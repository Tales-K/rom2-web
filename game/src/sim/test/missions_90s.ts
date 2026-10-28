/**
 * Pilotos automáticos headless das missões 90-96, 100-103 e 110 (scripts em data/scripts/mission_<n>.txt).
 * Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/missions_90s.ts)
 * Opcional: `npx tsx src/sim/test/missions_90s.ts 93` roda só a missão pedida.
 *
 * Padrão de missions_80s.ts (helpers em pilot.ts): monta a missão como a cena (loader.ts startRun) com Igles (10002) e Dina (10003) no grupo, leva o
 * herói pelos gatilhos do script (teletransporta entre os pontos) e MATA (w.kill) o que o script exige morto; cobre as falhas do script e as do motor
 * (causa 2 = herói, 3 = Igles, 4 = Dina). Trechos reais (marchas de dragões/trolls, combate junto aos bandos, magias lançadas como pergaminho, pegar
 * o saco do chão, escolta de longa distância) provam caminho/IA/host. Cada missão confere também o contrato com o motor de campanha
 * (MissionResult.scenarioVars -> onMissionResult) e quem a oferece na taverna.
 *   90 A Kings Request: druida chefe (15) -> v70, aliança com os druidas; podstava (78) -> emboscada (grupo 7) faz os necromantes inimigos; grupo 7 morto.
 *   91 The Orcologist: orcólogo (95) fala; ingrediente (item 58 = 3666) com o xamã orc 41, que o larga ao morrer; entregar ao orcólogo = vitória.
 *   92 The Ancient Crypt: cadeia dos druidas (armadilheiro 55, falante 56, fantasmas 53) com 3 súcubos, dragão 57; todos os necromantes (jogador 2) mortos = vitória.
 *   93-96 As Fontes de Magia (Talena): alavancas (Switch) -> teleporte do centro; enigma de fogo/terra/água/ar com magias lançadas; prêmio da pirâmide
 *      (marcador fora de fase) e chegada a (10,135).
 *   100 The King's Hunt, 101 Forest Madness, 102 Mysterious Amulet (amuleto do chão), 103 The Desert Oracle (alavancas, escolta do xamã), 110 The Last Battle.
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { loadData, proc, run, startRun, type Run } from "./loader";
import {
  at, beside, BOTH, campaignContract, campaignData, castAt, castOn, check, companionsFail, count, dist, distTo, failCause, failed, failedWith, group, has, heroOf, hold, immortal,
  keep, killAll, messagesHaveText, noUnsupported, offeredBy, ofPlayer, pickupAt, settle, sub, summary, unit, unstone, VARIANTS,
} from "./pilot";
import { healDying } from "../necro";
import { pickupText, sackAtCell } from "../../mission/pickup";
import { WalkThenUse, switchAtCell } from "../../mission/interact";
import { availableMissions, getVar, isDone, nextAfterMission, takePendingVideos } from "../../campaign/engine";
import type { CampaignState } from "../../campaign/types";

import { TICKS_PER_SEC } from "../types";
const all3 = (r: Run): Unit[] => [r.b.hero, unit(r, 10002), unit(r, 10003)];
/** o grupo inteiro (herói, Igles, Dina) para junto de (x, y) */
function groupAt(r: Run, x: number, y: number): void { for (const [i, u] of all3(r).entries()) at(r, u, x + i, y); }

// ------------------------------------------------------------------------------------------- 90
async function m90(): Promise<void> {
  console.log("\n=== Missão 90 — A Kings Request ===");
  const data = await loadData(90);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const druid = unit(r, 15), pod = unit(r, 78);
  const ambush = (q: Run): Unit[] => group(q, 7);
  check(Math.abs(h.cx - 83) <= 3 && Math.abs(h.cy - 133) <= 3, `herói nasce no Drop Location (83,133): ${h.cx},${h.cy}`);
  check(druid.player === 5 && pod.player === 4 && ambush(r).length === 15 && ambush(r).every(u => u.player === 4), "druida chefe (15, jogador 5), podstava (78, necromante), emboscada de 15 (grupo 7, jogador 4)");
  check(w.diplomacyValue(5, 1) === 0 && w.diplomacyValue(4, 1) === 0, "druidas e necromantes em paz com o herói no início");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 10) && sub(r, 1) === 1 && !r.outcome, "msg 10 (início) e sub 1 (achar a causa) ativo");
  check(ambush(r).every(u => u.phased) && group(r, 4).every(u => u.phased), "emboscada (grupo 7) e necromantes do teleporte (grupo 4) fora de fase");
  // druida ferido (50,118), força de cavaleiros (27,106), teleporte dos necromantes (99,24)
  groupAt(r, 50, 118); settle(r);
  check(has(r, 2) && sub(r, 3) === 1, "druida ferido (50,118): msg 2 e sub 3 (avisar os druidas)");
  groupAt(r, 27, 106); settle(r);
  check(has(r, 3), "força de cavaleiros (27,106): msg 3");
  const lancers = group(r, 5);
  check(lancers.length === 16 && lancers.every(u => u.ai?.type === "swarm"), `os ${lancers.length} lanceiros do grupo 5 marcham (swarm) rumo aos druidas`);
  const l0 = distTo(lancers[0]!, 128, 15);
  run(r, TICKS_PER_SEC * 15, () => keep(r));
  console.log(`  info: lanceiro 1 a ${l0.toFixed(0)} -> ${distTo(lancers[0]!, 128, 15).toFixed(0)} células de (128,15) em 15 s`);
  check(distTo(lancers[0]!, 128, 15) < l0 - 3 || !lancers[0]!.alive, "a marcha dos lanceiros avança");
  groupAt(r, 99, 24); settle(r);
  check(has(r, 11) && group(r, 4).every(u => !u.phased), "teleporte dos necromantes (99,24): msg 11 e grupo 4 aparece");
  // podstava sozinho antes do druida: msg 1 e sub 2
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  hold(r, unit(r, 10002)); hold(r, unit(r, 10003)); at(r, h, 81, 117); settle(r);
  check(has(r, 1) && sub(r, 2) === 1 && !has(r, 13), "perto da podstava (81,119): msg 1 e sub 2 (matar os druidas) ativo");
  // atacar a podstava: necromantes hostis -> emboscada aparece (msg 13) -> matar o grupo 7 = vitória
  w.damage(h, unit(r, 78), 1); settle(r, 30);
  check(has(r, 13) && ambush(r).every(u => !u.phased) && !r.outcome, "atacar a podstava: msg 13 e a emboscada (grupo 7) aparece");
  check(w.diplomacyValue(4, 1) === 1 && w.diplomacyValue(5, 1) === 0, "necromantes em guerra com o herói, druidas ainda em paz");
  killAll(r, ambush(r).slice(1)); settle(r, 25);
  check(!r.outcome, "um único da emboscada vivo: sem desfecho");
  killAll(r, ambush(r)); settle(r, 25);
  check(r.outcome?.ok === true && sub(r, 4) === 2, `emboscada morta: Mission Complete e sub 4 cumprido (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(90, r);

  console.log("[90] druida chefe -> aliança; podstava grita; emboscada; combate real");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 15); settle(r);
  check(has(r, 4) && sub(r, 1) === 2 && sub(r, 4) === 1, "druida chefe (129,14) com o herói: msg 4, sub 1 cumprido e sub 4 (matar os necromantes) ativo");
  check(w.diplomacyValue(5, 1) === 2 && w.diplomacyValue(6, 1) === 2 && w.diplomacyValue(1, 5) === 2, "druidas (5), monstros dos druidas (6) e o herói em aliança");
  check(group(r, 9).every(u => u.ai?.type === "swarm") && group(r, 10).every(u => u.ai?.type === "swarm"), "dragões (grupo 9) e trolls (grupo 10) marcham em defesa dos druidas");
  check(!has(r, 12), "emboscada ainda escondida (a podstava não gritou)");
  const dr0 = group(r, 9).map(u => distTo(u, 122, 20));
  run(r, TICKS_PER_SEC * 20, () => keep(r));
  const drNow = group(r, 9).map(u => distTo(u, 122, 20));
  console.log(`  info: dragões a ${dr0.map(d => d.toFixed(0))} -> ${drNow.map(d => d.toFixed(0))} células de (122,20) em 20 s`);
  check(group(r, 9).some((u, i) => drNow[i]! < dr0[i]! - 3 || distTo(u, 122, 20) < 6), "os dragões marcham para os druidas");
  // a podstava grita com o herói (v70 > 0): emboscada + necromantes inimigos
  beside(r, h, 78); settle(r, 30);
  check(has(r, 7) && has(r, 12) && ambush(r).every(u => !u.phased) && w.diplomacyValue(4, 1) === 1, "podstava com o herói: msg 7, msg 12, emboscada aparece e os necromantes viram inimigos");
  check(r.messages.filter(m => m === 7).length === 1, "a podstava só grita uma vez (v71)");
  killAll(r, ambush(r)); settle(r, 25);
  check(r.outcome?.ok === true && sub(r, 4) === 2, "emboscada morta: Mission Complete");
  // atacar druida antes da aliança: falha 5; depois da aliança não há falha (gatilho de uma vez só)
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  w.damage(h, group(r, 3)[0]!, 1); settle(r, 30);
  failedWith(r, 5, "atacar um druida antes da aliança");
  // variantes: quem fala com o druida e com a podstava (herói 4/7, Igles 5/8, Dina 6/9)
  for (const [who, mm, pp] of [[10001, 4, 7], [10002, 5, 8], [10003, 6, 9]] as const) {
    for (const v of VARIANTS) {
      const hero = heroOf(v.mage, v.female);
      const q = start(hero); settle(q, 5);
      beside(q, unit(q, who), 15); settle(q); beside(q, unit(q, who), 78); settle(q, 30);
      check(has(q, mm) && has(q, pp) && has(q, 12) && messagesHaveText(q, hero), `${v.label}${who === 10001 ? "" : who === 10002 ? " (Igles)" : " (Dina)"}: falas ${mm}/${pp}/12 com texto`);
      if (who !== 10001) break; // as falas de Igles/Dina não dependem da variante: uma conferência basta
    }
  }
  // combate real: o grupo na podstava depois do pacto, com os necromantes em guerra
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 15); settle(r); beside(r, h, 78); settle(r, 30);
  for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; }
  const alive0 = ambush(r).filter(u => u.alive).length;
  run(r, TICKS_PER_SEC * 25, () => keep(r));
  console.log(`  info: emboscada ${alive0} -> ${ambush(r).filter(u => u.alive).length} vivos após 25 s de combate real`);
  check(!r.outcome?.ok && w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), "25 s de combate real junto à emboscada: sem NaN e sem vitória precoce");
  companionsFail(start);
  const by = offeredBy(90, false, false);
  check(by === 2004, `campanha: a 90 é oferecida pelo enviado necromante (npc 2004), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 91
const INGR = "3666"; // item 58 do script = 3608 + 58
async function m91(): Promise<void> {
  console.log("\n=== Missão 91 — The Orcologist ===");
  const data = await loadData(91);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const orc = unit(r, 95), shaman = unit(r, 41);
  check(Math.abs(h.cx - 15) <= 3 && Math.abs(h.cy - 130) <= 3, `herói nasce no Drop Location (15,130): ${h.cx},${h.cy}`);
  check(orc.player === 4 && shaman.player === 3 && shaman.items.includes(INGR), `orcólogo (95, jogador 4) e o xamã orc 41 (jogador 3) com o ingrediente ${INGR} (item 58)`);
  check(w.diplomacyValue(4, 1) === 0, "orcólogo em paz com o herói");
  const patrol = [...group(r, 4), ...group(r, 5)];
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1 e sub 1 (achar o orcólogo) ativo");
  check(patrol.length === 2 && patrol.every(u => u.ai?.type === "patrol") && group(r, 6).every(u => u.ai?.type === "hold"), "orcs dos grupos 4 e 5 patrulham; grupo 6 (orcólogo e ajudante) em stand ground");
  const p0 = patrol.map(u => ({ x: u.x, y: u.y }));
  run(r, TICKS_PER_SEC * 20, () => keep(r));
  check(patrol.some((u, i) => Math.hypot(u.x - p0[i]!.x, u.y - p0[i]!.y) > 4), "os patrulheiros orcs andam de verdade (patrol até (64,36)/(68,37))");
  // 1ª conversa -> sub 1 cumprido, sub 2 (ingrediente)
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  at(r, h, 96, 118); settle(r);   // (100,112) é margem do lago: água no plano de passagem do exe
  check(!has(r, 2), "herói a > 4 do orcólogo: nada");
  beside(r, h, 95); settle(r);
  check(has(r, 2) && sub(r, 1) === 2 && sub(r, 2) === 1 && count(r, 2) === 1, "1ª conversa: msg 2, sub 1 cumprido e sub 2 (ingrediente) ativo");
  beside(r, h, 95); settle(r);
  check(count(r, 2) === 1 && !has(r, 5), "a 1ª conversa não se repete (v70) e sem o ingrediente não há a 2ª");
  // xamã morto larga o saco; o herói caminha de verdade até ele e pega
  const shamanR = unit(r, 41);   // o xamã DESTA corrida (o `shaman` acima é o da 1ª)
  const where = { x: shamanR.cx, y: shamanR.cy };
  w.kill(shamanR, h); settle(r, 10);
  const sack = w.loot.find(l => l.items.includes(INGR));
  check(!!sack && sack.x === where.x && sack.y === where.y, `o xamã larga o ingrediente no chão em (${where.x},${where.y})`);
  at(r, h, sack!.x - 3, sack!.y + 1);
  check(pickupAt(r, h, sack!.x, sack!.y) && h.items.includes(INGR), "o herói anda até o saco e pega o ingrediente (ordem pickup)");
  settle(r, 25);
  check(has(r, 8) && sub(r, 2) === 2 && sub(r, 3) === 1 && !r.outcome, "com o ingrediente: msg 8, sub 2 cumprido e sub 3 (entregar) ativo");
  const gold0 = r.gold;
  beside(r, h, 95); settle(r, 25);
  check(has(r, 5) && r.outcome?.ok === true && sub(r, 3) === 2, `entrega ao orcólogo: msg 5, sub 3 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(!h.items.includes(INGR) && r.gold - gold0 === 1000000, `o ingrediente sai da mochila e o jogador recebe 1.000.000 de ouro (${r.gold - gold0})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(91, r);

  console.log("[91] Igles/Dina; variantes; falhas");
  /** cadeia curta: 1ª conversa -> ingrediente (com `who`) -> 2ª conversa (com `who`) */
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5);
    beside(q, unit(q, who), 95); settle(q);
    q.b.world.kill(unit(q, 41), q.b.hero); settle(q, 5);
    const sk = q.b.world.loot.find(l => l.items.includes(INGR))!;
    at(q, unit(q, who), sk.x, sk.y); pickupAt(q, unit(q, who), sk.x, sk.y); settle(q, 25);
    beside(q, unit(q, who), 95); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 9) && has(q, 6), "Igles conduz a cadeia: msgs 3, 9 e 6");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 10) && has(q, 7), "Dina conduz a cadeia: msgs 4, 10 e 7");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 2) && has(q, 8) && has(q, 5) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 95), 1); settle(r, 30);
  failedWith(r, 5, "atacar o orcólogo");
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 95)); settle(r, 30);
  failedWith(r, 6, "orcólogo morto");
  // chegar à 2ª conversa sem o ingrediente: nada; um orc patrulheiro hostil perto do herói: combate real sem desfecho
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  const pat = group(r, 5)[0]!;
  at(r, h, pat.cx + 3, pat.cy); for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; }
  let engaged = false;
  run(r, TICKS_PER_SEC * 15, () => { keep(r); if (pat.state === "attack") engaged = true; });
  console.log(`  info: patrulheiro orc (${pat.name}) vida ${Math.ceil(pat.hp)}/${pat.maxHp}, estado ${pat.state}`);
  check(engaged && !r.outcome && w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), "15 s de combate real com o patrulheiro orc (jogador 3, hostil): ele ataca o grupo, sem desfecho e sem NaN");
  companionsFail(start);
  const by = offeredBy(91, false, false);
  check(by === 681, `campanha: a 91 é oferecida pelo pregador druida (npc 681, acampamento), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 92
const SUCC = [64, 66, 68];
async function m92(): Promise<void> {
  console.log("\n=== Missão 92 — The Ancient Crypt ===");
  const data = await loadData(92);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()) => startRun(data, hero, undefined, { companions: BOTH });
  /** a cadeia dos druidas com `who` falando em cada passo, até a concordância do armadilheiro (msg 12/13/14) */
  const chain = (q: Run, who = 10001): void => {
    settle(q, 5);
    at(q, q.b.hero, 45, 24); settle(q);                                         // fantasma (45,24): msg 11
    beside(q, unit(q, who), 55); settle(q);                                     // armadilheiro 55: msg 2/3/4
    killAll(q, SUCC.map(i => unit(q, i))); settle(q, 25);                       // súcubos mortos (v81)
    at(q, unit(q, who), 97, 16); settle(q);                                     // msg 5 (v70 = 2)
    beside(q, unit(q, who), 56); settle(q);                                     // falante 56: msg 6/7/8
    q.b.world.kill(unit(q, 57), q.b.hero); settle(q, 10);                       // dragão morto
    at(q, unit(q, who), 37, 114); settle(q);                                    // msg 9 (v76)
    beside(q, unit(q, who), 55); settle(q);                                     // armadilheiro concorda: msg 12/13/14 e passa a seguir
  };
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const trapper = unit(r, 55), talker = unit(r, 56), ghost = unit(r, 53), dragon = unit(r, 57), item = unit(r, 79);
  check(Math.abs(h.cx - 43) <= 3 && Math.abs(h.cy - 12) <= 3, `herói nasce no Drop Location (43,12): ${h.cx},${h.cy}`);
  check(trapper.player === 3 && talker.player === 3 && ghost.player === 4 && dragon.player === 6 && group(r, 1).length === 3 && ofPlayer(r, 2).length === 12,
    "druidas armadilheiro 55 e falante 56 (jogador 3), fantasmas (grupo 1, jogador 4), dragão 57, 12 necromantes (jogador 2)");
  check(item.items.includes("17762") && item.gold === 10000, "unidade 79 (marcador do prêmio) leva o item 17762 e 10000 de ouro");
  immortal(r);   // a guarda dos grupos (raio em volta do centroide, exe 0x57275f) alcança o grupo teletransportado pela cripta
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && item.phased && !r.outcome, "msg 1 e o marcador do prêmio (79) fora de fase");
  // sem ouvir o fantasma o armadilheiro não fala; depois sim
  beside(r, h, 55); settle(r);
  check(!has(r, 2), "armadilheiro (98,16) antes de ouvir os fantasmas: nada (v80 = 0)");
  at(r, h, 45, 24); settle(r);
  check(has(r, 11), "fantasma que fala (45,24): msg 11");
  beside(r, h, 55); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "armadilheiro com o herói: msg 2 e sub 1");
  at(r, h, 97, 16); settle(r);
  check(!has(r, 5), "perto do armadilheiro sem os súcubos mortos: sem a msg 5");
  killAll(r, SUCC.slice(0, 2).map(i => unit(r, i))); settle(r, 25);
  check(!has(r, 5), "2 de 3 súcubos mortos: nada (v81 = 0)");
  killAll(r, [unit(r, 68)]); settle(r, 25);
  check(has(r, 5) && sub(r, 1) === 2, "3 súcubos mortos e o grupo no armadilheiro: msg 5, sub 1 cumprido");
  beside(r, h, 56); settle(r);
  check(has(r, 6) && sub(r, 2) === 1, "falante (36,114) com o herói: msg 6 e sub 2");
  at(r, h, 37, 114); settle(r);
  check(!has(r, 9), "perto do falante com o dragão vivo: sem a msg 9");
  w.kill(dragon, h); settle(r, 25);
  check(has(r, 9) && sub(r, 2) === 2, "dragão 57 morto: msg 9, sub 2 cumprido");
  beside(r, h, 55); settle(r);
  check(has(r, 12) && sub(r, 3) === 1 && trapper.ai?.type === "follow", `armadilheiro concorda: msg 12, sub 3 e ele passa a seguir o herói (ai ${trapper.ai?.type})`);
  check(!has(r, 15), "fantasmas ainda parados (msg 15 só quando o armadilheiro os alcança)");
  // escolta de verdade: o armadilheiro (jogador 3) segue o herói até os fantasmas e depois até o falante, com os fantasmas atrás dele
  for (const u of [trapper, ...all3(r)]) { u.maxHp = u.hp = 100000; u.stats = { ...u.stats, healthRegen: 0 }; } // grupo "imortal" (sem regeneração: 0x50fc5a estouraria o short) só na escolta (as abelhas matam a Dina de 26 PV de um golpe)
  at(r, h, 44, 27);
  // o herói fica (Stand ground): quem atira de longe nele (a guarda dos grupos alcança mais longe, exe 0x57275f) não o tira do lugar
  w.command(h, { type: "hold" });
  let t = run(r, TICKS_PER_SEC * 150, () => { keep(r); return trapper.alive && dist(trapper, ghost) <= 3.5; });
  console.log(`  info: armadilheiro andou ${(t / TICKS_PER_SEC).toFixed(0)} s até os fantasmas; está a ${dist(trapper, ghost).toFixed(1)} deles`);
  settle(r, 25);
  check(has(r, 15) && group(r, 1).every(u => u.ai?.type === "follow"), "armadilheiro chega aos fantasmas: msg 15 e os fantasmas passam a segui-lo");
  // o jogador leva o grupo até o falante e, se os fantasmas pararem longe (seguem a até 4,5 células do armadilheiro), dá a volta para trazê-los
  t = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [2, 0], [-2, 0], [0, -2], [0, 2], [1, 1], [-1, -1]] as const) {
    at(r, h, talker.cx + dx, talker.cy + dy);
    t += run(r, TICKS_PER_SEC * 30, () => { keep(r); return has(r, 10) || r.outcome !== null; });
    if (has(r, 10) || r.outcome) break;
  }
  console.log(`  info: escolta até o falante em ${(t / TICKS_PER_SEC).toFixed(0)} s; fantasma a ${dist(ghost, talker).toFixed(1)} do falante`);
  settle(r, 10);
  check(has(r, 10) && sub(r, 3) === 2, "fantasma a <= 4 do falante: msg 10 e sub 3 cumprido");
  check(group(r, 1).every(u => u.ai?.type === "move") && trapper.ai?.type === "move", "fantasmas voltam ao posto (85,42) e o armadilheiro volta (99,16)");
  settle(r, 25);
  const prize = w.loot.find(l => l.items.includes("17762"));
  check(!!prize, "Get Subobjective(3) >= 2: o prêmio é largado pelo marcador (79)");
  if (prize) {
    at(r, h, prize.x - 2, prize.y + 1);
    const g0 = h.gold;
    killAll(r, ofPlayer(r, 6).filter(u => Math.hypot(u.x - prize.x, u.y - prize.y) < 10)); // abelhas e lagartos em volta bloqueiam o caminho do herói
    check(pickupAt(r, h, prize.x, prize.y) && h.items.includes("17762") && h.gold - g0 === 10000, `o herói pega o prêmio em (${prize.x},${prize.y}): item 17762 e 10000 de ouro`);
  }
  // vitória: todos os necromantes (jogador 2) mortos
  const necros = ofPlayer(r, 2);
  killAll(r, necros.slice(1)); settle(r, 25);
  check(!r.outcome, "um necromante vivo: sem desfecho");
  killAll(r, necros); settle(r, 25);
  check(r.outcome?.ok === true, `necromantes mortos: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(92, r);

  console.log("[92] Igles/Dina/variantes; falhas; vitória sem a cadeia");
  let q = start(); chain(q, 10002);
  check(has(q, 3) && has(q, 7) && has(q, 13) && has(q, 9), "Igles conduz a cadeia: msgs 3, 7, 13");
  q = start(); chain(q, 10003);
  check(has(q, 4) && has(q, 8) && has(q, 14), "Dina conduz a cadeia: msgs 4, 8, 14");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = start(hero); chain(q);
    killAll(q, ofPlayer(q, 2)); settle(q, 25);
    check(q.outcome?.ok === true && has(q, 12) && messagesHaveText(q, hero), `${v.label}: cadeia completa, Mission Complete e falas com texto`);
  }
  q = start(); settle(q, 5); killAll(q, ofPlayer(q, 2)); settle(q, 25);
  check(q.outcome?.ok === true, "necromantes mortos sem tocar na cadeia dos druidas: vitória (a cadeia só rende o prêmio)");
  q = start(); settle(q, 5); q.b.world.damage(q.b.hero, unit(q, 55), 1); settle(q, 30);
  failedWith(q, 5, "atacar o druida armadilheiro");
  q = start(); settle(q, 5); q.b.world.damage(q.b.hero, unit(q, 69), 1); settle(q, 30);
  failedWith(q, 6, "atacar um camponês (jogador 7)");
  // abelhas e fantasmas reais: 60 s parado junto aos fantasmas; a missão segue sem desfecho
  q = start(); settle(q, 5); at(q, q.b.hero, 44, 22);
  run(q, TICKS_PER_SEC * 60, () => keep(q));
  // com a guarda de grupo do exe (raio 20/24, visão com relevo) o dragão 57 e os vizinhos alcançam Igles/Dina, que podem cair (falha 3/4)
  check((!q.outcome || (!q.outcome.ok && (q.outcome.cause === 3 || q.outcome.cause === 4))) && q.b.world.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)),
    `60 s junto aos fantasmas e às abelhas: sem desfecho do herói e sem NaN (${JSON.stringify(q.outcome)})`);
  companionsFail(start);
  const by = offeredBy(92, false, false);
  check(by === 2003, `campanha: a 92 é oferecida pelo elfo (npc 2003, acampamento), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 100
async function m100(): Promise<void> {
  console.log("\n=== Missão 100 — The King's Hunt ===");
  const data = await loadData(100);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()): Run => {
    const q = startRun(data, hero, undefined, { companions: BOTH });
    immortal(q); hold(q, unit(q, 10002)); hold(q, unit(q, 10003)); // os cavaleiros maus matam a Dina de 26 PV de um golpe; e ela/Igles não vagam pela guerra
    return q;
  };
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const ranger = unit(r, 305), king = unit(r, 276), kingFree = unit(r, 306), guard = unit(r, 288), uncle = unit(r, 293);
  const followers = (q: Run): Unit[] => group(q, 23), kings = (q: Run): Unit[] => group(q, 27);
  check(Math.abs(h.cx - 14) <= 3 && Math.abs(h.cy - 81) <= 3, `herói nasce no Drop Location (14,81): ${h.cx},${h.cy}`);
  check(ranger.player === 9 && king.player === 8 && kingFree.player === 8 && guard.player === 7 && uncle.player === 7 && followers(r).length === 8 && kings(r).length === 1 && kings(r)[0] === kingFree,
    "guarda-florestal bom (305, jogador 9), rei com máscara (276) e sem máscara (306) do jogador 8, 8 seguidores (grupo 23), guarda (288) e tio (293) dos cavaleiros (jogador 7)");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && sub(r, 1) === 1 && kingFree.phased && !king.phased && !r.outcome, "msg 1, sub 1 (achar o rei); o rei sem máscara (306) fora de fase");
  check(w.diplomacyValue(8, 7) === 0 && w.diplomacyValue(8, 1) === 0 && w.diplomacyValue(7, 1) === 0, "cavaleiros bons, maus e o herói em paz no início");
  // conversas curtas: guarda-florestal bom (20,128), guarda (77,73) — cada uma só uma vez
  beside(r, h, 305); settle(r);
  check(has(r, 2) && count(r, 2) === 1, "guarda-florestal bom: msg 2");
  beside(r, h, 305); settle(r);
  check(count(r, 2) === 1, "a conversa do guarda-florestal não se repete (v71)");
  beside(r, h, 288); settle(r);
  check(has(r, 5) && !has(r, 8), "guarda dos cavaleiros: msg 5");
  at(r, h, 13, 17); settle(r);
  check(has(r, 12), "guarda-florestal mau (13,16): msg 12");
  // o rei: msg 8, o rei mascarado some, o sem máscara aparece e os cavaleiros maus entram em guerra com os bons e com o herói
  beside(r, h, 276); settle(r, 30);
  check(has(r, 8) && king.phased && !kingFree.phased && sub(r, 1) === 2 && sub(r, 2) === 1, "falar com o rei: msg 8, o rei mascarado sai, o sem máscara (306) entra; sub 1 cumprido e sub 2 (matar o rei) ativo");
  check(w.diplomacyValue(8, 7) === 1 && w.diplomacyValue(8, 1) === 1, "os cavaleiros maus ficam hostis aos bons e ao herói");
  check(!r.outcome, "rei vivo: sem desfecho");
  killAll(r, followers(r)); settle(r, 25);
  check(!r.outcome, "só os seguidores mortos (o rei sem máscara vivo): sem desfecho");
  kingFree.hp = kingFree.maxHp;
  killAll(r, kings(r)); settle(r, 25);
  check(r.outcome?.ok === true && has(r, 11) && sub(r, 2) === 2, `seguidores e rei mortos: msg 11, sub 2 cumprido e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  const st = campaignContract(100, r);
  check(getVar(st, 768) === 110 && availableMissions(st).length >= 0, `campanha: a 100 é principal, o estágio vai a 110 (${getVar(st, 768)})`);

  console.log("[100] seguidores sem o rei; guerra real entre os cavaleiros; Igles/Dina; variantes; falhas");
  // os seguidores mortos antes da conversa e o rei sem máscara (fora de fase, vivo): nada
  r = start(); settle(r, 5); killAll(r, followers(r)); settle(r, 25);
  check(!r.outcome, "seguidores mortos antes de falar com o rei: o rei sem máscara (vivo, fora de fase) impede a vitória");
  // guerra real depois da conversa: 8 seguidores do rei contra os cavaleiros bons; o tio (293) precisa sobreviver ou a missão falha (causa 5)
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  beside(r, h, 276); settle(r, 30);
  const bad0 = ofPlayer(r, 8).length, good0 = ofPlayer(r, 7).length;
  run(r, TICKS_PER_SEC * 60, () => keep(r));
  console.log(`  info: cavaleiros maus ${bad0} -> ${ofPlayer(r, 8).length}, bons ${good0} -> ${ofPlayer(r, 7).length} em 60 s; desfecho ${JSON.stringify(r.outcome)}`);
  check(w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)) && (ofPlayer(r, 8).length < bad0 || ofPlayer(r, 7).length < good0 || !!r.outcome), "60 s de guerra real entre os cavaleiros: houve baixas, sem NaN");
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5);
    beside(q, unit(q, who), 305); settle(q); beside(q, unit(q, who), 288); settle(q); beside(q, unit(q, who), 276); settle(q, 30);
    killAll(q, followers(q)); kings(q)[0]!.hp = kings(q)[0]!.maxHp; killAll(q, kings(q)); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 6) && has(q, 9), "Igles conduz as conversas: msgs 3, 6 e 9 e vence");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 7) && has(q, 10), "Dina conduz as conversas: msgs 4, 7 e 10 e vence");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 2) && has(q, 5) && has(q, 8) && has(q, 11) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 293)); settle(r, 30);
  failedWith(r, 5, "tio morto");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 288), 1); settle(r, 30);
  failedWith(r, 6, "atacar os cavaleiros bons");
  companionsFail(start);
  const by = offeredBy(100, false, false);
  check(by === 2006, `campanha: a 100 é oferecida pelo velho cavaleiro (npc 2006, Kaarg), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 101
async function m101(): Promise<void> {
  console.log("\n=== Missão 101 — Forest Madness ===");
  const data = await loadData(101);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()): Run => { const q = startRun(data, hero, undefined, { companions: BOTH }); immortal(q); return q; };
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const druid = unit(r, 8), main = unit(r, 7);
  const necros = (q: Run): Unit[] => group(q, 3);
  check(Math.abs(h.cx - 11) <= 3 && Math.abs(h.cy - 102) <= 3, `herói nasce no Drop Location (11,102): ${h.cx},${h.cy}`);
  check(druid.player === 4 && main.player === 4 && necros(r).length === 12 && necros(r).every(u => u.player === 5) && ofPlayer(r, 3).length > 100,
    `druida (8) e druida chefe (7) do jogador 4, 12 necromantes (grupo 3), ${ofPlayer(r, 3).length} monstros dos druidas (jogador 3)`);
  check(r.b.host.dazed.has(main) && main.helpless && r.b.host.unitParameter(7, 6) === 0, "druida chefe começa caído (vida 0 no mapa): o script o vê com vida 0");
  check(w.diplomacyValue(3, 1) === 1 && w.diplomacyValue(4, 1) === 0 && w.diplomacyValue(5, 1) === 1, "monstros e necromantes hostis; druidas em paz");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && !r.outcome, "msg 1, sem desfecho");
  // druida (88,100) -> sub 1; druida chefe caído (22,14) acorda quando o grupo chega a <= 3 células
  beside(r, h, 8); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "druida (8): msg 2 e sub 1 (achar a causa)");
  at(r, h, 22, 22); settle(r);
  check(!has(r, 5) && sub(r, 3) !== 2, "druida chefe a 8 células: continua caído (sem msg 5, sem sub 3)");
  beside(r, h, 7); settle(r);
  check(has(r, 5) && sub(r, 3) === 2 && r.b.host.unitParameter(7, 6) > 0, "herói a <= 3 do druida chefe: ele acorda (vida > 0), msg 5 e sub 3 (curar) cumprido");
  check(!r.outcome, "necromantes vivos: sem desfecho");
  killAll(r, necros(r).slice(1)); settle(r, 25);
  check(!r.outcome, "um necromante vivo: sem desfecho");
  const gold0 = r.gold;
  killAll(r, necros(r)); settle(r, 25);
  check(r.outcome?.ok === true && sub(r, 1) === 2 && sub(r, 2) === 2, `necromantes mortos e o druida chefe ouvido: Mission Complete, subs 1 e 2 cumpridas (${JSON.stringify(r.outcome)})`);
  check(w.diplomacyValue(3, 1) === 0 && w.diplomacyValue(1, 3) === 0, "ao vencer os monstros dos druidas ficam em paz (Complete)");
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  void gold0;
  campaignContract(101, r);

  console.log("[101] necromantes antes do druida chefe; Igles/Dina; variantes; falhas");
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  killAll(r, necros(r)); settle(r, 25);
  check(!r.outcome && sub(r, 1) === 2 && sub(r, 2) === 2, "necromantes mortos antes de falar com o druida chefe: subs 1/2 cumpridas, mas sem a conversa não há vitória");
  beside(r, h, 7); settle(r, 25);
  check(has(r, 5) && r.outcome?.ok === true, "falar com o druida chefe depois: msg 5 e Mission Complete");
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5);
    beside(q, unit(q, who), 8); settle(q); beside(q, unit(q, who), 7); settle(q); killAll(q, necros(q)); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 3) && has(q, 6), "Igles conduz as conversas: msgs 3 e 6");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 4) && has(q, 7), "Dina conduz as conversas: msgs 4 e 7");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 2) && has(q, 5) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 7)); settle(r, 30);
  failedWith(r, 5, "druida chefe morto");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 8), 1); settle(r, 30);
  failedWith(r, 6, "atacar um druida");
  // curar o druida chefe também o acorda (vida >= 25%): "Heal" no druida deixado com 1 de vida
  r = start(); settle(r, 5); const dz = unit(r, 7);
  check(dz.downed && dz.corpseHp === 0 && r.b.host.unitParameter(7, 6) === 0, `o druida chefe inconsciente tem vida ${dz.corpseHp}/${dz.maxHp} e o script o vê com 0`);
  healDying(r.b.world, r.b.hero, dz, Math.ceil(dz.maxHp * 0.5));   // Heal do herói (druidas em paz): levanta de verdade
  check(r.b.host.unitParameter(7, 6) > 0, "curado a 50% da vida (Heal), o druida chefe acorda para o script (vida > 0) mesmo sem ninguém por perto");
  // (o herói fica parado: com o andar do exe a perseguição automática dele ao monstro mais perto o leva a <= 4 do druida)
  r = start(); settle(r, 5); at(r, r.b.hero, 22, 22); r.b.world.command(r.b.hero, { type: "hold" }); settle(r, 25);
  const castHeal = unit(r, 10003), dru = unit(r, 7);
  at(r, castHeal, 22, 20);
  check(dru.hp < dru.maxHp * 0.25 && r.b.host.unitParameter(7, 6) === 0, "herói e Dina a 6-8 células: o druida chefe continua moribundo");
  let casts = 0;
  while (r.b.host.unitParameter(7, 6) === 0 && casts < 10) {
    castOn(r, castHeal, 24, 50, dru); casts++; settle(r, 5);
  }
  settle(r, 25);
  check(casts > 1 && casts < 10 && dru.hp >= dru.maxHp * 0.25, `Dina lança Heal (24) no druida chefe ${casts} vezes até ele passar de 25% (vida ${Math.ceil(dru.hp)}/${dru.maxHp})`);
  check(r.b.host.unitParameter(7, 6) > 0 && sub(r, 3) === 2 && !has(r, 5), "o druida deixa de estar caído para o script (sub 3, curar, cumprido); a conversa só vem quando alguém chega a <= 4");
  beside(r, r.b.hero, 7); settle(r);
  check(has(r, 5), "herói junto do druida curado: msg 5");
  // 20 s de combate real junto aos monstros do começo
  r = start(); w = r.b.world; h = r.b.hero;
  for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; }
  run(r, TICKS_PER_SEC * 20, () => keep(r));
  check(!r.outcome && w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), "20 s no ponto de partida (monstros em volta): sem desfecho e sem NaN");
  companionsFail(start);
  const by = offeredBy(101, false, false);
  check(by === 681, `campanha: a 101 é oferecida pelo pregador druida (npc 681, acampamento), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 93
interface Shrine {
  id: number; mage: boolean; female: boolean; label: string;
  /** necromante que entrega os livros, seu grupo, onde some, e os itens que o herói recebe */
  necro: number; necroGroup: number; necroExit: [number, number]; necroGone: boolean; books: string[];
  /** dragão que guarda a pirâmide e o marcador fora de fase (unidade com o prêmio) */
  dragon: number; pyramid: number; prize: string;
  /** onde o herói lê o enigma (msg 4) e a armadilha do teleporte que a solução abre: gatilho -> destino */
  puzzle: [number, number]; trap: [number, number]; trapTo: [number, number];
  /** teleportes do mapa (bloco 9): do centro até o enigma e do santuário de volta (26,118), perto do ponto final (10,135) */
  pad: [number, number]; padTo: [number, number]; exit: [number, number];
  /** solução do enigma (o grupo lança as magias) e uma tentativa errada que não abre o teleporte */
  solve(r: Run): void; wrong(r: Run): void;
  /** condição do mapa conferida logo antes da solução (ex.: névoa cobrindo as células) */
  before?(r: Run): void; after?(r: Run): void;
}
/** o herói conjura como o jogador (pergaminho: poder 50, sem mana) de uma célula `from` */
const scroll = (r: Run, spell: number, x: number, y: number, from: [number, number]): void => {
  check(castAt(r, r.b.hero, spell, 50, x, y, { x: from[0], y: from[1] }), `o herói lança a magia ${spell} em (${x},${y}) a partir de (${from})`);
};
const scrollOn = (r: Run, spell: number, target: Unit): void => {
  check(castOn(r, r.b.hero, spell, 50, target), `o herói lança a magia ${spell} em ${target.name} (script ${target.scriptId})`);
};
const SHRINES: Shrine[] = [
  {
    pad: [93, 72], padTo: [131, 71], exit: [99, 104],
    id: 93, mage: false, female: false, label: "Fogo", necro: 37, necroGroup: 14, necroExit: [138, 8], necroGone: true, books: ["3587", "3588"], dragon: 32, pyramid: 27, prize: "59507",
    puzzle: [125, 71], trap: [115, 72], trapTo: [100, 104],
    // "duas paredes de fogo rugem": Wall of Fire cobrindo (121,69),(123,69),(125,69) e (121,75),(123,75),(125,75) ao mesmo tempo
    solve(r) { scroll(r, 3, 123, 69, [123, 65]); scroll(r, 3, 123, 75, [123, 79]); },
    wrong(r) { scroll(r, 3, 123, 69, [123, 65]); },
    after(r) { check([121, 123, 125].every(x => r.b.host.spellOnTile(x, 69, 0) === 1 && r.b.host.spellOnTile(x, 75, 0) === 1), "Spell on Tile (camada 0) vale 1 nas 6 células das paredes de fogo"); },
  },
  {
    pad: [74, 90], padTo: [65, 124], exit: [121, 124],
    id: 94, mage: false, female: true, label: "Terra", necro: 37, necroGroup: 13, necroExit: [137, 9], necroGone: true, books: ["3587", "3588"], dragon: 33, pyramid: 51, prize: "59507",
    puzzle: [65, 119], trap: [66, 107], trapTo: [122, 124],
    // "um muro no sinal, outro para seguir o primo, o terceiro como pilar": Wall of Earth em I — muro em y=113, muro em y=117 e pilar em x=65
    solve(r) { scroll(r, 17, 65, 113, [65, 118]); scroll(r, 17, 65, 117, [65, 121]); scroll(r, 17, 65, 115, [70, 115]); },
    // um muro largo no meio (63..67, 115) não serve: o script pede (63,115) e (66,115) sem pedra
    wrong(r) { scroll(r, 17, 65, 113, [65, 118]); scroll(r, 17, 65, 117, [65, 121]); scroll(r, 17, 65, 115, [65, 120]); },
    after(r) { check(r.b.host.spellOnTile(65, 115, 3) === 1 && r.b.host.spellOnTile(63, 113, 3) === 1 && r.b.host.spellOnTile(67, 117, 3) === 1 && r.b.host.spellOnTile(63, 115, 3) === 0 && r.b.host.spellOnTile(66, 115, 3) === 0, "Spell on Tile (camada 3): muros em y=113 e y=117, pilar em x=65 e (63,115)/(66,115) livres"); },
  },
  {
    pad: [73, 54], padTo: [67, 18], exit: [21, 20],
    id: 95, mage: true, female: true, label: "Água", necro: 52, necroGroup: 13, necroExit: [136, 8], necroGone: true, books: ["3587", "3588"], dragon: 35, pyramid: 50, prize: "63109",
    puzzle: [67, 18], trap: [68, 37], trapTo: [20, 19],
    // "o veneno pica, o mortal morre, quem passa leva o prêmio": as duas nuvens venenosas (66,25) e (69,27) cobrem as 9 células; um Wall of Fire (raio 2) em
    // (67,26) as queima [est: o original não foi decifrado]. Sem elas as 3 linhas ficam limpas e o teleporte abre.
    before(r) { check(r.b.host.spellOnTile(65, 24, 2) === 1 && r.b.host.spellOnTile(67, 26, 2) === 1 && r.b.host.spellOnTile(69, 28, 2) === 1, "as nuvens venenosas (camada 2) cobrem células das 3 linhas de verificação"); },
    solve(r) { scroll(r, 3, 67, 26, [67, 31]); },
    wrong(r) { scroll(r, 14, 67, 26, [67, 31]); }, // Darkness não dissipa a névoa
    after(r) { check([65, 67, 69].every(x => [24, 26, 28].every(y => r.b.host.spellOnTile(x, y, 2) === 0)), "as 9 células da camada 2 ficam sem névoa"); },
  },
  {
    pad: [56, 72], padTo: [13, 72], exit: [41, 39],
    id: 96, mage: true, female: false, label: "Ar", necro: 52, necroGroup: 13, necroExit: [137, 9], necroGone: true, books: ["3585"], dragon: 34, pyramid: 49, prize: "63109",
    puzzle: [18, 72], trap: [31, 71], trapTo: [40, 39],
    // "dois ídolos se olham, o obstáculo não importa": as 3 estátuas (20, 21, 22; Stone Curse do script) ficam invisíveis (Invisibility, magia 12)
    solve(r) { for (const id of [20, 21, 22]) { const t = unit(r, id); at(r, r.b.hero, t.cx + 2, t.cy); scrollOn(r, 12, t); } },
    wrong(r) { for (const id of [20, 21]) { const t = unit(r, id); at(r, r.b.hero, t.cx + 2, t.cy); scrollOn(r, 12, t); } },
    before(r) { check([20, 21, 22].every(id => unit(r, id).buffs.some(b => b.kind === "stone")), "as 3 estátuas (20, 21, 22) começam em pedra (Cast spell to unit: Stone Curse)"); },
    after(r) { check([20, 21, 22].every(id => r.b.host.unitHasSpell(id, 12)), "Spell on Unit(12) vale nas 3 estátuas"); },
  },
];

/** teletransporta o herói para `p` e deixa o script e a armadilha agirem */
const gotoCell = (r: Run, p: readonly [number, number], ticks = 25): void => { at(r, r.b.hero, p[0], p[1]); settle(r, ticks); };

async function shrine(s: Shrine): Promise<void> {
  console.log(`\n=== Missão ${s.id} — The Magic Source of ${s.label === "Fogo" ? "Fire" : s.label === "Terra" ? "Earth" : s.label === "Água" ? "Water" : "Air"} ===`);
  const data = await loadData(s.id);
  const hero0 = (): HeroState => heroOf(s.mage, s.female);
  const start = (hero: HeroState = hero0()): Run => {
    const q = startRun(data, hero, undefined, { companions: BOTH });
    hold(q, unit(q, 10002)); hold(q, unit(q, 10003)); // ficam no ponto de partida (Igles/Dina não participam dos enigmas)
    // os dragões que guardam as pirâmides matam um herói de 55-142 PV de um golpe: o grupo é "imortal" nestes pilotos (companionsFail ainda o mata com kill)
    for (const id of [10001, 10002, 10003]) { const u = unit(q, id); u.maxHp = u.hp = 100000; u.stats = { ...u.stats, healthRegen: 0 }; }
    // morcegos e feras soltas (jogador 7) arrastariam o herói "hold" para dentro dos teleportes; só os dragões guardiões ficam
    for (const u of ofPlayer(q, 7)) if (u.name !== "Dragon") q.b.world.kill(u);
    return q;
  };
  /** fases iniciais: alavancas, teleporte do centro, ler o enigma */
  const toPuzzle = (q: Run, solve = false): void => {
    settle(q, 5);
    q.b.host.toggleSwitch(2); q.b.host.toggleSwitch(3); settle(q, 15);
    gotoCell(q, [105, 30], 5);
    gotoCell(q, [102, 34], 45);
    gotoCell(q, s.puzzle, 15);
    if (solve) { s.solve(q); settle(q, 20); }
  };
  let r = start();
  let w = r.b.world, h = r.b.hero, host = r.b.host;
  const base = w.traps.length; // armadilhas Teleport do bloco 9 do mapa
  const necro = unit(r, s.necro), pyramid = unit(r, s.pyramid), dragon = unit(r, s.dragon);
  check(Math.abs(h.cx - 130) <= 3 && Math.abs(h.cy - 12) <= 3, `herói nasce no Drop Location (131,12): ${h.cx},${h.cy}`);
  check(necro.player === 6 && dragon.player === 7 && pyramid.items.includes(s.prize) && base > 0, `necromante ${s.necro} com os livros, dragão ${s.dragon} (jogador 7), prêmio ${s.prize} no marcador ${s.pyramid}; ${base} armadilhas Teleport do mapa (bloco 9) no início`);
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && s.books.every(b => h.items.includes(b)) && necro.items.length === 0, `msg 1: o necromante entrega os livros (${s.books.join(",")}) ao herói (Give All)`);
  run(r, TICKS_PER_SEC * 30, () => keep(r));
  // o ponto de sumiço fica na BORDA de 8 células (x ≥ 136 num mapa de 144), que o plano de passagem do exe bloqueia para todos
  // (0x553b99 = 0x1f): o necromante para na última célula útil, a 2–3 do ponto, e a condição "distância ≤ 1" do script não fecha
  const ex = Math.min(w.grid.w - 9, Math.max(8, s.necroExit[0])), ey = Math.min(w.grid.h - 9, Math.max(8, s.necroExit[1]));
  // some se a última célula útil fica a ≤ 1 do ponto (condição "distância ≤ 1" do script)
  const gone = s.necroGone && Math.max(Math.abs(ex - s.necroExit[0]), Math.abs(ey - s.necroExit[1])) <= 1;
  check(necro.phased === gone && Math.hypot(necro.x - (ex + 0.5), necro.y - (ey + 0.5)) <= 2, gone ? `o necromante anda até (${s.necroExit}) e some (Phase out)` : `o necromante anda até a borda junto de (${s.necroExit}) e fica ali (${necro.cx},${necro.cy}; ponto na borda intransponível)`);
  check(pyramid.phased && host.measurePhased, "marcador da pirâmide fora de fase; o host mede a distância até ele (measurePhased)");
  // alavancas (Switch): "Health of building" 1 = desligada, 0 = ligada
  check(host.switches.size === 2 && host.buildingHealth(2) === 1 && host.buildingHealth(3) === 1 && host.switchNear(100, 24) === 2 && host.switchNear(110, 40) === 3, "duas alavancas (estruturas 2 e 3), desligadas = 1; switchNear acha pelo clique");
  {
    // clique na alavanca pela interface (mission/interact.ts): o herói anda até uma célula ao lado e só então a aciona; outra ordem no caminho cancela
    const q = start(), qw = q.b.world, qh = q.b.hero, use = new WalkThenUse();
    at(q, qh, 106, 28); settle(q, 5);
    const lv = q.b.host.switches.get(2)!;
    check(switchAtCell(q.b.host, lv.x, lv.y) === 2 && switchAtCell(q.b.host, lv.x, lv.y - 1) === 2 && switchAtCell(q.b.host, lv.x + 2, lv.y) === undefined, "switchAtCell: pegada e a célula da imagem acima acham a alavanca 2");
    const act = (): void => { q.b.host.toggleSwitch(2); };
    check(use.start(qw, qh, lv.x, lv.y, o => qw.command(qh, o), act) && q.b.host.buildingHealth(2) === 1, "andar até a alavanca: ainda não acionou na partida");
    let ticks = 0;
    for (; ticks < TICKS_PER_SEC * 40 && q.b.host.buildingHealth(2) === 1; ticks++) run(q, 1, () => { keep(q); use.step(qw); });
    check(q.b.host.buildingHealth(2) === 0 && Math.max(Math.abs(qh.cx - lv.x), Math.abs(qh.cy - lv.y)) <= 1 && !use.active, `a alavanca 2 liga ao chegar (${ticks} tiques, herói em ${qh.cx},${qh.cy})`);
    // outra ordem antes de chegar cancela (alavanca 3, mais longe)
    at(q, qh, 104, 40);
    const lv3 = q.b.host.switches.get(3)!;
    use.start(qw, qh, lv3.x, lv3.y, o => qw.command(qh, o), () => { q.b.host.toggleSwitch(3); });
    run(q, 3, () => use.step(qw));
    qw.command(qh, { type: "move", x: 104, y: 36 });
    run(q, TICKS_PER_SEC * 30, () => { keep(q); use.step(qw); });
    check(q.b.host.buildingHealth(3) === 1 && !use.active, "uma nova ordem no caminho cancela o uso: a alavanca 3 continua desligada");
  }
  gotoCell(r, [102, 34], 20);
  check(h.cx === 102 && h.cy === 34 && !has(r, 2), "pisar no teleporte (102,34) com as alavancas desligadas: nada acontece");
  gotoCell(r, [105, 30], 5); // sai de cima do teleporte antes de abri-lo
  host.toggleSwitch(2); settle(r, 25);
  check(host.buildingHealth(2) === 0 && !has(r, 2) && w.traps.length === base, "uma alavanca ligada (0): o teleporte continua fechado");
  host.toggleSwitch(2); settle(r, 25); host.toggleSwitch(2); host.toggleSwitch(3); settle(r, 25);
  check(has(r, 2) && w.traps.length === base + 1, `as duas alavancas ligadas: msg 2 (Dina) e a armadilha Teleport (102,34) -> (74,72) (${w.traps.length - base} nova)`);
  gotoCell(r, [102, 34], 45);
  check(Math.abs(h.cx - 74) <= 2 && Math.abs(h.cy - 72) <= 2, `o herói pisa no teleporte (102,34) e vai para o centro (74,72): ${h.cx},${h.cy}`);
  settle(r, 20);
  check(has(r, 3), "no centro do mapa: msg 3 (direção)");
  // enigma: antes de chegar ao ponto, sem msg 4; resolver errado não abre o teleporte
  check(!has(r, 4), "longe do enigma: sem a msg 4");
  // teleporte do mapa (bloco 9) do centro até a área do enigma
  gotoCell(r, s.pad, 10);
  check(Math.abs(h.cx - s.padTo[0]) <= 2 && Math.abs(h.cy - s.padTo[1]) <= 2, `o herói pisa no teleporte do mapa em (${s.pad}) e chega a (${s.padTo}): ${h.cx},${h.cy}`);
  gotoCell(r, s.puzzle, 15);
  check(has(r, 4) && sub(r, 1) !== 2, "no ponto do enigma: msg 4 (a frase mágica)");
  if (s.id === 95) check(sub(r, 1) === 1, "msg 4 da 95 mostra o subobjetivo 1");
  s.before?.(r);
  s.wrong(r); settle(r, 30);
  check(w.traps.length === base + 1 && sub(r, 1) !== 2, `tentativa errada: o teleporte do santuário (${s.trap}) não abre`);
  // solução
  r = start(); w = r.b.world; h = r.b.hero; host = r.b.host;
  toPuzzle(r, true);
  const pyramid2 = unit(r, s.pyramid), dragon2 = unit(r, s.dragon);
  s.after?.(r);
  check(w.traps.length === base + 2 && (s.id === 96 || sub(r, 1) === 2), `enigma resolvido: nova armadilha Teleport (${s.trap}) -> (${s.trapTo}) e sub 1 cumprido (${w.traps.length - base} novas)`);
  gotoCell(r, s.trap, 45);
  check(Math.abs(h.cx - s.trapTo[0]) <= 2 && Math.abs(h.cy - s.trapTo[1]) <= 2, `o herói pisa em (${s.trap}) e vai ao santuário (${s.trapTo}): ${h.cx},${h.cy}`);
  // pirâmide: o dragão precisa estar morto; o marcador (fora de fase) é medido
  const spot: [number, number] = [pyramid2.cx + 1, pyramid2.cy];
  gotoCell(r, spot, 25);
  check(!has(r, 5) && !r.outcome, "junto da pirâmide com o dragão vivo: nada");
  w.kill(dragon2, h); settle(r, 25);
  check(has(r, 5) && !pyramid2.items.length, "dragão morto e o herói a <= 4 da pirâmide (marcador fora de fase): msg 5 e o marcador larga o prêmio");
  const prize = w.loot.find(l => l.items.includes(s.prize));
  check(!!prize && prize.x === pyramid2.cx && prize.y === pyramid2.cy, `o prêmio ${s.prize} fica no chão em (${pyramid2.cx},${pyramid2.cy})`);
  killAll(r, ofPlayer(r, 7)); unstone(r); // nada mais a bloquear o caminho
  const got = pickupAt(r, h, prize!.x, prize!.y);
  check(got && h.items.includes(s.prize), "o herói pega o prêmio (ordem pickup)");
  check(!r.outcome, "pegar o prêmio longe do ponto final (10,135): sem desfecho ainda");
  gotoCell(r, [10, 135], 30);
  check(r.outcome?.ok === true, `o herói chega a (10,135) com o prêmio já largado (v != 0): Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  const st = campaignContract(s.id, r, s.mage, s.female);
  check(isDone(st, s.id), `campanha: ${s.id} concluída`);

  console.log(`[${s.id}] chegar a (10,135) sem o prêmio; variantes; falhas; caminhada real`);
  r = start(); settle(r, 5); gotoCell(r, [10, 135], 40);
  check(!r.outcome, "(10,135) sem ter largado o prêmio (v != 0 só depois da pirâmide): sem desfecho");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    const q = start(hero); toPuzzle(q);
    check(has(q, 1) && has(q, 2) && has(q, 3) && has(q, 4) && messagesHaveText(q, hero), `${v.label}: msgs 1-4 com texto para o herói`);
  }
  // caminhada real: do santuário (pirâmide) ao teleporte de saída do mapa (bloco 9) e dali até (10,135); o herói anda de verdade
  r = start(); w = r.b.world; h = r.b.hero; toPuzzle(r, true);
  gotoCell(r, s.trap, 45);
  const arrival = { x: h.cx, y: h.cy };
  settle(r, TICKS_PER_SEC * 5);
  check(Math.hypot(h.cx - arrival.x, h.cy - arrival.y) < 8 && Math.hypot(h.cx - 26, h.cy - 118) > 10, `chegando ao lado do teleporte de saída (${s.exit}) o herói não é devolvido na hora (${arrival.x},${arrival.y} -> ${h.cx},${h.cy})`);
  w.kill(unit(r, s.dragon), h); gotoCell(r, [unit(r, s.pyramid).cx + 1, unit(r, s.pyramid).cy], 25);
  killAll(r, ofPlayer(r, 7)); unstone(r);
  const pz = w.loot.find(l => l.items.includes(s.prize))!;
  pickupAt(r, h, pz.x, pz.y);
  w.command(h, { type: "move", x: s.exit[0], y: s.exit[1] });
  let walked = run(r, TICKS_PER_SEC * 120, () => { keep(r); return Math.hypot(h.cx - 26, h.cy - 118) <= 3; });
  console.log(`  info: do prêmio ao teleporte de saída ${s.exit}: ${(walked / TICKS_PER_SEC).toFixed(0)} s; herói em ${h.cx},${h.cy}`);
  check(Math.hypot(h.cx - 26, h.cy - 118) <= 3 && !r.outcome, "o teleporte de saída leva o herói a (26,118) (mesma ilha de (10,135)); ainda sem desfecho");
  w.command(h, { type: "move", x: 10, y: 135 });
  walked = run(r, TICKS_PER_SEC * 120, () => { keep(r); return r.outcome !== null; });
  console.log(`  info: de (26,118) até (10,135): ${(walked / TICKS_PER_SEC).toFixed(0)} s, posição final ${h.cx},${h.cy}`);
  check(r.outcome?.ok === true, `o herói caminha até (10,135) e a missão termina (${JSON.stringify(r.outcome)})`);
  // falhas
  if (s.id === 96) {
    r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 20), 1); settle(r, 30);
    check(failCause(r) === 5, `atacar uma estátua do Ar (jogador 4 hostil): falha causa 5 (${JSON.stringify(r.outcome)}); o texto failure5 não existe em mission96 (GAPS [MAPAS-RE])`);
  }
  r = start(); settle(r, 5); at(r, r.b.hero, 100, 104); settle(r, TICKS_PER_SEC * 20);
  check(!r.outcome, "20 s junto ao dragão do santuário: sem desfecho (o grupo é mantido vivo)");
  companionsFail(() => start());
  const who = offeredBy(s.id, s.mage, s.female);
  check(who === 2022, `campanha: a ${s.id} é oferecida por Talena (npc 2022) a ${s.mage ? "mag" : "guerreir"}${s.female ? "a" : "o"}, foi ${who}`);
  const others = VARIANTS.filter(v => v.mage !== s.mage || v.female !== s.female).filter(v => offeredBy(s.id, v.mage, v.female) === undefined || false);
  check(others.length === 3, `campanha: as outras 3 variantes não recebem a ${s.id} (${others.length})`);
}
const m93 = () => shrine(SHRINES[0]!), m94 = () => shrine(SHRINES[1]!), m95 = () => shrine(SHRINES[2]!), m96 = () => shrine(SHRINES[3]!);

// ------------------------------------------------------------------------------------------- 102
const AMULET = "3668"; // item 60 do script = 3608 + 60
async function m102(): Promise<void> {
  console.log("\n=== Missão 102 — Mysterious Amulet ===");
  const data = await loadData(102);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()): Run => { const q = startRun(data, hero, undefined, { companions: BOTH }); immortal(q); return q; };
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const mage = unit(r, 217), elder = unit(r, 66), ghost = unit(r, 91), d1 = unit(r, 76), d2 = unit(r, 77);
  const zombies = (q: Run): Unit[] => group(q, 8);
  check(Math.abs(h.cx - 26) <= 3 && Math.abs(h.cy - 105) <= 3, `herói nasce no Drop Location (26,105): ${h.cx},${h.cy}`);
  check(mage.player === 4 && mage.items.includes(AMULET) && elder.player === 2 && ghost.player === 6 && d1.player === 5 && d2.player === 5 && group(r, 9).length === 2 && group(r, 26).length === 1,
    "mago 217 (jogador 4) com o amuleto (item 60 = 3668), ancião 66 (jogador 2), fantasma 91 (jogador 6), 2 dragões (grupo 9, jogador 5)");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && !r.outcome && zombies(r).length === 7 && zombies(r).every(u => u.ai?.type === "swarm") && elder.ai?.type === "hold", "msg 1; 7 zumbis (grupo 8) marcham sobre a aldeia (swarm) e o ancião fica parado (stand ground)");
  check(group(r, 2).every(u => u.ai?.type === "patrol"), "os camponeses (grupo 2) patrulham até (37,104)");
  // o mago (13,80): conversa 1 (msgs 2/3/4) uma vez; ele só entra no grupo com os dragões mortos
  beside(r, h, 217); settle(r);
  check(has(r, 2) && count(r, 2) === 1 && mage.player === 4, "mago 217 com o herói: msg 2 (v70) e ele ainda não entra (os dragões vivos)");
  killAll(r, group(r, 9)); settle(r, 25);
  check(mage.player === 1 && has(r, 5) && mage.ai?.type === "defend" || mage.player === 1, `dragões mortos e o herói junto do mago: Mage join — o mago passa ao jogador (${mage.player}) e a msg 5 vem`);
  check(!r.outcome, "o mago entrou, mas o amuleto fica com ele: sem desfecho");
  // o amuleto: o mago morto larga o saco; o herói o pega e leva ao fantasma (125,15)
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  const m2 = unit(r, 217);
  w.damage(h, m2, 1); w.kill(m2, h); settle(r, 10);
  const sack = w.loot.find(l => l.items.includes(AMULET));
  check(!!sack && sack.x === m2.cx && sack.y === m2.cy && w.diplomacyValue(4, 1) === 1 && !r.outcome, `o mago morto larga o amuleto em (${sack?.x},${sack?.y}); diplomacia do mago com o herói = guerra`);
  at(r, h, sack!.x - 2, sack!.y + 1);
  check(pickupAt(r, h, sack!.x, sack!.y) && h.items.includes(AMULET), "o herói pega o amuleto (ordem pickup)");
  settle(r, 25);
  check(!r.outcome, "com o amuleto longe do fantasma: sem desfecho");
  at(r, h, 125, 25); settle(r);
  check(!has(r, 10), "amuleto a 10 células do fantasma (125,15): ainda não");
  at(r, h, 125, 17); settle(r, 25);
  check(has(r, 10) && r.outcome?.ok === true && !h.items.includes(AMULET) && unit(r, 91).phased, `herói com o amuleto a <= 4 do fantasma: msg 10, o amuleto some de todos, o fantasma some e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(102, r);

  console.log("[102] Igles/Dina com o amuleto; dragões; vitória pela matança; ataque dos zumbis; falhas");
  const carry = (hero: HeroState, who: number): Run => {
    const q = start(hero); settle(q, 5);
    const m = unit(q, 217); q.b.world.kill(m, q.b.hero); settle(q, 5);
    const s = q.b.world.loot.find(l => l.items.includes(AMULET))!;
    const u = unit(q, who);
    at(q, u, s.x - 2, s.y + 1);
    pickupAt(q, u, s.x, s.y);
    at(q, u, 125, 17); settle(q, 25);
    return q;
  };
  let q = carry(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 10) && !unit(q, 10002).items.includes(AMULET), "Igles com o amuleto a <= 4 do fantasma: msg 10 e Mission Complete");
  q = carry(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 10), "Dina com o amuleto a <= 4 do fantasma: msg 10 e Mission Complete");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = carry(hero, 10001);
    check(q.outcome?.ok === true && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  // dragões: o mago morto libera os dragões, que entram no jogador com o herói a <= 4 (msgs 6/7/8 antes, 9 ao entrar)
  q = start(); settle(q, 5);
  beside(q, q.b.hero, 76); settle(q);
  check(has(q, 6) && count(q, 6) === 1 && unit(q, 76).player === 5, "dragão 76 com o herói: msg 6 (v71); os dragões ainda não entram (o mago vive)");
  q.b.world.kill(unit(q, 217), q.b.hero); settle(q, 25);
  check(unit(q, 76).player === 1 && unit(q, 77).player === 1 && has(q, 9), "mago morto e o herói junto do dragão: os dois dragões passam ao jogador (Dragon 1 join / Dragon 2 join), msg 9");
  // vitória pela matança: fantasma + grupos 24 e 7 mortos
  q = start(); settle(q, 5);
  killAll(q, [ghost, ...group(q, 24), ...group(q, 7)].map(u => unit(q, u.scriptId))); settle(q, 25);
  check(q.outcome?.ok === true && has(q, 11), `fantasma e os grupos 24 e 7 mortos: msg 11 e Mission Complete (${JSON.stringify(q.outcome)})`);
  q = start(); settle(q, 5);
  killAll(q, group(q, 24)); killAll(q, group(q, 7)); settle(q, 25);
  check(!q.outcome, "grupos 24 e 7 mortos mas o fantasma vivo: sem desfecho");
  // zumbis reais sobre a aldeia: sem defesa o ancião morre (falha 6); com o grupo parado ao lado dele ele sobrevive
  q = start(); settle(q, 5);
  for (const id of BOTH) at(q, unit(q, id), 60, 60); // o grupo longe, sem defender
  at(q, q.b.hero, 60, 59);
  let t = run(q, TICKS_PER_SEC * 300, () => { keep(q); return q.outcome !== null; });
  console.log(`  info: sem defesa: desfecho ${JSON.stringify(q.outcome)} após ${(t / TICKS_PER_SEC).toFixed(0)} s; zumbis vivos ${zombies(q).filter(u => u.alive).length}`);
  check(zombies(q).every(u => Number.isFinite(u.x)) && (failCause(q) === 6 || !q.outcome), "300 s sem defesa: os zumbis chegam à aldeia (falha 6 se o ancião cair) ou ainda marcham, sem NaN");
  // o jogador intercepta os zumbis antes que cheguem ao ancião (aqui: abate quem chega a <= 8 células dele): o ancião sobrevive e os zumbis acabam
  q = start(); settle(q, 5);
  const el = unit(q, 66);
  at(q, q.b.hero, el.cx - 1, el.cy);
  let killed = 0;
  t = run(q, TICKS_PER_SEC * 240, () => {
    keep(q);
    for (const z of zombies(q)) if (z.alive && dist(z, el) <= 8) { q.b.world.kill(z, q.b.hero); killed++; }
    return q.outcome !== null || zombies(q).every(z => !z.alive);
  });
  console.log(`  info: interceptando: ${killed} zumbis abatidos em ${(t / TICKS_PER_SEC).toFixed(0)} s; ancião ${el.alive ? "vivo" : "morto"}`);
  check(el.alive && !q.outcome && zombies(q).every(z => !z.alive), "zumbis interceptados a <= 8 células do ancião: ele sobrevive e o grupo 8 acaba");
  // falhas
  q = start(); settle(q, 5); q.b.world.kill(unit(q, 66)); settle(q, 30);
  failedWith(q, 6, "ancião morto");
  q = start(); settle(q, 5); q.b.world.damage(q.b.hero, group(q, 2)[0]!, 1); settle(q, 30);
  failedWith(q, 5, "atacar os camponeses (jogador 2)");
  companionsFail(start);
  const by = offeredBy(102, false, false);
  check(by === 2109, `campanha: a 102 é oferecida pela camponesa de Ushut (npc 2109, Kaarg), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 103
const HEAD = "3670", STONE = "3671"; // itens 62 e 63 do script
/** [x, y da unidade, id da estrutura que a ação de USAR aciona] medido no ORIGINAL (0x52bfe7 chamado pela caixa de correio, levers_probe.py) */
const USE_PICK_103: [number, number, number][] = [[11, 19, 13], [11, 20, 13], [11, 21, 13], [12, 19, 13], [12, 21, 13], [13, 19, 13], [13, 20, 13], [13, 21, 13], [18, 72, 12], [18, 73, 12], [18, 74, 12], [18, 75, 5], [18, 76, 5], [18, 77, 5], [18, 78, 5], [18, 79, 5], [18, 80, 4], [18, 81, 4], [18, 82, 4], [19, 72, 12], [19, 74, 12], [19, 75, 5], [19, 77, 5], [19, 79, 5], [19, 80, 4], [19, 82, 4], [19, 130, 14], [19, 131, 14], [19, 132, 14], [20, 72, 12], [20, 73, 12], [20, 74, 12], [20, 75, 5], [20, 76, 5], [20, 77, 5], [20, 78, 5], [20, 79, 5], [20, 80, 4], [20, 81, 4], [20, 82, 4], [20, 130, 14], [20, 132, 14], [21, 72, 6], [21, 73, 6], [21, 74, 6], [21, 80, 4], [21, 81, 4], [21, 82, 4], [21, 130, 14], [21, 131, 14], [21, 132, 14], [22, 72, 6], [22, 74, 6], [22, 80, 4], [22, 82, 4], [23, 72, 6], [23, 73, 6], [23, 74, 6], [23, 80, 10], [23, 81, 10], [23, 82, 10], [24, 72, 6], [24, 73, 6], [24, 74, 6], [24, 80, 3], [24, 81, 3], [24, 82, 3], [25, 72, 6], [25, 74, 6], [25, 80, 3], [25, 82, 3], [26, 72, 7], [26, 73, 7], [26, 74, 7], [26, 80, 3], [26, 81, 3], [26, 82, 3], [27, 72, 1], [27, 73, 1], [27, 74, 1], [27, 75, 1], [27, 76, 1], [27, 77, 2], [27, 78, 2], [27, 79, 2], [27, 80, 2], [27, 81, 2], [27, 82, 3], [28, 72, 1], [28, 74, 1], [28, 76, 1], [28, 77, 2], [28, 79, 2], [28, 80, 2], [28, 82, 3], [29, 72, 1], [29, 73, 1], [29, 74, 1], [29, 75, 1], [29, 76, 1], [29, 77, 2], [29, 78, 2], [29, 79, 2], [29, 80, 2], [29, 81, 2], [29, 82, 9], [127, 12, 16], [127, 13, 16], [127, 14, 16], [128, 12, 16], [128, 14, 16], [129, 12, 16], [129, 13, 16], [129, 14, 16], [130, 115, 15], [130, 116, 15], [130, 117, 15], [131, 115, 15], [131, 117, 15], [132, 115, 15], [132, 116, 15], [132, 117, 15]];
async function m103(): Promise<void> {
  console.log("\n=== Missão 103 — The Desert Oracle ===");
  const data = await loadData(103);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()): Run => { const q = startRun(data, hero, undefined, { companions: BOTH }); immortal(q); return q; };
  let r = start();
  let w = r.b.world, h = r.b.hero, host = r.b.host;
  const orc = unit(r, 30), witch = unit(r, 138), ogre = r.b.world.units.find(u => u.items.includes(HEAD))!;
  check(Math.abs(h.cx - 72) <= 3 && Math.abs(h.cy - 12) <= 3, `herói nasce no Drop Location (72,12): ${h.cx},${h.cy}`);
  check(orc.player === 5 && witch.player === 2 && !!ogre && ogre.player === 7 && host.switches.size === 16 && unit(r, 131).items.includes("37269") && unit(r, 132).items.includes("30608"),
    "xamã orc 30 (jogador 5), feiticeira da areia 138, ogro com a cabeça (item 62 = 3670), 16 alavancas e os marcadores 131/132 com o prêmio dos enigmas");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && unit(r, 131).phased && unit(r, 132).phased && !r.outcome, "msg 1; os marcadores 131 e 132 fora de fase");
  // conversas curtas: feiticeira (60,25) msgs 2/3/4 e xamã (94,123) msgs 5/6/7, cada uma uma vez
  beside(r, h, 138); settle(r);
  check(has(r, 2) && count(r, 2) === 1, "feiticeira da areia: msg 2");
  beside(r, h, 30); settle(r);
  check(has(r, 5), "xamã orc: msg 5");
  // casa (41,50): a pedra (item 63) vai para quem chegar a <= 4 primeiro, uma vez
  at(r, h, 41, 56); settle(r);
  check(!has(r, 8) && !h.items.includes(STONE), "herói a 6 da casa (41,50): sem pedra");
  at(r, h, 41, 53); settle(r);
  check(has(r, 8) && h.items.includes(STONE), "herói a <= 4 da casa (41,50): msg 8 e a pedra (item 63) entra na mochila");
  unstone(r); // as súcubos da casa (grupo 19) petrificam quem chega
  at(r, h, 41, 55); at(r, unit(r, 10002), 41, 52); settle(r);
  check(!has(r, 9) && unit(r, 10002).items.length === 0, "a pedra só é achada uma vez (v81)");
  // a cabeça: o ogro morto larga o saco; o herói pega
  w.kill(ogre, h); settle(r, 10);
  const hs = w.loot.find(l => l.items.includes(HEAD));
  check(!!hs, `o ogro morto larga a cabeça (item 62) em (${hs?.x},${hs?.y})`);
  at(r, h, hs!.x - 2, hs!.y + 1); unstone(r);   // a guarda do grupo das súcubos (raio em volta do centroide) volta a petrificar quem passa
  check(pickupAt(r, h, hs!.x, hs!.y) && h.items.includes(HEAD), "o herói pega a cabeça (ordem pickup)");
  // entrega ao xamã com as duas relíquias: msg 11, itens removidos, o grupo 1 (xamã) parte para (80,77) e depois (127,69)
  const orcStart = { x: orc.cx, y: orc.cy };
  beside(r, h, 30); settle(r, 25);
  check(has(r, 11) && !h.items.includes(HEAD) && !h.items.includes(STONE), "herói com a pedra e a cabeça junto do xamã: msg 11 e as duas relíquias são entregues");
  check(orc.ai?.type === "move" && orc.ai.x === 80 && orc.ai.y === 77, `o xamã parte para o 1º ponto (80,77) (${JSON.stringify(orc.ai)})`);
  hold(r, unit(r, 10002)); hold(r, unit(r, 10003));
  orc.maxHp = orc.hp = 100000; orc.stats = { ...orc.stats, healthRegen: 0 };   // imortal de verdade: a regeneração 0x50fc5a estoura o short (32767) ao 1.º golpe
  let t = run(r, TICKS_PER_SEC * 200, () => { keep(r); return orc.ai?.type === "move" && orc.ai.x === 127; });
  console.log(`  info: o xamã andou de (${orcStart.x},${orcStart.y}) até perto de (80,77) em ${(t / TICKS_PER_SEC).toFixed(0)} s; está em ${orc.cx},${orc.cy}`);
  check(orc.ai?.type === "move" && orc.ai.x === 127 && orc.ai.y === 69, `no 1º ponto (80,77) o xamã segue para o 2º (127,69) (${JSON.stringify(orc.ai)})`);
  t = run(r, TICKS_PER_SEC * 240, () => { keep(r); return distTo(orc, 128, 72) <= 4; });
  console.log(`  info: de (80,77) até (127,69): ${(t / TICKS_PER_SEC).toFixed(0)} s; xamã em ${orc.cx},${orc.cy}`);
  run(r, TICKS_PER_SEC * 10, () => keep(r)); // termina de andar até (127,69)
  check(distTo(orc, 128, 72) <= 4 && !r.outcome, `o xamã chega ao Oráculo (128,72) sozinho (${orc.cx},${orc.cy}); sem o grupo ali ainda não acaba`);
  at(r, h, 126, 71); settle(r, 25);
  check(has(r, 14) && r.outcome?.ok === true, `grupo a <= 4 de (126,71) e o xamã no Oráculo: msg 14 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  campaignContract(103, r);

  console.log("[103] alavancas (enigmas dos prêmios); Igles/Dina; variantes; falhas");
  const sw = (q: Run, on: number[]): void => { for (const id of on) q.b.host.toggleSwitch(id); settle(q, 25); };
  r = start(); w = r.b.world; host = r.b.host; settle(r, 5);
  check([...host.switches.keys()].every(id => host.buildingHealth(id) === 1), "as 16 alavancas começam desligadas (1)");
  sw(r, [4, 6, 7]);
  check(!w.loot.length, "alavancas 4, 6 e 7 ligadas (falta a 9): nada cai");
  sw(r, [1]); sw(r, [9]);
  check(!w.loot.length, "4, 6, 7, 9 e também a 1 ligadas (a 1 deveria estar desligada): nada");
  sw(r, [1]);
  check(w.loot.some(l => l.items.includes("30608") && l.x === unit(r, 132).cx && l.y === unit(r, 132).cy) && !w.loot.some(l => l.items.includes("37269")),
    "4, 6, 7, 9 ligadas e as outras 8 desligadas (\"Item2\"): o marcador 132 larga o prêmio (cota de malha 30608)");
  sw(r, [14, 16, 13]);
  check(!w.loot.some(l => l.items.includes("37269")), "14, 16 e 13 ligadas (a 13 deveria estar desligada): o prêmio do enigma 2 não cai");
  sw(r, [13]);
  check(w.loot.some(l => l.items.includes("37269") && l.x === unit(r, 131).cx && l.y === unit(r, 131).cy), "14 e 16 ligadas, 13 e 15 desligadas (\"Item1\"): o marcador 131 larga o prêmio (arco 37269)");
  {
    // USAR como no original (ação 0xf de 0x50f12c → 0x52bfe7: 1ª estrutura da lista a Chebyshev ≤ 2 de (x−1, y−1)); tabela MEDIDA no original
    // (tools/refcap/diff/levers_probe.py, refs/trace/levers/m103.json `pick`; notes/group-levers.md)
    const q = start(), qh = q.b.host, qw = q.b.world;
    const bad = USE_PICK_103.filter(([x, y, id]) => qh.useTarget(x, y)?.id !== id).map(([x, y, id]) => `(${x},${y}) o:${id} n:${qh.useTarget(x, y)?.id}`);
    check(!bad.length, `usar: a estrutura acionada a partir de cada uma das ${USE_PICK_103.length} células medidas no original bate ${bad.slice(0, 4).join(" ")}`);
    const hp = (id: number): number => qh.buildingHealth(id);
    // cliques reais no original: com o herói vindo de (20,73) a 7 liga a 6; de (23,81) a 9 liga a 3; de (27,81) a 10 liga a 10
    for (const [lever, fx, fy, want] of [[7, 20, 73, 6], [9, 23, 81, 3], [10, 27, 81, 10]] as const) {
      const q2 = start(), h2 = q2.b.hero, use = new WalkThenUse();
      for (const id of [10002, 10003]) at(q2, unit(q2, id), 60, 60);
      // monstros parados (a aranha de (31,82) vinha lutar e ocupava a célula de chegada; o clique medido não tinha ninguém no caminho)
      for (const u of q2.b.world.units) if (u.player !== 1 && Math.max(Math.abs(u.cx - fx), Math.abs(u.cy - fy)) < 15) u.suspended = true;
      at(q2, h2, fx, fy); settle(q2, 5);
      const lv = q2.b.host.switches.get(lever)!;
      let toggled: number | undefined;
      use.start(q2.b.world, h2, lv.x, lv.y, o => q2.b.world.command(h2, o), u => { toggled = q2.b.host.useFrom(u.cx, u.cy)?.id; });
      for (let t = 0; t < TICKS_PER_SEC * 20 && use.active; t++) run(q2, 1, () => { keep(q2); use.step(q2.b.world); });
      check(toggled === want && q2.b.host.buildingHealth(want) === 0, `clique na alavanca ${lever} com o herói vindo de (${fx},${fy}): liga a ${want} como no original (ligou ${toggled}, herói em ${h2.cx},${h2.cy})`);
    }
    // a 8 e a 11 nunca são acionadas pelo uso (de qualquer vizinha sai a 1 / a 5)
    const near = (x: number, y: number): number[] => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => qh.useTarget(x + dx, y + dy)?.id ?? 0));
    check(near(28, 75).every(id => id !== 8) && near(19, 78).every(id => id !== 11), "a 8 (28,75) e a 11 (19,78) não são acionáveis pelo uso (o original aciona a 1 e a 5)");
    // Fireball sobre a 6 a LIGA (vida 1 → 0); outra Fireball a mantém ligada; usar depois a desliga (medido)
    castAt(q, q.b.hero, 2, 20, 22, 73, { x: 27, y: 73 });
    check(hp(6) === 0 && hp(7) === 1 && hp(12) === 1, "Fireball na alavanca 6: só ela liga (a 7 a 3 células fica)");
    castAt(q, q.b.hero, 2, 20, 22, 73, { x: 27, y: 73 });
    check(hp(6) === 0, "Fireball de novo na 6: continua ligada");
    qh.useFrom(23, 73);
    check(hp(6) === 1, "usar a 6 depois da Fireball a desliga");
    void qw;
  }
  const quick = (hero: HeroState, who = 10001): Run => {
    const q = start(hero); settle(q, 5);
    const stone = who === 10001 ? q.b.hero : unit(q, who);
    at(q, stone, 41, 53); settle(q); unstone(q);
    const o = q.b.world.units.find(u => u.items.includes(HEAD))!;
    q.b.world.kill(o, q.b.hero); settle(q, 5);
    const s = q.b.world.loot.find(l => l.items.includes(HEAD))!;
    // uma súcubo pode ter começado Stone Curse no portador antes do teleporte: a magia pousa onde ele está (máquina 0x50f12c);
    // o cenário tira a pedra e manda de novo
    at(q, stone, s.x - 2, s.y + 1);
    for (let k = 0; k < 6 && !pickupAt(q, stone, s.x, s.y, TICKS_PER_SEC * 20); k++) unstone(q);
    beside(q, stone, 30); settle(q, 25);
    q.b.world.teleport(unit(q, 30), 128, 72); at(q, q.b.hero, 126, 71); settle(q, 25);
    return q;
  };
  let q = quick(hero0(), 10002);
  check(q.outcome?.ok === true && has(q, 9) && has(q, 12) && has(q, 14), "Igles busca a pedra e a cabeça: msgs 9 e 12, e vence");
  q = quick(hero0(), 10003);
  check(q.outcome?.ok === true && has(q, 10) && has(q, 13) && has(q, 14), "Dina busca a pedra e a cabeça: msgs 10 e 13, e vence");
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    q = quick(hero);
    check(q.outcome?.ok === true && has(q, 8) && has(q, 11) && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 30)); settle(r, 30);
  failedWith(r, 5, "xamã morto");
  r = start(); settle(r, 5); r.b.world.damage(r.b.hero, unit(r, 30), 1); settle(r, 30);
  failedWith(r, 6, "xamã atacado");
  r = start(); settle(r, 5); at(r, r.b.hero, 41, 53); settle(r, 25);
  const guards = group(r, 19);
  check(guards.length === 6, `a casa (41,50) tem ${guards.length} guardas (grupo 19)`);
  for (const id of [10001, 10002, 10003]) { const u = unit(r, id); u.maxHp = u.hp = 5000; }
  run(r, TICKS_PER_SEC * 15, () => keep(r));
  check(!r.outcome && r.b.world.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), "15 s de combate real junto à casa: sem desfecho e sem NaN");
  companionsFail(start);
  const by = offeredBy(103, false, false);
  check(by === 2005, `campanha: a 103 é oferecida pelo orcólogo (npc 2005, Kaarg), foi ${by}`);
}

// ------------------------------------------------------------------------------------------- 110
async function m110(): Promise<void> {
  console.log("\n=== Missão 110 — The Last Battle ===");
  const data = await loadData(110);
  const hero0 = (): HeroState => heroOf(false, false);
  const start = (hero: HeroState = hero0()): Run => { const q = startRun(data, hero, undefined, { companions: BOTH }); immortal(q); return q; };
  const knights = (q: Run): Unit[] => group(q, 11), druids = (q: Run): Unit[] => group(q, 12);
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const urd = unit(r, 117);
  check(Math.abs(h.cx - 241) <= 3 && Math.abs(h.cy - 239) <= 3, `herói nasce no Drop Location (241,239): ${h.cx},${h.cy}`);
  check(urd.player === 2 && urd.maxHp >= 10000 && knights(r).length === 12 && knights(r).every(u => u.player === 3) && druids(r).length === 14 && druids(r).every(u => u.player === 4) && group(r, 13).length === 15 && group(r, 14).length === 6 && group(r, 38).length === 1,
    `Urd (117, ${urd.maxHp} PV, jogador 2), 12 cavaleiros (grupo 11) e 14 druidas (grupo 12), super-lich (grupo 13, 15), super-cavaleiro da morte (grupo 14, 6), Skrakan (grupo 38)`);
  check(w.diplomacyValue(3, 4) === 0 && w.diplomacyValue(4, 3) === 0 && w.diplomacyValue(3, 1) === 2 && w.diplomacyValue(4, 1) === 2, "cavaleiros e druidas em paz entre si e aliados do herói antes do script");
  settle(r, TICKS_PER_SEC * 3);
  check(has(r, 1) && w.diplomacyValue(3, 4) === 1 && w.diplomacyValue(4, 3) === 1, "msg 1: cavaleiros e druidas entram em guerra entre si");
  check(group(r, 38).every(u => u.phased), "Skrakan (grupo 38) fora de fase");
  check([1, 4, 13, 14].every(g => group(r, g).every(u => u.suspended)), "os grupos 1 (Urd), 4, 13 e 14 ficam suspensos (Suspend group a cada ciclo): ninguém do exército de Urd age");
  check(has(r, 5), "o contador (v71 >= 5) chega a 5 ciclos: msg 5 (\"Brothers!\")");
  check(!r.outcome && r.b.host.scenarioVars.get(779) === undefined, "sem desfecho; a variável de cenário 779 ainda não foi gravada");
  {
    // guarda do GRUPO [exe 0x57275f]: os 3 magos dos cavaleiros (237,221)/(242,221)/(244,224), longe dos druidas, recebem o alvo que o
    // grupo vê (raio em volta do centroide), avançam e lançam (original, RE-DANO m110_idle*.jsonl: andam desde 0,25 s, lançam desde ~3 s)
    const q = start(), mages = knights(q).filter(u => u.spells.length);
    const home = mages.map(u => ({ x: u.cx, y: u.cy })), mana = mages.map(u => u.mana), low = [...mana];
    run(q, TICKS_PER_SEC * 12, () => { keep(q); mages.forEach((u, i) => { low[i] = Math.min(low[i]!, u.mana); }); });
    const moved = mages.filter((u, i) => Math.max(Math.abs(u.cx - home[i]!.x), Math.abs(u.cy - home[i]!.y)) >= 2).length;
    const cast = mages.filter((_, i) => low[i]! <= mana[i]! - 40).length;
    check(mages.length === 3 && moved >= 2 && cast >= 2, `guarda do grupo: os magos dos cavaleiros avançam (${moved}/3) e lançam (${cast}/3) em 12 s`);
  }
  // guerra real: o grupo parado olha 90 s a guerra dos cavaleiros contra os druidas
  const k0 = knights(r).length, d0 = druids(r).length;
  const t = run(r, TICKS_PER_SEC * 90, () => { keep(r); return knights(r).every(u => !u.alive) || druids(r).every(u => !u.alive); });
  const kLeft = knights(r).filter(u => u.alive).length, dLeft = druids(r).filter(u => u.alive).length;
  console.log(`  info: guerra real em ${(t / TICKS_PER_SEC).toFixed(0)} s: cavaleiros ${k0} -> ${kLeft}, druidas ${d0} -> ${dLeft}; 779 = ${r.b.host.scenarioVars.get(779)}; desfecho ${JSON.stringify(r.outcome)}`);
  check(kLeft < k0 || dLeft < d0, "a guerra entre os dois bandos faz baixas de verdade");
  check(w.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), "sem NaN");

  console.log("[110] vitória dos druidas / dos cavaleiros; os sobreviventes viram do jogador; Lich; Urd");
  // druidas vencem (todos os cavaleiros mortos): msg 3, 779 = 1, as duas facções passam ao jogador
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  killAll(r, knights(r)); settle(r, 25);
  check(has(r, 3) && !has(r, 2) && r.b.host.scenarioVars.get(779) === 1, "cavaleiros mortos: msg 3 (druidas triunfam) e 779 = 1");
  check(druids(r).filter(u => u.alive).length >= 10 && druids(r).every(u => u.player === 1), "os druidas sobreviventes passam ao jogador (Make druids ours)");
  check(druids(r).every(u => !u.alive || u.ai?.type === "defend" || u.ai?.type === "follow"), "os druidas do jogador passam a acompanhar o grupo");
  check(!r.outcome, "só a facção vencedora: sem desfecho (falta matar Urd)");
  const grp = r;
  // o super-lich morto: msg 4
  killAll(r, group(r, 13)); settle(r, 25);
  check(has(r, 4) && count(r, 4) === 1, "grupo 13 (super-lich) morto: msg 4");
  // Urd morto: msg 6 e vitória
  w.kill(unit(r, 117), h); settle(r, 25);
  check(has(r, 6) && r.outcome?.ok === true, `Urd morto: msg 6 e Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r) && messagesHaveText(r, hero0()), "script sem ações sem suporte e falas com texto");
  const stD = campaignContract(110, grp, false, false, {}, [779]);
  check(getVar(stD, 779) === 1 && getVar(stD, 768) >= 120, `campanha: 779 = 1 (druidas) e o estágio chega a ${getVar(stD, 768)} (fim do jogo)`);
  const vidD = takePendingVideos(stD, campaignData);
  const wantD = campaignData.cutscenes.find(c => c.id === 5)?.video;
  check(!!wantD && vidD.includes(wantD), `campanha: vitória dos druidas mostra o vídeo final ${wantD} (${vidD.join(",")})`);
  // cavaleiros vencem (todos os druidas mortos): msg 2, 779 = 0
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  killAll(r, druids(r)); settle(r, 25);
  check(has(r, 2) && !has(r, 3) && r.b.host.scenarioVars.get(779) === 0, "druidas mortos: msg 2 (cavaleiros triunfam) e 779 = 0");
  check(knights(r).filter(u => u.alive).length >= 10 && knights(r).every(u => u.player === 1), "os cavaleiros sobreviventes passam ao jogador (Make knights ours)");
  w.kill(unit(r, 117), h); settle(r, 25);
  check(r.outcome?.ok === true, "Urd morto: Mission Complete");
  const stK = campaignContract(110, r, false, false, {}, [779]);
  const vidK = takePendingVideos(stK, campaignData);
  const wantK = campaignData.cutscenes.find(c => c.id === 4)?.video;
  check(getVar(stK, 779) === 0 && !!wantK && vidK.includes(wantK) && wantK !== wantD, `campanha: 779 = 0 (cavaleiros) mostra o vídeo final ${wantK} (${vidK.join(",")})`);
  check(nextAfterMissionEnd(stK) && isDone(stK, 110), "campanha: depois da 110 o jogo vai ao fim (estágio 120)");
  // Urd morto antes de alguém vencer: vitória sem a variável 779
  r = start(); w = r.b.world; h = r.b.hero; settle(r, 5);
  w.kill(unit(r, 117), h); settle(r, 25);
  check(r.outcome?.ok === true && has(r, 6) && r.b.host.scenarioVars.get(779) === undefined, "Urd morto com as duas facções vivas: Mission Complete sem gravar 779 (a campanha usa o último valor do script)");
  const stN = campaignContract(110, r, false, false, {}, [779]);
  check(getVar(stN, 779) === 0, `campanha: sem 779 no resultado (só subobjetivos) a variável continua 0 = cavaleiros (${getVar(stN, 779)}); o último valor de scenarioVarsSet só vale sem o campo scenarioVars`);
  // fim da campanha: a 110 só é oferecida depois da 100
  const by = offeredBy(110, false, false);
  check(by === 2006, `campanha: a 110 é oferecida pelo velho cavaleiro (npc 2006, Kaarg), foi ${by}`);
  // falas por variante; Igles/Dina; falhas do motor
  for (const v of VARIANTS) {
    const hero = heroOf(v.mage, v.female);
    const q = start(hero); settle(q, 5); killAll(q, knights(q)); settle(q, 10); q.b.world.kill(unit(q, 117)); settle(q, 25);
    check(q.outcome?.ok === true && messagesHaveText(q, hero), `${v.label}: Mission Complete e falas com texto`);
  }
  companionsFail(start);
}
const nextAfterMissionEnd = (st: CampaignState): boolean => nextAfterMission(st).scene === "end";

// ------------------------------------------------------------------------------------------- 0
/** Pegar item do chão pela interface (mission/pickup.ts, usado pelo clique e pelo cursor da MissionScene), com a coroa do xamã da missão 80. */
async function pickupUi(): Promise<void> {
  console.log("\n=== Interface: pegar item do chão (coroa da missão 80) ===");
  const data = await loadData(80);
  const r = startRun(data, heroOf(false, false), undefined, { companions: BOTH });
  immortal(r);
  const w = r.b.world, h = r.b.hero;
  settle(r, 5);
  const shaman = unit(r, 38);
  w.kill(shaman, h); settle(r, 5);
  const sack = w.loot.find(l => l.items.includes("3665"));
  check(!!sack, "o xamã morto larga a coroa 13 (3665) no chão");
  const sx = sack!.x, sy = sack!.y;
  check(sackAtCell(w, sx, sy, h) === sack && !sackAtCell(w, sx + 3, sy, h), "sackAtCell: o saco só vale na própria célula");
  // um orc do bando em volta (célula vizinha): o clique no saco continua sendo do saco
  const orc = group(r, 9).find(u => u.alive && u !== shaman)!;
  at(r, orc, sx + 1, sy);
  check(sackAtCell(w, sx, sy, h) === sack, "com um orc da célula vizinha o saco continua com prioridade sobre a unidade (antes o clique virava ataque)");
  // alguém em cima do saco: o clique é nele
  at(r, orc, sx, sy);
  check(w.unitAtCell(sx, sy) === orc && sackAtCell(w, sx, sy, h) === undefined, "um orc EM CIMA do saco: o clique é nele (sackAtCell vazio)");
  check(sackAtCell(w, sx, sy, orc) === sack, "o próprio ocupante pode recolher o que está debaixo dele");
  w.kill(orc, h);
  check(sackAtCell(w, sx, sy, h) === sack, "orc morto não ocupa a célula: o saco volta a valer");
  // a ordem pickup anda até o saco e recolhe; o evento "pickup" traz os itens (aviso da interface)
  at(r, h, sx - 3, sy + 1);
  w.command(h, { type: "pickup", x: sx, y: sy });
  let seen: string[] | undefined;
  for (let i = 0; i < TICKS_PER_SEC * 60 && !seen; i++) {
    w.step();
    for (const e of w.events) if (e.type === "pickup" && e.unit === h.id) seen = e.items;
    w.events.length = 0;
  }
  check(!!seen && seen.includes("3665") && h.items.includes("3665") && !w.loot.some(l => l.x === sx && l.y === sy), `o herói anda até o saco e pega a coroa; evento pickup com ${JSON.stringify(seen)}`);
  const nm = (id: string): string => data.items?.[id]?.name ?? `item ${id}`;
  check(pickupText({ gold: 0, items: ["3665"] }, nm) === `Picked up ${nm("3665")}`, `aviso do item: "${pickupText({ gold: 0, items: ["3665"] }, nm)}"`);
  check(pickupText({ gold: 120, items: ["3665", "3665"] }, id => "Crown") === "Picked up 120 gold, Crown x2" && pickupText({ gold: 0, items: [] }, nm) === undefined, "aviso com ouro e itens repetidos; saco vazio não avisa");
  // missão 80: com a coroa na mão o script termina (777 = 0)
  settle(r, 30);
  check(r.outcome?.ok === true, `com a coroa pega pela ordem pickup o script da 80 termina (${JSON.stringify(r.outcome)})`);
}

// ------------------------------------------------------------------------------------------- execução
const only = proc.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
const all: [number, () => Promise<void>][] = [[0, pickupUi], [90, m90], [91, m91], [92, m92], [93, m93], [94, m94], [95, m95], [96, m96], [100, m100], [101, m101], [102, m102], [103, m103], [110, m110]];
for (const [id, fn] of all) {
  if (only.length && !only.includes(id)) continue;
  try { await fn(); } catch (e) { failed(`missão ${id} lançou exceção: ${(e as Error).stack ?? e}`); }
}
proc.exitCode = summary();
