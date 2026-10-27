"""Inventário estático de acessos a campos de estruturas no fecho do servidor do allods2.exe (só leitura do C decompilado).

Saídas (tools/re/):
  field_inventory.tsv   func_addr, func_name, base, path, size, rw, count, type, src
  fields_by_type.tsv    type, path, size, n_funcs, n_writes, example_funcs, known

`base` = raiz do acesso: `this` (in_ECX conta como this), `param_N`, variável local sem origem rastreável, global
`DAT_...`/`&DAT_...`, ou `ret:Nome` (valor devolvido por uma chamada). Variáveis locais que recebem UM único valor
rastreável (`iVar1 = *(int *)(this + 0x1c4)`) são resolvidas para a raiz/caminho de origem.
`path` = deslocamentos em hexa: `0x58` (campo direto) ou `0x1c4->0x16` (ponteiro em +0x1c4, depois campo +0x16);
`[]` depois de um deslocamento = índice de vetor não constante. `size` pelo cast; `rw` ∈ r|w|rw (rw = op composto).
`type` ∈ unit|group|player|world|path|unknown (+ `ai` = sub-objeto de IA apontado por unit+0x1c4; `path` = sub-objeto de
andar apontado por unit+0x1c0), `src` = origem da classificação: seed (nome da função), off (deslocamentos 1o nível: >= 0x10000 => mundo; 0x1c0/0x1c4 => unidade),
arg (ponteiro de unit+0x1c0/0x1c4 passado como argumento), prop
(propagação por argumentos de chamada), fp (impressão digital dos deslocamentos, fraca), ou vazio.

Heurísticas e limites: ver o final deste docstring e o relatório da tarefa.
  * o Ghidra imprime números < 10 em decimal; ponteiros tipados (`int *p`) escalam `p + N`; `IID *` (mal inferido para
    `this`) escala 16 e aparece como `p[k].Data1..4`; tudo isso é reduzido a deslocamentos em bytes;
  * escritas por variável local com mais de uma origem não são rastreadas (a base vira a variável local);
  * não há análise de fluxo: aliases são "um único valor por variável na função inteira".

Uso: .venv/Scripts/python.exe tools/re/field_inventory.py
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import port_status as ps  # noqa: E402

HERE = ps.HERE
ROOT = os.path.dirname(os.path.dirname(HERE))
NOTES = ["ai-behaviors", "ai-original", "differential-fuzz", "combat-formulas", "magic-original"]

SIZE1 = {"byte", "char", "undefined1", "undefined", "bool", "uchar", "BYTE", "CHAR"}
SIZE2 = {"short", "ushort", "undefined2", "WORD"}
SIZE4 = {"int", "uint", "undefined4", "long", "ulong", "float", "DWORD", "size_t", "LPVOID", "LPCSTR", "dword"}
SIZE8 = {"longlong", "ulonglong", "undefined8", "double", "LARGE_INTEGER"}
TYPE_NAMES = SIZE1 | SIZE2 | SIZE4 | SIZE8 | {"void", "code", "IID", "IUnknown", "IUnknownVtbl", "undefined3", "undefined5",
                                              "undefined6", "undefined7", "unsigned", "signed", "const"}
ELEM = {"IID": 16, "IUnknown": 4, "void": 1, "undefined3": 3}
IID_MEM = {"Data1": (0, 4), "Data2": (4, 2), "Data3": (6, 2)}  # Data4[i] = (8 + i, 1)
ACCESS_CAST = re.compile(r"\*\(\s*([A-Za-z_]\w*)\s*(\*+)\s*\)")
CAST_RE = re.compile(r"^\(\s*((?:unsigned |signed |const )*[A-Za-z_]\w*)(\s*\*+)?\s*\)\s*(?=\S)")
NUM_RE = re.compile(r"^-?(?:0x[0-9a-fA-F]+|\d+)[uUlL]*$")
IDENT = re.compile(r"^[A-Za-z_]\w*$")
RECV_ALIAS = {"in_ECX": "this"}


def size_of(tname, stars):
    if len(stars) >= 2:
        return 4
    if tname in SIZE1:
        return 1
    if tname in SIZE2:
        return 2
    if tname in SIZE4:
        return 4
    if tname in SIZE8:
        return 8
    if tname == "code":
        return 4
    return ELEM.get(tname)  # None se desconhecido (struct)


def balanced(s, i, op="(", cl=")"):
    d = 0
    for j in range(i, len(s)):
        if s[j] == op:
            d += 1
        elif s[j] == cl:
            d -= 1
            if d == 0:
                return j
    return -1


def fmt(cur, arr):
    return ("-0x%x" % -cur if cur < 0 else "0x%x" % cur) + ("[]" if arr else "")


def split_terms(s):
    """Divide em termos de nível 0 por +/-; devolve [(sinal, texto)]."""
    terms, d, cur, sign, prev_op = [], 0, [], 1, True
    i = 0
    while i < len(s):
        ch = s[i]
        if ch in "([":
            d += 1
        elif ch in ")]":
            d -= 1
        if d == 0 and ch in "+-" and not (ch == "-" and s[i + 1:i + 2] == ">"):
            before = "".join(cur).strip()
            if before == "" and not terms:  # sinal unário no início
                sign = -1 if ch == "-" else 1
                i += 1
                continue
            if before == "":  # unário depois de outro operador (`+ -2`)
                sign = -sign if ch == "-" else sign
                i += 1
                continue
            terms.append((sign, before))
            cur = []
            sign = -1 if ch == "-" else 1
            i += 1
            continue
        cur.append(ch)
        i += 1
    last = "".join(cur).strip()
    if last:
        terms.append((sign, last))
    return terms


class Val:
    __slots__ = ("root", "chain", "cur", "arr")

    def __init__(self, root, chain=(), cur=0, arr=False):
        self.root, self.chain, self.cur, self.arr = root, tuple(chain), cur, arr

    def key(self):
        return (self.root, self.chain, self.cur, self.arr)

    def deref(self):
        return Val(self.root, self.chain + (fmt(self.cur, self.arr),), 0, False)

    def path(self):
        return "->".join(self.chain + (fmt(self.cur, self.arr),))


class Func:
    def __init__(self, addr, name, text):
        self.faddr, self.name, self.text = addr, name, text
        lines = text.split("\n")
        try:
            b = next(i for i, l in enumerate(lines) if l == "{")
        except StopIteration:
            b = len(lines)
        head = " ".join(l.strip() for l in lines[:b] if l.strip() and not l.startswith("/*"))
        self.body = "\n".join(lines[b + 1:])
        m = re.search(r"__(thiscall|fastcall|cdecl|stdcall)", head)
        self.conv = m.group(1) if m else ""
        self.params = []  # [(type, name)]
        if "(" in head and ")" in head:
            inner = head[head.index("(") + 1:head.rindex(")")]
            d, cur, parts = 0, [], []
            for ch in inner:
                if ch in "(<":
                    d += 1
                elif ch in ")>":
                    d -= 1
                if ch == "," and d == 0:
                    parts.append("".join(cur))
                    cur = []
                else:
                    cur.append(ch)
            parts.append("".join(cur))
            for p in parts:
                p = p.strip()
                mm = re.match(r"^(.*?)(\w+)$", p)
                if p and p != "void" and mm and not p.endswith("void"):
                    self.params.append((mm.group(1).strip(), mm.group(2)))
        self.decl = {n: t for t, n in self.params}  # nome -> tipo textual
        self.arrays = set()
        for l in self.body.split("\n"):
            if not l.strip():
                continue
            s = l.strip()
            if "(" in s or "=" in s or not s.endswith(";"):
                break
            s = s[:-1].strip()
            arr = re.search(r"\s*\[[^\]]*\]$", s)
            if arr:
                s = s[:arr.start()]
            mm = re.match(r"^(.*?)(\w+)$", s)
            if mm:
                self.decl[mm.group(2)] = mm.group(1).strip()
                if arr:
                    self.arrays.add(mm.group(2))
        self.slot0 = "this" if any(n == "this" for _, n in self.params) else (self.params[0][1] if self.params else None)
        self.alias = {}
        self.unres = 0

    # ---- tipos declarados ----
    def elem_size(self, ident):
        t = self.decl.get(ident)
        if not t or ident in self.arrays:
            return None
        m = re.match(r"^((?:unsigned |const )*[\w:<>,]+)\s*(\*+)$", t)
        if not m:
            return None
        return size_of(m.group(1).split()[-1], m.group(2)) if len(m.group(2)) == 1 else 4

    def norm_root(self, ident):
        return RECV_ALIAS.get(ident, ident)

    # ---- resolução de expressões de endereço ----
    def strip(self, s):
        cast = False
        while True:
            s = s.strip()
            if s.startswith("(") and balanced(s, 0) == len(s) - 1:
                inner = s[1:-1].strip()
                if not CAST_RE.match("(" + inner + ")x") or not (IDENT.match(inner) is None and inner.endswith("*")):
                    s = inner
                    continue
            m = CAST_RE.match(s)
            if m and (m.group(2) or m.group(1).split()[-1] in TYPE_NAMES):
                s = s[m.end():]
                cast = True
                continue
            return s, cast

    def term(self, t):
        """(Val, escala, sem_cast) ou None; Val descreve o valor (ponteiro) do termo."""
        t, cast = self.strip(t)
        if not t:
            return None
        if NUM_RE.match(t):
            return None
        m = ACCESS_CAST.match(t)
        if m:
            rest = t[m.end():].strip()
            if rest.startswith("("):
                j = balanced(rest, 0)
                if j != len(rest) - 1:
                    return None
                rest = rest[1:-1]
            v = self.addr(rest)
            return (v.deref(), 1, False) if v else None
        m = re.match(r"^\*\s*(\w+)$", t)
        if m and IDENT.match(m.group(1)):
            v = self.ident(m.group(1))
            return (v[0].deref(), 1, False) if v else None
        m = re.match(r"^(&)?(\w+)\[(0x[0-9a-f]+|\d+)\](?:\.(Data[1-4]|lpVtbl)(?:\[(\d+)\])?)?$", t)
        if m:
            amp, ident, k, mem, sub = m.groups()
            v = self.ident(ident)
            if not v:
                return None
            k = int(k, 0)
            if mem is None:
                es = self.elem_size(ident)
                if es is None:
                    return None
                off = k * es
            elif mem == "lpVtbl":
                off = k * 4
            else:
                off = k * 16 + (IID_MEM[mem][0] if mem != "Data4" else 8 + int(sub or 0))
                if mem == "Data4" and sub is None and not amp:
                    amp = "&"  # Data4 sem índice decai para endereço
            vv = Val(v[0].root, v[0].chain, v[0].cur + off, v[0].arr)
            return ((vv if amp else vv.deref()), 1, False)
        m = re.match(r"^(&)?(\w+)->(Data1|Data2|Data3|lpVtbl)$", t)
        if m:
            amp, ident, mem = m.groups()
            v = self.ident(ident)
            if not v:
                return None
            off = IID_MEM.get(mem, (0, 4))[0]
            vv = Val(v[0].root, v[0].chain, v[0].cur + off, v[0].arr)
            return ((vv if amp else vv.deref()), 1, False)
        if t.startswith("&"):
            m = re.match(r"^&(\w+)$", t)
            if m and not m.group(1).startswith("(") and m.group(1) not in self.decl:
                return (Val("&" + m.group(1)), 1, False)
            if m:
                return (Val("&" + self.norm_root(m.group(1))), 1, False)
            return None
        m = re.match(r"^([A-Za-z_][\w:<>~]*)\(", t)
        if m and balanced(t, t.index("(")) == len(t) - 1:
            return (Val("ret:" + m.group(1)), 1, False)
        if IDENT.match(t):
            v = self.ident(t)
            if not v:
                return None
            val, scale = v
            return (val, scale if not cast else 1, not cast)
        return None

    def ident(self, name):
        a = self.alias.get(name)
        if a is not None:
            return (Val(a.root, a.chain, a.cur, a.arr), 1)
        sc = self.elem_size(name) if not (name in RECV_ALIAS) else 1
        return (Val(self.norm_root(name)), sc if sc else 1)

    def addr(self, expr):
        """Soma de termos -> Val (ponteiro + deslocamento constante) ou None."""
        s, _ = self.strip(expr)
        terms = split_terms(s)
        if not terms:
            return None
        nums, cands, idx = 0, [], False
        for sg, t in terms:
            ts, _ = self.strip(t)
            if NUM_RE.match(ts):
                nums += sg * int(ts.rstrip("uUlL"), 0)
                continue
            r = self.term(t)
            if r is None or sg < 0:
                idx = True
                continue
            cands.append(r)
        if not cands:
            return None

        def strong(c):
            r = c[0].root
            return (c[0].chain != () or r == "this" or r.startswith(("param_", "DAT_", "&", "ret:"))
                    or c[0].root in self.alias)

        base = next((c for c in cands if strong(c)), cands[0])
        idx = idx or len(cands) > 1
        v, scale, bare = base
        off = nums * (scale if bare else 1)
        return Val(v.root, v.chain, v.cur + off, v.arr or idx)

    # ---- aliases de variáveis locais ----
    def build_aliases(self):
        names = {n for n in self.decl if n not in {p[1] for p in self.params}}
        assigns = defaultdict(list)
        body = self.body
        for m in re.finditer(r"(?<![.\w>])([A-Za-z_]\w*) = (?!=)", body):
            nm = m.group(1)
            if nm not in names:
                continue
            i, d = m.end(), 0
            j = i
            while j < len(body):
                ch = body[j]
                if ch in "([":
                    d += 1
                elif ch in ")]":
                    d -= 1
                    if d < 0:
                        break
                elif ch in ";," and d == 0:
                    break
                j += 1
            assigns[nm].append(body[i:j].strip())
        for _ in range(4):
            new = {}
            for nm, rhss in assigns.items():
                vals, bad = set(), False
                for r in rhss:
                    rs, _ = self.strip(r)
                    if NUM_RE.match(rs):
                        continue  # 0 / constante: não decide
                    v = self.addr(r)
                    if v is None or v.root == nm or v.root.startswith("&") and False:
                        bad = True
                        break
                    vals.add(v.key())
                if not bad and len(vals) == 1:
                    root, chain, cur, arr = next(iter(vals))
                    new[nm] = Val(root, chain, cur, arr)
            if {k: v.key() for k, v in new.items()} == {k: v.key() for k, v in self.alias.items()}:
                break
            self.alias = new

    # ---- acessos ----
    def accesses(self):
        """Gera (Val com o caminho completo no .chain+cur, size, rw)."""
        body = self.body
        out = []

        def rw_of(end):
            m = re.match(r"\s*(=(?!=)|(?:[-+*/%|&^]|<<|>>)=|\+\+|--)", body[end:])
            if not m:
                return "r"
            return "w" if m.group(1) == "=" else "rw"

        for m in ACCESS_CAST.finditer(body):
            tname, stars = m.group(1), m.group(2)
            sz = size_of(tname, stars)
            if sz is None:
                continue
            e = m.end()
            while e < len(body) and body[e] == " ":
                e += 1
            if e >= len(body):
                continue
            if body[e] == "(":
                j = balanced(body, e)
                if j < 0:
                    continue
                v = self.addr(body[e + 1:j])
                end = j + 1
            else:
                mm = re.match(r"&?\w+(?:\[[^\]]*\])?(?:\.\w+(?:\[\d+\])?|->\w+)?", body[e:])
                if not mm or body[e + mm.end():e + mm.end() + 1] == "(":
                    continue
                v = self.addr(mm.group(0))
                end = e + mm.end()
            if v is None:
                self.unres += 1
                continue
            out.append((v, sz, rw_of(end)))

        # p[k], p[k].DataN, p[k].Data4[i], p->DataN
        for m in re.finditer(r"(?<![\w&.])([A-Za-z_]\w*)\[(0x[0-9a-f]+|\d+)\](?:\.(Data[1-4]|lpVtbl)(?:\[(\d+)\])?)?", body):
            ident, k, mem, sub = m.group(1), int(m.group(2), 0), m.group(3), m.group(4)
            if ident not in self.decl or ident in self.arrays:
                continue
            t = self.decl[ident]
            es = self.elem_size(ident)
            if es is None:
                continue
            if mem is None:
                if t.startswith("IID") or t.startswith("IUnknown"):
                    continue
                off, sz = k * es, es
            elif mem == "lpVtbl":
                off, sz = k * 4, 4
            elif mem == "Data4":
                if sub is None:
                    continue
                off, sz = k * 16 + 8 + int(sub), 1
            else:
                off, sz = k * 16 + IID_MEM[mem][0], IID_MEM[mem][1]
            v = self.ident(ident)[0]
            out.append((Val(v.root, v.chain, v.cur + off, v.arr), sz, rw_of(m.end())))
        for m in re.finditer(r"(?<![\w&.])([A-Za-z_]\w*)->(Data1|Data2|Data3|lpVtbl)\b", body):
            ident, mem = m.groups()
            if ident not in self.decl:
                continue
            v = self.ident(ident)[0]
            off, sz = IID_MEM.get(mem, (0, 4))
            out.append((Val(v.root, v.chain, v.cur + off, v.arr), sz, rw_of(m.end())))
        # *p (deslocamento 0) em ponteiros tipados
        for m in re.finditer(r"(?:(?<=[(=,!|&<>+\-*;{])|^|(?<=return))\s*\*(\w+)\b(?!\s*[(\[])", body, re.M):
            ident = m.group(1)
            es = self.elem_size(ident)
            if ident not in self.decl or es is None or ident in self.arrays:
                continue
            v = self.ident(ident)[0]
            out.append((Val(v.root, v.chain, v.cur, v.arr), es, rw_of(m.end())))
        return out

    def calls_loaded(self, names):
        """[(callee_addr, argpos, Val)] para argumentos que são um ponteiro carregado de UM campo (`this->0x1c0`)."""
        res = []
        for cal, k, a in self._call_args(names):
            r = self.term(a)
            if r and len(r[0].chain) == 1 and r[0].cur == 0 and not r[0].root.startswith("ret:"):
                res.append((cal, k, r[0]))
        return res

    # ---- chamadas ----
    def calls(self, names):
        """[(callee_addr, argpos, Val)] para argumentos que são ponteiros 'puros' (sem deslocamento)."""
        res = []
        for cal, k, a in self._call_args(names):
            r = self.term(a)
            if r and r[0].chain == () and r[0].cur == 0 and not r[0].arr and not r[0].root.startswith("ret:"):
                res.append((cal, k, r[0]))
        return res

    def _call_args(self, names):
        res = []
        body = self.body
        for m in re.finditer(r"(?<![\w.>])([A-Za-z_]\w*)\(", body):
            cal = names.get(m.group(1))
            if not cal:
                continue
            j = balanced(body, m.end() - 1)
            if j < 0:
                continue
            args, d, cur = [], 0, []
            for ch in body[m.end():j]:
                if ch in "([":
                    d += 1
                elif ch in ")]":
                    d -= 1
                if ch == "," and d == 0:
                    args.append("".join(cur))
                    cur = []
                else:
                    cur.append(ch)
            args.append("".join(cur))
            for k, a in enumerate(args):
                res.append((cal, k, a))
        return res


def node_key(fa, root):
    r = root.lstrip("&")
    if r.startswith(("DAT_", "ret:")):
        return ("*", r)
    return (fa, root)


def seeds_for(fn):
    """Sementes por nome: lista de (slot, tipo, peso)."""
    n, ps_ = fn.name, [p[1] for p in fn.params]
    s0 = fn.slot0
    out = []
    has_this = "this" in ps_
    other = [p for p in ps_ if p != "this"]
    if n.startswith(("Unit_", "Corpse_")) and s0:
        out.append((s0, "unit", 5))
    elif n == "AI_PlayerThink":
        out += [("this", "world", 4), ("param_1", "player", 5)]
    elif n.startswith(("AI_Group", "AI_NewGroup")) and n != "AI_GroupCommandDispatch":
        g = other[0] if other else None
        if g:
            out.append((g, "group", 5))
        if has_this:
            out.append(("this", "world", 3))
    elif n.startswith("World_") and s0:
        out.append((s0, "world", 4))
    elif n in ("Server_Tick", "Server_WorldTick", "Server_ClockTick", "Server_ClientMessages", "Server_PacketDispatcher") and s0:
        out.append((s0, "world", 3))
    return out


RET_SEEDS = {"ret:Human_CreateByName": "unit", "ret:Monster_CreateByName": "unit", "ret:Server_FindPlayerByName": "player"}


def load_notes():
    """(cadeia de deslocamentos como tupla) -> [(arquivo, trecho, linha)]"""
    known = defaultdict(list)
    files = [os.path.join(ROOT, "notes", n + ".md") for n in NOTES]
    pat = re.compile(r"\+(0x[0-9a-f]+(?:\s*(?:\+|->)\s*0x[0-9a-f]+)*)", re.I)
    for fp in files:
        if not os.path.exists(fp):
            continue
        stem = os.path.basename(fp)[:-3]
        for ln in open(fp, encoding="utf-8", errors="replace").read().split("\n"):
            for m in pat.finditer(ln):
                chain = tuple(int(x, 16) for x in re.findall(r"0x[0-9a-f]+", m.group(1), re.I))
                tail = ln[m.end():m.end() + 70]
                tail = re.split(r"\+0x|,\s|;|\.\s|\s—\s|\|", tail)[0]
                snip = re.sub(r"[`*|\t]", "", tail).strip(" :=,-)]")
                if not snip:
                    snip = re.sub(r"[`*|\t]", "", ln[max(0, m.start() - 40):m.start()]).strip(" :=,-(")
                known[chain].append((stem, snip[:40], ln.lower()))
    try:
        kf = json.load(open(os.path.join(HERE, "known_functions.json"), encoding="utf-8"))["functions"]
        for k in kf:
            for m in pat.finditer(k["desc"]):
                chain = tuple(int(x, 16) for x in re.findall(r"0x[0-9a-f]+", m.group(1), re.I))
                known[chain].append(("fn:" + k["name"], k["desc"][:48], k["desc"].lower()))
    except OSError:
        pass
    return known


TYPE_WORDS = {"unit": ("unidade", "unit", "monstro", "heroi", "herói"), "group": ("grupo", "group"),
              "player": ("jogador", "player"), "world": ("mundo", "world", "servidor"),
              "path": ("caminho", "path", "onda"), "ai": ("ia ", "ai ")}


def known_for(known, typ, path):
    if path.startswith("0x0->"):
        return ""  # leitura de slot de vtable (`*(this) + off`), não campo
    try:
        chain = tuple(int(x.rstrip("[]"), 16) for x in path.split("->"))
    except ValueError:
        return ""
    exact = known.get(chain, [])
    cand = [(1, e) for e in exact]
    if len(chain) > 1 or not exact:
        cand += [(0, e) for e in known.get(chain[-1:], []) if (chain[-1:] != chain)]
    words = TYPE_WORDS.get(typ, ())
    best = []
    for ex, (stem, snip, line) in cand:
        corr = any(w in line for w in words)
        score = (2 if corr else 0) + ex
        best.append((score, ex, corr, stem, snip))
    best.sort(key=lambda x: -x[0])
    seen, out = set(), []
    for score, ex, corr, stem, snip in best:
        if (stem, snip) in seen:
            continue
        seen.add((stem, snip))
        if typ == "unknown" and not ex:
            continue
        out.append(("" if corr and ex else "~") + f"{stem}:{snip}")
        if len(out) == 2:
            break
    return " | ".join(out)


def main():
    idx = ps.load_index()
    rows = ps.read_tsv()
    addrs = sorted(rows, key=lambda x: int(x, 16))
    names = {}
    dup = Counter(r["name"] for r in idx.values())
    for a in addrs:
        nm = idx[a]["name"]
        if dup[nm] == 1 and re.match(r"^[A-Za-z_]\w*$", nm):
            names[nm] = a
    funcs = {}
    for a in addrs:
        f = Func(a, idx[a]["name"], ps.func_text(idx, a))
        f.build_aliases()
        funcs[a] = f

    # ---- acessos ----
    acc = {}  # a -> Counter[(root, path, size, rw)]
    offsets_of = defaultdict(set)  # nó -> deslocamentos de 1o nível
    writes_total = 0
    unres = 0
    for a, f in funcs.items():
        c = Counter()
        for v, sz, rw in f.accesses():
            if v.root.startswith(("unaff_", "&unaff_", "in_FS")):
                continue  # prólogo SEH, não é campo de estrutura
            c[(v.root, v.path(), sz, rw)] += 1
            offsets_of[node_key(a, v.root)].add(v.chain[0] if v.chain else fmt(v.cur, v.arr))
        acc[a] = c
        unres += f.unres

    # ---- grafo de tipos ----
    label, src, weight = {}, {}, {}
    for a, f in funcs.items():
        for slot, typ, w in seeds_for(f):
            k = node_key(a, slot)
            if w > weight.get(k, 0):
                label[k], src[k], weight[k] = typ, "seed", w
    for r, t in RET_SEEDS.items():
        label[("*", r)], src[("*", r)], weight[("*", r)] = t, "seed", 5
    edges = defaultdict(set)
    for a, f in funcs.items():
        for cal, k, v in f.calls(names):
            cf = funcs[cal]
            if k >= len(cf.params):
                continue
            n1, n2 = node_key(a, v.root), node_key(cal, cf.params[k][1])
            if n1 != n2:
                edges[n1].add(n2)
                edges[n2].add(n1)

    def propagate(tag):
        for _ in range(30):
            new = {}
            for n, nb in edges.items():
                if n in label:
                    continue
                # globais (DAT_, ret:) só servem de fonte quando semeados: senão viram "hubs" que espalham o rótulo
                votes = Counter(label[m] for m in nb if m in label and (m[0] != "*" or src.get(m) == "seed"))
                if not votes:
                    continue
                top = votes.most_common(2)
                if len(top) > 1 and top[0][1] < 2 * top[1][1]:
                    continue  # vizinhos discordam (função utilitária compartilhada): não decide
                new[n] = top[0][0]
            if not new:
                break
            for n, t in new.items():
                label[n], src[n] = t, tag

    # evidência dura pelos deslocamentos de 1o nível da própria raiz: prevalece sobre a sugestão do nome da função
    # (ex.: Unit_ActionWalk tem `this` = mundo e param_1 = unidade)
    def first_off(o):
        try:
            return int(o.rstrip("[]"), 16)
        except ValueError:
            return -1

    n_over = 0
    for n, offs in offsets_of.items():
        if n[0] == "*":
            continue
        big = any(first_off(o) >= 0x10000 for o in offs)
        ukey = any(o in ("0x1c0", "0x1c4") for o in offs)
        ev = "world" if big and not ukey else ("unit" if ukey and not big else None)
        if ev and label.get(n) != ev:
            if n in label:
                n_over += 1
            label[n], src[n] = ev, "off"
    # ponteiros carregados de +0x1c0 / +0x1c4 da unidade e passados como argumento: sub-objetos de andar ('path') e de IA ('ai')
    for a, f in funcs.items():
        for cal, k, v in f.calls_loaded(names):
            cf = funcs[cal]
            if k < len(cf.params):
                n = node_key(cal, cf.params[k][1])
                if n not in label and v.chain == ("0x1c0",):
                    label[n], src[n] = "path", "arg"
                elif n not in label and v.chain == ("0x1c4",):
                    label[n], src[n] = "ai", "arg"
    propagate("prop")

    # ---- impressão digital dos deslocamentos (fraca) ----
    def fingerprint():
        by = defaultdict(list)
        for n, t in label.items():
            if n in offsets_of and src.get(n) in ("seed", "off", "arg"):
                by[t].append(offsets_of[n])
        cnt = {t: Counter(o for s in ss for o in s) for t, ss in by.items()}
        types = [t for t in by if len(by[t]) >= 10 and t not in ("path", "ai")]  # classes pequenas ficam promíscuas
        newl = {}
        for n, offs in offsets_of.items():
            if n in label or len(offs) < 4 or n[0] == "*":
                continue
            sc = {}
            for t in types:
                nt = len(by[t])
                sc[t] = sum(math.log((cnt[t][o] + 0.2) / (nt + 1.0)) for o in offs)
            top = sorted(sc.items(), key=lambda kv: -kv[1])
            if len(top) > 1 and top[0][1] - top[1][1] >= 3.0:
                newl[n] = top[0][0]
        for n, t in newl.items():
            label[n], src[n] = t, "fp"
        return len(newl)

    nfp = fingerprint()
    propagate("prop")

    # ---- saída ----
    known = load_notes()
    out = []
    for a in addrs:
        f = funcs[a]
        for (root, path, sz, rw), cnt in sorted(acc[a].items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][3])):
            k = node_key(a, root)
            out.append((a, f.name, root, path, sz, rw, cnt, label.get(k, "unknown"), src.get(k, "")))
    with open(os.path.join(HERE, "field_inventory.tsv"), "w", encoding="utf-8", newline="") as fo:
        fo.write("func_addr\tfunc_name\tbase\tpath\tsize\trw\tcount\ttype\tsrc\n")
        for r in out:
            fo.write("\t".join(str(x) for x in r) + "\n")

    agg = defaultdict(lambda: {"funcs": set(), "w": 0})
    for a, nm, root, path, sz, rw, cnt, typ, _s in out:
        g = agg[(typ, path, sz)]
        g["funcs"].add(a)
        if rw in ("w", "rw"):
            g["w"] += cnt
    order = {"unit": 0, "group": 1, "player": 2, "world": 3, "path": 4, "ai": 5, "unknown": 6}

    def sortkey(k):
        typ, path, sz = k
        els = []
        for x in path.split("->"):
            try:
                els.append(int(x.rstrip("[]"), 16))
            except ValueError:
                els.append(-1)
        return (order[typ], els, sz)

    n_known = Counter()
    n_rows = Counter()
    with open(os.path.join(HERE, "fields_by_type.tsv"), "w", encoding="utf-8", newline="") as fo:
        fo.write("type\tpath\tsize\tn_funcs\tn_writes\texample_funcs\tknown\n")
        for k in sorted(agg, key=sortkey):
            typ, path, sz = k
            g = agg[k]
            ex = ",".join(f"{a}:{funcs[a].name}" for a in sorted(g["funcs"], key=lambda x: int(x, 16))[:3])
            kn = known_for(known, typ, path)
            n_rows[typ] += 1
            if kn:
                n_known[(typ, "~" if kn.startswith("~") else "ok")] += 1
            fo.write(f"{typ}\t{path}\t{sz}\t{len(g['funcs'])}\t{g['w']}\t{ex}\t{kn}\n")

    byt = Counter()
    byt_s = Counter()
    for r in out:
        byt[r[7]] += r[6]
    for k, t in label.items():
        if k[0] != "*":
            byt_s[(t, src[k])] += 1
    print(f"field_inventory.tsv: {len(out)} linhas, {sum(r[6] for r in out)} acessos; não resolvidos (base ilegível): {unres}")
    print("acessos por tipo:", dict(byt))
    print("nós rotulados por (tipo, origem):", dict(byt_s), "| fp novos:", nfp)
    print("campos distintos (tipo,path,size):", dict(n_rows))
    print("casaram com notas (ok = cadeia exata+tipo corroborado; ~ = só deslocamento):", dict(n_known))


if __name__ == "__main__":
    main()
