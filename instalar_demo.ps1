# Instala tudo o que a demonstracao "Do sensor ao dado" precisa e que NAO fica no GitHub:
#   - Node.js LTS (via winget, se ainda nao houver)
#   - InfluxDB 2.7.11  -> bin\influxd.exe
#   - Grafana 11.6.0   -> bin\grafana-v11.6.0
#   - dependencias npm -> app\node_modules
# Pode ser executado mais de uma vez: o que ja estiver instalado e pulado.
# Uso: instalar_demo.ps1 [-Forcar]   (-Forcar baixa e reinstala InfluxDB e Grafana)
param([switch]$Forcar)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # deixa o Invoke-WebRequest muito mais rapido
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Raiz = $PSScriptRoot
$Bin = Join-Path $Raiz 'bin'
$Down = Join-Path $Raiz '_downloads'
$App = Join-Path $Raiz 'app'
$Logs = Join-Path $Raiz 'logs'

$InfluxVer = '2.7.11'
$InfluxZip = "influxdb2-$InfluxVer-windows.zip"
$InfluxUrl = "https://dl.influxdata.com/influxdb/releases/$InfluxZip"
$GrafanaVer = '11.6.0'
$GrafanaZip = "grafana-$GrafanaVer.windows-amd64.zip"
$GrafanaUrl = "https://dl.grafana.com/oss/release/$GrafanaZip"
$GrafanaHome = Join-Path $Bin "grafana-v$GrafanaVer"

function Escreve($m) { Write-Host ("[instalar] " + $m) }
foreach ($d in @($Bin, $Down, $Logs)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

function Baixa($url, $destino) {
    if ((Test-Path $destino) -and -not $Forcar) { Escreve "    ja baixado: $(Split-Path $destino -Leaf)"; return }
    Escreve "    baixando $url"
    $tmp = "$destino.parcial"
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    Move-Item $tmp $destino -Force
}

function Extrai($zip, $pasta) {
    if (Test-Path $pasta) { Remove-Item $pasta -Recurse -Force }
    New-Item -ItemType Directory -Path $pasta | Out-Null
    # tar.exe (nativo no Windows 10/11) e bem mais rapido que Expand-Archive
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $tar) {
        & $tar -xf $zip -C $pasta
        if ($LASTEXITCODE -eq 0) { return }
        Escreve '    tar falhou, usando Expand-Archive...'
    }
    Expand-Archive -Path $zip -DestinationPath $pasta -Force
}

function Atualiza-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

try {
    # ---- 1. Node.js
    Escreve '1/4 Node.js...'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Node.js nao encontrado e o winget nao esta disponivel. Instale o Node.js 22 LTS manualmente em https://nodejs.org e rode este instalador de novo.'
        }
        Escreve '    instalando Node.js LTS via winget (pode pedir permissao de administrador)...'
        winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
        Atualiza-Path
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            throw 'Node.js foi instalado, mas ainda nao aparece no PATH. Feche esta janela e rode INSTALAR_DEMO.bat de novo.'
        }
    }
    Escreve "    node $(node -v)"

    # ---- 2. InfluxDB
    Escreve "2/4 InfluxDB $InfluxVer..."
    $influxExe = Join-Path $Bin 'influxd.exe'
    if ((Test-Path $influxExe) -and -not $Forcar) {
        Escreve '    ja instalado.'
    } else {
        $zip = Join-Path $Down $InfluxZip
        Baixa $InfluxUrl $zip
        $tmp = Join-Path $Down 'influx_extraido'
        Extrai $zip $tmp
        # o zip pode ou nao ter uma subpasta: procura o influxd.exe onde estiver
        $achado = Get-ChildItem $tmp -Recurse -Filter 'influxd.exe' | Select-Object -First 1
        if (-not $achado) { throw 'influxd.exe nao encontrado dentro do zip do InfluxDB.' }
        Get-ChildItem $achado.DirectoryName | Copy-Item -Destination $Bin -Recurse -Force
        Remove-Item $tmp -Recurse -Force
    }

    # ---- 3. Grafana
    Escreve "3/4 Grafana $GrafanaVer (arquivo grande, pode demorar alguns minutos)..."
    if ((Test-Path (Join-Path $GrafanaHome 'bin\grafana-server.exe')) -and -not $Forcar) {
        Escreve '    ja instalado.'
    } else {
        $zip = Join-Path $Down $GrafanaZip
        Baixa $GrafanaUrl $zip
        $tmp = Join-Path $Down 'grafana_extraido'
        Extrai $zip $tmp
        $exe = Get-ChildItem $tmp -Recurse -Filter 'grafana-server.exe' | Select-Object -First 1
        if (-not $exe) { throw 'grafana-server.exe nao encontrado dentro do zip do Grafana.' }
        $origem = Split-Path $exe.DirectoryName -Parent   # ...\grafana-vX\bin\grafana-server.exe -> ...\grafana-vX
        if (Test-Path $GrafanaHome) { Remove-Item $GrafanaHome -Recurse -Force }
        Move-Item $origem $GrafanaHome
        Remove-Item $tmp -Recurse -Force
    }

    # ---- 4. dependencias npm
    Escreve '4/4 Dependencias do Node (node-red, aedes, mqtt, ws)...'
    if ((Test-Path (Join-Path $App 'node_modules\node-red')) -and -not $Forcar) {
        Escreve '    ja instaladas.'
    } else {
        Push-Location $App
        $npmLog = Join-Path $Logs 'npm_install.log'
        if (Test-Path (Join-Path $App 'package-lock.json')) { $cmd = 'ci' } else { $cmd = 'install' }
        & npm.cmd $cmd --no-audit --no-fund *> $npmLog
        $rc = $LASTEXITCODE
        Pop-Location
        if ($rc -ne 0) { throw "npm $cmd falhou (codigo $rc). Veja $npmLog" }
    }
} catch {
    Write-Host ("[instalar] ERRO: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '[instalar] TUDO PRONTO.' -ForegroundColor Green
Write-Host '   Os arquivos baixados ficaram em _downloads (pode apagar essa pasta para liberar espaco).'
Write-Host '   Agora e so dar duplo clique em INICIAR_DEMO.bat'
