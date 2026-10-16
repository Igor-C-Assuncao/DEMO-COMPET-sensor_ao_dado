'use strict';
// Geração do que cada canal coloca na rede (payload bruto), com os efeitos dos cenários de anomalia.
// Usada pelo simulador ao vivo (planta.js) e pelo gerador de histórico de ensaio (semear_historico.js).
const { F, mAde, r } = require('./modelo');

const TAXA = { 'prensa01/ciclos': 1 / 24, 'laminadora01/pecas': 1 / 3, 'esteira04/pecas': 1 / 4 };
const iso = (ms) => new Date(ms).toISOString();

function valorDe(c, t, sim) {
  if (c.tipo === 'pulsos') {
    if (sim.cont[c.chave] === undefined) sim.cont[c.chave] = Math.floor(t * TAXA[c.chave]) % 100000;
    const parado = c.chave === 'esteira04/pecas' && sim.tem('parada_legado');
    if (!parado) sim.cont[c.chave] += TAXA[c.chave] * c.periodo;
    return Math.floor(sim.cont[c.chave]);
  }
  return F[c.chave](t);
}

function efeitos(c, v, ctx, sim) {
  switch (c.chave) {
    case 'bomba03/vibracao_mm_s': v += 7.5 * sim.prog('rolamento', 150); break;
    case 'bomba03/temp_carcaca_c': v += 10 * sim.prog('rolamento', 150); break;
    case 'bomba03/corrente_a': v += 2 * sim.prog('rolamento', 150); break;
    case 'forno02/temp_zona2_c': v += 32 * sim.prog('superaquecimento', 120); break;
    case 'forno02/potencia_kw': v += 6 * sim.prog('superaquecimento', 120); break;
    case 'forno02/temp_zona1_c': v += 14 * sim.prog('deriva', 150); break;
    case 'prensa01/pressao_bar':
      if (sim.tem('congelado')) { const d = sim.dados('congelado'); if (d.v === undefined) d.v = v; v = d.v; }
      break;
    case 'prensa01/corrente_a': if (sim.tem('pico') && Math.random() < 0.15) v += 85; break;
    case 'bomba03/pressao_bar': if (sim.tem('unidade')) { v *= 14.5038; ctx.unidade = 'psi'; } break;
    case 'esteira04/ligada': if (sim.tem('parada_legado')) v = 0; break;
  }
  return v;
}

// devolve { skip, payload, duplicar }
function gerar(c, now, sim) {
  if (c.maq === 'misturador02' && sim.tem('perda_link')) return { skip: true };      // link sem fio caiu
  const ctx = { unidade: c.unidade };
  const v = efeitos(c, valorDe(c, now / 1000, sim), ctx, sim);
  let p;
  if (c.origem === 'moderna') {
    const skew = c.maq === 'prensa01' && sim.tem('relogio') ? 600000 : 0;
    p = { valor: c.tipo === 'pulsos' || c.tipo === 'contato' ? v : r(v, 3), unidade: ctx.unidade, hora: iso(now - skew) };
  } else if (c.tipo === '4-20mA') {
    let mA = mAde(v, c.min, c.max);
    if (c.chave === 'laminadora01/temperatura_c' && sim.tem('fio_rompido')) mA = 0;
    p = { mA: r(mA, 2) };
  } else if (c.tipo === 'pulsos') p = { pulsos: v };
  else if (c.tipo === 'contato') p = { contato: v ? 1 : 0 };
  else p = { valor: r(v, 2), unidade: c.unidade };                               // sensor BLE: valor em unidade, sem hora
  return { skip: false, payload: p, duplicar: c.maq === 'bomba03' && sim.tem('duplicata') };
}

module.exports = { gerar, iso };
