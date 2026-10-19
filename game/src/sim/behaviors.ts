/**
 * Liga os comportamentos automáticos e as magias a uma missão montada (mission/setup.ts `buildMission`).
 * Chamar UMA vez logo depois de `buildMission` e ANTES de aplicar um save (`restoreMission`), nas duas montagens (o snapshot
 * conta com as mesmas magias estáticas):
 *
 *   import { installMissionAi, applyAiSettings, cycleAutocast } from "../sim/behaviors";
 *   installMissionAi(built.world, { spells: data.spells, difficulty: hero.difficulty, heroSpellIds: hero.spells?.map(Number),
 *                                   settings: game.state.settings });
 *
 * O que faz: instala a tabela de magias; dá aos monstros/NPCs as magias conhecidas (template `spells`, poder = habilidade
 * mágica do template) e as magias de chance ("Spell N/Probability N", poder = "Spell Power"); remonta as magias do herói pelo id
 * (todas as 29 passam a funcionar); define a classe de IA (corpo a corpo / à distância / conjurador), Withdraw/Wimpy dos
 * templates (absolutos; fácil → Wimpy/2 [exe 0x561e93]) e, para o jogador humano, Retreat Mode/Formation/AutoCasting das opções.
 */
import { buildSpell, type SpellDef, type SpellTable } from "./spells";
import { skillFromExp } from "./stats";
import type { AiClass, Unit, World } from "./world";

export interface AiSettingsLike {
  formationMode?: "off" | "auto" | "on" | string;
  retreatMode?: "never" | "low" | "medium" | string;
  /** AutoCasting (bits do original; padrão 8|3 = nível 1, alvos próprios e aliados) */
  autocast?: number;
}

export interface MissionAiOptions {
  spells?: SpellTable;
  /** dificuldade do herói ("easy" divide o Wimpy dos monstros por 2) */
  difficulty?: string;
  /** magias conhecidas pelo herói (HeroState.spells): a barra antiga só montava algumas */
  heroSpellIds?: number[];
  settings?: AiSettingsLike;
  /** jogador humano (padrão: o do herói) */
  humanPlayer?: number;
  /** invocação (Summon): como criar a criatura (a cena tem templates/animações) */
  summonFactory?: World["summonFactory"];
}

const FORMATION: Record<string, number> = { off: 0, auto: 1, on: 2 };
const RETREAT: Record<string, number> = { never: 0, low: 1, medium: 2 };
/** Retreat Mode → % da vida [exe 0x4f67d5]: nunca 0, vida baixa 10, vida média 30. */
const RETREAT_PCT = [0, 10, 30];

/** Poder das magias de uma unidade que não é herói: habilidade da escola (magicSkills) + (Mind − 30, se positivo) [est/UA]. */
function npcPower(u: Unit, school: string): number {
  const sk = u.stats.magicSkills?.[school] ?? 0;
  return Math.max(0, sk + Math.max(0, (u.stats.mind ?? 30) - 30));
}

/** Poder do herói: habilidade da escola + Mind − 30 (mín. 0) [UA] (o mesmo de mission/setup.ts). */
function heroPower(u: Unit, school: string): number {
  const sx = u.heroInfo?.skillExp ?? {};
  return Math.max(0, skillFromExp(sx[school] ?? 0) + (u.stats.mind ?? 0) - 30);
}

function aiClassOf(u: Unit): AiClass {
  if (u.spells.length) return 2;
  if (Math.max(u.stats.range, u.weaponSpell?.range ?? 0) > 1 && !u.flying) return 1;
  return 0;
}

export function installMissionAi(world: World, opts: MissionAiOptions = {}): void {
  const table = opts.spells ?? world.spellTable;
  world.spellTable = table;
  if (opts.summonFactory) world.summonFactory = opts.summonFactory;
  const hero = world.units.find(u => u.isHero);
  world.humanPlayer = opts.humanPlayer ?? hero?.player ?? 1;
  for (const u of world.units) {
    if (u.isHero) {
      const ids = new Set<number>(u.spells.map(s => Number(s.id)));
      for (const id of opts.heroSpellIds ?? []) if (id > 0 && id <= 29) ids.add(id);
      if (table) {
        u.spells = [...ids].sort((a, b) => a - b).map(id => {
          const j = table[String(id)];
          return buildSpell(id, j, heroPower(u, String(j?.school ?? "").toLowerCase()));
        });
      }
    } else if (table) {
      const ids = u.stats.spellIds ?? [];
      if (ids.length) {
        u.spells = ids.map(id => { const j = table[String(id)]; return buildSpell(id, j, npcPower(u, String(j?.school ?? "").toLowerCase())); });
      }
      const procs = u.stats.procSpells ?? [];
      u.procSpells = procs.map(([id, chance]) => ({ spell: buildSpell(id, table[String(id)], u.stats.procPower ?? 0, { free: true }), chance }));
    }
    u.aiClass = aiClassOf(u);
    if (u.player !== world.humanPlayer) {
      // Withdraw/Wimpy do template = vida absoluta [exe 0x5114f3 → +0x1c4+0x40/+0x44]; fácil → Wimpy/2 [exe 0x561e93]
      u.withdrawHp = u.stats.withdraw ?? 0;
      u.wimpyHp = opts.difficulty === "easy" ? Math.floor((u.stats.wimpy ?? 0) / 2) : u.stats.wimpy ?? 0;
    }
  }
  applyAiSettings(world, opts.settings ?? {}, world.humanPlayer);
}

/**
 * Opções do jogo → IA do jogador humano (chamar também quando o jogador muda as opções no meio da missão):
 * Formation Mode (off/auto/on), Retreat Mode (never/low/medium) [exe 0x4f67d5: fuga com vida ≤ p% para todos; recuo de inimigos a
 * ≤ 2 células com vida ≤ 2p% (à distância) ou 3p% (conjuradores); corpo a corpo não recua], AutoCasting (bits).
 */
export function applyAiSettings(world: World, s: AiSettingsLike, player = world.humanPlayer): void {
  const pa = world.playerAi[player];
  if (!pa) return;
  if (s.formationMode !== undefined) pa.formation = FORMATION[s.formationMode] ?? 1;
  if (s.retreatMode !== undefined) pa.retreat = RETREAT[s.retreatMode] ?? 0;
  if (s.autocast !== undefined) pa.autocast = s.autocast;
  const p = RETREAT_PCT[pa.retreat] ?? 0;
  for (const u of world.units) {
    if (u.player !== player) continue;
    u.wimpyHp = Math.floor(u.maxHp * p / 100);
    u.withdrawHp = Math.floor(u.maxHp * (u.aiClass === 2 ? 3 * p : u.aiClass === 1 ? 2 * p : 0) / 100);
  }
}

/** CTRL+U: cicla o nível do AutoCasting 1 → 2 → 3 → 1 (bits 8 → 0x18 → 0x38) [exe 0x41a54a]. Devolve o nível (1..3). */
export function cycleAutocast(world: World, player = world.humanPlayer): number {
  const pa = world.playerAi[player];
  if (!pa) return 0;
  const lvl = pa.autocast & 0x38;
  const next = lvl === 8 ? 0x18 : lvl === 0x18 ? 0x38 : 8;
  pa.autocast = (pa.autocast & 7) | next;
  return autocastLevel(world, player);
}

/** Desliga/liga o AutoCasting (sem mexer nos bits de alvo). */
export function setAutocastLevel(world: World, level: 0 | 1 | 2 | 3, player = world.humanPlayer): void {
  const pa = world.playerAi[player];
  if (!pa) return;
  pa.autocast = (pa.autocast & 7) | [0, 8, 0x18, 0x38][level]!;
}

export function autocastLevel(world: World, player = world.humanPlayer): number {
  const v = (world.playerAi[player]?.autocast ?? 0) & 0x38;
  return v === 0x38 ? 3 : v === 0x18 ? 2 : v === 8 ? 1 : 0;
}

/**
 * Põe `units` (mercenários/aliados do jogador) para seguir e defender `leader` em formação (slot = ordem da lista).
 * O comportamento: segue (em formação se Formation Mode permitir), ataca quem ataca o líder ou chega perto dele, autocast,
 * recua pela Retreat Mode.
 */
export function attachFollowers(world: World, leader: Unit, units: Unit[], range = 4): void {
  units.forEach((u, i) => {
    u.ai = { type: "defend", unit: leader.id, range };
    u.formationSlot = i;
    u.suspended = false;
    world.command(u, { type: "none" });
  });
}

/** Magia (do herói ou de quem for) pelo id. */
export function spellOf(u: Unit, id: number | string): SpellDef | undefined { return u.spells.find(s => s.id === String(id)); }
