/**
 * Porta literal do servidor do allods2.exe: o despachante de ações da unidade (etapa 6). Chamado uma vez por tique por unidade
 * (Unit_ActionMachine 0x50f12c → 0x56dca2): com IA+9 ≠ 0 continua a sub-ação em curso (3 = o passo do andar, 0x555b38); com
 * IA+9 == 0 executa a tarefa IA+8 (1 andar 0x56e4ac, 4 perseguir 0x56ea52, 10 girar 0x56e55d...). No fim, se o caminho
 * dinâmico ficou vazio indo ao fim do estático (andar+0x98, 0x555dc2), trata a tarefa da unidade (+0x50).
 *
 * Portadas: 0x56dca2 Unit_ActionDispatcher, 0x56ea52 (tarefa 4: perseguir), 0x56e55d Unit_Turn, 0x56e5bc Unit_LookAround (tarefa 0xb:
 * olhar em volta, sorteios 0x56e629/0x56e656 pelo `WorldRec.rng`).
 * Chamados não portados (IA, magia, visão; outra etapa): lançam NotPorted, salvo quando o chamador passa um adaptador em
 * `DispatchHooks` (World: comportamento do motor antigo para esses pedaços, ver o cabeçalho de sim/world.ts).
 */
import { gridChebyshevDist, mapObjSubCellCenter } from "./walk";
import { mapObjCellX, mapObjCellY } from "./path";
import { NotPorted, pathClearDynamic, unitActionChase, unitTeleportTo, unitTurnStep, unitWalkNear } from "./walk_action";
import { fn_0x57afd0, randUniformObject } from "./rand";
import type { UnitRec, WorldRec } from "./types";

/** Adaptadores para chamados de 0x56dca2 ainda não portados (sem adaptador: NotPorted). */
export interface DispatchHooks {
  /** 0x56dc24 (fim do caminho com a tarefa +0x50 == 1): 0x56d969 + Vision_UpdateManager. */
  f56dc24?(u: UnitRec): void;
  /** Tarefa +0x50 == 0xa (patrulha) a menos de 3 células do ponto IA+2: IA+2 ← ponto seguinte da lista IA+0xb4 (0x57b020 Find,
   *  0x55f1f0 GetNext; no fim, 0x55f0d0 GetHead). */
  patrolNext?(u: UnitRec): void;
  /** 0x56ed4e (fim do caminho nas demais tarefas): alvo ao alcance → tarefa 6 (0x56eff3), senão 0xb (0x56e5bc) ou 0. */
  f56ed4e?(u: UnitRec): void;
  /** Tarefa IA+8 sem porta (2, 5..9, 0xc, 0xf): o adaptador a executa e devolve true; false → NotPorted. */
  task?(u: UnitRec): boolean;
}

/**
 * 0x56e5bc Unit_LookAround (thiscall; `this` = mundo): olhar em volta da unidade ociosa (tarefa IA+8 = 0xb). Já virada para o rumo
 * desejado: sem golpe recebido (IA+0x54 = 0) e rand() > 204 → ação 0; senão rumo desejado = rumo + 33 + rand()×190/32768 (byte),
 * IA+0x54 = 0, um passo de giro (0x556454) e ação 1. Ainda girando: um passo de giro e ação 1.
 */
export function unitLookAround(wd: WorldRec, u: UnitRec): void {
  const w = u.walk;
  if ((w.dir & 0xff) === (w.dirTarget & 0xff)) {
    if ((u.ai.f54 | 0) === 0 && 0xcc < randUniformObject(wd, 0x56e629)) {
      u.act = 0;
      return;
    }
    const cVar1 = w.dir & 0xff;
    const iVar2 = fn_0x57afd0(wd, 0xbe, 0x56e656);
    w.dirTarget = (cVar1 + 0x21 + iVar2) & 0xff;
    u.ai.f54 = 0;
    unitTurnStep(u, w.dirTarget & 0xff);
    u.act = 1;
  } else {
    unitTurnStep(u, w.dirTarget & 0xff);
    u.act = 1;
  }
}

/** 0x56e55d Unit_Turn (cdecl): já na direção `d` → tarefa 0 e ação 0; senão um passo de giro (0x556454) e ação 1. */
export function unitTurn(u: UnitRec, d: number): void {
  if ((u.walk.dir & 0xff) === (d & 0xff)) {
    u.ai.task = 0;
    u.act = 0;
  } else {
    unitTurnStep(u, d & 0xff);
    u.act = 1;
  }
}

/**
 * 0x56ea52 (fastcall; ECX = mundo, 4º argumento = IA+0x18): perseguir a unidade IA+0x18 até o alcance IA+0x14 (0x55574d); fora
 * do centro da célula, IA+9 = 3 e IA+0x15 = 0; ação 1.
 */
export function fn_0x56ea52(wd: WorldRec, u: UnitRec, target: number): void {
  unitActionChase(wd.map, u, wd.map.unitAt(target), u.ai.range & 0xff);
  if (mapObjSubCellCenter(u.mapObj) === 0) {
    u.ai.sub = 3;
    u.ai.f15 = 0;
  }
  u.act = 1;
}

/**
 * 0x56dca2 Unit_ActionDispatcher (thiscall; `this` = mundo). Grupo dormindo (mundo+0xbbe8 = 0, tipo+0x45 = 0, IA+9 = 0): ação
 * 0x1b. Senão a ação volta a 0 (salvo 2 e 0xf), o efeito 0x40000 força IA+9 = 4, e: IA+9 == 0 → teleporte pendente (IA+0xb0) e a
 * tarefa IA+8; IA+9 ≠ 0 → a sub-ação (1 golpe, 2 magia, 3 passo, 4 efeito, 0xff parado). Por fim o caminho dinâmico vazio no fim
 * (andar+0x98) decide pela tarefa +0x50.
 */
export function unitActionDispatcher(wd: WorldRec, u: UnitRec, hooks: DispatchHooks = {}): void {
  const ai = u.ai;
  if ((wd.fbbe8 | 0) === 0 && (u.type.stats.f45 & 0xff) === 0 && (ai.sub & 0xff) === 0) {
    u.act = 0x1b;
    return;
  }
  mapObjCellX(u.mapObj); // local_8 (sem uso)
  mapObjCellY(u.mapObj); // local_c (sem uso)
  if (u.act !== 2 && u.act !== 0xf) u.act = 0;
  if ((u.effects | 0) !== 0 && (u.effects & 0x40000) !== 0 && (ai.sub & 0xff) === 0) ai.sub = 4;
  if ((ai.sub & 0xff) === 0) {
    if ((ai.fb0 & 0xffff) !== 0 && mapObjSubCellCenter(u.mapObj) !== 0) {
      unitTeleportTo(wd.map, u, ai.fb0 & 0xff, (ai.fb0 & 0xffff) >> 8);
      ai.fb0 = 0;
    }
    switch (ai.task & 0xff) {
      case 1: unitWalkNear(wd, u, ai.f0a & 0xffff, 0); break;
      case 2: if (!hooks.task?.(u)) throw new NotPorted("0x56e8c3"); break;
      case 4: fn_0x56ea52(wd, u, ai.target >>> 0); break;
      case 5: if (!hooks.task?.(u)) throw new NotPorted("0x56eab5"); break;
      case 6: if (!hooks.task?.(u)) throw new NotPorted("0x56eff3"); break;
      case 7: if (!hooks.task?.(u)) throw new NotPorted("0x56ea24"); break;
      case 8: if (!hooks.task?.(u)) throw new NotPorted("0x56ebc0"); break;
      case 9: if (!hooks.task?.(u)) throw new NotPorted("0x56ec3f"); break;
      case 10: unitTurn(u, u.walk.dirTarget & 0xff); break;
      case 0xb: unitLookAround(wd, u); break;
      case 0xc: if (!hooks.task?.(u)) throw new NotPorted("0x56eb2d"); break;
      case 0xf: if (!hooks.task?.(u)) throw new NotPorted("0x56ecbc"); break;
    }
  } else {
    switch (ai.sub & 0xff) {
      case 1:
        u.act = 3;
        ai.f15 = (ai.f15 + 1) & 0xff;
        if (2 < (ai.f15 & 0xff) && (u.ready & 0xff) !== 0) {
          ai.sub = 0;
          u.act = 0;
        }
        break;
      case 2:
        // magia: ação 0xd/0xe, contador IA+0x15 e, no 3.º tique, o evento do servidor (0x57b210, campos do mundo +0xbd98..)
        throw new NotPorted("0x56dca2/IA+9=2 (0x57b210)");
      case 3: {
        pathClearDynamic(wd.map, u);
        u.act = 1;
        if (mapObjSubCellCenter(u.mapObj) !== 0) {
          ai.sub = 0;
          u.act = 0;
        }
        break;
      }
      case 4:
        u.act = 0x1b;
        if ((u.effects & 0x40000) === 0) ai.sub = 0;
        break;
      default:
        ai.sub = 0;
        u.act = 0x1b;
        break;
      case 0xff:
        u.act = 0x1b;
    }
  }
  if ((u.walk.f98 | 0) !== 0) {
    u.walk.f98 = 0;
    if ((u.task | 0) === 1) {
      if (!hooks.f56dc24) throw new NotPorted("0x56dc24");
      hooks.f56dc24(u);
    } else if ((u.task | 0) === 0xa) {
      ai.f04 = 1;
      ai.task = 0;
      const uVar6 = (ai.f02 & 0xffff) >> 8;
      const uVar7 = ai.f02 & 0xff;
      const y = mapObjCellY(u.mapObj);
      const x = mapObjCellX(u.mapObj);
      if (gridChebyshevDist(x, y, uVar7, uVar6) < 3) {
        if (!hooks.patrolNext) throw new NotPorted("0x57b020");
        hooks.patrolNext(u);
      }
    } else if ((u.task | 0) === 0x18) {
      ai.sub = 0xff;
    } else {
      ai.task = 0;
      if (!hooks.f56ed4e) throw new NotPorted("0x56ed4e");
      hooks.f56ed4e(u);
    }
  }
}

