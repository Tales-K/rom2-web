r"""Fundo do Hall da Fama (main/graphics/famehall/hall.bmp, 640x480: pergaminho com titulo, ornamentos e o selo "Ok").

    .venv\Scripts\python.exe tools/pipeline/hall.py [--src C:\Users\TALES K\Games\allods2-extracted] [--out game/public/assets/ui/menu]

Saida: hall.webp (sem perda). O texto da lista (10 linhas) e desenhado pela cena (game/src/scenes/FameScene.ts); posicoes medidas em
refs/original/hall_of_fame.png (capturas de 19/10/2026).
"""
import argparse
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--src", default=r"C:\Users\TALES K\Games\allods2-extracted")
ap.add_argument("--out", default=os.path.join(ROOT, "game", "public", "assets", "ui", "menu"))
a = ap.parse_args()
im = Image.open(os.path.join(a.src, "main", "graphics", "famehall", "hall.bmp")).convert("RGB")
os.makedirs(a.out, exist_ok=True)
im.save(os.path.join(a.out, "hall.webp"), "WEBP", lossless=True)
print("hall.webp", im.size)
