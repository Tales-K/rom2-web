"""Exporta mapas e terrenos para o visualizador web (pasta web/).

Gera:
  web/assets/terrain/<tile>.png     bitmaps de terreno convertidos para PNG
  web/data/index.json               lista de mapas
  web/data/maps/<nome>.json         um arquivo por mapa (mesmo formato de game/public/data/maps; ver tools/alm_export.py)

Uso: .venv/Scripts/python.exe tools/export_web.py [--game <pasta do jogo>] [--extracted <pasta dos .res extraidos>]
Os arquivos gerados contem dados do jogo: uso local apenas, nao redistribuir.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import descriptions  # noqa: E402
from alm import Alm  # noqa: E402
from alm_export import map_json as alm_map_json  # noqa: E402
from maprender import terrain_files  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def map_json(path, name, source, I, C):
    """Mesmo conteudo de game/public/data/maps (ver tools/alm_export.py)."""
    return alm_map_json(Alm(open(path, "rb").read()), name, source, I, C)


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d  # noqa: E731
    game = opt("--game", descriptions.GAME)
    extracted = opt("--extracted", r"C:\Users\TALES K\Games\allods2-extracted")
    I, C = descriptions.instants(game), descriptions.checks(game)

    terrain_dir = os.path.join(extracted, "graphics", "terrain")
    os.makedirs(os.path.join(WEB, "assets", "terrain"), exist_ok=True)
    names = terrain_files(terrain_dir)
    for n in names:
        Image.open(os.path.join(terrain_dir, n)).convert("RGB").save(os.path.join(WEB, "assets", "terrain", n[:-4] + ".png"))

    os.makedirs(os.path.join(WEB, "data", "maps"), exist_ok=True)
    index = []
    sources = [(os.path.join(extracted, "scenario"), "scenario"), (game, "multiplayer")]
    for folder, source in sources:
        for f in sorted(os.listdir(folder), key=lambda s: (len(s), s.lower())):
            if not f.lower().endswith(".alm"):
                continue
            name = os.path.splitext(f)[0] if source == "scenario" else "mp_" + os.path.splitext(f)[0]
            j = map_json(os.path.join(folder, f), name, source, I, C)
            with open(os.path.join(WEB, "data", "maps", name + ".json"), "w", encoding="utf-8") as fh:
                json.dump(j, fh, separators=(",", ":"))
            index.append({"name": name, "source": source, "w": j["w"], "h": j["h"], "players": len(j["players"]),
                          "units": len(j["units"]), "structures": len(j["structures"]), "triggers": len(j["triggers"])})
    with open(os.path.join(WEB, "data", "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"terrain": [n[:-4] for n in names], "maps": index}, fh)
    print("terrenos:", len(names), " mapas:", len(index))


if __name__ == "__main__":
    main()
