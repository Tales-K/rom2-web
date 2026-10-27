/**
 * Prova da porta sim/exe/wave.ts (lote 5b: ondas, backtrace, ocupação) e sim/exe/mfc.ts contra os pares do oráculo
 * (tools/re/oracle/fnprobe.py). Rodar em game/:
 *   npx tsx src/sim/test/exe_wave.ts                       (EXE_WAVE_ONLY=0x55d010,0x54d76e para só algumas)
 *
 * Cada linha de refs/oracle/pairs/<episodio>/<addr>.jsonl é uma chamada do original em contexto real. Entradas remontadas só
 * pelos acessos da própria chamada (CallMem: estado antes/depois por byte): o objeto de mapa inteiro (`MapRec`, 0xa4570 bytes,
 * byte nunca tocado = 0), a unidade e os sub-registros pelos ponteiros, as listas CList<WORD> e o CMap de ocupação pelos nós
 * que a chamada leu. Exige igualdade exata em 100 % das chamadas:
 *   - retorno na largura declarada; rand() intocado;
 *   - objeto de mapa: todo byte que a porta mudou foi escrito pelo original, e todo byte escrito pelo original (grades,
 *     custo da onda inteiro, filas, registro corrente) está igual ao final (o cabeçalho do CMap é conferido à parte);
 *   - unidade: andar+0x80/+0x98, IA+0x16, livro+0x18 iguais ao final; nenhuma outra escrita do original na unidade/andar/IA;
 *   - listas e CMap: contagem, nulidade e a sequência de dados/chaves (e valores conhecidos) iguais à memória final do original.
 * Escritas fora disso (blocos do CPlex/heap) são da biblioteca e não são conferidas.
 *
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  BACKTRACE_UB, aiAttackRange, aiTeleportTargetDist, fn_0x54d72d, fn_0x550966, fn_0x550a53, fn_0x550a96, fn_0x5508a0, fn_0x551edb, fn_0x5563ca,
  fn_0x556f56, fn_0x559bc9, fn_0x55be86, fn_0x55c1fe, fn_0x55c2ce, fn_0x55cd50, pathBacktraceDynamic, pathBacktraceStatic,
  pathRefreshDynamic, pathTargetFree, pathWaveDynamicAtoB, pathWaveDynamicBtoA, pathWaveSearch, pathWaveStaticAtoB,
  pathWaveStaticBtoA, unitFootprintCheck, unitGetBookSpell,
} from "../exe/wave";
import { CListNode, CListWord, CMapAssoc, CMapShortOcc } from "../exe/mfc";
import {
  BookSpellRec, CellStructRec, EXE_GLOBALS, MAP_OCC_CUR_OFF, MAP_OCC_MAP_OFF, MapObjRec, MapRec, OccRec, SpellBookRec, UnitRec,
} from "../exe/types";
import { CallMem, PAIRS, existsSync, join, proc, readFileSync, readdirSync, type Pair } from "./exe_recon";

const eq = (what: string, got: number, want: number): string | null =>
  got === want ? null : `${what}: porta ${got} (0x${(got >>> 0).toString(16)}) ≠ original ${want} (0x${(want >>> 0).toString(16)})`;

/** Objeto de mapa com as estruturas (OccRec+0xc) remontadas da memória da chamada sob demanda. */
class TestMap extends MapRec {
  constructor(readonly cm: CallMem, readonly base: number) { super(); }
  override structAt(addr: number): CellStructRec {
    let s = this.structs.get(addr >>> 0);
    if (!s) {
      s = new CellStructRec();
      s.mapObj = mapObjFrom(this.cm, this.cm.u32(addr + 0x10));
      s.width = this.cm.u8(addr + 0x60);
      s.cellMask = this.cm.u32(addr + 0x64);
      this.structs.set(addr >>> 0, s);
    }
    return s;
  }
}

function mapObjFrom(cm: CallMem, p: number): MapObjRec {
  const o = new MapObjRec();
  o.x = cm.u8(p); o.y = cm.u8(p + 1); o.cell = cm.u16(p + 2); o.fx = cm.u8(p + 4); o.fy = cm.u8(p + 5); o.owner = cm.u32(p + 8);
  return o;
}

function mapFrom(cm: CallMem, base: number): TestMap {
  const m = new TestMap(cm, base);
  for (const [a, v] of cm.init) {
    const i = a - base;
    if (i >= 0 && i < MapRec.SIZE) m.mem[i] = v;
  }
  m.occ = occMapFrom(cm, base + MAP_OCC_MAP_OFF);
  return m;
}

// ------------------------------------------------------------------------------------------------- CList / CMap da memória

type Mem = { has(a: number): boolean; u8(a: number): number; u16(a: number): number; u32(a: number): number };
/** Vista da memória FINAL do original (CallMem.fin). */
function finView(cm: CallMem): Mem {
  const g = (a: number) => cm.fin.get(a) ?? 0;
  return {
    has: (a) => cm.fin.has(a),
    u8: g,
    u16: (a) => g(a) | (g(a + 1) << 8),
    u32: (a) => (g(a) | (g(a + 1) << 8) | (g(a + 2) << 16) | (g(a + 3) << 24)) >>> 0,
  };
}

/** Lista CList<WORD> em `hdr` (cabeçalho), pelos nós conhecidos; nós além do conhecido viram um nó de dado desconhecido. */
function listFrom(mem: Mem, hdr: number): CListWord {
  const l = new CListWord();
  l.count = mem.u32(hdr + 0xc) | 0;
  let p = mem.u32(hdr + 4);
  let prev: CListNode | null = null;
  const seen = new Set<number>();
  while (p !== 0 && !seen.has(p)) {
    seen.add(p);
    const n = new CListNode();
    n.data = mem.u16(p + 8);
    n.prev = prev;
    if (prev) prev.next = n; else l.head = n;
    prev = n;
    if (!mem.has(p)) break;            // próximo desconhecido: a lista acaba aqui no espelho
    p = mem.u32(p);
  }
  if (mem.u32(hdr + 8) !== 0) l.tail = prev;
  return l;
}

/** Dados conhecidos da lista na memória `mem` (até o 1.º nó cujo próximo é desconhecido) e se ela foi lida até o fim. */
function listSeq(mem: Mem, hdr: number): { vals: number[]; complete: boolean } {
  const vals: number[] = [];
  let p = mem.u32(hdr + 4);
  const seen = new Set<number>();
  while (p !== 0 && !seen.has(p)) {
    seen.add(p);
    if (!mem.has(p + 8)) return { vals, complete: false };
    vals.push(mem.u16(p + 8));
    if (!mem.has(p)) return { vals, complete: false };
    p = mem.u32(p);
  }
  return { vals, complete: true };
}

function checkList(cm: CallMem, hdr: number, l: CListWord, what: string): string | null {
  const f = finView(cm);
  if (!f.has(hdr + 0xc)) return null;
  let e = eq(`${what}.count`, l.count, f.u32(hdr + 0xc) | 0);
  if (e) return e;
  if ((l.head === null) !== (f.u32(hdr + 4) === 0)) return `${what}: cabeça nula ${l.head === null} ≠ original`;
  if ((l.tail === null) !== (f.u32(hdr + 8) === 0)) return `${what}: cauda nula ${l.tail === null} ≠ original`;
  const s = listSeq(f, hdr);
  const got = l.values();
  for (let i = 0; i < s.vals.length; i++) {
    e = eq(`${what}[${i}]`, got[i] ?? -1, s.vals[i]);
    if (e) return e;
  }
  if (s.complete && got.length !== s.vals.length) return `${what}: porta ${got.length} nós ≠ original ${s.vals.length}`;
  return null;
}

/** CMap<short,OccRec> em `hdr`, pelos baldes e nós conhecidos. */
function occMapFrom(cm: CallMem, hdr: number): CMapShortOcc {
  const map = new CMapShortOcc();
  map.tableSize = cm.u32(hdr + 8) || 17;
  map.count = cm.u32(hdr + 0xc) | 0;
  const tbl = cm.u32(hdr + 4);
  if (tbl === 0 || !cm.has(hdr + 4)) { map.table = null; return map; }
  map.table = new Array<CMapAssoc | null>(map.tableSize).fill(null);
  for (let h = 0; h < map.tableSize; h++) {
    if (!cm.has(tbl + h * 4)) continue;
    let p = cm.u32(tbl + h * 4);
    let prev: CMapAssoc | null = null;
    while (p !== 0 && cm.has(p + 8)) {
      const a = new CMapAssoc();
      a.hash = cm.u32(p + 4);
      a.key = (cm.u16(p + 8) << 16) >> 16;
      a.value.b.set(cm.bytes(p + 0xc, OccRec.SIZE));
      if (prev) prev.next = a; else map.table[h] = a;
      prev = a;
      if (!cm.has(p)) break;
      p = cm.u32(p);
    }
  }
  return map;
}

function checkOccMap(cm: CallMem, hdr: number, map: CMapShortOcc): string | null {
  const f = finView(cm);
  if (f.has(hdr + 0xc)) {
    const e = eq("CMap.count", map.count, f.u32(hdr + 0xc) | 0);
    if (e) return e;
  }
  if (!f.has(hdr + 4)) return null;
  const tbl = f.u32(hdr + 4);
  if ((tbl === 0) !== (map.table === null)) return `CMap: tabela nula ${map.table === null} ≠ original ${tbl === 0}`;
  if (tbl === 0 || map.table === null) return null;
  for (let h = 0; h < map.tableSize; h++) {
    if (!f.has(tbl + h * 4)) continue;
    let p = f.u32(tbl + h * 4);
    let a = map.table[h];
    let i = 0;
    while (p !== 0 && f.has(p + 8)) {
      if (!a) return `CMap balde ${h}[${i}]: porta acaba, original tem chave ${(f.u16(p + 8) << 16) >> 16}`;
      const e = eq(`CMap balde ${h}[${i}].key`, a.key, (f.u16(p + 8) << 16) >> 16);
      if (e) return e;
      for (let k = 0; k < OccRec.SIZE; k++) {
        if (f.has(p + 0xc + k) && a.value.b[k] !== f.u8(p + 0xc + k)) {
          return `CMap chave ${a.key} valor +0x${k.toString(16)}: porta ${a.value.b[k]} ≠ original ${f.u8(p + 0xc + k)}`;
        }
      }
      if (!f.has(p)) break;
      p = f.u32(p);
      a = a.next;
      i++;
      if (p === 0 && a !== null) return `CMap balde ${h}: porta tem chave a mais ${a.key}`;
    }
  }
  return null;
}

// -------------------------------------------------------------------------------------------------------------- unidade

const UNIT_LISTS: [number, "pathStatic" | "pathDynamic"][] = [[0x1c8, "pathStatic"], [0x1e4, "pathDynamic"]];

function unitFrom(cm: CallMem, a: number): UnitRec {
  const u = new UnitRec();
  u.addr = a >>> 0;
  u.vtbl = cm.u32(a);
  u.mapObj = mapObjFrom(cm, cm.u32(a + 0x10));
  u.owner.f2c = cm.u32(cm.u32(a + 0x14) + 0x2c);
  u.size = cm.u8(a + 0x49);
  u.kind = cm.u8(a + 0x4a);
  u.type.stats.f20 = cm.u8(cm.u32(cm.u32(a + 0x70) + 0x3c) + 0x20);
  u.mana = cm.u16(a + 0x9a);
  u.attackRange = cm.u8(a + 0x12c);
  u.book = bookFrom(cm, cm.u32(a + 0x140));
  const w = cm.u32(a + 0x1c0);
  u.walk.passMask = cm.u8(w + 5);
  u.walk.f76 = cm.u16(w + 0x76);
  u.walk.footCell = cm.u16(w + 0x80);
  u.walk.f98 = cm.u32(w + 0x98);
  const ai = cm.u32(a + 0x1c4);
  u.ai.task = cm.u8(ai + 8);
  u.ai.f16 = cm.u16(ai + 0x16);
  u.ai.spellSlot = cm.u8(ai + 0x78);
  for (const [off, k] of UNIT_LISTS) u[k] = listFrom(cm, a + off);
  return u;
}

function bookFrom(cm: CallMem, b: number): SpellBookRec {
  const book = new SpellBookRec();
  const n = cm.u32(b + 0xc) | 0, data = cm.u32(b + 8);
  for (let i = 0; i < n && i < 256; i++) {
    const p = cm.u32(data + i * 4);
    if (p === 0) { book.spells.push(null); continue; }
    const s = new BookSpellRec();
    s.addr = p; s.range = cm.u8(p + 9); s.cost = cm.u16(p + 0xc);
    book.spells.push(s);
  }
  book.last = cm.u32(b + 0x18) | 0;
  return book;
}

/** Campos escritos da unidade e sub-registros: iguais ao final; nenhuma outra escrita do original neles. */
function checkUnit(cm: CallMem, d: Pair, a: number, u: UnitRec): string | null {
  const w = cm.u32(a + 0x1c0), ai = cm.u32(a + 0x1c4), book = cm.u32(a + 0x140);
  const known = new Map<number, [number, number, string]>([
    [w + 0x80, [2, u.walk.footCell, "andar+0x80"]], [w + 0x98, [4, u.walk.f98 >>> 0, "andar+0x98"]],
    [ai + 0x16, [2, u.ai.f16 & 0xffff, "ia+0x16"]], [book + 0x18, [4, u.book.last >>> 0, "livro+0x18"]],
  ]);
  const f = finView(cm);
  for (const [addr, [size, v, what]] of known) {
    let changed = false;
    for (let i = 0; i < size; i++) if (cm.written.has(addr + i)) changed = true;
    const orig = size === 2 ? f.u16(addr) : f.u32(addr);
    const before = size === 2 ? cm.u16(addr) : cm.u32(addr);
    if (!changed && v !== before) return `${what}: porta mudou ${before}→${v}, original não escreveu`;
    if (changed) { const e = eq(what, v, orig); if (e) return e; }
  }
  const ranges: [number, number][] = [[a, a + 0x200], [w, w + 0xa0], [ai, ai + 0xa0]];
  for (const [wa, size] of d.writes) {
    if (known.has(wa)) continue;
    if (UNIT_LISTS.some(([off]) => wa >= a + off && wa < a + off + 0x1c)) continue;
    for (const [lo, hi] of ranges) if (wa >= lo && wa < hi) return `escrita do original em 0x${wa.toString(16)} (${size} B) não espelhada`;
  }
  for (const [off, k] of UNIT_LISTS) {
    const e = checkList(cm, a + off, u[k], `unidade+0x${off.toString(16)}`);
    if (e) return e;
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------- objeto de mapa

const OCC_HDR_LO = MAP_OCC_MAP_OFF, OCC_HDR_HI = MAP_OCC_MAP_OFF + 0x1c;

/** Todo byte que a porta mudou foi escrito pelo original e todo byte escrito pelo original está igual ao final. */
function checkMap(cm: CallMem, m: TestMap, before: Uint8Array): string | null {
  const after = m.mem, base = m.base;
  const b32 = new Uint32Array(before.buffer, 0, before.length >> 2), a32 = new Uint32Array(after.buffer, 0, after.length >> 2);
  for (let w = 0; w < b32.length; w++) {
    if (b32[w] === a32[w]) continue;
    for (let i = w * 4; i < w * 4 + 4; i++) {
      if (before[i] === after[i] || (i >= OCC_HDR_LO && i < OCC_HDR_HI)) continue;
      if (!cm.written.has(base + i)) return `mapa+0x${i.toString(16)}: porta mudou ${before[i]}→${after[i]}, original não escreveu`;
    }
  }
  for (const a of cm.written) {
    const i = a - base;
    if (i < 0 || i >= MapRec.SIZE || (i >= OCC_HDR_LO && i < OCC_HDR_HI)) continue;
    if (after[i] !== cm.fin.get(a)) return `mapa+0x${i.toString(16)}: porta ${after[i]} ≠ original ${cm.fin.get(a)}`;
  }
  return checkOccMap(cm, base + MAP_OCC_MAP_OFF, m.occ);
}

/** Roda `run` sobre o mapa e as unidades remontados e confere mapa, unidades e retorno. */
function withMap(d: Pair, cm: CallMem, unitArgs: number[], run: (m: TestMap, us: UnitRec[]) => number | null, ret?: (v: number) => number): string | null {
  const m = mapFrom(cm, d.this);
  const us = unitArgs.map((a) => (a === 0 ? (null as unknown as UnitRec) : unitFrom(cm, a)));
  const before = m.mem.slice();
  const r = run(m, us);
  let e = checkMap(cm, m, before);
  if (e) return e;
  for (let i = 0; i < unitArgs.length; i++) {
    if (unitArgs[i] === 0) continue;
    e = checkUnit(cm, d, unitArgs[i], us[i]);
    if (e) return e;
  }
  if (r !== null && ret) return eq("retorno", r, ret(d.eax));
  return null;
}

const EAX = (v: number) => v | 0, AL = (v: number) => v & 0xff, AX = (v: number) => v & 0xffff;

type Check = (d: Pair, m: CallMem) => string | null;

const wave = (fn: typeof pathWaveStaticAtoB): Check => (d, cm) =>
  withMap(d, cm, [], (m) => { fn(m, new UnitRec(), d.args[1], d.args[2], d.args[3]); return null; });

const CHECKS: Record<string, Check> = {
  "0x55d010": wave(pathWaveStaticAtoB),
  "0x55d830": wave(pathWaveStaticBtoA),
  "0x55e050": wave(pathWaveDynamicAtoB),
  "0x55e870": wave(pathWaveDynamicBtoA),
  "0x55c440": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => pathTargetFree(m, u, d.args[1]), EAX),
  "0x55cd50": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => fn_0x55cd50(m, u, d.args[1]), EAX),
  "0x55c5a0": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => unitFootprintCheck(m, u, d.args[1], d.args[2]), EAX),
  "0x5563ca": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => fn_0x5563ca(m, u), EAX),
  "0x54e886": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => { pathBacktraceDynamic(m, u, d.args[1], d.args[2], d.args[3], d.args[4]); return null; }),
  "0x54e58c": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => { pathBacktraceStatic(m, u, d.args[1], d.args[2], d.args[3], d.args[4]); return null; }),
  "0x550a96": (d, cm) => withMap(d, cm, [], (m) => {
    const r = d.args[0] === d.this + MAP_OCC_CUR_OFF ? m.occCur : new OccRec(cm.bytes(d.args[0], OccRec.SIZE));
    fn_0x550a96(m, r);
    return null;
  }),
  "0x550a53": (d, cm) => withMap(d, cm, [], (m) => { fn_0x550a53(m, d.args[0]); return null; }),
  "0x550966": (d, cm) => withMap(d, cm, [], (m) => fn_0x550966(m, d.args[0]), EAX),
  "0x5508a0": (d, cm) => withMap(d, cm, [], (m) => { fn_0x5508a0(m, d.args[0]); return null; }),
  "0x551edb": (d, cm) => withMap(d, cm, [], (m) => fn_0x551edb(m, d.args[0]), (v) => v >>> 0),
  "0x559bc9": (d, cm) => withMap(d, cm, [], (m) => fn_0x559bc9(m, d.args[0]), (v) => v >>> 0),
  "0x55c1fe": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => { fn_0x55c1fe(m, u, d.args[1]); return null; }),
  "0x55c2ce": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => { fn_0x55c2ce(m, u, d.args[1]); return null; }),
  "0x55be86": (d, cm) => withMap(d, cm, [d.args[0]], (m, [u]) => { fn_0x55be86(m, u, d.args[1], d.args[2]); return null; }),
  "0x54d76e": (d, cm) => withMap(d, cm, [d.args[0], d.args[6]], (m, [u, t]) => {
    pathWaveSearch(m, u, d.args[1], d.args[2], d.args[3], d.args[4], d.args[5], d.args[6] === 0 ? null : t);
    return null;
  }),
  "0x54d72d": (d, cm) => withMap(d, cm, [d.args[0], d.args[4]], (m, [u, t]) => {
    fn_0x54d72d(m, u, d.args[1], d.args[2], d.args[3], d.args[4] === 0 ? null : t);
    return null;
  }),
  "0x555dc2": (d, cm) => withMap(d, cm, [d.args[0], d.args[1]], (m, [u, t]) => {
    pathRefreshDynamic(m, u, d.args[1] === 0 ? null : t);
    return null;
  }),
  "0x558fe9": (d) => eq("AL", aiTeleportTargetDist(d.args[0], d.args[1]), d.eax & 0xff),
  "0x556f56": (d) => eq("AL", fn_0x556f56(d.args[0], d.args[1], d.args[2]), d.eax & 0xff),
  "0x56ac5b": (d, cm) => {
    const u = unitFrom(cm, d.args[0]);
    const e = eq("AL", aiAttackRange(u), d.eax & 0xff);
    return e ?? checkUnit(cm, d, d.args[0], u);
  },
  "0x51c391": (d, cm) => {
    const book = bookFrom(cm, d.this);
    const s = unitGetBookSpell(book, d.args[0]);
    const e = eq("EAX", s === null ? 0 : s.addr, d.eax >>> 0);
    if (e) return e;
    if (cm.written.has(d.this + 0x18)) return eq("livro+0x18", book.last >>> 0, finView(cm).u32(d.this + 0x18));
    return eq("livro+0x18 (sem escrita)", book.last | 0, cm.u32(d.this + 0x18) | 0);
  },
  // MFC (mfc.ts), com o mapa dono do CMap/lista quando é o caso
  "0x55f3e0": (d, cm) => occCall(d, cm, (map, m) => {
    const dst = d.args[1] === m.base + MAP_OCC_CUR_OFF ? m.occCur : new OccRec(cm.bytes(d.args[1], OccRec.SIZE));
    return map.lookup(d.args[0], dst) ? 1 : 0;
  }, AL),
  "0x55f430": (d, cm) => occCall(d, cm, (map, m) => {
    const src = d.args[1] === m.base + MAP_OCC_CUR_OFF ? m.occCur : new OccRec(cm.bytes(d.args[1], OccRec.SIZE));
    map.setAt(d.args[0], src);
    return null;
  }),
  "0x55f460": (d, cm) => occCall(d, cm, (map) => map.removeKey(d.args[0]), EAX),
  "0x55f110": (d, cm) => listCall(d, cm, (l) => l.removeHead(), AX),
  "0x55f170": (d, cm) => listCall(d, cm, (l) => { l.addHead(d.args[0]); return null; }),
  "0x5421b0": (d, cm) => listCall(d, cm, (l) => { l.removeAll(); return null; }),
};

/** Método do CMap de ocupação: `this` = mapa+0x54084. */
function occCall(d: Pair, cm: CallMem, run: (map: CMapShortOcc, m: TestMap) => number | null, ret?: (v: number) => number): string | null {
  const base = d.this - MAP_OCC_MAP_OFF;
  return withMap({ ...d, this: base }, cm, [], (m) => run(m.occ, m), ret);
}

/** Método de CList: `this` = cabeçalho da lista. */
function listCall(d: Pair, cm: CallMem, run: (l: CListWord) => number | null, ret?: (v: number) => number): string | null {
  const l = listFrom(cm, d.this);
  const r = run(l);
  const e = checkList(cm, d.this, l, "lista");
  if (e) return e;
  return r !== null && ret ? eq("retorno", r, ret(d.eax)) : null;
}

interface NodeEnv { env: Record<string, string | undefined>; }
const only = (proc as unknown as NodeEnv).env.EXE_WAVE_ONLY?.split(",");
let failures = 0;
if (!existsSync(PAIRS)) {
  console.log(`exe_wave: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
} else {
  const total = new Map<string, number>();
  for (const ep of readdirSync(PAIRS).sort()) {
    for (const [fn, check] of Object.entries(CHECKS)) {
      if (only && !only.includes(fn)) continue;
      const file = join(PAIRS, ep, `${fn}.jsonl`);
      if (!existsSync(file)) continue;
      let n = 0, bad = 0, first = "";
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        const d = JSON.parse(line) as Pair;
        n++;
        let err: string | null;
        try {
          err = check(d, new CallMem(d));
          if (!err && (d.nrand !== 0 || d.rng0 !== d.rng1)) err = "rand() chamado no original";
        } catch (ex) { err = `exceção: ${(ex as Error).message}`; }
        if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
      }
      if (bad) failures++;
      total.set(fn, (total.get(fn) ?? 0) + n);
      if (n === 0) continue;
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${first ? "  " + first : ""}`);
    }
  }
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
}

// --------------------------------------------------------------------------------- varredura no Unicorn (fuzz_wave.py)

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

interface FzUnit { addr: number; x: number; y: number; size: number; kind?: number; }
interface FzCase {
  in: {
    shape: string; W: number; win: number; cost: string; smask: string; dmask: string; wavesS: number; wavesD: number; defCost: number;
    g: number; cost0: number; structs: { addr: number; x: number; y: number; w: number; mask: number; cells: number[] }[]; others: FzUnit[];
    me: FzUnit & { kind: number; mask: number; f2c: number; f20: number; task: number; rng: number; ai16: number; placed: boolean };
    pre: { s: number[]; d: number[] }; target: FzUnit | null; call: number[];
  };
  out: {
    crc: number; occ: [number, number, string][]; occN: number; occNull: boolean; foot: number; ai16: number;
    s: { n: number; v: number[]; tail0: boolean }; d: { n: number; v: number[]; tail0: boolean }; cov: string[];
  };
}

function fzUnit(f: FzUnit, kind: number, mask: number): UnitRec {
  const u = new UnitRec();
  u.addr = f.addr;
  u.vtbl = 0x5d0eb0;
  u.mapObj.x = f.x; u.mapObj.y = f.y; u.mapObj.cell = f.y * 256 + f.x; u.mapObj.fx = 0x80; u.mapObj.fy = 0x80;
  u.size = f.size;
  u.kind = kind;
  u.walk.passMask = mask;
  u.owner.f2c = 1;
  return u;
}

/** Remonta o caso como fuzz_wave.py montou no Unicorn (as operações de montagem passam pela porta) e roda 0x54d76e. */
function fzRun(c: FzCase["in"]): string | null {
  const m = new MapRec();
  const cost = b64(c.cost), sm = b64(c.smask), dm = b64(c.dmask), win = c.win;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const inside = y < win && x < win;
      const i = y * win + x, o = y * 256 + x;
      m.mem[o] = inside ? cost[i] : 1;
      m.mem[0x10000 + o] = inside ? sm[i] : 0xff;
      m.mem[0x20000 + o] = inside ? dm[i] : 0xff;
    }
  }
  m.cost.fill(c.cost0);
  m.dv.setInt32(0x50000, c.W, true);
  m.dv.setInt32(0x50004, c.W, true);
  m.mem[0x5414b] = c.defCost;
  const ring = [1, 0, 0, 1, -1, 0, 0, -1];
  for (let i = 0; i < m.ringStep.length; i++) m.ringStep[i] = ring[i % 8];
  m.dv.setInt32(0x58584, c.wavesS, true);
  m.dv.setInt32(0x58588, c.wavesD, true);
  m.occ.tableSize = 100;
  EXE_GLOBALS.w6044c4 = c.g;
  for (const s of c.structs) {
    const r = new CellStructRec();
    r.mapObj.x = s.x; r.mapObj.y = s.y; r.mapObj.cell = s.y * 256 + s.x; r.mapObj.fx = 0x80; r.mapObj.fy = 0x80;
    r.width = s.w; r.cellMask = s.mask;
    m.structs.set(s.addr, r);
    for (const cell of s.cells) {
      const rec = m.occCur.b;
      rec.fill(0);
      rec[0] = m.mem[cell];
      rec[1] = m.mem[0x10000 + cell];
      new DataView(rec.buffer, rec.byteOffset).setUint32(0xc, s.addr, true);
      rec[0x3a] = cell & 0xff; rec[0x3b] = cell >> 8;
      m.occ.setAt(cell, m.occCur);
      m.mem[0x10000 + cell] |= 0x20;
      fn_0x550a53(m, cell);
    }
  }
  for (const o of c.others) fn_0x55be86(m, fzUnit(o, o.kind ?? 1, 0x41), o.y * 256 + o.x, 1);
  const me = fzUnit(c.me, c.me.kind, c.me.mask);
  me.owner.f2c = c.me.f2c; me.type.stats.f20 = c.me.f20; me.ai.task = c.me.task; me.attackRange = c.me.rng; me.ai.f16 = c.me.ai16;
  if (c.me.placed) fn_0x55be86(m, me, c.me.y * 256 + c.me.x, 1);
  for (const v of c.pre.s) me.pathStatic.addHead(v);
  for (const v of c.pre.d) me.pathDynamic.addHead(v);
  const t = c.target ? fzUnit(c.target, 1, 0x41) : null;
  const [fx, fy, tx, ty, st] = c.call;
  pathWaveSearch(m, me, fx, fy, tx, ty, st, t);
  return JSON.stringify(fzDump(m, me));
}

function fzDump(m: MapRec, me: UnitRec): Omit<FzCase["out"], "cov"> {
  const crc = crc32(m.mem.subarray(MAP_OCC_MAP_OFF + 0x1c), crc32(m.mem.subarray(0, MAP_OCC_MAP_OFF)));
  const occ: [number, number, string][] = [];
  if (m.occ.table) {
    for (let h = 0; h < m.occ.tableSize; h++) for (let a = m.occ.table[h]; a; a = a.next) occ.push([h, a.key, hex(a.value.b)]);
  }
  const lst = (l: CListWord) => ({ n: l.count, v: l.values(), tail0: l.tail === null });
  return { crc, occ, occN: m.occ.count, occNull: m.occ.table === null, s: lst(me.pathStatic), d: lst(me.pathDynamic),
           foot: me.walk.footCell, ai16: (me.ai.f16 << 16) >> 16 };
}

const FUZZ_WAVE = join(PAIRS, "..", "fuzz", "0x54d76e.jsonl");
if (existsSync(FUZZ_WAVE) && (!only || only.includes("fuzz"))) {
  let n = 0, bad = 0, first = "", ub = 0;
  const cov = new Map<string, number>();
  for (const line of readFileSync(FUZZ_WAVE, "utf8").split("\n")) {
    if (!line) continue;
    const f = JSON.parse(line) as FzCase;
    n++;
    for (const k of f.out.cov) cov.set(k, (cov.get(k) ?? 0) + 1);
    const { cov: _c, ...want } = f.out;
    let err: string | null;
    try {
      const got = fzRun(f.in) as string;
      const w = JSON.stringify({ crc: want.crc, occ: want.occ, occN: want.occN, occNull: want.occNull, s: want.s, d: want.d, foot: want.foot, ai16: want.ai16 });
      err = got === w ? null : diffFz(JSON.parse(got), want);
    } catch (ex) {
      const msg = (ex as Error).message;
      err = msg.startsWith(BACKTRACE_UB) ? null : `exceção: ${msg}`;
      if (!err) ub++;
    }
    if (err) { bad++; if (!first) first = `caso ${n} (${f.in.shape}): ${err}`; }
  }
  if (bad) failures++;
  console.log(`  ${bad ? "FALHOU" : "ok  "} unicorn 0x54d76e: ${n - bad - ub}/${n} iguais, ${ub} indefinidos no exe (backtrace com lixo de pilha)` +
    ` (${[...cov].map(([k, v]) => `${k} ${v}`).join(", ")})${first ? "  " + first : ""}`);
}

function diffFz(got: Record<string, unknown>, want: Record<string, unknown>): string {
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(got[k]), b = JSON.stringify(want[k]);
    if (a !== b) return `${k}: porta ${a.slice(0, 160)} ≠ original ${b.slice(0, 160)}`;
  }
  return "diferente";
}

const FUZZ_RANGE = join(PAIRS, "..", "fuzz", "0x556f56.jsonl");
if (existsSync(FUZZ_RANGE) && (!only || only.includes("fuzz"))) {
  let n = 0, bad = 0, first = "";
  for (const line of readFileSync(FUZZ_RANGE, "utf8").split("\n")) {
    if (!line) continue;
    const [a, b, s, al] = JSON.parse(line) as number[];
    n++;
    const e = eq("AL", fn_0x556f56(a, b, s), al);
    if (e) { bad++; if (!first) first = `a=0x${a.toString(16)} b=0x${b.toString(16)} lado=${s}: ${e}`; }
  }
  if (bad) failures++;
  console.log(`  ${bad ? "FALHOU" : "ok  "} unicorn 0x556f56: ${n - bad}/${n}${first ? "  " + first : ""}`);
}

console.log(failures ? `exe_wave: ${failures} FALHA(S)` : "exe_wave: tudo igual ao original");
if (failures) proc.exitCode = 1;
