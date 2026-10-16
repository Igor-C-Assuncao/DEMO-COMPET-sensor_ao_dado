# Mostra o que esta de pe.
$itens = @(@('Broker MQTT', 1883), @('Broker MQTT (WebSocket)', 9001), @('InfluxDB', 8086), @('Node-RED', 1880), @('Grafana', 3000), @('Monitor MQTT', 8088))
foreach ($i in $itens) {
    $ok = [bool](Get-NetTCPConnection -LocalPort $i[1] -State Listen -ErrorAction SilentlyContinue)
    $cor = 'Red'; $txt = 'PARADO'
    if ($ok) { $cor = 'Green'; $txt = 'NO AR' }
    Write-Host ('{0,-26} porta {1,-5} {2}' -f $i[0], $i[1], $txt) -ForegroundColor $cor
}
