/**
 * Porta literal do servidor do allods2.exe: as tarefas por unidade do pensamento de 1×/s (comando 0 do grupo: 0x5700f3 → 0x56fe34)
 * (etapa 9, lote 3; notes/pensamento.md). Portadas (ordem de chamada):
 *  - 0x56fe34 → 0x5692d5 (dono humano +0x2c == 0 → AI_TaskDispatcher; IA → 0x569308 → AI_TaskDispatcher).
 *  - AI_TaskDispatcher 0x569321 (thiscall; `switch` na classe da tarefa unidade+0x50): antes, o alvo consumado (+0x54 == 0x10) das
 *    classes 3 (IA+0xc) e 8/0x11 (IA+0x10) e a chegada da classe 1 (fim do caminho dinâmico andar+0x90 com andar+0x76 = a célula) → parar
 *    0x56dbc6; 0 → ação +0x54 = 0; 1 → AI_MoveTo(IA+0xa); 3 → AI_Task_Attack(IA+0xc); 0xa → AI_Task_Patrol; 0xb → 0x569cc9 → AI_Task_Guard;
 *    0xc → AI_Task_StandGround; 0xd → AI_CastAtTarget(IA+0x28, IA+0x30); 0xe → AI_TeleportCast(IA+0x3c, IA+0x30); 0x16 → AI_FleeAction;
 *    0x1b → ação 0x1b; qualquer outra → ação 0 e AI_Idle 0 (Stand ground); 2 0x56c8da, 4 0x569638, 8 0x5696e8, 0xf 0x56af23, 0x11
 *    0x569857, 0x18 0x56f492, 0x19 0x56f71a, 0x1a 0x56a909: exec 0 no corpus, NotPorted.
 *  - AI_Task_StandGround 0x56a1fb (tarefa 0xc): 0x569fd4 (visão da unidade recomputada (0x553681, Vision_UnitMap); a célula de quem
 *    bateu num membro de IA, IA+0x58, conta como vista por 20 pensamentos (IA+0x5a); candidatos mundo+0xa68 = as unidades de [0x68d2dc]
 *    em células vistas, inimigas (AI_EnemyFilter), de pé (0x567ddf põe as caídas em +0xa88); sem nenhuma de pé, as caídas); o alvo = o
 *    inimigo a menor AI_UnitDistance (voador conta +1 para quem não voa) ≤ alcance (AI_AttackRange), desempate pelo ângulo
 *    (AI_AngleTiebreak ≤ do anterior); sem alvo, o mesmo entre as caídas; com alvo 0x56c840 (dono humano com livro: AI_CastChosenSpell
 *    0x56b059, gancho; senão IA+8 = 6, IA+0xc = alvo, IA+0x14 = alcance), senão AI_IdleAlt; no centro da célula fora de andar+0x80 →
 *    0x55be86(0, 1).
 *  - AI_Task_Guard 0x56a5fc (tarefa 0xb): posto IA+0 (0 → a célula); longe do posto (Chebyshev ≥ visão +0xa5) → AI_MoveTo(posto);
 *    AI_EnemiesAroundPost: o 1.º inimigo nos anéis em volta do posto → AI_Task_Attack; nenhum: no posto → AI_Idle 0, senão AI_MoveTo.
 *  - AI_Task_Patrol 0x569b62 (tarefa 0xa): IA+8 = 0; IA+4 ≠ 0 → posto = a célula e IA+4 = 0; AI_Task_Guard; se ficou sem tarefa
 *    (IA+8 = 0 ou 0xb): IA+4 = 1 e, na célula do ponto IA+2, o ponto seguinte da lista IA+0xb4 (Find 0x57b020, GetNext 0x55f1f0, GetHead
 *    0x55f0d0 no fim); AI_MoveTo(ponto).
 * Ficam em gancho (8b): AI_CastChosenSpell 0x56b059 (`castChosenSpell`), AI_Autocast 0x56bc7b, AI_CasterOffensiveSpell 0x57a769.
 */
import { aiAngleTiebreak, aiEnemyFilter, fn_0x53a5a0, fn_0x567ddf, fn_0x56dbc6 } from "./action";
import { CListPtrIter, CListWord, type ListPos } from "./mfc";
import { bookSpellAt } from "./orders";
import {
  aiCastAtTarget, aiEnemiesAroundPost, aiFleeAction, aiIdle, aiIdleAlt, aiMoveTo, aiTargetCost, aiTaskAttack, aiTeleportCast, type ThinkHooks,
} from "./think";
import { MAP_VISION_OFF, VIS_SEEN_OFF, type UnitRec, type WorldRec } from "./types";
import { fn_0x553681, visionUnitMap } from "./vision";
import { fn_0x55f330, gridChebyshevDist, mapObjCellOf, mapObjSubCellCenter } from "./walk";
import { aiUnitDistance, fn_0x52b22a, fn_0x5568e4, NotPorted } from "./walk_action";
import { aiAttackRange, fn_0x55be86 } from "./wave";
import { mapObjCellX, mapObjCellY } from "./path";

const i16 = (v: number): number => (v << 16) >> 16;
const i8 = (v: number): number => (v << 24) >> 24;

/** 0x56fe34 (thiscall; mundo, unidade; comando 0 do grupo): → 0x5692d5. Antes, o gancho `legacyThink` (não é do exe): a unidade num
 *  modo cujo tratador tem exec 0 no corpus (defend/follow/still) pensa no motor antigo e não entra no despachante. */
export function fn_0x56fe34(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  if (h.legacyThink?.(wd, param_1)) return;
  fn_0x5692d5(wd, param_1, h);
}

/** 0x5692d5 (thiscall): dono humano ([+0x14]+0x2c == 0) → AI_TaskDispatcher; jogador de IA → 0x569308. */
export function fn_0x5692d5(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  if ((param_1.owner.f2c >>> 0) === 0) aiTaskDispatcher(wd, param_1, h);
  else fn_0x569308(wd, param_1, h);
}

/** 0x569308 (thiscall): → AI_TaskDispatcher. */
export function fn_0x569308(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  aiTaskDispatcher(wd, param_1, h);
}

/** 0x569321 AI_TaskDispatcher (thiscall; mundo, unidade): ver o cabeçalho. */
export function aiTaskDispatcher(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  const ai = param_1.ai, w = param_1.walk;
  if ((param_1.task >>> 0) === 3 && (ai.f0c >>> 0) !== 0 && (wd.map.unitAt(ai.f0c).act >>> 0) === 0x10) fn_0x56dbc6(wd, param_1);
  if (((param_1.task >>> 0) === 8 || (param_1.task >>> 0) === 0x11) && (wd.map.unitAt(ai.f10).act >>> 0) === 0x10) fn_0x56dbc6(wd, param_1);
  if ((param_1.task >>> 0) === 1 && (w.f90 >>> 0) !== 0) {
    const sVar1 = i16(w.f76), sVar2 = i16(mapObjCellOf(param_1.mapObj));
    if (sVar1 === sVar2) fn_0x56dbc6(wd, param_1);
  }
  switch (param_1.task >>> 0) {
    case 0: param_1.act = 0; break;
    case 1: aiMoveTo(param_1, ai.f0a & 0xffff); break;
    case 2: throw new NotPorted("0x56c8da");
    case 3: aiTaskAttack(wd, param_1, wd.map.unitAt(ai.f0c), h); break;
    case 4: throw new NotPorted("0x569638");
    case 8: throw new NotPorted("0x5696e8");
    case 0xa: aiTaskPatrol(wd, param_1, h); break;
    case 0xb: fn_0x569cc9(wd, param_1, h); break;
    case 0xc: aiTaskStandGround(wd, param_1, h); break;
    case 0xd: aiCastAtTarget(wd, param_1, (ai.f28 >>> 0) === 0 ? null : wd.map.unitAt(ai.f28), bookSpellAt(wd, ai.f30), h); break;
    case 0xe: aiTeleportCast(wd, param_1, ai.f3c & 0xffff, bookSpellAt(wd, ai.f30), h); break;
    case 0xf: throw new NotPorted("0x56af23");
    case 0x11: throw new NotPorted("0x569857");
    case 0x16: aiFleeAction(wd, param_1, h); break;
    case 0x18: throw new NotPorted("0x56f492");
    case 0x19: throw new NotPorted("0x56f71a");
    case 0x1a: throw new NotPorted("0x56a909");
    case 0x1b: param_1.act = 0x1b; break;
    default: param_1.act = 0; aiIdle(wd, param_1, 0, h); break;
  }
}

/** 0x569cc9 (thiscall; tarefa 0xb): → AI_Task_Guard. */
export function fn_0x569cc9(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  aiTaskGuard(wd, param_1, h);
}

/** 0x569fd4 (thiscall; mundo, unidade): os candidatos a alvo do Stand ground (ver o cabeçalho). */
export function fn_0x569fd4(wd: WorldRec, param_1: UnitRec): void {
  const m = wd.map, mem = m.mem, ai = param_1.ai;
  fn_0x553681(m);
  const uVar1 = mapObjCellOf(param_1.mapObj) & 0xffff;
  visionUnitMap(m, param_1, uVar1);
  if ((param_1.owner.f2c >>> 0) !== 0 && i16(ai.f58) !== 0) {
    const a = MAP_VISION_OFF + VIS_SEEN_OFF + (ai.f58 & 0xffff);
    mem[a] = (mem[a]! + 1) & 0xff;
    ai.f5a = (ai.f5a + 1) & 0xff;
    if (0x14 < i8(ai.f5a)) ai.f58 = 0;
  }
  const local_10 = new CListPtrIter();
  wd.cand.removeAll();
  let local_14 = local_10.first(wd.liveUnits);
  while (local_14 !== 0) {
    const uVar2 = mapObjCellOf(wd.map.unitAt(local_14).mapObj) & 0xffff;
    if (mem[MAP_VISION_OFF + VIS_SEEN_OFF + uVar2] !== 0) fn_0x52b22a(wd.cand, local_14);
    local_14 = local_10.next();
  }
  aiEnemyFilter(wd, param_1, wd.cand, 0);
  fn_0x567ddf(wd);
  if (wd.cand.getCount() === 0) {
    if (wd.dead.getCount() !== 0) {
      wd.cand.removeAll();
      local_14 = local_10.first(wd.dead);
      while (local_14 !== 0) {
        fn_0x52b22a(wd.cand, local_14);
        local_14 = local_10.next();
      }
      wd.dead.removeAll();
    }
  }
}

/** 0x56c840 (thiscall; mundo, unidade, alvo): sem livro, ou dono de IA, ou AI_CastChosenSpell (gancho) sem lançar → IA+8 = 6,
 *  IA+0xc = alvo, IA+0x14 = alcance. */
export function fn_0x56c840(wd: WorldRec, param_1: UnitRec, param_2: UnitRec, h: ThinkHooks): void {
  const bVar1 = fn_0x53a5a0(param_1) & 0xff;
  let cast = 0;
  if (bVar1 !== 0 && (param_1.owner.f2c >>> 0) === 0) {
    if (!h.castChosenSpell) throw new NotPorted("0x56b059");
    cast = h.castChosenSpell(wd, param_1, param_2);
  }
  if (bVar1 === 0 || (param_1.owner.f2c >>> 0) !== 0 || cast === 0) {
    param_1.ai.task = 6;
    param_1.ai.f0c = param_2.addr >>> 0;
    param_1.ai.range = aiAttackRange(param_1) & 0xff;
  }
}

/** 0x56a1fb AI_Task_StandGround (thiscall; mundo, unidade): ver o cabeçalho. */
export function aiTaskStandGround(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  let local_8 = 0xff;
  const cVar2 = aiAttackRange(param_1);
  let local_20 = (cVar2 + 1) & 0xff;
  const local_18 = new CListPtrIter();
  fn_0x569fd4(wd, param_1);
  let local_30: UnitRec | null = null;
  let iVar5 = wd.cand.getCount();
  if (iVar5 !== 0) {
    let local_c = local_18.first(wd.cand);
    while (local_c !== 0) {
      const t = wd.map.unitAt(local_c);
      iVar5 = aiTargetCost(wd, param_1, t);
      if (iVar5 === 0xffffff) {
        local_c = local_18.next();
      } else {
        const uVar6 = aiUnitDistance(wd.map, param_1, t) >>> 0;
        let local_1c = uVar6 & 0xff;
        if (fn_0x55f330(t) === 3) {
          if (fn_0x55f330(param_1) !== 3) local_1c = ((uVar6 & 0xff) + 1) & 0xff;
        }
        const uVar7 = fn_0x5568e4(param_1, t);
        const uVar6b = aiAngleTiebreak(uVar7 & 0xff, param_1.walk.dir & 0xff);
        if (local_1c < local_20) {
          local_30 = t;
          local_8 = uVar6b & 0xff;
          local_20 = local_1c;
        } else if (local_1c === local_20) {
          const bVar3 = aiAttackRange(param_1) & 0xff;
          if (local_1c <= bVar3 && (uVar6b & 0xff) <= local_8) {
            local_30 = t;
            local_8 = uVar6b & 0xff;
          }
        }
        local_c = local_18.next();
      }
    }
  }
  let bVar3 = aiAttackRange(param_1) & 0xff;
  if (bVar3 < local_20) local_30 = null;
  if (local_30 === null) {
    iVar5 = wd.dead.getCount();
    if (iVar5 !== 0) {
      local_30 = null;
      local_8 = 0xff;
      local_20 = (aiAttackRange(param_1) + 1) & 0xff;
      let local_c = local_18.first(wd.dead);
      while (local_c !== 0) {
        const t = wd.map.unitAt(local_c);
        const uVar6 = aiUnitDistance(wd.map, param_1, t) >>> 0;
        const uVar7 = fn_0x5568e4(param_1, t);
        const uVar8 = aiAngleTiebreak(uVar7 & 0xff, param_1.walk.dir & 0xff);
        if ((uVar6 & 0xff) < local_20) {
          local_30 = t;
          local_8 = uVar8 & 0xff;
          local_20 = uVar6 & 0xff;
        } else if ((uVar6 & 0xff) === local_20) {
          bVar3 = aiAttackRange(param_1) & 0xff;
          if ((uVar6 & 0xff) <= bVar3 && (uVar8 & 0xff) <= local_8) {
            local_30 = t;
            local_8 = uVar8 & 0xff;
          }
        }
        local_c = local_18.next();
      }
    }
  }
  bVar3 = aiAttackRange(param_1) & 0xff;
  if (bVar3 < local_20) local_30 = null;
  if (local_30 === null) aiIdleAlt(wd, param_1, h);
  else fn_0x56c840(wd, param_1, local_30, h);
  iVar5 = mapObjSubCellCenter(param_1.mapObj);
  if (iVar5 !== 0 && i16(param_1.walk.footCell) !== 0) {
    const sVar1 = i16(param_1.walk.footCell);
    const sVar4 = i16(mapObjCellOf(param_1.mapObj));
    if (sVar1 !== sVar4) fn_0x55be86(wd.map, param_1, 0, 1);
  }
}

/** 0x56a5fc AI_Task_Guard (thiscall; mundo, unidade): ver o cabeçalho. */
export function aiTaskGuard(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  const ai = param_1.ai;
  if (i16(ai.f00) === 0) ai.f00 = mapObjCellOf(param_1.mapObj) & 0xffff;
  const uVar9 = (ai.f00 & 0xffff) >> 8;
  const uVar10 = ai.f00 & 0xff;
  const uVar5 = mapObjCellY(param_1.mapObj) & 0xff;
  const uVar1 = mapObjCellX(param_1.mapObj) & 0xff;
  const bVar2 = gridChebyshevDist(uVar1, uVar5, uVar10, uVar9) & 0xff;
  if ((param_1.fa5 & 0xff) <= bVar2) aiMoveTo(param_1, ai.f00 & 0xffff);
  const iVar6 = aiEnemiesAroundPost(wd, param_1, ai.f00 & 0xffff);
  const iVar7 = iVar6.getCount();
  if (iVar7 === 0) {
    const sVar4 = i16(mapObjCellOf(param_1.mapObj));
    if (sVar4 === i16(ai.f00)) aiIdle(wd, param_1, 0, h);
    else aiMoveTo(param_1, ai.f00 & 0xffff);
  } else {
    aiTaskAttack(wd, param_1, wd.map.unitAt(iVar6.first()), h);
  }
}

/** 0x569b62 AI_Task_Patrol (thiscall; mundo, unidade): ver o cabeçalho. */
export function aiTaskPatrol(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  const ai = param_1.ai;
  ai.task = 0;
  if ((ai.f04 >>> 0) !== 0) {
    ai.f00 = mapObjCellOf(param_1.mapObj) & 0xffff;
    ai.f04 = 0;
  }
  aiTaskGuard(wd, param_1, h);
  if ((ai.task & 0xff) === 0 || (ai.task & 0xff) === 0xb) {
    ai.f04 = 1;
    let local_8 = ai.f02 & 0xffff;
    const uVar2 = mapObjCellOf(param_1.mapObj) & 0xffff;
    if (uVar2 === local_8) {
      const local_c: ListPos = { p: ai.patrol.find(local_8, null) };
      local_8 = CListWord.getNext(local_c);
      if (local_c.p === null) local_8 = ai.patrol.getHead() & 0xffff;
      else local_8 = CListWord.getNext(local_c);
    }
    ai.f02 = local_8 & 0xffff;
    aiMoveTo(param_1, local_8 & 0xffff);
  }
}
