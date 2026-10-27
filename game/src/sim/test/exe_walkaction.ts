/**
 * Prova da porta sim/exe/walk_action.ts (lote 5c, o andar), do despachante sim/exe/action.ts (etapa 6: 0x56dca2, 0x56ea52; etapa 7:
 * 0x56e5bc olhar em volta) e dos sorteios sim/exe/rand.ts (0x57afc0, 0x57afd0) contra
 * os pares do oráculo (tools/re/oracle/fnprobe.py) e a varredura no Unicorn (tools/re/oracle/fuzz_walk.py). Pares de 0x56dca2 que
 * caem numa tarefa ainda não portada (NotPorted) contam à parte, não como falha. Rodar em game/:
 *   npx tsx src/sim/test/exe_walkaction.ts            (EXE_WALK_ONLY=0x555411,fuzz para só algumas)
 *
 * Cada linha de refs/oracle/pairs/<episodio>/<addr>.jsonl é uma chamada do original em contexto real. Entradas remontadas só
 * pelos acessos da própria chamada (CallMem): o objeto de mapa inteiro (`TestMap`), as unidades pelos ponteiros (argumentos e
 * as que o mapa guarda: occCur+4, lista de 0x54ec6a), os sub-registros de andar (+0x1c0) e IA (+0x1c4), listas e CMap.
 * Exige igualdade exata em 100 % das chamadas:
 *   - retorno na largura declarada; rand(): a mesma contagem e a mesma semente final (`nrand`, `rng1`), logo os mesmos valores na
 *     mesma ordem (o `Rng` do motor parte da semente `rng0` da chamada);
 *   - mapa: todo byte que a porta mudou foi escrito pelo original e todo byte escrito pelo original igual ao final (CMap e
 *     lista de unidades conferidos por nós);
 *   - cada unidade tocada: cada campo espelhado (tabelas abaixo) igual ao final se o original o escreveu, intocado senão;
 *     nenhuma escrita do original na unidade/andar/IA/objeto de mapa fora dos campos espelhados; listas +0x1c8/+0x1e4.
 *
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  NotPorted, aiUnitDistance, dirFromDelta16, fn_0x52b22a, fn_0x54f618, fn_0x5503af, fn_0x550697, fn_0x55073f, fn_0x55532d,
  fn_0x554fd2, fn_0x555c7e, fn_0x5568e4, fn_0x556d78, fn_0x556da2, fn_0x558f64, fn_0x55a147, fn_0x56fc69, gridUnitsInRings,
  pathClearDynamic, unitActionChase, unitActionWalk, unitPlaceOnCells, unitRemoveFromCells, unitTurnStep, unitWalkFormula,
  unitWalkNear, unitWalkWait,
} from "../exe/walk_action";
import { fn_0x56ea52, unitActionDispatcher, unitLookAround } from "../exe/action";
import { fn_0x57afd0, randUniformObject } from "../exe/rand";
import { Rng } from "../rng";
import {
  MAP_ALT_OFF, MAP_DIR_CELL_OFF, MAP_DIR_DX_OFF, MAP_DIR_DY_OFF, MAP_RINGS_OFF, MAP_SPEED_MUL_OFF, MAP_WORLD_OFF, MapObjRec, MapRec,
  UnitRec, WorldRec,
} from "../exe/types";
import {
  CallMem, PAIRS, bookFrom, checkList, checkMap, checkPtrList, eq, existsSync, finView, join, listFrom, mapFrom, mapObjFrom, proc,
  ptrListFrom, readFileSync, readdirSync, type Pair, type TestMap,
} from "./exe_recon";

// ------------------------------------------------------------------------------------------- campos espelhados por offset

type Field = [off: number, size: 1 | 2 | 4, key: string, signed?: boolean];
const UNIT_FIELDS: Field[] = [
  [0x00, 4, "vtbl"], [0x43, 1, "f43"], [0x49, 1, "size"], [0x4a, 1, "kind"], [0x50, 4, "task"], [0x54, 4, "act"], [0x8c, 2, "speed", true],
  [0x94, 2, "f94", true], [0x9a, 2, "mana"], [0x12c, 1, "attackRange"], [0x136, 1, "ready"], [0x144, 4, "effects"],
];
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
  [0x02, 2, "f02"], [0x04, 4, "f04"], [0x08, 1, "task"], [0x09, 1, "sub"], [0x0a, 2, "f0a"], [0x0c, 4, "f0c"], [0x14, 1, "range"],
  [0x15, 1, "f15"], [0x16, 2, "f16", true], [0x18, 4, "target"], [0x28, 4, "f28"], [0x3c, 2, "f3c"], [0x54, 4, "f54"], [0x78, 1, "spellSlot"],
  [0xb0, 2, "fb0"],
];

/** O rand() do CRT a partir da semente da chamada, contando os sorteios (prova da ordem: contagem e semente final iguais). */
class CountingRng extends Rng {
  n = 0;
  override raw(): number { this.n++; return super.raw(); }
}
const UNIT_LISTS: [number, "pathStatic" | "pathDynamic"][] = [[0x1c8, "pathStatic"], [0x1e4, "pathDynamic"]];

type Rec = Record<string, number>;
const rd = (mem: { u8(a: number): number; u16(a: number): number; u32(a: number): number }, a: number, f: Field): number => {
  const [, s, , sg] = f;
  const v = s === 1 ? mem.u8(a) : s === 2 ? mem.u16(a) : mem.u32(a);
  return sg ? (s === 1 ? (v << 24) >> 24 : (v << 16) >> 16) : v;
};
const mask = (v: number, s: 1 | 2 | 4): number => (s === 1 ? v & 0xff : s === 2 ? v & 0xffff : v >>> 0);

function fill(rec: Rec, cm: CallMem, base: number, fields: Field[]): void {
  for (const f of fields) rec[f[2]] = rd(cm, base + f[0], f);
}

/** Unidade remontada da memória da chamada (memoizada por endereço: argumentos e mapa compartilham o registro). */
function unitFrom(cm: CallMem, a: number, memo: Map<number, UnitRec>): UnitRec {
  let u = memo.get(a >>> 0);
  if (u) return u;
  u = new UnitRec();
  memo.set(a >>> 0, u);
  u.addr = a >>> 0;
  fill(u as unknown as Rec, cm, a, UNIT_FIELDS);
  u.mapObj = mapObjFrom(cm, cm.u32(a + 0x10));
  u.owner.f2c = cm.u32(cm.u32(a + 0x14) + 0x2c);
  const stats = cm.u32(cm.u32(a + 0x70) + 0x3c);
  u.type.stats.f20 = cm.u8(stats + 0x20);
  u.type.stats.speedByte = cm.u8(stats + 0x44);
  u.type.stats.f45 = cm.u8(stats + 0x45);
  u.book = bookFrom(cm, cm.u32(a + 0x140));
  fill(u.walk as unknown as Rec, cm, cm.u32(a + 0x1c0), WALK_FIELDS);
  fill(u.ai as unknown as Rec, cm, cm.u32(a + 0x1c4), AI_FIELDS);
  for (const [off, k] of UNIT_LISTS) u[k] = listFrom(cm, a + off);
  return u;
}

function packMapObj(o: MapObjRec): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = o.x; b[1] = o.y; b[2] = o.cell & 0xff; b[3] = (o.cell >> 8) & 0xff; b[4] = o.fx; b[5] = o.fy;
  for (let i = 0; i < 4; i++) b[8 + i] = Math.floor((o.owner >>> 0) / 2 ** (8 * i)) & 0xff;
  return b;
}

function checkFields(cm: CallMem, base: number, rec: Rec, fields: Field[], what: string): string | null {
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
function checkUnit(cm: CallMem, d: Pair, a: number, u: UnitRec): string | null {
  const w = cm.u32(a + 0x1c0), ai = cm.u32(a + 0x1c4), mo = cm.u32(a + 0x10);
  let e = checkFields(cm, a, u as unknown as Rec, UNIT_FIELDS, "unidade")
    ?? checkFields(cm, w, u.walk as unknown as Rec, WALK_FIELDS, "andar")
    ?? checkFields(cm, ai, u.ai as unknown as Rec, AI_FIELDS, "ia")
    ?? cm.checkRecord(mo, packMapObj(mapObjFrom(cm, mo)), packMapObj(u.mapObj));
  if (e) return e;
  const covered = (base: number, fields: Field[], x: number) => fields.some(([off, s]) => x >= base + off && x < base + off + s);
  for (const [wa, size] of d.writes) {
    for (let x = wa; x < wa + size; x++) {
      if (x >= a && x < a + 0x200) {
        if (UNIT_LISTS.some(([off]) => x >= a + off && x < a + off + 0x1c) || covered(a, UNIT_FIELDS, x)) continue;
        return `escrita do original em unidade+0x${(x - a).toString(16)} não espelhada`;
      }
      if (x >= w && x < w + 0xb4 && !covered(w, WALK_FIELDS, x)) return `escrita do original em andar+0x${(x - w).toString(16)} não espelhada`;
      if (x >= ai && x < ai + 0xb4 && !covered(ai, AI_FIELDS, x)) return `escrita do original em ia+0x${(x - ai).toString(16)} não espelhada`;
    }
  }
  for (const [off, k] of UNIT_LISTS) {
    e = checkList(cm, a + off, u[k], `unidade+0x${off.toString(16)}`);
    if (e) return e;
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------- chamadas

interface Ctx { d: Pair; cm: CallMem; memo: Map<number, UnitRec>; map: TestMap | null; mapBefore: Uint8Array | null; rng: CountingRng | null; }

function ctx(d: Pair, cm: CallMem): Ctx {
  return { d, cm, memo: new Map(), map: null, mapBefore: null, rng: null };
}
/** Mundo em `w` com o gerador na semente da chamada e o divisor do sorteio (mundo+0) lido pela chamada. */
function worldRec(c: Ctx, w: number, m: MapRec): WorldRec {
  const wr = new WorldRec(m);
  c.rng = new CountingRng(c.d.rng0);
  wr.rng = c.rng;
  if (c.cm.has(w)) wr.divisor = c.cm.u32(w) | 0;
  return wr;
}
const U = (c: Ctx, a: number): UnitRec => unitFrom(c.cm, a, c.memo);
function M(c: Ctx, base: number): TestMap {
  const m = mapFrom(c.cm, base, (a) => unitFrom(c.cm, a, c.memo));
  m.world = new WorldRec(m);
  c.map = m;
  c.mapBefore = m.mem.slice();
  return m;
}
/** Mapa do mundo `w` (+0xa50), conferindo que o mapa aponta de volta para o mesmo mundo quando a chamada leu +0x58d80. */
function W(c: Ctx, w: number): WorldRec {
  const base = c.cm.u32(w + 0xa50);
  const m = M(c, base);
  if (c.cm.has(base + MAP_WORLD_OFF) && c.cm.u32(base + MAP_WORLD_OFF) !== (w >>> 0)) throw new Error("mapa+0x58d80 ≠ mundo");
  return worldRec(c, w, m);
}
/** Mundo sem o mapa remontado (funções que só sorteiam: 0x57afc0, 0x57afd0). */
const WR = (c: Ctx, w: number): WorldRec => worldRec(c, w, new MapRec());

/** Confere mapa, todas as unidades tocadas e o retorno. */
function done(c: Ctx, r: number | null, ret?: (v: number) => number): string | null {
  if (c.map && c.mapBefore) {
    const e = checkMap(c.cm, c.map, c.mapBefore);
    if (e) return e;
  }
  for (const [a, u] of c.memo) {
    const e = checkUnit(c.cm, c.d, a, u);
    if (e) return `unidade 0x${a.toString(16)}: ${e}`;
  }
  const e = c.rng ? eq("rand(): sorteios", c.rng.n, c.d.nrand) ?? eq("rand(): semente final", c.rng.state, c.d.rng1 >>> 0)
    : c.d.nrand !== 0 || c.d.rng0 !== c.d.rng1 ? "rand() chamado no original" : null;
  if (e) return e;
  return r !== null && ret ? eq("retorno", r, ret(c.d.eax)) : null;
}

const EAX = (v: number) => v | 0, AL = (v: number) => v & 0xff, AX = (v: number) => v & 0xffff;
type Check = (d: Pair, cm: CallMem) => string | null;
const run = (f: (c: Ctx, d: Pair) => number | null, ret?: (v: number) => number): Check => (d, cm) => {
  const c = ctx(d, cm);
  return done(c, f(c, d), ret);
};
const A = (d: Pair, i: number) => d.args[i];

const CHECKS: Record<string, Check> = {
  "0x5551ef": run((c, d) => { unitWalkWait(U(c, A(d, 0))); return null; }),
  "0x556454": run((c, d) => { unitTurnStep(U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x5568e4": run((c, d) => fn_0x5568e4(U(c, A(d, 0)), U(c, A(d, 1))), AL),
  "0x556d78": run((c, d) => { fn_0x556d78(U(c, A(d, 0)), U(c, A(d, 1))); return null; }),
  "0x54f618": run((c, d) => fn_0x54f618(U(c, A(d, 0)), A(d, 1)), EAX),
  "0x558f64": run((c, d) => fn_0x558f64(U(c, A(d, 0))), AX),
  "0x556dcd": run((c, d) => aiUnitDistance(M(c, d.this), U(c, A(d, 0)), U(c, A(d, 1))), EAX),
  "0x55532d": run((c, d) => fn_0x55532d(M(c, d.this), U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)), EAX),
  "0x55a147": run((c, d) => fn_0x55a147(M(c, d.this), A(d, 0)), AL),
  "0x559195": run((c, d) => { const m = M(c, d.this); return unitWalkFormula(m, U(c, A(d, 0)), A(d, 1), (A(d, 2) << 24) >> 24); }, EAX),
  "0x554fd2": run((c, d) => { const m = M(c, d.this); fn_0x554fd2(m, U(c, A(d, 0))); return null; }),
  "0x555c7e": run((c, d) => { const m = M(c, d.this); fn_0x555c7e(m, U(c, A(d, 0))); return null; }),
  "0x555b38": run((c, d) => { const m = M(c, d.this); pathClearDynamic(m, U(c, A(d, 0))); return null; }),
  "0x555411": run((c, d) => { const m = M(c, d.this); unitActionWalk(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x55574d": run((c, d) => { const m = M(c, d.this); unitActionChase(m, U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)); return null; }),
  "0x56e4ac": run((c, d) => { const w = W(c, d.this); unitWalkNear(w, U(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x56fc69": run((c, d) => { const w = W(c, d.this); return fn_0x56fc69(w, U(c, A(d, 0)), A(d, 1)); }, AL),
  "0x56dca2": run((c, d) => { const w = W(c, d.this); w.fbbe8 = c.cm.u32(d.this + 0xbbe8); unitActionDispatcher(w, U(c, A(d, 0))); return null; }),
  "0x56ea52": run((c, d) => { const w = W(c, d.this); fn_0x56ea52(w, U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x56e5bc": run((c, d) => { const w = W(c, d.this); unitLookAround(w, U(c, A(d, 0))); return null; }),
  "0x57afc0": run((c, d) => randUniformObject(WR(c, d.this), 0x57afc0), EAX),
  "0x57afd0": run((c, d) => fn_0x57afd0(WR(c, d.this), A(d, 0), 0x57afd0), EAX),
  "0x54ec6a": run((c, d) => {
    const m = M(c, d.this);
    const l = gridUnitsInRings(m, A(d, 0), A(d, 1));
    if (l !== m.ringUnits) throw new Error("lista devolvida ≠ mapa+0x54010");
    return d.this + MAP_RINGS_OFF;
  }, EAX),
  "0x52b22a": (d, cm) => {
    const l = ptrListFrom(cm, d.this + 4);
    fn_0x52b22a(l, A(d, 0));
    return checkPtrList(cm, d.this + 4, l, "lista") ?? (d.nrand !== 0 ? "rand() chamado no original" : null);
  },
  "0x55073f": run((c, d) => { const m = M(c, d.this); return fn_0x55073f(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); }, EAX),
  "0x550697": run((c, d) => { const m = M(c, d.this); return fn_0x550697(m, U(c, A(d, 0))); }, EAX),
  "0x553891": run((c, d) => { const m = M(c, d.this); return unitRemoveFromCells(m, U(c, A(d, 0))); }, AL),
  "0x5503af": run((c, d) => { const m = M(c, d.this); return fn_0x5503af(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); }, EAX),
  "0x55020a": run((c, d) => { const m = M(c, d.this); return unitPlaceOnCells(m, U(c, A(d, 0))); }, EAX),
};

interface NodeEnv { env: Record<string, string | undefined>; }
const only = (proc as unknown as NodeEnv).env.EXE_WALK_ONLY?.split(",");
let failures = 0;
const notPorted = new Map<string, number>();
if (!existsSync(PAIRS)) {
  console.log(`exe_walkaction: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
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
          if (ex instanceof NotPorted) notPorted.set(ex.addr, (notPorted.get(ex.addr) ?? 0) + 1);
          // despachante: a chamada caiu numa tarefa/sub-ação ainda não portada (IA, golpe, magia): fora da prova
          if (ex instanceof NotPorted && fn === "0x56dca2") { skipped++; n--; continue; }
          err = `exceção: ${(ex as Error).message}`;
        }
        if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
      }
      if (bad) failures++;
      total.set(fn, (total.get(fn) ?? 0) + n);
      if (n === 0) continue;
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${skipped ? ` (+${skipped} em ramo não portado)` : ""}${first ? "  " + first : ""}`);
    }
  }
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
  if (notPorted.size) console.log(`  NotPorted alcançado: ${[...notPorted].map(([a, k]) => `${a}×${k}`).join(" ")}`);
}

// --------------------------------------------------------------------------------- varredura no Unicorn (fuzz_walk.py)

interface FzUnit { x: number; y: number; fx: number; fy: number; size: number; kind: number; speed: number; sb: number; }
interface FzCase { fn: string; in: Record<string, unknown> & { u: FzUnit; t?: FzUnit }; out: Record<string, unknown>; }

function fzUnit(f: FzUnit, addr: number): UnitRec {
  const u = new UnitRec();
  u.addr = addr;
  u.vtbl = 0x5d0eb0;
  u.mapObj.x = f.x; u.mapObj.y = f.y; u.mapObj.fx = f.fx; u.mapObj.fy = f.fy; u.mapObj.cell = (f.y << 8) | f.x;
  u.size = f.size; u.kind = f.kind; u.speed = f.speed; u.type.stats.speedByte = f.sb;
  return u;
}

function fzRun(c: FzCase): Record<string, unknown> {
  const i = c.in;
  const u = fzUnit(i.u, 1);
  if (c.fn === "0x559195") {
    const m = new MapRec();
    const dx = i.dx as number[], dy = i.dy as number[], step = i.step as number[];
    for (let k = 0; k < 8; k++) {
      m.dv.setInt8(MAP_DIR_DX_OFF + k, dx[k]); m.dv.setInt8(MAP_DIR_DY_OFF + k, dy[k]); m.dv.setInt32(MAP_DIR_CELL_OFF + k * 4, step[k], true);
    }
    m.dv.setInt32(MAP_SPEED_MUL_OFF, i.mul as number, true);
    for (const [cl, v] of i.alt as number[][]) m.dv.setInt8(MAP_ALT_OFF + cl, v);
    for (const [cl, v] of i.cost as number[][]) m.mem[cl] = v;
    try {
      const eax = unitWalkFormula(m, u, i.cell as number, ((i.dir as number) << 24) >> 24);
      const w = u.walk, b = new Uint8Array(10), dv = new DataView(b.buffer);
      dv.setUint16(0, w.stepSpeed, true); dv.setUint16(2, w.stepTicks, true); dv.setUint16(4, w.stepTick, true);
      dv.setUint16(6, w.stepDir, true); dv.setInt8(8, w.stepDx); dv.setInt8(9, w.stepDy);
      return { eax, w: Array.from(b) };
    } catch (ex) {
      return { err: (ex as Error).message };
    }
  }
  const w = u.walk;
  const w0 = i.w0 as number[];
  w.dir = w0[0]; w.dirTarget = w0[1]; w.turnRate = i.rate as number; w.turning = i.turning as number; w.f9d = i.f9d as number;
  w.turnTicks = 0;
  const t = i.t ? fzUnit(i.t, 2) : u;
  const getw = () => ({ w0: [w.dir, w.dirTarget], a0: w.turning >>> 0, a4: w.turnTicks, "9d": w.f9d });
  switch (c.fn) {
    case "0x5551ef": unitWalkWait(u); return getw();
    case "0x556454": unitTurnStep(u, i.d as number); return getw();
    case "0x556da2": fn_0x556da2(u, i.cell as number); return getw();
    case "0x556b2c": return { al: dirFromDelta16(u, i.cell as number) };
    case "0x5568e4": return { al: fn_0x5568e4(u, t) };
    case "0x54f618": return { eax: fn_0x54f618(u, i.cell as number) };
    case "0x556dcd": return { eax: aiUnitDistance(new MapRec(), u, t) };
  }
  throw new Error(`caso ${c.fn} sem porta`);
}

const FUZZ = join(PAIRS, "..", "fuzz", "walk.jsonl");
if ((!only || only.includes("fuzz")) && existsSync(FUZZ)) {
  const per = new Map<string, [number, number, string]>();
  for (const line of readFileSync(FUZZ, "utf8").split("\n")) {
    if (!line) continue;
    const c = JSON.parse(line) as FzCase;
    const got = fzRun(c);
    const s = per.get(c.fn) ?? [0, 0, ""];
    s[0]++;
    const want = c.out;
    const same = "err" in want ? "err" in got : JSON.stringify(got) === JSON.stringify(want);
    if (!same) { s[1]++; if (!s[2]) s[2] = `${JSON.stringify(c.in).slice(0, 160)} → porta ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`; }
    per.set(c.fn, s);
  }
  for (const [fn, [n, bad, first]] of per) {
    if (bad) failures++;
    console.log(`  ${bad ? "FALHOU" : "ok  "} fuzz ${fn}: ${n - bad}/${n}${first ? "  " + first : ""}`);
  }
} else if (!only || only.includes("fuzz")) {
  console.log(`  sem varredura em ${FUZZ} (rode tools/re/oracle/fuzz_walk.py)`);
}

console.log(failures ? `exe_walkaction: ${failures} FALHA(S)` : "exe_walkaction: tudo igual ao original");
if (failures) proc.exitCode = 1;
