/**
 * Peças do teste de ponta a ponta da campanha (campaign/test/e2e.ts): jogo "falso" sem navegador (mesmo `GameState`/`SaveManager`/
 * campaign/runtime.ts do jogo, com `localStorage` em memória e vídeo que só registra o nome), criação do herói pelo código do criador
 * de personagem (ui/chargenData.ts), ida e volta pelo save real (slot -> JSON -> slot), comparação estável de estados e aplicação do
 * resultado de uma missão exatamente como a MissionScene.leave() (ouro, XP, hall da fama, fila da campanha).
 */
import { GameState, type HeroState, type MissionResult } from "../../core/state";
import { SaveManager, memoryStorage, type StorageLike } from "../../core/save";
import { buildHero, loadChargenData, newDraft, type ChargenData, type ClassId } from "../../ui/chargenData";
import { fsGame } from "../../sim/test/loader";
import { TICK_MS } from "../../sim/types";
import { recordHallStats } from "../runtime";
import type { Game } from "../../core/game";
import type { PilotResult } from "./e2e_pilot";

// ------------------------------------------------------------------ ambiente: localStorage em memória (galeria de vídeos e hall da fama)
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(),
};
export const resetBrowserStorage = (): void => mem.clear();
export const browserStorage = (k: string): string | null => mem.get(k) ?? null;

// ------------------------------------------------------------------ jogo falso
export interface FakeGame {
  data: typeof fsGame.data;
  state: GameState;
  storage: StorageLike & { dump(): Record<string, string> };
  video: { play(name: string, opts?: unknown): Promise<void>; played: string[] };
  audio: { stopMusic(ms?: number): void };
}

export function makeGame(): FakeGame {
  const storage = memoryStorage();
  return {
    data: fsGame.data, state: new GameState(new SaveManager(storage)), storage,
    video: { played: [], async play(name: string) { this.played.push(name); } },
    audio: { stopMusic() { /* mudo */ } },
  };
}
/** O que as funções de campaign/runtime.ts esperam (`Game` inteiro; só usam data/state/video/audio). */
export const asGame = (g: FakeGame): Game => g as unknown as Game;

// ------------------------------------------------------------------ criação do personagem (criador, 4 classes)
export interface Variant { id: ClassId; mage: boolean; female: boolean; label: string }
export const E2E_VARIANTS: Variant[] = [
  { id: "male_fighter", mage: false, female: false, label: "guerreiro" },
  { id: "female_fighter", mage: false, female: true, label: "guerreira" },
  { id: "male_mage", mage: true, female: false, label: "mago" },
  { id: "female_mage", mage: true, female: true, label: "maga" },
];
let chargen: ChargenData | undefined;
let itemsJson: Record<string, { slot?: string; kind?: string }> | undefined;
/** Herói como o do botão "Accept" do criador (nome, atributos iniciais, itens e magias da classe, 1000 de ouro) e `state.newGame`. */
export async function createCharacter(g: FakeGame, v: Variant): Promise<HeroState> {
  chargen ??= await loadChargenData(p => fsGame.data.tryJson(p));
  itemsJson ??= await fsGame.data.tryJson("data/items.json");
  const c = chargen.classes[v.id];
  const hero = buildHero(c, newDraft(c), `E2E ${v.label}`, "normal", itemsJson);
  g.state.newGame(hero);
  return g.state.hero!;
}

// ------------------------------------------------------------------ comparação estável de estados
export function stable(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, y]) => [k, norm(y)]));
    return x;
  };
  return JSON.stringify(norm(v));
}
/** Até `max` caminhos que diferem entre dois valores JSON. */
export function diffPaths(a: unknown, b: unknown, max = 4, path = "$", out: string[] = []): string[] {
  if (out.length >= max) return out;
  if (stable(a) === stable(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const ka = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of ka) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], max, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${stable(a)?.slice(0, 60)} != ${stable(b)?.slice(0, 60)}`);
  return out;
}
/** O que um save guarda e o jogo precisa para retomar igual: herói + progresso (campanha incluída). */
export const persisted = (s: GameState): { hero: HeroState | undefined; progress: GameState["progress"] } => ({ hero: s.hero, progress: s.progress });

// ------------------------------------------------------------------ save/load pelo caminho real (slot -> JSON -> slot)
export interface RoundTrip { loaded: GameState; target: ReturnType<GameState["loadFromSlot"]>; equal: boolean; diff: string[] }
/** Grava no slot (como "Save Game"), lê com um GameState novo (como "Load Game") e compara com o estado de origem. */
export function roundTrip(g: FakeGame, slot = 7, name = "e2e"): RoundTrip {
  const w = g.state.saveToSlot(slot, name);
  if (!w.ok) throw new Error("save falhou: " + w.message);
  const loaded = new GameState(new SaveManager(g.storage));
  const target = loaded.loadFromSlot(slot);
  const diff = diffPaths(persisted(g.state), persisted(loaded));
  return { loaded, target, equal: diff.length === 0, diff };
}

// ------------------------------------------------------------------ resultado da missão (MissionScene.leave)
/** Vitória: ouro, XP e hall da fama vão para o herói/campanha e a vitória entra na fila (`completeMission`); derrota: só grava. Devolve o MissionResult. */
export function applyMissionResult(g: FakeGame, res: PilotResult): MissionResult & { scenarioVars?: Record<string, number> } {
  const st = g.state;
  if (res.outcome === "complete" && st.hero) {
    st.hero.gold += res.gold;
    st.hero.exp = (st.hero.exp ?? 0) + res.exp;
    const camp = st.progress.campaign;
    if (camp) recordHallStats(camp, res.ticks * TICK_MS, res.kills);
    st.completeMission(res.id, [], res.vars);
  } else st.save();
  return { id: res.id, outcome: res.outcome, goldReward: 0, flags: {}, scenarioVars: res.vars };
}
