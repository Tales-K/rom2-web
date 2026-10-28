"""Pipeline da frente CIDADE: converte a arte de cidade/taverna/loja/briefing/mapa-multi do Rage of Mages II em PNG.

Uso (reexecutavel; sobrescreve a saida):
  .venv/Scripts/python.exe tools/pipeline/town.py [--src <allods2-extracted>] [--out <game/public/assets/ui>]

Saida (relativa a game/public/assets/ui/):
  (imagens em WebP - com perda q92/q95 nas grandes, sem perda nas pequenas -, exceto mascaras em PNG; ver imgout.py)
  town/     main.webp (640x480 de Plagat), mask.png (ids das regioes), hili_<id>.webp (realce ao passar o mouse),
            anim/<nome>.webp (faixa horizontal com todos os quadros; fw/fh/frames em town.json), town.json (regioes + animacoes)
  inn/      center, left_picture, left_stats, buttons_area, btn<1..3>_<off|on>, card_man, card_quest (.webp),
            anim/<nome>.webp (faixas), units/unit<N>_0.webp (so o quadro 0), inn.json, voices.json (lista de vozes existentes)
  shop/     scene, frame, inv, menu, table, cell_shop, cell_mine, money (.webp), anim/<letra>.webp (faixas),
            icons/<arquivo>.webp (icones de itens 80x80, sem perda), shop.json
  globalmap/ uimoir.webp, yases.webp, missionflag.webp / yourflag.webp (faixas; meta em globalmap.json), cross_0.webp (cruz completa),
            sprites.json + cross/flag/flag1/flagonmap.webp (faixas) e hero/flag/ballmap_bmp.webp (ainda sem uso)
  briefing/  sheet.webp (pergaminho 640x480), plan.webp (planta da torre), info/<nome>.webp (so as janelas usadas, ver INFO_USED)

Decisoes (registradas em docs/GAPS.md):
  * Plagat usa a arte "base" (interface/town, interface/inn, interface/shop*, shopanim) — as variantes _kaarg/_druid sao de Kaarg e do Bosque Antigo.
  * Pixels .16a (icones de itens, taverna, bandeiras do mapa-mundi): indice = bits 1..8, opacidade = bits 9..12
    (decodificado em tools/sprites.py; o antigo "byte baixo >> 1" perdia o bit 7 do indice, que fica no byte alto).
  * As posicoes das animacoes foram achadas por correlacao do primeiro quadro com a imagem de fundo (valores fixos abaixo).
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "pipeline"))
import sprites  # noqa: E402
from imgout import save_img, save_strip  # noqa: E402

DEFAULT_SRC = r"C:\Users\TALES K\Games\allods2-extracted"
DEFAULT_OUT = os.path.join(ROOT, "game", "public", "assets", "ui")


def save(img, path, kind="auto"):
    """WebP (com alfa) ou PNG para mascaras; ver imgout.py. A extensao pedida e trocada conforme a politica."""
    return save_img(img, path, kind)


def strip(frames, path, kind="auto"):
    """Quadros de animacao numa faixa horizontal unica (uma requisicao em vez de N); devolve o meta {strip, frames, fw, fh}."""
    return save_strip(frames, path, kind)


def bmp(src, rel):
    return Image.open(os.path.join(src, rel)).convert("RGB")


def black_key(im, thr=6):
    """Torna transparente o preto conectado as bordas (cor-chave dos botoes/ornamentos)."""
    a = np.array(im.convert("RGB")).astype(int)
    h, w, _ = a.shape
    dark = a.sum(axis=2) <= thr
    seen = np.zeros((h, w), bool)
    stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not dark[y, x]:
            continue
        seen[y, x] = True
        stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    rgba = np.dstack([a.astype(np.uint8), np.where(seen, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def sprite_frames(path, half_index=False):
    """Frames RGBA de um .16a/.256 pelo decodificador comum (tools/sprites.py).
    Pixel .16a: indice = bits 1..8, opacidade = bits 9..12 (0..15) — vale para TODOS os .16a (icones, taverna,
    bandeiras do mapa-mundi, cursores). `half_index` ficou so por compatibilidade (era o achado parcial "byte baixo >> 1")."""
    pal, frames, wide = sprites.read_sprite(path)
    out = []
    for w, h, rows in frames:
        im = Image.new("RGBA", (w, h))
        im.putdata(sprites.to_rgba(rows, pal, wide, "idx_alpha", True))
        out.append(im)
    return out


# ---------------------------------------------------------------- cidade (Plagat)
# posicoes (x, y) em 640x480 achadas por correlacao do quadro 0 com townmain.bmp
TOWN_ANIMS = {
    "door": ("town/door", 180, 148),     # grade do portao (abre ao passar o mouse no portao)
    "vane": ("town/fluger", 308, 64),    # cata-vento
    "sign": ("town/sign", 360, 232),     # placa/escudo
    "halo": ("town/stars", 340, 288),    # aureola da estatua
}
# valor da mascara -> nome. Confirmado pelos realces originais (shop_l/tavern_l/trener_l) e pela imagem.
TOWN_REGIONS = {128: "inn", 144: "shop", 160: "gate", 176: "statue", 192: "trainer"}


def largest_component(mask):
    """Mantem so o maior componente conexo (4-vizinhos): a mascara original tem pixels isolados de ruido."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    best, best_n, cur = 0, 0, 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or lab[y0, x0]:
                continue
            cur += 1
            lab[y0, x0] = cur
            stack, n = [(y0, x0)], 0
            while stack:
                y, x = stack.pop()
                n += 1
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur
                        stack.append((yy, xx))
            if n > best_n:
                best, best_n = cur, n
    return lab == best


# ---------------------------------------------------------------- localizacao de quadros na imagem de fundo (posicoes nao gravadas no exe)
def _gray(im):
    return np.asarray(im.convert("RGB"), np.float64).mean(axis=2)


def _corr(a, k):
    """Correlacao valida (sem inverter) de a (H,W) com k (h,w) via FFT -> (H-h+1, W-w+1)."""
    H, W = a.shape
    h, w = k.shape
    fa = np.fft.rfft2(a, (H, W))
    fk = np.fft.rfft2(k[::-1, ::-1], (H, W))
    c = np.fft.irfft2(fa * fk, (H, W))
    return c[h - 1:H, w - 1:W]


def locate(bg, frame, key_black=False, near=None):
    """Posicao (x, y) do quadro no fundo por menor soma de quadrados ponderada (pixels pretos-chave ignorados se key_black;
    quadros RGBA usam o proprio alfa). Devolve (x, y, erro medio por pixel)."""
    B, F = _gray(bg), _gray(frame)
    M = np.ones_like(F)
    if frame.mode == "RGBA":
        M = (np.asarray(frame)[:, :, 3] > 0).astype(np.float64)
    elif key_black:
        M = (np.asarray(frame.convert("RGB")).sum(axis=2) > 18).astype(np.float64)
    ssd = _corr(B * B, M) - 2 * _corr(B, M * F) + (M * F * F).sum()
    if near:
        h, w = F.shape
        yy, xx = np.mgrid[0:ssd.shape[0], 0:ssd.shape[1]]
        ok = (xx + w > near[0]) & (xx < near[2]) & (yy + h > near[1]) & (yy < near[3])
        ssd = np.where(ok, ssd, np.inf)
    y, x = np.unravel_index(int(np.argmin(ssd)), ssd.shape)
    return int(x), int(y), float(max(ssd[y, x], 0) / max(M.sum(), 1)) ** 0.5


def locate_ncc(bg, frame):
    """Posicao por correlacao normalizada (invariante a brilho): para os realces hili_* (versao clareada do fundo)."""
    B, F = _gray(bg), _gray(frame)
    h, w = F.shape
    n = h * w
    Fz = F - F.mean()
    s1 = _corr(B, np.ones_like(F))
    s2 = _corr(B * B, np.ones_like(F))
    var = np.maximum(s2 - s1 * s1 / n, 1e-6)
    ncc = _corr(B, Fz) / (np.sqrt(var) * np.sqrt((Fz * Fz).sum()) + 1e-9)
    y, x = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
    return int(x), int(y), float(ncc[y, x])


def frames_of(src, rel):
    """Quadros BMP de uma pasta (ordem natural) ou de um sprites.16a."""
    p = os.path.join(src, "graphics/interface", rel)
    if os.path.isfile(p):
        return sprite_frames(p)
    files = sorted(glob.glob(os.path.join(p, "*.bmp")))
    return [Image.open(f).convert("RGB") for f in files]


def frame_groups(src, rel):
    """Quadros agrupados em sequencias: prefixo do nome (a1xxxx, a2xxxx, g1xxx...) + tamanho. Cada sequencia tem posicao propria
    (o original desenha uma de cada vez sobre o fundo: parado, gestos, piscar...). palette.bmp e ignorado."""
    p = os.path.join(src, "graphics/interface", rel)
    if os.path.isfile(p):
        return [("", sprite_frames(p))]
    import re
    groups = []
    for f in sorted(glob.glob(os.path.join(p, "*.bmp"))):
        nm = os.path.basename(f).lower()
        if nm == "palette.bmp" or nm.startswith("a_"):
            continue
        im = Image.open(f).convert("RGB")
        am = os.path.join(p, "a_" + os.path.basename(f))     # a_<quadro>.bmp = mascara de opacidade (lagarto do acampamento)
        if os.path.exists(am):
            a = np.asarray(Image.open(am).convert("L"))
            im = Image.fromarray(np.dstack([np.asarray(im), np.where(a > 8, 255, 0).astype(np.uint8)]), "RGBA")
        m = re.match(r"([a-z]+\d)", nm)
        label = (m.group(1) if m else "") + "_%dx%d" % im.size
        if groups and groups[-1][0] == label:
            groups[-1][1].append(im)
        else:
            groups.append((label, [im]))
    return groups


def export_groups(src, rel, bg, d, name, meta_anims, log, near=None, fixed=None):
    """Exporta cada sequencia como anims[name] (a 1a) e anims[name + i] (as demais), todas com "group": name e "seq": i.
    `near` = (x0, y0, x1, y1): so aceita posicoes em que o quadro cruza essa caixa (regiao da mascara do morador)."""
    for i, (label, fr) in enumerate(frame_groups(src, rel)):
        keyed = fr[0].mode != "RGBA" and border_black(fr[0])
        x, y, err = locate(bg, fr[0], keyed, near)
        if fixed and i < len(fixed) and fixed[i]:
            x, y = fixed[i]                  # posicao conferida nas capturas do original (ver FIXED_POS)
        nm = name if i == 0 else "%s%d" % (name, i)
        print("  %s %s [%s] %d quadros em (%d,%d) erro %.1f%s" % (log, nm, label, len(fr), x, y, err, " [preto = transparente]" if keyed else ""))
        if keyed:
            fr = [black_key(f, 18) for f in fr]
        meta_anims[nm] = {"x": x, "y": y, "group": name, "seq": i, **strip(fr, os.path.join(d, "anim", nm))}


def border_black(im, thr=18):
    a = np.asarray(im.convert("RGB")).astype(int).sum(axis=2)
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return (edge <= thr).mean() > 0.6


# ---------------------------------------------------------------- cidades
# Valor da mascara -> funcao: o mesmo nas 3 cidades (128 taverna, 144 loja, 160 portao/saida, 176 estatua = menu do jogo,
# 192 escola em Plagat); os demais valores marcam moradores (clicar = fala da cidade, secoes kaarg*/druid* de town.json).
# Conferido pelos realces originais (shop_l/tavern_l/trener_l; hili_shop/hili_tavern de Kaarg e do acampamento) e pelas
# animacoes que caem dentro de cada regiao (maingates no 160 de Kaarg; dervixe, guarda e mocas nos moradores).
TOWNS = {
    "plagat": {"dir": "town", "out": "town", "regions": {128: "inn", 144: "shop", 160: "gate", 176: "statue", 192: "trainer"},
               "anims": {k: (v[0], v[1], v[2]) for k, v in TOWN_ANIMS.items()}},
    "kaarg": {"dir": "town_kaarg", "out": "town/kaarg",
              "regions": {128: "inn", 144: "shop", 160: "gate", 176: "statue", 32: "person:kaargman", 64: "person:kaargguard",
                          96: "person:kaargwoman", 192: "person:kaargwoman"},
              "anims": {"gate": ("town_kaarg/maingates", None, None), "dervish": ("town_kaarg/dervish", None, None),
                        "girl1": ("town_kaarg/girl1", None, None), "girl2": ("town_kaarg/girl2", None, None),
                        "guard": ("town_kaarg/guard", None, None)}},
    "druids": {"dir": "town_druid", "out": "town/druids",
               "regions": {128: "inn", 144: "shop", 160: "gate", 96: "person:druidinnkeeper", 80: "person:druidshopkeeper"},
               "anims": {"man": ("town_druid/man", None, 96), "woman": ("town_druid/woman", None, 80),
                         "lizard": ("town_druid/lizard", None, None)}},
}


# Posicoes (x, y) por sequencia achadas por correlacao COM AS CAPTURAS DO ORIGINAL (refs/original/town_{kaarg,druids}*.png; o fundo
# townmain.bmp nao tem os figurantes, entao a correlacao com ele erra). Erro medio 2..4 (0..255) exceto o lagarto (alfa parcial).
FIXED_POS = {
    ("druids", "man"): [(164, 200), (164, 200), (152, 184)],
    ("druids", "lizard"): [(0, 300)],
    ("kaarg", "guard"): [(184, 156), (140, 152), (184, 156)],
}


def largest_component(mask):
    """Mantem so o maior componente conexo (4-vizinhos): a mascara original tem pixels isolados de ruido."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    best, best_n, cur = 0, 0, 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or lab[y0, x0]:
                continue
            cur += 1
            lab[y0, x0] = cur
            stack, n = [(y0, x0)], 0
            while stack:
                y, x = stack.pop()
                n += 1
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur
                        stack.append((yy, xx))
            if n > best_n:
                best, best_n = cur, n
    return lab == best


# ---------------------------------------------------------------- localizacao de quadros na imagem de fundo (posicoes nao gravadas no exe)
def _gray(im):
    return np.asarray(im.convert("RGB"), np.float64).mean(axis=2)


def _corr(a, k):
    """Correlacao valida (sem inverter) de a (H,W) com k (h,w) via FFT -> (H-h+1, W-w+1)."""
    H, W = a.shape
    h, w = k.shape
    fa = np.fft.rfft2(a, (H, W))
    fk = np.fft.rfft2(k[::-1, ::-1], (H, W))
    c = np.fft.irfft2(fa * fk, (H, W))
    return c[h - 1:H, w - 1:W]


def locate(bg, frame, key_black=False, near=None):
    """Posicao (x, y) do quadro no fundo por menor soma de quadrados ponderada (pixels pretos-chave ignorados se key_black;
    quadros RGBA usam o proprio alfa). Devolve (x, y, erro medio por pixel)."""
    B, F = _gray(bg), _gray(frame)
    M = np.ones_like(F)
    if frame.mode == "RGBA":
        M = (np.asarray(frame)[:, :, 3] > 0).astype(np.float64)
    elif key_black:
        M = (np.asarray(frame.convert("RGB")).sum(axis=2) > 18).astype(np.float64)
    ssd = _corr(B * B, M) - 2 * _corr(B, M * F) + (M * F * F).sum()
    if near:
        h, w = F.shape
        yy, xx = np.mgrid[0:ssd.shape[0], 0:ssd.shape[1]]
        ok = (xx + w > near[0]) & (xx < near[2]) & (yy + h > near[1]) & (yy < near[3])
        ssd = np.where(ok, ssd, np.inf)
    y, x = np.unravel_index(int(np.argmin(ssd)), ssd.shape)
    return int(x), int(y), float(max(ssd[y, x], 0) / max(M.sum(), 1)) ** 0.5


def locate_ncc(bg, frame):
    """Posicao por correlacao normalizada (invariante a brilho): para os realces hili_* (versao clareada do fundo)."""
    B, F = _gray(bg), _gray(frame)
    h, w = F.shape
    n = h * w
    Fz = F - F.mean()
    s1 = _corr(B, np.ones_like(F))
    s2 = _corr(B * B, np.ones_like(F))
    var = np.maximum(s2 - s1 * s1 / n, 1e-6)
    ncc = _corr(B, Fz) / (np.sqrt(var) * np.sqrt((Fz * Fz).sum()) + 1e-9)
    y, x = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
    return int(x), int(y), float(ncc[y, x])


def frames_of(src, rel):
    """Quadros BMP de uma pasta (ordem natural) ou de um sprites.16a."""
    p = os.path.join(src, "graphics/interface", rel)
    if os.path.isfile(p):
        return sprite_frames(p)
    files = sorted(glob.glob(os.path.join(p, "*.bmp")))
    return [Image.open(f).convert("RGB") for f in files]


def frame_groups(src, rel):
    """Quadros agrupados em sequencias: prefixo do nome (a1xxxx, a2xxxx, g1xxx...) + tamanho. Cada sequencia tem posicao propria
    (o original desenha uma de cada vez sobre o fundo: parado, gestos, piscar...). palette.bmp e ignorado."""
    p = os.path.join(src, "graphics/interface", rel)
    if os.path.isfile(p):
        return [("", sprite_frames(p))]
    import re
    groups = []
    for f in sorted(glob.glob(os.path.join(p, "*.bmp"))):
        nm = os.path.basename(f).lower()
        if nm == "palette.bmp" or nm.startswith("a_"):
            continue
        im = Image.open(f).convert("RGB")
        am = os.path.join(p, "a_" + os.path.basename(f))     # a_<quadro>.bmp = mascara de opacidade (lagarto do acampamento)
        if os.path.exists(am):
            a = np.asarray(Image.open(am).convert("L"))
            im = Image.fromarray(np.dstack([np.asarray(im), np.where(a > 8, 255, 0).astype(np.uint8)]), "RGBA")
        m = re.match(r"([a-z]+\d)", nm)
        label = (m.group(1) if m else "") + "_%dx%d" % im.size
        if groups and groups[-1][0] == label:
            groups[-1][1].append(im)
        else:
            groups.append((label, [im]))
    return groups


def export_groups(src, rel, bg, d, name, meta_anims, log, near=None, fixed=None):
    """Exporta cada sequencia como anims[name] (a 1a) e anims[name + i] (as demais), todas com "group": name e "seq": i.
    `near` = (x0, y0, x1, y1): so aceita posicoes em que o quadro cruza essa caixa (regiao da mascara do morador)."""
    for i, (label, fr) in enumerate(frame_groups(src, rel)):
        keyed = fr[0].mode != "RGBA" and border_black(fr[0])
        x, y, err = locate(bg, fr[0], keyed, near)
        if fixed and i < len(fixed) and fixed[i]:
            x, y = fixed[i]                  # posicao conferida nas capturas do original (ver FIXED_POS)
        nm = name if i == 0 else "%s%d" % (name, i)
        print("  %s %s [%s] %d quadros em (%d,%d) erro %.1f%s" % (log, nm, label, len(fr), x, y, err, " [preto = transparente]" if keyed else ""))
        if keyed:
            fr = [black_key(f, 18) for f in fr]
        meta_anims[nm] = {"x": x, "y": y, "group": name, "seq": i, **strip(fr, os.path.join(d, "anim", nm))}


def border_black(im, thr=18):
    a = np.asarray(im.convert("RGB")).astype(int).sum(axis=2)
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return (edge <= thr).mean() > 0.6


# ---------------------------------------------------------------- cidades
# Valor da mascara -> funcao: o mesmo nas 3 cidades (128 taverna, 144 loja, 160 portao/saida, 176 estatua = menu do jogo,
# 192 escola em Plagat); os demais valores marcam moradores (clicar = fala da cidade, secoes kaarg*/druid* de town.json).
# Conferido pelos realces originais (shop_l/tavern_l/trener_l; hili_shop/hili_tavern de Kaarg e do acampamento) e pelas
# animacoes que caem dentro de cada regiao (maingates no 160 de Kaarg; dervixe, guarda e mocas nos moradores).
# [exe] (frente MAGIA-RE, notes/magic-original.md): teste de clique 0x4cd8b7 (valor-0x20 -> bit: 0x20 0x400, 0x40 0x800, 0x50 0x1000,
# 0x60 0x200, 0x80 2 taverna, 0x90 1 loja, 0xa0 8 portao, 0xb0 0x10 estatua, 0xc0 4); cliques: Plagat 0x4cace7 (bit 4 = escola NAO tratado:
# o clique nao faz nada, so a etiqueta 234 e o realce Trener_l), Kaarg 0x4d2fa3 (4 e 0x200 = kaargwoman, 0x400 kaargman, 0x800 kaargguard),
# acampamento 0x4d06cc (0x200 druidinnkeeper, 0x1000 = 80).
TOWNS = {
    "plagat": {"dir": "town", "out": "town", "regions": {128: "inn", 144: "shop", 160: "gate", 176: "statue", 192: "trainer"},
               "anims": {k: (v[0], v[1], v[2]) for k, v in TOWN_ANIMS.items()}},
    "kaarg": {"dir": "town_kaarg", "out": "town/kaarg",
              "regions": {128: "inn", 144: "shop", 160: "gate", 176: "statue", 32: "person:kaargman", 64: "person:kaargguard",
                          96: "person:kaargwoman", 192: "person:kaargwoman"},
              "anims": {"gate": ("town_kaarg/maingates", None, None), "dervish": ("town_kaarg/dervish", None, None),
                        "girl1": ("town_kaarg/girl1", None, None), "girl2": ("town_kaarg/girl2", None, None),
                        "guard": ("town_kaarg/guard", None, None)}},
    "druids": {"dir": "town_druid", "out": "town/druids",
               "regions": {128: "inn", 144: "shop", 160: "gate", 96: "person:druidinnkeeper", 80: "person:druidshopkeeper"},
               "anims": {"man": ("town_druid/man", None, 96), "woman": ("town_druid/woman", None, 80),
                         "lizard": ("town_druid/lizard", None, None)}},
}


# Posicoes (x, y) por sequencia achadas por correlacao COM AS CAPTURAS DO ORIGINAL (refs/original/town_{kaarg,druids}*.png; o fundo
# townmain.bmp nao tem os figurantes, entao a correlacao com ele erra). Erro medio 2..4 (0..255) exceto o lagarto (alfa parcial).
FIXED_POS = {
    ("druids", "man"): [(164, 200), (164, 200), (152, 184)],
    ("druids", "lizard"): [(0, 300)],
    ("kaarg", "guard"): [(184, 156), (140, 152), (184, 156)],
}


def largest_component(mask):
    """(ys, xs) do maior componente conexo (vizinhanca 8) de uma mascara booleana; sem scipy (busca em largura sobre os pixels)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = ([], [])
    ys0, xs0 = np.where(mask)
    for sy, sx in zip(ys0.tolist(), xs0.tolist()):
        if seen[sy, sx]:
            continue
        stack, comp = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(comp) > len(best[0]):
            best = ([c[0] for c in comp], [c[1] for c in comp])
    return np.array(best[0]), np.array(best[1])


def build_town(src, out, key="plagat"):
    cfg = TOWNS[key]
    d = os.path.join(out, cfg["out"])
    base_dir = "graphics/interface/%s/" % cfg["dir"]
    main = bmp(src, base_dir + "townmain.bmp")
    save(main, os.path.join(d, "main.webp"))
    raw = np.array(Image.open(os.path.join(src, base_dir + "townmask.bmp")).convert("L")).astype(int)
    ids = np.zeros(raw.shape, np.uint8)
    keys = sorted(cfg["regions"])
    for i, k in enumerate(keys, start=1):
        sel = largest_component(np.abs(raw - k) <= 6)
        ids[sel] = i
    save(Image.fromarray(ids, "L"), os.path.join(d, "mask.png"))
    meta = {"size": [640, 480], "town": key, "regions": {}, "anims": {}}
    base = np.array(main)
    for i, k in enumerate(keys, start=1):
        ys, xs = np.where(ids == i)
        # caixa da regiao = maior componente conexo (a mascara tem pixels soltos de ruido longe do objeto: 14 na taverna e 16 no
        # portao de Plagat, que esticariam a caixa e o realce ate 273x320); a mascara em si fica exata
        cys, cxs = largest_component(ids == i)
        x0, x1, y0, y1 = int(cxs.min()), int(cxs.max()), int(cys.min()), int(cys.max())
        name = cfg["regions"][k]
        reg = {"name": name.split(":")[0], "mask": k, "x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1,
               # centro/topo robustos (a mascara tem pixels isolados de ruido nas bordas)
               "cx": int(np.median(xs)), "cy": int(np.median(ys)), "top": int(np.percentile(ys, 3))}
        hili_path = os.path.join(d, "hili_%d.webp" % i)
        if key == "plagat":
            # realce: a propria imagem clareada dentro da regiao
            sub = base[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
            lit = np.clip(sub * 1.28 + 14, 0, 255).astype(np.uint8)
            alpha = (ids[y0:y1 + 1, x0:x1 + 1] == i).astype(np.uint8) * 255
            save(Image.fromarray(np.dstack([lit, alpha]), "RGBA"), hili_path, "lossless")
        else:
            # Kaarg e acampamento: o original SO realca a taverna e a loja, com os bitmaps hili_tavern/hili_shop da pasta da cidade
            # (desenhados inteiros na posicao achada por correlacao com o fundo); portao, estatua e moradores nao se clareiam
            # (refs/original/town_kaarg_hover_* x town_kaarg_hover_none: so a taverna muda, e muda pelo bitmap; 28/10). Antes todas as
            # regioes ganhavam a versao clareada do fundo (realce inventado).
            if os.path.exists(hili_path):
                os.remove(hili_path)
            src_hili = {"inn": "hili_tavern.bmp", "shop": "hili_shop.bmp"}.get(reg["name"])
            if src_hili:
                im = Image.open(os.path.join(src, base_dir + src_hili)).convert("RGB")
                hx, hy, score = locate_ncc(main, im)
                print("  town %s hili %s (%s) em (%d,%d) ncc %.3f" % (key, reg["name"], src_hili, hx, hy, score))
                save(im, hili_path, "lossless")
                reg["hili"] = {"x": hx, "y": hy, "w": im.width, "h": im.height}
        if ":" in name:
            reg["speech"] = name.split(":", 1)[1]
        meta["regions"][str(i)] = reg
    for name, (rel, x, y) in cfg["anims"].items():
        if x is None:                       # Kaarg/acampamento: posicao achada por correlacao, uma por sequencia
            near = None
            if y is not None:               # dica: valor da mascara do morador que a animacao deve cobrir
                ys, xs = np.where(np.abs(raw - y) <= 6)
                near = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
            export_groups(src, rel, main, d, name, meta["anims"], "town " + key, near, FIXED_POS.get((key, name)))
        else:                               # Plagat: posicoes fixas (ja conferidas)
            fr = frames_of(src, rel)
            meta["anims"][name] = {"x": x, "y": y, **strip(fr, os.path.join(d, "anim", name))}
        if name in ("door", "gate"):
            meta["anims"][name]["mode"] = "hover"
            if key == "plagat":
                # grade do portao: o original a mostra FECHADA (ultimo quadro) e a levanta (quadro 0) com o mouse no portao
                meta["anims"][name]["rest"] = meta["anims"][name]["frames"] - 1
                meta["anims"][name]["hoverTo"] = 0
    if key == "plagat":
        build_plagat_ambient(src, d, meta)
    elif key == "druids":
        build_bug(src, d, meta)
    json.dump(meta, open(os.path.join(d, "town.json"), "w"), indent=1)


# Figurantes de Plagat (graphics/interface/townbirds/*: sprites.16a com alfa). Posicoes e quadros conferidos por correlacao com as
# capturas do original (refs/original/town_*.png; erro medio 3..6 em 0..255): carroca (horse5), mulher (baba2), dervixe (dervish3),
# lojista na porta da loja (shopie), porta da taverna que abre com o mouse (tavern), guardas atras da grade do portao (guards).
# "rest" = quadro em repouso (guardas: o original sempre mostra o quadro 7); "mode": loop | hover (abre sobre a regiao `hover`) |
# once (toca de vez em quando).
PLAGAT_AMBIENT = [
    ("cart", ["horse5/a1", "horse5/a2", "horse5/a3"], 140, 400, {"mode": "loop", "fps": 9}),
    ("woman", ["baba2/a1", "baba2/a2"], 308, 424, {"mode": "loop", "fps": 8}),
    ("dervish", ["dervish3"], 392, 420, {"mode": "loop", "fps": 8}),
    ("shopkeeper", ["shopie"], 276, 296, {"mode": "loop", "fps": 8}),
    ("tavern", ["tavern"], 124, 312, {"mode": "hover", "hover": "inn", "fps": 12}),
    ("guards", ["guards"], 184, 158, {"mode": "once", "rest": 7, "fps": 6}),
]


def save_one(img, path):
    out = save_img(img, path, "lossless")
    return {"strip": out.name}


def build_plagat_ambient(src, d, meta):
    root = "townbirds/"
    for name, seqs, x, y, opt in PLAGAT_AMBIENT:
        for i, rel in enumerate(seqs):
            fr = frames_of(src, root + rel + "/sprites.16a")
            nm = name if i == 0 else "%s%d" % (name, i)
            meta["anims"][nm] = {"x": x, "y": y, "group": name, "seq": i, **opt, **strip(fr, os.path.join(d, "anim", nm))}
    # primeiro plano com o preto transparente: torres e telhados passam na frente dos passaros
    top = bmp(src, "graphics/interface/town/town_add.bmp").convert("RGBA")
    a = np.asarray(top).copy()
    a[:, :, 3] = np.where(a[:, :, :3].max(axis=2) > 6, 255, 0)      # preto = transparente em TODOS os pixels (janelas das torres)
    top = Image.fromarray(a, "RGBA")
    meta["overlay"] = {"x": 0, "y": 0, **save_one(top, os.path.join(d, "anim", "skyfront"))}
    # passaros: 9 voos de 57 quadros 552x92 quase vazios; guarda so o recorte justo de cada quadro (atlas por voo)
    flights = []
    for n in range(1, 10):
        fl = atlas_flight(frames_of(src, "%sbirds%d/sprites.16a" % (root, n)), os.path.join(d, "anim", "birds%d" % n))
        if fl:
            flights.append(fl)
    meta["birds"] = {"x": 0, "y": 0, "flights": flights, "fps": 10}


def atlas_flight(fr, path):
    """Voo de quadros quase vazios (passaros de Plagat, besouro do acampamento): atlas com o recorte justo de cada quadro + `cells`
    [x no atlas, w, h, dx, dy] (None = quadro vazio). Devolve {strip, cells} ou None se todos os quadros forem vazios."""
    boxes = [f.getchannel("A").point(lambda v: 255 if v > 0 else 0).getbbox() for f in fr]
    ok = [(f, b) for f, b in zip(fr, boxes) if b]
    if not ok:
        return None
    W = sum(b[2] - b[0] + 2 for _, b in ok)
    H = max(b[3] - b[1] for _, b in ok)
    atlas = Image.new("RGBA", (W, H))
    cells, cx = [], 0
    for f, b in zip(fr, boxes):
        if not b:
            cells.append(None)
            continue
        c = f.crop(b)
        atlas.paste(c, (cx, 0))
        cells.append([cx, c.size[0], c.size[1], b[0], b[1]])
        cx += c.size[0] + 2
    info = save_one(atlas, path)
    return {"strip": info["strip"], "cells": cells}


def build_bug(src, d, meta):
    """Besouro do acampamento druida (town_druid/bug: 183 quadros 640x268, a 10 quadros/s a partir de (0,212); posicao conferida contra a captura
    scratch/cap2/c_druids, erro medio 3 em 0..255). Dividido em voos nos quadros quase vazios (60-61 e a cauda 160..182); o original mostra o inseto
    em voos de ~5 s a cada ~15 s."""
    fr = frames_of(src, "town_druid/bug/sprites.16a")
    flights = []
    for i, (a, b) in enumerate([(0, 60), (62, 160)]):
        fl = atlas_flight(fr[a:b], os.path.join(d, "anim", "bug%d" % i))
        if fl:
            flights.append(fl)
    meta["birds"] = {"x": 0, "y": 212, "flights": flights, "fps": 10}


def build_towns(src, out):
    for k in TOWNS:
        build_town(src, out, k)


# ---------------------------------------------------------------- taverna
INN_ANIMS = {  # nome: (pasta, x, y) dentro de center.png (320x480)
    "breath": ("inn/tender/breath", 80, 152),
    "drink": ("inn/tender/drink", 80, 152),
    "candle": ("inn/candle", 0, 48),
    "cauldron": ("inn/cauldron", 260, 160),
}


def build_inn(src, out):
    d = os.path.join(out, "inn")
    base = "graphics/interface/inn/"
    for rel, name in [("centerarea.bmp", "center"), ("leftpicture.bmp", "left_picture"), ("leftstats.bmp", "left_stats"),
                      ("buttonsarea.bmp", "buttons_area"), ("manback.bmp", "card_man"), ("manbacktalk.bmp", "card_quest")]:
        save(bmp(src, base + rel), os.path.join(d, name + ".webp"))
    for i in (1, 2, 3):
        for st in ("off", "on"):
            save(bmp(src, base + "button%d%s.bmp" % (i, st)), os.path.join(d, "btn%d_%s.webp" % (i, st)))
    # ornamentos da borda do centro (16 px, preto = transparente): ldover (160,238) luover (160,0) ruover (464,0) tav_09 (464,238);
    # gemas dos cantos da moldura do heroi (lbutton em 476,446; rbutton em 598,446; "on" = acesa) e o olho de humanmode.bmp (608,242).
    # Posicoes achadas por correlacao com refs/original/inn_default.png.
    for nm in ("ldover", "luover", "ruover", "tav_09"):
        im = bmp(src, base + nm + ".bmp").convert("RGBA")
        a = np.asarray(im).copy()
        a[:, :, 3] = np.where(a[:, :, :3].max(axis=2) > 6, 255, 0)
        save(Image.fromarray(a, "RGBA"), os.path.join(d, "edge_%s.webp" % nm), "lossless")
    for nm in ("lbuttonoff", "lbuttonon", "rbuttonoff", "rbuttonon"):
        save(black_key(bmp(src, base + nm + ".bmp"), 10), os.path.join(d, "gem_%s.webp" % nm), "lossless")
    eye = bmp(src, "graphics/interface/humanmode.bmp").convert("RGBA")
    a = np.asarray(eye).copy()
    a[:, :, 3] = np.where(a[:, :, :3].max(axis=2) > 6, 255, 0)
    save(Image.fromarray(a, "RGBA"), os.path.join(d, "eye.webp"), "lossless")
    meta = {"anims": {}, "units": {}}
    for name, (rel, x, y) in INN_ANIMS.items():
        files = sorted(glob.glob(os.path.join(src, "graphics/interface", rel, "*.bmp")))
        info = strip([Image.open(f).convert("RGB") for f in files], os.path.join(d, "anim", name))
        meta["anims"][name] = {"x": x, "y": y, **info}
    # sprites dos frequentadores (48x64, 8 quadros): a taverna so usa o quadro 0
    for f in sorted(glob.glob(os.path.join(src, base, "*", "sprites.16a"))):
        nm = os.path.basename(os.path.dirname(f))
        fr = sprite_frames(f, half_index=True)
        save(fr[0], os.path.join(d, "units", "%s_0.webp" % nm), "lossless")
        meta["units"][nm] = len(fr)
    json.dump(meta, open(os.path.join(d, "inn.json"), "w"), indent=1)


def build_inn_variant(src, out, key, folder, anims):
    """Taverna de Kaarg/acampamento: so o centro (tavernmain.bmp) e o taverneiro mudam; paineis e botoes sao os da base."""
    d = os.path.join(out, "inn", key)
    center = bmp(src, "graphics/interface/%s/tavernmain.bmp" % folder)
    save(center, os.path.join(d, "center.webp"))
    meta = {"anims": {}, "center": "center.webp"}
    for name in anims:
        export_groups(src, "%s/%s" % (folder, name), center, d, name, meta["anims"], "inn " + key)
    json.dump(meta, open(os.path.join(d, "inn.json"), "w"), indent=1)


def build_inns(src, out):
    build_inn(src, out)
    build_inn_variant(src, out, "kaarg", "inn_kaarg", ["taverner"])
    build_inn_variant(src, out, "druids", "inn_druid", ["taverner", "waterdrop"])


def export_shop_arrows(src, base, d):
    """Ornamentos de rolagem da grade da loja (72x32, preto = transparente): 1 = acima ativo (gema acesa), 2 = abaixo inativo,
    3 = acima inativo, 4 = abaixo ativo. Posicoes em 640x480 (conferidas em refs/original/shop_default.png): acima (46,0), abaixo (46,271)."""
    for i in range(1, 5):
        f = os.path.join(src, base, "shoparrow%d.bmp" % i)
        if os.path.exists(f):
            save(black_key(Image.open(f).convert("RGB"), 8), os.path.join(d, "arrow%d.webp" % i), "lossless")


def keeper_strips(src, d, x, y, seqs):
    """Animacao do lojista (movies/shopanim, movies/shop_kaarg, movies/shop_druid; quadros opacos que cobrem o vao da porta da cena).
    `seqs` = {nome: lista de arquivos .bmp}; devolve {x, y, <nome>: meta da faixa}. Posicoes (x, y) achadas por correlacao do quadro de
    repouso com refs/original/shop_*.png (cena em 169,8)."""
    meta = {"x": x, "y": y}
    for nm, files in seqs.items():
        meta[nm] = strip([Image.open(f).convert("RGB") for f in files], os.path.join(d, "anim", "keeper_" + nm))
    return meta


def build_shop_variant(src, out, key, folder):
    """Loja de Kaarg/acampamento: cena, moldura, inventario, menu e mesa proprios; hili_<prateleira>.bmp localizados na cena
    (viram as regioes clicaveis das prateleiras); Kaarg tem o fogo animado (fire/dark = normal, fire/select = realcado);
    o acampamento tem a prateleira Elven (elven.bmp, so depois da conversa 675/78)."""
    d = os.path.join(out, "shop", key)
    base = "graphics/interface/%s/" % folder
    scene = bmp(src, base + "shopmain.bmp")
    save(scene, os.path.join(d, "scene.webp"))
    for rel, name in [("shopframe.bmp", "frame"), ("shopinv.bmp", "inv"), ("shopmenu.bmp", "menu"), ("shoptable.bmp", "table")]:
        im = bmp(src, base + rel)
        # o shopmenu desenha por cima da moldura (que entra 16 px sob ele): o preto externo e cor-chave (transparente)
        save(black_key(im, 8) if name == "menu" else im, os.path.join(d, name + ".webp"))
    meta = {"anims": {}, "hili": {}, "extra": {}}
    export_shop_arrows(src, base, d)
    for f in sorted(glob.glob(os.path.join(src, base, "hili_*.bmp"))):
        nm = os.path.basename(f)[5:-4]
        im = Image.open(f).convert("RGB")
        x, y, score = locate_ncc(scene, im)
        print("  shop %s hili_%s em (%d,%d) ncc %.2f" % (key, nm, x, y, score))
        save(im, os.path.join(d, "hili_%s.webp" % nm))
        meta["hili"][nm] = {"x": x, "y": y, "w": im.width, "h": im.height}
    el = os.path.join(src, base, "elven.bmp")
    if os.path.exists(el):
        im = Image.open(el).convert("RGB")
        h = meta["hili"].get("elven")
        save(im, os.path.join(d, "elven.webp"))
        meta["extra"]["elven"] = {"x": h["x"] if h else 0, "y": h["y"] if h else 0, "w": im.width, "h": im.height}
    fire = os.path.join(src, base, "fire", "dark")
    if os.path.isdir(fire):
        for nm in ("burn", "cicle", "lite"):
            fr = [Image.open(os.path.join(fire, "%s%d.bmp" % (nm, i))).convert("RGB") for i in range(1, 7)]
            keyed = border_black(fr[0])
            x, y, err = locate(scene, fr[0], keyed)
            print("  shop %s fogo %s em (%d,%d) erro %.1f" % (key, nm, x, y, err))
            if keyed:
                fr = [black_key(f, 18) for f in fr]
            meta["anims"][nm] = {"x": x, "y": y, **strip(fr, os.path.join(d, "anim", nm))}
    mv = os.path.join(src, "movies", folder)
    grp = {k: sorted(glob.glob(os.path.join(mv, "a%s*.bmp" % k))) for k in "123"}
    if grp["1"]:
        if key == "kaarg":      # 1 = a1 (21 quadros), 2 = a2 (20); repouso = 1o quadro de a1 (72x84 em 120,108)
            meta["keeper"] = keeper_strips(src, d, 120, 108, {"rest": grp["1"][:1], "yes": grp["1"], "no": grp["2"]})
        else:                   # acampamento: a3 = repouso (72x164 em 192,84); a1/a2 = 30 quadros cada
            meta["keeper"] = keeper_strips(src, d, 192, 84, {"rest": grp["3"] or grp["1"][:1], "yes": grp["1"], "no": grp["2"]})
    json.dump(meta, open(os.path.join(d, "shop.json"), "w"), indent=1)


def build_shops(src, out):
    build_shop(src, out)
    build_shop_variant(src, out, "kaarg", "shop_kaarg")
    build_shop_variant(src, out, "druids", "shop_druid")


# ---------------------------------------------------------------- loja
SHOP_ANIMS = {"a": ("shopanim/01", 32, 12), "b": ("shopanim/02", 144, 12), "c": ("shopanim/03", 28, 100), "d": ("shopanim/04", 184, 100)}


def build_shop(src, out):
    d = os.path.join(out, "shop")
    base = "graphics/interface/"
    save(bmp(src, base + "shopanim/shopmain.bmp"), os.path.join(d, "scene.webp"))
    save(bmp(src, base + "shopframe.bmp"), os.path.join(d, "frame.webp"))
    save(bmp(src, base + "shopinv.bmp"), os.path.join(d, "inv.webp"))
    save(black_key(bmp(src, base + "shopmenu.bmp"), 8), os.path.join(d, "menu.webp"))
    save(bmp(src, base + "shoptable.bmp"), os.path.join(d, "table.webp"))
    # fundo das celulas da grade de itens a venda (marrom; o de "meus itens" e o backinv do HUD, verde-azulado)
    save(bmp(src, base + "backinvs.bmp"), os.path.join(d, "backinvs.webp"), "lossless")
    # etiquetas (aba de peso no canto sup. dir., x 42..78, y 1..10) de shopitem/myitem: o resto do bitmap e preto = transparente
    for nm, out_nm in (("shopitem", "cell_shop"), ("myitem", "cell_mine")):
        a = np.array(bmp(src, base + nm + ".bmp")).astype(np.uint8)
        al = np.where(a.astype(int).sum(axis=2) > 6, 255, 0).astype(np.uint8)
        save(Image.fromarray(np.dstack([a, al]), "RGBA"), os.path.join(d, out_nm + ".webp"), "lossless")
    # (shopbutton1..4 = so as cavidades das plaquetas do shopmenu, sem uso: ja estao no shopmenu.bmp)
    export_shop_arrows(src, base, d)
    save(sprite_frames(os.path.join(src, base, "money/money.16a"), True)[0], os.path.join(d, "money.webp"), "lossless")
    meta = {"anims": {}, "icons": []}
    for name, (rel, x, y) in SHOP_ANIMS.items():
        files = sorted(glob.glob(os.path.join(src, base, rel, "*.bmp")), key=lambda p: int(os.path.basename(p)[:-4]))
        info = strip([Image.open(f).convert("RGB") for f in files], os.path.join(d, "anim", name))
        meta["anims"][name] = {"x": x, "y": y, **info}
    for f in sorted(glob.glob(os.path.join(src, "graphics/inventory", "*.16a"))):
        nm = os.path.basename(f)[:-4]
        save(sprite_frames(f, True)[0], os.path.join(d, "icons", nm + ".webp"), "lossless")
        meta["icons"].append(nm)
    mv = os.path.join(src, "movies", "shopanim")
    seq = lambda n: sorted(glob.glob(os.path.join(mv, n, "*.bmp")), key=lambda p: int(os.path.basename(p)[:-4]))
    meta["keeper"] = keeper_strips(src, d, 108, 104, {"idle": seq("pose2-3"), "yes": seq("yes"), "no": seq("no")})
    json.dump(meta, open(os.path.join(d, "shop.json"), "w"))


# ---------------------------------------------------------------- mapa-multi e briefing
def build_globalmap(src, out):
    d = os.path.join(out, "globalmap")
    save(bmp(src, "main/graphics/global.map/umoir.bmp"), os.path.join(d, "uimoir.webp"))
    save(bmp(src, "main/graphics/global.map/gmap.bmp"), os.path.join(d, "yases.webp"))
    gm = os.path.join(src, "graphics/global.map")
    meta = {}
    for folder, name in [("missionflag", "missionflag"), ("yourflag", "yourflag")]:
        fr = sprite_frames(os.path.join(gm, folder, "sprites.16a"))
        meta[name] = strip(fr, os.path.join(d, name), "lossless")
    json.dump(meta, open(os.path.join(d, "globalmap.json"), "w"), indent=1)
    # redes de trilhas (umoirpath.bmp = Uimoir, pathmap.bmp = Yases; 640x480, 0 = vazio, 1 = trilha, 2 = ponto de local): o heroi anda por elas
    # e o jogo desenha a trilha de bolinhas (ballmap.bmp) ao longo do caminho. PNG 0/128/255 (a paleta original nao sobrevive ao canvas).
    for nm, out_nm in (("umoirpath", "path_uimoir"), ("pathmap", "path_yases")):
        a = np.array(Image.open(os.path.join(gm, nm + ".bmp")))
        Image.fromarray(np.select([a == 2, a == 1], [255, 128], 0).astype(np.uint8), "L").save(os.path.join(d, out_nm + ".png"), optimize=True)
    # cruz de missao concluida: os 13 quadros desenham o X traco a traco; cross_0.webp = cruz COMPLETA (ultimo quadro;
    # o nome ficou por compatibilidade com GlobalMapScene — o quadro 0 e so o inicio do 1o traco).
    cross = sprite_frames(os.path.join(gm, "cross", "sprites.16a"))
    save(cross[-1], os.path.join(d, "cross_0.webp"), "lossless")
    # demais sprites do mapa-mundi (o allods2.exe carrega todos com a mesma paleta de 16 niveis, sem cor de jogador);
    # ficam em sprites.json (separado de globalmap.json para nao entrar no pre-carregamento da cena).
    extra = {"cross": strip(cross, os.path.join(d, "cross"), "lossless")}
    for folder in ("flag", "flag1", "flagonmap"):
        extra[folder] = strip(sprite_frames(os.path.join(gm, folder, "sprites.16a")), os.path.join(d, folder), "lossless")
    for name in ("hero", "flag", "ballmap"):  # BMPs 24 bits com fundo preto (cor-chave)
        extra[name + "_bmp"] = save(black_key(bmp(src, "graphics/global.map/%s.bmp" % name)), os.path.join(d, name + "_bmp.webp"), "lossless").name
    json.dump(extra, open(os.path.join(d, "sprites.json"), "w"), indent=1)


# janelas de informacao realmente usadas pelo briefing (tabela INFO_IMAGE em BriefingScene.ts; "castle" e o padrao). Acrescente aqui ao ampliar a tabela.
INFO_USED = {"tower_m", "horse", "tent", "house02", "mine", "tower_s", "tower1", "dragon", "necro", "kaargtow1", "castle", "house03", "orc",
             "squirrel", "necrotower", "kaargshop", "orcshaman", "druid", "zombie_f1", "pyramid1", "mainnecro"}


def build_briefing(src, out):
    d = os.path.join(out, "briefing")
    base = "graphics/interface/docs/"
    save(bmp(src, base + "sheet.bmp"), os.path.join(d, "sheet.webp"))
    save(bmp(src, base + "1.bmp"), os.path.join(d, "plan.webp"))
    # (ok/*.bmp nao e usado: o selo "Ok" e a propria folha)
    for f in sorted(glob.glob(os.path.join(src, "graphics/infowindow", "*.bmp"))):
        nm = os.path.basename(f)[:-4]
        if nm in INFO_USED:
            save(black_key(Image.open(f).convert("RGB"), 12), os.path.join(d, "info", nm + ".webp"))


def build_voices(src, out):
    """Lista os arquivos de fala (assets/audio/speech/{talk,accept,reject,about,town}) em inn/voices.json.
    O jogo usa a lista para saber se existe voz para uma fala (sem tentar baixar arquivos inexistentes)."""
    root = os.path.join(os.path.dirname(out), "audio", "speech")
    data = {}
    for kind in ("talk", "accept", "reject", "about", "town"):
        d = os.path.join(root, kind)
        data[kind] = sorted(f[:-4] for f in os.listdir(d) if f.endswith(".ogg")) if os.path.isdir(d) else []
    path = os.path.join(out, "inn", "voices.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(data, open(path, "w"), separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--only", default="", help="lista de etapas separadas por virgula (town,inn,shop,globalmap,briefing,voices)")
    a = ap.parse_args()
    steps = {"town": build_towns, "inn": build_inns, "shop": build_shops, "globalmap": build_globalmap, "briefing": build_briefing,
             "voices": build_voices}
    names = [n for n in a.only.split(",") if n] or list(steps)
    for fn in (steps[n] for n in names):
        print(fn.__name__)
        fn(a.src, a.out)
    print("ok ->", a.out)


if __name__ == "__main__":
    main()
