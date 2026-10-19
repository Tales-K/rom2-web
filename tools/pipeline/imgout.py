"""Saida de imagens das pipelines de interface (menu.py, town.py): WebP no lugar de PNG, com o alfa preservado.

Politica (`kind="auto"`):
  * modo L (mascaras/mapas de acerto)          -> PNG sem perda (os valores sao ids e precisam ser exatos)
  * RGB/RGBA grande (>= 20000 px; fundos, paineis, retratos)   -> WebP com perda q=92 (alfa sempre sem perda)
  * pequeno (icones, sprites, bandeiras, botoes)                -> WebP sem perda
  * kind="overlay": como o grande, mas q=95 (quadros de animacao que se sobrepoem ao fundo e nao podem destoar dele)
  * kind="lossless" / "png": forcam sem perda / PNG
Os fundos pintados 1024x768 passam de ~900 KB (PNG) para ~100 KB sem diferenca visivel (PSNR ~38-40 dB).
"""
from pathlib import Path

import numpy as np
from PIL import Image

Q_BG = 92
Q_OVERLAY = 95
BIG = 20000


def _has_alpha(img):
    return img.mode == "RGBA" and int(np.asarray(img)[..., 3].min()) < 255


def save_img(img, path, kind="auto", quality=None):
    """Grava `img`; a extensao de `path` e trocada conforme a politica. Devolve o Path realmente escrito."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if kind == "png" or img.mode in ("L", "P", "1"):
        out = path.with_suffix(".png")
        img.save(out, optimize=True)
        return out
    out = path.with_suffix(".webp")
    big = img.width * img.height >= BIG
    if kind == "lossless" or (kind == "auto" and not big):
        img.save(out, "WEBP", lossless=True, method=6, quality=100)
    else:
        q = quality or (Q_OVERLAY if kind == "overlay" else Q_BG)
        if img.mode == "RGBA" and not _has_alpha(img):
            img = img.convert("RGB")
        img.save(out, "WEBP", quality=q, method=6, alpha_quality=100)
    return out


def save_strip(frames, path, kind="auto", quality=None):
    """Junta quadros do mesmo tamanho numa faixa horizontal e grava. Devolve {"strip": nome, "frames": n, "fw": w, "fh": h}."""
    w, h = frames[0].size
    for f in frames:
        assert f.size == (w, h), "quadros de tamanhos diferentes"
    mode = "RGBA" if any(f.mode == "RGBA" for f in frames) else "RGB"
    sheet = Image.new(mode, (w * len(frames), h))
    for i, f in enumerate(frames):
        sheet.paste(f.convert(mode), (i * w, 0))
    if kind == "auto":
        kind = "lossless" if (w * h < BIG and mode == "RGBA") else "overlay"
    out = save_img(sheet, path, kind, quality)
    return {"strip": out.name, "frames": len(frames), "fw": w, "fh": h}
