/**
 * Porta literal do servidor do allods2.exe: o andar (lote 5c). Ordem de andar por célula, perseguição, giro, a fórmula do
 * passo e o avanço da posição fina por tique, mais pôr/tirar a unidade das células. Uma função do exe = uma função daqui;
 * prova em sim/test/exe_walkaction.ts contra os pares do oráculo e tools/re/oracle/fuzz_walk.py (Unicorn).
 *
 * Portadas: 0x56e4ac Unit_WalkNear, 0x555411 Unit_ActionWalk, 0x55574d Unit_ActionChase, 0x555c7e (próximo passo),
 * 0x555b38 Path_ClearDynamic, 0x554fd2 (avanço por tique), 0x559195 Unit_WalkFormula, 0x55a147, 0x5551ef Unit_WalkWait,
 * 0x556454 Unit_TurnStep, 0x5568e4, 0x556b2c Dir_FromDelta16, 0x556d78, 0x556da2, 0x54f618, 0x556dcd AI_UnitDistance,
 * 0x55532d, 0x558f64, 0x55020a Unit_PlaceOnCells, 0x5503af, 0x550697, 0x55073f, 0x553891 Unit_RemoveFromCells, 0x56fc69,
 * 0x54ec6a Grid_UnitsInRings, 0x52b22a.
 * Não portadas (exec = 0 no corpus; lançam NotPorted): 0x55a96c Unit_TeleportTo (teleporte da célula), 0x4f0832 (objeto de
 * célula de tipo ≠ 0x17 ao entrar).
 *
 * Um tique de andar (medido na sonda): Unit_ActionMachine 0x50f12c → Unit_ActionDispatcher 0x56dca2. Com IA+9 == 3 (passo em
 * curso) o despachante chama Path_ClearDynamic 0x555b38 → 0x554fd2 (avanço por tique); com IA+9 == 0 e IA+8 == 1, chama
 * Unit_WalkNear 0x56e4ac → Unit_ActionWalk 0x555411 (no centro da célula: caminho e 0x555c7e → giro ou fórmula + 0x554fd2).
 */
import {
  cellIdxOff00000, fn_0x55687d, fn_0x55915a, fn_0x55f330, gridChebyshevDist, mapObjCellOf, mapObjCenterFraction, mapObjSetFine,
  mapObjSubCellCenter, occRecConstruct, occRecIsEmpty, unitPassMaskAnd,
} from "./walk";
import { crtFtol, mapObjCellX, mapObjCellY, mapObjFineX, mapObjFineY, unitCenterX, unitCenterY, vtGetSize } from "./path";
import {
  aiTeleportTargetDist, fn_0x54d72d, fn_0x5508a0, fn_0x550966, fn_0x550a53, fn_0x551edb, fn_0x5563ca, fn_0x55be86, fn_0x55f350,
  pathRefreshDynamic, unitFootprintCheck,
} from "./wave";
import { CListPtrIter, type CListPtr } from "./mfc";
import {
  MAP_DIR_CELL_OFF, MAP_DIR_DX_OFF, MAP_DIR_DY_OFF, MAP_DYN_LEN_OFF, MAP_DYN_TICKS_OFF, MAP_ALT_OFF, MAP_MASK_OFF,
  MAP_OCC_KIND_OFF, MAP_OCC_P04_OFF, MAP_OCC_P08_OFF, MAP_OCC_TX_OFF, MAP_OCC_TY_OFF, MAP_PATH_STATIC_N_OFF, MAP_SPEED_MUL_OFF,
  OccRec, type MapRec, type UnitRec, type WorldRec,
} from "./types";

/** Função do exe ainda não portada, alcançada só por um ramo que o corpus não executa (exec = 0). */
export class NotPorted extends Error {
  constructor(readonly addr: string) { super(`NotPorted(${addr})`); }
}

/** 0x582c40 (CRT abs, cdecl). */
function crtAbs(v: number): number {
  return (v < 0 ? -v : v) | 0;
}

const i8 = (v: number): number => (v << 24) >> 24;
const i16 = (v: number): number => (v << 16) >> 16;

/** 0x556447 / 0x55643a / 0x55c420: destrutores e métodos vazios (sem estado). */
function nop(): void {}

/** 0x55a96c Unit_TeleportTo (thiscall, ret 0xc): exec = 0 no corpus; o fecho (Unit_CanPlaceAt, Server_Event, visão) é de outra etapa. */
export function unitTeleportTo(_m: MapRec, _u: UnitRec, _x: number, _y: number): number {
  throw new NotPorted("0x55a96c");
}

// ------------------------------------------------------------------------------------------------------- giro e direção

/** 0x5551ef Unit_WalkWait (cdecl): aproxima a direção atual da desejada em `turnRate` (ou chega nela). */
export function unitWalkWait(u: UnitRec): void {
  const w = u.walk;
  const bVar1 = w.dir & 0xff;
  const uVar2 = crtAbs((w.dir & 0xff) - (w.dirTarget & 0xff));
  let local8 = uVar2 & 0xffff;
  if (0x80 < local8) local8 = (0x100 - i16(uVar2)) & 0xffff;
  if (local8 < (w.turnRate & 0xff)) {
    w.dir = w.dirTarget & 0xff;
  } else if (((bVar1 + local8) & 0xff) === (w.dirTarget & 0xff)) {
    w.dir = (w.dir + w.turnRate) & 0xff;
  } else if (((bVar1 - local8) & 0xff) === (w.dirTarget & 0xff)) {
    w.dir = (w.dir - w.turnRate) & 0xff;
  }
}

/**
 * 0x556454 Unit_TurnStep (cdecl): fixa a direção desejada `d`. Parado e com diferença ≤ 0x20 (dos dois lados), vira de uma
 * vez (1 tique); senão um passo de 0x5551ef e conta os tiques previstos (diferença / turnRate, para cima).
 */
export function unitTurnStep(u: UnitRec, d: number): void {
  const w = u.walk;
  w.dirTarget = d & 0xff;
  const uVar1 = crtAbs((w.dir & 0xff) - (w.dirTarget & 0xff));
  let local8 = uVar1 & 0xffff;
  if ((w.turning | 0) === 0) w.f9d = 0;
  if ((w.turning | 0) === 0 && ((uVar1 & 0xffff) < 0x21 || (0x100 - (uVar1 & 0xffff)) < 0x21)) {
    w.dir = w.dirTarget & 0xff;
    w.turnTicks = 1;
  } else {
    unitWalkWait(u);
    if (0x80 < (uVar1 & 0xffff)) local8 = (0x100 - i16(uVar1)) & 0xffff;
    const rate = w.turnRate & 0xff;
    if (rate === 0) throw new Error("0x556454: divisão por zero (#DE no exe)");
    w.turnTicks = Math.floor(local8 / rate) & 0xff;
    if ((Math.imul(w.turnTicks & 0xff, rate) - local8) !== 0) w.turnTicks = (w.turnTicks + 1) & 0xff;
  }
  w.turning = 1;
  w.f9d = (w.f9d + 1) & 0xff;
  if ((w.dir & 0xff) === (w.dirTarget & 0xff)) w.turning = 0;
}

/** Setor de 16 → direção de 8 em 1/256 de volta: `(s+1)>>1 << 5` (s ≠ 0), no byte (16 → 0). */
function sectorToDir(b: number): number {
  if (b !== 0) b = (b + 1) & 0xff;
  return ((b >> 1) << 5) & 0xff;
}

/**
 * Corpo comum de 0x5568e4 e 0x556b2c (setor de 16 pelo delta): mesmos testes, mesma ordem (|dy| < |dx| primeiro). Os dois
 * são cópias no exe; só a origem do delta muda.
 */
function sector16(dx: number, dy: number): number {
  const l14 = dx < 1 ? (-dx) & 0xffff : dx & 0xffff;
  const l8 = dy < 1 ? (-dy) & 0xffff : dy & 0xffff;
  let b: number;
  if (dx < 1) {
    if (dy < 1) {
      if (l8 < l14) b = l8 * 2 < l14 ? 0xc : 0xd;
      else b = l14 * 2 < l8 ? 0xf : 0xe;
    } else if (l8 < l14) b = l8 * 2 < l14 ? 0xb : 10;
    else b = l14 * 2 < l8 ? 8 : 9;
  } else if (dy < 1) {
    if (l8 < l14) b = l8 * 2 < l14 ? 3 : 2;
    else b = l14 * 2 < l8 ? 0 : 1;
  } else if (l8 < l14) b = l8 * 2 < l14 ? 4 : 5;
  else b = l14 * 2 < l8 ? 7 : 6;
  return sectorToDir(b);
}

/** 0x5568e4 (cdecl): direção (1/256 de volta, múltiplo de 0x20) do centro de `a` ao de `b`. Devolve AL. */
export function fn_0x5568e4(a: UnitRec, b: UnitRec): number {
  let uVar1 = unitCenterX(b);
  let uVar2 = unitCenterX(a);
  const dx = (uVar1 & 0xffff) - (uVar2 & 0xffff);
  uVar1 = unitCenterY(b);
  uVar2 = unitCenterY(a);
  const dy = (uVar1 & 0xffff) - (uVar2 & 0xffff);
  return sector16(dx, dy);
}

/** 0x556b2c Dir_FromDelta16 (cdecl): direção da célula da unidade até a célula `cell` (y<<8|x). Devolve AL. */
export function dirFromDelta16(u: UnitRec, cell: number): number {
  const dx = (cell & 0xff) - mapObjCellX(u.mapObj);
  const dy = ((cell & 0xffff) >> 8) - mapObjCellY(u.mapObj);
  return sector16(dx, dy);
}

/** 0x556d78 (cdecl): gira um passo para a unidade `t`. */
export function fn_0x556d78(u: UnitRec, t: UnitRec): void {
  const uVar1 = fn_0x5568e4(u, t);
  unitTurnStep(u, uVar1 & 0xff);
}

/** 0x556da2 (cdecl): gira um passo para a célula `cell`. */
export function fn_0x556da2(u: UnitRec, cell: number): void {
  const cVar1 = dirFromDelta16(u, cell & 0xffff);
  unitTurnStep(u, cVar1);
}

/**
 * 0x54f618 (cdecl): direção de 8 (1/256 de volta) da posição fina até o centro da célula `cell`; no próprio centro fica a
 * direção atual. Devolve EAX inteiro (dir << 5 pode passar de 0xff).
 */
export function fn_0x54f618(u: UnitRec, cell: number): number {
  let l10 = u.walk.dir & 0xff;
  const fx = mapObjFineX(u.mapObj);
  const iVar2 = ((cell & 0xff) * 0x100 + 0x80) - fx;
  const fy = mapObjFineY(u.mapObj);
  const iVar3 = (((cell & 0xffff) >> 8) * 0x100 + 0x80) - fy;
  if (iVar2 < 1) {
    if (iVar2 < 0) {
      if (iVar3 < 1) l10 = iVar3 < 0 ? 7 : 6;
      else l10 = 5;
    } else if (iVar3 < 1) {
      if (iVar3 < 0) l10 = 0;
    } else l10 = 4;
  } else if (iVar3 < 1) l10 = iVar3 < 0 ? 1 : 2;
  else l10 = 3;
  return (l10 << 5) | 0;
}

/**
 * 0x556dcd AI_UnitDistance (thiscall, ret 8): distância de Chebyshev em células entre as bordas dos quadrados das duas
 * unidades (frações incluídas), + 1. O lado vem do slot +0x1c (p1 e depois p2).
 */
export function aiUnitDistance(_m: MapRec, p1: UnitRec, p2: UnitRec): number {
  const bVar1 = vtGetSize(p1) & 0xff;
  const bVar2 = vtGetSize(p2) & 0xff;
  const sVar3 = mapObjFineX(p1.mapObj);
  const sVar4 = mapObjFineY(p1.mapObj);
  const sVar5 = mapObjFineX(p2.mapObj);
  const sVar6 = mapObjFineY(p2.mapObj);
  let l24 = crtAbs(((sVar3 + (bVar1 - 1) * 0x80) & 0xffff) - ((sVar5 + (bVar2 - 1) * 0x80) & 0xffff));
  l24 = (l24 + (bVar1 + bVar2) * -0x80) | 0;
  if (l24 < 0) l24 = 0;
  let l28 = crtAbs(((sVar4 + (bVar1 - 1) * 0x80) & 0xffff) - ((sVar6 + (bVar2 - 1) * 0x80) & 0xffff));
  l28 = (l28 + (bVar1 + bVar2) * -0x80) | 0;
  if (l28 < 0) l28 = 0;
  const l14 = l28 < l24 ? l24 : l28;
  return ((l14 + ((l14 >> 31) & 0xff)) >> 8) + 1;
}

/** 0x55532d (thiscall, ret 0xc): 1 se a unidade já olha para `t` e está a no máximo `range` (AI_UnitDistance). */
export function fn_0x55532d(m: MapRec, u: UnitRec, t: UnitRec, range: number): number {
  mapObjSubCellCenter(u.mapObj);
  const bVar1 = u.walk.dir & 0xff;
  const uVar2 = fn_0x5568e4(u, t);
  if (bVar1 === (uVar2 & 0xff) && (aiUnitDistance(m, u, t) & 0xff) <= (range & 0xff)) return 1;
  return 0;
}

/** 0x558f64 (cdecl): cabeça do caminho estático se ela é vizinha (Chebyshev 1) da célula atual, senão 0. Devolve AX. */
export function fn_0x558f64(u: UnitRec): number {
  if (!u.pathStatic.isEmpty()) {
    const uVar1 = u.pathStatic.getHead();
    const uVar7 = uVar1 >> 8;
    const uVar8 = uVar1 & 0xff;
    const y = mapObjCellY(u.mapObj);
    const x = mapObjCellX(u.mapObj);
    const cVar4 = gridChebyshevDist(x, y, uVar8, uVar7);
    return cVar4 === 1 ? uVar1 : 0;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------------- fórmula e avanço

/**
 * 0x55a147 (thiscall, ret 4): custo de passo da célula (grade em this+0). Célula com registro de ocupação (máscara 0x20) cujo
 * byte +2 ≠ 0: o 1.º dos seis objetos (+0x14..+0x28) responde 1 a 0x55f350 (sempre), e o custo da célula é DIVIDIDO por 4
 * na própria grade (escrita permanente) e devolvido. Registro lido num OccRec local (não no corrente do mapa).
 */
export function fn_0x55a147(m: MapRec, cell: number): number {
  const c = cell & 0xffff;
  if ((m.mem[c + MAP_MASK_OFF] & 0x20) === 0) return m.mem[cellIdxOff00000(c)];
  const rec = occRecConstruct(new OccRec());
  if (!m.occ.lookup(c, rec)) {
    const v = m.mem[cellIdxOff00000(c)];
    nop(); // 0x55c420
    return v;
  }
  if ((rec.b[2] & 0xff) === 0) {
    const v = m.mem[cellIdxOff00000(c)];
    nop();
    return v;
  }
  for (let l50 = 0; l50 < 6; l50++) {
    if (fn_0x55f350() !== 0) {
      m.mem[c] = (m.mem[c] >> 2) & 0xff;
      const v = m.mem[c];
      nop();
      return v;
    }
  }
  nop();
  return m.mem[cellIdxOff00000(c)];
}

/**
 * 0x559195 Unit_WalkFormula (thiscall, ret 0xc): velocidade do passo da célula `cell` na direção `dir` e o avanço fino por
 * tique. Tipo 1 (slot +0x20): velocidade × mapa+0x58d84 corrigida pela diferença de altura (±0x20, em 1/64) e dividida pela
 * média dos custos das duas células (0 → 8); outros tipos: a velocidade. Limita a 1..0x3f. Direção diagonal: dx/dy =
 * ftol(v·d·0.707) (x87: `fild` do produto inteiro × qword 0.707 em 0x5d1aa8 com FPCW 0x27f = produto em double; ftol trunca).
 * Tiques por célula = ⌈0x100 / |dx ou dy|⌉. Devolve a velocidade.
 */
export function unitWalkFormula(m: MapRec, u: UnitRec, cell: number, dir: number): number {
  const w = u.walk;
  const bVar7 = (((dir + 0x10) & 0xff) >> 5) & 0xff;
  const uVar4 = ((cell & 0xffff) + m.i32(MAP_DIR_CELL_OFF + bVar7 * 4)) & 0xffff;
  const cVar1 = fn_0x55f330(u);
  let l14: number;
  if (cVar1 === 1) {
    let lc = i8(m.i8(MAP_ALT_OFF + (cell & 0xffff)) - m.i8(MAP_ALT_OFF + uVar4));
    if (0x20 < crtAbs(lc)) lc = lc < 0 ? -0x20 : 0x20;
    const uVar6 = fn_0x55915a(u);
    l14 = Math.imul(uVar6, m.i32(MAP_SPEED_MUL_OFF));
    if (lc < 0) l14 = (l14 - (Math.imul(l14, crtAbs(lc)) >> 6)) | 0;
    else l14 = (l14 + (Math.imul(l14, lc) >> 6)) | 0;
    const c1 = fn_0x55a147(m, cell);
    const c2 = fn_0x55a147(m, uVar4);
    let l20 = (((c1 & 0xff) + (c2 & 0xff)) & 0xff) >> 1;
    if (l20 === 0) l20 = 8;
    l14 = Math.trunc(l14 / l20) | 0;
  } else {
    const t = Math.imul(fn_0x55915a(u), 8);
    l14 = (t + ((t >> 31) & 7)) >> 3;
  }
  if (l14 < 1) l14 = 1;
  if (0x3f < l14) l14 = 0x3f;
  w.stepSpeed = l14 & 0xffff;
  w.stepDir = bVar7;
  const ddx = m.i8(MAP_DIR_DX_OFF + bVar7);
  const ddy = m.i8(MAP_DIR_DY_OFF + bVar7);
  if (Math.imul(ddx, ddy) === 0) {
    w.stepDx = i8(Math.imul(l14, ddx));
    w.stepDy = i8(Math.imul(l14, ddy));
  } else {
    w.stepDx = i8(crtFtol(Math.imul(l14, ddx) * 0.707));
    w.stepDy = i8(crtFtol(Math.imul(l14, ddy) * 0.707));
  }
  let l8 = (w.stepDx !== 0 ? crtAbs(w.stepDx) : crtAbs(w.stepDy)) & 0xff;
  if (l8 === 0) l8 = 1;
  w.stepTicks = Math.trunc(0x100 / l8) & 0xffff;
  if (0x100 % l8 !== 0) w.stepTicks = (w.stepTicks + 1) & 0xffff;
  return l14;
}

/**
 * 0x554fd2 (thiscall, ret 4): O AVANÇO POR TIQUE. Conta o tique do passo (+0xac), soma (dx,dy) à posição fina (direções 1 e
 * 5 que caem exatamente num canto recuam 1 em x); dentro da mesma célula só grava a posição (0x54fc41); ao trocar de célula
 * tira a pegada e a unidade das células antigas, grava, põe nas novas e marca a pegada na célula antiga como alvo. Ao
 * completar os tiques do passo, volta a fração ao centro (0x5551d6).
 */
export function fn_0x554fd2(m: MapRec, u: UnitRec): void {
  const w = u.walk;
  const sVar1 = mapObjFineX(u.mapObj);
  const sVar2 = mapObjFineY(u.mapObj);
  w.stepTick = (w.stepTick + 1) & 0xffff;
  let uVar3 = (sVar1 + i8(w.stepDx)) & 0xffff;
  const uVar6 = (sVar2 + i8(w.stepDy)) & 0xffff;
  if ((i16(w.stepDir) === 1 || i16(w.stepDir) === 5) && (uVar3 & 0xff) === 0 && (uVar6 & 0xff) === 0) {
    uVar3 = (uVar3 - 1) & 0xffff;
  }
  if (((sVar1 >> 8) & 0xff) === uVar3 >> 8 && ((sVar2 >> 8) & 0xff) === uVar6 >> 8) {
    mapObjSetFine(u.mapObj, uVar3, uVar6);
  } else {
    const uVar4 = mapObjCellOf(u.mapObj);
    fn_0x55be86(m, u, 0, 2);
    fn_0x550697(m, u);
    mapObjSetFine(u.mapObj, uVar3, uVar6);
    unitPlaceOnCells(m, u);
    fn_0x55be86(m, u, uVar4, 0);
  }
  if ((w.stepTicks & 0xffff) <= (w.stepTick & 0xffff)) mapObjCenterFraction(u.mapObj);
}

/**
 * 0x555c7e (thiscall, ret 4): começa o próximo passo pela cabeça do caminho dinâmico: marca a pegada no destino; já virado
 * para ele, calcula a fórmula e dá o 1.º tique (0x554fd2); senão gira um passo. Caminho vazio: só gira (0x5551ef).
 */
export function fn_0x555c7e(m: MapRec, u: UnitRec): void {
  const w = u.walk;
  if (!u.pathDynamic.isEmpty()) {
    w.nextCell = u.pathDynamic.getHead();
    w.stepFrom = mapObjCellOf(u.mapObj);
    w.f9c = 0;
    fn_0x55be86(m, u, 0, 2);
    fn_0x55be86(m, u, w.nextCell, 0);
    const iVar5 = fn_0x54f618(u, w.nextCell);
    w.dirTarget = iVar5 & 0xff;
    if ((w.dir & 0xff) === (w.dirTarget & 0xff)) {
      const cVar6 = i8(w.dir);
      const uVar3 = mapObjCellOf(u.mapObj);
      unitWalkFormula(m, u, uVar3, cVar6);
      w.stepTick = 0;
      fn_0x554fd2(m, u);
    } else {
      unitTurnStep(u, w.dirTarget);
    }
  } else {
    unitWalkWait(u);
  }
}

/**
 * 0x555b38 Path_ClearDynamic (thiscall, ret 4): um tique de passo (0x554fd2); trocou de célula: relê a velocidade da célula
 * (0x55687d → andar+0x72). Chegou ao centro: zera o passo, refaz a pegada, esvazia o caminho dinâmico e, se a célula tem
 * objeto de teleporte (tipo 0x17), teleporta (não portado: exec 0).
 */
export function pathClearDynamic(m: MapRec, u: UnitRec): void {
  const w = u.walk;
  const sVar4 = mapObjCellOf(u.mapObj);
  fn_0x554fd2(m, u);
  const sVar5 = mapObjCellOf(u.mapObj);
  if (sVar4 !== sVar5) {
    const y = mapObjCellY(u.mapObj);
    const x = mapObjCellX(u.mapObj);
    const uVar6 = fn_0x55687d(m, u, x, y);
    w.f72 = uVar6 & 0xffff;
  }
  if (mapObjSubCellCenter(u.mapObj) !== 0) {
    w.stepTicks = 0;
    w.stepTick = 0;
    w.stepSpeed = 0;
    fn_0x55be86(m, u, 0, 2);
    fn_0x55be86(m, u, 0, 1);
    u.pathDynamic.removeAll();
    const c = mapObjCellOf(u.mapObj);
    if (m.occ.lookup(c, m.occCur) && m.mem[MAP_OCC_KIND_OFF] === 0x17) {
      unitTeleportTo(m, u, m.mem[MAP_OCC_TX_OFF], m.mem[MAP_OCC_TY_OFF]);
    }
  }
}

// --------------------------------------------------------------------------------------------- ordens de andar

/**
 * 0x555411 Unit_ActionWalk (thiscall, ret 0xc): ordem de andar até `cell`, parando a `near` células (Chebyshev). Fora do
 * centro da célula: um tique (0x555b38). No centro e longe: refaz o caminho estático quando o destino mudou ou já se refez
 * mais que mapa+0x5858c vezes; no fim do estático, chegou (+0x90 = 1); senão, com o dinâmico vazio ou velho (mais que
 * mapa+0x58590 tiques), tenta o atalho da célula vizinha (0x558f64/0x56fc69) ou refaz o dinâmico, e dá o passo (0x555c7e).
 * Perto (≤ near) com near ≠ 0: só gira para o destino.
 */
export function unitActionWalk(m: MapRec, u: UnitRec, cell: number, near: number): void {
  const w = u.walk;
  const uVar5 = cell & 0xffff;
  const uVar4 = mapObjCellOf(u.mapObj);
  const bVar1 = aiTeleportTargetDist(uVar4, cell & 0xffff);
  if (mapObjSubCellCenter(u.mapObj) === 0) {
    pathClearDynamic(m, u);
  } else if ((near & 0xff) < bVar1) {
    w.f78 = (w.f78 + 1) & 0xff;
    if ((w.dest & 0xffff) !== (cell & 0xffff) || m.i32(MAP_PATH_STATIC_N_OFF) < (w.f09 & 0xff)) {
      fn_0x54d72d(m, u, cell & 0xff, (cell >> 8) & 0xff, 1, null);
      w.f90 = 0;
      w.dest = uVar5;
      if (!u.pathStatic.isEmpty()) {
        w.f76 = u.pathStatic.getTail();
      } else {
        w.f76 = mapObjCellOf(u.mapObj);
        mapObjCellOf(u.mapObj);
        nop(); // 0x556447
        nop();
        w.f98 = 1;
      }
      w.f09 = 0;
      u.pathDynamic.removeAll();
    }
    const sVar6 = mapObjCellOf(u.mapObj);
    if (sVar6 === (w.f76 & 0xffff)) {
      w.f90 = 1;
    } else {
      let lc = 0;
      if (u.pathDynamic.isEmpty() || m.i32(MAP_DYN_TICKS_OFF) < (w.f78 & 0xff)) {
        const uVar7 = fn_0x558f64(u) & 0xffff;
        lc = 0;
        if (uVar7 !== 0 && unitFootprintCheck(m, u, uVar7, 0) === 0) {
          lc = fn_0x56fc69(m.world!, u, uVar7) & 0xff;
        }
        if (lc !== 0) {
          const cVar3 = dirFromDelta16(u, uVar7);
          if ((w.dir & 0xff) === (cVar3 & 0xff)) {
            u.ai.task = 0;
          } else {
            fn_0x556da2(u, uVar7);
            u.ai.task = 10;
          }
        }
        if (lc === 0) {
          pathRefreshDynamic(m, u, null);
          w.f09 = (w.f09 + 1) & 0xff;
          w.f78 = 0;
        }
      }
      if (lc === 0) fn_0x555c7e(m, u);
    }
  } else if ((near & 0xff) !== 0) {
    fn_0x556da2(u, cell & 0xffff);
  }
}

/**
 * 0x55574d Unit_ActionChase (thiscall, ret 0xc): perseguir `t` até `range` (AI_UnitDistance). Fora do centro: um tique.
 * No centro e longe: alvo novo zera o caminho; o estático (até a célula do alvo) é refeito quando a contagem passa de
 * tamanho/3 + 1 (onda se o caminho anterior era longo, senão a lista de uma célula); depois o dinâmico (se virado para o
 * passo) e o passo (0x555c7e). No alcance: gira para o alvo (0x556d78).
 */
export function unitActionChase(m: MapRec, u: UnitRec, t: UnitRec, range: number): void {
  const w = u.walk;
  const sVar3 = mapObjCellOf(t.mapObj);
  const uVar6 = aiUnitDistance(m, u, t);
  if (mapObjSubCellCenter(u.mapObj) === 0) {
    pathClearDynamic(m, u);
  } else if ((range & 0xff) < (uVar6 & 0xff)) {
    w.f78 = (w.f78 + 1) & 0xff;
    if ((w.chaseTarget >>> 0) !== (t.addr >>> 0)) {
      w.f09 = 0xff;
      u.pathStatic.removeAll();
      w.f8a = 0xff;
      w.f76 = sVar3;
      w.f8c = sVar3;
    }
    const bVar1 = w.f09 & 0xff;
    const iVar7 = u.pathStatic.getCount();
    if (Math.trunc(iVar7 / 3) + 1 < bVar1) {
      if (m.i32(MAP_DYN_LEN_OFF) < (w.f8a & 0xffff)) {
        fn_0x54d72d(m, u, sVar3 & 0xff, (sVar3 >> 8) & 0xff, 1, t);
      } else {
        u.pathStatic.removeAll();
        u.pathStatic.addTail(w.f76);
      }
      w.f8a = u.pathStatic.getCount() & 0xffff;
      w.dest = sVar3;
      if (!u.pathStatic.isEmpty()) {
        w.f76 = u.pathStatic.getTail();
        w.f8c = sVar3;
      } else {
        w.f76 = mapObjCellOf(u.mapObj);
        w.f8c = sVar3;
        mapObjCellOf(u.mapObj);
        nop(); // 0x556447
        nop();
        w.f98 = 1;
      }
      w.chaseTarget = t.addr >>> 0;
      w.f09 = 0;
      if (m.i32(MAP_DYN_LEN_OFF) < (w.f8a & 0xffff)) u.pathDynamic.removeAll();
    }
    const sVar5 = mapObjCellOf(u.mapObj);
    if (sVar5 === (w.f76 & 0xffff) && (w.f8c & 0xffff) === sVar3) {
      w.f09 = (w.f09 + 1) & 0xff;
      w.chaseTarget = 0;
    } else {
      if ((u.pathDynamic.isEmpty() || m.i32(MAP_DYN_TICKS_OFF) < (w.f78 & 0xff)) && (w.dir & 0xff) === (w.dirTarget & 0xff)) {
        pathRefreshDynamic(m, u, t);
        w.f94 = sVar3;
        w.f96 = mapObjCellOf(u.mapObj);
        w.f09 = (w.f09 + 1) & 0xff;
        w.f78 = 0;
      }
      fn_0x555c7e(m, u);
    }
  } else {
    fn_0x556d78(u, t);
  }
}

/**
 * 0x56e4ac Unit_WalkNear (thiscall, ret 0xc; `this` = mundo): andar+0x6c = 1; destino novo força refazer (andar+9 = 0xff);
 * Unit_ActionWalk no mapa do mundo; se ficou fora do centro da célula, IA+9 = 3 (o despachante continua o passo nos tiques
 * seguintes por 0x555b38) e IA+0x15 = 0; ação da unidade = 1.
 */
export function unitWalkNear(wd: WorldRec, u: UnitRec, cell: number, near: number): void {
  u.walk.f6c = 1;
  if ((u.walk.dest & 0xffff) === (cell & 0xffff)) {
    unitActionWalk(wd.map, u, cell & 0xffff, near);
  } else {
    u.walk.f09 = 0xff;
    unitActionWalk(wd.map, u, cell & 0xffff, near);
  }
  if (mapObjSubCellCenter(u.mapObj) === 0) {
    u.ai.sub = 3;
    u.ai.f15 = 0;
  }
  u.act = 1;
}

// ------------------------------------------------------------------------------------------- células e vizinhos

/** 0x52b22a (thiscall): AddTail no CList<void*> em this+4 (`l` = essa lista). */
export function fn_0x52b22a(l: CListPtr, p: number): void {
  l.addTail(p);
}

/**
 * 0x54ec6a Grid_UnitsInRings (thiscall, ret 8): lista (mapa+0x54010) das unidades nas células com registro de ocupação, da
 * célula `cell` e dos anéis 1..rings (por anel: x de −r a r, linha de baixo e de cima; fora dos cantos, coluna direita e
 * esquerda). Índices sem máscara de 16 bits na leitura da grade, como no exe. Devolve a lista (o exe devolve mapa+0x5400c).
 */
export function gridUnitsInRings(m: MapRec, cell: number, rings: number): CListPtr {
  const c = cell & 0xffff;
  m.ringUnits.removeAll();
  if (unitPassMaskAnd(m.mem[MAP_MASK_OFF + c], 0x20) !== 0) {
    const p = fn_0x551edb(m, c);
    if (p !== 0) fn_0x52b22a(m.ringUnits, p);
  }
  for (let b = 1; b < (rings & 0xff) + 1; b = (b + 1) & 0xff) {
    for (let l14 = -b; l14 < b + 1; l14++) {
      ringCell(m, b * 0x100 + l14 + c);
      ringCell(m, c + b * -0x100 + l14);
      if (crtAbs(l14) !== b) {
        ringCell(m, c + l14 * 0x100 + b);
        ringCell(m, (c + l14 * 0x100) - b);
      }
    }
  }
  return m.ringUnits;
}

/** Um dos quatro blocos iguais do laço de 0x54ec6a: grade+0x10000 lida em `i` (int), unidade da célula (short) na lista. */
function ringCell(m: MapRec, i: number): void {
  if (unitPassMaskAnd(m.mem[MAP_MASK_OFF + (i | 0)], 0x20) !== 0) {
    const p = fn_0x551edb(m, i & 0xffff);
    if (p !== 0) fn_0x52b22a(m.ringUnits, p);
  }
}

/**
 * 0x56fc69 (thiscall, ret 8; `this` = mundo): a célula vizinha `cell` (cabeça do caminho estático, bloqueada) é de uma
 * unidade que vai sair dela? Só para unidades de lado 1 cujo dono tem +0x2c = 0. 1 = a ocupante está a meio passo (e não é
 * a nossa próxima célula); 2 = há quem esteja saindo de lá a meio passo, ou a ocupante anda (IA 1/4) e não é o nosso alvo
 * IA+0xa; 0 = não. Devolve AL.
 */
export function fn_0x56fc69(wd: WorldRec, u: UnitRec, cell: number): number {
  const m = wd.map;
  const it = new CListPtrIter(); // 0x53b060
  let l8 = fn_0x551edb(m, cell & 0xffff);
  mapObjCellOf(u.mapObj);
  const cVar1 = vtGetSize(u);
  if ((cVar1 & 0xff) !== 1) return 0;
  if (u.owner.f2c !== 0) return 0;
  if ((u.walk.footCell & 0xffff) === (cell & 0xffff)) return 0;
  if (l8 === 0) {
    const l = gridUnitsInRings(m, cell & 0xffff, 1);
    let p = it.first(l);
    while (p !== 0) {
      const o = m.unitAt(p);
      if ((o.walk.stepFrom & 0xffff) === (cell & 0xffff) && mapObjSubCellCenter(o.mapObj) === 0) return 2;
      p = it.next();
    }
    if (l8 === 0) return 0;
  }
  const o = m.unitAt(l8);
  if (i16(o.f94) < 1) {
    l8 = 0;
    return 0;
  }
  if (mapObjSubCellCenter(o.mapObj) === 0) {
    return (u.walk.nextCell & 0xffff) === (cell & 0xffff) ? 0 : 1;
  }
  if ((o.ai.task & 0xff) === 1 || (o.ai.task & 0xff) === 4) {
    return (u.ai.f0a & 0xffff) === (cell & 0xffff) ? 0 : 2;
  }
  return 0;
}

/**
 * 0x55073f (thiscall, ret 0xc): tira a unidade do registro de ocupação da célula (x,y): zera o ponteiro do tipo dela
 * (occCur+4 para tipos 1/2, +8 para 3; já nulo → 0), grava o registro, reaplica às grades e apaga o registro vazio. Guarda a
 * posição em andar+0x86..0x89. Sem registro → 0.
 */
export function fn_0x55073f(m: MapRec, u: UnitRec, x: number, y: number): number {
  const uVar8 = ((y & 0xff) * 0x100 + (x & 0xff)) & 0xffff;
  if (!m.occ.lookup(uVar8, m.occCur)) return 0;
  const bVar2 = fn_0x55f330(u);
  if (bVar2 !== 0) {
    if (bVar2 < 3) {
      if (m.u32(MAP_OCC_P04_OFF) === 0) return 0;
      m.setU32(MAP_OCC_P04_OFF, 0);
    } else if (bVar2 === 3) {
      if (m.u32(MAP_OCC_P08_OFF) === 0) return 0;
      m.setU32(MAP_OCC_P08_OFF, 0);
    }
  }
  m.occ.setAt(uVar8, m.occCur);
  fn_0x550a53(m, uVar8);
  if (occRecIsEmpty(m.occCur) !== 0) fn_0x550966(m, uVar8);
  u.walk.f86 = mapObjCellX(u.mapObj);
  u.walk.f87 = mapObjCellY(u.mapObj);
  u.walk.f88 = mapObjFineX(u.mapObj) & 0xff;
  u.walk.f89 = mapObjFineY(u.mapObj) & 0xff;
  return 1;
}

/** 0x550697 (thiscall, ret 4): 0x55073f em cada célula do quadrado da unidade (y por fora); 0 na 1.ª que falha. */
export function fn_0x550697(m: MapRec, u: UnitRec): number {
  const uVar3 = vtGetSize(u);
  const cVar1 = mapObjCellX(u.mapObj);
  const cVar2 = mapObjCellY(u.mapObj);
  for (let l14 = 0; ; l14++) {
    if ((uVar3 & 0xff) <= l14) return 1;
    for (let l18 = 0; l18 < (uVar3 & 0xff); l18++) {
      if (fn_0x55073f(m, u, (cVar1 + l18) & 0xff, (cVar2 + l14) & 0xff) === 0) return 0;
    }
  }
}

/** 0x553891 Unit_RemoveFromCells (thiscall, ret 4): tira a pegada (0x55be86 modo 2) e a unidade das células. */
export function unitRemoveFromCells(m: MapRec, u: UnitRec): number {
  fn_0x55be86(m, u, 0, 2);
  const iVar1 = fn_0x550697(m, u);
  return iVar1 !== 0 ? 1 : 0;
}

/**
 * 0x5503af (thiscall, ret 0xc): põe a unidade no registro de ocupação da célula (x,y), criando-o (0x5508a0) se não existe.
 * Tipos 1/2 usam occCur+4, tipo 3 occCur+8 (ocupado → 0). Registro existente com objeto (occCur+0x34): teleporte (0x17)
 * guarda o destino em IA+0xb0; outro tipo chama 0x4f0832 (não portado: exec 0; 0x519408 devolve sempre 1).
 */
export function fn_0x5503af(m: MapRec, u: UnitRec, x: number, y: number): number {
  const sVar5 = ((y & 0xff) * 0x100 + (x & 0xff)) & 0xffff;
  const bVar1 = fn_0x55f330(u);
  if (bVar1 === 0) return 0;
  if (bVar1 < 3) {
    if (!m.occ.lookup(sVar5, m.occCur)) {
      fn_0x5508a0(m, sVar5);
      if (m.occ.lookup(sVar5, m.occCur)) {
        m.setU32(MAP_OCC_P04_OFF, u.addr);
        m.occ.setAt(sVar5, m.occCur);
        fn_0x550a53(m, sVar5);
        return 1;
      }
      return 0;
    }
    const kind = m.mem[MAP_OCC_KIND_OFF];
    if (kind !== 0) {
      if (kind === 0x17) {
        u.ai.fb0 = (m.mem[MAP_OCC_TY_OFF] * 0x100 + m.mem[MAP_OCC_TX_OFF]) & 0xffff;
      } else {
        throw new NotPorted("0x4f0832"); // 0x519408 → 1: FUN_004f0832(objeto da célula, unidade)
      }
    }
    if (m.u32(MAP_OCC_P04_OFF) !== 0) {
      nop(); // 0x556447
      return 0;
    }
    m.setU32(MAP_OCC_P04_OFF, u.addr);
    m.occ.setAt(sVar5, m.occCur);
    fn_0x550a53(m, sVar5);
    return 1;
  }
  if (bVar1 === 3) {
    if (!m.occ.lookup(sVar5, m.occCur)) {
      fn_0x5508a0(m, sVar5);
      if (m.occ.lookup(sVar5, m.occCur)) {
        m.setU32(MAP_OCC_P08_OFF, u.addr);
        m.occ.setAt(sVar5, m.occCur);
        fn_0x550a53(m, sVar5);
        return 1;
      }
      return 0;
    }
    if (m.u32(MAP_OCC_P08_OFF) !== 0) {
      nop();
      return 0;
    }
    m.setU32(MAP_OCC_P08_OFF, u.addr);
    m.occ.setAt(sVar5, m.occCur);
    fn_0x550a53(m, sVar5);
    return 1;
  }
  return 0;
}

/**
 * 0x55020a Unit_PlaceOnCells (thiscall, ret 4): velocidade da célula em andar+0x72 e a posição em +0x82..0x85; põe a unidade
 * em cada célula do quadrado (0x5503af, y por fora; 0 na 1.ª que falha) e marca a pegada atual (0x55be86 modo 1).
 */
export function unitPlaceOnCells(m: MapRec, u: UnitRec): number {
  const w = u.walk;
  const uVar6 = vtGetSize(u);
  fn_0x55f330(u);
  const cVar2 = mapObjCellX(u.mapObj);
  const cVar3 = mapObjCellY(u.mapObj);
  const uVar7 = fn_0x55687d(m, u, cVar2, cVar3);
  w.f72 = uVar7 & 0xffff;
  w.f82 = cVar2;
  w.f83 = cVar3;
  w.f84 = mapObjFineX(u.mapObj) & 0xff;
  w.f85 = mapObjFineY(u.mapObj) & 0xff;
  const iVar8 = fn_0x5563ca(m, u);
  if (iVar8 === 0 && i16(w.footCell) !== i16(mapObjCellOf(u.mapObj))) {
    nop(); // 0x55643a
    mapObjCellOf(u.mapObj);
    nop(); // 0x556447
  }
  for (let l14 = 0; ; l14++) {
    if ((uVar6 & 0xff) <= l14) {
      fn_0x55be86(m, u, mapObjCellOf(u.mapObj), 1);
      return 1;
    }
    for (let l18 = 0; l18 < (uVar6 & 0xff); l18++) {
      if (fn_0x5503af(m, u, (cVar2 + l18) & 0xff, (cVar3 + l14) & 0xff) === 0) return 0;
    }
  }
}
