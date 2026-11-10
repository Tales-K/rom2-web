"""Gerador de ROTEIROS de ações com semente para o teste diferencial (fase 3; notes/differential-fuzz.md).

    .venv\\Scripts\\python.exe tools/refcap/diff/gen_script.py --state refs/trace/diff/state_m10_start.json --seed 1 --ticks 960 [--out s.json]

Parte do estado exportado do original (export_state.py) e sorteia só ações LEGAIS para o herói, em tiques do servidor (16/s):
  move   → célula a 3–8 do herói, passável pelo terreno (terrain.json: classes bloqueadas) e livre de unidades no estado;
  attack → unidade viva de jogador em GUERRA com o do herói (diplomacia do estado, bit 0) a ≤ 14 células;
  cast   → magia do livro com custo ≤ mana do estado: defensiva (Heal/Shield/Bless/Haste/proteções...) no próprio herói, ofensiva num
           inimigo como acima;
  stop   → parar.
Intervalo entre ações: 16–64 tiques (1–4 s). O formato é o do original_episode.py ({"t", "do", "unit": "hero", ...}).
"""
from __future__ import annotations

import argparse
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DEFENSIVE = {4, 8, 13, 19, 20, 21, 24, 27, 12}       # proteções, Bless, Haste, Heal, Shield, Invisibility (spells.json)


def load_map(mission: int):
    m = json.load(open(os.path.join(ROOT, "game", "public", "data", "maps", f"{mission}.json"), encoding="utf-8"))
    terr = json.load(open(os.path.join(ROOT, "game", "public", "assets", "ui", "hud", "terrain.json"), encoding="utf-8"))
    blocked = {terr["classes"].index(c) for c in terr["blocked"]}
    w, h = m["w"], m["h"]
    walk = [[terr["tile"].get(str(m["tiles"][y * w + x] & 0x1FFF), 0) not in blocked and 0 < x < w - 1 and 0 < y < h - 1
             for x in range(w)] for y in range(h)]
    for ox, oy, _ in m.get("objs", []):
        pass  # objetos de cenário: nem todos bloqueiam (grid.ts objectBlocks); a ação inválida vira "sem caminho" nos dois lados
    return w, h, walk


def generate(st: dict, seed: int, ticks: int) -> list[dict]:
    rnd = random.Random(seed)
    hero = next(u for u in st["units"] if u["id"] == st["hero"])
    w, h, walk = load_map(st["mission"])
    occ = {(u["x"], u["y"]) for u in st["units"] if u["state"] != 0x10}
    dip = st.get("diplomacy") or []

    def war(p, q):
        try:
            return bool(dip[p][q] & 1)
        except (IndexError, TypeError):
            return p != q
    enemies = [u for u in st["units"] if u["state"] != 0x10 and u["hp"] > 0 and u["id"] != hero["id"] and war(hero["player"], u["player"])]
    book = [b for b in hero.get("book", []) if b["mana"] <= max(hero["mana"], 0)]
    acts, t = [], rnd.randint(0, 16)
    hx, hy = hero["x"], hero["y"]
    while t < ticks - 16:
        r = rnd.random()
        near = [e for e in enemies if max(abs(e["x"] - hx), abs(e["y"] - hy)) <= 14]
        if r < 0.4 or (r < 0.7 and not near):
            for _ in range(40):
                d = rnd.randint(3, 8)
                x, y = hx + rnd.randint(-d, d), hy + rnd.randint(-d, d)
                if 0 <= x < w and 0 <= y < h and walk[y][x] and (x, y) not in occ:
                    acts.append({"t": t, "do": "move", "unit": "hero", "x": x, "y": y})
                    hx, hy = x, y                 # posição esperada (o roteiro não sabe onde o herói está de fato)
                    break
        elif r < 0.7:
            e = rnd.choice(near)
            acts.append({"t": t, "do": "attack", "unit": "hero", "target": e["id"]})
            hx, hy = e["x"], e["y"]
        elif r < 0.9 and book:
            s = rnd.choice(book)
            if s["id"] in DEFENSIVE or not near:
                if s["id"] in DEFENSIVE:
                    acts.append({"t": t, "do": "cast", "unit": "hero", "spell": s["id"], "target": "hero"})
            else:
                acts.append({"t": t, "do": "cast", "unit": "hero", "spell": s["id"], "target": rnd.choice(near)["id"]})
        else:
            acts.append({"t": t, "do": "stop", "unit": "hero"})
        t += rnd.randint(16, 64)
    return acts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--ticks", type=int, default=960)
    ap.add_argument("--out")
    a = ap.parse_args()
    st = json.load(open(a.state, encoding="utf-8"))
    acts = generate(st, a.seed, a.ticks)
    txt = json.dumps({"actions": acts, "state": st.get("state"), "seed": a.seed}, indent=0)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(txt)
    else:
        print(txt)


if __name__ == "__main__":
    main()
