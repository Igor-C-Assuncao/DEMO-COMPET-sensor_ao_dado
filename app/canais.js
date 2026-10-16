'use strict';
// Mapa de canais da "Fábrica Demo" (100% simulada, sem relação com a Moura).
// Fonte única de verdade: o simulador, o historiador de ensaio, o gateway do Node-RED e os painéis do Grafana usam esta lista.
//  origem: 'moderna' (publica já em unidade, com hora na fonte) | 'legada' (sinal bruto: mA, pulsos ou contato, sem hora)
//  tipo:   'valor' | '4-20mA' | 'pulsos' | 'contato'
//  periodo: segundos entre leituras. lo/hi: faixa fisicamente plausível. salto: salto máximo entre leituras vizinhas.

const MAQUINAS = {
  prensa01:      { linha: 'linha1', nome: 'Prensa hidráulica P-01',  origem: 'moderna', via: 'OPC UA para MQTT' },
  bomba03:       { linha: 'linha1', nome: 'Bomba centrífuga B-03',   origem: 'moderna', via: 'sensores IO-Link' },
  forno02:       { linha: 'linha2', nome: 'Forno de cura F-02',      origem: 'moderna', via: 'CLP em rede (OPC UA)' },
  laminadora01:  { linha: 'linha2', nome: 'Laminadora L-01 (antiga)', origem: 'legada', via: 'sinais 4-20 mA e contatos no CLP antigo' },
  misturador02:  { linha: 'linha3', nome: 'Misturador M-02 (retrofit sem fio)', origem: 'legada', via: 'clip-on de corrente e sensor BLE' },
  esteira04:     { linha: 'linha3', nome: 'Esteira E-04 (antiga)',   origem: 'legada', via: 'contador de pulsos e apontamento por QR code' },
};

const L = [];
function add(maq, varn, o) {
  const m = MAQUINAS[maq];
  L.push(Object.assign({ chave: maq + '/' + varn, linha: m.linha, maq, varn, origem: m.origem, tipo: 'valor', periodo: 1, unidade: '', lo: -1e9, hi: 1e9, salto: 0, descricao: '' }, o));
}

// ---- modernas: já chegam em unidade de engenharia, com hora na fonte
add('prensa01', 'pressao_bar',      { unidade: 'bar',  lo: 0, hi: 250, salto: 120, descricao: 'Pressão do cilindro' });
add('prensa01', 'temp_oleo_c',      { unidade: 'C',    lo: 0, hi: 120, salto: 5,   descricao: 'Temperatura do óleo' });
add('prensa01', 'vibracao_mm_s',    { unidade: 'mm/s', lo: 0, hi: 25,  salto: 6,   descricao: 'Vibração RMS' });
add('prensa01', 'corrente_a',       { unidade: 'A',    lo: 0, hi: 100, salto: 40,  descricao: 'Corrente do motor' });
add('prensa01', 'ciclos',           { unidade: 'un',   tipo: 'pulsos', periodo: 5, descricao: 'Contador de ciclos' });
add('bomba03',  'vazao_m3h',        { unidade: 'm3/h', lo: 0, hi: 80,  salto: 8,   descricao: 'Vazão' });
add('bomba03',  'pressao_bar',      { unidade: 'bar',  lo: 0, hi: 10,  salto: 1.5, descricao: 'Pressão de descarga' });
add('bomba03',  'temp_carcaca_c',   { unidade: 'C',    lo: 0, hi: 120, salto: 5,   descricao: 'Temperatura da carcaça' });
add('bomba03',  'vibracao_mm_s',    { unidade: 'mm/s', lo: 0, hi: 25,  salto: 4,   descricao: 'Vibração RMS' });
add('bomba03',  'corrente_a',       { unidade: 'A',    lo: 0, hi: 40,  salto: 8,   descricao: 'Corrente do motor' });
add('forno02',  'temp_zona1_c',     { unidade: 'C',    lo: 0, hi: 300, salto: 8,   descricao: 'Zona 1, termopar' });
add('forno02',  'temp_zona1_ref_c', { unidade: 'C',    lo: 0, hi: 300, salto: 8,   descricao: 'Zona 1, Pt100 de referência' });
add('forno02',  'temp_zona2_c',     { unidade: 'C',    lo: 0, hi: 300, salto: 8,   descricao: 'Zona 2, termopar' });
add('forno02',  'temp_zona3_c',     { unidade: 'C',    lo: 0, hi: 300, salto: 8,   descricao: 'Zona 3, termopar' });
add('forno02',  'potencia_kw',      { unidade: 'kW',   lo: 0, hi: 60,  salto: 10,  descricao: 'Potência aplicada' });

// ---- legadas: chegam como sinal bruto (mA, pulsos, contato) e sem hora; quem converte é o gateway
add('laminadora01', 'temperatura_c', { unidade: 'C', tipo: '4-20mA', min: 0, max: 150, periodo: 2, lo: 0, hi: 160, salto: 15, descricao: 'Temperatura do rolo (4-20 mA)' });
add('laminadora01', 'corrente_a',    { unidade: 'A', tipo: '4-20mA', min: 0, max: 100, periodo: 2, lo: 0, hi: 110, salto: 40, descricao: 'Corrente do motor (4-20 mA)' });
add('laminadora01', 'ligada',        { unidade: '',  tipo: 'contato', periodo: 2, descricao: 'Contato: máquina ligada' });
add('laminadora01', 'pecas',         { unidade: 'un', tipo: 'pulsos', periodo: 2, descricao: 'Contador de peças' });
add('misturador02', 'corrente_a',    { unidade: 'A', tipo: '4-20mA', min: 0, max: 50, periodo: 5, lo: 0, hi: 55, salto: 20, descricao: 'Corrente do motor (clip-on)' });
add('misturador02', 'vibracao_mm_s', { unidade: 'mm/s', tipo: 'valor', periodo: 10, lo: 0, hi: 25, salto: 4, descricao: 'Vibração RMS (sensor BLE, 1 leitura a cada 10 s)' });
add('misturador02', 'ligada',        { unidade: '',  tipo: 'contato', periodo: 5, descricao: 'Contato: máquina ligada' });
add('esteira04',    'pecas',         { unidade: 'un', tipo: 'pulsos', periodo: 5, descricao: 'Contador de peças (pulsos)' });
add('esteira04',    'ligada',        { unidade: '',  tipo: 'contato', periodo: 5, descricao: 'Contato: esteira ligada' });
// estado da máquina moderna
add('prensa01', 'ligada',            { unidade: '',  tipo: 'contato', periodo: 5, descricao: 'Estado: rodando' });

const CENARIOS = {
  rolamento:       { rotulo: 'Rolamento desgastando',        maquina: 'bomba03',      duracao: 150, texto: 'Vibração e temperatura da bomba B-03 sobem aos poucos' },
  superaquecimento:{ rotulo: 'Superaquecimento do forno',    maquina: 'forno02',      duracao: 120, texto: 'Zona 2 do forno F-02 esquenta além do normal' },
  deriva:          { rotulo: 'Deriva do termopar',           maquina: 'forno02',      duracao: 150, texto: 'Termopar da zona 1 se afasta do Pt100 de referência' },
  fio_rompido:     { rotulo: 'Fio rompido (0 mA)',           maquina: 'laminadora01', duracao: 60,  texto: 'Sinal 4-20 mA da laminadora cai a 0 mA' },
  congelado:       { rotulo: 'Valor congelado',              maquina: 'prensa01',     duracao: 60,  texto: 'Pressão da prensa repete o mesmo valor' },
  pico:            { rotulo: 'Picos por interferência',      maquina: 'prensa01',     duracao: 60,  texto: 'Picos espúrios na corrente da prensa' },
  perda_link:      { rotulo: 'Perda de link sem fio',        maquina: 'misturador02', duracao: 60,  texto: 'O misturador deixa de enviar dados' },
  relogio:         { rotulo: 'Relógio atrasado 10 min',      maquina: 'prensa01',     duracao: 90,  texto: 'Relógio da prensa atrasado 10 minutos' },
  duplicata:       { rotulo: 'Mensagens duplicadas',         maquina: 'bomba03',      duracao: 40,  texto: 'A bomba envia cada mensagem duas vezes' },
  unidade:         { rotulo: 'Unidade trocada (psi)',        maquina: 'bomba03',      duracao: 60,  texto: 'Pressão da bomba passa a chegar em psi' },
  parada_legado:   { rotulo: 'Parada da esteira antiga',     maquina: 'esteira04',    duracao: 60,  texto: 'Esteira para; o apontamento chega depois' },
};

module.exports = { MAQUINAS, CANAIS: L, CENARIOS };
