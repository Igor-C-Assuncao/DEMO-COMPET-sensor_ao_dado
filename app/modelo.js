'use strict';
// Modelo físico simplificado da "Fábrica Demo": valor limpo de cada canal em um instante t (segundos, época Unix).
// Tudo simulado. O ruído é gaussiano e o comportamento é periódico, só para dar vida aos gráficos.

function gauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const n = (s) => gauss() * s;
const slow = (t, per, amp, ph = 0) => amp * Math.sin(2 * Math.PI * t / per + ph);
const bump = (t, per) => { const f = (t % per) / per; return f < 0.5 ? Math.sin(Math.PI * f / 0.5) : 0; };   // pulso do ciclo da prensa (0 a 1)

// "estado verdadeiro" do forno: o Pt100 e o termopar medem a mesma coisa
function trueForno(z, t) { return [205, 212, 208][z - 1] + slow(t, 300, 1.5, z); }

const F = {
  'prensa01/pressao_bar':      (t) => 20 + 160 * bump(t, 24) + n(1.5),
  'prensa01/temp_oleo_c':      (t) => 55 + slow(t, 1800, 3) + n(0.15),
  'prensa01/vibracao_mm_s':    (t) => 2.0 + 0.8 * bump(t, 24) + n(0.1),
  'prensa01/corrente_a':       (t) => 18 + 28 * bump(t, 24) + n(0.5),
  'prensa01/ciclos':           (t) => Math.floor(t / 24) % 1000000,
  'prensa01/ligada':           () => 1,
  'bomba03/vazao_m3h':         (t) => 42 + slow(t, 37, 1.2) + n(0.3),
  'bomba03/pressao_bar':       (t) => 4.1 + slow(t, 53, 0.06) + n(0.02),
  'bomba03/temp_carcaca_c':    (t) => 48 + slow(t, 2400, 2) + n(0.1),
  'bomba03/vibracao_mm_s':     (t) => 1.5 + slow(t, 211, 0.1) + n(0.08),
  'bomba03/corrente_a':        (t) => 12 + slow(t, 41, 0.4) + n(0.1),
  'forno02/temp_zona1_c':      (t) => trueForno(1, t) + n(0.3),
  'forno02/temp_zona1_ref_c':  (t) => trueForno(1, t) + n(0.08),
  'forno02/temp_zona2_c':      (t) => trueForno(2, t) + n(0.3),
  'forno02/temp_zona3_c':      (t) => trueForno(3, t) + n(0.3),
  'forno02/potencia_kw':       (t) => 31 + slow(t, 300, 3) + n(0.2),
  // legadas: o modelo devolve a grandeza física; o simulador converte para mA/pulsos
  'laminadora01/temperatura_c':(t) => 118 + slow(t, 600, 4) + n(0.3),
  'laminadora01/corrente_a':   (t) => 52 + slow(t, 90, 8) + n(1.0),
  'laminadora01/ligada':       () => 1,
  'laminadora01/pecas':        (t) => Math.floor(t / 3),
  'misturador02/corrente_a':   (t) => 22 + slow(t, 120, 6) + n(0.5),
  'misturador02/vibracao_mm_s':(t) => 3.4 + n(0.15),
  'misturador02/ligada':       () => 1,
  'esteira04/pecas':           (t) => Math.floor(t / 4),
  'esteira04/ligada':          () => 1,
};

const mAde = (v, min, max) => 4 + 16 * (v - min) / (max - min);
const r = (x, d) => { const k = Math.pow(10, d); return Math.round(x * k) / k; };

module.exports = { F, mAde, r, gauss, n, slow, bump, trueForno };
