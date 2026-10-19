"""Exporta o script estruturado das missoes e os mapas para o jogo (contrato em docs/DATA.md, secao MAPAS-RE).

Gera:
  game/public/data/scripts/<missao>.json   script do bloco 7 com todas as referencias resolvidas (46 missoes do scenario.res)
  game/public/data/maps/<nome>.json        mapas (57: 46 missoes + 11 multiplayer "mp_<nome>") com os campos extras

Uso: .venv/Scripts/python.exe tools/alm_export.py [--only 10] [--scripts-only | --maps-only] [--extracted <pasta>] [--game <pasta>]
Os arquivos gerados contem dados do jogo: uso local apenas, nao redistribuir.
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import descriptions  # noqa: E402
from alm import Alm, COMPARE_OPS, GROUP_COMMANDS, PARAM_TYPES, SPECIAL_UNITS, DIPLOMACY  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME_DATA = os.path.join(ROOT, "game", "public", "data")
EXTRACTED = r"C:\Users\TALES K\Games\allods2-extracted"
HERO_UNIT_ID = 10001

# tipos de registro com nome fixo que o .ini nao resolve (varios grupos do .ini dividem o mesmo ID)
SPECIAL_ACTION_KINDS = {65538: "Drop Location", 65539: "Outpost (Repopper)", 65540: "Change next music to"}


def kind_name(rec, table, is_action):
    k = rec["kind"]
    if is_action and k == 6:
        c = rec["params"][0]["value"] if rec["params"] else -1
        return "Group Command : " + GROUP_COMMANDS.get(c, "const %d" % c)
    if is_action and k in SPECIAL_ACTION_KINDS:
        return SPECIAL_ACTION_KINDS[k]
    if not is_action and k == 65538:
        p = rec["params"][0] if rec["params"] else None
        if p and p["type"] == 7:
            return "TRUE" if p["value"] else "FALSE"
        return "Constant Value"
    return table.get(k, {}).get("name", "kind %d" % k)


class Resolver:
    """Liga os parametros do script aos objetos do mapa."""

    def __init__(self, m):
        self.m = m
        self.unit_index = m.unit_by_id()
        self.struct_index = {s["id"]: i for i, s in enumerate(m.structures)}
        self.players = {p["index"]: p["name"] for p in m.players}

    def ref(self, p):
        t = PARAM_TYPES.get(p["type"], "t%d" % p["type"])
        v = p["value"]
        if t == "unit":
            if v in SPECIAL_UNITS:
                return {"special": SPECIAL_UNITS[v]}
            if v in self.unit_index:
                i = self.unit_index[v]
                u = self.m.units[i]
                return {"unitIndex": i, "kind": u["kind"], "player": u["player"]}
            return {"unresolved": True}
        if t == "group":
            if v in self.m.groups:
                return {"units": self.m.groups[v]}
            return {"unresolved": True}
        if t == "player":
            if v in self.players:
                return {"playerName": self.players[v]}
            return {"unresolved": True}
        if t == "structure":
            if v in self.struct_index:
                i = self.struct_index[v]
                return {"structureIndex": i, "kind": self.m.structures[i]["kind"]}
            return {"unresolved": True}
        return None


def record_json(rec, table, is_action, res):
    params = []
    for p in rec["params"]:
        q = {"slot": p["slot"], "label": p["label"], "type": PARAM_TYPES.get(p["type"], "t%d" % p["type"]),
             "typeCode": p["type"], "value": p["value"]}
        r = res.ref(p)
        if r is not None:
            q["ref"] = r
        params.append(q)
    out = {"seq": rec["seq"], "index": rec["index"], "name": rec["name"], "kind": rec["kind"],
           "kindName": kind_name(rec, table, is_action), "params": params}
    if rec["executeOnce"]:
        out["executeOnce"] = True
    if is_action:
        if rec["kind"] == 2 and params:          # Send message N -> texts/mission<M>.json secao event<N>
            out["text"] = "event%d" % params[0]["value"]
        elif rec["kind"] == 5 and params:        # Force "Mission Fail" state(Cause N) -> secao failure<N>
            out["text"] = "failure%d" % params[0]["value"]
        if rec["kind"] == 6:
            g = next((q for q in params if q["type"] == "group"), None)
            if g:
                out["group"] = g["value"]
    return out


def group_names(m):
    """Nome do grupo = nome do primeiro valor/acao do script que o referencia (o .alm nao guarda nome de grupo)."""
    names = {}
    for rec in m.script_values + m.script_actions:
        for p in rec["params"]:
            if p["type"] == 2 and p["value"] not in names:
                names[p["value"]] = rec["name"]
    return names


def unit_json(i, u):
    d = {"index": i, "id": u["id"], "group": u["group"] or None, "kind": u["kind"], "player": u["player"],
         "x": u["x"], "y": u["y"], "face": u["face"], "direction": u["direction"], "spriteDir": u["spriteDir"],
         "human": u["human"], "serverId": u["serverId"]}
    if u["hp"] is not None:
        d["hp"] = u["hp"]
    if u["maxHp"] is not None:
        d["maxHp"] = u["maxHp"]
    if u["quest"]:
        d["quest"] = {"kill": bool(u["quest"] & 1), "intercept": bool(u["quest"] & 2), "escort": bool(u["quest"] & 4),
                      "noXp": bool(u["quest"] & 8)}
    if u["bag"]:
        d["bag"] = u["bag"] - 1          # indice 0-based em bags[]
    return d


def players_json(m):
    out = []
    for p in m.players:
        n = len(m.players)
        out.append({"index": p["index"], "id": p["index"], "name": p["name"], "color": p["id"], "computer": p["computer"],
                    "money": p["money"],
                    # diplomacy[j] = relacao deste jogador com o jogador j+1: 0 neutro, 1 inimigo, 2 aliado; vision = bit 0x10
                    "diplomacy": [d & 3 for d in p["diplomacy"][:n]],
                    "vision": [bool(d & 0x10) for d in p["diplomacy"][:n]]})
    return out


def points_json(m):
    """Pontos/areas citados pelo script (coordenadas em celulas). `radius` vem da constante comparada no gatilho
    (ex.: [Hero to bridge distance] < [2] -> raio 2) ou do proprio parametro (circulo, ponto de musica)."""
    V = {v["seq"]: v for v in m.script_values}
    const = {}
    for t in m.script_triggers:
        for c in t["conditions"]:
            a, b = V.get(c["a"]), V.get(c["b"])
            if a and b and b["kind"] == 65538 and b["params"]:
                const.setdefault(a["seq"], (COMPARE_OPS.get(c["op"], "?"), b["params"][0]["value"]))
    out = []
    for is_action, lst in ((False, m.script_values), (True, m.script_actions)):
        for rec in lst:
            ps = rec["params"]
            xs = [p for p in ps if p["type"] == 5]
            ys = [p for p in ps if p["type"] == 6]
            if not xs:
                continue
            base = {"source": "action" if is_action else "value", "seq": rec["seq"], "name": rec["name"], "kind": rec["kind"]}
            if not is_action and rec["kind"] == 2 and len(xs) >= 2:      # Is unit in a box
                out.append(dict(base, shape="box", x=xs[0]["value"], y=ys[0]["value"], x2=xs[1]["value"], y2=ys[1]["value"]))
                continue
            for k, (px, py) in enumerate(zip(xs, ys)):
                d = dict(base, shape="point", x=px["value"], y=py["value"], label=px["label"])
                ints = [p for p in ps if p["type"] == 1]
                if not is_action and rec["kind"] == 3 and ints:          # Is unit in a circle
                    d["shape"], d["radius"] = "circle", ints[0]["value"]
                elif not is_action and rec["seq"] in const:
                    op, r = const[rec["seq"]]
                    d["shape"], d["radius"], d["op"] = "circle", r, op
                elif is_action and rec["kind"] == 65538:
                    d["role"] = "heroEntry"
                out.append(d)
    return out


def script_json(m, mission, I, C):
    res = Resolver(m)
    gnames = group_names(m)
    triggers = []
    for i, t in enumerate(m.script_triggers):
        w = list(struct.unpack("<46I", t["raw"]))
        triggers.append({
            "index": i, "name": t["name"], "enabled": True, "once": t["once"],
            "conditions": [{"a": c["a"], "b": c["b"], "op": COMPARE_OPS.get(c["op"], "=="), "opCode": c["op"]}
                           for c in t["conditions"]],
            "actions": t["actions"],
            # w[0..31] nome + lixo de memoria; w32..37 pares; w38..41 acoes; w42..44 operadores; w45 Run Once
            "raw": w,
        })
    actions_by_index = {a["index"]: a["seq"] for a in m.script_actions}
    return {
        "mission": mission, "source": "tools/alm_export.py",
        "values": [record_json(v, C, False, res) for v in m.script_values],
        "actions": [record_json(a, I, True, res) for a in m.script_actions],
        "triggers": triggers,
        "units": [unit_json(i, u) for i, u in enumerate(m.units)],
        "groups": [dict({"id": g, "units": us}, **({"name": gnames[g]} if g in gnames else {}))
                   for g, us in sorted(m.groups.items())],
        "heroUnitId": HERO_UNIT_ID,
        "specialUnits": {str(k): v for k, v in SPECIAL_UNITS.items()},
        "players": players_json(m),
        "structures": [{"index": i, "id": s["id"], "kind": s["kind"], "x": s["x"], "y": s["y"], "owner": s["owner"],
                        "hp": s["hp"]} for i, s in enumerate(m.structures)],
        # "Drop Location" (acao 65538) nunca e chamada por gatilho: e o marcador estatico de onde o grupo do heroi entra
        "dropLocations": m.drop_locations(),
        "heroEntry": ({"x": m.drop_locations()[0]["x"], "y": m.drop_locations()[0]["y"]} if m.drop_locations() else None),
        "signposts": [dict(s, action=actions_by_index.get(s["actionIndex"])) for s in m.signposts],
        "bags": m.bags,
        "points": points_json(m),
        "texts": "texts/mission%d.json" % mission,
    }


def map_json(m, name, source, I, C):
    """Mapa no contrato antigo (campos atuais mantidos) + campos extras."""
    V = {v["seq"]: v for v in m.script_values}
    A = {a["seq"]: a for a in m.script_actions}
    gnames = group_names(m)
    d = {
        "name": name, "source": source, "w": m.width, "h": m.height, "version": m.version,
        "tiles": [t & 0x1fff for t in m.tiles],
        "tileFlags": sum(1 for t in m.tiles if t & 0x2000),
        "alt": m.altitude,
        # bloco 3: id do objeto de cenario + 1 por celula (0 = vazio) -> lista [x, y, id]
        "objs": [[i % m.width, i // m.width, v - 1] for i, v in enumerate(m.flags) if v],
        "players": players_json(m),
        "units": [unit_json(i, u) for i, u in enumerate(m.units)],
        "structures": [{k: v for k, v in s.items()} for s in m.structures],
        "values": [{"seq": v["seq"], "name": v["name"], "text": describe(v, C, False, m.players)} for v in m.script_values],
        "actions": [{"seq": a["seq"], "name": a["name"], "text": describe(a, I, True, m.players)} for a in m.script_actions],
        "triggers": [{
            "name": t["name"], "enabled": t["enabled"], "once": t["once"],
            "if": [{"a": V[c["a"]]["name"] if c["a"] in V else "?", "op": COMPARE_OPS.get(c["op"], str(c["op"])),
                    "b": V[c["b"]]["name"] if c["b"] in V else "?"} for c in t["conditions"]],
            "then": [A[x]["name"] if x in A else "?" for x in t["actions"]],
        } for t in m.script_triggers],
        # extras (MAPAS-RE)
        "info": m.info,
        "groups": [dict({"id": g, "units": us}, **({"name": gnames[g]} if g in gnames else {}))
                   for g, us in sorted(m.groups.items())],
        "heroEntry": m.drop_locations(),
        "points": points_json(m),
        "signposts": m.signposts,
        "bags": m.bags,
        "music": m.music, "musicDefault": m.music_default,
        "effects": m.effects,
    }
    if m.taverns:
        d["taverns"] = m.taverns
    if m.shops:
        d["shops"] = m.shops
    if m.repops:
        d["repops"] = m.repops
    return d


def describe(rec, table, is_action, players):
    """Texto legivel de um valor/acao (como tools/script_dump.py, mas com o nome certo dos comandos de grupo)."""
    names = {pl["index"]: pl["name"] for pl in players}
    parts = []
    for p in rec["params"]:
        t, v = PARAM_TYPES.get(p["type"], "t%d" % p["type"]), p["value"]
        if t == "player":
            parts.append("%s=player#%d(%s)" % (p["label"], v, names.get(v, "?")))
        elif t in ("group", "unit", "item", "structure"):
            parts.append("%s=%s#%d" % (p["label"], t, v))
        elif t in ("x", "y"):
            parts.append("%s=%s:%d" % (p["label"], t, v))
        else:
            parts.append("%s=%d" % (p["label"], v))
    return "%s(%s)" % (kind_name(rec, table, is_action), ", ".join(parts))


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d  # noqa: E731
    extracted = opt("--extracted", EXTRACTED)
    game = opt("--game", descriptions.GAME)
    only = opt("--only", None)
    I, C = descriptions.instants(game), descriptions.checks(game)
    sources = [(os.path.join(extracted, "scenario"), "scenario")]
    if only is None:
        sources.append((game, "multiplayer"))
    n_s = n_m = 0
    for folder, source in sources:
        for f in sorted(os.listdir(folder), key=lambda s: (len(s), s.lower())):
            if not f.lower().endswith(".alm"):
                continue
            stem = os.path.splitext(f)[0]
            if only is not None and stem != only:
                continue
            m = Alm(open(os.path.join(folder, f), "rb").read())
            name = stem if source == "scenario" else "mp_" + stem
            if "--maps-only" not in a and source == "scenario":
                write(os.path.join(GAME_DATA, "scripts", stem + ".json"), script_json(m, int(stem), I, C))
                n_s += 1
            if "--scripts-only" not in a:
                write(os.path.join(GAME_DATA, "maps", name + ".json"), map_json(m, name, source, I, C))
                n_m += 1
    print("scripts:", n_s, " mapas:", n_m)


if __name__ == "__main__":
    main()
