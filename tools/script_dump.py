"""Imprime o script de uma missao (.alm) em forma legivel.

Uso:  python tools/script_dump.py <mapa.alm> [--ini <pasta do jogo>]

Mostra jogadores, valores (condicoes/variaveis/constantes), acoes e gatilhos "IF ... THEN ...".
Nomes de tipos de acao/condicao vem de 'Description Instants.ini' / 'Description Checks.ini' do jogo.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alm import Alm, PARAM_TYPES  # noqa: E402
import descriptions  # noqa: E402

# ordem dos botoes de radio do dialogo "Trigger Manager" do editor (corrige COMPARE_OPS de alm.py nos codigos 3/4/5)
COMPARE_OPS = {0: "==", 1: "!=", 2: ">", 3: "<", 4: ">=", 5: "<="}


def fmt_param(p, players):
    t = PARAM_TYPES.get(p["type"], "t%d" % p["type"])
    v = p["value"]
    if t == "player":
        names = {pl["index"]: pl["name"] for pl in players}
        return "%s=player#%d(%s)" % (p["label"], v, names.get(v, "?"))
    if t in ("group", "unit"):
        return "%s=%s#%d" % (p["label"], t, v)
    if t in ("x", "y"):
        return "%s=%s:%d" % (p["label"], t, v)
    return "%s=%d" % (p["label"], v)


def describe(rec, table, players):
    kind = table.get(rec["kind"], {}).get("name", "kind %d" % rec["kind"])
    return "%s(%s)" % (kind, ", ".join(fmt_param(p, players) for p in rec["params"]))


def dump(path, game):
    m = Alm(open(path, "rb").read())
    I, C = descriptions.instants(game), descriptions.checks(game)
    V = {v["seq"]: v for v in m.script_values}
    A = {a["seq"]: a for a in m.script_actions}
    print("# %s  %dx%d  versao 0x%x" % (os.path.basename(path), m.width, m.height, m.version))
    print("\n## Jogadores")
    for p in m.players:
        print("  #%d %s" % (p["index"], p["name"]))
    print("\n## Valores (condicoes, variaveis, constantes)")
    for v in m.script_values:
        print("  v%-3d %-34s = %s" % (v["seq"], v["name"], describe(v, C, m.players)))
    print("\n## Acoes")
    for a in m.script_actions:
        print("  a%-3d %-40s = %s" % (a["seq"], a["name"], describe(a, I, m.players)))
    print("\n## Gatilhos")
    for t in m.script_triggers:
        conds = " AND ".join("[%s] %s [%s]" % (V[c["a"]]["name"] if c["a"] in V else "v%d?" % c["a"],
                                               COMPARE_OPS.get(c["op"], "op%d" % c["op"]),
                                               V[c["b"]]["name"] if c["b"] in V else "v%d?" % c["b"]) for c in t["conditions"])
        acts = ", ".join(A[x]["name"] if x in A else "a%d?" % x for x in t["actions"])
        print("  %s%s\n      IF   %s\n      THEN %s" % (t["name"], "" if t["enabled"] else "  (repete: Run Once desligado)", conds or "(sempre)", acts or "(nada)"))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    dump(a[0], a[a.index("--ini") + 1] if "--ini" in a else descriptions.GAME)
