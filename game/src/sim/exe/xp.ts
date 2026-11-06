/**
 * Porta literal do servidor do allods2.exe: a experiência dos humanos/herói (F2, 2026-11-06; notes/largar-synccombat.md). Portadas:
 *  - 0x513128 Unit_XPOnHit (vtable+0x6c; agressor, alvo, dano, id da magia): com dono da IA no alvo (+0x14 → +0x2c ≠ 0), experiência =
 *    ftol(alvo+0x1c × 0,5 × dano ÷ alvo+0x96 + 1,0) na esfera da magia (definição[2], só conjurador) → vtable+0x64.
 *  - 0x512fcb (vtable+0x68; matador, vítima, id): ftol(vítima+0x1c × 0,5) → vtable+0x64; depois a tabela de abates +0x1a8.
 *  - 0x5131ef (vtable+0x70; quem lança, alvo, id da magia): conjurador com esfera ≠ 0 → ftol(definição[1] × 0,5 + 0,5) → vtable+0x64.
 *  - 0x5128cb (vtable+0x64 dos humanos/herói; xp, alvo, esfera): só modelos 0x21..0x3f e alvo não invocado (+0x1a0); xp =
 *    ftol(xp × (Mind +0x88 ÷ 30,0 + 0,25)), × 10 ÷ (abates do tipo + 10); conta se o alvo está com vida < 0 (0x542770), sem alvo, ou é de
 *    outro dono não aliado (mundo+0xa8c4 & 2); habilidades +0xa8 ← base +0x116; lutador na arma +0xb6, mago na esfera; ÷ 8 (para cima)
 *    fora da principal +0x23c[0] e da 5; teto 0x512f44; +0x23c[esfera] e +0x130; subida (exp(nível + 1) ≤ +0x23c) → +1 na habilidade e
 *    na base, mago refaz o livro (0x51c3e4), vtable+0x58; sem subida, habilidades = min(base, 100) + bônus +0xe8.
 *  - 0x512f44 (teto: exp(nível + 1) − exp(nível), ÷ 5 com [0x6044c4]+0x74 ≠ 0), 0x542770 (vida < 0).
 * x87 do assembly (o C perdeu as contas: CRT_ftol sem argumento); constantes 0x5d0828 = 0,5, 0x5d0858 = 1,0, 0x5d0868 = 30,0,
 * 0x5d0870 = 0,25. Cliente: Server_SendMsg92 (subida), Server_Event 0xffb e 0x4e9e97 (perfil, GetTickCount): stubs.
 * Pares do oráculo: test/exe_xp.ts.
 */
import { fn_0x53a5a0 } from "./action";
import type { CombatHooks } from "./combat";
import { fn_0x5128ac } from "./create";
import { fn_0x51c3e4, vt58 } from "./effects";
import { crtFtol } from "./path";
import { EXE_GLOBALS, type UnitRec, type WorldRec } from "./types";

const s16 = (v: number): number => (v << 16) >> 16;

/** 0x542770 (fastcall): vida +0x94 < 0. */
export function fn_0x542770(u: UnitRec): boolean {
  return s16(u.f94) < 0;
}

/** 0x512f44 (cdecl; xp, nível): o ganho limitado a exp(nível + 1) − exp(nível) (÷ 5 com [0x6044c4]+0x74 ≠ 0). */
export function fn_0x512f44(param_1: number, param_2: number): number {
  let local_8: number;
  if ((EXE_GLOBALS.f74 | 0) === 0) {
    local_8 = (fn_0x5128ac(param_2 + 1) - fn_0x5128ac(param_2)) | 0;
  } else {
    const iVar1 = fn_0x5128ac(param_2 + 1), iVar2 = fn_0x5128ac(param_2);
    local_8 = Math.trunc((iVar1 - iVar2) / 5);
  }
  return local_8 < (param_1 | 0) ? local_8 : param_1 | 0;
}

/** 0x5128cb (thiscall; vtable+0x64 dos humanos/herói; xp, alvo ou null, esfera): ver o cabeçalho. */
export function fn_0x5128cb(wd: WorldRec, u: UnitRec, param_1: number, param_2: UnitRec | null, param_3: number, h: CombatHooks): void {
  const tipo = u.f0e & 0xffff;
  if (!(0x20 < tipo && tipo < 0x40)) return;
  if (param_2 !== null && (param_2.f1a0 >>> 0) !== 0) return;
  let local_c = 0;
  param_1 = crtFtol((param_1 | 0) * (s16(u.f88) / 30 + 0.25)) >>> 0;
  if (param_2 !== null) {
    for (let local_14 = 0; local_14 < u.kills.length; local_14++) {
      const k = u.kills[local_14]! >>> 0;
      if ((param_2.f14c & 0xffff) === (k & 0xffff)) {
        param_1 = Math.floor((Math.imul(param_1, 10) >>> 0) / (((k >>> 16) + 10) >>> 0)) >>> 0;
        break;
      }
    }
  }
  const outro = (): boolean => {
    if (param_2!.owner === u.owner) return false;   // +0x14 ≠ 0: todo registro espelhado tem dono (o mesmo dono = o mesmo registro)
    return (wd.dipTable[8 + s16(param_2!.owner.f04) * 0x46 + s16(u.owner.f04)]! & 2) === 0;   // [0x66832c] ≠ 0: o mundo existe
  };
  if (param_2 === null || fn_0x542770(param_2) || outro()) {
    let bVar3 = false;
    for (let local_8 = 1; local_8 < 6; local_8++) u.dmg.sk[local_8] = u.skBase[local_8]!;
    if (fn_0x53a5a0(u) === 0) {
      const w = u.dmg.wtype & 0xff;
      if (param_3 === 0 && w !== 0 && s16(u.dmg.sk[w]!) < 100) {
        if (w !== (u.f23c[0]! >>> 0) && w !== 5) param_1 = Math.trunc(((param_1 + 7) | 0) / 8) >>> 0;
        param_1 = fn_0x512f44(param_1, s16(u.dmg.sk[w]!)) >>> 0;
        u.f23c[w] = (u.f23c[w]! + param_1) | 0;
        u.f130 = (u.f130 + param_1) | 0;
        const iVar5 = fn_0x5128ac(s16(u.dmg.sk[w]!) + 1);
        bVar3 = iVar5 <= (u.f23c[w]! | 0);
        local_c = (0x100 << ((w - 1) & 0x1f)) >>> 0;
        if (bVar3) {
          for (let local_24 = 1; local_24 < 6; local_24++) u.dmg.sk[local_24] = u.skBase[local_24]!;
          u.dmg.sk[w] = s16(u.dmg.sk[w]! + 1);
          for (let local_28 = 1; local_28 < 6; local_28++) u.skBase[local_28] = u.dmg.sk[local_28]!;
          // stub: cliente (Server_SendMsg92 com dono+0x2c == 0: a subida de nível ao jogador)
        }
      }
    } else if ((param_3 | 0) > 0 && param_3 < 6 && s16(u.dmg.sk[param_3]!) < 100) {
      if ((param_3 >>> 0) !== (u.f23c[0]! >>> 0) && param_3 !== 5) param_1 = Math.trunc(((param_1 + 7) | 0) / 8) >>> 0;
      param_1 = fn_0x512f44(param_1, s16(u.dmg.sk[param_3]!)) >>> 0;
      u.f23c[param_3] = (u.f23c[param_3]! + param_1) | 0;
      u.f130 = (u.f130 + param_1) | 0;
      const iVar5 = fn_0x5128ac(s16(u.dmg.sk[param_3]!) + 1);
      bVar3 = iVar5 <= (u.f23c[param_3]! | 0);
      local_c = (0x100 << ((param_3 - 1) & 0x1f)) >>> 0;
      if (bVar3) {
        for (let local_18 = 1; local_18 < 6; local_18++) u.dmg.sk[local_18] = u.skBase[local_18]!;
        u.dmg.sk[param_3] = s16(u.dmg.sk[param_3]! + 1);
        // stub: cliente (Server_SendMsg92 com dono+0x2c == 0)
        for (let local_1c = 1; local_1c < 6; local_1c++) u.skBase[local_1c] = u.dmg.sk[local_1c]!;
        if (u.hasBook) fn_0x51c3e4(u);   // o livro +0x140
      }
    }
    if (bVar3) {
      vt58(wd, u, h);
      // stub: cliente (Server_Event 0xffb, local_c | 0x3000c)
    } else {
      // stub: cliente (Server_Event 0xffb, local_c, com xp ≠ 0)
      for (let local_2c = 1; local_2c < 6; local_2c++) {
        const x = s16(u.dmg.sk[local_2c]!);
        const sVar2 = x < 0x65 ? x : 100;
        u.dmg.sk[local_2c] = s16(sVar2 + u.bdmg.sk[local_2c]!);
      }
    }
    void local_c;
    // stub: perfil do jogador (0x4e9e97 com xp ≠ 0, [0x6044c4]+0x74 e GetTickCount − dono+0xa74 > 15000: arquivo)
  }
}

/** 0x513128 Unit_XPOnHit (thiscall; vtable+0x6c dos humanos/herói; alvo, dano, id da magia ou 0): ver o cabeçalho. */
export function unitXpOnHit(wd: WorldRec, u: UnitRec, param_1: UnitRec, param_2: number, param_3: number, h: CombatHooks): void {
  let local_8 = 0;
  if (param_3 === 0 || fn_0x53a5a0(u) !== 0) {
    if (param_3 !== 0 && fn_0x53a5a0(u) !== 0) local_8 = wd.spellDefCol(param_3, 2) | 0;
    if ((param_3 === 0 || fn_0x53a5a0(u) !== 0) && (param_1.owner.f2c | 0) !== 0) {   // +0x14 ≠ 0: todo registro espelhado tem dono
      const iVar2 = s16(param_1.f96);
      const xp = crtFtol(((param_1.f1c | 0) * 0.5 * (param_2 | 0)) / iVar2 + 1.0);
      fn_0x5128cb(wd, u, xp, param_1, local_8, h);   // vtable+0x64 (humano/herói)
    }
  }
}

/** 0x512fcb (thiscall; vtable+0x68 dos humanos/herói; vítima, id): a experiência pela morte e a tabela de abates +0x1a8. */
export function fn_0x512fcb(wd: WorldRec, u: UnitRec, param_1: UnitRec, param_2: number, h: CombatHooks): void {
  let local_8 = 0;
  if (param_2 === 0 || fn_0x53a5a0(u) !== 0) {
    if (param_2 !== 0 && fn_0x53a5a0(u) !== 0) local_8 = wd.spellDefCol(param_2, 2) | 0;
    const xp = crtFtol((param_1.f1c | 0) * 0.5);
    fn_0x5128cb(wd, u, xp, param_1, local_8, h);   // vtable+0x64
    let bVar2 = false;
    for (let local_c = 0; local_c < u.kills.length; local_c++) {
      if ((param_1.f14c & 0xffff) === (u.kills[local_c]! & 0xffff)) {
        u.kills[local_c] = (u.kills[local_c]! + 0x10000) >>> 0;
        bVar2 = true;
        break;
      }
    }
    if (!bVar2) {
      if (4 < u.kills.length) u.kills.splice(0, 1);   // 0x59f2f8 RemoveAt(0, 1)
      u.kills.push(param_1.f14c & 0xffff);            // CDWordArray::Add
    }
  }
}

/** 0x5131ef (thiscall; vtable+0x70 dos humanos/herói; alvo (não lido), id da magia): ver o cabeçalho. */
export function fn_0x5131ef(wd: WorldRec, u: UnitRec, param_1: UnitRec | null, param_2: number, h: CombatHooks): void {
  void param_1;
  let local_8 = 0;
  if (param_2 !== 0 && fn_0x53a5a0(u) !== 0) local_8 = wd.spellDefCol(param_2, 2) | 0;
  if (local_8 !== 0) {
    const xp = crtFtol((wd.spellDefCol(param_2, 1) | 0) * 0.5 + 0.5);
    fn_0x5128cb(wd, u, xp, null, local_8, h);   // vtable+0x64
  }
}
