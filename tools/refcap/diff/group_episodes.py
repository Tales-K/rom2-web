"""Episódios de COMBATE DE GRUPO para o teste diferencial (frente GRUPO-ALAVANCAS, 20/10; pedido D(1) da docs/FILA.md).

Herói mago (saves m10_mage / m20_mage) com o livro completado na memória antes do estado inicial (Original_episode.Session.setup:
Fireball, Wall of Fire, Poison Cloud, Blizzard, Teleport, Summon + mana 3000) contra criaturas de dificuldades diferentes: invoca no
começo e no meio (Summon), magias de área sobre bandos e sobre ESTRUTURAS (casas da m10/m20: o export grava a vida de todas as
estruturas a cada 16 tiques), Teleport, ataque físico ao fim. Igles/Dina não existem nos saves derivados (o carregador do script não
os resolve sem o remendo da 103) — o "grupo" aqui é o herói + as invocações (IA aliada).

    .venv\\Scripts\\python.exe tools/refcap/diff/group_episodes.py      # grava refs/trace/diff/group/episodes.json
    .venv\\Scripts\\python.exe tools/refcap/diff/run_pair.py --episodes refs/trace/diff/group/episodes.json --dir refs/trace/diff/group --ticks 960
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "refs", "trace", "diff", "group")

FIREBALL, WALL_FIRE, POISON, BLIZZARD, TELEPORT, SUMMON = 2, 3, 6, 7, 23, 25
# mana: experiência alta + recálculo da ficha (0x51366b) e mana = mana máx. (escrever 3000 direto é desfeito no 1º recálculo)
SETUP = {"spells": [FIREBALL, WALL_FIRE, POISON, BLIZZARD, TELEPORT, SUMMON], "exp": 5_000_000, "mana": "max"}


def cast(t, spell, x, y):
    return {"t": t, "do": "cast", "unit": "hero", "spell": spell, "x": x, "y": y}


def self_cast(t, spell):
    return {"t": t, "do": "cast", "unit": "hero", "spell": spell, "target": "hero"}


def move(t, x, y):
    return {"t": t, "do": "move", "unit": "hero", "x": x, "y": y}


def episodes() -> list[dict]:
    """1ª versão (refs/trace/diff/group_v1_*): alvos a 15–20 células e ordens a cada 6–8 s → no original o herói nunca chegava ao
    alcance antes da ordem seguinte e só lançou a última magia (o nosso lançava tudo). Medido também: magia de PONTO na célula do
    próprio herói (Summon em si) não sai no original (0x55539a exige estar VIRADO para o ponto; com delta 0 o modo 9 anda/espera sem
    lançar). Agora: o herói anda até ~6–8 células do bando, magias com 8–10 s de intervalo, Summon na célula vizinha."""
    eps = []
    # v3 (refs/trace/diff/group_v3_summonpoint): Summon no PONTO (vizinho) nunca saiu no original — alcance 0 com alvo de ponto exige estar
    # na célula e virado para ela (0x55539a); o modo 8 (magia na UNIDADE) com alvo = o próprio lançador pula o teste (0x56ebc0). E alvos
    # fora do alcance (Blizzard a 11, Poison a 10) ficaram pendentes sem o herói andar (tarefa 14, modo 9). Agora tudo ao alcance do ponto
    # onde o herói para e Summon em si mesmo.
    # m20 (herói anda de 41,67 a 50,64): lobos t103 (40 PV, jogador 2) em (58,60), (63,62), (65,67)
    m20 = [move(0, 50, 62), self_cast(112, SUMMON), cast(240, FIREBALL, 58, 60), self_cast(320, SUMMON),
           cast(368, BLIZZARD, 58, 62), cast(496, WALL_FIRE, 55, 61), cast(592, POISON, 55, 63),
           cast(688, TELEPORT, 48, 63), self_cast(760, SUMMON), cast(820, FIREBALL, 57, 61)]
    # m10 (herói anda de 11,41 a 25,41): esquilos t75 (30 PV) entre as Leg's House (100 PV) 27 (34,36), 28 (28,45), 29 (33,34), 30 (36,35), 31 (27,47)
    m10 = [move(0, 24, 40), self_cast(160, SUMMON), cast(288, FIREBALL, 30, 38), self_cast(352, SUMMON),
           cast(416, BLIZZARD, 33, 38), cast(544, WALL_FIRE, 28, 40), cast(640, POISON, 30, 40),
           cast(720, TELEPORT, 23, 43), cast(800, FIREBALL, 28, 45), cast(900, FIREBALL, 33, 35)]
    for k, (state, acts) in enumerate((("m20_mage", m20), ("m10_mage", m10))):
        for seed in (601 + 2 * k, 602 + 2 * k):
            eps.append({"name": f"g{len(eps):02d}_{state}_s{seed}", "state": state, "seed": seed, "ticks": 960, "actions": acts,
                        "setup": SETUP, "structures": True, "tags": ["group", "area", "summon", "teleport", "structures"]})
    return eps


def main():
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, "episodes.json")
    json.dump(episodes(), open(p, "w", encoding="utf-8"), indent=1)
    print("gravado", p)


if __name__ == "__main__":
    main()
