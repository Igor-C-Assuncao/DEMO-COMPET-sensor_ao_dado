'use strict';
// Gera um histórico de ensaio (padrão: 3 horas) no InfluxDB, com vários episódios de anomalia, para os painéis do Grafana já abrirem "vividos".
// Usa o MESMO código do gateway do Node-RED (rodado com um relógio simulado), então a qualidade marcada é a mesma que ao vivo.
// Uso: node semear_historico.js [minutos=180] [--limpar]
const { CANAIS, CENARIOS } = require('./canais');
const { gerar } = require('./geracao');
const B = require('./build_flows');

const MIN = +(process.argv.find((a) => /^\d+$/.test(a)) || 180);
const LIMPAR = process.argv.includes('--limpar');
const INFLUX = process.env.INFLUX || 'http://127.0.0.1:8086', TOKEN = process.env.INFLUX_TOKEN || 'demo-token-fabrica';
const H = { Authorization: 'Token ' + TOKEN };

const ADIANTE = +(((process.argv.find((a) => a.startsWith('--adiante=')) || '').split('=')[1]) || 0);   // segundos: cobre o tempo que os serviços levam para subir
const FIM = Date.now() + ADIANTE * 1000, INI = FIM - MIN * 60000;
// [minutos atrás, cenário, duração em s]
const EP = [[168, 'superaquecimento', 120], [150, 'deriva', 150], [133, 'rolamento', 150], [118, 'fio_rompido', 60], [104, 'congelado', 60], [92, 'pico', 60],
  [80, 'perda_link', 70], [68, 'relogio', 90], [57, 'duplicata', 40], [47, 'unidade', 60], [36, 'parada_legado', 60], [24, 'rolamento', 150],
  [14, 'fio_rompido', 45], [8, 'pico', 40]].filter((e) => e[0] < MIN - 2)
  .map(([m, nome, d]) => ({ nome, ini: FIM - m * 60000, fim: FIM - m * 60000 + d * 1000, dados: {} }));

// ---- relógio simulado e contexto do Node-RED
let simNow = INI;
function FakeDate(...a) { return a.length ? new Date(...a) : new Date(simNow); }
FakeDate.now = () => simNow; FakeDate.parse = Date.parse; FakeDate.UTC = Date.UTC;
const store = new Map();
const flow = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
const node = { warn() { }, log() { } };
new Function('flow', B.INIT)(flow);
const gw = new Function('flow', 'msg', 'node', 'Date', B.GATEWAY);
const wd = new Function('flow', 'msg', 'node', 'Date', B.WATCHDOG);

const ativoEm = (nome) => EP.find((e) => e.nome === nome && simNow >= e.ini && simNow < e.fim);
const sim = { cont: {}, tem: (n) => !!ativoEm(n), prog: (n, ramp) => { const e = ativoEm(n); return e ? Math.min(1, (simNow - e.ini) / 1000 / ramp) : 0; },
  dados: (n) => ativoEm(n).dados };

const extras = [];   // linhas que não passam pelo gateway (marcadores de cenário)
for (const e of EP) {
  const c = CENARIOS[e.nome];
  extras.push(`cenario,nome=${e.nome},maquina=${c.maquina} ativo=1,rotulo="${c.rotulo}",texto="${c.texto}" ${e.ini}`);
  extras.push(`cenario,nome=${e.nome},maquina=${c.maquina} ativo=0,rotulo="${c.rotulo}",texto="${c.texto}" ${e.fim}`);
}
// eventos agendados: [instante, tópico, payload]
const eventos = [];
for (const e of EP) if (e.nome === 'parada_legado')
  eventos.push([e.fim + 25000, 'planta/raw/esteira04/evento', { tipo: 'parada', inicio: new Date(e.ini).toISOString(), fim: new Date(e.fim).toISOString(), texto: 'Parada da esteira E-04 (apontamento por QR code)' }]);
for (let t = INI + 600000; t < FIM - 60000; t += 240000)
  eventos.push([t + 110000, 'planta/raw/laminadora01/evento', { tipo: 'ajuste', inicio: new Date(t).toISOString(), fim: new Date(t + 90000).toISOString(), texto: 'Ajuste de rolo (apontamento manual)' }]);
eventos.sort((a, b) => a[0] - b[0]);

const prox = {}; for (const c of CANAIS) prox[c.chave] = INI + Math.random() * c.periodo * 1000;
const passo = (c) => Math.max(c.periodo, 2) * 1000;
let proxWd = INI + 5000, ie = 0, n = 0;
for (simNow = INI; simNow < FIM; simNow += 500) {
  for (const c of CANAIS) {
    if (simNow < prox[c.chave]) continue;
    prox[c.chave] += passo(c);
    const g = gerar(c, simNow, sim);
    if (g.skip) continue;
    gw(flow, { topic: 'planta/raw/' + c.chave, payload: g.payload }, node, FakeDate); n++;
    if (g.duplicar) gw(flow, { topic: 'planta/raw/' + c.chave, payload: g.payload }, node, FakeDate);
  }
  while (ie < eventos.length && eventos[ie][0] <= simNow) { gw(flow, { topic: eventos[ie][1], payload: eventos[ie][2] }, node, FakeDate); ie++; }
  if (simNow >= proxWd) { proxWd += 5000; wd(flow, {}, node, FakeDate); }
}

(async () => {
  if (LIMPAR) {
    const r = await fetch(`${INFLUX}/api/v2/delete?org=demo&bucket=fabrica`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: '1970-01-01T00:00:00Z', stop: '2100-01-01T00:00:00Z' }) });
    console.log('limpeza do bucket:', r.status);
  }
  const linhas = store.get('buf').concat(extras);
  for (let i = 0; i < linhas.length; i += 5000) {
    const r = await fetch(`${INFLUX}/api/v2/write?org=demo&bucket=fabrica&precision=ms`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain; charset=utf-8' }, body: linhas.slice(i, i + 5000).join('\n') });
    if (r.status !== 204) { console.error('erro ao gravar', r.status, await r.text()); process.exit(1); }
  }
  console.log(`histórico de ${MIN} min gravado: ${n} mensagens simuladas, ${linhas.length} linhas, ${EP.length} episódios de anomalia`);
})();
