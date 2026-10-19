"""Comparador original x nosso (refs/original/<id>.png x refs/ours/<id>.png).

Uso:
  .venv\\Scripts\\python.exe tools/refcap/compare.py [--only id,id] [--orig refs/original] [--ours refs/ours]
                                                    [--out docs/COMPARE] [--shift 8] [--block 4] [--de 12] [--ssim 0.55]

Para cada cenario de tools/refcap/scenarios.json:
  1. alinha (ambos 1024x768; tamanhos diferentes sao reamostrados para 1024x768 com aviso) com busca de deslocamento
     global inteiro em [-shift, shift] (grosso em 1/4 da resolucao, refinado em resolucao cheia);
  2. calcula o mapa de diferenca por pixel (Delta E 1976 em Lab) e o SSIM local (janela uniforme 9x9, luminancia);
  3. marca blocos (4x4 px) divergentes (Delta E medio > --de ou SSIM medio < --ssim), dilata e agrupa em regioes
     (componentes conexos); regioes minusculas sao descartadas;
  4. classifica cada regiao por heuristica:
       - "extra no nosso": borda/energia (gradiente) so do nosso lado;
       - "faltando no nosso": borda/energia so no original;
       - "posicao deslocada": o conteudo existe nos dois lados, mas casa melhor com um deslocamento local
         (busca de molde) — ou um par extra/faltando com o mesmo conteudo;
       - "estilo/cor diferente": mesma estrutura (gradientes correlacionados), cor diferente;
       - "estilo/forma diferente": os dois lados tem conteudo, mas estruturas diferentes;
       - "cursor": regiao pequena junto da posicao do mouse registrada (refs/*/<id>.json);
  5. para sequencias (<id>_000.png ...): energia de movimento por bloco entre quadros consecutivos de cada lado;
     sinaliza "sem animacao onde o original anima" e "anima so no nosso", com contagem de quadros distintos;
  6. grava docs/COMPARE/<id>.png (original | nosso | mapa de diferenca com caixas numeradas + recortes das
     principais regioes) e docs/COMPARE/report.md (sumario por gravidade, itens acionaveis, cenarios sem original).

Somente numpy + Pillow. A cada execucao, avisa quais cenarios nao tem referencia original.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import re
import sys
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H = 1024, 768

# ------------------------------------------------------------------------------------------- utilidades de imagem


def load_rgb(p: Path) -> tuple[np.ndarray, str | None]:
    im = Image.open(p).convert("RGB")
    note = None
    if im.size != (W, H):
        note = f"{p.name}: {im.size[0]}x{im.size[1]} reamostrado para {W}x{H}"
        im = im.resize((W, H), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32), note


def gray(a: np.ndarray) -> np.ndarray:
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def rgb2lab(a: np.ndarray) -> np.ndarray:
    c = a / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], dtype=np.float32)
    xyz = c @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    A = 500 * (f[..., 0] - f[..., 1])
    B = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, A, B], -1)


def box(a: np.ndarray, r: int) -> np.ndarray:
    """media em janela (2r+1)^2 via imagem integral (bordas replicadas)."""
    p = np.pad(a, r + 1, mode="edge").astype(np.float64)
    s = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    out = s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]
    return (out / (k * k))[: a.shape[0], : a.shape[1]].astype(np.float32)


def ssim_map(x: np.ndarray, y: np.ndarray, r: int = 4) -> np.ndarray:
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = box(x, r), box(y, r)
    sxx = box(x * x, r) - mx * mx
    syy = box(y * y, r) - my * my
    sxy = box(x * y, r) - mx * my
    return ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))


def sobel(g: np.ndarray) -> np.ndarray:
    p = np.pad(g, 1, mode="edge")
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    return np.hypot(gx, gy) / 8.0


def shift_img(a: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """desloca a imagem (conteudo vai para +dx,+dy); bordas replicadas."""
    if dx == 0 and dy == 0:
        return a
    h, w = a.shape[:2]
    pad = [(max(dy, 0), max(-dy, 0)), (max(dx, 0), max(-dx, 0))] + [(0, 0)] * (a.ndim - 2)
    p = np.pad(a, pad, mode="edge")
    y0, x0 = max(-dy, 0), max(-dx, 0)
    return p[y0 : y0 + h, x0 : x0 + w]


def block_mean(a: np.ndarray, b: int) -> np.ndarray:
    h, w = a.shape[0] // b * b, a.shape[1] // b * b
    return a[:h, :w].reshape(h // b, b, w // b, b).mean(axis=(1, 3))


def dilate(m: np.ndarray, r: int = 1) -> np.ndarray:
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= shift_bool(m, dx, dy)
    return out


def shift_bool(m: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(m)
    h, w = m.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def components(m: np.ndarray) -> list[list[tuple[int, int]]]:
    """componentes 8-conexos de uma mascara booleana pequena (grade de blocos)."""
    h, w = m.shape
    seen = np.zeros_like(m)
    comps = []
    for y0, x0 in zip(*(v.tolist() for v in np.nonzero(m))):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        cells = []
        while q:
            y, x = q.popleft()
            cells.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        comps.append(cells)
    return comps


def merge_close(comps: list[list[tuple[int, int]]], gap: int) -> list[list[tuple[int, int]]]:
    """une componentes cujas caixas (em blocos) ficam a <= gap blocos uma da outra, se a uniao nao for enorme."""
    boxes = [[min(c[1] for c in cs), min(c[0] for c in cs), max(c[1] for c in cs), max(c[0] for c in cs)] for cs in comps]
    comps = [list(cs) for cs in comps]
    changed = True
    while changed:
        changed = False
        for i in range(len(comps)):
            if not comps[i]:
                continue
            for j in range(i + 1, len(comps)):
                if not comps[j]:
                    continue
                a, c = boxes[i], boxes[j]
                if a[0] - gap <= c[2] and c[0] - gap <= a[2] and a[1] - gap <= c[3] and c[1] - gap <= a[3]:
                    u = [min(a[0], c[0]), min(a[1], c[1]), max(a[2], c[2]), max(a[3], c[3])]
                    ua = (u[2] - u[0] + 1) * (u[3] - u[1] + 1)
                    if ua > 2.5 * ((a[2] - a[0] + 1) * (a[3] - a[1] + 1) + (c[2] - c[0] + 1) * (c[3] - c[1] + 1)) + 64:
                        continue   # uniao vazia demais: provavelmente coisas diferentes
                    comps[i] += comps[j]
                    comps[j] = []
                    boxes[i] = u
                    changed = True
    return [cs for cs in comps if cs]


def best_global_shift(o: np.ndarray, n: np.ndarray, rng: int) -> tuple[int, int, float, float]:
    """(dx, dy, erro_com_desloc, erro_sem) a aplicar ao NOSSO para casar com o original (MAD em cinza)."""
    if rng <= 0:
        e = float(np.abs(o - n).mean())
        return 0, 0, e, e
    go, gn = gray(o), gray(n)
    so, sn = block_mean(go, 4), block_mean(gn, 4)
    m = 2
    best = (0, 0, float("inf"))
    r4 = max(1, (rng + 3) // 4)
    for dy in range(-r4, r4 + 1):
        for dx in range(-r4, r4 + 1):
            e = float(np.abs(so[m:-m, m:-m] - shift_img(sn, dx, dy)[m:-m, m:-m]).mean())
            if e < best[2]:
                best = (dx, dy, e)
    cx, cy = best[0] * 4, best[1] * 4
    m = rng + 4
    base = float(np.abs(go[m:-m, m:-m] - gn[m:-m, m:-m]).mean())
    best = (0, 0, base)
    for dy in range(max(-rng, cy - 4), min(rng, cy + 4) + 1):
        for dx in range(max(-rng, cx - 4), min(rng, cx + 4) + 1):
            e = float(np.abs(go[m:-m, m:-m] - shift_img(gn, dx, dy)[m:-m, m:-m]).mean())
            if e < best[2] - 1e-6:
                best = (dx, dy, e)
    return best[0], best[1], best[2], base


def local_shift(go: np.ndarray, gn: np.ndarray, bb: tuple[int, int, int, int], pm: np.ndarray, rng: int = 24, tol: float = 14.0) -> tuple[int, int, float, float]:
    """procura o deslocamento (dx, dy) que faz o conteudo do NOSSO dentro de bb casar com o original (meia resolucao).
    Mede a fracao dos pixels divergentes (pm) que passam a casar (|diferenca| < tol). Devolve (dx, dy, frac_best, frac0)."""
    x0, y0, x1, y1 = bb
    X0, Y0, X1, Y1 = max(0, x0 - rng), max(0, y0 - rng), min(W, x1 + rng), min(H, y1 + rng)
    patch = gn[y0:y1:2, x0:x1:2]
    msk = pm[y0:y1:2, x0:x1:2]
    if patch.size < 16 or msk.sum() < 8:
        return 0, 0, 0.0, 0.0
    area = go[Y0:Y1:2, X0:X1:2]
    ph, pw = patch.shape
    oy, ox = (y0 - Y0) // 2, (x0 - X0) // 2
    pv = patch[msk]

    def frac(sy, sx):
        a = area[sy : sy + ph, sx : sx + pw]
        if a.shape != patch.shape:
            return 0.0
        return float((np.abs(a[msk] - pv) < tol).mean())

    f0 = frac(oy, ox)
    best = (0, 0, f0)
    for sy in range(0, area.shape[0] - ph + 1):
        for sx in range(0, area.shape[1] - pw + 1):
            f = frac(sy, sx)
            if f > best[2] + 1e-6:
                best = ((sx - ox) * 2, (sy - oy) * 2, f)
    return best[0], best[1], best[2], f0


def hexcolor(a: np.ndarray) -> str:
    c = np.clip(a.reshape(-1, 3).mean(0), 0, 255).astype(int)
    return "#%02x%02x%02x" % tuple(c)


# ------------------------------------------------------------------------------------------- dados


@dataclass
class Region:
    n: int
    bbox: tuple[int, int, int, int]
    area: int
    score: float
    category: str
    detail: str
    severity: float = 0.0
    hint: str = ""


@dataclass
class Result:
    id: str
    desc: str
    status: str  # ok | sem-original | sem-nosso
    notes: list[str] = field(default_factory=list)
    regions: list[Region] = field(default_factory=list)
    ssim: float = 1.0
    diverge_pct: float = 0.0
    shift: tuple[int, int] = (0, 0)
    image: str = ""
    motion: list[dict] = field(default_factory=list)
    ours_warnings: list[str] = field(default_factory=list)
    framing: str = ""
    roi: tuple | None = None          # (x0,y0,x1,y1) da interface comparada (scenarios.json `roi`)
    ssim_roi: float | None = None     # SSIM medio so dentro do roi, SEM deslocamento global (interface ancorada na tela)


CAT_WEIGHT = {
    "extra no nosso": 1.0,
    "faltando no nosso": 1.0,
    "sem animacao onde o original anima": 1.0,
    "anima so no nosso": 0.6,
    "estilo/forma diferente": 0.8,
    "estilo/cor diferente": 0.6,
    "posicao deslocada": 0.5,
    "cursor": 0.35,
}
CAT_COLOR = {
    "extra no nosso": (255, 60, 60),
    "faltando no nosso": (60, 140, 255),
    "posicao deslocada": (255, 200, 40),
    "estilo/cor diferente": (200, 90, 255),
    "estilo/forma diferente": (255, 120, 200),
    "cursor": (140, 140, 140),
    "sem animacao onde o original anima": (60, 255, 120),
    "anima so no nosso": (255, 150, 60),
}

SCENE_FILES = [
    ("menu_", "game/src/scenes/MenuScene.ts (arte: tools/pipeline/menu.py)"),
    ("chargen_", "game/src/scenes/ChargenScene.ts (arte: tools/pipeline/menu.py)"),
    ("town_", "game/src/scenes/TownScene.ts + game/src/town/common.ts (arte: tools/pipeline/town.py)"),
    ("inn_", "game/src/scenes/InnScene.ts (arte: tools/pipeline/town.py)"),
    ("shop_", "game/src/scenes/ShopScene.ts (arte: tools/pipeline/town.py)"),
    ("briefing_", "game/src/scenes/BriefingScene.ts"),
    ("globalmap", "game/src/scenes/GlobalMapScene.ts (bandeiras/arte: tools/pipeline/town.py)"),
]
PANEL_X = 848  # game/src/mission/hud.ts


def code_hint(sid: str, bb: tuple[int, int, int, int], cat: str) -> str:
    if cat == "cursor":
        return "game/src/scenes/MissionScene.ts (updateCursor) + assets/ui/cursors" if sid.startswith("mission") else "game/src/ui/cursor.ts (applyThemeCursor) / cena"
    if sid.startswith("mission"):
        x0, y0, x1, y1 = bb
        if x0 >= PANEL_X - 4:
            return "game/src/mission/hud.ts (painel direito; arte: tools/pipeline/mission.py)"
        if x1 > PANEL_X + 8:
            return "game/src/mission/hud.ts / game/src/mission/view.ts (cruza a borda do painel)"
        if y0 >= 600:
            return "game/src/mission/hud.ts (caixa de dialogo/mensagens) ou view.ts"
        if y1 <= 24:
            return "game/src/mission/hud.ts (linha de aviso no topo: hud.say)"
        return "game/src/mission/view.ts (mundo: unidades, barras, aneis, terreno) / game/src/mission/fog.ts"
    for pre, f in SCENE_FILES:
        if sid.startswith(pre):
            return f
    return ""


def load_provenance() -> dict[str, list[str]]:
    p = ROOT / "docs/PROVENANCE.md"
    out: dict[str, list[str]] = {}
    if not p.exists():
        return out
    cur = None
    for line in p.read_text(encoding="utf8").splitlines():
        m = re.match(r"## `([^`]+)`", line)
        if m:
            cur = m.group(1)
            out[cur] = []
        elif cur and line.startswith("- L"):
            out[cur].append(line[2:].strip())
    return out


# ------------------------------------------------------------------------------------------- analise de quadro


def analyze_pair(sid: str, o: np.ndarray, n: np.ndarray, args, mouse_pts: list[tuple[int, int]]):
    dx, dy, e1, e0 = best_global_shift(o, n, args.shift)
    notes = []
    if (dx, dy) != (0, 0):
        notes.append(f"deslocamento global aplicado ao nosso: dx={dx} dy={dy} (erro medio {e0:.1f} -> {e1:.1f})")
        n = shift_img(n, dx, dy)
    lo, ln = rgb2lab(o), rgb2lab(n)
    de = np.sqrt(((lo - ln) ** 2).sum(-1))
    go, gn = gray(o), gray(n)
    ss = ssim_map(go, gn)
    b = args.block
    bde, bss = block_mean(de, b), block_mean(ss, b)
    bad = (bde > args.de) | (bss < args.ssim)
    score_blk = np.clip(np.maximum(bde / (2.5 * args.de), (1 - bss) / (1 - args.ssim) / 2.5), 0, 1)
    mask = dilate(bad, 1)
    if sid.startswith("mission"):
        # zonas independentes: painel do HUD (x >= PANEL_X) x area de jogo (depende da camera/estado)
        mask[:, PANEL_X // b - 1 : PANEL_X // b + 1] = False
    Go, Gn = sobel(go), sobel(gn)
    regions: list[Region] = []
    min_blocks = max(2, args.min_area // (b * b))
    zone_of = (lambda cs: cs[0][1] * b >= PANEL_X) if sid.startswith("mission") else (lambda cs: 0)
    comps = components(mask)
    merged = []
    for z in {zone_of(c) for c in comps}:
        merged += merge_close([c for c in comps if zone_of(c) == z], args.merge // b + 1)
    # regioes enormes (layout inteiro diferente): subdivide com limiar mais estrito, sem dilatar/unir
    strict = (bde > 2 * args.de) | (bss < args.ssim / 2)
    final = []
    for cells in merged:
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        if (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1) * b * b <= 0.2 * W * H:
            final.append(cells)
            continue
        inside = np.zeros(bad.shape, bool)
        for y, x in cells:
            inside[y, x] = True
        subs = [c for c in components(dilate(strict & inside, 1) & inside) if sum(1 for y, x in c if strict[y, x]) * b * b >= 600]
        if len(subs) >= 2:
            final += subs
        else:
            final.append(cells)
    for cells in final:
        core = [(y, x) for y, x in cells if bad[y, x]]
        if len(core) < min_blocks:
            continue
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        bb = (min(xs) * b, min(ys) * b, (max(xs) + 1) * b, (max(ys) + 1) * b)
        sel = np.zeros(bad.shape, bool)
        for y, x in core:
            sel[y, x] = True
        pm = np.kron(sel, np.ones((b, b), bool))
        pm = np.pad(pm, ((0, H - pm.shape[0]), (0, W - pm.shape[1])))
        area = int(pm.sum())
        sc = float(score_blk[sel].mean())
        regions.append(classify(sid, o, n, lo, ln, go, gn, Go, Gn, pm, bb, area, sc, mouse_pts))
    pair_moves(regions, go, gn)
    for r in regions:
        x0, y0, x1, y1 = r.bbox
        if (x1 - x0) * (y1 - y0) > 0.2 * W * H:
            r.detail += " | regiao enorme: estado/camera/layout provavelmente diferentes entre as capturas — conferir a imagem"
    for r in regions:
        r.severity = 100.0 * r.area * r.score * CAT_WEIGHT.get(r.category, 0.7) / (W * H)
        r.hint = code_hint(sid, r.bbox, r.category)
    regions.sort(key=lambda r: -r.severity)
    for i, r in enumerate(regions, 1):
        r.n = i
    stats = {"ssim": float(ss.mean()), "diverge_pct": 100.0 * float(bad.mean()), "shift": (dx, dy), "de": de, "n_shifted": n}
    return regions, notes, stats


def context_dev(lab: np.ndarray, pm: np.ndarray, bb, ring: int = 10) -> float:
    """quanto o interior da regiao destoa do anel em volta (media e desvio em Lab)."""
    x0, y0, x1, y1 = bb
    X0, Y0, X1, Y1 = max(0, x0 - ring), max(0, y0 - ring), min(W, x1 + ring), min(H, y1 + ring)
    rm = np.zeros((H, W), bool)
    rm[Y0:Y1, X0:X1] = True
    rm[y0:y1, x0:x1] = False
    if rm.sum() < 16:
        return 0.0
    a, r = lab[pm], lab[rm]
    return float(np.abs(a.mean(0) - r.mean(0)).sum() + 0.5 * np.abs(a.std(0) - r.std(0)).sum())


def classify(sid, o, n, lo, ln, go, gn, Go, Gn, pm, bb, area, sc, mouse_pts) -> Region:
    x0, y0, x1, y1 = bb
    eo, en = float(Go[pm].mean()), float(Gn[pm].mean())
    so, sn = float(go[pm].std()), float(gn[pm].std())
    w, h = x1 - x0, y1 - y0
    co, cn = hexcolor(o[pm]), hexcolor(n[pm])
    # cursor: pequeno e junto do mouse registrado
    if w <= 64 and h <= 64:
        for mx, my in mouse_pts:
            if x0 - 24 <= mx <= x1 + 24 and y0 - 24 <= my <= y1 + 24:
                side = "so no nosso" if en > 1.6 * eo + 1 else "so no original" if eo > 1.6 * en + 1 else "diferente"
                return Region(0, bb, area, sc, "cursor", f"perto do mouse ({mx},{my}); {side}")
    eps = 1.5
    ratio = (en + eps) / (eo + eps)
    # posicao deslocada (conteudo casa com deslocamento local)
    if w * h <= 0.35 * W * H and min(eo, en) > 2.0:
        ldx, ldy, fb, f0 = local_shift(go, gn, bb, pm)
        if (abs(ldx) + abs(ldy)) >= 2 and fb >= 0.6 and fb >= f0 + 0.3:
            return Region(0, bb, area, sc, "posicao deslocada", f"o original casa com o nosso deslocado de dx={-ldx} dy={-ldy} (pixels divergentes que casam: {100 * f0:.0f}% -> {100 * fb:.0f}%)")
    a, c = Go[pm] - Go[pm].mean(), Gn[pm] - Gn[pm].mean()
    corr = float((a * c).sum() / (math.sqrt(float((a * a).sum() * (c * c).sum())) + 1e-6))
    if corr > 0.45 and min(eo, en) > 1.0:
        return Region(0, bb, area, sc, "estilo/cor diferente", f"mesma estrutura (corr. de bordas {corr:.2f}); cor media {co} x {cn}")
    # qual lado destoa do entorno (o anel em volta da regiao e igual nos dois lados)
    c_o, c_n = context_dev(lo, pm, bb), context_dev(ln, pm, bb)
    ctx = f"desvio do entorno original {c_o:.0f} x nosso {c_n:.0f}; bordas {eo:.1f} x {en:.1f}; cor media {co} x {cn}"
    # diferenca forte de energia de borda decide primeiro (ex.: grade com guardas no original x arco vazio no nosso)
    if ratio > 2.5 and en > 6:
        return Region(0, bb, area, sc, "extra no nosso", ctx)
    if ratio < 1 / 2.5 and eo > 6:
        return Region(0, bb, area, sc, "faltando no nosso", ctx)
    if c_n > 1.6 * c_o + 4:
        return Region(0, bb, area, sc, "extra no nosso", ctx)
    if c_o > 1.6 * c_n + 4:
        return Region(0, bb, area, sc, "faltando no nosso", ctx)
    if ratio > 1.8 or (so < 4 and sn > 10):
        return Region(0, bb, area, sc, "extra no nosso", ctx)
    if ratio < 1 / 1.8 or (sn < 4 and so > 10):
        return Region(0, bb, area, sc, "faltando no nosso", ctx)
    if corr > 0.45:
        return Region(0, bb, area, sc, "estilo/cor diferente", f"mesma estrutura (corr. de bordas {corr:.2f}); cor media {co} x {cn}")
    return Region(0, bb, area, sc, "estilo/forma diferente", f"estruturas diferentes (corr. de bordas {corr:.2f}); cor media {co} x {cn}")


def pair_moves(regions: list[Region], go, gn) -> None:
    """um par 'extra' + 'faltando' de tamanho parecido e mesmo conteudo vira 'posicao deslocada'."""
    extras = [r for r in regions if r.category == "extra no nosso"]
    missing = [r for r in regions if r.category == "faltando no nosso"]
    for e in extras:
        ex0, ey0, ex1, ey1 = e.bbox
        best = None
        for m in missing:
            mx0, my0, mx1, my1 = m.bbox
            ew, eh, mw, mh = ex1 - ex0, ey1 - ey0, mx1 - mx0, my1 - my0
            if not (0.6 < ew / max(mw, 1) < 1.66 and 0.6 < eh / max(mh, 1) < 1.66):
                continue
            w, h = min(ew, mw), min(eh, mh)
            pe, po = gn[ey0 : ey0 + h, ex0 : ex0 + w], go[my0 : my0 + h, mx0 : mx0 + w]
            err = float(np.abs(pe - po).mean())
            base = float(np.abs(gn[ey0 : ey0 + h, ex0 : ex0 + w] - go[ey0 : ey0 + h, ex0 : ex0 + w]).mean())
            if err < 0.5 * base and (best is None or err < best[0]):
                best = (err, m, base)
        if best:
            err, m, base = best
            ddx, ddy = e.bbox[0] - m.bbox[0], e.bbox[1] - m.bbox[1]
            for r in (e, m):
                r.category = "posicao deslocada"
                r.detail = f"o elemento do original em {m.bbox[:2]} aparece no nosso em {e.bbox[:2]} (dx={ddx} dy={ddy}; erro {base:.1f} -> {err:.1f})"
            missing.remove(m)


# ------------------------------------------------------------------------------------------- sequencias


STD_SIZES = [(640, 480), (800, 600)]


def content_box(a: np.ndarray) -> tuple[int, int, int, int] | None:
    """caixa do conteudo nao preto (linhas/colunas com > 5% de pixels acesos; ignora o cursor solto na borda)."""
    m = gray(a) > 10
    r = np.nonzero(m.mean(1) > 0.05)[0]
    c = np.nonzero(m.mean(0) > 0.05)[0]
    if not len(r) or not len(c):
        return None
    return int(c.min()), int(r.min()), int(c.max()) + 1, int(r.max()) + 1


def find_fit(o: np.ndarray, n: np.ndarray, mode: str):
    """Se o original mostra a tela menor (ex.: 640x480 centralizada com borda preta) e o nosso ocupa a tela toda,
    devolve (caixa_original, caixa_nossa) para reamostrar o original sobre a area do nosso. Senao None."""
    if mode == "none":
        return None
    bo, bn = content_box(o), content_box(n)
    if not bo or not bn:
        return None
    ao = (bo[2] - bo[0]) * (bo[3] - bo[1])
    an = (bn[2] - bn[0]) * (bn[3] - bn[1])
    if not (ao < 0.8 * W * H and an > 0.9 * W * H):
        return None
    for sw, sh in STD_SIZES:   # encaixa no tamanho padrao centralizado mais proximo
        x0, y0 = (W - sw) // 2, (H - sh) // 2
        if all(abs(u - v) <= 24 for u, v in zip(bo, (x0, y0, x0 + sw, y0 + sh))):
            bo = (x0, y0, x0 + sw, y0 + sh)
            break
    return bo, (0, 0, W, H)


def apply_fit(a: np.ndarray, fit) -> np.ndarray:
    (x0, y0, x1, y1), (X0, Y0, X1, Y1) = fit
    crop = a[y0:y1, x0:x1]
    if a.ndim == 3:
        im = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8)).resize((X1 - X0, Y1 - Y0), Image.BICUBIC)
        arr = np.asarray(im, dtype=np.float32)
    else:
        arr = np.asarray(Image.fromarray(crop.astype(np.float32), "F").resize((X1 - X0, Y1 - Y0), Image.BICUBIC), dtype=np.float32)
    out = np.zeros_like(a)
    out[Y0:Y1, X0:X1] = arr
    return out


def fit_point(p: tuple[int, int], fit) -> tuple[int, int] | None:
    (x0, y0, x1, y1), (X0, Y0, X1, Y1) = fit
    if not (x0 <= p[0] < x1 and y0 <= p[1] < y1):
        return None
    return int(X0 + (p[0] - x0) * (X1 - X0) / (x1 - x0)), int(Y0 + (p[1] - y0) * (Y1 - Y0) / (y1 - y0))


def load_seq(d: Path, sid: str) -> list[np.ndarray]:
    fs = sorted(d.glob(f"{sid}_[0-9][0-9][0-9].png"))
    out = []
    for f in fs:
        a, _ = load_rgb(f)
        out.append(gray(a))
    return out


def motion_map(frames: list[np.ndarray], thr: float = 10.0) -> tuple[np.ndarray, np.ndarray]:
    """fracao de transicoes em que o pixel mudou (> thr) e energia media |diff|."""
    acc = np.zeros(frames[0].shape, np.float32)
    en = np.zeros(frames[0].shape, np.float32)
    for a, b in zip(frames, frames[1:]):
        d = np.abs(a - b)
        acc += d > thr
        en += d
    k = max(1, len(frames) - 1)
    return acc / k, en / k


def distinct_frames(frames: list[np.ndarray], bb, thr: float = 6.0) -> int:
    x0, y0, x1, y1 = bb
    reps: list[np.ndarray] = []
    for f in frames:
        p = f[y0:y1, x0:x1]
        if not any(float(np.abs(p - r).mean()) < thr / 4 and float((np.abs(p - r) > thr).mean()) < 0.01 for r in reps):
            reps.append(p)
    return len(reps)


def motion_regions(mm: np.ndarray, b: int = 8, frac: float = 0.08) -> list[tuple[int, int, int, int]]:
    blk = block_mean(mm, b) > frac
    out = []
    for cells in components(dilate(blk, 1)):
        core = [c for c in cells if blk[c]]
        if len(core) < 2:
            continue
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        out.append((min(xs) * b, min(ys) * b, (max(xs) + 1) * b, (max(ys) + 1) * b))
    return out


def analyze_motion(sid, fo, fn, mouse_pts) -> tuple[list[Region], list[dict]]:
    mo, _ = motion_map(fo)
    mn, _ = motion_map(fn)
    ro, rn = motion_regions(mo), motion_regions(mn)
    regs: list[Region] = []
    info = []

    def near_cursor(bb):
        x0, y0, x1, y1 = bb
        return (x1 - x0) <= 72 and (y1 - y0) <= 72 and any(x0 - 24 <= mx <= x1 + 24 and y0 - 24 <= my <= y1 + 24 for mx, my in mouse_pts)

    def grow(bb, m=48):
        return (max(0, bb[0] - m), max(0, bb[1] - m), min(W, bb[2] + m), min(H, bb[3] + m))

    bo, bn = block_mean(mo, 8), block_mean(mn, 8)

    def peak(bm, bb):
        x0, y0, x1, y1 = bb
        v = bm[y0 // 8 : max(y0 // 8 + 1, y1 // 8), x0 // 8 : max(x0 // 8 + 1, x1 // 8)]
        return float(v.max()) if v.size else 0.0

    for bb in ro:
        x0, y0, x1, y1 = bb
        g = grow(bb)
        a_o, a_n = peak(bo, bb), peak(bn, g)
        k_o, k_n = distinct_frames(fo, bb), distinct_frames(fn, g)
        info.append({"lado": "original", "bbox": bb, "quadros_distintos": k_o, "quadros_distintos_nosso_na_area": k_n, "atividade": round(a_o, 3)})
        if near_cursor(bb):
            continue
        if k_n <= 1 or a_n < 0.15 * a_o:
            area = (x1 - x0) * (y1 - y0)
            regs.append(Region(0, bb, area, min(1.0, 0.5 + a_o), "sem animacao onde o original anima",
                               f"original: {k_o} quadros distintos em {len(fo)} (atividade de pico {a_o:.2f}); nosso (area +48px): {k_n} quadro(s), atividade {a_n:.2f}"))
    for bb in rn:
        x0, y0, x1, y1 = bb
        g = grow(bb)
        a_n, a_o = peak(bn, bb), peak(bo, g)
        k_n, k_o = distinct_frames(fn, bb), distinct_frames(fo, g)
        info.append({"lado": "nosso", "bbox": bb, "quadros_distintos": k_n, "quadros_distintos_original_na_area": k_o, "atividade": round(a_n, 3)})
        if near_cursor(bb):
            continue
        if k_o <= 1 or a_o < 0.15 * a_n:
            area = (x1 - x0) * (y1 - y0)
            regs.append(Region(0, bb, area, min(1.0, 0.4 + a_n), "anima so no nosso",
                               f"nosso: {k_n} quadros distintos em {len(fn)}; original (area +48px): {k_o} quadro(s)"))
    return regs, info


# ------------------------------------------------------------------------------------------- imagens


def font(size: int):
    for name in ("arial.ttf", "DejaVuSans.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def heatmap(de: np.ndarray, base: np.ndarray) -> np.ndarray:
    t = np.clip(de / 40.0, 0, 1)[..., None]
    g = gray(base)[..., None] * 0.35
    hot = np.concatenate([np.clip(t * 3, 0, 1), np.clip(t * 3 - 1, 0, 1), np.clip(t * 3 - 2, 0, 1)], -1) * 255
    return np.clip(np.repeat(g, 3, -1) * (1 - t) + hot * t, 0, 255).astype(np.uint8)


def render(res: Result, o: np.ndarray | None, n: np.ndarray | None, de: np.ndarray | None, out: Path, mo=None, mn=None) -> None:
    s = 2 / 3
    pw, ph = int(W * s), int(H * s)
    f_t, f_b, f_s = font(18), font(16), font(13)
    panels = []
    titles = []
    if o is not None:
        panels.append(Image.fromarray(o.astype(np.uint8)))
        titles.append("ORIGINAL")
    if n is not None:
        panels.append(Image.fromarray(n.astype(np.uint8)))
        titles.append("NOSSO")
    if de is not None:
        panels.append(Image.fromarray(heatmap(de, n if n is not None else o)))
        titles.append("DIFERENCA (Delta E) + regioes")
    if mo is not None:
        panels.append(Image.fromarray(motion_vis(mo)))
        titles.append("MOVIMENTO original")
    if mn is not None:
        panels.append(Image.fromarray(motion_vis(mn)))
        titles.append("MOVIMENTO nosso")
    cols = 3
    rows = (len(panels) + cols - 1) // cols
    top = 30
    crops = [r for r in res.regions[:8]]
    crop_h = 170 if crops else 0
    canvas = Image.new("RGB", (cols * pw + (cols - 1) * 6, rows * (ph + top) + (crop_h + 34 if crops else 0) + 4), (24, 22, 20))
    d = ImageDraw.Draw(canvas)
    for i, (p, t) in enumerate(zip(panels, titles)):
        cx, cy = (i % cols) * (pw + 6), (i // cols) * (ph + top)
        pi = p.resize((pw, ph), Image.BILINEAR)
        dd = ImageDraw.Draw(pi)
        for r in res.regions:
            col = CAT_COLOR.get(r.category, (255, 255, 255))
            x0, y0, x1, y1 = [int(v * s) for v in r.bbox]
            dd.rectangle([x0, y0, x1, y1], outline=col, width=2 if t.startswith("DIF") else 1)
            if t.startswith("DIF") or t.startswith("MOV"):
                dd.text((x0 + 2, max(0, y0 - 15)), str(r.n), fill=col, font=f_b, stroke_width=2, stroke_fill=(0, 0, 0))
        canvas.paste(pi, (cx, cy + top))
        d.text((cx + 4, cy + 6), f"{t}  [{res.id}]", fill=(240, 220, 160), font=f_t)
    if crops:
        y = rows * (ph + top) + 4
        d.text((4, y), "Recortes (original | nosso) das principais regioes:", fill=(240, 220, 160), font=f_b)
        y += 24
        x = 4
        for r in crops:
            x0, y0, x1, y1 = r.bbox
            m = 6
            bb = (max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m))
            parts = []
            for a in (o, n):
                if a is None:
                    continue
                parts.append(Image.fromarray(a[bb[1] : bb[3], bb[0] : bb[2]].astype(np.uint8)))
            if not parts:
                continue
            bw, bh = parts[0].size
            k = min((crop_h - 18) / bh, 220 / bw, 4.0)
            tw, th = max(1, int(bw * k)), max(1, int(bh * k))
            need = tw * len(parts) + 4 * (len(parts) - 1)
            if x + need > canvas.width:
                break
            for j, p in enumerate(parts):
                canvas.paste(p.resize((tw, th), Image.NEAREST), (x + j * (tw + 4), y + 16))
            col = CAT_COLOR.get(r.category, (255, 255, 255))
            d.text((x, y), f"{r.n}: {r.category}", fill=col, font=f_s)
            x += need + 18
    canvas.save(out, optimize=True)


def motion_vis(m: np.ndarray) -> np.ndarray:
    t = np.clip(m * 2.0, 0, 1)
    out = np.zeros(m.shape + (3,), np.uint8)
    out[..., 1] = (t * 255).astype(np.uint8)
    out[..., 0] = (t * 80).astype(np.uint8)
    return out


# ------------------------------------------------------------------------------------------- principal


def meta_mouse(d: Path, sid: str) -> list[tuple[int, int]]:
    """posicao do mouse: <dir>/<id>.json (campo mouse/cursor_pos) ou <dir>/meta.json[id] (campo mouse, ou 'mouse ... (x,y)' em 'how')."""
    p = d / f"{sid}.json"
    j = None
    try:
        if p.exists():
            j = json.loads(p.read_text(encoding="utf8"))
        elif (d / "meta.json").exists():
            j = json.loads((d / "meta.json").read_text(encoding="utf8")).get(sid)
    except Exception:
        return []
    if not isinstance(j, dict):
        return []
    if not (j.get("mouse") or j.get("cursor_pos")):
        m = re.search(r"mouse[^()]*\((\d+)\s*,\s*(\d+)\)", str(j.get("how", "")))
        return [(int(m.group(1)), int(m.group(2)))] if m else []
    m = j.get("mouse") or j.get("cursor_pos")
    if isinstance(m, dict) and "x" in m:
        return [(int(m["x"]), int(m["y"]))]
    if isinstance(m, (list, tuple)) and len(m) == 2:
        return [(int(m[0]), int(m[1]))]
    return []


def meta_warnings(d: Path, sid: str) -> list[str]:
    p = d / f"{sid}.json"
    if not p.exists():
        return []
    try:
        return list(json.loads(p.read_text(encoding="utf8")).get("warnings", []))
    except Exception:
        return []


def ours_motion_summary(res: Result, fn: list[np.ndarray], mouse: list[tuple[int, int]]) -> None:
    """sem original: descreve o que anima no nosso (para achar 'heroi parado' sem precisar da referencia)."""
    mn, _ = motion_map(fn)
    comps = motion_regions(mn)
    moving = []
    for bb in comps:
        x0, y0, x1, y1 = bb
        cur = (x1 - x0) <= 72 and (y1 - y0) <= 72 and any(x0 - 24 <= mx <= x1 + 24 and y0 - 24 <= my <= y1 + 24 for mx, my in mouse)
        k = distinct_frames(fn, bb)
        res.motion.append({"lado": "nosso", "bbox": bb, "quadros_distintos": k, "cursor": cur})
        if not cur:
            moving.append((bb, k))
    if not moving:
        res.ours_warnings.append(f"sequencia de {len(fn)} quadros: nada anima alem do cursor (heroi/unidades/cenario parados)")
    else:
        res.ours_warnings.append(f"sequencia de {len(fn)} quadros: anima(m) " + ", ".join(f"{bb} ({k} quadros distintos)" for bb, k in moving[:6]))


def run(args) -> list[Result]:
    scen = json.loads(Path(args.scenarios).read_text(encoding="utf8"))["scenarios"]
    if args.only:
        want = set(args.only.split(","))
        scen = [s for s in scen if s["id"] in want]
    od, nd, out = Path(args.orig), Path(args.ours), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for s in scen:
        sid = s["id"]
        res = Result(sid, s.get("desc", ""), "ok")
        res.ours_warnings = meta_warnings(nd, sid)
        mouse_n, mouse_o = meta_mouse(nd, sid), meta_mouse(od, sid)
        mouse = mouse_n + mouse_o
        seq = s.get("sequence")
        if seq:
            fo, fn = load_seq(od, sid), load_seq(nd, sid)
            have_o, have_n = bool(fo), bool(fn)
            single_o = od / f"{sid}_000.png"
            single_n = nd / f"{sid}_000.png"
        else:
            single_o, single_n = od / f"{sid}.png", nd / f"{sid}.png"
            have_o, have_n = single_o.exists(), single_n.exists()
        if not have_n:
            res.status = "sem-nosso"
        if not have_o:
            res.status = "sem-original" if have_n else "sem-ambos"
        if res.status != "ok":
            if seq and have_n and len(fn) > 1:
                ours_motion_summary(res, fn, mouse)
            if have_n and args.render_missing:
                n, _ = load_rgb(single_n)
                img = out / f"{sid}.png"
                render(res, None, n, None, img)
                res.image = img.name
            results.append(res)
            continue
        o, no1 = load_rgb(single_o)
        n, no2 = load_rgb(single_n)
        res.notes += [x for x in (no1, no2) if x]
        fit = find_fit(o, n, args.fit)
        if fit:
            bo = fit[0]
            res.framing = f"original mostra a tela em {bo[2] - bo[0]}x{bo[3] - bo[1]} em ({bo[0]},{bo[1]}) com borda preta; o nosso ocupa {W}x{H} (escala {W / (bo[2] - bo[0]):.2f})"
            res.notes.append(res.framing + " — comparado com o original reamostrado sobre a area do nosso (--fit none desliga)")
            o = apply_fit(o, fit)
            if seq:
                fo = [apply_fit(f, fit) for f in fo]
            mouse = mouse_n + [q for q in (fit_point(p, fit) for p in mouse_o) if q]
        regions, notes, st = analyze_pair(sid, o, n, args, mouse)
        res.notes += notes
        res.regions = regions
        res.ssim, res.diverge_pct, res.shift = st["ssim"], st["diverge_pct"], st["shift"]
        if s.get("roi"):
            x0, y0, x1, y1 = s["roi"]
            res.roi = (x0, y0, x1, y1)
            res.ssim_roi = float(ssim_map(gray(o), gray(n))[y0:y1, x0:x1].mean())
        mo = mn = None
        if seq:
            res.notes.append(f"sequencia: original {len(fo)} quadros, nosso {len(fn)} quadros (analise estatica sobre o quadro 000)")
            mregs, info = analyze_motion(sid, fo, fn, mouse)
            res.motion = info
            for r in mregs:
                r.severity = 100.0 * r.area * r.score * CAT_WEIGHT.get(r.category, 0.7) / (W * H) * 3  # animacao ausente pesa mais
                r.hint = code_hint(sid, r.bbox, r.category)
                if r.category.startswith("sem animacao") and sid.startswith("mission"):
                    r.hint = "game/src/mission/view.ts + game/src/mission/anim.ts (bloco 'ocioso' dos sprites; ver GAPS [MISSAO] layout dos sprites)"
            res.regions = sorted(regions + mregs, key=lambda r: -r.severity)
            for i, r in enumerate(res.regions, 1):
                r.n = i
            mo, _ = motion_map(fo)
            mn, _ = motion_map(fn)
        img = out / f"{sid}.png"
        render(res, o, st["n_shifted"], st["de"], img, mo, mn)
        res.image = img.name
        results.append(res)
    return results


def rel(p) -> str:
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return Path(p).as_posix()


# achados da captura nossa -> acao/arquivo
WARN_HINTS = [
    ("nao tematico", "aplicar o cursor tematico (`applyThemeCursor` de game/src/ui/cursor.ts) tambem nessas cenas; TownScene.ts poe `canvas.style.cursor = \"pointer\"/\"default\"` direto e os botoes Pixi usam `cursor = \"pointer\"` (cursor do Windows)"),
    ("tambem visivel", "na missao o Pixi (EventSystem) troca `canvas.style.cursor` para `inherit` ao mover o mouse, por cima do `none` posto em MissionScene.bindInput: definir `app.renderer.events.cursorStyles.default/pointer = \"none\"` durante a missao (game/src/scenes/MissionScene.ts)"),
    ("nada anima alem do cursor", "heroi/unidades sem animacao ociosa: game/src/mission/view.ts + game/src/mission/anim.ts (bloco 'ocioso' dos sprites)"),
]


def sev_label(v: float) -> str:
    return "ALTA" if v >= 1.0 else "media" if v >= 0.2 else "baixa"


def write_report(results: list[Result], args) -> Path:
    prov = load_provenance()
    out = Path(args.out)
    L = []
    now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    L.append("# Comparacao original x nosso")
    L.append("")
    L.append(f"Gerado por `tools/refcap/compare.py` em {now}. Original: `{rel(args.orig)}`; nosso: `{rel(args.ours)}`. "
             f"Parametros: shift={args.shift}, bloco={args.block}px, DeltaE>{args.de}, SSIM<{args.ssim}, area minima={args.min_area}px2.")
    L.append("Como ler: notes/compare.md. Gravidade = % da tela x intensidade x peso da categoria.")
    L.append("")
    missing = [r for r in results if r.status != "ok"]
    done = [r for r in results if r.status == "ok"]
    L.append(f"**Cenarios comparados:** {len(done)}/{len(results)}.")
    if missing:
        L.append("")
        L.append("**Sem referencia original** (rode a captura do original para eles): " + ", ".join(f"`{r.id}`" for r in missing if r.status == "sem-original"))
        other = [r for r in missing if r.status != "sem-original"]
        if other:
            L.append("")
            L.append("**Sem captura nossa:** " + ", ".join(f"`{r.id}` ({r.status})" for r in other))
    L.append("")
    allr = [(res, r) for res in done for r in res.regions]
    allr.sort(key=lambda t: -t[1].severity)
    L.append("## Sumario por gravidade")
    L.append("")
    if not allr:
        L.append("_(nenhuma divergencia — ou nenhum par comparado)_")
    else:
        L.append("| # | cenario | regiao | categoria | gravidade | caixa (x0,y0,x1,y1) | detalhe | codigo provavel |")
        L.append("|---|---|---|---|---|---|---|---|")
        for i, (res, r) in enumerate(allr[: args.top], 1):
            L.append(f"| {i} | `{res.id}` | {r.n} | {r.category} | {sev_label(r.severity)} ({r.severity:.2f}) | {r.bbox} | {r.detail} | {r.hint} |")
        if len(allr) > args.top:
            L.append(f"\n_{len(allr) - args.top} regioes menores omitidas do sumario (veja as secoes por cenario)._")
    L.append("")
    # itens acionaveis: agrupa por cenario/categoria
    L.append("## Itens acionaveis (automaticos)")
    L.append("")
    act = []
    for res, r in allr:
        if r.severity < args.action_min or r.category == "cursor":
            continue
        verb = {"extra no nosso": "REMOVER/trocar pelo bitmap original", "faltando no nosso": "ACRESCENTAR (existe no original)",
                "posicao deslocada": "REPOSICIONAR", "estilo/cor diferente": "TROCAR estilo/cor (usar o bitmap/paleta original)",
                "estilo/forma diferente": "TROCAR pelo elemento original", "sem animacao onde o original anima": "ANIMAR",
                "anima so no nosso": "PARAR animacao inexistente no original"}.get(r.category, r.category)
        act.append(f"- [{sev_label(r.severity)}] `{res.id}` regiao {r.n} {r.bbox}: **{verb}** — {r.detail}. Arquivo: {r.hint or '?'}")
    cur = [(res, r) for res, r in allr if r.category == "cursor"]
    if cur:
        act.append(f"- [baixa] cursor diferente em {len(cur)} cenario(s): " + ", ".join(sorted({f'`{res.id}`' for res, _ in cur})) +
                   " — conferir manualmente (a posicao do mouse pode diferir entre as capturas).")
    L += act or ["_(nenhum acima do limiar)_"]
    fr = [r for r in done if r.framing]
    if fr:
        L.append("")
        L.append("## Enquadramento (decisao de projeto, nao corrigida pelo comparador)")
        L.append("")
        L.append(f"- Em {len(fr)} cenario(s) ({', '.join(f'`{r.id}`' for r in fr)}) o original NAO amplia a tela: {fr[0].framing}. "
                 "O nosso amplia 1,6x (GAPS [MENUS]). As regioes acima foram medidas com o original reamostrado para a area do nosso. "
                 "Para replicar o original: desenhar essas cenas em 640x480 no centro de 1024x768 com fundo preto (game/src/scenes/*, town/common.ts).")
    # achados do proprio lado nosso (metadados da captura)
    warn = [(res.id, w) for res in results for w in res.ours_warnings]
    if warn:
        L.append("")
        L.append("## Achados da captura do nosso jogo (independem do original)")
        L.append("")
        grouped: dict[str, list[str]] = {}
        notes_art: dict[str, list[str]] = {}
        for sid, w in warn:
            key = re.sub(r'"[^"]*"', '"…"', w)
            (notes_art if "teleportado" in w else grouped).setdefault(key, []).append(sid)
        for k, ids in grouped.items():
            hint = next((h for pat, h in WARN_HINTS if pat in k), "")
            L.append(f"- {k}: " + ", ".join(f"`{i}`" for i in sorted(set(ids))) + (f". **Acao:** {hint}" if hint else ""))
        for k, ids in notes_art.items():
            L.append(f"- (nota, nao e divergencia) {k}: " + ", ".join(f"`{i}`" for i in sorted(set(ids))))
    L.append("")
    L.append("## Por cenario")
    for res in results:
        L.append("")
        L.append(f"### `{res.id}` — {res.desc}")
        L.append("")
        if res.status != "ok":
            L.append(f"_{res.status}_" + (f" — captura nossa: ![]({res.image})" if res.image else ""))
            continue
        L.append(f"SSIM medio {res.ssim:.3f}; {res.diverge_pct:.1f}% da tela divergente; deslocamento global {res.shift}."
                 + (f" **SSIM da interface (roi {res.roi}, sem deslocamento): {res.ssim_roi:.3f}.**" if res.ssim_roi is not None else ""))
        for nt in res.notes:
            L.append(f"- {nt}")
        L.append("")
        L.append(f"![{res.id}]({res.image})")
        L.append("")
        if res.regions:
            L.append("| # | categoria | gravidade | caixa | detalhe |")
            L.append("|---|---|---|---|---|")
            for r in res.regions[: args.per_scene]:
                L.append(f"| {r.n} | {r.category} | {r.severity:.2f} | {r.bbox} | {r.detail} |")
            if len(res.regions) > args.per_scene:
                L.append(f"\n_+{len(res.regions) - args.per_scene} regioes pequenas._")
        if res.motion:
            L.append("")
            L.append("Movimento (componentes animados): " + "; ".join(
                f"{m['lado']} {tuple(m['bbox'])} {m['quadros_distintos']} quadros distintos" for m in res.motion[:12]))
        files = sorted({r.hint.split(" ")[0] for r in res.regions if r.hint})
        cands = [(f, prov[f]) for f in files if f in prov and prov[f]]
        if cands:
            L.append("")
            L.append("Candidatos a elementos inventados nesses arquivos (docs/PROVENANCE.md): " + "; ".join(f"`{f}` ({len(c)})" for f, c in cands))
    p = out / "report.md"
    p.write_text("\n".join(L) + "\n", encoding="utf8")
    js = [{"id": r.id, "status": r.status, "ssim": r.ssim, "ssim_roi": r.ssim_roi, "roi": r.roi, "diverge_pct": r.diverge_pct, "shift": r.shift, "notes": r.notes,
           "ours_warnings": r.ours_warnings, "motion": r.motion,
           "regions": [{"n": g.n, "bbox": g.bbox, "area": g.area, "category": g.category, "severity": round(g.severity, 4), "detail": g.detail, "hint": g.hint} for g in r.regions]}
          for r in results]
    (out / "report.json").write_text(json.dumps(js, indent=1, ensure_ascii=False, default=lambda v: v.item() if hasattr(v, "item") else str(v)), encoding="utf8")
    return p


def parse(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default=None)
    ap.add_argument("--scenarios", default=str(ROOT / "tools/refcap/scenarios.json"))
    ap.add_argument("--orig", default=str(ROOT / "refs/original"))
    ap.add_argument("--ours", default=str(ROOT / "refs/ours"))
    ap.add_argument("--out", default=str(ROOT / "docs/COMPARE"))
    ap.add_argument("--fit", choices=["auto", "none"], default="auto", help="auto: se o original e uma tela menor centralizada (640x480) e o nosso ocupa tudo, reamostra o original")
    ap.add_argument("--shift", type=int, default=8, help="busca de deslocamento global (px); 0 desliga")
    ap.add_argument("--block", type=int, default=4)
    ap.add_argument("--de", type=float, default=12.0, help="Delta E medio por bloco para divergir")
    ap.add_argument("--ssim", type=float, default=0.55, help="SSIM medio por bloco abaixo do qual diverge")
    ap.add_argument("--merge", type=int, default=12, help="une regioes a ate N px uma da outra")
    ap.add_argument("--min-area", type=int, default=48, help="area minima (px2) de nucleo divergente por regiao")
    ap.add_argument("--top", type=int, default=60)
    ap.add_argument("--per-scene", type=int, default=25)
    ap.add_argument("--action-min", type=float, default=0.05, help="gravidade minima para virar item acionavel")
    ap.add_argument("--render-missing", action="store_true", help="gera a imagem so com o nosso lado quando falta o original")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse(argv)
    results = run(args)
    rep = write_report(results, args)
    miss = [r.id for r in results if r.status == "sem-original"]
    if miss:
        print(f"[aviso] {len(miss)} cenario(s) sem referencia original em {args.orig}: {', '.join(miss)}", file=sys.stderr)
    other = [f"{r.id}({r.status})" for r in results if r.status not in ("ok", "sem-original")]
    if other:
        print(f"[aviso] sem captura nossa: {', '.join(other)}", file=sys.stderr)
    for r in results:
        if r.status == "ok":
            top = ", ".join(f"{g.n}:{g.category}({g.severity:.2f})" for g in r.regions[:4])
            print(f"[ok] {r.id}: SSIM {r.ssim:.3f}, {r.diverge_pct:.1f}% divergente, {len(r.regions)} regioes  {top}")
    print(f"[relatorio] {rep}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
