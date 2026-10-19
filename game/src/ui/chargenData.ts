import type { ElementSkill, HeroClass, HeroState, Sex, WeaponSkill } from "../core/state";

/**
 * Dados e regras do criador de personagem. Lê public/data/classes.json (frente DADOS); sem o arquivo usa o padrão provisório
 * (valores iniciais dos 4 heróis de data.bin, copiados aqui). Fórmulas das estatísticas derivadas: docs/DATA.md (seção DADOS).
 */

export type Attr = "body" | "reaction" | "mind" | "spirit";
export const ATTRS: Attr[] = ["body", "reaction", "mind", "spirit"];
export type ClassId = "male_fighter" | "female_fighter" | "male_mage" | "female_mage";

export interface Derived {
  health: number; mana: number; speed: number; sight: number; attack: number;
  damage: { min: number; max: number }; defense: number; absorption: number;
  resist: { fire: number; water: number; air: number; earth: number; astral: number };
}

export interface ClassDef {
  id: ClassId;
  label: string;
  mage: boolean;
  female: boolean;
  face: number;
  attributes: Record<Attr, number>;
  attributeMax: Record<Attr, number>;
  attributeMin: Record<Attr, number>;
  freePoints: number;
  skills: Record<string, number>;
  alignment: { options: string[]; default: string; bonusSkill: number };
  startItems: Array<{ id: number; name?: string }>;
  startSpells: number[];
  derived: Derived;
}

interface ClassesFile { classes: Record<string, Partial<ClassDef>>; skillExpTable?: number[]; }

const WEAPONS = ["blade", "axe", "bludgeon", "pike", "shooting"];
const SPHERES = ["fire", "water", "air", "earth", "astral"];

function prov(id: ClassId, label: string, mage: boolean, female: boolean, face: number, a: number[], max: number[], d: Partial<Derived>): ClassDef {
  const mk = (v: number[]): Record<Attr, number> => ({ body: v[0], reaction: v[1], mind: v[2], spirit: v[3] });
  return {
    id, label, mage, female, face, attributes: mk(a), attributeMax: mk(max), attributeMin: mk(a.map(v => Math.max(1, v - 15))), freePoints: 0,
    skills: Object.fromEntries((mage ? SPHERES : WEAPONS).map((k, i) => [k, i === 0 ? 20 : 0])),
    alignment: { options: mage ? SPHERES : WEAPONS, default: mage ? "fire" : "blade", bonusSkill: 20 },
    startItems: [], startSpells: [],
    derived: { health: 100, mana: 0, speed: 19, sight: 6, attack: 55, damage: { min: 10, max: 20 }, defense: 70, absorption: 4, resist: { fire: 8, water: 8, air: 8, earth: 8, astral: 8 }, ...d },
  };
}

/** Padrão provisório (só até existir classes.json). */
const FALLBACK: Record<ClassId, ClassDef> = {
  male_fighter: prov("male_fighter", "Male Warrior", false, false, 32, [40, 36, 25, 17], [52, 50, 48, 46], { health: 133 }),
  female_fighter: prov("female_fighter", "Female Warrior", false, true, 11, [37, 39, 21, 25], [50, 52, 46, 48], { health: 115 }),
  male_mage: prov("male_mage", "Male Mage", true, false, 15, [28, 20, 41, 32], [48, 46, 52, 50], { health: 41, mana: 92, speed: 16, attack: 5, damage: { min: 1, max: 2 }, defense: 14, absorption: 0, resist: { fire: 16, water: 16, air: 16, earth: 16, astral: 16 } }),
  female_mage: prov("female_mage", "Female Mage", true, true, 6, [19, 23, 30, 42], [46, 48, 50, 52], { health: 30, mana: 105, speed: 16, attack: 5, damage: { min: 1, max: 2 }, defense: 14, absorption: 0, resist: { fire: 21, water: 21, air: 21, earth: 21, astral: 21 } }),
};

export interface ChargenData { classes: Record<ClassId, ClassDef>; skillExp: number[]; fromFile: boolean; }

export async function loadChargenData(load: <T>(p: string) => Promise<T | undefined>): Promise<ChargenData> {
  const f = await load<ClassesFile>("data/classes.json");
  const out = {} as Record<ClassId, ClassDef>;
  for (const id of Object.keys(FALLBACK) as ClassId[]) {
    const fb = FALLBACK[id], c = f?.classes?.[id];
    out[id] = c ? { ...fb, ...c, id, attributes: { ...fb.attributes, ...c.attributes }, attributeMax: { ...fb.attributeMax, ...c.attributeMax },
      attributeMin: { ...fb.attributeMin, ...c.attributeMin }, derived: { ...fb.derived, ...c.derived } } as ClassDef : fb;
  }
  return { classes: out, skillExp: f?.skillExpTable ?? [], fromFile: !!f?.classes };
}

// ------------------------------------------------------------------ estado em edição

export interface Draft {
  cls: ClassId;
  attrs: Record<Attr, number>;
  pool: number;
  align: string;
}

export function newDraft(c: ClassDef): Draft {
  return { cls: c.id, attrs: { ...c.attributes }, pool: c.freePoints, align: c.alignment.default };
}

export function canDec(c: ClassDef, d: Draft, a: Attr): boolean { return d.attrs[a] > c.attributeMin[a]; }
export function canInc(c: ClassDef, d: Draft, a: Attr): boolean { return d.pool > 0 && d.attrs[a] < c.attributeMax[a]; }
export function dec(c: ClassDef, d: Draft, a: Attr): boolean { if (!canDec(c, d, a)) return false; d.attrs[a]--; d.pool++; return true; }
export function inc(c: ClassDef, d: Draft, a: Attr): boolean { if (!canInc(c, d, a)) return false; d.attrs[a]++; d.pool--; return true; }

// ------------------------------------------------------------------ estatísticas derivadas (exibição)

const log11 = (x: number): number => Math.log(x) / Math.log(1.1);

/** Fórmulas de vida/mana/velocidade/ataque... (DATA.md); o resultado é ancorado nos valores `derived` da classe (que já embutem itens). */
export function derive(c: ClassDef, d: Draft, skillExp: number[]): Derived & { skills: Record<string, number> } {
  const skillsBase = c.skills;
  const skills: Record<string, number> = Object.fromEntries(Object.keys(skillsBase).map(k => [k, k === d.align ? c.alignment.bonusSkill : 0]));
  const a0 = c.attributes, a = d.attrs;
  const exp = skillExp[c.alignment.bonusSkill] ?? 5727;
  const f = c.mage ? 1 : 2, m = c.mage ? 2 : 1;
  const hp = (body: number) => Math.floor((Math.pow(1.1, body) / 100 + 1) * (Math.floor(body * f) + Math.floor(log11(exp / 5000 + f))));
  const mp = (sp: number) => c.mage ? Math.floor((Math.pow(1.1, sp) / 100 + 1) * (Math.floor(sp * m) + Math.floor(log11(exp / 5000 + m)))) : 0;
  const speed = (r: number) => (r < 10 ? r : Math.min(255, Math.floor(r / 5) + 12));
  const sk0 = c.skills[c.alignment.default] ?? 20;
  const sk = c.alignment.bonusSkill;
  const atk = (r: number, s: number) => Math.floor(Math.pow(1 + r / 100 + s / 100, 9));
  const sight = (r: number, mi: number) => 4 + Math.pow(1 + r / 100, mi / 10);
  const dmg = (body: number) => 1 + Math.floor(sk / 20) * body / 100;
  const dmg0 = 1 + Math.floor(sk0 / 20) * a0.body / 100;
  const k = dmg(a.body) / dmg0;
  const D = c.derived;
  return {
    health: Math.max(1, D.health + hp(a.body) - hp(a0.body)),
    mana: c.mage ? Math.max(0, D.mana + mp(a.spirit) - mp(a0.spirit)) : 0,
    speed: D.speed + speed(a.reaction) - speed(a0.reaction),
    sight: Math.round((D.sight + sight(a.reaction, a.mind) - sight(a0.reaction, a0.mind)) * 100) / 100,
    attack: Math.max(0, D.attack + atk(a.reaction, sk) - atk(a0.reaction, sk0)),
    damage: { min: Math.max(1, Math.round(D.damage.min * k)), max: Math.max(1, Math.round(D.damage.max * k)) },
    defense: Math.round(D.defense * Math.floor(a.reaction / 15) / Math.max(1, Math.floor(a0.reaction / 15))),
    absorption: D.absorption,
    resist: Object.fromEntries(Object.entries(D.resist).map(([e, v]) => [e, Math.max(0, v + Math.floor(a.spirit / 2) - Math.floor(a0.spirit / 2))])) as Derived["resist"],
    skills,
  };
}

// ------------------------------------------------------------------ montagem do HeroState

interface ItemInfo { slot?: string; kind?: string }

export function buildHero(c: ClassDef, d: Draft, name: string, difficulty: HeroState["difficulty"], items?: Record<string, ItemInfo>): HeroState {
  const sex: Sex = c.female ? "female" : "male";
  const heroClass: HeroClass = c.mage ? "mage" : "fighter";
  const inventory: HeroState["inventory"] = [];
  const equipment: HeroState["equipment"] = {};
  for (const it of c.startItems) {
    const id = String(it.id);
    const slot = items?.[id]?.slot;
    if (slot && slot !== "none" && !equipment[slot]) equipment[slot] = id; else inventory.push({ id });
  }
  const hero: HeroState = {
    name, sex, heroClass, face: c.face,
    stats: { body: d.attrs.body, mind: d.attrs.mind, agility: d.attrs.reaction, spirit: d.attrs.spirit },
    gold: 1000, inventory, equipment, spells: c.startSpells.map(String), difficulty,
  };
  if (c.mage) hero.elementSkill = d.align as ElementSkill; else hero.weaponSkill = d.align as WeaponSkill;
  return hero;
}
