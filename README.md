# Do sensor ao dado: fábrica simulada

Demonstração da aula de 15/10 (COMPET, Fase 1). É uma fábrica simulada completa, que roda inteira no seu computador:

- **6 máquinas**: 3 modernas e 3 legadas, que publicam seus sinais por **MQTT**
- **Gateway (Node-RED)**: converte o sinal bruto (4–20 mA, pulsos, contatos), carimba a hora e marca a qualidade do dado
- **Banco de séries temporais (InfluxDB)**
- **Painéis (Grafana)**: visão geral, moderna x legada e anomalias
- **Monitor MQTT**: página com botões para injetar **11 tipos de anomalia**

Tudo escuta só em `127.0.0.1` (nada fica visível na rede). Os dados são 100% simulados: máquinas, nomes e valores são inventados.

```
máquinas (simulador) ──MQTT──> broker ──> gateway (Node-RED) ──> InfluxDB ──> Grafana
                                  └───────> monitor MQTT (navegador)
```

## Requisitos

- Windows 10 ou 11
- Um navegador moderno (Chrome, Edge ou Firefox)
- Cerca de 1,5 GB livres em disco e 1 GB de memória
- Internet **só na instalação**

## Instalação (uma vez)

1. Baixe o repositório: botão **Code → Download ZIP** (e extraia), ou
   ```
   git clone https://github.com/Igor-C-Assuncao/DEMO-COMPET-sensor_ao_dado.git
   ```
   > Dica: coloque a pasta fora do OneDrive (por exemplo `C:\demo_aula15`). A instalação cria dezenas de milhares de arquivos e a sincronização deixa tudo lento.
2. Dê duplo clique em **`INSTALAR_DEMO.bat`**. Ele baixa e instala:
   - Node.js 22 LTS (via `winget`, só se ainda não estiver instalado)
   - InfluxDB 2.7.11 e Grafana 11.6.0 (na pasta `bin/`)
   - as dependências do Node (Node-RED, Aedes, MQTT.js) na pasta `app/`

   Pode rodar de novo sem problema: o que já estiver instalado é pulado.

## Como usar

1. Dê duplo clique em **`INICIAR_DEMO.bat`**. Na primeira vez leva cerca de 1 minuto; nas seguintes, de 20 a 30 s.
2. Aguarde a mensagem verde **PRONTO**. O navegador abre sozinho.
3. Ao terminar, dê duplo clique em **`PARAR_DEMO.bat`**.

| Tela | Endereço | Login |
|---|---|---|
| Monitor MQTT | http://localhost:8088 | não tem |
| Grafana: visão geral | http://localhost:3000/d/fab-geral | não tem |
| Grafana: moderna x legada | http://localhost:3000/d/fab-modleg | não tem |
| Grafana: anomalias | http://localhost:3000/d/fab-anom | não tem |
| Node-RED (editor) | http://localhost:1880 | não tem |
| InfluxDB | http://localhost:8086 | `demo` / `demo12345` |
| Broker MQTT | `localhost:1883` (TCP), `ws://localhost:9001` | não tem |

As credenciais (`demo` / `demo12345`, token `demo-token-fabrica`) servem só para esta demonstração. Não use em nada real.

### Outros arquivos

| Arquivo | O que faz |
|---|---|
| `INICIAR_DEMO_AUTOMATICO.bat` | Igual ao iniciar, mas dispara um cenário de anomalia novo a cada 80 s |
| `STATUS_DEMO.bat` | Mostra quais serviços estão no ar |
| `GUIA_DO_ALUNO_SIMULADOR.pdf` | Guia completo: telas, tópicos MQTT, qualidade do dado, cenários e problemas comuns |

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Node.js não encontrado" | Feche a janela e rode `INSTALAR_DEMO.bat` de novo, ou instale o Node.js LTS em [nodejs.org](https://nodejs.org) |
| "A porta XXXX já está em uso" | Rode `PARAR_DEMO.bat`. Se continuar, outro programa usa a porta (Docker costuma usar 3000 e 8086) |
| Demora mais de 2 min para subir | Pause o OneDrive ou mova a pasta para fora dele |
| Grafana mostra "No data" | Espere 20 s e atualize; confira com `STATUS_DEMO.bat` |
| Quero recomeçar do zero | `PARAR_DEMO.bat`, apague a pasta `data` e rode `INICIAR_DEMO.bat` |

Se algo falhar, veja a pasta `logs/`: há um log por serviço.

## Licenças

Cada programa tem a sua licença: Grafana (AGPLv3), InfluxDB 2 OSS (MIT), Node-RED e demais (Apache 2.0 ou MIT). Esta demonstração é para uso em aula.
