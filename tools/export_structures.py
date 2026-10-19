"""Exporta os sprites de estruturas (casas, torres, pontes...) para o visualizador web.

Fontes: graphics/structures/structures.reg (ID, DescText, File, TileWidth/Height...) e os .256 de graphics/structures/.
No mapa (.alm, bloco 4) o campo `tipo` de cada estrutura e o ID.
Saidas: web/assets/structures/st_<ID>.png (grade de tiles montada; fase 0) e web/data/structures.json ({ID: {name, w, h, tw, th}}).

Uso: .venv/Scripts/python.exe tools/export_structures.py [--extracted <pasta>]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reg  # noqa: E402
import sprites  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def main():
    a = sys.argv[1:]
    extracted = a[a.index("--extracted") + 1] if "--extracted" in a else r"C:\Users\TALES K\Games\allods2-extracted"
    base = os.path.join(extracted, "graphics", "structures")
    tree, _ = reg.parse(open(os.path.join(base, "structures.reg"), "rb").read())
    out_dir = os.path.join(WEB, "assets", "structures")
    os.makedirs(out_dir, exist_ok=True)
    cache, table, skipped = {}, {}, []
    for key, o in tree.items():
        if not key.startswith("Structure") or "ID" not in o:
            continue
        rel = o["File"].replace("\\", os.sep) + ".256"
        path = os.path.join(base, rel)
        try:
            if path not in cache:
                cache[path] = sprites.read_sprite(path)
            pal, frames, _ = cache[path]
        except Exception as e:  # noqa: BLE001
            skipped.append((o.get("DescText") or key, "%s: %s" % (rel, e)))
            continue
        # a estrutura e montada de tiles 32x32 em grade TileWidth x FullHeight, em ordem de linha (confirmado visualmente)
        tw, th, fh = o.get("TileWidth", 1), o.get("TileHeight", 1), o.get("FullHeight", o.get("TileHeight", 1))
        im = Image.new("RGBA", (tw * 32, fh * 32))
        for i in range(min(len(frames), tw * fh)):
            fw, fhh, rows = frames[i]
            tile = Image.new("RGBA", (fw, fhh))
            tile.putdata(sprites.to_rgba(rows, pal, False, "idx_alpha", True))
            im.alpha_composite(tile, ((i % tw) * 32, (i // tw) * 32))
        w, h = im.size
        im.save(os.path.join(out_dir, "st_%d.png" % o["ID"]))
        table[o["ID"]] = {"name": o.get("DescText") or key, "w": w, "h": h, "tw": tw, "th": th}
    with open(os.path.join(WEB, "data", "structures.json"), "w", encoding="utf-8") as fh:
        json.dump(table, fh, separators=(",", ":"))
    print("estruturas exportadas:", len(table), " ignorados:", skipped[:8], "...", len(skipped))


if __name__ == "__main__":
    main()
