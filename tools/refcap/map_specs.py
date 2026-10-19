"""Gera (idempotente) os cenarios do mapa-mundi Yases com TODOS os locais (frente FIDELIDADE-RESTO, 19/10).

    python tools/refcap/original/build_map_states.py     # estados kaarg_all / druids_all do original
    python tools/refcap/map_specs.py
    python tools/refcap/original/run_groups.py --group gm_kaarg --group gm_druids
    python tools/refcap/run_all.py --only gm_k_30,... -- --out docs/COMPARE/resto --shift 0

Um cenario por destino: o mouse sobre a bandeira do local (o original mostra titulo, descricao e a trilha ate ele). Posicoes do mapa =
`MISSION_POS` de tools/refcap/original/states.py (bitmap 640x480); a bandeira (20x24) fica em (x-10, y-24) e o clique/mouse usa o meio dela.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(HERE, "scenarios.json")
OX, OY = 192, 144
MISSION_POS = {10: (302, 158), 20: (380, 364), 21: (423, 367), 30: (331, 395), 31: (443, 225), 32: (457, 202),
               40: (339, 226), 41: (403, 228), 42: (531, 207), 43: (454, 358), 50: (210, 260), 51: (450, 240),
               52: (132, 303), 53: (292, 191), 60: (511, 301), 61: (475, 312), 62: (253, 169), 63: (385, 221),
               70: (86, 193), 71: (337, 306), 72: (530, 255), 73: (343, 347), 80: (554, 299), 90: (283, 244),
               100: (388, 140), 110: (448, 140)}
TOWN_POS = {2: (370, 305), 3: (194, 225)}
GATES = {2: (377, 441), 3: (272, 476)}
STATES = {"k": dict(town=2, other=3, stage=30, state="kaarg_all", group="gm_kaarg"), "d": dict(town=3, other=2, stage=60, state="druids_all", group="gm_druids")}


def build():
    out = []
    for key, c in STATES.items():
        locs = [["T", c["town"]], ["T", c["other"]]] + [["M", m] for m in sorted(MISSION_POS)]
        targets = [("t%d" % c["other"], TOWN_POS[c["other"]])] + [(str(m), MISSION_POS[m]) for m in sorted(MISSION_POS)]
        for i, (tid, (x, y)) in enumerate(targets):
            mx, my = OX + x, OY + y - 12
            gate = GATES[c["town"]]
            out.append(dict(id=f"gm_{key}_{tid}", desc=f"Mapa-mundi ({'Kaarg' if key == 'k' else 'acampamento'}, todos os locais): mouse sobre {tid}",
                            scene="globalmap", gmap=dict(town=c["town"], stage=c["stage"], locs=locs), mouse=[mx, my],
                            orig_group=c["group"], orig_start=c["state"],
                            orig_pre=f"click:{gate[0]},{gate[1]} wait:3", orig_steps=f"move:{mx},{my} wait:1"))
    return out


def main():
    d = json.load(open(SC, encoding="utf-8"))
    new = build()
    ids = {s["id"] for s in new}
    d["scenarios"] = [s for s in d["scenarios"] if s["id"] not in ids] + new
    json.dump(d, open(SC, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(new)} cenarios gerados; total {len(d['scenarios'])}")


if __name__ == "__main__":
    main()
