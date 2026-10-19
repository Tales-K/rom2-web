/**
 * Teste headless do inventário da missão (mission/inventory.ts + setup.refreshHero + save no meio da missão).
 * Rodar em game/:  npx tsx src/mission/inventory_test.ts
 *   - vestir/tirar, duas mãos × escudo, classe, pilhas, peso/sobrecarga, efeitos de poção/pergaminho, dica;
 *   - espelho Unit.items ↔ mochila (saco recolhido pela sim, Give All do script, item removido pelo script);
 *   - recálculo do herói ao vestir (defesa/absorção) e save: herói trocou de arma (outro `kind`) → o restore aceita (a cena
 *     corrige o kind do snapshot) e o herói remontado tem os mesmos atributos.
 */
import { parseScript } from "../script";
import type { HeroState } from "../core/state";
import { buildMission, heroStats, refreshHero, type MissionData } from "./setup";
import { HeroInventory } from "./inventory";
import { restoreMission, snapshotMission, type MissionSnapshot } from "../sim/snapshot";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
function json<T>(rel: string): T | undefined {
  const p = join(PUB, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : undefined;
}

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const ID = 10;
const data: MissionData = {
  id: ID,
  map: json<MissionData["map"]>(`data/maps/${ID}.json`)!,
  objects: json("data/objects.json") ?? {},
  structures: json("data/structures.json") ?? {},
  unitsStatic: json("data/units.json") ?? {},
  anim: json("assets/ui/hud/anim/units.json") ?? {},
  terrain: json("assets/ui/hud/terrain.json"),
  meta: json(`assets/ui/hud/missions/${ID}.json`),
  script: parseScript(json<unknown>(`data/scripts/${ID}.json`)),
  stats: json("data/unit-stats.json"),
  templates: json("data/unit-templates.json"),
  mapTemplates: json<Record<string, { serverId: number; level: number; kind: number }[]>>("data/map-unit-templates.json")?.[String(ID)],
  items: json("data/items.json"),
  spells: json("data/spells.json"),
  classes: json("data/classes.json"),
  texts: json(`data/texts/mission${ID}.json`),
  terrainNames: [],
};

const fighter = (): HeroState => ({
  name: "Teste", sex: "male", heroClass: "fighter", face: 0, stats: { body: 40, mind: 25, agility: 36, spirit: 17 },
  weaponSkill: "blade", gold: 100, inventory: [{ id: "3654", count: 2 }],
  equipment: { weapon: "260", cuirass: "2067" }, spells: [], difficulty: "normal",
});
const noop = { message() {}, subobjective() {}, complete() {}, fail() {}, giveAll() {}, money() {} };

console.log("inventário:");
{
  const h = fighter();
  const inv = new HeroInventory(h, data);
  check(inv.name("3661") === "Valuable Documents" && inv.isQuest("3661"), "documentos de Skrakan = item de missão 3661");
  inv.add("3654");
  check(h.inventory.length === 1 && h.inventory[0]!.count === 3, "itens iguais empilham");
  inv.add("33037");   // cajado (mago)
  check(inv.equipFromPack(h.inventory.findIndex(e => e.id === "33037")) !== "", "guerreiro não veste item de mago");
  // escudo e arma de duas mãos
  const shield = Object.entries(data.items!).find(([, v]) => v.slot === "shield" && (v.usableBy ?? []).includes("fighter"))?.[0];
  const twoH = Object.entries(data.items!).find(([, v]) => v.twoHanded && (v.usableBy ?? []).includes("fighter"))?.[0];
  if (shield && twoH) {
    inv.add(shield);
    check(inv.equipFromPack(h.inventory.findIndex(e => e.id === shield)) === "" && h.equipment.shield === shield, "veste o escudo");
    inv.add(twoH);
    inv.equipFromPack(h.inventory.findIndex(e => e.id === twoH));
    check(h.equipment.weapon === twoH && !h.equipment.shield && h.inventory.some(e => e.id === shield) && h.inventory.some(e => e.id === "260"),
      "arma de duas mãos: escudo e arma antiga voltam para a mochila");
  }
  const w0 = inv.weight();
  inv.add("2067", 40);
  check(inv.weight() === w0 + 40 * Number(data.items!["2067"]!.weight), "peso conta mochila × quantidade");
  check(inv.overloaded(), "sobrecarga com 40 couraças");
  const base = heroStats(fighter(), data).speed;
  check(heroStats(h, data).speed < base, "sobrecarga reduz a velocidade (heroDerived)");
  check(inv.useEffect("3654")?.health === 30 && inv.useEffect("3657")?.mana === 30, "poções de cura/mana");
  check(inv.useEffect("3648")?.timed?.kind === "absorption" && inv.useEffect("3648")?.timed?.seconds === 30, "antídoto: absorção +50 por 30 s");
  check(inv.useEffect("3649")?.attrs?.body === 1, "poção de Body +1");
  check(inv.useEffect("3590")?.scroll?.spell === 1, "pergaminho de Fire Arrow");
  check(inv.describe("260").lines.some(l => /^Damage 6-11/.test(l)) && inv.describe("260").lines.includes("Weight 20"), "dica com dano e peso");
  check(!inv.describe("33037").usable, "dica marca item que a classe não usa");
}

console.log("espelho Unit.items ↔ mochila:");
{
  const h = fighter();
  const b = buildMission(data, h, noop);
  const inv = new HeroInventory(h, data);
  b.hero.items = inv.mirror();
  inv.markSynced(b.hero.items);
  check(b.hero.items.length === 4, "espelho = 2 poções + 2 vestidos");
  // saco no chão recolhido pela sim
  b.world.loot.push({ id: 9999, x: b.hero.cx, y: b.hero.cy, gold: 7, items: ["3657"] });
  (b.world as unknown as { pickupAt(u: unknown): void }).pickupAt(b.hero);
  let r = inv.absorb(b.hero.items); b.hero.items = r.mirror;
  check(r.added.join() === "3657" && h.inventory.some(e => e.id === "3657") && b.hero.gold === 7, "saco recolhido vai para a mochila (ouro no herói da sim)");
  // Give All do script (Skrakan → herói)
  const sk = b.world.units.find(u => u.items.includes("3661"));
  check(!!sk, "Skrakan carrega os documentos (bags do mapa)");
  if (sk) {
    b.host.giveAll(sk.scriptId, b.hero.scriptId);
    r = inv.absorb(b.hero.items); b.hero.items = r.mirror;
    check(h.inventory.some(e => e.id === "3661") && b.host.unitHasItem(b.hero.scriptId, 3661), "Give All: documentos na mochila e o script vê");
  }
  b.host.removeItem(b.hero.scriptId, 3654);
  r = inv.absorb(b.hero.items); b.hero.items = r.mirror;
  check(!h.inventory.some(e => e.id === "3654"), "item removido pelo script sai da mochila");
  // recálculo ao vestir
  const d0 = b.hero.stats.defense, a0 = b.hero.stats.absorption;
  const helm = Object.entries(data.items!).find(([, v]) => v.slot === "helm" && (v.usableBy ?? []).includes("fighter") && (v.defense ?? 0) > 0)?.[0];
  if (helm) {
    inv.add(helm); inv.equipFromPack(h.inventory.findIndex(e => e.id === helm));
    refreshHero(b.hero, h, data);
    check(b.hero.stats.defense === d0 + Number(data.items![helm]!.defense ?? 0) && b.hero.stats.absorption >= a0, "elmo soma defesa no herói em jogo");
  }
}

console.log("save no meio da missão com troca de arma:");
{
  const h = fighter();
  const b = buildMission(data, h, noop);
  for (let i = 0; i < 100; i++) b.world.step();
  const inv = new HeroInventory(h, data);
  const axe = Object.entries(data.items!).find(([, v]) => v.slot === "weapon" && v.attackType === "axe" && !v.twoHanded && (v.usableBy ?? []).includes("fighter"))?.[0];
  inv.add(axe!); inv.equipFromPack(h.inventory.findIndex(e => e.id === axe));
  refreshHero(b.hero, h, data);
  b.hero.items = inv.mirror();
  const snap = JSON.parse(JSON.stringify(snapshotMission(ID, b, { objectives: [], messages: [], elapsedMs: 0, cam: { x: 0, y: 0 }, zoom: 1 }))) as MissionSnapshot;
  const saved = JSON.parse(JSON.stringify(h)) as HeroState;
  const c = buildMission(data, saved, noop);
  check(c.hero.kind !== b.hero.kind, `sprite do herói muda com a arma no próximo build (${b.hero.kind} → ${c.hero.kind})`);
  const hs = snap.world.units.find(u => u.id === c.hero.id);
  if (hs && hs.kind !== c.hero.kind) hs.kind = c.hero.kind;   // o que MissionScene.applyResume faz
  let ok = true;
  try { restoreMission(c, snap); } catch (e) { ok = false; console.log("   ", e); }
  check(ok, "restore aceita o herói com outra arma");
  check(JSON.stringify(c.hero.stats) === JSON.stringify(b.hero.stats) && c.hero.hp === b.hero.hp && c.hero.items.join() === b.hero.items.join(),
    "herói remontado = herói salvo (atributos, vida, itens)");
}

console.log(`\n${passes} ok, ${failures} falhas`);
if (failures) proc.exitCode = 1;
