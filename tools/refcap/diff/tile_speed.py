"""Tabela de VELOCIDADE DO TERRENO por id de tile (F do exe; passo do andar = Speed×8 / ((F[de]+F[para])>>1), notes/differential-fuzz.md).

Fonte: tabela F do objeto de caminho do original ([0x670e48] + y×256 + x) lida por export_state.py nas missões 10 e 20
(refs/trace/diff/state_m10_start.json, state_m20_start.json; 302 ids de tile, 0 inconsistências). Os ids não vistos seguem o
padrão medido: grupos de 4 arquivos de tile (arquivo = id >> 4); o 4º arquivo do grupo é o terreno puro B e os 3 primeiros são
transições A→B com peso w por linha: F = floor(A + (B − A)×w). Linhas sem medida usam w = 1/2 [est]; o grupo 8–11 (areia) usa
B = 14 (map.reg CostSand) [est].

    .venv\\Scripts\\python.exe tools/refcap/diff/tile_speed.py     → refs/trace/diff/tile_speed.json + "speed" em terrain.json
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TERRAIN = os.path.join(ROOT, "game", "public", "assets", "ui", "hud", "terrain.json")
OUT = os.path.join(ROOT, "refs", "trace", "diff", "tile_speed.json")

# (A, B) por grupo de 4 arquivos (arquivo // 4)
GROUPS = {0: (8, 8), 1: (8, 6), 2: (8, 14), 3: (8, 8), 4: (8, 12), 5: (6, 6), 6: (8, 8), 7: (12, 16),
          8: (8, 8), 9: (8, 8), 10: (8, 8), 11: (8, 8), 12: (8, 6)}
Q = None  # linha sem medida
# peso w (em quartos) por linha: arquivos 4g+0 e 4g+2 / arquivo 4g+1 (medidos nos grupos 1, 4, 7 e 12)
W02 = [1, 2, 1, 3, 2, 3, Q, 3, 1, Q, Q, 1, 3, Q, Q, Q]
W1 = [2, 4, 2, 2, 0, 2, Q, 3, 1, Q, Q, 1, 3, Q, Q, Q]


def measured() -> dict[int, int]:
    tf: dict[int, int] = {}
    for st, mis in (("m10_start", 10), ("m20_start", 20)):
        sp = os.path.join(ROOT, "refs", "trace", "diff", f"state_{st}.json")
        if not os.path.exists(sp):
            continue
        s = json.load(open(sp, encoding="utf-8"))
        m = json.load(open(os.path.join(ROOT, "game", "public", "data", "maps", f"{mis}.json"), encoding="utf-8"))
        F, w = s["terrain_speed"], m["w"]
        for y in range(m["h"]):
            for x in range(w):
                t = m["tiles"][y * w + x] & 0x1FFF
                if t in tf and tf[t] != F[y][x]:
                    raise SystemExit(f"tile {t:#x}: F {tf[t]} × {F[y][x]}")
                tf[t] = F[y][x]
    return tf


def build() -> tuple[dict[int, int], dict[int, str]]:
    meas = measured()
    table, src = {}, {}
    for f in range(52):
        a, b = GROUPS.get(f // 4, (8, 8))
        for r in range(16):
            t = f * 16 + r
            if t in meas:
                table[t], src[t] = meas[t], "medido"
                continue
            if f % 4 == 3:
                q = 4
            else:
                q = (W1 if f % 4 == 1 else W02)[r]
            est = q is None
            q = 2 if q is None else q
            table[t] = (a * 4 + (b - a) * q) // 4
            src[t] = "est" if est or (f // 4 == 2 and a != b) else "padrão"
    # confere o modelo contra o medido
    bad = []
    for t, v in meas.items():
        f, r = t >> 4, t & 15
        a, b = GROUPS.get(f // 4, (8, 8))
        q = 4 if f % 4 == 3 else (W1 if f % 4 == 1 else W02)[r]
        if q is not None and (a * 4 + (b - a) * q) // 4 != v:
            bad.append((hex(t), v))
    if bad:
        print("modelo × medido divergem:", bad[:10])
    return table, src


def main():
    table, src = build()
    from collections import Counter
    print("tiles:", len(table), Counter(src.values()))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"note": __doc__.strip().split("\n")[0], "speed": {str(k): v for k, v in table.items()},
               "source": {str(k): v for k, v in src.items()}}, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    terr = json.load(open(TERRAIN, encoding="utf-8"))
    terr["speed"] = {str(k): v for k, v in table.items()}
    terr["speedNote"] = "F por id de tile (exe [0x670e48]; passo = Speed×8/((F[de]+F[para])>>1) ± altura) — tools/refcap/diff/tile_speed.py"
    json.dump(terr, open(TERRAIN, "w", encoding="utf-8"), separators=(",", ":"))
    print("ok:", OUT, TERRAIN)


if __name__ == "__main__":
    main()
