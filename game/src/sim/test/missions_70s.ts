/**
 * Pilotos automáticos headless das missões do bloco 70: 70, 71, 72, 73, 74, 75, 76 e 77 (scripts em data/scripts/mission_<n>.txt).
 * Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/missions_70s.ts)
 * Opcional: `npx tsx src/sim/test/missions_70s.ts 71` roda só a missão pedida.
 *
 * Padrão de missions_druids.ts: monta a missão como a cena (loader.ts startRun) com Igles (10002) e Dina (10003) no grupo, leva o herói pelos
 * gatilhos do script (teletransporta entre os pontos) e MATA (w.kill) o que o script exige morto; cobre as falhas do script e as do motor
 * (causa 2 = herói, 3 = Igles, 4 = Dina). Trechos reais (marcha de ogros, caminho dos caçadores pela ponte, escolta da moça, druida que segue)
 * provam caminho/IA. Cada missão confere também o contrato com o motor de campanha (MissionResult.scenarioVars -> onMissionResult).
 *   70 The Elf: elfo (54) fala com o herói (sub 1), necromante (grupo 37) morto (sub 2) -> coroa; druidas (128) trazem os monstros (jogador 6) como
 *      aliados; com vars[778] != 0 (esteve na 80) a coroa vem do portador 207. Falhas 5 (druidas), 6 (elfo atacado), 7 (elfo morto).
 *   71 Ill-Tempered Squirrels: ogros (grupos 1-4) mortos libera os esquilos; rei (40) fala (pacto) e, com os 4 bandos mortos, de novo (a Wall of Earth
 *      da ponte (66,50) some: Tile Spell Duration); caçadores (41) vão até o ancião (63,16); ouro 100000. Falhas 5, 6, 7.
 *   72 The Disappearing Caravans: 4 runas (itens 68-71) em orcs/monstros; Dina as leva aos painéis (102,78) e (20,47); ouro 500000. Só falhas do motor.
 *   73 A Rebel Stronghold: jogador 6 (defensores do castelo) morto = vitória; aldeões (jogador 5) atacados = falha 5.
 *   74 Minge the Shaman (guerreiro): orcs mortos (resta o xamã 102) + falar com ele; ogro meio morto (35) acorda; falha 5 = xamã morto.
 *   75 The Old Warrior (guerreira): filho 81, líder 66 (Igles perto dele), moça 67 segue Igles até o filho; falhas 5, 6, 7, 8.
 *   76 The Dangerous Forest (maga): druida 57, druida sábio 62 (caçadores mortos), segue o grupo até (46,17); falhas 5, 6.
 *   77 A Mage's Spirit (mago): necromante 139 -> bom necromante 144 (passa para o jogador) -> amigo 175 -> túmulo (48,25); falhas 5, 6, 7, 8.
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { defaultHero } from "../../mission/setup";
import { pickLines } from "../../mission/messages";
import { loadData, json, proc, run, startRun, type Run } from "./loader";
import { availableMissions, availableTowns, enterLocation, innPatrons, isDone, newCampaign, onMissionResult, talkTo } from "../../campaign/engine";
import type { CampaignData, CampaignState } from "../../campaign/types";

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const classes = (await loadData(70)).classes?.classes;
/** Herói de uma das 4 variantes (classe x sexo) com os atributos iniciais de classes.json. */
function heroOf(mage: boolean, female: boolean): HeroState {
  const h = defaultHero();
  h.sex = female ? "female" : "male"; h.heroClass = mage ? "mage" : "fighter";
  h.name = mage ? (female ? "Aldora" : "Aldor") : (female ? "Alda" : "Igles");
  const c = classes?.[`${female ? "female" : "male"}_${mage ? "mage" : "fighter"}`]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  if (mage) { h.elementSkill = "fire"; h.equipment = {}; h.spells = []; }
  return h;
}
const fighterHero = (): HeroState => heroOf(false, false);
interface Variant { mage: boolean; female: boolean; label: string }
const VARIANTS: Variant[] = [
  { mage: false, female: false, label: "guerreiro" }, { mage: false, female: true, label: "guerreira" },
  { mage: true, female: true, label: "maga" }, { mage: true, female: false, label: "mago" },
];

// ------------------------------------------------------------------------------------------- utilidades
const unit = (r: Run, id: number): Unit => {
  const u = r.b.host.units.get(id);
  if (!u) throw new Error(`unidade de script ${id} inexistente`);
  return u;
};
const group = (r: Run, g: number): Unit[] => r.b.host.groups.get(g) ?? [];
const dist = (a: Unit, b: Unit): number => Math.hypot(a.x - b.x, a.y - b.y);
const distTo = (u: Unit, x: number, y: number): number => Math.hypot(u.x - x, u.y - y);
/** teletransporta `who` para ao lado da unidade de script `id` (1 célula) */
function beside(r: Run, who: Unit, id: number): void { const t = unit(r, id); r.b.world.teleport(who, t.cx + 1, t.cy); }
function at(r: Run, who: Unit, x: number, y: number): void { r.b.world.teleport(who, x, y); }
/** deixa o script rodar (o runtime avalia a cada 0,5 s = 10 tiques); o grupo (herói, Igles, Dina e quem virar do jogador) é mantido vivo */
const settle = (r: Run, ticks = 25): number => run(r, ticks, () => {
  for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; // inclui quem passa para o jogador (necromantes da 77)
});
function killAll(r: Run, us: Unit[]): void { for (const u of us) if (u.alive) r.b.world.kill(u, r.b.hero); }
const failCause = (r: Run): number | undefined => (r.outcome && !r.outcome.ok ? r.outcome.cause : undefined);
const noUnsupported = (r: Run): boolean => !r.logs.some(l => /não implementa|não suportado/.test(l.msg));
const sub = (r: Run, n: number): number => r.subs.get(n) ?? 0;
const has = (r: Run, m: number): boolean => r.messages.includes(m);
const svar = (r: Run, i: number): number => r.b.host.scenarioVars.get(i) ?? 0;
const BOTH = [10002, 10003];

/** Mata o herói / Igles / Dina e confere a causa de falha do motor (2 / 3 / 4) */
function companionsFail(start: () => Run, dina = true): void {
  let r = start();
  r.b.world.kill(r.b.hero); run(r, 80);
  check(failCause(r) === 2, `herói morto: falha causa 2 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 10002)); run(r, 30);
  check(failCause(r) === 3, `Igles morto: falha causa 3 (${JSON.stringify(r.outcome)})`);
  if (dina) {
    r = start(); settle(r, 5); r.b.world.kill(unit(r, 10003)); run(r, 30);
    check(failCause(r) === 4, `Dina morta: falha causa 4 (${JSON.stringify(r.outcome)})`);
  }
}

/** Toda fala disparada tem texto (seção event<N>) para o herói da variante (tags iammale/iamfemale/...) */
function messagesHaveText(r: Run, hero: HeroState): boolean {
  const miss = r.messages.filter(n => !pickLines(r.data.texts?.sections[`event${n}`] as never, hero).length);
  if (miss.length) console.log(`    sem texto para as falas ${[...new Set(miss)].join(",")}`);
  return miss.length === 0;
}

// ------------------------------------------------------------------------------------------- contrato com o motor de campanha
const campaignData = json<CampaignData>("data/campaign.json");
/** O que a MissionScene manda no MissionResult: variáveis de cenário alteradas pelo script (menos as semeadas) + subobjetivos em 752+n. */
function sceneVars(r: Run, seeded: Record<number, number> = {}): Record<string, number> {
  const v: Record<string, number> = {};
  for (const [k, x] of r.b.host.scenarioVars) if (seeded[k] !== x) v[String(k)] = x;
  for (const [n, x] of r.subs) v[String(752 + n)] = x;
  return v;
}
/** Campanha de um herói (mago?, mulher?) jogada pelo caminho mais curto até a missão `m` ficar disponível (conversas na taverna incluídas). */
function campaignUpTo(m: number, mage: boolean, female: boolean): CampaignState {
  const data = campaignData!;
  const st = newCampaign(data, { mage, female }, 1);
  for (let i = 0; i < 80 && !availableMissions(st).includes(m); i++) {
    for (const t of availableTowns(st)) { enterLocation(st, ["T", t]); for (const p of innPatrons(st, data, t)) if (p.kind === 0 || p.kind === 3) talkTo(st, data, p); }
    if (availableMissions(st).includes(m)) break;
    const next = availableMissions(st).sort((a, b) => a - b).find(x => !isDone(st, x) && x !== m);
    if (next == null) break;
    onMissionResult(st, data, { id: next, outcome: "complete" });
  }
  return st;
}
/** A missão `m` está disponível para o herói, o resultado `r` (vitória) a conclui e nada de estranho entra nas variáveis de cenário. */
function campaignContract(m: number, r: Run, mage = false, female = false, seeded: Record<number, number> = {}): void {
  const st = campaignUpTo(m, mage, female);
  check(availableMissions(st).includes(m), `campanha: ${m} disponível para ${mage ? "mag" : "guerreir"}${female ? "a" : "o"}`);
  const vars = sceneVars(r, seeded);
  check(Object.keys(vars).every(k => Number(k) >= 752 || Number(k) === 780), `MissionResult.scenarioVars só com subobjetivos (752+n): ${JSON.stringify(vars)}`);
  onMissionResult(st, campaignData!, { id: m, outcome: "complete", scenarioVars: vars });
  check(isDone(st, m) && !availableMissions(st).includes(m), `campanha: ${m} concluída pelo MissionResult`);
}

// ------------------------------------------------------------------------------------------- 70
async function m70(): Promise<void> {
  console.log("\n=== Missão 70 — The Elf ===");
  const data = await loadData(70);
  const start = (seed?: Record<number, number>) => startRun(data, fighterHero(), seed, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const knight = unit(r, 10002), dina = unit(r, 10003), elf = unit(r, 54), druid = unit(r, 128);
  const necro = group(r, 37);
  check(Math.abs(h.cx - 131) <= 3 && Math.abs(h.cy - 125) <= 3, `herói nasce no Drop Location (131,125): ${h.cx},${h.cy}`);
  check(elf.player === 3 && druid.player === 5 && necro.length === 1 && necro[0]!.player === 4, "elfo (54, jogador 3), druida (128, jogador 5) e 1 necromante (grupo 37)");
  check(elf.items.includes("3664") && unit(r, 207).items.includes("18118"), "elfo carrega a coroa 12 (item 56 = 3664); o portador 207 a coroa inteira (18118)");
  settle(r, 20 * 3);
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1 e sub 1 (achar o elfo) ativo");
  check(group(r, 11).every(u => !u.active), "dragão (grupo 11) fora de fase até o pacto com os druidas");
  check(w.diplomacyValue(3, 1) === 0 && w.diplomacyValue(5, 1) === 0 && w.diplomacyValue(6, 1) === 1, "elfo e druidas em paz; os monstros dos druidas (jogador 6) hostis");
  // marcha real do ogro solitário rumo ao ponto de partida (grupo 14, swarm2) e patrulha do troll (grupo 23)
  const ogre = group(r, 14)[0]!;
  check(ogre.ai?.type === "swarm" && group(r, 23).every(u => u.ai?.type === "patrol"), "ogro solitário em marcha (swarm2) e troll em patrulha");
  const d0 = dist(ogre, h);
  run(r, 20 * 30, () => { h.hp = h.maxHp; knight.hp = knight.maxHp; dina.hp = dina.maxHp; });
  console.log(`  info: ogro solitário a ${d0.toFixed(0)} -> ${dist(ogre, h).toFixed(0)} células do herói em 30 s`);
  check(dist(ogre, h) < d0 - 3 || !ogre.alive, "o ogro anda para o herói");
  r = start(); w = r.b.world; h = r.b.hero;
  // Igles e Dina não convencem o elfo: só a primeira recusa fala (v72); quem libera a missão é o herói
  settle(r, 5); beside(r, unit(r, 10002), 54); settle(r);
  check(has(r, 4) && !has(r, 3) && sub(r, 1) === 1 && !sub(r, 2), "Igles com o elfo: msg 4 (recusa); a busca (sub 1) continua");
  beside(r, unit(r, 10003), 54); settle(r);
  check(!has(r, 5), "Dina logo depois: o elfo não repete a recusa (v72)");
  beside(r, h, 54); settle(r);
  check(has(r, 3) && sub(r, 1) === 2 && sub(r, 2) === 1, "herói com o elfo: msg 3, sub 1 cumprido, sub 2 (matar o necromante) ativo");
  check(!has(r, 6) && !r.outcome, "sem o necromante morto: sem coroa");
  killAll(r, group(r, 37)); settle(r, 40);
  check(sub(r, 2) === 2 && has(r, 6) && r.outcome?.ok === true, `necromante morto com o herói ao lado: sub 2 cumprido, msg 6 (coroa) e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(h.items.includes("3664") && !unit(r, 54).items.includes("3664"), `herói recebe a coroa 12 do elfo (item 3664) (${h.items.join(",")})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  campaignContract(70, r);

  console.log("[70] variantes da coroa: Dina e Igles recebem; esteve na 80 (vars[778])");
  r = start(); settle(r, 5); beside(r, r.b.hero, 54); settle(r); killAll(r, group(r, 37)); beside(r, unit(r, 10003), 54); at(r, r.b.hero, 100, 100); settle(r, 40);
  check(r.outcome?.ok === true && unit(r, 10003).items.includes("3664") && has(r, 6), `Dina perto do elfo na hora da coroa: ela a recebe (${unit(r, 10003).items.join(",")})`);
  r = start({ 778: 1 }); settle(r, 5); beside(r, r.b.hero, 54); settle(r); killAll(r, group(r, 37)); settle(r, 40);
  check(r.outcome?.ok === true && has(r, 10) && r.b.hero.items.includes("18118") && !r.b.hero.items.includes("3664"), `com 778 = 1 o herói recebe a coroa inteira do portador 207 (18118) e a msg 10 (${r.b.hero.items.join(",")})`);
  check(Object.keys(sceneVars(r, { 778: 1 })).every(k => Number(k) >= 752), "MissionResult não devolve a variável 778 semeada");

  console.log("[70] druidas e monstros aliados");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 128); settle(r);
  check(has(r, 7) && w.diplomacyValue(6, 1) === 2 && w.diplomacyValue(1, 6) === 2, "herói com o druida: msg 7 e os monstros (jogador 6) viram aliados");
  check(group(r, 11).every(u => u.ai?.type === "defend") && group(r, 24).every(u => u.ai?.type === "defend"), "dragão e grupo 24 passam a defender o herói");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 128); settle(r);
  check(has(r, 8) && group(r, 8).every(u => u.ai?.type === "defend") && group(r, 9).every(u => u.ai?.type === "defend"), "Dina com o druida: msg 8, grupos 8 e 9 a defendem");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 128); settle(r);
  check(has(r, 9) && group(r, 10).every(u => u.ai?.type === "defend") && r.b.world.diplomacyValue(6, 1) === 1, "Igles com o druida: msg 9 e o grupo 10 o defende (sem pacto: v71 não sobe)");

  console.log("[70] falhas");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 128), 1); settle(r, 30);
  check(failCause(r) === 5, `atacar os druidas: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 54), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar o elfo: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 54)); settle(r, 30);
  check(failCause(r) === 7, `elfo morto: falha causa 7 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 71
async function m71(): Promise<void> {
  console.log("\n=== Missão 71 — Ill-Tempered Squirrels ===");
  const data = await loadData(71);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const king = unit(r, 40), hunter = unit(r, 41);
  const ogres = [4, 3, 2, 1].map(g => group(r, g)), squirrels = [10, 9, 8, 7].map(g => group(r, g));
  check(Math.abs(h.cx - 63) <= 3 && Math.abs(h.cy - 17) <= 3, `herói nasce no Drop Location (63,17): ${h.cx},${h.cy}`);
  check(ogres.every(g => g.length === 2 && g.every(u => u.player === 4)), "4 bandos de 2 ogros (grupos 4, 3, 2, 1, jogador 4)");
  check(squirrels.every(g => g.length >= 8 && g.every(u => u.player === 5)) && king.player === 6 && hunter.player === 3, "esquilos (grupos 10, 9, 8, 7, jogador 5), rei (40, jogador 6) e caçadores (grupo 5, jogador 3)");
  settle(r, 20 * 6);
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1 e sub 1 (achar a causa) ativo");
  check(group(r, 12).concat(group(r, 14)).every(u => u.ai?.type === "patrol"), "camponeses em patrulha");
  // Make spell effect (Wall of Earth, magia 17) em (66,50) + Tile Spell Duration 30000 (parede mantida)
  const wall = () => w.areas.filter(a => Number(a.spell) === 17 && a.kind === "wall");
  check(wall().length === 1 && (wall()[0]!.cells?.length ?? 0) >= 1, `parede da ponte (Wall of Earth) criada: ${wall()[0]?.cells?.length} células bloqueadas`);
  check(wall()[0]!.until - w.tick > 20 * 60 * 5, `Tile Spell Duration 30000 mantém a parede (${wall()[0]!.until - w.tick} tiques restantes)`);
  check(wall()[0]!.cells!.every(i => w.grid.block[i]! !== 0), "células da parede bloqueadas na grade");
  check(w.areaAt(66, 50, 17) === wall()[0] && w.areaAt(66, 50, 99) === undefined, "areaAt(66,50): a parede da magia 17");
  check(r.b.host.spellOnTile(66, 50, 3) === 1 && r.b.host.spellOnTile(66, 50, 0) === 0, "spellOnTile(66,50) na camada 3 (Wall of Earth) = 1 e na camada 0 = 0");
  // ogros: um bando morto solta o bando de esquilos correspondente (swarm2) e conta em v70
  check(squirrels.every(g => g.every(u => u.ai?.type !== "swarm")), "esquilos parados enquanto os ogros vivem");
  killAll(r, ogres[0]!); settle(r);
  check(squirrels[0]!.every(u => u.ai?.type === "swarm") && squirrels.slice(1).every(g => g.every(u => u.ai?.type !== "swarm")), "bando de ogros 4 morto: só o grupo 10 de esquilos parte (16,14)");
  // primeira conversa com o rei (v70 < 4): pacto com os esquilos
  check(!has(r, 2), "rei ainda não falou");
  beside(r, h, 40); settle(r);
  check(has(r, 2) && sub(r, 1) === 2 && sub(r, 2) === 1, "rei com o herói: msg 2, sub 1 cumprido, sub 2 (liberar as pontes) ativo");
  check(w.diplomacyValue(5, 1) === 2 && w.diplomacyValue(1, 5) === 0 && wall().length === 1, "esquilos aliados do herói (2) e o herói em paz com eles (0); a ponte ainda fechada");
  check(!has(r, 5) && wall().length === 1, "(ainda sem segunda conversa: faltam 3 bandos de ogros) e a ponte fechada");
  for (const k of [1, 2]) killAll(r, ogres[k]!);
  settle(r, 20);
  check(!has(r, 5) && wall().length === 1, "3 de 4 bandos de ogros mortos: sem segunda conversa");
  killAll(r, ogres[3]!); settle(r, 40);
  check(squirrels.every(g => g.every(u => u.ai?.type === "swarm")), "todos os ogros mortos: os 4 bandos de esquilos marcham");
  check(has(r, 5) && !r.outcome, "rei ainda ao lado do herói: segunda conversa (msg 5)");
  check(wall().length === 0, "Tile Spell Duration 1: a parede da ponte (66,50) sumiu");
  check(sub(r, 2) === 2 && sub(r, 3) === 1, "sub 2 (pontes) cumprido e sub 3 (libertar os caçadores) ativo");
  check(noUnsupported(r), "script sem ações sem suporte (Tile Spell Duration)");
  // caçadores: libertados pelo herói perto deles (<= 2); vão ao ancião (63,16)
  at(r, h, hunter.cx + 1, hunter.cy); settle(r);
  check(has(r, 8) && group(r, 5).every(u => u.ai?.type === "move"), "caçadores libertados: msg 8 e voltam para (63,16)");
  at(r, h, 59, 18);
  const t = run(r, 20 * 90, () => { for (const id of [10001, 10002, 10003]) { const u = unit(r, id); if (u.alive) u.hp = u.maxHp; } if (distTo(hunter, 63, 16) <= 4) return true; });
  console.log(`  info: caçador 41 chega ao ancião em ${(t / 20).toFixed(0)} s (da ponte (66,54)): ${hunter.cx},${hunter.cy}`);
  check(hunter.alive && distTo(hunter, 63, 16) <= 4 + 1, `os caçadores atravessam a ponte e chegam ao ancião (${hunter.cx},${hunter.cy})`);
  settle(r, 30);
  check(r.outcome?.ok === true && has(r, 9) && r.gold === 100000 && sub(r, 3) === 2, `ancião agradece: msg 9, sub 3, 100000 de ouro e Mission Complete (${JSON.stringify(r.outcome)}, ouro ${r.gold})`);
  campaignContract(71, r);

  console.log("[71] Igles, Dina e falhas");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 40); settle(r);
  check(has(r, 3) && sub(r, 2) === 1, "Igles com o rei: msg 3 e pacto");
  r = start(); settle(r, 5); beside(r, unit(r, 10003), 40); settle(r);
  check(has(r, 4) && sub(r, 2) === 1, "Dina com o rei: msg 4 e pacto");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 40), 1); settle(r, 30);
  check(failCause(r) === 5, `atacar o rei: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 41), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar os caçadores/camponeses: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); killAll(r, group(r, 8)); settle(r, 30);
  check(failCause(r) === 7, `família de esquilos (grupo 8) toda morta: falha causa 7 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 72
/** runas do script (itens 68-71) -> id do jogo e o monstro/orc que a carrega */
const RUNES = { air: { item: "3676", unit: 69 }, earth: { item: "3677", unit: 78 }, fire: { item: "3678", unit: 165 }, water: { item: "3679", unit: 133 } };
async function m72(): Promise<void> {
  console.log("\n=== Missão 72 — The Disappearing Caravans ===");
  const data = await loadData(72);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  let dina = unit(r, 10003);
  check(Math.abs(h.cx - 18) <= 3 && Math.abs(h.cy - 131) <= 3, `herói nasce no Drop Location (18,131): ${h.cx},${h.cy}`);
  check(Object.values(RUNES).every(x => unit(r, x.unit).items.includes(x.item)), "as 4 runas (itens 68-71 = 3676-3679) estão nos bolsos de 4 orcs/monstros");
  check([3, 4, 5, 6].every(p => w.diplomacyValue(p, 1) === 1 && w.diplomacyValue(1, p) === 1), "os 4 elementais (jogadores 3-6) começam hostis ao herói");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // painel 1 (102,78): Dina sem runa só encontra o painel (msg 9)
  at(r, dina, 98, 78); settle(r);
  check(has(r, 9) && !has(r, 2), "Dina perto do painel 1: msg 9 (acha o painel), sem runa nada acontece");
  // herói acha a runa do ar: msg 6, v74 = 1; passada para a Dina: msg 8, v74 = 2 -> subs 1/2 e depois 3/4
  const carry = (rune: keyof typeof RUNES): void => {
    const x = RUNES[rune], u = unit(r, x.unit);
    const hasBag = u.items.includes(x.item);
    if (u.alive) w.kill(u, h);
    check(hasBag && w.loot.some(l => l.items.includes(x.item)), `${rune}: ${u.name} (${x.unit}) morre e larga a runa (${x.item}) no chão`);
    const l = w.loot.find(q => q.items.includes(x.item))!;
    at(r, h, l.x, l.y + 1); w.command(h, { type: "pickup", x: l.x, y: l.y }); settle(r, 60);
    check(h.items.includes(x.item), `${rune}: herói pega a runa`);
  };
  const toDina = (rune: keyof typeof RUNES): void => {
    const x = RUNES[rune];
    h.items = h.items.filter(i => i !== x.item); dina.items.push(x.item);
  };
  at(r, dina, 18, 130);
  carry("air"); settle(r);
  check(has(r, 6) && has(r, 8) && sub(r, 1) === 1, "herói com a runa do ar: msg 6 e, como a mochila é dele, a Dina já \"a tem\" (msg 8, subs)");
  toDina("air"); settle(r);
  check(has(r, 8) && sub(r, 1) === 1 && sub(r, 2) === 1 && sub(r, 3) === 1 && sub(r, 4) === 1, `runa com a Dina: msg 8, subs 1-4 ativos (${[...r.subs].join(";")})`);
  carry("earth"); toDina("earth"); carry("fire"); toDina("fire"); carry("water"); toDina("water");
  settle(r);
  check(dina.items.length === 4 && !r.outcome, "Dina com as 4 runas, longe dos painéis: sem desfecho");
  // painel 2 (20,47) com a runa da água ainda antes do painel 1: não completa
  at(r, dina, 102, 78); settle(r, 30);
  check(has(r, 2) && has(r, 3) && has(r, 4) && !has(r, 5), "painel 1 (102,78): runas do ar, terra e fogo usadas (msgs 2, 3, 4)");
  check(dina.items.length === 1 && dina.items[0] === RUNES.water.item, "restou a runa da água com a Dina");
  check(has(r, 10), "runa da água no painel 1 (errado): msg 10");
  check([3, 5, 6].every(p => w.diplomacyValue(p, 1) === 0 && w.diplomacyValue(1, p) === 0 && w.diplomacyValue(p, 7) === 1 && w.diplomacyValue(p, 2) === 1), "ar, terra e fogo: em paz com o herói e hostis aos orcs (2) e monstros (7)");
  check(w.diplomacyValue(4, 1) === 1 && sub(r, 1) === 2 && sub(r, 3) === 2 && sub(r, 4) === 2 && sub(r, 2) === 1, "água ainda hostil; subs 1, 3, 4 cumpridos e sub 2 (água) ativo");
  check(!r.outcome, "falta o painel 2");
  at(r, dina, 20, 47); settle(r, 30);
  check(has(r, 5) && w.diplomacyValue(4, 1) === 0 && sub(r, 2) === 2, "painel 2 (20,47): runa da água, msg 5 e sub 2 cumprido");
  check(r.outcome?.ok === true && r.gold === 500000, `quatro elementais em paz: 500000 de ouro e Mission Complete (${JSON.stringify(r.outcome)}, ouro ${r.gold})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(messagesHaveText(r, fighterHero()), "todas as falas disparadas têm texto");
  campaignContract(72, r);

  console.log("[72] ordem trocada (água primeiro) e runa direto com a Dina; falhas do motor");
  r = start(); w = r.b.world; h = r.b.hero; dina = unit(r, 10003);
  settle(r, 5);
  for (const k of ["water", "air", "earth", "fire"] as const) dina.items.push(RUNES[k].item);
  at(r, dina, 20, 47); settle(r, 30);
  check(has(r, 5) && w.diplomacyValue(4, 1) === 0 && !r.outcome, "água primeiro: painel 2 abre a água, sem desfecho");
  check(has(r, 8) && sub(r, 3) === 1, "runa do ar direto com a Dina: msg 8 (v74 = 2) e subs 3/4");
  at(r, dina, 102, 78); settle(r, 30);
  check(r.outcome?.ok === true && r.gold === 500000, `painel 1 depois: Mission Complete + 500000 (${JSON.stringify(r.outcome)})`);
  // a mochila do jogo ainda é só do herói: as runas ficam com ele e a Dina nos painéis basta (MissionHost.heroItemsCountForCompanions)
  r = start(); w = r.b.world; h = r.b.hero; dina = unit(r, 10003);
  settle(r, 5);
  for (const k of ["air", "earth", "fire", "water"] as const) h.items.push(RUNES[k].item);
  at(r, dina, 102, 78); settle(r, 30);
  check(has(r, 2) && has(r, 3) && has(r, 4) && h.items.length === 1 && h.items[0] === RUNES.water.item && dina.items.length === 0, `runas no bolso do herói: a Dina no painel 1 as usa e elas saem do herói (${h.items.join(",")})`);
  at(r, dina, 20, 47); settle(r, 30);
  check(r.outcome?.ok === true && r.gold === 500000 && h.items.length === 0, `painel 2 com a runa da água do herói: Mission Complete + 500000 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 10003)); settle(r, 30);
  check(failCause(r) === 4, `Dina morta (a missão depende dela): falha causa 4 (${JSON.stringify(r.outcome)})`);
  companionsFail(start, false);
}

// ------------------------------------------------------------------------------------------- 73
async function m73(): Promise<void> {
  console.log("\n=== Missão 73 — A Rebel Stronghold ===");
  const data = await loadData(73);
  const start = () => startRun(data, fighterHero(), undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const defenders = (): Unit[] => w.units.filter(u => u.player === 6 && u.alive);
  check(Math.abs(h.cx - 34) <= 3 && Math.abs(h.cy - 13) <= 3, `herói nasce no Drop Location (34,13): ${h.cx},${h.cy}`);
  check(defenders().length === 19 && group(r, 7).length === 10 && group(r, 8).length === 9, `${defenders().length} defensores do castelo (jogador 6, grupos 7 e 8)`);
  check(group(r, 1).every(u => u.player === 5) && unit(r, 69).player === 5 && unit(r, 80).player === 5, "aldeões (grupos 1 e 2) e os dois anciãos (69 e 80) são do jogador 5");
  // objeto sem sprite (obj13) e estruturas: a grade monta e a simulação roda sem erro (fallback seguro: o objeto não bloqueia)
  const o13 = r.data.map.objs.filter(o => o[2] === 13);
  check(r.data.objects["13"] === undefined && o13.length === 16 && o13.every(o => o[1] === r.data.map.h - 1) && !r.logs.some(l => l.level === "warn"),
    `objeto 13 sem sprite: ${o13.length} células na última linha do mapa (y=${r.data.map.h - 1}), ignoradas pela grade/vista, sem aviso do runtime`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho (os defensores vivem)");
  check(group(r, 3).concat(group(r, 9), group(r, 10)).every(u => u.ai?.type !== "swarm"), "guerreiros e magos parados longe do castelo");
  // anciãos
  beside(r, h, 69); settle(r);
  check(has(r, 2), "ancião da aldeia com o herói: msg 2");
  beside(r, unit(r, 10002), 80); settle(r);
  check(has(r, 6), "líder dos sem-teto com Igles: msg 6");
  beside(r, unit(r, 10003), 69); settle(r);
  check(!has(r, 4), "ancião só fala uma vez (v70)");
  // castelo (65,74): o herói a <= 10 células solta os 3 bandos (swarm2)
  at(r, h, 65, 62); settle(r);
  check(!group(r, 3).some(u => u.ai?.type === "swarm"), "a 12 células do castelo ainda não");
  at(r, h, 65, 66); settle(r);
  check(group(r, 3).concat(group(r, 9), group(r, 10)).every(u => u.ai?.type === "swarm"), "herói a <= 10 do castelo: grupos 3, 9 e 10 marcham (swarm2)");
  check(!r.outcome, "defensores vivos: sem desfecho");
  // marcha real (info): guerreiros rumo a (60,77)
  const c0 = group(r, 3).reduce((a, u) => a + Math.hypot(u.x - 60, u.y - 77), 0) / group(r, 3).length;
  run(r, 20 * 20, () => { for (const id of [10001, 10002, 10003]) { const u = unit(r, id); if (u.alive) u.hp = u.maxHp; } });
  const al = group(r, 3).filter(u => u.alive);
  console.log(`  info: guerreiros (grupo 3) a ${c0.toFixed(0)} -> ${(al.reduce((a, u) => a + Math.hypot(u.x - 60, u.y - 77), 0) / Math.max(1, al.length)).toFixed(0)} células de (60,77) em 20 s; ${defenders().length} defensores vivos`);
  // vitória: nenhum defensor vivo (unidades do jogador 6)
  const some = defenders();
  killAll(r, some.slice(1)); settle(r, 25);
  check(!r.outcome, "um defensor vivo: sem desfecho");
  killAll(r, some); settle(r, 25);
  check(r.outcome?.ok === true, `todos os defensores mortos: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(messagesHaveText(r, fighterHero()), "todas as falas disparadas têm texto");
  campaignContract(73, r);

  console.log("[73] falhas");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 69), 1); settle(r, 30);
  check(failCause(r) === 5, `atacar o ancião/aldeões: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, group(r, 1)[3]!, 1); settle(r, 30);
  check(failCause(r) === 5, `atacar um aldeão qualquer: falha causa 5 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 74
/** Talena (taverna de Kaarg, npc 2022) oferece só a missão da variante do herói: 74 guerreiro, 75 guerreira, 76 maga, 77 mago */
const TALENA: Array<[boolean, boolean, number]> = [[false, false, 74], [false, true, 75], [true, true, 76], [true, false, 77]];
function talenaChain(): void {
  console.log("[74-77] Talena (npc 2022, Kaarg) oferece uma missão por classe/sexo");
  for (const [mage, female, m] of TALENA) {
    const st = campaignUpTo(63, mage, female);
    onMissionResult(st, campaignData!, { id: 63, outcome: "complete" });
    enterLocation(st, ["T", 2]);
    for (const p of innPatrons(st, campaignData!, 2).filter(x => x.npc === 2022)) talkTo(st, campaignData!, p);
    const offered = [74, 75, 76, 77].filter(x => availableMissions(st).includes(x));
    check(offered.length === 1 && offered[0] === m, `(${mage ? "mag" : "guerreir"}${female ? "a" : "o"}) Talena oferece só a missão ${m} (${offered.join(",")})`);
  }
}

async function m74(): Promise<void> {
  console.log("\n=== Missão 74 — Minge the Shaman ===");
  const data = await loadData(74);
  const start = (hero: HeroState = heroOf(false, false)) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const shaman = unit(r, 102), ogre = unit(r, 35);
  const orcsOf = (q: Run): Unit[] => q.b.world.units.filter(u => u.player === 2 && u.alive);
  const orcs = (): Unit[] => orcsOf(r);
  check(Math.abs(h.cx - 21) <= 3 && Math.abs(h.cy - 132) <= 3, `herói nasce no Drop Location (21,132): ${h.cx},${h.cy}`);
  check(orcs().length === 27 && shaman.player === 2, `${orcs().length} orcs (jogador 2) com o xamã Minge (102) no meio`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome && !sub(r, 1), "msg 1, sem desfecho");
  check(ogre.alive && ogre.hp < ogre.maxHp * 0.25 && ogre.helpless && r.b.host.unitParameter(35, 6) === 0, `ogro meio morto (35): vida do script 0 (Set Unit Parameter), hp real ${Math.ceil(ogre.hp)}/${ogre.maxHp}, sem o gatilho "Ogre healed" no 1º ciclo`);
  check(!has(r, 2) && w.diplomacyValue(1, 3) === 1, "ogros (jogador 3) hostis ao herói até acordarem o ogro");
  // ogro acorda quando o grupo chega perto: msg 2, paz com os ogros e ele marcha até (132,131)
  at(r, h, ogre.cx + 2, ogre.cy); settle(r, 40);
  check(!ogre.helpless && has(r, 2) && w.diplomacyValue(1, 3) === 0 && w.diplomacyValue(3, 1) === 0, "herói perto do ogro: msg 2 e paz com os ogros");
  check(ogre.ai?.type === "move" && ogre.ai.x === 132 && ogre.ai.y === 131, "o ogro volta a andar até o ponto (132,131)");
  const g0 = distTo(ogre, 132, 131);
  run(r, 20 * 60, () => { h.hp = h.maxHp; });
  console.log(`  info: ogro a ${g0.toFixed(0)} -> ${distTo(ogre, 132, 131).toFixed(0)} células de (132,131) em 60 s`);
  check(distTo(ogre, 132, 131) < g0 - 10, "o ogro caminha para o ponto de encontro");
  w.kill(unit(r, 32), h); settle(r, 20);
  check(w.diplomacyValue(1, 3) === 1 && w.diplomacyValue(3, 1) === 1, "ogro 32 morto: ogros hostis de novo (Ogre dead)");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); unit(r, 35).hp = Math.ceil(unit(r, 35).maxHp * 0.3); settle(r, 30);
  check(has(r, 2) && w.diplomacyValue(1, 3) === 0, "ogro curado (vida >= 25%) acorda mesmo sem ninguém perto");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); at(r, h, 66, 125); settle(r, 60);
  check(unit(r, 35).alive && unit(r, 35).hp >= 1, "ogro meio morto não é atacado pela IA do grupo enquanto dorme");
  // xamã Minge (112,38)
  r = start(); w = r.b.world; h = r.b.hero;
  const sh = unit(r, 102);
  settle(r, 5);
  check(group(r, 5).concat(group(r, 6), group(r, 7)).every(u => u.ai?.type !== "swarm") && !sub(r, 1), "orcs parados e sem sub 1 longe do xamã");
  at(r, h, 112, 52); settle(r);
  check(group(r, 5).concat(group(r, 6), group(r, 7)).every(u => u.ai?.type === "swarm") && sub(r, 1) === 1, "herói a <= 15 de (112,38): grupos 5, 6 e 7 vêm (swarm) e sub 1 ativo");
  beside(r, h, 102); settle(r, 15);
  check(!has(r, 4) && !r.outcome, "orcs vivos: o xamã não fala");
  killAll(r, orcs().filter(u => u !== sh).slice(1)); settle(r, 15);
  check(!has(r, 4) && !r.outcome, "sobram 2 orcs (o xamã e mais um): não fala");
  killAll(r, orcs().filter(u => u !== sh)); settle(r, 30);
  check(has(r, 4) && sub(r, 1) === 2 && r.outcome?.ok === true, `só o xamã vivo + herói perto: msg 4, sub 1 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(sh.alive && noUnsupported(r), "xamã vivo; script sem ações sem suporte");
  check(messagesHaveText(r, heroOf(false, false)), "todas as falas têm texto para o guerreiro");
  campaignContract(74, r, false, false);

  console.log("[74] Igles e Dina falam com o xamã; variantes do herói (as 4 completam a missão); falhas");
  r = start(); settle(r, 5); at(r, r.b.hero, 112, 52); killAll(r, orcs().filter(u => u !== unit(r, 102))); beside(r, unit(r, 10002), 102); settle(r, 30);
  check(has(r, 5) && r.outcome?.ok === true, "Igles com o xamã: msg 5 + Mission Complete");
  r = start(); settle(r, 5); at(r, r.b.hero, 112, 52); killAll(r, orcs().filter(u => u !== unit(r, 102))); beside(r, unit(r, 10003), 102); settle(r, 30);
  check(has(r, 6) && r.outcome?.ok === true, "Dina com o xamã: msg 6 + Mission Complete");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    r = start(hero); settle(r, 5); at(r, r.b.hero, 112, 52); killAll(r, orcs().filter(u => u !== unit(r, 102))); beside(r, r.b.hero, 102); settle(r, 30);
    check(r.outcome?.ok === true && has(r, 4) && messagesHaveText(r, hero), `${v.label}: xamã convencido, Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 102)); settle(r, 30);
  check(failCause(r) === 5, `xamã morto antes da conversa: falha causa 5 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
  talenaChain();
}

// ------------------------------------------------------------------------------------------- 75
async function m75(): Promise<void> {
  console.log("\n=== Missão 75 — The Old Warrior ===");
  const data = await loadData(75);
  const hero0 = (): HeroState => heroOf(false, true);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  let knight = unit(r, 10002);
  const son = unit(r, 81), leader = unit(r, 66), girl = unit(r, 67);
  check(Math.abs(h.cx - 130) <= 3 && Math.abs(h.cy - 56) <= 3, `herói nasce no Drop Location (130,56): ${h.cx},${h.cy}`);
  check(son.player === 2 && leader.player === 2 && girl.player === 2 && group(r, 28).includes(girl), "filho (81), líder (66) e moça (67, grupo 28) são humanos do jogador 2");
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(1, 2) === 0, "humanos em paz com o herói");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // filho: 1ª conversa; líder; 2ª conversa (só depois do líder) abre o sub 1
  at(r, h, son.cx + 1, son.cy); settle(r);
  check(has(r, 2) && !sub(r, 1), "filho com a guerreira: msg 2 (sem sub ainda)");
  at(r, h, leader.cx + 1, leader.cy + 1); settle(r);
  check(has(r, 5), "líder com a guerreira: msg 5");
  at(r, h, son.cx + 1, son.cy); settle(r);
  check(has(r, 8) && sub(r, 1) === 1, "filho de novo (depois do líder): msg 8 e sub 1 ativo");
  // Igles precisa chegar ao líder (<= 1): luta/conversa (msg 11), sub 1 cumprido
  at(r, knight, leader.cx - 3, leader.cy); settle(r);
  check(!has(r, 11), "Igles a 3 células do líder: ainda não");
  at(r, knight, leader.cx - 1, leader.cy); settle(r);
  check(has(r, 11) && sub(r, 1) === 2 && !r.outcome, "Igles junto ao líder: msg 11 e sub 1 cumprido");
  // moça: Igles a <= 4 dela depois da luta -> ela o segue
  check(!has(r, 12), "ainda sem fala final");
  check(has(r, 13) && girl.ai?.type === "follow" && girl.ai.unit === knight.id, `moça (67) passa a seguir Igles (ai ${JSON.stringify(girl.ai)})`);
  // escolta real: Igles vai até o filho (93,39) — fica a 60+ células da moça —, que o acompanha pelo caminho
  at(r, h, 91, 41); at(r, knight, son.cx, son.cy + 1);
  const d0 = dist(girl, son);
  const t = run(r, 20 * 120, () => {
    for (const id of [10001, 10002, 10003, 67]) { const u = unit(r, id); if (u.alive) u.hp = u.maxHp; } // a moça cruza terra de monstros: imortal só neste trecho
    return dist(girl, son) <= 4;
  });
  console.log(`  info: moça a ${d0.toFixed(0)} células do filho -> ${dist(girl, son).toFixed(0)} em ${(t / 20).toFixed(0)} s`);
  check(dist(girl, son) <= 4.5 && girl.alive, `a moça chega até o filho seguindo Igles (${girl.cx},${girl.cy})`);
  settle(r, 30);
  check(has(r, 12) && r.outcome?.ok === true, `Igles com o filho depois da fuga: msg 12 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(messagesHaveText(r, hero0()), "todas as falas disparadas têm texto para a guerreira");
  campaignContract(75, r, false, true);

  console.log("[75] atalho do fim por teletransporte; variantes; falhas");
  const quick = (hero: HeroState): Run => {
    const q = start(hero); const qk = unit(q, 10002), qs = unit(q, 81), ql = unit(q, 66), qg = unit(q, 67);
    settle(q, 5);
    at(q, q.b.hero, qs.cx + 1, qs.cy); settle(q); at(q, q.b.hero, ql.cx + 1, ql.cy + 1); settle(q); at(q, q.b.hero, qs.cx + 1, qs.cy); settle(q);
    at(q, qk, ql.cx - 1, ql.cy); settle(q); at(q, qk, qg.cx + 1, qg.cy); settle(q);
    at(q, qg, qs.cx - 2, qs.cy); at(q, qk, qs.cx + 1, qs.cy); settle(q, 40);
    return q;
  };
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    const q = quick(hero);
    check(q.outcome?.ok === true && has(q, 12) && messagesHaveText(q, hero), `${v.label}: cadeia completa (filho, líder, luta, moça, filho) e Mission Complete`);
  }
  r = start(); settle(r, 5); at(r, unit(r, 10003), son.cx + 1, son.cy); settle(r);
  check(has(r, 4), "Dina com o filho: msg 4");
  r = start(); settle(r, 5); at(r, unit(r, 10002), unit(r, 81).cx + 1, unit(r, 81).cy); settle(r);
  check(has(r, 3), "Igles com o filho: msg 3");
  r = start(); settle(r, 5); at(r, unit(r, 10002), unit(r, 66).cx + 1, unit(r, 66).cy + 1); settle(r);
  check(has(r, 6), "Igles com o líder: msg 6");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 66)); settle(r, 30);
  check(failCause(r) === 5, `líder morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 81)); settle(r, 30);
  check(failCause(r) === 6, `filho morto: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 67)); settle(r, 30);
  check(failCause(r) === 7, `moça morta: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, group(r, 2)[0]!, 1); settle(r, 30);
  check(failCause(r) === 8, `atacar um humano: falha causa 8 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 76
async function m76(): Promise<void> {
  console.log("\n=== Missão 76 — The Dangerous Forest ===");
  const data = await loadData(76);
  const hero0 = (): HeroState => heroOf(true, true);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  let smart = unit(r, 62), knight = unit(r, 10002);
  const hunters = (q: Run = r): Unit[] => q.b.world.units.filter(u => u.player === 3 && u.alive);
  check(Math.abs(h.cx - 13) <= 3 && Math.abs(h.cy - 102) <= 3, `herói nasce no Drop Location (13,102): ${h.cx},${h.cy}`);
  check(h.heroInfo?.mage === true && h.spells.length > 0, `maga com ${h.spells.length} magias iniciais`);
  check(unit(r, 57).player === 2 && smart.player === 2 && group(r, 7).includes(smart) && hunters().length === 21, `druida 57 e druida sábio 62 (grupo 7) do jogador 2; ${hunters().length} caçadores (jogador 3)`);
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(1, 3) === 1, "druidas em paz com o herói; caçadores hostis");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome && !sub(r, 1), "msg 1, sem desfecho");
  beside(r, h, 57); settle(r);
  check(has(r, 2), "druida 57 com a maga: msg 2");
  beside(r, h, 62); settle(r);
  check(has(r, 5) && sub(r, 1) === 1, "druida sábio com a maga: msg 5 e sub 1 (caçadores) ativo");
  check(!has(r, 8) && sub(r, 2) === 0, "caçadores vivos: ele não vai com o grupo");
  killAll(r, hunters().slice(1)); settle(r, 20);
  check(sub(r, 1) === 1 && !has(r, 8), "um caçador vivo: sub 1 em aberto");
  killAll(r, hunters()); settle(r, 30);
  check(sub(r, 1) === 2 && has(r, 8) && sub(r, 2) === 1, "caçadores mortos: sub 1 cumprido, msg 8 e sub 2 (levar o druida às flores) ativo");
  check(smart.ai?.type === "follow" && smart.ai.unit === h.id, `druida sábio passa a seguir a maga (ai ${JSON.stringify(smart.ai)})`);
  // caminhada real: a maga vai até as flores (46,17) e o druida (127,47) a acompanha, 85 células
  at(r, h, 120, 48); settle(r, 20);
  const dd0 = distTo(smart, 46, 17);
  at(r, h, 46, 18);
  const t = run(r, 20 * 400, () => {
    for (const id of [10001, 10002, 10003, 62]) { const u = unit(r, id); if (u.alive) u.hp = u.maxHp; }
    return distTo(smart, 46, 17) <= 8;
  });
  console.log(`  info: druida sábio a ${dd0.toFixed(0)} -> ${distTo(smart, 46, 17).toFixed(0)} células das flores (46,17) em ${(t / 20).toFixed(0)} s`);
  check(distTo(smart, 46, 17) <= 8.5 && !r.outcome, `o druida atravessa o mapa seguindo a maga (a ~8 células das flores: ${smart.cx},${smart.cy})`);
  // os morcegos perto das flores seguram o druida (o grupo precisa limpar o caminho): último trecho por teletransporte
  at(r, smart, 46, 17); at(r, h, 47, 18);
  settle(r, 40);
  check(r.outcome?.ok === true && has(r, 11) && sub(r, 2) === 2, `druida nas flores com a maga: msg 11, sub 2 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(messagesHaveText(r, hero0()), "todas as falas disparadas têm texto para a maga");
  campaignContract(76, r, true, true);

  console.log("[76] atalho do fim por teletransporte; variantes; falhas");
  const quick = (hero: HeroState, who: 10001 | 10002 | 10003 = 10001): Run => {
    const q = start(hero); const qs = unit(q, 62), qw = unit(q, who);
    settle(q, 5);
    at(q, qw, qs.cx + 1, qs.cy); settle(q);
    killAll(q, hunters(q)); settle(q, 30);
    at(q, qs, 46, 17); at(q, qw, 47, 17); settle(q, 40);
    return q;
  };
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    const q = quick(hero);
    check(q.outcome?.ok === true && has(q, 11) && messagesHaveText(q, hero), `${v.label}: cadeia completa (druida sábio, caçadores, flores) e Mission Complete`);
  }
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 12), "Igles leva o druida às flores: msg 12");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 13), "Dina leva o druida às flores: msg 13");
  r = start(); settle(r, 5); beside(r, unit(r, 10002), 57); settle(r); beside(r, unit(r, 10003), 62); settle(r);
  check(has(r, 3) && has(r, 7), "Igles com o druida 57 (msg 3) e Dina com o sábio (msg 7)");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 62)); settle(r, 30);
  check(failCause(r) === 5, `druida sábio morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 57), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar os druidas: falha causa 6 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 77
/** o jogador manda a unidade ficar onde está (stand ground, sem seguir o herói) */
function hold(r: Run, u: Unit): void { u.ai = { type: "hold" }; r.b.world.command(u, { type: "none" }); }
async function m77(): Promise<void> {
  console.log("\n=== Missão 77 — A Mage's Spirit ===");
  const data = await loadData(77);
  const hero0 = (): HeroState => heroOf(true, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const good = unit(r, 144), friend = unit(r, 175), leader = unit(r, 139);
  check(Math.abs(h.cx - 111) <= 3 && Math.abs(h.cy - 13) <= 3, `herói nasce no Drop Location (111,13): ${h.cx},${h.cy}`);
  check(leader.player === 2 && good.player === 2 && friend.player === 2 && group(r, 24).length === 8, "necromantes (139 chefe, 144 bom, 175 amigo; jogador 2) e a guarda dos mortos-vivos (grupo 24, 8, jogador 3)");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  check(group(r, 24).every(u => !u.active), "guarda (grupo 24) fora de fase até o ritual");
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(1, 2) === 0, "necromantes em paz com o herói");
  // conversa na ordem: o bom necromante só fala depois do chefe
  beside(r, h, 144); settle(r);
  check(!has(r, 5) && good.player === 2, "bom necromante antes do chefe: nada");
  beside(r, h, 139); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "chefe com o herói: msg 2, sub 1 (achar o bom necromante) ativo");
  beside(r, h, 144); settle(r);
  check(has(r, 5) && sub(r, 1) === 2 && good.player === 1, `bom necromante com o herói: msg 5, sub 1 cumprido e ele passa para o jogador (jogador ${good.player})`);
  check(good.ai?.type === "defend", `ele acompanha o grupo (ai ${JSON.stringify(good.ai)})`);
  // túmulo (48,25): o bom necromante levanta o fantasma
  check(!has(r, 8) && !sub(r, 2), "(ainda não no túmulo)");
  at(r, h, 80, 20); at(r, good, 48, 26); settle(r);
  check(has(r, 8) && sub(r, 2) === 1, "bom necromante no túmulo (48,25): msg 8 e sub 2 (levar o amigo) ativo");
  check(!r.outcome, "guarda ainda fora de fase (falta o ritual a dois)");
  at(r, good, 18, 117); settle(r);
  check(has(r, 9) && sub(r, 2) === 2 && friend.player === 1, `bom necromante com o amigo (175): msg 9, sub 2 cumprido e ele passa para o jogador (jogador ${friend.player})`);
  check(group(r, 24).every(u => !u.active), "guarda continua fora de fase");
  // ritual no túmulo: contador v73 sobe a cada ciclo (0,5 s); aos 10 a guarda aparece, aos 20 some
  at(r, h, 100, 14); at(r, good, 48, 26); at(r, friend, 47, 26); hold(r, good); hold(r, friend); settle(r, 20); // o jogador manda os dois ficarem no túmulo
  check(has(r, 10), "os dois no túmulo: msg 10 (contador do ritual)");
  const guard = group(r, 24);
  const keep = (): void => { for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; };
  check(good.buffs.some(b => b.kind === "invisible") && friend.buffs.some(b => b.kind === "invisible"), "msg 10: o bom necromante cobre o grupo com invisibilidade (os guardas que aparecem não veem ninguém)");
  const trace: string[] = [];
  for (let i = 0; i < 16 && !r.outcome; i++) { run(r, 20, keep); trace.push(guard.filter(u => u.active).length === 8 ? "A" : guard.some(u => u.active) ? "?" : "."); }
  console.log(`  info: guarda em fase por segundo (A = os 8 presentes): ${trace.join("")}`);
  check(trace.slice(3, 8).every(c => c === "A") && trace[0] === "." && trace[12] === ".", "contador do ritual: a guarda (8) aparece ~4 s depois da fala 10 e some ~5 s depois");
  check(!r.outcome && !guard.some(u => u.state === "attack"), "invisíveis, o grupo não é atacado pela guarda: sem falha 7");
  check(has(r, 11) && has(r, 13) && !has(r, 12), "bom necromante a <= 15 do túmulo: msg 11 (viu o feitiço) e msg 13 (fala com o fantasma)");
  beside(r, h, 144); settle(r, 30);
  check(has(r, 14) && r.outcome?.ok === true, `herói com o bom necromante: msg 14 + Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");
  check(messagesHaveText(r, hero0()), "todas as falas disparadas têm texto para o mago");
  campaignContract(77, r, true, false);

  console.log("[77] variantes, Igles/Dina e falhas");
  /** cadeia curta por teletransporte: chefe -> bom necromante -> túmulo -> amigo -> ritual -> fala final com `who` */
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); const qk = (): void => { for (const u of q.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; };
    const qw = unit(q, who), qg = unit(q, 144), qf = unit(q, 175);
    settle(q, 5);
    beside(q, qw, 139); settle(q); beside(q, qw, 144); settle(q);
    at(q, qw, 80, 20); at(q, qg, 48, 26); settle(q); at(q, qg, 18, 117); settle(q);
    at(q, qw, 100, 14); at(q, qg, 48, 26); at(q, qf, 47, 26); hold(q, qg); hold(q, qf); run(q, 20 * 16, qk);
    beside(q, qw, 144); run(q, 30, qk);
    return q;
  };
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    const q = quick(hero);
    check(q.outcome?.ok === true && has(q, 14) && messagesHaveText(q, hero), `${v.label}: cadeia completa (chefe, bom necromante, túmulo, amigo, ritual, fala final) e Mission Complete`);
  }
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 6) && has(q, 15), "Igles conduz a cadeia: msgs 3, 6 e 15");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 7) && has(q, 16), "Dina conduz a cadeia: msgs 4, 7 e 16");
  // falha 8: o bom necromante longe do túmulo na hora do feitiço
  r = start(); settle(r, 5); beside(r, r.b.hero, 139); settle(r); beside(r, r.b.hero, 144); settle(r);
  at(r, unit(r, 144), 48, 26); settle(r); at(r, unit(r, 144), 18, 117); settle(r); at(r, unit(r, 144), 48, 26); at(r, unit(r, 175), 47, 26); settle(r, 20);
  at(r, unit(r, 144), 100, 90); at(r, unit(r, 175), 99, 90); run(r, 20 * 16, () => { for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; });
  check(failCause(r) === 8 && has(r, 12), `bom necromante longe (> 15) quando o feitiço acontece: falha causa 8 + msg 12 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); beside(r, r.b.hero, 139); settle(r); beside(r, r.b.hero, 144); settle(r); r.b.world.kill(unit(r, 144)); settle(r, 30);
  check(failCause(r) === 5, `bom necromante morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 175)); settle(r, 30);
  check(failCause(r) === 5, `amigo necromante morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 139), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar os necromantes: falha causa 6 (${JSON.stringify(r.outcome)})`);
  // guardas dos zumbis (59): se atacam o grupo, falha 7 ("Guards caught us")
  r = start(); settle(r, 5); beside(r, r.b.hero, 59); run(r, 20 * 20, () => { for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; });
  check(failCause(r) === 7, `herói visto pelos zumbis da guarda (59): falha causa 7 (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// @@MISSIONS

// ------------------------------------------------------------------------------------------- execução
const only = proc.argv.slice(2).map(Number).filter(n => n > 0);
const all: [number, () => Promise<void>][] = [[70, m70], [71, m71], [72, m72], [73, m73], [74, m74], [75, m75], [76, m76], [77, m77]];
for (const [id, fn] of all) {
  if (only.length && !only.includes(id)) continue;
  try { await fn(); } catch (e) { failures++; console.log(`  FALHOU: missão ${id} lançou exceção: ${(e as Error).stack ?? e}`); }
}
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
