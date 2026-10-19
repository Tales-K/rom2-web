/**
 * Atributos das unidades.
 * Fontes (frente DADOS, docs/DATA.md): `map-unit-templates.json` (template exato de cada unidade do mapa) → `unit-templates.json`;
 * senão `unit-stats.json` (template de nível 1 do tipo); senão a tabela PROVISÓRIA abaixo.
 * Herói: fórmulas [UA] de docs/DATA.md (UnityAllods) a partir dos atributos e do equipamento (items.json).
 */
import type { UnitStats } from "./types";

const R0 = { fire: 0, water: 0, air: 0, earth: 0, astral: 0 };

function s(name: string, health: number, dmin: number, dmax: number, attack: number, defense: number, absorption: number,
           speed: number, sight: number, range: number, exp: number, extra: Partial<UnitStats> = {}): UnitStats {
  return { name, health, mana: 0, speed, sight, attack, damage: { min: dmin, max: dmax }, defense, absorption, range,
    attackSkill: range > 1 ? "shooting" : "blade", resist: { ...R0 }, exp, healthRegen: 50, charge: 8, relax: 5, source: "provisional", ...extra };
}

/** Tabela provisória (só usada se os JSON da frente DADOS faltarem). Velocidade em células/s. */
export const PROVISIONAL: Record<string, UnitStats> = {
  "24": s("Human Mage", 400, 25, 45, 60, 40, 6, 1.5, 9, 6, 800, { mana: 300, attackSkill: "fire" }),
  "66": s("Ogre (Lord)", 200, 20, 40, 80, 70, 5, 0.9, 5, 1, 1200),
  "68": s("Fat troll", 300, 15, 30, 60, 100, 10, 0.5, 4, 1, 1800),
  "70": s("Sonic Bat", 61, 4, 16, 320, 255, 5, 2.2, 8, 4, 13023, { flying: true }),
  "71": s("Dragon", 1024, 41, 61, 370, 270, 18, 1.7, 12, 8, 781397, { flying: true, attackSkill: "fire" }),
  "74": s("Squirrel", 20, 3, 6, 40, 0, 0, 1.5, 8, 1, 36),
  "75": s("Snake", 30, 1, 5, 0, 30, 0, 1.1, 4, 1, 24),
  "76": s("Turtle", 60, 1, 12, 30, 80, 4, 0.5, 5, 1, 96),
};

export function genericStats(name: string): UnitStats { return s(name, 60, 3, 8, 40, 40, 2, 1.0, 6, 1, 50); }

/** Entrada de unit-stats.json / unit-templates.json (campos usados). */
export interface TemplateJson {
  name?: string; health?: number; mana?: number; speed?: number; speedCellsPerSec?: number; sight?: number; attack?: number;
  damage?: { min: number; max: number }; defense?: number; absorption?: number; range?: number; attackSkill?: string;
  resist?: Partial<Record<string, number>>; resistPhysical?: Record<string, number>; exp?: number; healthRegen?: number; manaRegen?: number;
  charge?: number; relax?: number; flying?: boolean | null; movementType?: number | null;
  treasure?: { goldChance: number; goldMin: number; goldMax: number } | null; source?: string; [k: string]: unknown;
}
export type StatsTable = Record<string, TemplateJson>;

/** células/s a partir da velocidade bruta do jogo (speed/16, docs/DATA.md). */
export function cellsPerSec(t: TemplateJson): number {
  if (t.speedCellsPerSec && t.speedCellsPerSec > 0) return t.speedCellsPerSec;
  if (t.speed && t.speed > 0) return t.speed / 16;
  return 1;
}

export function fromTemplate(t: TemplateJson, fallback: UnitStats, flyingHint: boolean): UnitStats {
  const dmg = t.damage && Number.isFinite(t.damage.min) ? { min: t.damage.min, max: Math.max(t.damage.min, t.damage.max) } : fallback.damage;
  return {
    ...fallback,
    name: t.name ?? fallback.name,
    health: Math.max(1, t.health ?? fallback.health),
    mana: Math.max(0, t.mana ?? fallback.mana),
    speed: Math.max(0.2, cellsPerSec(t)),
    sight: Math.max(2, Math.min(16, t.sight ?? fallback.sight)),
    attack: t.attack ?? fallback.attack,
    damage: dmg,
    defense: t.defense ?? fallback.defense,
    absorption: t.absorption ?? fallback.absorption,
    range: Math.max(1, t.range ?? fallback.range),
    attackSkill: t.attackSkill ?? fallback.attackSkill,
    attackType: ["blade", "axe", "bludgeon", "pike", "shooting"].includes(t.attackSkill ?? "") ? t.attackSkill : undefined,
    resist: { ...R0, ...(t.resist as Record<string, number> | undefined ?? {}) },
    resistPhysical: t.resistPhysical,
    exp: t.exp ?? fallback.exp,
    healthRegen: t.healthRegen ?? fallback.healthRegen,
    manaRegen: t.manaRegen ?? 0,
    alwaysHit: !!t.alwaysHit,
    charge: t.charge ?? fallback.charge,
    relax: t.relax ?? fallback.relax,
    flying: t.flying ?? (t.movementType === 3 ? true : undefined) ?? fallback.flying ?? flyingHint,
    treasure: t.treasure ?? undefined,
    source: t.source ?? "data",
    mind: (t.attributes as { mind?: number } | undefined)?.mind ?? fallback.mind,
    ...templateAi(t),
  };
}

/** Campos de IA/magia do template (unit-templates.json): magias conhecidas, magias por chance, poder, Withdraw/Wimpy. */
function templateAi(t: TemplateJson): Partial<UnitStats> {
  const out: Partial<UnitStats> = {};
  const sp = Array.isArray(t.spells) ? (t.spells as unknown[]).map(Number).filter(n => n > 0) : [];
  if (sp.length) out.spellIds = sp;
  const pr = Array.isArray(t.spellProbabilities) ? (t.spellProbabilities as unknown[][]).map(a => [Number(a[0]), Number(a[1])] as [number, number]).filter(a => a[0] > 0 && a[1] > 0) : [];
  if (pr.length) { out.procSpells = pr; out.procPower = Math.max(0, Number(t.spellPower ?? 0)); }
  const ms = (t.magicSkills ?? (t.mage ? t.skills : undefined)) as Record<string, number> | undefined;
  if (ms && Object.values(ms).some(v => v > 0)) out.magicSkills = { ...ms };
  if (typeof t.withdraw === "number" && t.withdraw > 0) out.withdraw = t.withdraw;
  if (typeof t.wimpy === "number" && t.wimpy > 0) out.wimpy = t.wimpy;
  if (typeof t.seeInvisible === "number" && t.seeInvisible > 0) out.seeInvisible = t.seeInvisible;
  if (typeof t.level === "number") out.level = t.level;
  return out;
}

export function statsFor(kind: number, unitName: string, template: TemplateJson | undefined, byType: StatsTable | undefined, flyingHint: boolean): UnitStats {
  const prov = PROVISIONAL[String(kind)] ?? genericStats(unitName);
  const t = template ?? byType?.[String(kind)];
  if (!t || !t.health) return { ...prov, flying: prov.flying ?? flyingHint };
  return fromTemplate(t, prov, flyingHint);
}

// ------------------------------------------------------------------------------------------------ herói

export interface HeroAttrs { body: number; reaction: number; mind: number; spirit: number; }
export interface HeroItem {
  slot?: string; damage?: { min: number; max: number }; toHit?: number; defense?: number; absorption?: number; attackType?: string;
  range?: number; charge?: number; relax?: number; casterWeapon?: boolean; weight?: number; effects?: Record<string, number> | null;
  /** modificadores mágicos do item equipado (classes.json startItems[].mods): castSpell, spellPower, defence... */
  mods?: Record<string, number>;
}

/**
 * Habilidades iniciais do herói [exe 0x514f59, chamado na criação do personagem com bônus 20]: zera as 5 habilidades da classe,
 * põe 20 na do alinhamento e **bônus/2 = 10 na 5ª** (Shooting para guerreiros, Astral para magos) — por isso o Aldor padrão do
 * original mostra Shooting 10, XP 7320 (= exp(20) + exp(10)) e Health 142 (com só Blade 20 sairia 139). Se o alinhamento for a
 * própria 5ª habilidade, a escrita do 10 vem depois e prevalece (leitura literal do código).
 */
export function heroStartSkills(mage: boolean, alignment: string, bonus = 20): Record<string, number> {
  const list = mage ? MAGE_SKILLS : WEAPON_SKILLS;
  const out: Record<string, number> = {};
  for (const s of list) out[s] = 0;
  out[(list as readonly string[]).includes(alignment) ? alignment : list[0]!] = bonus;
  out[list[4]!] = Math.floor(bonus / 2);
  return out;
}

/** Experiência inicial por habilidade (exp(v) de `heroStartSkills`). */
export function heroStartSkillExp(mage: boolean, alignment: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(heroStartSkills(mage, alignment))) if (v > 0) out[k] = skillExp(v);
  return out;
}

export const WEAPON_SKILLS = ["blade", "axe", "bludgeon", "pike", "shooting"] as const;
export const MAGE_SKILLS = ["fire", "water", "air", "earth", "astral"] as const;
/** Limites de atributo (Body/Reaction/Mind/Spirit) por (mago, mulher) [exe 0x5136a5]. */
const HERO_CAPS: Record<string, number[]> = { "ff": [52, 50, 48, 46], "fF": [50, 52, 46, 48], "mf": [48, 46, 52, 50], "mF": [46, 48, 50, 52] };

/** exp(v) = int((1,1^v − 1) × 1000) [exe 0x512824] */
export function skillExp(v: number): number { return v > 0 ? Math.floor((Math.pow(1.1, v) - 1) * 1000) : 0; }
/** maior v (≤ 100) com exp(v) ≤ exp */
export function skillFromExp(exp: number): number { let v = 0; while (v < 100 && skillExp(v + 1) <= exp) v++; return v; }

/**
 * Atributos derivados de herói/humano = allods2.exe @0x51366b (porte de tools/data/derive.py `human_stats`, docs/DATA.md [exe]):
 * vida = int((1,1^Body/100 + 1) × int(Body×f + log1,1(expTotal/5000 + 1)×f)) + itens (f = 2 guerreiro / 1 mago);
 * mana (mago) = int((1,1^Spirit/100 + 1) × int(Spirit×2 + log1,1(expTotal/5000 + 1)×2)) + itens;
 * toHit = int((1,1^Body + 1,1^Reaction)/5) + 3×skill + itens; dano: b = int(1,1^Body/20), min = b + skill div 5 + minArma,
 * max = min + b + (maxArma − minArma); defesa = Reaction div 3 + itens; velocidade = Reaction<12 ? Reaction : Reaction div 5 + 12,
 * menos a sobrecarga (peso/2 ≥ Body×10+1); visão = (Mind+Reaction)/25 + 4; proteções = Spirit div 2 + itens, em [0, min(100, 70+Spirit div 2)].
 */
export function heroDerived(name: string, mage: boolean, female: boolean, base: HeroAttrs, skills: Record<string, number>,
                            expTotal: number, items: HeroItem[]): UnitStats & { skillValue: number } {
  const it: Record<string, number> = {};
  let weight = 0;
  let weapon: HeroItem | undefined;
  for (const x of items) {
    weight += x.weight ?? 0;
    it.defense = (it.defense ?? 0) + (x.defense ?? 0);
    it.absorption = (it.absorption ?? 0) + (x.absorption ?? 0);
    it.toHit = (it.toHit ?? 0) + (x.toHit ?? 0);
    if (x.slot === "weapon") weapon = x;
    for (const [k, v] of Object.entries(x.effects ?? {})) it[k] = (it[k] ?? 0) + v;
    for (const [k0, v] of Object.entries(x.mods ?? {})) {
      if (k0 === "castSpell" || k0 === "spellPower") continue;
      const k = k0 === "defence" ? "defense" : k0 === "absorbtion" ? "absorption" : k0;
      it[k] = (it[k] ?? 0) + v;
    }
  }
  const caps = HERO_CAPS[(mage ? "m" : "f") + (female ? "F" : "f")]!;
  const b0 = [base.body, base.reaction, base.mind, base.spirit].map((v, i) => Math.min(caps[i]!, v));
  const body = b0[0]! + (it.body ?? 0), reaction = b0[1]! + (it.reaction ?? 0), mind = b0[2]! + (it.mind ?? 0), spirit = b0[3]! + (it.spirit ?? 0);
  const fighter = !mage;
  const wtype = fighter && weapon?.attackType && (WEAPON_SKILLS as readonly string[]).includes(weapon.attackType) ? weapon.attackType : "";
  const fskill = wtype ? Math.min(100, (skills[wtype] ?? 0) + (it["skill" + wtype.charAt(0).toUpperCase() + wtype.slice(1)] ?? 0)) : 0;
  const f = fighter ? 2 : 1;
  const log11 = (x: number) => Math.log(x) / Math.log(1.1);
  const p11 = (x: number) => Math.pow(1.1, x);
  let hp = Math.floor(body * f + log11(expTotal / 5000 + 1) * f);
  hp = Math.floor((p11(body) / 100 + 1) * hp) + (it.healthMax ?? 0);
  let mp = 0;
  if (mage) {
    mp = Math.floor(spirit * 2 + log11(expTotal / 5000 + 1) * 2);
    mp = Math.floor((p11(spirit) / 100 + 1) * mp) + (it.manaMax ?? 0);
  }
  const sight = (mind + reaction) / 25 + 4 + (it.scanRange ?? 0);
  const capacity = body * 10 + 1;
  let speed = reaction < 12 ? reaction : Math.floor(reaction / 5) + 12;
  const load = Math.floor(weight / 2);
  if (load >= capacity) speed = Math.max(6, speed - Math.floor(load / capacity));
  speed += it.speed ?? 0;
  const dbase = Math.floor(p11(body) / 20);
  let dmin = dbase + (wtype ? Math.floor(fskill / 5) : 0);
  let ddelta = dbase;
  const toHit = Math.floor((p11(body) + p11(reaction)) / 5) + (wtype ? 3 * fskill : 0) + (it.toHit ?? 0);
  if (weapon?.damage && !weapon.casterWeapon) { dmin += weapon.damage.min; ddelta += weapon.damage.max - weapon.damage.min; }
  dmin += it.damageMin ?? 0;
  const defense = Math.floor(reaction / 3) + (it.defense ?? 0);
  const pmax = Math.min(100, 70 + Math.floor(spirit / 2));
  const prot = (el: string) => Math.max(0, Math.min(pmax, Math.floor(spirit / 2) + (it["protection" + el.charAt(0).toUpperCase() + el.slice(1)] ?? 0)));
  return {
    name, health: Math.max(1, hp), mana: mp, speed: speed / 16, sight, attack: toHit, damage: { min: dmin, max: dmin + ddelta },
    defense, absorption: it.absorption ?? 0, range: weapon?.range && weapon.range > 1 ? weapon.range : 1,
    attackSkill: wtype || (mage ? "bludgeon" : "none"), attackType: wtype || undefined,
    resist: { fire: prot("fire"), water: prot("water"), air: prot("air"), earth: prot("earth"), astral: prot("astral") },
    exp: 0, healthRegen: 100, manaRegen: mage ? 50 : 0, charge: weapon?.charge ?? 8, relax: weapon?.relax ?? 4, mind, source: "hero",
    skillValue: fskill,
  };
}
