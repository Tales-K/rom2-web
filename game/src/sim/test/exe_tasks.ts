/**
 * Prova da porta sim/exe/tasks.ts (etapa 9, lote 3: as tarefas por unidade do pensamento — 0x56fe34 → 0x5692d5 → AI_TaskDispatcher
 * 0x569321, AI_Task_StandGround 0x56a1fb com 0x569fd4 e 0x56c840, AI_Task_Guard 0x56a5fc, AI_Task_Patrol 0x569b62) contra os pares do
 * oráculo (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts (igualdade exata em 100 % das chamadas). As chamadas que caem num
 * gancho da etapa 8b (AI_CastChosenSpell 0x56b059, AI_Autocast 0x56bc7b, AI_CasterOffensiveSpell 0x57a769) contam à parte. Rodar em game/:
 *   npx tsx src/sim/test/exe_tasks.ts            (EXE_TASKS_ONLY=0x56a1fb,... para só algumas)
 */
import { aiTaskDispatcher, aiTaskGuard, aiTaskPatrol, aiTaskStandGround, fn_0x5692d5, fn_0x569308, fn_0x569fd4, fn_0x56c840, fn_0x56fe34 } from "../exe/tasks";
import type { ThinkHooks } from "../exe/think";
import { A, M, U, run, runPairs, worldRec, type Check, type Ctx } from "./exe_recon";

const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
/** NotPorted esperado: ganchos (8b) e ramos com exec 0. */
const HOOKED = new Set(["0x56b059", "0x56bc7b", "0x57a769", "0x56a981", "0x56cb8c", "0x56ce0f"]);
const H: ThinkHooks = {};

/** O mundo: `this` = [0x66832c] (ou o endereço dado); o mapa de [0x670e48] ou mundo+0xa50. */
function world(c: Ctx, w?: number) {
  const wa = w ?? c.cm.u32(WORLD_PTR);
  const m = M(c, c.cm.has(MAP_PTR) ? c.cm.u32(MAP_PTR) : c.cm.u32(wa + 0xa50));
  return worldRec(c, wa, m);
}

const CHECKS: Record<string, Check> = {
  "0x56fe34": run((c, d) => { const w = world(c, d.this); fn_0x56fe34(w, U(c, A(d, 0)), H); return null; }),
  "0x5692d5": run((c, d) => { const w = world(c, d.this); fn_0x5692d5(w, U(c, A(d, 0)), H); return null; }),
  "0x569308": run((c, d) => { const w = world(c, d.this); fn_0x569308(w, U(c, A(d, 0)), H); return null; }),
  "0x569321": run((c, d) => { const w = world(c, d.this); aiTaskDispatcher(w, U(c, A(d, 0)), H); return null; }),
  "0x56a1fb": run((c, d) => { const w = world(c, d.this); aiTaskStandGround(w, U(c, A(d, 0)), H); return null; }),
  "0x569fd4": run((c, d) => { const w = world(c, d.this); fn_0x569fd4(w, U(c, A(d, 0))); return null; }),
  "0x56a5fc": run((c, d) => { const w = world(c, d.this); aiTaskGuard(w, U(c, A(d, 0)), H); return null; }),
  "0x569b62": run((c, d) => { const w = world(c, d.this); aiTaskPatrol(w, U(c, A(d, 0)), H); return null; }),
  "0x56c840": run((c, d) => { const w = world(c, d.this); fn_0x56c840(w, U(c, A(d, 0)), U(c, A(d, 1)), H); return null; }),
};

runPairs("exe_tasks", CHECKS, HOOKED, "EXE_TASKS_ONLY");
