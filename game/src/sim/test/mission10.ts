/**
 * Teste headless da missão 10 (sem navegador, sem PixiJS). Rodar em game/:  npm run test:sim   (= npx tsx src/sim/test/mission10.ts)
 *
 * Lê os JSON de game/public (mapa, script, templates, itens, magias, classes, animações) e monta o mesmo mundo da cena
 * (mission/setup.ts `buildMission`). Casos:
 *   1. guerreiro: piloto automático do Drop Location até Skrakan pela ponte → "Mission Complete", herói vivo, passou pela ponte
 *   2. maga: o mesmo
 *   3. guerreiro e maga vencem os 3 "Bone Snakes" (inimigos opcionais fracos) lutando
 *   4. irritar Skrakan (bater nele) → "Mission Fail" causa 5
 *   5. herói morre (Hydun hostil) → falha causa 2
 *   6. desafio do troll: arena deixa Hydun hostil; matar o troll jovem → neutro, subobjetivo 1 cumprido, 700 de ouro
 */
import { parseScript } from "../../script";
import type { HeroState } from "../../core/state";
import { buildMission, defaultHero, wireOutcome, type BuiltMission, type MissionData } from "../../mission/setup";
import type { Unit } from "../world";
import { installMissionAi } from "../behaviors";

interface NodeProc { argv: string[]; exitCode?: number; getBuiltinModule(name: string): unknown; }
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

interface Run { b: BuiltMission; outcome: { ok: boolean; cause: number } | null; messages: number[]; subs: Map<number, number>; gold: number; }

function start(hero: HeroState): Run {
  const r: Run = { b: undefined as unknown as BuiltMission, outcome: null, messages: [], subs: new Map(), gold: 0 };
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

/** Avança n tiques (o script a cada tique, como a cena). `each` roda antes de cada tique. */
function run(r: Run, n: number, each?: (t: number) => boolean | void): number {
  for (let i = 0; i < n; i++) {
    if (each && each(i) === true) return i;
    r.b.world.step();
    r.b.runtime?.update(0.05);
    r.b.world.events.length = 0;
    if (r.outcome) return i;
  }
  return n;
}

const SKRAKAN_SPOT = { x: 62, y: 36 };
const onBridge = (u: Unit) => u.cx >= 52 && u.cx <= 57 && u.cy >= 37 && u.cy <= 40;

function autopilot(label: string, hero: HeroState): void {
  console.log(`\n[${label}] piloto automático: Drop Location -> Skrakan`);
  const r = start(hero);
  const h = r.b.hero;
  const w = r.b.world;
  check(h.cx === 11 && h.cy === 41, `herói nasce no Drop Location (11,41): ${h.cx},${h.cy}`);
  let bridge = false, minHp = h.hp;
  // ignora inimigos: só anda (o herói revida sozinho se parado; aqui ele nunca fica parado)
  const ticks = run(r, 20 * 60 * 6, () => {
    if (!h.alive) return true;
    if (onBridge(h)) bridge = true;
    minHp = Math.min(minHp, h.hp);
    if (h.order.type !== "move") w.command(h, { type: "move", x: SKRAKAN_SPOT.x, y: SKRAKAN_SPOT.y });
  });
  check(r.outcome?.ok === true, `missão cumprida (${(ticks / 20).toFixed(0)} s simulados; desfecho ${JSON.stringify(r.outcome)})`);
  check(h.alive, `herói vivo (vida mínima ${Math.ceil(minHp)}/${h.maxHp})`);
  check(bridge, "o caminho passou pela ponte");
  check(r.messages.includes(1) && r.messages.includes(8), `mensagens 1 e 8 (${r.messages.join(",")})`);
  check(r.subs.get(2) === 2, "subobjetivo 2 (encontrar Skrakan) cumprido");
}

function fightSnakes(label: string, hero: HeroState): void {
  console.log(`\n[${label}] luta com 3 Bone Snakes (grupo 8)`);
  const r = start(hero);
  const h = r.b.hero, w = r.b.world;
  const snakes = r.b.host.groups.get(8) ?? [];
  check(snakes.length === 3, "grupo 8 tem 3 cobras");
  w.teleport(h, 33, 39);
  run(r, 20 * 120, () => {
    if (!h.alive || snakes.every(s => !s.alive)) return true;
    // luta "com cuidado": ataca a cobra viva mais próxima; cura com magia/descanso se a vida cair
    if (h.order.type === "none" || h.order.type === "hold") {
      const heal = h.spells.find(s => s.kind === "heal");
      const shield = h.spells.find(s => s.kind === "shield");
      if (shield && !h.buffs.some(b => b.spell === shield.id) && h.mana >= shield.mana) { w.command(h, { type: "cast", spell: shield.id, target: h.id }); return; }
      if (heal && h.hp < h.maxHp * 0.6 && h.mana >= heal.mana) { w.command(h, { type: "cast", spell: heal.id, target: h.id }); return; }
      const t = snakes.filter(s => s.active).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
      if (t) w.command(h, { type: "attack", target: t.id });
    }
  });
  check(snakes.every(s => !s.alive), `as 3 cobras morreram (vidas: ${snakes.map(s => Math.max(0, Math.ceil(s.hp))).join(",")})`);
  check(h.alive, `herói vivo (${Math.ceil(h.hp)}/${h.maxHp}), experiência ${h.exp}`);
}

function angerSkrakan(): void {
  console.log("\n[falha] irritar Skrakan");
  const r = start(fighterHero());
  run(r, 5);
  const sk = r.b.host.units.get(32)!;
  r.b.world.damage(r.b.hero, sk, 1);
  run(r, 40);
  check(r.outcome && !r.outcome.ok && r.outcome.cause === 5, `falha causa 5 (${JSON.stringify(r.outcome)})`);
}

function heroDies(): void {
  console.log("\n[falha] herói morre");
  const r = start(fighterHero());
  run(r, 5);
  const hy = r.b.host.units.get(23)!;
  r.b.world.setDiplomacy(5, 1, 1);
  r.b.world.teleport(r.b.hero, hy.cx + 2, hy.cy);
  run(r, 20 * 120, () => { if (r.b.hero.state === "dead") return true; });
  check(!r.b.hero.alive, "herói morto pelo Troll.4 (Hydun)");
  check(r.outcome && !r.outcome.ok && r.outcome.cause === 2, `falha causa 2 (${JSON.stringify(r.outcome)})`);
}

function trollChallenge(): void {
  console.log("\n[script] desafio do troll");
  const r = start(fighterHero());
  const w = r.b.world, h = r.b.hero;
  run(r, 3);
  const hy = r.b.host.units.get(23)!, young = r.b.host.units.get(24)!;
  check(hy.maxHp === 1229, `Hydun é o Troll.4 (vida ${hy.maxHp})`);
  check(young.maxHp === 300, `troll jovem é Troll nível 1 (vida ${young.maxHp})`);
  w.teleport(h, hy.cx + 3, hy.cy + 1); run(r, 30);
  check(r.messages.includes(2), "mensagem 2 (desafio)");
  w.teleport(h, 62, 17); run(r, 30);
  check(w.diplomacyValue(5, 1) === 1 && r.subs.get(1) === 1, "na arena Hydun fica hostil e o subobjetivo 1 aparece");
  w.kill(young, h); run(r, 30);
  check(w.diplomacyValue(5, 1) === 0 && r.subs.get(1) === 2, "troll jovem morto: Hydun neutro, subobjetivo 1 cumprido");
  w.teleport(h, hy.cx + 3, hy.cy + 1); run(r, 30);
  check(r.messages.includes(3) && r.gold === 700, `prêmio de 700 de ouro (${r.gold})`);
}

function report(): void {
  const f = start(fighterHero()).b.hero, m = start(mageHero()).b.hero;
  console.log(`\nherói guerreiro: vida ${f.maxHp}, acerto ${f.stats.attack}, dano ${f.stats.damage.min}-${f.stats.damage.max}, defesa ${f.stats.defense}, absorção ${f.stats.absorption}, vel ${f.stats.speed.toFixed(2)} c/s`);
  console.log(`heroína maga: vida ${m.maxHp}, mana ${m.maxMana}, defesa ${m.stats.defense}, magias ${m.spells.map(s => `${s.name} ${s.min}-${s.max}`).join(", ")}, cajado ${m.weaponSpell?.name} ${m.weaponSpell?.min}-${m.weaponSpell?.max}`);
}

/** Duelos informativos (não falham o teste): mostram se os opcionais fortes estão coerentes. */
function duel(label: string, hero: HeroState, scriptId: number, enemyPlayer: number): void {
  const r = start(hero);
  const h = r.b.hero, w = r.b.world, e = r.b.host.units.get(scriptId)!;
  run(r, 3);
  w.setDiplomacy(enemyPlayer, 1, 1);
  w.teleport(h, e.cx - 1, e.cy);
  const t = run(r, 20 * 300, () => {
    if (!h.alive || !e.alive) return true;
    if (h.order.type === "none") w.command(h, { type: "attack", target: e.id });
  });
  console.log(`  duelo ${label} x ${e.name}: ${h.alive ? "herói venceu" : "herói morreu"} em ${(t / 20).toFixed(0)} s (herói ${Math.max(0, Math.ceil(h.hp))}/${h.maxHp}, ${e.name} ${Math.max(0, Math.ceil(e.hp))}/${e.maxHp})`);
}

report();
console.log("\n[info] duelos 1x1 sem poções");
duel("guerreiro", fighterHero(), 5, 7);
duel("guerreiro", fighterHero(), 24, 6);
duel("maga", mageHero(), 5, 7);
autopilot("guerreiro", fighterHero());
autopilot("maga", mageHero());
fightSnakes("guerreiro", fighterHero());
fightSnakes("maga", mageHero());
angerSkrakan();
heroDies();
trollChallenge();
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
