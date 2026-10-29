/**
 * Testes da frente MAGIA-RE (sim/necro.ts, sim/spellattack.ts): corpos, Animate Dead, Summon, Heal em quem está morrendo e ataque com a
 * magia escolhida — gabarito = allods2.exe + medições no original rodando (notes/magic-original.md). `npx tsx src/sim/test/necro.ts`
 */
import { Grid } from "../grid";
import { World, type Unit, type UnitInit } from "../world";
import { fromTemplate, genericStats, heroDerived, type TemplateJson } from "../stats";
import { SPELL, type SpellTable } from "../spells";
import { installMissionAi, setAutocastLevel } from "../behaviors";
import { CORPSE, corpseStage, summonLevel, summonTemplateName } from "../necro";
import { restoreWorld, snapshotWorld } from "../snapshot";
import type { SimEvent } from "../types";

import { TICKS_PER_SEC } from "../types";
type NodeProc = { getBuiltinModule(m: string): unknown; exitCode?: number };
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { readFileSync } = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(PUB, rel), "utf8")) as T;

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const templates = json<Record<string, TemplateJson & { template?: string }>>("data/unit-templates.json");
const spells = json<SpellTable>("data/spells.json");
const TIMING = { attackTicks: 12, hitTick: 6, attackDelay: 4, dyingTicks: 14 };
const sec = (s: number) => Math.round(s * TICKS_PER_SEC);

const byName = new Map<string, string>();
for (const id of Object.keys(templates).sort((a, b) => Number(a) - Number(b))) {
  const n = templates[id]!.template;
  if (n && !byName.has(n)) byName.set(n, id);
}
function initOf(id: string, player: number, x: number, y: number): UnitInit {
  const t = templates[id]!;
  return { kind: String(t.typeId), typeId: Number(t.typeId), player, x, y, stats: fromTemplate(t, genericStats(String(t.name)), false), timing: TIMING, name: String(t.name) };
}
function makeWorld(seed = 11): World {
  const g = new Grid(48, 48);
  for (let x = 0; x < 48; x++) { g.block[x] = 8; g.block[47 * 48 + x] = 8; g.block[x * 48] = 8; g.block[x * 48 + 47] = 8; }
  const w = new World(g, 3, seed);
  w.dip[1]![2] = 1; w.dip[2]![1] = 1;
  // fábrica pelo NOME do template (a mesma regra de mission/setup.ts summonFactoryFor)
  w.summonFactory = (c, x, y, _p, name = "Squirrel") => { const id = byName.get(name); return id ? initOf(id, c.player, x, y) : undefined; };
  return w;
}
const mon = (w: World, id: number, player: number, x: number, y: number): Unit => w.spawn(initOf(String(id), player, x, y));
function heroMage(w: World, x: number, y: number, astral = 30): Unit {
  const st = heroDerived("Maga", true, true, { body: 19, reaction: 23, mind: 30, spirit: 42 }, { fire: 20, astral }, 7000, []);
  const h = w.spawn({ kind: "hero_mage", typeId: 0, player: 1, x, y, stats: st, timing: TIMING, isHero: true, name: "Maga" });
  h.heroInfo = { mage: true, alignment: "fire", skillExp: { fire: 6000, astral: Math.ceil((Math.pow(1.1, astral) - 1) * 1000) } };
  return h;
}
function run(w: World, ticks: number, each?: (ev: SimEvent[]) => boolean | void): number {
  for (let i = 0; i < ticks; i++) {
    w.step();
    const stop = each?.(w.events);
    w.events.length = 0;
    if (stop === true) return i + 1;
  }
  return ticks;
}
/** mata `u` deixando a vida em `hp` (≤ 0) */
function killTo(w: World, u: Unit, hp: number): void { w.damage(undefined, u, u.hp - hp); w.step(); w.events.length = 0; }   // a queda sai no tique da própria unidade (máquina 0x50f12c)
function castBy(w: World, h: Unit, id: number, o: { target?: Unit; x?: number; y?: number }): void {
  h.mana = h.maxMana = 5000; h.cooldown = 0;
  w.command(h, { type: "cast", spell: String(id), target: o.target?.id, x: o.x, y: o.y });
  run(w, sec(15), () => h.order.type === "none" && h.state === "idle" && h.rec.ai.sub === 0);   // a ordem em unidade acaba quando a magia começa (0x56e906)
}

// ------------------------------------------------------------------------------------------------ corpos
console.log("\n[corpos] sangria (−1 a cada 4 s) e decomposição (−1 a cada 2 s) [exe 0x50fc5a/0x5110b8; medido no original, refs/trace/d_hp.jsonl]");
{
  const w = makeWorld();
  const a = mon(w, 640, 2, 10, 10);
  killTo(w, a, -3);
  check(corpseStage(a) === 1 && a.corpseHp === -3, `morto com sobra de dano: estado 1 (morrendo), vida do corpo ${a.corpseHp}`);
  const t2 = run(w, sec(40), () => corpseStage(a) >= 2);
  // o 1º ponto sai no próximo laço de 1/s de um segundo múltiplo de 4 (0x52bbb7, tique ≡ 13 mod 64: de 0 a 4 s depois da queda) e os
  // outros 6 a cada 4 s: 24–28 s conforme a fase (no original, medido do meio do ciclo: 28 s)
  check(corpseStage(a) === 2 && t2 > sec(24) && t2 <= sec(28), `cadáver (estado 2) em ${(t2 / TICKS_PER_SEC).toFixed(1)} s (−3 → −10 a 1 ponto / 4 s = 24–28 s; morte consumada e 1º desgaste: −11)`);
  const t3 = run(w, sec(60), () => corpseStage(a) >= 3);
  check(corpseStage(a) === 3 && t3 <= sec(24), `ossos (estado 3) ${(t3 / TICKS_PER_SEC).toFixed(1)} s depois`);
  const t4 = run(w, sec(120), () => corpseStage(a) >= 4);
  check(corpseStage(a) === 4 && Math.abs(t4 - sec(40)) <= sec(3), `pó (estado 4) ${(t4 / TICKS_PER_SEC).toFixed(1)} s depois (−20 → −41 a 1 ponto / 2 s ≈ 40 s)`);
  const t5 = run(w, sec(1300), () => corpseStage(a) >= 5);
  check(corpseStage(a) === 5 && t5 > sec(1100), `some (estado 5) ${(t5 / TICKS_PER_SEC / 60).toFixed(1)} min depois (−41 → −601)`);
  const b = mon(w, 624, 2, 12, 12);   // morcego (voa): some ao morrer
  killTo(w, b, -1);
  run(w, sec(45));   // sangra de −1 a −10 em 36 s
  check(!b.stats.flying || corpseStage(b) === 5, `voador não deixa corpo (estado ${corpseStage(b)}, voa=${!!b.stats.flying})`);
  const h = heroMage(w, 20, 20);
  killTo(w, h, -1);
  run(w, sec(45));
  check(corpseStage(h) === 4 && h.corpseHp <= CORPSE.HERO, `herói morto vai direto a "pó" (vida do corpo ${h.corpseHp}) [exe 0x511010]`);
}

// ------------------------------------------------------------------------------------------------ Animate Dead
console.log("\n[Animate Dead] levanta o corpo da célula como zumbi/esqueleto/fantasma [exe 0x51a91f; conferido no original]");
{
  const w = makeWorld(3);
  const h = heroMage(w, 10, 20, 40);
  installMissionAi(w, { spells, heroSpellIds: [SPELL.AnimateDead, SPELL.Summon, SPELL.Heal, SPELL.FireArrow] });
  setAutocastLevel(w, 0);
  const ad = h.spells.find(s => s.id === String(SPELL.AnimateDead))!;
  check(ad.kind === "raise" && ad.target === "point" && ad.mana === 30, `magia 22 = "raise", alvo no chão, 30 de mana (alcance ${ad.range})`);
  const raise = (stage: number, at: number) => {
    const c = mon(w, 640, 2, at, 20);   // Foot_Animated: vida 30, toHit 0, defesa 30
    killTo(w, c, -1);
    run(w, sec(1));
    c.corpseHp = stage === 2 ? -12 : stage === 3 ? -25 : -45; c.bodyDead = true; c.state = "dead";
    const before = new Set(w.units.map(u => u.id));
    castBy(w, h, SPELL.AnimateDead, { x: c.cx, y: c.cy });
    const n = w.units.find(u => !before.has(u.id));
    return { c, n };
  };
  const z = raise(2, 13);
  check(z.n?.typeId === 82 && z.n.player === 1 && z.n.maxHp === 30 && z.n.hp === 30, `zumbi (F_Zombie.1, tipo 82) do jogador 1 com a vida máx. do corpo (${z.n?.maxHp}/${z.c.maxHp})`);
  check(z.n?.stats.defense === 15 && z.n.stats.attack === 0, `defesa = metade da do corpo (${z.n?.stats.defense}) e toHit copiado (${z.n?.stats.attack}) — original: 15 e 0`);
  check(z.n?.ai.type === "hold" && z.n.dynamic && !z.n.summoner && !z.n.buffs.length, "Stand Ground, sem duração e sem vínculo com quem lançou");
  check(corpseStage(z.c) === 5, "o corpo some (consumido)");
  const s = raise(3, 15);
  check(s.n?.typeId === 89 && s.n.maxHp === 15, `esqueleto (F_Skeleton.1, tipo 89) com metade da vida (${s.n?.maxHp}) — original: 15`);
  const g = raise(4, 17);
  check(g.n?.typeId === 69 && g.n.maxHp === 15, `fantasma (Ghost, tipo 69) com metade da vida (${g.n?.maxHp}) — original: 15`);
  // morto-vivo não se levanta de novo
  killTo(w, s.n!, -1); run(w, sec(1)); s.n!.corpseHp = -25; s.n!.bodyDead = true; s.n!.state = "dead";
  const before = w.units.length;
  castBy(w, h, SPELL.AnimateDead, { x: s.n!.cx, y: s.n!.cy });
  check(w.units.length === before, "corpo de esqueleto (tipo 82..98) não se levanta [exe 0x51a9a4]");
  // prioridade: estado 2 antes do 3 na mesma célula
  const p3 = mon(w, 640, 2, 25, 25), p2 = mon(w, 608, 2, 26, 25);
  killTo(w, p3, -1); killTo(w, p2, -1); run(w, sec(1));
  p2.cx = 25; p2.x = 25.5;
  p3.corpseHp = -25; p2.corpseHp = -12; p3.bodyDead = p2.bodyDead = true; p3.state = p2.state = "dead";
  const ids = new Set(w.units.map(u => u.id));
  castBy(w, h, SPELL.AnimateDead, { x: 25, y: 25 });
  const n2 = w.units.find(u => !ids.has(u.id));
  check(n2?.typeId === 82 && corpseStage(p2) === 5 && corpseStage(p3) === 3,
    `na mesma célula o cadáver (estado 2) vem antes dos ossos (estado 3) (novo ${n2?.typeId}, estados ${corpseStage(p2)}/${corpseStage(p3)}, herói ${h.cx},${h.cy} mana ${h.mana})`);
  // corpo ainda "morrendo" (estado 1) não serve
  const d = mon(w, 640, 2, 30, 30);
  w.teleport(h, 28, 30);
  killTo(w, d, -1);
  const ids2 = new Set(w.units.map(u => u.id));
  castBy(w, h, SPELL.AnimateDead, { x: 30, y: 30 });
  check(!w.units.some(u => !ids2.has(u.id)), "corpo ainda morrendo (estado 1) não se levanta");
  // invocada/levantada não dá experiência ao ser ferida
  const foe = mon(w, 640, 2, 12, 22);
  foe.dynamic = true;
  const exp0 = h.exp;
  castBy(w, h, SPELL.FireArrow, { target: foe });
  run(w, sec(2));
  check(h.exp === exp0, `ferir unidade invocada/levantada não dá experiência (${h.exp - exp0}) [exe 0x512900]`);
}

// ------------------------------------------------------------------------------------------------ Summon
console.log("\n[Summon] Squirrel/Turtle/Foot_Animated, nível Astral÷25+1, sem duração, desgaste (N−1)%/s [exe 0x51a595/0x52bbb7]");
{
  check(summonTemplateName(0, 1) === "Squirrel" && summonTemplateName(1, 3) === "Turtle.3" && summonTemplateName(2, 4) === "Foot_Animated.4", "nomes dos templates");
  const w = makeWorld(5);
  const hA = heroMage(w, 5, 5, 10), hB = heroMage(w, 5, 8, 30), hC = heroMage(w, 5, 11, 90);
  check(summonLevel(hA) === 1 && summonLevel(hB) === 2 && summonLevel(hC) === 4, `nível: Astral 10 → ${summonLevel(hA)}, 30 → ${summonLevel(hB)}, 90 → ${summonLevel(hC)} (máx. 4)`);
  const w2 = makeWorld(6);
  const h = heroMage(w2, 20, 20, 10);
  installMissionAi(w2, { spells, heroSpellIds: [SPELL.Summon] });
  setAutocastLevel(w2, 0);
  const sum = h.spells.find(s => s.id === String(SPELL.Summon))!;
  check(sum.mana === 100 && sum.target === "self", "Summon: 100 de mana, em si");
  const kinds = new Set<number>();
  const made: Unit[] = [];
  for (let i = 0; i < 9; i++) {
    const ids = new Set(w2.units.map(u => u.id));
    castBy(w2, h, SPELL.Summon, { target: h });
    const n = w2.units.find(u => !ids.has(u.id));
    if (n) { kinds.add(n.typeId); made.push(n); }
  }
  check(made.length === 9 && [...kinds].every(k => k === 74 || k === 75 || k === 76) && kinds.size >= 2, `9 invocações, tipos ${[...kinds].sort().join("/")} (74 esquilo, 75 pé, 76 tartaruga)`);
  check(made.every(m => m.player === 1 && m.summoner === h.id && m.ai.type === "guard" && m.dynamic && !m.buffs.length), "do jogador, vínculo com quem invocou, Guard, sem duração");
  check(made.every(m => Math.max(Math.abs(m.cx - h.cx), Math.abs(m.cy - h.cy)) <= 6), "nascem a ≤ 6 células de quem invocou");
  // desgaste: com 9 vivas, ~8%/s → algumas morrem sem corpo; com 1 só, nunca
  let deaths = 0;
  run(w2, sec(60), ev => { for (const e of ev) if (e.type === "death") deaths++; });
  const alive = made.filter(m => m.alive).length;
  check(deaths >= 2 && alive >= 1, `desgaste em 60 s: ${deaths} morreram, ${alive} vivas`);
  run(w2, sec(30));
  check(made.filter(m => !m.alive).every(m => corpseStage(m) === 5 || m.state === "dying"), "invocação morta não deixa corpo");
  const w3 = makeWorld(7);
  const h3 = heroMage(w3, 20, 20, 10);
  installMissionAi(w3, { spells, heroSpellIds: [SPELL.Summon] });
  setAutocastLevel(w3, 0);
  castBy(w3, h3, SPELL.Summon, { target: h3 });
  const one = w3.units.find(u => u.summoner === h3.id)!;
  run(w3, sec(600));
  check(one?.alive, "uma invocação sozinha não some (r = 1..100 nunca < 1)");
  // snapshot com invocação + corpo: continuação idêntica
  const snap = JSON.parse(JSON.stringify(snapshotWorld(w2)));
  const w4 = makeWorld(6);
  heroMage(w4, 20, 20, 10);
  installMissionAi(w4, { spells, heroSpellIds: [SPELL.Summon] });
  restoreWorld(w4, snap);
  run(w2, sec(20)); run(w4, sec(20));
  check(JSON.stringify(snapshotWorld(w2)) === JSON.stringify(snapshotWorld(w4)), "save/load com invocações e corpos: continuação idêntica");
}

// ------------------------------------------------------------------------------------------------ Heal em quem está morrendo
console.log("\n[Heal] levanta quem ainda sangra (vida > −10), sem guerra [exe 0x51a2b8 → 0x510534]");
{
  const w = makeWorld(9);
  const h = heroMage(w, 10, 10, 40);
  installMissionAi(w, { spells, heroSpellIds: [SPELL.Heal] });
  setAutocastLevel(w, 0);
  const ally = mon(w, 608, 1, 12, 10);
  ally.ai = { type: "hold" };
  // o Heal do exe sai depois da carga de 8 tiques de 16/s (0,5 s, sim/world.ts castTiming); a sangria é de 1 ponto a cada 4 s
  run(w, sec(1));
  killTo(w, ally, -2);
  castBy(w, h, SPELL.Heal, { target: ally });
  check(ally.alive && ally.hp > 0 && ally.state === "idle", `aliado caído levanta com Heal (vida ${ally.hp}, estado ${ally.state})`);
  const late = mon(w, 608, 1, 14, 10);
  killTo(w, late, -2);
  run(w, sec(40));   // −2 → −10 em 32 s: a morte é consumada
  castBy(w, h, SPELL.Heal, { target: late });
  check(!late.alive, `morte consumada (vida do corpo ${late.corpseHp}) não volta`);
  const foe = mon(w, 608, 2, 16, 10);
  killTo(w, foe, -1);
  castBy(w, h, SPELL.Heal, { target: foe });
  check(!foe.alive, "inimigo (em guerra) não é curado");
}

// ------------------------------------------------------------------------------------------------ ataque com a magia escolhida
console.log("\n[magia escolhida] o ataque do jogador lança a magia no lugar do golpe [exe 0x56b059; original: −5 de mana por Fire Arrow]");
{
  const mk = (sel: string | null, range = 1) => {
    const w = makeWorld(13);
    const h = heroMage(w, 10, 10, 30);
    h.stats = { ...h.stats, range };
    installMissionAi(w, { spells, heroSpellIds: [SPELL.FireArrow, SPELL.Heal, SPELL.Summon] });
    setAutocastLevel(w, 0);
    const e = mon(w, 608, 2, 14, 10);
    e.hp = e.maxHp = 5000; e.ai = { type: "hold" }; e.suspended = true;   // alvo parado: não fere o herói
    h.mana = h.maxMana = 500;
    h.selectedSpell = sel;
    w.command(h, { type: "attack", target: e.id });
    let casts = 0, blows = 0;
    run(w, sec(8), ev => { for (const x of ev) { if (x.type === "spell" && x.unit === h.id) casts++; if (x.type === "attack" && x.unit === h.id) blows++; } });
    return { h, casts, blows, w };
  };
  const a = mk(String(SPELL.FireArrow));
  check(a.casts >= 3 && a.blows === 0, `Fire Arrow escolhida: ${a.casts} lançamentos, ${a.blows} golpes`);
  // o original medido tem cajado (+0x12c = 6, m10_mage): sem magia escolhida ataca com a arma
  const b = mk(null, 6);
  check(b.casts === 0 && b.blows >= 1, `sem magia escolhida (alcance 6, cajado): ${b.blows} golpes com a arma`);
  // corpo a corpo (alcance < 2): AI_Task_Attack 0x56acc8 chama AI_Autocast 0x56bc7b, que sem nada a lançar zera IA+8 — a maga para
  const b1 = mk(null);
  check(b1.casts === 0 && b1.blows === 0, `sem magia escolhida e corpo a corpo: o autocast zera a tarefa (${b1.blows} golpes)`);
  const c = mk(String(SPELL.Heal));
  check(c.blows === 0 && c.casts === 0, `Heal escolhida e ninguém ferido: a unidade não golpeia (${c.blows} golpes, ${c.casts} curas; o exe zera a tarefa)`);
  const d = mk(String(SPELL.Summon));
  check(d.w.units.some(u => u.summoner === d.h.id), "Summon escolhida: atacar invoca");
}

// ------------------------------------------------------------------------------------------------ IA conjuradora
console.log("\n[IA] conjurador de IA sorteia Summon/Animate Dead como as demais magias não defensivas [exe 0x57a769]");
{
  const w = makeWorld(17);
  const h = heroMage(w, 10, 10, 30);
  h.hp = h.maxHp = 100000; h.stats = { ...h.stats, healthRegen: 0 };
  const dr = mon(w, 10036, 2, 16, 10);
  installMissionAi(w, { spells });
  setAutocastLevel(w, 0);
  dr.spells = dr.spells.filter(s => s.id === String(SPELL.Summon));
  dr.mana = dr.maxMana = 1000;
  const t = run(w, sec(40), () => w.units.some(u => u.summoner === dr.id));
  const m = w.units.find(u => u.summoner === dr.id);
  check(!!m && m.player === 2, `druida inimigo invoca em combate (${(t / TICKS_PER_SEC).toFixed(1)} s, jogador ${m?.player})`);
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
