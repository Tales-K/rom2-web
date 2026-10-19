/**
 * Formato dos saves (versão 2), valores padrão e migração/validação. Sem DOM: usado por core/state.ts, core/save.ts e pelos testes.
 *
 * Versões:
 *   1  `allods2web.save.v1` (slot único): { version: 1, hero, progress, settings }
 *   2  slots nomeados (core/save.ts): { version: 2, hero, progress, settings, location, mission? }
 *      `progress.campaign` (opcional; campaign/types.ts:CampaignState) = estado da campanha. Saves sem ele (modelo antigo:
 *      availableMissions/completedMissions/flags `accepted_<id>`) são migrados por campaign/progress.ts:ensureCampaign.
 * `migrateSaveData` aceita qualquer versão conhecida (ou JSON estranho/corrompido) e devolve um SaveData v2 válido, ou `null`.
 */
import type { HeroState, Progress, Settings } from "./state";
import type { MissionSnapshot } from "../sim/snapshot";
import { sanitizeCampaign } from "../campaign/engine";

export const SAVE_VERSION = 2;

/** Onde o jogo continua ao carregar. */
export interface SaveLocation {
  scene: "town" | "mission";
  /** cidade (progress.town no momento do save) */
  town: string;
  /** id da missão quando scene === "mission" */
  mission?: number;
}

/** Save no meio da missão: snapshot da simulação + script + estado mínimo da cena (sim/snapshot.ts). */
export type MissionSave = MissionSnapshot;

export interface SaveData {
  version: typeof SAVE_VERSION;
  hero?: HeroState;
  progress: Progress;
  /** cópia das opções no momento do save (as opções valem para o jogo todo: ver GameState.settings) */
  settings?: Settings;
  location: SaveLocation;
  mission?: MissionSave;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  musicVolume: 0.6, sfxVolume: 0.8, speechVolume: 0.9,
  gameSpeed: 1.5, smoothing: true, dayNight: true, showHealth: true, formationMode: "auto", retreatMode: "never",
  acknowledgments: true, shadows: true, dynamicLighting: true, objectAnimations: true, damagePoints: true, altColors: true,
  autoCastOwn: true, autoCastAllies: true, autoCastNeutral: true, autoCastMode: "avg",
} satisfies Settings);

export function defaultSettings(): Settings { return { ...DEFAULT_SETTINGS }; }

export function defaultProgress(): Progress {
  return { town: "plagat", completedMissions: [], availableMissions: [10], flags: {} };
}

// ------------------------------------------------------------------ validação
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const numList = (v: unknown, d: number[]): number[] => (Array.isArray(v) ? v.filter(x => typeof x === "number" && Number.isFinite(x)) : d);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function sanitizeSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const d = DEFAULT_SETTINGS;
  const bool = (x: unknown, def: boolean) => (typeof x === "boolean" ? x : def);
  return {
    musicVolume: clamp01(num(s.musicVolume, d.musicVolume)),
    sfxVolume: clamp01(num(s.sfxVolume, d.sfxVolume)),
    speechVolume: clamp01(num(s.speechVolume, d.speechVolume)),
    gameSpeed: Math.max(0.25, Math.min(4, num(s.gameSpeed, d.gameSpeed))),
    smoothing: bool(s.smoothing, d.smoothing),
    dayNight: bool(s.dayNight, d.dayNight),
    showHealth: bool(s.showHealth, d.showHealth),
    formationMode: oneOf(s.formationMode, ["off", "auto", "on"] as const, d.formationMode),
    retreatMode: oneOf(s.retreatMode, ["never", "low", "medium"] as const, d.retreatMode),
    acknowledgments: bool(s.acknowledgments, true),
    shadows: bool(s.shadows, true), dynamicLighting: bool(s.dynamicLighting, true), objectAnimations: bool(s.objectAnimations, true),
    damagePoints: bool(s.damagePoints, true), altColors: bool(s.altColors, true),
    autoCastOwn: bool(s.autoCastOwn, true), autoCastAllies: bool(s.autoCastAllies, true), autoCastNeutral: bool(s.autoCastNeutral, true),
    autoCastMode: oneOf(s.autoCastMode, ["min", "avg", "max"] as const, "avg"),
  };
}

export function sanitizeProgress(v: unknown): Progress {
  const p = isObj(v) ? v : {};
  const d = defaultProgress();
  const flags: Record<string, number> = {};
  if (isObj(p.flags)) for (const [k, x] of Object.entries(p.flags)) if (typeof x === "number" && Number.isFinite(x)) flags[k] = x;
  const out: Progress = {
    ...p as Partial<Progress>,                        // campos extras de outras frentes passam adiante
    town: str(p.town, d.town) || d.town,
    completedMissions: numList(p.completedMissions, d.completedMissions),
    availableMissions: numList(p.availableMissions, d.availableMissions),
    flags,
  };
  // estado da campanha (campaign/types.ts); inválido = descartado e reconstruído a partir dos campos antigos (campaign/progress.ts)
  const camp = sanitizeCampaign(p.campaign);
  if (camp) out.campaign = camp; else delete out.campaign;
  return out;
}

/** Herói válido ou `undefined` (save sem herói = "sem jogo"). Campos extras (exp, skillExp, ...) são preservados. */
export function sanitizeHero(v: unknown): HeroState | undefined {
  if (!isObj(v) || typeof v.name !== "string") return undefined;
  const st = isObj(v.stats) ? v.stats : {};
  const inv = Array.isArray(v.inventory)
    ? v.inventory.filter(isObj).filter(i => typeof i.id === "string" || typeof i.id === "number")
      .map(i => ({ ...i, id: String(i.id), ...(typeof i.count === "number" ? { count: i.count } : {}) }))
    : [];
  const eq: Record<string, string | undefined> = {};
  if (isObj(v.equipment)) for (const [k, x] of Object.entries(v.equipment)) if (typeof x === "string" || typeof x === "number") eq[k] = String(x);
  const h: HeroState = {
    ...(v as Partial<HeroState>),
    name: v.name,
    sex: oneOf(v.sex, ["male", "female"] as const, "male"),
    heroClass: oneOf(v.heroClass, ["fighter", "mage"] as const, "fighter"),
    face: num(v.face, 0),
    stats: { body: num(st.body, 0), mind: num(st.mind, 0), agility: num(st.agility, 0), spirit: num(st.spirit, 0) },
    gold: Math.max(0, num(v.gold, 0)),
    inventory: inv,
    equipment: eq,
    spells: Array.isArray(v.spells) ? v.spells.filter(s => typeof s === "string" || typeof s === "number").map(String) : [],
    difficulty: oneOf(v.difficulty, ["easy", "normal", "hard"] as const, "normal"),
  };
  if (v.exp !== undefined) h.exp = num(v.exp, 0);
  if (v.level !== undefined) h.level = num(v.level, 1);
  if (isObj(v.skillExp)) {
    const se: Record<string, number> = {};
    for (const [k, x] of Object.entries(v.skillExp)) if (typeof x === "number" && Number.isFinite(x)) se[k] = x;
    h.skillExp = se;
  } else delete h.skillExp;
  return h;
}

function sanitizeMission(v: unknown): MissionSave | undefined {
  if (!isObj(v) || typeof v.id !== "number" || !isObj(v.world) || !Array.isArray((v.world as Obj).units)) return undefined;
  return v as unknown as MissionSave;
}

/**
 * Converte qualquer save conhecido para a versão atual, validando cada campo (JSON corrompido/estranho nunca lança).
 * Devolve `null` se não for um save (ou se for de uma versão futura que não sabemos ler).
 */
export function migrateSaveData(raw: unknown): SaveData | null {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!isObj(raw)) return null;
  const version = raw.version;
  if (typeof version !== "number" || version < 1 || version > SAVE_VERSION) return null;
  const progress = sanitizeProgress(raw.progress);
  const out: SaveData = {
    version: SAVE_VERSION,
    hero: sanitizeHero(raw.hero),
    progress,
    settings: raw.settings === undefined ? undefined : sanitizeSettings(raw.settings),
    location: { scene: "town", town: progress.town },
  };
  if (version >= 2) {
    const loc = isObj(raw.location) ? raw.location : {};
    const mission = sanitizeMission(raw.mission);
    if (loc.scene === "mission" && mission) {
      out.location = { scene: "mission", town: str(loc.town, progress.town), mission: mission.id };
      out.mission = mission;
    } else out.location = { scene: "town", town: str(loc.town, progress.town) || progress.town };
  }
  return out;
}

/** Descrição curta do lugar do save ("Plagat", "Mission 10"). */
export function placeLabel(d: SaveData, missionTitle?: string): string {
  if (d.location.scene === "mission") return missionTitle ? `Quest: ${missionTitle}` : `Quest ${d.location.mission ?? "?"}`;
  const t = d.location.town || "plagat";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
