# Para tudo o que o iniciar_demo.ps1 abriu.
$Raiz = $PSScriptRoot
$arq = Join-Path $Raiz 'run\pids.json'
if (Test-Path $arq) {
    $p = Get-Content $arq -Raw | ConvertFrom-Json
    foreach ($n in $p.PSObject.Properties) {
        try { & taskkill /PID $n.Value /T /F 2>$null | Out-Null; Write-Host ("[demo] parado: " + $n.Name) } catch { }
    }
    Remove-Item $arq -Force
} else { Write-Host '[demo] Nada registrado para parar.' }
# garantia: processos da demonstracao que ainda estejam nas portas dela
foreach ($porta in 1883, 9001, 8086, 1880, 3000, 8088) {
    $c = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
    foreach ($x in $c) {
        try {
            $proc = Get-Process -Id $x.OwningProcess -ErrorAction Stop
            $meu = $false
            if ($proc.Path -and $proc.Path.StartsWith($Raiz)) { $meu = $true }
            if ($proc.ProcessName -eq 'node') { $meu = $true }
            if ($meu) { Stop-Process -Id $proc.Id -Force; Write-Host ("[demo] liberada a porta " + $porta) }
        } catch { }
    }
}
