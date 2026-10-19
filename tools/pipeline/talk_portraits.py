"""Retratos das janelas de conversa dos moradores (frente CAPTURAS-ORIGINAL, 19/10).

    .venv\\Scripts\\python.exe tools/pipeline/talk_portraits.py [--refs refs/original] [--out game/public/assets/ui/talk]

Os retratos 88x108 (moldura dourada t_border + fundo t_back + figura) dos NPCs de cidade (guarda de Plagat, mendigo/guarda/mulheres de Kaarg,
lojista/taverneiro do Bosque Antigo) NAO foram encontrados como recurso isolado em graphics.res (os ids 90..99 de campaign.json nao tem
template nem retrato; graphics/interface/t_border.bmp e t_back.bmp so trazem a moldura e o fundo). Por isso sao RECORTADOS das capturas do
jogo original (refs/original/town_*_talk_*.png), na posicao medida (298,324) do cliente 1024x768 (correlacao com t_border.bmp). Fonte e
limite registrados em docs/PROVENANCE.md e docs/GAPS.md ([FIDELIDADE-CIDADE-2]).
"""
from __future__ import annotations

import argparse
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BOX = (298, 324, 298 + 88, 324 + 108)
# npc (campaign.json) -> captura do original em que a 1a/2a fala e dele
SOURCES = {
    97: "town_click_gate_guard",
    92: "town_kaarg_talk_kaargman",
    93: "town_kaarg_talk_kaargguard",
    90: "town_kaarg_talk_kaargwoman",
    99: "town_kaarg_talk_kaargwoman_line2",
    91: "town_druids_talk_druidshopkeeper",
    94: "town_druids_talk_druidinnkeeper",
}


def frame_art(out: str, ext: str = r"C:\Users\TALES K\Games\allods2-extracted") -> None:
    """border.webp (t_border.256, RGBA: so a moldura dourada 88x108, miolo transparente 72x92 em (8,7)) e back.webp (t_back.bmp, 160x240: pintura escura de fundo)."""
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import sprites
    d = os.path.join(ext, "graphics", "interface")
    pal, frames, wide = sprites.read_sprite(os.path.join(d, "t_border.256"))
    f = frames[0]
    im = Image.new("RGBA", (f[0], f[1]))
    im.putdata([tuple(p) for p in sprites.to_rgba(f[2], pal, wide)])
    im.save(os.path.join(out, "border.webp"), "WEBP", lossless=True)
    Image.open(os.path.join(d, "t_back.bmp")).convert("RGB").save(os.path.join(out, "back.webp"), "WEBP", lossless=True)
    print("  border.webp, back.webp")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs", default=os.path.join(ROOT, "refs", "original"))
    ap.add_argument("--out", default=os.path.join(ROOT, "game", "public", "assets", "ui", "talk"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    done = {}
    for npc, src in SOURCES.items():
        p = os.path.join(a.refs, src + ".png")
        if not os.path.exists(p):
            print(f"  [pula] npc {npc}: sem {src}.png")
            continue
        im = Image.open(p).convert("RGB").crop(BOX)
        im.save(os.path.join(a.out, f"npc{npc}.webp"), "WEBP", lossless=True)
        done[npc] = src
        print(f"  npc{npc}.webp  <- {src}")
    frame_art(a.out)
    json.dump({"box": BOX, "sources": done, "interior": [8, 7, 72, 92]}, open(os.path.join(a.out, "talk.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
