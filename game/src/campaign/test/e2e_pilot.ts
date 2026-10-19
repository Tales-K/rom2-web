/**
 * Pilotos de missão do teste de ponta a ponta da campanha. `pilotMission` monta a missão como a MissionScene (loader.ts startRun) com o grupo
 * que o motor de campanha manda (partyForMission: Igles/Dina = unidades 10002/10003, mercenários pelo template do estágio) e as variáveis
 * de cenário da campanha semeadas, e vence:
 *   - "real": 10 (ponte até Skrakan) e 20 (estrada até Kaarg, passando pelo bom bandido = vars[772]=1): o herói ANDA e o script decide a vitória;
 *   - "forçado": as outras 44 (os pilotos específicos de src/sim/test/missions_*.ts provam cada uma por teletransporte + abates, mas são scripts
 *     sem API reutilizável): roda o script 3 s com o grupo vivo e, sem falha, declara a vitória; as variáveis que o script gravaria
 *     (missions[id].scenarioVarsSet, ex.: 780 na 50, 779 na 110 conforme o final pedido) entram no resultado como o MissionScene.leave() faria.
 * Vitória/derrota também podem ser pedidas: `fail` mata o herói (falha causa 2 do motor).
 */
import type { HeroState } from "../../core/state";
import { spawnFromTemplate } from "../../mission/setup";
import { attachFollowers } from "../../sim/behaviors";
import type { Unit } from "../../sim/world";
import { partyForMission } from "../engine";
import type { CampaignState } from "../types";
import { loadData, run, startRun, type Run } from "../../sim/test/loader";
import { campaignData, sceneVars, settle } from "../../sim/test/pilot";

export interface PilotGame { state: { hero?: HeroState; progress: { campaign?: CampaignState } } }
export interface PilotOpts { /** final da 110: 0 = cavaleiros (knights), 1 = druidas */ ending?: 0 | 1; fail?: boolean }
export interface PilotResult {
  id: number; outcome: "complete" | "fail"; mode: "real" | "forçado"; vars: Record<string, number>;
  gold: number; exp: number; kills: number; ticks: number; cause: number;
  /** quem o motor mandou e quem realmente apareceu no mundo da missão */
  party: { companions: number[]; mercs: number; companionUnits: number[]; mercUnits: number };
  /** a execução da missão (mundo, host, desfecho) para inspeção */
  run: Run;
}

/** Recompensa sintética dos pilotos forçados (nenhum script dá XP/ouro ao vencer): só para provar que ouro/XP persistem entre missões. */
export const syntheticReward = (id: number): { gold: number; exp: number } => ({ gold: id, exp: 100 + id });

const SKRAKAN = { x: 62, y: 36 };
const ROAD_TO_KAARG = [{ x: 44, y: 55 }, { x: 55, y: 52 }, { x: 60, y: 44 }, { x: 56, y: 34 }, { x: 47, y: 29 }, { x: 43, y: 20 }, { x: 42, y: 10 }];

/** Piloto real da 10: anda até Skrakan (a ordem é reemitida quando o herói para; o motor revida sozinho). Sem estado próprio: serve para restaurar de um snapshot. */
export function walkToSkrakan(r: Run): () => boolean | void {
  const h = r.b.hero, w = r.b.world;
  return () => { if (!h.alive) return true; if (h.order.type !== "move") w.command(h, { type: "move", x: SKRAKAN.x, y: SKRAKAN.y }); };
}

function walkRoadToKaarg(r: Run): () => boolean | void {
  const h = r.b.hero, w = r.b.world;
  let wp = 0;
  return () => {
    if (!h.alive) return true;
    while (wp < ROAD_TO_KAARG.length - 1 && Math.hypot(h.x - ROAD_TO_KAARG[wp]!.x, h.y - ROAD_TO_KAARG[wp]!.y) < 4) wp++;
    if (h.order.type !== "move") w.command(h, { type: "move", x: ROAD_TO_KAARG[wp]!.x, y: ROAD_TO_KAARG[wp]!.y });
  };
}

/** Monta a missão `id` com o grupo da campanha. */
export async function buildMissionRun(game: PilotGame, id: number): Promise<{ r: Run; party: PilotResult["party"]; seed: Record<number, number> }> {
  const camp = game.state.progress.campaign!;
  const data = await loadData(id);
  const hero = JSON.parse(JSON.stringify(game.state.hero)) as HeroState;
  const seed: Record<number, number> = {};
  for (const [k, v] of Object.entries(camp.vars)) if (Number(k) < 752) seed[Number(k)] = v;   // MissionScene: variáveis de cenário da campanha
  const party = partyForMission(camp, campaignData);
  const r = startRun(data, hero, seed, { companions: party.companions.map(c => c.unit) });
  const mercs: Unit[] = [];
  for (const m of party.mercs) { const u = spawnFromTemplate(r.b, data, m.template); if (u) mercs.push(u); }
  if (mercs.length) attachFollowers(r.b.world, r.b.hero, mercs);
  return {
    r, seed,
    party: {
      companions: party.companions.map(c => c.npc), mercs: party.mercs.length,
      companionUnits: party.companions.map(c => c.unit).filter(u => r.b.host.units.has(u)), mercUnits: mercs.length,
    },
  };
}

const killsOf = (r: Run): number => r.b.world.units.filter(u => u.player !== r.b.hero.player && !u.alive && r.b.world.hostile(r.b.hero.player, u.player)).length;

export async function pilotMission(game: PilotGame, id: number, o: PilotOpts = {}): Promise<PilotResult> {
  const { r, party, seed } = await buildMissionRun(game, id);
  const h = r.b.hero, w = r.b.world;
  let mode: PilotResult["mode"] = "forçado";
  const out = (outcome: "complete" | "fail", vars: Record<string, number>, extra: { gold: number; exp: number }): PilotResult => ({
    id, outcome, mode, vars, gold: r.gold + h.gold + extra.gold, exp: h.exp + extra.exp, kills: killsOf(r), ticks: r.ticks,
    cause: r.outcome && !r.outcome.ok ? r.outcome.cause : 0, party, run: r,
  });

  if (o.fail) {                                           // derrota: o herói morre (falha causa 2)
    settle(r, 20);
    w.kill(h);
    run(r, 80);
    return out(r.outcome && !r.outcome.ok ? "fail" : "complete", {}, { gold: 0, exp: 0 });
  }

  if (id === 10) {
    mode = "real";
    run(r, 20 * 60 * 6, walkToSkrakan(r));
  } else if (id === 20) {
    mode = "real";
    // o bom bandido (unidade 62) abre o subobjetivo 1 e grava vars[772]=1 (libera a 21); depois a estrada até Kaarg
    const good = r.b.host.units.get(62);
    if (good) { w.teleport(h, good.cx + 2, good.cy); run(r, 20); w.teleport(h, 41, 67); }
    run(r, 20 * 300, walkRoadToKaarg(r));
  } else {
    settle(r, 60);                                        // o script roda 3 s com o grupo vivo; sem falha, a vitória é declarada
    if (!r.outcome) r.outcome = { ok: true, cause: 0 };
  }

  if (!r.outcome?.ok) return out("fail", {}, { gold: 0, exp: 0 });
  const vars = sceneVars(r, seed);
  if (mode === "forçado") {
    // variáveis de cenário que o script da missão grava (campaign.json missions[id].scenarioVarsSet); a 110 escolhe o final
    const sets = campaignData.missions[String(id)]?.scenarioVarsSet ?? [];
    for (const s of sets) {
      if (String(s.var) in vars) continue;
      const same = sets.filter(x => x.var === s.var);
      if (same.length > 1 && s.value !== (o.ending ?? 1)) continue;
      vars[String(s.var)] = s.value;
    }
  }
  return out("complete", vars, mode === "forçado" ? syntheticReward(id) : { gold: 0, exp: 0 });
}
