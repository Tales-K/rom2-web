"""Exporta os sprites de objetos de cenario (arvores, pedras...) para o visualizador web.

Fontes: graphics/objects/objects.reg (ID, DescText, File, Index, Phases) e os .256 de graphics/objects/.
No mapa (.alm, bloco 3) cada celula guarda `ID do objeto + 1` (0 = vazio).
Saidas: web/assets/objects/obj_<ID>.png (primeiro frame da variante) e web/data/objects.json ({ID: {name, w, h}}).

Uso: .venv/Scripts/python.exe tools/export_objects.py [--extracted <pasta>]
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
    base = os.path.join(extracted, "graphics", "objects")
    tree, _ = reg.parse(open(os.path.join(base, "objects.reg"), "rb").read())
    files = tree["Files"]
    out_dir = os.path.join(WEB, "assets", "objects")
    os.makedirs(out_dir, exist_ok=True)
    cache, table, skipped = {}, {}, []
    for key, o in tree.items():
        if not key.startswith("Object") or "ID" not in o:
            continue
        rel = files["File%d" % o["File"]].replace("\\", os.sep) + ".256"
        path = os.path.join(base, rel)
        try:
            if path not in cache:
                cache[path] = sprites.read_sprite(path)
            pal, frames, _ = cache[path]
        except Exception as e:  # noqa: BLE001
            skipped.append((o.get("DescText") or key, "%s: %s" % (rel, e)))
            continue
        idx = o.get("Index", 0)
        n = idx * max(1, o.get("Phases", 1))
        if n >= len(frames):
            n = min(idx, len(frames) - 1)
        w, h, rows = frames[n]
        im = Image.new("RGBA", (w, h))
        im.putdata(sprites.to_rgba(rows, pal, False, "idx_alpha", True))
        im.save(os.path.join(out_dir, "obj_%d.png" % o["ID"]))
        table[o["ID"]] = {"name": o.get("DescText") or key, "w": w, "h": h}
    with open(os.path.join(WEB, "data", "objects.json"), "w", encoding="utf-8") as fh:
        json.dump(table, fh, separators=(",", ":"))
    print("objetos exportados:", len(table), " ignorados:", skipped[:8], "...", len(skipped))


if __name__ == "__main__":
    main()
