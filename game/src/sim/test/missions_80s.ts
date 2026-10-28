/**
 * Pilotos automáticos headless das missões do bloco 80: 80, 81, 82, 83, 84, 85, 86 e 87 (scripts em data/scripts/mission_<n>.txt).
 * Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/missions_80s.ts)
 * Opcional: `npx tsx src/sim/test/missions_80s.ts 85` roda só a missão pedida.
 *
 * Padrão de missions_70s.ts: monta a missão como a cena (loader.ts startRun) com Igles (10002) e Dina (10003) no grupo, leva o herói pelos
 * gatilhos do script (teletransporta entre os pontos) e MATA (w.kill) o que o script exige morto; cobre as falhas do script e as do motor
 * (causa 2 = herói, 3 = Igles, 4 = Dina). Trechos reais (patrulha do dragão, lobos que atacam as ovelhas, feras da maga) provam caminho/IA.
 * Cada missão confere também o contrato com o motor de campanha (MissionResult.scenarioVars -> onMissionResult) e quem a oferece.
 *   80 The Scarab Wastes: xamã orc (38) morto solta a coroa 13 (item 57 = 3665); o herói a pega -> vitória (777 = 0, "esteve na 70") ou, com
 *      vars[777] != 0, a coroa inteira do portador 160 (18118). Troll vira inimigo dos orcs. Só falhas do motor (2/3/4).
 *   81 The Battle Mages (só mago): 5 bandos (astral 18, fogo 10, ar 14, terra 1, água 5) mortos = vitória.
 *   82 The Elite Knights (só guerreiro): 5 bandos (machados 1, arcos 11, clavas 4, lanças 8, espadas 15) mortos = vitória.
 *   83 The Stone Web: grupo 15 (necromantes e zumbis) morto = vitória.
 *   84 Tekel Knows! (guerreiro): defensores do jogador 2 mortos + herói a <= 4 de Tekel (70, fora de fase) = vitória.
 *   85 The Storyteller (guerreira): líder 8 fala (inicia o contador), lobos atacantes (jogador 5) mortos + líder de novo = vitória; ovelhas
 *      <= 15 = falha 7, aldeões atacados = 5, líder morto = 6.
 *   86 The Swamp Mage (maga): maga do pântano (38) com paz nas feras (grupo 2) -> feras do jogador, bandidos (jogador 2) hostis e mortos,
 *      maga de novo = vitória; falsa maga (12). Falhas 5 (maga morta), 6 (maga atacada).
 *   87 The Dark Library (mago): bibliotecário (20), cidadão (36), defensores (grupo 6) mortos, casa (54,13), bibliotecário de novo = vitória.
 *      Falhas 5 (necromantes atacados), 6 (bibliotecário morto).
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { defaultHero } from "../../mission/setup";
import { pickLines } from "../../mission/messages";
import { loadData, json, proc, run, startRun, type Run } from "./loader";
import { availableMissions, availableTowns, enterLocation, getVar, innPatrons, isDone, newCampaign, onMissionResult, takePendingVideos, talkTo } from "../../campaign/engine";
import type { CampaignData, CampaignState } from "../../campaign/types";

import { TICKS_PER_SEC } from "../types";
let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const classes = (await loadData(80)).classes?.classes;
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
const keep = (r: Run): void => { for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; };
const settle = (r: Run, ticks = 25): number => run(r, ticks, () => keep(r));
/** o jogador manda a unidade ficar onde está (stand ground, sem seguir o herói) */
function hold(r: Run, u: Unit): void { u.ai = { type: "hold" }; r.b.world.command(u, { type: "none" }); }
function killAll(r: Run, us: Unit[]): void { for (const u of us) if (u.alive) r.b.world.kill(u, r.b.hero); }
const ofPlayer = (r: Run, p: number): Unit[] => r.b.world.units.filter(u => u.player === p && u.alive);
const failCause = (r: Run): number | undefined => (r.outcome && !r.outcome.ok ? r.outcome.cause : undefined);
const noUnsupported = (r: Run): boolean => !r.logs.some(l => /não implementa|não suportado/.test(l.msg));
const sub = (r: Run, n: number): number => r.subs.get(n) ?? 0;
const has = (r: Run, m: number): boolean => r.messages.includes(m);
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
/** A falha foi a `cause` e o texto dela (seção failure<N>) existe */
function failedWith(r: Run, cause: number, what: string): void {
  const sec = r.data.texts?.sections[`failure${cause}`] as never;
  check(failCause(r) === cause && !!sec && pickLines(sec, defaultHero()).length > 0, `${what}: falha causa ${cause} com texto (${JSON.stringify(r.outcome)})`);
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
function campaignUpTo(m: number, mage: boolean, female: boolean, skip: number[] = []): CampaignState {
  const data = campaignData!;
  const st = newCampaign(data, { mage, female }, 1);
  for (let i = 0; i < 80 && !availableMissions(st).includes(m); i++) {
    for (const t of availableTowns(st)) { enterLocation(st, ["T", t]); for (const p of innPatrons(st, data, t)) if (p.kind === 0 || p.kind === 3) talkTo(st, data, p); }
    if (availableMissions(st).includes(m)) break;
    const next = availableMissions(st).sort((a, b) => a - b).find(x => !isDone(st, x) && x !== m && !skip.includes(x));
    if (next == null) break;
    onMissionResult(st, data, { id: next, outcome: "complete" });
  }
  return st;
}
/** A missão `m` está disponível para o herói, o resultado `r` (vitória) a conclui e nada de estranho entra nas variáveis de cenário. */
function campaignContract(m: number, r: Run, mage = false, female = false, seeded: Record<number, number> = {}): CampaignState {
  const st = campaignUpTo(m, mage, female);
  check(availableMissions(st).includes(m), `campanha: ${m} disponível para ${mage ? "mag" : "guerreir"}${female ? "a" : "o"}`);
  const vars = sceneVars(r, seeded);
  check(Object.keys(vars).every(k => Number(k) >= 752), `MissionResult.scenarioVars só com subobjetivos (752+n): ${JSON.stringify(vars)}`);
  onMissionResult(st, campaignData!, { id: m, outcome: "complete", scenarioVars: vars });
  check(isDone(st, m) && !availableMissions(st).includes(m), `campanha: ${m} concluída pelo MissionResult`);
  return st;
}
/** Cadeia de Talena (npc 2022, Kaarg): 63 -> 74|75|76|77 -> 84|85|86|87 -> 93|94|95|96 conforme (mago, mulher); só uma de cada degrau é oferecida */
const CHAIN: Array<[boolean, boolean, number, number, number]> = [[false, false, 74, 84, 93], [false, true, 75, 85, 94], [true, true, 76, 86, 95], [true, false, 77, 87, 96]];
function talenaChain(): void {
  console.log("[84-87] Talena (npc 2022, Kaarg) oferece 84|85|86|87 depois de 74-77 e 93-96 depois destas");
  const data = campaignData!;
  const talena = (st: CampaignState): void => {
    enterLocation(st, ["T", 2]);
    for (const p of innPatrons(st, data, 2).filter(x => x.npc === 2022)) talkTo(st, data, p);
  };
  for (const [mage, female, m7, m8, m9] of CHAIN) {
    const who = `${mage ? "mag" : "guerreir"}${female ? "a" : "o"}`;
    const st = campaignUpTo(63, mage, female);
    onMissionResult(st, data, { id: 63, outcome: "complete" });
    talena(st);
    check(availableMissions(st).includes(m7), `(${who}) Talena oferece a ${m7}`);
    check([84, 85, 86, 87].every(x => !availableMissions(st).includes(x)), `(${who}) antes da ${m7}: nenhuma de 84-87`);
    onMissionResult(st, data, { id: m7, outcome: "complete" });
    talena(st);
    const offered = [84, 85, 86, 87].filter(x => availableMissions(st).includes(x));
    check(offered.length === 1 && offered[0] === m8, `(${who}) depois da ${m7}: Talena oferece só a ${m8} (${offered.join(",")})`);
    onMissionResult(st, data, { id: m8, outcome: "complete" });
    talena(st);
    const next = [93, 94, 95, 96].filter(x => availableMissions(st).includes(x));
    check(next.length === 1 && next[0] === m9, `(${who}) depois da ${m8}: Talena oferece só a ${m9} (${next.join(",")})`);
  }
}

// ------------------------------------------------------------------------------------------- 80
const CROWN13 = "3665", CROWN_FULL = "18118";
async function m80(): Promise<void> {
  console.log("\n=== Missão 80 — The Scarab Wastes ===");
  const data = await loadData(80);
  const start = (seed?: Record<number, number>, hero: HeroState = heroOf(false, false)) => startRun(data, hero, seed, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const shaman = unit(r, 38), lich = unit(r, 160), dragon = group(r, 18)[0]!;
  check(Math.abs(h.cx - 13) <= 3 && Math.abs(h.cy - 65) <= 3, `herói nasce no Drop Location (13,65): ${h.cx},${h.cy}`);
  check(shaman.player === 3 && shaman.items.includes(CROWN13) && lich.items.includes(CROWN_FULL), "xamã E'lo (38, orcs) carrega a coroa 13 (item 57 = 3665); o portador 160 (lich) a coroa inteira (18118)");
  check(group(r, 9).length === 21 && group(r, 9).includes(shaman), `${group(r, 9).length} orcs do xamã (grupo 9)`);
  settle(r, 20 * 3);
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1 e sub 1 (achar o xamã) ativo");
  check(lich.phased, "portador da coroa inteira (grupo 28) fora de fase");
  check(w.diplomacyValue(4, 3) === 0 && w.diplomacyValue(3, 4) === 0, "trolls e orcs em paz até o xamã morrer");
  check(dragon.ai?.type === "patrol", `dragão (grupo 18) em patrulha (ai ${JSON.stringify(dragon.ai)})`);
  const x0 = dragon.x, y0 = dragon.y;
  // conjurador em patrulha [exe 0x569b62 → AI_Task_Guard 0x56a5fc → 0x56afd9 → AI_IdleCasterSupport 0x56c592/AI_CasterShield 0x57a999]:
  // com a mana cheia lança Haste num aliado do mesmo dono que ainda não a tem e, no pensamento seguinte, volta ao posto (que a patrulha
  // pôs onde ele estava) antes de seguir — perto dos orcs anda pouco; depois de passar por eles, segue (medido: ~30 s para sair)
  run(r, TICKS_PER_SEC * 60, () => keep(r));
  console.log(`  info: dragão (${x0.toFixed(0)},${y0.toFixed(0)}) -> (${dragon.x.toFixed(0)},${dragon.y.toFixed(0)}) em 60 s`);
  check(dragon.alive && distTo(dragon, x0, y0) > 5, "o dragão anda na patrulha rumo a (39,129)");
  // xamã morto: trolls atacam os orcs, sub 1 cumprido e sub 2 (a coroa) ativo; a coroa fica no chão
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); w.kill(unit(r, 38), h); settle(r, 20);
  check(sub(r, 1) === 2 && sub(r, 2) === 1 && !r.outcome, "xamã morto: sub 1 cumprido, sub 2 (achar a coroa) ativo");
  check(w.diplomacyValue(4, 3) === 1, `trolls hostis aos orcs (Trolls become angry at orcs; assimétrico: orcs->trolls = ${w.diplomacyValue(3, 4)})`);
  const sack = w.loot.find(l => l.items.includes(CROWN13));
  check(!!sack, `a coroa 13 cai no chão onde o xamã morreu (${sack?.x},${sack?.y})`);
  at(r, h, sack!.x, sack!.y + 1); w.command(h, { type: "pickup", x: sack!.x, y: sack!.y }); settle(r, 60);
  check(h.items.includes(CROWN13), `herói pega a coroa 13 (${h.items.join(",")})`);
  check(has(r, 2) && !has(r, 3) && !has(r, 4) && !has(r, 5) && r.outcome?.ok === true && sub(r, 2) === 2, `sem ter ido à 70: msg 2 (coroa), sub 2 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(h.items.includes(CROWN13) && !h.items.includes(CROWN_FULL), "o herói fica com a coroa 13 (só as peças 1 e 12 são removidas) e não ganha a coroa inteira");
  check(noUnsupported(r) && messagesHaveText(r, heroOf(false, false)), "script sem ações sem suporte e falas com texto");
  const st = campaignContract(80, r);
  check(getVar(st, 778) === 1, "campanha: a vitória grava vars[778] (esteve na 80)");

  console.log("[80] com vars[777] (esteve na 70): coroa inteira do portador 160");
  r = start({ 777: 1 }); w = r.b.world; h = r.b.hero;
  settle(r, 5); w.kill(unit(r, 38), h); settle(r, 10);
  const l2 = w.loot.find(l => l.items.includes(CROWN13))!;
  at(r, h, l2.x, l2.y + 1); w.command(h, { type: "pickup", x: l2.x, y: l2.y }); settle(r, 60);
  check(r.outcome?.ok === true && has(r, 5) && !has(r, 2), `com 777 = 1: msg 5 (coroa completa) e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(h.items.includes(CROWN_FULL) && !h.items.includes(CROWN13) && unit(r, 160).items.length === 0, `o herói recebe a coroa inteira (18118) do 160 e a 13 some (${h.items.join(",")})`);
  check(w.diplomacyValue(4, 3) === 1 && sub(r, 2) === 2, "trolls hostis aos orcs; sub 2 cumprido");
  check(Object.keys(sceneVars(r, { 777: 1 })).every(k => Number(k) >= 752), "MissionResult não devolve a variável 777 semeada");
  // a campanha: 70 antes da 80 -> 777 = 1; a vitória na 80 grava 778 e dispara a cena da coroa (3)
  const camp = campaignUpTo(80, false, false);
  onMissionResult(camp, campaignData!, { id: 70, outcome: "complete" });
  check(getVar(camp, 777) === 1, "campanha: concluir a 70 grava vars[777] (a 80 lê esse valor)");
  takePendingVideos(camp, campaignData!);
  onMissionResult(camp, campaignData!, { id: 80, outcome: "complete", scenarioVars: sceneVars(r, { 777: 1 }) });
  check(getVar(camp, 778) === 1 && takePendingVideos(camp, campaignData!).some(v => /crown/.test(v)), "campanha: 80 depois da 70 grava 778 e mostra o vídeo da coroa");

  console.log("[80] Igles ou Dina com a coroa; variantes; falhas do motor");
  const withCrown = (seed: Record<number, number> | undefined, who: number): Run => {
    const q = start(seed); settle(q, 5); q.b.world.kill(unit(q, 38), q.b.hero); settle(q, 5);
    unit(q, who).items.push(CROWN13); settle(q, 30);
    return q;
  };
  r = withCrown(undefined, 10002);
  check(r.outcome?.ok === true && has(r, 3) && !has(r, 2), "coroa com Igles: msg 3 e Mission Complete");
  r = withCrown(undefined, 10003);
  check(r.outcome?.ok === true && has(r, 4) && !has(r, 2), "coroa com Dina: msg 4 e Mission Complete");
  r = withCrown({ 777: 1 }, 10002);
  check(r.outcome?.ok === true && has(r, 6) && unit(r, 10002).items.includes(CROWN_FULL), "com 777 = 1, Igles com a coroa: msg 6 e a coroa inteira vai para ele");
  r = withCrown({ 777: 1 }, 10003);
  check(r.outcome?.ok === true && has(r, 7) && unit(r, 10003).items.includes(CROWN_FULL), "com 777 = 1, Dina com a coroa: msg 7 e a coroa inteira vai para ela");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    for (const seed of [undefined, { 777: 1 }]) {
      r = start(seed, hero); settle(r, 5); r.b.world.kill(unit(r, 38), r.b.hero); settle(r, 5); r.b.hero.items.push(CROWN13); settle(r, 30);
      check(r.outcome?.ok === true && messagesHaveText(r, hero), `${v.label}${seed ? " (777 = 1)" : ""}: Mission Complete e falas com texto`);
    }
  }
  r = start(); settle(r, 5); w = r.b.world;
  w.kill(unit(r, 38), r.b.hero); settle(r, 30);
  check(!r.outcome, "xamã morto e a coroa no chão (ninguém pegou): sem desfecho");
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 81 / 82
interface Camp { id: number; mage: boolean; hit: number[]; last: number[] }
/** 81: astral 18 + fogo 10 + ar 14 ("most dead", v70) e depois terra 1 + água 5; 82: machados 1 + arcos 11 + clavas 4, depois lanças 8 + espadas 15 */
const CAMPS: Camp[] = [
  { id: 81, mage: true, hit: [18, 10, 14], last: [1, 5] },
  { id: 82, mage: false, hit: [1, 11, 4], last: [8, 15] },
];
async function campMission(c: Camp): Promise<void> {
  console.log(`\n=== Missão ${c.id} — ${c.id === 81 ? "The Battle Mages" : "The Elite Knights"} ===`);
  const data = await loadData(c.id);
  const heroes = VARIANTS.filter(v => v.mage === c.mage);
  const hero0 = (): HeroState => heroOf(c.mage, heroes[0]!.female);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const sizeOf = (q: Run, gs: number[]): number => gs.reduce((s, g) => s + group(q, g).filter(u => u.alive).length, 0);
  const dropX = c.id === 81 ? 71 : 72, dropY = c.id === 81 ? 131 : 133;
  check(Math.abs(h.cx - dropX) <= 3 && Math.abs(h.cy - dropY) <= 3, `herói nasce no Drop Location (${dropX},${dropY}): ${h.cx},${h.cy}`);
  const total = sizeOf(r, [...c.hit, ...c.last]);
  check(total > 20 && ofPlayer(r, 2).length >= total, `${total} inimigos nos 5 bandos (jogador 2; ${ofPlayer(r, 2).length} no mapa)`);
  check(w.diplomacyValue(2, 1) === 1, "jogador 2 hostil ao herói");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // ordem: os 3 primeiros bandos mortos soltam v70; os 2 últimos mortos com v70 = vitória; tudo no mesmo ciclo também vale
  killAll(r, c.last.flatMap(g => group(r, g))); settle(r, 25);
  check(!r.outcome && !has(r, 2), "últimos bandos mortos mas os primeiros vivos: sem desfecho");
  for (const g of c.hit.slice(1)) killAll(r, group(r, g)); settle(r, 25);
  check(!r.outcome, "falta um bando dos primeiros (só 2 de 3 mortos): sem desfecho");
  const rest = group(r, c.hit[0]!).filter(u => u.alive);
  killAll(r, rest.slice(1)); settle(r, 25);
  check(!r.outcome, "um único inimigo vivo do primeiro bando: sem desfecho");
  killAll(r, rest); settle(r, 40);
  check(r.outcome?.ok === true && has(r, 2), `todos os bandos mortos: msg 2 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(c.id, r, c.mage, false);

  console.log(`[${c.id}] os 5 bandos de uma vez; as duas variantes; quem recebe a missão; combate real; falhas`);
  r = start(); settle(r, 5); killAll(r, [...c.hit, ...c.last].flatMap(g => group(r, g))); settle(r, 40);
  check(r.outcome?.ok === true && has(r, 2), "5 bandos mortos no mesmo ciclo: vitória");
  for (const v of heroes) {
    const hero = heroOf(v.mage, v.female);
    r = start(hero); settle(r, 5); killAll(r, [...c.hit, ...c.last].flatMap(g => group(r, g))); settle(r, 40);
    check(r.outcome?.ok === true && messagesHaveText(r, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  // quem oferece: 81 (npc 2010) só mago, 82 (npc 2009) só guerreiro, em Kaarg no estágio 80
  for (const [mage, female] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const st = campaignUpTo(c.id, mage, female);
    check(availableMissions(st).includes(c.id) === (mage === c.mage), `campanha: ${c.id} ${mage === c.mage ? "oferecida" : "não oferecida"} a ${mage ? "mag" : "guerreir"}${female ? "a" : "o"}`);
  }
  // combate real ao lado de um bando: a IA reage, nada explode
  r = start(); w = r.b.world; h = r.b.hero;
  const near = ofPlayer(r, 2).sort((a, b) => dist(a, h) - dist(b, h))[0]!;
  at(r, h, near.cx + 4, near.cy); const hp0 = near.hp;
  for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; } // grupo "imortal" só neste trecho
  run(r, 20 * 20, () => keep(r));
  console.log(`  info: inimigo mais próximo (${near.name}): vida ${Math.ceil(hp0)} -> ${Math.ceil(near.hp)}, estado ${near.state}, a ${dist(near, h).toFixed(0)} células do herói após 20 s`);
  check(!r.outcome && w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), `20 s de combate real ao lado de um bando: sem desfecho e sem NaN (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 83
async function m83(): Promise<void> {
  console.log("\n=== Missão 83 — The Stone Web ===");
  const data = await loadData(83);
  const start = (hero: HeroState = heroOf(false, false)) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  check(Math.abs(h.cx - 130) <= 3 && Math.abs(h.cy - 16) <= 3, `herói nasce no Drop Location (130,16): ${h.cx},${h.cy}`);
  const necros = group(r, 15);
  check(necros.length === 16 && necros.filter(u => u.name === "Necromancer").length === 3 && necros.every(u => u.player === 2), "grupo 15: 3 necromantes + 13 zumbis (jogador 2)");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho (o gatilho da vitória não dispara com o grupo vivo)");
  killAll(r, necros.filter(u => u.name === "Necromancer")); settle(r, 25);
  check(!r.outcome, "só os necromantes mortos (zumbis vivos): sem desfecho");
  killAll(r, necros.slice(1)); settle(r, 25);
  check(!r.outcome, "um único vivo do grupo 15: sem desfecho");
  killAll(r, necros); settle(r, 25);
  check(r.outcome?.ok === true && has(r, 2), `grupo 15 morto: msg 2 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, heroOf(false, false)), "script sem ações sem suporte e falas com texto");
  // o resto do mapa morto (fora do grupo 15) não conta
  r = start(); settle(r, 5); killAll(r, ofPlayer(r, 2).filter(u => !group(r, 15).includes(u))); settle(r, 30);
  check(!r.outcome && group(r, 15).every(u => u.alive), "o resto do mapa morto e o grupo 15 vivo: sem desfecho");
  // o grupo 15 está longe (59,72): nada o traz sozinho
  r = start(); w = r.b.world; h = r.b.hero;
  const z = group(r, 15)[0]!, d0 = dist(z, h);
  run(r, 20 * 20, () => keep(r));
  check(!r.outcome && w.units.every(u => Number.isFinite(u.x)), `20 s parado em (130,16): o grupo 15 a ${d0.toFixed(0)} células não chega sozinho (${dist(z, h).toFixed(0)})`);
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    r = start(hero); settle(r, 5); killAll(r, group(r, 15)); settle(r, 30);
    check(r.outcome?.ok === true && messagesHaveText(r, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  // campanha: 83 só no acampamento druida (npc 677) com vars[536] != 0 (estágio 80)
  r = start(); settle(r, 5); killAll(r, group(r, 15)); settle(r, 30);
  const st0 = campaignUpTo(83, false, false);
  check(availableMissions(st0).includes(83) && getVar(st0, 536) !== 0, `campanha: 83 disponível no estágio 80 com vars[536] = ${getVar(st0, 536)}`);
  const vars = sceneVars(r);
  check(Object.keys(vars).every(k => Number(k) >= 752), `MissionResult.scenarioVars só com subobjetivos: ${JSON.stringify(vars)}`);
  onMissionResult(st0, campaignData!, { id: 83, outcome: "complete", scenarioVars: vars });
  check(isDone(st0, 83) && !availableMissions(st0).includes(83), "campanha: 83 concluída pelo MissionResult");
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 84
async function m84(): Promise<void> {
  console.log("\n=== Missão 84 — Tekel Knows! ===");
  const data = await loadData(84);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const tekel = unit(r, 70);
  check(Math.abs(h.cx - 63) <= 3 && Math.abs(h.cy - 13) <= 3, `herói nasce no Drop Location (63,13): ${h.cx},${h.cy}`);
  check(tekel.player === 3 && Math.abs(tekel.cx - 16) <= 1 && Math.abs(tekel.cy - 13) <= 1, `ídolo Tekel (70, jogador 3) em (${tekel.cx},${tekel.cy})`);
  const defenders = ofPlayer(r, 2);
  check(defenders.length === 28, `${defenders.length} defensores de Orakul (jogador 2)`);
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  check(tekel.phased, "Tekel fora de fase (Phase out unit)");
  // com defensores vivos o herói junto de Tekel não basta
  beside(r, h, 70); settle(r);
  check(!has(r, 2) && !r.outcome, "herói a <= 4 de Tekel com defensores vivos: nada");
  killAll(r, defenders.slice(1)); settle(r);
  check(!r.outcome, "um defensor vivo: nada");
  at(r, h, 63, 13); killAll(r, defenders); settle(r, 25);
  check(!r.outcome, "defensores mortos mas o grupo longe de Tekel: sem desfecho");
  at(r, h, 24, 13); settle(r);
  check(!r.outcome, "herói a 8 células de Tekel (> 4): sem desfecho");
  beside(r, h, 70); settle(r);
  check(has(r, 2) && r.outcome?.ok === true, `defensores mortos e herói a <= 4 de Tekel (fora de fase): msg 2 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(84, r, false, false);

  console.log("[84] Igles/Dina falam com Tekel; variantes; falhas do motor");
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5); killAll(q, ofPlayer(q, 2)); settle(q, 15); beside(q, unit(q, who), 70); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3), "Igles com Tekel: msg 3 e Mission Complete");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4), "Dina com Tekel: msg 4 e Mission Complete");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 2) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  // marcha real: o dragão (grupo 8) guarda Tekel; ao chegar perto os defensores atacam o grupo
  r = start(); w = r.b.world; h = r.b.hero;
  at(r, h, 24, 14);
  run(r, 20 * 20, () => keep(r));
  const dr = group(r, 8).filter(u => u.alive);
  console.log(`  info: dragões de Orakul (grupo 8): ${dr.length}, estados ${dr.map(u => u.state).join(",")}, a ${dr[0] ? dist(dr[0], h).toFixed(0) : "-"} células do herói`);
  // com a guarda de grupo do exe (raio 20/24, visão com relevo) os dragões alcançam também Igles/Dina, que podem cair (falha 3/4 do script)
  check(w.units.every(u => Number.isFinite(u.x)) && (!r.outcome || (!r.outcome.ok && (r.outcome.cause === 3 || r.outcome.cause === 4))),
    `20 s junto aos dragões que guardam Tekel: o combate roda sem desfecho do herói (${JSON.stringify(r.outcome)})`);
  companionsFail(start);
  talenaChain();
}

// ------------------------------------------------------------------------------------------- 85
async function m85(): Promise<void> {
  console.log("\n=== Missão 85 — The Storyteller ===");
  const data = await loadData(85);
  const hero0 = (): HeroState => heroOf(false, true);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const leader = unit(r, 8);
  const wolves = (q: Run): Unit[] => ofPlayer(q, 5);
  const swarming = (q: Run): boolean => wolves(q).length > 0 && wolves(q).every(u => u.ai?.type === "swarm");
  const away = (q: Run): void => { for (const id of [10001, 10002, 10003]) at(q, unit(q, id), 39 + (id - 10001) * 2, 40); };
  check(Math.abs(h.cx - 39) <= 3 && Math.abs(h.cy - 14) <= 3, `herói nasce no Drop Location (39,14): ${h.cx},${h.cy}`);
  check(leader.player === 2 && group(r, 1).includes(leader) && group(r, 1).length === 8, "líder dos aldeões (8) no grupo 1 (jogador 2), 8 aldeões");
  check(ofPlayer(r, 4).length === 18 && wolves(r).length === 8, `${ofPlayer(r, 4).length} ovelhas (jogador 4) e ${wolves(r).length} lobos atacantes (jogador 5, grupos 3 e 4)`);
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(5, 4) === 1 && w.diplomacyValue(5, 1) === 1, "aldeões em paz com o herói; lobos atacantes hostis a ovelhas e ao herói");
  settle(r, 20 * 20);
  check(has(r, 1) && !r.outcome && !has(r, 2) && !swarming(r), "20 s no ponto de partida: msg 1, os lobos não se mexem (contador parado)");
  // contador do círculo de iniciativa (39,10): o grupo inteiro a >= 15 células -> 16 ciclos depois os lobos marcham
  away(r); settle(r, 20 * 3);
  check(!swarming(r) && !has(r, 2), "grupo fora do círculo há 3 s: contador correndo, lobos ainda parados");
  settle(r, 20 * 8);
  check(swarming(r), "8 s depois: lobos atacantes marcham (grupos 3 e 4, swarm)");
  check(noUnsupported(r), "script sem ações sem suporte (Distance to nearest units of player)");
  // só o herói sair do círculo não basta (Igles e Dina ficam perto de (39,10))
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  for (const id of BOTH) hold(r, unit(r, id));
  at(r, h, 39, 40); settle(r, 20 * 15);
  check(!swarming(r), "só o herói fora do círculo (Igles e Dina dentro): lobos parados");
  // conversa com o líder: msg 2 e o contador corre sozinho
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  at(r, h, 39, 17); settle(r);
  check(!has(r, 2), "herói a 6 do líder (> 4): nada");
  beside(r, h, 8); settle(r);
  check(has(r, 2) && !has(r, 3) && !swarming(r), "herói com o líder: msg 2 (v70 = 1) e o contador começa");
  beside(r, unit(r, 10002), 8); settle(r, 20 * 3);
  check(!has(r, 3) && !swarming(r), "Igles depois: o líder não repete a fala (v70)");
  settle(r, 20 * 6);
  check(swarming(r), "~8 s depois da conversa: lobos marcham");
  // vitória: lobos mortos + herói de novo com o líder -> msg 5 e Mission Complete
  check(!r.outcome, "lobos vivos: sem desfecho");
  const wl = wolves(r);
  killAll(r, wl.slice(1)); settle(r);
  check(!r.outcome, "um lobo atacante vivo: sem desfecho");
  killAll(r, wl); for (const id of [10001, 10002, 10003]) at(r, unit(r, id), 38, 40); settle(r, 25);
  check(!r.outcome, "lobos mortos mas o grupo longe do líder: sem desfecho");
  beside(r, h, 8); settle(r, 25);
  check(has(r, 5) && r.outcome?.ok === true, `lobos mortos e herói com o líder: msg 5 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(85, r, false, true);

  console.log("[85] lobos reais comendo as ovelhas (falha 7); Igles/Dina; variantes; falhas");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 8);
  const sheep0 = ofPlayer(r, 4).length;
  const t = run(r, 20 * 240, () => { keep(r); leader.hp = leader.maxHp; });
  console.log(`  info: ovelhas ${sheep0} -> ${ofPlayer(r, 4).length} em ${(t / 20).toFixed(0)} s; lobos vivos ${wolves(r).length}; desfecho ${JSON.stringify(r.outcome)}`);
  check(ofPlayer(r, 4).length < sheep0, "os lobos atacantes chegam às ovelhas e matam algumas sem ninguém defender");
  if (!r.outcome) { killAll(r, ofPlayer(r, 4).slice(0, ofPlayer(r, 4).length - 15)); settle(r, 25); }
  failedWith(r, 7, "ovelhas <= 15");
  r = start(); settle(r, 5); killAll(r, ofPlayer(r, 4).slice(0, 2)); settle(r, 30);
  check(!r.outcome, "2 ovelhas perdidas (16 restam): sem falha");
  killAll(r, ofPlayer(r, 4).slice(0, 1)); settle(r, 30);
  failedWith(r, 7, "15 ovelhas restantes");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, group(r, 1)[3]!, 1); settle(r, 30);
  failedWith(r, 5, "atacar um aldeão");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 8)); settle(r, 30);
  failedWith(r, 6, "líder morto");
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5); beside(q, unit(q, who), 8); settle(q, 25);
    killAll(q, wolves(q)); at(q, q.b.hero, 38, 40); at(q, unit(q, 10002), 38, 40); at(q, unit(q, 10003), 38, 40); settle(q, 25);
    beside(q, unit(q, who), 8); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 6), "Igles conduz as duas conversas: msgs 3 e 6");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 7), "Dina conduz as duas conversas: msgs 4 e 7");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 5) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); killAll(r, wolves(r)); beside(r, r.b.hero, 8); settle(r, 25);
  check(r.outcome?.ok === true && has(r, 2) && has(r, 5), "lobos mortos antes de qualquer conversa: as duas falas (2 e 5) na mesma passada e vitória");
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 86
async function m86(): Promise<void> {
  console.log("\n=== Missão 86 — The Swamp Mage ===");
  const data = await loadData(86);
  const hero0 = (): HeroState => heroOf(true, true);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const mage = unit(r, 38), fake = unit(r, 12);
  const beasts = (q: Run): Unit[] => group(q, 2);
  check(Math.abs(h.cx - 67) <= 3 && Math.abs(h.cy - 65) <= 3, `herói nasce no Drop Location (67,65): ${h.cx},${h.cy}`);
  check(mage.player === 3 && fake.player === 2 && group(r, 1).includes(fake) && ofPlayer(r, 2).length === 11 && beasts(r).length === 9 && beasts(r).every(u => u.player === 5),
    "maga do pântano (38, druida, jogador 3), falsa maga (12) entre os 11 bandidos (jogador 2), 9 feras (grupo 2, jogador 5)");
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(5, 1) === 0 && w.diplomacyValue(3, 1) === 0, "bandidos, feras e druida em paz com a maga");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // maga verdadeira: paz com as feras -> feras do jogador, bandidos hostis
  beside(r, h, 38); settle(r);
  check(has(r, 8) && beasts(r).every(u => u.player === 1) && w.diplomacyValue(1, 2) === 1, `herói com a maga do pântano: msg 8, as 9 feras passam para o jogador e o herói fica hostil aos bandidos (bandidos->herói = ${w.diplomacyValue(2, 1)}: a ação "Brigands to Self enemy" existe mas nenhum gatilho a usa)`);
  console.log(`  info: feras do jogador: ai ${[...new Set(beasts(r).map(u => u.ai?.type))].join("/")}`);
  check(!r.outcome, "bandidos vivos: sem desfecho");
  beside(r, h, 38); settle(r);
  check(!has(r, 11) && !r.outcome, "conversa de novo com bandidos vivos: nada");
  // a falsa maga depois do pacto: nada (v72 != 0)
  beside(r, h, 12); settle(r);
  check(!has(r, 2) && !has(r, 5), "falsa maga depois do pacto: nada");
  const brigands = ofPlayer(r, 2);
  killAll(r, brigands.slice(1)); beside(r, h, 38); settle(r, 25);
  check(!r.outcome, "um bandido vivo: sem desfecho");
  killAll(r, brigands); settle(r, 10); beside(r, h, 38); settle(r, 25);
  check(has(r, 11) && r.outcome?.ok === true, `bandidos mortos e herói com a maga: msg 11 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(86, r, true, true);

  console.log("[86] falsa maga primeiro; feras atacadas; Igles/Dina; variantes; falhas");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 12); settle(r);
  check(has(r, 2) && !r.outcome, "falsa maga (12) com a maga: msg 2");
  beside(r, h, 12); settle(r);
  check(!has(r, 5), "feras vivas: a segunda fala da falsa maga não vem");
  killAll(r, beasts(r)); settle(r, 20); beside(r, h, 12); settle(r);
  check(has(r, 5), "feras mortas: falsa maga de novo, msg 5");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  w.damage(h, beasts(r)[0]!, 1); settle(r, 10);
  check(w.diplomacyValue(5, 1) === 1 && !r.outcome, "herói ataca uma fera: feras hostis, sem falha");
  beside(r, h, 38); settle(r);
  check(has(r, 14) && !has(r, 8) && beasts(r).every(u => u.player === 5), "maga do pântano depois do ataque às feras: msg 14 (as feras morreram), sem pacto");
  killAll(r, ofPlayer(r, 2)); beside(r, h, 38); settle(r, 25);
  check(has(r, 11) && r.outcome?.ok === true, "(v72 = 1) bandidos mortos e maga de novo: msg 11 e Mission Complete");
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5); beside(q, unit(q, who), 38); settle(q, 25);
    killAll(q, ofPlayer(q, 2)); settle(q, 10); beside(q, unit(q, who), 38); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 9) && has(q, 12), "Igles conduz as duas conversas: msgs 9 e 12");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 10) && has(q, 13), "Dina conduz as duas conversas: msgs 10 e 13");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 11) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 38)); settle(r, 30);
  failedWith(r, 5, "maga do pântano morta");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 38), 1); settle(r, 30);
  failedWith(r, 6, "maga do pântano atacada");
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- 87
async function m87(): Promise<void> {
  console.log("\n=== Missão 87 — The Dark Library ===");
  const data = await loadData(87);
  const hero0 = (): HeroState => heroOf(true, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const lib = unit(r, 20), town = unit(r, 36);
  const defenders = (q: Run): Unit[] => group(q, 6);
  check(Math.abs(h.cx - 66) <= 3 && Math.abs(h.cy - 55) <= 3, `herói nasce no Drop Location (66,55): ${h.cx},${h.cy}`);
  check(lib.player === 2 && town.player === 2 && defenders(r).length === 10 && defenders(r).every(u => u.player === 3), "bibliotecário (20) e cidadão (36) necromantes em paz (jogador 2); 10 defensores mortos-vivos (grupo 6, jogador 3)");
  check(w.diplomacyValue(2, 1) === 0 && w.diplomacyValue(3, 1) === 1, "necromantes em paz, mortos-vivos hostis");
  settle(r, 20 * 3);
  check(has(r, 1) && !r.outcome && !sub(r, 1), "msg 1, sem desfecho");
  // casa do bibliotecário (54,13): a <= 15 células a fala vem uma vez
  at(r, h, 54, 30); settle(r);
  check(!has(r, 14), "herói a 17 células da casa (54,13): ainda não");
  at(r, h, 54, 27); settle(r);
  check(has(r, 14), "herói a 14 células da casa: msg 14");
  const n14 = r.messages.filter(m => m === 14).length;
  at(r, h, 54, 22); settle(r, 40);
  check(r.messages.filter(m => m === 14).length === n14, "a fala da casa não se repete (v75)");
  // sem conversar com o cidadão e sem os defensores mortos: nada
  at(r, h, 54, 14); killAll(r, defenders(r)); settle(r);
  check(!has(r, 8) && !r.outcome, "casa vazia de defensores mas o cidadão não falou (v71 = 0): sem os livros");
  beside(r, h, 36); settle(r);
  check(has(r, 5), "herói com o cidadão: msg 5 (v71 = 1)");
  beside(r, h, 20); settle(r);
  check(has(r, 2) && sub(r, 1) === 1 && !has(r, 11) && !r.outcome, "herói com o bibliotecário: msg 2 e sub 1; livros ainda não achados -> sem a 2ª conversa");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 20); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "bibliotecário (28,57): msg 2 e sub 1 (achar a biblioteca) ativo");
  beside(r, h, 20); settle(r);
  check(r.messages.filter(m => m === 2).length === 1, "a conversa só vem uma vez (v70)");
  beside(r, h, 36); settle(r);
  check(has(r, 5), "cidadão (21,19): msg 5");
  at(r, h, 54, 14); settle(r, 25);
  check(!has(r, 8) && !r.outcome, "defensores vivos junto da casa: os livros não são achados");
  killAll(r, defenders(r).slice(1)); settle(r, 25);
  check(!has(r, 8), "um defensor vivo: nada");
  killAll(r, defenders(r)); settle(r, 25);
  check(has(r, 8) && !r.outcome, "defensores mortos e herói a <= 4 da casa: msg 8 (livros roubados achados)");
  beside(r, h, 36); settle(r);
  check(!has(r, 11) && !r.outcome, "só falar com o cidadão não basta");
  beside(r, h, 20); settle(r, 25);
  check(has(r, 11) && sub(r, 1) === 2 && r.outcome?.ok === true, `herói de novo com o bibliotecário: msg 11, sub 1 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(87, r, true, false);

  console.log("[87] Igles/Dina; variantes; falhas");
  /** cadeia curta por teletransporte: bibliotecário -> cidadão -> defensores mortos -> casa -> bibliotecário (com `who` em cada passo) */
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5);
    beside(q, unit(q, who), 20); settle(q); beside(q, unit(q, who), 36); settle(q);
    killAll(q, defenders(q)); at(q, unit(q, who), 54, 14); settle(q, 25);
    beside(q, unit(q, who), 20); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 6) && has(q, 9) && has(q, 12), "Igles conduz a cadeia: msgs 3, 6, 9 e 12");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 7) && has(q, 10) && has(q, 13), "Dina conduz a cadeia: msgs 4, 7, 10 e 13");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 11) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  // combate real: o grupo na casa (54,13) com os 10 mortos-vivos do grupo 6 ao redor; invulnerável só neste trecho, os livros só valem com eles mortos
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; }
  beside(r, h, 36); settle(r); at(r, h, 54, 15);
  run(r, 20 * 25, () => keep(r));
  const left = defenders(r).filter(u => u.alive).length;
  console.log(`  info: defensores da casa vivos após 25 s de combate real: ${left}/10`);
  check(!has(r, 8) && !r.outcome && w.units.every(u => Number.isFinite(u.x)) && (left < 10 || defenders(r).some(u => u.state === "attack" || u.hp < u.maxHp)), "25 s junto à casa com os defensores vivos: combate real e nenhuma descoberta dos livros");
  r = start(); settle(r, 5); at(r, unit(r, 10002), 54, 28); settle(r); at(r, unit(r, 10003), 54, 28); settle(r);
  check(has(r, 15) || has(r, 16), "Igles/Dina a <= 15 da casa: msg 15/16 (só uma vez no total)");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 20), 1); settle(r, 30);
  failedWith(r, 5, "atacar o bibliotecário (necromantes hostis)");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 36), 1); settle(r, 30);
  failedWith(r, 5, "atacar o cidadão");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 20)); settle(r, 30);
  failedWith(r, 6, "bibliotecário morto");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, defenders(r)[0]!, 1); settle(r, 30);
  check(!r.outcome, "atacar os mortos-vivos da casa (jogador 3, já hostis) não falha");
  companionsFail(start);
}

// ------------------------------------------------------------------------------------------- execução
const only = proc.argv.slice(2).map(Number).filter(n => n > 0);
const all: [number, () => Promise<void>][] = [
  [80, m80], [81, () => campMission(CAMPS[0]!)], [82, () => campMission(CAMPS[1]!)], [83, m83], [84, m84], [85, m85], [86, m86], [87, m87],
];
for (const [id, fn] of all) {
  if (only.length && !only.includes(id)) continue;
  try { await fn(); } catch (e) { failures++; console.log(`  FALHOU: missão ${id} lançou exceção: ${(e as Error).stack ?? e}`); }
}
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
