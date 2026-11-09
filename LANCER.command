#!/bin/bash
# Lanceur Mac : double-clic (ou « bash LANCER.command » dans le Terminal).
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installé sur ce Mac."
  echo "  Installe-le depuis https://nodejs.org (version LTS), puis relance ce fichier."
  echo ""
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installation des composants, une seule fois..."
  npm install --no-fund --no-audit
fi
node server.js
echo ""
echo "Le jeu s'est arrêté."
read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
