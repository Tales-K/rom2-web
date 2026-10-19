/**
 * Teste headless da missão 20 ("The Road to Kaarg", scenario/20.alm; estágio 20: sem cidade, começa depois do vídeo do teleport).
 * Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/mission20.ts)
 *
 * Script (data/scripts/mission_20.txt): Drop Location (41,67); vitória = herói a < 4 células de (42,10) ("Road to Kaarg": mensagem 11,
 * subobjetivo 2 cumprido, Mission Complete); derrota 5 = diplomacia jogador 1 -> 3 (Villagers) deixa de ser paz (bater em camponês);
 * derrota 2 = herói morto. Opcionais: chegar perto do "bom bandido" (unit 62) abre o subobjetivo 1 ("Destroy the outlaws!", grupo 6 = 6
 * bandidos do jogador 5), mensagem 6 + 250 e a variável de cenário 772 = 1 (libera a missão 21); matar o grupo 6 cumpre o subobjetivo 1.
 * Casos:
 *   1. guerreiro e maga: piloto automático por waypoints (Drop Location -> Kaarg) = Mission Complete, herói vivo
 *   2. parado 30 s: nada acontece (sem desfecho)
 *   3. bom bandido: subobjetivo 1 ativo, mensagem 6/250, variável 772; matar os 6 bandidos cumpre o subobjetivo 1
 *   4. luta real (informativa): guerreiro contra os bandidos
 *   5. bater em camponês -> falha 5; herói morre (monstros do início) -> falha 2
 *   6. mortos-vivos: mensagem 3 (camponês assustado) e 8 (todos mortos); cavaleiros (jogador 6) continuam em paz
 */
import type { HeroState } from "../../core/state";
import { defaultHero } from "../../mission/setup";
import { loadData, proc, run, startRun, type Run } from "./loader";

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const ID = 20;
const data = await loadData(ID);
const classes = data.classes?.classes;

function fighterHero(): HeroState {
  const h = defaultHero();
  const c = classes?.["male_fighter"]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  return h;
}
function mageHero(): HeroState {
  const c = classes?.["female_mage"]?.attributes ?? { body: 19, reaction: 23, mind: 30, spirit: 42 };
  return {
    name: "Maga", sex: "female", heroClass: "mage", face: 0, stats: { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit },
    elementSkill: "fire", gold: 0, inventory: [], equipment: { weapon: "33037", mail: "63277", cuirass: "63531" }, spells: [], difficulty: "normal",
  };
}

/** Rota até Kaarg (estrada: sul -> leste -> norte -> cavaleiros -> ponte guardada em (42,10)). */
const WAYPOINTS = [{ x: 44, y: 55 }, { x: 55, y: 52 }, { x: 60, y: 44 }, { x: 56, y: 34 }, { x: 47, y: 29 }, { x: 43, y: 20 }, { x: 42, y: 10 }];
const KAARG = { x: 42, y: 10 };

/** Piloto: anda pelos waypoints (reemite a ordem quando o herói fica parado); se parar para lutar, o motor revida sozinho. */
function walkRoute(r: Run, maxSec = 300): { ticks: number; minHp: number; visited: number } {
  const h = r.b.hero, w = r.b.world;
  let wp = 0, minHp = h.hp;
  const ticks = run(r, maxSec * 20, () => {
    if (!h.alive) return true;
    minHp = Math.min(minHp, h.hp);
    while (wp < WAYPOINTS.length - 1 && Math.hypot(h.x - WAYPOINTS[wp]!.x, h.y - WAYPOINTS[wp]!.y) < 4) wp++;
    if (h.order.type !== "move") w.command(h, { type: "move", x: WAYPOINTS[wp]!.x, y: WAYPOINTS[wp]!.y });
  });
  return { ticks, minHp, visited: wp };
}

function autopilot(label: string, hero: HeroState): void {
  console.log(`\n[${label}] piloto automático: Drop Location -> Kaarg`);
  const r = startRun(data, hero);
  const h = r.b.hero;
  check(Math.abs(h.cx - 41) <= 3 && Math.abs(h.cy - 67) <= 3, `herói nasce no Drop Location (41,67): ${h.cx},${h.cy}`);
  const { ticks, minHp, visited } = walkRoute(r);
  check(r.outcome?.ok === true, `missão cumprida (${(ticks / 20).toFixed(0)} s simulados; desfecho ${JSON.stringify(r.outcome)})`);
  check(h.alive, `herói vivo (vida mínima ${Math.ceil(minHp)}/${h.maxHp})`);
  check(visited >= WAYPOINTS.length - 1, "passou por todos os waypoints");
  check(Math.hypot(h.x - KAARG.x, h.y - KAARG.y) < 5, `terminou perto de Kaarg (${h.cx},${h.cy})`);
  check(r.messages.includes(1) && r.messages.includes(11), `mensagens 1 (início) e 11 (estrada) (${r.messages.join(",")})`);
  check(r.subs.get(2) === 2, "subobjetivo 2 (encontrar Kaarg) cumprido");
  check(r.b.world.diplomacyValue(1, 3) === 0, "camponeses continuam em paz");
}

function idle(): void {
  console.log("\n[parado] 30 s no Drop Location");
  const r = startRun(data, fighterHero());
  run(r, 20 * 30);
  check(!r.outcome, "sem desfecho enquanto o herói não anda");
  check(r.messages.includes(1) && r.subs.get(2) === 1, `mensagem 1 e subobjetivo 2 ativo (msgs ${r.messages.join(",")}, subs ${[...r.subs].join(";")})`);
  check(r.b.hero.alive && r.b.hero.hp === r.b.hero.maxHp, "ninguém ataca o herói no ponto de chegada");
  check(!r.logs.some(l => /não implementa/.test(l.msg)), "script sem ações sem suporte");
}

function goodBrigand(): void {
  console.log("\n[opcional] bom bandido + destruir os fora-da-lei");
  const r = startRun(data, fighterHero());
  const w = r.b.world, h = r.b.hero, host = r.b.host;
  const bandits = host.groups.get(6) ?? [];
  check(bandits.length === 6 && bandits.every(b => b.player === 5), "grupo 6 = 6 bandidos do jogador 5");
  run(r, 5);
  check(!r.subs.has(1), "subobjetivo 1 ainda oculto");
  const good = host.units.get(62)!;
  w.teleport(h, good.cx + 2, good.cy);
  run(r, 20);
  check(r.subs.get(1) === 1, `subobjetivo 1 ("Destroy the outlaws!") ativo (subs ${[...r.subs].join(";")})`);
  check(r.messages.includes(6) && r.messages.includes(250), `mensagens 6 e 250 (${r.messages.join(",")})`);
  check(host.scenarioVars.get(772) === 1, "variável de cenário 772 = 1 (libera a missão 21)");
  for (const b of bandits) w.kill(b, h);
  run(r, 40);
  check(r.subs.get(1) === 2, "bandidos mortos: subobjetivo 1 cumprido");
  check(!r.outcome, "matar bandidos não encerra a missão");
}

function fightOutlaws(label: string, hero: HeroState): void {
  const r = startRun(data, hero);
  const w = r.b.world, h = r.b.hero;
  const bandits = r.b.host.groups.get(6) ?? [];
  w.teleport(h, 19, 22);
  const t = run(r, 20 * 240, () => {
    if (!h.alive || bandits.every(b => !b.alive)) return true;
    if (h.order.type === "none" || h.order.type === "hold") {
      const tg = bandits.filter(b => b.alive).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
      if (tg) w.command(h, { type: "attack", target: tg.id });
    }
  });
  console.log(`  info: ${label} x 6 bandidos: ${bandits.every(b => !b.alive) ? "venceu" : h.alive ? "empate" : "morreu"} em ${(t / 20).toFixed(0)} s (herói ${Math.max(0, Math.ceil(h.hp))}/${h.maxHp}, bandidos vivos ${bandits.filter(b => b.alive).length})`);
}

function failures_(): void {
  console.log("\n[falha] bater em camponês");
  let r = startRun(data, fighterHero());
  run(r, 5);
  const peasant = r.b.host.units.get(41)!;
  check(peasant.player === 3, "unit 41 é camponês (jogador 3)");
  r.b.world.damage(r.b.hero, peasant, 1);
  run(r, 40);
  check(r.outcome && !r.outcome.ok && r.outcome.cause === 5, `falha causa 5 (${JSON.stringify(r.outcome)})`);

  console.log("\n[falha] herói morre");
  r = startRun(data, fighterHero());
  run(r, 5);
  const h = r.b.hero;
  const mon = r.b.host.groups.get(13)![0]!;
  // lobos do início (grupo 13): cercam o herói ferido; o golpe final é dado direto (o duelo é aleatório e o herói regenera)
  h.hp = 1;
  r.b.world.teleport(h, mon.cx - 2, mon.cy);
  run(r, 20 * 5);
  r.b.world.damage(mon, h, 9999);
  run(r, 20);
  check(!h.alive, `herói morto pelos monstros (${mon.name})`);
  run(r, 40 + 30);
  check(r.outcome && !r.outcome.ok && r.outcome.cause === 2, `falha causa 2 (${JSON.stringify(r.outcome)})`);
}

function undeadAndKnights(): void {
  console.log("\n[script] mortos-vivos, camponês assustado e cavaleiros");
  const r = startRun(data, fighterHero());
  const w = r.b.world, h = r.b.hero, host = r.b.host;
  run(r, 5);
  const afraid = host.units.get(46)!;
  check((host.groups.get(8) ?? []).length === 2, "grupo 8 = 2 mortos-vivos");
  w.teleport(h, afraid.cx + 2, afraid.cy);
  run(r, 20);
  check(r.messages.includes(3), "mensagem 3 (camponês assustado, mortos-vivos vivos)");
  for (const u of host.groups.get(8) ?? []) w.kill(u, h);
  run(r, 20);
  check(r.messages.includes(8), "mensagem 8 (mortos-vivos destruídos)");
  const leader = host.units.get(58)!;
  w.teleport(h, leader.cx + 2, leader.cy);
  run(r, 20 * 20);
  check(r.messages.includes(10), "mensagem 10 (cavaleiros)");
  check(w.diplomacyValue(1, 6) === 0 && w.diplomacyValue(6, 1) === 0 && h.alive && !r.outcome, "cavaleiros em paz com o herói");
}

autopilot("guerreiro", fighterHero());
autopilot("maga", mageHero());
idle();
goodBrigand();
fightOutlaws("guerreiro", fighterHero());
fightOutlaws("maga", mageHero());
failures_();
undeadAndKnights();
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
