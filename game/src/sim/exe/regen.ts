/**
 * Porta literal do servidor do allods2.exe: o laço de 1/s do mundo e a regeneração (etapa 9, lote 1; notes/pensamento.md).
 * Portadas:
 *  - 0x52bbb7 World_SecondTick (fastcall; `this` = o contentor das listas de unidades [0x68d2dc]). Server_Tick 0x4f08c0 a chama no
 *    tique em que o relógio de 16/s [[0x6044c4]+4] ≡ 0xc (mod 16), ANTES de Server_ClockTick incrementá-lo e rodar as máquinas das
 *    unidades. Três passagens: vtable+0x14 (= 0x50fc5a Unit_Regen nas 3 vtables das unidades) em cada unidade da lista +4 (todas, na
 *    ordem de criação, caídas incluídas); 0x5110b8 Corpse_Decay em cada cadáver da lista [[0x6044c4]+0x7c]+0xc (+4 = contentor+0x44);
 *    desgaste das invocações pela lista [0x672f64]+4 (= contentor+0x24): CMap<uint,uint> invocador (+0x148) → contagem, depois, na
 *    ordem dos baldes do CMap, Rand_One(100) < contagem → marca o invocador (−1) e a 1.ª invocação dele na lista morre (Unit_Die
 *    0x510a70; o invocador fica −2). O iterador das listas é o de 0x53b060/0x53b070/0x53b0e0 (`CListPtrIter`).
 *  - 0x50fc5a Unit_Regen (fastcall): nada se a ação +0x54 é 0x10 (morta). Vida +0x94 < 1: se < 0 e contador de 1/s % 4 == 0, vida −1
 *    (sangria de quem caiu). Senão k = 3 se 0x50fc3e (relógio − +0x138) > 0x50 (parada há mais de 5 s), senão 1; vida < máx. +0x96 e
 *    período +0x98 ≠ 0 e contador % 4 == id (+4) % 4 → v = vida × 100 + resto +0xa2 + (máx. × 2 × (bônus +0xde + 100) × k) / período;
 *    resto = v % 100, vida = min(v / 100, máx.); mana +0x9a < máx. +0x9c (todo segundo, sem teste do período +0x9e: 0 → #DE) → idem
 *    com máx. × (bônus +0xe2 + 100) × k / período e o resto +0xa3. Server_Event 0x502019 (vida 1 / mana 2, código 0xffb) é cliente: stub.
 *    Todas as contas em int com sinal (imul/idiv/cdq): `Math.imul`, `Math.trunc`, `%` de JS.
 *  - 0x51fa4e Rand_One (rand.ts). Fora (MFC): o CMap 0x545780/0x5457e0/0x545820/0x53d920/0x53d940 (mfc.ts `CMapU32`), o iterador
 *    0x53b060/0x53b070/0x53b0e0 (`CListPtrIter`).
 */
import { CListPtrIter, CMapU32 } from "./mfc";
import { fn_0x50fc3e } from "./combat";
import { corpseDecay, unitDie, type DieHooks } from "./death";
import { randOne } from "./rand";
import { VT_HERO, VT_HUMAN, VT_MONSTER } from "./vtables";
import { EXE_GLOBALS, type UnitRec, type WorldRec } from "./types";

const i16 = (v: number): number => (v << 16) >> 16;

/** 0x50fc5a Unit_Regen (fastcall). */
export function unitRegen(u: UnitRec): void {
  if ((u.act >>> 0) !== 0x10) {
    if (i16(u.f94) < 1) {
      // ((c ^ s) - s & 3 ^ s) == s, s = c >> 31: |c| & 3 == 0, isto é, c % 4 == 0 com sinal
      if (i16(u.f94) < 0 && ((EXE_GLOBALS.w6044c4 | 0) % 4) === 0) {
        u.f94 = i16(i16(u.f94) - 1);
        // stub: cliente (Server_Event 0x502019: unidade, id, 1 = vida, 0xffb)
      }
    } else {
      let local_8 = 1;
      let iVar1 = fn_0x50fc3e(u);
      if (0x50 < iVar1) local_8 = 3;
      if (i16(u.f94) < i16(u.f96) && i16(u.f98) !== 0) {
        // contador % 4 == id % 4 (os dois com sinal, pelo mesmo ajuste de |x| & 3)
        if (((EXE_GLOBALS.w6044c4 | 0) % 4) === ((u.f04 | 0) % 4)) {
          iVar1 = (Math.imul(i16(u.f94), 100) + (u.fa2 & 0xff)
            + Math.trunc(Math.imul(Math.imul(Math.imul(i16(u.f96), 2), (i16(u.fde) + 100) | 0), local_8) / i16(u.f98))) | 0;
          u.fa2 = (iVar1 % 100) & 0xff;
          u.f94 = i16(Math.trunc(iVar1 / 100));
          let local_16: number;
          if (i16(u.f94) < i16(u.f96)) local_16 = u.f94;
          else local_16 = u.f96;
          u.f94 = i16(local_16);
          // stub: cliente (Server_Event 0x502019: unidade, 0, 1 = vida, 0xffb)
        }
      }
      if (i16(u.mana) < i16(u.f9c)) {
        if (i16(u.f9e) === 0) throw new Error("0x50fc5a: período de mana (+0x9e) zero com mana < máxima (#DE no exe)");
        iVar1 = (Math.imul(i16(u.mana), 100) + (u.fa3 & 0xff)
          + Math.trunc(Math.imul(Math.imul(i16(u.f9c), (i16(u.fe2) + 100) | 0), local_8) / i16(u.f9e))) | 0;
        u.fa3 = (iVar1 % 100) & 0xff;
        u.mana = i16(Math.trunc(iVar1 / 100));
        let local_18: number;
        if (i16(u.mana) < i16(u.f9c)) local_18 = u.mana;
        else local_18 = u.f9c;
        u.mana = i16(local_18);
        // stub: cliente (Server_Event 0x502019: unidade, 0, 2 = mana, 0xffb)
      }
    }
  }
}

/** vtable +0x14: 0x50fc5a Unit_Regen nas 3 vtables das unidades (tools/re/vtables.tsv). */
export function vt14(u: UnitRec): void {
  switch (u.vtbl) { case VT_MONSTER: case VT_HUMAN: case VT_HERO: unitRegen(u); return; }
  throw new Error(`vtable 0x${u.vtbl.toString(16)} sem slot +0x14 espelhado`);
}

/** 0x52bbb7 World_SecondTick (fastcall; `this` = contentor das listas, `wd.lists`). */
export function worldSecondTick(wd: WorldRec, h: DieHooks = {}): void {
  const lists = wd.lists;
  const local_1c = new CListPtrIter();
  let local_20 = local_1c.first(lists.all);
  while (local_20 !== 0) {
    vt14(wd.map.unitAt(local_20));
    local_20 = local_1c.next();
  }
  local_20 = local_1c.first(lists.corpses);
  while (local_20 !== 0) {
    corpseDecay(wd.map.unitAt(local_20), h);
    local_20 = local_1c.next();
  }
  local_20 = local_1c.first(lists.magic);
  const local_44 = new CMapU32(10);
  const local_14 = { v: 0 };
  while (local_20 !== 0) {
    const u = wd.map.unitAt(local_20);
    if ((u.f148 >>> 0) !== 0) {
      const bVar1 = local_44.lookup(u.f148, local_14);
      if (!bVar1) local_14.v = 0;
      local_44.setAt(u.f148, (local_14.v + 1) >>> 0);
    }
    local_20 = local_1c.next();
  }
  let local_48 = local_44.getStartPosition();
  const local_24 = { v: 0 };
  while (local_48 !== null) {
    local_48 = local_44.getNextAssoc(local_48, local_24, local_14);
    const uVar2 = randOne(wd, 100, 0x52bd3f);
    if ((uVar2 >>> 0) < (local_14.v >>> 0)) local_44.setAt(local_24.v, 0xffffffff);
  }
  local_20 = local_1c.first(lists.magic);
  while (local_20 !== 0) {
    const u = wd.map.unitAt(local_20);
    if ((u.f148 >>> 0) !== 0 && local_44.lookup(u.f148, local_14) && (local_14.v >>> 0) === 0xffffffff) {
      local_44.setAt(u.f148, 0xfffffffe);
      unitDie(wd, u, h);
    }
    local_20 = local_1c.next();
  }
}
