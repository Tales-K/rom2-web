/**
 * Carregador de dados para os testes headless (Node + tsx, sem PixiJS): lê `game/public/` do disco e monta o `MissionData`
 * exatamente como a MissionScene (mission/setup.ts `loadMissionData`).
 */
import { buildMission, defaultHero, loadMissionData, spawnCompanions, summonFactoryFor, wireOutcome, type BuiltMission, type MissionData } from "../../mission/setup";
import type { HeroState } from "../../core/state";
import { attachFollowers, installMissionAi } from "../behaviors";
import type { ScriptLogLevel } from "../../script";

interface NodeProc { argv: string[]; exitCode?: number; getBuiltinModule(name: string): unknown; }
export const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PUB = join(HERE, "..", "..", "..", "public");
export const GAME = join(HERE, "..", "..", "..");
export const fileExists = (rel: string): boolean => existsSync(join(PUB, rel));
export function json<T>(rel: string): T | undefined {
  const p = join(PUB, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : undefined;
}

const cache = new Map<string, unknown>();
/** Leitor de arquivos com a mesma interface do DataStore usada por `loadMissionData`. */
export const fsGame = {
  data: {
    async getJson<T>(path: string): Promise<T> {
      if (cache.has(path)) return cache.get(path) as T;
      // fixtures de teste do script ficam em src/, o resto em public/
      const p = path.startsWith("src/") ? join(GAME, path) : join(PUB, path);
      if (!existsSync(p)) throw new Error(`${path}: não existe`);
      const v = JSON.parse(readFileSync(p, "utf8"));
      cache.set(path, v);
      return v as T;
    },
    async tryJson<T>(path: string): Promise<T | undefined> { try { return await this.getJson<T>(path); } catch { return undefined; } },
  },
};

export const loadData = (id: number): Promise<MissionData> => loadMissionData(fsGame, id);

export interface Outcome { ok: boolean; cause: number; }
export interface Run {
  b: BuiltMission; data: MissionData; outcome: Outcome | null; messages: number[]; subs: Map<number, number>; gold: number;
  logs: { level: ScriptLogLevel; msg: string }[]; ticks: number;
}

/** Monta a missão como a cena (buildMission + wireOutcome + installMissionAi). */
export function startRun(data: MissionData, hero: HeroState = defaultHero(), seedVars?: Record<number, number>, opts: { companions?: number[] } = {}): Run {
  const r: Run = { b: undefined as unknown as BuiltMission, data, outcome: null, messages: [], subs: new Map(), gold: 0, logs: [], ticks: 0 };
  r.b = buildMission(data, hero, {
    message: n => r.messages.push(n),
    subobjective: (n, v) => r.subs.set(n, v),
    complete: () => { r.outcome ??= { ok: true, cause: 0 }; },
    fail: c => { r.outcome ??= { ok: false, cause: c }; },
    giveAll: () => { /* documentos */ },
    money: (p, a) => { if (p === 1) r.gold += a; },
    log: (level, msg) => { r.logs.push({ level, msg }); },
  });
  wireOutcome(r.b, c => { r.outcome ??= { ok: false, cause: c }; });
  if (seedVars) for (const [k, v] of Object.entries(seedVars)) r.b.host.scenarioVars.set(Number(k), v);
  // Igles (10002) / Dina (10003) do grupo: como a cena (spawnParty + attachFollowers antes do installMissionAi)
  if (opts.companions?.length) attachFollowers(r.b.world, r.b.hero, spawnCompanions(r.b, data, opts.companions));
  installMissionAi(r.b.world, { spells: data.spells, difficulty: hero.difficulty, heroSpellIds: (hero.spells ?? []).map(Number), summonFactory: summonFactoryFor(data) });
  return r;
}

/** Avança n tiques (script a cada tique, como a cena). `each` roda antes de cada tique; devolver true interrompe. */
export function run(r: Run, n: number, each?: (t: number) => boolean | void): number {
  for (let i = 0; i < n; i++) {
    if (each && each(i) === true) return i;
    r.b.world.step();
    r.b.runtime?.update(0.05);
    r.b.world.events.length = 0;
    r.ticks++;
    if (r.outcome) return i;
  }
  return n;
}
