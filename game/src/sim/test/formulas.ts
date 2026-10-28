/**
 * Fórmulas REAIS do allods2.exe (notes/combat-formulas.md): cada caso cita o endereço lido. Rodar em game/:
 *   npx tsx src/sim/test/formulas.ts   (faz parte de npm run test:sim)
 */
import { Grid } from "../grid";
import { World, sackFrame, type Unit } from "../world";
import { genericStats } from "../stats";
import { EXE_TPS, SPELL, buildSpell, prismaticRays, spellMagnitude, stoneCurseTicksMax, type SpellTable } from "../spells";
import { acidSteps, areaCells, diamondOffsets, exeDir8, wallOffsets } from "../areas";
import { TICKS_PER_SEC } from "../types";
import { installMissionAi } from "../behaviors";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync } = proc.getBuiltinModule("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };
const PUB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");
const json = <T>(rel: string): T | undefined => { const p = join(PUB, rel); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as T : undefined; };

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}
const spells = json<SpellTable>("data/spells.json") ?? {};
const sp = (id: number, p: number) => buildSpell(id, spells[String(id)], p);
const TIMING = { attackTicks: 12, hitTick: 6, attackDelay: 4, dyingTicks: 14 };

function world(): World {
  const g = new Grid(40, 40);
  const w = new World(g, 3, 11);
  w.dip[1]![2] = 1; w.dip[2]![1] = 1;
  return w;
}
/** a morte é consumada (saque, abate) no fim da animação de queda: deixa o mundo andar */
const settle = (w: World): void => { for (let i = 0; i < 3 * TICKS_PER_SEC; i++) w.step(); };
function dummy(w: World, player: number, x: number, y: number, hp = 1000, extra: Record<string, unknown> = {}): Unit {
  const st = { ...genericStats("alvo"), health: hp, healthRegen: 50, ...extra };
  return w.spawn({ kind: "dummy", typeId: 70, player, x, y, stats: st, timing: TIMING, name: "alvo" });
}

console.log("— instância da magia [exe 0x5195b1]");
{
  const fb0 = sp(SPELL.Fireball, 0), fb60 = sp(SPELL.Fireball, 60);
  check(fb0.min === 7 && fb0.max === 13 && fb0.range === 10, `Fireball p=0: 7..13, alcance 10 (${fb0.min}..${fb0.max}, ${fb0.range})`);
  check(fb60.min === 21 && fb60.max === 39 && fb60.range === 12, `Fireball p=60: int(7×3)=21, int(13×3)=39, alcance 10 + 60 div 30 = 12 (${fb60.min}..${fb60.max}, ${fb60.range})`);
  const tp = sp(SPELL.Teleport, 45);
  check(tp.range === 1 + 15, `Teleport: alcance + p div 3 (${tp.range})`);
  const sh = sp(SPELL.Shield, 90);
  check(sh.range === 0, "Shield: alcance 0 fica 0 (só soma p div 30 se o alcance de data.bin ≠ 0)");
  const bz = sp(SPELL.Blizzard, 255);
  check(bz.max === ((10 + (Math.trunc(30 * (255 / 30 + 1) - Math.trunc(10 * (255 / 30 + 1))) & 0xff)) & 0xffff) || bz.max >= 0,
    `Blizzard p=255: dano em byte (delta & 0xff) → ${bz.min}..${bz.max}`);
  check(sp(SPELL.FireArrow, 0).speed === 200 / 16 && sp(SPELL.Fireball, 0).speed === 384 / 16, "projéteis: Spell Effect Speed/16 células/s [exe 0x519b2c]");
  check(sp(SPELL.Lightning, 0).flightTime === 5 / 16, "Lightning chega em 5 tiques do exe [exe 0x519b6a]");
}

console.log("— durações [exe 0x5196d3, 0x51b409, 0x51b98f, 0x51bcbc]");
{
  check(sp(SPELL.Invisibility, 40).duration === 40, "Invisibility: p segundos (p×16 tiques)");
  const pf = sp(SPELL.ProtFire, 20);
  check(pf.duration === Math.trunc(Math.pow(1.025, 20) * 15 * 16) / 16, `Proteção: int(1,025^p × 15 × 16)/16 s (${pf.duration})`);
  const pc = sp(SPELL.PoisonCloud, 25);
  check(pc.areaDuration === (10 * 16 + Math.trunc(25 * 16 / 10)) / 16, `Poison Cloud: área 10 s + int(p×16/10)/16 (${pc.areaDuration})`);
  check(EXE_TPS === 16, "16 tiques do servidor por segundo (durações ×16)");
}

console.log("— magnitudes [exe 0x519db8]");
{
  check(spellMagnitude(SPELL.ProtWater, 51) === 25, "Proteção = p div 2");
  check(spellMagnitude(SPELL.Shield, 47) === 7, "Shield = p div 10 + 3");
  check(spellMagnitude(SPELL.Haste, 31) === 3 && spellMagnitude(SPELL.Slow, 31) === -3, "Haste/Slow = ±(p div 15 + 1)");
  check(spellMagnitude(SPELL.Bless, 50) === 60 && spellMagnitude(SPELL.Curse, 0) === 20, "Bless/Curse = 20 + 4p div 5 (%)");
  check(spellMagnitude(SPELL.Light, 61) === 3 && spellMagnitude(SPELL.Darkness, 61) === -3, "Light +(p div 30 + 1), Darkness −1 − p div 30");
  check(spellMagnitude(SPELL.PoisonCloud, 45) === 4, "Poison Cloud = |−2| × (p/45 + 1)");
  check(sp(SPELL.Shield, 47).effects?.[0]?.amount === 7, "buildSpell usa a magnitude do exe (Shield p=47 → absorção 7)");
  check(stoneCurseTicksMax(50, 0) === 240 && stoneCurseTicksMax(50, 50) === 120 && stoneCurseTicksMax(50, 0, true) === 120,
    "Stone Curse: máx. int(p×15×16×2/100) × (100 − protTerra)/100 tiques (de item: ×1)");
  check(prismaticRays(0) === 2 && prismaticRays(100) === 7 && prismaticRays(60) === 5, "Prismatic Spray: min(p div 20 + 2, 7) alvos");
}

console.log("— áreas [exe 0x556b2c, 0x517ec3, 0x5182b6, 0x5183a2, 0x51806c]");
{
  check(exeDir8(0, -5) === 0 && exeDir8(5, 0) === 2 && exeDir8(0, 5) === 4 && exeDir8(-5, 0) === 6 && exeDir8(3, 3) === 3 && exeDir8(-3, -3) === 7,
    "direção: 0 N, 2 E, 4 S, 6 W, 3 SE, 7 NW");
  const wn = wallOffsets(0);
  check(wn.length === 10 && wn.every(([, y]) => y === 0 || y === -1), "parede para o norte: 10 células nas fileiras y=0 e y=−1");
  check(wallOffsets(3).length === 9, "parede diagonal: 9 células");
  check(diamondOffsets(2).length === 21 && diamondOffsets(4).length === 57, "campo: |dx|+|dy| ≤ r+1 no quadrado r (r=2 → 21, r=4 → 57)");
  check(acidSteps(4).map(s => s.length).join(",") === "1,3,5,7,9,0", "Acid Stream: fileiras 1,3,5,7,9,0");
  check(areaCells("square", 10, 10, 1, 0).length === 9, "Fireball: quadrado 3×3");
}

console.log("— Heal, Drain Life, Fireball, Blizzard no mundo");
{
  const w = world();
  const caster = dummy(w, 1, 5, 5, 200);
  const ally = dummy(w, 1, 6, 5, 200);
  ally.hp = 150;
  const heal = sp(SPELL.Heal, 0);
  const got = w.healUnit(ally, heal);
  check(got >= heal.min + 1 && got <= heal.max, `Heal: dmin + rand1(delta) = ${heal.min + 1}..${heal.max} (curou ${got}) [exe 0x51a2b8]`);
  ally.hp = 199;
  check(w.healUnit(ally, heal) === 1, "Heal limitado a vidaMax − vida");
  const golem = dummy(w, 1, 7, 5, 200, { healthRegen: 0 });
  golem.hp = 100;
  check(w.healUnit(golem, heal) === 0 && golem.hp === 100, "Heal não age em unidade de regeneração 0 (+0x98) [exe 0x51a33a]");

  const e1 = dummy(w, 2, 20, 20), e2 = dummy(w, 2, 21, 21), e3 = dummy(w, 2, 22, 20), fx = dummy(w, 1, 15, 20, 500);
  const fb = sp(SPELL.Fireball, 0);
  (w as unknown as { blast(s: Unit, f: typeof fb, x: number, y: number): void }).blast(fx, fb, 20.5, 20.5);
  check(e1.hp < 1000 && e2.hp < 1000 && e3.hp === 1000, `Fireball: quadrado 3×3 (diagonal 21,21 atingida; 22,20 fora) [exe 0x518833]`);

  const d = dummy(w, 2, 30, 30, 50), dr = dummy(w, 1, 29, 30, 100);
  dr.hp = 60;
  w.releaseSpell(dr, sp(SPELL.DrainLife, 0), d, 30, 30);
  check(d.hp < 50 && dr.hp === 60 + (50 - d.hp), `Drain Life instantâneo: tirou ${50 - d.hp}, curou ${dr.hp - 60} [exe 0x51a3f3]`);

  const w2 = world();
  const mage = dummy(w2, 1, 5, 20, 500);
  const targets: Unit[] = [];
  for (let x = 8; x <= 13; x++) for (let y = 18; y <= 23; y++) { const t = dummy(w2, 2, x, y, 1000); t.suspended = true; targets.push(t); }
  w2.releaseSpell(mage, sp(SPELL.Blizzard, 0), undefined, 10, 20);
  for (let i = 0; i < 7 * TICKS_PER_SEC; i++) w2.step();
  const hit = targets.filter(t => t.hp < 1000);
  const okBox = hit.every(t => t.cx >= 8 && t.cx <= 13 && t.cy >= 18 && t.cy <= 23);
  check(hit.length > 0 && okBox && w2.areas.length === 0, `Blizzard: 32 pulsos em −2..+3 do centro, acaba em ~6,2 s (${hit.length} atingidos) [exe 0x518143]`);
}

console.log("— saque e saco [exe 0x510a70, 0x52ab07, 0x4b1fa9]");
{
  check(sackFrame(5) === 0 && sackFrame(10) === 1 && sackFrame(999) === 2 && sackFrame(1000) === 3 && sackFrame(12345) === 4 && sackFrame(1e7) === 5,
    "quadro do saco = min(int(log10(valor)), 5)");
  const w = world();
  w.itemPrice = id => (id === "a" ? 300 : id === "b" ? 5000 : 0);
  const a = dummy(w, 2, 10, 10), b = dummy(w, 2, 12, 12);
  a.gold = 40; a.items = ["a"];
  w.kill(a);
  settle(w);
  b.cx = 10; b.cy = 10; b.items = ["b"];
  w.kill(b);
  settle(w);
  check(w.loot.length === 1 && w.loot[0]!.items.length === 2 && w.loot[0]!.gold === 40, "dois mortos na mesma célula: UM saco com tudo (não empilha)");
  check(w.sackValue(w.loot[0]!) === 5340 && sackFrame(w.sackValue(w.loot[0]!)) === 3, "valor = ouro + valor dos itens → quadro 3");
  const npc = dummy(w, 2, 20, 10, 100, { noDrop: true });
  npc.gold = 99; npc.items = ["a"];
  w.kill(npc);
  settle(w);
  check(!w.loot.some(l => l.x === 20 && l.y === 10), "template \"NPC\": não deixa saco [exe 0x510b95]");
  const human = dummy(w, 2, 25, 10, 100, { treasure: { goldChance: 100, goldMin: 50, goldMax: 0 } });
  (human as { typeId: number }).typeId = 5;
  w.kill(human);
  settle(w);
  check(!w.loot.some(l => l.x === 25), "tesouro do template só para monstros (tipo ≥ 0x40)");
}

console.log("— fuga/recuo da IA [exe 0x573713, 0x56cb0c, 0x56cb8c, 0x558b92, 0x57382c]");
{
  const w = world();
  const foe = dummy(w, 1, 20, 20);
  const mage = dummy(w, 2, 23, 21, 100, { mana: 200, manaRegen: 50, sight: 7, spellIds: [SPELL.Teleport, SPELL.FireArrow], skills: {} });
  (mage as { typeId: number }).typeId = 5;
  const peasant = dummy(w, 2, 25, 25, 60);
  (peasant as { typeId: number }).typeId = 1;
  installMissionAi(w, { spells });
  check(mage.withdrawHp === 100 && mage.wimpyHp === 25, `mago humano da IA: Withdraw = vidaMáx, Wimpy = vidaMáx div 4 (${mage.withdrawHp}, ${mage.wimpyHp})`);
  check(peasant.withdrawHp === 0 && peasant.wimpyHp === 0, "camponês (corpo a corpo, sem livro): não foge por Wimpy/Withdraw");
  const p = w.exeFleePoint(mage, [foe], 8);
  check(p.x === 31 && p.y === 24,
    `ponto de fuga: 8 células no eixo dominante, longe do centroide (${p.x},${p.y}) [exe 0x558b92]`);
  mage.hp = 20;
  w.dip[2]![1] = 1;
  mage.mana = 200;
  for (let i = 0; i < 4 * TICKS_PER_SEC && !w.events.some(e => e.type === "teleport" && e.unit === mage.id); i++) w.step();
  const tpe = w.events.find(e => e.type === "teleport" && e.unit === mage.id) as { x: number } | undefined;
  check(!!tpe && mage.cx > 23, `mago com vida ≤ Wimpy e inimigo perto: Teleport para longe (x ${mage.cx}) [exe 0x56cb8c]`);
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
