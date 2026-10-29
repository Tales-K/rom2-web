/**
 * Prova da porta sim/exe/effects.ts, etapa 8b lote 4 (os efeitos com duração na lista +0x20 e o recálculo dos atributos do humano:
 * 0x51e8fa, 0x51caa0, 0x51ce12, 0x51cc9f, 0x542540, 0x51d175, 0x51d337, 0x51d436, 0x51366b) contra os pares do oráculo
 * (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts: retorno, unidades tocadas (atributos, bônus +0xd4.., lista +0x20), as
 * cargas "Effect", as habilidades +0xa8.. e as magias do livro refeitas (Spell_CasterPower → Spell_Instance). Rodar em game/:
 *   npx tsx src/sim/test/exe_effects.ts            (EXE_EFFECTS_ONLY=0x51366b,... para só algumas)
 */
import {
  fn_0x5118be, fn_0x51caa0, fn_0x51cc9f, fn_0x51ce12, fn_0x51d175, fn_0x51d337, fn_0x51d436, fn_0x51e8fa, fn_0x542540, unitRecompute,
} from "../exe/effects";
import type { CombatHooks } from "../exe/combat";
import { VT_EFFECT, type SpellPayloadRec, type UnitRec, type WorldRec } from "../exe/types";
import {
  A, AL, M, U, checkFields, checkSpellWorld, ctx, done, eq, finView, payloadFrom, runPairs, worldRec, type CallMem, type Check, type Ctx,
  type Field, type Pair, type Rec,
} from "./exe_recon";

const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
const H: CombatHooks = { xpOnHit: () => { /* nada */ }, xpOnCast: () => { /* nada */ } };
const HOOKED = new Set<string>();

const world = (c: Ctx): WorldRec => worldRec(c, c.cm.u32(WORLD_PTR), M(c, c.cm.u32(MAP_PTR)));
/** a carga "Effect" `this` (vtable lida pelo chamador) registrada no mundo */
function fx(c: Ctx, w: WorldRec, a: number): SpellPayloadRec {
  const p = payloadFrom(c.cm, a, VT_EFFECT);
  w.payloads.set(p.addr, p);
  return p;
}
/** CString (ponteiro para os caracteres em +0): o texto que a chamada leu. */
function cstr(cm: CallMem, a: number): string {
  const p = cm.u32(a);
  let s = "";
  for (let i = 0; i < 256 && cm.has(p + i) && cm.u8(p + i) !== 0; i++) s += String.fromCharCode(cm.u8(p + i));
  return s;
}
const SPELL_FIELDS: Field[] = [[0x09, 1, "range"], [0x0e, 1, "f0e"], [0x0f, 1, "f0f"], [0x10, 2, "f10", true]];
/** habilidades +0xa8..+0xb3 (fora da conferência do arnês: a experiência do motor antigo as escreve) e as magias do livro */
function checkStats(c: Ctx, u: UnitRec): string | null {
  const f = finView(c.cm);
  for (let i = 0; i < 6; i++) {
    const a = u.addr + 0xa8 + 2 * i, got = u.dmg.sk[i]! & 0xffff;
    const want = c.cm.written.has(a) || c.cm.written.has(a + 1) ? f.u16(a) : c.cm.u16(a);
    const e = eq(`habilidade[${i}]`, got, want);
    if (e) return e;
  }
  for (const s of u.book.spells) {
    if (!s) continue;
    const e = checkFields(c.cm, s.addr, s as unknown as Rec, SPELL_FIELDS, `magia 0x${s.addr.toString(16)}`);
    if (e) return e;
  }
  return null;
}
const runE = (f: (c: Ctx, d: Pair) => { r: number | null; u?: UnitRec }, ret?: (v: number) => number): Check => (d: Pair, cm: CallMem) => {
  const c = ctx(d, cm), o = f(c, d);
  return done(c, o.r, ret) ?? checkSpellWorld(c) ?? (o.u ? checkStats(c, o.u) : null);
};

const CHECKS: Record<string, Check> = {
  "0x51e8fa": runE((c, d) => ({ r: fn_0x51e8fa(world(c), cstr(c.cm, A(d, 0)))?.addr ?? 0 }), (v) => v >>> 0),
  "0x51caa0": runE((c, d) => ({ r: fn_0x51caa0(world(c), cstr(c.cm, A(d, 0))).addr }), (v) => v >>> 0),
  "0x51ce12": runE((c, d) => { const w = world(c), u = U(c, A(d, 0)); fn_0x51ce12(w, fx(c, w, d.this), u, H); return { r: null, u }; }),
  "0x51cc9f": runE((c, d) => { const w = world(c), u = U(c, A(d, 0)); fn_0x51cc9f(w, fx(c, w, d.this), u, H); return { r: null, u }; }),
  "0x542540": runE((c, d) => ({ r: fn_0x542540(fx(c, world(c), d.this)) }), AL),
  "0x51d175": runE((c, d) => { const w = world(c), u = U(c, A(d, 0)); fn_0x51d175(w, fx(c, w, d.this), u, H); return { r: null, u }; }),
  "0x51d337": runE((c, d) => { const w = world(c), u = U(c, A(d, 0)); fn_0x51d337(w, fx(c, w, d.this), u, H); return { r: null, u }; }),
  "0x51d436": runE((c, d) => { const w = world(c), u = U(c, A(d, 0)); fn_0x51d436(w, fx(c, w, d.this), u, A(d, 1) | 0, H); return { r: null, u }; }),
  "0x5118be": runE((c, d) => { const u = U(c, d.this); fn_0x5118be(u); return { r: null, u }; }),
  "0x51366b": runE((c, d) => { const u = U(c, d.this); unitRecompute(world(c), u); return { r: null, u }; }),
};

runPairs("exe_effects", CHECKS, HOOKED, "EXE_EFFECTS_ONLY");
