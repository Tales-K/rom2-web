"""Pipeline da frente MENUS: converte os bitmaps do menu principal, da criacao de personagem, a fonte e o cursor
para PNG em game/public/assets/ui/{menu,chargen,fonts}/ (reexecutavel).

Uso:  .venv/Scripts/python.exe tools/pipeline/menu.py [--only menu,chargen,fonts] [--src <extraido>]

Origem (somente leitura): C:/Users/TALES K/Games/allods2-extracted
  main/graphics/mainmenu/*.bmp         menu principal (640x480)
  graphics/interface/chrgen/**         criacao de personagem
  graphics/font4/font4.16a + .dat      fonte alfa (Times 16px)  -> font4*.fnt/png (BitmapFont do PixiJS)
  graphics/cursors/default             cursor

Como o jogo marca a transparencia: os BMP sao RGB opacos; cada tela tem uma "mascara" 8 bits (menumask.bmp, precreate/mask.bmp,
fighter/mask.bmp, mag/mask.bmp) cujos valores identificam as regioes clicaveis. As imagens de botao/estado (button1.bmp, h1on.bmp,
on.bmp, shine_on.bmp...) sao retangulos que so valem dentro da regiao da mascara; o fundo (menu_.bmp, mainarea.bmp, column.bmp)
traz o estado "normal". Aqui a mascara vira o canal alfa (suavizado) de cada estado.

Escala: o allods2.exe em 1024x768 NAO amplia o menu nem a criacao de personagem: desenha a arte 640x480 em tamanho natural
no centro da tela (borda preta). Por isso a saida padrao e em escala 1,0 (pixel a pixel, posicoes em coordenadas 640x480
em menu.json / chargen.json) e o jogo monta tudo num contenedor 640x480 centralizado (game/src/ui/frame640.ts, UI_SCALE).
`--scale 1.6` ainda gera a versao reamostrada (bicubico) para quem preferir a tela ampliada com qualidade de pipeline
(o campo "scale" dos JSON registra a escala usada; as cenas dividem as posicoes por ele).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "pipeline"))
import sprites  # noqa: E402
from imgout import save_img  # noqa: E402

SRC = Path("C:/Users/TALES K/Games/allods2-extracted")
OUT = ROOT / "game" / "public" / "assets" / "ui"
S = 1.0
PRESS_OFFSET = (1, 2)   # deslocamento do bitmap pressionado do menu principal (ver build_menu)
CHR = "graphics/interface/chrgen/"


# ------------------------------------------------------------------ utilitarios

def sx(v):
    """coordenada 640x480 -> coordenada de saida (identidade em escala 1,0)"""
    return int(round(v * S))


def load_rgb(p):
    return Image.open(SRC / p).convert("RGB")


def scaled(img, x, y):
    """Reamostra `img` (colocada em x,y no espaco 640x480) pela escala S; devolve (img, X, Y). Em S = 1 e uma copia exata."""
    x0, y0 = sx(x), sx(y)
    x1, y1 = sx(x + img.width), sx(y + img.height)
    if (x1 - x0, y1 - y0) == img.size:
        return img.copy(), x0, y0
    return img.resize((x1 - x0, y1 - y0), Image.BICUBIC), x0, y0


def save(img, path, kind="auto"):
    """Grava em WebP (ou PNG para mascaras/cursor); ver imgout.py. A extensao pedida e trocada conforme a politica.
    Em escala 1,0 tudo e sem perda: a compressao com perda deixava diferencas visiveis (ate 100 niveis) nos vitrais."""
    if S == 1 and kind in ("auto", "overlay"):
        kind = "lossless"
    if S == 1 and img.mode in ("RGB", "RGBA") and kind != "png":
        img = q565(img)
    return save_img(img, path, kind)


def q565(img):
    """Cores como o original as mostra: o jogo roda em 16 bits (RGB565) e a captura expande cada canal replicando os bits
    (ex.: 23/31 -> 189). Sem isso os fundos quase pretos (1..7) ficam 'nao pretos' e o comparador acusa diferencas."""
    a = np.asarray(img).copy()
    for c, bits in ((0, 5), (1, 6), (2, 5)):
        v = a[..., c].astype(np.uint16) >> (8 - bits)
        a[..., c] = ((v * 255 + ((1 << bits) - 1) // 2) // ((1 << bits) - 1)).astype(np.uint8)
    return Image.fromarray(a, img.mode)


def region_alpha(mask_arr, ids, x, y, w, h, blur=0.7):
    """Alfa (L) do retangulo (x,y,w,h) = pixels da mascara cujo valor esta em `ids`, levemente suavizado."""
    full = np.zeros(mask_arr.shape, dtype=np.uint8)
    for i in ids:
        full[mask_arr == i] = 255
    a = Image.fromarray(full, "L")
    if blur and S != 1:          # em escala 1,0 a borda e dura, como o original (copia o bitmap so dentro da mascara)
        a = a.filter(ImageFilter.GaussianBlur(blur))
    return a.crop((x, y, x + w, y + h))


def layer(img_rgb, alpha_l, x, y):
    """RGBA 640 com o retangulo img_rgb em (x,y) e o alfa dado (tamanho do retangulo); devolve (rgba1024, X, Y)."""
    rgba = img_rgb.convert("RGBA")
    rgba.putalpha(alpha_l)
    return scaled(rgba, x, y)


def hitmap(mask_arr, mapping, size=None):
    """PNG 'L' com ids pequenos (1..n) no lugar dos valores da mascara; em 1024x768 (vizinho mais proximo)."""
    out = np.zeros(mask_arr.shape, dtype=np.uint8)
    for val, ident in mapping.items():
        out[mask_arr == val] = ident
    im = Image.fromarray(out, "L")
    w, h = size or (sx(mask_arr.shape[1]), sx(mask_arr.shape[0]))
    return im.resize((w, h), Image.NEAREST)


# ------------------------------------------------------------------ menu principal

MENU_LABELS = ["new_game", "multiplayer", "cut_scenes", "credits", "load_game", "server", "hall_of_fame", "exit"]


def build_menu():
    d = OUT / "menu"
    R = "main/graphics/mainmenu/"
    bg = load_rgb(R + "menu_.bmp")
    mask = np.array(Image.open(SRC / R / "menumask.bmp").convert("L"))
    bgg = np.array(bg.convert("L")).astype(float)
    save(scaled(bg, 0, 0)[0], d / "bg.webp")
    meta = {"scale": S, "label": None, "buttons": []}

    for i in range(1, 9):
        val = 128 + 16 * (i - 1)
        ys, xs = np.where(mask == val)
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        entry = {"id": i, "name": MENU_LABELS[i - 1]}
        for suffix, key in (("", "hover"), ("p", "pressed")):
            im = load_rgb(f"{R}button{i}{suffix}.bmp")
            a = np.array(im.convert("L")).astype(float)
            h, w = a.shape
            best = None   # posicao do bitmap: correlacao com o fundo apenas dentro da regiao da mascara
            for y in range(max(0, by0 - 8), min(480 - h, by0 + 8) + 1):
                for x in range(max(0, bx0 - 8), min(640 - w, bx0 + 8) + 1):
                    m = mask[y:y + h, x:x + w] == val
                    p, q = bgg[y:y + h, x:x + w][m], a[m]
                    if p.std() < 1e-6 or q.std() < 1e-6:
                        continue
                    r = np.corrcoef(p, q)[0, 1]
                    if best is None or r > best[0]:
                        best = (r, x, y)
            _, px, py = best
            # camada em coordenadas 640 recortada no retangulo do bitmap, alfa = regiao da mascara
            canvas = Image.new("RGBA", (640, 480), (0, 0, 0, 0))
            # pressionado: o original desenha o bitmap "p" deslocado (+1,+2) em relacao ao de foco (medido nas capturas
            # refs/original/menu_press_*: melhor deslocamento -1,-2 do nosso em todos os botoes); o alfa continua a mascara
            ox, oy = PRESS_OFFSET if key == "pressed" else (0, 0)
            canvas.paste(im.convert("RGBA"), (px + ox, py + oy))
            cover = Image.new("L", (640, 480), 0)                 # so vale onde o bitmap do botao existe
            cover.paste(255, (px + ox, py + oy, px + ox + w, py + oy + h))
            canvas.putalpha(ImageChops.multiply(region_alpha(mask, [val], 0, 0, 640, 480), cover))
            # recorta no bbox da mascara (+ margem), para os dois estados terem o mesmo retangulo
            pad = 3
            box = (max(0, bx0 - pad), max(0, by0 - pad), min(640, bx1 + pad), min(480, by1 + pad))
            crop = canvas.crop(box)
            img1024, X, Y = scaled(crop, box[0], box[1])
            save(img1024, d / f"btn{i}{'' if key == 'hover' else 'p'}.webp")
            entry[key] = {"file": f"btn{i}{'' if key == 'hover' else 'p'}.webp", "x": X, "y": Y, "w": img1024.width, "h": img1024.height}
        meta["buttons"].append(entry)

    # rotulo ("NEW GAME"...) mostrado no centro do disco quando o botao esta em foco: 180x80 em (232,200)
    lx, ly = 232, 200
    for i in range(1, 9):
        t = load_rgb(f"{R}text{i}.bmp")
        diff = np.abs(np.array(t).astype(int) - np.array(bg.crop((lx, ly, lx + 180, ly + 80))).astype(int)).max(axis=2)
        a = Image.fromarray(np.where(diff > 0, 255, 0).astype(np.uint8), "L")
        rgba = t.convert("RGBA")
        rgba.putalpha(a)
        img1024, X, Y = scaled(rgba, lx, ly)
        save(img1024, d / f"label{i}.webp")
        if meta["label"] is None:
            meta["label"] = {"x": X, "y": Y, "w": img1024.width, "h": img1024.height}

    save(hitmap(mask, {128 + 16 * (i - 1): i for i in range(1, 9)}), d / "hit.png")
    (d / "menu.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ cursor

CURSORS = {
    # arquivo de saida -> (pasta em graphics/cursors, hotspot do exe; ver assets/ui/cursors/cursors.json da frente SPRITES-RE)
    # Conferido nas capturas do original (refs/original): menu principal e criacao A mostram "select" (mao prateada) com a
    # ponta do dedo no mouse; a criacao B (atributos) mostra "default" (seta dourada).
    "cursor.png": ("default", 4, 4),
    "cursor_select.png": ("select", 3, 3),
}


def build_cursor():
    d = OUT / "menu"
    meta = {}
    for out, (name, hx, hy) in CURSORS.items():
        pal, frames, wide = sprites.read_sprite(str(SRC / f"graphics/cursors/{name}/sprites.16a"))
        w, h, rows = frames[0]
        img = Image.new("RGBA", (w, h))
        img.putdata(sprites.to_rgba(rows, pal, wide, "idx_alpha", True))
        save(img, d / out, "png")
        meta[name] = {"file": out, "hx": hx, "hy": hy, "w": w, "h": h}
    (d / "cursors.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ criacao de personagem

ICONS = {
    # kind: ordem -> (nome, valor na mascara, x, y) ; x,y = posicao do bitmap dentro da coluna central (320x480)
    "fighter": [("sword", 255, 88, 93), ("axe", 191, 92, 126), ("mace", 152, 88, 182), ("pike", 127, 84, 225), ("bow", 102, 88, 250)],
    "mag": [("air", 255, 132, 98), ("astral", 191, 136, 158), ("fire", 127, 200, 150), ("water", 102, 72, 165), ("earth", 152, 140, 228)],
}
COL_X = 160           # a coluna central ocupa x=160..480 da tela 640


def build_chargen():
    d = OUT / "chargen"
    meta = {"scale": S}
    P = CHR + "precreate/"
    # ---------- etapa A: "precreate" (janelas de vitral, nivel, nome)
    main = load_rgb(P + "mainarea.bmp")
    save(scaled(main, 0, 0)[0], d / "pc_bg.webp")
    mask = np.array(Image.open(SRC / P / "mask.bmp").convert("L"))
    ids = {20: 1, 40: 2, 60: 3, 80: 4, 100: 5, 120: 6, 140: 7, 160: 8, 180: 9, 200: 10}
    save(hitmap(mask, ids), d / "pc_hit.png")
    # janelas em foco (alfa = regiao da mascara)
    win_pos = [(116, 44), (180, 44), (392, 44), (456, 44)]
    meta["windows"] = []
    for k in range(4):
        im = load_rgb(P + f"heroes/h{k + 1}on.bmp")
        x, y = win_pos[k]
        a = region_alpha(mask, [80 + 20 * k], x, y, im.width, im.height)
        out, X, Y = layer(im, a, x, y)
        save(out, d / f"pc_win{k + 1}_on.webp")
        meta["windows"].append({"x": X, "y": Y, "w": out.width, "h": out.height})
    # heroi selecionado: 268x340 (par esquerdo em 112,44; par direito em 260,44), dois quadros de brilho
    sel_files = [("h1sel", "h1sel2"), ("h2sel", "h2sel1"), ("h3sel", "h3sel4"), ("h4sel", "h4sel3")]
    meta["sel"] = []
    for k, (fa, fb) in enumerate(sel_files):
        x, y = (112, 44) if k < 2 else (260, 44)
        for tag, f in (("a", fa), ("b", fb)):
            # preto puro = transparente (chave de cor) e as pecas de xadrez ficam por cima (regioes 20/40/60 da mascara);
            # conferido em refs/original/chargen_a.png (sem isso aparece um semicirculo preto sob a peca do meio)
            im = load_rgb(P + f"heroes/{f}.bmp")
            arr = np.asarray(im)
            keep = (arr.max(axis=2) > 0) & ~np.isin(mask[y:y + im.height, x:x + im.width], (20, 40, 60))
            rgba = im.convert("RGBA")
            rgba.putalpha(Image.fromarray((keep * 255).astype(np.uint8), "L"))
            out, X, Y = scaled(rgba, x, y)
            save(out, d / f"pc_sel{k + 1}{tag}.webp")
        meta["sel"].append({"x": X, "y": Y, "w": out.width, "h": out.height})
    # niveis (facil/medio/dificil): l = em foco, lon = escolhido, on = escolhido + foco
    lvl_pos = [(8, 0), (296, 0), (580, 0)]
    meta["levels"] = []
    for k in range(3):
        x, y = lvl_pos[k]
        for tag in ("l", "lon", "on"):
            im = load_rgb(P + f"levels/level{k}{tag}.bmp")
            a = region_alpha(mask, [20 + 20 * k], x, y, im.width, im.height, blur=0.8)
            out, X, Y = layer(im, a, x, y)
            save(out, d / f"pc_lvl{k}_{tag}.webp")
        meta["levels"].append({"x": X, "y": Y, "w": out.width, "h": out.height})
    # ossos (cancelar a esquerda, ok a direita) e tabuleta do nome
    for nm, fn, val, x, y in (("cancel", "cancell", 160, 16, 400), ("ok", "okl", 180, 548, 400)):
        im = load_rgb(P + fn + ".bmp")
        a = region_alpha(mask, [val], x, y, im.width, im.height)
        out, X, Y = layer(im, a, x, y)
        save(out, d / f"pc_{nm}.webp")
        meta[nm] = {"x": X, "y": Y, "w": out.width, "h": out.height}
    im = load_rgb(P + "tablol.bmp")
    a = region_alpha(mask, [200], 172, 396, im.width, im.height)
    out, X, Y = layer(im, a, 172, 396)
    save(out, d / "pc_name.webp")
    meta["name"] = {"x": X, "y": Y, "w": out.width, "h": out.height}
    # tochas animadas (15 quadros cada), retangulos opacos: batem com o fundo fora da chama
    meta["torches"] = []
    for n, (x, y) in ((1, (4, 200)), (2, (589, 200))):
        frames = []
        for f in range(15):
            im = load_rgb(P + f"torch{n}/t{n}{f:04d}.bmp")
            out, X, Y = scaled(im, x, y)
            frames.append(out)
        sheet = Image.new("RGB", (frames[0].width * 15, frames[0].height))
        for f, fr in enumerate(frames):
            sheet.paste(fr, (f * fr.width, 0))
        save(sheet, d / f"pc_torch{n}.webp", "overlay")
        meta["torches"].append({"x": X, "y": Y, "w": frames[0].width, "h": frames[0].height, "frames": 15})

    # ---------- etapa B: paineis (atributos | coluna central | botoes / retrato)
    # Posicoes conferidas por correlacao com refs/original/chargen_b_fighter.png (tela 640x480 em 192,144 da captura):
    # leftup (0,0); fullstatsl (0,238); coluna da classe (160,0) por cima de tudo em x 160..480 (as tiras rollstatsr/
    # fullstatsr NAO aparecem: a borda em x 160..176 e da propria coluna);
    # inn/buttonsarea (480,0) + placas inn/button*; moldura oval do retrato humanbackr (480,238), a mesma do painel da missao.
    def panel(rel, x, y, fname):
        im = load_rgb(rel)
        out, X, Y = scaled(im, x, y)
        save(out, d / fname)
        return {"x": X, "y": Y, "w": out.width, "h": out.height}

    meta["panels"] = {
        "attr": panel("main/graphics/chrgen/leftup.bmp", 0, 0, "pb_attr.webp"),             # Body/Agility/Mind/Spirit + 3 caixas
        "stats": panel(CHR + "fullstatsl.bmp", 0, 238, "pb_stats.webp"),                    # painel verde-azulado (estatisticas)
        # o original usa o painel de botoes da taverna (3 sulcos) + as placas inn/button{1,2,3}off|on em (484, 44 + 47k)
        "buttons": panel("graphics/interface/inn/buttonsarea.bmp", 480, 0, "pb_buttons.webp"),
        "portrait": panel("graphics/interface/humanbackr.bmp", 480, 238, "pb_portrait.webp"),  # moldura oval (retrato do heroi)
    }
    meta["plates"] = []
    for k in range(3):
        for st in ("off", "on"):
            rec = panel(f"graphics/interface/inn/button{k + 1}{st}.bmp", 484, 44 + 47 * k, f"pb_btn{k + 1}_{st}.webp")
        meta["plates"].append(rec)
    # o retrato e a "boneca" 160x240 do painel da missao (assets/ui/hud/doll, mission/hud.ts buildDoll), desenhada por cima
    # da moldura em (480, 240) — o corpo ja traz alfa fora do oval
    meta["columns"] = {}
    for kind in ("fighter", "mag"):
        col = load_rgb(CHR + f"{kind}/column.bmp")
        out, X, Y = scaled(col, COL_X, 0)
        save(out, d / f"col_{kind}.webp")
        meta["columns"][kind] = {"x": X, "y": Y, "w": out.width, "h": out.height}
        cm = np.array(Image.open(SRC / CHR / kind / "mask.bmp").convert("L"))
        # mascara -> ids 1..5 (as variacoes minusculas 103/138/153 da coluna "mag" sao ruido de borda)
        mapping = {}
        for n, (name, val, x, y) in enumerate(ICONS[kind], start=1):
            mapping[val] = n
        # ruido de borda: vai para o id do valor mais proximo
        vals = np.unique(cm)
        for v in vals:
            if v == 0 or v in mapping:
                continue
            nearest = min(mapping, key=lambda k: abs(k - int(v)))
            mapping[int(v)] = mapping[nearest]
        hm = hitmap(cm, mapping, (sx(320), sx(480)))
        save(hm, d / f"hit_{kind}.png")
        meta["columns"][kind]["icons"] = []
        for n, (name, val, x, y) in enumerate(ICONS[kind], start=1):
            ids_ = [v for v, i in mapping.items() if i == n]
            rec = {"name": name, "id": n}
            for state in ("on", "shine_on", "shine_off"):
                im = load_rgb(CHR + f"{kind}/{name}/{state}.bmp")
                a = region_alpha(cm, ids_, x, y, im.width, im.height, blur=0.6)
                # os bitmaps trazem retangulos pretos (sobras de recorte) dentro da regiao: viram transparentes
                dark = (np.array(im).max(axis=2) <= 8)
                a = Image.fromarray((np.array(a) * (~dark)).astype(np.uint8), "L")
                out, X, Y = layer(im, a, COL_X + x, y)
                save(out, d / f"ic_{kind}_{name}_{state}.webp")
                rec["x"], rec["y"], rec["w"], rec["h"] = X, Y, out.width, out.height
            meta["columns"][kind]["icons"].append(rec)
    # botoes +/- (20x20): off = normal, on = pressionado/foco, disable
    for n in ("mloff", "mlon", "mnloff", "mnlon", "mdisable", "ploff", "plon", "pnloff", "pnlon", "pdisable"):
        im = load_rgb(CHR + f"buttons/{n}.bmp")
        out = im if im.size == (sx(20), sx(20)) else im.resize((sx(20), sx(20)), Image.BICUBIC)
        save(out, d / f"btn_{n}.webp", "lossless")
    meta["pm_size"] = sx(20)
    # ---------- tela "New Character" do Multiplayer ("loader"; conferida pixel a pixel com refs/original/menu_multiplayer.png):
    # lista de personagens (madeira com 4 sulcos) | coluna de pedra | placas Accept/Delete/Rename/Cancel (chrgen/buttonsarea) |
    # painel verde (chrgen/fullstatsl, o mesmo da etapa B) | moldura oval (humanbackr). Posicoes iguais as da etapa B.
    meta["loader"] = {
        "list": panel(CHR + "loader/leftup.bmp", 0, 0, "ld_list.webp"),
        "center": panel(CHR + "loader/centerarea.bmp", 160, 0, "ld_center.webp"),
        "buttons": panel(CHR + "buttonsarea.bmp", 480, 0, "ld_buttons.webp"),
    }
    (d / "chargen.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ fonte bitmap (font4.16a, alfa)

FONT_NAME = "a2font4"
CELL = 16        # celula original 16x16; assentada em 2x (Lanczos) para escalar bem para baixo/cima
UP = 2
PAD = 2          # margem (px originais) para o contorno


def font_glyphs():
    p = SRC / "graphics/font4/font4.16a"
    pal, frames, wide = sprites.read_sprite(str(p))
    adv = struct.unpack("<224I", (SRC / "graphics/font4/font4.dat").read_bytes())
    glyphs = []
    for k, (w, h, rows) in enumerate(frames):
        cell = np.zeros((CELL, CELL), dtype=np.float32)
        for y, r in enumerate(rows):
            for x, v in enumerate(r):
                if v is not None:
                    cell[y, x] = min((v >> 8) & 0xFF, 31) / 31.0
        glyphs.append((0x20 + k, cell, adv[k]))
    return glyphs


def variant_cell(cell, bold, outline):
    """RGBA float (CELL+2*PAD)^2 : branco (glifo) sobre contorno preto (opcional); `bold` engrossa 1px na horizontal."""
    a = np.zeros((CELL + 2 * PAD, CELL + 2 * PAD), dtype=np.float32)
    a[PAD:PAD + CELL, PAD:PAD + CELL] = cell
    if bold:
        b = a.copy()
        b[:, 1:] = np.maximum(b[:, 1:], a[:, :-1])
        a = b
    out = np.zeros(a.shape + (4,), dtype=np.float32)
    if outline:
        o = a.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                o = np.maximum(o, np.roll(np.roll(a, dy, 0), dx, 1))
        # contorno preto, glifo branco por cima
        out[..., 3] = o
        out[..., :3] = 0.0
        ga = a[..., None]
        out[..., :3] = out[..., :3] * (1 - ga) + 1.0 * ga
        out[..., 3] = np.maximum(o, a)
    else:
        out[..., :3] = 1.0
        out[..., 3] = a
    return out


def build_fonts():
    d = OUT / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    glyphs = font_glyphs()
    variants = {FONT_NAME: (False, False), FONT_NAME + "b": (True, False),
                FONT_NAME + "o": (False, True), FONT_NAME + "bo": (True, True)}
    cw = (CELL + 2 * PAD) * UP
    cols = 16
    rows_n = (len(glyphs) + cols - 1) // cols
    for name, (bold, outline) in variants.items():
        atlas = Image.new("RGBA", (cols * cw, rows_n * cw), (0, 0, 0, 0))
        chars = []
        for n, (code, cell, adv) in enumerate(glyphs):
            rgba = variant_cell(cell, bold, outline)
            img = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
            img = img.resize((cw, cw), Image.LANCZOS)
            gx, gy = (n % cols) * cw, (n // cols) * cw
            atlas.paste(img, (gx, gy))
            if code == 0x20:
                advance = 6
            else:
                advance = adv + 2 + (1 if bold else 0)
            chars.append((code, gx, gy, cw, cw, -PAD * UP, -PAD * UP, advance * UP))
        save_img(atlas, d / f"{name}.webp", "lossless")
        lines = ['<?xml version="1.0"?>', "<font>",
                 f'  <info face="{name}" size="{CELL * UP}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="1" aa="1" padding="0,0,0,0" spacing="0,0"/>',
                 f'  <common lineHeight="{(CELL + 1) * UP}" base="{12 * UP}" scaleW="{atlas.width}" scaleH="{atlas.height}" pages="1" packed="0"/>',
                 "  <pages>", f'    <page id="0" file="{name}.webp"/>', "  </pages>", f'  <chars count="{len(chars)}">']
        for code, x, y, w, h, xo, yo, xa in chars:
            lines.append(f'    <char id="{code}" x="{x}" y="{y}" width="{w}" height="{h}" xoffset="{xo}" yoffset="{yo}" xadvance="{xa}" page="0" chnl="15"/>')
        lines += ["  </chars>", "</font>"]
        (d / f"{name}.fnt").write_text("\n".join(lines), encoding="utf-8")
    (d / "fonts.json").write_text(json.dumps({"family": FONT_NAME, "variants": list(variants), "cell": CELL, "up": UP,
                                              "lineHeight": CELL + 1, "note": "font4.16a (alfa); font1..3 (.16) usam outro RLE nao decifrado"}, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ fontes pixel a pixel (font1..4 em escala 1, para as telas 640x480)

PIXEL_FONTS = {
    # familia: (arquivo, formato) — .16 = 4 bits por pixel (tom 0..15 da cor do texto), .16a = branco com 16 niveis de alfa
    "a2f1": ("graphics/font1/font1.16", "nibble"),    # 16x15, decorativa
    "a2f2": ("graphics/font2/font2.16", "nibble"),    # 8x10, maiusculas (painel de estatisticas, HUD)
    "a2f3": ("graphics/font3/font3.16", "nibble"),    # 8x6, algarismos minusculos
    "a2f4": ("graphics/font4/font4.16a", "alpha"),    # 16x16, Times (rotulos, botoes, nome)
}


# espaco da font1 = 9 px (o calculo padrao dava 8): cada espaco nos textos do Load Game (refs/original/load_game_screen: "Load Saved Game"
# 140 px de largura contra 138) e do menu do jogo (refs/original/mission_menu) era 1 px estreito demais
SPACE_ADVANCE = {"a2f1": 9, "a2f2": 6}   # a2f2: 19/10, dicas da criacao (chargen_b_*_hover_*): intervalo entre palavras 9 px contra 6


def build_pixel_fonts():
    """BitmapFonts sem reamostragem (1 texel = 1 pixel da tela 640x480), com e sem sombra preta em (+1,+1).

    Cor: o glifo sai branco; o jogo pinta com `tint` (Pixi multiplica). Nas fontes .16 o nibble e o tom (v/15 da cor
    do texto, conferido no painel de estatisticas da criacao: 189,158,74 -> 165,138,57 -> 107,93,41 -> 57,52,24 para
    v = 15/13/9/5); a sombra preta 1 px abaixo/direita aparece nas capturas do original (refs/original/chargen_b_fighter.png).
    Avanco = largura do .dat + 2 (o mesmo da font4)."""
    d = OUT / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    index = {}
    for fam, (rel, kind) in PIXEL_FONTS.items():
        pal, frames, wide = sprites.read_sprite(str(SRC / rel))
        dat = (SRC / rel).with_suffix(".dat").read_bytes()
        adv = struct.unpack(f"<{len(dat) // 4}I", dat)
        cw = max(f[0] for f in frames) + 1
        ch = max(f[1] for f in frames) + 1
        cols = 16
        rows_n = (len(frames) + cols - 1) // cols
        variants = [(False, False), (False, True)] + ([(True, False), (True, True)] if kind == "alpha" else [])
        for bold, shadow in variants:
            # negrito (so font4): o glifo desenhado duas vezes, em x e x+1 (o que o original faz nos rotulos/botoes,
            # conferido em "Name: Aldor" e "Accept" das capturas); o avanco nao muda
            name = fam + ("b" if bold else "") + ("s" if shadow else "")
            atlas = np.zeros((rows_n * ch, cols * cw, 4), dtype=np.float32)
            chars = []
            for n, (w, h, rws) in enumerate(frames):
                g = np.zeros((h, w), dtype=np.float32)       # cobertura/alfa
                lum = np.zeros((h, w), dtype=np.float32)     # tom (multiplica a cor)
                for y, r in enumerate(rws):
                    for x, v in enumerate(r):
                        if v is None:
                            continue
                        if kind == "nibble":
                            if v:
                                g[y, x] = 1.0
                                lum[y, x] = v / 15.0
                        else:
                            g[y, x] = sprites.pixel16_alpha(v) / 255.0
                            lum[y, x] = 1.0
                if bold:
                    g2 = np.zeros((h, w + 1), dtype=np.float32)
                    g2[:, :w] = g
                    g2[:, 1:] = np.maximum(g2[:, 1:], g)
                    l2 = np.zeros((h, w + 1), dtype=np.float32)
                    l2[:, :w] = lum
                    l2[:, 1:] = np.maximum(l2[:, 1:], lum)
                    g, lum, w = g2[:, :cw - 1], l2[:, :cw - 1], min(w + 1, cw - 1)
                cell = np.zeros((ch, cw, 4), dtype=np.float32)
                if shadow:
                    cell[1:h + 1, 1:w + 1, 3] = g                 # sombra preta
                ga = g[..., None]
                cell[:h, :w, :3] = cell[:h, :w, :3] * (1 - ga) + lum[..., None] * ga
                cell[:h, :w, 3] = np.maximum(cell[:h, :w, 3], g) if shadow else g
                gx, gy = (n % cols) * cw, (n // cols) * ch
                atlas[gy:gy + ch, gx:gx + cw] = cell
                code = 0x20 + n
                a = adv[n] if n < len(adv) else w
                advance = (a + 2) if code != 0x20 else SPACE_ADVANCE.get(fam, max(3, a + 2 if a else (cw // 2)))
                chars.append((code, gx, gy, cw, ch, 0, 0, advance))
            img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
            save_img(img, d / f"{name}.png", "png")
            lines = ['<?xml version="1.0"?>', "<font>",
                     f'  <info face="{name}" size="{ch - 1}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="0" padding="0,0,0,0" spacing="0,0"/>',
                     f'  <common lineHeight="{ch - 1}" base="{ch - 2}" scaleW="{img.width}" scaleH="{img.height}" pages="1" packed="0"/>',
                     "  <pages>", f'    <page id="0" file="{name}.png"/>', "  </pages>", f'  <chars count="{len(chars)}">']
            for code, x, y, w, h, xo, yo, xa in chars:
                lines.append(f'    <char id="{code}" x="{x}" y="{y}" width="{w}" height="{h}" xoffset="{xo}" yoffset="{yo}" xadvance="{xa}" page="0" chnl="15"/>')
            lines += ["  </chars>", "</font>"]
            (d / f"{name}.fnt").write_text("\n".join(lines), encoding="utf-8")
        index[fam] = {"src": rel, "cellW": cw - 1, "cellH": ch - 1, "glyphs": len(frames)}
    (d / "pixelfonts.json").write_text(json.dumps(index, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ main

def main():
    global SRC, S
    args = sys.argv[1:]
    only = {"menu", "chargen", "fonts", "cursor", "pixelfonts"}
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    if "--src" in args:
        SRC = Path(args[args.index("--src") + 1])
    if "--scale" in args:
        S = float(args[args.index("--scale") + 1])
    if "menu" in only:
        build_menu(); print("menu ok")
    if "cursor" in only or "menu" in only:
        build_cursor(); print("cursor ok")
    if "chargen" in only:
        build_chargen(); print("chargen ok")
    if "fonts" in only:
        build_fonts(); print("fonts ok")
    if "pixelfonts" in only or "fonts" in only:
        build_pixel_fonts(); print("pixelfonts ok")


if __name__ == "__main__":
    main()
