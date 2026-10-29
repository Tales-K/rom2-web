/**
 * Porta literal do servidor do allods2.exe: a criação das unidades do mapa a partir do modelo cru de data.bin (etapa 9b, lote 2;
 * notes/carregador.md). O carregador 0x561bf9 cria cada unidade do .alm pelo nome do modelo:
 *  - monstro: Monster_CreateByName 0x50dd41 (vtable 0x5d0eb0) → 0x50e173 (construtor de toda unidade: 0x50ec60, o sorteio do rumo —
 *    feito em `World.spawn` — e, com nome, 0x511959) → 0x5114f3 Monster_LoadTemplate, itens (vtable+0x44 = 0x510883 → item+0x38),
 *    livro, habilidades e 0x57382c;
 *  - humano: Human_CreateByName 0x5143e4 → 0x512133 (0x50dc2b: 0x50e173 sem nome; 0x5121e1) → vtable 0x5d0fb8 → 0x5145d1 (0x514cf2, itens
 *    pela vtable+0x44 = 0x512638 → 0x512573 → item+0x38, livro, 0x513497, vtable+0x58 = 0x51366b, vida/mana cheias).
 * Portadas: 0x50ec60, 0x569003 (os campos que ficam ≠ 0), 0x5114f3, 0x511959 Monster_CreateFromTemplate (antes "Human_Create" no known_functions: é o ramo do MONSTRO),
 * 0x557a89, 0x57382c AI_SetDefaultWimpy, 0x5121e1, 0x5145d1, 0x514cf2, 0x513497, 0x5128ac (+ a tabela de 0x512824), 0x510883, 0x512638,
 * 0x512573, 0x5290cc (arma, item+0x38), 0x52846b (escudo), 0x527a13 (armadura), 0x50f065, 0x52377e (efeitos mágicos do item:
 * vtable+0x40 = 0x51d175).
 * Os itens são dados: o construtor 0x528808/0x527e23/0x5273f0 (forma × material × classe de data.bin, 0x528a9b/0x528c92) não está portado;
 * os atributos vêm de items.json (tools/data/derive.py `compute_item`, conferido contra itemname.pkt) por `CreateItem`. Os efeitos do
 * texto "{...}" (0x523913 → 0x51e78e) são lidos pelos nomes da tabela 0x5f8f50.
 * Não portado: o nome com "." (nível/sexo, só nos modelos de herói "Start_"/"*" de 0x5145d1) e o ramo de herói (param_2 ≠ 0),
 * vtable+0x5c dos humanos (0x51754d: +0x1c pela conta x87 que o C perdeu; +0x1c fica 0), o item para a mochila (Pack_AddItem: o item
 * trocado, que na criação nunca existe).
 */
import { fn_0x53a5a0 } from "./action";
import { fn_0x515617, fn_0x5113e7, fn_0x5127d2, fxVt40, unitRecompute, vt58 } from "./effects";
import { crtFtol } from "./path";
import { vt30 } from "./vtables";
import { fn_0x55f330 } from "./walk";
import { aiAttackRange } from "./wave";
import { DefRec, DmgRec, SpellPayloadRec, VT_EFFECT, type UnitRec, type WorldRec } from "./types";
import type { CombatHooks } from "./combat";

const s16 = (v: number) => (v << 16) >> 16;

/** Modelo cru (unit-templates.json `raw`/`rawItems`): o CArray<int> do modelo (+0x3c → +8) e o CStringArray dos itens (+0x1c). */
export interface CreateTemplate { name: string; raw: number[]; rawItems: string[] }

/** Item já construído (o construtor não está portado: atributos de items.json). Campos pelo deslocamento no objeto do item. */
export interface CreateItem {
  /** classe de runtime (0x5a1edf: 0x5f9158 arma / 0x5f9188 escudo / 0x5f9170 armadura) e o construtor de 0x511959/0x5145d1 */
  kind: "weapon" | "shield" | "armor";
  /** modelo da classe do item ([+0x3c]+8): [5] tipo de ataque, [0xc] charge, [0xd] relax, [0xe] 2 = duas mãos, [0xf] serve a (1 lutador, 2 mago) */
  cls: number; charge: number; relax: number; twoHanded: number; suitable: number;
  weight: number;       // +0x4a i16
  range: number;        // +0x54 u8 (arma: o alcance; armadura: o lugar no corpo)
  dmg: DmgRec;          // +0x56 (arma) golpe
  def: DefRec;          // +0x6e (arma) / +0x54 (escudo) / +0x56 (armadura) defesa
  /** +0x20 efeitos mágicos (0x51e78e): tipo da tabela 0x5f8f50 e o valor */
  magic: [number, number][];
}

// ------------------------------------------------------------------------------------------------ leitura do modelo

/** O leitor sequencial 0x4fd85f do CArray do modelo: 0x5425c0 (i16), 0x542610 (u8), 0x542660 (i32), 0x5426b0 (u16). Valor −1 = deixa
 *  o campo como está; o índice anda sempre. */
class TplReader {
  i = 0;
  constructor(private arr: number[]) {}
  private next(): number | null {
    const v = this.arr[this.i++] ?? 0;   // 0x542700: CArray::GetAt
    return v === -1 ? null : v | 0;
  }
  rd(set: (v: number) => void): void { const v = this.next(); if (v !== null) set(v); }
}

/** Nomes dos tipos de efeito (tabela 0x5f8f50 do .rdata, índice = tipo +0x3c). */
export const FX_NAMES = [
  "unused_value_0", "price", "body", "mind", "reaction", "spirit", "health", "healthmax", "healthregeneration", "mana", "manamax",
  "manaregeneration", "tohit", "damagemin", "damagemax", "defence", "absorbtion", "speed", "rotationspeed", "scanrange", "protection0",
  "protectionfire", "protectionwater", "protectionair", "protectionearth", "protectionastral", "fighterskill0", "skillblade", "skillaxe",
  "skillbludgeon", "skillpike", "skillshooting", "mageskill0", "skillfire", "skillwater", "skillair", "skillearth", "skillastral",
  "itemlore", "magiclore", "creaturelore", "castspell", "teachspell", "damage", "damagefire", "damagewater", "damageair", "damageearth",
  "damageastral", "damagebonus",
];

/** O texto "{nome=valor, ...}" do item (0x523913 → 0x51e78e) → [tipo, valor]. castSpell ("Fire_Arrow:5") fica com valor 0 (0x51d436
 *  não faz nada no tipo 0x29; o cajado é do motor antigo, `weaponSpell`). */
export function parseItemMagic(spec: string): [number, number][] {
  const m = /\{(.*)\}/.exec(spec);
  if (!m) return [];
  const out: [number, number][] = [];
  for (const part of m[1]!.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase(), v = part.slice(eq + 1).trim();
    const t = FX_NAMES.indexOf(k);
    if (t < 0) continue;
    out.push([t, t === 0x29 ? 0 : parseInt(v.replace(/^\+/, ""), 10) | 0]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ construtores

/** 0x50ec60 (fastcall): os padrões de toda unidade (chamado por 0x50e173 antes do modelo). */
export function fn_0x50ec60(u: UnitRec): void {
  u.task = 0xb;
  u.f84 = 0x1e; u.f86 = 0x1e; u.f88 = 0x14; u.f8a = 0x14;
  u.speed = 10;
  u.walk.turnRate = 8;
  u.fa5 = 5;
  u.fa4 = s16(u.fa4 & ~0xff);   // +0xa4 (byte) = 0
  u.f8e = 0; u.f90 = 0;
  u.f92 = s16(s16(u.f84) * 10);
  u.f96 = 0x1e; u.f94 = 0x1e;
  u.f98 = 100;
  u.f9c = 0; u.mana = 0;
  u.fa0 = u.f9c;
  u.f9e = 0x32;
  u.f134 = 8; u.f135 = 4;
  u.attackRange = 1;
}

/** 0x569003 (fastcall; IA, 0xb8 bytes): memset 0, +0x71 = 1, +0x16 = 0xffdc (os outros campos espelhados já nascem 0). */
export function fn_0x569003(u: UnitRec): void {
  u.ai.task = 0; u.ai.sub = 0; u.ai.f4c = 0;
  u.ai.f71 = 1;
  u.ai.f16 = s16(0xffdc);
}

/** 0x557a89 (thiscall; andar, unidade): a máscara de passagem andar+5 pelo tipo de movimento (vtable+0x20 → +0x4a). */
export function fn_0x557a89(u: UnitRec): void {
  const cVar1 = fn_0x55f330(u);
  if (cVar1 === 1) u.walk.passMask = 0x41;
  else if (cVar1 === 2) u.walk.passMask = 0x44;
  else if (cVar1 === 3) u.walk.passMask = 0x82;
}

/** 0x5114f3 Monster_LoadTemplate (thiscall; unidade, CArray do modelo). */
export function monsterLoadTemplate(u: UnitRec, arr: number[]): void {
  const r = new TplReader(arr);
  r.rd(v => { u.f84 = s16(v); });
  r.rd(v => { u.f86 = s16(v); });
  r.rd(v => { u.f88 = s16(v); });
  r.rd(v => { u.f8a = s16(v); });
  r.rd(v => { u.f96 = s16(v); });
  u.f94 = u.f96;
  r.rd(v => { u.f98 = s16(v); });
  r.rd(v => { u.f9c = s16(v); });
  u.mana = u.f9c;
  u.fa0 = u.mana;
  r.rd(v => { u.f9e = s16(v); });
  r.rd(v => { u.speed = s16(v); });
  r.rd(v => { u.walk.turnRate = v & 0xff; });
  r.rd(v => { u.fa5 = v & 0xff; });
  let local_18 = 0, local_14 = 0, local_8 = 0;
  r.rd(v => { local_14 = v; });
  r.rd(v => { local_8 = v; });
  local_8 = (local_8 - local_14) | 0;
  r.rd(v => { local_18 = v; });
  const d = u.dmg;
  if (local_18 < 1) {
    if (local_14 < 0x80 && local_8 <= local_14 + 0xff) {
      d.dmin = local_14 & 0xff;
      d.dadd = local_8 & 0xff;
    } else {
      const local_24 = Math.trunc(local_14 / 0xf) < 0x7f ? Math.trunc(local_14 / 0xf) & 0xff : 0x7f;
      d.dmin = (local_24 | 0x80) & 0xff;
      d.dadd = Math.trunc(local_8 / 0xf) < 0xff ? Math.trunc(local_8 / 0xf) & 0xff : 0xff;
    }
  } else if (local_18 === 1) {
    d.elA0 = local_14 & 0xff;
    d.elA1 = local_8 & 0xff;
  } else if (local_18 === 2) {
    d.elB0 = -local_14 & 0xff;
    d.elB1 = -local_8 & 0xff;
  } else if (local_18 === 3) {
    u.f4c = (u.f4c | 0x10) & 0xff;
    d.dmin = local_14 & 0xff;
    d.dadd = local_8 & 0xff;
  }
  r.rd(v => { d.atk = s16(v); });
  d.sk[0] = d.atk;
  r.rd(v => { u.fbe = s16(v); });
  r.rd(v => { u.fc0 = s16(v); });
  r.rd(v => { u.f134 = v & 0xff; });
  r.rd(v => { u.f135 = v & 0xff; });
  for (let local_1c = 1; local_1c < 6; local_1c++) r.rd(v => { u.prot[local_1c] = s16(v); });
  for (let local_1c = 1; local_1c < 6; local_1c++) r.rd(v => { u.resist[local_1c] = v & 0xff; });
  r.rd(v => { u.f0e = v & 0xffff; });
  r.rd(v => { u.f4b = v & 0xff; });
  r.rd(v => { u.size = v & 0xff; });
  r.rd(v => { u.kind = v & 0xff; });
  r.rd(() => { /* local_1c (duração da queda: lida de novo por vtable+0x74, modelo[0x21]) */ });
  r.rd(v => { u.ai.f40 = v | 0; });
  r.rd(v => { u.ai.f44 = v | 0; });
  r.rd(v => { u.ai.f71 = v & 0xff; });
  r.rd(v => { u.f1c = v | 0; });
}

/** 0x5121e1 (fastcall): os padrões do humano (depois de 0x50dc2b). Os ponteiros +0x208..+0x238 (13 lugares de equipamento) e
 *  +0x23c..+0x250 ficam zerados (`f23c`). */
export function fn_0x5121e1(u: UnitRec): void {
  u.f23c.fill(0);
  u.f84 = 0x1e; u.f88 = 0x1e; u.f86 = 0x1e; u.f8a = 0x1e;
  u.f96 = 0x32; u.f94 = 0x32;
  u.speed = 0x10;
  u.walk.turnRate = 8;
  u.f134 = 8; u.f135 = 4;
  u.dmg.dmin = 1;
  u.dmg.dadd = (2 - u.dmg.dmin) & 0xff;
  fn_0x557a89(u);
}

/** 0x514cf2 (thiscall; unidade, CArray do modelo humano). O laço das habilidades (+0x116 ← +0xa8, a maior em +0x23c) vem do
 *  assembly (0x514e75..0x514ee7: o C o perdeu). */
export function fn_0x514cf2(u: UnitRec, arr: number[], tplName: string): void {
  const r = new TplReader(arr);
  r.rd(v => { u.f84 = s16(v); });
  r.rd(v => { u.f86 = s16(v); });
  r.rd(v => { u.f88 = s16(v); });
  r.rd(v => { u.f8a = s16(v); });
  r.rd(v => { u.f96 = s16(v); });
  u.f94 = u.f96;
  r.rd(v => { u.f9c = s16(v); });
  u.mana = u.f9c;
  r.rd(v => { u.speed = s16(v); });
  r.rd(v => { u.walk.turnRate = v & 0xff; });
  r.rd(v => { u.fa5 = v & 0xff; });
  r.rd(v => { u.fbe = s16(v); });
  for (let local_1c = 0; local_1c < 6; local_1c++) r.rd(v => { u.dmg.sk[local_1c] = s16(v); });
  u.dmg.atk = 0;
  let local_20 = 0, local_8 = 0;
  const local_28 = tplName.includes("_Hero") || tplName.includes("Start_") ? 1 : 0;   // CRT_strstr ≠ −1
  for (let local_10 = 1; local_10 < 6; local_10++) {
    u.skBase[local_10] = u.dmg.sk[local_10]!;
    if (local_8 < s16(u.dmg.sk[local_10]!)) { local_20 = local_10; local_8 = s16(u.dmg.sk[local_10]!); }
  }
  if (local_28 !== 0) u.f23c[0] = local_20;
  r.rd(v => { u.f0e = v & 0xffff; });
  r.rd(v => { u.f4b = v & 0xff; });
  r.rd(() => { /* local_1c (feminino: 0x5145d1 relê modelo[0x12]) */ });
  r.rd(v => { u.f134 = v & 0xff; });
  r.rd(v => { u.f135 = v & 0xff; });
  r.rd(v => { u.size = v & 0xff; });
  r.rd(v => { u.kind = v & 0xff; });
}

/** Tabela 0x6a8998 (0x512824, na partida): ftol((1,1^i − 1) × 1000), i = 0..0x95 (x87 do assembly: fsub [0x5d0858] 1,0; fmul [0x5d0860]
 *  1000,0; conferida com a memória da imagem m10_start_s1). */
const SKILL_EXP: number[] = Array.from({ length: 0x96 }, (_, i) => crtFtol((fn_0x5127d2(i) - 1) * 1000));

/** 0x5128ac (cdecl): a experiência de um valor de habilidade (teto 0x95). */
export function fn_0x5128ac(param_1: number): number {
  if (0x95 < param_1) param_1 = 0x95;
  return SKILL_EXP[param_1] ?? 0;   // índice negativo: memória antes da tabela (não ocorre nos modelos)
}

/** 0x513497 (fastcall): experiência +0x130 = soma das de cada habilidade (+0x240..), +0x118.. ← +0xaa.. */
export function fn_0x513497(u: UnitRec): void {
  u.f130 = 0;
  for (let local_c = 1; local_c < 6; local_c++) {
    u.f23c[local_c] = fn_0x5128ac(s16(u.dmg.sk[local_c]!));
    u.f130 = (u.f130 + u.f23c[local_c]!) | 0;
  }
  for (let local_8 = 1; local_8 < 6; local_8++) u.skBase[local_8] = u.dmg.sk[local_8]!;
}

// ------------------------------------------------------------------------------------------------ itens

/** 0x50f065 (thiscall; unidade, peso): carga-base +0x8e += peso; +0x90 = carga-base + mochila ÷ 2; mudou a faixa (+0x90 ÷ +0x92) →
 *  vtable+0x58. */
export function fn_0x50f065(wd: WorldRec, u: UnitRec, param_1: number, h: CombatHooks): void {
  const sVar1 = s16(u.f90);
  u.f8e = s16(u.f8e + param_1);
  u.f90 = u.f8e;
  if (u.f7c !== null) {
    if ((u.f7c.f20 | 0) < 64000) u.f90 = s16(u.f90 + Math.trunc((u.f7c.f20 | 0) / 2));
    else u.f90 = 32000;
  }
  if (Math.trunc(s16(u.f90) / s16(u.f92)) !== Math.trunc(sVar1 / s16(u.f92))) vt58(wd, u, h);
}

/** 0x52377e (thiscall; item, unidade): vtable+0x40 de cada efeito mágico do item (carga "Effect": 0x51d175 → 0x51d436). */
export function fn_0x52377e(wd: WorldRec, it: CreateItem, u: UnitRec, h: CombatHooks): void {
  for (const [t, v] of it.magic) {
    const e = new SpellPayloadRec();
    e.vtbl = VT_EFFECT; e.f3c = t & 0xff; e.f3d = 0;
    e.f40 = v & 0xffff; e.f42 = (v >>> 16) & 0xffff;
    fxVt40(wd, e, u, h);
  }
}

/** 0x5290cc (thiscall; arma, unidade; vtable+0x38 da arma): veste a arma (não há outra na criação: param_1[0x1d] = 0). */
export function fn_0x5290cc(wd: WorldRec, it: CreateItem, u: UnitRec, h: CombatHooks): void {
  const iVar2 = it.cls | 0;
  if (iVar2 < 10) {
    u.bdmg.dmin = (u.bdmg.dmin + it.dmg.dmin) & 0xff;
    u.bdmg.dadd = (u.bdmg.dadd + it.dmg.dadd) & 0xff;
    u.bdef.def = s16(u.bdef.def + it.def.def);
    u.bdmg.elB0 = it.dmg.elB0 & 0xff;
    u.bdmg.elB1 = it.dmg.elB1 & 0xff;
    u.bdmg.elK = it.dmg.elK & 0xff;
    u.bdmg.atk = s16(u.bdmg.atk + it.dmg.atk);
    u.dmg.wtype = iVar2 & 0xff;
  } else {
    if (iVar2 === 0xb) {
      u.bdmg.elB0 = (u.bdmg.elB0 + it.dmg.dmin) & 0xff;
      u.bdmg.elB1 = (u.bdmg.elB1 + it.dmg.dadd) & 0xff;
      u.bdmg.elK = 1;
    } else if (iVar2 === 0xc) {
      u.bdmg.elB0 = (u.bdmg.elB0 + it.dmg.dmin) & 0xff;
      u.bdmg.elB1 = (u.bdmg.elB1 + it.dmg.dadd) & 0xff;
      u.bdmg.elK = 2;
    }
    u.bdmg.atk = s16(u.dmg.sk[0]!);   // param_1[0x2a] = +0xa8
    u.dmg.wtype = 0;
  }
  vt58(wd, u, h);
  if (vt30(u) !== 0) {
    if (it.charge !== -1) u.f134 = it.charge & 0xff;
    if (it.relax !== -1) u.f135 = it.relax & 0xff;
  }
  u.attackRange = (u.attackRange + it.range - 1) & 0xff;
  fn_0x50f065(wd, u, s16(it.weight), h);
  u.f150 = (u.f150 | 0x34000) >>> 0;
  fn_0x52377e(wd, it, u, h);
}

/** 0x52846b (thiscall; escudo, unidade; vtable+0x38 do escudo). Arma de duas mãos vestida: o exe a tira (vtable+0x48) — não ocorre
 *  nos modelos (o escudo vem depois da arma só nos humanos, e nenhum tem os dois). */
export function fn_0x52846b(wd: WorldRec, it: CreateItem, u: UnitRec, h: CombatHooks, weapon: CreateItem | null): void {
  if (weapon && weapon.twoHanded === 2) throw new Error("0x52846b: escudo com arma de duas mãos (vtable+0x48 não portada)");
  defAdd(u.bdef, it.def);   // 0x515617 no bônus +0xfe
  fn_0x515617(u, it.def);   // e no bloco da unidade +0xbe
  fn_0x50f065(wd, u, s16(it.weight), h);
  fn_0x52377e(wd, it, u, h);
  u.f150 = (u.f150 | 0xc000) >>> 0;
}

/** 0x527a13 (thiscall; armadura, unidade; vtable+0x38 da armadura): só quem tem equipamento (vtable+0x30). O lugar (+0x54) vazio na
 *  criação: o ponteiro +0x208.. não é espelhado. */
export function fn_0x527a13(wd: WorldRec, it: CreateItem, u: UnitRec, h: CombatHooks): void {
  if ((it.range & 0xff) === 0) return;   // "Illegal armor" (Server_Log)
  if (vt30(u) === 0) return;
  defAdd(u.bdef, it.def);   // 0x515617 no bônus +0xfe
  fn_0x515617(u, it.def);   // e no bloco da unidade +0xbe
  fn_0x50f065(wd, u, s16(it.weight), h);
  u.f150 = (u.f150 | 0xc000) >>> 0;
  fn_0x52377e(wd, it, u, h);
}

/** 0x515617 (thiscall) sobre o bloco de bônus +0xfe (o de effects.ts soma no bloco da unidade +0xbe). */
function defAdd(d: DefRec, p: DefRec): void {
  for (let i = 0; i < 6; i++) d.prot[i] = s16(d.prot[i]! + p.prot[i]!);
  for (let i = 0; i < 6; i++) d.resist[i] = (d.resist[i]! + p.resist[i]!) & 0xff;
  d.def = s16(d.def + p.def);
  d.abs = s16(d.abs + p.abs);
}

/** item+0x38 pela classe do item. */
function itemVt38(wd: WorldRec, it: CreateItem, u: UnitRec, h: CombatHooks, weapon: CreateItem | null): void {
  if (it.kind === "weapon") fn_0x5290cc(wd, it, u, h);
  else if (it.kind === "shield") fn_0x52846b(wd, it, u, h, weapon);
  else fn_0x527a13(wd, it, u, h);
}

/** 0x510883 (thiscall; vtable+0x44 do monstro): item+0x38; o item trocado (nenhum na criação) iria para a mochila + vtable+0x5c. */
function fn_0x510883(wd: WorldRec, u: UnitRec, it: CreateItem, h: CombatHooks, weapon: CreateItem | null): void {
  itemVt38(wd, it, u, h, weapon);
}

/** 0x512573 (thiscall; vtable+0x40 do humano): arma/escudo/armadura só se serve (modelo do item [0xf]: bit 1 lutador, bit 2 mago;
 *  0x53a5a0 = conjurador); senão o item volta (vai para a mochila). */
function fn_0x512573(wd: WorldRec, u: UnitRec, it: CreateItem, h: CombatHooks, weapon: CreateItem | null): boolean {
  const caster = fn_0x53a5a0(u) !== 0;
  if (((it.suitable & 1) !== 0 || caster) && ((it.suitable & 2) !== 0 || !caster)) {
    itemVt38(wd, it, u, h, weapon);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ criação

/** 0x57382c AI_SetDefaultWimpy (thiscall; IA [0x66832c], unidade). Na criação do monstro a vtable é a 0x5d0eb0: vtable+0x30 = 0 → nada. */
export function aiSetDefaultWimpy(u: UnitRec): void {
  if (vt30(u) === 0) return;
  if (!u.hasBook) {
    const bVar1 = aiAttackRange(u) & 0xff;
    if (bVar1 < 2 || fn_0x55f330(u) === 3) { u.ai.f4c = 0; u.ai.f40 = 0; u.ai.f44 = 0; }
    else { u.ai.f4c = 1; u.ai.f40 = Math.trunc(s16(u.f96) / 2); u.ai.f44 = 0; }
  } else {
    u.ai.f4c = 2;
    u.ai.f40 = s16(u.f96);
    u.ai.f44 = Math.trunc(s16(u.f96) / 4);
  }
}

/** Resultado da criação além do registro: as magias do livro na ordem de Unit_AddSpellToBook (0x51906d + 0x51c29e; o livro espelhado é
 *  refeito pelo motor antigo das magias da unidade) e as magias de chance (IA+0x7c/+0x88). */
export interface Created { book: number[] }

/** 0x511959 (thiscall; unidade com vtable de monstro, nome do modelo): o modelo já achado pelo nome na lista [0x68f57c] (o índice +0xc
 *  e o ponteiro +0x3c são do chamador). `items[i]` = o item construído de rawItems[i] (null: texto vazio ou "Invalid weapon"). */
export function monsterCreate(wd: WorldRec, u: UnitRec, t: CreateTemplate, items: (CreateItem | null)[], h: CombatHooks = {}): Created {
  const arr = t.raw, out: Created = { book: [] };
  monsterLoadTemplate(u, arr);
  if (arr.length > 0x36) u.f14c = arr[0x37]! & 0xffff;
  let weapon: CreateItem | null = null;
  for (let local_18 = 0; local_18 < 2; local_18++) {
    const it = items[local_18] ?? null;
    if ((t.rawItems[local_18] ?? "").length > 0 && it) {
      fn_0x510883(wd, u, it, h, weapon);   // "Shield" no texto → 0x527e23, senão 0x528808 (o tipo do `CreateItem`)
      if (it.kind === "weapon") weapon = it;
    }
  }
  if (s16(u.f0e) === 0) return out;   // "Invalid unit" (Server_Log)
  if (0 < (arr[0x30]! | 0)) { u.f4c = (u.f4c | 2) & 0xff; u.hasBook = true; }
  for (let local_14 = 0; local_14 < 3; local_14++) {
    const local_20 = arr[local_14 * 2 + 0x30]! | 0, local_24 = arr[local_14 * 2 + 0x31]! | 0;
    if (0 < local_20) {
      out.book.push(local_20);
      u.ai.f7c[local_14] = local_20;
      u.ai.f88[local_14] = Math.imul(local_24, 0x147);
    }
  }
  for (let local_28 = 1; local_28 < 6; local_28++) u.dmg.sk[local_28] = s16(arr[0x36]!);
  if (0x37 < arr.length) {
    const local_2c = arr[0x38]! >>> 0;
    if (local_2c !== 0 && local_2c !== 0xffffffff) {
      u.f4c = (u.f4c | 6) & 0xff;
      u.hasBook = true;
      out.book.length = 0;   // livro novo (0x53a600): o das magias de chance fica para trás
      for (let local_30 = 1; local_30 < 0x1e; local_30++) if ((local_2c & (1 << (local_30 & 0x1f))) !== 0) out.book.push(local_30);
      for (let i = 1; i < 6; i++) u.dmg.sk[i] = s16(arr[0x38 + i]!);
    }
  }
  fn_0x5113e7(u);
  // vtable+0x5c do monstro: 0x5423c0 devolve +0x1c (nada)
  if (0 < (arr[0x25]! | 0)) u.f1c = arr[0x25]! | 0;
  fn_0x557a89(u);
  aiSetDefaultWimpy(u);
  return out;
}

/** 0x5145d1 (thiscall; unidade humana, nome do modelo, param_2 herói, param_3 sem itens): o ramo dos modelos do mapa — nome sem "." nem
 *  o prefixo do herói (local_14 = −1, local_1c = 1, local_20 = 1). */
export function humanCreate(wd: WorldRec, u: UnitRec, t: CreateTemplate, items: (CreateItem | null)[], h: CombatHooks = {}): Created {
  const arr = t.raw, out: Created = { book: [] };
  let local_1c = 1;
  // o carregador passa param_2 = o nome tem "_Hero" depois do 1.º caractere (0x561bf9: strstr > 0)
  const local_14 = -1, param_2 = t.name.indexOf("_Hero") > 0 ? 1 : 0;
  fn_0x514cf2(u, arr, t.name);
  if ((arr[0x12]! | 0) !== -1) local_1c = arr[0x12]! | 0;
  if (0x17 < arr.length) {
    u.f14c = arr[0x18]! & 0xffff;
    if (10000 < u.f14c) u.f14c = Math.trunc(u.f14c / 10) % 1000 & 0xffff;
  }
  if (0 < s16(u.f9c)) u.f4c = (u.f4c | 6) & 0xff;
  let weapon: CreateItem | null = null;
  for (let local_28 = 0; local_28 < 10; local_28++) {
    const it = items[local_28] ?? null;
    if ((t.rawItems[local_28] ?? "").length > 0 && it) {
      // 0 arma (0x528808), 1 escudo (0x527e23), o resto armadura (0x5273f0); vtable+0x44 = 0x512638 → vtable+0x40 = 0x512573
      if (fn_0x512573(wd, u, it, h, weapon) && it.kind === "weapon") weapon = it;
    }
  }
  if (0 < s16(u.f9c)) {
    u.f4c = (u.f4c | 6) & 0xff;
    u.hasBook = true;
    const local_34 = arr[0x19]! >>> 0;
    for (let local_30 = 1; local_30 < 0x1e; local_30++) if ((local_34 & (1 << (local_30 & 0x1f))) !== 0) out.book.push(local_30);
  }
  if (0 < local_14) u.f4b = local_14 & 0xff;
  if (param_2 === 0) u.f4b = (u.f4b | ((local_1c << 7) & 0xff)) & 0xff;
  else u.f0e = (fn_0x53a5a0(u) === 0 ? local_1c + 0x21 : local_1c + 0x23) & 0xffff;
  fn_0x513497(u);
  unitRecompute(wd, u);   // vtable+0x58 (0x51366b)
  u.f94 = u.f96;
  u.mana = u.f9c;
  // vtable+0x5c (0x51754d): +0x1c pela conta x87 perdida no C — não portado (+0x1c fica 0)
  return out;
}

/** Os padrões que 0x50e173/0x569003 deixam antes do modelo (as duas vias de criação). */
export function unitBaseDefaults(u: UnitRec): void {
  fn_0x569003(u);
  u.f4c = 0; u.f14c = 0; u.f130 = 0; u.effects = 0; u.f148 = 0;
  fn_0x50ec60(u);
}

/** Unidade do mapa do modelo cru: monstro (vtable 0x5d0eb0) ou humano (0x5d0fb8), como o carregador 0x561bf9 escolhe pelo bit 0x10
 *  do .alm (aqui: o modelo é da tabela Humans). */
export function createFromTemplate(wd: WorldRec, u: UnitRec, t: CreateTemplate, human: boolean, items: (CreateItem | null)[], h: CombatHooks = {}): Created {
  unitBaseDefaults(u);
  if (!human) { u.vtbl = 0x5d0eb0; return monsterCreate(wd, u, t, items, h); }
  u.vtbl = 0x5d0f40;
  fn_0x5121e1(u);   // 0x512133 (vtable 0x5d0f40), depois 0x5d0fb8 em 0x5143e4
  u.vtbl = 0x5d0fb8;
  return humanCreate(wd, u, t, items, h);
}

/** O `CreateItem` de um item de items.json (o construtor do item não está portado: ver o cabeçalho). */
export interface ItemJsonLike {
  slotId?: number; attackType?: string | null; damage?: { min: number; max: number } | null; toHit?: number | null; defense?: number | null;
  absorption?: number | null; range?: number | null; charge?: number | null; relax?: number | null; twoHanded?: boolean; weight?: number;
  usableBy?: string[];
}
const ATTACK_TYPE: Record<string, number> = { blade: 1, axe: 2, bludgeon: 3, pike: 4, shooting: 5 };
export function itemFromJson(j: ItemJsonLike, spec: string): CreateItem {
  const slot = j.slotId ?? 0;
  const kind = slot === 1 ? "weapon" : slot === 2 ? "shield" : "armor";
  const dmg = new DmgRec(), def = new DefRec();
  if (kind === "weapon") {
    dmg.atk = s16(j.toHit ?? 0);
    dmg.dmin = (j.damage?.min ?? 0) & 0xff;
    dmg.dadd = ((j.damage?.max ?? 0) - (j.damage?.min ?? 0)) & 0xff;
  }
  def.def = s16(j.defense ?? 0); def.abs = s16(j.absorption ?? 0);
  const at = j.attackType ?? "";
  const cls = ATTACK_TYPE[at] ?? (/^special(\d+)$/.exec(at) ? Number(/^special(\d+)$/.exec(at)![1]) : 0);
  const u = j.usableBy ?? ["fighter", "mage"];
  return {
    kind, cls, charge: j.charge ?? -1, relax: j.relax ?? -1, twoHanded: j.twoHanded ? 2 : 0,
    suitable: (u.includes("fighter") ? 1 : 0) | (u.includes("mage") ? 2 : 0),
    weight: j.weight ?? 0, range: kind === "weapon" ? Math.max(1, j.range ?? 1) : slot, dmg, def, magic: parseItemMagic(spec),
  };
}
