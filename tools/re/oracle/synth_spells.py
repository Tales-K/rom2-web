"""Pares SINTÉTICOS das magias que o corpus não executa (etapa 8b, lote 5): Spell_Apply 0x519db8 chamado no Unicorn com estado real.

O episódio m10_mage_s102 roda até o tique T0 sem sonda; daí a sonda de fnprobe.py (Probe) é ligada e, entre dois tiques, Spell_Apply
é chamado direto (ECX = uma magia do livro de quem lança, com +8 = id e +4 = a definição do id trocados; quem lança, alvo, x, y), com o
poder ajustado pela habilidade da esfera (unidade+0xa8+2×esfera = poder + 30 − Mind; o exe faz habilidade − 30 + Mind). Depois da
chamada a magia do livro volta ao que era (os 0x14 bytes). O jogo segue N tiques com a sonda: a lista do mundo aplica as cargas
(0x517949 → 0x51ce12 → 0x51d175 → 0x51d436 → vtable+0x58: 0x51366b no herói, 0x5118be no monstro), os efeitos descontam (0x51cc9f) e
acabam (0x51d337), as áreas andam (0x517cfe...). Por fim a varredura do poder: Spell_Apply de cada id para poder 0..255, sem tique. Na varredura quem lança
fica sem o bit 2 de +0x4c (sem a experiência do lançamento, vtable+0x70: o nível subiria); depois de cada chamada ele volta ao que era.

Cada registro é o de fnprobe (leituras/escritas com os valores, sorteios, objs): o par é coerente por construção, ainda que o estado
não seja um que o jogo alcançaria. Saída: refs/oracle/pairs/synth_m10_mage/<addr>.jsonl (o test:sim lê toda pasta de pairs/).
`--verify N` refaz N chamadas de cada função numa imagem nova só com o estado anterior do registro (fnprobe.replay);
`--verify-only N` só refaz, com os pares já gravados.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/synth_spells.py [--ticks 400] [--verify 10]
"""
from __future__ import annotations

import json
import os
import random
import struct
import sys
import time

from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import resume as R  # noqa: E402
import fnprobe as F  # noqa: E402

EP, OUT = "m10_mage_s102", "synth_m10_mage"
SPELL_APPLY = 0x519DB8
DEF0, DEF_STRIDE = 0x29A16A0, 0x20          # definição do id k = DEF0 + k × 0x20 (a tabela de data.bin na imagem; nome +4, colunas +8, texto +0x1c)
SPHERE = {4: 1, 6: 2, 8: 2, 0xC: 3, 0xD: 3, 0xE: 3, 0xF: 3, 0x12: 4, 0x13: 4, 0x14: 5, 0x15: 5, 0x1B: 5, 0x1C: 5, 0x1D: 5}
MAGE, ALLY, MONSTER, MONSTER2 = 1, 24608, 24611, 24612
T0 = 200
# (id, quem lança, alvo, poder): a cena aplicada e tiquetada
SCENE = [
    (4, MAGE, MAGE, 0), (8, MAGE, MAGE, 40), (0xD, MAGE, ALLY, 0), (0x13, MAGE, MONSTER, 0), (4, MAGE, MAGE, 90),
    (0x14, MAGE, MAGE, 0), (0x1C, MAGE, MAGE, 30), (0x14, MAGE, MONSTER, 0), (0x1C, MAGE, MONSTER2, 0),
    (0x15, MAGE, MAGE, 0), (0x1D, MAGE, MONSTER, 0), (0x15, MAGE, MONSTER2, 60), (0x1D, MAGE, ALLY, 10),
    (0xC, MAGE, ALLY, 0), (0xC, MAGE, MAGE, 3),
    (0x12, MAGE, MONSTER, 0), (0x12, MAGE, MAGE, 0), (0x12, MAGE, MONSTER2, 100),
    (0x1B, MAGE, MONSTER, 0),
    (6, MAGE, MONSTER, 0), (0xE, MAGE, MAGE, 0), (0xF, MAGE, MONSTER2, 0),
    (6, MAGE, MAGE, 50), (0xF, MAGE, MAGE, 20), (0xE, MAGE, MONSTER2, 0),   # veneno com proteção de água; Light × Darkness
]
# a varredura do poder (Spell_Apply só): os ids com conta própria
SWEEP = [4, 0x14, 0x15, 0x1D, 6, 0xC, 0x12, 0xE, 0xF, 0x1C, 8, 0xD, 0x13]
SWEEP_STEP = {4: 1, 0x14: 1, 0x15: 1, 6: 1, 0x12: 1}         # passo do poder (o resto de 17 em 17)
FNS = [SPELL_APPLY, 0x517949, 0x542D00, 0x51CE12, 0x51D175, 0x51D337, 0x51D436, 0x51CC9F, 0x51366B, 0x5118BE,
       0x517C1A, 0x517CFE, 0x518681, 0x518594, 0x5183A2, 0x518024, 0x55A8F8, 0x518833, 0x542D50]
STRIDE = {0x51CC9F: 5, 0x517CFE: 3}


def units(o, corpses: bool = False) -> dict[int, int]:
    return {o.u32(u + 4): u for u in R.unit_list(o, corpses=corpses)}


def call(o, pr: F.Probe, fn: int, ecx: int, args: list[int]) -> None:
    """fn(ECX, args...) com retorno num trampolim (nop + parada no byte seguinte, como fnprobe.replay): o gancho de retorno da sonda
    dispara no nop."""
    tramp = o.stub + 0x200
    o.write(tramp, b"\x90")
    sp = o.stack + o.stack_size - 0x400
    o.write(sp, struct.pack("<%dI" % (1 + len(args)), tramp, *args))
    uc = o.uc
    for r in (X.UC_X86_REG_EAX, X.UC_X86_REG_EBX, X.UC_X86_REG_EDX, X.UC_X86_REG_ESI, X.UC_X86_REG_EDI, X.UC_X86_REG_EBP):
        uc.reg_write(r, 0)
    uc.reg_write(X.UC_X86_REG_ECX, ecx)
    uc.reg_write(X.UC_X86_REG_ESP, sp)
    uc.reg_write(X.UC_X86_REG_EFLAGS, 0x202)
    uc.emu_start(fn, tramp + 1)
    if pr.frames:
        raise RuntimeError("chamada sem retorno: %s" % [hex(f.fn) for f in pr.frames])


def cast(o, pr: F.Probe, sid: int, caster: int, target: int | None, power: int, x: int = 0, y: int = 0, no_xp: bool = False) -> None:
    """Spell_Apply(magia sid) de `caster` (endereço) em `target` (endereço ou None: ponto x, y) com o poder `power`."""
    book = o.u32(caster + 0x140)
    data = o.u32(book + 8)
    inst = next(e for e in (o.u32(data + 4 * i) for i in range(o.u32(book + 0xC))) if e)   # a 1.ª magia do livro
    saved_inst = o.read(inst, 0x14)
    sph = SPHERE[sid]
    sk_a = caster + 0xA8 + 2 * sph
    saved_sk = o.read(sk_a, 2)
    mind = struct.unpack("<h", o.read(caster + 0x88, 2))[0]
    o.set_u32(inst + 4, DEF0 + sid * DEF_STRIDE)
    o.write(inst + 8, bytes([sid]))
    if target is not None:
        mo = o.u32(target + 0x10)
        x, y = o.read(mo, 1)[0], o.read(mo + 1, 1)[0]
    saved_caster = o.read(caster, 0x1D0)
    o.write(sk_a, struct.pack("<h", power + 30 - mind))
    if no_xp:                                                        # +0x4c bit 2 apagado: sem experiência (vtable+0x70)
        o.write(caster + 0x4C, bytes([o.read(caster + 0x4C, 1)[0] & ~2 & 0xFF]))
    call(o, pr, SPELL_APPLY, inst, [caster, target or 0, x, y])
    o.write(inst, saved_inst)
    o.write(caster, saved_caster)                                    # a experiência do lançamento (vtable+0x70) e o que ela refez
    o.write(sk_a, saved_sk)


def main():
    argv = sys.argv[1:]

    def opt(name, default):
        if name in argv:
            i = argv.index(name)
            v = argv[i + 1]
            del argv[i:i + 2]
            return v
        return default
    ticks, nver = int(opt("--ticks", "400")), int(opt("--verify", "0"))
    only = int(opt("--verify-only", "0"))
    if only:                                                         # só o replay dos pares já gravados
        verify(only)
        return
    t_start = time.perf_counter()
    o, ep = R.load_episode(EP)
    R.play(o, ep, T0)
    fns = F.parse_fns(["0x%x" % a for a in FNS], None)
    pr = F.Probe(o, fns, STRIDE)
    o.uc.ctl_flush_tb()                                              # ganchos de memória valem nos blocos traduzidos depois deles
    pr.t = T0
    pr.refresh_objects()
    us = units(o)
    for sid, c, t, p in SCENE:
        cast(o, pr, sid, us[c], us.get(t), p)
    print("cena: %d lançamentos; %d tiques" % (len(SCENE), ticks), flush=True)
    import original_episode as oe
    hero = o.meta["hero"]
    pend = [a for a in sorted(oe.normalize_script(ep["script"]), key=lambda a: a["t"]) if a["t"] >= T0]
    for step in range(T0, T0 + ticks):
        while pend and pend[0]["t"] <= step:
            R.apply_action(o, pend.pop(0), hero)
        pr.before_tick(step)
        o.tick()
    us = units(o, corpses=True)                                     # a maga pode ter caído na cena (o registro continua)
    pr.t = T0 + ticks
    pr.refresh_objects()
    n = 0
    for sid in SWEEP:
        for p in range(0, 256, SWEEP_STEP.get(sid, 17)):
            tgt = us[MONSTER] if sid in (0x12, 0x1D, 0x1C) and MONSTER in us else us[MAGE]
            cast(o, pr, sid, us[MAGE], tgt, p, no_xp=True)
            n += 1
    print("varredura: %d lançamentos" % n, flush=True)
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
        verify(nver)


def verify(nver: int) -> None:
    """Refaz até `nver` chamadas de cada função gravada numa imagem nova só com o estado anterior do registro (fnprobe.replay)."""
    fns = F.parse_fns(["0x%x" % a for a in FNS], None)
    out_dir = os.path.join(F.PAIRS, OUT)
    rnd = random.Random(1)
    errs, k = [], 0
    for a in FNS:
        path = os.path.join(out_dir, "0x%x.jsonl" % a)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            recs = [json.loads(line) for line in fh if line.strip()]
        sample = rnd.sample(recs, min(nver, len(recs)))
        t0 = time.perf_counter()
        e = F.replay(EP, {a: fns[a]}, sample)
        print("  0x%x: %d/%d iguais (%.1f s)" % (a, len(sample) - len(e), len(sample), time.perf_counter() - t0), flush=True)
        k += len(sample)
        errs += e
    print("replay de %d chamadas: %s" % (k, "IDÊNTICO" if not errs else "%d diferentes: %s" % (len(errs), errs[:5])), flush=True)
    if errs:
        sys.exit(1)


if __name__ == "__main__":
    main()
