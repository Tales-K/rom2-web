#!/usr/bin/env bash
# Copia os dados/sprites ja exportados para o visualizador (web/) para o jogo (game/public/).
# Rode depois de tools/export_web.py, export_units.py, export_objects.py e export_structures.py.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p game/public/assets game/public/data
cp -r web/assets/terrain web/assets/units web/assets/objects web/assets/structures game/public/assets/
# (os mapas de game/public/data/maps sao gerados por tools/alm_export.py, nao copie web/data/maps)
cp web/data/units.json web/data/objects.json web/data/structures.json game/public/data/
echo "ok"
