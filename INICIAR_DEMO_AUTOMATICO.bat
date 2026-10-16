@echo off
title Demo: do sensor ao dado - iniciar (modo automatico)
rem Modo automatico: um cenario de anomalia novo a cada 80 s, sem ninguem clicar. Bom para ensaiar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_demo.ps1" -Auto %*
echo.
echo Pode fechar esta janela. Para encerrar a demonstracao, use PARAR_DEMO.bat
pause
