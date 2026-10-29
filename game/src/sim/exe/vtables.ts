/**
 * Porta literal do servidor do allods2.exe: as chamadas virtuais das unidades (`(**(code **)(*u + slot))(...)`), resolvidas pela
 * vtable do registro (`UnitRec.vtbl`: 0x5d0eb0 monstros, 0x5d0f40 humanos, 0x5d0fb8 herói; tabelas lidas do .rdata). O slot +0x1c
 * (lado) está em path.ts (`vtGetSize`); +0x14 Unit_Regen (as 3 vtables → 0x50fc5a) está em regen.ts (`vt14`); +0x18 Unit_ActionMachine não passa por aqui.
 * Portadas: 0x542410 e 0x542720 (+0x2c: 1), 0x542420 (+0x30: 0 = sem equipamento) e 0x542730 (+0x30: 1), 0x542030 (+0x34: 0),
 * 0x5423f0 (+0x6c dos monstros: nada), 0x50f048 (+0x74 dos monstros: modelo[0x21] = duração da queda), 0x512526 (+0x74 dos humanos:
 * modelo[0x17], −1 ou lista vazia → 8), 0x5423a0 (+0x4c dos monstros: nada).
 * Com gancho (magia/experiência/itens, motor antigo): 0x513128 Unit_XPOnHit (+0x6c dos humanos), 0x512697 (+0x4c dos humanos: larga o
 * equipamento ao morrer; exec 0).
 */
import { NotPorted } from "./walk_action";
import type { UnitRec } from "./types";

export const VT_MONSTER = 0x5d0eb0, VT_HUMAN = 0x5d0f40, VT_HERO = 0x5d0fb8;

function noSlot(u: UnitRec, slot: number): never {
  throw new Error(`vtable 0x${u.vtbl.toString(16)} sem slot +0x${slot.toString(16)} espelhado`);
}

/** +0x2c: 0x542410 / 0x542720 → 1 (a unidade pode ser golpeada de perto; 0x516c1f). */
export function vt2c(u: UnitRec): number {
  switch (u.vtbl) { case VT_MONSTER: case VT_HUMAN: case VT_HERO: return 1; }
  return noSlot(u, 0x2c);
}

/** +0x30: 0x542420 (monstro) → 0, 0x542730 (humano/herói) → 1: tem equipamento (0x516f6f: dano ×15 do bit 0x80; 0x50f12c: espera da arma). */
export function vt30(u: UnitRec): number {
  switch (u.vtbl) { case VT_MONSTER: return 0; case VT_HUMAN: case VT_HERO: return 1; }
  return noSlot(u, 0x30);
}

/** +0x34: 0x542030 → 0 (golpe à distância 0x516ea0 nunca; 0x516c1f). */
export function vt34(u: UnitRec): number {
  switch (u.vtbl) { case VT_MONSTER: case VT_HUMAN: case VT_HERO: return 0; }
  return noSlot(u, 0x34);
}

/** +0x74: duração da queda em tiques. 0x50f048 (monstro): modelo[0x21]; 0x512526 (humano/herói): lista do modelo vazia (+8 = 0) → −1,
 *  senão modelo[0x17]; −1 → 8. */
export function vt74(u: UnitRec): number {
  switch (u.vtbl) {
    case VT_MONSTER: return u.tpl!.arr[0x21]! | 0;
    case VT_HUMAN: case VT_HERO: {
      let local_8 = u.tpl!.arrSize === 0 ? -1 : u.tpl!.arr[0x17]! | 0;
      if (local_8 === -1) local_8 = 8;
      return local_8;
    }
  }
  return noSlot(u, 0x74);
}

/** +0x6c: experiência pelo golpe. 0x5423f0 (monstro): nada; 0x513128 Unit_XPOnHit (humano/herói): gancho `xpOnHit` (motor antigo). */
export function vt6c(a: UnitRec, t: UnitRec, dmg: number, p3: number, xpOnHit?: (a: UnitRec, t: UnitRec, dmg: number, p3: number) => void): void {
  switch (a.vtbl) {
    case VT_MONSTER: return;
    case VT_HUMAN: case VT_HERO:
      if (!xpOnHit) throw new NotPorted("0x513128");
      xpOnHit(a, t, dmg, p3);
      return;
  }
  noSlot(a, 0x6c);
}

/** +0x70: experiência pela magia lançada (Spell_Apply 0x519db8 sem item em uso e sem o bit 2 de +0x4c). 0x542400 (monstro): nada;
 *  0x5131ef (humano/herói; `this`, alvo, id da magia): gancho `xpOnCast` (a experiência vive no motor antigo); sem gancho → NotPorted. */
export function vt70(u: UnitRec, t: UnitRec | null, id: number, xpOnCast?: (u: UnitRec, t: UnitRec | null, id: number) => void): void {
  switch (u.vtbl) {
    case VT_MONSTER: return;
    case VT_HUMAN: case VT_HERO:
      if (!xpOnCast) throw new NotPorted("0x5131ef");
      xpOnCast(u, t, id);
      return;
  }
  noSlot(u, 0x70);
}

/** +0x4c: ao morrer. 0x5423a0 (monstro): nada; 0x512697 (humano/herói, exec 0): larga os 12 itens equipados na mochila (vtable+0x48 →
 *  Pack_AddItem): gancho `onDieHuman` (o equipamento vive no motor antigo); sem gancho → NotPorted. */
export function vt4c(u: UnitRec, onDieHuman?: (u: UnitRec) => void): void {
  switch (u.vtbl) {
    case VT_MONSTER: return;
    case VT_HUMAN: case VT_HERO:
      if (!onDieHuman) throw new NotPorted("0x512697");
      onDieHuman(u);
      return;
  }
  noSlot(u, 0x4c);
}
