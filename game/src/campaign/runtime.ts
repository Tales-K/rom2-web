/**
 * Cola entre o motor de campanha (puro) e o jogo: carrega data/campaign*.json, garante/migra `progress.campaign`,
 * aplica os resultados de missão pendentes, toca os vídeos de transição e decide para onde ir.
 * Usado pelas cenas Town/Inn/Shop/Briefing/GlobalMap/Credits. Console: `(await import("/src/campaign/runtime.ts")).campaignCtx(game)`.
 */
import type { Game } from "../core/game";
import type { MissionResult } from "../core/state";
import {
  FINAL_STAGE, availableTowns, enterLocation, isTownAvailable, nextAfterMission, stageOf, takePendingVideos,
} from "./engine";
import { applyQueue, ensureCampaign, queueResult, syncLegacy } from "./progress";
import { markCutscene } from "../ui/cutsceneGallery";
import { DEFAULT_FAME, fameScore, insertFame, type FameEntry } from "./hall";
export { fameScore, hallStatsOf, hallXp, recordHallStats, insertFame } from "./hall";
import type { CampaignData, CampaignState, MissionDef, MissionOutcome, PoolItem, ShopsData, TownDef } from "./types";

let dataP: Promise<CampaignData> | undefined;
let shopsP: Promise<ShopsData> | undefined;
let poolP: Promise<PoolItem[]> | undefined;

export function loadCampaignData(game: Game): Promise<CampaignData> {
  return (dataP ??= game.data.getJson<CampaignData>("data/campaign.json").catch(e => { dataP = undefined; throw e; }));
}
export function loadShopsData(game: Game): Promise<ShopsData> {
  return (shopsP ??= game.data.getJson<ShopsData>("data/campaign-shops.json").catch(e => { shopsP = undefined; throw e; }));
}
export function loadItemPool(game: Game): Promise<PoolItem[]> {
  return (poolP ??= game.data.tryJson<Record<string, PoolItem>>("data/items.json").then(j => Object.values(j ?? {})));
}

export interface CampaignCtx { data: CampaignData; st: CampaignState; outcomes: MissionOutcome[] }

/** Estado pronto para uso: cria/migra, aplica vitórias pendentes e sincroniza os campos antigos do `Progress`. */
export async function campaignCtx(game: Game): Promise<CampaignCtx> {
  const data = await loadCampaignData(game);
  const p = game.state.progress;
  const st = ensureCampaign(p, game.state.hero, data);
  const outcomes = applyQueue(p, data);
  syncLegacy(p, data);
  return { data, st, outcomes };
}

export function townDef(data: CampaignData, id: number): TownDef { return data.towns.find(t => t.id === id) ?? data.towns[0]; }
export function missionDef(data: CampaignData, id: number): MissionDef | undefined { return data.missions[String(id)]; }

/** Título e texto do briefing do mapa-múndi (#title/#briefing do globalmap.txt; 10 e 20 usam o #briefing da missão). */
export function missionText(data: CampaignData, id: number): { title: string; text: string } {
  const m = data.missions[String(id)];
  if (!m) return { title: `Mission ${id}`, text: "" };
  if (m.briefing) return { title: m.title, text: m.briefing };
  const [first, ...rest] = (m.missionBriefing ?? "").split(/\n\s*\n/);
  return { title: m.title || first.trim(), text: rest.join("\n\n").trim() };
}

/** Toca os vídeos de transição pendentes (teleport/stars/crown/knights/druids), um após o outro. */
export async function playPendingVideos(game: Game, ctx: CampaignCtx): Promise<void> {
  const names = takePendingVideos(ctx.st, ctx.data);
  if (!names.length) return;
  game.state.save();
  game.audio.stopMusic(300);
  for (const n of names) {
    await game.video.play(n, { skippable: true });
    const id = ctx.data.cutscenes.find(c => c.video === n)?.id;
    if (id !== undefined) markCutscene(id);      // galeria "Cut Scenes" do menu (global, como o registro do original)
  }
}

export type Route =
  | { scene: "town"; town: number }
  | { scene: "globalmap" }
  | { scene: "mission"; mission: number }
  | { scene: "credits"; ending: true };

const isResult = (p: unknown): p is MissionResult => !!p && typeof p === "object" && "outcome" in p && "id" in p;

/**
 * Chegada na cena "town" (vinda da missão, do mapa-múndi, de um save ou do criador de personagem): aplica o resultado,
 * toca os vídeos e decide o destino. Vitória → mapa-múndi se houver cidade, senão o 1º local (a 20 depois da 10) [exe 0x486d45];
 * estágio 120 → hall da fama e créditos. Derrota/abandono → a última cidade (se ainda existir), senão o 1º local.
 */
export async function routeTownArrival(game: Game, params: unknown): Promise<{ ctx: CampaignCtx; route: Route; result?: MissionResult }> {
  const data = await loadCampaignData(game);
  const p = game.state.progress;
  ensureCampaign(p, game.state.hero, data);
  const result = isResult(params) ? params : undefined;
  if (result && result.outcome === "complete") queueResult(p, { id: result.id, outcome: "complete", scenarioVars: result.scenarioVars });
  const ctx = await campaignCtx(game);
  const st = ctx.st;
  if (ctx.outcomes.length) game.state.autosave(`campanha: missão ${ctx.outcomes.map(o => o.completed ? "ok" : "-").join(",")}`);
  await playPendingVideos(game, ctx);
  if (stageOf(st) >= FINAL_STAGE) return { ctx, route: { scene: "credits", ending: true }, result };
  const asked = params && typeof params === "object" && "town" in params ? (params as { town: unknown }).town : undefined;
  const askedId = typeof asked === "number" ? asked : typeof asked === "string" ? ctx.data.towns.find(t => t.key === asked)?.id : undefined;
  if (result?.outcome === "complete") {
    const n = nextAfterMission(st);
    if (n.scene === "mission") return { ctx, route: missionRoute(game, ctx, n.mission), result };
    return { ctx, route: { scene: "globalmap" }, result };
  }
  const want = askedId ?? st.lastTown;
  if (isTownAvailable(st, want)) return { ctx, route: { scene: "town", town: want }, result };
  const t = availableTowns(st)[0];
  if (t !== undefined) return { ctx, route: result ? { scene: "globalmap" } : { scene: "town", town: t }, result };
  const n = nextAfterMission(st);
  return { ctx, route: n.scene === "mission" ? missionRoute(game, ctx, n.mission) : { scene: "globalmap" }, result };
}

/** Sem cidade disponível: entra direto na 1ª missão da lista, sem mapa nem briefing [exe 0x486d45; notes/original-capture.md]. */
function missionRoute(game: Game, ctx: CampaignCtx, mission: number): Route {
  enterLocation(ctx.st, ["M", mission]);
  syncLegacy(game.state.progress, ctx.data);
  game.state.save();
  return { scene: "mission", mission };
}

/** Entrar numa cidade (ScenarioEnterLocation) e gravar. */
export function enterTown(game: Game, ctx: CampaignCtx, town: number): void {
  enterLocation(ctx.st, ["T", town]);
  syncLegacy(game.state.progress, ctx.data);
}

// ------------------------------------------------------------------ hall da fama (famehall.dat: 10 × {nome, pontos}; regras em hall.ts)
export type { FameEntry } from "./hall";
const FAME_KEY = "allods2web.famehall";

export function readFameHall(): FameEntry[] {
  const dflt = () => DEFAULT_FAME.map(([name, score]) => ({ name, score, date: "" }));
  try {
    const j = JSON.parse(localStorage.getItem(FAME_KEY) ?? "[]");
    const l: FameEntry[] = Array.isArray(j) ? j.filter(e => e && typeof e.name === "string") : [];
    return l.length ? l : dflt();
  } catch { return dflt(); }
}

/**
 * Registra o herói no hall da fama (10 lugares) como o exe (0x4a8d28/0x4a8c5e, ver hall.ts): pontos = trunc(XP / (segundos × 10) × abates),
 * empate sobe, o resto sai. `xp` = hallXp(herói); `stats` = tempo e abates acumulados nas missões (campaign.hall; ver hallStatsOf).
 */
export function addToFameHall(name: string, xp: number, stats: { seconds: number; kills: number }): { list: FameEntry[]; rank: number } {
  const me: FameEntry = { name, score: fameScore(xp, stats.kills, stats.seconds), date: new Date().toISOString().slice(0, 10) };
  const r = insertFame(readFameHall(), me);
  try { localStorage.setItem(FAME_KEY, JSON.stringify(r.list)); } catch { /* sem armazenamento */ }
  return r;
}
