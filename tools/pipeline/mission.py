"""Pipeline da frente MISSÃO: exporta o que a cena de missão precisa e que ainda não existe em game/public.

Saídas (todas em game/public/assets/ui/hud/ e game/public/assets/ui/cursors/, pastas da frente MISSÃO):
  hud/anim/unit_<ID>.png + hud/anim/units.json   atlas com TODOS os frames de cada tipo de unidade (units.reg) e layout das animações
  hud/anim/hero_<arma>.png                         sprites dos heróis (graphics/units/heroes/<arma>/sprites.256), mesmo layout
  hud/*.png                                         bitmaps da interface (graphics/interface: commandbar, crystal, humanback...)
  hud/doll/**                                       "boneca" do herói/humanos na moldura oval (corpo por face + camadas do equipamento)
  hud/info/<nome>.png                               retratos da caixa de informação (graphics/infowindow/<InfoPicture>.bmp)
  hud/missions/<n>.json                             dados do .alm que os mapas JSON ainda não trazem: diplomacia inicial (bloco 5),
                                                    id usado pelo script e NPC de cada unidade (bloco 6, último/7º campo)
  cursors/<nome>.png + cursors/cursors.json         cursores carregados pelo exe (tabela CURSORS: .16a + s*.256), tira horizontal
                                                    de frames; JSON com celula, hotspot (hx, hy) e ms por quadro

Layout dos sprites de unidade (deduzido aqui; ver game/src/sim/README.md e docs/GAPS.md):
  Flip=1 (só metade das direções desenhadas, o resto é espelhado):  9 frames parados (16 direções: S, SSW, SW ... N)
        + 5 direções (S, SW, W, NW, N) × [mover(MoveBegin+Move) | atacar | morrer | ossos | ocioso]   — confere frame a frame em 47 unidades
  Flip=0: 16 frames parados + 8 direções (S, SW, W, NW, N, NE, E, SE) × os mesmos blocos.
  Os frames são recortes de tamanho múltiplo de 8 sem deslocamento no cabeçalho: alinhamos pelo CENTRO da célula.

Uso: .venv/Scripts/python.exe tools/pipeline/mission.py [--extracted <pasta>] [--only anim|hud|doll|cursors|missions|terrain]
"""
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import alm  # noqa: E402
import reg  # noqa: E402
import sprites  # noqa: E402
from PIL import Image  # noqa: E402

PUB = os.path.join(ROOT, "game", "public")
HUD = os.path.join(PUB, "assets", "ui", "hud")
CUR = os.path.join(PUB, "assets", "ui", "cursors")

FIELDS = ("MoveBeginPhases", "MovePhases", "AttackPhases", "DyingPhases", "BonePhases", "IdlePhases",
          "MoveAnimTime", "MoveAnimFrame", "AttackAnimTime", "AttackAnimFrame", "IdleAnimTime", "IdleAnimFrame",
          "Width", "Height", "CenterX", "CenterY", "SelectionX1", "SelectionX2", "SelectionY1", "SelectionY2",
          "Flip", "Z", "TileSize", "Sound", "AttackDelay", "ShootDelay", "Projectile", "ShootOffset", "InfoPicture", "Dying", "Palette")


def frame_rgba(fr, pal, wide):
    w, h, rows = fr
    im = Image.new("RGBA", (w, h))
    im.putdata(sprites.to_rgba(rows, pal, wide, "idx_alpha", True))
    return im


def pack(frames, pal, wide, out_png):
    """Atlas em grade: célula = maior frame; cada frame centralizado na célula. Devolve (cw, ch, cols)."""
    cw = max(f[0] for f in frames)
    ch = max(f[1] for f in frames)
    cols = max(1, min(len(frames), 4096 // cw, 24))
    rows = (len(frames) + cols - 1) // cols
    img = Image.new("RGBA", (cols * cw, rows * ch))
    for i, fr in enumerate(frames):
        t = frame_rgba(fr, pal, wide)
        img.alpha_composite(t, ((i % cols) * cw + (cw - fr[0]) // 2, (i // cols) * ch + (ch - fr[1]) // 2))
    img.save(out_png, optimize=True)
    return cw, ch, cols


def layout(u, n):
    """Blocos de animação para um tipo de unidade com `n` frames. Devolve dict ou None se a contagem não fechar."""
    flip = bool(u.get("Flip"))
    static, dirs = (9, 5) if flip else (16, 8)
    mb, mv = u.get("MoveBeginPhases", 0), u.get("MovePhases", 0)
    at, dy, bo, idl = u.get("AttackPhases", 0), u.get("DyingPhases", 0), u.get("BonePhases", 0), u.get("IdlePhases", 0)
    order = [("move", mb + mv), ("attack", at), ("dying", dy), ("bones", bo), ("idle", idl)]
    total = static + dirs * sum(p for _, p in order)
    if total != n:
        # heróis e humanos: sem morrer/ossos no arquivo; tenta só mover+atacar
        order2 = [("move", mb + mv), ("attack", at)]
        if static + dirs * sum(p for _, p in order2) == n:
            order = order2
        else:
            return None
    blocks, pos = {}, static
    for name, ph in order:
        if ph:
            blocks[name] = {"start": pos, "phases": ph}
        pos += dirs * ph
    if "move" in blocks:
        blocks["move"]["begin"] = mb
    return {"flip": flip, "staticDirs": static, "dirs": dirs, "blocks": blocks}


def export_anim(ext):
    """Animações das unidades/heróis: agora geradas por tools/pipeline/anim_world.py (frente MOTOR-B) — atlas indexado com
    variantes de paleta por nível, camada B (suavização), correções de layout (ID 2 espelhado, morte da ovelha) e tempos."""
    sys.path.insert(0, HERE)
    import anim_world  # noqa: E402
    anim_world.export_units(ext)


DOLL_SUBS = ("mfighter", "ffighter", "mmage", "fmage")
GRAPHICS_RES = r"C:\GOG Games\Rage of Mages II\graphics.res"


def _sprite_from_bytes(data):
    """Decodifica o 1º frame de um .256 vindo de dentro do graphics.res (read_sprite só aceita caminho)."""
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix=".256")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        pal, frames, wide = sprites.read_sprite(tmp)
    finally:
        os.remove(tmp)
    return frame_rgba(frames[0], pal, wide)


def export_doll(ext, res=GRAPHICS_RES):
    """Retrato do herói/humanos no painel (a "boneca" da moldura oval), como o allods2.exe monta (strings em 0x1eee65:
    graphics\\equipment\\{mfighter,mmage,ffighter,fmage}\\[primary\\|secondary\\]<n>.256):
      corpo   = equipment/<sexo+classe>/<face>.256 (160x240; `face` = campo da classe/herói)
      camadas = equipment/<sub>/primary|secondary/<AABBCDD>.256 por item vestido (nome = material, slot, classe, opção do id)
      capa    = interface/heroback/back<m|f>.256 atrás do corpo (heróis guerreiros)
    As pastas primary/secondary estão VAZIAS em allods2-extracted (a extração não as gravou), então as camadas são lidas
    direto do graphics.res (somente leitura). Saída: hud/doll/<sub>/<face>.webp, hud/doll/<sub>/p|s/<nome>.webp (recortadas)
    e hud/doll/index.json {sub: {"bodies": [...], "p": {nome: [x, y]}, "s": {...}}, "back": {...}}."""
    sys.path.insert(0, TOOLS)
    import ya1  # noqa: E402
    from imgout import save_img  # noqa: E402
    out = os.path.join(HUD, "doll")
    os.makedirs(out, exist_ok=True)
    index = {}
    for sub in DOLL_SUBS:
        src = os.path.join(ext, "graphics", "equipment", sub)
        bodies = []
        for f in sorted(os.listdir(src)):
            if not f.endswith(".256"):
                continue
            pal, frames, wide = sprites.read_sprite(os.path.join(src, f))
            save_img(frame_rgba(frames[0], pal, wide), os.path.join(out, sub, f[:-4] + ".webp"))
            bodies.append(int(f[:-4]))
        index[sub] = {"bodies": sorted(bodies), "p": {}, "s": {}}
    n = 0
    if os.path.exists(res):
        ar = ya1.open_archive(res)
        for path, node in ar.walk():
            parts = path.split("/")
            if node.is_dir or len(parts) != 4 or parts[0] != "equipment" or parts[2] not in ("primary", "secondary"):
                continue
            sub, layer, name = parts[1], parts[2][0], parts[3][:-4]
            try:
                im = _sprite_from_bytes(bytes(ar.data(node)))
            except Exception as e:  # noqa: BLE001 — há entradas vazias/curtas no .res
                print("camada ignorada", path, e)
                continue
            box = im.getbbox()
            if not box:
                continue
            save_img(im.crop(box), os.path.join(out, sub, layer, name + ".webp"), kind="lossless")
            index.setdefault(sub, {"bodies": [], "p": {}, "s": {}})[layer][name] = [box[0], box[1]]
            n += 1
    else:
        print("graphics.res não encontrado: sem camadas de equipamento")
    index["back"] = {}
    for g in ("m", "f"):
        p = os.path.join(ext, "graphics", "interface", "heroback", "back%s.256" % g)
        if os.path.exists(p):
            pal, frames, wide = sprites.read_sprite(p)
            im = frame_rgba(frames[0], pal, wide)
            box = im.getbbox() or (0, 0, im.width, im.height)
            save_img(im.crop(box), os.path.join(out, "back%s.webp" % g), kind="lossless")
            index["back"][g] = [box[0], box[1]]
    index["note"] = ("corpo 160x240 em <sub>/<face>.webp; camadas recortadas em <sub>/p|s/<nome>.webp com o canto [x, y] dentro de 160x240; "
                     "nome = '%02d%02d%d%02d' % (material, slot, classe, opção) do id do item (material<<12|slot<<8|classe<<5|opção)")
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"))
    print("boneca: %d camadas de equipamento" % n)


HUD_BMPS = ["commandbarl", "commandbarr", "commanddnr", "commandempr", "crystall", "crystalr", "headsl", "headsr", "humanbackl", "humanbackr",
            "textbackl", "textbackr", "extra1024l", "extra1024r", "inv1024l", "inv1024r", "invframe", "invarrow1", "invarrow2", "invarrow3", "invarrow4",
            "spb1024l", "spb1024r", "spellbook", "spellback", "t_back", "backinv", "humanmode", "textmode", "bookclosed", "bookopened",
            "backpackcl", "backpackop", "minimapdata", "ball", "diskette"]
#: bitmaps com preto como cor transparente (desenhados por cima de outros)
HUD_KEYED = {"ball", "bookclosed", "bookopened", "backpackcl", "backpackop", "humanmode", "textmode", "diskette"}


def export_hud(ext):
    os.makedirs(HUD, exist_ok=True)
    src = os.path.join(ext, "graphics", "interface")
    for n in HUD_BMPS:
        p = os.path.join(src, n + ".bmp")
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            if n in HUD_KEYED:
                # botões pequenos e as pontas das barras: preto puro = transparente (chave de cor do jogo)
                im = im.convert("RGBA")
                im.putdata([(r, g, b, 0) if (r, g, b) == (0, 0, 0) else (r, g, b, 255) for (r, g, b, _a) in im.getdata()])
            im.save(os.path.join(HUD, n + ".png"), optimize=True)
    # retratos da caixa de informação
    info = os.path.join(ext, "graphics", "infowindow")
    os.makedirs(os.path.join(HUD, "info"), exist_ok=True)
    for f in os.listdir(info):
        if f.lower().endswith(".bmp"):
            # 160x240 com fundo preto puro = transparente: o fundo de pedra da moldura oval (humanbackr) aparece atrás
            im = Image.open(os.path.join(info, f)).convert("RGBA")
            im.putdata([(r, g, b, 0) if (r, g, b) == (0, 0, 0) else (r, g, b, 255) for (r, g, b, _a) in im.getdata()])
            im.save(os.path.join(HUD, "info", f[:-4].lower() + ".png"), optimize=True)
    print("hud ok")


# Cursores carregados pelo allods2.exe (rotina 0x47b92d; construtor 0x47b736(arquivo, hx, hy, ms_por_quadro)):
# nome -> (arquivo em graphics/cursors, hotspot x, hotspot y, ms por quadro; 0 = estatico [o exe usa 2000000000]).
# O hotspot e o ponto do clique medido a partir do canto superior esquerdo do quadro.
# Os .256 soltos (default.256, attack.256, pickup.256, l/r/u/d/lu/ld/ru/rd.256, select.256, cantput.256) NAO sao
# carregados pelo jogo (restos; attack.256/pickup.256 nem decodificam como imagem) e nao sao exportados.
CURSORS = {
    "default": ("default/sprites.16a", 4, 4, 0), "move": ("move/sprites.16a", 2, 3, 100),
    "swarm": ("swarm/sprites.16a", 2, 3, 100), "attack": ("attack/sprites.16a", 3, 3, 100),
    "defend": ("defend/sprites.16a", 16, 16, 100), "select": ("select/sprites.16a", 3, 3, 100),
    "patrol": ("patrol/sprites.16a", 8, 25, 100), "cast": ("cast/sprites.16a", 16, 16, 100),
    "pickup": ("pickup/sprites.16a", 16, 12, 66),
    # setas de rolagem na borda da tela (0 = cima, sentido horario: 1 NE, 2 E, 3 SE, 4 S, 5 SO, 6 O, 7 NO)
    "arrow0": ("arrow0/sprites.16a", 16, 6, 0), "arrow1": ("arrow1/sprites.16a", 23, 9, 0),
    "arrow2": ("arrow2/sprites.16a", 26, 16, 0), "arrow3": ("arrow3/sprites.16a", 23, 24, 0),
    "arrow4": ("arrow4/sprites.16a", 16, 28, 0), "arrow5": ("arrow5/sprites.16a", 8, 24, 0),
    "arrow6": ("arrow6/sprites.16a", 5, 16, 0), "arrow7": ("arrow7/sprites.16a", 8, 9, 0),
    # versoes pequenas (s*): o exe as carrega logo depois de sdefault (uso exato nao decifrado)
    "sdefault": ("sdefault/sprites.16a", 1, 1, 0), "smove": ("smove.256", 0, 0, 0), "sattack": ("sattack.256", 0, 0, 0),
    "sdefend": ("sdefend.256", 0, 0, 0), "spatrol": ("spatrol.256", 0, 0, 0), "scast": ("scast.256", 0, 0, 0),
    "cantput": ("cantput/sprites.16a", 38, 36, 0), "town": ("town/sprites.16a", 16, 16, 0),
    "dice": ("dice/sprites.16a", 16, 16, 100), "wait": ("wait/sprites.16a", 16, 16, 100),
    "backpack": ("backpack/sprites.16a", 16, 16, 100),
}


def export_cursors(ext):
    """Tira horizontal por cursor + cursors.json {nome: {w, h, frames, hx, hy, delay, src}} (w/h = celula; hx/hy = hotspot;
    delay = ms por quadro, 0 = estatico)."""
    os.makedirs(CUR, exist_ok=True)
    src = os.path.join(ext, "graphics", "cursors")
    meta = {}
    for name, (rel, hx, hy, delay) in CURSORS.items():
        p = os.path.join(src, rel)
        try:
            pal, frames, wide = sprites.read_sprite(p)
        except Exception as e:  # noqa: BLE001
            print("cursor", name, e)
            continue
        cw, ch = max(f[0] for f in frames), max(f[1] for f in frames)
        img = Image.new("RGBA", (cw * len(frames), ch))
        for i, fr in enumerate(frames):
            img.alpha_composite(frame_rgba(fr, pal, wide), (i * cw, 0))
        img.save(os.path.join(CUR, name + ".png"), optimize=True)
        meta[name] = {"w": cw, "h": ch, "frames": len(frames), "hx": hx, "hy": hy, "delay": delay, "src": "graphics/cursors/" + rel}
    with open(os.path.join(CUR, "cursors.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print("cursores:", list(meta))


def export_missions(ext):
    out = os.path.join(HUD, "missions")
    os.makedirs(out, exist_ok=True)
    src = os.path.join(ext, "scenario")
    for f in sorted(os.listdir(src)):
        if not f.endswith(".alm"):
            continue
        m = alm.Alm(open(os.path.join(src, f), "rb").read())
        dip = []
        for p in m.players:
            r = p["raw"]
            dip.append(list(struct.unpack_from("<16H", r, 44))[:len(m.players)])
        units = []
        for u in m.units:
            raw = u["raw"]
            units.append({"id": raw[12] & 0xffff, "npc": raw[6], "f3": raw[3], "f4": raw[4], "f5": raw[5], "f8": raw[8], "f9": raw[9]})
        with open(os.path.join(out, f[:-4] + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"mission": f[:-4], "diplomacy": dip, "units": units,
                       "note": "diplomacy[a][b]: bit0 = a hostil a b, bit1 = aliado, 0x10 = visão compartilhada (bloco 5 @44). units[i] alinha com maps/<n>.json units[i]"},
                      fh, separators=(",", ":"))
    print("missões ok")


TERRAIN_CLASSES = ["land", "grass", "flowers", "sand", "cracked", "stones", "savanna", "mountain", "water", "road"]


def file_class(f):
    """Classe de terreno por arquivo de tile (decisão visual; ver docs/GAPS.md)."""
    if f <= 3:
        return "grass"
    if f <= 7 or 12 <= f <= 15:
        return "land"
    if f <= 11:
        return "sand"
    if f <= 19:
        return "stones"
    if f <= 23:
        return "cracked"
    if f <= 25:
        return "grass"
    if f <= 27:
        return "flowers"
    if f <= 31:
        return "stones"   # vira "mountain" quando o tile é majoritariamente rocha cinza
    if f <= 47:
        return "land"     # margem; vira "water" quando o tile é majoritariamente água
    return "road"


def export_terrain(ext):
    """Classifica cada id de tile (arquivo*16+linha) num tipo de terreno de map.reg, olhando os pixels."""
    terr = os.path.join(PUB, "assets", "terrain")
    names = json.load(open(os.path.join(PUB, "data", "index.json")))["terrain"]
    tiles = {}
    for f, n in enumerate(names):
        im = Image.open(os.path.join(terr, n + ".png")).convert("RGB")
        for r in range(im.height // 32):
            px = list(im.crop((0, r * 32, 32, r * 32 + 32)).getdata())
            blue = sum(1 for (R, G, B) in px if B > R + 12 and B > G - 4) / len(px)
            grey = sum(1 for (R, G, B) in px if max(R, G, B) - min(R, G, B) < 18 and R > 95) / len(px)
            c = file_class(f)
            if 32 <= f <= 47 and blue > 0.5:
                c = "water"
            if 28 <= f <= 31 and grey > 0.35:
                c = "mountain"
            tiles[f * 16 + r] = TERRAIN_CLASSES.index(c)
    reg_map = json.load(open(os.path.join(ROOT, "data", "reg", "map.json")))["Terrain"]
    cost = {c: reg_map.get("Cost" + c.capitalize(), 8) for c in TERRAIN_CLASSES}
    with open(os.path.join(HUD, "terrain.json"), "w", encoding="utf-8") as fh:
        json.dump({"classes": TERRAIN_CLASSES, "cost": cost, "blocked": ["mountain", "water"], "tile": tiles,
                   "note": "classe por id de tile (arquivo*16+linha); custo = map.reg Terrain/Cost*; ver tools/pipeline/mission.py"}, fh, separators=(",", ":"))
    from collections import Counter
    print("terreno:", Counter(TERRAIN_CLASSES[v] for v in tiles.values()))


def main():
    a = sys.argv[1:]
    ext = a[a.index("--extracted") + 1] if "--extracted" in a else r"C:\Users\TALES K\Games\allods2-extracted"
    only = a[a.index("--only") + 1] if "--only" in a else None
    for name, fn in (("anim", export_anim), ("hud", export_hud), ("doll", export_doll), ("cursors", export_cursors), ("missions", export_missions),
                     ("terrain", export_terrain)):
        if only in (None, name):
            fn(ext)


if __name__ == "__main__":
    main()
