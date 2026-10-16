# Inicia toda a demonstracao "Do sensor ao dado" (aula 15/10). Tudo roda so neste computador (127.0.0.1).
# Uso: iniciar_demo.ps1 [-Auto] [-SemHistorico] [-NaoAbrirNavegador] [-MinutosHistorico 180]
param([switch]$Auto, [switch]$SemHistorico, [switch]$NaoAbrirNavegador, [int]$MinutosHistorico = 180)
$ErrorActionPreference = 'Stop'
$Raiz = $PSScriptRoot
$App = Join-Path $Raiz 'app'
$Logs = Join-Path $Raiz 'logs'
$Run = Join-Path $Raiz 'run'
$Data = Join-Path $Raiz 'data'
$GrafanaHome = Join-Path $Raiz 'bin\grafana-v11.6.0'
$Influx = Join-Path $Raiz 'bin\influxd.exe'
foreach ($d in @($Logs, $Run, $Data, (Join-Path $Data 'influx'), (Join-Path $Data 'grafana'))) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

function Escreve($m) { Write-Host ("[demo] " + $m) }
function Porta-Em-Uso($p) { return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }
function Espera-Http($url, $seg, $nome) {
    $fim = (Get-Date).AddSeconds($seg)
    while ((Get-Date) -lt $fim) {
        try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return } } catch { }
        Start-Sleep -Milliseconds 700
    }
    throw "$nome nao respondeu em $seg s. Veja a pasta logs."
}
function Espera-Porta($p, $seg, $nome) {
    $fim = (Get-Date).AddSeconds($seg)
    while ((Get-Date) -lt $fim) { if (Porta-Em-Uso $p) { return }; Start-Sleep -Milliseconds 500 }
    throw "$nome nao abriu a porta $p em $seg s. Veja a pasta logs."
}

# ---- verificacoes
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado no PATH. Instale o Node.js LTS (veja o manual).' }
if (-not (Test-Path $Influx)) { throw "InfluxDB nao encontrado em $Influx" }
if (-not (Test-Path (Join-Path $GrafanaHome 'bin\grafana-server.exe'))) { throw "Grafana nao encontrado em $GrafanaHome" }
if (-not (Test-Path (Join-Path $App 'node_modules\node-red'))) { throw 'Dependencias do Node nao instaladas. Rode "npm install" na pasta app (veja o manual).' }
$pidsArq = Join-Path $Run 'pids.json'
if (Test-Path $pidsArq) { Escreve 'Ja existe uma execucao registrada. Parando antes de iniciar...'; & (Join-Path $Raiz 'parar_demo.ps1') | Out-Null }
foreach ($p in 1883, 9001, 8086, 1880, 3000, 8088) {
    if (Porta-Em-Uso $p) { throw "A porta $p ja esta em uso por outro programa. Feche-o ou veja 'Problemas comuns' no manual." }
}
$script:pids = @{}
function Inicia($nome, $exe, $argumentos, $dir) {
    $o = Join-Path $Logs "$nome.log"; $e = Join-Path $Logs "$nome.erro.log"
    if ($argumentos) {
        $proc = Start-Process -FilePath $exe -ArgumentList $argumentos -WorkingDirectory $dir -WindowStyle Hidden -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
    } else {
        $proc = Start-Process -FilePath $exe -WorkingDirectory $dir -WindowStyle Hidden -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
    }
    $script:pids[$nome] = $proc.Id
    ($script:pids | ConvertTo-Json) | Set-Content -Path $pidsArq -Encoding ASCII
}
$node = (Get-Command node).Source
$inicio = Get-Date

try {
    # ---- 1. InfluxDB
    Escreve '1/6 InfluxDB (banco de series temporais)...'
    $env:INFLUXD_BOLT_PATH = Join-Path $Data 'influx\influxd.bolt'
    $env:INFLUXD_ENGINE_PATH = Join-Path $Data 'influx\engine'
    $env:INFLUXD_HTTP_BIND_ADDRESS = '127.0.0.1:8086'
    $env:INFLUXD_REPORTING_DISABLED = 'true'
    Inicia 'influxdb' $Influx '' $Raiz
    Espera-Http 'http://127.0.0.1:8086/health' 60 'InfluxDB'
    $flag = Join-Path $Data 'influx\.configurado'
    if (-not (Test-Path $flag)) {
        Escreve '    primeira execucao: criando organizacao, bucket e token de demonstracao'
        $corpo = '{"username":"demo","password":"demo12345","org":"demo","bucket":"fabrica","retentionPeriodSeconds":0,"token":"demo-token-fabrica"}'
        try { Invoke-WebRequest -Uri 'http://127.0.0.1:8086/api/v2/setup' -Method Post -Body $corpo -ContentType 'application/json' -UseBasicParsing | Out-Null } catch { Escreve '    (o InfluxDB ja estava configurado)' }
        Set-Content -Path $flag -Value 'ok' -Encoding ASCII
    }

    # ---- 2. historico de ensaio
    Push-Location $App
    & $node build_flows.js | Out-Null
    if (-not $SemHistorico) {
        Escreve "2/6 Gravando $MinutosHistorico min de historico de ensaio (com varias anomalias)..."
        & $node semear_historico.js $MinutosHistorico --limpar --adiante=70
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar o historico de ensaio.' }
    } else { Escreve '2/6 Historico de ensaio ignorado (-SemHistorico).' }
    Pop-Location

    # ---- 3. broker MQTT
    Escreve '3/6 Broker MQTT...'
    Inicia 'broker' $node 'broker.js' $App
    Espera-Porta 1883 30 'Broker MQTT'

    # ---- 4. Node-RED
    Escreve '4/6 Node-RED (gateway da fabrica)...'
    $nrArgs = '"' + (Join-Path $App 'node_modules\node-red\red.js') + '" --userDir "' + (Join-Path $Data 'nodered') + '" --settings "' + (Join-Path $Data 'nodered\settings.js') + '"'
    Inicia 'nodered' $node $nrArgs $App
    Espera-Http 'http://127.0.0.1:1880/' 90 'Node-RED'

    # ---- 5. Grafana
    Escreve '5/6 Grafana (paineis)...'
    $gdir = Join-Path $Data 'grafana'
    $raizFs = $Raiz.Replace('\', '/')
    (Get-Content (Join-Path $Raiz 'config\grafana\grafana.ini.modelo') -Raw -Encoding UTF8).Replace('@@RAIZ@@', $raizFs) | Set-Content -Path (Join-Path $gdir 'grafana.ini') -Encoding UTF8
    $prov = Join-Path $gdir 'provisioning'
    if (Test-Path $prov) { Remove-Item $prov -Recurse -Force }
    Copy-Item (Join-Path $Raiz 'config\grafana\provisioning') $prov -Recurse
    foreach ($vz in 'alerting', 'plugins', 'notifiers', 'access-control') { New-Item -ItemType Directory -Path (Join-Path $prov $vz) -Force | Out-Null }
    $dy = Join-Path $prov 'dashboards\dashboards.yaml'
    (Get-Content $dy -Raw -Encoding UTF8).Replace('@@DASHBOARDS@@', ($raizFs + '/config/grafana/dashboards')) | Set-Content -Path $dy -Encoding UTF8
    $gArgs = '--homepath "' + $GrafanaHome + '" --config "' + (Join-Path $gdir 'grafana.ini') + '"'
    Inicia 'grafana' (Join-Path $GrafanaHome 'bin\grafana-server.exe') $gArgs $GrafanaHome
    Espera-Http 'http://127.0.0.1:3000/api/health' 120 'Grafana'

    # ---- 6. simulador + monitor MQTT
    Escreve '6/6 Simulador da fabrica e monitor MQTT...'
    $sArgs = 'planta.js'; if ($Auto) { $sArgs = 'planta.js --auto' }
    Inicia 'simulador' $node $sArgs $App
    Espera-Http 'http://127.0.0.1:8088/api/meta' 30 'Simulador'
} catch {
    Write-Host ("[demo] ERRO: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host '[demo] Parando o que foi iniciado...'
    & (Join-Path $Raiz 'parar_demo.ps1') | Out-Null
    exit 1
}

$seg = [int]((Get-Date) - $inicio).TotalSeconds
Write-Host ''
Write-Host "[demo] PRONTO em $seg s. Enderecos:" -ForegroundColor Green
Write-Host '   Monitor MQTT ...... http://localhost:8088   (topicos, valores, qualidade e botoes de cenarios)'
Write-Host '   Grafana ........... http://localhost:3000   (paineis, sem senha)'
Write-Host '   Node-RED .......... http://localhost:1880   (o gateway)'
Write-Host '   Broker MQTT ....... localhost:1883 (TCP)  e  localhost:9001 (WebSocket)'
Write-Host '   InfluxDB .......... http://localhost:8086   (usuario demo / senha demo12345)'
if (-not $NaoAbrirNavegador) {
    Start-Process 'http://localhost:8088'
    Start-Process 'http://localhost:3000/d/fab-geral'
    Start-Process 'http://localhost:1880'
}
