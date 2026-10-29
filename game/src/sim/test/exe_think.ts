/**
 * Prova da porta sim/exe/think.ts (etapa 9, lote 2: o pensamento de 1×/s 0x56fe4d → AI_PlayerThink → AI_GroupThink e as suas folhas;
 * os setores 0x55b5f1) e de sim/exe/vision.ts (Vision_Compute 0x552c28) contra os pares do oráculo (tools/re/oracle/fnprobe.py), com o
 * arnês de exe_recon.ts (igualdade exata em 100 % das chamadas: sorteios, unidades, grupos, jogadores, mundo, mapa (visão, setores)).
 * Chamadas que caem num gancho (magia 8b: 0x57a769, exec 0) ou
 * num ramo com exec 0 (NotPorted em endereço de `HOOKED`) contam à parte. Rodar em game/:
 *   npx tsx src/sim/test/exe_think.ts            (EXE_THINK_ONLY=0x5728fa,... para só algumas)
 */
import {
  aiAlliesScan, aiAutocast, aiAutocastTargetsMask, aiCastAtTarget, aiCastChosenSpell, fn_0x567c56, fn_0x56bc2e, fn_0x571e9b, fn_0x57b0e0, aiCasterShield, aiEnemiesAroundPost, aiFilterByGroupRadius, aiIdleCasterSupport, aiFleeAction, aiFleePoint, aiGroupAssignTargets, aiGroupCentroid, aiGroupFlee, aiGroupMaxScanRange,
  aiGroupThink, aiGroupVisibleEnemies, aiGuardEnterCombat, aiIdle, aiIdleAlt, aiMoveTo, aiPlayerThink, aiTargetCost, aiTaskAttack, aiWimpy,
  aiWimpyOrWithdraw, aiWithdraw, fn_0x55aca2, fn_0x55b406, fn_0x55b507, fn_0x55b5f1, fn_0x55b879, fn_0x56b025, fn_0x56fe4d, fn_0x5713f8,
  fn_0x5725a8, fn_0x5728fa, fn_0x57309d, fn_0x573159, fn_0x573198, fn_0x57375a, gridFineCoordCentroid, type ThinkHooks,
} from "../exe/think";
import { fn_0x553681, visionCompute } from "../exe/vision";
import { randRange } from "../exe/rand";
import { MAP_VISION_OFF, MAP_WAKE_OFF } from "../exe/types";
import {
  A, AL, AX, EAX, M, U, groupFrom, playerFrom, ptrListFrom, run, runS, runPairs, spellFrom, worldRec, type Check, type Ctx,
} from "./exe_recon";

const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
/** NotPorted esperado: ganchos (8b) e ramos com exec 0. */
const HOOKED = new Set(["0x57a769", "0x56a981", "0x56cb8c", "0x56ce0f"]);
const H: ThinkHooks = {};

/** O mundo: `this` = [0x66832c] (ou o endereço dado); o mapa de [0x670e48] ou mundo+0xa50. */
function world(c: Ctx, w?: number) {
  const wa = w ?? c.cm.u32(WORLD_PTR);
  const m = M(c, c.cm.has(MAP_PTR) ? c.cm.u32(MAP_PTR) : c.cm.u32(wa + 0xa50));
  return worldRec(c, wa, m);
}
/** Mundo a partir de um objeto dentro do mapa (`this` = mapa + off). */
function worldFromMapObj(c: Ctx, thisAddr: number, off: number) {
  const m = M(c, thisAddr - off);
  return worldRec(c, c.cm.has(WORLD_PTR) ? c.cm.u32(WORLD_PTR) : 0, m);
}
const G = (c: Ctx, _w: ReturnType<typeof world>, a: number) => groupFrom(c.cm, a);

const CHECKS: Record<string, Check> = {
  // magos do jogador humano (etapa 8b, lote 1)
  "0x56bc7b": run((c, d) => { const w = world(c, d.this); aiAutocast(w, U(c, A(d, 0)), H); return null; }),
  "0x56b059": run((c, d) => { const w = world(c, d.this); return aiCastChosenSpell(w, U(c, A(d, 0)), U(c, A(d, 1)), H); }, EAX),
  "0x56bb53": run((c, d) => { const w = world(c, d.this); return aiAutocastTargetsMask(w, U(c, A(d, 0)), U(c, A(d, 1))); }, EAX),
  "0x56bc2e": run((c, d) => { world(c); return fn_0x56bc2e(U(c, A(d, 0)), U(c, A(d, 1)), spellFrom(c.cm, A(d, 2))) ? 1 : 0; }, AL),
  "0x567c56": run((c, d) => { const w = world(c, d.this); if (A(d, 1) !== d.this + 0xa64) throw new Error("0x567c56: lista fora do mundo"); fn_0x567c56(w, U(c, A(d, 0)), w.cand); return null; }),
  "0x571e9b": run((c, d) => { const w = world(c, d.this); fn_0x571e9b(w, G(c, w, A(d, 0))); return null; }),
  "0x57b0e0": run((c, d) => { world(c); const l = ptrListFrom(c.cm, d.this); c.ptrList = l; c.ptrListAddr = d.this; fn_0x57b0e0(l, A(d, 0)); return null; }),
  "0x56fe4d": run((c, d) => { const w = world(c, d.this); fn_0x56fe4d(w, ptrListFrom(c.cm, A(d, 0)), H); return null; }),
  "0x570087": run((c, d) => { const w = world(c, d.this); const p = playerFrom(c.cm, A(d, 0)); for (const ga of p.groups.values()) groupFrom(c.cm, ga); aiPlayerThink(w, p, H); return null; }),
  "0x5700f3": run((c, d) => { const w = world(c, d.this); aiGroupThink(w, G(c, w, A(d, 0)), H); return null; }),
  "0x5728fa": run((c, d) => { const w = world(c, d.this); fn_0x5728fa(w, G(c, w, A(d, 0)), H); return null; }),
  "0x57240b": run((c, d) => { const w = world(c, d.this); aiGroupAssignTargets(w, G(c, w, A(d, 0))); return null; }),
  "0x571c4d": run((c, d) => { const w = world(c, d.this); aiGroupVisibleEnemies(w, G(c, w, A(d, 0))); return null; }),
  "0x5711ea": run((c, d) => { const w = world(c, d.this); return aiTargetCost(w, U(c, A(d, 0)), U(c, A(d, 1))); }, EAX),
  "0x5713f8": run((c, d) => { const w = world(c, d.this); return fn_0x5713f8(w, U(c, A(d, 0)), U(c, A(d, 1))); }, EAX),
  "0x5725a8": run((c, d) => { const w = world(c, d.this); fn_0x5725a8(w, G(c, w, A(d, 0))); return null; }),
  "0x57309d": run((c, d) => { const w = world(c, d.this); fn_0x57309d(w, G(c, w, A(d, 0)), H); return null; }),
  "0x573198": run((c, d) => { const w = world(c, d.this); fn_0x573198(w, G(c, w, A(d, 0)), (A(d, 1) << 16) >> 16, H); return null; }),
  "0x573159": run((c, d) => { const w = world(c, d.this); fn_0x573159(w, G(c, w, A(d, 0)), H); return null; }),
  "0x57375a": run((c, d) => { const w = world(c); fn_0x57375a(G(c, w, A(d, 0))); return null; }),
  "0x57377d": run((c, d) => { const w = world(c, d.this); aiGroupFlee(w, G(c, w, A(d, 0)), H); return null; }),
  "0x573713": run((c, d) => { const w = world(c, d.this); aiWimpyOrWithdraw(w, U(c, A(d, 0)), H); return null; }),
  "0x56cb0c": run((c, d) => { const w = world(c, d.this); return aiWimpy(w, U(c, A(d, 0))); }, EAX),
  "0x56cd11": run((c, d) => { const w = world(c, d.this); return aiWithdraw(w, U(c, A(d, 0))); }, EAX),
  "0x56c9bc": run((c, d) => { const w = world(c, d.this); aiFleeAction(w, U(c, A(d, 0)), H); return null; }),
  "0x56f765": run((c, d) => { const w = world(c); return aiFleePoint(w.map, ptrListFrom(c.cm, A(d, 0) + 4)); }, EAX),
  "0x558b92": run((c, d) => { const m = M(c, d.this); worldRec(c, c.cm.has(WORLD_PTR) ? c.cm.u32(WORLD_PTR) : 0, m); return gridFineCoordCentroid(m, U(c, A(d, 0)), A(d, 1) >>> 0, A(d, 2)); }, AX),
  "0x56acc8": run((c, d) => { const w = world(c, d.this); aiTaskAttack(w, U(c, A(d, 0)), U(c, A(d, 1)), H); return null; }),
  "0x56afac": run((c, d) => { const w = world(c, d.this); aiIdle(w, U(c, A(d, 0)), A(d, 1), H); return null; }),
  "0x56afd9": run((c, d) => { const w = world(c, d.this); aiIdleAlt(w, U(c, A(d, 0)), H); return null; }),
  "0x56b025": run((c, d) => { const w = world(c, d.this); fn_0x56b025(w, U(c, A(d, 0)), H); return null; }),
  "0x56c8af": run((c, d) => { world(c); aiMoveTo(U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x56c592": run((c, d) => { const w = world(c, d.this); aiIdleCasterSupport(w, U(c, A(d, 0)), H); return null; }),
  "0x57a999": run((c, d) => { const w = world(c, d.this); const l = ptrListFrom(c.cm, A(d, 1) + 4); c.ptrList = l; c.ptrListAddr = A(d, 1) + 4; return aiCasterShield(w, U(c, A(d, 0)), l, H); }, EAX),
  "0x567b2d": run((c, d) => { const w = world(c, d.this); const l = ptrListFrom(c.cm, A(d, 1) + 4); c.ptrList = l; c.ptrListAddr = A(d, 1) + 4; aiAlliesScan(w, U(c, A(d, 0)), l); return null; }),
  "0x56c72b": run((c, d) => { const w = world(c, d.this); aiCastAtTarget(w, U(c, A(d, 0)), A(d, 1) === 0 ? null : U(c, A(d, 1)), spellFrom(c.cm, A(d, 2)), H); return null; }),
  "0x567e92": run((c, d) => { const w = world(c, d.this); aiFilterByGroupRadius(w, A(d, 0), A(d, 1)); return null; }),
  "0x56fa63": run((c, d) => { const w = world(c); aiGroupCentroid(w, G(c, w, A(d, 0))); return null; }),
  "0x56f850": run((c, d) => { const w = world(c); aiGroupMaxScanRange(w, G(c, w, A(d, 0))); return null; }),
  "0x5726f7": run((c, d) => { const w = world(c, d.this); aiGuardEnterCombat(w, G(c, w, A(d, 0))); return null; }),
  "0x57aff0": run((c, d) => { const w = world(c, d.this); return randRange(w, A(d, 0), A(d, 1), 0x57aff0); }, EAX),
  "0x552c28": run((c, d) => { const w = worldFromMapObj(c, d.this, MAP_VISION_OFF); visionCompute(w.map, U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x553681": run((c, d) => { const w = worldFromMapObj(c, d.this, MAP_VISION_OFF); fn_0x553681(w.map); return null; }),
  "0x567988": run((c, d) => { const w = world(c, d.this); const l = aiEnemiesAroundPost(w, U(c, A(d, 0)), A(d, 1)); c.ptrList = l; c.ptrListAddr = d.eax + 4; return null; }),
  "0x55b5f1": runS((c, d) => { const w = worldFromMapObj(c, d.this, MAP_WAKE_OFF); fn_0x55b5f1(w); return null; }),
  "0x55b879": run((c, d) => { const w = worldFromMapObj(c, d.this, MAP_WAKE_OFF); fn_0x55b879(w); return null; }),
  "0x55aca2": run((c, d) => { const w = worldFromMapObj(c, d.this, MAP_WAKE_OFF); fn_0x55aca2(w, U(c, A(d, 0))); return null; }),
  "0x55b406": run((c, d) => { const w = worldFromMapObj(c, d.this, MAP_WAKE_OFF); fn_0x55b406(w, U(c, A(d, 0))); return null; }),
  "0x55b507": runS((c, d) => { const w = worldFromMapObj(c, d.this, MAP_WAKE_OFF); fn_0x55b507(w, w.spellObjAt(A(d, 0))); return null; }),
};
void AL;

runPairs("exe_think", CHECKS, HOOKED, "EXE_THINK_ONLY");
