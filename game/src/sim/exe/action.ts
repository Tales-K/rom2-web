/**
 * Porta literal do servidor do allods2.exe: o despachante de ações da unidade (etapas 6 e 7). Chamado uma vez por tique por unidade
 * (Unit_ActionMachine 0x50f12c → 0x56dca2): com IA+9 ≠ 0 continua a sub-ação em curso (1 golpe, 2 magia, 3 = o passo do andar
 * 0x555b38, 4 efeito, 0xff parado); com IA+9 == 0 executa a tarefa IA+8 (1 andar 0x56e4ac, 2 golpe 0x56e8c3, 4 perseguir 0x56ea52,
 * 5 atacar 0x56eab5, 6 0x56eff3, 8 magia na unidade 0x56ebc0, 10 girar 0x56e55d, 0xb olhar em volta 0x56e5bc). No fim, se o
 * caminho dinâmico ficou vazio indo ao fim do estático (andar+0x98, 0x555dc2), trata a tarefa da unidade (+0x50).
 *
 * Portadas: 0x56dca2 Unit_ActionDispatcher, 0x56ea52 (tarefa 4: perseguir), 0x56e55d Unit_Turn, 0x56e5bc Unit_LookAround (tarefa 0xb:
 * olhar em volta, sorteios 0x56e629/0x56e656 pelo `WorldRec.rng`), 0x56e8c3 (começo do golpe), 0x56eab5 (tarefa 5), 0x56eff3
 * (tarefa 6), 0x56f0bb, 0x56ebc0 (tarefa 8), 0x56e906 (começo da magia), 0x56dbc6, 0x56d969, 0x558b75, 0x56dba1 (parar e Stand
 * ground; o nome "Vision_UpdateManager" de known_functions é de uma nota antiga), 0x56dbfb, 0x56d52b AI_StandGroundAt, 0x53a5a0.
 * O golpe/a magia em si (Unit_StrikeBegin 0x516c1f, Spell_Apply) vivem em Unit_ActionMachine 0x50f12c, fora deste arquivo: a World
 * os começa quando a sub-ação 1/2 nasce (IA+0x15 = 0) e marca +0x136 (pronto) quando a máquina acaba.
 * Fim de caminho (cauda de 0x56dca2): 0x56dc24 (andar: parar + Stand ground), a patrulha (lista IA+0xb4: 0x57b020 Find, GetNext,
 * GetHead) e 0x56ed4e (demais tarefas: candidatos ao alcance na lista de unidades vivas → AI_EnemyFilter 0x567a16 (diplomacia
 * 0x57994d, invisíveis) → caídos à parte (0x567ddf) → o de menor desvio angular (0x55aa21 AI_AngleTiebreak) vira alvo da tarefa 6,
 * senão 0xb (jogador de IA) ou 0). Também 0x54fb7f (distância de Chebyshev entre objetos de mapa).
 * Chamados não portados (tarefas 7, 9, 0xc, 0xf: exec 0 no corpus): lançam NotPorted, salvo quando o chamador passa um adaptador em
 * `DispatchHooks` (World: comportamento do motor antigo para esses pedaços, ver o cabeçalho de sim/world.ts).
 */
import { gridChebyshevDist, mapObjCellOf, mapObjSubCellCenter } from "./walk";
import { mapObjCellX, mapObjCellY } from "./path";
import {
  NotPorted, aiUnitDistance, fn_0x52b22a, fn_0x55532d, fn_0x5568e4, pathClearDynamic, unitActionChase, unitTeleportTo, unitTurnStep,
  unitWalkNear,
} from "./walk_action";
import { aiAttackRange, fn_0x55be86 } from "./wave";
import { fn_0x57afd0, randUniformObject } from "./rand";
import { CListPtrIter, CListWord, type CListPtr, type ListPos } from "./mfc";
import type { MapObjRec, MapRec, UnitRec, WorldRec } from "./types";

/** `abs` do CRT (0x582c40): |v| em 32 bits (INT_MIN fica INT_MIN). */
function crtAbs(v: number): number {
  v |= 0;
  return v < 0 ? (-v) | 0 : v;
}

/** Adaptadores para chamados de 0x56dca2 ainda não portados (sem adaptador: NotPorted). */
export interface DispatchHooks {
  /** Tarefa IA+8 sem porta (7, 9, 0xc, 0xf; exec 0 no corpus): o adaptador a executa e devolve true; false → NotPorted. */
  task?(u: UnitRec): boolean;
}

/** 0x54fb7f (thiscall; `this` = objeto de mapa): distância de Chebyshev em células entre dois objetos de mapa (bytes). AL. */
export function fn_0x54fb7f(a: MapObjRec, b: MapObjRec): number {
  const bVar1 = a.x & 0xff;
  const bVar2 = mapObjCellX(b);
  const uVar4 = crtAbs(bVar1 - bVar2);
  let uVar3 = uVar4 & 0xff;
  const b1 = a.y & 0xff;
  const b2 = mapObjCellY(b);
  const uVar5 = crtAbs(b1 - b2);
  const local_c = uVar5 & 0xff;
  if ((uVar4 & 0xff) <= local_c) uVar3 = local_c;
  return uVar3 & 0xff;
}

/** 0x55aa21 AI_AngleTiebreak (cdecl): |a − b| em 1/256 de volta pelo lado curto (byte); AL. */
export function aiAngleTiebreak(a: number, b: number): number {
  const uVar2 = crtAbs((a & 0xff) - (b & 0xff));
  let local_8 = uVar2 & 0xff;
  if (0x80 < local_8) local_8 = (-local_8) & 0xff;
  return local_8;
}

/** 0x57994d (thiscall; `this` = mundo+0xa8bc): bit 0 da tabela de diplomacia em [8 + id(dono de a) × 0x46 + id(dono de b)] (guerra). */
export function fn_0x57994d(wd: WorldRec, a: UnitRec, b: UnitRec): boolean {
  const ib = (b.owner.f04 << 16) >> 16, ia = (a.owner.f04 << 16) >> 16;
  return (wd.dipTable[ib + ia * 0x46 + 8]! & 1) !== 0;
}

/** 0x567ddf (fastcall; `this` = mundo): esvazia a lista dos caídos (+0xa88) e passa para ela os candidatos (+0xa68) com vida
 *  +0x94 < 1 (0x53afb0 tira, 0x52b22a põe). */
export function fn_0x567ddf(wd: WorldRec): void {
  const it = new CListPtrIter();
  wd.dead.removeAll();
  let local_10 = it.first(wd.cand);
  while (local_10 !== 0) {
    let local_14 = 0;
    if (((wd.map.unitAt(local_10).f94 << 16) >> 16) < 1) local_14 = local_10;
    local_10 = it.next();
    if (local_14 !== 0) {
      wd.cand.remove(local_14);
      fn_0x52b22a(wd.dead, local_14);
    }
  }
}

/** 0x567a16 AI_EnemyFilter (thiscall; `this` = mundo): tira da lista `lst` (objeto `param_2`, CList em +4) quem tem o bit de guerra
 *  com `u` igual a `want` e, dos invisíveis (efeito 0x1000) restantes, os que alguma unidade do tipo de `u` ([+0x70], lista) tem a
 *  AI_UnitDistance ≤ IA+0x71 (ver invisível). */
export function aiEnemyFilter(wd: WorldRec, u: UnitRec, lst: CListPtr, want: number): void {
  let local_14 = 0;
  const it = new CListPtrIter();
  let local_10 = it.first(lst);
  while (local_10 !== 0) {
    local_14 = 0;
    const cand = wd.map.unitAt(local_10);
    const bVar1 = fn_0x57994d(wd, u, cand) ? 1 : 0;
    if (bVar1 === (want | 0)) local_14 = local_10;
    else if ((cand.effects & 0x1000) !== 0) {
      const it2 = new CListPtrIter();
      let local_20 = it2.first(u.type.members);
      local_14 = local_10;
      while (local_20 !== 0) {
        const v = wd.map.unitAt(local_20);
        const uVar2 = aiUnitDistance(wd.map, cand, v);
        if ((uVar2 & 0xff) <= (v.ai.f71 & 0xff)) local_14 = 0;
        local_20 = it2.next();
      }
    }
    local_10 = it.next();
    if (local_14 !== 0) lst.remove(local_14);
  }
}

/**
 * 0x56ed4e (thiscall; `this` = mundo): fim do caminho das tarefas que não são andar/patrulha/0x18. Candidatos = unidades vivas
 * (mapa+0xa456c → mundo+4) a distância de Chebyshev ≤ AI_AttackRange e ≤ a menor até aqui (a lista +0xa68 fica em ordem não
 * crescente de distância), menos a própria; AI_EnemyFilter (só inimigos vistos); caídos à parte (0x567ddf) e, sem candidato de pé,
 * os caídos voltam a ser os candidatos. Alvo = o de menor desvio angular (AI_AngleTiebreak ≤ 300, o último em empate). Sem alvo:
 * dono com +0x2c == 0 → tarefa 0, senão 0xb e olhar em volta; com alvo: IA+0xc = alvo, tarefa 6 e 0x56eff3.
 */
export function fn_0x56ed4e(wd: WorldRec, u: UnitRec): void {
  wd.cand.removeAll();
  const it = new CListPtrIter();
  let local_24 = 0xff;
  let local_20 = it.first(wd.liveUnits);
  while (local_20 !== 0) {
    const c = wd.map.unitAt(local_20);
    const bVar1 = fn_0x54fb7f(u.mapObj, c.mapObj);
    const local_14 = bVar1 & 0xff;
    const r = aiAttackRange(u) & 0xff;
    if (local_14 <= r && local_14 <= local_24 && local_20 !== (u.addr >>> 0)) {
      fn_0x52b22a(wd.cand, local_20);
      local_24 = local_14;
    }
    local_20 = it.next();
  }
  aiEnemyFilter(wd, u, wd.cand, 0);
  fn_0x567ddf(wd);
  if ((wd.cand.count | 0) === 0) {
    if ((wd.dead.count | 0) !== 0) {
      const it2 = new CListPtrIter();
      let p = it2.first(wd.dead);
      while (p !== 0) {
        fn_0x52b22a(wd.cand, p);
        p = it2.next();
      }
      wd.dead.removeAll();
    }
  }
  let local_30 = 0;
  let local_8 = 300;
  if ((wd.cand.count | 0) !== 0) {
    let local_c = it.first(wd.cand);
    while (local_c !== 0) {
      const c = wd.map.unitAt(local_c);
      const uVar3 = fn_0x5568e4(u, c);
      const local_28 = aiAngleTiebreak(u.walk.dir & 0xff, uVar3) & 0xff;
      if (local_28 <= local_8) {
        local_30 = local_c;
        local_8 = local_28;
      }
      local_c = it.next();
    }
  }
  if (local_30 === 0) {
    if ((u.owner.f2c | 0) === 0) u.ai.task = 0;
    else {
      u.ai.task = 0xb;
      unitLookAround(wd, u);
    }
  } else {
    u.ai.f0c = local_30 >>> 0;
    u.ai.task = 6;
    fn_0x56eff3(wd, u);
  }
}

/** 0x56dc24 (thiscall; nome "ReleaseAccessors" é da biblioteca, errado): fim do caminho da tarefa de andar: parar (0x56d969) e
 *  Stand ground (0x56dba1). */
export function fn_0x56dc24(wd: WorldRec, u: UnitRec): void {
  fn_0x56d969(wd, u);
  fn_0x56dba1(wd, u);
}

/** 0x53a5a0 (fastcall): bit 4 de unidade+0x4c. */
export function fn_0x53a5a0(u: UnitRec): number {
  return u.f4c & 4;
}

/** 0x56e8c3 (cdecl): começa o golpe: IA+9 = 1, IA+0x15 = 0, ação 3, +0x5c = alvo IA+0xc. (O golpe em si é a máquina 0x50f12c.) */
export function fn_0x56e8c3(u: UnitRec): void {
  u.ai.sub = 1;
  u.ai.f15 = 0;
  u.act = 3;
  u.f5c = u.ai.f0c >>> 0;
}

/** 0x56eab5 (thiscall; `this` = mundo): tarefa 5, atacar IA+0xc: de frente e ao alcance de AI_AttackRange (0x55532d) → golpe
 *  (0x56e8c3, ação 3); senão perseguir (0x56ea52, ação 1). */
export function fn_0x56eab5(wd: WorldRec, u: UnitRec): void {
  const uVar1 = aiAttackRange(u);
  const iVar2 = fn_0x55532d(wd.map, u, wd.map.unitAt(u.ai.f0c >>> 0), uVar1 & 0xff);
  if (iVar2 === 0) {
    fn_0x56ea52(wd, u, u.ai.f0c >>> 0);
    u.act = 1;
  } else {
    fn_0x56e8c3(u);
    u.act = 3;
  }
}

/** 0x56f0bb (cdecl): um passo de giro para `d` (0x556454); se o rumo mudou, ação 1. */
export function fn_0x56f0bb(u: UnitRec, d: number): void {
  const cVar1 = u.walk.dir & 0xff;
  unitTurnStep(u, d & 0xff);
  if ((u.walk.dir & 0xff) !== cVar1) u.act = 1;
}

/** 0x56eff3 (thiscall; `this` = mundo): tarefa 6, atacar IA+0xc sem perseguir: unidade com o bit 4 de +0x4c, alcance < 2 e dono
 *  com +0x2c == 0 → tarefa 0; ao alcance → golpe (0x56e8c3, ação 3); senão gira para o alvo (0x5568e4 → 0x56f0bb) e ação 1. */
export function fn_0x56eff3(wd: WorldRec, u: UnitRec): void {
  const bVar1 = fn_0x53a5a0(u);
  if (bVar1 !== 0 && (aiAttackRange(u) & 0xff) < 2 && (u.owner.f2c | 0) === 0) {
    u.ai.task = 0;
    return;
  }
  const uVar2 = aiAttackRange(u);
  const t = wd.map.unitAt(u.ai.f0c >>> 0);
  const iVar3 = fn_0x55532d(wd.map, u, t, uVar2 & 0xff);
  if (iVar3 === 0) {
    const uVar4 = fn_0x5568e4(u, t);
    fn_0x56f0bb(u, uVar4 & 0xff);
    u.act = 1;
  } else {
    fn_0x56e8c3(u);
    u.act = 3;
  }
}

/** 0x558b75 (thiscall; `this` = mapa): 0x55be86(unidade, 0, 1) — tira a pegada marcada (andar+0x80). */
export function fn_0x558b75(m: MapRec, u: UnitRec): void {
  fn_0x55be86(m, u, 0, 1);
}

/** 0x56d969 (thiscall; `this` = mundo): parar: rumo desejado = rumo; pegada (andar+0x80) noutra célula com a unidade no centro →
 *  0x558b75; IA+0x14 = AI_AttackRange; IA+0x60 = 0; andar+0x7c (perseguido) = 0; ação 0. */
export function fn_0x56d969(wd: WorldRec, u: UnitRec): void {
  const w = u.walk;
  if ((w.dir & 0xff) !== (w.dirTarget & 0xff)) w.dirTarget = w.dir & 0xff;
  if (((w.footCell << 16) >> 16) !== 0) {
    const iVar4 = mapObjSubCellCenter(u.mapObj);
    if (iVar4 !== 0) {
      const sVar1 = (w.footCell << 16) >> 16;
      const sVar3 = (mapObjCellOf(u.mapObj) << 16) >> 16;
      if (sVar1 !== sVar3) fn_0x558b75(wd.map, u);
    }
  }
  u.ai.range = aiAttackRange(u) & 0xff;
  u.ai.f60 = 0;
  w.chaseTarget = 0;
  u.act = 0;
}

/** 0x56dbfb (thiscall): 0x56d969 e IA+0x50 = 0. */
export function fn_0x56dbfb(wd: WorldRec, u: UnitRec): void {
  fn_0x56d969(wd, u);
  u.ai.f50 = 0;
}

/** 0x56d52b AI_StandGroundAt (thiscall): 0x56dbfb; classe da tarefa +0x50 = 0xc (Stand ground), posto IA+0 = célula atual, IA+8 = 0. */
export function aiStandGroundAt(wd: WorldRec, u: UnitRec): void {
  fn_0x56dbfb(wd, u);
  u.task = 0xc;
  u.ai.f00 = mapObjCellOf(u.mapObj) & 0xffff;
  u.ai.task = 0;
}

/** 0x56dba1 (thiscall; "Vision_UpdateManager" em known_functions é nome de nota antiga: é parar + Stand ground): 0x56dbfb e
 *  0x56d52b. Devolve o EAX que sobrou (sem uso). */
export function fn_0x56dba1(wd: WorldRec, u: UnitRec): void {
  fn_0x56dbfb(wd, u);
  aiStandGroundAt(wd, u);
}

/** 0x56dbc6 (thiscall): parar (0x56d969), Stand ground (0x56dba1) e IA+0x50 = 1. */
export function fn_0x56dbc6(wd: WorldRec, u: UnitRec): void {
  fn_0x56d969(wd, u);
  fn_0x56dba1(wd, u);
  u.ai.f50 = 1;
}

/** 0x56e906 (thiscall; `this` = mundo): começa a magia na unidade: IA+9 = 2, IA+0x15 = 0, ação 0xd, +0x5c = alvo IA+0x28, +0x64 =
 *  magia IA+0x30, IA+0x5c = 1 (alvo é unidade); com IA+0x60 == 0, para e fica em Stand ground (0x56dbc6: a tarefa IA+8 vira 0 — a
 *  magia seguinte é decisão do pensamento). */
export function fn_0x56e906(wd: WorldRec, u: UnitRec): void {
  u.ai.sub = 2;
  u.ai.f15 = 0;
  u.act = 0xd;
  u.f5c = u.ai.f28 >>> 0;
  u.f64 = u.ai.f30 >>> 0;
  u.ai.f5c = 1;
  if ((u.ai.f60 | 0) === 0) fn_0x56dbc6(wd, u);
}

/** 0x56ebc0 (thiscall; `this` = mundo): tarefa 8, magia na unidade IA+0x28: alvo ≠ a própria unidade e fora do alcance IA+0x14
 *  (0x55532d) → perseguir (0x56ea52, ação 1); senão começa a magia (0x56e906). */
export function fn_0x56ebc0(wd: WorldRec, u: UnitRec): void {
  const t = u.ai.f28 >>> 0;
  if ((u.addr >>> 0) !== t && fn_0x55532d(wd.map, u, wd.map.unitAt(t), u.ai.range & 0xff) === 0) {
    fn_0x56ea52(wd, u, t);
    u.act = 1;
    return;
  }
  fn_0x56e906(wd, u);
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
      case 2: fn_0x56e8c3(u); break;
      case 4: fn_0x56ea52(wd, u, ai.target >>> 0); break;
      case 5: fn_0x56eab5(wd, u); break;
      case 6: fn_0x56eff3(wd, u); break;
      case 7: if (!hooks.task?.(u)) throw new NotPorted("0x56ea24"); break;
      case 8: fn_0x56ebc0(wd, u); break;
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
        // magia: ação 0xd (alvo unidade) / 0xe (célula); no 3.º tique o evento para a IA (rascunho mundo+0xbd98 copiado para a lista
        // +0xbbec por 0x57b210); com o pedido pronto (+0x136) a sub-ação acaba
        u.act = (ai.f5c | 0) === 0 ? 0xe : 0xd;
        ai.f15 = (ai.f15 + 1) & 0xff;
        if (2 < (ai.f15 & 0xff)) {
          if ((ai.f15 & 0xff) === 3) {
            if ((ai.f5c | 0) === 0) {
              wd.evtSetU32(0x00, 3);
              wd.evtSetU32(0x2c, u.addr);
              wd.evtSetU32(0x30, u.f64);
              wd.evtSetU32(0x04, u.f60 & 0xff);
              wd.evtSetU32(0x08, (u.f60 >>> 8) & 0xff);
              wd.events.addTail(wd.evt);
            } else {
              wd.evtSetU32(0x00, 2);
              wd.evtSetU32(0x2c, u.addr);
              wd.evtSetU32(0x30, u.f64);
              wd.evtSetU32(0x34, u.f5c);
              wd.events.addTail(wd.evt);
            }
          }
          if ((u.ready & 0xff) !== 0) {
            ai.sub = 0;
            u.act = 0;
          }
        }
        break;
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
      fn_0x56dc24(wd, u);
    } else if ((u.task | 0) === 0xa) {
      ai.f04 = 1;
      ai.task = 0;
      const uVar6 = (ai.f02 & 0xffff) >> 8;
      const uVar7 = ai.f02 & 0xff;
      const y = mapObjCellY(u.mapObj);
      const x = mapObjCellX(u.mapObj);
      if (gridChebyshevDist(x, y, uVar7, uVar6) < 3) {
        // ponto seguinte da lista de patrulha IA+0xb4: Find (0x57b020) do ponto corrente, GetNext (0x55f1f0) o devolve e avança;
        // no fim da lista, GetHead (0x55f0d0); senão GetNext de novo = o ponto seguinte
        const local_10: ListPos = { p: ai.patrol.find(ai.f02 & 0xffff, null) };
        ai.f02 = CListWord.getNext(local_10);
        if (local_10.p === null) ai.f02 = ai.patrol.getHead();
        else ai.f02 = CListWord.getNext(local_10);
      }
    } else if ((u.task | 0) === 0x18) {
      ai.sub = 0xff;
    } else {
      ai.task = 0;
      fn_0x56ed4e(wd, u);
    }
  }
}

