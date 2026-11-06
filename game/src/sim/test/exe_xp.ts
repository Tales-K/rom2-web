/**
 * Prova da porta sim/exe/xp.ts (a experiência dos humanos/herói: 0x5128cb, 0x513128, 0x512fcb, 0x5131ef, 0x512f44) contra os pares do
 * oráculo (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts: retorno, unidades tocadas (o recálculo 0x51366b da subida de nível
 * incluído) e, à parte, os campos da experiência: +0x23c[0..5], +0x130, habilidades +0xa8.., base +0x116.. e os abates +0x1a8. Rodar em game/:
 *   npx tsx src/sim/test/exe_xp.ts            (EXE_XP_ONLY=0x5128cb,... para só algumas)
 */
import { fn_0x512f44, fn_0x5128cb, fn_0x512fcb, fn_0x5131ef, unitXpOnHit } from "../exe/xp";
import type { CombatHooks } from "../exe/combat";
import type { UnitRec, WorldRec } from "../exe/types";
import { A, M, U, ctx, done, eq, finView, runPairs, worldRec, type Check, type Ctx, type Pair } from "./exe_recon";

const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
const H: CombatHooks = {};
const HOOKED = new Set<string>();

const world = (c: Ctx): WorldRec => worldRec(c, c.cm.u32(WORLD_PTR), M(c, c.cm.u32(MAP_PTR)));

/** Os campos da experiência da unidade iguais ao fim da chamada no original (lido o final onde o original escreveu, senão o inicial). */
function checkXp(c: Ctx, u: UnitRec): string | null {
  const f = finView(c.cm), w = (a: number, n: number): boolean => { for (let i = 0; i < n; i++) if (c.cm.written.has(a + i)) return true; return false; };
  const u32 = (a: number): number => (w(a, 4) ? f.u32(a) : c.cm.u32(a)) >>> 0;
  const u16 = (a: number): number => (w(a, 2) ? f.u16(a) : c.cm.u16(a)) & 0xffff;
  for (let i = 0; i < 6; i++) {
    const e = eq(`+0x23c[${i}]`, u.f23c[i]! >>> 0, u32(u.addr + 0x23c + 4 * i))
      ?? eq(`habilidade[${i}] (+0xa8)`, u.dmg.sk[i]! & 0xffff, u16(u.addr + 0xa8 + 2 * i))
      ?? eq(`habilidade-base[${i}] (+0x116)`, u.skBase[i]! & 0xffff, u16(u.addr + 0x116 + 2 * i));
    if (e) return e;
  }
  const e = eq("+0x130", u.f130 >>> 0, u32(u.addr + 0x130));
  if (e) return e;
  const n = u32(u.addr + 0x1a8 + 8), p = u32(u.addr + 0x1a8 + 4);
  if (n !== u.kills.length) return `abates +0x1a8: tamanho ${u.kills.length}, original ${n}`;
  for (let i = 0; i < n; i++) { const x = eq(`abates[${i}]`, u.kills[i]! >>> 0, u32(p + 4 * i)); if (x) return x; }
  return null;
}
const runX = (f: (c: Ctx, d: Pair) => { r: number | null; u?: UnitRec }): Check => (d: Pair, cm) => {
  const c = ctx(d, cm), o = f(c, d);
  return done(c, o.r) ?? (o.u ? checkXp(c, o.u) : null);
};
const ptr = (c: Ctx, a: number): UnitRec | null => (a >>> 0) === 0 ? null : U(c, a);

const CHECKS: Record<string, Check> = {
  "0x512f44": (d: Pair, cm) => { const c = ctx(d, cm); return done(c, fn_0x512f44(A(d, 0) | 0, A(d, 1) | 0)); },
  "0x5128cb": runX((c, d) => { const w = world(c), u = U(c, d.this); fn_0x5128cb(w, u, A(d, 0) >>> 0, ptr(c, A(d, 1)), A(d, 2) | 0, H); return { r: null, u }; }),
  "0x513128": runX((c, d) => { const w = world(c), u = U(c, d.this); unitXpOnHit(w, u, U(c, A(d, 0)), A(d, 1) | 0, A(d, 2) | 0, H); return { r: null, u }; }),
  "0x512fcb": runX((c, d) => { const w = world(c), u = U(c, d.this); fn_0x512fcb(w, u, U(c, A(d, 0)), A(d, 1) | 0, H); return { r: null, u }; }),
  "0x5131ef": runX((c, d) => { const w = world(c), u = U(c, d.this); fn_0x5131ef(w, u, ptr(c, A(d, 0)), A(d, 1) | 0, H); return { r: null, u }; }),
};

runPairs("exe_xp", CHECKS, HOOKED, "EXE_XP_ONLY");
