/**
 * Teste de ponta a ponta HEADLESS da campanha inteira, para os 4 heróis do criador (guerreiro, guerreira, mago, maga).
 * Rodar em game/:  npm run test:campaign   (= run.ts && e2e.ts)   ou   npx tsx src/campaign/test/e2e.ts [--rapido]
 *
 * O jogo é conduzido pelas MESMAS funções das cenas (sem Pixi/DOM): criação do herói (ui/chargenData.ts) -> `state.newGame` -> cena "town"
 * (`routeTownArrival`) -> taverna (`innPatrons`/`talkTo`/`toggleHire`) -> loja (`shopStock`/`takeFromStock`) -> portão (`leaveTown`) ->
 * mapa-múndi (`globalMapNodes`/`enterLocation`) -> missão (simulação real do mundo, e_pilot) -> `state.completeMission` -> vídeos -> cidade ...
 * até o estágio 120 (missão 110, vídeo final, hall da fama e créditos). Passos de cada partida:
 *   A  partida direta, com verificação a cada etapa (missão oferecida, ordem, vars gravadas, vídeos, grupo, ouro/XP/itens, galeria);
 *   B  a mesma partida RECARREGANDO do save (slot -> JSON -> slot) em cada ponto de salvamento: o resultado final tem de ser idêntico ao de A;
 *   C  derrota (10 e 30) -> a campanha não muda e o herói volta ao da entrada; mid-mission: snapshot da 10, recarregar e terminar igual.
 * Vitórias: 10 e 20 são "reais" (o herói anda; o script decide); as outras 44 são "forçadas" (ver e2e_pilot.ts: o script roda 3 s e a vitória é
 * declarada com as variáveis de cenário que o script gravaria) porque os pilotos de src/sim/test/missions_*.ts não têm API reutilizável.
 */
import { addToFameHall, campaignCtx, enterTown, hallStatsOf, hallXp, loadItemPool, loadShopsData, routeTownArrival } from "../runtime";
import {
  FINAL_STAGE, V_DONE, V_HIRED, V_JOIN, V_M10_TAKEN, V_MAGE, V_FEMALE, availableMissions, availableTowns, enterLocation, evalAll, getVar, globalMapNodes,
  hiredMercs, innPatrons, isDone, leaveTown, rng, stageOf, talkTo, toggleHire,
} from "../engine";
import { syncLegacy } from "../progress";
import { shopStock, takeFromStock } from "../shops";
import { readMask, unlockedCutscenes } from "../../ui/cutsceneGallery";
import { GameState } from "../../core/state";
import { SaveManager } from "../../core/save";
import { restoreMission, snapshotMission, type MissionSnapshot } from "../../sim/snapshot";
import { campaignData as D, check, summary } from "../../sim/test/pilot";
import { json, proc, run } from "../../sim/test/loader";
import type { CampaignState, PoolItem, ShopsData } from "../types";
import {
  E2E_VARIANTS, asGame, browserStorage, createCharacter, diffPaths, makeGame, persisted, resetBrowserStorage, roundTrip, stable, applyMissionResult,
  type FakeGame, type Variant,
} from "./e2e_harness";
import { buildMissionRun, pilotMission, walkToSkrakan } from "./e2e_pilot";

console.info = () => { /* mudo: o jogo registra cada autosave */ };
const QUICK = proc.argv.includes("--rapido");
const SHOPS = json<ShopsData>("data/campaign-shops.json")!;
const POOL = Object.values(json<Record<string, PoolItem>>("data/items.json") ?? {});

// ------------------------------------------------------------------ oráculos independentes do motor (notes/campaign.md)
/** Vídeos que a campanha original toca, na ordem das vitórias: 10 teleport; 30 stars; crown na 2ª de 70/80; 110 knights (779=0) ou druids (779=1). */
function expectedVideos(log: number[], ending: 0 | 1): string[] {
  const v: string[] = [];
  const seen: number[] = [];
  for (const m of log) {
    seen.push(m);
    if (m === 10) v.push("teleport");
    if (m === 30) v.push("stars");
    if ((m === 70 || m === 80) && seen.includes(m === 70 ? 80 : 70)) v.push("crown");
    if (m === 110) v.push(ending ? "druids" : "knights");
  }
  return v;
}
/** Estágio = 10 + 10 por missão principal (id múltiplo de 10) concluída [DLL 0x10002465]. */
const expectedStage = (log: number[]): number => 10 + 10 * log.filter(m => m % 10 === 0).length;
const VIDEO_ID: Record<string, number> = { teleport: 1, stars: 2, crown: 3, knights: 4, druids: 5 };

// ------------------------------------------------------------------ uma partida
/** `sloppy` = semente de um jogador descuidado (fala só com parte do povo, contrata ao acaso, escolhe missões ao acaso e volta à taverna quando trava); sem ele: diligente (fala com todos, a menor missão primeiro) */
interface RunOpts { label: string; ending: 0 | 1; reload: boolean; failAt: number[]; sloppy?: number }
interface Report {
  label: string; hero: string; problems: string[]; checks: number; log: number[]; videos: string[]; real: number; forced: number; points: number; reloads: number;
  sig: string; fame?: { rank: number; score: number }; gallery: string[]; missions: number;
  /** missões jogadas com Igles / Dina / ao menos um mercenário, e itens comprados */
  withIgles: number; withDina: number; withMercs: number; maxMercs: number; bought: number;
}

async function playthrough(v: Variant, o: RunOpts): Promise<Report> {
  resetBrowserStorage();
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;                       // semente da campanha estável (ensureCampaign usa Date.now) -> A e B comparáveis
  try { return await playthroughInner(v, o); } finally { Date.now = realNow; }
}

async function playthroughInner(v: Variant, o: RunOpts): Promise<Report> {
  const g = makeGame();
  const G = asGame(g);
  const problems: string[] = [];
  let checks = 0;
  const ex = (c: unknown, msg: string): void => { checks++; if (!c && problems.length < 25) problems.push(msg); };
  const camp = (): CampaignState => g.state.progress.campaign!;
  const st0 = (): GameState => g.state;
  const stages = (): string => `estágio ${camp() ? stageOf(camp()) : "?"}`;

  const diligent = o.sloppy === undefined;
  const rnd = rng(o.sloppy ?? 1);
  const pick = (p: number): boolean => diligent || rnd() < p;
  const hero = await createCharacter(g, v);
  ex(hero.heroClass === (v.mage ? "mage" : "fighter") && hero.sex === (v.female ? "female" : "male") && hero.gold === 1000, `${v.label}: herói do criador (${hero.heroClass}/${hero.sex}/${hero.gold})`);
  let goldExp = hero.gold, expExp = 0;
  const bought: string[] = [];

  let real = 0, forced = 0, points = 0, reloads = 0, withIgles = 0, withDina = 0, withMercs = 0, maxMercs = 0;
  let scene = "town" as "town" | "globalmap" | "mission" | "end";
  let params: unknown;
  let missionId = 0;
  let last: { id: number; log: number[]; stage: number; hiredBefore: number[]; videos: number } | undefined;     // verificações pós-vitória (só na partida sem recarga)
  let failCheck: { slim: string; gold: number; exp: number; videos: number } | undefined;
  const slim = (): string => stable({ vars: camp().vars, locations: [...camp().locations].sort(), log: camp().log, party: camp().party, videos: camp().videos });

  /** Ponto de salvamento: round-trip pelo save real; com `o.reload`, o jogo passa a ser o carregado e a cena volta à cidade (como "Load Game"). */
  const reloadedAt = new Set<string>();
  const checkpoint = (where: string): boolean => {
    const rt = roundTrip(g);
    points++;
    ex(rt.equal, `${v.label}: save/load em "${where}" (${stages()}) difere: ${rt.diff.join(" | ")}`);
    ex(rt.target?.scene === "town", `${v.label}: load em "${where}" volta para a cidade`);
    if (!o.reload) return false;
    const key = where + "|" + stable(persisted(g.state));
    if (reloadedAt.has(key)) return false;                // o mesmo ponto com o mesmo estado só recarrega uma vez (senão o laço cicla)
    reloadedAt.add(key);
    g.state = rt.loaded;
    reloads++;
    scene = "town"; params = undefined; last = undefined; failCheck = undefined;
    return true;
  };

  // ---------------------------------------------------------------- taverna, loja, portão
  async function visitTown(town: number): Promise<void> {
    const ctx = await campaignCtx(G);
    const st = ctx.st;
    enterTown(G, ctx, town);
    st0().save();
    const stage = stageOf(st);
    ex(st.current?.[0] === "T" && st.current[1] === town && st.lastTown === town, `cidade ${town}: entrada registrada (current/lastTown)`);
    if (town === 1 && !getVar(st, V_M10_TAKEN)) ex(!leaveTown(st, 1).ok, "Plagat: o guarda não deixa sair antes de falar com o mensageiro");
    const patrons = innPatrons(st, D, town);
    if (town === 1 && stage === 10) ex(stable(patrons.map(p => p.npc)) === "[207,2108,517]", `Plagat estágio 10: frequentadores ${patrons.map(p => p.npc)}`);
    const before = new Set(availableMissions(st));
    for (const p of patrons) {
      if ((p.kind === 0 || p.kind === 3) && pick(0.6)) {
        const r = talkTo(st, D, p);
        if (p.kind === 3) {
          ex(!!p.mission && D.missions[String(p.mission)] !== undefined, `taverna: oferta ${p.mission} existe`);
          if (p.mission && r.addedMission) {
            const def = D.missions[String(p.mission)];
            ex(def.stagesOffered.includes(stage) || stage >= def.stageGroup, `missão ${p.mission} oferecida no estágio ${stage} (grupo ${def.stageGroup}, estágios ${def.stagesOffered})`);
            ex(evalAll((def.prerequisites ?? []) as never, st, town), `missão ${p.mission}: pré-requisitos ${JSON.stringify(def.prerequisites)} valem ao ser oferecida`);
          }
        }
      }
    }
    // conversas podem liberar mercenários (22/30, 5/79): a lista de contratação é relida depois das conversas (o resultado não depende de quantas vezes se visita)
    for (const p of innPatrons(st, D, town)) {
      if (p.kind === 1 && !p.hired && pick(0.5)) { const h = toggleHire(st, D, p.merc!); ex(h.hired && !h.refused, `contratar mercenário ${p.merc} (grátis)`); }
      else if (p.kind === 2 && pick(0.5)) { const h = toggleHire(st, D, p.merc!); ex(h.refused && !getVar(st, V_HIRED + p.merc! - 1), `mercenário ${p.merc} que foi à última missão recusa (${h.textKey})`); }
    }
    const added = availableMissions(st).filter(m => !before.has(m));
    if (diligent && town === 2 && stage === 30) ex(availableMissions(st).includes(30) && (added.includes(30) || before.has(30)), `Kaarg estágio 30: Igles oferece a 30 (${[...availableMissions(st)]})`);
    if (diligent && town === 2 && stage === 30) ex(st.party.includes(22), "Igles entra no grupo ao falar na 30");
    // loja: uma compra por cidade e estágio (o item mais barato que cabe em 1/4 do ouro)
    if (town !== 1 || stage === 10 || true) {
      const fkey = `e2e_shop_${town}_${stage}`;
      const stock = shopStock(st, SHOPS, town, POOL);
      ex(stock.shelves.length === 4 && stock.shelves.some(s => s.length > 0), `loja ${town} estágio ${stage}: estoque gerado (${stock.shelves.map(s => s.length)})`);
      if (!g.state.progress.flags[fkey]) {
        g.state.progress.flags[fkey] = 1;
        const budget = Math.floor(g.state.hero!.gold / 4);
        let best: { shelf: number; id: string; price: number } | undefined;
        stock.shelves.forEach((sh, i) => { for (const it of sh) if (it.price <= budget && it.count > 0 && !it.id.includes("#") && (!best || it.price < best.price)) best = { shelf: i, id: it.id, price: it.price }; });
        if (best) {
          const b = best as { shelf: number; id: string; price: number };
          const count0 = stock.shelves[b.shelf].find(i => i.id === b.id)!.count;
          g.state.hero!.gold -= b.price; goldExp -= b.price;
          const inv = g.state.hero!.inventory.find(i => i.id === b.id);
          if (inv) inv.count = (inv.count ?? 1) + 1; else g.state.hero!.inventory.push({ id: b.id });
          ex(takeFromStock(st, town, b.shelf, b.id), `loja ${town}: item ${b.id} sai do estoque`);
          const left = shopStock(st, SHOPS, town, POOL).shelves[b.shelf].find(i => i.id === b.id)?.count ?? 0;
          ex(left === count0 - 1, `loja ${town}: estoque ${count0} -> ${left}`);
          bought.push(b.id);
        }
      } else {
        // reabrir a loja no mesmo estágio mostra o mesmo estoque (guardado no save)
        ex(shopStock(st, SHOPS, town, POOL) === st.stock[String(town)], `loja ${town}: estoque estável`);
      }
    }
    st0().progress.flags[`e2e_visit_${town}`] = st.log.length + 1;
    st0().save();
  }

  /** Portão -> mapa-múndi (ou, em Plagat, o herói segue sozinho para a missão 10). */
  function gate(town: number): void {
    const st = camp();
    const lv = leaveTown(st, town);
    ex(lv.ok, `portão de ${town} abre`);
    st0().autosave("saindo da cidade");
    if (town === 1) {
      ex(lv.map === "uimoir" && lv.autoMission === 10 && !availableTowns(st).includes(1), "Plagat: mapa Uimoir, herói vai à 10, Plagat some da lista");
      missionId = lv.autoMission ?? 0;
      enterLocation(st, ["M", missionId]); syncLegacy(st0().progress, D); st0().autosave(`entrando na missão ${missionId}`);
      scene = "mission";
    } else scene = "globalmap";
  }

  // ---------------------------------------------------------------- laço de cenas (como o jogo: town -> globalmap -> mission -> town ...)
  for (let guard = 0; scene !== "end" && guard < 600; guard++) {
    if (scene === "town") {
      const a = await routeTownArrival(G, params);
      params = undefined;
      const st = camp();
      ex(st.vars[V_MAGE] === (v.mage ? 1 : undefined) && st.vars[V_FEMALE] === (v.female ? 1 : undefined), `vars[776]/[781] = herói (${st.vars[V_MAGE]}/${st.vars[V_FEMALE]})`);
      ex(stageOf(st) === expectedStage(st.log), `estágio ${stageOf(st)} = 10 + 10 × principais (${st.log})`);
      ex(new Set(st.locations.map(l => l.join(":"))).size === st.locations.length, "lista de locais sem duplicatas");
      ex(availableMissions(st).every(m => D.missions[String(m)] && !isDone(st, m)), `locais disponíveis válidos e não concluídos (${availableMissions(st)})`);
      if (failCheck) {
        ex(slim() === failCheck.slim, `derrota: campanha inalterada (${diffPaths(JSON.parse(failCheck.slim), JSON.parse(slim())).join(" | ")})`);
        ex(g.state.hero!.gold === failCheck.gold && (g.state.hero!.exp ?? 0) === failCheck.exp, "derrota: herói volta ao da entrada (ouro/XP)");
        ex(g.video.played.length === failCheck.videos, "derrota: nenhum vídeo");
        const wantScene = availableTowns(st).includes(st.lastTown) ? "town" : availableTowns(st).length ? "globalmap" : "mission";
        ex(a.route.scene === wantScene, `derrota: destino ${JSON.stringify(a.route)} (esperado ${wantScene})`);
        failCheck = undefined;
      }
      if (last) {                                            // vitória aplicada pela cidade
        const m = last.id;
        ex(a.ctx.outcomes.length === 1 && a.ctx.outcomes[0].completed, `missão ${m}: aplicada uma vez pela cidade`);
        ex(isDone(st, m) && getVar(st, V_DONE + m) === 1 && !availableMissions(st).includes(m), `missão ${m}: vars[${V_DONE + m}]=1 e fora do mapa`);
        ex(st.log[st.log.length - 1] === m && st.log.length === last.log.length + 1, `missão ${m}: no fim do log`);
        ex(stageOf(st) === last.stage + (m % 10 === 0 ? 10 : 0), `missão ${m}: estágio ${last.stage} -> ${stageOf(st)}`);
        ex(hiredMercs(st).length === 0, `missão ${m}: contratos zerados`);
        const want = expectedVideos(st.log, o.ending).slice(expectedVideos(last.log, o.ending).length);
        ex(stable(g.video.played.slice(last.videos)) === stable(want), `missão ${m}: vídeos ${g.video.played.slice(last.videos)} (esperado ${want})`);
        if (m === 20) ex(getVar(st, 772) === 1 && availableMissions(st).includes(21) && availableTowns(st)[0] === 2, "20: passou pelo bom bandido -> vars[772]=1, 21 e Kaarg no mapa");
        if (m === 50) ex(getVar(st, 780) === 1 && availableMissions(st).includes(52) && availableTowns(st).includes(3), "50: vars[780]=1, 52 e o acampamento druida");
        if (m === 110) ex(getVar(st, 779) === o.ending, `110: vars[779]=${getVar(st, 779)} (final ${o.ending})`);
        if (m === 40) ex(st.party.includes(23) && getVar(st, V_JOIN) === 23, "40: Dina entra no grupo (vars[773]=23)");
        last = undefined;
      }
      if (a.route.scene === "credits") { scene = "end"; break; }
      if (checkpoint(`chegada (${a.route.scene})`)) continue;
      if (a.route.scene === "mission") { missionId = a.route.mission; scene = "mission"; if (checkpoint("entrada direta na missão")) continue; continue; }
      if (a.route.scene === "globalmap") { scene = "globalmap"; continue; }
      await visitTown(a.route.town);
      if (checkpoint(`taverna/loja de ${a.route.town}`)) continue;
      if (a.route.town === 1 && !getVar(camp(), V_M10_TAKEN)) {
        if (diligent) { ex(false, "Plagat: falar com todos não liberou o portão"); scene = "end"; break; }
        params = { town: 1 }; continue;                       // descuidado: não falou com o mensageiro, volta à taverna
      }
      gate(a.route.town);
      continue;
    }

    if (scene === "globalmap") {
      const ctx = await campaignCtx(G);
      const st = ctx.st;
      const gm = globalMapNodes(st, D);
      for (const l of st.locations) {
        const pos = l[0] === "T" ? D.towns.find(t => t.id === l[1])?.mapPos : D.missions[String(l[1])]?.mapPos;
        if (pos?.map === gm.map) ex(gm.nodes.some(n => n.id === l[1] && n.kind === (l[0] === "T" ? "town" : "mission") && !n.done), `mapa ${gm.map}: ${l.join(":")} aparece`);
      }
      ex(gm.nodes.filter(n => n.done).every(n => isDone(st, n.id)), "mapa: cruzes só nas concluídas");
      const need = availableTowns(st).filter(t => g.state.progress.flags[`e2e_visit_${t}`] !== st.log.length + 1);
      if (need.length) { scene = "town"; params = { town: need[0] }; continue; }          // visita cada cidade disponível antes de partir
      const ms = gm.nodes.filter(n => n.kind === "mission" && !n.done).map(n => n.id).sort((a, b) => a - b);
      if (!ms.length) {
        if (!diligent && availableTowns(st).length) { scene = "town"; params = { town: availableTowns(st)[0] }; continue; }   // sem missão: volta à taverna
        ex(false, `mapa sem missão em ${stages()} (log ${st.log})`); scene = "end"; break;
      }
      missionId = diligent ? ms[0] : ms[Math.floor(rnd() * ms.length)];
      enterLocation(st, ["M", missionId]); syncLegacy(g.state.progress, D); g.state.autosave(`entrando na missão ${missionId}`);
      ex(st.current?.[0] === "M" && st.current[1] === missionId, "mapa: entrou na missão escolhida");
      if (checkpoint(`missão ${missionId} escolhida`)) continue;
      scene = "mission";
      continue;
    }

    if (scene === "mission") {
      const st = camp();
      const m = missionId;
      ex(availableMissions(st).includes(m), `missão ${m} está disponível ao entrar (${availableMissions(st)})`);
      const def = D.missions[String(m)];
      if (m % 10 === 0) {
        // principais: estágio = id, exceto o bloco livre 50/60/70/80 (notes/campaign.md: 50 e 60 após a 40; 70 só depois da 50; 80 só depois da 60)
        if (m >= 50 && m <= 80) ex(stageOf(st) >= 50 && stageOf(st) <= 80, `principal ${m} no bloco livre (estágio ${stageOf(st)})`);
        else ex(stageOf(st) === m, `principal ${m} só no estágio ${m} (estágio ${stageOf(st)})`);
        const need: Record<number, number> = { 20: 10, 30: 20, 40: 30, 50: 40, 60: 40, 70: 50, 80: 60 };
        if (need[m]) ex(isDone(st, need[m]), `principal ${m} exige a ${need[m]} concluída`);
        if (m >= 90) ex([50, 60, 70, 80].every(x => isDone(st, x)) && stageOf(st) === m, `principal ${m} exige o bloco 50-80 inteiro`);
      } else ex(stageOf(st) >= Math.min(...def.stagesOffered), `missão ${m}: estágio ${stageOf(st)} ≥ primeiro estágio de oferta ${Math.min(...def.stagesOffered)}`);
      const failNow = o.failAt.includes(m) && !g.state.progress.flags[`e2e_failed_${m}`];
      if (failNow) g.state.progress.flags[`e2e_failed_${m}`] = 1;
      const before = { slim: slim(), gold: g.state.hero!.gold, exp: g.state.hero!.exp ?? 0, videos: g.video.played.length };
      const logBefore = [...st.log], stageBefore = stageOf(st), hiredBefore = hiredMercs(st);
      const res = await pilotMission(g, m, { ending: o.ending, fail: failNow });
      // o grupo que o motor manda tem de aparecer no mundo da missão
      ex(res.party.companionUnits.length === res.party.companions.length, `missão ${m}: companheiros ${res.party.companions} no mundo (${res.party.companionUnits})`);
      ex(res.party.mercUnits === res.party.mercs, `missão ${m}: ${res.party.mercs} mercenário(s) contratado(s), ${res.party.mercUnits} no mundo`);
      ex((diligent ? res.party.companions.includes(22) === (stageOf(st) >= 30) : (!res.party.companions.includes(22) || stageOf(st) >= 30) && (!isDone(st, 30) || res.party.companions.includes(22))), `missão ${m}: Igles ${res.party.companions.includes(22) ? "no" : "fora do"} grupo`);
      ex(res.party.companions.includes(23) === isDone(st, 40), `missão ${m}: Dina ${res.party.companions.includes(23) ? "no" : "fora do"} grupo (40 ${isDone(st, 40) ? "feita" : "pendente"})`);
      ex(hiredBefore.length === res.party.mercs, `missão ${m}: contratados ${hiredBefore} = mercenários da missão`);
      if (failNow) {
        ex(res.outcome === "fail" && res.cause === 2, `missão ${m}: derrota (causa ${res.cause})`);
        failCheck = before;
        params = applyMissionResult(g, res);
        scene = "town";
        continue;
      }
      ex(res.outcome === "complete", `missão ${m}: vitória do piloto ${res.mode} (${res.outcome}, causa ${res.cause}, ${res.ticks} tiques)`);
      if (res.outcome !== "complete") { scene = "end"; break; }
      if (res.mode === "real") real++; else forced++;
      if (res.party.companions.includes(22)) withIgles++;
      if (res.party.companions.includes(23)) withDina++;
      if (res.party.mercs) withMercs++;
      maxMercs = Math.max(maxMercs, res.party.mercs);
      goldExp += res.gold; expExp += res.exp;
      params = applyMissionResult(g, res);
      ex(camp().queue.length === 1 && camp().queue[0].id === m && !isDone(camp(), m), `missão ${m}: vitória na fila, ainda não aplicada`);
      ex(g.state.hero!.gold === goldExp && (g.state.hero!.exp ?? 0) === expExp, `missão ${m}: ouro ${g.state.hero!.gold}/${goldExp} e XP ${g.state.hero!.exp}/${expExp} no herói`);
      last = { id: m, log: logBefore, stage: stageBefore, hiredBefore, videos: g.video.played.length };
      scene = "town";
      if (checkpoint(`vitória na ${m} (fila)`)) continue;
      continue;
    }
  }

  // ---------------------------------------------------------------- fim: estágio 120, vídeo final, hall da fama
  const st = camp();
  ex(scene === "end" && stageOf(st) === FINAL_STAGE, `fim no estágio 120 (${stages()}, log ${st.log.length})`);
  let fame: Report["fame"];
  if (stageOf(st) === FINAL_STAGE) {
    ex(st.log[st.log.length - 1] === 110, "a última missão é a 110");
    const vids = g.video.played;
    ex(stable(vids) === stable(expectedVideos(st.log, o.ending)), `vídeos tocados: ${vids} (esperado ${expectedVideos(st.log, o.ending)})`);
    ex(vids[vids.length - 1] === (o.ending ? "druids" : "knights"), "o vídeo final é o do final escolhido");
    ex(stable([...st.videos].sort()) === stable(vids.map(n => VIDEO_ID[n]).sort()), `galeria da campanha: vídeos vistos ${st.videos}`);
    const gal = unlockedCutscenes(G).map(c => c.id);
    ex(["intro", ...vids].every(n => gal.includes(n)) && gal.length === 1 + vids.length, `galeria "Cut Scenes": ${gal}`);
    ex(vids.every(n => (readMask() >> VIDEO_ID[n]) & 1) && Number(browserStorage("allods2web.cutscenes")) === readMask(), "galeria global (registro do original) com os bits dos vídeos");
    // CreditsScene.fameHall: registra o herói uma vez e marca `ended`
    const first = !st.ended;
    ex(first, "hall da fama: ainda não registrado");
    const r = addToFameHall(g.state.hero!.name, hallXp(g.state.hero!), hallStatsOf(st));
    st.ended = true; g.state.save();
    fame = { rank: r.rank, score: r.list.length };
    ex(r.list.length === 10, "hall da fama com 10 lugares");
    ex(hallStatsOf(st).seconds > 0 && !hallStatsOf(st).estimated, `hall: tempo/abates gravados pelas missões (${JSON.stringify(st.hall)})`);
    checkpoint("fim (hall da fama gravado)");
    const again = await routeTownArrival(G, undefined);
    ex(again.route.scene === "credits", "carregar o save do fim leva aos créditos de novo");
    ex(camp().ended === true, "campaign.ended persistiu");
  }
  const rep = finish();
  if (stageOf(st) === FINAL_STAGE && diligent) {
    // "Continue": um GameState novo carrega o save mais recente e fica igual; "New Game" depois de terminar começa do zero
    const cont = new GameState(new SaveManager(g.storage));
    ex(cont.hasSave() && cont.load() && stable(persisted(cont)) === stable(persisted(g.state)), `Continue carrega o último save (fim) igual: ${diffPaths(persisted(g.state), persisted(cont)).join(" | ")}`);
    const other = E2E_VARIANTS[(E2E_VARIANTS.indexOf(v) + 1) % 4];
    await createCharacter(g, other);
    const fresh = await routeTownArrival(G, undefined);
    const c2 = camp();
    ex(fresh.route.scene === "town" && stageOf(c2) === 10 && c2.log.length === 0 && c2.videos.length === 0 && stable(c2.locations) === '[["T",1]]' && !c2.ended && !c2.hall, `novo jogo depois do fim: campanha zerada (${JSON.stringify(fresh.route)}, estágio ${stageOf(c2)})`);
    ex(c2.vars[V_MAGE] === (other.mage ? 1 : undefined) && c2.vars[V_FEMALE] === (other.female ? 1 : undefined), "novo jogo: vars[776]/[781] do novo herói");
  }
  rep.checks = checks;
  return rep;

  /** Resumo da partida (antes do teste de "novo jogo", que troca o herói). */
  function finish(): Report {
    ex(g.state.hero!.gold === goldExp && (g.state.hero!.exp ?? 0) === expExp, `ouro/XP finais ${g.state.hero!.gold}/${g.state.hero!.exp} = ${goldExp}/${expExp}`);
    ex(bought.every(id => g.state.hero!.inventory.some(i => i.id === id)), `itens comprados continuam no inventário (${bought.length})`);
    const fin = camp();
    return {
      label: o.label, hero: v.label, problems, checks, log: [...fin.log], videos: [...g.video.played], real, forced, points, reloads,
      sig: stable({ hero: g.state.hero, progress: g.state.progress, videos: g.video.played }), fame,
      gallery: unlockedCutscenes(G).map(c => c.id), missions: fin.log.length, withIgles, withDina, withMercs, maxMercs, bought: bought.length,
    };
  }
}

// ------------------------------------------------------------------ mid-mission: snapshot da missão 10 -> save em slot -> load -> termina igual
async function midMissionResume(): Promise<void> {
  console.log("\n[E2E-C2. salvar no meio da missão 10 e retomar]");
  resetBrowserStorage();
  const g = makeGame(); const G = asGame(g);
  await createCharacter(g, E2E_VARIANTS[0]);
  const arrival = await routeTownArrival(G, undefined);
  const ctx = await campaignCtx(G);
  const patrons = innPatrons(ctx.st, D, 1);
  for (const p of patrons) if (p.kind === 0 || p.kind === 3) talkTo(ctx.st, D, p);
  leaveTown(ctx.st, 1); enterLocation(ctx.st, ["M", 10]); syncLegacy(g.state.progress, D);
  check(arrival.route.scene === "town", "novo jogo cai na cidade de Plagat");
  const A = await buildMissionRun(g, 10);
  const stepA = walkToSkrakan(A.r);
  run(A.r, 400, stepA);
  check(!A.r.outcome && A.r.b.hero.alive, "aos 20 s a 10 ainda está em andamento");
  const snap = snapshotMission(10, A.r.b, { objectives: [...A.r.subs], messages: [...A.r.messages], elapsedMs: 400 * 50, cam: { x: 0, y: 0 }, zoom: 1 });
  const w = g.state.saveToSlot(4, "no meio da 10", snap, "Great Mage Skrakan");
  check(w.ok, "save de missão num slot");
  const rawSlot = g.storage.getItem("allods2web.slot.4") ?? "";
  const loaded = new GameState(new SaveManager(g.storage));
  const target = loaded.loadFromSlot(4);
  check(target?.scene === "mission" && (target.params as { id: number; resume: boolean }).id === 10 && (target.params as { resume: boolean }).resume === true, `load do slot -> missão 10 com resume (${JSON.stringify(target)})`);
  check(stable(loaded.progress.campaign) === stable(g.state.progress.campaign), "campanha do save de missão idêntica (current = missão 10)");
  const m = loaded.takeMissionResume(10);
  check(!!m && loaded.takeMissionResume(10) === undefined && rawSlot.length > 1000, "takeMissionResume entrega o snapshot uma vez");
  const g2 = { state: loaded };
  const B = await buildMissionRun(g2 as never, 10);
  restoreMission(B.r.b, JSON.parse(JSON.stringify(m)) as MissionSnapshot);
  B.r.subs = new Map(A.r.subs); B.r.ticks = 0;
  const stepB = walkToSkrakan(B.r);
  const ta = run(A.r, 20 * 60 * 6, stepA), tb = run(B.r, 20 * 60 * 6, stepB);
  check(A.r.outcome?.ok === true && B.r.outcome?.ok === true, `as duas terminam em vitória (${JSON.stringify(A.r.outcome)} / ${JSON.stringify(B.r.outcome)})`);
  check(ta === tb, `mesmo número de tiques até a vitória depois do ponto de save (${ta} / ${tb})`);
  check(Math.abs(A.r.b.hero.x - B.r.b.hero.x) < 1e-6 && Math.abs(A.r.b.hero.y - B.r.b.hero.y) < 1e-6 && Math.ceil(A.r.b.hero.hp) === Math.ceil(B.r.b.hero.hp), "herói no mesmo lugar e vida");
  check(stable([...A.r.b.host.scenarioVars]) === stable([...B.r.b.host.scenarioVars]), "variáveis de cenário iguais ao fim");
}

// ------------------------------------------------------------------ principal
function report(rp: Report): void {
  const tag = `${rp.label}: ${rp.missions} missões (${rp.real} reais + ${rp.forced} forçadas), ${rp.checks} verificações, ${rp.points} pontos de save${rp.reloads ? ` (${rp.reloads} recarregados)` : ""}`;
  check(rp.problems.length === 0, tag + (rp.problems.length ? `\n      ${rp.problems.join("\n      ")}` : ""));
}

console.log("\n[E2E-A. campanha inteira por herói (novo jogo -> criação -> cidade -> taverna/loja -> mapa -> missões -> 110 -> hall da fama)]");
const reports: Record<string, Report> = {};
const t0 = Date.now();
for (const v of E2E_VARIANTS) {
  const rp = await playthrough(v, { label: `${v.label} (final druidas)`, ending: 1, reload: false, failAt: [10, 30] });
  reports[v.id] = rp;
  report(rp);
  const canon = D.validation?.canonical?.[v.id];
  check(!!canon && stable(rp.log) === stable(canon.order), `${v.label}: ordem das missões = ordem canônica do original (${rp.log.join(",")})`);
  console.log(`      vídeos: ${rp.videos.join(" > ")}; galeria: ${rp.gallery.join(",")}; hall: posição ${rp.fame?.rank}
      grupo: Igles em ${rp.withIgles}, Dina em ${rp.withDina}, mercenários em ${rp.withMercs} missões (até ${rp.maxMercs}); ${rp.bought} compras`);
}
console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

{
  const all = new Set<number>();
  for (const rp of Object.values(reports)) rp.log.forEach(m => all.add(m));
  const ids = Object.keys(D.missions).map(Number);
  check(ids.length === 46 && ids.every(m => all.has(m)), `as 46 missões foram jogadas pelas 4 partidas (${all.size}); faltam: ${ids.filter(m => !all.has(m))}`);
  const has = (id: string, m: number) => reports[id].log.includes(m);
  check(has("male_mage", 81) && has("female_mage", 81) && !has("male_fighter", 81) && !has("female_fighter", 81) && has("male_fighter", 82) && has("female_fighter", 82) && !has("male_mage", 82), "81 só mago, 82 só guerreiro");
  check(has("male_fighter", 74) && has("female_fighter", 75) && has("female_mage", 76) && has("male_mage", 77), "Talena: guerreiro 74, guerreira 75, maga 76, mago 77");
}

{
  console.log("\n[E2E-A2. final alternativo (cavaleiros) e dificuldade de caminho]");
  const rp = await playthrough(E2E_VARIANTS[0], { label: "guerreiro (final cavaleiros)", ending: 0, reload: false, failAt: [] });
  report(rp);
  check(rp.videos[rp.videos.length - 1] === "knights" && rp.gallery.includes("knights") && !rp.gallery.includes("druids"), `vídeo final knights; galeria ${rp.gallery}`);
}

{
  console.log("\n[E2E-A3. jogador descuidado: fala com parte do povo, contrata ao acaso, escolhe missões ao acaso, volta à taverna quando trava]");
  const N = QUICK ? 2 : 6;
  let ok = 0, runs = 0, bad: string[] = [];
  const reached = new Set<number>();
  for (const v of E2E_VARIANTS) {
    for (let seed = 1; seed <= N; seed++) {
      const rp = await playthrough(v, { label: `${v.label} descuidado #${seed}`, ending: seed % 2 as 0 | 1, reload: false, failAt: [], sloppy: seed * 7919 + 13 });
      runs++;
      rp.log.forEach(m => reached.add(m));
      if (rp.problems.length === 0) ok++; else bad.push(`${rp.label}: ${rp.problems.slice(0, 3).join(" | ")}`);
    }
  }
  check(ok === runs, `${runs} partidas descuidadas terminam no estágio 120 sem violar nenhuma regra (${ok}/${runs})${bad.slice(0, 4).map(b => "\n      " + b).join("")}`);
  check(reached.size >= (QUICK ? 30 : 40), `as partidas descuidadas alcançam ${reached.size} das 46 missões`);
}

if (!QUICK) {
  console.log("\n[E2E-B. a mesma partida recarregando o save em CADA ponto de salvamento = resultado idêntico]");
  const t1 = Date.now();
  for (const v of E2E_VARIANTS) {
    const rp = await playthrough(v, { label: `${v.label} recarregando`, ending: 1, reload: true, failAt: [10, 30] });
    report(rp);
    const a = reports[v.id];
    const same = rp.sig === a.sig;
    check(same && stable(rp.log) === stable(a.log) && stable(rp.videos) === stable(a.videos),
      `${v.label}: herói+campanha+vídeos finais idênticos aos da partida direta${same ? "" : " — " + diffPaths(JSON.parse(a.sig), JSON.parse(rp.sig)).join(" | ")}`);
  }
  console.log(`  (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
}

await midMissionResume();

proc.exitCode = summary();
