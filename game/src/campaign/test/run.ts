/**
 * Testes do motor de campanha (sem navegador). Rodar em game/:  npm run test:campaign  (= npx tsx src/campaign/test/run.ts)
 *
 * Lê data/campaign.json, campaign-shops.json e items.json de game/public. Casos:
 *  1. simulação de ponta a ponta (como tools/data/campaign.py): ordem canônica dos 4 tipos de herói = validation.canonical;
 *     centenas de ordens aleatórias (contratando mercenários e variando as variáveis dos scripts): as 46 missões alcançáveis, fim no 120
 *  2. Plagat: taverna do estágio 10, guarda, mensageiro põe a 10 no mapa, saída pelo mapa Uimoir
 *  3. 10 → vídeo teleport → 20 direto; 20 → Kaarg + arqueira; regras de mercenário (recusa após ir), Igles, Dina
 *  4. ofertas presas a um estágio somem; 81/82 por classe; cadeia de Talena por (mago, mulher); final 779 → knights/druids; hall
 *  5. lojas: estoque estável por save, muda com o estágio, prateleira Elven da loja druida após a conversa 675/78
 *  6. derrota não muda nada; saneamento do save; migração do modelo antigo (availableMissions/flags)
 */
import {
  FINAL_STAGE, V_MERC_STATE, availableMissions, availableTowns, decodeInnCode, enterLocation, getVar, globalMapNodes, innPatrons, isDone,
  leaveTown, mercTemplate, newCampaign, nextAfterMission, onMissionResult, rng, sanitizeCampaign, setVar, stageOf, takePendingVideos, talkTo,
  toggleHire, partyForMission,
} from "../engine";
import { shopStock, takeFromStock } from "../shops";
import { DEFAULT_FAME, fameScore, hallStatsOf, hallXp, insertFame, recordHallStats } from "../hall";
import { applyQueue, ensureCampaign, queueResult, type ProgressLike } from "../progress";
import type { CampaignData, CampaignState, PoolItem, ShopsData } from "../types";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { readFileSync } = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(PUB, rel), "utf8")) as T;

const data = json<CampaignData>("data/campaign.json");
const shops = json<ShopsData>("data/campaign-shops.json");
const items = json<Record<string, PoolItem>>("data/items.json");
const pool = Object.values(items);

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const ALL = Object.keys(data.missions).map(Number).sort((a, b) => a - b);

// ------------------------------------------------------------------ simulação (porta de tools/data/campaign.py: Sim/simulate)
interface SimOpts { mage: boolean; female: boolean; policy: "lowest" | "mainFirst" | "random"; seed?: number }
function simulate(o: SimOpts): { st: CampaignState; cutscenes: number[]; error?: string } {
  const r = rng(o.seed ?? 1);
  const st = newCampaign(data, { mage: o.mage, female: o.female }, o.seed ?? 1);
  const cutscenes: number[] = [];
  for (let steps = 0; stageOf(st) < FINAL_STAGE && steps < 200; steps++) {
    // entra em cada cidade disponível e fala com todos (o que um jogador atento faz)
    for (const town of availableTowns(st)) {
      enterLocation(st, ["T", town]);
      for (const p of innPatrons(st, data, town)) {
        if (p.kind === 0 || p.kind === 3) talkTo(st, data, p);
        else if (o.policy === "random" && p.kind === 1 && !p.hired && r() < 0.5) toggleHire(st, data, p.merc!);
      }
      if (town === 1 && getVar(st, 769)) leaveTown(st, 1);
    }
    const missions = availableMissions(st).sort((a, b) => a - b);
    if (!missions.length) return { st, cutscenes, error: `sem missões no estágio ${stageOf(st)} (${st.log})` };
    let m: number;
    if (!availableTowns(st).length) m = st.locations.find(l => l[0] === "M")![1];
    else if (o.policy === "lowest") m = missions[0];
    else if (o.policy === "mainFirst") m = missions.find(x => x % 10 === 0) ?? missions[0];
    else m = missions[Math.floor(r() * missions.length)];
    enterLocation(st, ["M", m]);
    const vars = o.policy === "random"
      ? (data.missions[String(m)].scenarioVarsSet ?? []).map(s => [s.var, r() < 0.5 ? 0 : 1] as [number, number]) : undefined;
    const res = onMissionResult(st, data, { id: m, outcome: "complete", scenarioVars: vars?.length ? vars : undefined });
    cutscenes.push(...res.cutscenes);
  }
  return { st, cutscenes };
}

console.log("\n[1. simulação de ponta a ponta]");
const HEROES: Record<string, { mage: boolean; female: boolean }> = {
  male_fighter: { mage: false, female: false }, female_fighter: { mage: false, female: true },
  male_mage: { mage: true, female: false }, female_mage: { mage: true, female: true },
};
for (const [name, h] of Object.entries(HEROES)) {
  const s = simulate({ ...h, policy: "lowest" });
  const canon = data.validation?.canonical?.[name];
  check(!s.error && stageOf(s.st) === FINAL_STAGE, `${name}: chega ao estágio 120 (${s.st.log.length} missões)`);
  check(canon && eq(s.st.log, canon.order), `${name}: ordem canônica igual à do campaign.py`);
  check(canon && eq(s.cutscenes, canon.cutscenes), `${name}: vídeos ${s.cutscenes.join(",")}`);
}
{
  const reached = new Set<number>();
  let runs = 0, ended = 0, errors: string[] = [];
  for (const [, h] of Object.entries(HEROES)) {
    for (const policy of ["lowest", "mainFirst"] as const) { const s = simulate({ ...h, policy }); runs++; if (stageOf(s.st) === FINAL_STAGE) ended++; s.st.log.forEach(m => reached.add(m)); if (s.error) errors.push(s.error); }
    for (let seed = 1; seed <= 250; seed++) {
      const s = simulate({ ...h, policy: "random", seed });
      runs++;
      if (s.error) errors.push(s.error);
      if (stageOf(s.st) === FINAL_STAGE) ended++;
      s.st.log.forEach(m => reached.add(m));
    }
  }
  check(errors.length === 0, `nenhuma simulação trava (${runs} execuções)${errors.length ? ": " + errors[0] : ""}`);
  check(ended === runs, `todas terminam no estágio 120 (${ended}/${runs})`);
  check(reached.size === 46 && ALL.every(m => reached.has(m)), `as 46 missões são alcançáveis (${reached.size})`);
}

console.log("\n[2. Plagat]");
{
  const st = newCampaign(data, { mage: false, female: false }, 7);
  const ps = innPatrons(st, data, 1);
  check(eq(ps.map(p => p.npc), [207, 2108, 517]), `taverna do estágio 10: ${ps.map(p => p.npc).join(",")}`);
  check(ps[2].kind === 3 && ps[2].mission === 10 && ps[2].textKey === "npc517talk10", "o mensageiro (517) oferece a 10");
  check(!leaveTown(st, 1).ok && availableTowns(st)[0] === 1, "guarda não deixa sair antes de falar com o mensageiro");
  talkTo(st, data, ps[0]);
  check(availableMissions(st).length === 0, "conversa fiada (207) não põe missão no mapa");
  const t = talkTo(st, data, ps[2]);
  check(t.addedMission === 10 && getVar(st, 769) === 1, "falar com o mensageiro já põe a 10 no mapa e libera o portão (vars[769])");
  const lv = leaveTown(st, 1);
  check(lv.ok && lv.map === "uimoir" && lv.autoMission === 10 && availableTowns(st).length === 0, "saída: mapa Uimoir, herói vai sozinho à 10, Plagat some");
  const gm = globalMapNodes(st, data);
  check(gm.map === "uimoir" && gm.nodes.some(n => n.kind === "mission" && n.id === 10) && gm.hero?.x === 215, "mapa-múndi Uimoir com a 10 e o herói em Plagat");
}

console.log("\n[3. 10 → 20 → Kaarg; mercenários e grupo]");
{
  const st = newCampaign(data, { mage: false, female: false }, 7);
  talkTo(st, data, innPatrons(st, data, 1)[2]); leaveTown(st, 1); enterLocation(st, ["M", 10]);
  const r10 = onMissionResult(st, data, { id: 10, outcome: "complete" });
  check(r10.completed && stageOf(st) === 20 && eq(r10.cutscenes, [1]), "vitória na 10: estágio 20, vídeo 1");
  check(eq(takePendingVideos(st, data), ["teleport"]) && st.pending.length === 0 && st.videos.includes(1), "vídeo pendente = teleport (consumido e marcado como visto)");
  const n10 = nextAfterMission(st);
  check(n10.scene === "mission" && (n10 as { mission: number }).mission === 20, "sem cidade: a 20 começa direto");
  const r20 = onMissionResult(st, data, { id: 20, outcome: "complete", scenarioVars: [[772, 0]] });
  check(r20.stageAfter === 30 && availableTowns(st)[0] === 2 && !availableMissions(st).includes(21), "20 sem a variável 772: Kaarg disponível, sem a 21");
  check(nextAfterMission(st).scene === "globalmap", "com cidade disponível: volta ao mapa-múndi");
  const gm = globalMapNodes(st, data);
  check(gm.map === "yases" && gm.nodes.some(n => n.kind === "town" && n.id === 2) && gm.nodes.some(n => n.done && n.id === 20), "mapa Yases: Kaarg + cruz na 20");
  enterLocation(st, ["T", 2]);
  const ps = innPatrons(st, data, 2);
  check(eq(ps.map(p => p.npc), [22, 2108, 2110, 1]), `taverna de Kaarg no 30: ${ps.map(p => p.npc).join(",")}`);
  const archer = ps.find(p => p.merc === 1)!;
  check(archer.kind === 1 && archer.acceptKey === "npc1accept30" && decodeInnCode(archer.code).npc === 1, "arqueira (merc 1) livre, fala npc1accept30");
  check(mercTemplate(data, 1, 30) === 10011 && mercTemplate(data, 7, 110) === 10079, "template de mercenário 10000+10n+estágio/10−2");
  const h = toggleHire(st, data, 1);
  check(h.hired && h.textKey === "npc1accept30" && innPatrons(st, data, 2).find(p => p.merc === 1)!.hired, "contratar (grátis) marca o bit 31");
  check(eq(partyForMission(st, data).mercs, [{ merc: 1, template: 10011 }]), "a missão recebe a arqueira com o template do estágio");
  talkTo(st, data, ps[0]);
  check(getVar(st, V_MERC_STATE + 1) === 1 && st.party.includes(22) && availableMissions(st).includes(30), "Igles (22/30): oferece a 30, libera o espadachim e entra no grupo");
  onMissionResult(st, data, { id: 30, outcome: "complete" });
  check(getVar(st, V_MERC_STATE) === 2 && getVar(st, V_MERC_STATE + 1) === 1 && !innPatrons(st, data, 2).some(p => p.hired), "após a missão: quem foi descansa (estado 2), contratos zerados");
  const rej = toggleHire(st, data, 1);
  check(rej.refused && rej.textKey === "npc1reject40", "arqueira recusa a missão seguinte (npc1reject40)");
  check(!availableMissions(st).includes(31) && !innPatrons(st, data, 2).some(p => p.talk === 31), "oferta da 31 (presa ao estágio 30) sumiu sem conversa");
  check(eq(st.pending, [2]), "vídeo stars pendente após a 30");
  for (const p of innPatrons(st, data, 2)) talkTo(st, data, p);
  onMissionResult(st, data, { id: 40, outcome: "complete" });
  check(availableMissions(st).includes(50) && availableMissions(st).includes(60) && st.party.includes(23) && getVar(st, 773) === 23, "40: surgem 50 e 60; Dina entra no grupo (vars[773]=23)");
  check(getVar(st, 532) === 1, "arqueira volta a ficar livre (não foi à 40)");
}

console.log("\n[4. ofertas por classe, Talena, final]");
{
  const run = (mage: boolean, female: boolean) => simulate({ mage, female, policy: "lowest" }).st;
  const mm = run(true, false), ff = run(false, true);
  check(isDone(mm, 81) && !isDone(mm, 82) && isDone(ff, 82) && !isDone(ff, 81), "81 só para mago, 82 só para guerreiro");
  check(isDone(mm, 77) && isDone(mm, 87) && isDone(mm, 96) && isDone(ff, 75) && isDone(ff, 85) && isDone(ff, 94), "cadeia de Talena por (mago, mulher)");
  const st = run(false, false);
  check(st.queue.length === 0 && nextAfterMission(st).scene === "end", "estágio 120: fim do jogo");
  // final alternativo
  const s2 = newCampaign(data, { mage: false, female: false }, 3);
  setVar(s2, 768, 110); s2.locations = [["T", 2], ["M", 110]];
  const k = onMissionResult(s2, data, { id: 110, outcome: "complete", scenarioVars: { 779: 0 } });
  check(eq(k.cutscenes, [4]) && k.ended && stageOf(s2) === FINAL_STAGE, "110 com 779=0: vídeo knights, estágio 120");
  const s3 = newCampaign(data, { mage: false, female: false }, 3);
  setVar(s3, 768, 110); s3.locations = [["T", 2], ["M", 110]];
  check(eq(onMissionResult(s3, data, { id: 110, outcome: "complete", scenarioVars: [[779, 1]] }).cutscenes, [5]), "110 com 779=1: vídeo druids");
  // crown = a segunda de 70/80
  const s4 = newCampaign(data, { mage: false, female: false }, 3);
  setVar(s4, 768, 70); s4.locations = [["T", 2], ["M", 70], ["M", 80]];
  const a = onMissionResult(s4, data, { id: 80, outcome: "complete" }), b = onMissionResult(s4, data, { id: 70, outcome: "complete" });
  check(a.cutscenes.length === 0 && eq(b.cutscenes, [3]), "vídeo crown só na segunda de 70/80");
}

console.log("\n[5. lojas]");
{
  const st = newCampaign(data, { mage: false, female: false }, 42);
  const p1 = shopStock(st, shops, 1, pool);
  check(p1.shelves.length === 4 && p1.shelves[0].length > 10 && p1.shelves[1].length > 5 && p1.shelves[3].length >= 6, `Plagat: prateleiras ${p1.shelves.map(s => s.length).join("/")}`);
  check(p1.shelves[0].every(i => i.price <= 1500) && p1.shelves[3].some(i => i.spell !== undefined && i.id.includes("#")), "Plagat: preços ≤ 1500; livros com a magia no id");
  check(p1.shelves[3].filter(i => i.count >= 50).length === 6, "6 poções fixas com 50+ unidades");
  const again = shopStock(st, shops, 1, pool);
  check(again === p1, "estoque guardado no estado (mesma chave → mesmo objeto)");
  const st2 = newCampaign(data, { mage: false, female: false }, 43);
  check(!eq(shopStock(st2, shops, 1, pool).shelves[0], p1.shelves[0]), "outra semente → outro sorteio");
  const st3 = newCampaign(data, { mage: false, female: false }, 42);
  check(eq(shopStock(st3, shops, 1, pool), p1), "mesma semente → mesmo estoque (estável por save)");
  const id = p1.shelves[0][0].id, n = p1.shelves[0][0].count;
  check(takeFromStock(st, 1, 0, id) && (st.stock["1"].shelves[0].find(i => i.id === id)?.count ?? 0) === n - 1, "comprar tira do estoque");
  const k30 = shopStock(st, shops, 2, pool).key;
  setVar(st, 768, 40);
  check(shopStock(st, shops, 2, pool).key !== k30, "estoque de Kaarg muda com o estágio");
  // loja druida: Elven após a conversa 675/78
  const s = simulate({ mage: false, female: false, policy: "lowest" }).st;
  check((s.shops["3"]?.[3]?.mask ?? 0) & 0x80000, "conversa 675/78 acrescenta Elven à prateleira 3 da loja druida");
  const d = shopStock(s, shops, 3, pool);
  check(d.shelves[3].length > 0 && d.shelves[3].every(i => items[i.id]?.shape === "Elven"), `prateleira Elven com ${d.shelves[3].length} itens`);
}

console.log("\n[6. derrota, save e migração]");
{
  const st = newCampaign(data, { mage: false, female: false }, 5);
  talkTo(st, data, innPatrons(st, data, 1)[2]); leaveTown(st, 1);
  const before = JSON.stringify(st);
  const f = onMissionResult(st, data, { id: 10, outcome: "fail" });
  check(!f.completed && JSON.stringify(st) === before && f.next?.[1] === 10, "derrota não muda a campanha (próximo local = a mesma missão)");
  const rt = sanitizeCampaign(JSON.parse(JSON.stringify(st)));
  check(eq(rt, st), "estado sobrevive a JSON (save/load)");
  check(sanitizeCampaign({ vars: 3 }) === undefined && sanitizeCampaign(null) === undefined, "estado corrompido é rejeitado");
  // migração do modelo antigo
  const p: ProgressLike = { town: "plagat", completedMissions: [10], availableMissions: [20], flags: { accepted_10: 1 } };
  const c = ensureCampaign(p, { heroClass: "fighter", sex: "male" }, data, 9);
  check(stageOf(c) === 20 && eq(c.locations, [["M", 20]]) && eq(c.log, [10]) && getVar(c, 769) === 1 && c.pending.length === 0, "save antigo (10 concluída) → estágio 20, só a 20 na lista");
  check(eq(p.availableMissions, [20]) && p.flags.accepted_10 === undefined, "campos antigos sincronizados; flags accepted_* removidas");
  const fresh: ProgressLike = { town: "plagat", completedMissions: [], availableMissions: [10], flags: {} };
  const c2 = ensureCampaign(fresh, { heroClass: "mage", sex: "female" }, data, 9);
  check(eq(c2.locations, [["T", 1]]) && getVar(c2, 776) === 1 && getVar(c2, 781) === 1, "jogo novo: só Plagat; maga grava vars[776]/[781]");
  const old2: ProgressLike = { town: "plagat", completedMissions: [10, 20], availableMissions: [], flags: {} };
  const c3 = ensureCampaign(old2, { heroClass: "fighter", sex: "male" }, data, 9);
  check(stageOf(c3) === 30 && availableTowns(c3)[0] === 2 && old2.town === "kaarg", "save antigo com 10 e 20 → Kaarg, estágio 30");
  // fila de resultados (a missão grava, a cidade aplica)
  const q: ProgressLike = { town: "plagat", completedMissions: [], availableMissions: [], flags: {} };
  const c4 = ensureCampaign(q, { heroClass: "fighter", sex: "male" }, data, 9);
  talkTo(c4, data, innPatrons(c4, data, 1)[2]); leaveTown(c4, 1);
  queueResult(q, { id: 10, outcome: "complete" }); queueResult(q, { id: 10, outcome: "complete", scenarioVars: [[1, 2]] });
  check(c4.queue.length === 1 && eq(c4.queue[0].scenarioVars, [[1, 2]]), "fila sem duplicatas; scenarioVars do resultado prevalecem");
  const outs = applyQueue(q, data);
  check(outs.length === 1 && outs[0].completed && eq(q.completedMissions, [10]) && eq(q.availableMissions, [20]), "applyQueue aplica e sincroniza");
}

// 7. hall da fama (exe 0x4a8d28/0x4a8c5e; campaign/hall.ts)
{
  console.log("\n[7. hall da fama]");
  check(fameScore(7320, 2, 0) === 0 && fameScore(1_000_000, 2000, 0) === 4000 && fameScore(7320, 0, 100) === 0, "tempo 0: trunc(XP/500000×abates); sem abates: 0");
  check(fameScore(1_000_000, 1200, 30000) === 4000 && fameScore(7320, 2, 61) === 24, "trunc(XP/(tempo×10)×abates)");
  check(hallXp({ skillExp: { blade: 1000, axe: 20.5, fire: 0 }, exp: 5 } as never) === 1020.5 && hallXp({ exp: 7 } as never) === 7, "XP = soma da experiência por habilidade (senão a do herói)");
  const base = DEFAULT_FAME.map(([name, score]) => ({ name, score }));
  const r1 = insertFame(base, { name: "Eu", score: 56966 });
  check(r1.rank === 2 && r1.list[2].name === "Eu" && r1.list[3].name === "Gella" && r1.list.length === 10 && r1.list[9].name === "Monk", "empate: o novo sobe; Nick (último) sai");
  const r2 = insertFame(base, { name: "Eu", score: 0 });
  check(r2.rank === 9 && r2.list[9].name === "Eu" && r2.list.length === 10, "0 pontos entra antes do 'Nick 0' (empate sobe)");
  const r3 = insertFame(base, { name: "Eu", score: -5 });
  check(r3.rank === -1 && r3.list.length === 10 && r3.list.every(e => e.name !== "Eu"), "pontos abaixo de todos: fora da lista");
  const camp = { log: [10, 20, 30] } as unknown as CampaignState;
  check(hallStatsOf(camp).estimated && hallStatsOf(camp).kills === 60, "sem estatísticas gravadas: estimativa por missão");
  recordHallStats(camp, 125_000, 7); recordHallStats(camp, 61_000, 3);
  check(eq(camp.hall, { seconds: 186, kills: 10 }) && !hallStatsOf(camp).estimated, "recordHallStats acumula segundos (ticks/16) e abates");
  const sv = sanitizeCampaign(JSON.parse(JSON.stringify({ ...newCampaign(data, { mage: false, female: false }, 9), hall: { seconds: 186.7, kills: 10 } })));
  check(eq(sv?.hall, { seconds: 186, kills: 10 }), "campaign.hall sobrevive ao save/load");
  // ligação MissionScene.leave → recordHallStats(camp, world.tick × TICK_MS, abates): 1200 ticks de 50 ms = 60 s; vitórias acumulam; pausa não conta (ticks não andam)
  const run2 = { log: [10, 20] } as unknown as CampaignState;
  recordHallStats(run2, 1200 * 50, 12); recordHallStats(run2, 2400 * 50, 30);
  check(eq(run2.hall, { seconds: 180, kills: 42 }), "ticks de simulação (20/s) viram segundos; abates das missões somam");
  const st2 = hallStatsOf(run2), pts = fameScore(7320 + 4000, st2.kills, st2.seconds);
  check(!st2.estimated && pts === Math.trunc(11320 / (180 * 10) * 42), "hallStatsOf(camp) alimenta a pontuação do hall (sem estimativa)");
  const ins = insertFame(base, { name: "Eu", score: pts });
  check(pts === 264 && ins.list.length === 10 && ins.rank === 9, "pontuação gravada (264) entra na lista de 10 antes do Nick");
  const sv2 = sanitizeCampaign(JSON.parse(JSON.stringify({ ...newCampaign(data, { mage: false, female: false }, 9), hall: run2.hall })));
  check(eq(sv2?.hall, { seconds: 180, kills: 42 }), "hall acumulado persiste no save da campanha");
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
