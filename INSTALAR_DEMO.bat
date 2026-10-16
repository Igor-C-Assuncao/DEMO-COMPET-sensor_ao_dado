@echo off
title Demo: do sensor ao dado - instalar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_demo.ps1" %*
echo.
pause
