"""Pipeline das animações do mundo da missão (frente MOTOR-B).

Saídas em game/public/assets/ui/hud/anim/ (pasta das animações da missão):
  unit_<ID>.png / hero_<arma>.png      atlas INDEXADO (PNG 8 bits + tRNS) com todos os quadros do tipo de unidade
  unit_<ID>_b.png / hero_<arma>_b.png  camada B ("spritesb": contorno de suavização, desenhada a 50% — opção Smoothing)
  units.json                           layout das animações + `palettes` (variantes por nível: paletteN.pal do monstro)
  world/obj_<arquivo>.png [+ _b]       atlas de cada arquivo de objeto de cenário (objects.reg Files)
  world/st_<ID>.png [+ _b]             faixa com as fases montadas de cada estrutura (+ quadro "destruída" no fim)
  world/pr_<nome>.webp                 atlas de cada projétil/efeito (.16a com alfa, ou .256 de flecha com projectiles.pal)
  world/world.json                     {"objects": {...}, "objectFiles": {...}, "structures": {...}, "projectiles": {...}}

O que foi decifrado/confirmado (ver docs/GAPS.md, frente MOTOR-B):
  * unidade de tempo das animações (objects.reg AnimationTime, units.reg *AnimTime, structures.reg AnimTime) = 1/16 s:
    as árvores da captura do original (refs/original/mission10_idle_*) trocam de quadro a cada 250 ms com AnimationTime 4.
  * camada B (`sprites b.256`, paleta toda preta no arquivo): índices da paleta do sprite principal, desenhados por cima
    com alfa 0,5 (UnityAllods MapViewUnit/Obstacle/Structure: "SpritesBEnabled" = opção Smoothing).
  * estruturas (UnityAllods MapViewStructure): quadros 0..n-1 = tiles da fase 0 (n = TileWidth×FullHeight, em linhas);
    depois, para cada fase p ≥ 1, um bloco com só os tiles marcados '+' em AnimMask (na ordem); por fim, nas destrutíveis,
    n tiles da versão destruída. Estrutura 1×1 animada: quadro = fase.
  * unidades: rotação (16 ou 9 espelhadas), mover (MoveBegin+Move), atacar, morrer, ossos e — no FIM do arquivo — ocioso.
    MoveBegin não é animado (o laço começa depois dele). Conferido nos 77 tipos (os 2 que não fechavam: ver layout()).
  * paletas de monstro: monsters/<x>/palette.pal (= a embutida), palette2..5.pal; usamos paletteN para o nível N do
    template (hipótese: 5 níveis × 5 paletas; o UnityAllods escolhe pela "face").

Uso: .venv/Scripts/python.exe tools/pipeline/anim_world.py [--extracted <pasta>] [--only units|objects|structures|projectiles]
"""
import base64
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import reg  # noqa: E402
import sprites  # noqa: E402

PUB = os.path.join(ROOT, "game", "public")
ANIM = os.path.join(PUB, "assets", "ui", "hud", "anim")
WORLD = os.path.join(ANIM, "world")
EXT_DEFAULT = r"C:\Users\TALES K\Games\allods2-extracted"

_cache = {}


def read(path, palette=None):
    key = (path, id(palette))
    if key not in _cache:
        _cache[key] = sprites.read_sprite(path, palette)
    return _cache[key]


def b_path(path):
    """Arquivo da camada B ao lado do principal (sprites.256 -> spritesb.256, house.256 -> houseb.256)."""
    root, ext = os.path.splitext(path)
    p = root + "b" + ext
    return p if os.path.exists(p) else None


def idx_array(fr):
    """Quadro .256 -> (índices uint8, máscara de opacidade)."""
    w, h, rows = fr
    if not h or not w:
        return np.zeros((max(1, h), max(1, w)), np.uint8), np.zeros((max(1, h), max(1, w)), bool)
    v = np.array([[-1 if p is None else p for p in row] for row in rows], np.int32).reshape(h, w)
    m = v >= 0
    return np.where(m, v, 0).astype(np.uint8), m


def rgba_array(fr, pal, wide):
    w, h, rows = fr
    return np.array(sprites.to_rgba(rows, pal, wide, "idx_alpha", True), np.uint8).reshape(h, w, 4)


def pal_rgb(pal):
    """Paleta do arquivo (B,G,R) -> lista plana R,G,B."""
    out = []
    for c in pal:
        out += [c[2], c[1], c[0]]
    return out


def save_indexed(cells, pal, cw, ch, cols, out_png):
    """cells = lista de (índices, máscara) já do tamanho da célula ou menores (centralizados). Grava PNG 8 bits com um índice
    livre como transparente. Devolve o índice transparente (ou None se gravou RGBA porque a paleta estava cheia)."""
    rows = (len(cells) + cols - 1) // cols
    idx = np.zeros((rows * ch, cols * cw), np.uint8)
    msk = np.zeros((rows * ch, cols * cw), bool)
    for i, (a, m) in enumerate(cells):
        h, w = a.shape
        x0 = (i % cols) * cw + (cw - w) // 2
        y0 = (i // cols) * ch + (ch - h) // 2
        sub = idx[y0:y0 + h, x0:x0 + w]
        sm = msk[y0:y0 + h, x0:x0 + w]
        sub[m] = a[m]
        sm |= m
    used = set(np.unique(idx[msk]).tolist())
    free = [i for i in range(256) if i not in used]
    rgb = pal_rgb(pal)
    if not free:
        # paleta cheia: RGBA comum (sem troca de paleta)
        img = np.zeros((rows * ch, cols * cw, 4), np.uint8)
        p = np.array(rgb, np.uint8).reshape(256, 3)
        img[..., :3] = p[idx]
        img[..., 3] = np.where(msk, 255, 0)
        Image.fromarray(img, "RGBA").save(out_png, optimize=True)
        return None
    t = free[-1]
    idx[~msk] = t
    im = Image.fromarray(idx, "P")
    im.putpalette(rgb)
    # sem optimize: o PNG precisa manter a paleta inteira e na ordem (o cliente troca o PLTE para as variantes)
    im.save(out_png, transparency=t, compress_level=9)
    return t


def cell_size(frames_list):
    cw = max(f[0] for fl in frames_list for f in fl)
    ch = max(f[1] for fl in frames_list for f in fl)
    return cw, ch


def cols_for(n, cw):
    return max(1, min(n, 4096 // cw, 24))


def pal_b64(pal):
    return base64.b64encode(bytes(pal_rgb(pal))).decode("ascii")


# ----------------------------------------------------------------------------------------------------------- unidades
FIELDS = ("MoveBeginPhases", "MovePhases", "AttackPhases", "DyingPhases", "BonePhases", "IdlePhases",
          "MoveAnimTime", "MoveAnimFrame", "AttackAnimTime", "AttackAnimFrame", "IdleAnimTime", "IdleAnimFrame",
          "Width", "Height", "CenterX", "CenterY", "SelectionX1", "SelectionX2", "SelectionY1", "SelectionY2",
          "Flip", "Z", "TileSize", "Sound", "AttackDelay", "ShootDelay", "Projectile", "ShootOffset", "InfoPicture", "Dying", "Palette")


def layout(u, n):
    """Blocos de animação (ordem do arquivo: rotação, mover, atacar, morrer, ossos, ocioso) para `n` quadros.
    Correções: tipo sem Flip no .reg cujo arquivo é espelhado (ID 2 usa o arquivo do ID 1 → tenta o outro espelhamento);
    número de fases de morte diferente do .reg (ovelha: DyingPhases 4, arquivo 5) → deduz a morte pelo resto."""
    def attempt(flip, dying=None, drop=False):
        static, dirs = (9, 5) if flip else (16, 8)
        mb, mv = u.get("MoveBeginPhases", 0) or 0, u.get("MovePhases", 0) or 0
        at = u.get("AttackPhases", 0) or 0
        dy = u.get("DyingPhases", 0) or 0 if dying is None else dying
        bo, idl = u.get("BonePhases", 0) or 0, u.get("IdlePhases", 0) or 0
        if drop:
            dy = bo = 0
        order = [("move", mb + mv), ("attack", at), ("dying", dy), ("bones", bo), ("idle", idl)]
        if static + dirs * sum(p for _, p in order) != n:
            return None
        blocks, pos = {}, static
        for name, ph in order:
            if ph:
                blocks[name] = {"start": pos, "phases": ph}
            pos += dirs * ph
        if "move" in blocks:
            blocks["move"]["begin"] = mb
        return {"flip": flip, "staticDirs": static, "dirs": dirs, "blocks": blocks}

    flip = bool(u.get("Flip"))
    for f in (flip, not flip):
        r = attempt(f) or attempt(f, drop=True)
        if r:
            if f != flip:
                r["flipFix"] = True
            return r
    # morte com outra quantidade de fases
    for f in (flip, not flip):
        static, dirs = (9, 5) if f else (16, 8)
        rest = (n - static) / dirs - sum(u.get(k, 0) or 0 for k in ("MoveBeginPhases", "MovePhases", "AttackPhases", "BonePhases", "IdlePhases"))
        if rest == int(rest) and 0 < rest <= 12:
            r = attempt(f, dying=int(rest))
            if r:
                r["dyingFix"] = int(rest)
                return r
    return None


def unit_palettes(sprite_path, pal):
    """Variantes de paleta do diretório do monstro: {nível: base64(RGB)} para palette2..N.pal que diferem da embutida."""
    d = os.path.dirname(sprite_path)
    out = {}
    for k in range(2, 10):
        p = os.path.join(d, "palette%d.pal" % k)
        if os.path.exists(p):
            vp = sprites.bmp_palette(p)
            if vp != list(pal):
                out[str(k)] = pal_b64(vp)
    return out


def export_unit_file(path, out_name, base_meta, table_key, table):
    pal, frames, wide = read(path)
    bp = b_path(path)
    fb = read(bp)[1] if bp else None
    if fb is not None and len(fb) != len(frames):
        fb = None
    cw, ch = cell_size([frames] + ([fb] if fb else []))
    cols = cols_for(len(frames), cw)
    t = save_indexed([idx_array(f) for f in frames], pal, cw, ch, cols, os.path.join(ANIM, out_name + ".png"))
    meta = dict(base_meta, image=out_name + ".png", cellW=cw, cellH=ch, cols=cols, count=len(frames))
    if fb:
        save_indexed([idx_array(f) for f in fb], pal, cw, ch, cols, os.path.join(ANIM, out_name + "_b.png"))
        meta["imageB"] = out_name + "_b.png"
    if t is not None:
        meta["transparent"] = t
    pals = unit_palettes(path, pal)
    if pals and t is not None:
        meta["palettes"] = pals
    table[table_key] = meta
    return meta


def export_units(ext):
    base = os.path.join(ext, "graphics", "units")
    tree, _ = reg.parse(open(os.path.join(base, "units.reg"), "rb").read())
    files = tree["Files"]
    by_id = {u["ID"]: u for k, u in tree.items() if k.startswith("Unit") and isinstance(u, dict) and "ID" in u}

    def resolved(u):
        out = {}
        if u.get("Parent") in by_id and by_id[u["Parent"]] is not u:
            out.update(resolved(by_id[u["Parent"]]))
        out.update({k: v for k, v in u.items() if v != ""})
        return out

    os.makedirs(ANIM, exist_ok=True)
    table, bad = {}, []
    for uid, raw in sorted(by_id.items()):
        u = resolved(raw)
        rel = files["File%d" % u["File"]].replace("\\", "/") + ".256"
        path = os.path.join(base, rel)
        try:
            n = len(read(path)[1])
        except Exception as e:  # noqa: BLE001
            bad.append((uid, rel, str(e)))
            continue
        lay = layout(u, n)
        if lay is None:
            bad.append((uid, rel, "contagem %d não fecha" % n))
            lay = {"flip": bool(u.get("Flip")), "staticDirs": 9 if u.get("Flip") else 16, "dirs": 5 if u.get("Flip") else 8, "blocks": {}}
        fix = {k: lay.pop(k) for k in ("flipFix", "dyingFix") if k in lay}
        meta = dict(name=u.get("DescText", ""), file=rel, **lay, **{k: u[k] for k in FIELDS if k in u})
        if "dyingFix" in fix:
            meta["DyingPhases"] = fix["dyingFix"]
        if fix:
            meta["layoutFix"] = fix
        export_unit_file(path, "unit_%d" % uid, meta, str(uid), table)
        print("unidade", uid, u.get("DescText"), n, "quadros", "ok" if lay["blocks"] else "SEM LAYOUT", fix or "")
    # heróis (o jogador): graphics/units/heroes/<arma>/sprites.256, parâmetros do "Human Swordsman" (ID 3)
    base_h = by_id[3]
    for weapon in sorted(os.listdir(os.path.join(base, "heroes"))):
        path = os.path.join(base, "heroes", weapon, "sprites.256")
        if not os.path.exists(path):
            continue
        n = len(read(path)[1])
        u = dict(resolved(base_h))
        u.pop("DyingPhases", None)
        u.pop("BonePhases", None)
        if (n - 16) % 8 and (n - 9) % 5 == 0 and 1 in by_id:
            # heroes/unarmed (129 quadros) = layout espelhado do "Unarmed Fighter" (ID 1)
            u = dict(resolved(by_id[1]))
            lay = layout(u, n) or {"flip": True, "staticDirs": 9, "dirs": 5, "blocks": {}}
        else:
            rest = (n - 16) // 8 - u["MoveBeginPhases"] - u["MovePhases"]
            if rest > 9:
                # mago com cajado (mage_st, 216 quadros): atacar 6 + morrer 6 + ossos 3, como o "Human Mage" (ID 24)
                u["DyingPhases"], u["BonePhases"] = 6, 3
                rest -= 9
            u["AttackPhases"] = rest
            # tempos do humano com a mesma arma quando a contagem de fases bate (ex.: arqueiro [2,3,3,2,2,2,6,3,2])
            twin = {"archer": 14, "xbowman": 15, "pikeman": 12, "pikeman_": 13, "axeman": 7, "axeman_": 8, "axeman2h": 9,
                    "clubman": 10, "clubman_": 11, "swordsman": 3, "swordsman_": 4, "swordsman2h": 5, "mage": 23, "mage_st": 24}.get(weapon)
            tw = resolved(by_id[twin]) if twin in by_id else {}
            if isinstance(tw.get("AttackAnimTime"), list) and len(tw["AttackAnimTime"]) == rest:
                u["AttackAnimFrame"], u["AttackAnimTime"] = tw.get("AttackAnimFrame") or list(range(rest)), tw["AttackAnimTime"]
            else:
                u["AttackAnimFrame"], u["AttackAnimTime"] = list(range(rest)), [2] * rest
            lay = layout(u, n) or {"flip": False, "staticDirs": 16, "dirs": 8, "blocks": {}}
        lay.pop("flipFix", None)
        lay.pop("dyingFix", None)
        meta = dict(name="Hero " + weapon, file="heroes/%s/sprites.256" % weapon, **lay, **{k: u[k] for k in FIELDS if k in u})
        export_unit_file(path, "hero_" + weapon, meta, "hero_" + weapon, table)
        print("herói", weapon, n, "ok" if lay["blocks"] else "SEM LAYOUT")
    with open(os.path.join(ANIM, "units.json"), "w", encoding="utf-8") as fh:
        json.dump(table, fh, separators=(",", ":"))
    print("animações:", len(table), "problemas:", bad)


# ------------------------------------------------------------------------------------------------- objetos de cenário
def export_objects(ext, world):
    base = os.path.join(ext, "graphics", "objects")
    tree, _ = reg.parse(open(os.path.join(base, "objects.reg"), "rb").read())
    files = tree["Files"]
    by_id = {o["ID"]: o for k, o in tree.items() if k.startswith("Object") and isinstance(o, dict) and "ID" in o}

    def resolved(o, depth=0):
        out = {}
        p = o.get("Parent")
        if p in by_id and by_id[p] is not o and depth < 8:
            out.update(resolved(by_id[p], depth + 1))
        out.update({k: v for k, v in o.items() if v != "" and k != "Parent"})
        return out

    os.makedirs(WORLD, exist_ok=True)
    objs, ofiles = {}, {}
    for oid, raw in sorted(by_id.items()):
        o = resolved(raw)
        if "File" not in o:
            continue
        fidx = o["File"]
        rel = files.get("File%d" % fidx)
        if not rel:
            continue
        path = os.path.join(base, rel.replace("\\", "/") + ".256")
        if not os.path.exists(path):
            continue
        try:
            pal, frames, wide = read(path)
        except Exception as e:  # noqa: BLE001
            print("objeto", oid, rel, e)
            continue
        if str(fidx) not in ofiles:
            bp = b_path(path)
            fb = read(bp)[1] if bp else None
            if fb is not None and len(fb) != len(frames):
                fb = None
            cw, ch = cell_size([frames] + ([fb] if fb else []))
            cols = cols_for(len(frames), cw)
            name = "obj_%d" % fidx
            t = save_indexed([idx_array(f) for f in frames], pal, cw, ch, cols, os.path.join(WORLD, name + ".png"))
            entry = {"image": name + ".png", "cw": cw, "ch": ch, "cols": cols, "count": len(frames), "src": rel,
                     "sizes": [[f[0], f[1]] for f in frames]}
            if fb:
                save_indexed([idx_array(f) for f in fb], pal, cw, ch, cols, os.path.join(WORLD, name + "_b.png"))
                entry["imageB"] = name + "_b.png"
            if t is None:
                entry["rgba"] = True
            ofiles[str(fidx)] = entry
        fe = ofiles[str(fidx)]
        index = o.get("Index", 0) or 0
        af, at = o.get("AnimationFrame"), o.get("AnimationTime")
        if isinstance(af, list) and af and isinstance(at, list):
            seq = [min(fe["count"] - 1, index + f) for f in af]
            times = [max(1, at[i] if i < len(at) else at[-1]) for i in range(len(af))]
        else:
            seq, times = [min(fe["count"] - 1, index)], []
        w, h = fe["sizes"][seq[0]]
        ox, oy = (fe["cw"] - w) // 2, (fe["ch"] - h) // 2
        if (w, h) == (o.get("Width"), o.get("Height")) and "CenterX" in o:
            ax, ay = ox + o["CenterX"], oy + o["CenterY"]
        else:
            # recorte sem deslocamento (ex.: cactos mortos): base no centro da célula + 12 px (como o visualizador antigo)
            ax, ay = ox + w // 2, oy + h - 12
        objs[str(oid)] = {"name": o.get("DescText", ""), "file": fidx, "frames": seq, "times": times, "ax": ax, "ay": ay}
    world["objects"] = objs
    world["objectFiles"] = ofiles
    print("objetos:", len(objs), "arquivos:", len(ofiles), "animados:", sum(1 for v in objs.values() if len(v["frames"]) > 1))


# -------------------------------------------------------------------------------------------------------- estruturas
def compose_structure(frames, tw, fh, mask, phase, dead):
    """Índices/máscara (fh*32 × tw*32) da estrutura numa fase (regra do UnityAllods MapViewStructure)."""
    n = tw * fh
    A = mask.count("+")
    H, W = fh * 32, tw * 32
    idx = np.zeros((H, W), np.uint8)
    msk = np.zeros((H, W), bool)
    for i in range(n):
        if dead:
            k = len(frames) - n + i
        elif phase > 0 and i < len(mask) and mask[i] == "+":
            k = n + A * (phase - 1) + mask[:i].count("+")
        else:
            k = i
        if k >= len(frames):
            k = i
        a, m = idx_array(frames[k])
        h, w = a.shape
        x0, y0 = (i % tw) * 32, (i // tw) * 32
        h2, w2 = min(h, H - y0), min(w, W - x0)
        sub, sm = idx[y0:y0 + h2, x0:x0 + w2], msk[y0:y0 + h2, x0:x0 + w2]
        mm = m[:h2, :w2]
        sub[mm] = a[:h2, :w2][mm]
        sm |= mm
    return idx, msk


def export_structures(ext, world):
    base = os.path.join(ext, "graphics", "structures")
    tree, _ = reg.parse(open(os.path.join(base, "structures.reg"), "rb").read())
    out = {}
    for key, s in tree.items():
        if not key.startswith("Structure") or "ID" not in s:
            continue
        sid = s["ID"]
        path = os.path.join(base, s["File"].replace("\\", "/") + ".256")
        try:
            pal, frames, wide = read(path)
        except Exception as e:  # noqa: BLE001
            print("estrutura", sid, e)
            continue
        tw, fh = s.get("TileWidth", 1) or 1, s.get("FullHeight", s.get("TileHeight", 1)) or 1
        n = tw * fh
        mask = s.get("AnimMask") or ""
        ph = s.get("Phases", 1) or 1
        A = mask.count("+")
        if tw == 1 and fh == 1 and A:
            # 1×1 animada (fogueira): quadro = fase
            nph = min(ph, len(frames))
            images = [idx_array(frames[p]) for p in range(nph)]
            images = [(a, m) for a, m in images]
            dead_i = -1
        else:
            nph = ph if A and len(frames) >= n + A * (ph - 1) else 1
            images = [compose_structure(frames, tw, fh, mask, p, False) for p in range(nph)]
            has_dead = len(frames) == n + A * max(0, ph - 1) + n and not s.get("Indestructible")
            dead_i = -1
            if has_dead:
                images.append(compose_structure(frames, tw, fh, mask, 0, True))
                dead_i = len(images) - 1
        W = max(a.shape[1] for a, _ in images)
        H = max(a.shape[0] for a, _ in images)
        name = "st_%d" % sid
        t = save_indexed(images, pal, W, H, len(images), os.path.join(WORLD, name + ".png"))
        entry = {"name": s.get("DescText", ""), "image": name + ".png", "w": W, "h": H, "count": len(images), "tw": tw,
                 "th": s.get("TileHeight", 1) or 1, "fh": fh, "dead": dead_i, "shadowY": s.get("ShadowY", 0),
                 "flat": bool(s.get("Flat")), "light": s.get("LightRadius", 0)}
        bp = b_path(path)
        if bp:
            try:
                fb = read(bp)[1]
                if len(fb) == len(frames):
                    if tw == 1 and fh == 1 and A:
                        bim = [idx_array(fb[p]) for p in range(nph)]
                    else:
                        bim = [compose_structure(fb, tw, fh, mask, p, False) for p in range(nph)]
                        if dead_i >= 0:
                            bim.append(compose_structure(fb, tw, fh, mask, 0, True))
                    save_indexed(bim, pal, W, H, len(bim), os.path.join(WORLD, name + "_b.png"))
                    entry["imageB"] = name + "_b.png"
            except Exception as e:  # noqa: BLE001
                print("estrutura B", sid, e)
        af, at = s.get("AnimFrame"), s.get("AnimTime")
        if nph > 1 and isinstance(af, list) and af:
            entry["frames"] = [min(nph - 1, f) for f in af]
            entry["times"] = [max(1, at[i] if isinstance(at, list) and i < len(at) else 2) for i in range(len(af))]
        out[str(sid)] = entry
    world["structures"] = out
    print("estruturas:", len(out), "animadas:", sum(1 for v in out.values() if v.get("frames")))


# ----------------------------------------------------------------------------------------------- projéteis e efeitos
#: efeitos sem entrada no projectiles.reg (usados como impacto/fumaça); nome -> (arquivo, fases)
EXTRA_FX = {"smallxpl": ("smallxpl/sprites.16a", 11), "smoke0": ("smoke0/sprites.16a", 6), "smoke1": ("smoke1/sprites.16a", 6),
            "diamonddust": ("diamonddust/sprites.16a", 5), "freeze": ("freeze/sprites.16a", 15)}


def export_projectiles(ext, world):
    base = os.path.join(ext, "graphics", "projectiles")
    tree, _ = reg.parse(open(os.path.join(base, "projectiles.reg"), "rb").read())
    ppal = sprites.bmp_palette(os.path.join(base, "projectiles.pal"))
    items = []
    for key, p in tree.items():
        if not key.startswith("Projectile") or "ID" not in p:
            continue
        f = p["File"].replace("\\", "/").lower()
        rel = f + (".16a" if p.get("A16") else ".256")
        if not os.path.exists(os.path.join(base, rel)):
            alt = f + (".256" if p.get("A16") else ".16a")
            rel = alt if os.path.exists(os.path.join(base, alt)) else rel
        items.append((str(p["ID"]), rel, p))
    for name, (rel, ph) in EXTRA_FX.items():
        items.append((name, rel, {"Phases": ph, "A16": 1, "RotationPhases": 1}))
    out = {}
    for pid, rel, p in items:
        path = os.path.join(base, rel)
        if not os.path.exists(path):
            print("projétil sem arquivo", pid, rel)
            continue
        pal, frames, wide = read(path)
        if pal == sprites.GRAY:
            pal, frames, wide = read(path, ppal)
        cw, ch = cell_size([frames])
        cols = cols_for(len(frames), cw)
        rows = (len(frames) + cols - 1) // cols
        img = Image.new("RGBA", (cols * cw, rows * ch))
        for i, fr in enumerate(frames):
            t = Image.fromarray(rgba_array(fr, pal, wide), "RGBA")
            img.alpha_composite(t, ((i % cols) * cw + (cw - fr[0]) // 2, (i // cols) * ch + (ch - fr[1]) // 2))
        name = "pr_%s" % pid
        img.save(os.path.join(WORLD, name + ".webp"), "WEBP", lossless=True, method=6, quality=100)
        phases = max(1, min(len(frames), p.get("Phases", 1) or 1))
        dirs = max(1, len(frames) // phases)
        out[pid] = {"image": name + ".webp", "cw": cw, "ch": ch, "cols": cols, "count": len(frames), "phases": phases,
                    "dirs": dirs, "homing": bool(p.get("Homing")), "sfx": bool(p.get("SFX")), "src": rel}
    world["projectiles"] = out
    print("projéteis/efeitos:", len(out))


def main():
    a = sys.argv[1:]
    ext = a[a.index("--extracted") + 1] if "--extracted" in a else EXT_DEFAULT
    only = a[a.index("--only") + 1] if "--only" in a else None
    if only in (None, "units"):
        export_units(ext)
    os.makedirs(WORLD, exist_ok=True)
    wj = os.path.join(WORLD, "world.json")
    world = json.load(open(wj, encoding="utf-8")) if os.path.exists(wj) else {}
    world.pop("t", None)
    if only in (None, "objects"):
        export_objects(ext, world)
    if only in (None, "structures"):
        export_structures(ext, world)
    if only in (None, "projectiles"):
        export_projectiles(ext, world)
    world["note"] = ("tempos em 1/16 s (ms = t*62,5); objetos: ancora (ax, ay) na célula do atlas do arquivo, quadro = frames[k]; "
                     "estruturas: faixa de fases (count) + dead = índice do quadro destruído (-1 = não há); projéteis: dirs×phases "
                     "(dirs 9 = 16 sentidos com espelho, 16 = 16 sentidos, 1 = sem rotação), quadro = dir*phases + fase")
    with open(wj, "w", encoding="utf-8") as fh:
        json.dump(world, fh, separators=(",", ":"))


if __name__ == "__main__":
    main()
