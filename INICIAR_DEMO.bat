@echo off
title Demo: do sensor ao dado - iniciar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_demo.ps1" %*
echo.
echo Pode fechar esta janela. Para encerrar a demonstracao, use PARAR_DEMO.bat
pause
