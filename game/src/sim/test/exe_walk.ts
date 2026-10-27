/**
 * Prova da porta sim/exe/walk.ts (lote 5a, folhas do andar) contra os pares do oráculo (tools/re/oracle/fnprobe.py). Rodar em game/:
 *   npx tsx src/sim/test/exe_walk.ts
 *
 * Cada linha de refs/oracle/pairs/<episodio>/<addr>.jsonl é uma chamada do original em contexto real. Entradas: reconstruídas só
 * pelos acessos da própria chamada (CallMem = estado antes/depois por byte; Recon para unidades via `objs`), endereçadas relativas
 * a `this`/argumentos, nunca por endereço absoluto. Exige igualdade exata em 100 % das chamadas: valor de retorno na largura
 * declarada (byte/short: o resto de EAX é sobra de registrador; EDX não é retorno em nenhuma função do lote), rand() intocado e,
 * nas funções que escrevem, o registro final igual byte a byte ao do original (a porta só muda bytes que o original escreveu).
 *
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  cellFlagMark40, cellFlagTest40, cellIdxOff00000, cellIdxOff10000, cellIdxOff20000, cellIndex, cellOff00000, cellOff10000, cellOff20000,
  fn_0x5514ce, fn_0x55687d, fn_0x55915a, fn_0x55b95f, fn_0x55f330, unitGetKind, gridChebyshevDist, mapObjCellOf, mapObjCenterFraction, mapObjInit, mapObjInitPacked,
  mapObjInitPacked16, mapObjSetFine, mapObjSubCellCenter, occRecArrayInit, occRecClear, occRecConstruct, occRecCopy, occRecIsEmpty,
  orMaskInto, sessionField18b0, unitByte43, unitPassMaskAnd,
} from "../exe/walk";
import { FLAGS_OFF, MapObjRec, OccRec, SessionRec, UnitRec } from "../exe/types";
import { CallMem, PAIRS, Recon, existsSync, join, proc, readFileSync, readdirSync, type Pair } from "./exe_recon";

const eq = (what: string, got: number, want: number): string | null =>
  got === want ? null : `${what}: porta ${got} (0x${(got >>> 0).toString(16)}) ≠ original ${want} (0x${(want >>> 0).toString(16)})`;

function mapFrom(m: CallMem, base: number): MapObjRec {
  const o = new MapObjRec();
  o.x = m.u8(base); o.y = m.u8(base + 1); o.cell = m.u16(base + 2); o.fx = m.u8(base + 4); o.fy = m.u8(base + 5); o.owner = m.u32(base + 8);
  return o;
}
function packMap(o: MapObjRec): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = o.x; b[1] = o.y; b[2] = o.cell & 0xff; b[3] = o.cell >> 8; b[4] = o.fx; b[5] = o.fy;
  for (let i = 0; i < 4; i++) b[8 + i] = Math.floor(o.owner / 2 ** (8 * i)) & 0xff;
  return b;
}
function occFrom(m: CallMem, base: number): OccRec {
  const r = new OccRec();
  r.b.set(m.bytes(base, OccRec.SIZE));
  return r;
}
function flagsFrom(m: CallMem, base: number): Uint8Array {
  const f = new Uint8Array(0x10000);
  for (let i = 0; i < f.length; i++) f[i] = m.u8(base + FLAGS_OFF + i);
  return f;
}

type Check = (d: Pair, m: CallMem) => string | null;

/** Funções que escrevem: o registro final é conferido byte a byte em vez de "nenhuma escrita". */
const WRITERS = new Set(["0x54fc41", "0x54f9b9", "0x54fa43", "0x54fa22", "0x5551d6", "0x54f89a", "0x54f84c", "0x5604f0", "0x55385f", "0x55c500", "0x550de0"]);

function mapWrite(d: Pair, m: CallMem, run: (o: MapObjRec) => number | null): string | null {
  const o = mapFrom(m, d.this);
  const before = packMap(o);
  const ret = run(o);
  const e = m.checkRecord(d.this, before, packMap(o));
  if (e) return e;
  return ret === null ? null : eq("EAX", ret, d.eax | 0);
}

const CHECKS: Record<string, Check> = {
  "0x54f9b9": (d, m) => mapWrite(d, m, (o) => { mapObjInit(o, d.args[0], d.args[1], d.args[2]); return null; }),
  "0x54fa43": (d, m) => mapWrite(d, m, (o) => { mapObjInitPacked(o, d.args[0], d.args[1]); return null; }),
  "0x54fa22": (d, m) => mapWrite(d, m, (o) => { mapObjInitPacked16(o, d.args[0], d.args[1]); return d.this | 0; }),
  "0x54fc41": (d, m) => mapWrite(d, m, (o) => { mapObjSetFine(o, d.args[0], d.args[1]); return null; }),
  "0x54ff9e": (d, m) => eq("AX", mapObjCellOf(mapFrom(m, d.this)), d.eax & 0xffff),
  "0x551383": (d, m) => eq("EAX", mapObjSubCellCenter(mapFrom(m, d.this)), d.eax | 0),
  "0x5551d6": (d, m) => mapWrite(d, m, (o) => { mapObjCenterFraction(o); return null; }),
  "0x551463": (d) => eq("AL", gridChebyshevDist(d.args[0], d.args[1], d.args[2], d.args[3]), d.eax & 0xff),
  "0x5514ce": (d, m) => eq("AL", fn_0x5514ce(m.u8(d.this)), d.eax & 0xff),
  "0x55915a": (d, m) => {
    const u = new UnitRec();
    const unit = d.args[0];
    const type = m.u32(unit + 0x70), stats = m.u32(type + 0x3c);
    u.type.stats.speedByte = m.u8(stats + 0x44);
    u.speed = (m.u16(unit + 0x8c) << 16) >> 16;
    return eq("EAX", fn_0x55915a(u), d.eax | 0);
  },
  "0x542380": (d, m) => { const u = new UnitRec(); u.kind = m.u8(d.this + 0x4a); return eq("AL", unitGetKind(u), d.eax & 0xff); },
  "0x55f330": (d) => eq("AL", fn_0x55f330(new Recon(d).unitAt(d.this)), d.eax & 0xff),
  "0x55687d": (d, m) => {
    const u = new Recon(d).unitAt(d.args[0]);
    const grid = { bytes: new Uint8Array(0x10000) };
    for (let i = 0; i < 0x10000; i++) grid.bytes[i] = m.u8(d.this + i);
    const got = fn_0x55687d(grid, u, d.args[1], d.args[2]);
    return fn_0x55f330(u) === 1 ? eq("EAX", got, d.eax | 0) : eq("AX", got, d.eax & 0xffff);
  },
  "0x5160ef": (d, m) => { const u = new UnitRec(); u.f43 = m.u8(d.this + 0x43); return eq("AL", unitByte43(u), d.eax & 0xff); },
  "0x540360": (d, m) => { const s = new SessionRec(); s.f18b0 = m.u32(d.this + 0x18b0); return eq("EAX", sessionField18b0(s), d.eax | 0); },
  "0x55c500": (d, m) => {
    const p = d.args[0];
    const buf = new Uint8Array([m.u8(p)]);
    const before = buf.slice();
    orMaskInto(buf, 0, d.args[1]);
    return m.checkRecord(p, before, buf);
  },
  "0x55c550": (d) => eq("EAX", unitPassMaskAnd(d.args[0], d.args[1]), d.eax | 0),
  "0x55f9c0": (d) => eq("EAX", cellIndex(d.args[0], d.args[1]), d.eax | 0),
  "0x55f9f0": (d) => eq("EAX-this", cellOff00000(d.args[0], d.args[1]), (d.eax - d.this) | 0),
  "0x542dc0": (d) => eq("EAX-this", cellOff10000(d.args[0], d.args[1]), (d.eax - d.this) | 0),
  "0x55fa20": (d) => eq("EAX-this", cellOff20000(d.args[0], d.args[1]), (d.eax - d.this) | 0),
  "0x55fa50": (d) => eq("EAX-this", cellIdxOff00000(d.args[0]), (d.eax - d.this) | 0),
  "0x55fa70": (d) => eq("EAX-this", cellIdxOff10000(d.args[0]), (d.eax - d.this) | 0),
  "0x55fa90": (d) => eq("EAX-this", cellIdxOff20000(d.args[0]), (d.eax - d.this) | 0),
  "0x550eae": (d, m) => eq("EAX", cellFlagTest40({ flags: flagsFrom(m, d.this) }, d.args[0]), d.eax | 0),
  "0x550de0": (d, m) => {
    const g = { flags: flagsFrom(m, d.this) };
    const before = g.flags.slice();
    cellFlagMark40(g, d.args[0]);
    return m.checkRecord(d.this + FLAGS_OFF, before, g.flags);
  },
  "0x55b95f": (d) => eq("EAX", fn_0x55b95f(d.this), d.eax | 0),
  "0x54f89a": (d, m) => {
    const r = occFrom(m, d.this);
    const before = r.b.slice();
    occRecClear(r);
    return m.checkRecord(d.this, before, r.b);
  },
  "0x54f84c": (d, m) => {
    const r = occFrom(m, d.this);
    const before = r.b.slice();
    const ret = occRecConstruct(r);
    return m.checkRecord(d.this, before, ret.b);
  },
  "0x55385f": (d, m) => {
    const dst = occFrom(m, d.this), src = occFrom(m, d.args[0]);
    const before = dst.b.slice();
    occRecCopy(dst, src);
    return m.checkRecord(d.this, before, dst.b);
  },
  "0x5513b6": (d, m) => eq("EAX", occRecIsEmpty(occFrom(m, d.this)), d.eax | 0),
  "0x5604f0": (d, m) => {
    const base = d.args[0], n = d.args[1];
    const recs: OccRec[] = [];
    for (let i = 0; i < n; i++) recs.push(occFrom(m, base + i * OccRec.SIZE));
    const before = recs.map((r) => r.b.slice());
    occRecArrayInit(recs, n);
    for (let i = 0; i < n; i++) {
      const e = m.checkRecord(base + i * OccRec.SIZE, before[i], recs[i].b);
      if (e) return `registro ${i}: ${e}`;
    }
    return null;
  },
};

let failures = 0;
if (!existsSync(PAIRS)) {
  console.log(`exe_walk: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
} else {
  const total = new Map<string, number>();
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
          err = check(d, new CallMem(d));
          if (!err && !WRITERS.has(fn) && d.writes.length) err = `${d.writes.length} escritas no original`;
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
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
}

console.log(failures ? `exe_walk: ${failures} FALHA(S)` : "exe_walk: tudo igual ao original");
if (failures) proc.exitCode = 1;
