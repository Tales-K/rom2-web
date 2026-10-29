/**
 * Porta literal do servidor do allods2.exe: os efeitos com duração na lista +0x20 da unidade e o recálculo dos atributos do humano
 * (etapa 8b, lote 4; notes/magias.md). No corpus: o Shield (0x1b), nos dois Shields que já estão no T=0 (herói e 24608) e na fusão dos
 * dois lançamentos da maga. Portadas:
 *  - 0x51e8fa (cdecl; o texto do efeito da definição+0x1c): carga "Effect" temporária (Spell_WallObject) com o tipo +0x3c (índice do nome
 *    antes do '=' na tabela 0x5f8f50, minúsculo), o valor +0x40 e a duração +0x42 / bits +0x3d ("duration n" → 1, n × 16; "continuous" →
 *    2; "charges" → 4; "permanent" → 0; "singleuse" → 8); castSpell/teachSpell pelo nome da magia (0x51f1c3), damage* "a-b" (0x51f072).
 *    O CString do MFC: operator+= 0x5a1bdb, MakeLower 0x5a1d4a, Find 0x5a1cf8, Left 0x59df77, Right 0x59defa, TrimRight 0x59e49c,
 *    TrimLeft 0x59e453, == 0x439e10, SpanIncluding 0x59dfee, sscanf "%d" 0x584030 (`cstr*` abaixo).
 *  - 0x51caa0 (thiscall; new 0x48): a carga "Effect" com tipo/bits/valor+duração/id copiados da temporária (destruída) e +0x44 = 0.
 *  - 0x51ce12 (vtable+0x3c da carga "Effect"; alvo): +0x150 = 0; Bless (0x14) × Curse (0x1c) se anulam; efeito sem duração age já
 *    (vtable+0x40); com duração: o mesmo id na lista +0x20 → tira (vtable+0x44), maior valor e maior duração, põe (vtable+0x40); senão uma
 *    cópia (0x51cb98 + 0x50d772) entra na lista (AddTail 0x53bf70) e liga o bit +0x144. Avisos ao cliente (Server_Event 0x502019,
 *    0x504498/0x5044ba): stubs.
 *  - 0x51cc9f (vtable+0x38: um tique do efeito na unidade), 0x542540 (acabou), 0x53af60 (tira da lista e destrói), 0x51cc53 (com
 *    duração ou contínuo).
 *  - 0x51d175 / 0x51d337 (vtable+0x40 / +0x44: põe / tira): Poison (6) tira vida (com proteção de água, x87 do assembly; lote 5),
 *    Light/Darkness (0xf/0xe) mexem na visão +0xa4/+0xe4, o resto 0x51d436 com ±1.
 *  - 0x51d436 (vtable+0x48; unidade, ±1): soma o valor (vezes ±1) no atributo do tipo +0x3c (na unidade sem equipamento, vtable+0x30 = 0,
 *    direto; no humano, no bônus +0xd4..) e os bits de aviso +0x150; depois vtable+0x58 (o recálculo).
 *  - 0x51366b (vtable+0x58 dos humanos/herói): os atributos derivados de Body/Reaction/Mind/Spirit (tetos por classe e sexo 0x53a5c0),
 *    experiência +0x130 (nível = log(exp/5000 + 1)/log 1,1: 0x5127f2; 1,1^x: 0x5127d2), habilidades, defesa e o bônus (0x5155dd,
 *    0x5113e7, 0x515617, 0x515a6c); as magias do livro refeitas (0x51c3e4 → Spell_CasterPower 0x519483 → Spell_Instance). x87 do assembly.
 * Lote 5: os outros `case` de carga "Effect" de Spell_Apply (`spellApplyEffect`: proteções 4/8/0xd/0x13, Poison 6, Invisibility 0xc,
 * Light/Darkness 0xf/0xe, Stone Curse 0x12, Bless/Curse 0x14/0x1c, Haste/Slow 0x15/0x1d; durações pow(1,025, poder) do assembly) e o
 * recálculo do monstro 0x5118be; provados por pares sintéticos (tools/re/oracle/synth_spells.py: o poder 0..255 em cada `case`).
 * Com gancho: vtable+0x58 `recompute` (no mundo o motor antigo ainda é dono dos atributos: `syncCombat` a cada tique); sem gancho, 0x51366b
 * (humano/herói) ou 0x5118be (monstro, lote 5). teachSpell (0x2a: 0x51906d/Unit_AddSpellToBook 0x51c29e, exec 0): NotPorted.
 */
import { fn_0x53a5a0 } from "./action";
import { aiInBattle, type CombatHooks } from "./combat";
import { CListPtrIter } from "./mfc";
import { crtFtol } from "./path";
import { randInclusive } from "./rand";
import { NotPorted } from "./walk_action";
import { unitGetBookSpell } from "./wave";
import { vt2c, vt30, vt6c, VT_HERO, VT_HUMAN, VT_MONSTER } from "./vtables";
import { fn_0x54feae, objBase, spellInstance, spellWallObject } from "./spells";
import {
  MapObjRec, SpellPayloadRec, VT_EFFECT, type BookSpellRec, type DefRec, type DmgRec, type UnitRec, type WorldRec,
} from "./types";

/** Bits de +0x3d (dados 0x5d07e0..0x5d07f0). */
const FX_TIMED = 1, FX_CONT = 2, FX_CHARGES = 4, FX_NOCAP = 8, FX_DONE = 0x80;

/** Tabela 0x5f8f50 (0x32 nomes dos tipos de efeito, minúsculos). */
export const EFFECT_NAMES = [
  "unused_value_0", "price", "body", "mind", "reaction", "spirit", "health", "healthmax", "healthregeneration", "mana", "manamax",
  "manaregeneration", "tohit", "damagemin", "damagemax", "defence", "absorbtion", "speed", "rotationspeed", "scanrange", "protection0",
  "protectionfire", "protectionwater", "protectionair", "protectionearth", "protectionastral", "fighterskill0", "skillblade", "skillaxe",
  "skillbludgeon", "skillpike", "skillshooting", "mageskill0", "skillfire", "skillwater", "skillair", "skillearth", "skillastral",
  "itemlore", "magiclore", "creaturelore", "castspell", "teachspell", "damage", "damagefire", "damagewater", "damageair", "damageearth",
  "damageastral", "damagebonus",
];
/** Tabela 0x5f9018 (0x1e nomes das magias; 0x51f1c3). */
const SPELL_NAMES = [
  "unused_spell_0", "fire_arrow", "fire_ball", "wall_of_fire", "protection_from_fire", "ice_missile", "poison_cloud", "blizzard",
  "protection_from_water", "acid_stream", "lightning", "prismatic_spray", "invisibility", "protection_from_air", "darkness", "light",
  "diamond_dust", "wall_of_earth", "stone_curse", "protection_from_earth", "bless", "haste", "control_spirit", "teleport", "heal", "summon",
  "drain_life", "shield", "curse", "slow",
];

// ------------------------------------------------------------------------------------------------ CString do MFC (biblioteca)

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\v" || c === "\f" || c === "\r";
/** 0x59df77 CString::Left: n < 0 → 0; n ≥ tamanho → a cadeia inteira. */
function cstrLeft(s: string, n: number): string { return n < 0 ? "" : n >= s.length ? s : s.slice(0, n); }
/** 0x59defa CString::Right. */
function cstrRight(s: string, n: number): string { return n < 0 ? "" : n >= s.length ? s : s.slice(s.length - n); }
/** 0x59e49c CString::TrimRight (_istspace). */
function cstrTrimRight(s: string): string { let e = s.length; while (e > 0 && isSpace(s[e - 1]!)) e--; return s.slice(0, e); }
/** 0x59e453 CString::TrimLeft. */
function cstrTrimLeft(s: string): string { let i = 0; while (i < s.length && isSpace(s[i]!)) i++; return s.slice(i); }
/** 0x59dfee CString::SpanIncluding: o prefixo feito só de caracteres de `set`. */
function cstrSpanIncluding(s: string, set: string): string { let i = 0; while (i < s.length && set.includes(s[i]!)) i++; return s.slice(0, i); }
/** 0x584030 sscanf(s, "%d", &v): o número no começo (brancos, sinal, dígitos); sem número a variável fica sem valor: NotPorted. */
function crtScanInt(s: string, where: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s);
  if (!m) throw new NotPorted(`${where} (sscanf sem número: "${s}")`);
  return Number.parseInt(m[1]!, 10) | 0;
}

// ------------------------------------------------------------------------------------------------ o texto do efeito

/** 0x51f20a (cdecl; CString&): vazio → 0; senão SpanIncluding("+-1234567890") e sscanf "%d". */
export function fn_0x51f20a(param_1: string): number {
  if (param_1.length === 0) return 0;
  return crtScanInt(cstrSpanIncluding(param_1, "+-1234567890"), "0x51f20a");
}

/** 0x51f151 (cdecl): TrimRight, TrimLeft, SpanIncluding("+1234567890") → 0x51f20a. */
export function fn_0x51f151(param_1: string): number {
  return fn_0x51f20a(cstrSpanIncluding(cstrTrimLeft(cstrTrimRight(param_1)), "+1234567890"));
}

/** 0x51f1c3 (cdecl): índice do nome da magia na tabela 0x5f9018 (0..0x1d) ou −1. */
export function fn_0x51f1c3(param_1: string): number {
  for (let local_8 = 0; local_8 <= 0x1d; local_8++) if (param_1 === SPELL_NAMES[local_8]) return local_8;
  return -1;
}

/** 0x51f072 (cdecl; "a-b", &+0x40, &+0x41): com '-' → +0x40 = a (byte), +0x41 = b − a (byte); sem '-' nada. */
export function fn_0x51f072(param_1: string, set: (lo: number, hi: number) => void): void {
  const iVar1 = param_1.indexOf("-");
  if (iVar1 === -1) return;
  const local_14 = cstrTrimLeft(cstrTrimRight(cstrLeft(param_1, iVar1)));
  const local_18 = cstrTrimLeft(cstrTrimRight(cstrRight(param_1, param_1.length - iVar1 - 1)));
  const lo = fn_0x51f20a(local_14) & 0xff;
  const hi = (fn_0x51f20a(local_18) - lo) & 0xff;
  set(lo, hi);
}

/** 0x51f29c (cdecl; o texto depois do ':', &n): "permanent" 0, "singleuse" 8, "charges n" 4, "duration n" 1, "continuous n" 2 (n em
 *  `out[0]`), nada disso 0. */
export function fn_0x51f29c(param_1: string, out: number[]): number {
  let s = cstrTrimLeft(cstrTrimRight(param_1));
  if (s === "permanent") return 0;
  if (s === "singleuse") return 8;
  const word = (w: string, k: number, r: number): number | null => {
    const local_14 = s.indexOf(w);
    if (local_14 === -1) return null;
    s = cstrTrimRight(cstrRight(s, s.length - local_14 - k));
    out[0] = fn_0x51f20a(s);
    return r;
  };
  return word("charges", 8, 4) ?? word("duration", 9, 1) ?? word("continuous", 0xb, 2) ?? 0;
}

/** +0x40 como i32 (valor + duração; os construtores e 0x51e8fa escrevem os 4 bytes de uma vez). */
function setI40(o: SpellPayloadRec, v: number): void { o.f40 = (v << 16) >> 16; o.f42 = (v >>> 16) & 0xffff; }
function getI40(o: SpellPayloadRec): number { return ((o.f40 & 0xffff) | ((o.f42 & 0xffff) << 16)) | 0; }

/** Destruição da carga (vtable+4 = 0x543300 → 0x50d6d6, 0x401860 libera). */
export function deletePayload(wd: WorldRec, a: number): void {
  wd.payloads.delete(a >>> 0);
}

/** 0x51e8fa (cdecl; definição+0x1c): ver o cabeçalho. Devolve a carga temporária (new 0x48 + Spell_WallObject) ou null. */
export function fn_0x51e8fa(wd: WorldRec, param_1: string): SpellPayloadRec | null {
  let local_30: string, local_24: string, local_2c: string;
  if (param_1.length === 0) return null;
  let local_18 = param_1;
  const local_14 = spellWallObject(wd);
  local_18 += ",";
  local_18 = local_18.toLowerCase();
  const local_40 = local_18.indexOf("=");
  if (local_40 === -1) {
    deletePayload(wd, local_14.addr);
    return null;
  }
  local_30 = cstrTrimLeft(cstrTrimRight(cstrLeft(local_18, local_40)));
  local_18 = cstrRight(local_18, local_18.length - local_40 - 1);
  local_18 = cstrTrimRight(cstrTrimRight(local_18));
  let local_38 = 0;
  for (let local_34 = 0; local_34 < 0x32; local_34++) {
    if (local_30 === EFFECT_NAMES[local_34]) { local_38 = local_34; break; }
  }
  if (local_38 === 0) {
    deletePayload(wd, local_14.addr);
    return null;
  }
  local_14.f3c = local_38 & 0xff;
  const local_44 = local_18.indexOf(":");
  const local_20 = local_18.indexOf(",");
  local_24 = cstrTrimLeft(cstrTrimRight(cstrLeft(local_18, local_20)));
  local_18 = cstrRight(local_18, local_18.length - local_20 - 1);
  const setBytes = (lo: number, hi: number) => { local_14.f40 = ((lo & 0xff) | ((hi & 0xff) << 8)) << 16 >> 16; };
  const isDmg = local_38 >= 0x2b && local_38 <= 0x30;
  if (local_44 < local_20 && local_44 !== -1) {
    local_2c = cstrTrimLeft(cstrTrimRight(cstrLeft(local_24, local_44)));
    local_24 = cstrTrimRight(cstrRight(local_24, local_24.length - local_44 - 1));
    const out = [0];
    if (local_38 === 0x29 || local_38 === 0x2a) {
      const local_28 = fn_0x51f1c3(local_2c);
      local_14.f40 = (local_28 << 16) >> 16;
      local_14.f42 = 0;
      if (local_28 === -1) {
        deletePayload(wd, local_14.addr);
        return null;
      }
    } else if (isDmg) {
      fn_0x51f072(local_2c, setBytes);
    } else {
      out[0] = fn_0x51f20a(local_2c);
      setI40(local_14, out[0]);
    }
    let local_1c: number;
    if ((local_14.f3c & 0xff) === 0x29) {
      local_14.f42 = fn_0x51f151(local_24) & 0xffff;
      local_14.f3d = 0;
      local_1c = 0;
    } else {
      local_1c = fn_0x51f29c(local_24, out);
      local_14.f3d = local_1c & 0xff;
    }
    if ((local_1c & 1) !== 0 || (local_1c & 2) !== 0 || (local_1c & 4) !== 0) {
      local_14.f42 = (out[0]! << 4) & 0xffff;
    }
  } else if (local_38 === 0x29 || local_38 === 0x2a) {
    const local_28 = fn_0x51f1c3(local_24);
    local_14.f40 = (local_28 << 16) >> 16;
    local_14.f42 = 0;
    if (local_28 === -1) {
      deletePayload(wd, local_14.addr);
      return null;
    }
  } else if (isDmg) {
    fn_0x51f072(local_24, setBytes);
  } else {
    const local_3c = fn_0x51f20a(local_24);
    setI40(local_14, local_3c);
    local_14.f1c = Math.imul(local_3c, 0x32) >>> 0;
  }
  return local_14;
}

/** 0x401880 (new 0x48) + 0x51caa0 (thiscall; definição+0x1c): carga "Effect" (base 0x50d493) com tipo, bits, +0x40 (i32) e id da
 *  temporária de 0x51e8fa (destruída depois); sem temporária tudo zerado. */
export function fn_0x51caa0(wd: WorldRec, param_1: string): SpellPayloadRec {
  const o = new SpellPayloadRec();
  o.addr = wd.allocObj(0x48) >>> 0;
  objBase(wd, o);   // 0x50d493
  o.vtbl = VT_EFFECT;
  wd.payloads.set(o.addr, o);
  const piVar1 = fn_0x51e8fa(wd, param_1);
  o.fe = 0;
  if (piVar1 === null) {
    o.f3c = 0; o.f3d = 0; setI40(o, 0); o.fc = 0;
  } else {
    o.f3c = piVar1.f3c & 0xff;
    o.f3d = piVar1.f3d & 0xff;
    setI40(o, getI40(piVar1));
    o.fc = piVar1.fc & 0xffff;
    deletePayload(wd, piVar1.addr);
    o.f44 = 0;
  }
  return o;
}

/** 0x5a1e92 (new 0xc) + 0x401880 (new 0x48) + 0x51cb98 (thiscall; carga): cópia do efeito para a lista da unidade — 0x50d772 (base:
 *  +0xc, +0xe, +0x14, +0x18, +0x1c e o objeto de mapa copiado, 0x54feae) e tipo, bits, +0x40 (i32), id e +0x44. */
export function fn_0x51cb98(wd: WorldRec, param_1: SpellPayloadRec): SpellPayloadRec {
  const o = new SpellPayloadRec();
  o.addr = wd.allocObj(0x48) >>> 0;
  o.fc = param_1.fc & 0xffff;
  o.fe = param_1.fe & 0xffff;
  o.f14 = param_1.f14 >>> 0;
  o.f18 = param_1.f18 & 0xffff;
  o.f1c = param_1.f1c >>> 0;
  o.mapObj = fn_0x54feae(new MapObjRec(), param_1.mapObj);
  o.vtbl = VT_EFFECT;
  o.f3c = param_1.f3c & 0xff;
  o.f3d = param_1.f3d & 0xff;
  setI40(o, getI40(param_1));
  o.fc = param_1.fc & 0xffff;
  o.f44 = param_1.f44 >>> 0;
  wd.payloads.set(o.addr, o);
  return o;
}

/** 0x51cc53 (fastcall): bit 1 ou 2 de +0x3d (com duração ou contínuo). */
export function fn_0x51cc53(e: SpellPayloadRec): number {
  return (e.f3d & FX_TIMED) === 0 && (e.f3d & FX_CONT) === 0 ? 0 : 1;
}

/** 0x542540 (fastcall): bit 0x80 de +0x3d (acabou). */
export function fn_0x542540(e: SpellPayloadRec): number {
  return e.f3d & FX_DONE;
}

/** 0x53af60 (thiscall; lista, efeito): tira da lista (0x53b1f0 = Find + RemoveAt) e destrói (vtable+4). */
export function fn_0x53af60(wd: WorldRec, u: UnitRec, e: SpellPayloadRec): void {
  u.fx.remove(e.addr);
  deletePayload(wd, e.addr);
}

// ------------------------------------------------------------------------------------------------ vtable da carga "Effect" 0x5d1178

function vtFx(e: SpellPayloadRec, slot: number): void {
  if (e.vtbl !== VT_EFFECT) throw new Error(`carga 0x${e.addr.toString(16)} vtable 0x${e.vtbl.toString(16)} sem slot +0x${slot.toString(16)}`);
}
export function fxVt38(wd: WorldRec, e: SpellPayloadRec, u: UnitRec, h: CombatHooks): void { vtFx(e, 0x38); fn_0x51cc9f(wd, e, u, h); }
export function fxVt40(wd: WorldRec, e: SpellPayloadRec, u: UnitRec, h: CombatHooks): void { vtFx(e, 0x40); fn_0x51d175(wd, e, u, h); }
export function fxVt44(wd: WorldRec, e: SpellPayloadRec, u: UnitRec, h: CombatHooks): void { vtFx(e, 0x44); fn_0x51d337(wd, e, u, h); }
function fxVt48(wd: WorldRec, e: SpellPayloadRec, u: UnitRec, p: number, h: CombatHooks): void { vtFx(e, 0x48); fn_0x51d436(wd, e, u, p, h); }

/** 0x5118be (fastcall; vtable+0x58 do monstro): +0xa0 = mana máxima +0x9c, ou × dono+0xa5c ÷ 100 com dono (+0x14 ≠ 0: todo registro
 *  espelhado tem dono). */
export function fn_0x5118be(u: UnitRec): void {
  u.fa0 = s16(Math.trunc(Math.imul(u.owner.fa5c | 0, s16(u.f9c)) / 100));
}

/** vtable+0x58 da unidade: 0x51366b (humano/herói), 0x5118be (monstro). No mundo: gancho `recompute`. */
export function vt58(wd: WorldRec, u: UnitRec, h: CombatHooks): void {
  if (h.recompute) { h.recompute(u); return; }
  switch (u.vtbl) {
    case VT_HUMAN: case VT_HERO: unitRecompute(wd, u); return;
    case VT_MONSTER: fn_0x5118be(u); return;
  }
  throw new Error(`vtable 0x${u.vtbl.toString(16)} sem slot +0x58 espelhado`);
}

/** Procura na lista +0x20 (0x53b110/0x53b120/0x53b170) o 1.º efeito com `pred`. */
function findFx(wd: WorldRec, u: UnitRec, pred: (e: SpellPayloadRec) => boolean): SpellPayloadRec | null {
  const it = new CListPtrIter();
  for (let a = it.first(u.fx); a !== 0; a = it.next()) {
    const e = wd.payloadAt(a);
    if (pred(e)) return e;
  }
  return null;
}

/** 0x51ce12 (thiscall; vtable+0x3c da carga "Effect"; alvo): ver o cabeçalho. */
export function fn_0x51ce12(wd: WorldRec, o: SpellPayloadRec, param_1: UnitRec, h: CombatHooks): void {
  const local_14 = param_1;
  param_1.f150 = 0;
  const id = (o.fc << 16) >> 16;
  if (fn_0x51cc53(o) !== 0 && (id === 0x14 || id === 0x1c)) {
    const local_18 = findFx(wd, param_1, e => {
      const k = (e.fc << 16) >> 16;
      return (k === 0x14 && id === 0x1c) || (k === 0x1c && id === 0x14);
    });
    if (local_18 !== null) {
      local_14.effects = (local_14.effects & ~(1 << (local_18.fc & 0x1f))) >>> 0;
      fxVt44(wd, local_18, param_1, h);
      h.clientEffect?.(param_1, local_18.fc & 0xffff, local_18.f3c & 0xff, s16(local_18.f40), false);   // stub: cliente (0x504498)
      fn_0x53af60(wd, param_1, local_18);
      // stub: cliente (Server_Event 0xffb com +0x150)
      return;
    }
  }
  if (fn_0x51cc53(o) === 0) {
    fxVt40(wd, o, local_14, h);
  } else {
    const local_28 = findFx(wd, param_1, e => ((e.fc << 16) >> 16) === id);
    if (local_28 === null) {
      const local_48 = fn_0x51cb98(wd, o);
      if (((local_48.fc << 16) >> 16) !== 6) fxVt40(wd, local_48, local_14, h);
      param_1.fx.addTail(local_48.addr);   // 0x53bf70 → 0x53bf90 AddTail
      local_14.effects = (local_14.effects | (1 << (o.fc & 0x1f))) >>> 0;
      if (((o.fc << 16) >> 16) !== 0) h.clientEffect?.(param_1, local_48.fc & 0xffff, local_48.f3c & 0xff, s16(local_48.f40), true);   // stub: cliente (0x5044ba)
    } else {
      fxVt44(wd, local_28, local_14, h);
      const v = (o.f40 << 16) >> 16, w = (local_28.f40 << 16) >> 16;
      local_28.f40 = v < w ? w : v;
      const d = o.f42 & 0xffff, dd = local_28.f42 & 0xffff;
      local_28.f42 = d < dd ? dd : d;
      if (((local_28.fc << 16) >> 16) !== 6) fxVt40(wd, local_28, local_14, h);
      h.clientEffect?.(param_1, local_28.fc & 0xffff, local_28.f3c & 0xff, s16(local_28.f40), true);   // stub: cliente (Server_Event)
    }
  }
  // stub: cliente (Server_Event 0xffb com +0x150)
}

/** 0x51cc9f (thiscall; vtable+0x38: um tique do efeito na unidade): contínuo a cada 8 tiques age de novo (vtable+0x40); a duração
 *  (< 0x2581) desconta e, a 0, tira o efeito (vtable+0x44, salvo o contínuo), apaga o bit +0x144 e marca +0x3d |= 0x80. */
export function fn_0x51cc9f(wd: WorldRec, e: SpellPayloadRec, param_1: UnitRec, h: CombatHooks): void {
  if (fn_0x51cc53(e) === 0) return;
  if ((e.f3d & FX_CONT) !== 0 && (e.f42 & 7) === 0) {
    param_1.f150 = 0;
    fxVt40(wd, e, param_1, h);
    // stub: cliente (Server_Event 0xffb com +0x150)
  }
  if ((e.f42 & 0xffff) < 0x2581) {
    e.f42 = (e.f42 - 1) & 0xffff;
    if (e.f42 === 0) {
      if ((e.f3d & FX_CONT) === 0) {
        param_1.f150 = 0;
        fxVt44(wd, e, param_1, h);
        // stub: cliente (Server_Event 0xffb com +0x150)
      }
      param_1.effects = (param_1.effects & ~(1 << (e.fc & 0x1f))) >>> 0;
      if (((e.fc << 16) >> 16) !== 0) h.clientEffect?.(param_1, e.fc & 0xffff, e.f3c & 0xff, s16(e.f40), false);   // stub: cliente (0x504498)
      e.f3d = (e.f3d | FX_DONE) & 0xff;
    }
  }
}

/** 0x542770 (fastcall): vida < 0. */
function fn_0x542770(u: UnitRec): boolean {
  return ((u.f94 << 16) >> 16) < 0;
}

/** 0x51d175 (thiscall; vtable+0x40: o efeito começa a valer / age de novo). */
export function fn_0x51d175(wd: WorldRec, e: SpellPayloadRec, param_1: UnitRec, h: CombatHooks): void {
  const id = (e.fc << 16) >> 16;
  if (id === 6) {
    let local_8 = -((e.f40 << 16) >> 16);
    // proteção de água ≠ 0: ftol(dano × (100 − proteção) ÷ 100.0 + 0.5) (x87 do assembly: fdiv [0x5d0840], fadd [0x5d0828]; o
    // quociente só cai num inteiro + 0,5 quando é exato, então a dupla precisão trunca igual)
    const prot = (param_1.prot[2]! << 16) >> 16;
    if (prot !== 0) local_8 = crtFtol(Math.imul(local_8, (100 - prot) | 0) / 100 + 0.5);
    if (local_8 !== 0) {
      param_1.f94 = ((((param_1.f94 << 16) >> 16) - ((local_8 << 16) >> 16)) << 16) >> 16;
      if (e.f44 !== 0) {
        const c = wd.map.unitAt(e.f44);
        if (!fn_0x542770(c)) vt6c(c, param_1, local_8, 6, h.xpOnHit);
        else e.f44 = 0;
      }
      // stub: cliente (0x504b1d 's')
    }
  } else if (id === 0xf) {
    if (vt30(param_1) === 0) {
      param_1.fa4 = ((param_1.fa4 + ((e.f40 << 16) >> 16) * -0x100) << 16) >> 16;
      param_1.f150 = (param_1.f150 | 0x40000) >>> 0;
    }
  } else if (id === 0xe) {
    if (vt30(param_1) !== 0) {
      param_1.fe4 = ((param_1.fe4 + ((e.f40 << 16) >> 16) * 0x100) << 16) >> 16;
      param_1.fa4 = ((param_1.fa4 + ((e.f40 << 16) >> 16) * 0x100) << 16) >> 16;
      param_1.f150 = (param_1.f150 | 0x40000) >>> 0;
    }
  } else {
    fxVt48(wd, e, param_1, 1, h);
  }
}

/** 0x51d337 (thiscall; vtable+0x44: o efeito deixa de valer). */
export function fn_0x51d337(wd: WorldRec, e: SpellPayloadRec, param_1: UnitRec, h: CombatHooks): void {
  const id = (e.fc << 16) >> 16;
  if (id === 0xf) {
    if (vt30(param_1) === 0) {
      param_1.fa4 = ((param_1.fa4 + ((e.f40 << 16) >> 16) * 0x100) << 16) >> 16;
      param_1.f150 = (param_1.f150 | 0x40000) >>> 0;
    }
  } else if (id === 0xe) {
    if (vt30(param_1) !== 0) {
      param_1.fe4 = ((param_1.fe4 + ((e.f40 << 16) >> 16) * -0x100) << 16) >> 16;
      param_1.fa4 = ((param_1.fa4 + ((e.f40 << 16) >> 16) * -0x100) << 16) >> 16;
      param_1.f150 = (param_1.f150 | 0x40000) >>> 0;
    }
  } else if (id !== 6) {
    fxVt48(wd, e, param_1, -1, h);
  }
}

const s16 = (v: number) => (v << 16) >> 16;
const s8 = (v: number) => (v << 24) >> 24;

/** 0x51d436 (thiscall; vtable+0x48; unidade, ±1): ver o cabeçalho. */
export function fn_0x51d436(wd: WorldRec, e: SpellPayloadRec, param_1: UnitRec, param_2: number, h: CombatHooks): void {
  const u = param_1;
  if (0x18 < s16(u.fd8)) u.fd8 = 0;
  let local_14: number;
  if ((e.f3d & FX_TIMED) === 0 && (e.f3d & FX_CHARGES) === 0 && (e.f3d & FX_CONT) === 0) local_14 = getI40(e);
  else local_14 = s16(e.f40);
  local_14 = Math.imul(param_2, local_14);
  const cVar2 = s8(local_14);
  const v = s16(local_14);
  const nocap = (e.f3d & FX_NOCAP) !== 0;
  const or = (bits: number) => { u.f150 = (u.f150 | bits) >>> 0; };
  const cap100 = (x: number) => (s16(x) < 0x65 ? s16(x) : 100);
  const add = (x: number) => s16(x + v);
  const add0 = (x: number) => { const r = add(x); return r < 0 ? 0 : r; };
  switch (e.f3c & 0xff) {
    case 0: case 1: break;
    case 2: u.f84 = add(u.f84); if (!nocap) u.fd4 = s8(u.fd4 + cVar2); u.f84 = cap100(u.f84); or(0x20030009); break;
    case 3: u.f88 = add(u.f88); if (!nocap) u.fd6 = s8(u.fd6 + cVar2); u.f88 = cap100(u.f88); or(0x20040000); break;
    case 4: u.f86 = add(u.f86); if (!nocap) u.fd5 = s8(u.fd5 + cVar2); u.f86 = cap100(u.f86); or(0x20074000); break;
    case 5: u.f8a = add(u.f8a); if (!nocap) u.fd7 = s8(u.fd7 + cVar2); u.f8a = cap100(u.f8a); or(0x2100000a); break;
    case 6: u.f94 = s16(u.f94) + local_14 < s16(u.f96) ? add(u.f94) : s16(u.f96); or(1); break;
    case 7: u.f94 = add(u.f94); u.fdc = add(u.fdc); or(9); break;
    case 8: u.fde = add(u.fde); break;
    case 9: u.mana = s16(u.mana) + local_14 < s16(u.f9c) ? add(u.mana) : s16(u.f9c); or(2); break;
    case 10: if (fn_0x53a5a0(u) !== 0) { u.mana = add(u.mana); u.fe0 = add(u.fe0); or(10); } break;
    case 0xb: if (fn_0x53a5a0(u) !== 0) u.fe2 = add(u.fe2); break;
    case 0xc: u.bdmg.atk = add(u.bdmg.atk); or(0x10000); break;
    case 0xd: case 0x2b: case 0x31: u.bdmg.dmin = (u.bdmg.dmin + cVar2) & 0xff; or(0x20000); break;
    case 0xe: u.bdmg.dadd = (u.bdmg.dadd + cVar2) & 0xff; or(0x20000); break;
    case 0xf:
      if (vt30(u) === 0) u.fbe = add0(u.fbe);
      else u.bdef.def = add(u.bdef.def);
      or(0x4000); break;
    case 0x10:
      if (vt30(u) === 0) u.fc0 = add(u.fc0);
      else u.bdef.abs = add0(u.bdef.abs);
      or(0x8000); break;
    case 0x11:
      if (vt30(u) === 0) u.speed = add(u.speed);
      else u.fd8 = add(u.fd8);
      or(0x80000); break;
    case 0x12: u.walk.turnRate = (u.walk.turnRate + cVar2) & 0xff; break;
    case 0x13:
      if (vt30(u) === 0) u.fa4 = s16(u.fa4 + v * 0x100);
      else u.fe4 = s16(u.fe4 + v * 0x100);
      or(0x40000); break;
    case 0x14: case 0x15: case 0x16: case 0x17: case 0x18: case 0x19: {
      const i = (e.f3c & 0xff) - 0x14;
      u.bdef.prot[i] = add0(u.bdef.prot[i]!);
      or(0x1000000); break;
    }
    case 0x1a: if (aiInBattle(u)) u.bdmg.sk[0] = add(u.bdmg.sk[0]!); break;
    case 0x1b: case 0x1c: case 0x1d: case 0x1e: case 0x1f: {
      const i = (e.f3c & 0xff) - 0x1a;
      if (aiInBattle(u)) u.bdmg.sk[i] = add(u.bdmg.sk[i]!);
      or(0x30004); break;
    }
    case 0x20: if (fn_0x53a5a0(u) !== 0) u.bdmg.sk[0] = add(u.bdmg.sk[0]!); break;
    case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: {
      const i = (e.f3c & 0xff) - 0x20;
      if (fn_0x53a5a0(u) !== 0) u.bdmg.sk[i] = add(u.bdmg.sk[i]!);
      or(4); break;
    }
    case 0x26: case 0x27: case 0x28:
      break;   // stub: log "Effect affects not implemented yet" (Server_Log 0x43a0a8)
    case 0x29: break;
    case 0x2a:
      if (u.hasBook && unitGetBookSpell(u.book, local_14) === null) throw new NotPorted("0x51c29e");   // 0x51906d + Unit_AddSpellToBook
      or(0x100000); break;
    case 0x2c: case 0x2d: case 0x2e: case 0x2f: case 0x30:
      u.bdmg.elK = ((e.f3c & 0xff) - 0x2b) & 0xff;
      u.bdmg.elB0 = e.f40 & 0xff;
      u.bdmg.elB1 = (e.f40 >> 8) & 0xff;
      or(0x20000); break;
    default:
      break;   // stub: log "Oops - unknown Effect case" (Server_Log)
  }
  vt58(wd, u, h);
}

// ------------------------------------------------------------------------------------------------ o recálculo 0x51366b

/** 0x53a5c0 (fastcall): modelo +0xe == 0x22 ou 0x24 (as heroínas). */
export function fn_0x53a5c0(u: UnitRec): number {
  return (u.f0e & 0xffff) === 0x22 || (u.f0e & 0xffff) === 0x24 ? 1 : 0;
}
/** 0x5127d2 (cdecl; int): pow 0x5845c9(1,1, x). */
export function fn_0x5127d2(param_1: number): number {
  return Math.pow(1.1, param_1 | 0);
}
/** 0x5127f2 (cdecl; double): log 0x585d94(x) / log(1,1). */
export function fn_0x5127f2(param_1: number): number {
  return Math.log(param_1) / Math.log(1.1);
}
/** 0x5155dd (fastcall): memset do bloco de defesa (0x16 bytes) — defesa, absorção, proteções e resistências da unidade. */
function fn_0x5155dd(u: UnitRec): void {
  u.fbe = 0; u.fc0 = 0; u.prot.fill(0); u.resist.fill(0);
}
/** 0x515617 (thiscall; bloco +0xbe da unidade, bloco de bônus): soma proteções, resistências, defesa e absorção. */
function fn_0x515617(u: UnitRec, p: DefRec): void {
  for (let i = 0; i < 6; i++) u.prot[i] = s16(u.prot[i]! + p.prot[i]!);
  for (let i = 0; i < 6; i++) u.resist[i] = (u.resist[i]! + p.resist[i]!) & 0xff;
  u.fbe = s16(u.fbe + p.def);
  u.fc0 = s16(u.fc0 + p.abs);
}
/** 0x515a6c (thiscall; golpe +0xa6, bônus +0xe6): soma ataque, dano e os dois elementos; o elemento +0x15 é atribuído. */
function fn_0x515a6c(d: DmgRec, p: DmgRec): void {
  d.atk = s16(d.atk + p.atk);
  d.dmin = (d.dmin + p.dmin) & 0xff;
  d.dadd = (d.dadd + p.dadd) & 0xff;
  d.elA0 = (d.elA0 + p.elA0) & 0xff;
  d.elA1 = (d.elA1 + p.elA1) & 0xff;
  d.elB0 = (d.elB0 + p.elB0) & 0xff;
  d.elB1 = (d.elB1 + p.elB1) & 0xff;
  d.elK = p.elK & 0xff;
}
/** 0x5113e7 (thiscall; bônus +0xd4, unidade): soma o bônus nos derivados (velocidade < 0 zera o bônus de velocidade). */
function fn_0x5113e7(u: UnitRec): void {
  u.speed = s16(u.speed + u.fd8);
  if (s16(u.speed) < 0) u.fd8 = 0;
  u.f92 = s16(u.f92 + u.fda);
  u.f96 = s16(u.f96 + u.fdc);
  u.f9c = s16(u.f9c + u.fe0);
  u.fa4 = s16(u.fa4 + u.fe4);
  fn_0x515617(u, u.bdef);   // 0x5425a0
  fn_0x515a6c(u.dmg, u.bdmg);
}
/** 0x519483 Spell_CasterPower (thiscall; magia, unidade): poder = habilidade da esfera + Mind − 30 em 0..255 → Spell_Instance. */
export function spellCasterPower(s: BookSpellRec, u: UnitRec): void {
  const iVar2 = s16(u.f88);
  const iVar3 = s16(u.dmg.sk[s.def[2]! | 0] ?? 0) - 0x1e + iVar2;
  const p = iVar3 < 0 ? 0 : 0xff < iVar3 ? 0xff : iVar3;
  spellInstance(s, p & 0xff);
}
/** 0x51c3e4 (thiscall; livro, unidade): as magias do livro (índices 1..tamanho − 1) refeitas pelo poder de quem lança. */
function fn_0x51c3e4(u: UnitRec): void {
  for (let local_8 = 1; local_8 < u.book.spells.length; local_8++) {
    const s = u.book.spells[local_8];
    if (s) spellCasterPower(s, u);
  }
}

/** 0x51366b (fastcall; vtable+0x58 dos humanos/herói): ver o cabeçalho. */
export function unitRecompute(wd: WorldRec, u: UnitRec): void {
  void wd;
  const bVar5 = fn_0x53a5a0(u);
  const uVar3 = bVar5 === 0 ? 1 : 0;
  const uVar6 = fn_0x53a5c0(u);
  let local_24: number, local_10: number, local_28: number, local_c: number;
  if (uVar3 !== 0 && uVar6 === 0) { local_24 = 0x34; local_10 = 0x32; local_28 = 0x30; local_c = 0x2e; }
  else if ((uVar3 & uVar6) === 0) {
    if (uVar3 === 0 && uVar6 === 0) { local_24 = 0x30; local_10 = 0x2e; local_28 = 0x34; local_c = 0x32; }
    else { local_24 = 0x2e; local_10 = 0x30; local_28 = 0x32; local_c = 0x34; }
  } else { local_24 = 0x32; local_10 = 0x34; local_28 = 0x2e; local_c = 0x30; }
  const capped = (cap: number, b: number, x: number) => (cap + s8(b) < s16(x) ? s16(cap + s8(b)) : s16(x));
  u.f84 = capped(local_24, u.fd4, u.f84);
  u.f86 = capped(local_10, u.fd5, u.f86);
  u.f88 = capped(local_28, u.fd6, u.f88);
  u.f8a = capped(local_c, u.fd7, u.f8a);
  u.f96 = s16(Math.imul(s16(u.f84), uVar3 + 1));
  if (s16(u.f96) !== 0) {
    const lvl = fn_0x5127f2((u.f130 | 0) / 5000 + 1);
    u.f96 = s16(crtFtol(lvl * (uVar3 + 1) + s16(u.f96)));
    u.f96 = s16(crtFtol((fn_0x5127d2(s16(u.f84)) / 100 + 1) * s16(u.f96)));
  }
  if (s16(u.f9c) === 0) {
    u.mana = 0;
  } else {
    u.f9c = s16(s16(u.f8a) << 1);
    const lvl = fn_0x5127f2((u.f130 | 0) / 5000 + 1);
    u.f9c = s16(crtFtol(lvl * (uVar3 !== 0 ? 1 : 2) + s16(u.f9c)));
    u.f9c = s16(crtFtol((fn_0x5127d2(s16(u.f8a)) / 100 + 1) * s16(u.f9c)));
  }
  u.fa4 = s16(crtFtol(((s16(u.f88) + s16(u.f86)) / 25 + 4) * 256));
  u.f92 = s16(s16(u.f84) * 10 + 1);
  if (s16(u.f86) < 0xc) u.speed = s16(u.f86);
  else u.speed = s16(Math.trunc(s16(u.f86) / 5) + 0xc);
  if ((u.f0e & 0xffff) === 0x13 || (u.f0e & 0xffff) === 0x15) u.speed = s16(u.speed + 10);
  u.f90 = s16(u.f8e);
  if (u.f7c !== null) {
    if ((u.f7c.f20 | 0) < 64000) u.f90 = s16(s16(u.f90) + Math.trunc((u.f7c.f20 | 0) / 2));
    else u.f90 = 32000;
  }
  if (s16(u.f92) <= s16(u.f90)) {
    u.speed = s16(s16(u.speed) - Math.trunc(s16(u.f90) / s16(u.f92)));
    if (s16(u.speed) < 6) u.speed = 6;
  }
  u.dmg.dadd = crtFtol(fn_0x5127d2(s16(u.f84)) / 20) & 0xff;
  u.dmg.dmin = u.dmg.dadd;
  {
    const b = fn_0x5127d2(s16(u.f84));
    u.dmg.atk = s16(crtFtol((fn_0x5127d2(s16(u.f86)) + b) / 5));
  }
  for (let local_14 = 1; local_14 < 6; local_14++) u.dmg.sk[local_14] = u.skBase[local_14]!;
  for (let local_20 = 1; local_20 < 6; local_20++) {
    const x = s16(u.dmg.sk[local_20]!);
    const sVar1 = x < 0x65 ? x : 100;
    u.dmg.sk[local_20] = sVar1 < 0 ? 0 : sVar1;
  }
  for (let local_18 = 1; local_18 < 6; local_18++) {
    const x = s16(u.dmg.sk[local_18]!);
    const sVar1 = x < 0x65 ? x : 100;
    u.dmg.sk[local_18] = s16(sVar1 + u.bdmg.sk[local_18]!);
  }
  if ((u.dmg.wtype & 0xff) !== 0) {
    const w = u.dmg.wtype & 0xff;
    if (w > 5) throw new NotPorted("0x51366b (tipo de arma > 5)");
    const k = s16(u.dmg.sk[w]!);
    u.dmg.atk = s16(u.dmg.atk + k * 3);
    u.dmg.dmin = (u.dmg.dmin + Math.trunc(k / 5)) & 0xff;
  }
  u.dmg.elB1 = 0; u.dmg.elB0 = 0; u.dmg.elA1 = 0; u.dmg.elA0 = 0;
  fn_0x5155dd(u);
  u.fbe = s16(Math.trunc(s16(u.f86) / 3));
  for (let local_20 = 1; local_20 < 6; local_20++) u.prot[local_20] = s16(Math.trunc(s16(u.f8a) / 2));
  fn_0x5113e7(u);
  u.f94 = s16(u.f94) < s16(u.f96) ? s16(u.f94) : s16(u.f96);
  {
    const m = s16(u.mana) < s16(u.f9c) ? s16(u.mana) : s16(u.f9c);
    u.mana = m < 0 ? 0 : m;
  }
  u.fa0 = s16(Math.trunc(Math.imul(u.owner.fa5c | 0, s16(u.f9c)) / 100));
  u.walk.turnRate = u.speed & 0xff;
  if (s16(u.fbe) < 0) u.fbe = 0;
  if (s16(u.fc0) < 0) u.fc0 = 0;
  if (s16(u.f90) < 0) u.f90 = 0;
  for (let local_20 = 1; local_20 < 6; local_20++) {
    const cap = Math.trunc(s16(u.f8a) / 2) + 0x46;
    const p = s16(u.prot[local_20]!);
    const b = cap < p ? cap : p;
    const c = b < 0x65 ? b : 100;
    u.prot[local_20] = c < 0 ? 0 : c;
  }
  if (u.hasBook) fn_0x51c3e4(u);
}

// ------------------------------------------------------------------------------------------------ os laços da lista +0x20

/** O laço de efeitos de Unit_ActionMachine 0x50f12c: vtable+0x38 de cada efeito e, acabado (0x542540), 0x53af60. */
export function unitEffectsTick(wd: WorldRec, u: UnitRec, h: CombatHooks): void {
  const it = new CListPtrIter();
  for (let a = it.first(u.fx); a !== 0; a = it.next()) {
    const e = wd.payloadAt(a);
    fxVt38(wd, e, u, h);
    if (fn_0x542540(e) !== 0) fn_0x53af60(wd, u, e);
  }
}

/** O laço de efeitos de Unit_Die 0x510a70: os com duração/contínuos ficam com +0x42 = 1 e andam um tique (acabam). */
export function unitEffectsOnDie(wd: WorldRec, u: UnitRec, h: CombatHooks): void {
  const it = new CListPtrIter();
  for (let a = it.first(u.fx); a !== 0; a = it.next()) {
    const e = wd.payloadAt(a);
    if (fn_0x51cc53(e) !== 0) {
      e.f42 = 1;
      fxVt38(wd, e, u, h);
      if (fn_0x542540(e) !== 0) fn_0x53af60(wd, u, e);
    }
  }
}

/** 1,025^poder × definição[0xe] × 16.0 truncado (x87 do assembly: pow 0x5845c9, fmul [0x5d08a8], CRT_ftol): a duração dos `case` com
 *  duração do poder (proteções, Bless/Curse, Haste/Slow, Shield). */
function durationOfPower(s: BookSpellRec, local_44: number): number {
  return crtFtol(Math.pow(1.025, local_44) * (s.def[0xe]! | 0) * 16) & 0xffff;
}

/** Spell_Apply 0x519db8, os `case` de carga "Effect" (lote 4: Shield 0x1b; lote 5: o resto). Carga do texto da definição (0x51caa0) ou
 *  zerada (Spell_WallObject 0x51ca4d: Invisibility, Bless/Curse), +0x3d |= 1 (com duração) onde o exe põe, o valor +0x40 e a duração
 *  +0x42 pelo poder, o id +0xc e o desenho +0xe = id × 2 + 8. `null` = o exe destrói a carga (vtable+4) e sai (duração 0 na
 *  Invisibility e na Stone Curse). `local_30` = poder ÷ 45 + 1 (double, [ebp−0x2c]); Stone Curse sorteia a duração contra a proteção de
 *  terra do alvo (+0xca) se ele é unidade (vtable+0x2c; alvo nulo: o exe lê [0] e cai). */
export function spellApplyEffect(wd: WorldRec, s: BookSpellRec, local_44: number, param_1: UnitRec, param_2: UnitRec | null): SpellPayloadRec | null {
  const id = s.id & 0xff;
  let o: SpellPayloadRec;
  switch (id) {
    case 4: case 8: case 0xd: case 0x13:
      o = fn_0x51caa0(wd, s.effText);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f40 = s16(Math.trunc(local_44 / 2));
      o.f42 = durationOfPower(s, local_44);
      break;
    case 6: {
      o = fn_0x51caa0(wd, s.effText);
      const local_30 = local_44 / 45 + 1;
      o.f40 = s16(crtFtol(s16(o.f40) * local_30));
      break;
    }
    case 0xc:
      o = spellWallObject(wd);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f42 = (local_44 << 4) & 0xffff;
      o.fc = id; o.fe = (id * 2 + 8) & 0xffff;
      if (s16(o.f42) === 0) { deletePayload(wd, o.addr); return null; }
      return o;
    case 0xe:
      o = fn_0x51caa0(wd, s.effText);
      o.fc = id;
      o.f40 = s16(-1 - Math.trunc(local_44 / 0x1e));
      o.fe = (id * 2 + 8) & 0xffff;
      return o;
    case 0xf:
      o = fn_0x51caa0(wd, s.effText);
      o.fc = id;
      o.f40 = s16(Math.trunc(local_44 / 0x1e) + 1);
      o.fe = (id * 2 + 8) & 0xffff;
      return o;
    case 0x12: {
      o = fn_0x51caa0(wd, s.effText);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f42 = Math.trunc(Math.imul(Math.imul(local_44, 0xf0), (param_1.f68 === null ? 1 : 0) + 1) / 100) & 0xffff;
      if (param_2 === null) throw new NotPorted("0x519db8 (Stone Curse sem alvo: o exe lê [0])");
      if (vt2c(param_2) !== 0) {
        const n = Math.trunc(Math.imul(o.f42 & 0xffff, (100 - s16(param_2.prot[4]!)) | 0) / 100);
        o.f42 = randInclusive(wd, n, 0x51b799) & 0xffff;
        if ((o.f42 & 0xffff) === 0) { deletePayload(wd, o.addr); return null; }
      }
      break;
    }
    case 0x14: case 0x1c:
      o = spellWallObject(wd);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f40 = s16(Math.trunc((local_44 << 2) / 5) + 0x14);
      o.f42 = durationOfPower(s, local_44);
      break;
    case 0x15: case 0x1d:
      o = fn_0x51caa0(wd, s.effText);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f40 = s16(Math.trunc(local_44 / 0xf) + 1);
      if (id === 0x1d) o.f40 = s16(-o.f40);
      o.f42 = durationOfPower(s, local_44);
      break;
    case 0x1b:
      o = fn_0x51caa0(wd, s.effText);
      o.f3d = (o.f3d | FX_TIMED) & 0xff;
      o.f40 = s16(Math.trunc(local_44 / 10) + 3);
      o.f42 = durationOfPower(s, local_44);
      break;
    default:
      throw new NotPorted(`0x519db8 (magia 0x${id.toString(16)})`);
  }
  o.fc = id;
  o.fe = (id * 2 + 8) & 0xffff;
  return o;
}

/** Os ids de `spellApplyEffect`. */
export const EFFECT_CASES: ReadonlySet<number> = new Set([4, 6, 8, 0xc, 0xd, 0xe, 0xf, 0x12, 0x13, 0x14, 0x15, 0x1b, 0x1c, 0x1d]);
