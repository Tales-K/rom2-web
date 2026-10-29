/**
 * Porta literal do servidor do allods2.exe: o pensamento da IA de 1×/s — jogadores, grupos e o que o grupo manda a cada unidade
 * (etapa 9, lote 2; notes/pensamento.md). Server_Tick 0x4f08c0 chama 0x56fe4d no tique em que o relógio de 16/s PRÉ-incremento ≡ 6.
 * Portadas (ordem de chamada):
 *  - 0x56fe4d (thiscall; mundo, lista de jogadores [0x68d2c4]+4): mundo+0xbbe8 == 0 → 0x55b5f1 (acorda os grupos pelos setores de 8×8:
 *    0x55b879, 0x55aca2, 0x55b406, 0x55b507); 0x57485b = o script (0x574899/0x574ba1: `out`, game/src/script) e RemoveAll dos eventos
 *    mundo+0xbbec; AI_PlayerThink 0x570087 por jogador; 0x57a47d (armadilhas do script: gancho `traps`); contadores +0xd720/+0xa4c;
 *    os cronômetros de perfil (AI_ProfileTimer) e a mensagem "Stats" ao cliente são stubs.
 *  - 0x570087 AI_PlayerThink: por grupo da lista dono+0x28; mundo+0xbbe8 == 0 → só os acordados (+0x3c+0x45).
 *  - 0x5700f3 AI_GroupThink: 0x57375a (grupo vazio → comando −1); pelo comando +0x3c+0x20: −1 0x573159 (AI_Idle 0 = Stand ground em cada
 *    unidade), 0 0x56fe34 → 0x5692d5 (tarefas por unidade: AI_TaskDispatcher 0x569321, tasks.ts), 1 AI_GroupGuardState1
 *    0x57275f, 2 0x572d57, 3 0x57309d, 4 0x573198, 5 0x572e1e, 0x11 0x572ec4, 0x12 0x5728fa (Guard da carga do mapa), 0x13 0x57311c;
 *    depois AI_GroupFlee 0x57377d (AI_WimpyOrWithdraw 0x573713 por unidade: AI_Wimpy 0x56cb0c → AI_FleeAction 0x56c9bc; AI_Withdraw
 *    0x56cd11 → AI_WithdrawAction 0x56ce0f, exec 0: NotPorted).
 *  - Pensamento do grupo: AI_GroupCentroid 0x56fa63, AI_GroupMaxScanRange 0x56f850, AI_GroupVisibleEnemies 0x571c4d (visão de cada membro,
 *    vision.ts; candidatos mundo+0xa68 e caídos +0xa88 por 0x567a16/0x567ddf), AI_FilterByGroupRadius 0x567e92, AI_GroupAssignTargets
 *    0x57240b (evento 4 na lista do mundo; AI_TargetCost 0x5711ea por par: Chebyshev × 256 + desempate 0x55aa21, tabela de classes
 *    mundo+0xa54, Mind +0x88, petrificado +0x7f), 0x5725a8 (idem com 0x5713f8: só adjacentes), AI_GuardEnterCombat 0x5726f7 e
 *    AI_GuardLeaveCombat 0x57272c (raio +0x2d = base +0x38 + 4 ± 1 / base ± 1: Rand_Range 0x57aff0, sítios 0x572718/0x57274d).
 *  - Por unidade: AI_MoveTo 0x56c8af (IA+8 = 1, IA+0xa = célula), AI_Idle 0x56afac (0 → Stand ground 0x56a1fb, tasks.ts;
 *    1 → AI_IdleAlt 0x56afd9: jogador humano → 0x56b025 (livro → AI_Autocast 0x56bc7b; senão IA+8 = 0); IA → IA+8 = 0xb
 *    e, com livro, AI_IdleCasterSupport 0x56c592: Heal em si/no aliado mais ferido (AI_AlliesScan 0x567b2d) ou AI_CasterShield 0x57a999
 *    (Shield em si; sorteios 0x57afd0 nos sítios 0x57aad9/0x57ac98: aliado e magia de apoio) → AI_CastAtTarget 0x56c72b (tarefa 8;
 *    0x5679cf aliados em volta) — a magia em si fica na tarefa 8 do despachante e na máquina), AI_Task_Attack 0x56acc8 (alvo imune (+0x4c bit 8) → ocioso; magias de chance
 *    IA+0x7c/+0x88 com Rand_UniformObject, sítio 0x56ad33 → 0x56a981 (exec 0: NotPorted); sem alvo → AI_EnemiesAroundPost 0x567988;
 *    jogador humano: AI_CastChosenSpell 0x56b059 senão tarefa 5 (+ AI_Autocast se corpo a corpo); IA com livro:
 *    AI_CasterOffensiveSpell 0x57a769 (exec 0: gancho/NotPorted) senão tarefa 5), AI_FleePoint 0x56f765, Grid_FineCoordCentroid 0x558b92
 *    (x87: reconstruída do assembly — float32 nas divisões e no termo independente, _ftol trunca), AI_CanCastCost 0x56bb0d, 0x56cb8c
 *    (fuga por Teleport, exec 0: NotPorted).
 * O mundo, o grupo, o dono e as listas são os registros de types.ts; MFC (listas por 0x55f220/0x55f240, 0x57b140/0x57b160, 0x57b120/
 * 0x53da40, GetCount 0x44fc20): mfc.ts `CListPtr.first/nextAfter/getCount`.
 */
import { CListPtrIter, type CListPtr } from "./mfc";
import { aiTaskStandGround, fn_0x56fe34 } from "./tasks";
import { aiAngleTiebreak, aiEnemyFilter, fn_0x53a5a0, fn_0x567ddf, fn_0x56dbc6, fn_0x57994d } from "./action";
import { aiInBattle } from "./combat";
import { aiUnitDistance, fn_0x52b22a, fn_0x5568e4, gridUnitsInRings, NotPorted } from "./walk_action";
import { aiAttackRange, aiTeleportTargetDist, fn_0x55cd50, unitGetBookSpell } from "./wave";
import { fn_0x55f330, mapObjCellOf, mapObjSubCellCenter } from "./walk";
import { mapObjCellX, mapObjCellY, mapObjFineX, mapObjFineY, vtGetSize } from "./path";
import { fn_0x57afd0, randRange, randUniformObject } from "./rand";
import { fn_0x553681, visionSeen, visionUnitMap } from "./vision";
import {
  EXE_GLOBALS, MAP_DIR_DX_OFF, MAP_DIR_DY_OFF, MAP_HEIGHT_OFF, MAP_RECT_OFF, MAP_WAKE_OFF, MAP_WIDTH_OFF, WAKE_F1614_OFF, WAKE_F1618_OFF,
  WAKE_F1624_OFF, WAKE_TABLE_OFF, type BookSpellRec, type CellStructRec, type MapRec, type PlayerRec, type UnitRec, type UnitTypeRec, type WorldRec,
} from "./types";

const i16 = (v: number): number => (v << 16) >> 16;
const i8 = (v: number): number => (v << 24) >> 24;
/** 0x582c40 abs (CRT). */
const crtAbs = (v: number): number => Math.abs(v | 0) | 0;

/** Ganchos: o que ainda vive no motor antigo (8b: magias) e o que não é do exe. Sem gancho → NotPorted. */
export interface ThinkHooks {
  /** 0x57a769 AI_CasterOffensiveSpell(unidade, alvo): ≠ 0 = o conjurador de IA lançou (8b; exec 0 no corpus). */
  casterOffensiveSpell?(wd: WorldRec, u: UnitRec, t: UnitRec): number;
  /** 0x57a47d: armadilhas do script (0x57a307 sorteia o alvo; exec 0 no corpus). Sem gancho: nada. */
  traps?(wd: WorldRec): void;
  /** 0x56cb8c (Wimpy com Teleport pagável) e 0x56cef3 (Withdraw idem): fuga por magia (8b; exec 0 no corpus). Sem gancho → NotPorted. */
  fleeTeleport?(wd: WorldRec, u: UnitRec): void;
  withdrawTeleport?(wd: WorldRec, u: UnitRec): void;
  /** não é do exe: a unidade acabou de receber a tarefa de fuga/recuo (AI_MoveTo) — a apresentação acompanha. */
  fled?(wd: WorldRec, u: UnitRec): void;
  /** não é do exe: a unidade acabou de receber a tarefa de magia 8 (AI_CastAtTarget) ou 9 (AI_TeleportCast) — a ordem do motor antigo acompanha. */
  castTask?(wd: WorldRec, u: UnitRec): void;
  /** não é do exe: true = a unidade pensa no motor antigo (modo sem tratador portado, exec 0: defend 0x56d5b9, follow 0x56d638, still
   *  0x56dafe/0x56a909) e o comando 0 do grupo (0x56fe34) não a despacha. */
  legacyThink?(wd: WorldRec, u: UnitRec): boolean;
}

// ---------------------------------------------------------------------------------------------------------- folhas por unidade

/** 0x56c8af AI_MoveTo (cdecl): tarefa IA+8 = 1 (andar), destino IA+0xa. */
export function aiMoveTo(u: UnitRec, param_2: number): void {
  u.ai.task = 1;
  u.ai.f0a = param_2 & 0xffff;
}

/** 0x56afac AI_Idle (thiscall): 0 → AI_Task_StandGround 0x56a1fb (tasks.ts); senão AI_IdleAlt. */
export function aiIdle(wd: WorldRec, u: UnitRec, param_2: number, h: ThinkHooks): void {
  if (param_2 === 0) aiTaskStandGround(wd, u, h);
  else aiIdleAlt(wd, u, h);
}

/** 0x56afd9 AI_IdleAlt (thiscall): dono humano (+0x2c == 0) → 0x56b025; IA → IA+8 = 0xb (olhar em volta) e, com livro (0x53a5a0), AI_IdleCasterSupport. */
export function aiIdleAlt(wd: WorldRec, u: UnitRec, h: ThinkHooks): void {
  if ((u.owner.f2c >>> 0) === 0) {
    fn_0x56b025(wd, u, h);
  } else {
    u.ai.task = 0xb;
    if (fn_0x53a5a0(u) !== 0) aiIdleCasterSupport(wd, u, h);
  }
}

/** 0x56b025 (thiscall): sem livro (0x53a5a0 == 0) → IA+8 = 0; com livro → AI_Autocast 0x56bc7b. */
export function fn_0x56b025(wd: WorldRec, u: UnitRec, h: ThinkHooks): void {
  if (fn_0x53a5a0(u) === 0) u.ai.task = 0;
  else {
    aiAutocast(wd, u, h);
  }
}

/** 0x567988 AI_EnemiesAroundPost (fastcall; mundo, unidade, célula): unidades nos anéis até o raio da unidade (andar+8) em volta da célula,
 *  filtradas por AI_EnemyFilter (inimigas). Devolve a lista (objeto de 0x54ec6a). */
export function aiEnemiesAroundPost(wd: WorldRec, u: UnitRec, param_4: number): CListPtr {
  const iVar1 = gridUnitsInRings(wd.map, param_4 & 0xffff, u.walk.f08 & 0xff);
  aiEnemyFilter(wd, u, iVar1, 0);
  return iVar1;
}

/** 0x567b2d AI_AlliesScan (thiscall; mundo, unidade, lista de 0x54ec6a): tira da lista quem tem o bit 1 da diplomacia (dono da unidade ×
 *  dono do outro) ligado — salvo o invisível (+0x144 bit 0x1000) que nenhum membro do grupo da unidade vê de perto (IA+0x71): esse sai. */
export function aiAlliesScan(wd: WorldRec, param_1: UnitRec, param_2: CListPtr): void {
  let local_14 = 0;
  const it = new CListPtrIter();
  let local_10 = it.first(param_2);   // param_2 == 0 → GetHeadPosition de lista nula (não acontece: 0x54ec6a devolve sempre o objeto)
  while (local_10 !== 0) {
    local_14 = 0;
    const cand = wd.map.unitAt(local_10);
    if ((wd.dipTable[i16(cand.owner.f04) + i16(param_1.owner.f04) * 0x46 + 8]! & 2) === 0) {
      local_14 = local_10;
    } else if ((cand.effects & 0x1000) !== 0) {
      const it2 = new CListPtrIter();
      let local_20 = it2.first(param_1.type.members);
      local_14 = local_10;
      while (local_20 !== 0) {
        const v = wd.map.unitAt(local_20);
        const uVar1 = aiUnitDistance(wd.map, cand, v);
        if ((uVar1 & 0xff) <= (v.ai.f71 & 0xff)) local_14 = 0;
        local_20 = it2.next();
      }
    }
    local_10 = it.next();
    if (local_14 !== 0) param_2.remove(local_14);
  }
}

/** 0x5679cf (fastcall; mundo, unidade, célula): unidades nos anéis até o raio da unidade (andar+8) em volta da célula, filtradas por
 *  AI_EnemyFilter com 1 (aliadas). */
export function fn_0x5679cf(wd: WorldRec, param_3: UnitRec, param_4: number): CListPtr {
  const iVar1 = gridUnitsInRings(wd.map, param_4 & 0xffff, param_3.walk.f08 & 0xff);
  aiEnemyFilter(wd, param_3, iVar1, 1);
  return iVar1;
}

/** 0x56c72b AI_CastAtTarget (thiscall; mundo, unidade, alvo (0 = procurar), magia do livro): sem alvo, o 1.º da lista de 0x5679cf
 *  (magia de apoio) ou de AI_EnemiesAroundPost em volta da unidade; nenhum → AI_Idle(0). Com alvo: tarefa IA+8 = 8, IA+0x28 = alvo,
 *  IA+0x30 = magia, IA+0x14 = AI_AttackRange e, no alvo, IA+0xa4 = id da magia, IA+0xa8 = relógio de 16/s. No fim IA+0x14 = alcance da
 *  magia (+9) — também no ramo sem alvo. O lançamento em si é a tarefa 8 no despachante (0x56ebc0 → 0x56e906) e a máquina. */
export function aiCastAtTarget(wd: WorldRec, param_1: UnitRec, param_2: UnitRec | null, param_3: BookSpellRec, h: ThinkHooks): void {
  let local_c = param_2;
  if (param_2 === null) {
    const uVar2 = mapObjCellOf(param_1.mapObj);
    const local_8 = param_3.f0a === 0 ? aiEnemiesAroundPost(wd, param_1, uVar2) : fn_0x5679cf(wd, param_1, uVar2);
    if (local_8.getCount() !== 0) local_c = wd.map.unitAt(local_8.first());
  }
  if (local_c === null) {
    aiIdle(wd, param_1, 0, h);
  } else {
    param_1.ai.task = 8;
    param_1.ai.f28 = local_c.addr >>> 0;
    param_1.ai.f30 = param_3.addr >>> 0;
    param_1.ai.range = aiAttackRange(param_1) & 0xff;
    local_c.ai.fa4 = param_3.id & 0xff;
    local_c.ai.fa8 = EXE_GLOBALS.clock16 >>> 0;
    h.castTask?.(wd, param_1);
  }
  param_1.ai.range = param_3.range & 0xff;
}

/** 0x57a999 AI_CasterShield (thiscall; mundo, unidade, lista de aliados de 0x56c592): ferida e com Heal (0x18) → Heal em si; senão
 *  Shield (0x1b) em si se o conhece e não o tem; senão sorteia um da lista (0x57afd0 × contagem, sítio 0x57aad9) — do mesmo dono — e, se
 *  ele está ferido e há Heal, Heal nele; senão, com a mana cheia, sorteia (sítio 0x57ac98) entre as magias de apoio 1..28 pagáveis
 *  (sem Heal/Shield) e lança no sorteado se ele ainda não tem o efeito. Devolve 1 se lançou. Com a lista de apoio vazia a magia "sorteada"
 *  é o que GetBookSpell(0x1c) deixou (null com o livro de 28), logo nada é lançado — como no exe. */
export function aiCasterShield(wd: WorldRec, param_1: UnitRec, param_2: CListPtr, h: ThinkHooks): number {
  const local_44: BookSpellRec[] = [];   // List_Construct 0x57c9a0 (lista de ponteiros; 0x57ca20 AddTail, 0x57ca00 GetCount, 0x57ca80/0x57caa0)
  let local_14 = 0;
  let local_1c: BookSpellRec | null;
  const local_24 = new CListPtrIter();
  if (i16(param_1.f94) === i16(param_1.f96) || (local_1c = unitGetBookSpell(param_1.book, 0x18)) === null) {
    local_1c = unitGetBookSpell(param_1.book, 0x1b);
    if (local_1c === null || (param_1.effects & (1 << (local_1c.id & 0x1f))) !== 0) {
      const iVar1 = param_2.getCount();
      local_14 = fn_0x57afd0(wd, iVar1, 0x57aad9);
      let local_18 = local_24.first(param_2);
      let local_28 = 0;
      while (local_18 !== 0 && local_28 !== local_14) {
        local_28 = local_28 + 1;
        local_18 = local_24.next();
      }
      if (local_18 === 0 || wd.map.unitAt(local_18).owner.addr !== param_1.owner.addr) return 0;
      const t = wd.map.unitAt(local_18);
      if (i16(t.f94) === i16(t.f96) || (local_1c = unitGetBookSpell(param_1.book, 0x18)) === null) {
        if (i16(param_1.mana) === i16(param_1.f9c)) {
          for (local_28 = 1; local_28 < 0x1d; local_28 = local_28 + 1) {
            local_1c = unitGetBookSpell(param_1.book, local_28);
            if (local_1c !== null && i16(local_1c.cost) <= i16(param_1.mana) && local_1c.f0a !== 0 && local_1c.id !== 0x18 && local_1c.id !== 0x1b) {
              local_44.push(local_1c);
            }
          }
          local_14 = fn_0x57afd0(wd, local_44.length, 0x57ac98);
          local_28 = 0;
          for (let local_48 = 0; local_48 < local_44.length;) {
            local_1c = local_44[local_48++]!;
            if (local_28 === local_14) break;
            local_28 = local_28 + 1;
          }
          if (local_1c === null || (t.effects & (1 << (local_1c.id & 0x1f))) !== 0) return 0;
          param_1.ai.f60 = 1;
          aiCastAtTarget(wd, param_1, t, local_1c, h);
          return 1;
        }
        return 0;
      }
      param_1.ai.f60 = 1;
      aiCastAtTarget(wd, param_1, t, local_1c, h);
      return 1;
    }
    param_1.ai.f60 = 1;
    aiCastAtTarget(wd, param_1, param_1, local_1c, h);
    return 1;
  }
  param_1.ai.f60 = 1;
  aiCastAtTarget(wd, param_1, param_1, local_1c, h);
  return 1;
}

/** 0x56c592 AI_IdleCasterSupport (thiscall; mundo, unidade): com livro e mana > 10 e Heal (0x18) no livro: ferida → Heal em si; senão
 *  aliados (0x54ec6a nos anéis até o alcance do Heal, AI_AlliesScan) e o de menor vida ÷ máx. (divisão INTEIRA convertida a double:
 *  qualquer ferido vale 0, o 1.º achado fica) — abaixo de 1.0 → Heal nele; senão AI_CasterShield. */
export function aiIdleCasterSupport(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  if (param_1.hasBook && 10 < i16(param_1.mana)) {
    const local_c = unitGetBookSpell(param_1.book, 0x18);
    if (local_c !== null) {
      if (i16(param_1.f94) === i16(param_1.f96)) {
        const uVar2 = mapObjCellOf(param_1.mapObj);
        const local_8 = gridUnitsInRings(wd.map, uVar2, local_c.range & 0xff);
        aiAlliesScan(wd, param_1, local_8);
        let local_14 = 2.0;
        let local_2c = 0;
        const local_1c = new CListPtrIter();
        let local_28 = local_1c.first(local_8);
        while (local_28 !== 0) {
          const v = wd.map.unitAt(local_28);
          if (i16(v.f96) === 0) throw new Error("0x56c592: vida máxima 0 (#DE no exe)");
          const dVar1 = Math.trunc(i16(v.f94) / i16(v.f96));
          if (dVar1 < local_14) { local_2c = local_28; local_14 = dVar1; }
          local_28 = local_1c.next();
        }
        if (1.0 <= local_14) {   // _DAT_005d1b88 = 1.0
          aiCasterShield(wd, param_1, local_8, h);
        } else {
          param_1.ai.f60 = 1;
          aiCastAtTarget(wd, param_1, wd.map.unitAt(local_2c), local_c, h);
        }
      } else {
        param_1.ai.f60 = 1;
        aiCastAtTarget(wd, param_1, param_1, local_c, h);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- magos do jogador humano (8b)

/** 0x57b0e0 (thiscall; lista): AddTail 0x53c5c0. */
export function fn_0x57b0e0(l: CListPtr, p: number): void {
  l.addTail(p);
}

/** 0x571e9b (thiscall; mundo, grupo): candidatos mundo+0xa68 = unidades em células vistas por algum membro do grupo (visão recomputada;
 *  a célula de quem bateu num membro de IA conta 20 pensamentos), de pé (0x567ddf põe as caídas em +0xa88); sem nenhuma de pé, as
 *  caídas. É AI_GroupVisibleEnemies 0x571c4d sem o filtro de inimigos. */
export function fn_0x571e9b(wd: WorldRec, param_1: UnitTypeRec): void {
  wd.cand.removeAll();
  let local_14 = param_1.members.first();
  if (local_14 !== 0) {
    const m = wd.map;
    fn_0x553681(m);
    for (; local_14 !== 0; local_14 = param_1.members.nextAfter(local_14)) {
      const u = m.unitAt(local_14);
      const uVar1 = mapObjCellOf(u.mapObj) & 0xffff;
      visionUnitMap(m, u, uVar1);
      if ((u.owner.f2c >>> 0) !== 0 && (u.ai.f58 & 0xffff) !== 0) {
        const off = 0x58ec0 + (u.ai.f58 & 0xffff) + 0x2a008;
        m.mem[off] = (m.mem[off]! + 1) & 0xff;
        u.ai.f5a = (u.ai.f5a + 1) & 0xff;
        if (0x14 < i8(u.ai.f5a)) u.ai.f58 = 0;
      }
    }
    const local_10 = new CListPtrIter();
    local_14 = local_10.first(wd.lists.all);   // [mapa+0xa456c]+4
    while (local_14 !== 0) {
      const uVar2 = mapObjCellOf(m.unitAt(local_14).mapObj) & 0xffff;
      if (visionSeen(m, uVar2) !== 0) fn_0x52b22a(wd.cand, local_14);
      local_14 = local_10.next();
    }
    fn_0x567ddf(wd);
    if (wd.cand.getCount() === 0 && wd.dead.getCount() !== 0) {
      wd.cand.removeAll();
      for (local_14 = wd.dead.first(); local_14 !== 0; local_14 = wd.dead.nextAfter(local_14)) fn_0x52b22a(wd.cand, local_14);
      wd.dead.removeAll();
    }
  }
}

/** 0x567c56 (thiscall; mundo, unidade, candidatos mundo+0xa64): reparte os candidatos (menos os mortos, ação 0x10) entre +0xac8 (em
 *  guerra com a unidade, 0x57994d) e +0xaa8 (os outros); o invisível (+0x144 bit 0x1000) de quem não é aliado pleno (diplomacia ≠ 2) só
 *  entra se algum membro do grupo da unidade o vê de perto (AI_UnitDistance ≤ IA+0x71). */
export function fn_0x567c56(wd: WorldRec, param_1: UnitRec, param_2: CListPtr): void {
  const local_c = new CListPtrIter();
  wd.foes.removeAll();
  wd.friends.removeAll();
  let local_10 = local_c.first(param_2);
  for (;;) {
    if (local_10 === 0) return;
    const v = wd.map.unitAt(local_10);
    if ((v.act >>> 0) === 0x10) { local_10 = local_c.next(); continue; }
    if ((v.effects & 0x1000) !== 0 && wd.dipTable[i16(v.owner.f04) + i16(param_1.owner.f04) * 0x46 + 8] !== 2) {
      let bVar1 = false;
      const local_18 = new CListPtrIter();
      let local_20 = local_18.first(param_1.type.members);
      while (local_20 !== 0) {
        const w = wd.map.unitAt(local_20);
        const uVar2 = aiUnitDistance(wd.map, v, w);
        if ((uVar2 & 0xff) <= (w.ai.f71 & 0xff)) bVar1 = true;
        local_20 = local_18.next();
      }
      if (!bVar1) { local_10 = local_c.next(); continue; }
    }
    if (!fn_0x57994d(wd, param_1, v)) fn_0x57b0e0(wd.friends, local_10);
    else fn_0x57b0e0(wd.foes, local_10);
    local_10 = local_c.next();
  }
}

/** 0x56bb53 AI_AutocastTargetsMask (thiscall; mundo, unidade, candidato): 1 se o AutoCasting do dono ([+0x34]+0x20) cobre o candidato —
 *  neutro (diplomacia & 3 == 0) com o bit 4, aliado (& 2) com o bit 2, do mesmo dono com o bit 1, ou a própria unidade. */
export function aiAutocastTargetsMask(wd: WorldRec, param_1: UnitRec, param_2: UnitRec): number {
  const dip = wd.dipTable[i16(param_2.owner.f04) + i16(param_1.owner.f04) * 0x46 + 8]!;
  const flags = param_1.owner.autocast & 0xff;
  if ((dip & 3) === 0 && (flags & 4) !== 0) return 1;
  if ((dip & 2) === 0 || (flags & 2) === 0) {
    if ((param_1.owner.addr >>> 0) === (param_2.owner.addr >>> 0) && (flags & 1) !== 0) return 1;
    if (param_1 === param_2) return 1;
    return 0;
  }
  return 1;
}

/** 0x56bc2e (cdecl; unidade, alvo, magia do livro): AI_TeleportTargetDist (Chebyshev) entre as células ≤ alcance da magia (+9). */
export function fn_0x56bc2e(param_1: UnitRec, param_2: UnitRec, param_3: BookSpellRec): boolean {
  const uVar3 = mapObjCellOf(param_2.mapObj) & 0xffff;
  const uVar2 = mapObjCellOf(param_1.mapObj) & 0xffff;
  const bVar1 = aiTeleportTargetDist(uVar2, uVar3) & 0xff;
  return bVar1 <= (param_3.range & 0xff);
}

/** A magia do livro do endereço que `aiCanCastCost` devolve (o exe guarda o ponteiro). */
const bookSpell = (wd: WorldRec, a: number): BookSpellRec => wd.spellAt(a);
/** IA+0xa4 ≠ 0x14 ou já passaram mais de 20 tiques de 16/s desde que a IA lançou nela (IA+0xa8; 0x582c40 abs). O exe compara com 0x14
 *  (Bless) em TODAS as magias do autocast, não com o id da magia testada. */
const notRecast = (t: UnitRec): boolean => (t.ai.fa4 | 0) !== 0x14 || 0x14 < crtAbs((t.ai.fa8 | 0) - (EXE_GLOBALS.clock16 | 0));

/** 0x56bc7b AI_Autocast (thiscall; mundo, unidade do jogador humano com livro): pelo AutoCasting do dono — nível 1 (bit 8, mana ≥ 5):
 *  Heal em si se ferida, Shield (0x1b) em si sem o efeito, senão Heal no candidato (lista +0xaa8 de 0x567c56, com 2+, pela máscara
 *  0x56bb53 e ao alcance) de menor vida ÷ máx. (divisão INTEIRA convertida a double, < 1,0); nível 2 (bit 0x10, mana ≥ 10): Bless (0x14,
 *  em combate) e Haste (0x15) no candidato sem o efeito; nível 3 (bit 0x20, mana ≥ 40): Protection 0xd/0x13/4/8 e Invisibility (0xc) em
 *  outro só com diplomacia & 3; por fim Invisibility em si. Nada → IA+8 = 0. Cada lançamento: IA+0x60 = 1 e AI_CastAtTarget 0x56c72b. */
export function aiAutocast(wd: WorldRec, param_1: UnitRec, h: ThinkHooks): void {
  const local_10 = new CListPtrIter();
  const cast = (t: UnitRec, s: number): void => { param_1.ai.f60 = 1; aiCastAtTarget(wd, param_1, t, bookSpell(wd, s), h); };
  const flags = (): number => param_1.owner.autocast & 0xff;
  let local_8: number;
  if (i16(param_1.mana) < 5) { param_1.ai.task = 0; return; }
  if ((flags() & 8) === 0) { param_1.ai.task = 0; return; }
  if (i16(param_1.f94) !== i16(param_1.f96) && (local_8 = aiCanCastCost(param_1, 0x18)) !== 0) { cast(param_1, local_8); return; }
  if ((param_1.effects & 0x8000000) === 0 && (local_8 = aiCanCastCost(param_1, 0x1b)) !== 0) { cast(param_1, local_8); return; }
  fn_0x571e9b(wd, param_1.type);
  fn_0x567c56(wd, param_1, wd.cand);
  local_8 = aiCanCastCost(param_1, 0x18);
  if (local_8 !== 0 && 1 < wd.friends.getCount()) {
    let dVar2 = 2.0, local_28 = 0;
    let local_14 = local_10.first(wd.friends);
    while (local_14 !== 0) {
      const t = wd.map.unitAt(local_14);
      if (aiAutocastTargetsMask(wd, param_1, t) === 0 || !fn_0x56bc2e(param_1, t, bookSpell(wd, local_8))) {
        local_14 = local_10.next();
      } else {
        if (i16(t.f96) === 0) throw new Error("0x56bc7b: vida máxima 0 (#DE no exe)");
        const dVar1 = Math.trunc(i16(t.f94) / i16(t.f96));
        if (dVar1 < dVar2) { local_28 = local_14; dVar2 = dVar1; }
        local_14 = local_10.next();
      }
    }
    if (dVar2 < 1.0) { cast(wd.map.unitAt(local_28), local_8); return; }   // _DAT_005d1b88 = 1.0
  }
  if ((flags() & 0x10) === 0) { param_1.ai.task = 0; return; }
  if (i16(param_1.mana) < 10) { param_1.ai.task = 0; return; }
  let local_14 = local_10.first(wd.friends);
  while (local_14 !== 0) {
    const t = wd.map.unitAt(local_14);
    if (aiAutocastTargetsMask(wd, param_1, t) === 0) { local_14 = local_10.next(); continue; }
    local_8 = aiCanCastCost(param_1, 0x14);
    if (local_8 !== 0 && aiInBattle(t) && (t.effects & 0x100000) === 0 && notRecast(t) && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8))) {
      cast(t, local_8); return;
    }
    local_8 = aiCanCastCost(param_1, 0x15);
    if (local_8 !== 0 && (t.effects & 0x200000) === 0 && notRecast(t) && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8))) {
      cast(t, local_8); return;
    }
    local_14 = local_10.next();
  }
  if ((flags() & 0x20) === 0) { param_1.ai.task = 0; return; }
  if (i16(param_1.mana) < 0x28) { param_1.ai.task = 0; return; }
  local_14 = local_10.first(wd.friends);
  while (local_14 !== 0) {
    const t = wd.map.unitAt(local_14);
    if (aiAutocastTargetsMask(wd, param_1, t) === 0) { local_14 = local_10.next(); continue; }
    local_8 = aiCanCastCost(param_1, 0xd);
    if (local_8 !== 0 && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8)) && (t.effects & 0x2000) === 0 && notRecast(t)) { cast(t, local_8); return; }
    local_8 = aiCanCastCost(param_1, 0x13);
    if (local_8 !== 0 && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8)) && (t.effects & 0x80000) === 0 && notRecast(t)) { cast(t, local_8); return; }
    local_8 = aiCanCastCost(param_1, 4);
    if (local_8 !== 0 && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8)) && (t.effects & 0x10) === 0 && notRecast(t)) { cast(t, local_8); return; }
    local_8 = aiCanCastCost(param_1, 8);
    if (local_8 !== 0 && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8)) && (t.effects & 0x100) === 0 && notRecast(t)) { cast(t, local_8); return; }
    local_8 = aiCanCastCost(param_1, 0xc);
    if (local_8 !== 0 && fn_0x56bc2e(param_1, t, bookSpell(wd, local_8)) && (t.effects & 0x1000) === 0 && param_1 !== t
      && (wd.dipTable[i16(t.owner.f04) + i16(param_1.owner.f04) * 0x46 + 8]! & 3) !== 0 && notRecast(t)) { cast(t, local_8); return; }
    local_14 = local_10.next();
  }
  local_8 = aiCanCastCost(param_1, 0xc);
  if (local_8 === 0 || (param_1.effects & 0x1000) !== 0) param_1.ai.task = 0;
  else cast(param_1, local_8);
}

/** Saldo das áreas de AI_CastChosenSpell (o mesmo laço nos casos 2, 3, 6 e 7): para cada inimigo (+0xac8) a célula (adiantada um passo
 *  pelo rumo andar+0 >> 5 fora do centro da célula, quando `ahead`), as unidades nos anéis até `rings`: em guerra +1, senão −1 (a própria
 *  unidade −100); o melhor saldo (−1000 sem inimigos). */
function chosenAreaScore(wd: WorldRec, param_1: UnitRec, rings: number, ahead: boolean): number {
  const local_1c = new CListPtrIter(), local_30 = new CListPtrIter();
  let local_38 = -1000;
  let local_28 = local_1c.first(wd.foes);
  while (local_28 !== 0) {
    const e = wd.map.unitAt(local_28);
    let local_10 = mapObjCellOf(e.mapObj) & 0xffff;
    if (ahead && mapObjSubCellCenter(e.mapObj) === 0) {
      const d = (e.walk.dir & 0xff) >> 5;
      local_10 = (local_10 + wd.map.i8(MAP_DIR_DX_OFF + d) + wd.map.i8(MAP_DIR_DY_OFF + d) * 0x100) & 0xffff;
    }
    const local_68 = gridUnitsInRings(wd.map, local_10, rings);
    let local_44 = 0, local_40 = 0;
    let local_4c = local_30.first(local_68);
    while (local_4c !== 0) {
      if (!fn_0x57994d(wd, param_1, wd.map.unitAt(local_4c))) local_44 += local_4c === (param_1.addr >>> 0) ? 100 : 1;
      else local_40 += 1;
      local_4c = local_30.next();
    }
    if (local_38 < local_40 - local_44) local_38 = local_40 - local_44;
    local_28 = local_1c.next();
  }
  return local_38;
}

/** 0x56b059 AI_CastChosenSpell (thiscall; mundo, unidade do jogador humano, alvo): a magia escolhida na interface (IA+0x78; 0 = golpe)
 *  pagável (AI_CanCastCost) no lugar do golpe — 1, 5, 0xa, 0xb, 0x10, 0x1a no alvo; áreas (2 e 3 pelo inimigo adiantado, 6 e 7 parado;
 *  anéis 1 só no 2) só com saldo de inimigos > 0; 0x12/0x1c no alvo que já tem o efeito, ou no que não o tem se algum inimigo também não o tem (como está no exe); Heal (0x18) no
 *  candidato da máscara de menor vida ÷ máx. (< 1,0; senão IA+8 = 0 e devolve 1); 0x19 e Shield (0x1b, sem o efeito) em si; 0x16 e o
 *  resto: 0. Devolve 1 se lançou (IA+0x60 = 1 e AI_CastAtTarget 0x56c72b; 0x19 sem IA+0x60). */
export function aiCastChosenSpell(wd: WorldRec, param_1: UnitRec, param_2: UnitRec, h: ThinkHooks): number {
  const id = param_1.ai.spellSlot & 0xff;
  if (id === 0) return 0;
  const local_14 = aiCanCastCost(param_1, id);
  if (local_14 === 0) return 0;
  const cast = (t: UnitRec): number => { param_1.ai.f60 = 1; aiCastAtTarget(wd, param_1, t, bookSpell(wd, local_14), h); return 1; };
  switch (id) {
    case 1: case 5: case 10: case 0xb: case 0x10: case 0x1a:
      return cast(param_2);
    case 2: case 3: case 6: case 7: {
      fn_0x571e9b(wd, param_1.type);
      fn_0x567c56(wd, param_1, wd.cand);
      const local_38 = chosenAreaScore(wd, param_1, id === 2 ? 1 : 2, id === 2 || id === 3);
      return local_38 < 1 ? 0 : cast(param_2);
    }
    case 0x12: case 0x1c: {
      if ((param_2.effects & (1 << (id & 0x1f))) === 0) {
        fn_0x571e9b(wd, param_1.type);
        fn_0x567c56(wd, param_1, wd.cand);
        const local_1c = new CListPtrIter();
        let local_28 = local_1c.first(wd.foes);
        while (local_28 !== 0) {
          if ((wd.map.unitAt(local_28).effects & (1 << (id & 0x1f))) === 0) return cast(param_2);
          local_28 = local_1c.next();
        }
        return 0;
      }
      return cast(param_2);
    }
    case 0x16:
      return 0;
    case 0x18: {
      fn_0x571e9b(wd, param_1.type);
      fn_0x567c56(wd, param_1, wd.cand);
      const local_1c = new CListPtrIter();
      let local_c = 2.0, local_34 = 0;
      let local_28 = local_1c.first(wd.friends);
      while (local_28 !== 0) {
        const t = wd.map.unitAt(local_28);
        if (aiAutocastTargetsMask(wd, param_1, t) === 0) { local_28 = local_1c.next(); continue; }
        if (i16(t.f96) === 0) throw new Error("0x56b059: vida máxima 0 (#DE no exe)");
        const local_24 = Math.trunc(i16(t.f94) / i16(t.f96));
        if (local_24 < local_c) { local_34 = local_28; local_c = local_24; }
        local_28 = local_1c.next();
      }
      if (1.0 <= local_c) { param_1.ai.task = 0; return 1; }   // _DAT_005d1b88 = 1.0
      return cast(wd.map.unitAt(local_34));
    }
    case 0x19:
      aiCastAtTarget(wd, param_1, param_1, bookSpell(wd, local_14), h);
      return 1;
    case 0x1b:
      return (param_1.effects & 0x8000000) === 0 ? cast(param_1) : 0;
    default:
      return 0;
  }
}

/** 0x56969c AI_TeleportCast (cdecl; unidade, célula, magia do livro): tarefa IA+8 = 9 (magia na célula IA+0x3c), IA+0x30 = magia,
 *  IA+0x14 = alcance da magia. */
export function aiTeleportCast(wd: WorldRec, param_1: UnitRec, param_2: number, param_3: BookSpellRec, h: ThinkHooks): void {
  param_1.ai.task = 9;
  param_1.ai.f3c = param_2 & 0xffff;
  param_1.ai.f30 = param_3.addr >>> 0;
  param_1.ai.range = param_3.range & 0xff;
  h.castTask?.(wd, param_1);
}

/** 0x56a981 (thiscall; mundo, unidade, alvo, id da magia de chance sorteada em AI_Task_Attack): a magia `param_3` do livro, lançada
 *  conforme o id — no alvo (bolts, Curse, Slow…), na célula do alvo (muros, nuvens: AI_TeleportCast), em si (proteções, Bless, Haste…),
 *  9 (Wall of Fire?) na célula adiante do alvo pelo rumo (tabelas mapa+0x58e88/+0x58e90), 0x17 Teleport: alvo a mais de 2 células →
 *  a 1.ª célula livre (0x55cd50) do quadrado 3×3 em volta dele, varrida por linhas de cima para baixo. Depois IA+0x60 = 1.
 *  [review] exec 0 no corpus: sem pares; porta literal do C. */
export function fn_0x56a981(wd: WorldRec, param_1: UnitRec, param_2: UnitRec, param_3: number, h: ThinkHooks): void {
  const iVar8 = unitGetBookSpell(param_1.book, param_3);
  if (iVar8 !== null) {
    switch (param_3) {
      case 1: case 5: case 10: case 0xb: case 0x10: case 0x12: case 0x1a: case 0x1c: case 0x1d:
        aiCastAtTarget(wd, param_1, param_2, iVar8, h);
        break;
      case 2: case 3: case 6: case 7: case 0xe: case 0xf: case 0x11:
        aiTeleportCast(wd, param_1, mapObjCellOf(param_2.mapObj) & 0xffff, iVar8, h);
        break;
      case 4: case 8: case 0xc: case 0xd: case 0x13: case 0x14: case 0x15: case 0x18: case 0x19: case 0x1b:
        aiCastAtTarget(wd, param_1, param_1, iVar8, h);
        break;
      case 9: {
        const uVar10 = fn_0x5568e4(param_1, param_2);
        const bVar2 = (uVar10 & 0xff) >> 5;
        const cVar3 = mapObjCellX(param_1.mapObj) & 0xff;
        const cVar1 = wd.map.i8(MAP_DIR_DX_OFF + bVar2);
        const cVar4 = mapObjCellY(param_1.mapObj) & 0xff;
        aiTeleportCast(wd, param_1, (((cVar4 + wd.map.i8(MAP_DIR_DY_OFF + bVar2)) & 0xff) << 8) + ((cVar3 + cVar1) & 0xff), iVar8, h);
        break;
      }
      case 0x17: {
        let sVar7 = 0;
        const sVar5 = mapObjCellOf(param_2.mapObj) & 0xffff;
        const uVar6 = mapObjCellOf(param_1.mapObj) & 0xffff;
        const bVar2 = aiTeleportTargetDist(sVar5, uVar6);
        if (2 < (bVar2 & 0xff)) {
          for (let local_20 = 0; local_20 < 3; local_20++) {
            for (let local_24 = 0; local_24 < 3; local_24++) {
              const iVar9 = fn_0x55cd50(wd.map, param_1, (local_20 * 0x100 + local_24 + ((sVar5 - 0x101) & 0xffff)) >>> 0);
              if (iVar9 !== 0) {
                sVar7 = ((local_20 << 8) + local_24 + ((sVar5 - 0x101) & 0xffff)) & 0xffff;
                break;
              }
            }
            if (sVar7 !== 0) break;
          }
          if (sVar7 !== 0) aiTeleportCast(wd, param_1, sVar7, iVar8, h);
        }
        break;
      }
    }
    param_1.ai.f60 = 1;
  }
}

/** 0x56bb0d AI_CanCastCost (cdecl): a magia `param_2` do livro com custo ≤ mana (endereço) ou 0. */
export function aiCanCastCost(u: UnitRec, param_2: number): number {
  const iVar1 = unitGetBookSpell(u.book, param_2);
  if (iVar1 === null || i16(u.mana) < i16(iVar1.cost)) return 0;
  return iVar1.addr;
}

/** 0x56acc8 AI_Task_Attack (thiscall; mundo, unidade, alvo). */
export function aiTaskAttack(wd: WorldRec, u: UnitRec, param_2: UnitRec, h: ThinkHooks): void {
  let local_10: UnitRec | null = param_2;
  let local_8 = 0;
  if ((param_2.f4c & 8) !== 0) {
    aiIdle(wd, u, 0, h);
    return;
  }
  for (let local_14 = 0; local_14 < 3; local_14++) {
    if ((u.ai.f7c[local_14]! | 0) !== 0) {
      const iVar5 = randUniformObject(wd, 0x56ad33, u.ai.f88[local_14]! | 0);
      if (iVar5 < (u.ai.f88[local_14]! | 0)) local_8 = u.ai.f7c[local_14]! | 0;
    }
  }
  if (local_8 !== 0) {
    fn_0x56a981(wd, u, param_2, local_8, h);
    return;
  }
  if (u === param_2) local_10 = null;
  if (local_10 === null) {
    const uVar4 = mapObjCellOf(u.mapObj) & 0xffff;
    const iVar5 = aiEnemiesAroundPost(wd, u, uVar4);
    if (iVar5.getCount() !== 0) local_10 = wd.map.unitAt(iVar5.first());
  }
  if (local_10 === null) {
    aiIdle(wd, u, 0, h);
  } else if ((u.owner.f2c >>> 0) === 0) {
    let cast = 0;
    if (fn_0x53a5a0(u) !== 0) {
      cast = aiCastChosenSpell(wd, u, local_10, h);
    }
    if (cast === 0) {
      u.ai.task = 5;
      u.ai.f0c = local_10.addr >>> 0;
      u.ai.range = aiAttackRange(u) & 0xff;
      if (fn_0x53a5a0(u) !== 0 && (u.ai.range & 0xff) < 2) {
        aiAutocast(wd, u, h);
      }
    }
  } else {
    let cast = 0;
    if (fn_0x53a5a0(u) !== 0) {
      if (!h.casterOffensiveSpell) throw new NotPorted("0x57a769");
      cast = h.casterOffensiveSpell(wd, u, local_10);
    }
    if (cast === 0) {
      u.ai.task = 5;
      u.ai.f0c = local_10.addr >>> 0;
      u.ai.range = aiAttackRange(u) & 0xff;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- fuga e recuo

/** 0x56cb0c AI_Wimpy (thiscall): vida ≤ IA+0x44 e algum inimigo nos anéis até andar+8 + 5. */
export function aiWimpy(wd: WorldRec, u: UnitRec): number {
  if (i16(u.f94) <= (u.ai.f44 | 0)) {
    const uVar2 = (u.walk.f08 & 0xff) + 5;
    const uVar1 = mapObjCellOf(u.mapObj) & 0xffff;
    const iVar3 = gridUnitsInRings(wd.map, uVar1, uVar2);
    aiEnemyFilter(wd, u, iVar3, 0);
    if (iVar3.getCount() !== 0) return 1;
  }
  return 0;
}

/** 0x56cd11 AI_Withdraw (thiscall): vida ≤ IA+0x40 e algum inimigo a ≤ 2 anéis. */
export function aiWithdraw(wd: WorldRec, u: UnitRec): number {
  if (i16(u.f94) <= (u.ai.f40 | 0)) {
    const uVar3 = 2;
    const uVar1 = mapObjCellOf(u.mapObj) & 0xffff;
    const iVar2 = gridUnitsInRings(wd.map, uVar1, uVar3);
    aiEnemyFilter(wd, u, iVar2, 0);
    if (iVar2.getCount() !== 0) return 1;
  }
  return 0;
}

/** 0x56f765 AI_FleePoint (cdecl; objeto de lista): média das coordenadas finas (x em 1/256) das unidades da lista: y_média << 16 | x_média. */
export function aiFleePoint(m: MapRec, param_1: CListPtr): number {
  const local_14 = new CListPtrIter();
  let local_18 = 0, local_c = 0;
  const cVar1 = param_1.getCount() & 0xff;
  let iVar3: number;
  if (cVar1 === 0) iVar3 = 0;
  else {
    let local_1c = local_14.first(param_1);
    // (os `param_1 == 0` do C: o objeto é a própria lista)
    while (local_1c !== 0) {
      const u = m.unitAt(local_1c);
      local_18 = (local_18 + (mapObjFineX(u.mapObj) & 0xffff)) >>> 0;
      local_c = (local_c + (mapObjFineY(u.mapObj) & 0xffff)) >>> 0;
      local_1c = local_14.next();
    }
    iVar3 = (Math.imul(Math.trunc((local_c | 0) / cVar1), 0x10000) + Math.trunc((local_18 | 0) / cVar1)) | 0;
  }
  return iVar3;
}

/** 0x550d9f / 0x550db3 (fastcall; mapa): largura / altura (+0x50000 / +0x50004). */
export function fn_0x550d9f(m: MapRec): number { return m.i32(MAP_WIDTH_OFF); }
export function fn_0x550db3(m: MapRec): number { return m.i32(MAP_HEIGHT_OFF); }

/** 0x558b92 Grid_FineCoordCentroid (thiscall; mapa, unidade, ponto fino (y << 16 | x), distância no byte baixo de `param_3`): a célula a
 *  `d` células da unidade na direção OPOSTA ao ponto, no eixo dominante, pela reta unidade→ponto (x87: coeficiente e termo
 *  independente em float32, `_ftol` trunca), presa a 8..largura−9 / 8..altura−9. Devolve y << 8 | x (word). */
export function gridFineCoordCentroid(m: MapRec, u: UnitRec, param_2: number, param_3: number): number {
  const uVar1 = mapObjFineX(u.mapObj) & 0xffff;
  const uVar2 = mapObjFineY(u.mapObj) & 0xffff;
  let local_2c = (uVar1 - (param_2 & 0xffff)) | 0;
  let local_30 = (uVar2 - (param_2 >>> 16)) | 0;
  if (local_2c === 0) local_2c = 1;
  if (local_30 === 0) local_30 = 1;
  const iVar3 = crtAbs(local_2c), iVar4 = crtAbs(local_30);
  let local_14: number, local_18: number;
  const d = param_3 & 0xff;
  if (iVar4 < iVar3) {
    const k = Math.fround(local_30 / local_2c);                 // fild dy; fidiv dx; fstp dword
    const b = Math.fround(uVar2 - uVar1 * k);                   // fild uy; fild ux; fmul k; fsubp; fstp dword
    local_14 = local_2c < 1 ? (uVar1 - d * 0x100) | 0 : (uVar1 + d * 0x100) | 0;   // [ebp-0x10]
    local_18 = Math.trunc(local_14 * k + b) | 0;                                    // fild; fmul k; fadd b; _ftol → [ebp-0x18]
  } else {
    const k = Math.fround(local_2c / local_30);
    const b = Math.fround(uVar1 - uVar2 * k);
    local_18 = local_30 < 1 ? (uVar2 - d * 0x100) | 0 : (uVar2 + d * 0x100) | 0;   // [ebp-0x18]
    local_14 = Math.trunc(local_18 * k + b) | 0;                                    // [ebp-0x10]
  }
  local_14 = local_14 >> 8;
  local_18 = local_18 >> 8;
  if (local_14 < 8) local_14 = 8;
  if (fn_0x550d9f(m) - 9 < local_14) local_14 = fn_0x550d9f(m) - 9;
  if (local_18 < 8) local_18 = 8;
  if (fn_0x550db3(m) - 9 < local_18) local_18 = fn_0x550db3(m) - 9;
  return (local_18 * 0x100 + local_14) & 0xffff;
}

/** 0x56c9bc AI_FleeAction (thiscall): com livro e Teleport (0x17) pagável → 0x56cb8c (exec 0: NotPorted); senão inimigos nos anéis até
 *  andar+8 + 5: nenhum de pé → AI_Idle 0 (Stand ground); senão anda para a célula a 3 do centroide deles, do lado oposto. */
export function aiFleeAction(wd: WorldRec, u: UnitRec, h: ThinkHooks): void {
  if (u.hasBook) {
    let iVar3 = aiCanCastCost(u, 0x17);
    if (iVar3 === 0) iVar3 = aiCanCastCost(u, 0x17);
    if (iVar3 !== 0) {
      if (!h.fleeTeleport) throw new NotPorted("0x56cb8c");
      h.fleeTeleport(wd, u);
      return;
    }
  }
  const uVar4 = (u.walk.f08 & 0xff) + 5;
  const uVar2 = mapObjCellOf(u.mapObj) & 0xffff;
  const local_8 = gridUnitsInRings(wd.map, uVar2, uVar4);
  aiEnemyFilter(wd, u, local_8, 0);
  const local_10 = new CListPtrIter();
  let cVar1 = 0;
  let local_18 = local_10.first(local_8);
  while (local_18 !== 0) {
    if (0 < i16(wd.map.unitAt(local_18).f94)) cVar1 = (cVar1 + 1) & 0xff;
    local_18 = local_10.next();
  }
  if (cVar1 === 0) {
    aiIdle(wd, u, 0, h);
  } else {
    const uVar4b = aiFleePoint(wd.map, local_8);
    const iVar3 = gridFineCoordCentroid(wd.map, u, uVar4b, 3);
    aiMoveTo(u, iVar3 & 0xffff);
    h.fled?.(wd, u);
  }
}

/** 0x56ce0f AI_WithdrawAction (thiscall; exec 0 no corpus — porta sem prova): com livro e Teleport pagável → 0x56cef3 (gancho); senão
 *  inimigos a ≤ 2 anéis: nenhum → Stand ground; senão anda para a célula a 3 do centroide deles, do lado oposto. */
export function aiWithdrawAction(wd: WorldRec, u: UnitRec, h: ThinkHooks): void {
  if (u.hasBook) {
    let iVar2 = aiCanCastCost(u, 0x17);
    if (iVar2 === 0) iVar2 = aiCanCastCost(u, 0x17);
    if (iVar2 !== 0) {
      if (!h.withdrawTeleport) throw new NotPorted("0x56cef3");
      h.withdrawTeleport(wd, u);
      return;
    }
  }
  const uVar4 = 2;
  const uVar1 = mapObjCellOf(u.mapObj) & 0xffff;
  const iVar2 = gridUnitsInRings(wd.map, uVar1, uVar4);
  aiEnemyFilter(wd, u, iVar2, 0);
  if (iVar2.getCount() === 0) {
    aiTaskStandGround(wd, u, h);
  } else {
    const uVar4b = aiFleePoint(wd.map, iVar2);
    const iVar2b = gridFineCoordCentroid(wd.map, u, uVar4b, 3);
    aiMoveTo(u, iVar2b & 0xffff);
    h.fled?.(wd, u);
  }
}

/** 0x573713 AI_WimpyOrWithdraw (thiscall): Wimpy → AI_FleeAction; senão Withdraw → AI_WithdrawAction 0x56ce0f (exec 0: NotPorted). */
export function aiWimpyOrWithdraw(wd: WorldRec, u: UnitRec, h: ThinkHooks): void {
  let iVar1 = aiWimpy(wd, u);
  if (iVar1 === 0) {
    iVar1 = aiWithdraw(wd, u);
    if (iVar1 !== 0) aiWithdrawAction(wd, u, h);
  } else {
    aiFleeAction(wd, u, h);
  }
}

/** 0x57377d AI_GroupFlee (thiscall): AI_WimpyOrWithdraw em cada unidade do grupo. */
export function aiGroupFlee(wd: WorldRec, g: UnitTypeRec, h: ThinkHooks): void {
  for (let local_8 = g.members.first(); local_8 !== 0; local_8 = g.members.nextAfter(local_8)) aiWimpyOrWithdraw(wd, wd.map.unitAt(local_8), h);
}

// ---------------------------------------------------------------------------------------------------------- o grupo

/** 0x56fa63 AI_GroupCentroid (cdecl; grupo): centroide (média inteira das células, somas em WORD), maior distância ao centroide (+0x2a),
 *  maior visão (+0x2b) e max(distância + visão) (+0x2c). */
export function aiGroupCentroid(wd: WorldRec, param_1: UnitTypeRec): void {
  let uVar7 = 0, uVar8 = 0;
  const cVar3 = param_1.members.getCount() & 0xff;
  let bVar2 = 0, local_8 = 0, bVar10 = 0;
  if (cVar3 !== 0) {
    const local_14 = new CListPtrIter();
    let local_24 = local_14.first(param_1.members);
    while (local_24 !== 0) {
      const u = wd.map.unitAt(local_24);
      uVar7 = (uVar7 + (mapObjCellX(u.mapObj) & 0xff)) & 0xffff;
      uVar8 = (uVar8 + (mapObjCellY(u.mapObj) & 0xff)) & 0xffff;
      local_24 = local_14.next();
    }
    uVar7 = Math.floor(uVar7 / cVar3) & 0xffff;
    uVar8 = Math.floor(uVar8 / cVar3) & 0xffff;
    const d = param_1.stats;
    d.f24 = (uVar8 * 0x10000 + uVar7) >>> 0;
    const sVar11 = (uVar8 * 0x100 + uVar7) & 0xffff;
    d.f28 = sVar11;
    local_24 = local_14.first(param_1.members);
    while (local_24 !== 0) {
      const u = wd.map.unitAt(local_24);
      const bVar4 = aiTeleportTargetDist(mapObjCellOf(u.mapObj) & 0xffff, sVar11) & 0xff;
      if (bVar2 < bVar4) bVar2 = bVar4;
      if (local_8 < (u.fa5 & 0xff)) local_8 = u.fa5 & 0xff;
      if (bVar10 < bVar4 + (u.fa5 & 0xff)) bVar10 = (bVar4 + i8(u.fa5)) & 0xff;
      local_24 = local_14.next();
    }
    d.f2a = bVar2;
    d.f2b = local_8;
    d.f2c = bVar10;
  }
}

/** 0x56f850 AI_GroupMaxScanRange (cdecl; grupo): como 0x56fa63, mas o centroide vem das coordenadas finas (média em 1/256). Devolve
 *  (EAX = local em ebp−0x18) o centroide +0x24 (x fino | y fino << 16; 0 com o grupo vazio) — 0x5703c0 o usa. */
export function aiGroupMaxScanRange(wd: WorldRec, param_1: UnitTypeRec): number {
  let local_20 = 0, local_1c = 0, local_18 = 0;
  const cVar2 = param_1.members.getCount() & 0xff;
  let bVar1 = 0, local_8 = 0, bVar9 = 0;
  if (cVar2 !== 0) {
    const local_14 = new CListPtrIter();
    let local_24 = local_14.first(param_1.members);
    while (local_24 !== 0) {
      const u = wd.map.unitAt(local_24);
      local_20 = (local_20 + (mapObjFineX(u.mapObj) & 0xffff)) >>> 0;
      local_1c = (local_1c + (mapObjFineY(u.mapObj) & 0xffff)) >>> 0;
      local_24 = local_14.next();
    }
    local_20 = Math.floor(local_20 / cVar2) >>> 0;
    local_1c = Math.floor(local_1c / cVar2) >>> 0;
    const d = param_1.stats;
    d.f28 = ((((local_1c & 0xffff) >> 8) << 8) + ((local_20 >>> 8) & 0xff)) & 0xffff;
    local_18 = (Math.imul(local_1c, 0x10000) + local_20) >>> 0;
    d.f24 = local_18;
    let iVar7 = local_14.first(param_1.members);
    while (iVar7 !== 0) {
      const u = wd.map.unitAt(iVar7);
      const bVar3 = aiTeleportTargetDist(mapObjCellOf(u.mapObj) & 0xffff, d.f28 & 0xffff) & 0xff;
      if (bVar1 < bVar3) bVar1 = bVar3;
      if (local_8 < (u.fa5 & 0xff)) local_8 = u.fa5 & 0xff;
      if (bVar9 < bVar3 + (u.fa5 & 0xff)) bVar9 = (bVar3 + i8(u.fa5)) & 0xff;
      iVar7 = local_14.next();
    }
    d.f2a = bVar1;
    d.f2b = local_8;
    d.f2c = bVar9;
  }
  return local_18;
}

/** 0x571c4d AI_GroupVisibleEnemies (thiscall; mundo, grupo): candidatos mundo+0xa68 = unidades em células vistas por algum membro (visão
 *  recomputada), inimigas (0x567a16 pelo 1.º membro), de pé (0x567ddf põe as caídas em +0xa88); sem nenhuma de pé, as caídas. A célula de
 *  quem bateu num membro de IA (IA+0x58) conta como vista por 20 pensamentos (IA+0x5a). */
export function aiGroupVisibleEnemies(wd: WorldRec, param_1: UnitTypeRec): void {
  wd.cand.removeAll();
  let local_14 = param_1.members.first();
  if (local_14 !== 0) {
    const m = wd.map;
    fn_0x553681(m);
    for (; local_14 !== 0; local_14 = param_1.members.nextAfter(local_14)) {
      const u = m.unitAt(local_14);
      const uVar1 = mapObjCellOf(u.mapObj) & 0xffff;
      visionUnitMap(m, u, uVar1);
      if ((u.owner.f2c >>> 0) !== 0 && (u.ai.f58 & 0xffff) !== 0) {
        const off = 0x58ec0 + (u.ai.f58 & 0xffff) + 0x2a008;
        m.mem[off] = (m.mem[off]! + 1) & 0xff;
        u.ai.f5a = (u.ai.f5a + 1) & 0xff;
        if (0x14 < i8(u.ai.f5a)) u.ai.f58 = 0;
      }
    }
    const local_10 = new CListPtrIter();
    local_14 = local_10.first(wd.lists.all);   // [mapa+0xa456c]+4 = o contentor das unidades
    while (local_14 !== 0) {
      const uVar2 = mapObjCellOf(m.unitAt(local_14).mapObj) & 0xffff;
      if (visionSeen(m, uVar2) !== 0) fn_0x52b22a(wd.cand, local_14);
      local_14 = local_10.next();
    }
    aiEnemyFilter(wd, m.unitAt(param_1.members.first()), wd.cand, 0);
    fn_0x567ddf(wd);
    if (wd.cand.getCount() === 0 && wd.dead.getCount() !== 0) {
      wd.cand.removeAll();
      for (local_14 = wd.dead.first(); local_14 !== 0; local_14 = wd.dead.nextAfter(local_14)) fn_0x52b22a(wd.cand, local_14);
      wd.dead.removeAll();
    }
  }
}

/** 0x567e92 AI_FilterByGroupRadius (thiscall; mundo, célula do centroide, raio): tira dos candidatos quem está a Chebyshev > raio. */
export function aiFilterByGroupRadius(wd: WorldRec, param_1: number, param_2: number): void {
  const local_c = new CListPtrIter();
  let local_10 = local_c.first(wd.cand);
  while (local_10 !== 0) {
    let local_14 = 0;
    const uVar2 = mapObjCellOf(wd.map.unitAt(local_10).mapObj) & 0xffff;
    const bVar1 = aiTeleportTargetDist(param_1 & 0xffff, uVar2) & 0xff;
    if ((param_2 & 0xff) < bVar1) local_14 = local_10;
    local_10 = local_c.next();
    if (local_14 !== 0) wd.cand.remove(local_14);
  }
}

/** 0x5711ea AI_TargetCost (thiscall; mundo, unidade, alvo): Chebyshev (para quem atira, o que falta além do alcance + 1) × 256 + desempate
 *  0x55aa21; × 1,5 / × 0,75 pela tabela de classes (Mind > 14, unidade pequena); 0xffffff = nunca; alvo petrificado (+0x40000) + 0x7f. */
export function aiTargetCost(wd: WorldRec, param_1: UnitRec, param_2: UnitRec): number {
  const uVar4 = mapObjCellOf(param_2.mapObj) & 0xffff;
  let bVar2 = aiTeleportTargetDist(mapObjCellOf(param_1.mapObj) & 0xffff, uVar4) & 0xff;
  let local_8 = bVar2;
  let local_14 = fn_0x55f330(param_2) & 0xff;
  if (local_14 === 1 && 1 < (aiAttackRange(param_2) & 0xff)) local_14 = 0;
  bVar2 = aiAttackRange(param_1) & 0xff;
  let cVar1: number;
  if (bVar2 < 2) {
    cVar1 = wd.classTable[local_14 + (fn_0x55f330(param_1) & 0xff) * 4]!;
  } else {
    cVar1 = wd.classTable[local_14]!;
    bVar2 = aiAttackRange(param_1) & 0xff;
    if (bVar2 < local_8) {
      bVar2 = aiAttackRange(param_1) & 0xff;
      local_8 = (local_8 - bVar2) + 1;
    } else local_8 = 1;
  }
  let uVar4b = fn_0x5568e4(param_1, param_2);
  uVar4b = aiAngleTiebreak(param_1.walk.dir & 0xff, uVar4b);
  let local_c = (local_8 * 0x100 + (uVar4b & 0xff)) | 0;
  if (cVar1 === 0) local_c = 0xffffff;
  else {
    if (cVar1 === 1) {
      const bVar2b = vtGetSize(param_1) & 0xff;
      if (bVar2b < 2 && 0xe < i16(param_1.f88)) local_c = (local_c + (local_c >> 1)) | 0;
    } else if (cVar1 === 4 && (vtGetSize(param_1) & 0xff) < 2 && 0xe < i16(param_1.f88)) {
      local_c = (local_c - (local_c >> 2)) | 0;
    }
    if (((param_2.effects >>> 0) & 0x40000) !== 0) {
      local_c = (local_c + 0x7f) | 0;
      if (local_c < 1) local_c = 1;
    }
  }
  return local_c;
}

/** 0x5713f8 (thiscall; mundo, unidade, alvo): custo só para alvos adjacentes (Chebyshev < 2 depois do alcance): × 2 / ÷ 2 pela classe. */
export function fn_0x5713f8(wd: WorldRec, param_1: UnitRec, param_2: UnitRec): number {
  const uVar4 = mapObjCellOf(param_2.mapObj) & 0xffff;
  let bVar1 = aiTeleportTargetDist(mapObjCellOf(param_1.mapObj) & 0xffff, uVar4) & 0xff;
  let local_8 = bVar1;
  bVar1 = aiAttackRange(param_2) & 0xff;
  let local_14: number;
  if (bVar1 < 2 || i8(fn_0x55f330(param_2)) !== 1) local_14 = fn_0x55f330(param_2) & 0xff;
  else local_14 = 0;
  bVar1 = aiAttackRange(param_1) & 0xff;
  let cVar2: number;
  if (bVar1 < 2) {
    cVar2 = wd.classTable[local_14 + (fn_0x55f330(param_1) & 0xff) * 4]!;
  } else {
    cVar2 = wd.classTable[local_14]!;
    bVar1 = aiAttackRange(param_1) & 0xff;
    if (bVar1 < local_8) {
      bVar1 = aiAttackRange(param_1) & 0xff;
      local_8 = (local_8 - bVar1) + 1;
    } else local_8 = 1;
  }
  let uVar4b = fn_0x5568e4(param_1, param_2);
  uVar4b = aiAngleTiebreak(param_1.walk.dir & 0xff, uVar4b);
  let local_c: number;
  if (local_8 < 2) {
    local_c = (local_8 * 0x100 + (uVar4b & 0xff)) | 0;
    if (cVar2 === 0) local_c = 0xffffff;
    else if (cVar2 === 1) local_c = (local_c * 2) | 0;
    else if (cVar2 === 4) local_c = local_c >> 1;
  } else local_c = 0xffffff;
  return local_c;
}

/** 0x57240b AI_GroupAssignTargets (thiscall; mundo, grupo): grupo ou candidatos vazios → IA+0x20 = 0 em todos; senão evento 4 (grupo em
 *  +0x2c) na lista do mundo e, por unidade, o candidato de menor AI_TargetCost (< 0xffffff) em IA+0x20. */
export function aiGroupAssignTargets(wd: WorldRec, param_1: UnitTypeRec): void {
  const local_18 = new CListPtrIter(), local_24 = new CListPtrIter();
  const cVar1 = param_1.members.getCount() & 0xff;
  const cVar2 = wd.cand.getCount() & 0xff;
  if (cVar1 === 0 || cVar2 === 0) {
    let local_10 = local_18.first(param_1.members);
    while (local_10 !== 0) {
      wd.map.unitAt(local_10).ai.f20 = 0;
      local_10 = local_18.next();
    }
  } else {
    if (cVar2 !== 0) {
      wd.evtSetU32(0, 4);
      wd.evtSetU32(0x2c, param_1.addr);
      wd.events.addTail(wd.evt);
    }
    let local_10 = local_18.first(param_1.members);
    while (local_10 !== 0) {
      let local_8 = 0xffffff;
      let local_30 = 0;
      let local_28 = local_24.first(wd.cand);
      while (local_28 !== 0) {
        const local_c = aiTargetCost(wd, wd.map.unitAt(local_10), wd.map.unitAt(local_28));
        if (local_c < local_8) { local_30 = local_28; local_8 = local_c; }
        local_28 = local_24.next();
      }
      wd.map.unitAt(local_10).ai.f20 = local_8 === 0xffffff ? 0 : local_30 >>> 0;
      local_10 = local_18.next();
    }
  }
}

/** 0x5725a8 (thiscall; mundo, grupo): como 0x57240b com o custo 0x5713f8 (só adjacentes) e sem o evento. */
export function fn_0x5725a8(wd: WorldRec, param_1: UnitTypeRec): void {
  const local_18 = new CListPtrIter(), local_24 = new CListPtrIter();
  const cVar1 = param_1.members.getCount() & 0xff;
  const cVar2 = wd.cand.getCount() & 0xff;
  if (cVar1 === 0 || cVar2 === 0) {
    let local_10 = local_18.first(param_1.members);
    while (local_10 !== 0) {
      wd.map.unitAt(local_10).ai.f20 = 0;
      local_10 = local_18.next();
    }
  } else {
    let local_10 = local_18.first(param_1.members);
    while (local_10 !== 0) {
      let local_8 = 0xffffff;
      let local_30 = 0;
      let local_28 = local_24.first(wd.cand);
      while (local_28 !== 0) {
        const local_c = fn_0x5713f8(wd, wd.map.unitAt(local_10), wd.map.unitAt(local_28));
        if (local_c < local_8) { local_30 = local_28; local_8 = local_c; }
        local_28 = local_24.next();
      }
      wd.map.unitAt(local_10).ai.f20 = local_8 === 0xffffff ? 0 : local_30 >>> 0;
      local_10 = local_18.next();
    }
  }
}

/** 0x5726f7 AI_GuardEnterCombat (thiscall): raio +0x2d = base +0x38 + 4 + rand(−1..1) (sítio 0x572718). */
export function aiGuardEnterCombat(wd: WorldRec, param_1: UnitTypeRec): void {
  const cVar1 = i8(param_1.stats.f38);
  const iVar2 = randRange(wd, -1, 1, 0x572718);
  param_1.stats.f2d = (cVar1 + 4 + iVar2) & 0xff;
}

/** 0x57272c AI_GuardLeaveCombat (thiscall): raio +0x2d = base + rand(−1..1) (sítio 0x57274d). */
export function aiGuardLeaveCombat(wd: WorldRec, param_1: UnitTypeRec): void {
  const cVar1 = i8(param_1.stats.f38);
  const iVar2 = randRange(wd, -1, 1, 0x57274d);
  param_1.stats.f2d = (cVar1 + iVar2) & 0xff;
}

/** O começo comum de 0x57275f / 0x5728fa: centroide, inimigos vistos, filtro pelo raio, alvos; entra/sai de combate (+0x30/+0x34). */
function guardCommon(wd: WorldRec, param_1: UnitTypeRec): number {
  aiGroupCentroid(wd, param_1);
  aiGroupVisibleEnemies(wd, param_1);
  aiFilterByGroupRadius(wd, param_1.stats.f28 & 0xffff, param_1.stats.f2d & 0xff);
  aiGroupAssignTargets(wd, param_1);
  const d = param_1.stats;
  const local_c = param_1.members.first();
  if (local_c === 0) {
    if ((d.f30 | 0) === 0) d.f34 = (d.f34 + 1) | 0;
    else { aiGuardLeaveCombat(wd, param_1); d.f34 = 0; }
    d.f30 = 0;
  } else {
    if ((d.f30 | 0) === 0) { aiGuardEnterCombat(wd, param_1); d.f34 = 0; }
    else d.f34 = (d.f34 + 1) | 0;
    d.f30 = 1;
  }
  return local_c;
}

/** 0x57275f AI_GroupGuardState1 (thiscall; comando 1, Guard do script): cada unidade ataca o alvo atribuído, senão volta ao posto IA+0
 *  (no posto e centrada → AI_Idle 1). */
export function aiGroupGuardState1(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  let local_c = guardCommon(wd, param_1);
  while (local_c !== 0) {
    const u = wd.map.unitAt(local_c);
    if ((u.ai.f20 >>> 0) === 0) {
      const sVar1 = mapObjCellOf(u.mapObj) & 0xffff;
      let idle = false;
      if (sVar1 === (u.ai.f00 & 0xffff)) {
        const iVar2 = mapObjSubCellCenter(u.mapObj);
        if (iVar2 !== 0) { aiIdle(wd, u, 1, h); idle = true; }
      }
      if (!idle) aiMoveTo(u, u.ai.f00 & 0xffff);
    } else {
      aiTaskAttack(wd, u, wd.map.unitAt(u.ai.f20), h);
    }
    local_c = param_1.members.nextAfter(local_c);
  }
}

/** 0x5728fa (thiscall; comando 0x12, Guard da carga do mapa): como 0x57275f, com a fuga ao ponto IA+0x9c (ferida e perseguição inalcançável
 *  IA+0x16 há < 30 s; ou há < 10 s), sem alvo: golpeada há < 10 tiques (IA+0x98) → fuga; senão posto IA+0 (ou a célula alternativa IA+0xa0
 *  enquanto IA+0x9e conta até 10). */
export function fn_0x5728fa(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  let local_c = guardCommon(wd, param_1);
  for (; local_c !== 0; local_c = param_1.members.nextAfter(local_c)) {
    const u = wd.map.unitAt(local_c), ai = u.ai;
    const sec = EXE_GLOBALS.w6044c4 & 0xffff;
    let iVar2: number;
    if (i16(u.f94) === i16(u.f96) || (iVar2 = crtAbs(((ai.f16 & 0xffff) - sec) | 0), 0x1d < iVar2)) {
      iVar2 = crtAbs(((ai.f16 & 0xffff) - sec) | 0);
      if (iVar2 < 10) {
        aiMoveTo(u, ai.f9c & 0xffff);
      } else if ((ai.f20 >>> 0) === 0) {
        if (i16(u.f94) === i16(u.f96) || (iVar2 = crtAbs(((ai.f98 | 0) - (EXE_GLOBALS.clock16 | 0)) | 0), 9 < iVar2)) {
          if ((ai.f9e & 0xff) === 0) {
            const sVar1 = mapObjCellOf(u.mapObj) & 0xffff;
            if (sVar1 === (ai.f00 & 0xffff) && (iVar2 = mapObjSubCellCenter(u.mapObj), iVar2 !== 0)) {
              aiIdle(wd, u, 1, h);
            } else {
              aiMoveTo(u, ai.f00 & 0xffff);
            }
          } else {
            ai.f9e = (ai.f9e + 1) & 0xff;
            aiMoveTo(u, ai.fa0 & 0xffff);
            if (10 < (ai.f9e & 0xff)) ai.f9e = 0;
          }
        } else {
          aiMoveTo(u, ai.f9c & 0xffff);
        }
      } else {
        aiTaskAttack(wd, u, wd.map.unitAt(ai.f20), h);
      }
    } else {
      aiMoveTo(u, ai.f9c & 0xffff);
    }
  }
}

/** 0x572d57 (thiscall; comando 2; célula): inimigos vistos e alvos; cada unidade ataca o seu, senão anda para a célula (nela e centrada → AI_Idle 1). */
export function fn_0x572d57(wd: WorldRec, param_1: UnitTypeRec, param_2: number, h: ThinkHooks): void {
  aiGroupVisibleEnemies(wd, param_1);
  aiGroupAssignTargets(wd, param_1);
  let local_8 = param_1.members.first();
  while (local_8 !== 0) {
    const u = wd.map.unitAt(local_8);
    if ((u.ai.f20 >>> 0) === 0) {
      const sVar1 = mapObjCellOf(u.mapObj) & 0xffff;
      let idle = false;
      if (sVar1 === (param_2 & 0xffff)) {
        const iVar2 = mapObjSubCellCenter(u.mapObj);
        if (iVar2 !== 0) { aiIdle(wd, u, 1, h); idle = true; }
      }
      if (!idle) aiMoveTo(u, param_2 & 0xffff);
    } else {
      aiTaskAttack(wd, u, wd.map.unitAt(u.ai.f20), h);
    }
    local_8 = param_1.members.nextAfter(local_8);
  }
}

/** 0x57309d (thiscall; comando 3): inimigos vistos, alvos só adjacentes (0x5725a8); com alvo ataca, senão AI_IdleAlt. */
export function fn_0x57309d(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  aiGroupVisibleEnemies(wd, param_1);
  fn_0x5725a8(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) {
    const u = wd.map.unitAt(local_8);
    if ((u.ai.f20 >>> 0) === 0) aiIdleAlt(wd, u, h);
    else aiTaskAttack(wd, u, wd.map.unitAt(u.ai.f20), h);
  }
}

/** 0x573198 (thiscall; comando 4; célula): andar do grupo até a célula. Chegada (no destino IA+0xa e centrada, sem IA+0x50) ou fim do
 *  caminho dinâmico (andar+0x90 com andar+0x76 = a célula) → parar (0x56dbc6); sem IA+0x50: AI_MoveTo(IA+0xa) (+0x44 do grupo →
 *  IA+0x6c = 1) e, com a célula ocupada (0x55cd50) sendo o destino e a ≤ 1 → Stand ground; com IA+0x50: AI_Idle 0. */
export function fn_0x573198(wd: WorldRec, param_1: UnitTypeRec, param_2: number, h: ThinkHooks): void {
  aiGroupMaxScanRange(wd, param_1);
  let local_8 = param_1.members.first();
  while (local_8 !== 0) {
    const u = wd.map.unitAt(local_8), ai = u.ai, w = u.walk;
    let sVar2 = mapObjCellOf(u.mapObj) & 0xffff;
    let toLab = true;
    if (sVar2 === (ai.f0a & 0xffff)) {
      const iVar5 = mapObjSubCellCenter(u.mapObj);
      if (!(iVar5 === 0 || (ai.f50 >>> 0) !== 0)) {
        fn_0x56dbc6(wd, u);
        w.f90 = 0;
        toLab = false;
      }
    }
    if (toLab) {
      if ((w.f90 >>> 0) !== 0) {
        sVar2 = w.f76 & 0xffff;
        const sVar3 = mapObjCellOf(u.mapObj) & 0xffff;
        if (sVar2 === sVar3) {
          fn_0x56dbc6(wd, u);
          w.f90 = 0;
        }
      }
    }
    if ((ai.f50 >>> 0) === 0) {
      if ((param_1.stats.speedByte & 0xff) !== 0) ai.f6c = 1;
      aiMoveTo(u, ai.f0a & 0xffff);
      const iVar5 = fn_0x55cd50(wd.map, u, param_2 & 0xffff);
      if (iVar5 === 0 && (ai.f0a & 0xffff) === (param_2 & 0xffff)) {
        const uVar4 = mapObjCellOf(u.mapObj) & 0xffff;
        const bVar1 = aiTeleportTargetDist(uVar4, param_2 & 0xffff) & 0xff;
        if (bVar1 < 2) aiTaskStandGround(wd, u, h);
      }
    } else {
      aiIdle(wd, u, 0, h);
    }
    local_8 = param_1.members.nextAfter(local_8);
  }
}

/** 0x572e1e (thiscall; comando 5; célula): inimigos vistos; nenhum → andar do grupo (0x573198); senão alvos e cada unidade ataca o seu, senão AI_Idle 1. */
export function fn_0x572e1e(wd: WorldRec, param_1: UnitTypeRec, param_2: number, h: ThinkHooks): void {
  aiGroupVisibleEnemies(wd, param_1);
  const iVar1 = wd.cand.getCount();
  if (iVar1 === 0) {
    fn_0x573198(wd, param_1, param_2, h);
  } else {
    aiGroupAssignTargets(wd, param_1);
    for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) {
      const u = wd.map.unitAt(local_8);
      if ((u.ai.f20 >>> 0) === 0) aiIdle(wd, u, 1, h);
      else aiTaskAttack(wd, u, wd.map.unitAt(u.ai.f20), h);
    }
  }
}

/** 0x572ec4 (thiscall; comando 0x11, enxame): com todas a < 10 da célula +0xa (ou +0x15 > 50 pensamentos), sorteia uma direção
 *  (Rand_Range 0..7, sítio 0x572f68) e um novo ponto a 20 células dentro da área útil; depois 0x572e1e. */
export function fn_0x572ec4(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  const d = param_1.stats, m = wd.map;
  let bVar2 = 0;
  let local_10 = param_1.members.first();
  while (local_10 !== 0) {
    const uVar4 = mapObjCellOf(m.unitAt(local_10).mapObj) & 0xffff;
    const bVar3 = aiTeleportTargetDist(uVar4, d.f0a & 0xffff) & 0xff;
    if (bVar2 < bVar3) bVar2 = bVar3;
    local_10 = param_1.members.nextAfter(local_10);
  }
  if (bVar2 < 10 || 0x32 < (d.f15 & 0xff)) {
    let bVar1 = true;
    let local_18 = 0, local_1c = 0;
    while (bVar1) {
      const iVar6 = randRange(wd, 0, 7, 0x572f68);
      local_18 = ((d.f0a & 0xff) + m.i8(MAP_DIR_DX_OFF + iVar6) * 0x14) | 0;
      local_1c = (((d.f0a & 0xffff) >> 8) + m.i8(MAP_DIR_DY_OFF + iVar6) * 0x14) | 0;
      bVar1 = m.mem[MAP_RECT_OFF + 3]! < local_1c || local_1c < m.mem[MAP_RECT_OFF + 1]! || m.mem[MAP_RECT_OFF + 2]! < local_18 || local_18 < m.mem[MAP_RECT_OFF]!;
    }
    d.f0a = ((local_1c << 8) + local_18) & 0xffff;
    d.f15 = 0;
  }
  fn_0x572e1e(wd, param_1, d.f0a & 0xffff, h);
  d.f15 = (d.f15 + 1) & 0xff;
}

/** 0x57311c (thiscall; comando 0x13): AI_IdleAlt em cada unidade. */
export function fn_0x57311c(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) aiIdleAlt(wd, wd.map.unitAt(local_8), h);
}

/** 0x573159 (thiscall; comando −1): AI_Idle 0 (Stand ground) em cada unidade. */
export function fn_0x573159(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) aiIdle(wd, wd.map.unitAt(local_8), 0, h);
}

/** 0x57375a (cdecl; grupo): grupo sem unidades → comando −1. */
export function fn_0x57375a(param_1: UnitTypeRec): void {
  if (param_1.members.getCount() === 0) param_1.stats.f20 = 0xff;
}

/** 0x5700f3 AI_GroupThink (thiscall; mundo, grupo). */
export function aiGroupThink(wd: WorldRec, param_1: UnitTypeRec, h: ThinkHooks): void {
  fn_0x57375a(param_1);
  const cVar1 = i8(param_1.stats.f20);
  if (cVar1 === -1) {
    fn_0x573159(wd, param_1, h);
  } else {
    switch (cVar1) {
      case 0:
        for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) fn_0x56fe34(wd, wd.map.unitAt(local_8), h);
        break;
      case 1: aiGroupGuardState1(wd, param_1, h); break;
      case 2: fn_0x572d57(wd, param_1, i16(param_1.stats.f0a), h); break;
      case 3: fn_0x57309d(wd, param_1, h); break;
      case 4: fn_0x573198(wd, param_1, i16(param_1.stats.f0a), h); break;
      case 5: fn_0x572e1e(wd, param_1, i16(param_1.stats.f0a), h); break;
      case 0x11: fn_0x572ec4(wd, param_1, h); break;
      case 0x12: fn_0x5728fa(wd, param_1, h); break;
      case 0x13: fn_0x57311c(wd, param_1, h); break;
    }
  }
  aiGroupFlee(wd, param_1, h);
}

/** 0x570087 AI_PlayerThink (thiscall; mundo, jogador): cada grupo da lista +0x28; com mundo+0xbbe8 == 0 só os acordados (+0x45). */
export function aiPlayerThink(wd: WorldRec, param_1: PlayerRec, h: ThinkHooks): void {
  for (let local_8 = param_1.groups.first(); local_8 !== 0; local_8 = param_1.groups.nextAfter(local_8)) {
    const g = wd.groupAt(local_8);
    if ((wd.fbbe8 | 0) === 0) {
      if ((g.stats.f45 & 0xff) !== 0) aiGroupThink(wd, g, h);
    } else {
      aiGroupThink(wd, g, h);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- acordar os grupos

/** Índice na tabela de setores (mapa+0x92ecc+0x404 i32[34][34]): linha = bloco x + 1 + dr, coluna = bloco y + 1 + dc. */
const wakeOff = (row: number, col: number): number => MAP_WAKE_OFF + WAKE_TABLE_OFF + row * 0x88 + col * 4;

/** 0x55b879 (fastcall; setores): zera a tabela (+0x400, 0x1210 bytes), adormece os grupos dos jogadores de IA (+0x2c ≠ 0) e zera +0x1a4 de todas as unidades. */
export function fn_0x55b879(wd: WorldRec): void {
  const m = wd.map;
  m.mem.fill(0, MAP_WAKE_OFF + 0x400, MAP_WAKE_OFF + 0x400 + 0x1210);
  for (let local_8 = wd.players.first(); local_8 !== 0; local_8 = wd.players.nextAfter(local_8)) {
    const p = wd.playerAt(local_8);
    if ((p.f2c >>> 0) !== 0) {
      for (let local_28 = p.groups.first(); local_28 !== 0; local_28 = p.groups.nextAfter(local_28)) wd.groupAt(local_28).stats.f45 = 0;
    }
  }
  const local_1c = new CListPtrIter();
  let local_c = local_1c.first(wd.lists.all);
  while (local_c !== 0) {
    m.unitAt(local_c).f1a4 = 0;
    local_c = local_1c.next();
  }
}

/** 0x55aca2 (thiscall; setores, unidade): unidade do lado humano (dono+0x2c == 0) → a máscara do dono (+0x32) nos 5×5 blocos de 8×8 em
 *  volta do seu; unidade de IA ferida (vida < máx.) → o grupo acorda. */
export function fn_0x55aca2(wd: WorldRec, param_1: UnitRec): void {
  const m = wd.map;
  if ((param_1.owner.f2c >>> 0) === 0) {
    const iVar2 = (mapObjCellX(param_1.mapObj) & 0xff) >> 3;
    const iVar4 = ((mapObjCellY(param_1.mapObj) & 0xff) >> 3) + 1;
    const mask = param_1.owner.f32 & 0xffff;
    for (let dr = -1; dr <= 3; dr++) {
      for (let dc = -3; dc <= 1; dc++) {
        const off = wakeOff(iVar2 + dr, iVar4 + dc);
        m.dv.setUint32(off, (m.dv.getUint32(off, true) | mask) >>> 0, true);
      }
    }
  } else if (i16(param_1.f94) < i16(param_1.f96)) {
    param_1.type.stats.f45 = 1;
  }
}

/** 0x55b406 (thiscall; setores, unidade): bloco sem jogador humano → acorda só se o grupo é sempre acordado (+0x48); com jogador → acorda e
 *  +0x1a4 = a máscara do bloco. */
export function fn_0x55b406(wd: WorldRec, param_1: UnitRec): void {
  const m = wd.map;
  const bVar1 = mapObjCellX(param_1.mapObj) & 0xff, bVar2 = mapObjCellY(param_1.mapObj) & 0xff;
  const v = m.dv.getInt32(wakeOff((bVar1 >> 3) + 1, bVar2 >> 3), true);   // linha bx + 1, coluna by (o centro de 0x55aca2)
  if (v === 0) {
    if ((param_1.type.stats.f48 >>> 0) !== 0) {
      param_1.type.stats.f45 = 1;
      m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1614_OFF, m.i32(MAP_WAKE_OFF + WAKE_F1614_OFF) + 1, true);
      m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1624_OFF, m.i32(MAP_WAKE_OFF + WAKE_F1624_OFF) + 1, true);
    }
  } else {
    param_1.type.stats.f45 = 1;
    m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1614_OFF, m.i32(MAP_WAKE_OFF + WAKE_F1614_OFF) + 1, true);
    param_1.f1a4 = m.u16(wakeOff((bVar1 >> 3) + 1, bVar2 >> 3));
  }
}

/** 0x55b507 (thiscall; setores, objeto fixo): +0x42 = OR das máscaras dos blocos (x+2, y+1), (x+2, y−1), (x, y+1), (x, y−1) em volta do objeto. */
export function fn_0x55b507(wd: WorldRec, param_1: CellStructRec): void {
  const m = wd.map;
  const iVar2 = (mapObjCellX(param_1.mapObj) & 0xff) >> 3;
  const iVar3 = ((mapObjCellY(param_1.mapObj) & 0xff) >> 3) + 1;
  let v = m.u16(wakeOff(iVar2 + 2, iVar3));
  v |= m.u16(wakeOff(iVar2 + 2, iVar3 - 2));
  v |= m.u16(wakeOff(iVar2, iVar3));
  v |= m.u16(wakeOff(iVar2, iVar3 - 2));
  param_1.f42 = v & 0xffff;
}

/** 0x55b5f1 (fastcall; `this` = setores em mapa+0x92ecc): acorda os grupos a cada pensamento. */
export function fn_0x55b5f1(wd: WorldRec): void {
  const m = wd.map;
  fn_0x55b879(wd);
  m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1614_OFF, 0, true);
  m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1624_OFF, 0, true);
  const local_1c = new CListPtrIter();
  let local_20 = local_1c.first(wd.lists.all);   // [setores+0x1610] = o contentor das unidades
  while (local_20 !== 0) {
    fn_0x55aca2(wd, m.unitAt(local_20));
    local_20 = local_1c.next();
  }
  for (let local_10 = wd.players.first(); local_10 !== 0; local_10 = wd.players.nextAfter(local_10)) {
    const p = wd.playerAt(local_10);
    if ((p.f2c >>> 0) === 0 && (p.f38 >>> 0) !== 0) fn_0x55aca2(wd, m.unitAt(p.f38));
  }
  local_20 = local_1c.first(wd.lists.all);
  while (local_20 !== 0) {
    fn_0x55b406(wd, m.unitAt(local_20));
    local_20 = local_1c.next();
  }
  local_20 = local_1c.first(wd.lists.corpses);   // [[0x6044c4]+0x7c]+0xc
  while (local_20 !== 0) {
    const u = m.unitAt(local_20);
    const bVar1 = mapObjCellX(u.mapObj) & 0xff, bVar2 = mapObjCellY(u.mapObj) & 0xff;
    if (m.i32(wakeOff((bVar1 >> 3) + 1, bVar2 >> 3)) !== 0) {
      u.f1a4 = m.u16(wakeOff((bVar1 >> 3) + 1, bVar2 >> 3));
    }
    local_20 = local_1c.next();
  }
  for (let local_14 = wd.lists.structs.first(); local_14 !== 0; local_14 = wd.lists.structs.nextAfter(local_14)) {   // [[0x6044c4]+0x7c]+4
    fn_0x55b507(wd, m.structAt(local_14));
  }
  m.dv.setInt32(MAP_WAKE_OFF + WAKE_F1618_OFF, (wd.lists.all.getCount() - m.i32(MAP_WAKE_OFF + WAKE_F1614_OFF)) | 0, true);
}

// ---------------------------------------------------------------------------------------------------------- o pensamento

/** 0x56fe4d (thiscall; mundo, lista de jogadores): o pensamento de 1×/s do servidor (sem os cronômetros de perfil e a mensagem "Stats"). */
export function fn_0x56fe4d(wd: WorldRec, param_1: CListPtr, h: ThinkHooks): void {
  if ((wd.fbbe8 | 0) === 0) fn_0x55b5f1(wd);
  // 0x57485b: +0xd720, o script (0x574899 / 0x574ba1: game/src/script) e RemoveAll dos eventos
  wd.fd720 = (wd.fd720 + 1) | 0;
  wd.events.removeAll();
  for (let local_78 = param_1.first(); local_78 !== 0; local_78 = param_1.nextAfter(local_78)) aiPlayerThink(wd, wd.playerAt(local_78), h);
  h.traps?.(wd);   // 0x57a47d
  wd.fa4c = (wd.fa4c + 1) | 0;
}
