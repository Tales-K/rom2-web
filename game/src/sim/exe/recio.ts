/**
 * Entrada e saída dos registros espelhados (não é porta): leitura dos bytes despejados pelo oráculo (tools/re/oracle/dump_ticks.py,
 * campo `exe` do estado por tique) e o formato compacto dos registros no save (sim/snapshot.ts). Os campos vão pelo offset e
 * tamanho do original, como em types.ts.
 */
import { CListWord, type CMapAssoc, CMapShortOcc } from "./mfc";
import type { MapRec, UnitRec } from "./types";

type Field = [off: number, size: 1 | 2 | 4, key: string, signed?: boolean];
const WALK_FIELDS: Field[] = [
  [0x00, 1, "dir"], [0x01, 1, "dirTarget"], [0x05, 1, "passMask"], [0x06, 2, "nextCell"], [0x09, 1, "f09"], [0x0a, 1, "turnRate"],
  [0x6c, 4, "f6c"], [0x70, 2, "stepFrom"], [0x72, 2, "f72"], [0x74, 2, "dest"], [0x76, 2, "f76"], [0x78, 1, "f78"],
  [0x7c, 4, "chaseTarget"], [0x80, 2, "footCell"], [0x82, 1, "f82"], [0x83, 1, "f83"], [0x84, 1, "f84"], [0x85, 1, "f85"],
  [0x86, 1, "f86"], [0x87, 1, "f87"], [0x88, 1, "f88"], [0x89, 1, "f89"], [0x8a, 2, "f8a"], [0x8c, 2, "f8c"], [0x90, 4, "f90"],
  [0x94, 2, "f94"], [0x96, 2, "f96"], [0x98, 4, "f98"], [0x9c, 1, "f9c"], [0x9d, 1, "f9d"], [0xa0, 4, "turning"],
  [0xa4, 1, "turnTicks"], [0xa8, 2, "stepSpeed"], [0xaa, 2, "stepTicks"], [0xac, 2, "stepTick"], [0xae, 2, "stepDir"],
  [0xb0, 1, "stepDx", true], [0xb1, 1, "stepDy", true],
];
const AI_FIELDS: Field[] = [
  [0x00, 2, "f00"], [0x02, 2, "f02"], [0x04, 4, "f04"], [0x08, 1, "task"], [0x09, 1, "sub"], [0x0a, 2, "f0a"], [0x0c, 4, "f0c"], [0x14, 1, "range"],
  [0x15, 1, "f15"], [0x16, 2, "f16", true], [0x18, 4, "target"], [0x28, 4, "f28"], [0x30, 4, "f30"], [0x3c, 2, "f3c"], [0x50, 4, "f50"], [0x54, 4, "f54"],
  [0x58, 2, "f58"], [0x5a, 1, "f5a"], [0x5c, 4, "f5c"], [0x60, 4, "f60"], [0x71, 1, "f71"], [0x78, 1, "spellSlot"], [0x94, 4, "f94"], [0x98, 4, "f98"],
  [0x9c, 2, "f9c"], [0xac, 4, "fac"], [0xb0, 2, "fb0"],
];

function read(b: Uint8Array, [off, size, , signed]: Field): number {
  if (off + size > b.length) return 0;
  const v = size === 1 ? b[off]! : size === 2 ? b[off]! | (b[off + 1]! << 8) : (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
  return signed ? (size === 1 ? (v << 24) >> 24 : (v << 16) >> 16) : v;
}

const hexBytes = (h: string): Uint8Array => {
  const b = new Uint8Array(h.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
};

/** Campos de andar (+0x1c0) e de IA (+0x1c4) a partir dos bytes crus despejados. */
export function recFromBytes(r: UnitRec, mv: string, ai: string): void {
  const w = r.walk as unknown as Record<string, number>, a = r.ai as unknown as Record<string, number>;
  if (mv) { const b = hexBytes(mv); for (const f of WALK_FIELDS) w[f[2]] = read(b, f); }
  if (ai) { const b = hexBytes(ai); for (const f of AI_FIELDS) a[f[2]] = read(b, f); }
}

/** Lista CList<WORD> com estes valores (na ordem). */
export function listSet(l: CListWord, vals: readonly number[]): void {
  l.removeAll();
  for (const v of vals) l.addTail(v & 0xffff);
}
export function listVals(l: CListWord): number[] {
  const out: number[] = [];
  for (let n = l.head; n; n = n.next) out.push(n.data & 0xffff);
  return out;
}

// ------------------------------------------------------------------------------------------- save

/** Campos escalares da unidade, do tipo e do dono (o motor antigo os sincroniza em `World.dispatch`; vão no save para o estado
 *  carregado ser idêntico). */
const UNIT_KEYS = ["addr", "vtbl", "f40", "size", "kind", "f4c", "speed", "f94", "f96", "mana", "attackRange", "effects", "ready", "f58", "f5c", "f60", "f64", "f6c", "f138", "f13c"] as const;

export interface UnitRecJson {
  m: [number, number, number, number]; act: number; task: number;
  u?: Record<string, number>; t?: [number, number, number]; o?: number;
  w: Record<string, number>; a: Record<string, number>; ps: number[]; pd: number[];
  /** pontos da patrulha ([IA+0xb4]) — ausente em saves antigos */
  pt?: number[];
}

export function unitRecToJson(r: UnitRec): UnitRecJson {
  const w = r.walk as unknown as Record<string, number>, a = r.ai as unknown as Record<string, number>;
  return {
    m: [r.mapObj.x, r.mapObj.y, r.mapObj.fx, r.mapObj.fy], act: r.act, task: r.task,
    u: Object.fromEntries(UNIT_KEYS.map(k => [k, r[k]])), t: [r.type.stats.f20, r.type.stats.speedByte, r.type.stats.f45], o: r.owner.f2c,
    w: Object.fromEntries(WALK_FIELDS.map(f => [f[2], w[f[2]]!])), a: Object.fromEntries(AI_FIELDS.map(f => [f[2], a[f[2]]!])),
    ps: listVals(r.pathStatic), pd: listVals(r.pathDynamic), pt: listVals(r.ai.patrol),
  };
}

export function unitRecFromJson(r: UnitRec, j: UnitRecJson): void {
  const o = r.mapObj;
  [o.x, o.y, o.fx, o.fy] = j.m;
  o.cell = ((o.y << 8) | o.x) & 0xffff;
  r.act = j.act; r.task = j.task;
  if (j.u) Object.assign(r, j.u);
  if (j.t) [r.type.stats.f20, r.type.stats.speedByte, r.type.stats.f45] = j.t;
  if (j.o !== undefined) r.owner.f2c = j.o;
  Object.assign(r.walk, j.w); Object.assign(r.ai, j.a);
  listSet(r.pathStatic, j.ps); listSet(r.pathDynamic, j.pd); listSet(r.ai.patrol, j.pt ?? []);
}

/** Estado do MapRec: trechos [deslocamento, hex] que diferem de `base` e a ocupação (baldes na ordem das cadeias). */
export interface MapRecJson {
  mem: [number, string][];
  occ: { n: number; count: number; null: boolean; b: Record<string, [number, string][]> };
  /** lista-rascunho de 0x54ec6a (MapRec+0x54010): unidades da última busca em anéis */
  ring?: number[];
}

const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

export function mapRecToJson(m: MapRec, base: Uint8Array): MapRecJson {
  const mem: [number, string][] = [];
  for (let i = 0; i < m.mem.length; i++) {
    if (m.mem[i] === base[i]) continue;
    let e = i;
    while (e + 1 < m.mem.length && (m.mem[e + 1] !== base[e + 1] || (e + 2 < m.mem.length && m.mem[e + 2] !== base[e + 2]))) e++;
    mem.push([i, toHex(m.mem.subarray(i, e + 1))]);
    i = e;
  }
  const b: Record<string, [number, string][]> = {};
  const t = m.occ.table;
  if (t) t.forEach((a, h) => { const c: [number, string][] = []; for (let p: CMapAssoc | null = a; p; p = p.next) c.push([p.key, toHex(p.value.b)]); if (c.length) b[h] = c; });
  return { mem, occ: { n: m.occ.tableSize, count: m.occ.count, null: t === null, b }, ring: m.ringUnits.values() };
}

/** Aplica trechos de memória sobre o buffer do MapRec. */
export function applyMemRuns(m: MapRec, runs: readonly (readonly [number, string])[]): void {
  for (const [off, hex] of runs) m.mem.set(hexBytes(hex), off);
}

/** Baldes do CMap de ocupação (cadeias inteiras, na ordem do exe). `full` recria a tabela; senão troca só os baldes dados. */
export function applyOccBuckets(occ: CMapShortOcc, s: { n?: number; count?: number; null?: boolean; full?: number; b: Record<string, readonly (readonly [number, string])[]> }): void {
  if (s.full || s.n !== undefined) {
    occ.tableSize = s.n ?? occ.tableSize;
    occ.table = s.null ? null : new Array<CMapAssoc | null>(occ.tableSize).fill(null);
  }
  if (s.count !== undefined) occ.count = s.count;
  if (!occ.table && Object.keys(s.b).length) occ.table = new Array<CMapAssoc | null>(occ.tableSize).fill(null);
  for (const [h, chain] of Object.entries(s.b)) {
    let head: CMapAssoc | null = null, prev: CMapAssoc | null = null;
    for (const [key, hex] of chain) {
      const a = occ.newAssoc();
      occ.count--; // newAssoc conta; a contagem vem do despejo
      a.hash = Number(h);
      a.key = (key << 16) >> 16;
      a.value.b.set(hexBytes(hex));
      if (prev) prev.next = a; else head = a;
      prev = a;
    }
    occ.table![Number(h)] = head;
  }
}

export function mapRecFromJson(m: MapRec, base: Uint8Array, j: MapRecJson): void {
  m.mem.set(base);
  applyMemRuns(m, j.mem);
  m.occ = new CMapShortOcc();
  applyOccBuckets(m.occ, { ...j.occ, full: 1 });
  m.ringUnits.removeAll();
  for (const p of j.ring ?? []) m.ringUnits.addTail(p);
}
