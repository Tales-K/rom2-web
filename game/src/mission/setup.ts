/**
 * Carrega os dados de uma missão e monta o `World` + `ScriptRuntime`.
 * Fontes (todas opcionais exceto o mapa): docs/DATA.md. Ordem de preferência para cada informação:
 *   ids/grupos de script: maps/<n>.json units[] (MAPAS-RE) > scripts/<n>.json units[] > assets/ui/hud/missions/<n>.json (pipeline MISSÃO)
 *   diplomacia: maps players[].diplomacy > missions/<n>.json (bloco 5) > padrão
 *   atributos: map-unit-templates + unit-templates > unit-stats > tabela provisória (sim/stats.ts)
 */
import { parseScript, ScriptRuntime, type Script } from "../script";
import type { Game } from "../core/game";
import type { HeroState } from "../core/state";
import { Grid, type MapLike, type TerrainTable } from "../sim/grid";
import { heroDerived, heroStartSkillExp, skillFromExp, statsFor, type HeroAttrs, type HeroItem, type StatsTable, type TemplateJson } from "../sim/stats";
import { TICKS_PER_SEC, type UnitStats } from "../sim/types";
import { World, type SpellDef, type Unit } from "../sim/world";
import { buildSpell, type SpellJsonLike, type SpellTable } from "../sim/spells";
import { ANIM_BASE, timingFor, type AnimTable } from "./animTiming";
import { MissionHost, type HostCallbacks } from "./host";

export interface MissionMeta {
  diplomacy: number[][];
  units: { id: number; npc: number }[];
}

export interface ItemDef extends HeroItem {
  id?: number; name?: string; kind?: string; usableBy?: string[]; price?: number; weight?: number; effectsText?: string;
  mods?: Record<string, number>; [k: string]: unknown;
}
export interface SpellJson {
  id?: number; name?: string; school?: string; manaCost?: number; damage?: { min: number; max: number }; range?: number;
  defensive?: boolean; description?: string; [k: string]: unknown;
}
interface ClassJson {
  label?: string; mage?: boolean; female?: boolean; attributes: HeroAttrs; skills?: Record<string, number>; startSpells?: number[];
  weaponSpell?: number | null; startItems?: { id: number; name: string; mods?: Record<string, number> }[];
}
export interface ClassesJson { classes: Record<string, ClassJson>; }

export interface MapUnitJson {
  x: number; y: number; kind: number; player: number; id?: number; group?: number | null; direction?: number; serverId?: number;
  bag?: number; quest?: { noXp?: boolean }; [k: string]: unknown;
}
export interface MapJson extends MapLike {
  name: string;
  units: MapUnitJson[];
  players: { id: number; name: string; diplomacy?: number[]; [k: string]: unknown }[];
  bags?: { unit: number; x: number; y: number; money: number; items: { item: number }[] }[];
  signposts?: { structure: number; enabled: boolean; actionIndex: number; action?: number }[];
  music?: { x: number; y: number; radius: number; themes: number[] }[];
  musicDefault?: number[];
  heroEntry?: { x: number; y: number }[];
  groups?: { id: number; units: number[] }[];
  /** bloco 9 do .alm: armadilhas/magias de item; `p1` = magia, `p2` = poder, `entries` = pontos (x, 0x2376 << 16 | y) */
  effects?: { x: number; y: number; p1: number; p2: number; entries?: [number, number][] }[];
}

export interface MissionData {
  id: number;
  map: MapJson;
  objects: Record<string, { name: string; w: number; h: number }>;
  structures: Record<string, { name: string; w: number; h: number; tw: number; th: number }>;
  unitsStatic: Record<string, { name: string; w: number; h: number; cx: number; cy: number }>;
  anim: AnimTable;
  terrain?: TerrainTable;
  meta?: MissionMeta;
  script?: Script;
  stats?: StatsTable;
  templates?: StatsTable;
  mapTemplates?: { serverId: number; level: number; kind: number }[];
  items?: Record<string, ItemDef>;
  spells?: Record<string, SpellJson>;
  classes?: ClassesJson;
  texts?: { sections: Record<string, { tags: Record<string, unknown>; text: string }[]> };
  terrainNames: string[];
}

/** `game` só precisa de `data.getJson/tryJson` (o teste headless passa um leitor de arquivos, sem Pixi). */
export async function loadMissionData(game: { data: Pick<Game["data"], "getJson" | "tryJson"> }, id: number): Promise<MissionData> {
  const d = game.data;
  const [map, objects, structures, unitsStatic, anim, terrain, meta, stats, templates, mapTemplates, items, spells, classes, texts, index] = await Promise.all([
    d.getJson<MapJson>(`data/maps/${id}.json`),
    d.tryJson<MissionData["objects"]>("data/objects.json"),
    d.tryJson<MissionData["structures"]>("data/structures.json"),
    d.tryJson<MissionData["unitsStatic"]>("data/units.json"),
    d.tryJson<AnimTable>(`${ANIM_BASE}units.json`),
    d.tryJson<TerrainTable>("assets/ui/hud/terrain.json"),
    d.tryJson<MissionMeta>(`assets/ui/hud/missions/${id}.json`),
    d.tryJson<StatsTable>("data/unit-stats.json"),
    d.tryJson<StatsTable>("data/unit-templates.json"),
    d.tryJson<Record<string, { serverId: number; level: number; kind: number }[]>>("data/map-unit-templates.json"),
    d.tryJson<Record<string, ItemDef>>("data/items.json"),
    d.tryJson<Record<string, SpellJson>>("data/spells.json"),
    d.tryJson<ClassesJson>("data/classes.json"),
    d.tryJson<MissionData["texts"]>(`data/texts/mission${id}.json`),
    d.tryJson<{ terrain: string[] }>("data/index.json"),
  ]);
  // estruturas 16777249 (0x1000021, missões 42 e 52): bit alto 0x1000000 + tipo 33 (Vertical Wooden Bridge); o tipo é o que vale (docs/GAPS.md)
  for (const st of map.structures) if (st.kind > 0xffff) st.kind &= 0xffff;
  let script: Script | undefined;
  const raw = (await d.tryJson<unknown>(`data/scripts/${id}.json`)) ?? (import.meta.env?.DEV ? await d.tryJson<unknown>(`src/script/test/fixtures/${id}.json`) : undefined);
  if (raw) {
    try { script = parseScript(raw); } catch (e) { console.warn("[missão] script inválido:", e); }
  }
  return {
    id, map, objects: objects ?? {}, structures: structures ?? {}, unitsStatic: unitsStatic ?? {}, anim: anim ?? {}, terrain, meta, script,
    stats, templates, mapTemplates: mapTemplates?.[String(id)], items, spells, classes, texts, terrainNames: index?.terrain ?? [],
  };
}

/** Herói padrão para o atalho de desenvolvimento (sem save). Atributos do "Start_MF" (classes.json). */
export function defaultHero(): HeroState {
  return {
    name: "Igles", sex: "male", heroClass: "fighter", face: 0, stats: { body: 40, mind: 25, agility: 36, spirit: 17 },
    weaponSkill: "blade", gold: 100, inventory: [{ id: "3654", count: 2 }],
    equipment: { weapon: "260", cuirass: "2067", boots: "3102", bracers: "2326", gauntlets: "2586", mail: "46863" }, spells: [], difficulty: "normal",
  };
}

const WEAPON_SPRITE: Record<string, string> = { blade: "swordsman", axe: "axeman", bludgeon: "clubman", pike: "pikeman", shooting: "archer" };

export function heroSpriteKey(h: HeroState, anim: AnimTable, items?: Record<string, ItemDef>): string {
  const w = h.equipment?.weapon ? items?.[h.equipment.weapon] : undefined;
  const shield = !!h.equipment?.shield;
  let want: string;
  if (h.heroClass === "mage") want = w?.casterWeapon || !w ? "hero_mage_st" : "hero_mage";
  else {
    const t = w?.attackType ?? h.weaponSkill ?? "blade";
    const base = WEAPON_SPRITE[t] ?? "swordsman";
    want = `hero_${base}${shield && anim[`hero_${base}_`] ? "_" : w?.twoHanded && anim[`hero_${base}2h`] ? "2h" : ""}`;
    if (t === "shooting" && /cross/i.test(String(w?.name ?? ""))) want = "hero_xbowman";
  }
  for (const k of [want, h.heroClass === "mage" ? "hero_mage" : "hero_swordsman", "3"]) if (anim[k]) return k;
  return want;
}

function classKey(h: HeroState): string { return `${h.sex === "female" ? "female" : "male"}_${h.heroClass === "mage" ? "mage" : "fighter"}`; }

/** Campos extras que a cena de missão grava no herói (fora do contrato de core/state.ts; pedido em docs/REQUESTS.md). */
export type HeroExtra = HeroState & { exp?: number; skillExp?: Record<string, number> };

/** Experiência por habilidade: a do save, ou a inicial do original (`heroStartSkillExp`: 20 no alinhamento + 10 em
 *  Shooting/Astral [exe 0x514f59], pedido da MOTOR-C — dá Health 142 ao guerreiro Aldor, como na captura do original). */
export function heroSkillExp(h: HeroState, _data?: MissionData): Record<string, number> {
  const saved = (h as HeroExtra).skillExp;
  if (saved && Object.keys(saved).length) return { ...saved };
  return heroStartSkillExp(h.heroClass === "mage", heroAlignment(h));
}

export function heroAlignment(h: HeroState): string {
  return (h.heroClass === "mage" ? h.elementSkill ?? "fire" : h.weaponSkill ?? "blade");
}

function heroAttrs(h: HeroState, data: MissionData): HeroAttrs {
  const cls = data.classes?.classes[classKey(h)];
  const a: HeroAttrs = { body: h.stats.body, reaction: h.stats.agility, mind: h.stats.mind, spirit: h.stats.spirit };
  // saves antigos (atributos na escala de 1..20) caem para os atributos iniciais da classe
  return a.body < 20 && cls ? { ...cls.attributes } : a;
}

/** Atributos do herói: fórmulas [exe] (sim/stats.ts `heroDerived`) a partir de game.state.hero e do equipamento (items.json). */
export function heroStats(h: HeroState, data: MissionData): UnitStats {
  const mage = h.heroClass === "mage";
  const cls = data.classes?.classes[classKey(h)];
  const items: HeroItem[] = [];
  for (const [slot, id] of Object.entries(h.equipment ?? {})) {
    const it = id ? data.items?.[id] : undefined;
    if (!it) continue;
    // mods dos itens iniciais (classes.json startItems[].mods), ex.: cajado com castSpell
    const mods = cls?.startItems?.find(si => String(si.id) === String(id))?.mods;
    items.push({ ...it, slot: it.slot ?? slot, mods: mods ?? it.mods });
  }
  // peso da mochila: conta para a sobrecarga (o texto 165 de main.txt: "peso dos itens vestidos E carregados"); só o peso,
  // sem efeitos (poções/pergaminhos na mochila não dão bônus)
  const packWeight = (h.inventory ?? []).reduce((s, e) => s + (Number(data.items?.[e.id]?.weight) || 0) * Math.max(1, e.count ?? 1), 0);
  if (packWeight > 0) items.push({ weight: packWeight });
  const sx = heroSkillExp(h, data);
  const skills: Record<string, number> = {};
  for (const [k, v] of Object.entries(sx)) skills[k] = skillFromExp(v);
  const expTotal = Object.values(sx).reduce((a, b) => a + b, 0);
  return heroDerived(h.name, mage, h.sex === "female", heroAttrs(h, data), skills, expTotal, items);
}

/** Magia com o poder `power` (sim/spells.ts `buildSpell`, frente MOTOR-C: todos os 29 tipos). */
export function spellDef(id: number, s: SpellJson | undefined, power: number): SpellDef {
  return buildSpell(id, s as SpellJsonLike | undefined, power);
}

export function heroSpells(h: HeroState, data: MissionData): { spells: SpellDef[]; weaponSpell: SpellDef | null } {
  const cls = data.classes?.classes[classKey(h)];
  const mind = heroAttrs(h, data).mind;
  const sx = heroSkillExp(h, data);
  const schoolSkill = (school: string) => skillFromExp(sx[school] ?? 0);
  let ids = (h.spells ?? []).map(Number).filter(n => n > 0);
  if (!ids.length && h.heroClass === "mage") ids = cls?.startSpells ?? [24, 27];
  const spells = ids.map(n => {
    const s = data.spells?.[String(n)];
    // poder da magia lançada pelo herói: habilidadeDaEscola + Mind − 30 (mín. 0) [UA]
    return spellDef(n, s, Math.max(0, schoolSkill(String(s?.school ?? "").toLowerCase()) + mind - 30));
  });
  // cajado com castSpell (Wood Staff: Fire Arrow, poder 1): o ataque normal dispara a magia, sem gastar mana
  let weaponSpell: SpellDef | null = null;
  const wid = h.equipment?.weapon;
  const w = wid ? data.items?.[wid] : undefined;
  const mods = cls?.startItems?.find(si => String(si.id) === String(wid))?.mods ?? (w?.mods as Record<string, number> | undefined);
  const castSpell = mods?.castSpell ?? (w?.casterWeapon ? cls?.weaponSpell ?? 1 : undefined);
  if (castSpell) {
    const power = mods?.spellPower ?? 1;
    weaponSpell = { ...spellDef(castSpell, data.spells?.[String(castSpell)], power), mana: 0 };
  }
  return { spells, weaponSpell };
}

/** Multiplicadores de dificuldade [exe 0x561e20] (só unidades de IA): fácil → vida ×0,5; difícil → vida ×1,5, ataque +50, defesa +50. */
export function applyDifficulty(st: UnitStats, difficulty: string | undefined): UnitStats {
  if (difficulty === "easy") return { ...st, health: Math.max(1, Math.floor(st.health * 0.5)) };
  if (difficulty === "hard") return { ...st, health: Math.floor(st.health * 1.5), attack: st.attack + 50, defense: st.defense + 50 };
  return st;
}

export interface BuiltMission {
  world: World;
  host: MissionHost;
  runtime?: ScriptRuntime;
  hero: Unit;
  /** índice em map.units -> unidade */
  mapUnits: Unit[];
}

/** Nomes de NPC que os textos usam (os nomes de npcnames.txt para estes ids estão vazios). */
const NPC_NAMES: Record<number, string> = { 623: "Hydun the Second", 2000: "Great Mage Skrakan", 616: "Old Ogre" };

/** missões em que o script mede a distância até unidades fora de fase (marcadores invisíveis) */
export const MEASURE_PHASED = new Set([84, 93, 94, 95, 96]);

/** missão -> valor "Necro to exit" do script (seq) e o ponto de sumiço corrigido (= destino do "Group Command: Move" do necromante) */
const NECRO_EXIT_FIX: Record<number, { value: number; x: number; y: number }> = { 94: { value: 32, x: 137, y: 9 }, 96: { value: 23, x: 137, y: 9 } };

export function buildMission(data: MissionData, hero: HeroState, cb: HostCallbacks): BuiltMission {
  const map = data.map;
  const grid = Grid.fromMap(map, data.terrain, data.objects, data.structures);
  const world = new World(grid, map.players.length, 0x10a + data.id);
  const dipFromMap = map.players.every(p => Array.isArray(p.diplomacy)) ? map.players.map(p => p.diplomacy!) : undefined;
  const dip = dipFromMap ?? data.meta?.diplomacy;
  for (let a = 1; a <= map.players.length; a++) for (let b = 1; b <= map.players.length; b++) {
    world.dip[a]![b] = a === b ? 0 : dip ? (dip[a - 1]?.[b - 1] ?? 0) & 3 : (a === 1 || b === 1 ? 1 : 0);
  }
  for (const p of map.players) world.money[p.id] = 0;
  const host = new MissionHost(world, cb);
  host.spellTable = data.spells as SpellTable | undefined;
  const sUnits = data.script?.units ?? [];
  const mapUnits: Unit[] = [];
  map.units.forEach((mu, i) => {
    const kind = String(mu.kind);
    const am = data.anim[kind];
    const name = data.unitsStatic[kind]?.name ?? am?.name ?? `unit ${kind}`;
    const su = sUnits.find(s => s.index === i);
    const scriptId = mu.id ?? su?.id ?? data.meta?.units[i]?.id ?? 0;
    const npc = mu.serverId ?? data.meta?.units[i]?.npc ?? 0;
    const serverId = mu.serverId ?? data.mapTemplates?.[i]?.serverId;
    const tpl: TemplateJson | undefined = serverId != null ? data.templates?.[String(serverId)] : undefined;
    const stats = applyDifficulty(statsFor(mu.kind, name, tpl, data.stats, !!am?.Z), hero.difficulty);
    if (mu.quest?.noXp) stats.noXp = true;
    const u = world.spawn({ kind, typeId: mu.kind, player: mu.player, x: mu.x, y: mu.y, stats,
      timing: timingFor(am, stats, (tpl?.dyingTime as number | undefined)), scriptId, npc, name: NPC_NAMES[npc] ?? stats.name });
    if (typeof mu.direction === "number") u.dir = ((mu.direction - 8) % 16 + 16) % 16;
    host.bindUnit(scriptId, u);
    // vida 0 no mapa: unidade caída (refém ogro da 50, druida chefe moribundo da 101); fica com 5% da vida para que "curar" (>= 25%) a acorde, além de chegar perto
    if (mu.hp === 0) { host.dazed.add(u); host.weak.add(u); host.mapDazed.add(u); u.helpless = true; u.hp = Math.max(1, Math.round(u.maxHp * 0.05)); }
    const group = mu.group ?? su?.group;
    if (group != null) host.bindGroup(group, u);
    mapUnits.push(u);
  });
  // sacos que as unidades carregam (largados ao morrer)
  for (const b of map.bags ?? []) {
    const u = b.unit ? mapUnits.find(x => x.scriptId === b.unit) : undefined;
    if (!u) {
      // `unit: 0` = saco no chão (mapas 21, 41, 42, 43, 63, 83, 92, 93, 102): vira loot na célula, que o herói recolhe ao pisar
      world.addLoot(Math.floor(b.x), Math.floor(b.y), b.money ?? 0, (b.items ?? []).map(it => String(it.item)));
      continue;
    }
    u.gold += b.money ?? 0;
    u.items.push(...(b.items ?? []).map(it => String(it.item)));
  }
  if (!host.groups.size) {
    for (const g of map.groups ?? data.script?.groups ?? []) for (const idx of g.units) { const u = mapUnits[idx]; if (u) host.bindGroup(g.id, u); }
  }
  for (const st of map.structures) if (st.id != null) host.bindStructure(st.id, st.hp ?? 100, st.kind, st.x, st.y);
  // armadilhas Teleport do mapa (bloco 9, magia 23): gatilho em (x, y), 1ª entrada = origem e 2ª = destino, como o "Set trap" do script [est: semântica
  // deduzida dos mapas 93-96, em que os teleportes de ida/volta dos santuários só existem aqui; as de outras magias (mapa 76) continuam ignoradas]
  for (const e of map.effects ?? []) {
    if (e.p1 !== 23 || (e.entries?.length ?? 0) < 2) continue;
    const [a, b] = e.entries!;
    const sx = a![0], sy = a![1] & 0xffff, tx = b![0], ty = b![1] & 0xffff;
    if (sx === tx && sy === ty) continue; // origem = destino: marcador sem efeito
    host.setTrap(23, e.p2, e.x, e.y, sx, sy, tx, ty);
  }
  // "Polymorph unit": a forma polimorfada (parâmetro 2) só entra em cena quando a ação rodar
  for (const a of data.script?.actionList ?? []) {
    if (!/^Polymorph/i.test(a.kindName)) continue;
    const poly = host.units.get(a.params[1]?.value ?? 0);
    if (poly) world.phaseOut(poly);
  }
  // marcadores fora de fase cuja distância o script mede (MissionHost.measurePhased): Tekel (84) e as "pirâmides" dos santuários (93-96: unidades 27, 51, 50, 49)
  if (MEASURE_PHASED.has(data.id)) host.measurePhased = true;
  // necromante dos livros (94 e 96): o script o manda andar até (137,9) mas o faz sumir ("Phase out unit") a <= 1 de (134,9)/(135,9), por onde o caminho
  // (diagonal 132,13 -> 137,9; mapa idêntico nas 93-96) passa a 2 células/1 célula; nas 93 e 95 o ponto de sumiço é o destino (ou a 1 dele). O ponto do
  // "Distance from point to unit" vira o destino do movimento, para ele sair de cena como nas outras duas [est: erro de edição do script]
  const exit = NECRO_EXIT_FIX[data.id];
  const exitDist = exit && data.script?.values.get(exit.value);
  if (exit && exitDist?.params[1] && exitDist.params[2]) { exitDist.params[1].value = exit.x; exitDist.params[2].value = exit.y; }
  if (data.id === 72) host.heroItemsCountForCompanions = true; // runas: ver MissionHost.heroItemsCountForCompanions
  // missão 77 (túmulo (48,25)): na fala 10 o bom necromante "cobre" o grupo com invisibilidade (o script só espera que os guardas que aparecem durante o
  // ritual não vejam ninguém — "Skeleton attack" = falha 7); o original faz isso por magia dele, sem ação no script [est]
  if (data.id === 77) host.onMessage = n => {
    if (n !== 10) return;
    for (const u of world.units) {
      if (u.player !== 1 || !u.alive || Math.hypot(u.x - 48, u.y - 25) > 12) continue;
      u.buffs = u.buffs.filter(b => b.kind !== "invisible");
      u.buffs.push({ kind: "invisible", amount: 999, until: world.tick + 16 * TICKS_PER_SEC, spell: "ritual" });
    }
  };
  // herói no ponto de entrada
  let runtime: ScriptRuntime | undefined;
  if (data.script) runtime = new ScriptRuntime(data.script, host, { cyclePeriod: 0.5 });
  const drop = map.heroEntry?.[0] ?? runtime?.dropLocation ?? { x: Math.floor(map.w / 2), y: Math.floor(map.h / 2) };
  const hkind = heroSpriteKey(hero, data.anim, data.items);
  const hs = heroStats(hero, data);
  const h = world.spawn({ kind: hkind, typeId: 0, player: 1, x: drop.x + 0.5, y: drop.y + 0.5, stats: hs, timing: timingFor(data.anim[hkind], hs),
    scriptId: data.script?.heroUnitId ?? 10001, npc: 21, isHero: true, name: hero.name });
  const sp = heroSpells(hero, data);
  h.spells = sp.spells;
  h.weaponSpell = sp.weaponSpell;
  if (h.weaponSpell) { h.stats.range = Math.max(h.stats.range, h.weaponSpell.range); }
  h.dir = 8; // o herói do original começa virado para o norte (quadro parado 8)
  h.exp = 0;
  h.heroInfo = { mage: hero.heroClass === "mage", alignment: heroAlignment(hero), skillExp: heroSkillExp(hero, data) };
  h.ai = { type: "hold" };
  host.bindUnit(h.scriptId, h);
  return { world, host, runtime, hero: h, mapUnits };
}

/** Companheiros da campanha: id de script (10002 = Igles/"Knight", 10003 = Dina) -> template do data.bin (campaign.json npcs 22/23: 10220 Fighter_Hero, 10230 Mage_Hero). */
export const COMPANION_TEMPLATE: Record<number, { template: number; name: string }> = {
  10002: { template: 10220, name: "Igles" },
  10003: { template: 10230, name: "Dina" },
};

/** Cria uma unidade do jogador pelo template (serverId) do data.bin, ao lado do herói; devolve undefined se o template/sprite faltar. */
export function spawnFromTemplate(b: BuiltMission, data: MissionData, templateId: number, opts: { scriptId?: number; name?: string } = {}): Unit | undefined {
  const tpl = data.templates?.[String(templateId)] as (TemplateJson & { typeId?: number }) | undefined;
  if (!tpl?.typeId) return undefined;
  const kind = String(tpl.typeId);
  const stats = statsFor(tpl.typeId, String(tpl.name ?? kind), tpl, data.stats, !!data.anim[kind]?.Z);
  const u = b.world.spawn({ kind, typeId: tpl.typeId, player: b.hero.player, x: b.hero.cx, y: b.hero.cy + 1, stats,
    timing: timingFor(data.anim[kind], stats, tpl.dyingTime as number | undefined), scriptId: opts.scriptId ?? 0, name: opts.name ?? stats.name });
  if (opts.scriptId) b.host.bindUnit(opts.scriptId, u);
  return u;
}

/** Igles/Dina como unidades 10002/10003 do script (os scripts a partir da missão 30 testam distância/itens deles). */
export function spawnCompanions(b: BuiltMission, data: MissionData, scriptIds: number[]): Unit[] {
  const out: Unit[] = [];
  for (const id of scriptIds) {
    const c = COMPANION_TEMPLATE[id];
    const u = c ? spawnFromTemplate(b, data, c.template, { scriptId: id, name: c.name }) : undefined;
    if (u) out.push(u); else console.warn(`[missão] sem template para o companheiro ${id}`);
  }
  return out;
}

/** Summon [est]: o original invoca "um monstro para defender o conjurador" (criatura não decifrada); aqui lobo nível 1/2/3 pelo poder (<30 / <60 / mais). */
export function summonFactoryFor(data: MissionData): NonNullable<World["summonFactory"]> {
  return (caster, _x, _y, power) => {
    const tid = power < 30 ? 703 : power < 60 ? 704 : 705;
    const tpl = data.templates?.[String(tid)] as (TemplateJson & { typeId?: number }) | undefined;
    if (!tpl?.typeId) return undefined;
    const kind = String(tpl.typeId);
    const stats = statsFor(tpl.typeId, String(tpl.name ?? kind), tpl, data.stats, !!data.anim[kind]?.Z);
    return { kind, typeId: tpl.typeId, player: caster.player, x: caster.cx, y: caster.cy, stats,
      timing: timingFor(data.anim[kind], stats, tpl.dyingTime as number | undefined), name: stats.name };
  };
}

/**
 * Recalcula o herói já em jogo depois de mudar equipamento/mochila/atributos (inventário da missão): atributos derivados
 * (`heroDerived`), vida/mana máximas (a vida/mana atuais mantêm a proporção), magias e magia da arma. O tipo do sprite (`kind`)
 * não muda no meio da missão (as folhas de sprite são carregadas na entrada; aparece na próxima missão — docs/GAPS.md).
 * Como `stats/spells` são estáticos no snapshot (sim/snapshot.ts UNIT_STATIC) e o save guarda o herói atualizado junto, o
 * `buildMission` de um save carregado chega aos mesmos valores.
 */
export function refreshHero(u: Unit, hero: HeroState, data: MissionData): void {
  const st = heroStats(hero, data);
  const hpRatio = u.maxHp > 0 ? u.hp / u.maxHp : 1, mpRatio = u.maxMana > 0 ? u.mana / u.maxMana : 1;
  u.stats = st;
  u.maxHp = Math.max(1, st.health);
  u.maxMana = Math.max(0, st.mana);
  if (u.alive) u.hp = Math.max(1, Math.min(u.maxHp, Math.round(u.maxHp * hpRatio)));
  u.mana = Math.min(u.maxMana, Math.round(u.maxMana * mpRatio));
  const sp = heroSpells(hero, data);
  const temp = u.spells.filter(s => s.id.startsWith("scroll:"));
  u.spells = [...sp.spells, ...temp];
  u.weaponSpell = sp.weaponSpell;
  if (u.weaponSpell) u.stats.range = Math.max(u.stats.range, u.weaponSpell.range);
}

/** Companheiros da campanha cuja morte encerra a missão: Igles (10002) = causa 3, Dina (10003) = causa 4 (todas as missões 30+ têm
 *  `failure3`/`failure4` nos textos e nenhum script as dispara: "Igles is dead!", "Dina died!"; regra do exe, estimada — docs/GAPS.md). */
export const COMPANION_FAIL: Record<number, number> = { 10002: 3, 10003: 4 };

/** Regras de desfecho fora do script: herói morto → falha (texto failure2); Igles/Dina mortos → falha 3/4; unidade VIP do script morta → falha (causa 0). */
export function wireOutcome(b: BuiltMission, fail: (cause: number, who: Unit) => void): void {
  const vips = new Set(b.runtime?.vipUnits ?? []);
  b.world.onDeath = (u) => {
    if (u === b.hero) fail(2, u);
    else if (COMPANION_FAIL[u.scriptId]) fail(COMPANION_FAIL[u.scriptId]!, u);
    else if (u.scriptId && vips.has(u.scriptId)) fail(0, u);
  };
}
