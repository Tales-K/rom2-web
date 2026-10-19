/**
 * Ida e volta do save no meio da missão em várias missões (sim/snapshot.ts v2). Rodar em game/:  npx tsx src/sim/test/saveroundtrip.ts [id...]
 *
 * Para cada missão: roda N tiques com um piloto determinístico (ordens, teletransportes entre os pontos do script, magias de pergaminho, áreas, armadilha,
 * invocação, alavancas, inconsciente, fora de fase, Polymorph, suspensão, diplomacia, abate, ouro...), serializa (JSON como no localStorage), monta a missão
 * de novo e restaura. Compara o estado COMPLETO dos dois mundos — não só o que o snapshot grava: `dump` caminha por todos os campos próprios do World,
 * das Units (inclusive estáticos), do MissionHost e do ScriptRuntime, de modo que um campo novo sem snapshot aparece como divergência — logo depois do
 * restore e a cada CHECK tiques durante mais M tiques rodados nos dois (o original e o restaurado). Qualquer divergência é bug do snapshot.
 * Também: controle negativo (um save "v1" perde a alavanca da 93: o comparador enxerga), migração de save v1, e `refreshHero` (equipamento trocado na missão).
 */
import { buildSpell, SPELL } from "../spells";
import { Unit } from "../world";
import { refreshHero } from "../../mission/setup";
import { migrateMissionSnapshot, restoreMission, snapshotMission, type MissionSnapshot, type MissionUiState } from "../snapshot";
import { loadData, proc, run, startRun, type Run } from "./loader";
import { BOTH, check, heroOf, summary } from "./pilot";
import type { HeroState } from "../../core/state";

// ------------------------------------------------------------------------------------------- dump profundo
type J = null | boolean | number | string | J[] | { [k: string]: J };

/** Serializa qualquer valor (ciclos e Unit viram referências "@id"; chaves e Maps ordenados; funções ignoradas). */
function ser(v: unknown, skip: ReadonlySet<string> = new Set(), full = false, seen = new WeakSet<object>()): J {
  if (typeof v === "number") return Number.isFinite(v) ? v : v <= -1e8 ? "-inf" : v > 0 ? "inf" : "nan";
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "function") return null;
  if (v instanceof Unit && !full) return `@${v.id}`;
  if (typeof v !== "object") return String(v);
  if (seen.has(v)) return "@cycle";
  seen.add(v);
  try {
    if (ArrayBuffer.isView(v)) { let h = 2166136261; for (const x of Array.from(v as unknown as ArrayLike<number>)) h = Math.imul(h ^ (x | 0), 16777619) >>> 0; return `ta:${(v as unknown as ArrayLike<number>).length}:${h}`; }
    if (Array.isArray(v)) return v.map(x => ser(x, new Set(), false, seen));
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [ser(k, new Set(), false, seen), ser(x, new Set(), false, seen)] as J).sort((a, b) => JSON.stringify((a as J[])[0]).localeCompare(JSON.stringify((b as J[])[0]))) };
    if (v instanceof Set) return { $set: [...v].map(x => ser(x, new Set(), false, seen)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
    const o: Record<string, J> = {};
    for (const k of Object.keys(v).sort()) {
      if (skip.has(k)) continue;
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === "function" || x === undefined) continue;
      o[k] = ser(x, new Set(), false, seen);
    }
    return o;
  } finally { seen.delete(v); }
}

const WORLD_SKIP = new Set(["grid", "byId", "units", "events", "spellTable", "summonFactory", "onDeath", "rng", "projectiles"]);
const HOST_SKIP = new Set(["world", "cb", "spellTable", "onMessage"]);
const RT_SKIP = new Set(["script", "host", "options", "history", "warned", "currentTrigger", "actionsThisCycle"]);

function dump(r: Run): J {
  const w = r.b.world, g = w.grid;
  return {
    world: ser(w, WORLD_SKIP),
    projectiles: ser(w.projectiles.filter(p => !p.done)),             // os já resolvidos (done) só esperam a limpeza e não entram no snapshot
    rng: w.rng.state,
    priv: { nextId: (w as unknown as { nextId: number }).nextId, splash: (w as unknown as { splash: number }).splash },
    grid: { block: ser(g.block), occ: ser(g.occ), cost: ser(g.cost) },
    units: w.units.map(u => ser(u, new Set(), true)),
    host: ser(r.b.host, HOST_SKIP),
    runtime: r.b.runtime ? ser(r.b.runtime, RT_SKIP) : null,
  };
}

/** Caminho do primeiro campo diferente entre dois dumps (ou null se iguais). */
function firstDiff(a: J, b: J, path = ""): string | null {
  if (a === b) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 80)} != ${JSON.stringify(b)?.slice(0, 80)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: tipo`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: tamanho ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i]!, b[i]!, `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    const x = (a as Record<string, J>)[k], y = (b as Record<string, J>)[k];
    if (x === undefined || y === undefined) return `${path}.${k}: ${x === undefined ? "falta no original" : "falta no restaurado"}`;
    const d = firstDiff(x, y, `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Descreve a unidade no caminho (units[i] -> id/kind/nome) para o relatório. */
function where(r: Run, d: string): string {
  const m = d.match(/^\.units\[(\d+)\]/);
  const u = m ? r.b.world.units[Number(m[1])] : undefined;
  return u ? `${d}  (unidade ${u.id} ${u.name} script#${u.scriptId})` : d;
}

// ------------------------------------------------------------------------------------------- piloto
const sorted = (r: Run): Unit[] => [...r.b.host.units].filter(([id, u]) => id < 10000 && u.id !== r.b.hero.id).sort((a, b) => a[0] - b[0]).map(([, u]) => u);
const scroll = (r: Run, name: string, spell: number, power = 40): string => {
  const id = `scroll:${name}`;
  if (!r.b.hero.spells.some(s => s.id === id)) r.b.hero.spells.push({ ...buildSpell(spell, r.data.spells?.[String(spell)], power), id, mana: 0 });
  return id;
};
const nearestEnemy = (r: Run, range: number): Unit | undefined => {
  const w = r.b.world, h = r.b.hero;
  return w.units.filter(u => u.active && w.hostile(1, u.player) && Math.hypot(u.x - h.x, u.y - h.y) <= range)
    .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y) || a.id - b.id)[0];
};

interface Plan { id: number; save: number; more: number; quiet?: boolean; }

/** Pokes por tique absoluto (idênticos nos dois mundos); o que cai depois de `save` roda também no restaurado. */
function pokes(r: Run, t: number, plan: Plan): void {
  const w = r.b.world, h = r.b.hero, host = r.b.host, sc = sorted(r);
  const hc = { x: h.cx, y: h.cy };
  if (t === 1) for (const u of w.units) if (u.player === 1) u.maxHp = u.hp = 5000;   // o grupo sobrevive às missões difíceis
  if (t === 2) { scroll(r, "fb", SPELL.Fireball); scroll(r, "wof", SPELL.WallOfFire); scroll(r, "pc", SPELL.PoisonCloud); scroll(r, "woe", SPELL.WallOfEarth); scroll(r, "sum", SPELL.Summon); return; }
  // as ações do piloto acontecem pouco antes do save (áreas, armadilhas e invocações ainda vivas no snapshot); k = tique relativo
  const k = t - (plan.save - 70);
  // invocação (Summon, o caminho que cria unidades `dynamic`); o herói em combate nunca fica livre para lançar, então chama o resolvedor da sim
  if (k === 18) (w as unknown as { summon(u: Unit, s: unknown, x: number, y: number): void }).summon(h, { ...buildSpell(SPELL.Summon, r.data.spells?.[String(SPELL.Summon)], 40), id: "scroll:sum" }, hc.x, hc.y);
  switch (k) {
    case 12: w.castAtPoint(buildSpell(SPELL.WallOfFire, r.data.spells?.[String(SPELL.WallOfFire)], 40), h.x, h.y, hc.x + 3, hc.y); break;
    case 13: w.castAtPoint(buildSpell(SPELL.PoisonCloud, r.data.spells?.[String(SPELL.PoisonCloud)], 40), h.x, h.y, hc.x - 3, hc.y + 1); break;
    case 14: w.castAtPoint(buildSpell(SPELL.WallOfEarth, r.data.spells?.[String(SPELL.WallOfEarth)], 40), hc.x, hc.y + 4, hc.x + 1, hc.y + 7); break;
    case 15: host.setTrap(SPELL.Teleport, 30, hc.x + 5, hc.y + 5, hc.x + 5, hc.y + 5, hc.x + 8, hc.y + 8); break;
    case 21: { const e = nearestEnemy(r, 30) ?? sc[0]; if (e) w.command(h, { type: "cast", spell: scroll(r, "fb", SPELL.Fireball), target: e.id }); break; }
    case 24: if (sc[0]) host.setUnitParameter(sc[0].scriptId, 6, 0); break;                    // inconsciente (dazed/weak)
    case 26: { const ids = [...host.switches.keys()].sort((a, b) => a - b); if (ids[0] != null) host.toggleSwitch(ids[0]); break; }
    case 28: if (sc[1]) w.phaseOut(sc[1]); break;                                                // fora de fase
    case 30: if (sc[2] && sc[3]) host.polymorph(sc[2].scriptId, sc[3].scriptId); break;          // ids/grupos trocam de unidade
    case 32: { const g = [...host.groups].filter(([, l]) => l.length && !l.includes(h)).map(([k]) => k).sort((a, b) => a - b)[0]; if (g != null) host.suspendGroup(g); break; }
    case 34: { const g = [...host.groups].filter(([, l]) => l.length > 1 && l.every(u => u.player !== 1)).map(([k]) => k).sort((a, b) => a - b)[1]; if (g != null) host.groupCommand(g, { type: "patrol", x: hc.x + 6, y: hc.y }); break; }
    case 36: if (sc[4]) w.setDiplomacy(sc[4].player, 1, w.diplomacyValue(sc[4].player, 1) === 1 ? 0 : 1); break;
    case 38: if (sc[5] && sc[5].alive) { w.kill(sc[5], h); w.addLoot(hc.x + 1, hc.y, 10, ["3654"]); } break; // cadáver + saco
    case 40: h.gold += 50; h.items.push("3654"); h.exp += 25; break;
    case 42: { const ig = host.units.get(10002), di = host.units.get(10003); if (ig) ig.ai = { type: "hold" }; if (di) { di.home = { x: di.cx, y: di.cy }; di.ai = { type: "guard", range: 8 }; } break; }
    case 44: host.castSpellOnUnit(hc.x, hc.y + 2, h.scriptId, SPELL.Bless, 30); host.castSpellOnUnit(hc.x, hc.y + 2, h.scriptId, SPELL.Haste, 30); break; // buffs com duração
    case 46: if (sc[6]) host.castSpellOnUnit(hc.x, hc.y, sc[6].scriptId, SPELL.Slow, 30); break;
    case 48: w.playerAi[1]!.autocast = 0x18; w.playerAi[1]!.retreat = 1; break;
    case 50: host.setBuildingHealth([...host.buildingHp.keys()][0] ?? -1, 55); break;
    default:
      if (t === plan.save + 6) { const ids = [...host.switches.keys()].sort((a, b) => a - b); if (ids[1] != null) host.toggleSwitch(ids[1]); else if (ids[0] != null) host.toggleSwitch(ids[0]); }
      if (t === plan.save + 9) w.castAtPoint(buildSpell(SPELL.WallOfFire, r.data.spells?.[String(SPELL.WallOfFire)], 30), h.x, h.y, hc.x - 2, hc.y - 2);
      if (t === plan.save + 12) { const e = nearestEnemy(r, 30); if (e) w.command(h, { type: "cast", spell: scroll(r, "fb", SPELL.Fireball), target: e.id }); }
  }
}

/** Política determinística do "jogador" (função só do estado e do tique). */
function drive(r: Run, plan: Plan): void {
  const w = r.b.world, h = r.b.hero, t = w.tick;
  for (const u of w.units) if (u.player === 1 && u.alive && u.hp < u.maxHp * 0.5) u.hp = Math.round(u.maxHp * 0.95);   // (hero morto pela magia de teste não conta)   // mantém o grupo vivo
  pokes(r, t, plan);
  if (t > 60 && t % 40 === 0 && !plan.quiet) {
    const e = nearestEnemy(r, 14);
    if (e && h.alive) w.command(h, { type: "attack", target: e.id });
  }
  if (t > 60 && t % 120 === 0 && h.alive && !plan.quiet) {
    const sc = sorted(r).filter(u => u.alive);
    const t0 = sc[Math.floor(t / 120) % Math.max(1, sc.length)];
    if (t0) w.teleport(h, t0.cx + 2, t0.cy);           // chega perto de cada ponto do script (dispara gatilhos de distância e combates)
  }
}

const DEBUG = proc.argv.includes("-d");
function step(r: Run, plan: Plan): void {
  drive(r, plan);
  if (DEBUG && r.b.world.tick % 10 === 0 && r.b.world.tick >= plan.save - 80 && r.b.world.tick <= plan.save + 20) { const h = r.b.hero; console.log(`    t=${r.b.world.tick} hero ${h.state}/${h.order.type} cast=${h.castSpell?.id} hp=${Math.round(h.hp)}/${h.maxHp} mana=${Math.round(h.mana)} dyn=${r.b.world.units.filter(u => u.dynamic).length} out=${JSON.stringify(r.outcome)}`); }
  r.b.world.step();
  r.b.runtime?.update(0.05);
  r.b.world.events.length = 0;
}

// ------------------------------------------------------------------------------------------- ida e volta
function uiOf(r: Run): MissionUiState { return { objectives: [...r.subs], messages: [...r.messages], elapsedMs: r.b.world.tick * 50, cam: { x: 0, y: 0 }, zoom: 1, gold: r.gold }; }

function restoreFrom(r0: Run, text: string, hero: HeroState, companions: number[], mutate?: (s: MissionSnapshot) => void): { r: Run; err?: unknown } {
  const c = startRun(r0.data, JSON.parse(JSON.stringify(hero)) as HeroState, undefined, { companions });
  const snap = JSON.parse(text) as MissionSnapshot;
  mutate?.(snap);
  try {
    const ui = restoreMission(c.b, snap);
    c.messages = [...ui.messages]; c.subs = new Map(ui.objectives); c.gold = Number(ui.gold ?? 0);
    c.outcome = null;
    return { r: c };
  } catch (err) { return { r: c, err }; }
}

const CHECK = 25;

async function mission(id: number, save = 300, more = 400): Promise<void> {
  console.log(`\n=== Missão ${id}: salvar no tique ${save}, +${more} tiques nos dois ===`);
  const data = await loadData(id);
  const companions = id >= 30 ? BOTH : [];
  const hero = heroOf(true, true);
  const plan: Plan = { id, save, more, quiet: id === 77 };       // 77: os guardas matam a missão (falha 7) ao ver o grupo; o piloto fica parado para ela seguir viva
  const a = startRun(data, JSON.parse(JSON.stringify(hero)) as HeroState, undefined, { companions });
  while (a.b.world.tick < save && !a.outcome) step(a, plan);
  if (a.outcome) { console.log(`  (desfecho antes do save: ${JSON.stringify(a.outcome)}; seguindo mesmo assim)`); a.outcome = null; }
  const snap = snapshotMission(id, a.b, uiOf(a));
  const text = JSON.stringify(snap);
  const w = a.b.world;
  const sw = [...a.b.host.buildingHp].filter(([k]) => a.b.host.switches.has(k)).map(([k, v]) => `${k}=${v}`).join(",");
  const poly = [...a.b.host.units].filter(([k, u]) => u.scriptId !== k && k < 10000).length;
  console.log(`  cobertura: ${poly} ids polimorfados, ${w.units.filter(u => u.phased).length} fora de fase, ${w.units.filter(u => u.suspended).length} suspensas, ${w.units.filter(u => u.state === "dead").length} mortas, ${w.units.reduce((n, u) => n + u.buffs.length, 0)} efeitos, ${w.units.filter(u => u.castSpell).length} lançando`);
  console.log(`  snapshot v${snap.v}: ${(text.length / 1024).toFixed(0)} KB, ${snap.world.units.length} unid. (${w.units.filter(u => u.dynamic).length} invocadas), ${snap.world.areas?.length ?? 0} áreas, ${snap.world.traps?.length ?? 0} armadilhas, `
    + `${snap.world.projectiles.length} projéteis, ${snap.world.loot.length} sacos, ${a.b.host.dazed.size} inconscientes, ${a.messages.length} falas${sw ? `, alavancas ${sw}` : ""}`);
  const { r: b, err } = restoreFrom(a, text, hero, companions);
  check(!err, `restore sem erro${err ? `: ${String(err)}` : ""}`);
  if (err) return;
  const d0 = firstDiff(dump(a), dump(b));
  check(!d0, `estado completo idêntico logo após o restore${d0 ? ` — ${where(a, d0)}` : ""}`);
  const msgsAtSave = a.messages.length, subsAtSave = [...a.subs];
  let div: string | null = null, at = -1;
  for (let i = 0; i < more && !div; i++) {
    step(a, plan); step(b, plan);
    if ((i + 1) % CHECK === 0 || i === more - 1) { const d = firstDiff(dump(a), dump(b)); if (d) { div = where(a, d); at = a.b.world.tick; } }
  }
  check(!div, `original e restaurado idênticos por mais ${more} tiques${div ? ` — divergiram até o tique ${at}: ${div}` : ""}`);
  check(JSON.stringify(a.messages.slice(msgsAtSave)) === JSON.stringify(b.messages.slice(msgsAtSave)), `mesmas falas depois do save (${a.messages.length - msgsAtSave})`);
  check(JSON.stringify([...a.subs].sort()) === JSON.stringify([...b.subs].sort()), `mesmos subobjetivos (${[...a.subs].length}, antes do save ${subsAtSave.length})`);
  check(a.gold === b.gold && JSON.stringify(a.outcome) === JSON.stringify(b.outcome), `mesmo ouro do script e desfecho (${JSON.stringify(a.outcome)})`);
  const sa = JSON.stringify(snapshotMission(id, a.b, uiOf(a))), sb = JSON.stringify(snapshotMission(id, b.b, uiOf(b)));
  check(sa === sb, "snapshots finais idênticos (serialização estável)");

  // controle negativo + migração: um save v1 (sem o estado do host) deve carregar sem erro, mas perde as alavancas/inconscientes — o comparador tem de enxergar
  const v1 = restoreFrom(a, text, hero, companions, s => {
    s.v = 1; delete (s.host as { buildingHp?: unknown }).buildingHp; for (const k of ["dazed", "weak", "mapDazed", "units", "groups"]) delete (s.host as unknown as Record<string, unknown>)[k];
    for (const u of s.world.units) { delete u.tmp; delete u.castDef; }
  });
  check(!v1.err, `save v1 (sem host/tmp/castDef) migra e carrega sem erro${v1.err ? `: ${String(v1.err)}` : ""}`);
  if (!v1.err && snap.world.tick === save) {
    const lost = [...a.b.host.buildingHp].some(([k, v]) => v1.r.b.host.buildingHp.get(k) !== v);
    const dz = a.b.host.dazed.size > 0 || a.b.host.units.size > 0;
    console.log(`  info: save v1 ${lost ? "perde a vida das estruturas (esperado)" : "sem diferença de estruturas nesta missão"}`);
    check(dz, "controle negativo: dump compara host.units/dazed (conjuntos não vazios)");
  }
}

// ------------------------------------------------------------------------------------------- alavancas na missão 93 (o bug original)
async function levers93(): Promise<void> {
  console.log("\n=== Alavancas da missão 93: ligar, salvar, carregar ===");
  const data = await loadData(93);
  const hero = heroOf(true, true);
  const a = startRun(data, JSON.parse(JSON.stringify(hero)) as HeroState, undefined, { companions: BOTH });
  const ids = [...a.b.host.switches.keys()].sort((x, y) => x - y);
  check(ids.length === 2, `93 tem 2 alavancas (${ids})`);
  run(a, 30);
  a.b.host.toggleSwitch(ids[0]!);
  const before = ids.map(i => [a.b.host.buildingHp.get(i), a.b.host.buildingHealth(i)]);
  check(before[0]![0] === 0 && before[0]![1] === 0 && before[1]![0] === 100 && before[1]![1] === 1, `alavanca ${ids[0]} ligada (hp 0, script vê 0), ${ids[1]} desligada (hp 100, script vê 1)`);
  run(a, 25);
  const text = JSON.stringify(snapshotMission(93, a.b, uiOf(a)));
  const { r: b, err } = restoreFrom(a, text, hero, BOTH);
  check(!err, "restore sem erro");
  const after = ids.map(i => [b.b.host.buildingHp.get(i), b.b.host.buildingHealth(i)]);
  check(JSON.stringify(after) === JSON.stringify(before), `alavancas voltam iguais após carregar: ${JSON.stringify(after)}`);
  // o script enxerga a mesma coisa depois de rodar
  run(a, 60); run(b, 60);
  check(firstDiff(dump(a), dump(b)) === null, "script/mundo idênticos 60 tiques depois");
  const v1 = restoreFrom(a, text, hero, BOTH, s => { s.v = 1; delete (s.host as { buildingHp?: unknown }).buildingHp; });
  check(v1.r.b.host.buildingHp.get(ids[0]!) === 100, "controle negativo: sem buildingHp (save v1) a alavanca ligada volta ao estado do mapa");
}

// ------------------------------------------------------------------------------------------- equipamento trocado na missão
async function heroRefresh(): Promise<void> {
  console.log("\n=== Herói com equipamento trocado na missão (refreshHero) ===");
  const data = await loadData(10);
  const hero = heroOf(false, false);
  const a = startRun(data, JSON.parse(JSON.stringify(hero)) as HeroState);
  run(a, 40);
  hero.equipment = { ...hero.equipment, bracers: "6420", boots: "3102" };       // outro item (não muda o sprite); como a cena: refreshHero + save do herói atual
  refreshHero(a.b.hero, hero, data);
  run(a, 20);
  const text = JSON.stringify(snapshotMission(10, a.b, uiOf(a)));
  const { r: b, err } = restoreFrom(a, text, hero, []);
  check(!err, "restore sem erro");
  const d = firstDiff(dump(a), dump(b));
  check(!d, `herói reconstruído do save (equipamento novo) + restore idêntico (stats/vida/mana)${d ? ` — ${d}` : ""}`);
}

const only = proc.argv.slice(2).map(Number).filter(Boolean);   // ids das missões a rodar; "-d" imprime o herói a cada 10 tiques perto do save
for (const id of [10, 20, 30, 53, 62, 77, 93, 103]) if (!only.length || only.includes(id)) await mission(id);
if (!only.length || only.includes(93)) await levers93();
if (!only.length) await heroRefresh();
const code = summary();
if (code) proc.exitCode = code;
