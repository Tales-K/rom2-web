"""Leitor dos mapas .alm (assinatura "M7R") do Rage of Mages II.

Formato deduzido do desmontador do ROM2 Map Editor.exe (funcao de carga em 0x41af70+...,
tabela de saltos em 0x424868; dialogos do editor dao o nome de cada campo) e conferido nos 57 mapas instalados.
Ver notes/alm-format.md (la estao os enderecos de cada achado).

Arquivo:
  cabecalho (20 bytes): "M7R\\0", u32 tamanho_cabecalho(=20), u32 ?(0x6448), u32 n_blocos(=13), u32 versao(0x514 ou 0x640)
  n_blocos blocos, cada um:
    cabecalho de 20 bytes: u32 5 ou 7, u32 20, u32 tamanho_corpo, u32 tipo, u32 lixo (varia entre mapas)
    corpo (tamanho_corpo bytes; o tipo 0 ocupa 16 bytes a mais do que o campo informa)
Ordem fixa nas missoes: tipos 0,1,2,3,5,11,4,9,8,6,7,10,12.

Uso:  python tools/alm.py <mapa.alm> [--png saida.png] [--units]   (PNG precisa do venv com Pillow)
"""
import struct
import sys

BLOCK_ORDER = (0, 1, 2, 3, 5, 11, 4, 9, 8, 6, 7, 10, 12)

# tipo de cada parametro de script (types[k] do registro): confirmados pelos rotulos gravados no proprio registro
PARAM_TYPES = {0: "none", 1: "int", 2: "group", 3: "player", 4: "unit", 5: "x", 6: "y", 7: "const", 8: "item", 9: "structure"}
# operadores dos gatilhos = indice do botao de radio no dialogo "Trigger Manager" do editor (recurso 273; ordem de tabulacao
# "=", "!=", ">", "<", ">=", "<=", WS_GROUP so no primeiro). O indice vai direto para o registro (codigo 0x414fa4/0x415285).
COMPARE_OPS = {0: "==", 1: "!=", 2: ">", 3: "<", 4: ">=", 5: "<="}
# acao tipo 6 = comando de grupo; o subcomando vem no parametro 0 ("Const"), o grupo no parametro 9 (ou 1 em Follow)
GROUP_COMMANDS = {1: "Guard", 2: "Swarm", 3: "Stand Ground", 4: "Move", 5: "Swarm 2", 10: "Attack", 11: "Defend",
                  14: "Patrol", 15: "Follow", 17: "Roam", 18: "Dwell"}
# ids especiais de unidade nos scripts (nao estao no bloco 6): personagens do grupo do jogador
SPECIAL_UNITS = {10001: "hero", 10002: "knight", 10003: "dina"}
# diplomacia (bloco 5, u16[16] por jogador; dialogo "Diplomacy relations", codigo 0x42e07c): bits 0..1 = 0 neutro,
# 1 inimigo, 2 alianca; bit 0x10 = visao compartilhada (caixa "Vision")
DIPLOMACY = {0: "neutral", 1: "enemy", 2: "ally"}


class AlmError(ValueError):
    pass


class Block:
    def __init__(self, index, type_, flag, body):
        self.index, self.type, self.flag, self.body = index, type_, flag, body


def _cstr(b):
    return b.split(b"\0")[0].decode("latin-1")


class Alm:
    def __init__(self, data):
        self.data = data
        magic, hsize, self.unk, count, self.version = struct.unpack_from("<4sIIII", data, 0)
        if magic != b"M7R\0":
            raise AlmError("nao e um mapa M7R")
        self.blocks = []
        pos = hsize
        for i in range(count):
            if pos + 20 > len(data):
                raise AlmError("bloco %d passa do fim do arquivo" % i)
            flag, hdr, size, typ, tag = struct.unpack_from("<5I", data, pos)
            if hdr != 20:
                raise AlmError("cabecalho de bloco %d inesperado" % i)  # `tag` varia entre mapas (lixo de memoria); ignorado
            size += 16 if typ == 0 else 0
            self.blocks.append(Block(i, typ, flag, data[pos + 20:pos + 20 + size]))
            pos += 20 + size
        if pos != len(data):
            raise AlmError("sobram %d bytes apos o ultimo bloco" % (len(data) - pos))
        self.by_type = {b.type: b for b in self.blocks}
        self._decode()

    # ------------------------------------------------------------------ bloco 0
    def _decode_info(self):
        """Tipo 0 (leitor em 0x423112). Os nomes vem dos dialogos "Light settings", "Global map settings" e das contagens
        que os outros blocos consomem."""
        t0 = self.by_type[0].body
        f = struct.unpack_from("<IIfIIII", t0, 0)
        c = struct.unpack_from("<10I", t0, 28)
        name = _cstr(t0[68:132])
        rec_players, min_level, unk_e0, unk_e4 = struct.unpack_from("<IIii", t0, 132)
        self.width, self.height = f[0], f[1]
        self.info = {
            "width": f[0], "height": f[1],
            "solarAngle": f[2],                 # radianos (slider "Solar Angle", -45..+45 graus)
            "startTime": f[3],                  # minutos do dia (slider "Starting Time" em quartos de hora x15; 360 = 6h)
            "brightness": 64 - f[4],            # o arquivo guarda 64 - brilho
            "contrast": f[5],
            "mask94": f[6],                     # +0x94 do documento: mascara de 13 bits (8191/4095...), significado desconhecido
            "counts": {"players": c[0], "structures": c[1], "units": c[2],
                       "scriptRecords": c[3],   # = n_acoes + n_valores + n_gatilhos (conferido em 10.alm: 32+21+16 = 69)
                       "bags": c[4], "groupRepops": c[5], "taverns": c[6], "shops": c[7], "signposts": c[8],
                       "musicPoints": c[9]},
            # "Global map settings": nome (<=0x3c), copyright (<=0x1fe); nas missoes costumam ser lixo de memoria
            "name": name if name.isprintable() else "",
            "recPlayers": rec_players, "minLevel": min_level,
            "unkE0": unk_e0, "unkE4": unk_e4,   # versao >= 0x488; desconhecidos (missoes: 0 e 60000000)
            "copyright": "",
        }
        cp = _cstr(t0[148:148 + 0x200])
        if cp.isprintable():
            self.info["copyright"] = cp
        return c

    def _decode(self):
        counts = self._decode_info()
        n = self.width * self.height
        self.tiles = list(struct.unpack("<%dH" % n, self.by_type[1].body))   # tipo 1: u16 por celula (id do tile)
        self.altitude = list(self.by_type[2].body)                           # tipo 2: u8 por celula (altitude)
        self.flags = list(self.by_type[3].body)                              # tipo 3: u8 por celula (objeto de cenario + 1)
        self._decode_players()
        self._decode_lists11(counts)
        self._decode_structures()
        self._decode_effects()
        self._decode_bags(counts[4])
        self._decode_units()
        self._decode_script()
        self._decode_repops(counts[5])
        self._decode_music(counts[9])
        self.groups = {}
        for i, u in enumerate(self.units):
            if u["group"]:
                self.groups.setdefault(u["group"], []).append(i)

    # ------------------------------------------------------------------ bloco 5
    def _decode_players(self):
        """Tipo 5 (0x42359f): 76 bytes = u32 cor, u32 computador(0 humano / 1 computador), u32 dinheiro, char[32] nome,
        u16[16] diplomacia (linha do jogador; coluna = posicao do outro jogador)."""
        self.players = []
        r = self.by_type[5].body
        for i in range(0, len(r), 76):
            rec = r[i:i + 76]
            color, computer, money = struct.unpack_from("<3I", rec, 0)
            dip = list(struct.unpack_from("<16H", rec, 44))
            self.players.append({
                "id": color,                  # campo "Color" do dialogo (o antigo "id"; pode repetir, ex.: 100.alm tem dois "3")
                "index": i // 76 + 1,         # numero usado por unidades, estruturas e scripts = posicao na lista (1-based)
                "name": _cstr(rec[12:44]),
                "computer": bool(computer), "money": money,
                "diplomacy": dip,
                "raw": rec,
            })

    # ------------------------------------------------------------------ bloco 11
    def _decode_lists11(self, c):
        """Tipo 11 (0x42332b): tres listas, contagens no bloco 0.
        tavernas  12 bytes {estrutura, flags, item de entrega (-1 = nenhum)}  (dialogo "Tavern Quests")
        lojas     0x54 bytes {estrutura, u32[20] prateleiras}                (dialogo "Shop Setup", 4 prateleiras)
        placas    12 bytes {estrutura, ligado, indice da acao}               (dialogo "Usable Pointer info": clicar na placa
                  executa actions[indice], indice 0-based na lista do bloco 7 -- conferido em 10/20/21/30/40/50.alm)"""
        b = self.by_type[11].body
        pos = 0
        self.taverns, self.shops, self.signposts = [], [], []
        for _ in range(c[6]):
            s, fl, item = struct.unpack_from("<Iii", b, pos)
            self.taverns.append({"structure": s, "flags": fl, "deliveryItem": item})
            pos += 12
        for _ in range(c[7]):
            w = struct.unpack_from("<I20i", b, pos)
            self.shops.append({"structure": w[0], "shelves": list(w[1:])})
            pos += 0x54
        for _ in range(c[8]):
            s, on, act = struct.unpack_from("<Iii", b, pos)
            self.signposts.append({"structure": s, "enabled": bool(on), "actionIndex": act})
            pos += 12
        if pos != len(b):
            raise AlmError("bloco 11 com tamanho inconsistente")

    # ------------------------------------------------------------------ bloco 4
    def _decode_structures(self):
        """Tipo 4 (0x42344b): 20 bytes {x, y (24.8), tipo, u16 hp(%), dono, u16 id}; +8 bytes quando tipo == 0x21 ou
        bit 0x1000000 (pontes de tamanho variavel: largura/altura)."""
        self.structures = []
        r = self.by_type[4].body
        i = 0
        while i < len(r):
            x, y, kind, hp, owner, uid = struct.unpack_from("<IIIhIh", r, i)
            rec = {"x": x / 256, "y": y / 256, "kind": kind, "hp": hp, "owner": owner, "id": uid}
            i += 20
            if kind == 0x21 or kind & 0x1000000:
                rec["extra"] = struct.unpack_from("<II", r, i)
                i += 8
            self.structures.append(rec)
        if i != len(r):
            raise AlmError("bloco 4 com tamanho inconsistente")

    # ------------------------------------------------------------------ bloco 9
    def _decode_effects(self):
        """Tipo 9 (0x423fc2): u32 n + n registros {u32 a, u32 x, u32 y, u16 modo, u32 alvo, u16 p1, u16 p2, u32 m,
        m x (u16, u32)}. Lista compartilhada pelas "magias" de itens (x = y = 0; entradas = (modificador, valor),
        referenciada 1-based pelos itens das bolsas) e pelas armadilhas/lancamentos de estrutura (x, y = origem;
        modo 4 = "Cast from structure": o editor procura a estrutura em (x, y) e grava o id dela em `alvo`;
        entradas = posicoes (x, y) de disparo). Semantica parcial."""
        b = self.by_type[9].body
        n = struct.unpack_from("<I", b, 0)[0]
        pos = 4
        self.effects = []
        for _ in range(n):
            a, x, y, mode, target, p1, p2, m = struct.unpack_from("<IIIHIHHI", b, pos)
            pos += 26
            entries = [list(struct.unpack_from("<Hi", b, pos + 6 * k)) for k in range(m)]
            pos += 6 * m
            self.effects.append({"a": a, "x": x, "y": y, "mode": mode, "target": target, "p1": p1, "p2": p2,
                                 "entries": entries})
        if pos != len(b):
            raise AlmError("bloco 9 com tamanho inconsistente")

    # ------------------------------------------------------------------ bloco 8
    def _decode_bags(self, count):
        """Tipo 8 (0x423e30): `count` (bloco 0) bolsas/inventarios {u32 n_itens, u32 unidade (id; 0 = bolsa no chao),
        u32 x, u32 y (24.8), u32 dinheiro} + n_itens x {u32 item, u16 flag ("Wielded"?), u32 magia (1-based no bloco 9; 0 = nenhuma)}.
        A unidade dona aponta para a bolsa pelo campo `bag` (1-based) do registro de unidade."""
        b = self.by_type[8].body
        pos = 0
        self.bags = []
        for _ in range(count):
            n, unit, x, y, money = struct.unpack_from("<IIIII", b, pos)
            pos += 20
            items = []
            for _ in range(n):
                item, wield, magic = struct.unpack_from("<IHI", b, pos)
                pos += 10
                items.append({"item": item, "wielded": wield, "magic": magic})
            self.bags.append({"unit": unit, "x": x / 256, "y": y / 256, "money": money, "items": items})
        if pos != len(b):
            raise AlmError("bloco 8 com tamanho inconsistente")

    # ------------------------------------------------------------------ bloco 6
    def _decode_units(self):
        """Tipo 6 (0x42367a; versao >= 0x456 -> 48 bytes). Ordem de leitura e destino na memoria do editor:
          0  u32 x (24.8, +0x80 = centro da celula)         +0x06
          4  u32 y                                         +0x0a
          8  u16 tipo (ID de units.reg)                     +0x22
         10  u16 face (variante do tipo na tabela de monstros/humanos do jogo)   +0x26
         12  u32 flags: 0x10 = humano (radio Human/Monster) +0x168
         16  u32 quest: bit0 Quest Kill, bit1 Quest Intersept, bit2 Quest Escort, bit3 No XP for kill   +0x16c
         20  u32 serverId: id do modelo (monstro/humano) na base do jogo; o editor o casa com (tipo, face)   +0x170
         24  u32 jogador (posicao 1-based na lista do bloco 5)
         28  u32 bolsa: indice 1-based no bloco 8 (0 = sem inventario)        +0xe2 (o leitor subtrai 1)
         32  u32 direcao 0..15 (16 rumos; coluna do sprite = ((dir - 8) >> 1) & 7, codigo de desenho 0x40c7fe;
                 colocacao com "aleatorio" sorteia 0..14)                    +0x6e
         36  i16 hp, i16 hp maximo (-1 = padrao do modelo)                    +0x102, +0x106
         40  u16 id da unidade (o "unit#N" dos scripts; "Unit ID:" no dialogo); os 2 bytes altos repetem os 16 bits baixos
             de x porque o leitor le 4 bytes sobre +0x04 (artefato, ignorar)
         44  u32 grupo (o "group#N" dos scripts; 0 = sem grupo)              +0x82
        """
        self.units = []
        r = self.by_type[6].body
        if len(r) % 48:
            raise AlmError("bloco 6 com tamanho inconsistente")
        for i in range(0, len(r), 48):
            x, y, kind, face, flags, quest, server, player, bag, direction, hp, maxhp, uid, xlo, group = \
                struct.unpack_from("<IIHHIIIIIIhhHHI", r, i)
            # `raw` mantem o formato antigo "<IIhhIIIIIhhII" (usado por tools/pipeline/mission.py: raw[12] & 0xffff = id)
            raw = struct.unpack_from("<IIhhIIIIIhhII", r, i)
            self.units.append({
                "x": x / 256, "y": y / 256, "kind": kind, "player": player,
                "id": uid, "group": group, "face": face, "direction": direction,
                "spriteDir": ((direction - 8) >> 1) & 7,
                "human": bool(flags & 0x10), "flags": flags, "quest": quest, "serverId": server,
                "hp": None if hp < 0 else hp, "maxHp": None if maxhp < 0 else maxhp,
                "bag": bag or None,
                "raw": raw,
            })

    # ------------------------------------------------------------------ bloco 10
    def _decode_repops(self, count):
        """Tipo 10 (0x4241eb): `count` (bloco 0) registros de 16 bytes. So aparecem nos mapas multiplayer. Hipotese
        (dialogo "Group Repop": Repop Delay, Random Positions, Enabled, AI Instant, Quest Kill/Intersept Group):
        {grupo, atraso, flags, ?}."""
        b = self.by_type[10].body
        if len(b) != 16 * count:
            raise AlmError("bloco 10 com tamanho inconsistente")
        self.repops = [dict(zip(("group", "delay", "flags", "unk"), struct.unpack_from("<4i", b, 16 * k)))
                       for k in range(count)]

    # ------------------------------------------------------------------ bloco 12
    def _decode_music(self, count):
        """Tipo 12 (0x424251): 0x1c bytes do conjunto padrao + `count` (bloco 0) pontos de troca de musica, 7 dwords cada:
        {x, y, raio, musica 1..4 (-1 = vazio)} (dialogo "Music Change point": Radius + lista; Music.ini do jogo nomeia
        Melody1..17). Ex.: 10.alm {14, 41, 6, 1, -1, -1, -1} perto do ponto de entrada (11, 41)."""
        b = self.by_type[12].body
        if len(b) != 0x1c * (count + 1):
            raise AlmError("bloco 12 com tamanho inconsistente")
        w = struct.unpack_from("<7i", b, 0)
        self.music_default = list(w)
        self.music = []
        for k in range(count):
            w = struct.unpack_from("<7i", b, 0x1c * (k + 1))
            self.music.append({"x": w[0], "y": w[1], "radius": w[2], "themes": [t for t in w[3:] if t >= 0]})

    # ------------------------------------------------------------------ bloco 7
    def _decode_script(self):
        """Tipo 7 (0x4239d3): u32 n + n acoes de 0x31c; u32 n + n valores de 0x31c; u32 n + n gatilhos de 0xb8.

        Registro de 0x31c (acoes = "instances", valores = "checks"):
          0x000 char[0x40] nome | 0x40 u32 tipo | 0x44 u32 seq | 0x48 u32 "Execute once" (caixa dos dialogos de instancia/check)
          0x4c  i32[10] valores dos parametros | 0x74 u32[10] tipos (PARAM_TYPES) | 0x9c 10 x char[0x40] rotulos
        Gatilho de 0xb8 (46 dwords): char[0x80] nome (w0..31, resto lixo) | w32..37 tres pares (a, b) de seq de valores
          | w38..41 quatro seq de acoes | w42..44 operador de cada par (COMPARE_OPS) | w45 "Run Once" (1 = dispara uma vez).
        Nao ha campo de periodo nem de ativacao no registro (conferido no dialogo "Trigger Manager", recurso 273)."""
        b = self.by_type[7].body
        pos = 0
        lists = []
        for size in (0x31c, 0x31c, 0xb8):
            if pos + 4 > len(b):
                raise AlmError("bloco 7 truncado")
            n = struct.unpack_from("<I", b, pos)[0]
            pos += 4
            if pos + n * size > len(b):
                raise AlmError("bloco 7: lista passa do fim")
            lists.append([b[pos + k * size:pos + (k + 1) * size] for k in range(n)])
            pos += n * size
        if pos != len(b):
            raise AlmError("bloco 7: sobram %d bytes" % (len(b) - pos))

        def named(rec, index):
            kind, seq, once = struct.unpack_from("<III", rec, 0x40)
            vals = struct.unpack_from("<10i", rec, 0x4c)
            types = struct.unpack_from("<10I", rec, 0x74)
            labels = [_cstr(rec[0x9c + 0x40 * k:0xdc + 0x40 * k]) for k in range(10)]
            params = [{"slot": k, "label": labels[k], "type": types[k], "value": vals[k]}
                      for k in range(10) if labels[k] and labels[k] != "<None>"]
            return {"name": _cstr(rec[:0x40]), "kind": kind, "seq": seq, "index": index, "executeOnce": bool(once),
                    "params": params, "raw": rec}
        self.script_actions = [named(r, i) for i, r in enumerate(lists[0])]  # "Send message 1", "Drop Location"...
        self.script_values = [named(r, i) for i, r in enumerate(lists[1])]   # "Hero to ogre distance", "v70", "4"...
        self.script_triggers = []
        for r in lists[2]:
            w = struct.unpack("<46I", r)
            self.script_triggers.append({
                "name": _cstr(r[:0x80]),
                # ate 3 comparacoes "valor[a] OP valor[b]" (a, b = seq na lista de valores; a == 0 = vazio); todas precisam ser verdadeiras
                "conditions": [{"a": w[32 + 2 * k], "b": w[33 + 2 * k], "op": w[42 + k]} for k in range(3) if w[32 + 2 * k]],
                "actions": [x for x in w[38:42] if x],           # seq na lista de acoes, executadas em ordem
                "once": w[45] == 1,                              # caixa "Run Once" do dialogo (0 = repete enquanto valer)
                "enabled": w[45],                                # nome antigo do mesmo campo (compatibilidade)
                "raw": r,
            })

    # ------------------------------------------------------------------ utilidades
    def unit_by_id(self):
        return {u["id"]: i for i, u in enumerate(self.units)}

    def drop_locations(self):
        """Acoes "Drop Location" (tipo 65538): onde o grupo do heroi entra no mapa."""
        out = []
        for a in self.script_actions:
            if a["kind"] == 65538:
                p = {q["type"]: q["value"] for q in a["params"]}
                out.append({"x": p.get(5), "y": p.get(6), "action": a["seq"], "name": a["name"]})
        return out


def render_png(alm, path, scale=8):
    from PIL import Image, ImageDraw
    w, h = alm.width, alm.height
    lo, hi = min(alm.altitude), max(alm.altitude)
    img = Image.new("RGB", (w, h))
    img.putdata([((v - lo) * 255 // max(1, hi - lo),) * 3 for v in alm.altitude])
    img = img.resize((w * scale, h * scale), Image.NEAREST)
    d = ImageDraw.Draw(img)
    colors = [(255, 255, 255), (255, 0, 0), (0, 200, 0), (0, 128, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255), (255, 128, 0), (160, 100, 255)]
    for u in alm.units:
        c = colors[u["player"] % len(colors)]
        x, y = u["x"] * scale, u["y"] * scale
        d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=c, outline=(0, 0, 0))
    for s in alm.structures:
        x, y = s["x"] * scale, s["y"] * scale
        d.rectangle((x - 5, y - 5, x + 5, y + 5), outline=(255, 255, 0), width=2)
    for p in alm.drop_locations():
        x, y = (p["x"] + 0.5) * scale, (p["y"] + 0.5) * scale
        d.line((x - 6, y - 6, x + 6, y + 6), fill=(255, 0, 0), width=2)
        d.line((x - 6, y + 6, x + 6, y - 6), fill=(255, 0, 0), width=2)
    img.save(path)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    m = Alm(open(a[0], "rb").read())
    print("versao 0x%x  mapa %dx%d  blocos: %s" % (m.version, m.width, m.height, [b.type for b in m.blocks]))
    print("jogadores:", [p["name"] for p in m.players])
    print("unidades: %d  grupos: %d  estruturas: %d  bolsas: %d  placas: %d  musica: %d" % (
        len(m.units), len(m.groups), len(m.structures), len(m.bags), len(m.signposts), len(m.music)))
    print("entrada do heroi:", m.drop_locations())
    if "--units" in a:
        for i, u in enumerate(m.units):
            print("  #%-3d id=%-4d grupo=%-3d tipo=%-3d face=%d jogador=%d (%.1f, %.1f) dir=%d server=%d%s%s" % (
                i, u["id"], u["group"], u["kind"], u["face"], u["player"], u["x"], u["y"], u["direction"], u["serverId"],
                " humano" if u["human"] else "", " bolsa=%d" % u["bag"] if u["bag"] else ""))
    if "--png" in a:
        render_png(m, a[a.index("--png") + 1])
        print("png ok")
