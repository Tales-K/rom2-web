/**
 * Teste de determinismo do save no meio da missão (sim/snapshot.ts). Rodar em game/:  npx tsx src/sim/test/snapshot.ts
 *
 * Para cada cenário da missão 10: roda A do início ao fim; roda B igual até o tique K, grava o snapshot (JSON.stringify →
 * JSON.parse, como no localStorage), monta a missão de novo (C) com o mesmo herói, restaura e continua. Exige:
 *   - o snapshot de C logo após o restore é idêntico ao de B no tique K;
 *   - B e C, avançando lado a lado, ficam idênticos (snapshot completo) até o fim;
 *   - C termina com o mesmo desfecho, tique, mensagens, subobjetivos e ouro que A (a execução sem salvar).
 */
import { parseScript } from "../../script";
import type { HeroState } from "../../core/state";
import { buildMission, defaultHero, wireOutcome, type BuiltMission, type MissionData } from "../../mission/setup";
import { restoreMission, snapshotMission, snapshotWorld, type MissionSnapshot } from "../snapshot";
import type { Unit } from "../world";
import { installMissionAi } from "../behaviors";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");
function json<T>(rel: string): T | undefined {
  const p = join(PUB, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : undefined;
}

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const ID = 10;
const mapTpl = json<Record<string, { serverId: number; level: number; kind: number }[]>>("data/map-unit-templates.json");
const data: MissionData = {
  id: ID,
  map: json<MissionData["map"]>(`data/maps/${ID}.json`)!,
  objects: json("data/objects.json") ?? {},
  structures: json("data/structures.json") ?? {},
  unitsStatic: json("data/units.json") ?? {},
  anim: json("assets/ui/hud/anim/units.json") ?? {},
  terrain: json("assets/ui/hud/terrain.json"),
  meta: json(`assets/ui/hud/missions/${ID}.json`),
  script: parseScript(json<unknown>(`data/scripts/${ID}.json`) ?? JSON.parse(readFileSync(join(PUB, "..", "src", "script", "test", "fixtures", `${ID}.json`), "utf8"))),
  stats: json("data/unit-stats.json"),
  templates: json("data/unit-templates.json"),
  mapTemplates: mapTpl?.[String(ID)],
  items: json("data/items.json"),
  spells: json("data/spells.json"),
  classes: json("data/classes.json"),
  texts: json(`data/texts/mission${ID}.json`),
  terrainNames: [],
};

function mageHero(): HeroState {
  const c = (data.classes?.classes["female_mage"]?.attributes) ?? { body: 19, reaction: 23, mind: 30, spirit: 42 };
  return {
    name: "Maga", sex: "female", heroClass: "mage", face: 0, stats: { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit },
    elementSkill: "fire", gold: 0, inventory: [], equipment: { weapon: "33037", mail: "63277", cuirass: "63531" }, spells: [], difficulty: "normal",
  };
}
function fighterHero(): HeroState {
  const h = defaultHero();
  const c = data.classes?.classes["male_fighter"]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  return h;
}

interface Run { b: BuiltMission; outcome: { ok: boolean; cause: number } | null; messages: number[]; subs: Map<number, number>; gold: number; endTick: number; }

function start(hero: HeroState): Run {
  const r: Run = { b: undefined as unknown as BuiltMission, outcome: null, messages: [], subs: new Map(), gold: 0, endTick: -1 };
  r.b = buildMission(data, hero, {
    message: n => r.messages.push(n),
    subobjective: (n, v) => r.subs.set(n, v),
    complete: () => { r.outcome ??= { ok: true, cause: 0 }; },
    fail: c => { r.outcome ??= { ok: false, cause: c }; },
    giveAll: () => { /* documentos */ },
    money: (p, a) => { if (p === 1) r.gold += a; },
    log: () => { /* silêncio */ },
  });
  wireOutcome(r.b, c => { r.outcome ??= { ok: false, cause: c }; });
  // comportamentos automáticos + magias completas (o que a MissionScene faz depois de buildMission)
  installMissionAi(r.b.world, { spells: data.spells, difficulty: hero.difficulty, heroSpellIds: (hero.spells ?? []).map(Number) });
  return r;
}

/** Política do "jogador": função só do estado do mundo (determinística). Devolve true para encerrar. */
type Policy = (r: Run) => boolean | void;

function stepOnce(r: Run, policy: Policy): boolean {
  if (r.outcome) return true;
  if (policy(r) === true) return true;
  r.b.world.step();
  r.b.runtime?.update(0.05);
  r.b.world.events.length = 0;
  if (r.outcome) { r.endTick = r.b.world.tick; return true; }
  return false;
}

function runUntil(r: Run, policy: Policy, maxTicks: number, stopAt = Infinity): void {
  while (r.b.world.tick < maxTicks && r.b.world.tick < stopAt) if (stepOnce(r, policy)) break;
}

function digest(r: Run): string {
  return JSON.stringify(snapshotWorld(r.b.world)) + JSON.stringify(r.b.runtime?.snapshot() ?? null);
}

function summary(r: Run): string {
  const h = r.b.hero;
  return JSON.stringify({ outcome: r.outcome, endTick: r.endTick, tick: r.b.world.tick, msgs: r.messages, subs: [...r.subs], gold: r.gold,
    hero: { x: h.x, y: h.y, hp: h.hp, mana: h.mana, exp: h.exp, gold: h.gold }, rng: r.b.world.rng.state,
    hp: r.b.world.units.map(u => Math.round(u.hp * 1000)) });
}

/** Mensagens/subobjetivos/ouro mostrados pela "cena" antes do save viajam no estado da UI (como na MissionScene). */
function uiOf(r: Run) { return { objectives: [...r.subs], messages: [...r.messages], elapsedMs: r.b.world.tick * 50, cam: { x: 0, y: 0 }, zoom: 1, gold: r.gold }; }

function scenario(label: string, hero: () => HeroState, setup: (r: Run) => void, policy: Policy, saveAt: number, maxTicks: number): void {
  console.log(`\n[${label}] save no tique ${saveAt}`);
  // A: sem salvar
  const a = start(hero()); setup(a); runUntil(a, policy, maxTicks);
  // B: até o save
  const b = start(hero()); setup(b); runUntil(b, policy, maxTicks, saveAt);
  check(!b.outcome && b.b.world.tick === saveAt, `B chegou ao tique ${saveAt} sem desfecho (tique ${b.b.world.tick})`);
  const snap = snapshotMission(ID, b.b, uiOf(b));
  const text = JSON.stringify(snap);
  const projs = snap.world.projectiles.length;
  console.log(`  snapshot: ${(text.length / 1024).toFixed(1)} KB, ${snap.world.units.length} unidades, ${projs} projéteis, ${snap.world.loot.length} sacos`);
  // C: missão nova + restore
  const c = start(hero());
  const ui = restoreMission(c.b, JSON.parse(text) as MissionSnapshot);
  c.messages = [...ui.messages]; c.subs = new Map(ui.objectives); c.gold = Number(ui.gold ?? 0);
  check(digest(c) === digest(b), "estado restaurado idêntico ao salvo");
  // B e C lado a lado
  let same = true, firstDiff = -1;
  while (b.b.world.tick < maxTicks) {
    const db = stepOnce(b, policy), dc = stepOnce(c, policy);
    if (same && b.b.world.tick % 20 === 0 && digest(b) !== digest(c)) { same = false; firstDiff = b.b.world.tick; }
    if (db || dc) break;
  }
  check(same && digest(b) === digest(c), `B e C idênticos até o fim${firstDiff >= 0 ? ` (divergiram no tique ${firstDiff})` : ""}`);
  check(summary(c) === summary(a), `mesmo resultado final que sem salvar: ${JSON.stringify(a.outcome)} no tique ${a.endTick}`);
  if (summary(c) !== summary(a)) { console.log("   A:", summary(a).slice(0, 300)); console.log("   C:", summary(c).slice(0, 300)); }
}

const SKRAKAN = { x: 62, y: 36 };
const walkToSkrakan: Policy = r => {
  const h = r.b.hero;
  if (!h.alive) return true;
  if (h.order.type !== "move") r.b.world.command(h, { type: "move", x: SKRAKAN.x, y: SKRAKAN.y });
};

function snakes(r: Run): Unit[] { return r.b.host.groups.get(8) ?? []; }
const fightSnakes: Policy = r => {
  const h = r.b.hero, w = r.b.world, ss = snakes(r);
  if (!h.alive || ss.every(s => !s.alive)) return true;
  if (h.order.type === "none" || h.order.type === "hold") {
    const heal = h.spells.find(s => s.kind === "heal");
    const shield = h.spells.find(s => s.kind === "shield");
    if (shield && !h.buffs.some(b => b.spell === shield.id) && h.mana >= shield.mana) { w.command(h, { type: "cast", spell: shield.id, target: h.id }); return; }
    if (heal && h.hp < h.maxHp * 0.6 && h.mana >= heal.mana) { w.command(h, { type: "cast", spell: heal.id, target: h.id }); return; }
    const t = ss.filter(s => s.active).sort((x, y) => Math.hypot(x.x - h.x, x.y - h.y) - Math.hypot(y.x - h.x, y.y - h.y) || x.id - y.id)[0];
    if (t) w.command(h, { type: "attack", target: t.id });
  }
};

// 1. guerreiro anda até Skrakan (gatilhos, mensagens, desfecho "complete"): save no meio do caminho
scenario("guerreiro → Skrakan", fighterHero, () => { /* Drop Location */ }, walkToSkrakan, 300, 20 * 60 * 6);
scenario("guerreiro → Skrakan (tarde)", fighterHero, () => { /* Drop Location */ }, walkToSkrakan, 850, 20 * 60 * 6);
scenario("maga → Skrakan", mageHero, () => { /* Drop Location */ }, walkToSkrakan, 500, 20 * 60 * 6);
// 2. maga contra as cobras (projéteis mágicos em voo, escudo, experiência, loot): save no meio da luta
scenario("maga x cobras", mageHero, r => r.b.world.teleport(r.b.hero, 33, 39), fightSnakes, 120, 20 * 120);
// 3. guerreiro contra as cobras: save logo no início do combate
scenario("guerreiro x cobras", fighterHero, r => r.b.world.teleport(r.b.hero, 33, 39), fightSnakes, 60, 20 * 120);
// 4. herói morre para Hydun (falha causa 2): save durante a luta
scenario("herói morre", fighterHero, r => { r.b.world.setDiplomacy(5, 1, 1); const hy = r.b.host.units.get(23)!; r.b.world.teleport(r.b.hero, hy.cx + 2, hy.cy); },
  r => { if (r.b.hero.state === "dead") return true; }, 20, 20 * 120);

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
