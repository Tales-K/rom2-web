"""Enumera as vtables de `.rdata` do allods2.exe e as chamadas virtuais do fecho do servidor (só leitura).

Saídas (tools/re/):
  vtables.tsv        vtable_addr, slot, offset, func_addr, func_name, referenced_by
  virtual_calls.tsv  func_addr, slot_offset, base_expr, candidates, other_candidates
                     (candidates = funções nesse slot nas 4 vtables conhecidas; other_candidates = nas demais vtables
                     citadas no C, truncado em 12)

Uma vtable é uma sequência de >= 3 ponteiros de 4 bytes alinhados, todos iguais a inícios de função do index.tsv.
Fronteiras: qualquer endereço de `.rdata` que o C cita (`PTR_FUN_005d0eb0`, `&PTR_LAB_...`, `0x5d0eb0`) começa uma nova
vtable, para que vtables vizinhas sem separador não se fundam. `referenced_by` = funções cujo C cita o endereço.
Limitações: slot nulo/`_purecall` quebra a sequência em duas; tabelas de despacho (não-vtable) entram também, e
`referenced_by` vazio costuma indicar isso; `candidates` só considera vtables citadas no C; o tipo do objeto da chamada não é inferido, então
`other_candidates` é só um limite superior.

Uso: .venv/Scripts/python.exe tools/re/vtables.py
"""
from __future__ import annotations

import bisect
import os
import re
import struct
import sys
from collections import defaultdict

import pefile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import port_status as ps  # noqa: E402

EXE = os.environ.get("A2_EXE", r"C:\Users\TALES K\Games\re_inputs\allods2.exe")
HERE = ps.HERE
KNOWN = ["0x5d0eb0", "0x5d0f40", "0x5d0fb8", "0x5d0c30"]  # unidades (x3) e pacote de comando
MIN_SLOTS = 3
PTR_RE = re.compile(r"PTR_\w*?_([0-9a-f]{8})\b")
HEXC_RE = re.compile(r"\b0x(5[c-e][0-9a-f]{4})\b")


def rdata_words():
    pe = pefile.PE(EXE)
    base = pe.OPTIONAL_HEADER.ImageBase
    for s in pe.sections:
        if s.Name.rstrip(b"\0") == b".rdata":
            data = s.get_data()
            lo = base + s.VirtualAddress
            n = len(data) // 4
            return lo, struct.unpack("<%dI" % n, data[: n * 4])
    sys.exit(".rdata não encontrada")


def func_ranges(idx):
    """Por arquivo: linhas de início e endereços, para mapear linha -> função."""
    per = defaultdict(list)
    for a, r in idx.items():
        per[r["file"]].append((int(r["line"]), a))
    for f in per:
        per[f].sort()
    return per


def scan_references(idx, lo, hi):
    """endereço de .rdata citado no C -> conjunto de funções que o citam."""
    per = func_ranges(idx)
    refs = defaultdict(set)
    for sub in ("game", "rest"):
        d = os.path.join(ps.DECOMP, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".c"):
                continue
            rel = f"{sub}/{fn}"
            starts = per.get(rel)
            if not starts:
                continue
            keys = [s[0] for s in starts]
            with open(os.path.join(d, fn), encoding="utf-8", errors="replace") as f:
                for ln, text in enumerate(f, 1):
                    found = [int(m.group(1), 16) for m in PTR_RE.finditer(text)]
                    found += [int(m.group(1), 16) for m in HEXC_RE.finditer(text)]
                    found = [v for v in found if lo <= v < hi]
                    if not found:
                        continue
                    k = bisect.bisect_right(keys, ln) - 1
                    owner = starts[k][1] if k >= 0 else "?"
                    for v in found:
                        refs[v].add(owner)
    return refs


def find_vtables(idx, lo, words, refs):
    funcs = {int(a, 16) for a in idx}
    cuts = set(refs) | {int(k, 16) for k in KNOWN}
    out, i, n = [], 0, len(words)
    while i < n:
        if words[i] not in funcs:
            i += 1
            continue
        j = i + 1
        while j < n and words[j] in funcs and (lo + 4 * j) not in cuts:
            j += 1
        if j - i >= MIN_SLOTS:
            out.append((lo + 4 * i, [words[k] for k in range(i, j)]))
        i = j
    return out


def main():
    idx = ps.load_index()
    lo, words = rdata_words()
    hi = lo + 4 * len(words)
    refs = scan_references(idx, lo, hi)
    vts = find_vtables(idx, lo, words, refs)
    by_addr = {v: slots for v, slots in vts}
    missing = [k for k in KNOWN if int(k, 16) not in by_addr]
    rows = []
    for v, slots in vts:
        # referências ao início ou a qualquer endereço interno da própria vtable
        rb = set()
        for k in range(len(slots)):
            rb |= refs.get(v + 4 * k, set())
        rb_s = ",".join(sorted(rb))
        for k, fa in enumerate(slots):
            a = "0x%06x" % fa
            rows.append((v, k, 4 * k, a, idx[a]["name"], rb_s))
    with open(os.path.join(HERE, "vtables.tsv"), "w", encoding="utf-8", newline="") as f:
        f.write("vtable_addr\tslot\toffset\tfunc_addr\tfunc_name\treferenced_by\n")
        for v, k, off, a, nm, rb in rows:
            f.write("0x%06x\t%d\t0x%x\t%s\t%s\t%s\n" % (v, k, off, a, nm, rb))
    cited = {v: s for v, s in by_addr.items() if any(refs.get(v + 4 * k) for k in range(len(s)))}
    print(f"vtables.tsv: {len(vts)} sequências (>= {MIN_SLOTS} slots), {len(rows)} slots; "
          f"{len(cited)} citadas no C; conhecidas ausentes: {missing}")

    # ---- chamadas virtuais no fecho do servidor ----
    cand = defaultdict(lambda: defaultdict(list))  # offset -> func_addr -> [vtables conhecidas]
    other = defaultdict(lambda: defaultdict(list))  # idem, demais vtables citadas no C
    known = {int(k, 16) for k in KNOWN}
    for v, slots in cited.items():
        for k, fa in enumerate(slots):
            (cand if v in known else other)[4 * k]["0x%06x" % fa].append("0x%06x" % v)
    server = ps.read_tsv()
    calls = defaultdict(int)
    for a in sorted(server, key=lambda x: int(x, 16)):
        for off, base in virtual_calls(ps.func_text(idx, a)):
            calls[(a, off, base)] += 1
    with open(os.path.join(HERE, "virtual_calls.tsv"), "w", encoding="utf-8", newline="") as f:
        f.write("func_addr\tslot_offset\tbase_expr\tcandidates\n")
        n_cand = 0
        for (a, off, base), _ in sorted(calls.items(), key=lambda kv: (int(kv[0][0], 16), kv[0][1], kv[0][2])):
            c = cand.get(off, {})
            n_cand += bool(c)  # com candidato nas 4 conhecidas
            cs = ";".join("%s:%s[%s]" % (fa, idx[fa]["name"], ",".join(vl)) for fa, vl in sorted(c.items()))
            f.write("%s\t0x%x\t%s\t%s\n" % (a, off, base, cs))
    print(f"virtual_calls.tsv: {len(calls)} chamadas virtuais distintas em {len({k[0] for k in calls})} funções; "
          f"{n_cand} com candidatos nas 4 conhecidas")


NUM = re.compile(r"^(0x[0-9a-f]+|\d+)$")


def balanced(s, i):
    """s[i] == '(' -> índice do ')' correspondente, ou -1."""
    d = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            d += 1
        elif s[j] == ")":
            d -= 1
            if d == 0:
                return j
    return -1


def virtual_calls(text):
    """(slot_offset, base_expr) de cada `(**(code **)(BASE + off))(...)` ou `(**(code **)BASE)`; BASE começa com `*`
    (o objeto é BASE sem a desreferência) ou é `obj->Data1` (campo 0 do IID = vtable)."""
    res = []
    for m in re.finditer(r"\*\*\(code \*\*\)", text):
        i = m.end()
        if i >= len(text):
            continue
        if text[i] == "(":
            j = balanced(text, i)
            if j < 0:
                continue
            g = text[i + 1:j].strip()
            k = g.rfind(" + ")
            # divide no último `+ N` de nível 0
            d, cut = 0, -1
            for p, ch in enumerate(g):
                if ch == "(":
                    d += 1
                elif ch == ")":
                    d -= 1
                elif ch == "+" and d == 0 and p > 0 and g[p - 1] == " ":
                    cut = p
            if cut > 0 and NUM.match(g[cut + 1:].strip()):
                tail = g[cut + 1:].strip()
                off = int(tail, 0)
                base = g[:cut].strip()
            else:
                off, base = 0, g
            res.append((off, base))
        else:
            mm = re.match(r"[\w>\-\.\[\]]+", text[i:])
            if mm:
                res.append((0, mm.group(0)))
    return res


if __name__ == "__main__":
    main()
