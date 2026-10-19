/**
 * Estado persistente do jogador. Qualquer cena pode ler/escrever; chame `game.state.save()` depois de mudanças importantes
 * (grava o "Autosave", slot 0). Saves nomeados: `saveToSlot`/`loadFromSlot` (core/save.ts, telas em ui/saveui.ts).
 * As opções (`settings`) valem para o jogo todo (como a configuração do original) e ficam em `allods2web.settings`.
 * Formato e migração dos saves: core/savedata.ts. Dono: frente SAVE-LOAD.
 */
import { AUTOSAVE_SLOT, SaveManager, type WriteResult } from "./save";
import type { CampaignState } from "../campaign/types";
import { queueResult } from "../campaign/progress";
import {
  SAVE_VERSION, defaultProgress, defaultSettings, migrateSaveData, sanitizeSettings,
  type MissionSave, type SaveData, type SaveLocation,
} from "./savedata";

export type Sex = "male" | "female";
export type HeroClass = "fighter" | "mage";            // classes do criador de personagem (a confirmar contra os dados do jogo)
export type WeaponSkill = "blade" | "axe" | "bludgeon" | "pike" | "shooting";
export type ElementSkill = "fire" | "water" | "air" | "earth" | "astral";

export interface HeroState {
  name: string;
  sex: Sex;
  heroClass: HeroClass;
  face: number;                                       // índice do retrato
  /** Atributos básicos (Body, Mind, Agility, Spirit) e pontos livres do criador. */
  stats: { body: number; mind: number; agility: number; spirit: number };
  weaponSkill?: WeaponSkill;                          // escolha de alinhamento (habilidade inicial 20)
  elementSkill?: ElementSkill;
  gold: number;
  /** Ids de itens (ver public/data/items.json quando existir) ou objetos livres. */
  inventory: Array<{ id: string; count?: number }>;
  equipment: Record<string, string | undefined>;
  spells: string[];
  difficulty: "easy" | "normal" | "hard";
  /** Experiência e nível acumulados em missões (gravados pela cena de missão). */
  exp?: number;
  level?: number;
  /** Experiência por habilidade (blade/axe/…/fire/…/astral), gravada pela cena de missão. */
  skillExp?: Record<string, number>;
}

export interface Progress {
  /** última cidade (plagat/kaarg/druids) — derivado de `campaign` (campaign/progress.ts:syncLegacy) */
  town: string;
  /** missões concluídas em ordem — derivado de `campaign.log` */
  completedMissions: number[];
  /** missões no mapa — derivado de `campaign.locations` */
  availableMissions: number[];
  /** Flags livres (por exemplo "skrakan_documents": 1). */
  flags: Record<string, number>;
  /**
   * Estado da campanha (Scenario.dll: vars[1024] com o estágio em vars[768], locais, lojas, mercenários, vídeos).
   * Motor em campaign/engine.ts; criado/migrado de saves antigos por campaign/progress.ts:ensureCampaign quando a cidade carrega.
   */
  campaign?: CampaignState;
}

/** Opções do jogo (dialogs.txt: Game Options / Sound Options). */
export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  speechVolume: number;
  /** "Acknowledgments" da janela Sound Options (original); padrão ligado */
  acknowledgments?: boolean;
  /** multiplicador da velocidade da simulação na missão (padrão 1,5; teclas [ ] na missão) */
  gameSpeed: number;
  /** "Smoothing": rolagem/filtragem suave */
  smoothing: boolean;
  /** "Day/Night changes" */
  dayNight: boolean;
  /** "Show Health": barras de vida sobre as unidades */
  showHealth: boolean;
  /** "Formation Mode": Off / Auto / On */
  formationMode: "off" | "auto" | "on";
  /** "Retreat Mode": Never / Low Health / Medium Health */
  retreatMode: "never" | "low" | "medium";
  /** Opções da janela Game Options do original (refs/original/mission_game_options.png, 19/10); ainda sem efeito no jogo: só são gravadas */
  shadows?: boolean;
  dynamicLighting?: boolean;
  objectAnimations?: boolean;
  damagePoints?: boolean;
  altColors?: boolean;
  autoCastOwn?: boolean;
  autoCastAllies?: boolean;
  autoCastNeutral?: boolean;
  /** "AutoCast mode": Minimum / Average / Maximum */
  autoCastMode?: "min" | "avg" | "max";
}

export type { SaveData, SaveLocation, MissionSave } from "./savedata";

const SETTINGS_KEY = "allods2web.settings";

/** Para onde ir depois de carregar um save. */
export interface ResumeTarget { scene: "town" | "mission"; params?: unknown; }

export class GameState {
  hero?: HeroState;
  progress: Progress = defaultProgress();
  settings: Settings = defaultSettings();
  readonly saves: SaveManager;
  /** Save de missão carregado e ainda não aplicado: a MissionScene o consome com `takeMissionResume(id)`. */
  pendingMission?: MissionSave;
  /** último slot usado em Save/Load (pré-seleção das telas) */
  lastSlot = 1;

  constructor(saves?: SaveManager) {
    this.saves = saves ?? new SaveManager();
    this.loadSettings();
  }

  newGame(hero: HeroState): void {
    this.hero = hero;
    this.progress = defaultProgress();
    this.pendingMission = undefined;
    this.save();
  }

  /** Existe algum jogo salvo (autosave, slots ou o save v1 antigo)? */
  hasSave(): boolean { try { return this.saves.hasAny(); } catch { return false; } }

  // ------------------------------------------------------------------ opções
  private loadSettings(): void {
    let raw: string | null = null;
    try { raw = this.saves.storage.getItem(SETTINGS_KEY); } catch { raw = null; }
    if (raw) { try { this.settings = sanitizeSettings(JSON.parse(raw)); return; } catch { /* corrompido: padrões */ } }
    // primeira vez: herda as opções do save v1, se houver
    try {
      const legacy = this.saves.storage.getItem("allods2web.save.v1");
      const d = legacy ? migrateSaveData(legacy) : null;
      if (d?.settings) this.settings = sanitizeSettings(d.settings);
    } catch { /* ignora */ }
  }

  saveSettings(): void {
    this.settings = sanitizeSettings(this.settings);
    try { this.saves.storage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* sem armazenamento */ }
  }

  // ------------------------------------------------------------------ saves
  /** Estado atual como SaveData (cópia profunda). `mission` = snapshot da missão em andamento (sim/snapshot.ts). */
  snapshotData(mission?: MissionSave): SaveData {
    const loc: SaveLocation = mission
      ? { scene: "mission", town: this.progress.town, mission: mission.id }
      : { scene: "town", town: this.progress.town };
    return JSON.parse(JSON.stringify({ version: SAVE_VERSION, hero: this.hero, progress: this.progress, settings: this.settings, location: loc, mission })) as SaveData;
  }

  /** Substitui o jogo atual pelo de um save (as opções globais não mudam). Devolve para onde ir. */
  applyData(d: SaveData): ResumeTarget {
    const clean = migrateSaveData(d) ?? migrateSaveData({ version: 1 })!;
    this.hero = clean.hero;
    this.progress = clean.progress;
    this.pendingMission = clean.location.scene === "mission" ? clean.mission : undefined;
    if (this.pendingMission) return { scene: "mission", params: { id: this.pendingMission.id, resume: true } satisfies MissionParams };
    return { scene: "town" };
  }

  /** Grava o "Autosave" (slot 0). Sem herói (menu principal) grava só as opções. */
  save(): void {
    this.saveSettings();
    if (!this.hero) return;
    const r = this.saves.write(AUTOSAVE_SLOT, "Autosave", this.snapshotData());
    if (!r.ok) console.warn("[save] autosave falhou:", r.message);
  }

  /** Autosave explícito (fim de missão, saída da cidade): o mesmo que `save()`, com registro no console. */
  autosave(reason: string): void {
    this.save();
    console.info(`[save] autosave (${reason})`);
  }

  /** Save nomeado num slot (1..SLOT_COUNT). `mission` = snapshot da missão em andamento. */
  saveToSlot(slot: number, name: string, mission?: MissionSave, missionTitle?: string): WriteResult {
    this.saveSettings();
    const r = this.saves.write(slot, name, this.snapshotData(mission), { missionTitle });
    if (r.ok) this.lastSlot = slot;
    return r;
  }

  /** Carrega um slot; devolve o destino (cena + parâmetros) ou null se o slot estiver vazio/corrompido. */
  loadFromSlot(slot: number): ResumeTarget | null {
    const d = this.saves.read(slot);
    if (!d || !d.hero) return null;
    if (slot > 0) this.lastSlot = slot;
    return this.applyData(d);
  }

  /** Compatibilidade (atalho `#cena=`, "Continuar"): carrega o save mais recente. */
  load(): boolean {
    const m = this.saves.latest();
    return !!m && !!this.loadFromSlot(m.slot);
  }

  /** A MissionScene chama em `enter`: devolve (e esquece) o save de missão pendente se for desta missão. */
  takeMissionResume(id: number): MissionSave | undefined {
    const m = this.pendingMission;
    this.pendingMission = undefined;
    return m && m.id === id ? m : undefined;
  }

  /**
   * Vitória numa missão: entra na fila da campanha (`progress.campaign.queue`) e grava o autosave; a cena "town" aplica o
   * resultado com o motor (campaign/runtime.ts:routeTownArrival → efeitos de missions[id].onComplete, estágio, vídeos).
   * `unlocks` é ignorado (os desbloqueios vêm do campaign.json); `scenarioVars` = variáveis de cenário que o script gravou.
   */
  completeMission(id: number, _unlocks: number[] = [], scenarioVars?: MissionResult["scenarioVars"]): void {
    queueResult(this.progress, { id, outcome: "complete", scenarioVars });
    this.autosave(`missão ${id} concluída`);
  }
}

/** Parâmetros/resultado trocados entre cenas de missão. `resume`: continuar do save carregado (`state.takeMissionResume`). */
export interface MissionParams { id: number; resume?: boolean; }
export interface MissionResult {
  id: number;
  outcome: "complete" | "fail" | "abort";
  goldReward?: number;
  flags?: Record<string, number>;
  /** obsoleto: os desbloqueios vêm de data/campaign.json (missions[id].onComplete) */
  unlocks?: number[];
  /**
   * Variáveis de cenário ao fim da missão (MissionHost.scenarioVars: "Set Scenario Variable", subobjetivos em 752+n).
   * Pares [índice, valor] ou { índice: valor } (só as que o script mudou). Ausente = o motor usa o último valor de
   * missions[id].scenarioVarsSet (20 → 772, 50 → 780, 110 → 779).
   */
  scenarioVars?: Array<[number, number]> | Record<string, number>;
}
