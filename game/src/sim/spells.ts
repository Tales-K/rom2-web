/**
 * Magias: definição (`SpellDef`) montada a partir de `data/spells.json` (frente DADOS) + poder de quem lança.
 * Fontes: tabela Spells do data.bin (alcance, mana, dano, raio, durações, efeitos), fórmulas [UA] de docs/DATA.md
 * (dano × (poder/30 + 1), alcance + poder div 30, duração × 1,025^poder) e leitura estática do allods2.exe (notes/ai-behaviors.md):
 * Bless/Curse = chance (poder %) de dano máximo/mínimo [exe 0x516ceb]; ids das magias = índice 1-based da tabela (bits de knownSpells).
 * Sem PixiJS/DOM. O `World` executa as magias (world.ts `releaseSpell`).
 */

/** Como a magia age (a apresentação escolhe o efeito visual por `id`/`kind`). */
export type SpellKind =
  | "bolt"      // projétil teleguiado, dano único (Fire Arrow, Ice Missile, Lightning, Stone Missile)
  | "ball"      // projétil que explode em raio (Fireball)
  | "field"     // área persistente no chão com dano/efeito periódico (Wall of Fire, Poison Cloud, Blizzard, Light, Darkness)
  | "wall"      // parede que bloqueia a passagem por um tempo (Wall of Earth)
  | "cone"      // jato/leque a partir de quem lança (Acid Stream, Prismatic Spray)
  | "heal"      // cura (Heal)
  | "drain"     // projétil que tira vida e devolve a quem lançou (Drain Life)
  | "shield"    // efeito em quem lança/aliado (Shield) — mantido com esse nome por compatibilidade
  | "buff"      // efeito benéfico temporário (Protections, Bless, Haste, Invisibility)
  | "debuff"    // efeito maléfico temporário (Curse, Slow, Stone Curse)
  | "teleport"  // leva quem lança até o ponto (Teleport)
  | "control"   // toma o controle de um morto-vivo/espírito por um tempo (Animate Dead = "Control Spirit")
  | "summon";   // invoca uma criatura (Summon) — depende de `World.summonFactory`

/** Efeito temporário numa unidade. `amount` já escalado pelo poder. */
export type BuffKind =
  | "absorption" | "defense" | "attack" | "speed" | "sight"
  | "resist.fire" | "resist.water" | "resist.air" | "resist.earth" | "resist.astral"
  | "bless" | "curse" | "invisible" | "stone" | "poison" | "control";

export interface SpellEffect { kind: BuffKind; amount: number; }

export interface SpellDef {
  /** id da magia (1..29) em string; pergaminhos em uso usam `scroll:<item>` (a cena troca o id) */
  id: string;
  /** número da magia (1..29), preservado quando `id` é trocado (pergaminho): as regras do mundo (camadas, nuvens, "Spell on Unit") usam este */
  base?: number;
  name: string;
  /** custo de mana (0 = magia de item/arma) */
  mana: number;
  /** alcance em células (já com o bônus do poder) */
  range: number;
  kind: SpellKind | string;
  /** dano/cura mínimo e máximo já escalados pelo poder (Shield antigo: absorção) */
  min: number;
  max: number;
  /** escola: fire | water | air | earth | astral */
  element: string;
  /** nível da magia (experiência de suporte: int(nível × 0,5 + 0,5)) */
  level: number;
  /** duração dos efeitos em segundos (já × 1,025^poder) */
  duration: number;
  /** poder com que foi lançada (habilidade da escola + Mind − 30, ou o poder do item) */
  power?: number;
  /** raio (células) da área/explosão/jato */
  radius?: number;
  /** duração (s) e período (s) da área persistente */
  areaDuration?: number;
  areaFrequency?: number;
  /** efeitos aplicados (buff/debuff/field) */
  effects?: SpellEffect[];
  /** magia defensiva (lançada em aliados; a IA ofensiva não a escolhe) [exe 0x57a769: flag +0xa] */
  defensive?: boolean;
  /** alvo: unidade inimiga, unidade amiga, só quem lança ou ponto no chão */
  target?: "enemy" | "friend" | "self" | "point";
  /** velocidade do projétil (células/s) */
  speed?: number;
}

/** Entrada de spells.json (campos usados). */
export interface SpellJsonLike {
  id?: number; name?: string; school?: string; level?: number; manaCost?: number; range?: number;
  damage?: { min: number; max: number } | null; duration?: number; frequency?: number; radius?: number;
  areaDuration?: number; areaFrequency?: number; defensive?: boolean; effects?: string | null; castType?: string | null;
  effectSpeed?: number; [k: string]: unknown;
}
export type SpellTable = Record<string, SpellJsonLike>;

/** Tipo de cada magia por id (spells.json não traz o "Delivery System" decodificado). */
const KIND_BY_ID: Record<number, SpellKind> = {
  1: "bolt", 2: "ball", 3: "field", 4: "buff", 5: "bolt", 6: "field", 7: "field", 8: "buff", 9: "cone", 10: "bolt",
  11: "cone", 12: "buff", 13: "buff", 14: "field", 15: "field", 16: "bolt", 17: "wall", 18: "debuff", 19: "buff",
  20: "buff", 21: "buff", 22: "control", 23: "teleport", 24: "heal", 25: "summon", 26: "drain", 27: "shield", 28: "debuff", 29: "debuff",
};

export const SPELL = {
  FireArrow: 1, Fireball: 2, WallOfFire: 3, ProtFire: 4, IceMissile: 5, PoisonCloud: 6, Blizzard: 7, ProtWater: 8,
  AcidStream: 9, Lightning: 10, PrismaticSpray: 11, Invisibility: 12, ProtAir: 13, Darkness: 14, Light: 15,
  StoneMissile: 16, WallOfEarth: 17, StoneCurse: 18, ProtEarth: 19, Bless: 20, Haste: 21, AnimateDead: 22,
  Teleport: 23, Heal: 24, Summon: 25, DrainLife: 26, Shield: 27, Curse: 28, Slow: 29,
} as const;

/**
 * Camada de efeito no terreno de cada magia de área ("Spell on Tile", parâmetro "Spell layer" das missões 93-96) [est]: o script mede 0 = fogo/gelo
 * (Wall of Fire, Blizzard) na 93, 2 = névoa (Poison Cloud) na 95 e 3 = parede de pedra (Wall of Earth) na 94; Darkness/Light ficam na camada 1.
 * O jogo guarda uma magia por camada e por célula; as camadas reais não foram decifradas do exe.
 */
export function spellLayer(id: number): number {
  switch (id) {
    case SPELL.WallOfEarth: return 3;
    case SPELL.PoisonCloud: return 2;
    case SPELL.Darkness: case SPELL.Light: return 1;
    default: return 0;
  }
}

/** Esfera da magia como o exe a guarda (definição[2]; unidade+0xa8 + 2 × esfera): 1 fogo, 2 água, 3 ar, 4 terra, 5 astral. */
export const SPHERE_INDEX: Record<string, number> = { fire: 1, water: 2, air: 3, earth: 4, astral: 5 };

/** As 22 colunas da tabela Spells de data.bin (a definição que o exe lê por 0x41e7e0: `BookSpellRec.def`) a partir da linha de
 *  spells.json (tools/data/derive.py: alcance < 0 → null, dano < 0 → sem `damage`, a coluna "item" não exportada → 0). */
export function spellDefColumns(j: SpellJsonLike): number[] {
  const n = (v: unknown, d = 0) => (typeof v === "number" ? v | 0 : d);
  const dmg = j.damage;
  return [
    n(j.level), n(j.manaCost), SPHERE_INDEX[String(j.school ?? "").toLowerCase()] ?? 0, 0, n(j.target), n(j.delivery), j.range == null ? -1 : n(j.range),
    n(j.effectSpeed), n(j.distribution), n(j.radius), n(j.areaAffect), n(j.areaDuration), n(j.areaFrequency), n(j.applyMethod), n(j.duration),
    n(j.frequency), dmg ? n(dmg.min) : -1, dmg ? n(dmg.max) : -1, j.defensive ? 1 : 0, n(j.skillOffset), n(j.scrollCost), n(j.bookCost),
  ];
}

/** Escala do poder [UA]: k = poder/30 + 1. */
export function powerScale(power: number): number { return Math.max(0, power) / 30 + 1; }

/** Lê "speed=+2: duration 30", "absorbtion=+5:duration 8,defence=-20:duration 8", "protectionFire=+30" → efeitos. */
export function parseEffects(text: string | null | undefined): { stat: string; value: number }[] {
  if (!text) return [];
  const out: { stat: string; value: number }[] = [];
  for (const m of String(text).matchAll(/([A-Za-z]+)\s*=\s*([+-]?\d+)/g)) out.push({ stat: m[1]!.toLowerCase(), value: Number(m[2]) });
  return out;
}

const STAT_TO_BUFF: Record<string, BuffKind> = {
  absorbtion: "absorption", absorption: "absorption", defence: "defense", defense: "defense", tohit: "attack", speed: "speed",
  scanrange: "sight", protectionfire: "resist.fire", protectionwater: "resist.water", protectionair: "resist.air",
  protectionearth: "resist.earth", protectionastral: "resist.astral",
};

/**
 * Monta a magia `id` com o poder `power`. Alcance = range + poder div 30 (Teleport: + poder div 3) [UA];
 * dano/cura = int(min × k)..int(max × k), k = poder/30 + 1 [UA]; duração = 1,025^poder × duration [UA];
 * área: duração = areaDuration + poder × 0,1 [UA], período = areaFrequency (mín. 0,5 s).
 * Magnitude dos efeitos (+5 de absorção, +30 de proteção, ±2 de velocidade...) × k [est] — o exe guarda o valor do efeito e o
 * "poder" separado; a escala exata não foi decifrada (docs/GAPS.md).
 */
export function buildSpell(id: number, s: SpellJsonLike | undefined, power: number, opts: { free?: boolean } = {}): SpellDef {
  const p = Math.max(0, Math.round(power));
  const k = powerScale(p);
  const name = s?.name ?? `Spell ${id}`;
  const kind: SpellKind = KIND_BY_ID[id] ?? (s?.defensive ? "buff" : "bolt");
  const element = String(s?.school ?? "fire").toLowerCase();
  const dmg = s?.damage ?? (kind === "heal" ? { min: 8, max: 16 } : null);
  const baseRange = Number(s?.range ?? 6);
  const range = kind === "teleport" ? Math.max(1, baseRange) + Math.floor(p / 3)
    : kind === "shield" || kind === "summon" ? 0
    : baseRange + Math.floor(p / 30);
  const effects: SpellEffect[] = [];
  for (const e of parseEffects(s?.effects as string | undefined)) {
    const b = STAT_TO_BUFF[e.stat];
    if (!b) continue;
    let amount = e.value * k;
    if (b.startsWith("resist.")) amount = Math.min(100, amount);
    effects.push({ kind: b, amount: Math.round(amount * 100) / 100 });
  }
  // efeitos com regra própria (exe/UA)
  if (id === SPELL.Bless) effects.splice(0, effects.length, { kind: "bless", amount: Math.max(1, Math.min(100, p)) });
  if (id === SPELL.Curse) effects.splice(0, effects.length, { kind: "curse", amount: Math.max(1, Math.min(100, p)) });
  // Invisibility: quem tem "See invisible" × 10 ≥ poder ainda vê [est]
  if (id === SPELL.Invisibility) effects.push({ kind: "invisible", amount: Math.max(1, p) });
  if (id === SPELL.StoneCurse) effects.push({ kind: "stone", amount: 1 });
  if (id === SPELL.PoisonCloud) effects.splice(0, effects.length, { kind: "poison", amount: Math.round(2 * k * 100) / 100 });
  if (id === SPELL.Shield && !effects.length) effects.push({ kind: "absorption", amount: 5 * k });
  const shieldAmount = effects.find(e => e.kind === "absorption")?.amount ?? 5;
  const defensive = !!s?.defensive;
  const target: SpellDef["target"] =
    kind === "shield" || kind === "summon" ? "self"
    : kind === "teleport" || kind === "field" || kind === "wall" ? "point"
    : kind === "heal" || (kind === "buff" && defensive) ? "friend"
    : "enemy";
  const areaDur = Number(s?.areaDuration ?? 0);
  return {
    id: String(id), base: id, name, mana: opts.free ? 0 : Number(s?.manaCost ?? 5), range: Math.max(0, range), kind,
    min: kind === "shield" ? shieldAmount : dmg ? Math.floor(dmg.min * k) : 0,
    max: kind === "shield" ? shieldAmount : dmg ? Math.floor(dmg.max * k) : 0,
    element, level: Number(s?.level ?? 1),
    // teto de 10 h: o script lança Stone Curse com poder 32768 ("permanente", missão 96) e 1,025^32768 estoura para Infinity (não serializa no save)
    duration: Math.min(36000, Math.pow(1.025, p) * Number(s?.duration || (kind === "control" ? 30 : 10))),
    power: p,
    radius: Number(s?.radius ?? 0),
    areaDuration: areaDur > 0 ? areaDur + p * 0.1 : 0,
    areaFrequency: Math.max(0.5, Number(s?.areaFrequency || 1)),
    effects, defensive, target,
    speed: kind === "ball" ? 10 : id === SPELL.Lightning ? 20 : 12,
  };
}

/** Chave da magia nas regras do mundo (efeitos, áreas): o número real mesmo quando o id é `scroll:<item>`. */
export const spellKey = (s: SpellDef): string => String(s.base ?? s.id);

/** Magia usável como ataque (a IA ofensiva sorteia entre estas) [exe 0x57a769: magias conhecidas, mana suficiente, não defensivas]. */
export function isOffensive(s: SpellDef): boolean {
  if (s.defensive) return false;
  return s.kind === "bolt" || s.kind === "ball" || s.kind === "cone" || s.kind === "drain" || s.kind === "debuff" ||
    (s.kind === "field" && (s.max > 0 || !!s.effects?.some(e => e.kind === "poison" || e.kind === "sight" && e.amount < 0)));
}

/** Escola → chave de proteção. */
export function resistKey(element: string): BuffKind { return `resist.${element}` as BuffKind; }
