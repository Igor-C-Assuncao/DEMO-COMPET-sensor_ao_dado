'use strict';
// Broker MQTT local da demonstração: TCP 1883 (clientes) e WebSocket 9001 (página do monitor). Só escuta em 127.0.0.1.
const { createServer } = require('aedes-server-factory');
const aedesPkg = require('aedes');
(async () => {
  const aedes = aedesPkg.Aedes && aedesPkg.Aedes.createBroker ? await aedesPkg.Aedes.createBroker() : (aedesPkg.default ? aedesPkg.default() : aedesPkg());
  const tcp = createServer(aedes);
  const ws = createServer(aedes, { ws: true });
  tcp.listen(1883, '127.0.0.1', () => console.log('broker MQTT em 127.0.0.1:1883'));
  ws.listen(9001, '127.0.0.1', () => console.log('broker MQTT (WebSocket) em 127.0.0.1:9001'));
  let n = 0;
  aedes.on('client', (c) => console.log('cliente conectado:', c && c.id));
  aedes.on('clientDisconnect', (c) => console.log('cliente saiu:', c && c.id));
  aedes.on('publish', () => { n++; });
  setInterval(() => { console.log('mensagens no último minuto:', n); n = 0; }, 60000);
})().catch((e) => { console.error(e); process.exit(1); });
