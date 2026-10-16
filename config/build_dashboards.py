# -*- coding: utf-8 -*-
"""Gera os painéis do Grafana (JSON) e a provisão do datasource. Rode: python build_dashboards.py"""
import json, os, re

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(AQUI, "grafana", "dashboards")
PROV = os.path.join(AQUI, "grafana", "provisioning")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PROV + "/datasources", exist_ok=True)
os.makedirs(PROV + "/dashboards", exist_ok=True)
DS = {"type": "influxdb", "uid": "influx-fabrica"}

CORES = {"azul": "#5794F2", "amarelo": "#F4AB1C", "verde": "#73BF69", "vermelho": "#F2495C", "laranja": "#FF9830", "roxo": "#B877D9", "ciano": "#8AB8FF", "cinza": "#9AA0B8"}
BASE = 'from(bucket: "fabrica")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'


def filtro(pares):
    return " or ".join('(r.maquina == "%s" and r.variavel == "%s")' % p for p in pares)


def q_series(pares, col="variavel", campo="valor", fn="mean", every="5s", nomes=None, medida="leitura"):
    """Série(s) em colunas largas (uma por máquina ou variável). Lacunas viram nulos."""
    cols = nomes or [p[1] if col == "variavel" else p[0] for p in pares]
    return (BASE + '  |> filter(fn: (r) => r._measurement == "%s" and r._field == "%s" and (%s))\n' % (medida, campo, filtro(pares)) +
            '  |> aggregateWindow(every: %s, fn: %s, createEmpty: true)\n' % (every, fn) +
            '  |> pivot(rowKey: ["_time"], columnKey: ["%s"], valueColumn: "_value")\n' % col +
            '  |> keep(columns: ["_time", %s])' % ", ".join('"%s"' % c for c in cols))


def adapta(q):
    """Janela de agregacao que cresce com o intervalo (no maximo ~700 pontos por serie), com minimo igual ao pedido na consulta."""
    q = q.replace('|> pivot(rowKey: ["_time"]', '|> group()\n  |> pivot(rowKey: ["_time"]')      # uma tabela só: as colunas de máquinas e variáveis ficam na mesma linha de tempo
    m = re.search(r"every: (\d+)s", q)
    if not m:
        return q
    mn = int(m.group(1)) * 1000000000
    pre = ("passo = (int(v: v.timeRangeStop) - int(v: v.timeRangeStart)) / 700\n"
           "janela = if passo > %d then duration(v: passo) else duration(v: %d)\n\n" % (mn, mn))
    return pre + re.sub(r"every: \d+s", "every: janela", q)


def target(q, ref="A"):
    return {"refId": ref, "datasource": DS, "query": adapta(q)}


_id = [0]


def nid():
    _id[0] += 1
    return _id[0]


def grid(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def ts(titulo, q, pos, unit="", cores=None, desc="", lim=None, minimo=None, maximo=None, span=25000, stack=False, pontos=False, draw="line", largura=2, sobrepor=None, tooltips=True):
    over = []
    for nome, cor in (cores or {}).items():
        over.append({"matcher": {"id": "byName", "options": nome}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": cor}}]})
    for nome, props in (sobrepor or {}).items():
        over.append({"matcher": {"id": "byName", "options": nome}, "properties": props})
    custom = {"drawStyle": draw, "lineWidth": largura, "fillOpacity": 8 if draw == "line" else 70, "showPoints": "always" if pontos else "never", "pointSize": 5, "spanNulls": span,
              "lineInterpolation": "linear", "axisPlacement": "auto", "gradientMode": "none", "stacking": {"mode": "normal" if stack else "none", "group": "A"}}
    d = {"unit": unit, "custom": custom, "color": {"mode": "palette-classic"}}
    if lim:
        d["thresholds"] = {"mode": "absolute", "steps": [{"color": "transparent", "value": None}] + [{"color": c, "value": v} for v, c in lim]}
        custom["thresholdsStyle"] = {"mode": "line+area"}
    else:
        d["thresholds"] = {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
    if minimo is not None: d["min"] = minimo
    if maximo is not None: d["max"] = maximo
    return {"id": nid(), "type": "timeseries", "title": titulo, "description": desc, "datasource": DS, "gridPos": pos, "targets": [target(q)],
            "fieldConfig": {"defaults": d, "overrides": over},
            "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True}, "tooltip": {"mode": "multi" if tooltips else "single", "sort": "none"}}}


def stat(titulo, q, pos, unit="", lim=None, sem_dado="0", decimais=None, cor_modo="thresholds", desc="", texto="value"):
    d = {"unit": unit, "noValue": sem_dado, "color": {"mode": cor_modo},
         "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}] + [{"color": c, "value": v} for v, c in (lim or [])]}}
    if decimais is not None: d["decimals"] = decimais
    return {"id": nid(), "type": "stat", "title": titulo, "description": desc, "datasource": DS, "gridPos": pos, "targets": [target(q)],
            "fieldConfig": {"defaults": d, "overrides": []},
            "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "background", "graphMode": "area", "textMode": texto, "justifyMode": "center"}}


def timeline(titulo, q, pos, mapa, desc=""):
    valores = {str(k): {"text": t, "color": c, "index": i} for i, (k, (t, c)) in enumerate(mapa.items())}
    return {"id": nid(), "type": "state-timeline", "title": titulo, "description": desc, "datasource": DS, "gridPos": pos, "targets": [target(q)],
            "fieldConfig": {"defaults": {"mappings": [{"type": "value", "options": valores}], "custom": {"fillOpacity": 80, "lineWidth": 0, "spanNulls": False},
                                         "color": {"mode": "fixed", "fixedColor": "green"}, "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}}, "overrides": []},
            "options": {"mergeValues": True, "showValue": "auto", "alignValue": "left", "rowHeight": 0.8, "legend": {"showLegend": True, "displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "single"}}}


def tabela(titulo, q, pos, desc="", overrides=None, ocultar=None, renomear=None, ordem=None):
    trans = []
    if ocultar or renomear or ordem:
        trans.append({"id": "organize", "options": {"excludeByName": {c: True for c in (ocultar or [])}, "renameByName": renomear or {},
                                                      "indexByName": {c: i for i, c in enumerate(ordem or [])}}})
    return {"id": nid(), "type": "table", "title": titulo, "description": desc, "datasource": DS, "gridPos": pos, "targets": [target(q)],
            "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"}, "filterable": False}, "color": {"mode": "thresholds"},
                                         "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}}, "overrides": overrides or []},
            "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": False}}, "transformations": trans}


def texto(titulo, md, pos):
    return {"id": nid(), "type": "text", "title": titulo, "gridPos": pos, "options": {"mode": "markdown", "content": md}}


def barras(titulo, q, pos, desc="", cores=None, unit=""):
    over = [{"matcher": {"id": "byName", "options": n}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": c}}]} for n, c in (cores or {}).items()]
    return {"id": nid(), "type": "timeseries", "title": titulo, "description": desc, "datasource": DS, "gridPos": pos, "targets": [target(q)],
            "fieldConfig": {"defaults": {"unit": unit, "custom": {"drawStyle": "bars", "fillOpacity": 85, "lineWidth": 1, "stacking": {"mode": "normal", "group": "A"}, "spanNulls": False,
                                                                 "showPoints": "never", "barAlignment": 0}, "color": {"mode": "palette-classic"},
                                         "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}}, "overrides": over},
            "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True}, "tooltip": {"mode": "multi", "sort": "desc"}}}


def dashboard(uid, titulo, paineis, refresh="5s", desde="now-15m", tags=None, descricao=""):
    anot = {"builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"}, "enable": False, "hide": True, "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard"}
    cen = {"datasource": DS, "enable": True, "iconColor": "#F4AB1C", "name": "Cenários injetados", "target": {"refId": "Anno", "query":
           'from(bucket: "fabrica")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r._measurement == "cenario" and r._field == "ativo" or r._field == "rotulo" or r._field == "texto")\n'
           '  |> pivot(rowKey: ["_time", "nome", "maquina"], columnKey: ["_field"], valueColumn: "_value")\n  |> filter(fn: (r) => r.ativo == 1.0)\n  |> keep(columns: ["_time", "rotulo", "texto", "nome"])'},
           "mappings": {"title": {"source": "field", "value": "rotulo"}, "text": {"source": "field", "value": "texto"}, "tags": {"source": "field", "value": "nome"}}}
    return {"uid": uid, "title": titulo, "description": descricao, "tags": tags or ["demo", "aula15"], "timezone": "browser", "schemaVersion": 39, "version": 1, "editable": True,
            "graphTooltip": 1, "refresh": refresh, "time": {"from": desde, "to": "now"}, "timepicker": {"refresh_intervals": ["1s", "5s", "10s", "30s", "1m"]},
            "annotations": {"list": [anot, cen]}, "templating": {"list": []}, "panels": paineis, "links": [
                {"title": "1 · Visão geral", "type": "link", "url": "/d/fab-geral", "icon": "dashboard", "targetBlank": False},
                {"title": "2 · Moderna x legada", "type": "link", "url": "/d/fab-modleg", "icon": "dashboard", "targetBlank": False},
                {"title": "3 · Anomalias", "type": "link", "url": "/d/fab-anom", "icon": "dashboard", "targetBlank": False}]}


def salvar(nome, d):
    with open(os.path.join(OUT, nome), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


# =================================================================== 1 · VISÃO GERAL
_id[0] = 0
BOAS = 'from(bucket: "fabrica")\n  |> range(start: -2m)\n  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "qualidade")\n  |> map(fn: (r) => ({_time: r._time, _value: if r._value == "boa" then 100.0 else 0.0}))\n  |> group()\n  |> mean()'
SEMDADOS = 'from(bucket: "fabrica")\n  |> range(start: -1m)\n  |> filter(fn: (r) => r._measurement == "link" and r._field == "ok")\n  |> group(columns: ["maquina", "variavel"])\n  |> last()\n  |> filter(fn: (r) => r._value == 0.0)\n  |> group()\n  |> count()'
MSGMIN = 'from(bucket: "fabrica")\n  |> range(start: -1m)\n  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "qualidade")\n  |> group()\n  |> count()'
CENARIOS_Q = ('from(bucket: "fabrica")\n  |> range(start: -6h)\n  |> filter(fn: (r) => r._measurement == "cenario")\n  |> pivot(rowKey: ["_time", "nome", "maquina"], columnKey: ["_field"], valueColumn: "_value")\n'
              '  |> group(columns: ["nome"])\n  |> sort(columns: ["_time"])\n  |> tail(n: 1)\n  |> group()\n  |> sort(columns: ["ativo", "_time"], desc: true)\n  |> keep(columns: ["_time", "rotulo", "maquina", "ativo"])')
QUALIDADE_Q = ('from(bucket: "fabrica")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "qualidade")\n'
               '  |> map(fn: (r) => ({r with ruim: if r._value == "boa" then 0.0 else 1.0, tot: 1.0}))\n  |> group(columns: ["maquina", "variavel", "origem"])\n'
               '  |> reduce(identity: {ruim: 0.0, tot: 0.0}, fn: (r, accumulator) => ({ruim: accumulator.ruim + r.ruim, tot: accumulator.tot + r.tot}))\n'
               '  |> map(fn: (r) => ({r with pct: r.ruim / r.tot * 100.0}))\n  |> group()\n  |> sort(columns: ["pct"], desc: true)\n  |> keep(columns: ["maquina", "variavel", "origem", "tot", "ruim", "pct"])')
LIGADAS_Q = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "valor" and r.variavel == "ligada")\n  |> aggregateWindow(every: 10s, fn: last, createEmpty: false)\n'
             '  |> pivot(rowKey: ["_time"], columnKey: ["maquina"], valueColumn: "_value")\n  |> keep(columns: ["_time", "prensa01", "laminadora01", "misturador02", "esteira04"])')
p = [
    stat("Leituras boas (últimos 2 min)", BOAS, grid(0, 0, 5, 4), unit="percent", lim=[(0, "red"), (90, "orange"), (98, "green")], decimais=1, sem_dado="sem dados",
         desc="Percentual de leituras que o gateway marcou como 'boa'."),
    stat("Canais sem dados agora", SEMDADOS, grid(5, 0, 4, 4), lim=[(1, "red")], desc="Canais que pararam de enviar (vigia de link do gateway)."),
    stat("Mensagens no último minuto", MSGMIN, grid(9, 0, 4, 4), lim=[(1, "green")], cor_modo="fixed", desc="Quantas leituras entraram na última minuto."),
    tabela("Cenários de anomalia (injetados na simulação)", CENARIOS_Q, grid(13, 0, 11, 8),
           desc="Em uma fábrica real ninguém avisa que há uma anomalia. Aqui a simulação mostra o que foi injetado, para comparar com o que os gráficos revelam.",
           overrides=[{"matcher": {"id": "byName", "options": "ativo"}, "properties": [{"id": "mappings", "value": [{"type": "value", "options": {"1": {"text": "ATIVO", "color": "red", "index": 0}, "0": {"text": "encerrado", "color": "green", "index": 1}}}]},
                                                                                     {"id": "custom.cellOptions", "value": {"type": "color-text"}}]},
                      {"matcher": {"id": "byName", "options": "_time"}, "properties": [{"id": "displayName", "value": "desde"}]}]),
    timeline("Máquinas ligadas", LIGADAS_Q, grid(0, 4, 13, 6), {1: ("ligada", "green"), 0: ("parada", "red")}, desc="Contato de 'ligada' de cada máquina."),
    ts("Bomba B-03 (moderna): vibração e temperatura", q_series([("bomba03", "vibracao_mm_s"), ("bomba03", "temp_carcaca_c")]), grid(0, 8, 12, 8),
       cores={"vibracao_mm_s": "yellow", "temp_carcaca_c": "orange"}, desc="Uma bomba moderna entrega valor, unidade e hora a cada segundo. Vibração no eixo esquerdo, temperatura no direito.",
       sobrepor={"temp_carcaca_c": [{"id": "custom.axisPlacement", "value": "right"}, {"id": "custom.thresholdsStyle", "value": {"mode": "off"}}, {"id": "unit", "value": "celsius"}, {"id": "min", "value": 30}], "vibracao_mm_s": [{"id": "unit", "value": "suffix:mm/s"}, {"id": "min", "value": 0}]}),
    ts("Forno F-02 (moderno): zonas de temperatura", q_series([("forno02", "temp_zona1_c"), ("forno02", "temp_zona1_ref_c"), ("forno02", "temp_zona2_c"), ("forno02", "temp_zona3_c")]),
       grid(12, 8, 12, 8), unit="celsius", minimo=190, desc="Termopar (z1), Pt100 de referência (z1_ref) e as zonas 2 e 3.", cores={"temp_zona1_c": "orange", "temp_zona1_ref_c": "green", "temp_zona2_c": "blue", "temp_zona3_c": "purple"}),
    ts("Laminadora L-01 (legada): temperatura do rolo", q_series([("laminadora01", "temperatura_c")]), grid(0, 16, 12, 7), unit="celsius", cores={"temperatura_c": "blue"},
       desc="Sinal 4-20 mA do CLP antigo, convertido para °C pelo gateway."),
    ts("Prensa P-01 (moderna): pressão do cilindro", q_series([("prensa01", "pressao_bar")], fn="max", every="2s"), grid(12, 16, 12, 7), unit="pressurebar", cores={"pressao_bar": "green"},
       desc="Ciclo de prensagem a cada 24 s."),
    tabela("Qualidade dos dados por canal (no intervalo escolhido)", QUALIDADE_Q, grid(0, 23, 24, 9),
           desc="Quanto de cada canal o gateway marcou como não confiável. Em ordem decrescente.",
           overrides=[{"matcher": {"id": "byName", "options": "pct"}, "properties": [{"id": "custom.cellOptions", "value": {"type": "gauge", "mode": "basic"}}, {"id": "unit", "value": "percent"},
                                                                                      {"id": "min", "value": 0}, {"id": "max", "value": 100},
                                                                                      {"id": "thresholds", "value": {"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 5}, {"color": "red", "value": 20}]}}]}],
           renomear={"maquina": "máquina", "variavel": "variável", "tot": "leituras", "ruim": "não confiáveis", "pct": "% ruim"}, ordem=["maquina", "variavel", "origem", "tot", "ruim", "pct"]),
]
salvar("01_visao_geral.json", dashboard("fab-geral", "1 · Visão geral da fábrica", p, descricao="Fábrica Demo: dados 100% simulados"))

# =================================================================== 2 · MODERNA X LEGADA
_id[0] = 0
RATE = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "qualidade")\n  |> group(columns: ["origem"])\n  |> aggregateWindow(every: 1m, fn: count, createEmpty: false)\n'
        '  |> pivot(rowKey: ["_time"], columnKey: ["origem"], valueColumn: "_value")\n  |> keep(columns: ["_time", "moderna", "legada"])')
BRUTO = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r.maquina == "laminadora01" and r.variavel == "temperatura_c" and (r._field == "valor" or r._field == "bruto"))\n'
         '  |> aggregateWindow(every: 5s, fn: mean, createEmpty: true)\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n  |> keep(columns: ["_time", "valor", "bruto"])')
EVENTOS = ('from(bucket: "fabrica")\n  |> range(start: -6h)\n  |> filter(fn: (r) => r._measurement == "evento")\n  |> pivot(rowKey: ["_time", "maquina", "tipo"], columnKey: ["_field"], valueColumn: "_value")\n'
           '  |> group()\n  |> sort(columns: ["_time"], desc: true)\n  |> keep(columns: ["_time", "maquina", "tipo", "duracao_s", "atraso_registro_s", "texto"])')
md = ("### Duas formas de a máquina falar\n\n| Máquina | Tipo | Como entrega o dado |\n|---|---|---|\n"
      "| **Prensa P-01** | moderna | valor em unidade, hora na fonte, 1 leitura/s (OPC UA para MQTT) |\n"
      "| **Bomba B-03** | moderna | sensores IO-Link, valor + unidade + hora, 1 leitura/s |\n"
      "| **Forno F-02** | moderna | CLP em rede (OPC UA), 1 leitura/s |\n"
      "| **Laminadora L-01** | legada | só sinal bruto (4-20 mA, contato, pulsos), sem hora: a hora é a da chegada; 1 leitura a cada 2 s |\n"
      "| **Misturador M-02** | legado + retrofit | clip-on de corrente (5 s) e sensor BLE de vibração (10 s) |\n"
      "| **Esteira E-04** | legada | contador de pulsos (5 s) e apontamento por QR code, que chega depois |\n\n"
      "**Tudo simulado.** Nenhuma relação com as máquinas da Moura.")
p = [
    texto("Moderna x legada: o que muda no dado", md, grid(0, 0, 10, 10)),
    barras("Leituras por minuto, por tipo de máquina", RATE, grid(10, 0, 14, 10), cores={"moderna": "blue", "legada": "orange"},
           desc="A máquina moderna gera muito mais pontos. A legada entrega menos, e isso limita o que se enxerga."),
    ts("Mesma grandeza, três cadências: corrente do motor", q_series([("prensa01", "corrente_a"), ("laminadora01", "corrente_a"), ("misturador02", "corrente_a")], col="maquina", fn="max", every="2s"),
       grid(0, 10, 12, 8), unit="amp", pontos=True, largura=1, span=12000,
       desc="Prensa (moderna, 1 s), laminadora (legada, 2 s) e misturador (retrofit, 5 s). Os pontos mostram cada leitura recebida."),
    ts("Vibração: moderna a 1 s x sensor BLE a 10 s", q_series([("bomba03", "vibracao_mm_s"), ("misturador02", "vibracao_mm_s")], col="maquina", fn="max", every="2s"),
       grid(12, 10, 12, 8), unit="suffix:mm/s", pontos=True, largura=1, span=12000,
       desc="Quem lê a cada 10 s não vê o que acontece entre uma leitura e outra (amostragem)."),
    ts("O sinal bruto da máquina legada: mA e °C", BRUTO, grid(0, 18, 12, 8), cores={"valor": "blue", "bruto": "orange"}, span=12000,
       sobrepor={"bruto": [{"id": "unit", "value": "mamp"}, {"id": "custom.axisPlacement", "value": "right"}, {"id": "min", "value": 0}, {"id": "max", "value": 20}], "valor": [{"id": "unit", "value": "celsius"}]},
       desc="O gateway converte 4-20 mA em °C. Quando o fio rompe, a corrente cai a 0 mA e a temperatura some (não é 0 °C)."),
    tabela("Apontamentos de pessoas (eventos): hora do evento x hora do registro", EVENTOS, grid(12, 18, 12, 8),
           desc="O evento acontece em um instante e o registro chega depois. A hora do evento é a que importa para cruzar com o sensor.",
           overrides=[{"matcher": {"id": "byName", "options": "_time"}, "properties": [{"id": "displayName", "value": "início do evento"}]},
                      {"matcher": {"id": "byName", "options": "atraso_registro_s"}, "properties": [{"id": "displayName", "value": "atraso do registro (s)"}, {"id": "unit", "value": "s"}]},
                      {"matcher": {"id": "byName", "options": "duracao_s"}, "properties": [{"id": "displayName", "value": "duração (s)"}, {"id": "unit", "value": "s"}]}]),
]
salvar("02_moderna_x_legada.json", dashboard("fab-modleg", "2 · Máquina moderna x legada", p, desde="now-30m", descricao="Comparação do dado de máquinas modernas e legadas"))

# =================================================================== 3 · ANOMALIAS
_id[0] = 0
ANOM = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "qualidade" and r._value != "boa")\n  |> map(fn: (r) => ({r with qual: r._value, _value: 1.0}))\n  |> group(columns: ["qual"])\n'
        '  |> aggregateWindow(every: 30s, fn: sum, createEmpty: false)\n  |> pivot(rowKey: ["_time"], columnKey: ["qual"], valueColumn: "_value")\n  |> group()\n  |> drop(columns: ["_start", "_stop"])')
DERIVA = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "valor" and r.maquina == "forno02" and (r.variavel == "temp_zona1_c" or r.variavel == "temp_zona1_ref_c"))\n'
          '  |> aggregateWindow(every: 5s, fn: mean, createEmpty: false)\n  |> pivot(rowKey: ["_time"], columnKey: ["variavel"], valueColumn: "_value")\n'
          '  |> map(fn: (r) => ({_time: r._time, termopar: r.temp_zona1_c, pt100_referencia: r.temp_zona1_ref_c, diferenca: r.temp_zona1_c - r.temp_zona1_ref_c}))')
LINK = ('from(bucket: "fabrica")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r._measurement == "link" and r.maquina == "misturador02" and r._field == "ok")\n'
        '  |> aggregateWindow(every: 10s, fn: min, createEmpty: false)\n  |> pivot(rowKey: ["_time"], columnKey: ["variavel"], valueColumn: "_value")\n  |> keep(columns: ["_time", "corrente_a", "vibracao_mm_s", "ligada"])')
ATRASO = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "atraso_ms" and r.maquina == "prensa01" and r.variavel == "corrente_a")\n'
          '  |> aggregateWindow(every: 5s, fn: max, createEmpty: true)\n  |> map(fn: (r) => ({r with _value: r._value / 1000.0}))\n  |> pivot(rowKey: ["_time"], columnKey: ["variavel"], valueColumn: "_value")\n'
          '  |> rename(columns: {corrente_a: "atraso_s"})\n  |> keep(columns: ["_time", "atraso_s"])')
DUP = (BASE + '  |> filter(fn: (r) => r._measurement == "gateway" and r._field == "duplicatas")\n  |> aggregateWindow(every: 10s, fn: last, createEmpty: false)\n'
       '  |> derivative(unit: 1m, nonNegative: true)\n  |> keep(columns: ["_time", "_value"])\n  |> rename(columns: {_value: "duplicatas_descartadas_por_min"})')
PECAS = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "valor" and r.variavel == "pecas" and (r.maquina == "esteira04" or r.maquina == "laminadora01"))\n'
         '  |> aggregateWindow(every: 30s, fn: last, createEmpty: false)\n  |> derivative(unit: 1m, nonNegative: true)\n  |> pivot(rowKey: ["_time"], columnKey: ["maquina"], valueColumn: "_value")\n  |> keep(columns: ["_time", "esteira04", "laminadora01"])')
PRESSAO_Q = (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r._field == "valor" and r.maquina == "bomba03" and r.variavel == "pressao_bar")\n'
             '  |> aggregateWindow(every: 5s, fn: mean, createEmpty: true)\n  |> pivot(rowKey: ["_time"], columnKey: ["variavel"], valueColumn: "_value")\n  |> keep(columns: ["_time", "pressao_bar"])')
p = [
    barras("Anomalias detectadas pelo gateway, por tipo", ANOM, grid(0, 0, 24, 8),
           desc="Cada barra conta as leituras que o gateway marcou como não confiáveis, por tipo de problema, a cada 30 s.",
           cores={"fio_rompido": "red", "congelado": "blue", "pico": "yellow", "relogio_fora": "purple", "unidade_convertida": "orange", "fora_da_faixa": "dark-red"}),
    ts("Rolamento desgastando: vibração e temperatura da bomba", q_series([("bomba03", "vibracao_mm_s"), ("bomba03", "temp_carcaca_c")]), grid(0, 8, 12, 8),
       cores={"vibracao_mm_s": "yellow", "temp_carcaca_c": "orange"}, lim=[(4.5, "orange"), (7, "red")],
       desc="A vibração (eixo esquerdo) sobe aos poucos e a temperatura (eixo direito) vai junto. Os limiares (4,5 e 7 mm/s) são só de exemplo, para o painel.",
       sobrepor={"temp_carcaca_c": [{"id": "custom.axisPlacement", "value": "right"}, {"id": "custom.thresholdsStyle", "value": {"mode": "off"}}, {"id": "unit", "value": "celsius"}, {"id": "min", "value": 30}], "vibracao_mm_s": [{"id": "unit", "value": "suffix:mm/s"}, {"id": "min", "value": 0}]}),
    ts("Superaquecimento: zonas do forno", q_series([("forno02", "temp_zona1_c"), ("forno02", "temp_zona2_c"), ("forno02", "temp_zona3_c")]), grid(12, 8, 12, 8), unit="celsius",
       minimo=195, lim=[(225, "red")], desc="Se só uma zona sobe, o problema é local (zona 2). Se as três sobem, é geral."),
    ts("Deriva do termopar: termopar x Pt100 de referência", DERIVA, grid(0, 16, 12, 8), unit="celsius", cores={"termopar": "orange", "pt100_referencia": "green", "diferenca": "red"},
       sobrepor={"diferenca": [{"id": "custom.axisPlacement", "value": "right"}, {"id": "min", "value": -2}, {"id": "max", "value": 16}]},
       desc="Dois sensores medem a mesma zona. Quando a diferença (eixo à direita) cresce, o termopar saiu da calibração, e não o forno."),
    ts("Fio rompido: temperatura do rolo e sinal bruto", (BASE + '  |> filter(fn: (r) => r._measurement == "leitura" and r.maquina == "laminadora01" and r.variavel == "temperatura_c" and (r._field == "valor" or r._field == "bruto"))\n'
                                                         '  |> aggregateWindow(every: 2s, fn: mean, createEmpty: true)\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n  |> keep(columns: ["_time", "valor", "bruto"])'),
       grid(12, 16, 12, 8), cores={"valor": "blue", "bruto": "orange"}, span=False if False else 5000,
       sobrepor={"bruto": [{"id": "unit", "value": "mamp"}, {"id": "custom.axisPlacement", "value": "right"}, {"id": "min", "value": 0}, {"id": "max", "value": 20}], "valor": [{"id": "unit", "value": "celsius"}]},
       desc="A temperatura (°C) desaparece e o sinal bruto vai a 0 mA: é fio rompido. 0 mA nunca é 0 °C."),
    ts("Valor congelado: pressão da prensa", q_series([("prensa01", "pressao_bar")], fn="max", every="2s"), grid(0, 24, 12, 7), unit="pressurebar", cores={"pressao_bar": "blue"}, span=5000,
       desc="A pressão deveria oscilar a cada ciclo. Uma linha reta, sem ruído, é sensor travado (o gateway marca 'congelado' após 8 leituras iguais)."),
    ts("Picos por interferência: corrente da prensa", q_series([("prensa01", "corrente_a")], fn="max", every="2s"), grid(12, 24, 12, 7), unit="amp", cores={"corrente_a": "yellow"}, pontos=True, largura=1,
       desc="Picos isolados muito acima do normal, que desaparecem na leitura seguinte: ruído elétrico, e não a máquina."),
    timeline("Perda de link sem fio: misturador M-02", LINK, grid(0, 31, 12, 6), {1: ("ok", "green"), 0: ("sem dados", "red")},
             desc="O vigia do gateway avisa 'sem dados' quando o canal fica calado por mais de 4 períodos (mínimo 15 s)."),
    ts("Relógio atrasado: quanto a prensa está atrás", ATRASO, grid(12, 31, 12, 6), unit="s", cores={"atraso_s": "purple"}, span=False if False else 5000,
       desc="Diferença entre a hora que a máquina carimbou e a hora em que o dado chegou. Com 10 minutos, o cruzamento com outras fontes erra."),
    ts("Mensagens duplicadas descartadas", DUP, grid(0, 37, 8, 6), cores={"duplicatas_descartadas_por_min": "orange"}, span=20000,
       desc="A rede entregou duas vezes a mesma mensagem. Sem tratar, contagens e médias ficam erradas."),
    ts("Unidade trocada (psi): pressão da bomba após conversão", PRESSAO_Q, grid(8, 37, 8, 6), unit="pressurebar", cores={"pressao_bar": "green"}, minimo=0,
       desc="Quando a bomba passa a mandar psi, o gateway converte para bar e marca 'unidade_convertida'. A curva continua coerente. Sem isso, pareceria uma pressão 14 vezes maior."),
    ts("Parada da esteira: ritmo de peças por minuto", PECAS, grid(16, 37, 8, 6), cores={"esteira04": "blue", "laminadora01": "green"}, span=60000,
       desc="O contador de pulsos para quando a esteira para. O apontamento por QR code só chega depois."),
]
salvar("03_anomalias.json", dashboard("fab-anom", "3 · Anomalias", p, desde="now-30m", descricao="Anomalias de dado e de máquina"))

# =================================================================== provisão
with open(os.path.join(PROV, "datasources", "influx.yaml"), "w", encoding="utf-8") as f:
    f.write("""apiVersion: 1
datasources:
  - name: Fábrica (InfluxDB)
    uid: influx-fabrica
    type: influxdb
    access: proxy
    url: http://127.0.0.1:8086
    isDefault: true
    jsonData:
      version: Flux
      organization: demo
      defaultBucket: fabrica
      tlsSkipVerify: true
    secureJsonData:
      token: demo-token-fabrica
""")
with open(os.path.join(PROV, "dashboards", "dashboards.yaml"), "w", encoding="utf-8") as f:
    f.write("""apiVersion: 1
providers:
  - name: fabrica-demo
    orgId: 1
    folder: Fábrica Demo
    type: file
    disableDeletion: false
    allowUiUpdates: true
    updateIntervalSeconds: 30
    options:
      path: @@DASHBOARDS@@
""")
print("painéis gerados em", OUT)
