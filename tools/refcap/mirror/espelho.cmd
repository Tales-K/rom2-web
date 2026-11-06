@echo off
rem Jogo espelhado (tools/refcap/mirror/mirror.py): o original (a2_diff) numa janela, o nosso sim acompanhando tique a tique.
rem Argumentos passam direto (ex.: --state m10_mage --seed 7). O atalho "Allods 2 espelhado" da area de trabalho chama este arquivo.
chcp 65001 >nul
cd /d "%~dp0..\..\.."
set PYTHONUTF8=1
title Allods 2 espelhado
".venv\Scripts\python.exe" -X utf8 tools\refcap\mirror\mirror.py %*
echo.
pause
