/**
 * Ponte (pura) entre o estado da campanha e `Progress` do save: criação/migração do estado, fila de resultados de missão
 * e os campos antigos (`availableMissions`, `completedMissions`, `town`) mantidos em sincronia para quem ainda os lê.
 */
import {
  enterLocation, hasLoc, isDone, leaveTown, newCampaign, onMissionResult, sanitizeCampaign, setVar, townKey, V_M10_TAKEN,
} from "./engine";
import type { CampaignData, CampaignState, MissionOutcome, MissionResultIn } from "./types";

/** O que o motor precisa de `Progress` (core/state.ts) — sem importar core/ (os testes rodam sem DOM). */
export interface ProgressLike {
  town: string;
  completedMissions: number[];
  availableMissions: number[];
  flags: Record<string, number>;
  campaign?: CampaignState;
}
export interface HeroLike { heroClass: string; sex: string }

const heroFlags = (h?: HeroLike) => ({ mage: h?.heroClass === "mage", female: h?.sex === "female" });

/**
 * Estado da campanha do save; cria um novo (novo jogo) ou migra o modelo antigo (availableMissions/completedMissions/flags
 * `accepted_<id>`): as missões concluídas são reaplicadas em ordem pelo motor (efeitos, estágio, mercenários, lojas).
 */
export function ensureCampaign(p: ProgressLike, hero: HeroLike | undefined, data: CampaignData, seed = Date.now() >>> 0): CampaignState {
  const ok = sanitizeCampaign(p.campaign);
  if (ok) { p.campaign = ok; return ok; }
  const st = newCampaign(data, heroFlags(hero), seed);
  const done = [...new Set(p.completedMissions ?? [])].filter(m => data.missions[String(m)]).sort((a, b) => a - b);
  const accepted = Object.keys(p.flags ?? {}).filter(k => k.startsWith("accepted_") && p.flags[k]).map(k => Number(k.slice(9)));
  if (done.includes(10) || accepted.includes(10)) setVar(st, V_M10_TAKEN, 1);
  for (const m of done) {
    if (hasLoc(st, ["T", 1])) { setVar(st, V_M10_TAKEN, 1); leaveTown(st, 1); }
    if (!hasLoc(st, ["M", m])) st.locations.push(["M", m]);
    onMissionResult(st, data, { id: m, outcome: "complete" });
  }
  st.pending = [];                                   // vídeos de missões antigas não são tocados de novo
  // missões disponíveis do modelo antigo (o padrão de jogo novo, [10], só conta se a 10 foi aceita)
  const legacyAvail = done.length || accepted.length ? [...(p.availableMissions ?? []), ...accepted] : [];
  for (const m of legacyAvail) {
    if (m === 10 && !accepted.includes(10)) continue;
    if (data.missions[String(m)] && !isDone(st, m) && !hasLoc(st, ["M", m])) st.locations.push(["M", m]);
  }
  const t = data.towns.find(x => x.key === p.town);
  if (t && hasLoc(st, ["T", t.id])) enterLocation(st, ["T", t.id]);
  else { const first = st.locations.find(l => l[0] === "T"); if (first) st.lastTown = first[1]; }
  p.campaign = st;
  syncLegacy(p, data);
  return st;
}

/** Mantém os campos antigos coerentes com a campanha (outros módulos e saves antigos os leem). */
export function syncLegacy(p: ProgressLike, data: CampaignData): void {
  const st = p.campaign;
  if (!st) return;
  p.completedMissions = [...st.log];
  p.availableMissions = st.locations.filter(l => l[0] === "M").map(l => l[1]);
  p.town = townKey(data, st.lastTown);
  for (const k of Object.keys(p.flags)) if (k.startsWith("accepted_")) delete p.flags[k];
}

/** Guarda o resultado de uma vitória para ser aplicado (a missão pode terminar antes de a campanha estar carregada). */
export function queueResult(p: ProgressLike, r: MissionResultIn): void {
  const st = p.campaign;
  const pairs = r.scenarioVars ? (Array.isArray(r.scenarioVars) ? r.scenarioVars : Object.entries(r.scenarioVars).map(([a, b]) => [Number(a), Number(b)] as [number, number])) : undefined;
  if (!st) {
    // sem estado ainda (atalho de depuração): registra no modelo antigo; ensureCampaign o reaplica
    if (!p.completedMissions.includes(r.id)) p.completedMissions.push(r.id);
    p.availableMissions = p.availableMissions.filter(m => m !== r.id);
    if (pairs) p.flags[`scenarioVars_${r.id}`] = 1;
    return;
  }
  if (r.outcome !== "complete" || isDone(st, r.id)) return;
  const q = st.queue.find(x => x.id === r.id);
  if (q) { if (pairs) q.scenarioVars = pairs; }
  else st.queue.push({ id: r.id, ...(pairs ? { scenarioVars: pairs } : {}) });
}

/** Aplica os resultados pendentes; devolve os desfechos (para mostrar/tocar os vídeos). */
export function applyQueue(p: ProgressLike, data: CampaignData): MissionOutcome[] {
  const st = p.campaign;
  if (!st) return [];
  const out: MissionOutcome[] = [];
  while (st.queue.length) {
    const q = st.queue.shift()!;
    out.push(onMissionResult(st, data, { id: q.id, outcome: "complete", scenarioVars: q.scenarioVars }));
  }
  syncLegacy(p, data);
  return out;
}
