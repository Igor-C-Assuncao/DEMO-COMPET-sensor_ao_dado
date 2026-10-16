'use strict';
// Simulador da "Fábrica Demo": publica o que cada máquina colocaria na rede (sinais brutos nas legadas, valores em unidade nas modernas)
// e executa os cenários de anomalia. Também serve a página do monitor MQTT (porta 8088). Tudo simulado.
const fs = require('fs'), path = require('path'), http = require('http');
const mqtt = require('mqtt');
const { CANAIS, CENARIOS, MAQUINAS } = require('./canais');

const BROKER = process.env.BROKER || 'mqtt://127.0.0.1:1883';
const INFLUX = process.env.INFLUX || 'http://127.0.0.1:8086';
const TOKEN = process.env.INFLUX_TOKEN || 'demo-token-fabrica';
const PORTA = +(process.env.MONITOR_PORT || 8088);
const AUTO_INICIAL = process.argv.includes('--auto');
const ROOT = path.join(__dirname, '..');

const cli = mqtt.connect(BROKER, { clientId: 'simulador-planta', reconnectPeriod: 2000,
  will: { topic: 'demo/status', payload: JSON.stringify({ online: false }), retain: true } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- cenários
const ativos = new Map();   // nome -> { inicio, fim, dados }
let auto = AUTO_INICIAL, ordemAuto = 0;
const prog = (nome, rampa) => { const a = ativos.get(nome); return a ? Math.min(1, (Date.now() - a.inicio) / 1000 / rampa) : 0; };

function influx(linha) {
  fetch(`${INFLUX}/api/v2/write?org=demo&bucket=fabrica&precision=ms`, { method: 'POST', headers: { Authorization: 'Token ' + TOKEN }, body: linha })
    .catch(() => { });
}
function marcador(nome, ativo) {
  const c = CENARIOS[nome];
  influx(`cenario,nome=${nome},maquina=${c.maquina} ativo=${ativo},rotulo="${c.rotulo}",texto="${c.texto}" ${Date.now()}`);
}
function publicaStatus() {
  const agora = Date.now();
  const lista = [...ativos.entries()].map(([nome, a]) => ({ nome, rotulo: CENARIOS[nome].rotulo, restante_s: Math.max(0, Math.round((a.fim - agora) / 1000)) }));
  cli.publish('demo/status', JSON.stringify({ online: true, auto, ativos: lista }), { retain: true });
}
function ativar(nome, dur) {
  const c = CENARIOS[nome]; if (!c) return;
  const d = (dur && dur > 0 ? dur : c.duracao) * 1000, agora = Date.now();
  ativos.set(nome, { inicio: agora, fim: agora + d, dados: {} });
  marcador(nome, 1); log('cenário ON ', nome, Math.round(d / 1000) + 's'); publicaStatus();
}
function encerrar(nome) {
  const a = ativos.get(nome); if (!a) return;
  ativos.delete(nome); marcador(nome, 0); log('cenário OFF', nome);
  if (nome === 'parada_legado') {
    setTimeout(() => {   // o apontamento por QR code só chega depois (hora do registro diferente da hora do evento)
      cli.publish('planta/raw/esteira04/evento', JSON.stringify({ tipo: 'parada', inicio: new Date(a.inicio).toISOString(), fim: new Date(Date.now() - 25000).toISOString(),
        texto: 'Parada da esteira E-04 (apontamento por QR code)' }));
    }, 25000);
  }
  publicaStatus();
}
setInterval(() => { const agora = Date.now(); for (const [n, a] of ativos) if (agora >= a.fim) encerrar(n); }, 500);
setInterval(publicaStatus, 5000);
setInterval(() => {
  if (!auto) return;
  const nomes = Object.keys(CENARIOS); const n = nomes[ordemAuto++ % nomes.length];
  if (!ativos.has(n)) ativar(n);
}, 80000);

// ---------------------------------------------------------------- canais
const { gerar, iso } = require('./geracao');
const sim = { cont: {}, tem: (n) => ativos.has(n), prog, dados: (n) => ativos.get(n).dados };

function publica(c) {
  const g = gerar(c, Date.now(), sim);
  if (g.skip) return;
  const msg = JSON.stringify(g.payload), topico = 'planta/raw/' + c.chave;
  cli.publish(topico, msg);
  if (g.duplicar) cli.publish(topico, msg);                                       // a rede reenviou a mesma mensagem
}

// eventos de apontamento (hora do registro diferente da hora do evento)
setInterval(() => {
  const fim = Date.now() - 20000, ini = fim - 90000;
  cli.publish('planta/raw/laminadora01/evento', JSON.stringify({ tipo: 'ajuste', inicio: iso(ini), fim: iso(fim), texto: 'Ajuste de rolo (apontamento manual)' }));
}, 240000);

cli.on('connect', () => {
  log('conectado ao broker', BROKER);
  cli.subscribe(['demo/cenario/+', 'demo/cmd/+']);
  publicaStatus();
});
cli.on('message', (topic, buf) => {
  const txt = buf.toString().trim().toLowerCase(); const nome = topic.split('/').pop();
  if (topic.startsWith('demo/cenario/')) {
    if (nome === 'normal') { for (const n of [...ativos.keys()]) encerrar(n); return; }
    if (txt === 'off') encerrar(nome); else { const d = parseFloat(txt); ativar(nome, isNaN(d) ? 0 : d); }
  } else if (topic === 'demo/cmd/auto') { auto = txt === 'on'; log('modo automático', auto); publicaStatus(); }
});
cli.on('error', (e) => log('mqtt erro', e.message));

for (const c of CANAIS) {
  if (c.chave === 'prensa01/ligada') { /* vai pelo mesmo laço */ }
  setTimeout(() => setInterval(() => { if (cli.connected) publica(c); }, c.periodo * 1000), Math.random() * c.periodo * 1000);
}

// ---------------------------------------------------------------- servidor do monitor
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/meta') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ maquinas: MAQUINAS, canais: CANAIS, cenarios: CENARIOS }));
  }
  let f = u === '/' ? path.join(ROOT, 'monitor', 'index.html')
    : u === '/vendor/mqtt.min.js' ? path.join(__dirname, 'node_modules', 'mqtt', 'dist', 'mqtt.min.js')
    : path.join(ROOT, 'monitor', u.replace(/\.\./g, ''));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('nao encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(d);
  });
}).listen(PORTA, '127.0.0.1', () => log('monitor em http://localhost:' + PORTA));
