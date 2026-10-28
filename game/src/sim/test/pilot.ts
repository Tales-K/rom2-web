/**
 * Utilidades comuns dos pilotos automáticos headless das missões (missions_90s.ts e seguintes): contadores de verificações, heróis das 4 variantes,
 * atalhos de unidades/grupos, teletransporte, falhas do motor (herói/Igles/Dina), textos das falas, contrato com o motor de campanha
 * (MissionResult -> onMissionResult), quem oferece a missão na taverna, lançamento de magia como o jogador (pergaminho) e pegar item do chão.
 * Os pilotos 70/80 têm cópias locais destas funções (anteriores a este arquivo); novos pilotos devem importar daqui.
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { buildSpell, spellKey } from "../spells";
import { defaultHero, spawnFromTemplate } from "../../mission/setup";
import { execConsoleLine, findTemplate, type ConsoleHost, type ConsoleResult } from "../../mission/console";
import { pickLines } from "../../mission/messages";
import { loadData, json, run, type Run } from "./loader";
import { availableMissions, availableTowns, enterLocation, innPatrons, isDone, newCampaign, onMissionResult, talkTo } from "../../campaign/engine";
import type { CampaignData, CampaignState } from "../../campaign/types";

import { TICKS_PER_SEC } from "../types";
// ------------------------------------------------------------------------------------------- verificações
let passes = 0, failures = 0;
export function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}
export function failed(msg: string): void { failures++; console.log(`  FALHOU: ${msg}`); }
/** Imprime o total e devolve o código de saída (1 se alguma verificação falhou). */
export function summary(): number { console.log(`\n${passes} ok, ${failures} falha(s)`); return failures ? 1 : 0; }

// ------------------------------------------------------------------------------------------- heróis
const classes = (await loadData(90)).classes?.classes;
/** Herói de uma das 4 variantes (classe x sexo) com os atributos iniciais de classes.json. */
export function heroOf(mage: boolean, female: boolean): HeroState {
  const h = defaultHero();
  h.sex = female ? "female" : "male"; h.heroClass = mage ? "mage" : "fighter";
  h.name = mage ? (female ? "Aldora" : "Aldor") : (female ? "Alda" : "Igles");
  const c = classes?.[`${female ? "female" : "male"}_${mage ? "mage" : "fighter"}`]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  if (mage) { h.elementSkill = "fire"; h.equipment = {}; h.spells = []; }
  return h;
}
export interface Variant { mage: boolean; female: boolean; label: string }
export const VARIANTS: Variant[] = [
  { mage: false, female: false, label: "guerreiro" }, { mage: false, female: true, label: "guerreira" },
  { mage: true, female: true, label: "maga" }, { mage: true, female: false, label: "mago" },
];
export const BOTH = [10002, 10003];

// ------------------------------------------------------------------------------------------- atalhos de unidades
export const unit = (r: Run, id: number): Unit => {
  const u = r.b.host.units.get(id);
  if (!u) throw new Error(`unidade de script ${id} inexistente`);
  return u;
};
export const group = (r: Run, g: number): Unit[] => r.b.host.groups.get(g) ?? [];
export const dist = (a: Unit, b: Unit): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distTo = (u: Unit, x: number, y: number): number => Math.hypot(u.x - x, u.y - y);
/** teletransporta `who` para ao lado da unidade de script `id` (1 célula) */
export function beside(r: Run, who: Unit, id: number): void { const t = unit(r, id); r.b.world.teleport(who, t.cx + 1, t.cy); }
export function at(r: Run, who: Unit, x: number, y: number): void { r.b.world.teleport(who, x, y); }
/** o grupo do jogador (herói, Igles, Dina e quem virar do jogador) é mantido vivo */
export const keep = (r: Run): void => { for (const u of r.b.world.units) if (u.player === 1 && u.alive) u.hp = u.maxHp; };
/** deixa o script rodar (o runtime avalia a cada 0,5 s = 10 tiques) mantendo o grupo vivo */
export const settle = (r: Run, ticks = Math.round(1.25 * TICKS_PER_SEC)): number => run(r, ticks, () => keep(r));
/** o jogador manda a unidade ficar onde está (stand ground, sem seguir o herói) */
export function hold(r: Run, u: Unit): void { u.ai = { type: "hold" }; r.b.world.command(u, { type: "none" }); }
export function killAll(r: Run, us: Unit[]): void { for (const u of us) if (u.alive) r.b.world.kill(u, r.b.hero); }
export const ofPlayer = (r: Run, p: number): Unit[] => r.b.world.units.filter(u => u.player === p && u.alive);
export const failCause = (r: Run): number | undefined => (r.outcome && !r.outcome.ok ? r.outcome.cause : undefined);
export const noUnsupported = (r: Run): boolean => !r.logs.some(l => /não implementa|não suportado/.test(l.msg));
export const sub = (r: Run, n: number): number => r.subs.get(n) ?? 0;
export const has = (r: Run, m: number): boolean => r.messages.includes(m);
export const count = (r: Run, m: number): number => r.messages.filter(x => x === m).length;

/** O grupo (herói, Igles, Dina) com vida enorme: inimigos fortes (dragões, lanceiros) matam de um golpe o herói de 55-142 PV e a Dina de 26 PV; `kill` ainda os mata. */
export function immortal(r: Run): void { for (const id of [10001, 10002, 10003]) { const u = r.b.host.units.get(id); if (u) { u.maxHp = u.hp = 100000; u.stats = { ...u.stats, healthRegen: 0 }; } } }   // sem regeneração: 0x50fc5a estouraria o short de 32767

/** Dragões e súcubos petrificam quem se aproxima (Stone Curse de chance, poder alto = pedra por muito tempo): tira a pedra do grupo para o piloto seguir.
 *  Todos os efeitos da Stone Curse (18: pedra, defesa, absorção): um que sobre mantém o bit 0x40000 em +0x144 e o despachante 0x56dca2
 *  prende a unidade na sub-ação 4. */
export function unstone(r: Run): void { for (const id of [10001, 10002, 10003]) { const u = r.b.host.units.get(id); if (u) u.buffs = u.buffs.filter(b => b.kind !== "stone" && Number(b.spell) !== 18); } }

/** Mata o herói / Igles / Dina e confere a causa de falha do motor (2 / 3 / 4) */
export function companionsFail(start: () => Run, dina = true): void {
  let r = start();
  r.b.world.kill(r.b.hero); run(r, 80);
  check(failCause(r) === 2, `herói morto: falha causa 2 (${JSON.stringify(r.outcome)})`);
  r = start(); settle(r, 5); r.b.world.kill(unit(r, 10002)); run(r, 30);
  check(failCause(r) === 3, `Igles morto: falha causa 3 (${JSON.stringify(r.outcome)})`);
  if (dina) {
    r = start(); settle(r, 5); r.b.world.kill(unit(r, 10003)); run(r, 30);
    check(failCause(r) === 4, `Dina morta: falha causa 4 (${JSON.stringify(r.outcome)})`);
  }
}

/** Toda fala disparada tem texto (seção event<N>) para o herói da variante (tags iammale/iamfemale/...) */
export function messagesHaveText(r: Run, hero: HeroState): boolean {
  const miss = r.messages.filter(n => !pickLines(r.data.texts?.sections[`event${n}`] as never, hero).length);
  if (miss.length) console.log(`    sem texto para as falas ${[...new Set(miss)].join(",")}`);
  return miss.length === 0;
}
/** A falha foi a `cause` e o texto dela (seção failure<N>) existe */
export function failedWith(r: Run, cause: number, what: string): void {
  const sec = r.data.texts?.sections[`failure${cause}`] as never;
  check(failCause(r) === cause && !!sec && pickLines(sec, defaultHero()).length > 0, `${what}: falha causa ${cause} com texto (${JSON.stringify(r.outcome)})`);
}

// ------------------------------------------------------------------------------------------- jogador: magia e pegar item
let scrollSeq = 0;
/**
 * `who` lança a magia `spell` (poder `power`, sem mana, como um pergaminho: MissionScene `scroll:<item>`) no ponto (x, y) estando em `from` (a direção
 * do lançamento define a Wall of Earth). Roda até a ordem terminar; devolve se a ordem chegou ao fim.
 */
export function castAt(r: Run, who: Unit, spell: number, power: number, x: number, y: number, from?: { x: number; y: number }): boolean {
  const w = r.b.world;
  const def = { ...buildSpell(spell, r.data.spells?.[String(spell)], power), id: `scroll:t${scrollSeq++}`, mana: 0 };
  who.spells.push(def);
  const susp = who.suspended; who.suspended = true; // a IA do aliado (autocast, defender) não atropela a ordem do jogador
  for (let i = 0; i < 80 && (who.state === "cast" || who.state === "attack" || who.cooldown > 0); i++) run(r, 1, () => keep(r)); // termina o golpe/magia automática em curso
  if (from) w.teleport(who, from.x, from.y);
  w.command(who, { type: "cast", spell: def.id, x, y });
  let i = 0;
  for (; i < 120 && who.order.type === "cast"; i++) run(r, 1, () => keep(r));
  run(r, 10, () => keep(r)); // a magia sai no quadro de lançamento
  who.spells = who.spells.filter(s => s !== def);
  who.suspended = susp;
  return who.order.type !== "cast";
}

/** Como `castAt`, mas com alvo unidade (buffs/debuffs: Invisibility, Stone Curse...). */
export function castOn(r: Run, who: Unit, spell: number, power: number, target: Unit): boolean {
  const w = r.b.world;
  const def = { ...buildSpell(spell, r.data.spells?.[String(spell)], power), id: `scroll:t${scrollSeq++}`, mana: 0 };
  who.spells.push(def);
  const susp = who.suspended; who.suspended = true;
  for (let i = 0; i < 80 && (who.state === "cast" || who.state === "attack" || who.cooldown > 0); i++) run(r, 1, () => keep(r));
  w.command(who, { type: "cast", spell: def.id, target: target.id });
  for (let i = 0; i < 120 && who.order.type === "cast"; i++) run(r, 1, () => keep(r));
  run(r, 10, () => keep(r));
  who.spells = who.spells.filter(s => s !== def);
  who.suspended = susp;
  return who.order.type !== "cast";
}

/** O jogador manda `who` pegar o saco da célula (x, y) (clique no saco = ordem "pickup" da MissionScene); roda até o item/ouro estar com ele. */
export function pickupAt(r: Run, who: Unit, x: number, y: number, maxTicks = TICKS_PER_SEC * 120): boolean {
  const w = r.b.world;
  const had = who.items.length + who.gold;
  const susp = who.suspended; who.suspended = true; // a IA do aliado não desfaz a ordem do jogador (na cena, PartyControl.order troca a IA)
  w.command(who, { type: "pickup", x, y });
  let ok = false;
  for (let i = 0; i < maxTicks && !ok; i++) {
    run(r, 1, () => keep(r));
    if (who.items.length + who.gold > had || !w.loot.some(l => l.x === x && l.y === y)) ok = true;
  }
  who.suspended = susp;
  return ok;
}

// ------------------------------------------------------------------------------------------- trapaças do console (mission/console.ts)
const cheatHosts = new WeakMap<Run, ConsoleHost & { log: string[]; mapShown: boolean }>();
/**
 * Console headless com as trapaças do original já ligadas (como depois de `##Coward`): mensagens em `log`; `#victory` = vitória do
 * motor, `#event n` = fala n (0xff = falha), `#summon` cria pelo template, magias com poder 50. Diferença da cena: qualquer herói tem
 * "livro" (o original exige livro de magias para `+spell(s)`).
 */
export function cheatHost(r: Run): ConsoleHost & { log: string[]; mapShown: boolean } {
  let h = cheatHosts.get(r);
  if (h) return h;
  let on = true;
  const host: ConsoleHost & { log: string[]; mapShown: boolean } = {
    world: r.b.world, hero: r.b.hero, playerName: r.b.hero.name, log: [], mapShown: false,
    cheats: () => on, setCheats: v => { on = v; },
    message: t => { host.log.push(t); },
    items: r.data.items as ConsoleHost["items"],
    addGold: n => { r.b.hero.gold += n; r.gold += n; },
    hasSpellbook: () => true,
    learnSpell: id => {
      const u = r.b.hero;
      if (u.spells.some(s => spellKey(s) === String(id))) return;
      const sp = buildSpell(id, r.data.spells?.[String(id)], 50);
      if (sp.kind) u.spells.push(sp);
    },
    summon: (name, n) => {
      const tid = findTemplate(r.data.templates as Record<string, unknown> | undefined, name);
      let made = 0;
      for (let i = 0; tid && i < n; i++) { const u = spawnFromTemplate(r.b, r.data, Number(tid)); if (!u) break; u.dynamic = true; made++; }
      return made;
    },
    showMap: v => { host.mapShown = v; },
    victory: () => { r.outcome ??= { ok: true, cause: 0 }; },
    event: n => { if (n === 0xff) r.outcome ??= { ok: false, cause: 0 }; else r.messages.push(n); },
  };
  cheatHosts.set(r, h = host);
  return h;
}
/** Executa uma linha do console (com as trapaças ligadas) — ex.: `cheat(r, "#create 1000 Gold")`. */
export const cheat = (r: Run, line: string): ConsoleResult => execConsoleLine(cheatHost(r), line);
/** `#modify self|army +god`: proteções e resistências físicas 100 (sem dano) */
export const godMode = (r: Run, army = false): ConsoleResult => cheat(r, `#modify ${army ? "army" : "self"} +god`);
/** `#victory`: encerra a missão com vitória */
export const victory = (r: Run): ConsoleResult => cheat(r, "#victory");
/** `#show map` */
export const showMap = (r: Run): ConsoleResult => cheat(r, "#show map");
/** `#create <n> Gold` */
export const giveGold = (r: Run, n: number): ConsoleResult => cheat(r, `#create ${n} Gold`);
/** `#modify self +spells` (magias 1..29) */
export const giveSpells = (r: Run): ConsoleResult => cheat(r, "#modify self +spells");

// ------------------------------------------------------------------------------------------- contrato com o motor de campanha
export const campaignData = json<CampaignData>("data/campaign.json")!;
/** O que a MissionScene manda no MissionResult: variáveis de cenário alteradas pelo script (menos as semeadas) + subobjetivos em 752+n. */
export function sceneVars(r: Run, seeded: Record<number, number> = {}): Record<string, number> {
  const v: Record<string, number> = {};
  for (const [k, x] of r.b.host.scenarioVars) if (seeded[k] !== x) v[String(k)] = x;
  for (const [n, x] of r.subs) v[String(752 + n)] = x;
  return v;
}
/** Campanha de um herói (mago?, mulher?) jogada pelo caminho mais curto até a missão `m` ficar disponível (conversas na taverna incluídas). */
export function campaignUpTo(m: number, mage: boolean, female: boolean, skip: number[] = []): CampaignState {
  const st = newCampaign(campaignData, { mage, female }, 1);
  for (let i = 0; i < 120 && !availableMissions(st).includes(m); i++) {
    for (const t of availableTowns(st)) { enterLocation(st, ["T", t]); for (const p of innPatrons(st, campaignData, t)) if (p.kind === 0 || p.kind === 3) talkTo(st, campaignData, p); }
    if (availableMissions(st).includes(m)) break;
    const next = availableMissions(st).sort((a, b) => a - b).find(x => !isDone(st, x) && x !== m && !skip.includes(x));
    if (next == null) break;
    onMissionResult(st, campaignData, { id: next, outcome: "complete" });
  }
  return st;
}
/**
 * Quem oferece a missão `m` na taverna: o NPC cuja conversa a põe no mapa (ids de campaign.json npcs), ou undefined se nunca é oferecida.
 * Mesmo caminho de `campaignUpTo`, mas conversando com um frequentador de cada vez e olhando quando `m` aparece.
 */
export function offeredBy(m: number, mage: boolean, female: boolean): number | undefined {
  const st = newCampaign(campaignData, { mage, female }, 1);
  for (let i = 0; i < 120; i++) {
    for (const t of availableTowns(st)) {
      enterLocation(st, ["T", t]);
      for (const p of innPatrons(st, campaignData, t)) {
        if (p.kind !== 0 && p.kind !== 3) continue;
        const before = availableMissions(st).includes(m);
        talkTo(st, campaignData, p);
        if (!before && availableMissions(st).includes(m)) return p.npc;
      }
    }
    if (availableMissions(st).includes(m)) return undefined;
    const next = availableMissions(st).sort((a, b) => a - b).find(x => !isDone(st, x) && x !== m);
    if (next == null) return undefined;
    onMissionResult(st, campaignData, { id: next, outcome: "complete" });
  }
  return undefined;
}
/** A missão `m` está disponível para o herói, o resultado `r` (vitória) a conclui e nada de estranho entra nas variáveis de cenário. */
export function campaignContract(m: number, r: Run, mage = false, female = false, seeded: Record<number, number> = {}, allowed: number[] = []): CampaignState {
  const st = campaignUpTo(m, mage, female);
  check(availableMissions(st).includes(m), `campanha: ${m} disponível para ${mage ? "mag" : "guerreir"}${female ? "a" : "o"}`);
  const vars = sceneVars(r, seeded);
  check(Object.keys(vars).every(k => Number(k) >= 752 || allowed.includes(Number(k))), `MissionResult.scenarioVars só com subobjetivos (752+n)${allowed.length ? ` e ${allowed.join(",")}` : ""}: ${JSON.stringify(vars)}`);
  onMissionResult(st, campaignData, { id: m, outcome: "complete", scenarioVars: vars });
  check(isDone(st, m) && !availableMissions(st).includes(m), `campanha: ${m} concluída pelo MissionResult`);
  return st;
}
