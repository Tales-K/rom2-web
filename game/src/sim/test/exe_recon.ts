/**
 * Infraestrutura comum dos testes de porta contra o oráculo (exe_path.ts, exe_walk.ts, exe_wave.ts, exe_walkaction.ts, exe_combat.ts):
 * leitura dos pares gravados por tools/re/oracle/fnprobe.py e reconstrução das entradas de uma chamada só pelos acessos que ela mesma
 * fez. A segunda metade (campos espelhados por offset, `unitFrom`/`checkUnit`, o contexto `Ctx` e `run`/`done`) é o arnês das
 * funções que recebem unidades/mundo: exige igualdade exata em 100 % das chamadas — retorno na largura declarada; rand() com a mesma
 * contagem e a mesma semente final; mapa, unidades tocadas (cada campo espelhado igual ao final se o original o escreveu, intocado
 * senão; nenhuma escrita do original fora do espelho), listas, mundo (evento, listas, diplomacia) e dono.
 */
import { CListEvent, CListEventNode, CListNode, CListPtr, CListPtrNode, CListWord, CMapAssoc, CMapShortOcc } from "../exe/mfc";
import {
  BookSpellRec, CellStructRec, DefRec, DmgRec, Obj7cRec, EVENT_SIZE, EXE_GLOBALS, ItemMagicRec, ItemRec, MAP_OCC_MAP_OFF, MAP_RINGS_OFF, MAP_WORLD_OFF, MapObjRec,
  MapRec, OccRec, PlayerRec, SPELL_DEF_N, SpellBookRec, SpellObjRec, SpellPayloadRec, TemplateRec, UnitListsRec, UnitRec, UnitTypeRec,
  VT_DIRECT_DAMAGE, VT_TRANSPORT, WorldRec,
} from "../exe/types";
import { Rng } from "../rng";
import { NotPorted } from "../exe/walk_action";

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
  /** grupos ([unidade+0x70]) e jogadores ([unidade+0x14]) remontados, por endereço: partilhados entre as unidades e conferidos em `done` */
  readonly groups = new Map<number, UnitTypeRec>();
  readonly players = new Map<number, PlayerRec>();
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
  const hasCount = cm.has(hdr + 0xc);
  if (hasCount) l.count = cm.u32(hdr + 0xc) | 0;
  if (!cm.has(hdr + 4)) {
    if (hasCount && cm.u32(hdr + 8) !== 0) {
      // cabeça não lida (AddTail numa lista não vazia): só a cauda é conhecida; um nó a representa
      const n = new CListPtrNode();
      n.data = cm.u32(cm.u32(hdr + 8) + 8);
      l.head = l.tail = n;
    }
    return l;
  }
  // percorrida pela cabeça (GetHeadPosition/GetNext não leem a contagem): a contagem, quando não lida, é a dos nós percorridos
  let p = cm.u32(hdr + 4);
  let prev: CListPtrNode | null = null;
  const seen = new Set<number>();
  let walked = 0, complete = p === 0;
  while (p !== 0 && !seen.has(p)) {
    seen.add(p);
    const n = new CListPtrNode();
    n.data = cm.u32(p + 8);
    n.prev = prev;
    if (prev) prev.next = n; else l.head = n;
    prev = n;
    walked++;
    if (!cm.has(p)) break;
    p = cm.u32(p);
    if (p === 0) complete = true;
  }
  if (!hasCount) l.count = walked;
  if (cm.u32(hdr + 8) !== 0 || complete) l.tail = prev;
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
    book.spells.push(spellFrom(cm, p));   // com a definição (o recálculo 0x51366b refaz a instância: Spell_CasterPower)
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

// ------------------------------------------------------------------------------------------- campos espelhados por offset

export type Field = [off: number, size: 1 | 2 | 4, key: string, signed?: boolean];
export const UNIT_FIELDS: Field[] = [
  [0x00, 4, "vtbl"], [0x04, 4, "f04"], [0x0e, 2, "f0e"], [0x40, 4, "f40"], [0x43, 1, "f43"], [0x44, 4, "f44"], [0x48, 1, "f48"], [0x49, 1, "size"], [0x4a, 1, "kind"],
  [0x4c, 1, "f4c"], [0x50, 4, "task"], [0x54, 4, "act"], [0x58, 4, "f58"], [0x5c, 4, "f5c"], [0x60, 4, "f60"], [0x64, 4, "f64"],
  [0x6c, 1, "f6c"], [0x86, 2, "f86", true], [0x88, 2, "f88", true], [0x8c, 2, "speed", true], [0x94, 2, "f94", true], [0x96, 2, "f96", true],
  [0x98, 2, "f98", true], [0x9a, 2, "mana", true], [0x9c, 2, "f9c", true], [0x9e, 2, "f9e", true], [0xa2, 1, "fa2"], [0xa3, 1, "fa3"], [0xa5, 1, "fa5"],
  [0xbe, 2, "fbe", true], [0xc0, 2, "fc0", true], [0xde, 2, "fde", true], [0xe2, 2, "fe2", true],
  // etapa 8b, lote 4 (efeitos e o recálculo 0x51366b): atributos-base e derivados, bônus +0xd4.. (o golpe +0xe6 e a defesa +0xfe à parte)
  [0x84, 2, "f84", true], [0x8a, 2, "f8a", true], [0x8e, 2, "f8e", true], [0x90, 2, "f90", true], [0x92, 2, "f92", true],
  [0xa0, 2, "fa0", true], [0xa4, 2, "fa4", true], [0xd4, 1, "fd4", true], [0xd5, 1, "fd5", true], [0xd6, 1, "fd6", true], [0xd7, 1, "fd7", true],
  [0xd8, 2, "fd8", true], [0xda, 2, "fda", true], [0xdc, 2, "fdc", true], [0xe0, 2, "fe0", true], [0xe4, 2, "fe4", true],
  [0x12c, 1, "attackRange"], [0x134, 1, "f134"], [0x135, 1, "f135"], [0x136, 1, "ready"],
  [0x138, 4, "f138"], [0x13c, 1, "f13c"], [0x144, 4, "effects"], [0x148, 4, "f148"], [0x14c, 2, "f14c"], [0x150, 4, "f150"], [0x1a0, 4, "f1a0"], [0x1a4, 2, "f1a4"],
];
/** Dados do comando do grupo ([grupo+0x3c]): o pensamento (0x56fa63, 0x5726f7, 0x5728fa, 0x55b406…) os escreve. */
export const GROUP_FIELDS: Field[] = [
  [0x00, 2, "f00"], [0x0a, 2, "f0a", true], [0x15, 1, "f15"], [0x20, 1, "f20"], [0x24, 4, "f24"], [0x28, 2, "f28"], [0x2a, 1, "f2a"], [0x2b, 1, "f2b"], [0x2c, 1, "f2c"],
  [0x2d, 1, "f2d"], [0x30, 4, "f30"], [0x34, 4, "f34"], [0x38, 1, "f38"], [0x39, 1, "f39"], [0x44, 1, "speedByte"], [0x45, 1, "f45"], [0x48, 4, "f48"],
];
/** Ponteiros da unidade espelhados como objetos (o valor conferido é o endereço). */
const UNIT_PTRS: [off: number, key: "tpl" | "f68" | "f74" | "f78"][] = [[0x3c, "tpl"], [0x68, "f68"], [0x74, "f74"], [0x78, "f78"]];
/** Sub-registros da unidade conferidos byte a byte: atributos do golpe +0xa6 (0x16), proteções +0xc2 (6 × i16), resistências +0xce (6). */
const DMG_OFF = 0xa6, DMG_SIZE = 0x16, PROT_OFF = 0xc2, RESIST_OFF = 0xce;
/** etapa 8b, lote 4: o bônus do golpe +0xe6 e da defesa +0xfe (conferidos byte a byte com o resto do bloco +0xd4..+0x113), a lista de
 *  efeitos +0x20 (CList: cabeçalho 0x1c). */
const BDMG_OFF = 0xe6, BDEF_OFF = 0xfe, BONUS_OFF = 0xd4, BONUS_SIZE = 0x40, FX_OFF = 0x20;
/** Dono da unidade (+0x14): id, IA, herói, +0x40 e mortes. */
export const PLAYER_FIELDS: Field[] = [[0x04, 2, "f04", true], [0x2c, 4, "f2c"], [0x32, 2, "f32"], [0x38, 4, "f38"], [0x40, 1, "f40"], [0xa54, 4, "fa54"], [0xa5c, 4, "fa5c"]];
export const WALK_FIELDS: Field[] = [
  [0x00, 1, "dir"], [0x01, 1, "dirTarget"], [0x05, 1, "passMask"], [0x06, 2, "nextCell"], [0x08, 1, "f08"], [0x09, 1, "f09"], [0x0a, 1, "turnRate"],
  [0x6c, 4, "f6c"], [0x70, 2, "stepFrom"], [0x72, 2, "f72"], [0x74, 2, "dest"], [0x76, 2, "f76"], [0x78, 1, "f78"],
  [0x7c, 4, "chaseTarget"], [0x80, 2, "footCell"], [0x82, 1, "f82"], [0x83, 1, "f83"], [0x84, 1, "f84"], [0x85, 1, "f85"],
  [0x86, 1, "f86"], [0x87, 1, "f87"], [0x88, 1, "f88"], [0x89, 1, "f89"], [0x8a, 2, "f8a"], [0x8c, 2, "f8c"], [0x90, 4, "f90"],
  [0x94, 2, "f94"], [0x96, 2, "f96"], [0x98, 4, "f98"], [0x9c, 1, "f9c"], [0x9d, 1, "f9d"], [0xa0, 4, "turning"],
  [0xa4, 1, "turnTicks"], [0xa8, 2, "stepSpeed"], [0xaa, 2, "stepTicks"], [0xac, 2, "stepTick"], [0xae, 2, "stepDir"],
  [0xb0, 1, "stepDx", true], [0xb1, 1, "stepDy", true],
];
export const AI_FIELDS: Field[] = [
  [0x00, 2, "f00"], [0x02, 2, "f02"], [0x04, 4, "f04"], [0x08, 1, "task"], [0x09, 1, "sub"], [0x0a, 2, "f0a"], [0x0c, 4, "f0c"], [0x10, 4, "f10"],
  [0x14, 1, "range"], [0x15, 1, "f15"], [0x16, 2, "f16", true], [0x18, 4, "target"], [0x20, 4, "f20"], [0x24, 4, "f24"], [0x28, 4, "f28"],
  [0x30, 4, "f30"], [0x38, 4, "f38"], [0x3c, 2, "f3c"], [0x40, 4, "f40"], [0x44, 4, "f44"],
  [0x50, 4, "f50"], [0x54, 4, "f54"], [0x58, 2, "f58"], [0x5a, 1, "f5a"], [0x5c, 4, "f5c"], [0x60, 4, "f60"], [0x6c, 4, "f6c"], [0x71, 1, "f71"],
  [0x78, 1, "spellSlot"], [0x94, 4, "f94"], [0x98, 4, "f98"], [0x9c, 2, "f9c"], [0x9e, 1, "f9e"], [0xa0, 2, "fa0"], [0xa4, 4, "fa4"], [0xa8, 4, "fa8"], [0xac, 4, "fac"], [0xb0, 2, "fb0"],
];
/** Mundo: lista das unidades vivas (+4), candidatos (+0xa68), caídos (+0xa88), tabela de diplomacia (+0xa8bc). */
export const WORLD_LIVE_OFF = 0x4, WORLD_CAND_OFF = 0xa68, WORLD_DEAD_OFF = 0xa88, WORLD_FRIENDS_OFF = 0xaa8, WORLD_FOES_OFF = 0xac8, WORLD_DIP_OFF = 0xa8bc, WORLD_DIP_SIZE = 8 + 0x46 * 0x46;
/** Mundo: lista de eventos (+0xbbec, cabeçalho 0x1c) e rascunho do evento (+0xbd98, 0x54 bytes). */
export const WORLD_EVENTS_OFF = 0xbbec, WORLD_EVT_OFF = 0xbd98;

/** O rand() do CRT a partir da semente da chamada, contando os sorteios (prova da ordem: contagem e semente final iguais). */
export class CountingRng extends Rng {
  n = 0;
  override raw(): number { this.n++; return super.raw(); }
}
export const UNIT_LISTS: [number, "pathStatic" | "pathDynamic"][] = [[0x1c8, "pathStatic"], [0x1e4, "pathDynamic"]];

export type Rec = Record<string, number>;
const rd = (mem: { u8(a: number): number; u16(a: number): number; u32(a: number): number }, a: number, f: Field): number => {
  const [, s, , sg] = f;
  const v = s === 1 ? mem.u8(a) : s === 2 ? mem.u16(a) : mem.u32(a);
  return sg ? (s === 1 ? (v << 24) >> 24 : (v << 16) >> 16) : v;
};
const mask = (v: number, s: 1 | 2 | 4): number => (s === 1 ? v & 0xff : s === 2 ? v & 0xffff : v >>> 0);

export function fill(rec: Rec, cm: CallMem, base: number, fields: Field[]): void {
  for (const f of fields) rec[f[2]] = rd(cm, base + f[0], f);
}

/** Unidade remontada da memória da chamada (memoizada por endereço: argumentos e mapa compartilham o registro). */
export function unitFrom(cm: CallMem, a: number, memo: Map<number, UnitRec>): UnitRec {
  let u = memo.get(a >>> 0);
  if (u) return u;
  u = new UnitRec();
  memo.set(a >>> 0, u);
  u.addr = a >>> 0;
  fill(u as unknown as Rec, cm, a, UNIT_FIELDS);
  u.mapObj = mapObjFrom(cm, cm.u32(a + 0x10));
  u.owner = playerFrom(cm, cm.u32(a + 0x14));
  u.tpl = templateFrom(cm, cm.u32(a + 0x3c));
  u.f68 = itemFrom(cm, cm.u32(a + 0x68)); u.f74 = itemFrom(cm, cm.u32(a + 0x74)); u.f78 = itemFrom(cm, cm.u32(a + 0x78));
  u.dmg = dmgFrom(cm, a + DMG_OFF);
  u.bdmg = dmgFrom(cm, a + BDMG_OFF);
  u.bdef = defFrom(cm, a + BDEF_OFF);
  for (let i = 0; i < 6; i++) u.skBase[i] = (cm.u16(a + 0x116 + 2 * i) << 16) >> 16;
  { const p7c = cm.u32(a + 0x7c); if (p7c !== 0) { u.f7c = new Obj7cRec(); u.f7c.addr = p7c; u.f7c.f20 = cm.u32(p7c + 0x20) | 0; } }
  u.fx = ptrListFrom(cm, a + FX_OFF);
  u.f130 = cm.u32(a + 0x130) | 0;   // experiência: só lida (a escrita é do gancho de experiência, fora da conferência)
  for (let i = 0; i < 6; i++) { u.prot[i] = cm.u16(a + PROT_OFF + 2 * i); u.resist[i] = cm.u8(a + RESIST_OFF + i); }
  u.type = groupFrom(cm, cm.u32(a + 0x70));
  u.hasBook = cm.u32(a + 0x140) !== 0;
  u.book = bookFrom(cm, cm.u32(a + 0x140));
  fill(u.walk as unknown as Rec, cm, cm.u32(a + 0x1c0), WALK_FIELDS);
  const ai = cm.u32(a + 0x1c4);
  fill(u.ai as unknown as Rec, cm, ai, AI_FIELDS);
  for (let i = 0; i < 3; i++) { u.ai.f7c[i] = cm.u32(ai + 0x7c + 4 * i) | 0; u.ai.f88[i] = cm.u32(ai + 0x88 + 4 * i) | 0; }
  u.ai.patrol = listFrom(cm, cm.u32(ai + 0xb4));   // IA+0xb4 = ponteiro para o CList<WORD>
  for (const [off, k] of UNIT_LISTS) u[k] = listFrom(cm, a + off);
  return u;
}

/** Grupo de IA em `g` (lista de membros em +0 e os dados do comando em [+0x3c]), memoizado em `cm.groups`. */
export function groupFrom(cm: CallMem, g: number): UnitTypeRec {
  let t = cm.groups.get(g >>> 0);
  if (t) return t;
  t = new UnitTypeRec();
  cm.groups.set(g >>> 0, t);
  t.addr = g >>> 0;
  t.members = ptrListFrom(cm, g);
  fill(t.stats as unknown as Rec, cm, cm.u32(g + 0x3c), GROUP_FIELDS);
  // dono do grupo (+0x44; 0x5703c0 lê a formação dele)
  if (cm.has(g + 0x44) && cm.u32(g + 0x44) !== 0) t.owner = playerFrom(cm, cm.u32(g + 0x44));
  return t;
}
/** Jogador em `p` (campos e a lista de grupos [+0x28]), memoizado em `cm.players`. */
export function playerFrom(cm: CallMem, p: number): PlayerRec {
  let r = cm.players.get(p >>> 0);
  if (r) return r;
  r = new PlayerRec();
  cm.players.set(p >>> 0, r);
  r.addr = p >>> 0;
  fill(r as unknown as Rec, cm, p, PLAYER_FIELDS);
  r.groups = ptrListFrom(cm, cm.u32(p + 0x28));
  // formação ([+0x34]+0x1f; 0x5703c0) e AutoCasting ([+0x34]+0x20; 0x56bb53/0x56bc7b)
  if (cm.has(p + 0x34)) { const o = cm.u32(p + 0x34); if (o !== 0 && cm.has(o + 0x1f)) r.formation = cm.u8(o + 0x1f); if (o !== 0 && cm.has(o + 0x20)) r.autocast = cm.u8(o + 0x20); }
  return r;
}

/** Modelo da unidade em `p` (+4 nome; +8 CArray<int>: dados em [+0xc], tamanho em +0x10), pelos bytes lidos. */
export function templateFrom(cm: CallMem, p: number): TemplateRec | null {
  if (p === 0) return null;
  const t = new TemplateRec();
  t.addr = p >>> 0;
  // +4 é um CString (ponteiro para os caracteres)
  const sp = cm.u32(p + 4);
  let name = "";
  for (let i = 0; i < 64 && sp !== 0 && cm.has(sp + i); i++) { const c = cm.u8(sp + i); if (c === 0) break; name += String.fromCharCode(c); }
  t.name = name;
  t.arrSize = cm.u32(p + 0x10) | 0;
  const data = cm.u32(p + 0xc);
  for (let i = 0; i < t.arr.length; i++) if (cm.has(data + 4 * i)) t.arr[i] = cm.u32(data + 4 * i) | 0;
  return t;
}
/** Item em `p` (+0x40, +0x42, +0x44, +0x4a, magia +0x84), pelos bytes lidos. */
export function itemFrom(cm: CallMem, p: number): ItemRec | null {
  if (p === 0) return null;
  const it = new ItemRec();
  it.addr = p >>> 0;
  it.f40 = cm.u16(p + 0x40); it.f42 = (cm.u16(p + 0x42) << 16) >> 16; it.f44 = cm.u8(p + 0x44); it.f4a = (cm.u16(p + 0x4a) << 16) >> 16;
  const sp = cm.u32(p + 0x84);
  it.spell = sp === 0 ? null : spellFrom(cm, sp);
  // +0x20 CList dos efeitos mágicos (cabeça +0x24; nó +0 próximo, +8 dado), pelos nós lidos (0x5238c5)
  for (let n = cm.u32(p + 0x24), k = 0; n !== 0 && cm.has(n + 8) && k < 64; n = cm.u32(n), k++) {
    const e = cm.u32(n + 8), m = new ItemMagicRec();
    m.f3c = cm.u8(e + 0x3c); m.f42 = (cm.u16(e + 0x42) << 16) >> 16;
    it.magic.push(m);
    if (!cm.has(n)) break;
  }
  const itpl = cm.u32(p + 0x3c);
  if (itpl !== 0 && cm.has(cm.u32(itpl + 0xc) + 0xf * 4)) it.tplF0f = cm.u32(cm.u32(itpl + 0xc) + 0xf * 4) | 0;
  return it;
}
/** Magia do livro em `p` (+8 id, +9 alcance, +0xc custo; definição [+4] → CArray em +8: elemento 0). */
export function spellFrom(cm: CallMem, p: number): BookSpellRec {
  const s = new BookSpellRec();
  s.addr = p >>> 0; s.id = cm.u8(p + 8); s.range = cm.u8(p + 9); s.f0a = cm.u8(p + 0xa); s.cost = (cm.u16(p + 0xc) << 16) >> 16;
  s.f0e = cm.u8(p + 0xe); s.f0f = cm.u8(p + 0xf); s.f10 = (cm.u16(p + 0x10) << 16) >> 16;
  const def = cm.u32(p + 4);
  s.hasDef = def !== 0;
  if (def !== 0 && cm.has(def + 0xc)) {
    // as colunas que a chamada leu ([0] nível, [4] alvo 0x519441, [5] entrega 0x519998, Spell_Instance/Spell_Apply: 2, 6..0x11)
    const data = cm.u32(def + 0xc);
    for (let i = 0; i < SPELL_DEF_N; i++) if (cm.has(data + 4 * i)) s.def[i] = cm.u32(data + 4 * i) | 0;
  }
  if (def !== 0 && cm.has(def + 0x1c)) {
    // definição+0x1c CString: o texto do efeito (0x51caa0 → 0x51e8fa), os caracteres que a chamada leu
    const t = cm.u32(def + 0x1c);
    let txt = "";
    for (let i = 0; i < 256 && cm.has(t + i) && cm.u8(t + i) !== 0; i++) txt += String.fromCharCode(cm.u8(t + i));
    s.effText = txt;
  }
  return s;
}
/** Atributos do golpe em `p` (unidade+0xa6 ou struct avulsa). */
export function dmgFrom(cm: CallMem, p: number): DmgRec {
  const d = new DmgRec();
  d.atk = (cm.u16(p) << 16) >> 16;
  for (let i = 0; i < 6; i++) d.sk[i] = (cm.u16(p + 2 + 2 * i) << 16) >> 16;
  d.dmin = cm.u8(p + 0xe); d.dadd = cm.u8(p + 0xf); d.wtype = cm.u8(p + 0x10);
  d.elA0 = cm.u8(p + 0x11); d.elA1 = cm.u8(p + 0x12); d.elB0 = cm.u8(p + 0x13); d.elB1 = cm.u8(p + 0x14); d.elK = cm.u8(p + 0x15);
  return d;
}
/** Bloco de defesa (0x16 bytes) em `p`. */
export function defFrom(cm: CallMem, p: number): DefRec {
  const d = new DefRec();
  d.def = (cm.u16(p) << 16) >> 16; d.abs = (cm.u16(p + 2) << 16) >> 16;
  for (let i = 0; i < 6; i++) { d.prot[i] = (cm.u16(p + 4 + 2 * i) << 16) >> 16; d.resist[i] = cm.u8(p + 0x10 + i); }
  return d;
}
/** O bloco de bônus +0xd4..+0x113 da unidade em bytes (o que o espelho guarda). */
export function packBonus(u: UnitRec): Uint8Array {
  const b = new Uint8Array(BONUS_SIZE), w16 = (o: number, v: number) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
  b[0] = u.fd4 & 0xff; b[1] = u.fd5 & 0xff; b[2] = u.fd6 & 0xff; b[3] = u.fd7 & 0xff;
  w16(4, u.fd8); w16(6, u.fda); w16(8, u.fdc); w16(0xa, u.fde); w16(0xc, u.fe0); w16(0xe, u.fe2); w16(0x10, u.fe4);
  b.set(packDmgFull(u.bdmg), BDMG_OFF - BONUS_OFF);
  const o = BDEF_OFF - BONUS_OFF;
  w16(o, u.bdef.def); w16(o + 2, u.bdef.abs);
  for (let i = 0; i < 6; i++) { w16(o + 4 + 2 * i, u.bdef.prot[i]!); b[o + 0x10 + i] = u.bdef.resist[i]!; }
  return b;
}
function packDmg(d: DmgRec): Uint8Array {
  const b = new Uint8Array(DMG_SIZE);
  b[0] = d.atk & 0xff; b[1] = (d.atk >> 8) & 0xff;
  b[0xe] = d.dmin; b[0xf] = d.dadd; b[0x10] = d.wtype; b[0x11] = d.elA0; b[0x12] = d.elA1; b[0x13] = d.elB0; b[0x14] = d.elB1; b[0x15] = d.elK;
  return b;
}
function packProt(u: UnitRec): Uint8Array {
  const b = new Uint8Array(12);
  for (let i = 0; i < 6; i++) { b[2 * i] = u.prot[i]! & 0xff; b[2 * i + 1] = (u.prot[i]! >> 8) & 0xff; }
  return b;
}

/** Só os bytes espelhados do bloco do golpe (+0xa6: ataque +0..1 e dano +0xe..+0x15; as habilidades +0xa8..+0xb3 ficam no meio). */
const DMG_BYTES = [0, 1, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15];
function checkBytes(cm: CallMem, base: number, offs: number[], before: Uint8Array, after: Uint8Array, what: string): string | null {
  for (const i of offs) {
    const a = base + i;
    if (cm.written.has(a)) { if (after[i] !== cm.fin.get(a)) return `${what}+0x${i.toString(16)}: porta ${after[i]} ≠ original ${cm.fin.get(a)}`; }
    else if (before[i] !== after[i]) return `${what}+0x${i.toString(16)}: porta mudou ${before[i]}→${after[i]}, original não escreveu`;
  }
  return null;
}

export function packMapObj(o: MapObjRec): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = o.x; b[1] = o.y; b[2] = o.cell & 0xff; b[3] = (o.cell >> 8) & 0xff; b[4] = o.fx; b[5] = o.fy;
  for (let i = 0; i < 4; i++) b[8 + i] = Math.floor((o.owner >>> 0) / 2 ** (8 * i)) & 0xff;
  return b;
}

export function checkFields(cm: CallMem, base: number, rec: Rec, fields: Field[], what: string): string | null {
  const f = finView(cm);
  for (const fl of fields) {
    const [off, s, key] = fl;
    let wrote = false;
    for (let i = 0; i < s; i++) if (cm.written.has(base + off + i)) wrote = true;
    const got = mask(rec[key], s);
    if (wrote) {
      const e = eq(`${what}.${key} (+0x${off.toString(16)})`, got, mask(rd(f, base + off, fl), s));
      if (e) return e;
    } else if (got !== mask(rd(cm, base + off, fl), s)) {
      return `${what}.${key} (+0x${off.toString(16)}): porta mudou ${mask(rd(cm, base + off, fl), s)}→${got}, original não escreveu`;
    }
  }
  return null;
}

/** Unidade, andar, IA, objeto de mapa e listas da unidade em `a` iguais ao original (e nada escrito fora do espelho). */
export function checkUnit(cm: CallMem, d: Pair, a: number, u: UnitRec): string | null {
  const w = cm.u32(a + 0x1c0), ai = cm.u32(a + 0x1c4), mo = cm.u32(a + 0x10);
  const own = cm.u32(a + 0x14);
  let e = checkFields(cm, a, u as unknown as Rec, UNIT_FIELDS, "unidade")
    ?? checkFields(cm, w, u.walk as unknown as Rec, WALK_FIELDS, "andar")
    ?? checkFields(cm, ai, u.ai as unknown as Rec, AI_FIELDS, "ia")
    ?? cm.checkRecord(mo, packMapObj(mapObjFrom(cm, mo)), packMapObj(u.mapObj))
    ?? checkBytes(cm, a + DMG_OFF, DMG_BYTES, packDmg(dmgFrom(cm, a + DMG_OFF)), packDmg(u.dmg), "golpe")
    ?? cm.checkRecord(a + PROT_OFF, cm.bytes(a + PROT_OFF, 12), packProt(u))
    ?? cm.checkRecord(a + RESIST_OFF, cm.bytes(a + RESIST_OFF, 6), u.resist)
    ?? cm.checkRecord(a + BONUS_OFF, cm.bytes(a + BONUS_OFF, BONUS_SIZE), packBonus(u))
    ?? checkPtrList(cm, a + FX_OFF, u.fx, "unidade+0x20 (efeitos)");
  if (e) return e;
  for (const [off, key] of UNIT_PTRS) {
    const got = (u[key] as { addr: number } | null)?.addr ?? 0;
    let wrote = false;
    for (let i = 0; i < 4; i++) if (cm.written.has(a + off + i)) wrote = true;
    if (wrote) { e = eq(`unidade.${key} (+0x${off.toString(16)})`, got, finView(cm).u32(a + off)); if (e) return e; }
    else if (got !== cm.u32(a + off)) return `unidade.${key} (+0x${off.toString(16)}): porta mudou o ponteiro, original não escreveu`;
  }
  {
    // o grupo (+0x70): regrupamento das ordens do cliente (0x52af8c/0x52afd2)
    let wrote = false;
    for (let i = 0; i < 4; i++) if (cm.written.has(a + 0x70 + i)) wrote = true;
    if (wrote) { e = eq("unidade.type (+0x70)", u.type.addr >>> 0, finView(cm).u32(a + 0x70)); if (e) return e; }
    else if ((u.type.addr >>> 0) !== cm.u32(a + 0x70)) return "unidade.type (+0x70): porta mudou o ponteiro, original não escreveu";
  }
  const covered = (base: number, fields: Field[], x: number) => fields.some(([off, s]) => x >= base + off && x < base + off + s);
  for (const [wa, size] of d.writes) {
    for (let x = wa; x < wa + size; x++) {
      if (x >= a && x < a + 0x200) {
        if (UNIT_LISTS.some(([off]) => x >= a + off && x < a + off + 0x1c) || covered(a, UNIT_FIELDS, x)) continue;
        if (UNIT_PTRS.some(([off]) => x >= a + off && x < a + off + 4) || (x >= a + 0x70 && x < a + 0x74)) continue;
        if ((x >= a + DMG_OFF && x < a + DMG_OFF + DMG_SIZE) || (x >= a + PROT_OFF && x < a + RESIST_OFF + 6)) continue;
        if ((x >= a + BONUS_OFF && x < a + BONUS_OFF + BONUS_SIZE) || (x >= a + FX_OFF && x < a + FX_OFF + 0x1c)) continue;
        if (x >= a + 0x114 && x < a + 0x154) continue;   // tabela por jogador do cliente (0x503672 's', 0x5039e2): fora do espelho
        // experiência do herói pelo golpe (0x513128 → 0x5128cb, motor antigo: gancho `xpOnHit`): +0x18, habilidades +0xa8.., +0x130, +0x240
        if ((x >= a + 0x18 && x < a + 0x1a) || (x >= a + 0xa8 && x < a + 0xb4) || (x >= a + 0x130 && x < a + 0x134) || (x >= a + 0x240 && x < a + 0x244)) continue;
        return `escrita do original em unidade+0x${(x - a).toString(16)} não espelhada`;
      }
      if (x >= own && x < own + 0xb00 && !covered(own, PLAYER_FIELDS, x) && !(x >= own + 0xad8 && x < own + 0xae0) && !(x >= own + 0xaa0 && x < own + 0xaa4)) return `escrita do original em dono+0x${(x - own).toString(16)} não espelhada`;   // +0xaa0, +0xad8/+0xadc: estatísticas do cliente (Server_Event)
      if (x >= w && x < w + 0xb4 && !covered(w, WALK_FIELDS, x)) return `escrita do original em andar+0x${(x - w).toString(16)} não espelhada`;
      if (x >= ai && x < ai + 0xb4 && !covered(ai, AI_FIELDS, x) && !(x >= ai + 0x7c && x < ai + 0x94)) return `escrita do original em ia+0x${(x - ai).toString(16)} não espelhada`;
    }
  }
  for (const [off, k] of UNIT_LISTS) {
    e = checkList(cm, a + off, u[k], `unidade+0x${off.toString(16)}`);
    if (e) return e;
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------- chamadas

export interface Ctx {
  d: Pair; cm: CallMem; memo: Map<number, UnitRec>; map: TestMap | null; mapBefore: Uint8Array | null; rng: CountingRng | null;
  world: WorldRec | null; worldAddr: number; events: CListEvent | null; eventsAddr: number; ptrList: CListPtr | null; ptrListAddr: number;
  /** etapa 8b, lote 3: o cabeçalho da lista dos objetos de magia [[0x6044c4]+0x7c]+4 (+4), quando a chamada o leu */
  spellListAddr: number;
}

export function ctx(d: Pair, cm: CallMem): Ctx {
  return { d, cm, memo: new Map(), map: null, mapBefore: null, rng: null, world: null, worldAddr: 0, events: null, eventsAddr: 0, ptrList: null, ptrListAddr: 0, spellListAddr: 0 };
}
/** Lista de eventos em `hdr` pela memória da chamada: contagem e, da cauda (o único nó que a chamada lê), o evento. */
export function eventListFrom(cm: CallMem, hdr: number): CListEvent {
  const l = new CListEvent();
  if (!cm.has(hdr + 0xc)) return l;
  l.count = cm.u32(hdr + 0xc) | 0;
  const tail = cm.u32(hdr + 8);
  if (tail !== 0) {
    const n = new CListEventNode();
    if (cm.has(tail + 8)) n.data.set(cm.bytes(tail + 8, EVENT_SIZE));
    l.head = l.tail = n;
  }
  return l;
}
/** Lista: contagem e o evento da cauda iguais à memória final (os ponteiros dos nós não são espelhados). */
export function checkEventList(cm: CallMem, hdr: number, l: CListEvent, what: string): string | null {
  const f = finView(cm);
  if (f.has(hdr + 0xc)) { const e = eq(`${what}.count`, l.count, f.u32(hdr + 0xc) | 0); if (e) return e; }
  if (!f.has(hdr + 8)) return null;
  const tail = f.u32(hdr + 8);
  if ((tail === 0) !== (l.tail === null)) return `${what}: cauda nula ${l.tail === null} ≠ original`;
  if (tail === 0 || !f.has(tail + 8)) return null;
  for (let i = 0; i < EVENT_SIZE; i++) {
    if (!f.has(tail + 8 + i)) continue;
    if (l.tail!.data[i] !== f.u8(tail + 8 + i)) return `${what}.cauda+0x${i.toString(16)}: porta ${l.tail!.data[i]} ≠ original ${f.u8(tail + 8 + i)}`;
  }
  return null;
}
/** Mundo em `w` com o gerador na semente da chamada, o divisor do sorteio (mundo+0), a lista de eventos e o rascunho lidos pela chamada. */
export function worldRec(c: Ctx, w: number, m: MapRec): WorldRec {
  const wr = new WorldRec(m);
  c.rng = new CountingRng(c.d.rng0);
  wr.rng = c.rng;
  if (c.cm.has(w)) wr.divisor = c.cm.u32(w) | 0;
  wr.events = eventListFrom(c.cm, w + WORLD_EVENTS_OFF);
  wr.spellAt = a => spellFrom(c.cm, a);   // BookSpellRec pelo ponteiro (unidade+0x44, IA+0x30)
  wr.evt.set(c.cm.bytes(w + WORLD_EVT_OFF, EVENT_SIZE));
  // listas do fim de caminho: unidades vivas ([mapa+0xa456c] = o mundo), candidatos e caídos; tabela de diplomacia (bytes lidos)
  const base = (m as { base?: number }).base;
  const live = base !== undefined && c.cm.has(base + 0xa456c) ? c.cm.u32(base + 0xa456c) : w;
  wr.liveUnits = ptrListFrom(c.cm, live + WORLD_LIVE_OFF);
  wr.cand = ptrListFrom(c.cm, w + WORLD_CAND_OFF);
  wr.dead = ptrListFrom(c.cm, w + WORLD_DEAD_OFF);
  wr.friends = ptrListFrom(c.cm, w + WORLD_FRIENDS_OFF);
  wr.foes = ptrListFrom(c.cm, w + WORLD_FOES_OFF);
  for (let i = 0; i < WORLD_DIP_SIZE; i++) if (c.cm.has(w + WORLD_DIP_OFF + i)) wr.dipTable[i] = c.cm.u8(w + WORLD_DIP_OFF + i);
  for (let i = 0; i < 16; i++) if (c.cm.has(w + 0xa54 + i)) wr.classTable[i] = (c.cm.u8(w + 0xa54 + i) << 24) >> 24;
  if (c.cm.has(w + 0xbbe8)) wr.fbbe8 = c.cm.u32(w + 0xbbe8);
  if (c.cm.has(w + 0xa724)) wr.fa724 = c.cm.u8(w + 0xa724);
  if (c.cm.has(w + 0xa8b8)) wr.fa8b8 = c.cm.u32(w + 0xa8b8) | 0;
  // jogadores ([0x68d2c4]), grupos e o contentor das unidades ([0x68d2dc]); os objetos fixos ([[0x6044c4]+0x7c]+4, lista em +4)
  (wr as { playersByAddr: Map<number, PlayerRec> }).playersByAddr = c.cm.players;
  (wr as { groupsByAddr: Map<number, UnitTypeRec> }).groupsByAddr = c.cm.groups;
  const po = c.cm.u32(0x68d2c4);
  if (po !== 0 && c.cm.has(po + 4)) {
    wr.players = ptrListFrom(c.cm, po);
    for (const pa of wr.players.values()) { const p = playerFrom(c.cm, pa); for (const ga of p.groups.values()) groupFrom(c.cm, ga); }
  }
  const uc = c.cm.u32(0x68d2dc);
  if (uc !== 0) wr.lists = listsFrom(c.cm, uc);
  // o objeto global [0x6044c4]: contador de 1/s (+0), relógio de 16/s (+4), jogo local (+0x74), registro dos objetos (+0x7c: +4 fixos)
  const g = c.cm.u32(0x6044c4);
  if (g !== 0) {
    if (c.cm.has(g)) EXE_GLOBALS.w6044c4 = c.cm.u16(g);
    if (c.cm.has(g + 4)) EXE_GLOBALS.clock16 = c.cm.u32(g + 4);
    EXE_GLOBALS.f74 = c.cm.has(g + 0x74) ? c.cm.u32(g + 0x74) : 1;
    const reg = c.cm.u32(g + 0x7c);
    if (reg !== 0 && c.cm.has(reg + 4)) { c.spellListAddr = c.cm.u32(reg + 4) + 4; wr.lists.spellObjs = ptrListFrom(c.cm, c.spellListAddr); }
  }
  // objetos de magia (etapa 8b, lote 3): remontados da memória sob demanda; `new` 0x401880 devolve os endereços que o par alocou
  wr.spellObjAt = (a: number) => { let o = wr.spellObjs.get(a >>> 0); if (!o) { o = spellObjFrom(c.cm, a); wr.spellObjs.set(a >>> 0, o); } return o; };
  wr.payloadAt = (a: number) => { let o = wr.payloads.get(a >>> 0); if (!o) { o = payloadFrom(c.cm, a); wr.payloads.set(a >>> 0, o); } return o; };
  const allocs = allocsOf(c.d);
  wr.allocObj = () => { const a = allocs.shift(); if (a === undefined) throw new Error("new 0x401880: o par não alocou mais objetos"); return a; };
  c.world = wr;
  c.worldAddr = w;
  return wr;
}

// ------------------------------------------------------------------------------- objetos de magia (etapa 8b, lote 3)

/** Campos do objeto da lista do mundo; o preso ao alvo tem 0x50 bytes (sem +0x50). */
const SPELLOBJ_FIELDS: Field[] = [
  [0x00, 4, "vtbl"], [0x04, 4, "f04"], [0x0c, 2, "fc"], [0x0e, 2, "fe"], [0x14, 4, "f14"], [0x18, 2, "f18"], [0x1c, 4, "f1c"], [0x3c, 4, "f3c"],
  [0x40, 1, "f40"], [0x41, 1, "f41"], [0x42, 2, "f42"], [0x44, 2, "f44"], [0x46, 2, "f46"], [0x48, 4, "f48"], [0x4c, 4, "f4c"],
];
const TRANSPORT_FIELDS: Field[] = [...SPELLOBJ_FIELDS, [0x50, 2, "f50", true]];
const PAYLOAD_FIELDS: Field[] = [
  [0x00, 4, "vtbl"], [0x04, 4, "f04"], [0x0c, 2, "fc"], [0x0e, 2, "fe"], [0x14, 4, "f14"], [0x18, 2, "f18"], [0x1c, 4, "f1c"], [0x3c, 1, "f3c"],
  [0x3d, 1, "f3d"], [0x40, 2, "f40", true], [0x42, 2, "f42", true], [0x44, 4, "f44"],
];
const objFields = (o: SpellObjRec): Field[] => (o.vtbl === VT_TRANSPORT ? TRANSPORT_FIELDS : SPELLOBJ_FIELDS);
/** O CObject 0x401900 escreve a vtable 0x5d1d74 primeiro em todo objeto novo: os endereços alocados, na ordem. O CList embutido em
 *  +0x20 (0x541de0, vtable final 0x5d0e60) também é CObject e fica de fora. */
export function allocsOf(d: Pair): number[] {
  const r: number[] = [], seen = new Set<number>(), lists = new Set<number>();
  // a vtable do CList (0x5d0e60) em algum momento: é a lista embutida, mesmo que o destrutor a tenha devolvido a 0x5d1d74 (lote 4)
  for (const [a, s, , after] of d.writes) if (s === 4 && (after >>> 0) === 0x5d0e60) lists.add(a);
  for (const [a, s, , after] of d.writes) {
    if (s === 4 && (after >>> 0) === 0x5d1d74 && !seen.has(a) && !lists.has(a)) { seen.add(a); r.push(a >>> 0); }
  }
  return r;
}
/** `vt`: a vtable quando a chamada não a leu (método chamado pelo despacho virtual do chamador). */
export function spellObjFrom(cm: CallMem, a: number, vt?: number): SpellObjRec {
  const o = new SpellObjRec();
  o.addr = a >>> 0;
  o.vtbl = cm.has(a) || vt === undefined ? cm.u32(a) : vt;
  const v = o.vtbl;
  fill(o as unknown as Rec, cm, a, objFields(o));
  o.vtbl = v;
  o.mapObj = mapObjFrom(cm, cm.u32(a + 0x10));
  return o;
}
export function payloadFrom(cm: CallMem, a: number, vt?: number): SpellPayloadRec {
  const o = new SpellPayloadRec();
  o.addr = a >>> 0;
  fill(o as unknown as Rec, cm, a, PAYLOAD_FIELDS);
  if (!cm.has(a) && vt !== undefined) o.vtbl = vt;
  o.mapObj = mapObjFrom(cm, cm.u32(a + 0x10));
  if (o.vtbl === VT_DIRECT_DAMAGE) o.dmg = dmgFrom(cm, a + 0x48);
  return o;
}
function packDmgFull(d: DmgRec): Uint8Array {
  const b = packDmg(d);
  for (let i = 0; i < 6; i++) { b[2 + 2 * i] = d.sk[i]! & 0xff; b[3 + 2 * i] = (d.sk[i]! >> 8) & 0xff; }
  return b;
}
/** Os objetos de magia do mundo (os remontados e os criados pela porta) iguais à memória final do original: campos, objeto de mapa
 *  (+0x10) e o dano (+0x48); e a lista do mundo. Objetos destruídos ficam de fora (a memória liberada não conta). */
export function checkSpellWorld(c: Ctx): string | null {
  const w = c.world;
  if (!w) return null;
  const f = finView(c.cm);
  const mo = (a: number, o: { mapObj: MapObjRec }, what: string): string | null => {
    const p = f.u32(a + 0x10);
    const e = c.cm.checkRecord(p, packMapObj(mapObjFrom(c.cm, p)), packMapObj(o.mapObj));
    return e ? `${what}.objeto de mapa ${e}` : null;
  };
  // vtable dada pelo teste (não lida nem escrita pela chamada) fica fora da conferência
  const known = (a: number, fl: Field[]) => (c.cm.has(a) || c.cm.written.has(a) ? fl : fl.filter(x => x[0] !== 0));
  for (const [a, o] of w.spellObjs) {
    const what = `objeto de magia 0x${a.toString(16)}`;
    const e = checkFields(c.cm, a, o as unknown as Rec, known(a, objFields(o)), what) ?? mo(a, o, what);
    if (e) return e;
  }
  for (const [a, o] of w.payloads) {
    const what = `carga 0x${a.toString(16)}`;
    let e = checkFields(c.cm, a, o as unknown as Rec, known(a, PAYLOAD_FIELDS), what) ?? mo(a, o, what);
    if (!e && o.vtbl === VT_DIRECT_DAMAGE) {
      const all = Array.from({ length: 0x16 }, (_, i) => i);
      e = checkBytes(c.cm, a + 0x48, all, packDmgFull(dmgFrom(c.cm, a + 0x48)), packDmgFull(o.dmg), `${what}.dano`);
    }
    if (e) return e;
  }
  return c.spellListAddr ? checkPtrList(c.cm, c.spellListAddr, w.lists.spellObjs, "lista dos objetos de magia") : null;
}
/** Rascunho do evento e lista de eventos do mundo iguais ao original (e nada mudado no rascunho que o original não escreveu). */
export function checkWorld(c: Ctx): string | null {
  if (!c.world) return null;
  const cm = c.cm, w = c.worldAddr, f = finView(cm);
  for (let i = 0; i < EVENT_SIZE; i++) {
    const a = w + WORLD_EVT_OFF + i, got = c.world.evt[i]!;
    if (cm.written.has(a)) { if (got !== f.u8(a)) return `mundo+0x${(WORLD_EVT_OFF + i).toString(16)}: porta ${got} ≠ original ${f.u8(a)}`; }
    else if (got !== cm.u8(a)) return `mundo+0x${(WORLD_EVT_OFF + i).toString(16)}: porta mudou ${cm.u8(a)}→${got}, original não escreveu`;
  }
  for (let i = 0; i < WORLD_DIP_SIZE; i++) {
    const a = w + WORLD_DIP_OFF + i, got = c.world.dipTable[i]!;
    if (cm.written.has(a)) { if (got !== f.u8(a)) return `diplomacia[${i}]: porta ${got} ≠ original ${f.u8(a)}`; }
    else if (cm.has(a) && got !== cm.u8(a)) return `diplomacia[${i}]: porta mudou ${cm.u8(a)}→${got}, original não escreveu`;
  }
  return checkEventList(cm, w + WORLD_EVENTS_OFF, c.world.events, "mundo+0xbbec")
    ?? checkPtrList(cm, w + WORLD_CAND_OFF, c.world.cand, "mundo+0xa68") ?? checkPtrList(cm, w + WORLD_DEAD_OFF, c.world.dead, "mundo+0xa88")
    ?? checkPtrList(cm, w + WORLD_FRIENDS_OFF, c.world.friends, "mundo+0xaa8") ?? checkPtrList(cm, w + WORLD_FOES_OFF, c.world.foes, "mundo+0xac8");
}
export const U = (c: Ctx, a: number): UnitRec => unitFrom(c.cm, a, c.memo);
/** As três listas do contentor de unidades [0x68d2dc] em `base` (+4 todas, +0x24 criadas por magia, +0x44 cadáveres), pelos nós lidos. */
export function listsFrom(cm: CallMem, base: number): UnitListsRec {
  const l = new UnitListsRec();
  l.all = ptrListFrom(cm, base + 4); l.magic = ptrListFrom(cm, base + 0x24); l.corpses = ptrListFrom(cm, base + 0x44);
  return l;
}
export function M(c: Ctx, base: number): TestMap {
  const m = mapFrom(c.cm, base, (a) => unitFrom(c.cm, a, c.memo));
  m.addr = base >>> 0;
  m.world = new WorldRec(m);
  c.map = m;
  c.mapBefore = m.mem.slice();
  return m;
}
/** Mapa do mundo `w` (+0xa50), conferindo que o mapa aponta de volta para o mesmo mundo quando a chamada leu +0x58d80. */
export function W(c: Ctx, w: number): WorldRec {
  const base = c.cm.u32(w + 0xa50);
  const m = M(c, base);
  if (c.cm.has(base + MAP_WORLD_OFF) && c.cm.u32(base + MAP_WORLD_OFF) !== (w >>> 0)) throw new Error("mapa+0x58d80 ≠ mundo");
  return worldRec(c, w, m);
}
/** Mundo sem o mapa remontado (funções que só sorteiam: 0x57afc0, 0x57afd0). */
export const WR = (c: Ctx, w: number): WorldRec => worldRec(c, w, new MapRec());

/** Confere mapa, todas as unidades tocadas e o retorno. */
export function done(c: Ctx, r: number | null, ret?: (v: number) => number): string | null {
  if (c.map && c.mapBefore) {
    const e = checkMap(c.cm, c.map, c.mapBefore);
    if (e) return e;
  }
  for (const [a, u] of c.memo) {
    const e = checkUnit(c.cm, c.d, a, u);
    if (e) return `unidade 0x${a.toString(16)}: ${e}`;
  }
  for (const [a, g] of c.cm.groups) {
    const e = checkFields(c.cm, c.cm.u32(a + 0x3c), g.stats as unknown as Rec, GROUP_FIELDS, "grupo") ?? checkPtrList(c.cm, a, g.members, "grupo.membros");
    if (e) return `grupo 0x${a.toString(16)}: ${e}`;
  }
  for (const [a, p] of c.cm.players) {
    const e = checkFields(c.cm, a, p as unknown as Rec, PLAYER_FIELDS, "dono");
    if (e) return `jogador 0x${a.toString(16)}: ${e}`;
  }
  const e = (c.rng ? eq("rand(): sorteios", c.rng.n, c.d.nrand) ?? eq("rand(): semente final", c.rng.state, c.d.rng1 >>> 0)
    : c.d.nrand !== 0 || c.d.rng0 !== c.d.rng1 ? "rand() chamado no original" : null) ?? checkWorld(c)
    ?? (c.events ? checkEventList(c.cm, c.eventsAddr, c.events, "lista") : null)
    ?? (c.ptrList ? checkPtrList(c.cm, c.ptrListAddr, c.ptrList, "lista") : null);
  if (e) return e;
  return r !== null && ret ? eq("retorno", r, ret(c.d.eax)) : null;
}

export const EAX = (v: number) => v | 0, AL = (v: number) => v & 0xff, AX = (v: number) => v & 0xffff;
export type Check = (d: Pair, cm: CallMem) => string | null;
export const run = (f: (c: Ctx, d: Pair) => number | null, ret?: (v: number) => number): Check => (d, cm) => {
  const c = ctx(d, cm);
  return done(c, f(c, d), ret);
};
/** `run` que também confere os objetos de magia do mundo e a lista deles (etapa 8b, lote 3). */
export const runS = (f: (c: Ctx, d: Pair) => number | null, ret?: (v: number) => number): Check => (d, cm) => {
  const c = ctx(d, cm);
  return done(c, f(c, d), ret) ?? checkSpellWorld(c);
};
export const A = (d: Pair, i: number) => d.args[i];

/** Roda as provas `CHECKS` (endereço → conferência) sobre os pares de todos os episódios em `PAIRS`. `HOOKED` = endereços cujo NotPorted
 *  é esperado (ganchos, ramos com exec 0): a chamada conta "em gancho". A variável de ambiente `only` (ex.: EXE_THINK_ONLY) limita os
 *  endereços. Sai com código 1 se alguma prova falhou. */
export function runPairs(name: string, CHECKS: Record<string, Check>, HOOKED: Set<string>, onlyVar: string): void {
  const only = (proc as unknown as { env: Record<string, string | undefined> }).env[onlyVar]?.split(",");
  let failures = 0;
  const notPorted = new Map<string, number>();
  if (!existsSync(PAIRS)) {
    console.log(`${name}: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
  } else {
    const total = new Map<string, number>();
    for (const ep of readdirSync(PAIRS).sort()) {
      for (const [fn, check] of Object.entries(CHECKS)) {
        if (only && !only.includes(fn)) continue;
        const file = join(PAIRS, ep, `${fn}.jsonl`);
        if (!existsSync(file)) continue;
        let n = 0, bad = 0, first = "", skipped = 0;
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!line) continue;
          const d = JSON.parse(line) as Pair;
          n++;
          let err: string | null;
          try {
            err = check(d, new CallMem(d));
          } catch (ex) {
            if (ex instanceof NotPorted) {
              notPorted.set(ex.addr, (notPorted.get(ex.addr) ?? 0) + 1);
              if (HOOKED.has(ex.addr)) { skipped++; n--; continue; }
            }
            err = `exceção: ${(ex as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? (ex as Error).message}`;
          }
          if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
        }
        if (bad) failures++;
        total.set(fn, (total.get(fn) ?? 0) + n);
        if (n === 0 && !skipped) continue;
        console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${skipped ? ` (+${skipped} em gancho)` : ""}${first ? "  " + first : ""}`);
      }
    }
    const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
    if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
    if (notPorted.size) console.log(`  NotPorted alcançado: ${[...notPorted].map(([a, k]) => `${a}×${k}`).join(" ")}`);
  }
  console.log(failures ? `${name}: ${failures} FALHA(S)` : `${name}: tudo igual ao original`);
  if (failures) proc.exitCode = 1;
}
