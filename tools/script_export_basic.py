"""Exporta o script das missoes (.alm, bloco 7) para JSON no formato de docs/DATA.md (scripts/<missao>.json).

Uso:  python tools/script_export_basic.py [--out <pasta>] [mapa.alm ...]
      (sem mapas: as 46 missoes de allods2-extracted/scenario; saida padrao: game/src/script/test/fixtures/)

E a versao "basica" da frente SCRIPT, usada pelos testes do motor de script (game/src/script/test/) enquanto o
JSON oficial da frente MAPAS-RE (game/public/data/scripts/<n>.json) nao existe. Diferencas conhecidas:
- operadores: usa a ordem dos botoes de radio do dialogo "Trigger Manager" do editor
  ("=", "!=", ">", "<", ">=", "<="), que difere de COMPARE_OPS em tools/alm.py nos codigos 3/4/5 (ver docs/SCRIPT_HOST.md);
- `once` = w[45] do registro de gatilho (caixa "Run Once" do mesmo dialogo); `enabled` sempre true;
- unidades: id = (dword 10 do registro de 48 bytes) & 0xffff, grupo = dword 11 (confirmado em 10.alm: ogro id 5 grupo 3,
  Skrakan id 32, dragao id 36, 4o troll id 23, 1o troll id 24 grupo 11);
- comandos de grupo (acao tipo 6): o grupo-alvo (Par9 do .ini) fica em types[0] do registro; exportado como parametro extra
  {"label": "Group", "type": "group", "slot": 9}.
"""
import glob
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alm import Alm, PARAM_TYPES  # noqa: E402
import descriptions  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENARIO = r"C:\Users\TALES K\Games\allods2-extracted\scenario"
OUT = os.path.join(ROOT, "game", "src", "script", "test", "fixtures")

# ordem dos botoes de radio no dialogo do editor (recurso de dialogo em ROM2 Map Editor.exe, ~0x106708)
OPS = {0: "==", 1: "!=", 2: ">", 3: "<", 4: ">=", 5: "<="}

GROUP_COMMANDS = {1: "Guard", 2: "Swarm", 3: "Stand Ground", 4: "Move", 5: "Swarm 2", 10: "Attack", 11: "Defend",
                  14: "Patrol", 15: "Follow", 17: "Roam", 18: "Dwell"}


def kind_name(table, rec, is_action):
    k = rec["kind"]
    if is_action and k == 6:
        c = rec["params"][0]["value"] if rec["params"] else -1
        return "Group Command : " + GROUP_COMMANDS.get(c, "const %d" % c)
    if not is_action and k == 65538:
        return "Constant Value"
    if is_action and k == 65538:
        return "Drop Location"
    return table.get(k, {}).get("name", "kind %d" % k)


def record(rec, table, is_action):
    params = [{"label": p["label"], "type": PARAM_TYPES.get(p["type"], "t%d" % p["type"]), "value": p["value"]}
              for p in rec["params"]]
    if is_action and rec["kind"] == 6:
        g = struct.unpack_from("<I", rec["raw"], 0x70)[0]
        if not any(p["type"] == "group" for p in params):
            params.append({"label": "Group", "type": "group", "value": g, "slot": 9})
    return {"seq": rec["seq"], "name": rec["name"], "kind": rec["kind"], "kindName": kind_name(table, rec, is_action),
            "params": params}


def export(path, I, C):
    m = Alm(open(path, "rb").read())
    mission = int(os.path.splitext(os.path.basename(path))[0])
    units, groups = [], {}
    b = m.by_type[6].body
    for i in range(0, len(b), 48):
        w = struct.unpack_from("<12I", b, i)
        idx = i // 48
        uid, grp = w[10] & 0xffff, w[11]
        units.append({"index": idx, "id": uid, "group": grp or None, "kind": w[2] & 0xffff, "player": w[6],
                      "x": w[0] / 256, "y": w[1] / 256})
        if grp:
            groups.setdefault(grp, []).append(idx)
    triggers = []
    for t in m.script_triggers:
        w = list(struct.unpack("<46I", t["raw"]))
        triggers.append({
            "name": t["name"], "enabled": True, "once": w[45] == 1,
            "conditions": [{"a": c["a"], "b": c["b"], "op": OPS.get(c["op"], "=="), "opCode": c["op"]} for c in t["conditions"]],
            "actions": t["actions"], "raw": w,
        })
    return {
        "mission": mission, "source": "tools/script_export_basic.py",
        "values": [record(v, C, False) for v in m.script_values],
        "actions": [record(a, I, True) for a in m.script_actions],
        "triggers": triggers,
        "units": units,
        "groups": [{"id": g, "units": us} for g, us in sorted(groups.items())],
        "heroUnitId": 10001,
        "players": [{"index": p["index"], "name": p["name"]} for p in m.players],
    }


def main():
    a = sys.argv[1:]
    out = OUT
    if "--out" in a:
        k = a.index("--out")
        out = a[k + 1]
        del a[k:k + 2]
    files = a or sorted(glob.glob(os.path.join(SCENARIO, "*.alm")))
    I, C = descriptions.instants(), descriptions.checks()
    os.makedirs(out, exist_ok=True)
    for f in files:
        d = export(f, I, C)
        with open(os.path.join(out, "%d.json" % d["mission"]), "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, separators=(",", ":"))
    print("%d scripts -> %s" % (len(files), out))


if __name__ == "__main__":
    main()
