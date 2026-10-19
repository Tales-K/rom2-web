"""Le 'Description Instants.ini' (acoes) e 'Description Checks.ini' (condicoes) que acompanham o jogo.
Cada [GroupN] tem Name, ID e parametros ParK_NAME / ParK_Value (int, X, Y, Target_Unit, Target_Group, Target_Player, EnumN)."""
import configparser

GAME = r"C:\GOG Games\Rage of Mages II"


def load(path):
    cp = configparser.RawConfigParser(strict=False, inline_comment_prefixes=None)
    cp.optionxform = str
    with open(path, encoding="latin-1") as fh:
        cp.read_file(fh)
    out = {}
    for sec in cp.sections():
        if not sec.startswith("Group"):
            continue
        d = dict(cp.items(sec))
        params = []
        k = 0
        while "Par%d_NAME" % k in d:
            p = {"name": d["Par%d_NAME" % k], "type": d.get("Par%d_Value" % k) or d.get("Par%d_Type" % k, "?")}
            if p["type"].startswith("Enum"):
                p["enum"] = list(zip((x.strip() for x in d.get(p["type"] + "_NAME", "").split(",")),
                                     (x.strip() for x in d.get(p["type"] + "_Value", "").split(","))))
            params.append(p)
            k += 1
        out[int(d["ID"])] = {"name": d["Name"], "params": params, "section": sec}
    return out


def instants(game=GAME):
    return load(game + r"\Description Instants.ini")


def checks(game=GAME):
    return load(game + r"\Description Checks.ini")
