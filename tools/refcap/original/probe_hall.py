"""Le o objeto do hall da fama (allods2.exe, exe 0x4a8d28) numa missao em andamento (frente FIDELIDADE-RESTO, 19/10).

    python probe_hall.py [estado=m10_start] [--wait 12]

O hall e o membro em +0x598 da janela principal (vtable 0x5ce0d8): +0 = valor do ultimo estagio (0x4899fb), +4 = tempo acumulado
(soma de `[0x6044c4]+4 / 16` ao fim de cada missao, exe 0x486bba), +8 = abates (conta 1 por unidade de tipo marcado que morre, exe 0x410891),
+0xc = 10 (tamanho da lista). Pontuacao = trunc(XP * abates / (tempo * 10)) com tempo != 0, senao trunc(XP / 500000 * abates),
onde XP = soma da experiencia das 5 habilidades da unidade cliente do heroi (+0x110, exe 0x469cbc). Imprime os campos e como andam no tempo.
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_steps as rs  # noqa: E402
from memory import Proc  # noqa: E402


def find_main(p):
    hits = p.scan_i32(0x5CE0D8)
    out = []
    for a in hits:
        if a % 4:
            continue
        try:
            if p.i32(a + 0x598 + 0xC) == 10:
                out.append(a)
        except OSError:
            pass
    return out


def main():
    state = next((a for a in sys.argv[1:] if not a.startswith("-")), "m10_start")
    wait = float(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 12
    if not rs.acquire():
        sys.exit(3)
    closer = None
    try:
        g, inp, closer = rs.open_session(state, 300)
        p = Proc.attach()
        mains = find_main(p)
        print("janela principal:", [hex(a) for a in mains])
        if not mains:
            return
        m = mains[0]
        srv = p.u32(0x6044C4)
        print("[0x6044c4] =", hex(srv))
        for k in range(4):
            hall = [p.i32(m + 0x598 + o) for o in (0, 4, 8, 0xC)]
            print(f"t={k * wait / 3:5.1f}s hall(+0,+4,+8,+c)={hall}  srv+4={p.i32(srv + 4)}  srv+8={p.i32(srv + 8)}")
            g.wait(wait / 3)
    finally:
        if closer:
            closer()
        rs.release()


if __name__ == "__main__":
    main()
