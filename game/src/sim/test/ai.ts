/**
 * Testes headless de IA e magias (sem navegador). Rodar em game/:  npx tsx src/sim/test/ai.ts   (faz parte de npm run test:sim)
 * Mundo sintético (grade aberta 48×48) com templates reais de data/unit-templates.json e magias de data/spells.json.
 */
import { BLOCK_STRUCTURE, Grid } from "../grid";
import { AI_THINK_PHASE, World, type Unit, type UnitInit } from "../world";
import { fromTemplate, genericStats, heroDerived, heroStartSkillExp, skillFromExp, type HeroItem, type TemplateJson } from "../stats";
import { buildSpell, SPELL, type SpellTable } from "../spells";
import { applyAiSettings, attachFollowers, autocastBits, autocastLevel, cycleAutocast, installMissionAi, setAutocastLevel } from "../behaviors";
import { restoreWorld, snapshotWorld } from "../snapshot";
import type { SimEvent } from "../types";

import { TICKS_PER_SEC } from "../types";
interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");
function json<T>(rel: string): T | undefined {
  const p = join(PUB, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : undefined;
}

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const templates = json<Record<string, TemplateJson>>("data/unit-templates.json") ?? {};
const spells = json<SpellTable>("data/spells.json") ?? {};
const items = json<Record<string, HeroItem & { slot?: string }>>("data/items.json") ?? {};
if (!Object.keys(templates).length || !Object.keys(spells).length) console.log("  (aviso) data/unit-templates.json ou spells.json ausente: testes vão falhar");

const TIMING = { attackTicks: 12, hitTick: 6, attackDelay: 4, dyingTicks: 14 };

/** Mundo 48×48 aberto, 3 jogadores: 1 (humano) × 2 em guerra; 3 neutro. */
function makeWorld(seed = 7): World {
  const g = new Grid(48, 48);
  for (let x = 0; x < 48; x++) { g.block[x] = 8; g.block[47 * 48 + x] = 8; g.block[x * 48] = 8; g.block[x * 48 + 47] = 8; }
  const w = new World(g, 3, seed);
  w.dip[1]![2] = 1; w.dip[2]![1] = 1;
  return w;
}

function mon(w: World, serverId: number, player: number, x: number, y: number): Unit {
  const t = templates[String(serverId)]!;
  const st = fromTemplate(t, genericStats(String(t.name)), false);
  const init: UnitInit = { kind: String(t.typeId), typeId: Number(t.typeId), player, x, y, stats: st, timing: TIMING, name: String(t.name) };
  return w.spawn(init);
}

function heroMage(w: World, x: number, y: number, astralSkill = 30): Unit {
  const st = heroDerived("Maga", true, true, { body: 19, reaction: 23, mind: 30, spirit: 42 }, { fire: 20, astral: astralSkill }, 7000, []);
  const h = w.spawn({ kind: "hero_mage", typeId: 0, player: 1, x, y, stats: st, timing: TIMING, isHero: true, name: "Maga" });
  const ex = Math.floor((Math.pow(1.1, astralSkill) - 1) * 1000);
  h.heroInfo = { mage: true, alignment: "fire", skillExp: { fire: 6000, astral: ex, air: ex, water: ex, earth: ex } };
  return h;
}

function heroFighter(w: World, x: number, y: number): Unit {
  const eq = ["260", "2067", "3102", "2326", "2586", "46863"].map(id => items[id]).filter(Boolean) as HeroItem[];
  const sx = heroStartSkillExp(false, "blade");
  const skills: Record<string, number> = {};
  for (const [k, v] of Object.entries(sx)) skills[k] = skillFromExp(v);
  const st = heroDerived("Aldor", false, false, { body: 40, reaction: 36, mind: 25, spirit: 17 }, skills, Object.values(sx).reduce((a, b) => a + b, 0), eq);
  const h = w.spawn({ kind: "hero_swordsman", typeId: 0, player: 1, x, y, stats: st, timing: TIMING, isHero: true, name: "Aldor" });
  h.heroInfo = { mage: false, alignment: "blade", skillExp: sx };
  return h;
}

function run(w: World, ticks: number, each?: (ev: SimEvent[]) => boolean | void): number {
  for (let i = 0; i < ticks; i++) {
    w.step();
    const stop = each?.(w.events);
    w.events.length = 0;
    if (stop === true) return i;
  }
  return ticks;
}
const sec = (s: number) => Math.round(s * TICKS_PER_SEC);
const dist = (a: Unit, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ------------------------------------------------------------------------------------------------ herói inicial (exe)
console.log("\n[herói] habilidades iniciais [exe 0x514f59] e atributos do Aldor padrão (gabarito: captura do original)");
{
  const sx = heroStartSkillExp(false, "blade");
  check(sx.blade === 5727 && sx.shooting === 1593, `guerreiro: Blade 20 + Shooting 10 (exp ${JSON.stringify(sx)})`);
  check(Object.values(sx).reduce((a, b) => a + b, 0) === 7320, "XP total 7320 (como no painel do original)");
  const w = makeWorld();
  const h = heroFighter(w, 10, 10);
  check(h.maxHp === 142, `Health 142 (${h.maxHp})`);
  check(h.stats.attack === 78 && h.stats.damage.min === 12 && h.stats.damage.max === 19, `Attack 78, Dmg 12-19 (${h.stats.attack}, ${h.stats.damage.min}-${h.stats.damage.max})`);
  check(h.stats.defense === 43 && h.stats.absorption === 4, `Defense 43, Absorb 4 (${h.stats.defense}, ${h.stats.absorption})`);
  check(Math.round(h.stats.sight * 10) / 10 === 6.4 && Math.round(h.stats.speed * 16) === 19, `Sight 6.4, Speed 19 (${h.stats.sight.toFixed(2)}, ${Math.round(h.stats.speed * 16)})`);
  const m = heroStartSkillExp(true, "fire");
  check(m.fire === 5727 && m.astral === 1593, "mago: Fire 20 + Astral 10");
}

// ------------------------------------------------------------------------------------------------ magias: montagem
console.log("\n[magias] montagem a partir de spells.json");
{
  const fb = buildSpell(2, spells["2"], 30);
  check(fb.kind === "ball" && fb.min === 14 && fb.max === 26 && fb.range === 11 && fb.mana === 30, `Fireball poder 30: ${fb.min}-${fb.max}, alcance ${fb.range}, mana ${fb.mana}`);
  const all = Object.keys(spells).map(Number).map(id => buildSpell(id, spells[String(id)], 40));
  check(all.length === 29 && all.every(s => s.kind && s.target), "29 magias montadas, todas com tipo e alvo");
  const bless = buildSpell(20, spells["20"], 50);
  check(bless.effects?.[0]?.kind === "bless" && bless.effects[0].amount === 60, "Bless: chance = 20 + 4×poder div 5 (poder 50 → 60%) [exe 0x51b894]");
}

// ------------------------------------------------------------------------------------------------ IA de monstros
console.log("\n[IA] ogro vigia o posto, persegue dentro do raio e volta");
{
  const w = makeWorld();
  const ogre = mon(w, 616, 2, 20, 20);
  const h = heroFighter(w, 26, 20);  // 6 células: dentro do raio de guarda (8) do posto
  installMissionAi(w, { spells });
  h.hp = h.maxHp = 5000;              // herói "imortal" para medir
  let attacked = false;
  run(w, sec(10), ev => { if (ev.some(e => e.type === "attack" && e.unit === ogre.id)) attacked = true; return attacked; });
  check(attacked, "ogro ataca quem entra no raio de guarda do posto");
  w.teleport(h, 40, 40);
  const t = run(w, sec(30), () => ogre.cx === 20 && ogre.cy === 20 && ogre.order.type === "none");
  check(ogre.cx === 20 && ogre.cy === 20, `ogro voltou ao posto (${ogre.cx},${ogre.cy}) em ${(t / TICKS_PER_SEC).toFixed(1)} s`);
  // fora do raio não é visto como alvo
  const w2 = makeWorld();
  const o2 = mon(w2, 616, 2, 20, 20);
  heroFighter(w2, 31, 20);
  installMissionAi(w2, { spells });
  run(w2, sec(8));
  check(o2.cx === 20 && o2.cy === 20 && o2.order.type === "none", "herói a 11 células (fora do raio 8): ogro fica no posto");
}

console.log("\n[IA] alerta de grupo: quem apanha avisa os companheiros");
{
  const w = makeWorld();
  const a = mon(w, 608, 2, 20, 20), b = mon(w, 608, 2, 23, 22);
  const h = heroFighter(w, 33, 20);
  installMissionAi(w, { spells });
  h.hp = h.maxHp = 5000;
  w.damage(h, a, 1);
  run(w, sec(3));
  check(b.order.type === "attack" || b.order.type === "cast" || b.state === "attack", `o companheiro também ataca (${b.order.type})`);
}

console.log("\n[magia de IA] xamã orc cura aliados e se protege; lich lança magias ofensivas");
{
  const w = makeWorld();
  const shaman = mon(w, 653, 2, 20, 20), orc = mon(w, 608, 2, 22, 20);
  installMissionAi(w, { spells });
  check(shaman.spells.some(s => Number(s.id) === SPELL.Heal), `xamã conhece Heal (${shaman.spells.map(s => s.name).join(", ")})`);
  orc.hp = 10;
  let healed = false;
  run(w, sec(10), ev => { if (ev.some(e => e.type === "heal" && e.unit === orc.id)) healed = true; return healed; });
  check(healed && orc.hp > 10, `xamã curou o orc ferido (vida ${orc.hp}/${orc.maxHp})`);

  const w2 = makeWorld(11);
  const lich = mon(w2, 672, 2, 20, 20);
  const h = heroFighter(w2, 26, 20);
  installMissionAi(w2, { spells });
  h.hp = h.maxHp = 5000;
  const cast = new Set<string>();
  run(w2, sec(30), ev => { for (const e of ev) if (e.type === "spell" && e.unit === lich.id) cast.add(e.spell); });
  check(cast.size >= 2, `lich lançou magias ofensivas variadas (${[...cast].map(id => spells[id]?.name).join(", ")})`);
}

console.log("\n[magia de chance] Troll.4 (Hydun): Stone Curse 10% no lugar do golpe [exe 0x56acc8]");
{
  const w = makeWorld(3);
  const troll = mon(w, 623, 2, 20, 20);
  const h = heroFighter(w, 21, 20);
  installMissionAi(w, { spells });
  h.hp = h.maxHp = 100000; h.stats = { ...h.stats, healthRegen: 0 };
  check(troll.procSpells.length === 1 && troll.procSpells[0]!.chance === 10, "Troll.4 tem Stone Curse com 10%");
  let stoned = false;
  run(w, sec(90), ev => { if (ev.some(e => e.type === "effect" && e.unit === h.id && e.kind === "stone" && e.on)) stoned = true; return stoned; });
  check(stoned && h.hasBuff("stone"), "herói virou pedra");
  const sp = h.stats.speed;
  check(w.speedOf(h) === 0 && sp > 0, "petrificado não anda");
}

// ------------------------------------------------------------------------------------------------ fuga/recuo
console.log("\n[fuga/recuo] Wimpy, Withdraw e Retreat Mode");
{
  const w = makeWorld();
  const bat = mon(w, 624, 2, 20, 20);   // Bat: Wimpy 4
  const h = heroFighter(w, 22, 20);
  installMissionAi(w, { spells });
  check(bat.wimpyHp === 4, `morcego foge com vida ≤ 4 (${bat.wimpyHp})`);
  bat.hp = 3;
  let fled = false;
  run(w, sec(3), ev => { if (ev.some(e => e.type === "flee" && e.unit === bat.id)) fled = true; return fled; });
  check(fled, "morcego ferido foge");
  run(w, sec(4));
  check(dist(bat, h) > 4, `e se afasta (${dist(bat, h).toFixed(1)} células)`);

  const w2 = makeWorld();
  const archer = mon(w2, 612, 2, 20, 20); // Orc Archer: Withdraw 90 (> vida 60) → sempre recua de quem chega a 2 células
  // herói a 10 células: a chegada cai numa fase do pensamento 1×/s em que o arqueiro não está pronto para atirar (o teste depende da
  // fase — giro antes do trecho e ordem que espera o pensamento, teste diferencial; a 16/s sai a 6, 10 e 11 células, a 5, 7, 8 e 9
  // não, desde que o olhar em volta começou a entrar pelo pensamento (etapa 7); a 20/s era o contrário)
  const h2 = heroFighter(w2, 30, 20);
  installMissionAi(w2, { spells });
  h2.hp = h2.maxHp = 5000;
  w2.command(h2, { type: "attack", target: archer.id });
  let retreats = 0;
  run(w2, sec(15), () => { if (archer.order.type === "retreat") retreats++; });
  check(retreats > 0, "arqueiro orc recua quando o herói encosta (kiting)");

  const w3 = makeWorld();
  const h3 = heroFighter(w3, 10, 10);
  const merc = mon(w3, 612, 1, 12, 10);
  installMissionAi(w3, { spells, settings: { retreatMode: "medium" } });
  check(h3.wimpyHp === Math.floor(h3.maxHp * 0.3) && merc.withdrawHp === Math.floor(merc.maxHp * 0.6), `Retreat Mode médio: fuga 30%, arqueiro recua a 60% (${h3.wimpyHp}, ${merc.withdrawHp})`);
  applyAiSettings(w3, { retreatMode: "never" });
  check(h3.wimpyHp === 0 && merc.withdrawHp === 0, "Retreat Mode nunca: sem fuga");
}

// ------------------------------------------------------------------------------------------------ aliados
console.log("\n[aliados] mercenário segue o herói (formação) e o defende");
{
  const w = makeWorld();
  const h = heroFighter(w, 10, 10);
  const m1 = mon(w, 608, 1, 8, 10), m2 = mon(w, 612, 1, 8, 12);
  installMissionAi(w, { spells, settings: { formationMode: "on" } });
  attachFollowers(w, h, [m1, m2]);
  w.command(h, { type: "move", x: 30, y: 10 });
  run(w, sec(25), () => h.cx === 30 && dist(m1, h) <= 3 && dist(m2, h) <= 3);
  check(dist(m1, h) <= 3.2 && dist(m2, h) <= 3.2, `seguem o herói (distâncias ${dist(m1, h).toFixed(1)}, ${dist(m2, h).toFixed(1)})`);
  const enemy = mon(w, 608, 2, 34, 14);
  h.hp = h.maxHp = 5000;
  w.damage(enemy, h, 1);
  let defended = false;
  run(w, sec(6), () => { defended = (m1.order.type === "attack" && m1.order.target === enemy.id) || (m2.order.type === "attack" && m2.order.target === enemy.id); return defended; });
  check(defended, "mercenário ataca quem bateu no herói");
}

// ------------------------------------------------------------------------------------------------ herói automático
console.log("\n[herói] comportamento automático e modos de comando");
{
  const w = makeWorld();
  const h = heroFighter(w, 20, 20);
  const orc = mon(w, 608, 2, 21, 20);
  installMissionAi(w, { spells });
  w.dip[2]![1] = 0; // o orc não ataca: medimos só a reação do herói parado
  let hit = false;
  run(w, sec(4), ev => { if (ev.some(e => e.type === "attack" && e.unit === h.id)) hit = true; return hit; });
  check(hit, "herói parado ataca inimigo ao alcance (Stand ground automático)");
  // Guard: volta ao posto
  const w2 = makeWorld();
  const h2 = heroFighter(w2, 20, 20);
  const o2 = mon(w2, 608, 2, 26, 20);
  installMissionAi(w2, { spells });
  w2.dip[2]![1] = 0;
  w2.command(h2, { type: "guard", x: 20, y: 20 });
  let went = false;
  run(w2, sec(8), () => { if (h2.order.type === "attack") went = true; return went; });
  check(went, "Guard: herói sai do posto para atacar quem entra no raio");
  w2.kill(o2, h2);
  run(w2, sec(10), () => h2.cx === 20 && h2.cy === 20);
  check(h2.cx === 20 && h2.cy === 20 && h2.order.type === "guard", `Guard: volta ao posto depois (${h2.cx},${h2.cy}, ordem ${h2.order.type})`);
  // Stand ground: não persegue
  const w3 = makeWorld();
  const h3 = heroFighter(w3, 20, 20);
  mon(w3, 608, 2, 24, 20);
  installMissionAi(w3, { spells });
  w3.dip[2]![1] = 0;
  w3.command(h3, { type: "hold" });
  run(w3, sec(5));
  check(h3.cx === 20 && h3.cy === 20, "Stand ground: não sai do lugar por inimigo fora do alcance");
  // Retreat
  const w4 = makeWorld();
  const h4 = heroFighter(w4, 20, 20);
  mon(w4, 608, 2, 22, 20);
  installMissionAi(w4, { spells });
  w4.command(h4, { type: "retreat" });
  run(w4, sec(6));
  check(h4.cx < 18, `Retreat: herói se afasta dos inimigos (x ${h4.cx})`);
}

console.log("\n[autocast] herói mago (CTRL+U)");
{
  const w = makeWorld();
  const h = heroMage(w, 20, 20, 30);
  const m = mon(w, 608, 1, 22, 20);
  installMissionAi(w, { spells, heroSpellIds: [24, 27, 20, 21] });
  check(autocastLevel(w) === 2 && w.playerAi[1]!.autocast === 0x19, "padrão do New Game = 0x19: Average, só Own (medido no original)");
  setAutocastLevel(w, 1);
  h.hp = Math.floor(h.maxHp / 2);
  const casts: string[] = [];
  run(w, sec(6), ev => { for (const e of ev) if (e.type === "spell" && e.unit === h.id) casts.push(`${spells[e.spell]?.name}${e.target === h.id ? "@self" : "@" + e.target}`); });
  check(casts.includes("Heal@self"), `cura a si mesmo (${casts.join(", ")})`);
  check(casts.includes("Shield@self"), "põe Shield em si");
  check(cycleAutocast(w) === 2, "CTRL+U → nível 2");
  m.lastHurtTick = w.tick; // mercenário em combate
  h.mana = h.maxMana;
  const c2: string[] = [];
  run(w, sec(8), ev => { for (const e of ev) if (e.type === "spell" && e.unit === h.id) c2.push(`${spells[e.spell]?.name}@${e.target}`); m.lastHurtTick = w.tick; });
  check(c2.some(s => s.startsWith("Bless") || s.startsWith("Haste")), `nível 2: Bless/Haste em quem luta (${c2.join(", ")})`);
  setAutocastLevel(w, 0);
  h.hp = 5;
  const c3: string[] = [];
  run(w, sec(4), ev => { for (const e of ev) if (e.type === "spell" && e.unit === h.id) c3.push(e.spell); });
  check(c3.length === 0, "autocast desligado: nada");
}

console.log("\n[autocast] opções Game Options → byte AutoCasting (medido no original: Own 1, Allies 2, Neutral 4; Min 8, Avg 0x18, Max 0x38)");
{
  check(autocastBits({}) === 0x19, "padrão (sem opções) = 0x19");
  check(autocastBits({ autoCastOwn: false, autoCastMode: "min" }) === 8 && autocastBits({ autoCastOwn: true, autoCastAllies: true, autoCastNeutral: true, autoCastMode: "max" }) === 0x3f,
    "Minimum sem alvos = 8; Maximum com os três = 0x3f");
  const mk = (s: Parameters<typeof applyAiSettings>[1]) => {
    const w = makeWorld(21);
    const h = heroMage(w, 20, 20, 30);
    const m = mon(w, 608, 1, 22, 20);
    installMissionAi(w, { spells, heroSpellIds: [24, 27], settings: s });
    h.mana = h.maxMana = 400; m.hp = Math.floor(m.maxHp / 3);
    const healed: number[] = [];
    run(w, sec(6), ev => { for (const e of ev) if (e.type === "spell" && e.unit === h.id && spells[e.spell]?.name === "Heal") healed.push(e.target ?? 0); });
    return { w, h, m, healed };
  };
  const a = mk({ autoCastOwn: false, autoCastAllies: false, autoCastNeutral: false, autoCastMode: "min" });
  check(a.w.playerAi[1]!.autocast === 8 && !a.healed.includes(a.m.id), "Own/Allies/Neutral desligados: o mago não cura o mercenário ferido");
  const b = mk({ autoCastOwn: true, autoCastAllies: false, autoCastNeutral: false, autoCastMode: "min" });
  check(b.healed.includes(b.m.id), "Own ligado (Minimum): cura o mercenário ferido");
  const c = mk({});
  check(c.healed.includes(c.m.id), "padrão do original (Own): cura o mercenário ferido");
}

// ------------------------------------------------------------------------------------------------ efeitos das magias
console.log("\n[magias] efeitos");
{
  const w = makeWorld(5);
  const h = heroMage(w, 10, 20, 40);
  const a = mon(w, 608, 2, 20, 20), b = mon(w, 608, 2, 21, 20), far = mon(w, 608, 2, 20, 26);
  const skel = mon(w, 664, 2, 33, 33);
  skel.ai = { type: "hold" };
  installMissionAi(w, { spells, heroSpellIds: [2, 3, 6, 9, 11, 12, 14, 15, 17, 18, 21, 22, 23, 26, 28, 29] });
  for (const u of [a, b, far]) { u.ai = { type: "hold" }; u.hp = u.maxHp = 10000; }
  // a regeneração do exe (1×/4 s, também em combate; LAB) com vida 10000 devolve 600 PV por chamada e esconde o dano: os testes
  // contam o dano aplicado (World.damage) em vez de olhar a vida
  const dealt = new Map<number, number>();
  const realDamage = w.damage.bind(w);
  w.damage = (src, t, dmg, el, quiet) => { dealt.set(t.id, (dealt.get(t.id) ?? 0) + dmg); realDamage(src, t, dmg, el, quiet); };
  const took = (u: Unit) => dealt.get(u.id) ?? 0;
  w.dip[2]![1] = 0;
  setAutocastLevel(w, 0);
  const cast = (id: number, target?: Unit, x?: number, y?: number) => {
    h.mana = h.maxMana = 5000;
    h.cooldown = 0;
    w.command(h, { type: "cast", spell: String(id), target: target?.id, x, y });
    // até 8 s: o andar segue o passo do exe por trecho (diagonal = trunc(passo×0,707) por eixo), um pouco mais lento; a magia em
    // unidade para onde o exe para (0x56ebc0: de frente e a AI_UnitDistance ≤ alcance), então o Teleport seguinte parte de mais longe
    run(w, sec(8), () => h.order.type === "none" && h.state === "idle");
  };
  const hpA = a.hp, hpB = b.hp, hpF = far.hp;
  h.x = 14.5; w.teleport(h, 14, 20);
  cast(SPELL.Fireball, a);
  run(w, sec(2));
  void hpA; void hpB; void hpF;
  check(took(a) > 0 && took(b) > 0 && took(far) === 0, `Fireball explode em raio (A ${took(a)}, B ${took(b)}, longe 0)`);
  const before = a.hp;
  cast(SPELL.WallOfFire, undefined, 20, 20);
  check(w.areas.some(x => x.spell === String(SPELL.WallOfFire)), "Wall of Fire cria área no chão");
  const tookBefore = took(a);
  void before;
  run(w, sec(4));
  check(took(a) > tookBefore, `Wall of Fire queima com o tempo (${took(a) - tookBefore})`);
  cast(SPELL.PoisonCloud, undefined, 21, 20);
  run(w, sec(3));
  check(b.hasBuff("poison"), "Poison Cloud envenena");
  const spd = w.speedOf(h);
  cast(SPELL.Haste, h);
  check(w.speedOf(h) > spd, `Haste acelera (${spd.toFixed(2)} → ${w.speedOf(h).toFixed(2)} c/s)`);
  cast(SPELL.Slow, a);
  check(w.speedOf(a) < a.stats.speed, "Slow reduz a velocidade do alvo");
  cast(SPELL.Curse, a);
  check(a.hasBuff("curse"), "Curse no alvo");
  // a pedra pode acabar antes do fim da espera do lançamento (duração curta com este poder): vale ter petrificado durante o lançamento
  let stoned = false;
  { h.mana = h.maxMana = 5000; h.cooldown = 0; w.command(h, { type: "cast", spell: String(SPELL.StoneCurse), target: far.id });
    run(w, sec(6), () => { if (far.hasBuff("stone") && w.stunned(far)) stoned = true; return h.order.type === "none" && h.state === "idle"; }); }
  check(stoned, "Stone Curse petrifica");
  const aHp = a.hp; h.hp = 1;
  // com 1 PV a Retreat Mode (fuga do exe, LAB) faria o herói se teletransportar em vez de lançar: aqui só o Drain Life importa
  h.wimpyHp = 0; h.withdrawHp = 0;
  const tookA = took(a);
  void aHp;
  // a Stone Curse do exe tem duração sorteada (pode sair 0 = "sem efeito" e o herói ainda estar no fim da animação): espera ficar livre
  run(w, sec(3), () => h.state === "idle" && h.order.type === "none");
  cast(SPELL.DrainLife, a);
  run(w, sec(2));
  check(took(a) > tookA && h.hp > 1, `Drain Life tira e devolve vida (alvo −${took(a) - tookA}, herói ${h.hp})`);
  cast(SPELL.Invisibility, h);
  check(h.hasBuff("invisible") && !w.canSee(a, h), `Invisibility: inimigo comum não vê o herói (${JSON.stringify(h.buffs.map(b => [b.kind, b.amount]))}, mana ${h.mana}, ${h.spells.find(s => s.id === "12")?.name})`);
  cast(SPELL.Light, undefined, 20, 20);
  run(w, sec(2));
  check(w.sightOf(a) > a.stats.sight, "Light aumenta a visão de quem está na área");
  const hx = h.cx;
  cast(SPELL.Teleport, undefined, 30, 30);
  check(h.cx !== hx && Math.abs(h.cx - 30) <= 1 && Math.abs(h.cy - 30) <= 1, `Teleport leva o herói ao ponto (${h.cx},${h.cy})`);
  cast(SPELL.WallOfEarth, undefined, 34, 30);
  check(w.areas.some(x => x.kind === "wall") && !w.grid.walkable(34, 30), "Wall of Earth bloqueia a passagem");
  // Animate Dead NÃO é "Control Spirit": levanta corpos (sim/test/necro.ts); esqueleto vivo não muda de dono e o corpo de um morto-vivo
  // (tipo 82..98) não se levanta [exe 0x51a91f/0x51a9a4]
  cast(SPELL.AnimateDead, skel);
  check(skel.player === 2, `Animate Dead num esqueleto vivo não o toma (dono ${skel.player})`);
  w.damage(undefined, skel, skel.hp + 1);
  skel.corpseHp = -25; skel.bodyDead = true; skel.state = "dead";   // já em "ossos" (estado 3)
  const n0 = w.units.length;
  cast(SPELL.AnimateDead, undefined, skel.cx, skel.cy);
  check(w.units.length === n0, "corpo de esqueleto não se levanta");
  // snapshot com áreas/efeitos ativos → mesmo estado depois
  const snap = snapshotWorld(w);
  run(w, sec(5));
  const after = JSON.stringify(snapshotWorld(w));
  // remonta um mundo igual e aplica o snapshot
  const w2 = makeWorld(5);
  const h2 = heroMage(w2, 10, 20, 40);
  const a2 = mon(w2, 608, 2, 20, 20), b2 = mon(w2, 608, 2, 21, 20), f2 = mon(w2, 608, 2, 20, 26);
  void h2; void a2; void b2; void f2;
  mon(w2, 664, 2, 33, 33).ai = { type: "hold" };
  installMissionAi(w2, { spells, heroSpellIds: [2, 3, 6, 9, 11, 12, 14, 15, 17, 18, 21, 22, 23, 26, 28, 29] });
  restoreWorld(w2, JSON.parse(JSON.stringify(snap)));
  check(!w2.grid.walkable(34, 30), "restaurar o snapshot reaplica a Wall of Earth");
  run(w2, sec(5));
  check(JSON.stringify(snapshotWorld(w2)) === after, "snapshot com áreas/efeitos: continuação idêntica (determinístico)");
  run(w, sec(40));
  check(w.grid.walkable(34, 30) && !w.areas.length, "áreas expiram e a parede some");
}

// ------------------------------------------------------------------------------------------------ guarda do grupo, cadência, giro, tiro
console.log("\n[IA do exe] guarda do grupo (0x57275f), pensamento 1×/s (0x570087), giro antes de lançar (0x556454), tiro sem projétil (0x516c1f)");
{
  // dois orcs do mesmo grupo: o raio é do GRUPO em volta do centroide (max(Chebyshev + scanRange, 8) + 4 ± 1) e o alvo vem de quem o
  // grupo vê; o orc de trás (a 12 do herói, fora da guarda individual de 8) avança junto
  const w = makeWorld(3);
  const a = mon(w, 608, 2, 10, 20), b = mon(w, 608, 2, 16, 20);
  const h = heroFighter(w, 22, 20); h.hp = h.maxHp = 50000; h.stats = { ...h.stats, healthRegen: 0 }; h.cooldown = 9999;
  w.initGroupGuard(5, [a, b]);
  check(a.group === 5 && b.group === 5 && a.groupRadius === b.groupRadius && a.groupRadius === 9,
    `raio do grupo fora de combate = base 9 (3 do centroide + visão 6) = ${a.groupRadius}`);
  let firstTick = -1;
  run(w, sec(4), () => { h.cooldown = 9999; if (firstTick < 0 && a.order.type !== "none") firstTick = w.tick; });
  check(a.groupRadius >= 12 && a.groupRadius <= 14, `em combate o raio sobe para base + 4 ± 1 (0x5726f7) = ${a.groupRadius}`);
  check(firstTick > 0 && firstTick % TICKS_PER_SEC === AI_THINK_PHASE, `a decisão sai no pensamento de 1×/s (tique ${firstTick} ≡ ${AI_THINK_PHASE} mod ${TICKS_PER_SEC})`);
  check(a.cx >= 13 && a.groupTarget === h.id, `o orc de trás avança no alvo do grupo (${a.cx},${a.cy}; alvo ${a.groupTarget})`);
  const w2 = makeWorld(3);
  const a2 = mon(w2, 608, 2, 10, 20);
  const h2 = heroFighter(w2, 22, 20); h2.hp = h2.maxHp = 50000; h2.stats = { ...h2.stats, healthRegen: 0 };
  run(w2, sec(4), () => { h2.cooldown = 9999; });
  check(a2.cx === 10 && a2.order.type === "none", "sem grupo, o mesmo orc (guarda 8 em volta do posto) fica parado");
}
{
  // giro: o lich de costas para o alvo (oeste → leste = 180°) leva ceil(128/16) = 8 tiques de 16/s a mais para lançar
  const delay = (dir0: number): number => {
    const w = makeWorld(4);
    const lich = mon(w, 672, 2, 10, 30), h = heroFighter(w, 14, 30);
    installMissionAi(w, { spells });
    h.hp = h.maxHp = 50000; h.stats = { ...h.stats, healthRegen: 0 }; lich.suspended = true; lich.dir = dir0; lich.mana = 1000;
    const l = lich.spells.find(s => Number(s.id) === SPELL.Lightning)!;
    w.command(lich, { type: "cast", spell: l.id, target: h.id });
    const t0 = w.tick;
    let at = -1;
    run(w, sec(3), ev => { if (ev.some(e => e.type === "spell" && e.unit === lich.id)) { at = w.tick - t0; return true; } });
    return at;
  };
  const back = delay(4), front = delay(12);
  check(back - front === 8, `giro de 180° antes de lançar: ${back} × ${front} tiques (diferença = 8 tiques de 16/s)`);
}
{
  // golpe à distância: resolve o dano na hora em que sai, através de uma estrutura (sem linha de visão; a flecha é só desenho)
  const w = makeWorld(6);
  const archer = mon(w, 14, 2, 10, 40), h = heroFighter(w, 14, 40);
  h.hp = h.maxHp = 50000; h.stats = { ...h.stats, healthRegen: 0 };
  w.grid.block[40 * 48 + 12]! |= BLOCK_STRUCTURE;
  // (o 1º tiro pode errar: o rand() também é gasto pelo olhar em volta das unidades ociosas, 0x56e5bc — vale o tique do tiro que acertou)
  let hitTick = -1, shotTick = -1;
  run(w, sec(6), ev => {
    h.cooldown = 9999;
    for (const e of ev) {
      if (e.type === "projectile") shotTick = w.tick;
      if (e.type === "hit" && e.unit === archer.id && hitTick < 0) hitTick = w.tick;
    }
    return hitTick >= 0;
  });
  check(hitTick > 0 && hitTick === shotTick && w.projectiles.every(p => p.visual), `arqueiro atira por cima da estrutura e o dano sai junto com a flecha (tique ${shotTick}/${hitTick})`);
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
