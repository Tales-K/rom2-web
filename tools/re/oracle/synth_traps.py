"""Pares SINTÉTICOS das armadilhas do MapRec (as que o corpus não pisa): 0x55ba36 chamado no Unicorn com estado real.

O episódio m10_start_s1 roda até o tique T0 sem sonda; daí a sonda de fnprobe.py (Probe) é ligada, duas armadilhas Teleport (0x17) são
postas por 0x55ba36 (como a carga 0x564072 e o "Set trap" 0x57847e: [magia, poder, ponto 1, ponto 2]) no caminho do herói (uma numa
célula sem registro, outra repetida na mesma célula, que devolve 0), e o herói recebe ordens de andar por cima: o andar portado
(0x5503af) guarda o destino em IA+0xb0 e o despachante teleporta (Unit_TeleportTo 0x55a96c → 0x55a928, 0x54fbf7). Cada registro é o de
fnprobe; saída: refs/oracle/pairs/synth_m10_trap/<addr>.jsonl (o test:sim lê toda pasta de pairs/).

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/synth_traps.py [--ticks 300] [--verify 10]
"""
from __future__ import annotations

import json
import os
import random
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import resume as R  # noqa: E402
import fnprobe as F  # noqa: E402
from synth_spells import call  # noqa: E402

EP, OUT = "m10_start_s1", "synth_m10_trap"
MAP_PTR = 0x670E48
T0 = 60
FNS = [0x55BA36, 0x55B978, 0x5503AF, 0x55A96C, 0x55A928, 0x54FBF7]


def put_trap(o, pr, cell_x: int, cell_y: int, b: bytes) -> None:
    """0x55ba36(mapa, célula, 6 bytes) com os bytes numa área livre do trampolim do arnês."""
    buf = o.stub + 0x300                                             # fora da pilha: a sonda grava a leitura (abaixo do ESP é local)
    o.write(buf, b)
    call(o, pr, 0x55BA36, o.u32(MAP_PTR), [(cell_y << 8) | cell_x, buf])


def main():
    argv = sys.argv[1:]

    def opt(name, default):
        if name in argv:
            i = argv.index(name)
            v = argv[i + 1]
            del argv[i:i + 2]
            return v
        return default
    ticks, nver = int(opt("--ticks", "300")), int(opt("--verify", "0"))
    t_start = time.perf_counter()
    o, ep = R.load_episode(EP)
    R.play(o, ep, T0)
    fns = F.parse_fns(["0x%x" % a for a in FNS], None)
    pr = F.Probe(o, fns, {})
    o.uc.ctl_flush_tb()
    pr.t = T0
    pr.refresh_objects()
    hero_id = o.meta["hero"]
    hero = next(u for u in R.unit_list(o) if o.u32(u + 4) == hero_id)
    mo = o.u32(hero + 0x10)
    hx, hy = o.read(mo, 1)[0], o.read(mo + 1, 1)[0]
    # 1) teleporte 3 células a leste, destino 3 ao sul dele; 2) a mesma célula de novo (registro com armadilha → 0); 3) outra a oeste
    tx, ty = hx + 3, hy
    put_trap(o, pr, tx, ty, bytes([0x17, 100, tx, ty, tx, ty + 3]))
    put_trap(o, pr, tx, ty, bytes([0x17, 100, tx, ty, tx, ty + 3]))
    put_trap(o, pr, hx, hy, bytes([0x17, 50, hx, hy, hx, hy + 2]))     # na célula do herói (registro com ele: copia, 1)
    print("herói %d em (%d, %d); armadilhas em (%d, %d) e (%d, %d)" % (hero_id, hx, hy, tx, ty, hx, hy), flush=True)
    # andar até a célula da armadilha (o caminho contorna a célula com registro quando ela não é o destino)
    plan = [(T0, {"do": "move", "x": tx, "y": ty}), (T0 + ticks // 2, {"do": "move", "x": hx, "y": hy})]
    for step in range(T0, T0 + ticks):
        while plan and plan[0][0] <= step:
            R.apply_action(o, plan.pop(0)[1], hero_id)
        pr.before_tick(step)
        o.tick()
    mo = o.u32(hero + 0x10)
    print("herói no fim em (%d, %d)" % (o.read(mo, 1)[0], o.read(mo + 1, 1)[0]), flush=True)
    out_dir = os.path.join(F.PAIRS, OUT)
    os.makedirs(out_dir, exist_ok=True)
    per = {}
    for a, recs in pr.out.items():
        path = os.path.join(out_dir, "0x%x.jsonl" % a)
        if not recs:
            if os.path.exists(path):
                os.remove(path)
            continue
        with open(path, "w", encoding="utf-8") as fh:
            for r in recs:
                fh.write(json.dumps(r, separators=(",", ":")) + "\n")
        per["0x%x" % a] = len(recs)
    print(json.dumps({"s": round(time.perf_counter() - t_start, 1), "per_fn": per, "out": out_dir}), flush=True)
    if nver:
        rnd = random.Random(1)
        errs, k = [], 0
        for a in FNS:
            path = os.path.join(out_dir, "0x%x.jsonl" % a)
            if not os.path.exists(path):
                continue
            recs = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
            sample = rnd.sample(recs, min(nver, len(recs)))
            e = F.replay(EP, {a: fns[a]}, sample)
            print("  0x%x: %d/%d iguais" % (a, len(sample) - len(e), len(sample)), flush=True)
            k += len(sample)
            errs += e
        print("replay de %d chamadas: %s" % (k, "IDÊNTICO" if not errs else "%d diferentes: %s" % (len(errs), errs[:5])), flush=True)


if __name__ == "__main__":
    main()
