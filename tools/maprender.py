"""Renderiza um mapa .alm com os bitmaps de terreno (graphics/terrain/tileN-MM.bmp).

Mapeamento: cada tileN-MM.bmp e uma coluna de tiles 32x32 (14 linhas; 8 nos tile3). Arquivos ordenados
tile1-00..tile1-15, tile2-00.., tile3-00.., tile4-00..tile4-03 (dirt.bmp nao entra); id = indice_do_arquivo * 16 + linha
(bit 0x2000 do valor e uma flag e e ignorado).

Uso: .venv/Scripts/python.exe tools/maprender.py <mapa.alm> <saida.png> [--tiles <pasta terrain>] [--scale N] [--units]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alm import Alm  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

TERRAIN = r"C:\Users\TALES K\Games\allods2-extracted\graphics\terrain"
TILE = 32
ID_STRIDE = 16  # id do tile = indice_do_arquivo * 16 + linha (confirmado pelas linhas realmente usadas nos 57 mapas)


def terrain_files(folder):
    names = sorted(f for f in os.listdir(folder) if f.lower().startswith("tile") and f.lower().endswith(".bmp"))
    return names


class Tileset:
    def __init__(self, folder=TERRAIN):
        self.folder = folder
        self.names = terrain_files(folder)
        self.cache = {}

    def tile(self, tid):
        f, row = divmod(tid, ID_STRIDE)
        if f >= len(self.names):
            return None
        if f not in self.cache:
            self.cache[f] = Image.open(os.path.join(self.folder, self.names[f])).convert("RGB")
        if (row + 1) * TILE > self.cache[f].height:
            return None
        return self.cache[f].crop((0, row * TILE, TILE, (row + 1) * TILE))


def render(alm, tileset, scale=1.0, units=False):
    w, h = alm.width, alm.height
    img = Image.new("RGB", (w * TILE, h * TILE), (255, 0, 255))
    missing = 0
    for y in range(h):
        for x in range(w):
            t = tileset.tile(alm.tiles[y * w + x] & 0x1fff)
            if t is None:
                missing += 1
                continue
            img.paste(t, (x * TILE, y * TILE))
    if units:
        d = ImageDraw.Draw(img)
        for u in alm.units:
            x, y = u["x"] * TILE, u["y"] * TILE
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=((255, 60, 60), (60, 200, 60), (60, 140, 255), (255, 255, 0))[u["player"] % 4], outline=(0, 0, 0))
        for s in alm.structures:
            x, y = s["x"] * TILE, s["y"] * TILE
            d.rectangle((x - 8, y - 8, x + 8, y + 8), outline=(255, 255, 0), width=2)
    if scale != 1:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img, missing


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d  # noqa: E731
    m = Alm(open(a[0], "rb").read())
    img, missing = render(m, Tileset(opt("--tiles", TERRAIN)), float(opt("--scale", 1)), "--units" in a)
    img.save(a[1])
    print("ok", a[1], img.size, "tiles fora do conjunto:", missing)
