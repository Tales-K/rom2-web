/**
 * Testes da frente VIDA-ZERO (sim/world.ts `fall`/`consumeDeath`/`knockOut`, sim/necro.ts): vida 0 = inconsciente, vida < 0 = sangrando
 * (−1 a cada 4 s), morte em −10, caído continua alvo de golpes e de Heal — gabarito = medições do original (notes/combat-formulas.md §5,
 * refs/trace/d_hp.jsonl) e notes/magic-original.md. `npx tsx src/sim/test/downed.ts`
 */
import { Grid } from "../grid";
import { World, type Unit, type UnitInit } from "../world";
import { fromTemplate, genericStats, heroDerived, type TemplateJson } from "../stats";
import { SPELL, type SpellTable } from "../spells";
import { installMissionAi, setAutocastLevel } from "../behaviors";
import { CORPSE, corpseStage, isBleeding, isUnconscious } from "../necro";
import { restoreWorld, snapshotWorld } from "../snapshot";
import { TICKS_PER_SEC, type SimEvent } from "../types";

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

function initOf(id: string, player: number, x: number, y: number): UnitInit {
  const t = templates[id]!;
  return { kind: String(t.typeId), typeId: Number(t.typeId), player, x, y, stats: fromTemplate(t, genericStats(String(t.name)), false), timing: TIMING, name: String(t.name) };
}
function makeWorld(seed = 11): World {
  const g = new Grid(48, 48);
  for (let x = 0; x < 48; x++) { g.block[x] = 8; g.block[47 * 48 + x] = 8; g.block[x * 48] = 8; g.block[x * 48 + 47] = 8; }
  const w = new World(g, 3, seed);
  w.dip[1]![2] = 1; w.dip[2]![1] = 1;
  return w;
}
const mon = (w: World, id: number, player: number, x: number, y: number): Unit => w.spawn(initOf(String(id), player, x, y));
const ORC = 608, FOOT = 640, SHAMAN = 653;
function heroMage(w: World, x: number, y: number, astral = 40): Unit {
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
/** deixa a vida de `u` em `hp` (≤ 0) com um golpe */
const killTo = (w: World, u: Unit, hp: number): void => { w.damage(undefined, u, u.hp - hp); w.step(); w.events.length = 0; };   // a queda sai no tique da própria unidade (máquina 0x50f12c)
const count = (ev: SimEvent[], type: string, unit: number): number => ev.filter(e => e.type === type && (e as { unit: number }).unit === unit).length;

// ------------------------------------------------------------------------------------------------ vida 0 = inconsciente
console.log("\n[inconsciente] vida EXATAMENTE 0: estável, não sangra, não morre, não solta saque [exe 0x50f12c/0x50fc5a; medido 100 s em 0]");
{
  const w = makeWorld();
  const a = mon(w, ORC, 2, 10, 10);
  a.gold = 7;
  const def0 = w.defenseOf(a);
  let falls = 0, deaths = 0;
  w.damage(undefined, a, a.hp);
  run(w, 1, ev => { falls += count(ev, "fall", a.id); });
  check(!a.alive && a.downed && isUnconscious(a) && !isBleeding(a) && a.corpseHp === 0 && a.hp === 0, `vida 0: caído e inconsciente (vida do corpo ${a.corpseHp})`);
  check(falls === 1, "evento `fall` (grito/queda) uma vez");
  check(w.defenseOf(a) === Math.floor(def0 / 2), `defesa pela metade enquanto caído (${def0} → ${w.defenseOf(a)}) [exe 0x50f12c]`);
  run(w, sec(120), ev => { deaths += count(ev, "death", a.id); falls += count(ev, "fall", a.id); });
  check(a.corpseHp === 0 && a.downed && !a.bodyDead && corpseStage(a) === 1 && deaths === 0 && falls === 1, `120 s depois: continua na vida 0, sem morte (${deaths}) e sem novo fall`);
  check(w.loot.length === 0 && a.gold === 7, "sem morte consumada não há saque");
  check(a.targetable && !a.active, "inconsciente continua alvo (targetable) sem estar ativo");
}

// ------------------------------------------------------------------------------------------------ sangria e morte em −10
console.log("\n[sangria] vida < 0: −1 a cada 4 s; morte consumada em −10 (saque, abate) e 1º desgaste do corpo [exe 0x50fc5a/0x510a70/0x5110b8; medido]");
{
  const w = makeWorld();
  const b = mon(w, ORC, 2, 10, 10);
  b.gold = 9;
  killTo(w, b, -3);
  check(b.downed && isBleeding(b) && b.corpseHp === -3, `vida -3: sangrando (${b.corpseHp})`);
  const changes: Array<[number, number]> = [];
  let last = b.corpseHp, deathTick = 0, lootBeforeDeath = false, hpAtDeath = 0;
  run(w, sec(40), ev => {
    if (b.corpseHp !== last) { changes.push([w.tick, b.corpseHp]); last = b.corpseHp; }
    if (!deathTick && count(ev, "death", b.id)) { deathTick = w.tick; hpAtDeath = b.corpseHp; }
    if (!deathTick && w.loot.length) lootBeforeDeath = true;
  });
  const steps = changes.map((c, i) => i ? c[1] - changes[i - 1]![1] : c[1] - -3);
  check(changes.length >= 7 && steps.slice(0, 7).every(s => s === -1 || s === -2), `passos de 1 ponto: ${changes.slice(0, 8).map(c => c[1]).join(", ")}`);
  // World_SecondTick 0x52bbb7 roda no tique com o relógio de 16/s pré-incremento ≡ 0xc (etapa 9, lote 1): o 1º laço de 1/s de um
  // segundo múltiplo de 4 é o tique ≡ 13 (mod 64)
  check(changes.slice(0, 7).every(c => c[0] % sec(4) === 13), "cada ponto sai no laço de 1/s de um segundo múltiplo de 4");
  check(changes[1]![0] - changes[0]![0] === sec(4) && changes[5]![0] - changes[4]![0] === sec(4), "intervalo de 4 s entre pontos");
  check(deathTick === changes[6]![0] && b.bodyDead && hpAtDeath === CORPSE.DEATH - 1, `morte consumada em −10 (tique ${deathTick}) e corpo em ${hpAtDeath} (−10 → −11 na hora, medido)`);
  check(corpseStage(b) === 2, "cadáver (estado 2) logo depois da morte");
  check(!lootBeforeDeath && w.loot.length === 1 && w.loot[0]!.gold >= 9, "saque só na morte consumada");
}

console.log("\n[golpe fatal] a vida não é limitada: `vida −= dano` em word, sem piso [exe 0x516d98 golpe / 0x51e69c magia; 0x516f6f não lê a vida];"
  + " medido 5 → −13 (golpe de 18) e morte consumada 0,7 s depois, 11 → −4 caído (refs/trace/m10_fight_seed7_A.jsonl, lab_fight_seed7_A.jsonl)");
{
  const w = makeWorld();
  const c = mon(w, ORC, 2, 10, 10);
  c.hp = 5;
  let deathTick = 0;
  run(w, sec(1));   // longe do segundo múltiplo de 4 (sangria) durante a animação
  c.hp = 5;
  w.damage(undefined, c, 18);
  run(w, 1);   // a queda sai no tique da própria unidade (máquina 0x50f12c: vida < 1)
  const t0 = w.tick;
  check(c.corpseHp === -13 && c.downed && !c.bodyDead, `5 de vida − 18 de dano = ${c.corpseHp} (medido −13), ainda caído até o fim da animação`);
  let hpAtDeath = 0;
  run(w, sec(2), ev => { if (!deathTick && count(ev, "death", c.id)) { deathTick = w.tick - t0; hpAtDeath = c.corpseHp; } });
  // o 1º desgaste de Corpse_Decay (chamada por Unit_Die) só tira 1 no segundo PAR do contador de 1/s (0x5110b8): −14 ou −13
  check(deathTick === TIMING.dyingTicks && corpseStage(c) === 2 && (hpAtDeath === -14 || hpAtDeath === -13),
    `consumada no fim da animação (${deathTick} tiques ≈ 0,7 s, medido 0,69 s) com o 1º desgaste só em segundo par (−13 → ${hpAtDeath}, medido −14)`);
  const d = mon(w, ORC, 2, 14, 10);
  d.hp = 11;
  w.damage(undefined, d, 15);
  run(w, 1);
  check(d.corpseHp === -4 && d.downed && !d.bodyDead, `11 − 15 = ${d.corpseHp}: caído sangrando, sem morte (medido 11 → −4)`);
  const e = mon(w, ORC, 2, 18, 10);
  e.hp = 5;
  w.damage(undefined, e, 50, "fire");
  run(w, sec(3));
  check(e.bodyDead && corpseStage(e) === 4, `golpe grande (5 − 50 = −45): direto em pó depois da animação (estado ${corpseStage(e)})`);
}

console.log("\n[voador] fim da animação de queda com +0x4a > 1: vida −1000 e morte mesmo com vida 0 [exe 0x50f26e; +0x4a = voador est]");
{
  const w = makeWorld();
  const f = mon(w, ORC, 2, 10, 10);
  f.stats.flying = true;
  w.damage(undefined, f, f.hp);
  run(w, 1);   // a queda sai no tique da própria unidade
  const t0 = w.tick;
  check(f.downed && f.corpseHp === 0, "voador com vida exatamente 0 cai");
  let deathTick = 0;
  run(w, sec(3), ev => { if (!deathTick && count(ev, "death", f.id)) deathTick = w.tick - t0; });
  // vida −1000 (0x50f27e) e, no 1º desgaste de Corpse_Decay (chamada por Unit_Die), < −600 → estado 5 e vida −10001: o corpo some na hora
  check(deathTick === TIMING.dyingTicks && f.bodyDead && f.corpseHp === CORPSE.CONSUMED, `e morre no fim da animação (${deathTick} tiques), corpo ${f.corpseHp}`);
}

// ------------------------------------------------------------------------------------------------ caído continua alvo
console.log("\n[alvo] quem caiu continua alvo de golpes: ordem de ataque, IA de guarda; golpe não dá experiência [exe 0x567a16; herói bateu na cobra caída −3 → −19]");
{
  const w = makeWorld();
  const att = mon(w, FOOT, 1, 12, 10), v = mon(w, ORC, 2, 11, 10);
  killTo(w, v, -2);
  w.command(att, { type: "attack", target: v.id });
  let hits = 0, deaths = 0, killer = 0;
  const t = run(w, sec(20), ev => { for (const e of ev) { if (e.type === "hit" && e.target === v.id) hits++; if (e.type === "death" && e.unit === v.id) { deaths++; killer = e.killer; } } return deaths > 0; });
  check(hits >= 1 && deaths === 1 && killer === att.id, `ordem de ataque bate no caído (${hits} golpes) até a morte consumada (${(t / TICKS_PER_SEC).toFixed(1)} s, abate de ${killer})`);
  check(t < sec(27), "a morte vem dos golpes, bem antes dos 28 s da sangria");
  run(w, sec(1));   // o golpe em curso termina antes (máquina 0x50f12c: ~10 tiques) e então a tarefa larga o alvo consumado
  check(att.order.type === "none", "e a ordem acaba com o alvo");

  // IA de guarda escolhe o caído (inimigo mais perto) e o ataca
  const w2 = makeWorld(5);
  const guard = mon(w2, ORC, 2, 10, 10), down = mon(w2, FOOT, 1, 13, 10);
  killTo(w2, down, 0);
  let gh = 0;
  // golpes contados no começo (evento `attack`): o 's' ao cliente (evento `hit`) não sai quando o caído passa de 0 a ≤ −10 (0x516c1f)
  run(w2, sec(10), ev => { for (const e of ev) if (e.type === "attack" && e.target === down.id && e.unit === guard.id) gh++; });
  check(gh >= 1 && down.corpseHp < 0, `guarda inimigo ataca o inconsciente (${gh} golpes; vida do corpo ${down.corpseHp})`);
  // um inconsciente "vida 0 do script" (helpless) NÃO é escolhido pela IA
  const w3 = makeWorld(5);
  const g3 = mon(w3, ORC, 2, 10, 10), hostage = mon(w3, FOOT, 1, 13, 10);
  w3.knockOut(hostage);
  let h3 = 0;
  run(w3, sec(10), ev => { for (const e of ev) if (e.type === "hit" && e.target === hostage.id) h3++; });
  check(h3 === 0 && hostage.corpseHp === 0, `refém "vida 0" do script (helpless): a IA não o ataca (${h3} golpes)`);
  void g3;

  // experiência: golpe em quem está de pé dá; em quem caiu não
  const w4 = makeWorld(7);
  const h = mon(w4, FOOT, 1, 12, 10), alive = mon(w4, ORC, 2, 11, 10), fallen = mon(w4, ORC, 2, 11, 12);
  h.isHero = true; h.heroInfo = { mage: false, alignment: "blade", skillExp: { blade: 1000 } };
  (h.stats as { attackType?: string }).attackType = "blade"; (h.stats as { mind?: number }).mind = 30; (h.stats as { alwaysHit?: boolean }).alwaysHit = true; h.stats.damage = { min: 5, max: 5 };
  alive.ai = { type: "hold" }; alive.suspended = true; alive.hp = alive.maxHp = 5000;
  for (let i = 0; i < 10; i++) w4.strike(h, alive);
  const xp1 = h.exp;
  killTo(w4, fallen, -1);
  for (let i = 0; i < 6; i++) w4.strike(h, fallen);
  check(xp1 > 0 && h.exp === xp1, `experiência: golpes no vivo +${xp1}, no caído +${h.exp - xp1}`);
}

console.log("\n[paz] a paz solta o caído: ataque comum não reabre a guerra por um corpo [est]");
{
  const w = makeWorld();
  const att = mon(w, FOOT, 1, 12, 10), v = mon(w, ORC, 2, 11, 10);
  killTo(w, v, -2);
  w.command(att, { type: "attack", target: v.id });
  w.setDiplomacy(1, 2, 0); w.setDiplomacy(2, 1, 0);
  const hp0 = v.corpseHp;
  run(w, sec(3));
  check(att.order.type === "none" && w.diplomacyValue(1, 2) === 0 && v.corpseHp >= hp0 - 1, `ordem largada, paz mantida, corpo intacto (${hp0} → ${v.corpseHp})`);
  // o ataque forçado insiste (acerto garantido: o teste é da ordem, não do sorteio de acerto)
  (att.stats as { alwaysHit?: boolean }).alwaysHit = true;
  w.command(att, { type: "attack", target: v.id, forced: true });
  const hits = run(w, sec(3), ev => ev.some(e => e.type === "hit" && e.target === v.id));
  check(hits < sec(3), "ataque forçado (Ctrl+clique) ainda acerta");
}

// ------------------------------------------------------------------------------------------------ Heal levanta
console.log("\n[Heal] levanta quem tem vida > −10, sem guerra; inconsciente (0) levanta com qualquer cura; depois da morte consumada não [exe 0x51a2b8 → 0x510534]");
{
  const w = makeWorld(9);
  const h = heroMage(w, 10, 10, 40);
  installMissionAi(w, { spells, heroSpellIds: [SPELL.Heal] });
  setAutocastLevel(w, 0);
  const heal = (t: Unit) => { h.mana = h.maxMana = 5000; h.cooldown = 0; w.command(h, { type: "cast", spell: String(SPELL.Heal), target: t.id }); run(w, sec(6), () => h.order.type === "none" && h.state === "idle"); };
  const mk = (x: number, hp: number): Unit => { const u = mon(w, ORC, 1, x, 12); u.ai = { type: "hold" }; killTo(w, u, hp); return u; };
  // a sangria sai no laço de 1/s dos segundos múltiplos de 4 (tique ≡ 13 mod 64, 0x52bbb7): os caídos nascem logo depois de um e o −9
  // é curado primeiro, antes do próximo (63 tiques)
  run(w, 14);
  const zero = mk(11, 0), neg = mk(13, -9), gone = mk(15, -12);
  const def = w.defenseOf(zero);
  heal(neg); heal(zero); heal(gone);
  check(zero.alive && zero.hp > 0 && zero.state === "idle" && !zero.downed, `inconsciente (0) levanta com Heal (vida ${zero.hp}, estado ${zero.state})`);
  check(w.defenseOf(zero) === def * 2 && def > 0, `defesa dobrada de volta (${def} → ${w.defenseOf(zero)}) [exe 0x510534]`);
  check(neg.alive && neg.hp >= 1, `vida −9 ainda levanta (vida ${neg.hp})`);
  check(!gone.alive && gone.bodyDead, `vida −12 (morte consumada) não volta (corpo ${gone.corpseHp})`);
  // depois de levantar não morre mais pela sangria antiga
  let deaths = 0;
  run(w, sec(60), ev => { deaths += count(ev, "death", neg.id) + count(ev, "death", zero.id); });
  check(neg.alive && zero.alive && deaths === 0, "levantado não volta a sangrar nem morre depois");
  const foe = mon(w, ORC, 2, 17, 12); killTo(w, foe, -1);
  heal(foe);
  check(!foe.alive, "inimigo (em guerra) não é curado");
}

console.log("\n[Heal da IA] o conjurador de IA cura o aliado caído (1º ferido da varredura em anéis) [exe 0x56c592]");
{
  const w = makeWorld(3);
  const sh = mon(w, SHAMAN, 2, 20, 20), orc = mon(w, ORC, 2, 22, 20);
  installMissionAi(w, { spells });
  orc.ai = { type: "hold" };
  killTo(w, orc, -3);
  run(w, sec(12), () => orc.alive);
  check(sh.spells.some(s => Number(s.id) === SPELL.Heal) && orc.alive && orc.hp > 0, `xamã levanta o orc caído (vida ${orc.hp})`);
}

// ------------------------------------------------------------------------------------------------ vida 0 do script
console.log("\n[script] `knockOut` (vida 0 do mapa/script): inconsciente sem passar pela morte; a falha de missão só na morte consumada");
{
  const w = makeWorld();
  const calls: number[] = [];
  w.onDeath = u => { calls.push(u.id); };
  const k = mon(w, ORC, 2, 10, 10);
  let falls = 0;
  w.knockOut(k);
  run(w, sec(30), ev => { falls += count(ev, "fall", k.id); });
  check(k.downed && k.helpless && k.corpseHp === 0 && k.hp === 0 && k.state === "dead" && calls.length === 0 && falls === 0, "inconsciente, helpless, sem `fall` nem onDeath");
  w.kill(k);
  check(!k.downed && k.bodyDead && calls.length === 1 && calls[0] === k.id, `decretar a morte consuma (onDeath 1×: ${calls.length})`);
  const k2 = mon(w, ORC, 2, 14, 10);
  w.knockOut(k2);
  w.revive(k2, 20, true);
  check(k2.alive && k2.hp === 20 && !k2.silentFall, "Heal/script levanta o inconsciente");
  w.kill(k2);
  check(calls.length === 2, "levantado e morto depois: onDeath uma vez só");
  // queda comum chama onDeath na queda (herói caído = falha da missão ~3 s depois, medido) e não de novo na morte consumada
  const calls2: number[] = [];
  w.onDeath = u => { calls2.push(u.id); };
  const f = mon(w, ORC, 2, 18, 10);
  killTo(w, f, -2);
  run(w, sec(40));
  check(f.bodyDead && calls2.length === 1, `queda comum: onDeath na queda, uma vez só (${calls2.length})`);
}

console.log("\n[kill] morte decretada (console, desgaste das invocações): consuma na hora");
{
  const w = makeWorld();
  const a = mon(w, ORC, 2, 10, 10); a.gold = 5;
  let deaths = 0;
  w.kill(a);
  run(w, 1, ev => { deaths += count(ev, "death", a.id); });
  check(deaths === 1 && a.bodyDead && w.loot.length === 1, "kill: `death` e saque no mesmo tique");
  const b = mon(w, ORC, 2, 14, 10);
  killTo(w, b, -4);
  w.kill(b);
  check(b.bodyDead && b.corpseHp <= CORPSE.DEATH, "kill em quem sangra consuma também");
}

// ------------------------------------------------------------------------------------------------ save/load
console.log("\n[save] caído (inconsciente e sangrando) sobrevive a save/load: continuação idêntica");
{
  const build = (): { w: World; a: Unit; b: Unit } => {
    const w = makeWorld(21);
    const a = mon(w, ORC, 2, 10, 10), b = mon(w, ORC, 2, 14, 10);
    return { w, a, b };
  };
  const x = build();
  w0(x.w, x.a, 0); w0(x.w, x.b, -3);
  run(x.w, sec(9));
  const snap = JSON.parse(JSON.stringify(snapshotWorld(x.w)));
  const y = build();
  restoreWorld(y.w, snap);
  run(x.w, sec(30)); run(y.w, sec(30));
  check(JSON.stringify(snapshotWorld(x.w)) === JSON.stringify(snapshotWorld(y.w)) && y.a.corpseHp === 0 && y.b.bodyDead, "snapshot/restore com inconsciente e sangrando");
}
function w0(w: World, u: Unit, hp: number): void { killTo(w, u, hp); }

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
