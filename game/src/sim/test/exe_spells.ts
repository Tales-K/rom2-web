/**
 * Prova da porta sim/exe/spells.ts, etapa 8b lote 3 (a aplicação Spell_Apply 0x519db8 e os objetos de magia: Spell_Instance 0x5195b1,
 * Unit_AddHeal 0x510484, 0x543130, 0x5238c5, Spell_ProjectileDist 0x516aae, 0x54feae/0x54ff06, os construtores 0x51e505/0x543040/0x5178d4/
 * 0x518d1e, a lista do mundo 0x52c279 e os métodos 0x518efd/0x542d00/0x517949/0x51e65b; Spell_Release 0x519d7f) contra os pares do
 * oráculo (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts: retorno, sorteios, unidades tocadas, os objetos de magia (campos,
 * objeto de mapa, dano) e a lista [[0x6044c4]+0x7c]+4, e a magia do livro (+9/+0xe/+0xf/+0x10). Os `case` de Spell_Apply fora da
 * porta (gancho `spellApply`: NotPorted 0x519db8) contam à parte. Rodar em game/:
 *   npx tsx src/sim/test/exe_spells.ts            (EXE_SPELLS_ONLY=0x519db8,... para só algumas)
 */
import {
  fn_0x517949, fn_0x518d1e, fn_0x518efd, fn_0x51e65b, fn_0x52c279, fn_0x5238c5, fn_0x543130, fn_0x54feae, fn_0x54ff06, spellApply,
  spellAttachToTarget, spellDamageObject, spellFireDamageObj, spellInstance, spellProjectileDist, spellRelease, unitAddHeal,
} from "../exe/spells";
import type { CombatHooks } from "../exe/combat";
import { VT_DIRECT_DAMAGE, VT_POINT_EFFECT, VT_TRANSPORT, type BookSpellRec, type SpellObjRec, type WorldRec } from "../exe/types";
import {
  A, AL, EAX, M, U, checkFields, checkSpellWorld, ctx, done, eq, finView, itemFrom, mapObjFrom, packMapObj, payloadFrom, ptrListFrom, runPairs, runS, spellFrom, spellObjFrom,
  worldRec, type CallMem, type Check, type Ctx, type Field, type Pair, type Rec,
} from "./exe_recon";

/** Mapa/caminho do exe: [0x670e48]; mundo: [0x66832c]. */
const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
/** Experiência (0x513128/0x5131ef): motor antigo, escritas fora da conferência (exe_recon.ts checkUnit). */
const H: CombatHooks = { xpOnHit: () => { /* nada */ }, xpOnCast: () => { /* nada */ } };
/** NotPorted esperado: os `case` de Spell_Apply fora da porta (gancho `spellApply` do motor antigo). */
const HOOKED = new Set(["0x519db8", "0x51ce12"]);

/** Mundo com o mapa remontado (as unidades por endereço: quem lançou +0x44/+0x3c, o alvo +0x48). */
const world = (c: Ctx): WorldRec => worldRec(c, c.cm.u32(WORLD_PTR), M(c, c.cm.u32(MAP_PTR)));
const SPELL_FIELDS: Field[] = [[0x08, 1, "id"], [0x09, 1, "range"], [0x0a, 1, "f0a"], [0x0c, 2, "cost", true], [0x0e, 1, "f0e"], [0x0f, 1, "f0f"], [0x10, 2, "f10", true]];
/** `runS` + a magia do livro igual ao original. */
const runSp = (f: (c: Ctx, d: Pair, s: BookSpellRec) => number | null, ret?: (v: number) => number): Check => (d: Pair, cm: CallMem) => {
  const c = ctx(d, cm), s = spellFrom(cm, d.this);
  return done(c, f(c, d, s), ret) ?? checkSpellWorld(c) ?? checkFields(cm, s.addr, s as unknown as Rec, SPELL_FIELDS, "magia");
};
const T = (c: Ctx, a: number) => (a === 0 ? null : U(c, a));
/** o objeto `this` de um método chamado pelo despacho virtual (a vtable foi lida pelo chamador) */
function obj(c: Ctx, w: WorldRec, a: number, vt: number): SpellObjRec {
  const o = spellObjFrom(c.cm, a, vt);
  w.spellObjs.set(o.addr, o);
  return o;
}

const CHECKS: Record<string, Check> = {
  "0x543130": runS((c, d) => fn_0x543130(U(c, d.this)), AL),
  "0x5195b1": runSp((_c, d, s) => { spellInstance(s, d.args[0]! & 0xff); return null; }),
  "0x510484": runS((c, d) => { unitAddHeal(U(c, d.this), (A(d, 0) << 16) >> 16, H); return null; }),
  "0x5238c5": (d, cm) => {
    const c = ctx(d, cm), e = fn_0x5238c5(itemFrom(cm, d.this)!);
    return done(c, null) ?? eq("achou", e ? 1 : 0, d.eax ? 1 : 0) ?? (e ? eq("+0x42", e.f42, (cm.u16(d.eax + 0x42) << 16) >> 16) : null);
  },
  "0x516aae": runS((c, d) => spellProjectileDist(mapObjFrom(c.cm, A(d, 0)), mapObjFrom(c.cm, A(d, 1))), EAX),
  "0x54feae": (d, cm) => {
    const c = ctx(d, cm), o = mapObjFrom(cm, d.this), before = packMapObj(o);
    const r = fn_0x54feae(o, mapObjFrom(cm, A(d, 0)));
    return done(c, null) ?? cm.checkRecord(d.this, before, packMapObj(r)) ?? eq("retorno", d.this, d.eax >>> 0);
  },
  "0x54ff06": (d, cm) => {
    const c = ctx(d, cm), o = mapObjFrom(cm, d.this), before = packMapObj(o);
    fn_0x54ff06(o, mapObjFrom(cm, A(d, 0)));
    return done(c, null) ?? cm.checkRecord(d.this, before, packMapObj(o));
  },
  "0x51e505": runS((c, d) => { const w = world(c); return spellDamageObject(w).addr; }, (v) => v >>> 0),
  "0x543040": runS((c, d) => { const w = world(c); spellFireDamageObj(w.payloadAt(d.this), A(d, 0), A(d, 1)); return null; }),
  "0x5178d4": runS((c, d) => { const w = world(c); return spellAttachToTarget(w, w.payloadAt(A(d, 0)), U(c, A(d, 1))).addr; }, (v) => v >>> 0),
  "0x518d1e": runS((c, d) => { const w = world(c); return fn_0x518d1e(w, w.spellObjAt(A(d, 0)), mapObjFrom(c.cm, A(d, 1)), A(d, 2)).addr; }, (v) => v >>> 0),
  "0x518efd": runS((c, d) => { const w = world(c); fn_0x518efd(w, obj(c, w, d.this, VT_TRANSPORT)); return null; }),
  "0x542d00": runS((c, d) => { const w = world(c); fn_0x517949(w, obj(c, w, d.this, VT_POINT_EFFECT), H); return null; }),
  "0x517949": runS((c, d) => { const w = world(c); fn_0x517949(w, obj(c, w, d.this, VT_POINT_EFFECT), H); return null; }),
  "0x51e65b": runS((c, d) => {
    const w = world(c), p = payloadFrom(c.cm, d.this, VT_DIRECT_DAMAGE);
    w.payloads.set(p.addr, p);
    fn_0x51e65b(w, p, U(c, A(d, 0)), H);
    return null;
  }),
  "0x52c279": runS((c, d) => {
    // `this` = o contentor [[0x6044c4]+0x7c]+4 (lista em +4), passado pelo chamador
    const w = world(c);
    c.spellListAddr = d.this + 4;
    w.lists.spellObjs = ptrListFrom(c.cm, c.spellListAddr);
    fn_0x52c279(w, H);
    return null;
  }),
  "0x519db8": runSp((c, d, s) => { spellApply(world(c), s, U(c, A(d, 0)), T(c, A(d, 1)), A(d, 2) & 0xff, A(d, 3) & 0xff, H); return null; }),
  "0x519d7f": runSp((c, d, s) => { spellRelease(world(c), s, U(c, A(d, 0)), T(c, A(d, 1)), H); return null; }),
};
void finView;

runPairs("exe_spells", CHECKS, HOOKED, "EXE_SPELLS_ONLY");
