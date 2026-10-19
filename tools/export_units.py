"""Exporta os sprites de unidades (pose parada nas 8 direcoes) e a tabela de unidades para o visualizador web.

Fontes: graphics/units/units.reg (ID, nome, arquivo de sprite, tamanho, ancora) + os .256 em graphics/units/.
Saidas: web/assets/units/unit_<ID>.png  (tira de 8 frames lado a lado, cada um Width x Height)
        web/data/units.json              ({id: {name, w, h, cx, cy, file}})

Uso: .venv/Scripts/python.exe tools/export_units.py [--extracted <pasta>]
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
    base = os.path.join(extracted, "graphics", "units")
    tree, _ = reg.parse(open(os.path.join(base, "units.reg"), "rb").read())
    files = tree["Files"]
    out_dir = os.path.join(WEB, "assets", "units")
    os.makedirs(out_dir, exist_ok=True)
    table, skipped = {}, []
    for key, u in tree.items():
        if not key.startswith("Unit") or key == "Unit" or "ID" not in u:
            continue
        rel = files["File%d" % u["File"]].replace("\\", os.sep) + ".256"
        path = os.path.join(base, rel)
        if not os.path.exists(path):
            skipped.append((u["DescText"], rel))
            continue
        try:
            _, frames, _ = sprites.read_sprite(path)
        except Exception as e:  # noqa: BLE001
            skipped.append((u["DescText"], "%s: %s" % (rel, e)))
            continue
        if len(frames) < 8:
            skipped.append((u["DescText"], "%s: so %d frames" % (rel, len(frames))))
            continue
        # os frames sao recortes de tamanho variavel (o deslocamento original nao esta no cabecalho do frame);
        # colocamos cada um centralizado na horizontal e alinhado embaixo numa celula do tamanho do maior.
        pal = sprites.read_sprite(path)[0]
        w, h = max(f[0] for f in frames[:8]), max(f[1] for f in frames[:8])
        strip = Image.new("RGBA", (w * 8, h))
        for d in range(8):
            fw, fh, rows = frames[d]
            tile = Image.new("RGBA", (fw, fh))
            tile.putdata(sprites.to_rgba(rows, pal, False, "idx_alpha", True))
            strip.paste(tile, (d * w + (w - fw) // 2, h - fh))
        strip.save(os.path.join(out_dir, "unit_%d.png" % u["ID"]))
        table[u["ID"]] = {"name": u["DescText"], "w": w, "h": h, "cx": u.get("CenterX", w // 2), "cy": u.get("CenterY", h // 2), "file": rel.replace(os.sep, "/")}
    with open(os.path.join(WEB, "data", "units.json"), "w", encoding="utf-8") as fh:
        json.dump(table, fh, separators=(",", ":"))
    print("unidades exportadas:", len(table), " ignoradas:", skipped)


if __name__ == "__main__":
    main()
