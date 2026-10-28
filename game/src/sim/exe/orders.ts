/**
 * Porta literal do servidor do allods2.exe: as ORDENS que chegam aos grupos — do cliente (os `case` executados do tipo 3 de
 * Server_PacketDispatcher 0x4f515d) e do script (AI_GroupCommandDispatch 0x577cee) — e o que cada uma escreve nas unidades
 * (etapa 9, lote 4; notes/pensamento.md). Os tratadores são os mesmos nos dois caminhos: o cliente só acrescenta o regrupamento.
 * Portadas (ordem de chamada):
 *  - Regrupamento da ordem do cliente (0x4f515d, pacote 3): 0x52b06f (o 1.º grupo vazio da lista dono+0x28 sai e morre, 0x539da0 +
 *    0x545710/0x52aeff; `new` de um grupo 0x52ae43 → 0x5690ee: dados do comando zerados, acordado +0x45 = 1), 0x52af8c (a unidade
 *    sai do grupo antigo 0x52afd2 e entra no novo; +0x44 do grupo = dono), 0x510745 (cancela a magia de item), 0x53d690 (o grupo
 *    entra no fim da lista do dono). Com magia (pacotes 0x1e/0x1f) unidade+0x44 = Unit_GetBookSpell. Depois o `case` pelo tipo − 0x12:
 *    4 e 10 AI_GroupCmd_Move 0x5703c0, 6 0x570b8b (Stand ground), 7 0x570946 (atacar unidade), 0xc 0x5702be (magia em unidade); os
 *    demais (0 0x570bde, 1 0x56dafe, 2 0x570c31, 5 AI_GroupCmd_Guard, 8 0x5709b8, 9 0x570c84, 0xb 0x570d26, 0xd 0x57033d, 0xf, 0x12,
 *    0x13/0x14) têm exec 0 no corpus: NotPorted quando o seu tratador por unidade não está portado. O resto do despachante (itens,
 *    loja, chat, carga, senha...) é cliente/rede: `out`.
 *  - Comandos de grupo: 0x570e83 (reinício: 0x56dbfb em cada membro, IA+0x38 = 0, comando 0), AI_GroupCmd_Move 0x5703c0 e
 *    AI_GroupCmd_Swarm2 0x57063e (formação do dono [+0x34]+0x1f: 2 → anda em formação se nenhum membro está a mais de mundo+0xa724 do
 *    centroide (AI_GroupMaxScanRange 0x56f850); deslocamentos IA+0x24/+0x26; +0x44 do grupo = menor velocidade +0x8c), 0x5708bc (2),
 *    0x5708ff (0x11 enxame), 0x5709b8 (→ Swarm2), AI_GroupCmd_Guard 0x5709d9 e AI_GuardLoad 0x570aba (0x56d4ba em cada membro,
 *    0x57026e: raio-base = max(distância ao centroide + visão) elevado ao parâmetro ou a MinimalGuardRange mundo+0xa8b8 / 20),
 *    0x570b8b (3; AI_StandGroundAt 0x56d52b), 0x570946 (AI_TargetCost 0xffffff → 0x56dba1, senão 0x56d1be), 0x5702be (unidade+0x44 →
 *    0x56d3e6, senão 0x56dba1), 0x570d26 (patrulha: 0x56d6b7), 0x570bde/0x570c31/0x570c84/0x570cd5 (0x56d572/0x56da4f/0x56d5b9/
 *    0x56d638: exec 0, NotPorted).
 *  - Por unidade: 0x56d032 (andar: destino limitado à área útil mapa+0x58eb8, +0x50 = 1, IA+0xa, andar+0x90 = 0, IA+8 = 1), 0x56d1be
 *    (atacar: +0x50 = 3, IA+0xc, IA+0x14 = alcance, IA+8 = 0; a própria unidade → 0x56dba1), 0x56d3e6 (magia: +0x50 = 0xd, IA+0x28 alvo,
 *    IA+0x30 magia, IA+0x14 = alcance da magia), 0x56d4ba (guarda: +0x50 = 0xb, posto IA+0 = célula (andar+6 a meio passo)), 0x56d6b7
 *    (patrulha: +0x50 = 0xa, posto, lista IA+0xb4 = [célula, ponto], IA+2 = ponto, Vision_Compute), 0x56dafe (+0x50 = 0x1a).
 * Listas MFC: mfc.ts (`CListPtr`, `CListWord`, `CListPtrIter`). A tabela 0x5f8120 (índice da magia no cliente → id do livro) é do
 * cliente: a ordem já chega com o id do livro.
 */
import { aiStandGroundAt, fn_0x56dba1, fn_0x56dbfb } from "./action";
import { fn_0x510745 } from "./combat";
import { CListPtrIter } from "./mfc";
import { mapObjCellX, mapObjCellY } from "./path";
import { aiGroupMaxScanRange, aiTargetCost } from "./think";
import { aiAttackRange, aiTeleportTargetDist, unitGetBookSpell } from "./wave";
import { mapObjCellOf, mapObjSubCellCenter } from "./walk";
import { NotPorted } from "./walk_action";
import { visionCompute } from "./vision";
import { MAP_RECT_OFF, PlayerRec, UnitStatsRec, UnitTypeRec, type BookSpellRec, type UnitRec, type WorldRec } from "./types";

const i16 = (v: number): number => (v << 16) >> 16;
const i8 = (v: number): number => (v << 24) >> 24;

// ---------------------------------------------------------------------------------------------------------- grupos (regrupamento)

/** 0x5690ee (fastcall; construtor dos dados do comando, 0x50 bytes zerados): IA+8/+9 = 0 (sic: bytes +8/+9 dos dados), comando 0,
 *  acordado +0x45 = 1, lista +0x4c nova. */
export function fn_0x5690ee(param_1: UnitStatsRec): UnitStatsRec {
  Object.assign(param_1, new UnitStatsRec());
  param_1.f20 = 0;
  param_1.f45 = 1;
  return param_1;
}

/** 0x52ae43 (fastcall; construtor do grupo): lista de membros vazia, lista +0x20 vazia, +0x40 = 0, dono +0x44 = 0, dados +0x3c novos
 *  (0x5690ee), +0x48 = +0x4c = 0. */
export function fn_0x52ae43(param_1: UnitTypeRec): UnitTypeRec {
  param_1.members.removeAll();
  param_1.owner = null;
  param_1.stats = fn_0x5690ee(new UnitStatsRec());
  return param_1;
}

/** 0x52aeff (fastcall; destrutor do grupo): apaga os dados +0x3c (0x544f10) e as listas. No espelho: sai de `groupsByAddr`. */
export function fn_0x52aeff(wd: WorldRec, param_1: UnitTypeRec): void {
  param_1.members.removeAll();
  wd.groupsByAddr.delete(param_1.addr >>> 0);
}

/** 0x545710 (thiscall; `delete` virtual do grupo): destrutor + liberta a memória com o bit 0. */
export function fn_0x545710(wd: WorldRec, param_1: UnitTypeRec, param_2: number): UnitTypeRec {
  fn_0x52aeff(wd, param_1);
  void param_2;
  return param_1;
}

/** 0x539da0 (thiscall; CList<void*>::Remove por valor: Find 0x539fe0 + RemoveAt 0x539f70): tira o grupo da lista do dono. */
export function fn_0x539da0(l: UnitTypeRec["members"], param_1: number): void {
  l.remove(param_1 >>> 0);
}

/** 0x53d690 → 0x53d6b0 (thiscall; CList<void*>::AddTail): o grupo entra no fim da lista do dono. */
export function fn_0x53d690(l: UnitTypeRec["members"], param_1: number): void {
  l.addTail(param_1 >>> 0);
}

/** 0x52b06f (fastcall; lista de grupos do dono [dono+0x28]): o 1.º grupo sem membros sai da lista e morre (0x539da0, 0x545710); depois
 *  nasce um grupo novo (`new` 0x50 bytes + 0x52ae43). Não o põe na lista: o chamador o faz (0x53d690). Devolve o grupo. */
export function fn_0x52b06f(wd: WorldRec, param_1: PlayerRec): UnitTypeRec {
  const it = new CListPtrIter();
  let local_14 = it.first(param_1.groups);
  for (;;) {
    if (local_14 === 0) break;
    const g = wd.groupAt(local_14);
    if (g.members.getCount() === 0) {
      fn_0x539da0(param_1.groups, local_14);
      fn_0x545710(wd, g, 1);
      break;
    }
    local_14 = it.next();
  }
  const pvVar2 = new UnitTypeRec();
  pvVar2.addr = wd.allocGroupAddr() >>> 0;
  fn_0x52ae43(pvVar2);
  wd.groupsByAddr.set(pvVar2.addr, pvVar2);
  return pvVar2;
}

/** 0x52afd2 (thiscall; grupo, unidade): a unidade sai da lista de membros (0x53afb0) e fica sem grupo (+0x70 = 0). */
export function fn_0x52afd2(param_1: UnitTypeRec, u: UnitRec): void {
  param_1.members.remove(u.addr >>> 0);
  u.type = EMPTY_GROUP;
}
/** unidade+0x70 = 0 no espelho (um registro vazio de endereço 0, nunca pensado: nenhum dono o lista). */
export const EMPTY_GROUP = new UnitTypeRec();

/** 0x52af8c (thiscall; grupo, unidade): sai do grupo antigo (0x52afd2), entra no fim da lista deste (0x53d840), +0x70 = este, e o dono
 *  do grupo +0x44 = o dono da unidade +0x14. */
export function fn_0x52af8c(param_1: UnitTypeRec, u: UnitRec): void {
  if (u.type !== EMPTY_GROUP) fn_0x52afd2(u.type, u);
  param_1.members.addTail(u.addr >>> 0);
  u.type = param_1;
  param_1.owner = u.owner;
}

// ---------------------------------------------------------------------------------------------------------- por unidade

/** 0x56d032 (thiscall; unidade, x byte, y u16): ordem de andar — 0x56dbfb, destino limitado à área útil (mapa+0x58eb8..bb), classe +0x50
 *  = 1, IA+0xa = y << 8 | x, fim do caminho estático andar+0x90 = 0, tarefa IA+8 = 1. */
export function fn_0x56d032(wd: WorldRec, param_1: UnitRec, param_2: number, param_3: number): void {
  fn_0x56dbfb(wd, param_1);
  const r = wd.map.mem;
  param_2 &= 0xff; param_3 &= 0xffff;
  if (param_2 < r[MAP_RECT_OFF]!) param_2 = r[MAP_RECT_OFF]!;
  if (r[MAP_RECT_OFF + 2]! < param_2) param_2 = r[MAP_RECT_OFF + 2]!;
  if ((param_3 & 0xff) < r[MAP_RECT_OFF + 1]!) param_3 = r[MAP_RECT_OFF + 1]!;
  if (r[MAP_RECT_OFF + 3]! < (param_3 & 0xff)) param_3 = r[MAP_RECT_OFF + 3]!;
  param_1.task = 1;
  param_1.ai.f0a = (Math.imul(param_3, 0x100) + param_2) & 0xffff;
  param_1.walk.f90 = 0;
  param_1.ai.task = 1;
}

/** 0x56d1be (thiscall; unidade, alvo): ordem de atacar — a si mesma → 0x56dba1 (parar + Stand ground); senão 0x56dbfb, +0x50 = 3,
 *  IA+0xc = alvo, IA+0x14 = alcance (AI_AttackRange), IA+8 = 0. */
export function fn_0x56d1be(wd: WorldRec, param_1: UnitRec, param_2: UnitRec): void {
  if (param_1 === param_2) {
    fn_0x56dba1(wd, param_1);
  } else {
    fn_0x56dbfb(wd, param_1);
    param_1.task = 3;
    param_1.ai.f0c = param_2.addr >>> 0;
    param_1.ai.range = aiAttackRange(param_1) & 0xff;
    param_1.ai.task = 0;
  }
}

/** 0x56d3e6 (thiscall; unidade, alvo, magia do livro): ordem de lançar em unidade — 0x56dbfb, +0x50 = 0xd, IA+0x28 = alvo, IA+0x30 =
 *  magia, IA+0x14 = alcance da magia (+9), IA+8 = 0. */
export function fn_0x56d3e6(wd: WorldRec, param_1: UnitRec, param_2: UnitRec, param_3: BookSpellRec): void {
  fn_0x56dbfb(wd, param_1);
  param_1.task = 0xd;
  param_1.ai.f28 = param_2.addr >>> 0;
  param_1.ai.f30 = param_3.addr >>> 0;
  param_1.ai.range = param_3.range & 0xff;
  param_1.ai.task = 0;
}

/** 0x56d4ba (thiscall; unidade): Guard — 0x56dbfb, +0x50 = 0xb, posto IA+0 = a célula (a meio passo, a célula seguinte andar+6), IA+8 = 0. */
export function fn_0x56d4ba(wd: WorldRec, param_1: UnitRec): void {
  fn_0x56dbfb(wd, param_1);
  param_1.task = 0xb;
  if (mapObjSubCellCenter(param_1.mapObj) === 0) param_1.ai.f00 = param_1.walk.nextCell & 0xffff;
  else param_1.ai.f00 = mapObjCellOf(param_1.mapObj) & 0xffff;
  param_1.ai.task = 0;
}

/** 0x56d6b7 (thiscall; unidade, x u16, y i16): patrulha — 0x56dbfb, +0x50 = 0xa, posto IA+0 = célula, lista IA+0xb4 = [célula, ponto]
 *  (RemoveAll 0x5421b0, AddHead 0x55f170, AddTail 0x542300), IA+2 = o último (GetTail 0x55f0f0), IA+4 = 0, IA+8 = 0, Vision_Compute. */
export function fn_0x56d6b7(wd: WorldRec, param_1: UnitRec, param_2: number, param_3: number): void {
  fn_0x56dbfb(wd, param_1);
  param_1.task = 10;
  const ai = param_1.ai;
  ai.f00 = mapObjCellOf(param_1.mapObj) & 0xffff;
  ai.patrol.removeAll();
  ai.patrol.addHead(mapObjCellOf(param_1.mapObj) & 0xffff);
  ai.patrol.addTail((Math.imul(i16(param_3), 0x100) + (param_2 & 0xff)) & 0xffff);
  ai.f02 = ai.patrol.getTail() & 0xffff;
  ai.f04 = 0;
  ai.task = 0;
  visionCompute(wd.map, param_1, mapObjCellOf(param_1.mapObj) & 0xffff);
}

/** 0x56dafe (thiscall; unidade): 0x56dbfb, +0x50 = 0x1a, andar+0x90 = 0, IA+8 = 0 (pacote 0x13; exec 0 no corpus). */
export function fn_0x56dafe(wd: WorldRec, param_1: UnitRec): void {
  fn_0x56dbfb(wd, param_1);
  param_1.task = 0x1a;
  param_1.walk.f90 = 0;
  param_1.ai.task = 0;
}

// ---------------------------------------------------------------------------------------------------------- por grupo

/** 0x570e83 (thiscall; grupo): reinício da ordem — 0x56dbfb em cada membro e IA+0x38 = 0; comando do grupo = 0. */
export function fn_0x570e83(wd: WorldRec, param_1: UnitTypeRec): void {
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) {
    const u = wd.map.unitAt(local_8);
    fn_0x56dbfb(wd, u);
    u.ai.f38 = 0;
  }
  param_1.stats.f20 = 0;
}

/** O corpo comum de AI_GroupCmd_Move 0x5703c0 e AI_GroupCmd_Swarm2 0x57063e (idênticos byte a byte salvo o comando final): com a
 *  formação do dono = 2, o grupo anda em formação só se nenhum membro está a mais de mundo+0xa724 células do centroide; com formação ≠ 0
 *  cada membro guarda o seu deslocamento IA+0x24/+0x26 e anda para destino + deslocamento, e +0x44 do grupo = a menor velocidade +0x8c;
 *  sem formação, todos para o destino (0x56d032). */
function groupCmdWalk(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number, cmd: number): void {
  let cVar1 = 1;
  let uVar2 = 0xfa;
  let local_14 = 0, local_18 = 0;
  fn_0x570e83(wd, param_1);
  const owner = param_1.owner;
  if (!owner) throw new Error(`grupo 0x${param_1.addr.toString(16)} sem dono (+0x44) em 0x${cmd === 4 ? "5703c0" : "57063e"}`);
  if ((owner.formation & 0xff) === 2) {
    const uVar5 = aiGroupMaxScanRange(wd, param_1) >>> 0;
    local_14 = (uVar5 & 0xffff) >> 8;
    local_18 = (uVar5 >>> 16) >> 8;
    for (let local_c = param_1.members.first(); local_c !== 0; local_c = param_1.members.nextAfter(local_c)) {
      const u = wd.map.unitAt(local_c);
      const c = (Math.imul(local_18, 0x100) + local_14) >>> 0;
      const bVar3 = aiTeleportTargetDist(mapObjCellOf(u.mapObj) & 0xffff, c) & 0xff;
      if ((wd.fa724 & 0xff) < bVar3) cVar1 = 0;
    }
  } else {
    cVar1 = i8(owner.formation);
    if (cVar1 !== 0) {
      const uVar5 = aiGroupMaxScanRange(wd, param_1) >>> 0;
      local_14 = (uVar5 & 0xffff) >> 8;
      local_18 = (uVar5 >>> 16) >> 8;
    }
  }
  fn_0x570e83(wd, param_1);
  for (let local_c = param_1.members.first(); local_c !== 0; local_c = param_1.members.nextAfter(local_c)) {
    const u = wd.map.unitAt(local_c);
    if (cVar1 === 0) {
      fn_0x56d032(wd, u, param_2 & 0xff, param_3 & 0xff);
    } else {
      const dx = ((mapObjCellX(u.mapObj) & 0xff) - local_14) & 0xffff;
      const dy = ((mapObjCellY(u.mapObj) & 0xff) - local_18) & 0xffff;
      u.ai.f24 = ((dy << 16) | dx) >>> 0;
      fn_0x56d032(wd, u, ((param_2 & 0xff) + i8(dx)) & 0xff, ((param_3 & 0xff) + i16(dy)) & 0xffff);
      if (i16(u.speed) < i16(uVar2)) uVar2 = u.speed & 0xff;
    }
  }
  if (cVar1 !== 0) param_1.stats.speedByte = uVar2 & 0xff;
  param_1.stats.f20 = cmd & 0xff;
  param_1.stats.f0a = (Math.imul(param_3 & 0xffff, 0x100) + (param_2 & 0xff)) & 0xffff;
}

/** 0x5703c0 AI_GroupCmd_Move (thiscall; grupo, x byte, y u16): comando 4 (andar) com o corpo de `groupCmdWalk`. */
export function aiGroupCmdMove(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number): void {
  groupCmdWalk(wd, param_1, param_2, param_3, 4);
}

/** 0x57063e AI_GroupCmd_Swarm2 (thiscall; grupo, x byte, y u16): comando 5 (enxame até a célula) com o corpo de `groupCmdWalk`. */
export function aiGroupCmdSwarm2(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number): void {
  groupCmdWalk(wd, param_1, param_2, param_3, 5);
}

/** 0x5708bc (thiscall; grupo, x u16, y i16): comando 2 com a célula (sem tocar nas unidades além do reinício). */
export function fn_0x5708bc(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number): void {
  fn_0x570e83(wd, param_1);
  param_1.stats.f20 = 2;
  param_1.stats.f0a = (Math.imul(i16(param_3), 0x100) + (param_2 & 0xff)) & 0xffff;
}

/** 0x5708ff (thiscall; grupo): comando 0x11 (enxame) a partir da célula do 1.º membro; contagem +0x15 = 0. */
export function fn_0x5708ff(wd: WorldRec, param_1: UnitTypeRec): void {
  fn_0x570e83(wd, param_1);
  param_1.stats.f20 = 0x11;
  const iVar2 = param_1.members.first();
  param_1.stats.f0a = mapObjCellOf(wd.map.unitAt(iVar2).mapObj) & 0xffff;
  param_1.stats.f15 = 0;
}

/** 0x5709b8 (thiscall; grupo, x byte, y byte): → AI_GroupCmd_Swarm2 (pacote 8). */
export function fn_0x5709b8(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number): void {
  aiGroupCmdSwarm2(wd, param_1, param_2, param_3 & 0xff);
}

/** 0x57026e (cdecl; grupo): AI_GroupMaxScanRange; célula do comando +0 = centroide +0x28; raio +0x2d e raio-base +0x38 = +0x2c
 *  (maior distância ao centroide + visão). */
export function fn_0x57026e(wd: WorldRec, param_1: UnitTypeRec): void {
  aiGroupMaxScanRange(wd, param_1);
  const d = param_1.stats;
  d.f00 = d.f28 & 0xffff;
  d.f2d = d.f2c & 0xff;
  d.f38 = d.f2c & 0xff;
}

/** 0x5709d9 AI_GroupCmd_Guard (thiscall; grupo, raio byte): 0x56d4ba em cada membro, comando 1, 0x57026e; sem parâmetro o raio sobe a
 *  MinimalGuardRange (mundo+0xa8b8) se for menor; com parâmetro sobe a ele; +0x39 = 0. */
export function aiGroupCmdGuard(wd: WorldRec, param_1: UnitTypeRec, param_2: number): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) fn_0x56d4ba(wd, wd.map.unitAt(local_8));
  const d = param_1.stats;
  d.f20 = 1;
  fn_0x57026e(wd, param_1);
  param_2 &= 0xff;
  if (param_2 === 0) {
    if ((d.f2d & 0xff) < (wd.fa8b8 | 0)) { d.f2d = wd.fa8b8 & 0xff; d.f38 = wd.fa8b8 & 0xff; }
  } else if ((d.f2d & 0xff) < param_2) { d.f2d = param_2; d.f38 = param_2; }
  d.f39 = 0;
}

/** 0x570aba AI_GuardLoad (thiscall; grupo, raio byte): como AI_GroupCmd_Guard com o comando 0x12 (Guard da carga do mapa) e, sem
 *  parâmetro e abaixo de MinimalGuardRange, raio 20. */
export function aiGuardLoad(wd: WorldRec, param_1: UnitTypeRec, param_2: number): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) fn_0x56d4ba(wd, wd.map.unitAt(local_8));
  const d = param_1.stats;
  d.f20 = 0x12;
  fn_0x57026e(wd, param_1);
  param_2 &= 0xff;
  if (param_2 === 0) {
    if ((d.f2d & 0xff) < (wd.fa8b8 | 0)) { d.f2d = 0x14; d.f38 = 0x14; }
  } else if ((d.f2d & 0xff) < param_2) { d.f2d = param_2; d.f38 = param_2; }
  d.f39 = 0;
}

/** 0x570b8b (thiscall; grupo): Stand ground — AI_StandGroundAt 0x56d52b em cada membro; comando 3. */
export function fn_0x570b8b(wd: WorldRec, param_1: UnitTypeRec): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) aiStandGroundAt(wd, wd.map.unitAt(local_8));
  param_1.stats.f20 = 3;
}

/** 0x570946 (thiscall; grupo, alvo): atacar unidade — por membro, AI_TargetCost 0xffffff (não atacável) → 0x56dba1, senão 0x56d1be. */
export function fn_0x570946(wd: WorldRec, param_1: UnitTypeRec, param_2: UnitRec): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) {
    const u = wd.map.unitAt(local_8);
    const iVar1 = aiTargetCost(wd, u, param_2);
    if (iVar1 === 0xffffff) fn_0x56dba1(wd, u);
    else fn_0x56d1be(wd, u, param_2);
  }
}

/** 0x5702be (thiscall; grupo, alvo): magia em unidade — por membro, sem magia escolhida (unidade+0x44 = 0) → 0x56dba1, senão
 *  0x56d3e6; +0x44 volta a 0; comando 0. */
export function fn_0x5702be(wd: WorldRec, param_1: UnitTypeRec, param_2: UnitRec): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) {
    const u = wd.map.unitAt(local_8);
    if ((u.f44 >>> 0) === 0) fn_0x56dba1(wd, u);
    else fn_0x56d3e6(wd, u, param_2, bookSpellAt(wd, u.f44));
    u.f44 = 0;
  }
  param_1.stats.f20 = 0;
}

/** 0x570d26 (thiscall; grupo, x byte, y byte): patrulha — 0x56d6b7 em cada membro (o comando fica 0: tarefas por unidade). */
export function fn_0x570d26(wd: WorldRec, param_1: UnitTypeRec, param_2: number, param_3: number): void {
  fn_0x570e83(wd, param_1);
  for (let local_8 = param_1.members.first(); local_8 !== 0; local_8 = param_1.members.nextAfter(local_8)) fn_0x56d6b7(wd, wd.map.unitAt(local_8), param_2 & 0xff, i8(param_3));
}

/** 0x570bde (thiscall; grupo): 0x56d572 em cada membro (exec 0: NotPorted); comando 0x13. */
export function fn_0x570bde(wd: WorldRec, param_1: UnitTypeRec): void {
  fn_0x570e83(wd, param_1);
  if (param_1.members.first() !== 0) throw new NotPorted("0x56d572");
  param_1.stats.f20 = 0x13;
}

/** 0x570c31 (thiscall; grupo): 0x56da4f em cada membro (exec 0: NotPorted); comando 0. */
export function fn_0x570c31(wd: WorldRec, param_1: UnitTypeRec): void {
  fn_0x570e83(wd, param_1);
  if (param_1.members.first() !== 0) throw new NotPorted("0x56da4f");
  param_1.stats.f20 = 0;
}

/** 0x570c84 (thiscall; grupo, unidade, raio): defender — 0x56d5b9 em cada membro (exec 0: NotPorted). */
export function fn_0x570c84(wd: WorldRec, param_1: UnitTypeRec, _param_2: UnitRec, _param_3: number): void {
  fn_0x570e83(wd, param_1);
  if (param_1.members.first() !== 0) throw new NotPorted("0x56d5b9");
}

/** 0x570cd5 (thiscall; grupo, unidade, raio): seguir — 0x56d638 em cada membro (exec 0: NotPorted). */
export function fn_0x570cd5(wd: WorldRec, param_1: UnitTypeRec, _param_2: UnitRec, _param_3: number): void {
  fn_0x570e83(wd, param_1);
  if (param_1.members.first() !== 0) throw new NotPorted("0x56d638");
}

/** A magia do livro com o endereço dado (o exe guarda o ponteiro; `WorldRec.spellAt` o resolve). */
export function bookSpellAt(wd: WorldRec, addr: number): BookSpellRec {
  return wd.spellAt(addr >>> 0);
}

// ---------------------------------------------------------------------------------------------------------- a ordem do cliente

/** Os `case` do pacote 3 de Server_PacketDispatcher 0x4f515d (tipo − 0x12). */
export const ClientOrder = { Walk: 4, StandGround: 6, AttackUnit: 7, DefendLocation: 10, CastAtUnit: 0xc } as const;

/** O `case` 3 de Server_PacketDispatcher 0x4f515d (thiscall; a ordem do cliente para uma seleção de unidades do mesmo dono): regrupa
 *  (0x52b06f → 0x52af8c + 0x510745 por unidade → 0x53d690), com magia (pacotes 0x1e/0x1f) unidade+0x44 = Unit_GetBookSpell 0x51c391 do
 *  id do livro (a tabela 0x5f8120 do cliente fica fora), e despacha pelo tipo − 0x12: 4/10 AI_GroupCmd_Move, 6 0x570b8b, 7 0x570946,
 *  0xc 0x5702be; os demais têm exec 0 no corpus (NotPorted em 0x4f515d). Devolve o grupo novo. As unidades mortas (+0x54 == 0x10) não
 *  entram (0x4f3a52 as devolve nulas); seleção vazia → nada. */
export function clientOrder(wd: WorldRec, units: UnitRec[], sub: number, x: number, y: number, target: UnitRec | null, spellId: number): UnitTypeRec | null {
  const alive = units.filter(u => (u.act >>> 0) !== 0x10);
  const local_1c = alive[0];
  if (!local_1c) return null;
  const local_18 = local_1c.owner;
  const local_20 = fn_0x52b06f(wd, local_18);
  fn_0x52af8c(local_20, local_1c);
  fn_0x510745(local_1c);
  for (let local_24 = 1; local_24 < alive.length; local_24++) {
    const u = alive[local_24]!;
    fn_0x52af8c(local_20, u);
    fn_0x510745(u);
  }
  fn_0x53d690(local_18.groups, local_20.addr);
  if (sub === ClientOrder.CastAtUnit) {
    for (let a = local_20.members.first(); a !== 0; a = local_20.members.nextAfter(a)) {
      const u = wd.map.unitAt(a);
      if (u.hasBook && (spellId & 0xff) !== 0) {
        const s = unitGetBookSpell(u.book, spellId & 0xff);
        u.f44 = s ? s.addr >>> 0 : 0;
      }
    }
  }
  switch (sub) {
    case ClientOrder.Walk: case ClientOrder.DefendLocation: aiGroupCmdMove(wd, local_20, x & 0xff, y & 0xff); break;
    case ClientOrder.StandGround: fn_0x570b8b(wd, local_20); break;
    case ClientOrder.AttackUnit: if (target) fn_0x570946(wd, local_20, target); break;
    case ClientOrder.CastAtUnit: if (target) fn_0x5702be(wd, local_20, target); break;
    default: throw new NotPorted("0x4f515d");
  }
  return local_20;
}
