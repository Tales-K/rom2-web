/**
 * Porta literal do servidor do allods2.exe: o gasto e o lançamento das magias (etapa 8b, lote 2; notes/magias.md). Portadas:
 *  - Spell_SpendMana 0x519998 (thiscall; `this` = a magia do livro/item, unidade, alvo ou 0, x, y): conjurador com livro (0x53a5a0) e
 *    sem item em uso (+0x68) paga o custo +0xc da mana +0x9a (sem mana → 0: a máquina tenta de novo no tique seguinte); invisível
 *    (efeito 0xc) que lança em outro marca o efeito para acabar (+0x42 = 1 na lista +0x20: gancho `effectExpire`, como 0x516b2f);
 *    arma que lança magia sem livro (+0x74 = +0x68) → 1 sem aviso; sem definição → 0; Prismatic Spray (0xb): Spell_CasterPower +
 *    0x519c04 (exec 0: gancho `spellPrismatic`); senão o aviso ao cliente 0x5041d6 (alvo; definição[4] = 1, 0x519441) ou 0x5042ba
 *    (célula). O ponto alvo (0x54f955/0x54feae/0x54ff06/0x54f9b9/0x54fc41) e o tempo de voo (Spell_ProjectileDist 0x516aae ÷ [7]) só
 *    vão no pacote: não portados (cliente).
 *  - 0x5041d6 / 0x5042ba: o pacote 0x86/0x8b ao cliente (stub; 0x503bef envia) e, se vtable+0x2c da unidade ≠ 0, +0x138 = relógio de
 *    16/s ("ocupada agora": 0x50fc3e não triplica a regeneração de quem lança sem parar).
 *  - 0x519441 (fastcall): definição[4] == 1.
 *  - Spell_Release 0x519d7f (thiscall): id ≠ 0xb → Spell_Apply 0x519db8 (ainda gancho `spellApply`: o motor antigo, lote 3).
 */
import { fn_0x53a5a0 } from "./action";
import { fn_0x5106d2, fn_0x542560 } from "./combat";
import { NotPorted } from "./walk_action";
import { vt2c } from "./vtables";
import { EXE_GLOBALS, type BookSpellRec, type UnitRec, type WorldRec } from "./types";

/** O que a magia ainda não portou (lote 3+) e a apresentação. Sem gancho de Spell_Apply/Prismatic → NotPorted. */
export interface SpellHooks {
  /** 0x519db8 Spell_Apply(magia, unidade, alvo ou null, x, y): a magia sai (motor antigo). */
  spellApply?(spell: number, u: UnitRec, t: UnitRec | null, x: number, y: number): void;
  /** Spell_CasterPower 0x519483 + Spell_PrismaticSpray 0x519c04 (exec 0 no corpus): o jato sai já no gasto (motor antigo). */
  spellPrismatic?(spell: number, u: UnitRec, t: UnitRec | null, x: number, y: number): void;
  /** efeitos do tipo `type` da lista +0x20 marcados para acabar (+0x42 = 1; os efeitos ainda são os `buffs` do motor antigo). */
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
  void wd;
  if (fn_0x53a5a0(u) !== 0 && u.f68 === null) {
    if (((u.mana << 16) >> 16) < ((s.cost << 16) >> 16)) {
      h.noMana?.(s.addr, u);
      return 0;
    }
    u.mana = ((u.mana - s.cost) << 16) >> 16;
  }
  // 0x54f955/0x54f9b9/0x54feae/0x54ff06/0x54fc41: o ponto alvo (célula ou centro do alvo, corrigido pelo lado) — só vai no pacote
  if (t !== u && fn_0x5106d2(u, 0xc) !== 0) h.effectExpire?.(u, 0xc);
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

/** 0x519d7f Spell_Release (thiscall; magia, unidade, alvo): a magia sai — Spell_Apply 0x519db8 (gancho), salvo Prismatic Spray (0xb),
 *  que saiu no gasto. */
export function spellRelease(s: BookSpellRec, u: UnitRec, t: UnitRec | null, h: SpellHooks): void {
  if ((s.id & 0xff) !== 0xb) {
    if (!h.spellApply) throw new NotPorted("0x519db8");
    h.spellApply(s.addr, u, t, 0, 0);
  }
}
