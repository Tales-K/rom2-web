"""Oráculo por FUNÇÃO em contexto real: registra cada chamada de funções escolhidas durante um episódio no Oracle (resume.py).

Para cada chamada: tique, função, convenção, ECX (`this`), EDX (fastcall), argumentos da pilha, EAX/EDX no retorno, semente do rand()
antes/depois (_tiddata+0x14), quantas vezes rand 0x583290 rodou dentro, e TODO acesso à memória dentro da chamada (chamadas internas
incluídas): leituras [endereço, tamanho, valor] e escritas [endereço, tamanho, antes, depois]. Ficam de fora: leituras do .text e
dos slots da IAT do exe; na pilha, leituras abaixo do fim dos argumentos da própria chamada (locais, endereço de retorno, argumentos,
que já estão em `args`) e escritas abaixo do ESP de entrada (locais). Leituras/escritas na pilha do chamador (parâmetros de saída)
ficam. `objs`: endereço (this, argumentos, EAX, endereços e valores de 4 bytes acessados) → {"unit": id, "off": deslocamento} quando
cai numa unidade conhecida (CList do mundo, resume.unit_list) ou num subobjeto dela ({"unit", "sub": "+0x1c4", "off"}).

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/fnprobe.py m10_start_s1 0x557f08 0x5585f4 0x557cf1 \\
        0x54ffb0 0x54ffc0 0x50d884 0x50d8c0 0x55f970 0x54ff7c 0x54ff5b [--ticks 960] [--args 0x557f08:2,...] [--verify 20] \
        [--stride 0x54d76e:3,...]

`--stride addr:k` grava só a 1.ª de cada k chamadas da função (contagem por função; funções caras como as ondas, cujo memset da
grade são ~32 mil escritas por chamada). Chamadas puladas não têm registro próprio, mas os acessos delas entram no da mãe gravada.

Saída: refs/oracle/pairs/<episodio>/<addr>.jsonl (uma linha por chamada, na ordem de término; `seq` = ordem de entrada).
Ganchos de memória ficam ligados o tempo todo e só registram com uma chamada ativa: no Unicorn 2 um gancho de memória só vale para
blocos traduzidos depois dele, e ligá-lo na entrada perdia os acessos do bloco da entrada (medido: 0x54ff7c sem as leituras de
[+0x10]+1/+5). Retorno = gancho no endereço de retorno lido da pilha (bloco invalidado com ctl_remove_cache ao criar) e ESP acima
do de entrada. Custo: ~32 tiques/s com os 10 endereços do piloto (contra ~500 sem sonda).
"""
from __future__ import annotations

import bisect
import json
import os
import re
import struct
import sys
import time

from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE, UC_PROT_ALL
from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import resume as R  # noqa: E402

DECOMP = r"C:\Users\TALES K\Games\allods2-decomp"
PAIRS = os.path.join(R.ROOT, "refs", "oracle", "pairs")
RAND = 0x583290
UNIT_SIZE = 0x1D0
SUBOBJ = {0x10: 0x10, 0x1C0: 0x90, 0x1C4: 0xA0}          # objeto de mapa, movimento, tarefa/IA (export_state)


def signature(addr: int) -> tuple[str, int]:
    """(convenção, n.º de parâmetros) lidos do C decompilado (index.tsv + cabeçalho da função)."""
    with open(os.path.join(DECOMP, "index.tsv"), encoding="utf-8") as fh:
        row = next((l.split("\t") for l in fh if l.startswith("0x%x\t" % addr)), None)
    if row is None:
        raise SystemExit("0x%x não está no index.tsv" % addr)
    path, line = os.path.join(DECOMP, row[2]), int(row[3])
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = [l for i, l in zip(range(line + 14), fh) if i >= line]
    txt = " ".join(l.strip() for l in lines if not l.strip().startswith(("/*", "*")))
    m = re.search(r"([^;{}]*?)\(([^)]*)\)\s*\{", txt)
    if not m:
        raise SystemExit("assinatura de 0x%x não achada" % addr)
    conv = next((c for c in ("thiscall", "fastcall", "stdcall") if "__" + c in m.group(1)), "cdecl")
    params = [p for p in m.group(2).split(",") if p.strip() and p.strip() != "void"]
    return conv, len(params)


def stack_args(conv: str, nparams: int) -> int:
    """No C do Ghidra o `this` (thiscall) e os 2 primeiros parâmetros (fastcall) estão na lista mas vêm em ECX/EDX."""
    return max(0, nparams - 2) if conv == "fastcall" else max(0, nparams - 1) if conv == "thiscall" else nparams


class Frame:
    __slots__ = ("fn", "seq", "t", "conv", "ecx", "edx", "args", "esp0", "ret", "rng0", "nrand", "reads", "writes", "rcut",
                 "depth")


class Probe:
    def __init__(self, o: "R.Oracle", fns: dict[int, tuple[str, int]], stride: dict[int, int] | None = None):
        self.o, self.uc, self.fns = o, o.uc, fns
        self.stride, self.ncalls = stride or {}, {a: 0 for a in fns}
        self.frames: list[Frame] = []
        self.out: dict[int, list[dict]] = {a: [] for a in fns}
        self.t, self.seq, self.ret_hooks = 0, 0, {}
        self.td = o.meta["tiddata"] + 0x14
        pe = o.u32(0x400000 + 0x3C) + 0x400000
        nsec, optsz = struct.unpack("<H", o.read(pe + 6, 2))[0], struct.unpack("<H", o.read(pe + 0x14, 2))[0]
        self.code = []
        for i in range(nsec):
            sh = o.read(pe + 0x18 + optsz + 40 * i, 40)
            va, vs, ch = struct.unpack_from("<I", sh, 12)[0], struct.unpack_from("<I", sh, 8)[0], struct.unpack_from("<I", sh, 36)[0]
            if ch & 0x20000000:                                   # IMAGE_SCN_MEM_EXECUTE
                self.code.append((0x400000 + va, 0x400000 + va + vs))
        self.iat = {e["slot"] for e in o.meta["iat"].get("allods2.exe", [])}
        self.stack_lo, self.stack_hi = o.stack, o.stack + o.stack_size
        self.ivals: list[tuple[int, int, dict]] = []
        self.starts: list[int] = []
        for a in fns:
            self.uc.hook_add(UC_HOOK_CODE, self._entry, begin=a, end=a)
        self.uc.hook_add(UC_HOOK_CODE, self._rand, begin=RAND, end=RAND)
        self.uc.hook_add(UC_HOOK_MEM_READ, self._read)
        self.uc.hook_add(UC_HOOK_MEM_WRITE, self._write)
        self.refresh_objects()

    # ------------------------------------------------------------ objetos conhecidos
    def refresh_objects(self, *_):
        o = self.o
        iv = []
        for u in R.unit_list(o):
            uid = o.u32(u + 4)
            iv.append((u, u + UNIT_SIZE, {"unit": uid}))
            for off, size in SUBOBJ.items():
                p = o.u32(u + off)
                if p:
                    iv.append((p, p + size, {"unit": uid, "sub": "+0x%x" % off}))
        iv.sort(key=lambda x: x[0])
        self.ivals, self.starts = iv, [x[0] for x in iv]

    def obj(self, a: int):
        i = bisect.bisect_right(self.starts, a) - 1
        if i >= 0:
            b, e, d = self.ivals[i]
            if a < e:
                return {**d, "off": a - b}
        return None

    # ------------------------------------------------------------ ganchos
    def _excluded(self, a):
        if a in self.iat:
            return True
        for b, e in self.code:
            if b <= a < e:
                return True
        return False

    def _read(self, uc, access, a, size, value, _):
        if not self.frames:
            return
        f = self.frames[-1]
        if (self.stack_lo <= a < f.rcut) or self._excluded(a):
            return
        f.reads.append([a, size, int.from_bytes(uc.mem_read(a, size), "little")])

    def _write(self, uc, access, a, size, value, _):
        if not self.frames:
            return
        f = self.frames[-1]
        if (self.stack_lo <= a < f.esp0) or self._excluded(a):
            return
        before = int.from_bytes(uc.mem_read(a, size), "little")
        after = value & ((1 << (8 * size)) - 1) if size <= 8 else None
        f.writes.append([a, size, before, after])

    def _rand(self, uc, address, size, _):
        for f in self.frames:
            f.nrand += 1

    def _entry(self, uc, address, size, _):
        k = self.ncalls[address]
        self.ncalls[address] = k + 1
        if k % self.stride.get(address, 1):
            return                                                # --stride: só 1 a cada k chamadas desta função
        conv, nargs = self.fns[address]
        esp = uc.reg_read(X.UC_X86_REG_ESP)
        st = struct.unpack("<%dI" % (1 + nargs), bytes(uc.mem_read(esp, 4 * (1 + nargs))))
        f = Frame()
        f.fn, f.seq, f.t, f.conv, f.depth = address, self.seq, self.t, conv, len(self.frames)
        f.ecx, f.edx = uc.reg_read(X.UC_X86_REG_ECX), uc.reg_read(X.UC_X86_REG_EDX)
        f.args, f.esp0, f.ret = list(st[1:]), esp, st[0]
        f.rcut = esp + 4 + 4 * nargs
        f.rng0, f.nrand, f.reads, f.writes = self.o.u32(self.td), 0, [], []
        self.seq += 1
        self.frames.append(f)
        if f.ret not in self.ret_hooks:
            self.ret_hooks[f.ret] = uc.hook_add(UC_HOOK_CODE, self._return, begin=f.ret, end=f.ret)
            uc.ctl_remove_cache(f.ret, f.ret + 1)

    def _return(self, uc, address, size, _):
        esp = uc.reg_read(X.UC_X86_REG_ESP)
        while self.frames and self.frames[-1].ret == address and esp > self.frames[-1].esp0:
            f = self.frames.pop()
            if self.frames:                                       # o que a filha acessou também é da mãe (filtrado pela mãe)
                p = self.frames[-1]
                p.reads += [r for r in f.reads if not (self.stack_lo <= r[0] < p.rcut)]
                p.writes += [w for w in f.writes if not (self.stack_lo <= w[0] < p.esp0)]
            self._finish(f, uc.reg_read(X.UC_X86_REG_EAX), uc.reg_read(X.UC_X86_REG_EDX))

    def _finish(self, f: Frame, eax: int, edx: int):
        objs = {}

        def note(a):
            if a not in objs:
                d = self.obj(a)
                if d:
                    objs[a] = d
        for a in [f.ecx, eax] + f.args:
            note(a)
        for a, size, v in f.reads:
            note(a)
            if size == 4:
                note(v)
        for a, size, b, v in f.writes:
            note(a)
            if size == 4 and v is not None:
                note(v)
        rec = {"t": f.t, "seq": f.seq, "depth": f.depth, "esp0": f.esp0, "fn": "0x%x" % f.fn, "conv": f.conv, "this": f.ecx, "args": f.args,
               "eax": eax, "edx": edx, "rng0": f.rng0, "rng1": self.o.u32(self.td), "nrand": f.nrand,
               "reads": f.reads, "writes": f.writes, "objs": {str(a): d for a, d in sorted(objs.items())}}
        if f.conv == "fastcall":
            rec["edx_in"] = f.edx
        self.out[f.fn].append(rec)

    def before_tick(self, step):
        self.t = step
        self.refresh_objects()


def parse_fns(addrs: list[str], override: str | None) -> dict[int, tuple[str, int]]:
    ov = {}
    for item in (override or "").split(","):
        if item.strip():
            a, n = item.split(":")
            ov[int(a, 16)] = int(n)
    fns = {}
    for s in addrs:
        a = int(s, 16)
        conv, np = signature(a)
        fns[a] = (conv, ov.get(a, stack_args(conv, np)))
    return fns


def run(eid: str, fns: dict, ticks: int, stride: dict[int, int] | None = None) -> tuple[Probe, float]:
    o, ep = R.load_episode(eid)
    pr = Probe(o, fns, stride)
    t0 = time.perf_counter()
    R.play(o, ep, ticks, before_tick=pr.before_tick)
    if pr.frames:
        raise RuntimeError("chamadas sem retorno no fim: %s" % [hex(f.fn) for f in pr.frames])
    return pr, time.perf_counter() - t0


def prestate(rec: dict) -> dict[int, int]:
    """Memória antes da chamada, byte a byte, reconstruída do registro: o `antes` da 1.ª escrita de cada byte (nada escreveu antes
    dela) e, nos bytes nunca escritos, o valor da 1.ª leitura."""
    mem: dict[int, int] = {}
    for a, size, before, _after in rec["writes"]:
        for i in range(size):
            mem.setdefault(a + i, (before >> (8 * i)) & 0xFF)
    for a, size, v in rec["reads"]:
        for i in range(size):
            mem.setdefault(a + i, (v >> (8 * i)) & 0xFF)
    return mem


def replay(eid: str, fns: dict, recs: list[dict]) -> list[str]:
    """Refaz cada chamada numa imagem nova do tique 0 só com o estado anterior do registro (mesmo ESP, ECX, EDX, argumentos e semente)
    e compara o registro novo com o gravado. Leitura que a sonda tivesse perdido viria da imagem do tique 0 e mudaria o resultado."""
    o, _ = R.load_episode(eid)
    pr = Probe(o, fns)
    tramp = o.stub + 0x200                    # retorno: nop (o gancho de retorno dispara nele) e para no byte seguinte
    o.write(tramp, b"\x90")
    errs, pages = [], set()
    for rec in recs:
        fn = int(rec["fn"], 16)
        for a, b in prestate(rec).items():
            pg = a & ~0xFFF
            if pg not in pages:                   # página comprometida (VirtualAlloc) depois do tique 0: não existe na imagem nova
                if not o._mapped(pg):
                    o.uc.mem_map(pg, 0x1000, UC_PROT_ALL)
                pages.add(pg)
            o.write(a, bytes([b]))
        o.set_u32(pr.td, rec["rng0"])
        esp0 = rec["esp0"]
        o.write(esp0, struct.pack("<%dI" % (1 + len(rec["args"])), tramp, *rec["args"]))
        uc = o.uc
        for r in (X.UC_X86_REG_EAX, X.UC_X86_REG_EBX, X.UC_X86_REG_ESI, X.UC_X86_REG_EDI, X.UC_X86_REG_EBP):
            uc.reg_write(r, 0)
        uc.reg_write(X.UC_X86_REG_ECX, rec["this"])
        uc.reg_write(X.UC_X86_REG_EDX, rec.get("edx_in", 0))
        uc.reg_write(X.UC_X86_REG_ESP, esp0)
        pr.t, pr.out[fn] = rec["t"], []
        try:
            uc.emu_start(fn, tramp + 1)
        except Exception as ex:                   # ex.: VirtualFree de bloco do heap que não existe na imagem nova
            pr.frames = []
            errs.append("%s seq %d: exceção no replay (%s)" % (rec["fn"], rec["seq"], ex))
            continue
        new = pr.out[fn][-1] if pr.out[fn] else None
        keys = ("eax", "edx", "rng1", "nrand", "reads", "writes")
        if new is None or any(new[k] != rec[k] for k in keys):
            errs.append("%s seq %d: %s" % (rec["fn"], rec["seq"], [k for k in keys if new is None or new[k] != rec[k]]))
    return errs


def main():
    argv = sys.argv[1:]

    def opt(name, default=None):
        if name in argv:
            i = argv.index(name)
            v = argv[i + 1]
            del argv[i:i + 2]
            return v
        return default
    ticks = int(opt("--ticks", "960"))
    override = opt("--args")
    nver = int(opt("--verify", "0"))
    stride = {int(a, 16): int(k) for a, k in (i.split(":") for i in (opt("--stride") or "").split(",") if i.strip())}
    eid, addrs = argv[0], argv[1:]
    fns = parse_fns(addrs, override)
    print("funções:", {hex(a): v for a, v in fns.items()}, flush=True)
    pr, dt = run(eid, fns, ticks, stride)
    out_dir = os.path.join(PAIRS, eid)
    os.makedirs(out_dir, exist_ok=True)
    tot = 0
    for a, recs in pr.out.items():
        with open(os.path.join(out_dir, "0x%x.jsonl" % a), "w", encoding="utf-8") as fh:
            for r in recs:
                fh.write(json.dumps(r, separators=(",", ":")) + "\n")
        tot += len(recs)
    print(json.dumps({"id": eid, "ticks": ticks, "s": round(dt, 2), "ticks_per_s": round(ticks / dt, 1), "calls": tot,
                      "per_fn": {"0x%x" % a: len(r) for a, r in pr.out.items()}, "out": out_dir}), flush=True)
    if nver:
        import random
        rnd = random.Random(1)
        errs, n = [], 0
        for a, recs in pr.out.items():
            roots = recs                                  # aninhadas também: o registro de cada uma é completo
            sample = rnd.sample(roots, min(nver, len(roots)))
            n += len(sample)
            errs += replay(eid, {a: fns[a]}, sample)
        print("replay de %d chamadas (até %d por função, imagem nova + estado anterior do registro): %s"
              % (n, nver, "IDÊNTICO" if not errs else "%d diferentes: %s" % (len(errs), errs[:5])), flush=True)
        if errs:
            sys.exit(1)


if __name__ == "__main__":
    main()
