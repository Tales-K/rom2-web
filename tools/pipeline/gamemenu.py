"""Pipeline da frente SAVE-LOAD: kit de janelas dos menus do jogo (menu Esc, Load/Save Game, opcoes) a partir de graphics/interface.

Uso:  .venv/Scripts/python.exe tools/pipeline/gamemenu.py [--src <extraido>]
Saida: game/public/assets/ui/gamemenu/  (WebP sem perda, tamanho original 640x480; o jogo escala 1,6x em tempo de execucao)

Origem (somente leitura): C:/Users/TALES K/Games/allods2-extracted/graphics/interface
  lm.256        18 quadros: moldura roxa com caveiras douradas das janelas de menu (conjunto grande 0..8 e pequeno 9..17):
                0 fundo 96x64 | 1 canto sup-esq | 2 borda sup 96x48 | 3 canto sup-dir | 4 borda esq 48x64 | 5 borda dir
                6 canto inf-esq | 7 borda inf 96x48 | 8 canto inf-dir | 9 fundo pequeno 48x32 | 10 canto sup-esq | 11 borda sup
                12 canto sup-dir | 13 borda esq | 14 borda dir | 15 canto inf-esq | 16 borda inf | 17 canto inf-dir
  scrlbars.256  26 quadros 24x24: pecas de barra de rolagem (0..11 horizontal, 12..23 vertical, 24/25 botoes soltos)
  radiob.256    6 quadros: radio redondo (0 desligado, 1 ligado), caixa quadrada (2/3), caixa pequena (4/5)
  diskette.bmp  icone de disquete 32x32 (salvar)
  t_border.bmp  moldura dourada 88x108 (preto = transparente)
A interpretacao da ordem dos quadros e nossa (pela forma das pecas); docs/GAPS.md [SAVE-LOAD].
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "pipeline"))
import sprites  # noqa: E402
from imgout import save_img  # noqa: E402

SRC = Path("C:/Users/TALES K/Games/allods2-extracted")
OUT = ROOT / "game" / "public" / "assets" / "ui" / "gamemenu"


def frames_of(path):
    pal, frames, wide = sprites.read_sprite(str(path))
    out = []
    for w, h, rows in frames:
        im = Image.new("RGBA", (w, h))
        im.putdata(sprites.to_rgba(rows, pal, wide))
        out.append(im)
    return out


def main():
    a = sys.argv[1:]
    src = Path(a[a.index("--src") + 1]) if "--src" in a else SRC
    ui = src / "graphics" / "interface"
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, prefix in (("lm", "lm"), ("scrlbars", "scr"), ("radiob", "radio")):
        fr = frames_of(ui / f"{name}.256")
        meta[prefix] = []
        for i, im in enumerate(fr):
            p = save_img(im, OUT / f"{prefix}_{i:02d}.webp", "lossless")
            meta[prefix].append({"file": p.name, "w": im.width, "h": im.height})
    disk = Image.open(ui / "diskette.bmp").convert("RGB")
    meta["diskette"] = save_img(disk, OUT / "diskette.webp", "lossless").name
    tb = Image.open(ui / "t_border.bmp").convert("RGBA")
    px = tb.load()
    for y in range(tb.height):
        for x in range(tb.width):
            r, g, b, _ = px[x, y]
            if r == 0 and g == 0 and b == 0:
                px[x, y] = (0, 0, 0, 0)
    meta["t_border"] = save_img(tb, OUT / "t_border.webp", "lossless").name
    (OUT / "gamemenu.json").write_text(json.dumps(meta, indent=1), encoding="utf8")
    print("ok", OUT, sum(len(v) for v in meta.values() if isinstance(v, list)), "quadros")


if __name__ == "__main__":
    main()
