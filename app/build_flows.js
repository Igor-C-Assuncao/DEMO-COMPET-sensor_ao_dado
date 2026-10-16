'use strict';
// Gera data/nodered/flows.json (gateway da fábrica) a partir do mapa de canais. Rode: node build_flows.js
const fs = require('fs'), path = require('path');
const { CANAIS } = require('./canais');

const canaisObj = {};
for (const c of CANAIS) {
  canaisObj[c.chave] = { linha: c.linha, maq: c.maq, varn: c.varn, origem: c.origem, tipo: c.tipo, periodo: c.periodo, unidade: c.unidade,
    min: c.min, max: c.max, lo: c.lo, hi: c.hi, salto: c.salto };
  for (const k of Object.keys(canaisObj[c.chave])) if (canaisObj[c.chave][k] === undefined || Math.abs(canaisObj[c.chave][k]) === 1e9) delete canaisObj[c.chave][k];
}

const INIT = String.raw`// MAPA DE CANAIS: é aqui que ficam a faixa, a unidade e a escala de cada canal (o "mapa de registradores" da fábrica).
// Se um canal não está aqui, o gateway não sabe o que ele significa e descarta o dado.
flow.set('canais', ` + JSON.stringify(canaisObj, null, 1) + String.raw`);
flow.set('est', {});      // último valor, repetições e última hora de cada canal
flow.set('visto', {});    // quando cada canal foi visto pela última vez
flow.set('down', {});     // canais sem dados no momento
flow.set('cont', { mensagens: 0, duplicatas: 0, desconhecidos: 0 });
flow.set('buf', []);      // linhas aguardando gravação no InfluxDB
`;

const GATEWAY = String.raw`// GATEWAY DA FÁBRICA
// Entrada: o que a máquina colocou na rede (planta/raw/<maquina>/<variavel>).
// Saída:   dado confiável em fabrica/<linha>/<maquina>/<variavel>, e uma linha gravada no InfluxDB.
// Passos:  1) hora do dado  2) descarta duplicata  3) converte o sinal  4) marca a qualidade  5) publica e guarda
const agora = Date.now();
const p = msg.topic.split('/');
const maq = p[2], vr = p[3];
const canais = flow.get('canais');
if (!canais) return null;
const est = flow.get('est'), visto = flow.get('visto'), cont = flow.get('cont'), buf = flow.get('buf');
cont.mensagens++;

// ---- apontamentos (eventos registrados por pessoas)
if (vr === 'evento') {
    const e = msg.payload || {};
    const ini = Date.parse(e.inicio), fim = Date.parse(e.fim);
    if (isNaN(ini) || isNaN(fim)) return null;
    const dur = (fim - ini) / 1000, atraso = (agora - fim) / 1000;
    const txt = String(e.texto || '').replace(/["\\]/g, '');
    buf.push('evento,maquina=' + maq + ',tipo=' + (e.tipo || 'parada') + ' duracao_s=' + dur.toFixed(1) + ',atraso_registro_s=' + atraso.toFixed(1) + ',texto="' + txt + '" ' + ini);
    return { topic: 'fabrica/eventos/' + maq, qos: 1, retain: true,
        payload: { tipo: e.tipo, inicio: new Date(ini).toISOString(), fim: new Date(fim).toISOString(), registrado_em: new Date(agora).toISOString(), atraso_registro_s: Math.round(atraso), texto: txt } };
}

const chave = maq + '/' + vr;
const c = canais[chave];
if (!c) { cont.desconhecidos++; return null; }
const pl = (msg.payload && typeof msg.payload === 'object') ? msg.payload : { valor: Number(msg.payload) };
const st = est[chave] || (est[chave] = { rep: 0, ultimo: null, ultimaHora: 0, picos: 0 });
const flags = [];
let valor = null, bruto = null;

// 1) hora do dado: da fonte (máquina moderna) ou da chegada (máquina legada não manda hora)
let horaMs = agora, horaOrigem = 'chegada';
if (pl.hora) { const h = Date.parse(pl.hora); if (!isNaN(h)) { horaMs = h; horaOrigem = 'fonte'; } else flags.push('hora_invalida'); }
// 2) duplicata: mesma hora na fonte que a mensagem anterior
if (horaOrigem === 'fonte' && horaMs === st.ultimaHora) { cont.duplicatas++; return null; }
if (horaOrigem === 'fonte') st.ultimaHora = horaMs;
const atrasoMs = agora - horaMs;
if (horaOrigem === 'fonte' && Math.abs(atrasoMs) > 120000) flags.push('relogio_fora');

// 3) conversão do sinal bruto em unidade de engenharia
if (c.tipo === '4-20mA') {
    const mA = Number(pl.mA);
    if (isNaN(mA) || mA < 3.8) flags.push('fio_rompido');                 // 0 mA não é "zero grau": é fio rompido
    else { valor = c.min + (mA - 4) / 16 * (c.max - c.min); bruto = mA; if (mA > 20.5) flags.push('acima_da_faixa'); }
} else if (c.tipo === 'pulsos') {
    valor = Number(pl.pulsos !== undefined ? pl.pulsos : pl.valor);
} else if (c.tipo === 'contato') {
    valor = Number(pl.contato !== undefined ? pl.contato : pl.valor);
} else {
    valor = Number(pl.valor);
    if (pl.unidade && pl.unidade !== c.unidade) {
        if (pl.unidade === 'psi' && c.unidade === 'bar') { valor = valor * 0.0689476; flags.push('unidade_convertida'); }
        else { flags.push('unidade_diferente'); valor = null; }
    }
}
if (valor !== null && isNaN(valor)) { valor = null; flags.push('valor_invalido'); }

// 4) checagens de qualidade (só em canais analógicos)
if (valor !== null && c.tipo !== 'pulsos' && c.tipo !== 'contato') {
    if (valor < c.lo || valor > c.hi) flags.push('fora_da_faixa');
    let salto = st.ultimo !== null && c.salto && Math.abs(valor - st.ultimo) > c.salto;
    if (salto && st.picos > 0 && Math.abs(valor - st.prev) <= c.salto) { salto = false; st.picos = 0; st.ultimo = valor; st.rep = 0; }   // o novo nível se manteve: não era pico
    else if (salto) { flags.push('pico'); st.picos++; }                    // salto brusco: marca e não adota como referência
    else { st.picos = 0; if (valor === st.ultimo) st.rep++; else st.rep = 0; st.ultimo = valor; }
    st.prev = valor;
    if (st.rep >= 8) flags.push('congelado');                              // oito leituras idênticas seguidas: sensor travado
}

const ordem = ['relogio_fora', 'fio_rompido', 'valor_invalido', 'unidade_diferente', 'pico', 'fora_da_faixa', 'congelado', 'acima_da_faixa', 'unidade_convertida', 'hora_invalida'];
let qual = 'boa';
for (const f of ordem) { if (flags.indexOf(f) >= 0) { qual = f; break; } }

// 5) publica o dado normalizado e guarda no InfluxDB
visto[chave] = agora;
const out = { valor: valor === null ? null : Math.round(valor * 1000) / 1000, unidade: c.unidade, qualidade: qual,
    hora: new Date(horaMs).toISOString(), hora_origem: horaOrigem, origem: c.origem, atraso_s: Math.round(atrasoMs / 1000) };
let campos = 'qualidade="' + qual + '",atraso_ms=' + Math.round(atrasoMs);
if (valor !== null) campos = 'valor=' + valor.toFixed(4) + ',' + campos;
if (bruto !== null) campos += ',bruto=' + bruto.toFixed(2);          // o sinal bruto (mA) também fica guardado
buf.push('leitura,linha=' + c.linha + ',maquina=' + maq + ',variavel=' + vr + ',origem=' + c.origem + ',unidade=' + (c.unidade || 'sem') + ' ' + campos + ' ' + horaMs);
return { topic: 'fabrica/' + c.linha + '/' + maq + '/' + vr, payload: out, qos: 0, retain: true };
`;

const WATCHDOG = String.raw`// VIGIA DE LINK: se um canal fica sem mandar dados por mais de 4 períodos (mínimo 15 s), avisa "sem_dados".
const agora = Date.now();
const canais = flow.get('canais'), visto = flow.get('visto'), down = flow.get('down'), buf = flow.get('buf'), cont = flow.get('cont');
if (!canais) return null;
const saidas = [];
for (const k in canais) {
    const c = canais[k], v = visto[k];
    if (!v) continue;                                   // ainda nunca visto
    const sem = (agora - v) > Math.max(4 * c.periodo, 15) * 1000;
    if (sem !== !!down[k]) {
        down[k] = sem;
        saidas.push({ topic: 'fabrica/_link/' + c.maq + '/' + c.varn, qos: 1, retain: true, payload: { link: sem ? 'sem_dados' : 'ok', desde: new Date(agora).toISOString() } });
    }
    buf.push('link,maquina=' + c.maq + ',variavel=' + c.varn + ' ok=' + (sem ? 0 : 1) + ' ' + agora);
}
buf.push('gateway mensagens=' + cont.mensagens + ',duplicatas=' + cont.duplicatas + ',desconhecidos=' + cont.desconhecidos + ' ' + agora);
saidas.push({ topic: 'fabrica/_gateway/contadores', retain: true, payload: { mensagens: cont.mensagens, duplicatas_descartadas: cont.duplicatas, canais_desconhecidos: cont.desconhecidos } });
return [saidas];
`;

const FLUSH = String.raw`// Grava no InfluxDB, em lote, o que o gateway acumulou no último segundo.
const buf = flow.get('buf');
if (!buf || buf.length === 0) return null;
flow.set('buf', []);
msg.payload = buf.join('\n');
msg.headers = { 'Authorization': 'Token demo-token-fabrica', 'Content-Type': 'text/plain; charset=utf-8' };
return msg;
`;

const ERRO = String.raw`if (msg.statusCode !== 204) node.warn('InfluxDB respondeu ' + msg.statusCode + ': ' + String(msg.payload).slice(0, 200));
return null;
`;

const T = 'tab_gateway', B = 'broker_local';
const f = (id, name, func, x, y, wires, extra) => Object.assign({ id, type: 'function', z: T, name, func, outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires }, extra || {});
const nodes = [
  { id: T, type: 'tab', label: 'Gateway da fábrica', disabled: false, info: 'Tudo simulado. Recebe planta/raw/#, normaliza, marca a qualidade e grava no InfluxDB.' },
  { id: B, type: 'mqtt-broker', name: 'Broker local', broker: '127.0.0.1', port: '1883', clientid: 'nodered-gateway', autoConnect: true, usetls: false, protocolVersion: '4',
    keepalive: '60', cleansession: true, autoUnsubscribe: true },
  { id: 'c1', type: 'comment', z: T, name: '1 · O que a máquina coloca na rede', info: 'planta/raw/<maquina>/<variavel>. Máquina moderna: valor, unidade e hora. Máquina legada: só o sinal bruto (mA, pulsos ou contato), sem hora.', x: 190, y: 40, wires: [] },
  { id: 'c2', type: 'comment', z: T, name: '2 · Gateway: converte, carimba, marca a qualidade', info: 'Abra o nó para ler a lógica e o mapa de canais (aba Ao iniciar).', x: 570, y: 40, wires: [] },
  { id: 'c3', type: 'comment', z: T, name: '3 · Dado confiável no MQTT e no InfluxDB', info: 'fabrica/<linha>/<maquina>/<variavel>', x: 960, y: 40, wires: [] },
  { id: 'mi', type: 'mqtt in', z: T, name: 'planta/raw/#', topic: 'planta/raw/#', qos: '0', datatype: 'json', broker: B, nl: false, rap: true, rh: 0, inputs: 0, x: 170, y: 120, wires: [['gw', 'dbg_raw']] },
  f('gw', 'gateway: converte, carimba e marca a qualidade', GATEWAY, 560, 120, [['mo']], { initialize: INIT }),
  { id: 'mo', type: 'mqtt out', z: T, name: 'fabrica/#', topic: '', qos: '', retain: '', respTopic: '', contentType: '', userProps: '', correl: '', expiry: '', broker: B, x: 950, y: 120, wires: [] },
  { id: 'dbg_raw', type: 'debug', z: T, name: 'bruto (desligado)', active: false, tosidebar: true, console: false, tostatus: false, complete: 'true', targetType: 'full', statusVal: '', statusType: 'auto', x: 430, y: 180, wires: [] },
  { id: 'dbg_out', type: 'debug', z: T, name: 'normalizado (desligado)', active: false, tosidebar: true, console: false, tostatus: false, complete: 'true', targetType: 'full', statusVal: '', statusType: 'auto', x: 760, y: 180, wires: [] },
  { id: 'iw', type: 'inject', z: T, name: 'a cada 5 s', props: [{ p: 'payload' }], repeat: '5', crontab: '', once: true, onceDelay: '3', topic: '', payload: '', payloadType: 'date', x: 150, y: 260, wires: [['wd']] },
  f('wd', 'vigia de link (sem dados?)', WATCHDOG, 400, 260, [['mo']]),
  { id: 'ifl', type: 'inject', z: T, name: 'a cada 1 s', props: [{ p: 'payload' }], repeat: '1', crontab: '', once: true, onceDelay: '3', topic: '', payload: '', payloadType: 'date', x: 150, y: 340, wires: [['fx']] },
  f('fx', 'grava em lote no InfluxDB', FLUSH, 400, 340, [['hr']]),
  { id: 'hr', type: 'http request', z: T, name: 'InfluxDB (write)', method: 'POST', ret: 'txt', paytoqs: 'ignore', url: 'http://127.0.0.1:8086/api/v2/write?org=demo&bucket=fabrica&precision=ms',
    tls: '', persist: false, proxy: '', insecureHTTPParser: false, authType: '', senderr: false, headers: [], x: 660, y: 340, wires: [['er']] },
  f('er', 'avisa se o InfluxDB recusar', ERRO, 900, 340, [[]]),
];
nodes[nodes.findIndex((n) => n.id === 'gw')].wires = [['mo', 'dbg_out']];

module.exports = { INIT, GATEWAY, WATCHDOG, FLUSH, canaisObj };

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'data', 'nodered');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'flows.json'), JSON.stringify(nodes, null, 2));
  fs.writeFileSync(path.join(dir, 'settings.js'), `module.exports = {
    uiPort: 1880,
    uiHost: '127.0.0.1',
    flowFile: 'flows.json',
    flowFilePretty: true,
    credentialSecret: 'demo-fabrica',
    telemetry: { enabled: false },
    logging: { console: { level: 'info', metrics: false, audit: false } },
    editorTheme: { tours: false, projects: { enabled: false } },
    contextStorage: { default: { module: 'memory' } },
  };
  `);
  console.log('flows.json e settings.js gerados em', dir);

}
