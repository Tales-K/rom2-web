/**
 * Infraestrutura comum dos testes de porta contra o oráculo (exe_path.ts, exe_walk.ts, exe_wave.ts, exe_walkaction.ts): leitura dos pares gravados por
 * tools/re/oracle/fnprobe.py e reconstrução das entradas de uma chamada só pelos acessos que ela mesma fez.
 */
import { CListNode, CListPtr, CListPtrNode, CListWord, CMapAssoc, CMapShortOcc } from "../exe/mfc";
import {
  BookSpellRec, CellStructRec, MAP_OCC_MAP_OFF, MAP_RINGS_OFF, MapObjRec, MapRec, OccRec, SpellBookRec, UnitRec,
} from "../exe/types";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
export const proc = (globalThis as unknown as { process: NodeProc }).process;
export const { existsSync, readFileSync, readdirSync } = proc.getBuiltinModule("node:fs") as {
  existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string; readdirSync(p: string): string[];
};
export const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

export const PAIRS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "refs", "oracle", "pairs");

export interface Obj { unit: number; sub?: string; off: number; }
export interface Pair {
  t: number; seq: number; fn: string; this: number; args: number[]; eax: number; rng0: number; rng1: number; nrand: number;
  /** ESP na entrada (os argumentos passados por valor na pilha, como o evento de 0x57b210, começam em esp0 + 4) */
  esp0: number;
  reads: [number, number, number][]; writes: [number, number, number, number][]; objs: Record<string, Obj>;
}

/** Unidades e objetos de mapa reconstruídos pelas leituras da chamada, via `objs`. */
export class Recon {
  units = new Map<number, UnitRec>();
  constructor(readonly d: Pair) {
    for (const [a, s, v] of d.reads) {
      const o = d.objs[String(a)];
      if (!o) continue;
      const u = this.unit(o.unit);
      if (o.sub === undefined) {
        if (o.off === 0x0 && s === 4) u.vtbl = v >>> 0;
        else if (o.off === 0x43 && s === 1) u.f43 = v;
        else if (o.off === 0x49 && s === 1) u.size = v;
        else if (o.off === 0x4a && s === 1) u.kind = v;
        else if (o.off === 0x8c && s === 2) u.speed = (v << 16) >> 16;
      } else if (o.sub === "+0x10" && s === 1) {
        if (o.off === 0) u.mapObj.x = v;
        else if (o.off === 1) u.mapObj.y = v;
        else if (o.off === 4) u.mapObj.fx = v;
        else if (o.off === 5) u.mapObj.fy = v;
      }
    }
  }
  unit(id: number): UnitRec {
    let u = this.units.get(id);
    if (!u) { u = new UnitRec(); u.mapObj = new MapObjRec(); this.units.set(id, u); }
    return u;
  }
  /** Unidade cujo endereço-base (off 0, sem sub-objeto) é `addr`. */
  unitAt(addr: number): UnitRec {
    const o = this.d.objs[String(addr)];
    if (!o || o.sub !== undefined || o.off !== 0) throw new Error(`0x${addr.toString(16)} não é base de unidade em objs`);
    return this.unit(o.unit);
  }
  /**
   * Objeto de mapa cujo endereço-base é `addr`. Os acessores 0x54ff5b..0x54ffc0 também servem objetos de mapa que não são de
   * unidade (sem entrada em `objs`): esses são remontados pelas leituras relativas a `addr`.
   */
  mapObjAt(addr: number): MapObjRec {
    const o = this.d.objs[String(addr)];
    if (o) {
      if (o.sub !== "+0x10" || o.off !== 0) throw new Error(`0x${addr.toString(16)} não é objeto de mapa em objs`);
      return this.unit(o.unit).mapObj;
    }
    const m = new MapObjRec();
    for (const [a, s, v] of this.d.reads) {
      if (s !== 1) continue;
      const r = a - addr;
      if (r === 0) m.x = v; else if (r === 1) m.y = v; else if (r === 4) m.fx = v; else if (r === 5) m.fy = v;
    }
    return m;
  }
}

/**
 * Memória de uma chamada: estado ANTES (primeiro `antes` de cada byte escrito; senão a leitura) e DEPOIS (com as escritas
 * aplicadas em ordem). Byte nunca tocado é desconhecido (`has` falso; os getters devolvem 0).
 */
export class CallMem {
  readonly init = new Map<number, number>();
  readonly fin = new Map<number, number>();
  readonly written = new Set<number>();
  constructor(d: Pair) {
    for (const [a, s, v] of d.reads) for (let i = 0; i < s; i++) this.init.set(a + i, Math.floor(v / 2 ** (8 * i)) & 0xff);
    const seen = new Set<number>();
    for (const [a, s, before] of d.writes) {
      for (let i = 0; i < s; i++) {
        if (seen.has(a + i)) continue;
        seen.add(a + i);
        this.init.set(a + i, Math.floor(before / 2 ** (8 * i)) & 0xff);
      }
    }
    for (const [k, v] of this.init) this.fin.set(k, v);
    for (const [a, s, , after] of d.writes) {
      for (let i = 0; i < s; i++) { this.fin.set(a + i, Math.floor(after / 2 ** (8 * i)) & 0xff); this.written.add(a + i); }
    }
  }
  has(a: number): boolean { return this.init.has(a); }
  u8(a: number): number { return this.init.get(a) ?? 0; }
  u16(a: number): number { return this.u8(a) | (this.u8(a + 1) << 8); }
  u32(a: number): number { return (this.u8(a) | (this.u8(a + 1) << 8) | (this.u8(a + 2) << 16) | (this.u8(a + 3) << 24)) >>> 0; }
  /** `n` bytes a partir de `a` no estado ANTES. */
  bytes(a: number, n: number): Uint8Array {
    const r = new Uint8Array(n);
    for (let i = 0; i < n; i++) r[i] = this.u8(a + i);
    return r;
  }
  /**
   * Compara o registro de `before.length` bytes em `base` depois da porta (`after`) com o original: todo byte que a porta
   * mudou foi escrito pelo original, e todo byte escrito pelo original está igual ao valor final.
   */
  checkRecord(base: number, before: Uint8Array, after: Uint8Array): string | null {
    for (let i = 0; i < before.length; i++) {
      const a = base + i;
      if (before[i] !== after[i] && !this.written.has(a)) return `+0x${i.toString(16)}: porta mudou ${before[i]}→${after[i]}, original não escreveu`;
      if (this.written.has(a) && after[i] !== this.fin.get(a)) return `+0x${i.toString(16)}: porta ${after[i]} ≠ original ${this.fin.get(a)}`;
    }
    return null;
  }
}

// ------------------------------------------------------------------- objeto de mapa, listas e CMap remontados (lotes 5b/5c)

export const eq = (what: string, got: number, want: number): string | null =>
  got === want ? null : `${what}: porta ${got} (0x${(got >>> 0).toString(16)}) ≠ original ${want} (0x${(want >>> 0).toString(16)})`;

/** Objeto de mapa com as estruturas (OccRec+0xc) remontadas da memória da chamada sob demanda. */
export class TestMap extends MapRec {
  /** `mkUnit`: remonta a unidade de um endereço guardado no mapa (occCur+4, listas de unidades). */
  constructor(readonly cm: CallMem, readonly base: number, readonly mkUnit?: (addr: number) => UnitRec) { super(); }
  override unitAt(addr: number): UnitRec {
    let u = this.units.get(addr >>> 0);
    if (!u) {
      if (!this.mkUnit) return super.unitAt(addr);
      u = this.mkUnit(addr >>> 0);
      this.units.set(addr >>> 0, u);
    }
    return u;
  }
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

export function mapObjFrom(cm: CallMem, p: number): MapObjRec {
  const o = new MapObjRec();
  o.x = cm.u8(p); o.y = cm.u8(p + 1); o.cell = cm.u16(p + 2); o.fx = cm.u8(p + 4); o.fy = cm.u8(p + 5); o.owner = cm.u32(p + 8);
  return o;
}

export function mapFrom(cm: CallMem, base: number, mkUnit?: (addr: number) => UnitRec): TestMap {
  const m = new TestMap(cm, base, mkUnit);
  for (const [a, v] of cm.init) {
    const i = a - base;
    if (i >= 0 && i < MapRec.SIZE) m.mem[i] = v;
  }
  m.occ = occMapFrom(cm, base + MAP_OCC_MAP_OFF);
  m.ringUnits = ptrListFrom(cm, base + MAP_RINGS_OFF + 4);
  return m;
}

// ------------------------------------------------------------------------------------------------- CList / CMap da memória

export type Mem = { has(a: number): boolean; u8(a: number): number; u16(a: number): number; u32(a: number): number };
/** Vista da memória FINAL do original (CallMem.fin). */
export function finView(cm: CallMem): Mem {
  const g = (a: number) => cm.fin.get(a) ?? 0;
  return {
    has: (a) => cm.fin.has(a),
    u8: g,
    u16: (a) => g(a) | (g(a + 1) << 8),
    u32: (a) => (g(a) | (g(a + 1) << 8) | (g(a + 2) << 16) | (g(a + 3) << 24)) >>> 0,
  };
}

/** Lista CList<WORD> em `hdr` (cabeçalho), pelos nós conhecidos; nós além do conhecido viram um nó de dado desconhecido. */
export function listFrom(mem: Mem, hdr: number): CListWord {
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
export function listSeq(mem: Mem, hdr: number): { vals: number[]; complete: boolean } {
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

export function checkList(cm: CallMem, hdr: number, l: CListWord, what: string): string | null {
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
export function occMapFrom(cm: CallMem, hdr: number): CMapShortOcc {
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

export function checkOccMap(cm: CallMem, hdr: number, map: CMapShortOcc): string | null {
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


/** CList<void*> em `hdr` pelos nós conhecidos (dado u32 em +8). */
export function ptrListFrom(cm: CallMem, hdr: number): CListPtr {
  const l = new CListPtr();
  if (!cm.has(hdr + 0xc)) return l;
  l.count = cm.u32(hdr + 0xc) | 0;
  if (!cm.has(hdr + 4) && cm.u32(hdr + 8) !== 0) {
    // cabeça não lida (AddTail numa lista não vazia): só a cauda é conhecida; um nó a representa
    const n = new CListPtrNode();
    n.data = cm.u32(cm.u32(hdr + 8) + 8);
    l.head = l.tail = n;
    return l;
  }
  let p = cm.u32(hdr + 4);
  let prev: CListPtrNode | null = null;
  const seen = new Set<number>();
  while (p !== 0 && !seen.has(p)) {
    seen.add(p);
    const n = new CListPtrNode();
    n.data = cm.u32(p + 8);
    n.prev = prev;
    if (prev) prev.next = n; else l.head = n;
    prev = n;
    if (!cm.has(p)) break;
    p = cm.u32(p);
  }
  if (cm.u32(hdr + 8) !== 0) l.tail = prev;
  return l;
}

/** CList<void*>: contagem, nulidade e dados conhecidos iguais à memória final do original. */
export function checkPtrList(cm: CallMem, hdr: number, l: CListPtr, what: string): string | null {
  const f = finView(cm);
  if (!f.has(hdr + 0xc)) return null;
  let e = eq(`${what}.count`, l.count, f.u32(hdr + 0xc) | 0);
  if (e) return e;
  if (!f.has(hdr + 4)) {
    // cabeça nunca lida nem escrita: confere só a cauda
    const t = f.u32(hdr + 8);
    if ((l.tail === null) !== (t === 0)) return `${what}: cauda nula ${l.tail === null} ≠ original`;
    return t !== 0 && f.has(t + 8) ? eq(`${what}.cauda`, l.tail!.data >>> 0, f.u32(t + 8)) : null;
  }
  if ((l.head === null) !== (f.u32(hdr + 4) === 0)) return `${what}: cabeça nula ${l.head === null} ≠ original`;
  const got = l.values();
  let p = f.u32(hdr + 4), i = 0;
  const seen = new Set<number>();
  while (p !== 0 && !seen.has(p) && f.has(p + 8)) {
    seen.add(p);
    e = eq(`${what}[${i}]`, got[i] ?? -1, f.u32(p + 8));
    if (e) return e;
    i++;
    if (!f.has(p)) return null;
    p = f.u32(p);
  }
  return p === 0 && got.length !== i ? `${what}: porta ${got.length} nós ≠ original ${i}` : null;
}

export function bookFrom(cm: CallMem, b: number): SpellBookRec {
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

const OCC_HDR_LO = MAP_OCC_MAP_OFF, OCC_HDR_HI = MAP_OCC_MAP_OFF + 0x1c;
const RINGS_LO = MAP_RINGS_OFF + 4, RINGS_HI = MAP_RINGS_OFF + 4 + 0x1c;
const skip = (i: number): boolean => (i >= OCC_HDR_LO && i < OCC_HDR_HI) || (i >= RINGS_LO && i < RINGS_HI);

/** Todo byte que a porta mudou foi escrito pelo original e todo byte escrito pelo original está igual ao final. */
export function checkMap(cm: CallMem, m: TestMap, before: Uint8Array): string | null {
  const after = m.mem, base = m.base;
  const b32 = new Uint32Array(before.buffer, 0, before.length >> 2), a32 = new Uint32Array(after.buffer, 0, after.length >> 2);
  for (let w = 0; w < b32.length; w++) {
    if (b32[w] === a32[w]) continue;
    for (let i = w * 4; i < w * 4 + 4; i++) {
      if (before[i] === after[i] || skip(i)) continue;
      if (!cm.written.has(base + i)) return `mapa+0x${i.toString(16)}: porta mudou ${before[i]}→${after[i]}, original não escreveu`;
    }
  }
  for (const a of cm.written) {
    const i = a - base;
    if (i < 0 || i >= MapRec.SIZE || skip(i)) continue;
    if (after[i] !== cm.fin.get(a)) return `mapa+0x${i.toString(16)}: porta ${after[i]} ≠ original ${cm.fin.get(a)}`;
  }
  return checkOccMap(cm, base + MAP_OCC_MAP_OFF, m.occ) ?? checkPtrList(cm, base + RINGS_LO, m.ringUnits, "mapa+0x54010");
}

