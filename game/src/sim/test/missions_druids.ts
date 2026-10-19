/**
 * Pilotos automáticos headless das missões do acampamento druida e do bloco livre: 50, 51, 52, 53, 60, 61, 62 e 63
 * (scripts em data/scripts/mission_<n>.txt). Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/missions_druids.ts)
 * Opcional: `npx tsx src/sim/test/missions_druids.ts 52` roda só a missão pedida.
 *
 * Padrão de missions_kaarg.ts: monta a missão como a cena (loader.ts startRun) com Igles (10002) e Dina (10003) no grupo, leva o herói pelos
 * gatilhos do script (teletransporta entre os pontos) e MATA (w.kill) o que o script exige morto; cobre as falhas do script e as do motor
 * (causa 2 = herói, 3 = Igles, 4 = Dina). Trechos reais (enxame, escolta, armadilha de teleporte, bando de morcegos) provam caminho/IA.
 *   50 Ancient Forest: fala com caçador/aldeão/druidas (msgs 2, 5, 8) -> o enxame de zumbis (grupo 7) marcha até o druida 40; matá-lo cumpre a
 *      sub 1; o druida 40 pede a cratera (sub 2); grupo 5 morto -> agradece e vence. O refém ogro (44, vida 0) acorda ao chegar perto e libera a 52
 *      (vars[780] = 1). Falhas 5 (druida 40 morto), 2, 3, 4.
 *   51 Rebel Battalion: 3 grupos de necromantes (2, 3, 4) mortos, falar com o cavaleiro 14 -> vitória. Falha 5 = cavaleiros atacados.
 *   52 The Hermit: ancião, druida solitário 43 (exige Os mortos), guarda 1 (122,97), druida chefe 44 (morcegos grupo 6 mortos), guarda 2;
 *      ossos (44,61) = vitória. Falhas 5 (passar a guarda), 6, 7, 8, 9.
 *   53 The Traveler: ogro 55 morto -> druida 54 volta para casa (40,123) -> druida chefe 89 -> armadilha de teleporte (15,121) -> 178 em (9,15).
 *   60 Desert Star: orcs (grupo 5) mortos + Dina na cratera + Greenpeace (60) -> vitória. Falha 5.
 *   61 Village Under Attack: orcs (grupo 5) mortos + herói perto do ancião 23. Falhas 5, 6, 7.
 *   62 Outlaws Camp: fugitivos (jogador 2) mortos -> vitória; druida solitário/succubus; falha 5 = atacar druidas.
 *   63 Talena's Request: Xara (40) pede ajuda, bando morto, amuleto (item 60 = 3668) devolvido, torre -> vitória. Falhas 5, 6.
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { defaultHero } from "../../mission/setup";
import { loadData, json, proc, run, startRun, type Run } from "./loader";
import { availableMissions, availableTowns, enterLocation, innPatrons, isDone, newCampaign, onMissionResult, talkTo } from "../../campaign/engine";
import type { CampaignData, CampaignState } from "../../campaign/types";

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const classes = (await loadData(50)).classes?.classes;
function fighterHero(): HeroState {
  const h = defaultHero();
  const c = classes?.["male_fighter"]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  return h;
}

// ------------------------------------------------------------------------------------------- utilidades
const unit = (r: Run, id: number): Unit => {
  const u = r.b.host.units.get(id);
  if (!u) throw new Error(`unidade de script ${id} inexistente`);
  return u;
};
const group = (r: Run, g: number): Unit[] => r.b.host.groups.get(g) ?? [];
const dist = (a: Unit, b: Unit): number => Math.hypot(a.x - b.x, a.y - b.y);
/** teletransporta `who` para ao lado da unidade de script `id` (1 célula) */
function beside(r: Run, who: Unit, id: number): void { const t = unit(r, id); r.b.world.teleport(who, t.cx + 1, t.cy); }
function at(r: Run, who: Unit, x: number, y: number): void { r.b.world.teleport(who, x, y); }
/** deixa o script rodar (o runtime avalia a cada 0,5 s = 10 tiques) */
const settle = (r: Run, ticks = 25): number => run(r, ticks, () => {
  // o grupo (herói, Igles, Dina) é mantido vivo nos trechos teletransportados; mortes provocadas por `w.kill` seguem valendo
  for (const id of [10001, 10002, 10003]) { const u = r.b.host.units.get(id); if (u && u.alive) u.hp = u.maxHp; }
});
function killAll(r: Run, us: Unit[]): void { for (const u of us) if (u.alive) r.b.world.kill(u, r.b.hero); }
const failCause = (r: Run): number | undefined => (r.outcome && !r.outcome.ok ? r.outcome.cause : undefined);
const noUnsupported = (r: Run): boolean => !r.logs.some(l => /não implementa|não suportado/.test(l.msg));
const sub = (r: Run, n: number): number => r.subs.get(n) ?? 0;
const has = (r: Run, m: number): boolean => r.messages.includes(m);
const svar = (r: Run, i: number): number => r.b.host.scenarioVars.get(i) ?? 0;
const BOTH = [10002, 10003];

/** Mata o herói / Igles / Dina e confere a causa de falha do motor (2 / 3 / 4) */
function companionsFail(start: () => Run): void {
  let r = start();
  r.b.world.kill(r.b.hero); run(r, 80);
  check(failCause(r) === 2, `herói morto: falha causa 2 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 10002)); run(r, 30);
  check(failCause(r) === 3, `Igles morto: falha causa 3 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 10003)); run(r, 30);
  check(failCause(r) === 4, `Dina morta: falha causa 4 (${JSON.stringify(r.outcome)})`);
}

// ------------------------------------------------------------------------------------------- contrato com o motor de campanha
const campaignData = json<CampaignData>("data/campaign.json");
/** O que a MissionScene manda no MissionResult: variáveis de cenário alteradas pelo script + subobjetivos em 752+n. */
function sceneVars(r: Run): Record<string, number> {
  const v: Record<string, number> = {};
  for (const [k, x] of r.b.host.scenarioVars) v[String(k)] = x;
  for (const [n, x] of r.subs) v[String(752 + n)] = x;
  return v;
}
/** Campanha de um herói (mago?, mulher?) jogada pelo caminho mais curto até a missão `m` ficar disponível (conversas na taverna incluídas). */
function campaignUpTo(m: number, mage: boolean, female: boolean): CampaignState {
  const data = campaignData!;
  const st = newCampaign(data, { mage, female }, 1);
  for (let i = 0; i < 60 && !availableMissions(st).includes(m); i++) {
    for (const t of availableTowns(st)) { enterLocation(st, ["T", t]); for (const p of innPatrons(st, data, t)) if (p.kind === 0 || p.kind === 3) talkTo(st, data, p); }
    if (availableMissions(st).includes(m)) break;
    const next = availableMissions(st).sort((a, b) => a - b).find(x => !isDone(st, x) && x !== m);
    if (next == null) break;
    onMissionResult(st, data, { id: next, outcome: "complete" });
  }
  return st;
}

// ------------------------------------------------------------------------------------------- 50
async function m50(): Promise<void> {
  console.log("\n=== Missão 50 — The Ancient Forest ===");
  const data = await loadData(50);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const knight = unit(r, 10002), dina = unit(r, 10003);
  const druid = unit(r, 40), ogre = unit(r, 44);
  check(knight.player === 1 && dina.player === 1, "Igles (10002) e Dina (10003) no grupo do herói");
  check(Math.abs(h.cx - 128) <= 3 && Math.abs(h.cy - 25) <= 3, `herói nasce no Drop Location (128,25): ${h.cx},${h.cy}`);
  settle(r, 20 * 5);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  const swarm = group(r, 7), crater = group(r, 5);
  check(swarm.length === 14 && swarm.every(u => u.player === 5), "enxame (grupo 7) = 14 mortos-vivos do jogador 5");
  check(crater.length === 6 && crater.every(u => u.player === 5), "cratera (grupo 5) = 6 necromantes");
  check(!has(r, 20) && svar(r, 780) === 0, "refém ogro (vida 0 no mapa) ainda não acordou: 52 não foi liberada");
  // caçador e aldeão
  beside(r, h, 29); settle(r);
  check(has(r, 2), "caçador: msg 2");
  beside(r, knight, 30); settle(r);
  check(has(r, 6), "aldeão com Igles: msg 6");
  // druidas: a conversa (fêmea) dispara o enxame
  check(swarm.every(u => u.ai?.type !== "swarm"), "enxame parado antes da conversa");
  beside(r, dina, 31); settle(r);
  check(has(r, 10) && sub(r, 1) === 1, `druida com Dina: msg 10 e sub 1 ativo (${[...r.subs].join(";")})`);
  check(swarm.every(u => u.ai?.type === "swarm"), "enxame marcha rumo ao druida (33,102)");
  // marcha real: 40 s, o enxame se aproxima
  const c0 = swarm.reduce((s, u) => s + Math.hypot(u.x - 33, u.y - 102), 0) / swarm.length;
  run(r, 20 * 40, () => { druid.hp = druid.maxHp; h.hp = h.maxHp; });
  const c1 = swarm.filter(u => u.alive).reduce((s, u) => s + Math.hypot(u.x - 33, u.y - 102), 0) / Math.max(1, swarm.filter(u => u.alive).length);
  console.log(`  info: distância média do enxame a (33,102): ${c0.toFixed(0)} -> ${c1.toFixed(0)} em 40 s`);
  check(c1 < c0 - 3, "enxame anda para o alvo");
  beside(r, h, 32); settle(r);
  check(!has(r, 11) && !r.outcome, "druida macho depois do enxame já marchando: sem fala nova (v74 != 0), sem desfecho");
  // enxame morto, cratera viva: sub 1 cumprido; druida 40 pede a cratera
  killAll(r, swarm); settle(r);
  check(sub(r, 1) === 2, "enxame morto: sub 1 cumprido");
  beside(r, h, 40); settle(r);
  check(has(r, 14) && sub(r, 2) === 1, "druida 40: msg 14 e sub 2 ativo");
  check(!r.outcome, "falta a cratera");
  killAll(r, crater); settle(r);
  check(sub(r, 2) === 2, "cratera morta: sub 2 cumprido");
  beside(r, h, 40); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 17), `druida agradece: Mission Complete + msg 17 (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  // refém ogro: acorda quando o grupo chega perto; libera a 52 (vars[780] = 1) para o motor de campanha
  console.log("[50] refém ogro (missão 52) e Igles/Dina");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10);
  beside(r, h, 44); settle(r);
  check(has(r, 20) && has(r, 250) && svar(r, 780) === 1, `refém acorda: msgs 20/250 e vars[780] = 1 (${svar(r, 780)})`);
  // o druida macho (32) também dispara o enxame (v74), por qualquer um do grupo
  r = start(); settle(r, 5); beside(r, r.b.hero, 32); settle(r);
  check(has(r, 11) && sub(r, 1) === 1 && group(r, 7).every(u => u.ai?.type === "swarm"), "druida macho: msg 11, sub 1 e enxame em marcha");
  // Igles chegando na cratera: o druida 40 conversa com ele (msg 15) e Dina (16)
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); killAll(r, group(r, 7)); settle(r);
  beside(r, unit(r, 10002), 40); settle(r);
  check(has(r, 15) && !r.outcome, "Igles perto do druida 40: msg 15 (a cratera ainda vive)");
  at(r, unit(r, 10002), 100, 25); killAll(r, group(r, 5)); settle(r);
  beside(r, unit(r, 10003), 40); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 19), `Dina fala com o druida: msg 19 + Mission Complete (${JSON.stringify(r.outcome)})`);

  // contrato com o motor de campanha: 52 só aparece com vars[780] = 1 (refém ogro acordado) no MissionResult
  {
    const withOgre = start(); settle(withOgre, 5); beside(withOgre, withOgre.b.hero, 44); settle(withOgre);
    const stA = campaignUpTo(50, false, false);
    onMissionResult(stA, campaignData!, { id: 50, outcome: "complete", scenarioVars: sceneVars(withOgre) });
    check(availableMissions(stA).includes(52), "campanha: 50 vencida com o refém acordado (vars[780] = 1) libera a missão 52");
    const noOgre = start(); settle(noOgre, 5);
    const stB = campaignUpTo(50, false, false);
    onMissionResult(stB, campaignData!, { id: 50, outcome: "complete", scenarioVars: sceneVars(noOgre) });
    check(isDone(stB, 50) && !availableMissions(stB).includes(52), "campanha: 50 vencida sem acordar o refém: a 52 não aparece (opcional)");
  }

  console.log("[50] falhas");
  r = start(); settle(r, 10); r.b.world.kill(unit(r, 40)); settle(r, 30);
  check(failCause(r) === 5, `druida mercenário morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 51
async function m51(): Promise<void> {
  console.log("\n=== Missão 51 — Rebel Battalion ===");
  const data = await loadData(51);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const cap = unit(r, 14);
  check(Math.abs(h.cx - 82) <= 3 && Math.abs(h.cy - 88) <= 3, `herói nasce no Drop Location (82,88): ${h.cx},${h.cy}`);
  check([2, 3, 4].every(g => group(r, g).length >= 7 && group(r, g).every(u => u.player === 2)), "grupos 2, 3 e 4 = necromantes (jogador 2)");
  check(group(r, 1).length === 14 && group(r, 1).every(u => u.player === 3) && cap.player === 3, "cavaleiros (grupo 1, jogador 3) cativos; unit 14 = capitão");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  check([5, 6, 7].every(g => group(r, g).every(u => u.ai?.type === "swarm")), "bandos 5, 6 e 7 (monstros) em marcha (swarm)");
  // falar com os cavaleiros antes de limpar os necromantes não adianta
  beside(r, h, 14); settle(r);
  check(!has(r, 2) && !r.outcome, "cavaleiros com necromantes vivos: nada acontece");
  // necromantes: um grupo de cada vez; a contagem passa por 1, 2, 3
  killAll(r, group(r, 2)); killAll(r, group(r, 3)); settle(r);
  check(!r.outcome && !has(r, 2), "2 de 3 grupos mortos: sem desfecho");
  killAll(r, group(r, 4)); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 2), `3 grupos mortos + herói perto: msg 2 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[51] Igles/Dina e falhas");
  r = start(); settle(r, 5);
  for (const g of [2, 3, 4]) killAll(r, group(r, g));
  settle(r, 5); at(r, unit(r, 10002), cap.cx + 1, cap.cy); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 3), `Igles fala com o capitão: msg 3 + Mission Complete (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5);
  for (const g of [2, 3, 4]) killAll(r, group(r, g));
  settle(r, 5); beside(r, unit(r, 10003), 14); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 4), `Dina fala com o capitão: msg 4 + Mission Complete (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10); w.damage(h, unit(r, 14), 1); settle(r, 30);
  check(failCause(r) === 5, `bater nos cavaleiros: falha causa 5 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 52
async function m52(): Promise<void> {
  console.log("\n=== Missão 52 — The Hermit ===");
  const data = await loadData(52);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const elder = unit(r, 42), alone = unit(r, 43), chief = unit(r, 44);
  check(Math.abs(h.cx - 106) <= 3 && Math.abs(h.cy - 15) <= 3, `herói nasce no Drop Location (106,15): ${h.cx},${h.cy}`);
  const os = () => w.units.filter(u => u.player === 5 && u.alive);
  const bats = group(r, 6);
  check(os().length === 13 && bats.length === 9, `${os().length} unidades do jogador 5 (Os) e ${bats.length} morcegos (grupo 6)`);
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(3, 1) === 0 && w.diplomacyValue(4, 1) === 0, "druidas e aldeões em paz com o herói");
  settle(r, 20 * 5);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  beside(r, h, 42); settle(r);
  check(has(r, 2), "ancião: msg 2");
  // druida solitário: conversa -> sub 1; só vira "OK" (msg 19) com todos os Os mortos
  beside(r, h, 43); settle(r);
  check(has(r, 3) && sub(r, 1) === 1, "druida solitário: msg 3 e sub 1");
  check(!has(r, 19), "Os vivos: o druida solitário ainda não agradece");
  killAll(r, os()); settle(r, 25);
  check(has(r, 19) && sub(r, 1) === 2, "Os mortos: msg 19 e sub 1 cumprido");
  // guarda 1 (122,97): depois do druida solitário, msg 20 (e passar por (107,100) deixa de ser falha)
  at(r, h, 122, 97); settle(r);
  check(has(r, 20) && !has(r, 6) && !r.outcome, "guarda 1 liberado: msg 20, sem falha");
  at(r, h, 107, 100); settle(r);
  check(!r.outcome, "passar o ponto (107,100) depois do druida solitário não é falha");
  // druida chefe: fala (msg 10, sub 2); morcegos mortos -> msg 13, sub 2 cumprido
  beside(r, h, 44); settle(r);
  check(has(r, 10) && sub(r, 2) === 1, "druida chefe: msg 10 e sub 2");
  check(!has(r, 13), "morcegos vivos: o druida chefe ainda não conclui");
  at(r, h, 83, 107); settle(r);
  check(!has(r, 13), "(sem morcegos mortos) sem msg 13");
  killAll(r, bats); settle(r, 25);
  check(has(r, 13) && sub(r, 2) === 2, "morcegos mortos: msg 13 e sub 2 cumprido");
  // guarda 2 (61,117): depois do druida chefe, msg 8; (44,115) deixa de ser falha
  at(r, h, 61, 117); settle(r);
  check(has(r, 8) && !has(r, 7), "guarda 2 liberado: msg 8");
  at(r, h, 44, 115); settle(r);
  check(!r.outcome, "passar o ponto (44,115) depois do druida chefe não é falha");
  // ossos do eremita: vitória
  at(r, h, 44, 62); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 16), `ossos (44,61): msg 16 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(Object.keys(Object.fromEntries(r.b.host.scenarioVars)).length === 0, "52 não grava variáveis de cenário");

  console.log("[52] variantes (Igles, Dina, guardas) e falhas");
  r = start(); w = r.b.world;
  settle(r, 5); at(r, unit(r, 10002), 44, 62); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 17), `Igles nos ossos: msg 17 + Mission Complete (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); at(r, unit(r, 10003), 45, 61); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 18), `Dina nos ossos: msg 18 + Mission Complete (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 43); settle(r);
  check(has(r, 4) && sub(r, 1) === 1, "Igles com o druida solitário: msg 4 e sub 1");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 43); settle(r);
  check(has(r, 5) && sub(r, 1) === 1, "Dina com o druida solitário: msg 5 e sub 1");
  r = start(); settle(r, 5); at(r, unit(r, 10002), 83, 108); settle(r);
  check(has(r, 11) && sub(r, 2) === 1, "Igles com o druida chefe: msg 11 e sub 2");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 44); settle(r);
  check(has(r, 12) && sub(r, 2) === 1, "Dina com o druida chefe: msg 12 e sub 2");
  // guarda 1 sem o druida solitário: msg 6
  r = start(); settle(r, 5); at(r, r.b.hero, 122, 97); settle(r);
  check(has(r, 6) && !r.outcome, "guarda 1 sem o druida solitário: msg 6 (aviso)");
  r = start(); settle(r, 5); at(r, r.b.hero, 61, 117); settle(r);
  check(has(r, 7) && !r.outcome, "guarda 2 sem o druida chefe: msg 7 (aviso)");

  r = start(); settle(r, 5); at(r, r.b.hero, 107, 100); settle(r);
  check(failCause(r) === 5, `passar a guarda 1 sem o druida solitário: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); at(r, r.b.hero, 44, 115); settle(r);
  check(failCause(r) === 5, `passar a guarda 2 sem o druida chefe: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 44), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar o druida chefe: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 43), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar o druida solitário: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 42), 1); settle(r, 30);
  check(failCause(r) === 7, `atacar o ancião: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 43)); settle(r, 30);
  check(failCause(r) === 8, `druida solitário morto: falha causa 8 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 44)); settle(r, 30);
  check(failCause(r) === 9, `druida chefe morto: falha causa 9 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 53
async function m53(): Promise<void> {
  console.log("\n=== Missão 53 — The Traveler ===");
  const data = await loadData(53);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const putnik = unit(r, 178), saved = unit(r, 54), ogre = unit(r, 55), main = unit(r, 89);
  const necros = () => w.units.filter(u => u.player === 3 && u.alive);
  check(Math.abs(h.cx - 120) <= 3 && Math.abs(h.cy - 13) <= 3, `herói nasce no Drop Location (120,13): ${h.cx},${h.cy}`);
  check(putnik.player === 1 && putnik !== h && putnik.alive, `viajante Putnik (178) é unidade do jogador (${putnik.name})`);
  check(necros().length === 30, `${necros().length} unidades do jogador 3 (necromantes)`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // o druida grita: o ogro que o prende vive
  at(r, h, 122, 40); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "druida preso: msg 2 e sub 1 ativo");
  beside(r, h, 54); settle(r);
  check(!has(r, 3), "ogro vivo: o druida preso não segue o herói");
  w.kill(ogre, h); settle(r);
  check(has(r, 3), "ogro morto: druida salvo fala com o herói (msg 3)");
  check(saved.ai?.type === "follow" && (saved.ai as { unit: number }).unit === h.id, `druida salvo segue o herói (ai ${JSON.stringify(saved.ai)})`);
  // escolta real: 30 s a pé; o druida acompanha
  const s0 = { x: saved.x, y: saved.y };
  w.command(h, { type: "move", x: 120, y: 60, attackMove: true });
  run(r, 20 * 30, () => {
    for (const u of [h, saved]) if (u.alive) u.hp = u.maxHp;
    if (h.alive && h.order.type === "none") w.command(h, { type: "move", x: 120, y: 60, attackMove: true });
  });
  const walked = Math.hypot(saved.x - s0.x, saved.y - s0.y);
  console.log(`  info: druida salvo andou ${walked.toFixed(0)} células, a ${dist(saved, h).toFixed(0)} do herói`);
  check(saved.alive && walked > 8 && dist(saved, h) < 14, "druida salvo acompanha o herói andando");
  check(!has(r, 12), "ponte quebrada (71,17) ainda não visitada");
  at(r, h, 71, 19); settle(r);
  check(has(r, 12), "ponte quebrada: msg 12");
  // volta para casa: druida a < 10 de (40,123): para, sub 1 cumprido
  at(r, saved, 44, 123); at(r, h, 45, 124); settle(r);
  check(sub(r, 1) === 2 && saved.ai?.type === "guard", `druida em casa: sub 1 cumprido, para (ai ${JSON.stringify(saved.ai)})`);
  beside(r, h, 89); settle(r);
  check(has(r, 6) && sub(r, 2) === 1, "druida chefe: msg 6 e sub 2 ativo");
  check(!has(r, 9), "necromantes vivos: o druida chefe ainda não manda para a armadilha");
  // necromantes (jogador 3) mortos: feras ficam neutras, sub 2 cumprido
  check(w.diplomacyValue(1, 4) === 1 && w.diplomacyValue(2, 4) === 1, "feras hostis ao herói e aos druidas");
  killAll(r, necros()); settle(r, 40);
  check(w.diplomacyValue(1, 4) === 0 && w.diplomacyValue(4, 1) === 0, "necromantes mortos: feras neutras com o herói");
  check(w.diplomacyValue(2, 4) === 0 && w.diplomacyValue(4, 2) === 0, "e com os druidas");
  check(sub(r, 2) === 2, "sub 2 cumprido");
  check(has(r, 9), "druida chefe agora fala da armadilha (msg 9)");
  check(w.traps.length === 0, "armadilha ainda não armada");
  // o druida chefe anda até a armadilha (15,121)/(17,121): ao chegar, arma o teleporte
  const t = run(r, 20 * 40, () => { if (w.traps.length) return true; });
  check(w.traps.length === 1 && w.traps[0]!.spell.kind === "teleport", `druida chefe arma a armadilha de teleporte em ${(t / 20).toFixed(0)} s (druida em ${main.cx},${main.cy})`);
  check(noUnsupported(r), "script sem ações sem suporte (Set trap incluso)");
  // quem pisa em (15,121) vai parar em (13,22)
  at(r, putnik, 15, 121); settle(r, 10);
  check(Math.abs(putnik.cx - 13) <= 3 && Math.abs(putnik.cy - 22) <= 3, `Putnik pisa na armadilha e aparece em (13,22): ${putnik.cx},${putnik.cy}`);
  check(!r.outcome, "ainda não chegou à saída (9,15)");
  w.command(putnik, { type: "move", x: 9, y: 15 });
  const t2 = run(r, 20 * 60, () => { putnik.hp = putnik.maxHp; h.hp = h.maxHp; if (putnik.order.type === "none" && !r.outcome) w.command(putnik, { type: "move", x: 9, y: 15 }); });
  check(r.outcome?.ok === true, `Putnik chega à saída (9,15) em ${(t2 / 20).toFixed(0)} s: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(r.gold === 40000, `recompensa de 40000 de ouro (${r.gold})`);

  console.log("[53] variantes e falhas");
  // Igles e Dina libertam o druida: v80 = 2 / 3 e o druida chefe fala com quem o trouxe
  r = start(); w = r.b.world;
  settle(r, 5); w.kill(unit(r, 55), r.b.hero); beside(r, unit(r, 10002), 54); settle(r);
  check(has(r, 4) && unit(r, 54).ai?.type === "follow" && (unit(r, 54).ai as { unit: number }).unit === unit(r, 10002).id, "Igles: msg 4 e o druida o segue");
  at(r, unit(r, 54), 44, 123); beside(r, unit(r, 10002), 89); settle(r);
  check(has(r, 7) && sub(r, 2) === 1, "druida chefe com Igles (quem trouxe o druida): msg 7 e sub 2");
  r = start(); w = r.b.world;
  settle(r, 5); w.kill(unit(r, 55), r.b.hero); beside(r, unit(r, 10003), 54); settle(r);
  check(has(r, 5), "Dina: msg 5");
  at(r, unit(r, 54), 44, 123); beside(r, unit(r, 10003), 89); settle(r);
  check(has(r, 8) && sub(r, 2) === 1, "druida chefe com Dina: msg 8 e sub 2");
  // sem salvar o druida: o druida chefe só lamenta
  r = start(); settle(r, 5); beside(r, r.b.hero, 89); settle(r);
  check(has(r, 15) && sub(r, 2) === 0, "druida chefe sem o druida salvo: msg 15, sem sub 2");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 89); settle(r);
  check(has(r, 16), "Igles sem o druida salvo: msg 16");
  // atacar druidas não encerra a missão (o gatilho do script não tem ação)
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 89), 1); settle(r, 30);
  check(!r.outcome && r.b.world.diplomacyValue(2, 1) === 1, "atacar o druida chefe: guerra declarada, sem falha (gatilho 'Druids attaked' vazio no script)");

  r = start(); settle(r, 5); r.b.world.kill(unit(r, 54)); settle(r, 30);
  check(failCause(r) === 7, `druida preso morto antes de voltar para casa: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 89)); settle(r, 30);
  check(failCause(r) === 6, `druida chefe morto: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 178)); settle(r, 30);
  check(failCause(r) === 8, `Putnik morto: falha causa 8 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 60
async function m60(): Promise<void> {
  console.log("\n=== Missão 60 — The Desert Star ===");
  const data = await loadData(60);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const dina = unit(r, 10003), green = unit(r, 60);
  check(Math.abs(h.cx - 15) <= 3 && Math.abs(h.cy - 128) <= 3, `herói nasce no Drop Location (15,128): ${h.cx},${h.cy}`);
  settle(r, 20 * 3);
  const bats = group(r, 9), orcs = group(r, 5), ogre = group(r, 2), scout = group(r, 10);
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1 e sub 1 (achar a cratera) ativo");
  check(bats.length === 3 && bats.every(u => u.phased), "morcegos (grupo 9) escondidos até a emboscada");
  check(ogre.every(u => u.ai?.type === "patrol") && group(r, 6).every(u => u.ai?.type === "patrol"), "ogro e goblin em patrulha");
  check(orcs.length === 7 && green.player === 6 && green.maxHp >= 200, `Greenpeace (60, jogador 6, ${green.maxHp} de vida) e 7 orcs hostis (grupo 5)`);
  check(w.diplomacyValue(5, 6) === 0 && w.diplomacyValue(6, 5) === 0, "orcs e Greenpeace em paz até o herói chegar");
  // batedor goblin
  check(scout.every(u => u.ai?.type !== "move"), "batedor goblin parado");
  at(r, h, 24, 120); settle(r);
  check(scout.every(u => u.ai?.type === "move"), "herói perto do batedor (24,123): ele corre para (110,16)");
  // poço fedorento (23,66)
  at(r, h, 23, 67); settle(r);
  check(w.areas.length >= 1 && w.areas.every(a => Number(a.spell) === 6 && Math.hypot(a.x - 23, a.y - 66) <= 1), `poço (23,66): ${w.areas.length} nuvens de Poison Cloud`);
  at(r, h, 30, 70);
  // cratera: só Dina conta
  at(r, h, 47, 69); settle(r);
  check(!has(r, 2) && sub(r, 1) === 1, "o herói na cratera não basta (é a Dina que conta)");
  at(r, dina, 47, 69); settle(r);
  check(has(r, 2) && sub(r, 1) === 2 && sub(r, 2) === 1, "Dina na cratera: msg 2, sub 1 cumprido, sub 2 (achar o orc) ativo");
  // oásis
  at(r, h, 109, 94); settle(r);
  check(has(r, 6), "oásis (109,94): msg 6");
  // emboscada de morcegos (73,93)
  at(r, dina, 72, 92); at(r, h, 73, 93); settle(r, 12);
  check(bats.every(u => !u.phased && u.alive), "morcegos entram em campo ao chegar em (73,93)");
  check(bats.every(u => u.order.type === "attack" && u.order.target === dina.id), "e atacam a maga (Dina)");
  check(!has(r, 3), "morcegos vivos: sem msg 3");
  killAll(r, bats); settle(r);
  check(has(r, 3), "morcegos mortos: msg 3");
  // orcs x Greenpeace
  at(r, h, 122, 30); settle(r);
  check(w.diplomacyValue(5, 6) === 1 && w.diplomacyValue(6, 5) === 1, "perto de Greenpeace (122,19): orcs e ele ficam em guerra");
  check(!has(r, 4) && !r.outcome, "orcs vivos: Greenpeace ainda não conta a história");
  at(r, h, 122, 24); at(r, dina, 122, 21); settle(r);
  check(!r.outcome, "Dina perto de Greenpeace, mas os orcs vivem: sem desfecho");
  killAll(r, orcs); settle(r, 30);
  check(has(r, 4), "orcs mortos: msg 4 (história de Greenpeace)");

  check(r.outcome?.ok === true && has(r, 5), `Dina com Greenpeace: msg 5 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(sub(r, 1) === 2 && sub(r, 2) === 2, "subobjetivos 1 e 2 cumpridos");
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[60] luta real orcs x Greenpeace (info), ordem das falas e falhas");
  {
    const q = start(); const qg = unit(q, 60), qo = group(q, 5);
    settle(q, 5); at(q, q.b.hero, 122, 30); settle(q);
    const t = run(q, 20 * 60, () => { q.b.hero.hp = q.b.hero.maxHp; return !qg.alive || qo.every(u => !u.alive); });
    console.log(`  info: orcs x Greenpeace: ${qg.alive ? "Greenpeace vivo" : "Greenpeace morto"}, ${qo.filter(u => u.alive).length}/${qo.length} orcs vivos após ${(t / 20).toFixed(0)} s`);
  }
  // os orcs morrendo antes da conversa: a fala 5 só vem depois da 4 (v70 > 0)
  r = start(); settle(r, 5); at(r, r.b.hero, 122, 24); at(r, unit(r, 10003), 122, 21); settle(r);
  check(!r.outcome, "Dina perto de Greenpeace antes de matar os orcs: nada");
  r = start(); settle(r, 5); killAll(r, group(r, 5)); settle(r);
  check(has(r, 4) && !r.outcome, "orcs mortos longe de Greenpeace: msg 4, sem desfecho");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 60)); settle(r, 30);
  check(failCause(r) === 5, `Greenpeace morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 61
async function m61(): Promise<void> {
  console.log("\n=== Missão 61 — Village Under Attack ===");
  const data = await loadData(61);
  const start = () => startRun(data, fighterHero());
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const elder = unit(r, 23), cap = unit(r, 31);
  check(Math.abs(h.cx - 11) <= 3 && Math.abs(h.cy - 70) <= 3, `herói nasce no Drop Location (11,70): ${h.cx},${h.cy}`);
  const orcs = group(r, 5), gob = group(r, 4), knights = group(r, 3), peasants = group(r, 2);
  check(orcs.length === 10 && gob.length === 7 && orcs.concat(gob).every(u => u.player === 2), "orcs (grupo 5) e goblins (grupo 4) = monstros (jogador 2)");
  check(knights.length === 8 && knights.every(u => u.player === 4) && cap.player === 4, "cavaleiros (grupo 3, jogador 4) e o capitão 31");
  settle(r, 10);
  check(has(r, 2) && sub(r, 1) === 1 && !r.outcome, "msg 2 e sub 1 (goblins) ativo");
  check(peasants.every(u => u.ai?.type === "patrol") && knights.every(u => u.ai?.type === "move" || u.ai?.type === "guard"), "aldeão em patrulha; cavaleiros marcham para o ancião (18,59)");
  // marcha real dos cavaleiros até o ancião: msg 1 e eles saem para os goblins
  const t = run(r, 20 * 60, () => { if (has(r, 1)) return true; });
  console.log(`  info: capitão chega ao ancião em ${(t / 20).toFixed(0)} s`);
  check(has(r, 1), "capitão perto do ancião: msg 1");
  settle(r, 15);
  check(knights.filter(u => u.alive).every(u => u.ai?.type === "swarm"), "cavaleiros partem contra os goblins (56,53)");
  check(!has(r, 3) && orcs.every(u => u.ai?.type !== "swarm"), "orcs ainda quietos");
  // herói fala com o ancião: os orcs atacam a aldeia
  at(r, h, 17, 61); settle(r);
  check(has(r, 3) && orcs.every(u => u.ai?.type === "swarm"), "herói perto do ancião: msg 3 e orcs marcham para a aldeia (18,60)");
  check(!r.outcome, "orcs vivos: sem desfecho");
  // orcs mortos com o herói longe: sub 2 cumprido mas sem vitória
  at(r, h, 11, 70); killAll(r, orcs); settle(r);
  check(sub(r, 2) === 2 && !r.outcome, "orcs mortos com o herói longe: sub 2 cumprido, sem desfecho");
  killAll(r, gob); settle(r);
  check(sub(r, 1) === 2, "goblins mortos: sub 1 cumprido");
  at(r, h, 17, 61); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 4), `herói perto do ancião: msg 4 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(r.gold === 100000, `recompensa de 100000 de ouro (${r.gold})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[61] aldeia sitiada (luta real, info) e falhas");
  {
    const q = start(); const qe = unit(q, 23);
    settle(q, 5); at(q, q.b.hero, 17, 61); settle(q);
    const qo = group(q, 5);
    const t2 = run(q, 20 * 90, () => { q.b.hero.hp = q.b.hero.maxHp; return !qe.alive || qo.every(u => !u.alive) || !!q.outcome; });
    console.log(`  info: orcs x aldeia por ${(t2 / 20).toFixed(0)} s: ancião ${qe.alive ? "vivo" : "morto"}, ${qo.filter(u => u.alive).length}/${qo.length} orcs vivos, desfecho ${JSON.stringify(q.outcome)}`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 23)); settle(r, 30);
  check(failCause(r) === 5, `ancião morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, group(r, 2)[0]!, 1); settle(r, 30);
  check(failCause(r) === 6, `atacar aldeões: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 31), 1); settle(r, 30);
  check(failCause(r) === 7, `atacar os cavaleiros: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); r.b.world.kill(r.b.hero); run(r, 80);
  check(failCause(r) === 2, `herói morto: falha causa 2 (${JSON.stringify(r.outcome)})`);
  companionsFail(() => startRun(data, fighterHero(), undefined, { companions: BOTH }));
}

// ------------------------------------------------------------------------------------------- 62
async function m62(): Promise<void> {
  console.log("\n=== Missão 62 — The Outlaws Camp ===");
  const data = await loadData(62);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const alone = unit(r, 24), succ = unit(r, 25), leader = unit(r, 61), d60 = unit(r, 60), d62 = unit(r, 62);
  const escapers = () => w.units.filter(u => u.player === 2 && u.alive);
  check(Math.abs(h.cx - 60) <= 3 && Math.abs(h.cy - 15) <= 3, `herói nasce no Drop Location (60,15): ${h.cx},${h.cy}`);
  check(escapers().length === 19 && alone.player === 3 && leader.player === 3 && succ.player === 4, `${escapers().length} fugitivos (jogador 2); druidas jogador 3; súcubo ${succ.name} (jogador 4)`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // druida solitário: conversa (msg 2) -> sub 1; o pagamento só vem com o súcubo morto
  beside(r, h, 24); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "druida solitário: msg 2 e sub 1 ativo");
  check(!has(r, 5) && r.gold === 0, "súcubo vivo: sem recompensa");
  w.kill(succ, h); settle(r);
  check(has(r, 5) && sub(r, 1) === 2 && r.gold === 10000, `súcubo morto: msg 5, sub 1 cumprido, 10000 de ouro (${r.gold})`);
  // líder dos druidas: dois druidas (60 e 62) passam para o jogador
  check(d60.player === 3 && d62.player === 3, "druidas 60 e 62 começam com os druidas");
  beside(r, h, 61); settle(r);
  check(has(r, 7) && d60.player === 1 && d62.player === 1, `líder dos druidas: msg 7; unidades 60 e 62 passam para o jogador (${d60.player}/${d62.player})`);
  check(!r.outcome, "fugitivos vivos: sem desfecho");
  // fugitivos: um sobra -> sem vitória; todos mortos -> Mission Complete
  const esc = escapers();
  killAll(r, esc.slice(1)); settle(r, 25);
  check(!r.outcome, "sobra um fugitivo: sem desfecho");
  killAll(r, esc); settle(r, 25);
  check(r.outcome?.ok === true, `todos os fugitivos mortos: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[62] Igles, Dina e falhas");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 24); settle(r);
  check(has(r, 3) && sub(r, 1) === 1, "Igles com o druida solitário: msg 3");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 24); settle(r);
  check(has(r, 4) && sub(r, 1) === 1, "Dina com o druida solitário: msg 4");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 61); settle(r);
  check(has(r, 8) && unit(r, 60).player === 1, "Igles com o líder: msg 8");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 61); settle(r);
  check(has(r, 6) && unit(r, 62).player === 1, "Dina com o líder: msg 6");
  // atacar druidas
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 24), 1); settle(r, 30);
  check(failCause(r) === 5, `atacar o druida solitário: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 61), 1); settle(r, 30);
  check(failCause(r) === 5, `atacar o líder dos druidas: falha causa 5 (${JSON.stringify(r.outcome)})`);
  // luta real contra os fugitivos (info)
  {
    const q = start(); const qh = q.b.hero;
    settle(q, 5);
    const esc2 = q.b.world.units.filter(u => u.player === 2 && u.alive);
    const nearest = esc2.reduce((a, b) => (dist(a, qh) < dist(b, qh) ? a : b));
    console.log(`  info: fugitivo mais perto do início: ${nearest.name} a ${dist(nearest, qh).toFixed(0)} células de (60,15)`);
  }
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 63
async function m63(): Promise<void> {
  console.log("\n=== Missão 63 — Talena's Request ===");
  const data = await loadData(63);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const knight = unit(r, 10002), dina = unit(r, 10003), xara = unit(r, 40);
  const monsters = group(r, 12), tower = group(r, 16);
  check(Math.abs(h.cx - 38) <= 3 && Math.abs(h.cy - 131) <= 3, `herói nasce no Drop Location (38,131): ${h.cx},${h.cy}`);
  check(xara.player === 2 && monsters.length === 6 && tower.length === 7 && monsters.concat(tower).every(u => u.player === 3), "Xara (40, humanos) e os bandos 12 (6) e 16 (7) de monstros");
  const amulet = w.loot.find(l => l.items.includes("3668"));
  check(!!amulet && amulet.x === 104 && amulet.y === 124, `amuleto (item 60 = 3668) no monte de tesouro em (104,124): ${amulet?.x},${amulet?.y}`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  check(monsters.every(u => u.ai?.type !== "swarm"), "bando 12 parado enquanto o grupo está no começo");
  // sair do ponto de partida (> 30 células de (39,135)) solta o bando rumo à aldeia
  const party = [h, knight, dina];
  const xy = (x: number, y: number) => party.forEach((u, i) => at(r, u, x + i, y));
  xy(39, 104); settle(r);
  check(monsters.every(u => u.ai?.type === "swarm"), "grupo longe do ponto de partida: o bando marcha para a aldeia (43,88)");
  beside(r, h, 40); settle(r);
  check(has(r, 2) && !has(r, 5), "Xara pede ajuda com o bando vivo: msg 2");
  // marcha real do bando (40 s)
  const m0 = monsters.reduce((a, u) => a + Math.hypot(u.x - 43, u.y - 88), 0) / monsters.length;
  run(r, 20 * 40, () => { for (const u of [h, knight, dina, xara]) if (u.alive) u.hp = u.maxHp; });
  const m1 = monsters.filter(u => u.alive).reduce((a, u) => a + Math.hypot(u.x - 43, u.y - 88), 0) / Math.max(1, monsters.filter(u => u.alive).length);
  console.log(`  info: distância média do bando à aldeia: ${m0.toFixed(0)} -> ${m1.toFixed(0)} em 40 s`);
  check(m1 < m0 - 5, "o bando anda para a aldeia");
  killAll(r, monsters); xy(40, 80); settle(r);
  check(has(r, 5) && xara.player === 1 && sub(r, 1) === 1, `bando morto: Xara fala (msg 5), passa para o jogador e sub 1 ativo (jogador ${xara.player})`);
  check(xara.ai?.type === "defend", `Xara acompanha o grupo (ai ${JSON.stringify(xara.ai)})`);
  // ela segue o herói andando
  w.command(h, { type: "move", x: 45, y: 70 });
  run(r, 20 * 15, () => { for (const u of [h, knight, dina, xara]) if (u.alive) u.hp = u.maxHp; if (h.order.type === "none") w.command(h, { type: "move", x: 45, y: 70 }); });
  console.log(`  info: Xara a ${dist(xara, h).toFixed(0)} células do herói em (${h.cx},${h.cy})`);
  check(dist(xara, h) < 12, "Xara anda atrás do herói");
  // cidade em ruínas (81,42): Xara reconhece
  at(r, xara, 81, 42); settle(r);
  check(has(r, 8) && !has(r, 9), "Xara na cidade em ruínas: msg 8");
  // tesouro: o herói pega o saco do amuleto (104,124)
  at(r, h, 104, 126); w.command(h, { type: "pickup", x: 104, y: 124 }); run(r, 60);
  check(h.items.includes("3668"), `herói pega o amuleto (itens ${h.items.join(",")})`);
  check(!has(r, 9), "o amuleto ainda não está com Xara");
  at(r, xara, 50, 50); at(r, h, 51, 51); settle(r, 25);
  check(has(r, 9) && sub(r, 1) === 2 && sub(r, 2) === 1, "amuleto devolvido a Xara: msg 9, sub 1 cumprido, sub 2 ativo");
  check(!h.items.includes("3668") && !w.loot.some(l => l.items.includes("3668")), "amuleto retirado de todos (item 60)");
  // torre (40,18): precisa do bando 16 morto
  at(r, xara, 40, 19); at(r, h, 41, 20); settle(r);
  check(xara.player === 1 && !r.outcome, "Xara na torre com o bando 16 vivo: continua com o jogador");
  killAll(r, tower); settle(r);
  check(xara.player === 2 && xara.ai?.type === "hold" && sub(r, 2) === 2, `bando 16 morto: Xara volta aos humanos e fica na torre, sub 2 cumprido (jogador ${xara.player})`);
  // fala final: o herói está ao lado, o gatilho do herói vence (msg 10)
  settle(r, 25);
  check(r.outcome?.ok === true && has(r, 10), `herói com Xara na torre: msg 10 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(Object.keys(sceneVars(r)).every(k => Number(k) >= 752), "63 não grava variáveis de cenário (só subobjetivos)");

  // campanha: a 63 abre a cadeia de Talena (74 guerreiro, 75 guerreira, 76 maga, 77 mago) conforme (mago, mulher)
  console.log("[63] cadeia de Talena na campanha");
  const want: Array<[boolean, boolean, number]> = [[false, false, 74], [false, true, 75], [true, true, 76], [true, false, 77]];
  for (const [mage, female, m] of want) {
    const st = campaignUpTo(63, mage, female);
    check(availableMissions(st).includes(63), `(${mage ? "mago" : "guerreiro"}${female ? " mulher" : ""}) a 63 está disponível no estágio 60`);
    onMissionResult(st, campaignData!, { id: 63, outcome: "complete", scenarioVars: sceneVars(r) });
    enterLocation(st, ["T", 2]);
    for (const p of innPatrons(st, campaignData!, 2).filter(x => x.npc === 2022)) talkTo(st, campaignData!, p);
    check(availableMissions(st).includes(m) && [74, 75, 76, 77].filter(x => availableMissions(st).includes(x)).length === 1, `Talena (Kaarg) oferece só a missão ${m}`);
  }

  console.log("[63] variantes e falhas");
  r = start(); w = r.b.world;
  settle(r, 5); killAll(r, group(r, 12)); at(r, unit(r, 10003), 40, 82); settle(r, 15);
  check(unit(r, 40).player === 1 && has(r, 7), "Dina com Xara (bando morto): msg 7 e Xara passa para o jogador");
  r = start(); w = r.b.world;
  settle(r, 5); killAll(r, group(r, 12)); at(r, unit(r, 10002), 40, 82); settle(r, 15);
  check(has(r, 6) && unit(r, 40).player === 1, "Igles com Xara (bando morto): msg 6");
  r = start(); w = r.b.world;
  settle(r, 5); at(r, unit(r, 10003), 40, 82); settle(r, 15);
  check(has(r, 4) && !has(r, 7), "Dina com Xara e o bando vivo: msg 4 (pede ajuda)");
  // Dina com Xara na torre, herói longe: msg 12
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); killAll(r, group(r, 12)); beside(r, h, 40); settle(r, 15);
  const x2 = unit(r, 40), d2 = unit(r, 10003), k2 = unit(r, 10002);
  at(r, x2, 50, 50); at(r, h, 51, 51); h.items.push("3668"); settle(r, 25);
  check(has(r, 9), "(preparo) amuleto devolvido");
  killAll(r, group(r, 16)); at(r, k2, 80, 40); at(r, h, 60, 60); at(r, x2, 40, 19); at(r, d2, 41, 20); settle(r, 15);
  check(x2.player === 2 && !r.outcome || r.outcome?.ok === true, "(preparo) Xara na torre, de volta aos humanos");
  settle(r, 25);
  check(r.outcome?.ok === true && has(r, 12) && !has(r, 10), `Dina com Xara na torre (herói longe): msg 12 + Mission Complete (${JSON.stringify(r.outcome)})`);

  r = start(); settle(r, 5); r.b.world.kill(unit(r, 40)); settle(r, 30);
  check(failCause(r) === 5, `Xara morta: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 40), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar Xara/aldeões: falha causa 6 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- execução
const only = proc.argv.slice(2).map(Number).filter(n => n > 0);
const all: [number, () => Promise<void>][] = [[50, m50], [51, m51], [52, m52], [53, m53], [60, m60], [61, m61], [62, m62], [63, m63]];
for (const [id, fn] of all) {
  if (only.length && !only.includes(id)) continue;
  try { await fn(); } catch (e) { failures++; console.log(`  FALHOU: missão ${id} lançou exceção: ${(e as Error).stack ?? e}`); }
}
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
