/**
 * Prova da porta sim/exe/path.ts contra os pares do oráculo (tools/re/oracle/fnprobe.py). Rodar em game/:
 *   npx tsx src/sim/test/exe_path.ts
 *
 * Para cada episódio em refs/oracle/pairs/ e cada função do lote, cada linha é uma chamada do original em contexto real. As
 * entradas são reconstruídas só pelas leituras da própria chamada, endereçadas por `objs` (id da unidade, sub-objeto, offset),
 * nunca por endereço absoluto; o objeto de busca (`this` de 0x557f08/0x55f970) é endereçado relativo a `this`. Exige igualdade
 * exata em 100 % das chamadas: valor de retorno na largura declarada (byte/short: o resto de EAX é sobra de registrador; EDX
 * não é retorno em nenhuma função do lote), nenhuma escrita, rand() intocado e, em 0x557f08, a mesma sequência de células da
 * grade de custo lidas, na mesma ordem.
 *
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  dirSector16, mapObjCellX, mapObjCellY, mapObjFineX, mapObjFineY, pathCostCellOff, pathUnlabeledTargetRing, unitApproachCell,
  unitCenterX, unitCenterY,
} from "../exe/path";
import { MapObjRec, PATH_COST_OFF, PATH_RING_STEP_OFF, PATH_RING_STEP_N, UnitRec, type PathRec } from "../exe/types";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync, readdirSync } = proc.getBuiltinModule("node:fs") as {
  existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string; readdirSync(p: string): string[];
};
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

const PAIRS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "refs", "oracle", "pairs");

interface Obj { unit: number; sub?: string; off: number; }
interface Pair {
  t: number; seq: number; fn: string; this: number; args: number[]; eax: number; rng0: number; rng1: number; nrand: number;
  reads: [number, number, number][]; writes: unknown[]; objs: Record<string, Obj>;
}

/** Unidades e objetos de mapa reconstruídos pelas leituras da chamada, via `objs`. */
class Recon {
  units = new Map<number, UnitRec>();
  constructor(readonly d: Pair) {
    for (const [a, s, v] of d.reads) {
      const o = d.objs[String(a)];
      if (!o) continue;
      const u = this.unit(o.unit);
      if (o.sub === undefined) {
        if (o.off === 0x0 && s === 4) u.vtbl = v >>> 0;
        else if (o.off === 0x49 && s === 1) u.size = v;
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

/** Objeto de busca a partir das leituras relativas a `this`; `costReads` registra os índices de custo lidos pela porta. */
function pathFrom(d: Pair, costReads: number[]): { p: PathRec; origCost: number[] } {
  const cost = new Uint16Array(256 * 256);
  const ringStep = new Int8Array(PATH_RING_STEP_N * 2);
  const origCost: number[] = [];
  for (const [a, s, v] of d.reads) {
    const r = a - d.this;
    if (r >= PATH_COST_OFF && r < PATH_COST_OFF + 0x20000 && s === 2) { cost[(r - PATH_COST_OFF) >> 1] = v; origCost.push((r - PATH_COST_OFF) >> 1); }
    else if (r >= PATH_RING_STEP_OFF && r < PATH_RING_STEP_OFF + ringStep.length && s === 1) ringStep[r - PATH_RING_STEP_OFF] = (v << 24) >> 24;
  }
  const costProxy = new Proxy(cost, {
    get(tgt, k) {
      if (typeof k === "string" && /^\d+$/.test(k)) { costReads.push(Number(k)); return tgt[Number(k)]; }
      return Reflect.get(tgt, k);
    },
  });
  return { p: { cost: costProxy, ringStep }, origCost };
}

type Check = (d: Pair) => string | null;
const eq = (what: string, got: number, want: number): string | null =>
  got === want ? null : `${what}: porta ${got} (0x${(got >>> 0).toString(16)}) ≠ original ${want} (0x${(want >>> 0).toString(16)})`;

const CHECKS: Record<string, Check> = {
  "0x54ffb0": (d) => eq("AL", mapObjCellX(new Recon(d).mapObjAt(d.this)), d.eax & 0xff),
  "0x54ffc0": (d) => eq("AL", mapObjCellY(new Recon(d).mapObjAt(d.this)), d.eax & 0xff),
  "0x54ff5b": (d) => eq("AX", mapObjFineX(new Recon(d).mapObjAt(d.this)), d.eax & 0xffff),
  "0x54ff7c": (d) => eq("AX", mapObjFineY(new Recon(d).mapObjAt(d.this)), d.eax & 0xffff),
  "0x50d884": (d) => eq("AX", unitCenterX(new Recon(d).unitAt(d.this)), d.eax & 0xffff),
  "0x50d8c0": (d) => eq("AX", unitCenterY(new Recon(d).unitAt(d.this)), d.eax & 0xffff),
  "0x55f970": (d) => eq("EAX-this", pathCostCellOff(pathFrom(d, []).p, d.args[0], d.args[1]), (d.eax - d.this) | 0),
  "0x557cf1": (d) => { const r = new Recon(d); return eq("AL", dirSector16(r.unitAt(d.args[0]), r.unitAt(d.args[1])), d.eax & 0xff); },
  "0x557f08": (d) => {
    const r = new Recon(d);
    const costReads: number[] = [];
    const { p, origCost } = pathFrom(d, costReads);
    const got = unitApproachCell(p, r.unitAt(d.args[0]), r.unitAt(d.args[1]));
    const e = got === 0 && (d.eax & 0xffff) === 0 ? null : eq("EAX", got, d.eax | 0);
    if (e) return e;
    if (costReads.length !== origCost.length || costReads.some((c, i) => c !== origCost[i]))
      return `células lidas: porta ${costReads.length}, original ${origCost.length} (primeira diferença em ${costReads.findIndex((c, i) => c !== origCost[i])})`;
    return null;
  },
  "0x5585f4": (d) => {
    const r = new Recon(d);
    const costReads: number[] = [];
    const { p, origCost } = pathFrom(d, costReads);
    const got = pathUnlabeledTargetRing(p, r.unitAt(d.args[0]), d.args[1], d.args[2], d.args[3]);
    const e = eq("AX", got, d.eax & 0xffff);
    if (e) return e;
    if (costReads.length !== origCost.length || costReads.some((c, i) => c !== origCost[i]))
      return `células lidas: porta ${costReads.length}, original ${origCost.length}`;
    return null;
  },
};

let failures = 0;
if (!existsSync(PAIRS)) {
  console.log(`exe_path: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
} else {
  for (const ep of readdirSync(PAIRS).sort()) {
    for (const [fn, check] of Object.entries(CHECKS)) {
      const file = join(PAIRS, ep, `${fn}.jsonl`);
      if (!existsSync(file)) continue;
      let n = 0, bad = 0, first = "";
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        const d = JSON.parse(line) as Pair;
        n++;
        let err: string | null;
        try {
          err = check(d);
          if (!err && d.writes.length) err = `${d.writes.length} escritas no original`;
          if (!err && (d.nrand !== 0 || d.rng0 !== d.rng1)) err = "rand() chamado no original";
        } catch (ex) { err = `exceção: ${(ex as Error).message}`; }
        if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
      }
      if (bad) failures++;
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${first ? "  " + first : ""}`);
    }
  }
}
// Varredura no Unicorn (tools/re/oracle/fuzz_approach.py): ramos que os pares não alcançam.
const FUZZ = join(PAIRS, "..", "fuzz", "0x557f08.jsonl");
if (existsSync(FUZZ)) {
  interface Fz { a: number[]; t: number[]; cells: [number, number][]; eax: number; nreads: number; hreads: number; }
  const unitOf = (r: number[]): UnitRec => {
    const u = new UnitRec();
    u.vtbl = 0x5d0eb0;
    u.mapObj = new MapObjRec();
    [u.mapObj.x, u.mapObj.y, u.mapObj.fx, u.mapObj.fy, u.size] = r;
    return u;
  };
  const RING = [1, 0, 0, 1, -1, 0, 0, -1];
  let n = 0, bad = 0, first = "";
  const stats = { notFound: 0, multiRing: 0 };
  for (const line of readFileSync(FUZZ, "utf8").split("\n")) {
    if (!line) continue;
    const f = JSON.parse(line) as Fz;
    n++;
    const cost = new Uint16Array(256 * 256).fill(0xffff);
    for (const [i, v] of f.cells) cost[i] = v;
    const ringStep = new Int8Array(PATH_RING_STEP_N * 2).map((_, i) => RING[i % 8]);
    const reads: number[] = [];
    const p: PathRec = {
      cost: new Proxy(cost, { get: (tg, k) => (typeof k === "string" && /^\d+$/.test(k) ? (reads.push(Number(k)), tg[Number(k)]) : Reflect.get(tg, k)) }),
      ringStep,
    };
    let err: string | null;
    try {
      const got = unitApproachCell(p, unitOf(f.a), unitOf(f.t));
      if ((f.eax & 0xffff) === 0) stats.notFound++;
      if (f.nreads > 2 * 40) stats.multiRing++;
      err = got === 0 && (f.eax & 0xffff) === 0 ? null : eq("EAX", got, f.eax);
      let h = 0;
      for (const i of reads) h = (Math.imul(h, 31) + i) | 0;
      if (!err && (reads.length !== f.nreads || h !== f.hreads)) err = `células lidas: porta ${reads.length}, original ${f.nreads}`;
    } catch (ex) { err = `exceção: ${(ex as Error).message}`; }
    if (err) { bad++; if (!first) first = `caso ${n} a=${f.a} t=${f.t}: ${err}`; }
  }
  if (bad) failures++;
  console.log(`  ${bad ? "FALHOU" : "ok  "} unicorn 0x557f08: ${n - bad}/${n} (sem célula ${stats.notFound}, >80 leituras ${stats.multiRing})${first ? "  " + first : ""}`);
}

const FUZZ_RING = join(PAIRS, "..", "fuzz", "0x5585f4.jsonl");
if (existsSync(FUZZ_RING)) {
  interface Fr { size: number; center: number; rings: number; cells: [number, number][]; eax: number; nreads: number; hreads: number; }
  let n = 0, bad = 0, first = "", notFound = 0;
  for (const line of readFileSync(FUZZ_RING, "utf8").split("\n")) {
    if (!line) continue;
    const f = JSON.parse(line) as Fr;
    n++;
    const cost = new Uint16Array(256 * 256).fill(0xffff);
    for (const [i, v] of f.cells) cost[i] = v;
    const reads: number[] = [];
    const p: PathRec = {
      cost: new Proxy(cost, { get: (tg, k) => (typeof k === "string" && /^\d+$/.test(k) ? (reads.push(Number(k)), tg[Number(k)]) : Reflect.get(tg, k)) }),
      ringStep: new Int8Array(PATH_RING_STEP_N * 2),
    };
    const u = new UnitRec();
    u.vtbl = 0x5d0eb0;
    u.size = f.size;
    let err: string | null;
    try {
      err = eq("AX", pathUnlabeledTargetRing(p, u, 0, f.center, f.rings), f.eax & 0xffff);
      if ((f.eax & 0xffff) === 0) notFound++;
      let h = 0;
      for (const i of reads) h = (Math.imul(h, 31) + i) | 0;
      if (!err && (reads.length !== f.nreads || h !== f.hreads)) err = `células lidas: porta ${reads.length}, original ${f.nreads}`;
    } catch (ex) { err = `exceção: ${(ex as Error).message}`; }
    if (err) { bad++; if (!first) first = `caso ${n}: ${err}`; }
  }
  if (bad) failures++;
  console.log(`  ${bad ? "FALHOU" : "ok  "} unicorn 0x5585f4: ${n - bad}/${n} (sem célula ${notFound})${first ? "  " + first : ""}`);
}

console.log(failures ? `exe_path: ${failures} FALHA(S)` : "exe_path: tudo igual ao original");
if (failures) proc.exitCode = 1;
