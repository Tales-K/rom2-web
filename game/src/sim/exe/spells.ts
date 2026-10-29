/**
 * Porta literal do servidor do allods2.exe: o gasto e o lançamento das magias (etapa 8b, lote 2; notes/magias.md). Portadas:
 *  - Spell_SpendMana 0x519998 (thiscall; `this` = a magia do livro/item, unidade, alvo ou 0, x, y): conjurador com livro (0x53a5a0) e
 *    sem item em uso (+0x68) paga o custo +0xc da mana +0x9a (sem mana → 0: a máquina tenta de novo no tique seguinte); invisível
 *    (efeito 0xc) que lança em outro marca o efeito para acabar (+0x42 = 1 na lista +0x20, como 0x516b2f);
 *    arma que lança magia sem livro (+0x74 = +0x68) → 1 sem aviso; sem definição → 0; Prismatic Spray (0xb): Spell_CasterPower +
 *    0x519c04 (exec 0: gancho `spellPrismatic`); senão o aviso ao cliente 0x5041d6 (alvo; definição[4] = 1, 0x519441) ou 0x5042ba
 *    (célula). O ponto alvo (0x54f955/0x54feae/0x54ff06/0x54f9b9/0x54fc41) e o tempo de voo (Spell_ProjectileDist 0x516aae ÷ [7]) só
 *    vão no pacote: não portados (cliente).
 *  - 0x5041d6 / 0x5042ba: o pacote 0x86/0x8b ao cliente (stub; 0x503bef envia) e, se vtable+0x2c da unidade ≠ 0, +0x138 = relógio de
 *    16/s ("ocupada agora": 0x50fc3e não triplica a regeneração de quem lança sem parar).
 *  - 0x519441 (fastcall): definição[4] == 1.
 *  - Spell_Release 0x519d7f (thiscall): id ≠ 0xb → Spell_Apply 0x519db8.
 * Lote 3 (a aplicação e os objetos de magia):
 *  - Spell_Apply 0x519db8 (thiscall; magia, unidade, alvo ou 0, x, y): poder = habilidade da esfera (definição[2]; unidade+0xa8 +
 *    2 × esfera) + Mind (+0x88) − 30 em 0..255, ou o do item em uso (0x5238c5: efeito 0x29 da lista item+0x20, +0x42); Spell_Instance;
 *    experiência pela magia (vtable+0x70, sem item e sem o bit 2 de +0x4c, 0x543130); o ponto alvo (0x54f955/0x54f9b9 ou 0x54feae +
 *    0x54ff06 e, lado > 1, o centro − 1 por 0x54fc41); alvo imune (vtable+0x2c e bit 8 de +0x4c) → nada. Portados: o objeto de dano
 *    (dano da instância ≠ 0 e id ≠ 0x18/0x1a: Spell_DamageObject 0x51e505 + 0x543040/0x543070/0x5430a0/0x5430d0/0x543100 pela esfera),
 *    preso ao alvo (definição[8] = 1: Spell_AttachToTarget 0x5178d4) e entregue já (definição[5] = 1) ou por projétil (2: 0x518d1e; voo
 *    10 em Lightning/Prismatic Spray) na lista do mundo (0x542e60); Heal (0x18): sem guerra (0x57994d inline), vida > −10 e período da
 *    regeneração +0x98 ≠ 0 → instância + Rand_One(faixa) até a vida máxima, +0x150 = 0, Unit_AddHeal 0x510484. Lotes 4–5: todos os
 *    `case` de carga "Effect" (exe/effects.ts `spellApplyEffect`: proteções, Poison, Invisibility, Light/Darkness, Stone Curse,
 *    Bless/Curse, Haste/Slow, Shield), presos ao alvo ou em SpellArea (definição[8] ≠ 1). Os outros (Wall of Earth 0x11, Animate Dead,
 *    Teleport, Summon, Drain Life) ficam no gancho `spellApply` (motor antigo) ANTES de qualquer efeito da porta (`spellApplyPorted`).
 *  - Spell_Instance 0x5195b1 (thiscall; poder em byte): alcance +9 = [6] + poder ÷ 30 (só se [6] ≠ 0; Teleport + poder ÷ 3); +0xe =
 *    ftol([0x10] × k), +0xf = ftol([0x11] × k − +0xe) com k = poder/30 + 1 (double); +0x10 = duração: [0xe] < 1 → [0xb] × 16 + poder ×
 *    16 ÷ 10 (ou 0), Invisibility poder × 16, Stone Curse poder × 0x1e0 ÷ 100, senão ftol(pow(1,025, poder) × [0xe] × 16) (assembly).
 *  - Unit_AddHeal 0x510484 (+0x150 |= 1, vida até a máxima; de < 1 a > 0 → Unit_Revive 0x510534, exec 0: gancho `revive`), 0x543130,
 *    0x5238c5, Spell_ProjectileDist 0x516aae (ftol(√(dx² + dy²)) dos finos 0x54ff5b/0x54ff7c), 0x54feae/0x54ff06 (cópia do objeto de mapa).
 *  - Construtores (registros `SpellPayloadRec`/`SpellObjRec`): 0x50d493/0x50d549 (base: +4/+0x14/+0x18/+0x1c = 0, objeto de mapa novo
 *    na célula 0 do mapa / cópia do dado), Spell_WallObject 0x51ca4d, Spell_DamageObject 0x51e505 (0x515825/0x51583b zeram o dano),
 *    0x517719/0x517774 (+0x41 = 1), Spell_AttachToTarget 0x5178d4 (alvo +0x48, carga +0x4c, objeto de mapa = o do alvo), 0x518d1e (filho
 *    +0x48; +0x50 = Spell_ProjectileDist(conjurador, filho) ÷ definição[7]).
 *  - A lista do mundo: 0x52c279 (Server_WorldTick 0x4f04cf, antes das unidades; quem lançou sem dono → +0x3c = 0; máscara +0x42 ≠ +0x44:
 *    pacote ao cliente só de SpellArea, stub; vtable+0x18; +0x40 ≠ 0 → 0x53cc70 tira e destrói: 0x542e30/0x518e30, 0x542d20/0x517aa0,
 *    0x543330/0x543300 → 0x50d6d6), 0x518efd (projétil: +0x50−−, a < 1 solta o filho na lista e acaba), 0x542d00 → 0x517949 (preso
 *    ao alvo: a carga age no alvo — vtable+0x3c — e, com +0x41, marca o agressor +0x40/+0x48 e avisa 0x56e6b8; acaba), 0x51e65b (dano:
 *    vtable+0x54 = Unit_PhysicalDamage 0x516f6f com quem lançou; vida −= dano; > 0 → experiência vtable+0x6c com o id e 's' ao
 *    cliente 0x504b1d, stub `clientSpellHit`). Carga "Effect": 0x51ce12 (exe/effects.ts).
 * Lote 5 (SpellArea, vtable 0x5d10e0; exec 0 no corpus, provado por pares sintéticos: tools/re/oracle/synth_spells.py):
 *  - SpellArea_Construct 0x517c1a e o ramo de área de Spell_Apply (raio [9], tiques +0x50 = [0xb] × 16 + poder × 16 ÷ 10 → modo +8 = 1;
 *    [8] = 5 → modo 2; direção +0x4e; 0x55b507); SpellArea_Process 0x517cfe (modo 1: marca as células 0x518024 → SpellArea_MarkCells
 *    0x5183a2 (|dx| + |dy| ≤ raio + 1: 0x5184bf → 0x55a325/0x55a37a na vaga da área no registro de ocupação, 0x518ba3; as áreas que se
 *    anulam, SpellArea_FireExtra 0x5189b5), conta os tiques, a cada 16 a carga age em quem está nas células marcadas (0x55a8f8/0x55a88b →
 *    0x551edb → SpellArea_HitCell 0x518681) e no fim desmarca (SpellArea_Unmark 0x518594 → 0x55a4de/0x55a533) e acaba); 0x5045a5 (a
 *    máscara ao cliente: as consultas 0x55a88b mexem no registro corrente; o pacote é o stub `clientArea`); 0x542d50/0x517c72 (destrói).
 *  - NotPorted (exec 0, áreas de dano): Spell_AreaProgressive 0x51806c (modo 2), SpellArea_ApplyAll 0x518833 (modo 0), SpellArea_Wall
 *    0x5182b6 ([8] = 4), a Fireball em 0x518681 (0x51e5db).
 */
import { fn_0x53a5a0 } from "./action";
import { deletePayload as deleteFx, EFFECT_CASES, fn_0x51ce12, spellApplyEffect } from "./effects";
import { fn_0x5106d2, fn_0x53b120fx, fn_0x542560, fn_0x56e6b8, unitPhysicalDamage, type CombatHooks } from "./combat";
import { CListPtrIter } from "./mfc";
import { crtFtol, mapObjCellX, mapObjCellY, mapObjFineX, mapObjFineY, unitCenterX, unitCenterY, vtGetSize } from "./path";
import { randOne } from "./rand";
import { fn_0x55b507 } from "./think";
import { cellOff10000, crtAbs, fn_0x55f330, mapObjCellOf, mapObjInit, mapObjInitPacked16, mapObjSetFine, occRecIsEmpty } from "./walk";
import { dirFromDelta16, NotPorted } from "./walk_action";
import { fn_0x5508a0, fn_0x550966, fn_0x550a53, fn_0x551edb, fn_0x559bc9 } from "./wave";
import { vt2c, vt34, vt6c, vt70 } from "./vtables";
import {
  DmgRec, EXE_GLOBALS, MAP_MASK_OFF, MapObjRec, SpellObjRec, SpellPayloadRec, VT_DIRECT_DAMAGE, VT_EFFECT, VT_POINT_EFFECT, VT_SPELL_AREA,
  VT_TRANSPORT, type BookSpellRec, type ItemMagicRec, type ItemRec, type MapRec, type UnitRec, type WorldRec,
} from "./types";

/** O que a magia ainda não portou e a apresentação. Sem gancho do ramo não portado → NotPorted. */
export interface SpellHooks {
  /** 0x519db8 Spell_Apply(magia, unidade, alvo ou null, x, y) nos `case` ainda não portados (`spellApplyPorted` falso): o motor antigo. */
  spellApply?(spell: number, u: UnitRec, t: UnitRec | null, x: number, y: number): void;
  /** 0x5131ef (vtable+0x70 dos humanos): experiência pela magia lançada (motor antigo). */
  xpOnCast?(u: UnitRec, t: UnitRec | null, id: number): void;
  /** 0x510534 Unit_Revive (exec 0 no corpus): a cura levantou quem estava caído (a apresentação e a ocupação vivem no motor antigo). */
  revive?(u: UnitRec): void;
  /** não é do exe: Server_Event da cura (+0x150) ao cliente. */
  clientHeal?(t: UnitRec, amount: number): void;
  /** não é do exe: 0x504b1d 's' ao cliente depois do dano da magia (HUD); `a` = quem lançou (null se ele perdeu o dono). */
  clientSpellHit?(a: UnitRec | null, t: UnitRec, dmg: number, id: number): void;
  /** não é do exe: o cliente desenha o projétil/efeito que sai (o pacote do gasto 0x5041d6 já levou o tempo de voo) — `ticks` de 16/s
   *  até chegar (0 = já no tique seguinte). */
  clientMissile?(spell: number, u: UnitRec, t: UnitRec | null, ticks: number): void;
  /** Spell_CasterPower 0x519483 + Spell_PrismaticSpray 0x519c04 (exec 0 no corpus): o jato sai já no gasto (motor antigo). */
  spellPrismatic?(spell: number, u: UnitRec, t: UnitRec | null, x: number, y: number): void;
  /** vtable+0x58 da unidade (recálculo dos atributos, 0x51366b nos humanos) depois de um efeito mudar (0x51d436): no mundo o motor antigo
   *  ainda é dono dos atributos (`syncCombat`); sem gancho, a porta (exe/effects.ts). */
  recompute?(u: UnitRec): void;
  /** não é do exe: os avisos ao cliente de efeito com duração (0x5044ba novo, Server_Event na fusão, 0x504498 acabou): a apresentação.
   *  `id` = magia (+0xc), `type` = tipo (+0x3c), `v` = valor (+0x40). */
  clientEffect?(u: UnitRec, id: number, type: number, v: number, on: boolean): void;
  /** não é do exe: 0x5045a5 (área ao cliente; lote 5): a área `o` marcou (`on`) ou tirou as células (o fim, ou anulada por outra). */
  clientArea?(o: SpellObjRec, on: boolean): void;
  /** não é do exe: a invisibilidade dos `buffs` do motor antigo (script) acaba onde o exe marca os efeitos 0xc da lista +0x20 (+0x42 = 1). */
  effectExpire?(u: UnitRec, type: number): void;
  /** não é do exe: o pacote 0x86/0x8b ao cliente (0x5041d6/0x5042ba → 0x503bef) — a apresentação começa a magia. */
  clientCast?(spell: number, u: UnitRec, t: UnitRec | null, x: number, y: number): void;
  /** não é do exe: Spell_SpendMana devolveu 0 por falta de mana (a máquina tenta de novo no tique seguinte). */
  noMana?(spell: number, u: UnitRec): void;
}

/** 0x519441 (fastcall; magia): elemento 4 da definição == 1 (aviso com o alvo). */
export function fn_0x519441(s: BookSpellRec): boolean {
  return (s.def4 | 0) === 1;
}

/** 0x5041d6 / 0x5042ba (thiscall; `this` = servidor [0x6831a8]): o pacote da magia ao cliente (stub) e +0x138 = relógio de 16/s
 *  quando vtable+0x2c da unidade ≠ 0. */
function clientSpellPacket(s: BookSpellRec, u: UnitRec, t: UnitRec | null, x: number, y: number, h: SpellHooks): void {
  // stub: cliente (0x503bef envio do pacote 0x86 — 0x8b se a unidade +0xe == 0 — com o id ×2 + 8, alvo/célula e o tempo de voo)
  if (vt2c(u) !== 0) u.f138 = EXE_GLOBALS.clock16 >>> 0;
  h.clientCast?.(s.addr, u, t, x, y);
}

/** 0x519998 Spell_SpendMana (thiscall; magia `s`, unidade, alvo ou null, x, y): ver o cabeçalho. 1 = a magia começa; 0 = não. */
export function spellSpendMana(wd: WorldRec, s: BookSpellRec, u: UnitRec, t: UnitRec | null, x: number, y: number, h: SpellHooks): number {
  if (fn_0x53a5a0(u) !== 0 && u.f68 === null) {
    if (((u.mana << 16) >> 16) < ((s.cost << 16) >> 16)) {
      h.noMana?.(s.addr, u);
      return 0;
    }
    u.mana = ((u.mana - s.cost) << 16) >> 16;
  }
  // 0x54f955/0x54f9b9/0x54feae/0x54ff06/0x54fc41: o ponto alvo (célula ou centro do alvo, corrigido pelo lado) — só vai no pacote
  if (t !== u && fn_0x5106d2(u, 0xc) !== 0) {
    fn_0x53b120fx(wd, u, 0xc);   // os efeitos 0xc da lista +0x20: +0x42 = 1 (lote 5)
    h.effectExpire?.(u, 0xc);    // não é do exe: a invisibilidade dos `buffs` do motor antigo (script)
  }
  if (fn_0x53a5a0(u) === 0 && u.f74 !== null && u.f74 === u.f68) return 1;
  if (!s.hasDef) return 0;
  if ((s.def5 | 0) === 2) {
    // Spell_ProjectileDist 0x516aae ÷ definição[7] (5 para 0xa/0xb): o tempo de voo — só vai no pacote
  } else if (fn_0x542560(u)) {
    return 1;
  }
  if ((s.id & 0xff) === 0xb) {
    if (!h.spellPrismatic) throw new NotPorted("0x519c04");
    h.spellPrismatic(s.addr, u, t, x, y);
    return 1;
  }
  clientSpellPacket(s, u, t, x, y, h);   // 0x5041d6 (fn_0x519441) ou 0x5042ba: o mesmo efeito no servidor
  return 1;
}

/** 0x519d7f Spell_Release (thiscall; magia, unidade, alvo): a magia sai — Spell_Apply 0x519db8, salvo Prismatic Spray (0xb), que saiu
 *  no gasto. */
export function spellRelease(wd: WorldRec, s: BookSpellRec, u: UnitRec, t: UnitRec | null, h: CombatHooks): void {
  if ((s.id & 0xff) !== 0xb) spellApply(wd, s, u, t, 0, 0, h);
}

// ------------------------------------------------------------------------------------- lote 3: a aplicação (Spell_Apply 0x519db8)

/** 0x543130 (fastcall): bit 2 de +0x4c da unidade. */
export function fn_0x543130(u: UnitRec): number {
  return u.f4c & 2;
}

/** 0x5238c5 (fastcall; item): o 1.º efeito da lista item+0x20 (0x53b110/0x53b120/0x53b170) com tipo +0x3c == 0x29 (')'), ou null. */
export function fn_0x5238c5(it: ItemRec): ItemMagicRec | null {
  for (const local_8 of it.magic) {
    if ((local_8.f3c & 0xff) === 0x29) return local_8;
  }
  return null;
}

/** 0x5195b1 Spell_Instance (thiscall; magia, poder em byte): alcance +9, dano +0xe/+0xf e duração +0x10 da instância (ver o cabeçalho;
 *  as contas em x87 do assembly, FPCW de 53 bits = o double do JS). */
export function spellInstance(s: BookSpellRec, param_1: number): void {
  const p = param_1 & 0xff;
  s.range = s.def[6]! & 0xff;
  if ((s.id & 0xff) === 0x17) {
    s.range = (s.range + Math.trunc(p / 3)) & 0xff;
  } else if ((s.range & 0xff) !== 0) {
    s.range = (s.range + Math.trunc(p / 0x1e)) & 0xff;
  }
  const k = p / 30 + 1;                                  // fild; fdiv 30.0 [0x5d0868]; fadd 1.0 [0x5d0858]
  if ((s.def[0x10]! | 0) < 1) s.f0e = 0;
  else s.f0e = crtFtol(s.def[0x10]! * k) & 0xff;
  if ((s.def[0x11]! | 0) < 1) s.f0f = 0;
  else s.f0f = crtFtol(s.def[0x11]! * k - (s.f0e & 0xff)) & 0xff;
  if ((s.def[0xe]! | 0) < 1) {
    if ((s.def[0xb]! | 0) < 1) s.f10 = 0;
    else s.f10 = (((s.def[0xb]! << 4) + Math.trunc((p << 4) / 10)) << 16) >> 16;
  } else if ((s.id & 0xff) === 0xc) {
    s.f10 = ((p << 4) << 16) >> 16;
  } else if ((s.id & 0xff) === 0x12) {
    s.f10 = (Math.trunc((((p * 0xf) << 4) << 1) / 100) << 16) >> 16;
  } else {
    // pow 0x5845c9(1,025 = 0x3ff0666666666666, poder) × [0xe] × 16.0 [0x5d08a8]
    s.f10 = (crtFtol(Math.pow(1.025, p) * s.def[0xe]! * 16) << 16) >> 16;
  }
}

/** 0x510484 Unit_AddHeal (thiscall; unidade, short): +0x150 |= 1; vida += n até a máxima; de < 1 a > 0 → Unit_Revive 0x510534. */
export function unitAddHeal(u: UnitRec, param_1: number, h: SpellHooks): void {
  u.f150 = (u.f150 | 1) >>> 0;
  const sVar1 = (u.f94 << 16) >> 16;
  u.f94 = ((sVar1 + param_1) << 16) >> 16;
  const local_e = ((u.f94 << 16) >> 16) < ((u.f96 << 16) >> 16) ? u.f94 : u.f96;
  u.f94 = (local_e << 16) >> 16;
  if (sVar1 < 1 && 0 < ((u.f94 << 16) >> 16)) {
    if (!h.revive) throw new NotPorted("0x510534");
    h.revive(u);
  }
}

/** 0x54feae (thiscall): cópia do objeto de mapa `p1` em `this` (x, y, célula, frações, +8); devolve `this`. */
export function fn_0x54feae(o: MapObjRec, p1: MapObjRec): MapObjRec {
  o.x = p1.x; o.y = p1.y; o.cell = p1.cell; o.fx = p1.fx; o.fy = p1.fy; o.owner = p1.owner;
  return o;
}
/** 0x54ff06 (thiscall): a mesma cópia, sem retorno. */
export function fn_0x54ff06(o: MapObjRec, p1: MapObjRec): void {
  fn_0x54feae(o, p1);
}

/** 0x516aae Spell_ProjectileDist (cdecl): ftol(√(dx² + dy²)) entre as posições finas (0x54ff5b/0x54ff7c) dos dois objetos de mapa. */
export function spellProjectileDist(a: MapObjRec, b: MapObjRec): number {
  const uVar2 = mapObjFineX(a), uVar3 = mapObjFineX(b), uVar4 = mapObjFineY(a), uVar5 = mapObjFineY(b);
  const dy = (uVar4 - uVar5) | 0, dx = (uVar2 - uVar3) | 0;
  const sq = (Math.imul(dx, dx) + Math.imul(dy, dy)) | 0;   // (double)(int)(dx² + dy²)
  return crtFtol(Math.sqrt(sq));                           // 0x582b64 sqrt
}

/** Base dos objetos de magia 0x50d493 (fastcall): +0x14 = 0, objeto de mapa novo (0x54fa22: célula 0, +8 = o mapa [0x670e48]),
 *  0x50d6ae (+0x18 = 0, +0x1c = 0, +4 = 0). */
export function objBase(wd: WorldRec, o: SpellPayloadRec | SpellObjRec): void {
  o.f14 = 0;
  o.mapObj = mapObjInitPacked16(new MapObjRec(), 0, wd.map.addr);
  o.f18 = 0; o.f1c = 0; o.f04 = 0;
}

/** 0x401880 (new 0x48) + Spell_WallObject 0x51ca4d (fastcall): carga "Effect" zerada. */
export function spellWallObject(wd: WorldRec): SpellPayloadRec {
  const o = new SpellPayloadRec();
  o.addr = wd.allocObj(0x48) >>> 0;
  objBase(wd, o);
  o.vtbl = VT_EFFECT;
  o.fe = 0; o.f3c = 0; o.f3d = 0; o.f40 = 0; o.fc = 0; o.f44 = 0;
  wd.payloads.set(o.addr, o);
  return o;
}

/** 0x401880 (new 0x60) + Spell_DamageObject 0x51e505 (fastcall): Spell_WallObject, o dano +0x48 zerado (0x515825 → 0x51583b),
 *  vtable "Effect_DirectDamage", +0x44 = 0. */
export function spellDamageObject(wd: WorldRec): SpellPayloadRec {
  const o = new SpellPayloadRec();
  o.addr = wd.allocObj(0x60) >>> 0;
  objBase(wd, o);
  o.vtbl = VT_EFFECT;
  o.fe = 0; o.f3c = 0; o.f3d = 0; o.f40 = 0; o.fc = 0; o.f44 = 0;
  o.dmg = new DmgRec();
  o.vtbl = VT_DIRECT_DAMAGE;
  o.f44 = 0;
  wd.payloads.set(o.addr, o);
  return o;
}

/** 0x543040 Spell_FireDamageObj (thiscall; carga, mínimo, faixa): dano elemental B +0x5b/+0x5c, elemento +0x5d = 1. */
export function spellFireDamageObj(o: SpellPayloadRec, param_1: number, param_2: number): void {
  o.dmg.elB0 = param_1 & 0xff; o.dmg.elB1 = param_2 & 0xff; o.dmg.elK = 1;
}
/** 0x543070 Spell_WaterDamageObj: o mesmo com o elemento 2. */
export function spellWaterDamageObj(o: SpellPayloadRec, param_1: number, param_2: number): void {
  o.dmg.elB0 = param_1 & 0xff; o.dmg.elB1 = param_2 & 0xff; o.dmg.elK = 2;
}
/** 0x5430a0 Spell_AirDamageObj: elemento 3. */
export function spellAirDamageObj(o: SpellPayloadRec, param_1: number, param_2: number): void {
  o.dmg.elB0 = param_1 & 0xff; o.dmg.elB1 = param_2 & 0xff; o.dmg.elK = 3;
}
/** 0x5430d0 Spell_EarthDamageObj: elemento 4. */
export function spellEarthDamageObj(o: SpellPayloadRec, param_1: number, param_2: number): void {
  o.dmg.elB0 = param_1 & 0xff; o.dmg.elB1 = param_2 & 0xff; o.dmg.elK = 4;
}
/** 0x543100 (astral): elemento 5. */
export function fn_0x543100(o: SpellPayloadRec, param_1: number, param_2: number): void {
  o.dmg.elB0 = param_1 & 0xff; o.dmg.elB1 = param_2 & 0xff; o.dmg.elK = 5;
}

/** Base dos objetos da lista 0x517719 (fastcall; 0x50d493) / 0x517774 (thiscall; 0x50d549: o objeto de mapa é cópia do dado): +0xe = 0,
 *  +0x3c = 0, +0x40 = 0, +0x41 = 1, +0x42/+0x44/+0x46 = 0. */
function pointEffectBase(wd: WorldRec, size: number, pos: MapObjRec | null): SpellObjRec {
  const o = new SpellObjRec();
  o.addr = wd.allocObj(size) >>> 0;
  if (pos === null) objBase(wd, o);
  else { o.f14 = 0; o.mapObj = fn_0x54feae(new MapObjRec(), pos); o.f18 = 0; o.f1c = 0; o.f04 = 0; }
  o.fe = 0; o.f3c = 0; o.f40 = 0; o.f41 = 1; o.f42 = 0; o.f44 = 0; o.f46 = 0;
  wd.spellObjs.set(o.addr, o);
  return o;
}

/** 0x401880 (new 0x50) + Spell_AttachToTarget 0x5178d4 (thiscall; carga, alvo): "PointEffect" com a carga em +0x4c, o alvo em +0x48 e o
 *  objeto de mapa copiado do alvo (0x54ff06). */
export function spellAttachToTarget(wd: WorldRec, param_1: SpellPayloadRec, param_2: UnitRec): SpellObjRec {
  const o = pointEffectBase(wd, 0x50, null);
  o.vtbl = VT_POINT_EFFECT;
  o.f4c = param_1.addr >>> 0;
  o.f48 = param_2.addr >>> 0;
  fn_0x54ff06(o.mapObj, param_2.mapObj);
  return o;
}

/** 0x401880 (new 0x54) + 0x518d1e (thiscall; filho, objeto de mapa de quem lança, velocidade = definição[7] em short): "SpellTransport"
 *  com o filho em +0x48, +0x4c = 0 e +0x50 = Spell_ProjectileDist(origem, filho) ÷ velocidade (divisão de 64 bits com sinal). */
export function fn_0x518d1e(wd: WorldRec, param_1: SpellObjRec, param_2: MapObjRec, param_3: number): SpellObjRec {
  const o = pointEffectBase(wd, 0x54, param_2);
  o.vtbl = VT_TRANSPORT;
  o.f48 = param_1.addr >>> 0;
  o.f4c = 0;
  const uVar1 = spellProjectileDist(param_2, param_1.mapObj);
  o.f50 = (Math.trunc(uVar1 / ((param_3 << 16) >> 16)) << 16) >> 16;
  return o;
}

/** Os `case` de Spell_Apply que a porta cobre (o resto vai inteiro para o gancho `spellApply` antes de qualquer efeito): Heal (0x18) e o
 *  objeto de dano (dano na definição; não Heal/Drain Life) preso ao alvo (definição[8] = 1). O teste do dano da instância (+0xe + +0xf
 *  ≠ 0) é o do exe; aqui vale o da definição ([0x10] ou [0x11] > 0 ⇒ instância ≠ 0, salvo o byte que dá a volta: NotPorted). */
export function spellApplyPorted(s: BookSpellRec): boolean {
  const id = s.id & 0xff;
  if (id === 0x18 || id === 0x1b) return true;
  if (EFFECT_CASES.has(id)) return true;   // lote 5: as cargas "Effect" (no alvo e em área: SpellArea)
  if (id === 0x1a || id === 0) return false;
  return ((s.def[0x10]! | 0) > 0 || (s.def[0x11]! | 0) > 0) && (s.def[8]! | 0) === 1;
}

/** `[unidade]+0x14` (dono) ≠ 0: todo registro espelhado tem dono; o endereço que saiu do espelho (objeto do exe destruído) conta como
 *  sem dono [est]. */
function hasOwner(wd: WorldRec, addr: number): boolean {
  try { wd.map.unitAt(addr); return true; } catch { return false; }
}

/** 0x519db8 Spell_Apply (thiscall; magia, unidade, alvo ou null, x, y): ver o cabeçalho. */
export function spellApply(wd: WorldRec, s: BookSpellRec, param_1: UnitRec, param_2: UnitRec | null, param_3: number, param_4: number, h: CombatHooks): void {
  const bVar1 = fn_0x543130(param_1);
  const local_14 = bVar1 === 0 ? 1 : 0;
  if (!s.hasDef) return;
  if (!spellApplyPorted(s)) {
    if (!h.spellApply) throw new NotPorted("0x519db8");
    h.spellApply(s.addr, param_1, param_2, param_3, param_4);
    return;
  }
  let local_44: number;
  const local_18 = s.def[2]! | 0;
  if (param_1.f68 === null) {
    const iVar15 = (param_1.f88 << 16) >> 16;
    const iVar10 = ((((param_1.dmg.sk[local_18] ?? 0) << 16) >> 16) - 0x1e + iVar15) | 0;
    local_44 = iVar10 < 0 ? 0 : 0xff < iVar10 ? 0xff : iVar10;
  } else {
    const local_4c = fn_0x5238c5(param_1.f68);
    local_44 = local_4c === null ? 0 : (local_4c.f42 << 16) >> 16;
  }
  spellInstance(s, local_44 & 0xff);
  // local_40 = poder/30 + 1 e local_30 = poder/45 + 1 (double): só os `case` não portados os usam
  if (local_14 === 0 && param_1.f68 === null) vt70(param_1, param_2, s.id & 0xff, h.xpOnCast);
  let local_48: SpellPayloadRec | null = null;
  let local_34: SpellPayloadRec | null = null;
  let local_28: SpellObjRec | null = null;
  const local_24 = new MapObjRec();
  mapObjInit(local_24, 0, 0, 0);                             // 0x54f955
  if (param_2 === null) {
    mapObjInit(local_24, param_3 & 0xff, param_4 & 0xff, wd.map.addr);   // 0x54f9b9(x, y, [0x670e48])
  } else {
    const local_b8 = fn_0x54feae(new MapObjRec(), param_2.mapObj);
    fn_0x54ff06(local_24, local_b8);
    if (1 < (vtGetSize(param_2) & 0xff)) {
      const iVar10 = (unitCenterY(param_2) & 0xffff) - 1;
      mapObjSetFine(local_24, (unitCenterX(param_2) & 0xffff) - 1, iVar10);
    }
    if (vt2c(param_2) !== 0 && (param_2.f4c & 8) !== 0) return;
  }
  const id = s.id & 0xff;
  if (((s.f0e & 0xff) + (s.f0f & 0xff)) !== 0 && id !== 0x18 && id !== 0x1a) {
    const local_190 = spellDamageObject(wd);
    local_34 = local_190;
    local_190.fc = id;
    local_34.f44 = fn_0x542560(param_1) ? 0 : param_1.addr >>> 0;
    switch (local_18) {
      case 1: spellFireDamageObj(local_34, s.f0e, s.f0f); break;
      case 2: spellWaterDamageObj(local_34, s.f0e, s.f0f); break;
      case 3: spellAirDamageObj(local_34, s.f0e, s.f0f); break;
      case 4: spellEarthDamageObj(local_34, s.f0e, s.f0f); break;
      case 5: fn_0x543100(local_34, s.f0e, s.f0f); break;
    }
    local_34.fe = (id * 2 + 9) & 0xffff;
  } else {
    switch (id) {
      case 0x18: {
        const t = param_2!;
        let local_50 = 1;
        // mundo [0x66832c] ≠ 0, os dois com dono (sempre no espelho) e guerra na tabela mundo+0xa8c4 [id(dono do alvo) + id(dono) × 0x46]
        if ((wd.dipTable[((t.owner.f04 << 16) >> 16) + ((param_1.owner.f04 << 16) >> 16) * 0x46 + 8]! & 1) !== 0) local_50 = 0;
        if (local_50 !== 0 && -10 < ((t.f94 << 16) >> 16) && ((t.f98 << 16) >> 16) !== 0) {
          const bVar = s.f0e & 0xff;
          let local_1a8 = randOne(wd, s.f0f & 0xff, 0x51a35f);
          local_1a8 = (bVar + local_1a8) | 0;
          const room = (((t.f96 << 16) >> 16) - ((t.f94 << 16) >> 16)) | 0;
          if (room <= local_1a8) local_1a8 = room;
          t.f150 = 0;
          unitAddHeal(t, (local_1a8 << 16) >> 16, h);
          h.clientHeal?.(t, local_1a8);   // stub: cliente (Server_Event com +0x150)
        }
        return;
      }
      default:
        if (EFFECT_CASES.has(id)) {
          // lotes 4–5: carga "Effect" (exe/effects.ts); null = destruída, sai
          local_48 = spellApplyEffect(wd, s, local_44, param_1, param_2);
          if (local_48 === null) return;
          break;
        }
        // dano da instância 0 com a definição com dano (o byte deu a volta) ou caso fora de `spellApplyPorted`: exec 0
        throw new NotPorted(`0x519db8 (magia 0x${id.toString(16)})`);
    }
  }
  // Spell_Distribute
  if (local_48 === null) local_48 = local_34;
  if ((s.def[8]! | 0) === 1) {
    if (param_2 === null) return;   // stub: log "Spell: oops, can't cast point effect..." (Server_Log 0x43a0a8)
    local_28 = spellAttachToTarget(wd, local_48!, param_2);
    local_28.f3c = fn_0x542560(param_1) ? 0 : param_1.addr >>> 0;
    local_28.fc = id;
    local_28.f41 = (1 - ((s.f0a & 0xff) !== 0 ? 1 : 0)) & 0xff;
    local_28.fe = (id * 2 + 9) & 0xffff;
    local_48!.f44 = fn_0x542560(param_1) ? 0 : param_1.addr >>> 0;
  } else {
    // lote 5: SpellArea (raio definição[9]; duração definição[0xb] × 16 + poder × 16 ÷ 10 → modo 1; definição[8] = 5 → modo 2)
    const local_ac = spellAreaConstruct(wd, local_48!, local_24, s.def[9]! & 0xff);
    local_ac.f3c = fn_0x542560(param_1) ? 0 : param_1.addr >>> 0;
    local_ac.fc = id;
    if (local_ac.f48 !== 0) wd.payloadAt(local_ac.f48).f44 = local_ac.f3c >>> 0;
    local_ac.fe = (id * 2 + 9) & 0xffff;
    local_ac.f50 = (((s.def[0xb]! | 0) << 4) << 16) >> 16;
    if (local_ac.f50 !== 0) {
      local_ac.f50 = ((local_ac.f50 + Math.trunc((local_44 << 4) / 10)) << 16) >> 16;
      local_ac.f08 = 1;
    }
    if ((s.def[8]! | 0) === 5) {
      local_ac.f08 = 2;
      local_ac.f50 = 0;
    }
    const uVar6 = mapObjCellOf(local_24);
    const bVar1 = dirFromDelta16(param_1, uVar6) & 0xff;
    local_ac.f4e = (bVar1 >> 5) & 0xff;
    local_28 = local_ac;
    fn_0x55b507(wd, local_ac);   // setores em [0x670e48]+0x92ecc
  }
  if ((s.def[5]! | 0) === 1) {
    local_28.fe = (id * 2 + 9) & 0xffff;
    wd.lists.spellObjs.addTail(local_28.addr);   // 0x542e60
    h.clientMissile?.(s.addr, param_1, param_2, 0);
  } else if ((s.def[5]! | 0) === 2) {
    const local_38 = fn_0x518d1e(wd, local_28, param_1.mapObj, s.def[7]!);
    if (id === 10 || id === 11) local_38.f50 = 10;
    wd.lists.spellObjs.addTail(local_38.addr);   // 0x542e60
    h.clientMissile?.(s.addr, param_1, param_2, (local_38.f50 << 16) >> 16);
  }
}

// --------------------------------------------------------------------------- lote 3: os objetos de magia da lista do mundo

/** Destruição pela vtable+4(1): 0x542e30 → 0x518e30 (projétil: destrói os filhos +0x48/+0x4c), 0x542d20 → 0x517aa0 (preso: destrói a
 *  carga +0x4c), 0x543330/0x543300 (cargas) → 0x50d6d6 (base: o objeto de mapa); 0x401860 libera. */
function deletePayload(wd: WorldRec, a: number): void {
  deleteFx(wd, a);
}
function deleteSpellObj(wd: WorldRec, o: SpellObjRec): void {
  if (o.vtbl === VT_TRANSPORT) {
    if (o.f48 !== 0) { const c = wd.spellObjs.get(o.f48 >>> 0); if (c) deleteSpellObj(wd, c); o.f48 = 0; }
    if (o.f4c !== 0) { const c = wd.spellObjs.get(o.f4c >>> 0); if (c) deleteSpellObj(wd, c); o.f4c = 0; }
  } else if (o.vtbl === VT_POINT_EFFECT) {
    if (o.f4c !== 0) { deletePayload(wd, o.f4c); o.f4c = 0; }
  } else if (o.vtbl === VT_SPELL_AREA) {
    fn_0x542d50(wd, o);
    return;
  } else {
    throw new Error(`objeto de magia 0x${o.addr.toString(16)} com vtable 0x${o.vtbl.toString(16)}`);
  }
  wd.spellObjs.delete(o.addr >>> 0);
}

/** 0x518efd (fastcall; vtable+0x18 do projétil): +0x50−−; a < 1 o filho (+0x48, ou +0x4c) entra na lista do mundo (0x542e60), os dois
 *  ponteiros zeram e +0x40 = 1 (acabou). */
export function fn_0x518efd(wd: WorldRec, o: SpellObjRec): void {
  o.f50 = ((o.f50 - 1) << 16) >> 16;
  if (o.f50 < 1) {
    if (o.f48 === 0) wd.lists.spellObjs.addTail(o.f4c);
    else wd.lists.spellObjs.addTail(o.f48);
    o.f48 = 0;
    o.f4c = 0;
    o.f40 = 1;
  }
}

/** vtable+0x3c da carga (aplicar no alvo): 0x51e65b no dano; 0x51ce12 no efeito com duração (exe/effects.ts). */
function payloadApply(wd: WorldRec, p: SpellPayloadRec, t: UnitRec, h: CombatHooks): void {
  if (p.vtbl === VT_DIRECT_DAMAGE) fn_0x51e65b(wd, p, t, h);
  else if (p.vtbl === VT_EFFECT) fn_0x51ce12(wd, p, t, h);
  else throw new NotPorted(`carga vtable 0x${p.vtbl.toString(16)}`);
}

/** 0x51e65b (thiscall; vtable+0x3c do dano; alvo): unidade (vtable+0x2c) → dano = vtable+0x54 (Unit_PhysicalDamage 0x516f6f nas três
 *  vtables) com o dano +0x48 e quem lançou +0x44; vida −= dano; dano > 0 → experiência de quem lançou (vtable+0x6c com o id +0xc, se
 *  houver os dois) e 's' ao cliente (0x504b1d, stub). Alvo que não é unidade (vtable+0x34: 0x5201b2, exec 0): NotPorted. */
export function fn_0x51e65b(wd: WorldRec, o: SpellPayloadRec, param_1: UnitRec, h: CombatHooks): void {
  if (vt2c(param_1) === 0) {
    if (vt34(param_1) !== 0) throw new NotPorted("0x5201b2");
    return;
  }
  const a = o.f44 === 0 ? null : wd.map.unitAt(o.f44);
  const iVar2 = unitPhysicalDamage(wd, param_1, o.dmg, a, h);
  const local_c = (iVar2 << 16) >> 16;
  param_1.f94 = ((((param_1.f94 << 16) >> 16) - local_c) << 16) >> 16;
  if (0 < iVar2) {
    if (o.f44 !== 0 && (o.fc & 0xffff) !== 0) vt6c(a!, param_1, iVar2, o.fc & 0xffff, h.xpOnHit);
    h.clientSpellHit?.(a, param_1, iVar2, o.fc & 0xffff);   // stub: cliente (0x504b1d 's')
  }
}

/** 0x542d00 → 0x517949 (fastcall; vtable+0x18 do preso ao alvo): quem lançou a carga sem dono → carga+0x44 = 0; alvo unidade → a carga
 *  age nele (vtable+0x3c, se ele tem dono) e, com quem lançou e +0x41: marca o agressor no alvo (+0x40 = quem lançou e +0x48 = id da
 *  carga; sem modelo, 0x542560 → +0x40 = 0) e o aviso 0x56e6b8; +0x40 = 1 (acabou). */
export function fn_0x517949(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  if (o.f4c !== 0) {
    const p = wd.payloadAt(o.f4c);
    if (p.f44 !== 0 && !hasOwner(wd, p.f44)) p.f44 = 0;
  }
  const t = wd.map.unitAt(o.f48);
  if (vt2c(t) === 0) {
    if (vt34(t) !== 0) payloadApply(wd, wd.payloadAt(o.f4c), t, h);
  } else {
    if (o.f48 !== 0 && hasOwner(wd, o.f48)) payloadApply(wd, wd.payloadAt(o.f4c), t, h);
    if (o.f3c !== 0 && (o.f41 & 0xff) !== 0) {
      const c = wd.map.unitAt(o.f3c);
      if (!fn_0x542560(c)) {
        if (hasOwner(wd, o.f3c)) {
          t.f40 = o.f3c >>> 0;
          t.f48 = wd.payloadAt(o.f4c).fc & 0xff;
        }
      } else {
        t.f40 = 0;
      }
      if (o.f48 !== 0 && o.f3c !== 0 && hasOwner(wd, o.f3c) && hasOwner(wd, o.f48)) fn_0x56e6b8(wd, c, t, 0);
    }
  }
  o.f40 = 1;
}

/** vtable+0x18 dos objetos da lista: 0x518efd (projétil), 0x542d00 (preso ao alvo), SpellArea_Process 0x517cfe (área). */
function spellObjTick(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  if (o.vtbl === VT_TRANSPORT) fn_0x518efd(wd, o);
  else if (o.vtbl === VT_POINT_EFFECT) fn_0x517949(wd, o, h);
  else if (o.vtbl === VT_SPELL_AREA) spellAreaProcess(wd, o, h);
  else throw new Error(`objeto de magia 0x${o.addr.toString(16)} com vtable 0x${o.vtbl.toString(16)}`);
}

/** 0x52c279 (fastcall; contentor [[0x6044c4]+0x7c]+4): um tique dos objetos de magia (ver o cabeçalho). */
export function fn_0x52c279(wd: WorldRec, h: CombatHooks): void {
  const local_10 = new CListPtrIter();
  let a = local_10.first(wd.lists.spellObjs);
  while (a !== 0) {
    const local_8 = wd.spellObjAt(a);
    if (local_8.f3c !== 0 && !hasOwner(wd, local_8.f3c)) local_8.f3c = 0;
    if ((local_8.f42 & 0xffff) !== (local_8.f44 & 0xffff)) {
      // IsKindOf(SpellArea 0x5f8340) e jogo local: o pacote ao cliente dos jogadores novos na máscara (0x5167c6/0x5045a5, stub) e
      // +0x44 = +0x42; os outros objetos só chamam GetRuntimeClass (0x518ca1...)
      if (local_8.vtbl === 0x5d10e0 && (EXE_GLOBALS.f74 >>> 0) !== 0) local_8.f44 = local_8.f42 & 0xffff;
    }
    spellObjTick(wd, local_8, h);
    if ((local_8.f40 & 0xff) !== 0) {
      wd.lists.spellObjs.remove(local_8.addr);   // 0x53cc70: 0x53cf30 (Find + RemoveAt) e vtable+4(1)
      deleteSpellObj(wd, local_8);
    }
    a = local_10.next();
  }
}

// --------------------------------------------------------------------------------------------- lote 5: SpellArea (vtable 0x5d10e0)

/** 0x401880 (new 0x54) + SpellArea_Construct 0x517c1a (thiscall; carga, objeto de mapa, raio): 0x517774 (base com o objeto de mapa
 *  copiado), vtable 0x5d10e0, carga +0x48, +8 = 0, +0x4c = 0, raio +0x4d, +0x4f = 0, +0x50 = 0. */
export function spellAreaConstruct(wd: WorldRec, param_1: SpellPayloadRec, param_2: MapObjRec, param_3: number): SpellObjRec {
  const o = pointEffectBase(wd, 0x54, param_2);
  o.vtbl = VT_SPELL_AREA;
  o.f48 = param_1.addr >>> 0;
  o.f08 = 0;
  o.f4c = 0;
  o.f4d = param_3 & 0xff;
  o.f4f = 0;
  o.f50 = 0;
  return o;
}

/** 0x542d50 (thiscall; vtable+4(1) da área): 0x517c72 (a carga +0x48 destruída, vtable+4(1), e zerada; 0x542ce0 → 0x50d6d6, a base) e
 *  0x401860 libera. */
export function fn_0x542d50(wd: WorldRec, o: SpellObjRec): void {
  if (o.f48 !== 0) { deletePayload(wd, o.f48); o.f48 = 0; }
  wd.spellObjs.delete(o.addr >>> 0);
}

/** 0x518ba3 (fastcall): a vaga da área no registro de ocupação da célula (occCur+0x14 + 4 × vaga) pelo id +0xc: Wall of Fire 0, Poison
 *  Cloud 2, Wall of Earth 3, Light 4, Darkness 5; outro id: log "MapLayer::call: Invalid Area Effect" (stub) e o byte baixo 0. */
export function fn_0x518ba3(param_1: SpellObjRec): number {
  switch (param_1.fc & 0xffff) {
    case 3: return 0;
    case 6: return 2;
    case 0xe: return 5;
    case 0xf: return 4;
    case 0x11: return 3;
    default: return 0;   // stub: Server_Log 0x43a11b (o resto de EAX é lixo; quem chama usa o byte baixo)
  }
}

const OCC_AREA_OFF = 0x54040, OCC_AREA_N_OFF = 0x5402e;   // occCur+0x14 u32[6] áreas na célula; occCur+2 u8 quantas

/** occCur+2 = quantas vagas de área não nulas (laço comum de 0x55a37a e 0x55a533). */
function occCountAreas(m: MapRec): void {
  m.mem[OCC_AREA_N_OFF] = 0;
  for (let i = 0; i < 6; i++) if (m.u32(i * 4 + OCC_AREA_OFF) !== 0) m.mem[OCC_AREA_N_OFF] = (m.mem[OCC_AREA_N_OFF]! + 1) & 0xff;
}

/** 0x55a37a (thiscall; área, célula short): põe a área na vaga dela no registro de ocupação da célula (criando-o, 0x5508a0), conta as
 *  áreas, grava (0x55f430) e reaplica às grades (0x550a53). 0 se o registro não existe nem depois de criado. */
export function fn_0x55a37a(m: MapRec, param_1: SpellObjRec, param_2: number): number {
  const key = (param_2 << 16) >> 16;
  if (!m.occ.lookup(key, m.occCur)) {
    fn_0x5508a0(m, key & 0xffff);
    if (!m.occ.lookup(key, m.occCur)) return 0;
  }
  const uVar3 = fn_0x518ba3(param_1);
  m.setU32((uVar3 & 0xff) * 4 + OCC_AREA_OFF, param_1.addr);
  occCountAreas(m);
  m.occ.setAt(key, m.occCur);
  fn_0x550a53(m, key & 0xffff);
  return 1;
}

/** 0x55a325 (thiscall; área, x, y): 0x55a37a na célula y × 0x100 + x. */
export function fn_0x55a325(m: MapRec, param_1: SpellObjRec, param_2: number, param_3: number): number {
  return fn_0x55a37a(m, param_1, (param_3 * 0x100 + (param_2 & 0xff)) & 0xffff);
}

/** 0x55a533 (thiscall; área (endereço), célula): tira a área da vaga dela se é ela que está lá: conta, grava, reaplica às grades e
 *  desfaz o registro vazio (0x5513b6 → 0x550966). 1 se tirou. */
export function fn_0x55a533(wd: WorldRec, param_1: number, param_2: number): number {
  const m = wd.map, cell = param_2 & 0xffff;
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  const a = wd.spellObjAt(param_1);
  const uVar3 = fn_0x518ba3(a);
  if ((m.u32((uVar3 & 0xff) * 4 + OCC_AREA_OFF) >>> 0) === (param_1 >>> 0)) {
    m.setU32((fn_0x518ba3(a) & 0xff) * 4 + OCC_AREA_OFF, 0);
    occCountAreas(m);
    m.occ.setAt(cell, m.occCur);
    fn_0x550a53(m, cell);
    if (occRecIsEmpty(m.occCur) !== 0) fn_0x550966(m, cell);
    return 1;
  }
  return 0;
}

/** 0x55a4de (thiscall; área (endereço), x, y): 0x55a533 na célula y × 0x100 + x. */
export function fn_0x55a4de(wd: WorldRec, param_1: number, param_2: number, param_3: number): number {
  return fn_0x55a533(wd, param_1, (param_3 * 0x100 + (param_2 & 0xff)) & 0xffff);
}

/** 0x55a88b (thiscall; área, célula): a área que ocupa a vaga desta na célula (com registro: grade +0x10000 bit 0x20), ou 0. */
export function fn_0x55a88b(m: MapRec, param_1: SpellObjRec, param_2: number): number {
  const cell = param_2 & 0xffff;
  if ((m.mem[cell + MAP_MASK_OFF]! & 0x20) === 0) return 0;
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  const uVar3 = fn_0x518ba3(param_1);
  return m.u32((uVar3 & 0xff) * 4 + OCC_AREA_OFF) >>> 0;
}

/** 0x55a8f8 (thiscall; área, x, y): 0x55a88b na célula y × 0x100 + x. */
export function fn_0x55a8f8(m: MapRec, param_1: SpellObjRec, param_2: number, param_3: number): number {
  return fn_0x55a88b(m, param_1, (param_3 * 0x100 + (param_2 & 0xff)) & 0xffff);
}

/** 0x5045a5 (thiscall; área, marcou?): o pacote da área ao cliente (0x503e41/0x503bef: `clientArea`). Do servidor só fica o efeito
 *  colateral no registro de ocupação corrente (occCur): fora da Fireball (id 2: pacote 0x86 sem consulta), a máscara das células do
 *  quadrado (lado 2 × raio + 1, x por fora) consulta cada célula com 0x55a88b. */
export function fn_0x5045a5(wd: WorldRec, param_1: SpellObjRec, param_2: number, h: CombatHooks): void {
  if ((param_1.fc & 0xffff) !== 2) {
    const bVar1 = param_1.f4d & 0xff;
    const x0 = (mapObjCellX(param_1.mapObj) - bVar1) & 0xff;
    const y0 = (mapObjCellY(param_1.mapObj) - bVar1) & 0xff;
    for (let local_10 = 0; local_10 <= bVar1 * 2; local_10++) {
      for (let local_20 = 0; local_20 <= bVar1 * 2; local_20++) fn_0x55a88b(wd.map, param_1, local_10 + x0 + (local_20 + y0) * 0x100);
    }
  }
  h.clientArea?.(param_1, param_2 !== 0);   // stub: cliente (0x503e41 / 0x503bef)
}

/** 0x55a82c (thiscall; célula): o deslocamento das vagas de área (occCur+0x14) do registro da célula, ou 0 sem registro. */
export function fn_0x55a82c(m: MapRec, param_1: number): number {
  const cell = param_1 & 0xffff;
  if ((m.mem[cell + MAP_MASK_OFF]! & 0x20) === 0) return 0;
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  return OCC_AREA_OFF;
}

/** 0x5189b5 SpellArea_FireExtra (thiscall; x, y): as áreas que se anulam na célula: fogo (2/3) apaga a nuvem de veneno (vaga 2) e a
 *  vaga 1; o veneno (6) some onde há fogo (vaga 0); Darkness (0xe) com Light (vaga 4) e Light (0xf) com Darkness (vaga 5) tiram as
 *  duas. A área tirada por último vai ao cliente (0x5045a5). */
export function spellAreaFireExtra(wd: WorldRec, o: SpellObjRec, param_1: number, param_2: number, h: CombatHooks): void {
  const m = wd.map, x = param_1 & 0xff, y = param_2 & 0xff;
  const piVar2 = fn_0x55a82c(m, ((param_1 & 0xff) + (param_2 & 0xffff) * 0x100) & 0xffff);
  if (piVar2 === 0) return;
  const slot = (i: number) => m.u32(piVar2 + i * 4) >>> 0;
  const off = (a: number) => { fn_0x55a4de(wd, a, x, y); fn_0x5045a5(wd, wd.spellObjAt(a), 0, h); };
  switch (o.fc & 0xffff) {
    case 2: case 3:
      if (slot(2) !== 0) off(slot(2));
      if (slot(1) !== 0) off(slot(1));
      break;
    case 6:
      if (slot(0) !== 0) off(slot(2));
      break;
    case 0xe:
      if (slot(4) !== 0) {
        fn_0x55a4de(wd, slot(5), x, y);
        off(slot(4));
      }
      break;
    case 0xf:
      if (slot(5) !== 0) {
        fn_0x55a4de(wd, slot(4), x, y);
        off(slot(5));
      }
      break;
  }
}

/** 0x559c28 SpellArea_FireExtra2 (thiscall; x, y): bit 0x10 nas grades +0x10000 e +0x20000 da célula. */
export function spellAreaFireExtra2(m: MapRec, param_1: number, param_2: number): void {
  const c = (param_2 & 0xff) * 0x100 + (param_1 & 0xff);
  m.mem[c + 0x10000] = (m.mem[c + 0x10000]! | 0x10) & 0xff;
  m.mem[c + 0x20000] = (m.mem[c + 0x20000]! | 0x10) & 0xff;
}

/** 0x5184bf (thiscall; x, y, fogo extra): marca a área na célula, salvo onde há estrutura com o bit 4 da grade +0x10000. Wall of Earth
 *  (0x11) só onde não há unidade (0x551edb); as outras marcam (0x55a325), anulam as opostas (0x5189b5) e, com o 3.º argumento, o bit
 *  0x10 do fogo (0x559c28). */
export function fn_0x5184bf(wd: WorldRec, o: SpellObjRec, param_1: number, param_2: number, param_3: number, h: CombatHooks): void {
  const m = wd.map, x = param_1 & 0xff;
  if (fn_0x559bc9(m, ((param_2 & 0xff) * 0x100 + x) & 0xffff) !== 0) {   // Map_ObjectAtCell 0x559b7f
    if ((m.mem[cellOff10000(x, param_2)]! & 4) !== 0) return;              // 0x542dc0
  }
  if ((o.fc & 0xffff) === 0x11) {
    const iVar2 = fn_0x551edb(m, (x + (param_2 & 0xffff) * 0x100) & 0xffff);
    if (iVar2 === 0) fn_0x55a325(m, o, x, param_2 & 0xff);
  } else {
    fn_0x55a325(m, o, x, param_2 & 0xff);
    spellAreaFireExtra(wd, o, x, param_2, h);
    if (param_3 !== 0) spellAreaFireExtra2(m, x, param_2);
  }
}

/** 0x5183a2 SpellArea_MarkCells (fastcall): as células com |dx| + |dy| ≤ raio + 1 no quadrado do raio (0x5184bf); o fogo extra se a
 *  carga é Effect_DirectDamage (IsKindOf 0x5f8f38: só a vtable 0x5d11d0) com +0x5c ≠ 0; cliente (0x5045a5 com 1); +0x4c = 1. */
export function spellAreaMarkCells(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  const cVar1 = mapObjCellX(o.mapObj) & 0xff;
  const bVar2 = mapObjCellY(o.mapObj) & 0xff;
  const p = wd.payloadAt(o.f48);
  const local_20 = p.vtbl === VT_DIRECT_DAMAGE && (p.dmg.elB1 & 0xff) !== 0 ? 1 : 0;
  const r = o.f4d & 0xff;
  for (let local_14 = -r; local_14 <= r; local_14++) {
    for (let local_18 = -r; local_18 <= r; local_18++) {
      if (crtAbs(local_14) + crtAbs(local_18) <= r + 1) fn_0x5184bf(wd, o, (cVar1 + local_14) & 0xff, (bVar2 + local_18) & 0xffff, local_20, h);
    }
  }
  fn_0x5045a5(wd, o, 1, h);
  o.f4c = 1;
}

/** 0x518024 (fastcall): definição[8] da magia +0xc (0x53e260): 4 → SpellArea_Wall 0x5182b6 (exec 0, NotPorted), senão 0x5183a2. */
export function fn_0x518024(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  if ((wd.spellDefCol(o.fc & 0xffff, 8) | 0) === 4) throw new NotPorted("0x5182b6");
  spellAreaMarkCells(wd, o, h);
}

/** 0x518594 SpellArea_Unmark (fastcall): tira a área de todas as células do quadrado do raio (0x55a4de), cliente (0x5045a5 com 0,
 *  occCur) e +0x4c = 0. */
export function spellAreaUnmark(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  const bVar1 = mapObjCellX(o.mapObj) & 0xff;
  const bVar2 = mapObjCellY(o.mapObj) & 0xff;
  const r = o.f4d & 0xff;
  for (let local_10 = bVar1 - r; local_10 <= bVar1 + r; local_10++) {
    for (let local_14 = bVar2 - r; local_14 <= bVar2 + r; local_14++) fn_0x55a4de(wd, o.addr, local_10 & 0xff, local_14 & 0xff);
  }
  fn_0x5045a5(wd, o, 0, h);
  o.f4c = 0;
}

/** 0x518681 SpellArea_HitCell (thiscall; unidade da célula ou null): a carga age nela (vtable+0x3c), salvo Wall of Earth; Fireball (2:
 *  cópia do dano dividida pelo lado², 0x51e5db, exec 0): NotPorted. Depois, salvo Light (0xf), unidade com vtable+0x20 ≠ 0 e quem lançou:
 *  marca o agressor (+0x40 = quem lançou e +0x48 = id da carga; não na Darkness; sem modelo, 0x542560 → +0x40 = 0) e o aviso 0x56e6b8. */
export function spellAreaHitCell(wd: WorldRec, o: SpellObjRec, param_1: UnitRec | null, h: CombatHooks): void {
  if (param_1 === null || (o.fc & 0xffff) === 0x11) return;
  if ((o.fc & 0xffff) === 2) throw new NotPorted("0x51e5db");
  payloadApply(wd, wd.payloadAt(o.f48), param_1, h);
  if ((o.fc & 0xffff) !== 0xf && (fn_0x55f330(param_1) & 0xff) !== 0 && o.f3c !== 0) {
    const c = wd.map.unitAt(o.f3c);
    if (!fn_0x542560(c)) {
      if (!hasOwner(wd, o.f3c)) param_1.f40 = 0;
      else if ((o.fc & 0xffff) !== 0xe) {
        param_1.f40 = o.f3c >>> 0;
        param_1.f48 = wd.payloadAt(o.f48).fc & 0xff;
      }
    } else {
      param_1.f40 = 0;
    }
    if (hasOwner(wd, o.f3c) && hasOwner(wd, param_1.addr)) fn_0x56e6b8(wd, c, param_1, 1);
  }
}

/** 0x517cfe SpellArea_Process (fastcall; vtable+0x18 da área): modo 2 → Spell_AreaProgressive 0x51806c e modo 0 → SpellArea_ApplyAll
 *  0x518833 (exec 0: NotPorted); modo 1: sem células marcadas → 0x518024; tempo +0x50 = 0 → desmarca e acaba (+0x40 = 1); senão
 *  +0x50−− e a cada 16 tiques as unidades nas células do quadrado do raio onde a vaga desta área está ocupada (0x55a8f8 → 0x551edb)
 *  levam a carga (0x518681). */
export function spellAreaProcess(wd: WorldRec, o: SpellObjRec, h: CombatHooks): void {
  if ((o.f08 & 2) !== 0) throw new NotPorted("0x51806c");
  if ((o.f08 & 1) === 0) throw new NotPorted("0x518833");
  if ((o.f4c & 0xff) === 0) {
    fn_0x518024(wd, o, h);
  } else if (((o.f50 << 16) >> 16) === 0) {
    spellAreaUnmark(wd, o, h);
    o.f40 = 1;
  } else {
    o.f50 = ((o.f50 - 1) << 16) >> 16;
    if ((o.f50 & 0xf) === 0) {
      const bVar1 = mapObjCellX(o.mapObj) & 0xff;
      const bVar2 = mapObjCellY(o.mapObj) & 0xff;
      const r = o.f4d & 0xff;
      for (let local_10 = -r; local_10 <= r; local_10++) {
        for (let local_14 = -r; local_14 <= r; local_14++) {
          const iVar4 = fn_0x55a8f8(wd.map, o, (local_10 + bVar1) & 0xffff, local_14 + bVar2);
          if (iVar4 !== 0) {
            const piVar5 = fn_0x551edb(wd.map, (local_10 + bVar1 + (local_14 + bVar2) * 0x100) & 0xffff);
            spellAreaHitCell(wd, o, piVar5 === 0 ? null : wd.map.unitAt(piVar5), h);
          }
        }
      }
    }
  }
}
