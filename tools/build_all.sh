#!/usr/bin/env bash
# Gera TODOS os assets e dados do jogo web (game/public/) a partir do Rage of Mages II instalado.
# Pré-requisitos: jogo instalado em C:\GOG Games\Rage of Mages II, .venv do projeto (Pillow, numpy, pefile, capstone, imageio-ffmpeg).
# Uso (Git Bash, na raiz do projeto):  tools/build_all.sh [--skip-speech]
# Etapas demoradas: mídia (vídeo/música/falas) e os pipelines de interface.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=".venv/Scripts/python.exe"
GAME="/c/GOG Games/Rage of Mages II"
EXT="/c/Users/TALES K/Games/allods2-extracted"

echo "== 1/8 extrair os .res (somente leitura do jogo)"
for r in patch world movies main scenario sfx speech music video graphics; do
  if [ ! -d "$EXT/$r" ]; then "$PY" tools/ya1.py extract "$GAME/$r.res" "$EXT/$r"; fi
done

echo "== 2/8 sprites e dados base (units/objects/structures, terrenos) para web/ e game/"
"$PY" tools/export_units.py
"$PY" tools/export_objects.py
"$PY" tools/export_structures.py
"$PY" tools/export_web.py            # terrenos e mapas provisórios
tools/sync_game_assets.sh

echo "== 3/8 mapas e scripts de missão (sobrescreve os mapas provisórios)"
"$PY" tools/alm_export.py

echo "== 4/8 textos do jogo"
"$PY" tools/texts_export.py

echo "== 5/8 banco de dados (data.bin: unidades, itens, magias, classes)"
"$PY" tools/data/databin.py
"$PY" tools/data/derive.py

echo "== 6/8 mídia (vídeo, música, efeitos, falas)"
"$PY" tools/pipeline/media.py "$@"

echo "== 7/8 interface: menu/criação de personagem, cidade/taverna/loja, HUD da missão"
"$PY" tools/pipeline/menu.py
"$PY" tools/pipeline/town.py
"$PY" tools/pipeline/gamemenu.py
"$PY" tools/pipeline/mission.py

echo "== 8/8 pronto. Rode:  cd game && npm install && npm run dev   (http://127.0.0.1:5173/)"
