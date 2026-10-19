/**
 * Testes do SaveManager / GameState (core/save.ts, core/savedata.ts, core/state.ts) sem navegador. Rodar em game/:
 *   npx tsx src/sim/test/savemanager.ts
 * Casos: migração do save v1, slots (gravar/listar/ler/apagar), autosave, índice perdido/corrompido, JSON corrompido nos slots,
 * cota cheia, exportar/importar, save de missão (location + snapshot), versão futura.
 */
import { GameState, type HeroState } from "../../core/state";
import { AUTOSAVE_SLOT, INDEX_KEY, LEGACY_KEY, SLOT_COUNT, SLOT_PREFIX, SaveManager, memoryStorage, type StorageLike } from "../../core/save";
import { DEFAULT_SETTINGS, migrateSaveData } from "../../core/savedata";

interface NodeProc { exitCode?: number; }
const proc = (globalThis as unknown as { process: NodeProc }).process;

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}
function noThrow(fn: () => void, msg: string): void {
  try { fn(); check(true, msg); } catch (e) { check(false, `${msg} (lançou ${(e as Error).message})`); }
}

const hero = (name = "Igles"): HeroState => ({
  name, sex: "male", heroClass: "fighter", face: 32, stats: { body: 52, mind: 20, agility: 45, spirit: 25 }, weaponSkill: "blade",
  gold: 300, inventory: [{ id: "260" }], equipment: { weapon: "4104" }, spells: [], difficulty: "normal",
});

console.log("\n[migração v1]");
{
  const st = memoryStorage();
  const v1 = { version: 1, hero: { ...hero("Velho"), gold: 777 }, progress: { town: "plagat", completedMissions: [10], availableMissions: [20], flags: { accepted_10: 1 } },
    settings: { musicVolume: 0.3, sfxVolume: 0.4, speechVolume: 0.5 } };
  st.setItem(LEGACY_KEY, JSON.stringify(v1));
  const gs = new GameState(new SaveManager(st));
  check(gs.settings.musicVolume === 0.3 && gs.settings.gameSpeed === DEFAULT_SETTINGS.gameSpeed, "opções herdadas do v1 + padrões novos");
  check(gs.hasSave(), "hasSave() vê o save v1");
  const list = gs.saves.list();
  check(list.length === SLOT_COUNT + 1 && list[AUTOSAVE_SLOT]?.hero === "Velho", "v1 virou o Autosave (slot 0)");
  check(gs.load() && gs.hero?.name === "Velho" && gs.hero.gold === 777 && gs.progress.completedMissions[0] === 10, "load() carrega o v1 migrado");
  check(st.getItem(LEGACY_KEY) !== null, "chave v1 preservada");
  const gs2 = new GameState(new SaveManager(st));
  gs2.saves.list();
  check(gs2.saves.list().filter(Boolean).length === 1, "migração acontece uma vez só");
  // v1 incompleto/estranho
  const d = migrateSaveData({ version: 1, hero: { name: "X", gold: "muito", inventory: "nada" } });
  check(d && d.hero && d.hero.gold === 0 && Array.isArray(d.hero.inventory) && d.progress.availableMissions[0] === 10 && d.location.scene === "town", "v1 com campos inválidos é saneado");
  check(migrateSaveData({ version: 99, hero: hero() }) === null, "versão futura é recusada");
  check(migrateSaveData("{oops") === null && migrateSaveData(null) === null && migrateSaveData([1, 2]) === null, "lixo devolve null sem lançar");
}

console.log("\n[slots]");
{
  const st = memoryStorage();
  const gs = new GameState(new SaveManager(st));
  check(!gs.hasSave(), "sem saves no começo");
  gs.newGame(hero());
  check(gs.saves.meta(0)?.name === "Autosave", "newGame grava o Autosave");
  gs.hero!.gold = 1234;
  const r = gs.saveToSlot(3, "  Antes da torre  ");
  check(r.ok && r.meta.name === "Antes da torre" && r.meta.hero === "Igles" && r.meta.place === "Plagat", "save nomeado no slot 3 com metadados");
  gs.hero!.gold = 1;
  gs.progress.flags.x = 5;
  const t = gs.loadFromSlot(3);
  check(t?.scene === "town" && gs.hero!.gold === 1234 && gs.progress.flags.x === undefined, "loadFromSlot restaura o estado");
  check(gs.loadFromSlot(4) === null, "slot vazio devolve null");
  check(gs.saves.firstFreeSlot() === 1, "primeiro slot livre = 1");
  gs.saves.remove(3);
  check(gs.saves.meta(3) === null && st.getItem(SLOT_PREFIX + 3) === null, "apagar slot");
  check(!gs.saves.write(SLOT_COUNT + 1, "x", gs.snapshotData()).ok && !gs.saves.write(-1, "x", gs.snapshotData()).ok, "slot fora da faixa é recusado");
  // latest
  gs.saves.write(5, "velho", gs.snapshotData(), { date: 1000 });
  gs.saves.write(6, "novo", gs.snapshotData(), { date: Date.now() + 100000 });
  check(gs.saves.latest()?.slot === 6, "latest() = mais recente");
}

console.log("\n[corrupção]");
{
  const st = memoryStorage();
  const sm = new SaveManager(st);
  const gs = new GameState(sm);
  gs.newGame(hero());
  gs.saveToSlot(1, "bom");
  gs.saveToSlot(2, "vai quebrar");
  st.setItem(SLOT_PREFIX + 2, "{\"format\":\"allods2web-save\",\"meta\":{");   // JSON truncado
  st.setItem(SLOT_PREFIX + 7, "lixo total");                                  // slot fora do índice
  st.setItem(INDEX_KEY, "não é json");
  const sm2 = new SaveManager(st);
  let list: ReturnType<SaveManager["list"]> = [];
  noThrow(() => { list = sm2.list(); }, "list() com índice e slots corrompidos não lança");
  check(list[1]?.name === "bom" && !list[1]?.damaged, "slot bom continua listado");
  check(list[2]?.damaged === true && list[7]?.damaged === true, "slots corrompidos aparecem como danificados");
  check(sm2.read(2) === null && sm2.read(7) === null, "read() de slot corrompido devolve null");
  const gs2 = new GameState(sm2);
  check(gs2.loadFromSlot(2) === null && gs2.loadFromSlot(1)?.scene === "town", "carregar corrompido falha limpo; o bom carrega");
  check(gs2.load() && gs2.hero?.name === "Igles", "load() ignora danificados");
  // settings corrompidas
  st.setItem("allods2web.settings", "{{{");
  noThrow(() => { const g = new GameState(new SaveManager(st)); check(g.settings.sfxVolume === DEFAULT_SETTINGS.sfxVolume, "opções corrompidas → padrões"); }, "GameState com opções corrompidas não lança");
  // armazenamento que lança em tudo
  const broken: StorageLike = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  noThrow(() => {
    const g = new GameState(new SaveManager(broken));
    g.newGame(hero()); g.save(); g.hasSave(); g.load(); g.saves.list();
    check(!g.saveToSlot(1, "x").ok, "armazenamento quebrado: save falha com erro, sem lançar");
  }, "armazenamento quebrado não derruba o jogo");
}

console.log("\n[cota cheia]");
{
  const base = memoryStorage();
  let limit = Infinity;
  const quota: StorageLike = {
    getItem: k => base.getItem(k),
    removeItem: k => base.removeItem(k),
    setItem: (k, v) => { if (v.length > limit) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; } base.setItem(k, v); },
  };
  const gs = new GameState(new SaveManager(quota));
  gs.newGame(hero());
  limit = 100;
  const r = gs.saveToSlot(1, "grande");
  check(!r.ok && r.error === "quota", "QuotaExceededError vira erro 'quota'");
  check(gs.saves.meta(1) === null, "slot não fica no índice quando a escrita falha");
}

console.log("\n[exportar/importar]");
{
  const gs = new GameState(new SaveManager(memoryStorage()));
  gs.newGame(hero("Exportado"));
  gs.saveToSlot(2, "para exportar");
  const text = gs.saves.exportSlot(2)!;
  check(typeof text === "string" && text.includes("allods2web-save"), "exportSlot gera JSON");
  const other = new GameState(new SaveManager(memoryStorage()));
  const r = other.saves.importText(text, 4);
  check(r.ok && other.saves.meta(4)?.name === "para exportar" && other.loadFromSlot(4) && other.hero?.name === "Exportado", "importText recupera o save");
  const v1 = JSON.stringify({ version: 1, hero: hero("Cru"), progress: { town: "plagat" } });
  check(other.saves.importText(v1, 5).ok && other.saves.meta(5)?.hero === "Cru", "importa um save v1 cru");
  check(!other.saves.importText("isto não é json", 6).ok && !other.saves.importText("{\"a\":1}", 6).ok, "arquivo inválido é recusado");
}

console.log("\n[missão]");
{
  const gs = new GameState(new SaveManager(memoryStorage()));
  gs.newGame(hero());
  const fake = { v: 1 as const, id: 10, world: { tick: 5, nextId: 9, rng: 1, dip: [], money: [], units: [], projectiles: [], loot: [], killsByType: [], occ: [] },
    script: null, host: { scenarioVars: [] }, ui: { objectives: [[2, 1]], messages: [1], elapsedMs: 250, cam: { x: 1, y: 2 }, zoom: 1 } };
  const r = gs.saveToSlot(8, "na torre", fake as never, "Great Mage Skrakan");
  check(r.ok && r.meta.scene === "mission" && r.meta.mission === 10 && r.meta.place.includes("Skrakan"), "save de missão: metadados");
  gs.pendingMission = undefined;
  const t = gs.loadFromSlot(8);
  check(t?.scene === "mission" && (t.params as { id: number; resume: boolean }).id === 10 && (t.params as { resume: boolean }).resume, "carregar devolve a cena de missão com resume");
  check(gs.takeMissionResume(20) === undefined && gs.pendingMission === undefined, "takeMissionResume de outra missão descarta");
  gs.loadFromSlot(8);
  const m = gs.takeMissionResume(10);
  check(m?.world.tick === 5 && m.ui.messages[0] === 1, "takeMissionResume devolve o snapshot");
  check(gs.takeMissionResume(10) === undefined, "e só uma vez");
  gs.loadFromSlot(8);
  gs.loadFromSlot(0);
  check(gs.pendingMission === undefined, "carregar save de cidade limpa a missão pendente");
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
