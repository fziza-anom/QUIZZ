@echo off
title Blind Test - NE PAS FERMER pendant le jeu
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des composants, une seule fois...
  call npm install --no-fund --no-audit
)
node server.js
echo.
echo Le jeu s'est arrete.
pause
