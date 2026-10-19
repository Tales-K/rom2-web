"""Cenarios da TAVERNA do acampamento druida no estado derivado druids_60 (frente FIDELIDADE-RESTO, 19/10).

    python tools/refcap/druid_specs.py
    python tools/refcap/original/run_groups.py --group dr_inn
    python tools/refcap/run_all.py --only dr_inn,dr_inn_hover_talk,dr_inn_hover_exit -- --out docs/COMPARE/resto --shift 0

POR QUE O ORIGINAL DERRUBAVA (tools/refcap/original/crashdbg.py, depurador mínimo; 0xC0000005 em 0x495dde): o laco do jogo chama a cada quadro
o tratador de "passar o mouse" (0x4268c4 -> funcao virtual 0x495bfd); quando o cursor está sobre a faixa dos frequentadores da taverna, ele lê o
frequentador sob o ponto na lista (`[ebp-0x2c]`, inicializado com 0) e dereferencia `[eax+0x1b8]` SEM testar nulo. No save derivado a taverna
dos druidas não tem frequentador nenhum (a lista está vazia; as variaveis dos mercenarios/tagarelas ficaram zeradas), entao o jogo cai quando o
mouse fica sobre a faixa (clicar na taverna com o cursor em (339,376) deixa o ponteiro ali). NAO e falha do nosso jogo nem do harness: e um bug
do exe com lista vazia. Contorno: entrar pela borda superior do desenho da taverna (352,336), onde o cursor não cai sobre a faixa, e só mover o
mouse por fora dela.
O estado do nosso lado usa EXATAMENTE as variaveis do save derivado (`rawVars`): estagio 60 e missoes 10..50 concluidas, sem efeitos de conversa.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(HERE, "scenarios.json")
RAW = {"768": 60, "906": 1, "916": 1, "926": 1, "936": 1, "946": 1}
CAMP = {"done": [10, 20, 30, 40, 50], "town": 3, "stage": 60, "rawVars": RAW}
ENTER = "click:352,336 wait:3 click:583,312 wait:1 "


def build():
    base = dict(enter="inn", town=3, campaign=CAMP, orig_group="dr_inn", orig_start="druids_60")
    return [
        dict(id="dr_inn", desc="Taverna druida (estado derivado, vazia), dica fechada", mouse=[1012, 756], orig_steps=ENTER + "move:1012,756 wait:1", **base),
        dict(id="dr_inn_hover_talk", desc="Taverna druida: mouse sobre Talk", mouse=[745, 255], orig_steps="move:745,255 wait:1", **base),
        dict(id="dr_inn_hover_exit", desc="Taverna druida: mouse sobre Exit", mouse=[745, 302], orig_steps="move:745,302 wait:1", **base),
    ]


def main():
    d = json.load(open(SC, encoding="utf-8"))
    new = build()
    ids = {s["id"] for s in new}
    d["scenarios"] = [s for s in d["scenarios"] if s["id"] not in ids] + new
    json.dump(d, open(SC, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(new)} cenarios gerados; total {len(d['scenarios'])}")


if __name__ == "__main__":
    main()
