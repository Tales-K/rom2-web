"""Lista de trabalho da porta do servidor do allods2.exe (docs/ABORDAGEM-FIDELIDADE-UNIDADES.md, seção 5; skill `port-exe`).

Mantém `tools/re/port_status.tsv`: uma linha por função do fecho de chamadas do servidor, com o estado da porta.
Colunas: addr, name, size, file, line, status, ts, note.  status ∈ {pending, ported, out, review}.
  pending = ainda não portada; ported = portada e provada pelo oráculo (ts = nome da função TS);
  out = fora do escopo com motivo (cliente, rede, log, salvar, código morto); review = tentada, não bateu (nota diz o que diverge).

Uso (sempre com o Python do projeto, .venv/Scripts/python.exe):
  port_status.py init                      # (re)gera o tsv a partir do callgraph; preserva estados já marcados
  port_status.py report                    # contagem e bytes por estado, % coberto
  port_status.py next --root 0x557f08 --n 15   # pendentes no fecho da raiz, FOLHAS PRIMEIRO (ordem de porta)
  port_status.py next --field 0x1c4+0x16 --n 15  # pendentes que ESCREVEM nesse campo: `+0x1c4` é PONTEIRO para a área de IA,
                                                 # logo o C escreve `*(short *)(*(int *)(this + 0x1c4) + 0x16) = ...`; `--field 0x58` = `(this + 0x58) =`
                                                 # Heurística: escritas por variável local intermediária (`iVar = *(int*)(this+0x1c4); iVar+0x16 = ..`)
                                                 # NÃO aparecem; confirme com `show` nos escritores conhecidos das notas.
  port_status.py show 0x557f08             # C da função + chamados (com estado) + chamadores
  port_status.py set 0x557f08 ported --ts approachCell --note "pares 0x557f08.jsonl 100%"

Raízes do fecho (chamadas diretas do callgraph + raízes de vtable que o callgraph não vê): ver ROOTS.
O C decompilado fica fora do repositório (A2_DECOMP ou o caminho padrão abaixo).
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from collections import defaultdict

DECOMP = os.environ.get("A2_DECOMP", r"C:\Users\TALES K\Games\allods2-decomp")
HERE = os.path.dirname(os.path.abspath(__file__))
TSV = os.path.join(HERE, "port_status.tsv")
COLS = ["addr", "name", "size", "file", "line", "status", "ts", "note"]
STATUSES = ("pending", "ported", "out", "review")
GAME_LO, GAME_HI = 0x401000, 0x57D000

# Raízes: Server_Tick e o que o servidor chama por vtable/ponteiro (callgraph.tsv só tem chamadas diretas).
ROOTS = {
    "0x4f08c0": "Server_Tick",
    "0x50f12c": "Unit_ActionMachine (vtable +0x18)",
    "0x50fc5a": "Unit_Regen (vtable +0x14)",
    "0x569321": "AI_TaskDispatcher",
    "0x570087": "AI_PlayerThink",
    "0x52bbb7": "World_SecondTick",
}
HEX = re.compile(r"^0x[0-9a-f]+$")


def load_index():
    idx = {}
    with open(os.path.join(DECOMP, "index.tsv"), encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            idx[r["addr"]] = r
    return idx


def load_callgraph():
    callees, callers = {}, defaultdict(list)
    with open(os.path.join(DECOMP, "callgraph.tsv"), encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            cs = [c.split(":")[0] for c in r["callees"].split(",") if c and HEX.match(c.split(":")[0])]
            callees[r["addr"]] = cs
            for c in cs:
                callers[c].append(r["addr"])
    return callees, callers


def in_game(addr):
    try:
        return GAME_LO <= int(addr, 16) < GAME_HI
    except ValueError:
        return False


PROFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exec_profile.tsv")


def load_profile():
    """addr -> entradas somadas nos episódios (tools/re/oracle/exec_profile.py); {} se o arquivo não existe."""
    if not os.path.exists(PROFILE):
        return {}
    with open(PROFILE, encoding="utf8") as f:
        return {r["addr"].lower(): int(r["total"]) for r in csv.DictReader(f, delimiter="	")}


def closure(roots, callees):
    seen, st = set(), list(roots)
    while st:
        a = st.pop()
        if a in seen:
            continue
        seen.add(a)
        st.extend(callees.get(a, []))
    return seen


def postorder(roots, callees, keep):
    """Folhas primeiro: uma função aparece depois de todas as que ela chama (dentro de `keep`)."""
    out, seen = [], set()

    def visit(a):
        if a in seen or a not in keep:
            return
        seen.add(a)
        for c in callees.get(a, []):
            visit(c)
        out.append(a)

    sys.setrecursionlimit(10000)
    for r in roots:
        visit(r)
    return out


def read_tsv():
    rows = {}
    if os.path.exists(TSV):
        with open(TSV, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                rows[r["addr"]] = r
    return rows


def write_tsv(rows):
    with open(TSV, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, delimiter="\t", lineterminator="\n")
        w.writeheader()
        for a in sorted(rows, key=lambda x: int(x, 16)):
            w.writerow({c: rows[a].get(c, "") for c in COLS})


def norm_addr(s):
    s = s.lower()
    if not s.startswith("0x"):
        s = "0x" + s
    return "0x%06x" % int(s, 16)


def func_text(idx, addr):
    """Texto do C da função: do cabeçalho `/* ---- 0xADDR` até o próximo cabeçalho."""
    r = idx[addr]
    path = os.path.join(DECOMP, r["file"])
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    i = int(r["line"]) - 1
    j = i + 1
    while j < len(lines) and not lines[j].startswith("/* ---- 0x"):
        j += 1
    return "\n".join(lines[i:j]).rstrip() + "\n"


def field_patterns(s):
    """'0x58' -> escrita em (base + 0x58); '0x1c4+0x16' -> escrita em (*(int *)(base + 0x1c4) + 0x16) (ponteiro + campo).
    Devolve (estrito: base = this/param_1, solto: qualquer identificador como base)."""
    parts = [int(p, 0) for p in s.replace(" ", "").split("+")]
    base_strict = r"(?:this|param_1|in_ECX)"
    base_loose = r"[A-Za-z_][A-Za-z_0-9]*"

    def num(v):  # o Ghidra imprime < 10 em decimal e o resto em hexadecimal
        return r"(?:0x%x|%d)" % (v, v)

    def expr(base):
        e = r"\(\s*(?:\([a-z ]+\*?\))?\s*%s\s*\+\s*%s\s*\)" % (base, num(parts[0]))
        for off in parts[1:]:
            e = r"\(\s*\*\s*\(int \*\)\s*%s\s*\+\s*%s\s*\)" % (e, num(off))
        return re.compile(e + r"\s*=[^=]")

    return expr(base_strict), expr(base_loose)


def cmd_init(_):
    idx = load_index()
    callees, _ = load_callgraph()
    base = closure(ROOTS, callees)
    # Funções executadas no tique (exec_profile.tsv) que o callgraph não alcança a partir das raízes: chamadas por vtable ou
    # ponteiro. Entram como raízes extras, com o seu próprio fecho, para a lista cobrir tudo o que roda no corpus.
    prof = load_profile()
    extra = sorted((a for a in prof if a in idx and in_game(a) and a not in base), key=lambda x: int(x, 16))
    fecho = sorted((a for a in closure(list(ROOTS) + extra, callees) if in_game(a) and a in idx), key=lambda x: int(x, 16))
    old = read_tsv()
    rows = {}
    for a in fecho:
        r = idx[a]
        row = {"addr": a, "name": r["name"], "size": r["size_bytes"], "file": r["file"], "line": r["line"],
               "status": "pending", "ts": "", "note": "raiz extra: executada no corpus sem chamador no callgraph (vtable/ponteiro)" if a in extra else ""}
        if a in old:
            for c in ("status", "ts", "note"):
                row[c] = old[a].get(c, "") or row[c]
        rows[a] = row
    dropped = [a for a in old if a not in rows and old[a]["status"] != "pending"]
    write_tsv(rows)
    print(f"{TSV}: {len(rows)} funções no fecho de {len(ROOTS)} raízes + {len(extra)} raízes extras do exec_profile; {len(old)} linhas anteriores; "
          f"{len(dropped)} marcadas que saíram do fecho (mantidas fora do tsv; confira): {dropped[:10]}")


def cmd_report(_):
    rows = read_tsv()
    if not rows:
        sys.exit("sem tsv: rode `init`")
    tot = defaultdict(lambda: [0, 0])
    for r in rows.values():
        tot[r["status"]][0] += 1
        tot[r["status"]][1] += int(r["size"] or 0)
    print("estado      funções   bytes")
    for s in STATUSES:
        n, b = tot[s]
        print(f"{s:<10} {n:>8} {b:>8}")
    scope_b = sum(int(r["size"] or 0) for r in rows.values() if r["status"] != "out")
    ported_b = tot["ported"][1]
    print(f"cobertura: {ported_b}/{scope_b} bytes no escopo = {100.0 * ported_b / max(1, scope_b):.1f} %")
    prof = load_profile()
    if prof:
        ex = [a for a, r in rows.items() if r["status"] != "out" and prof.get(a, 0) > 0]
        ex_b = sum(int(rows[a]["size"] or 0) for a in ex)
        ex_p = sum(int(rows[a]["size"] or 0) for a in ex if rows[a]["status"] == "ported")
        print(f"executadas no corpus (exec_profile.tsv): {len(ex)} funções, {ex_b} bytes; portadas {ex_p}/{ex_b} bytes = "
              f"{100.0 * ex_p / max(1, ex_b):.1f} %")


def _print_batch(addrs, rows, n, prof=None):
    prof = load_profile() if prof is None else prof
    print("ordem  addr      size   exec  status   name")
    for i, a in enumerate(addrs[:n], 1):
        r = rows[a]
        print(f"{i:>4}  {a}  {int(r['size'] or 0):>5} {prof.get(a, 0):>6}  {r['status']:<8} {r['name']}")
    if len(addrs) > n:
        print(f"... e mais {len(addrs) - n} pendentes no fecho")


def cmd_next(args):
    rows = read_tsv()
    if not rows:
        sys.exit("sem tsv: rode `init`")
    callees, _ = load_callgraph()
    pend = {a for a, r in rows.items() if r["status"] == "pending"}
    if args.root:
        root = norm_addr(args.root)
        keep = closure([root], callees) & set(rows)
        order = [a for a in postorder([root], callees, keep) if a in pend]
        if args.max_size:
            order = [a for a in order if int(rows[a]["size"] or 0) <= args.max_size]
        prof = load_profile()
        if args.executed:
            if not prof:
                sys.exit(f"--executed precisa de {PROFILE} (tools/re/oracle/exec_profile.py)")
            order = [a for a in order if prof.get(a, 0) > 0]
        print(f"fecho de {root} {rows.get(root, {}).get('name', '?')}: {len(keep)} funções, {len(order)} pendentes"
              f"{' executadas no corpus' if args.executed else ''}; folhas primeiro:")
        _print_batch(order, rows, args.n, prof)
    elif args.field:
        strict, loose = field_patterns(args.field)
        idx = load_index()
        hits, maybe = [], []
        for a in sorted(pend, key=lambda x: int(x, 16)):
            t = func_text(idx, a)
            if strict.search(t):
                hits.append(a)
            elif loose.search(t):
                maybe.append(a)
        print(f"pendentes que escrevem em this+{args.field}: {len(hits)} (base this/param_1)")
        _print_batch(hits, rows, args.n)
        print(f"possíveis (mesmo caminho a partir de outra variável; confira o tipo da base): {len(maybe)}")
        _print_batch(maybe, rows, args.n)
    else:
        sys.exit("informe --root ou --field")


def cmd_show(args):
    rows = read_tsv()
    idx = load_index()
    callees, callers = load_callgraph()
    a = norm_addr(args.addr)
    if a not in idx:
        sys.exit(f"{a} não está no index")
    r = idx[a]
    st = rows.get(a, {}).get("status", "(fora do fecho)")
    ex = load_profile().get(a, 0)
    print(f"== {a} {r['name']} size={r['size_bytes']} {r['file']}:{r['line']} status={st} exec={ex} {rows.get(a, {}).get('note', '')}")
    print("-- chama:")
    for c in callees.get(a, []):
        print(f"   {c} {idx.get(c, {}).get('name', '?'):<28} {rows.get(c, {}).get('status', '-')}")
    print("-- chamada por:")
    for c in callers.get(a, [])[:12]:
        print(f"   {c} {idx.get(c, {}).get('name', '?'):<28} {rows.get(c, {}).get('status', '-')}")
    print("-- C:")
    print(func_text(idx, a))


def cmd_set(args):
    rows = read_tsv()
    a = norm_addr(args.addr)
    if a not in rows:
        sys.exit(f"{a} não está no tsv (fora do fecho? rode `init` ou confira o endereço)")
    if args.status not in STATUSES:
        sys.exit(f"status deve ser um de {STATUSES}")
    rows[a]["status"] = args.status
    if args.ts is not None:
        rows[a]["ts"] = args.ts
    if args.note is not None:
        rows[a]["note"] = args.note
    if args.status in ("out", "review") and not rows[a]["note"]:
        sys.exit("`out` e `review` exigem --note com o motivo")
    write_tsv(rows)
    print(f"{a} {rows[a]['name']} -> {args.status} {rows[a]['ts']} {rows[a]['note']}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("init").set_defaults(fn=cmd_init)
    sp.add_parser("report").set_defaults(fn=cmd_report)
    n = sp.add_parser("next")
    n.add_argument("--root")
    n.add_argument("--field")
    n.add_argument("--n", type=int, default=15)
    n.add_argument("--max-size", type=int, default=0)
    n.add_argument("--executed", action="store_true", help="só funções com entradas no exec_profile.tsv")
    n.set_defaults(fn=cmd_next)
    s = sp.add_parser("show")
    s.add_argument("addr")
    s.set_defaults(fn=cmd_show)
    st = sp.add_parser("set")
    st.add_argument("addr")
    st.add_argument("status")
    st.add_argument("--ts")
    st.add_argument("--note")
    st.set_defaults(fn=cmd_set)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
