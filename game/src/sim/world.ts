/**
 * Mundo da simulação: unidades, projéteis, áreas de magia, sacos de loot, diplomacia, combate, magias e ordens. Passo fixo
 * (TICK_MS = 50 ms, 20 Hz), determinístico (toda aleatoriedade via `Rng`), sem dependência de PixiJS/DOM. A apresentação lê o
 * estado e consome `events`. A IA (o que cada unidade decide sozinha) fica em `ai.ts`; a montagem das magias/parâmetros de IA a
 * partir dos dados, em `behaviors.ts`. Fontes e aproximações: README.md desta pasta e notes/ai-behaviors.md.
 */
import { BLOCK_SPELL, BLOCK_STRUCTURE, Grid } from "./grid";
import { skillExp, skillFromExp } from "./stats";
import { findPath, lineOfSight } from "./path";
import { Rng } from "./rng";
import { aiThink, heroThink } from "./ai";
import { SPELL, spellKey, spellLayer, type BuffKind, type SpellDef, type SpellEffect, type SpellTable } from "./spells";
import {
  DIP_ALLY, DIP_WAR, TICK_MS, TICKS_PER_SEC, dirFromDelta,
  type Cell, type Order, type SimEvent, type UnitState, type UnitStats,
} from "./types";

export type { SpellDef } from "./spells";

/** Tempos de animação por tipo (em ticks), vindos do layout dos sprites. */
export interface AnimTiming {
  attackTicks: number;
  /** tick (dentro do ataque) em que o golpe acerta / o projétil sai */
  hitTick: number;
  attackDelay: number;
  dyingTicks: number;
}

/** Comportamento padrão dado pelo script (comando de grupo), pelo mapa ou pela cena (mercenários). */
export type AiMode =
  | { type: "guard"; range: number }
  | { type: "hold" }
  | { type: "move"; x: number; y: number }
  | { type: "swarm"; x: number; y: number }
  | { type: "defend"; unit: number; range: number }
  | { type: "follow"; unit: number; range: number }
  | { type: "patrol"; x: number; y: number }
  | { type: "roam"; range: number };

export interface UnitInit {
  kind: string;
  typeId: number;
  player: number;
  x: number;
  y: number;
  stats: UnitStats;
  timing: AnimTiming;
  name?: string;
  scriptId?: number;
  npc?: number;
  isHero?: boolean;
}

/** Efeito temporário numa unidade (`until` em tiques). Shield antigo = `absorption`. */
export interface Buff {
  kind: BuffKind;
  amount: number;
  until: number;
  /** id da magia (ou "aura" das áreas) */
  spell: string;
  /** quem lançou (id) */
  from?: number;
  /** Control Spirit: dono original */
  data?: number;
}

/** Magia de chance no golpe ("Spell N / Probability N" do template). */
export interface ProcSpell { spell: SpellDef; chance: number; }

/** Classe de IA para recuo/fuga [exe 0x57382c]: 0 corpo a corpo, 1 à distância, 2 conjurador. */
export type AiClass = 0 | 1 | 2;

/** Mínimo do raio de guarda (ai.reg Scanning/MinimalGuardRange = 8; padrão do exe 10) [exe 0x56839b, 0x5709d9]. */
export const MINIMAL_GUARD_RANGE = 8;

/** Tipos de unidade "espírito/morto-vivo" que Control Spirit (Animate Dead) controla [est]. */
export const UNDEAD_TYPES = new Set([69, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]);

export class Unit {
  readonly id: number;
  readonly kind: string;
  readonly typeId: number;
  player: number;
  stats: UnitStats;
  timing: AnimTiming;
  name: string;
  scriptId: number;
  npc: number;
  isHero: boolean;
  hp: number;
  mana: number;
  maxHp: number;
  maxMana: number;
  /** posição contínua em células (centro da célula = x + 0.5) */
  x: number;
  y: number;
  /** célula ocupada */
  cx: number;
  cy: number;
  dir = 0;
  state: UnitState = "idle";
  /** ticks desde a última troca de estado */
  stateTime = 0;
  /** ticks acumulados andando (para a animação de passo) */
  walkTime = 0;
  path: Cell[] = [];
  pathGoal: Cell | null = null;
  waitTicks = 0;
  repathIn = 0;
  order: Order = { type: "none" };
  ai: AiMode = { type: "guard", range: MINIMAL_GUARD_RANGE };
  home: Cell;
  target = 0;
  cooldown = 0;
  hitDone = false;
  phased = false;
  suspended = false;
  /** inconsciente ("vida 0" do script: ogro meio morto da missão 74, refém da 50): a IA não o escolhe como alvo nem ataca */
  helpless = false;
  lastAttacker = 0;
  lastHurtTick = -9999;
  castSpell: SpellDef | null = null;
  /** ponto-alvo da magia em lançamento (magias de área/teleporte) */
  castX = 0;
  castY = 0;
  /** a magia em lançamento foi decidida pela IA/autocast (não gasta a ordem do jogador) */
  castAuto = false;
  exp = 0;
  spells: SpellDef[] = [];
  /** magia disparada pela arma (cajado com castSpell): o ataque normal vira projétil mágico sem gastar mana */
  weaponSpell: SpellDef | null = null;
  /** magias lançadas no lugar do golpe com chance % [exe 0x56acc8] (montadas em behaviors.ts) */
  procSpells: ProcSpell[] = [];
  gold = 0;
  items: string[] = [];
  regenAcc = 0;
  manaAcc = 0;
  /** último tique em que a unidade agiu (andou/atacou/lançou) — regeneração ×3 quando descansa */
  lastActionTick = 0;
  /** efeitos temporários (Shield, Bless, Haste, Slow, Curse, Stone Curse, Invisibility, proteções, veneno...) */
  buffs: Buff[] = [];
  /** só o herói: alinhamento e experiência acumulada por habilidade (arma/escola) */
  heroInfo?: { mage: boolean; alignment: string; skillExp: Record<string, number> };
  /** classe de IA (recuo): 0 corpo a corpo, 1 à distância, 2 conjurador [exe 0x57382c] */
  aiClass: AiClass = 0;
  /** vida (absoluta) abaixo da qual recua de inimigos a ≤ 2 células (Withdraw) [exe 0x56cd11] */
  withdrawHp = 0;
  /** vida (absoluta) abaixo da qual foge de inimigos a ≤ raio de guarda + 5 (Wimpy) [exe 0x56cb0c] */
  wimpyHp = 0;
  /** destino da fuga/recuo em andamento */
  fleeX = -1;
  fleeY = -1;
  /** alerta do grupo: inimigo que atacou um companheiro (tique) */
  alertTarget = 0;
  alertTick = -9999;
  /** posição na formação atrás do líder (-1 = sem formação) */
  formationSlot = -1;
  /** ordem a retomar quando o alvo atual morrer (patrulha/guarda interrompidas por um ataque automático) */
  resume: Order | null = null;
  /** criada durante a missão (invocação): o snapshot guarda os dados estáticos dela */
  dynamic = false;

  constructor(id: number, init: UnitInit) {
    this.id = id;
    this.kind = init.kind;
    this.typeId = init.typeId;
    this.player = init.player;
    this.stats = init.stats;
    this.timing = init.timing;
    this.name = init.name ?? init.stats.name;
    this.scriptId = init.scriptId ?? 0;
    this.npc = init.npc ?? 0;
    this.isHero = !!init.isHero;
    this.maxHp = this.hp = Math.max(1, init.stats.health);
    this.maxMana = this.mana = Math.max(0, init.stats.mana);
    this.cx = Math.floor(init.x); this.cy = Math.floor(init.y);
    this.x = this.cx + 0.5; this.y = this.cy + 0.5;
    this.home = { x: this.cx, y: this.cy };
  }

  get alive(): boolean { return this.state !== "dying" && this.state !== "dead"; }
  /** presente no mapa (vivo e não "phased out") */
  get active(): boolean { return this.alive && !this.phased; }
  get flying(): boolean { return !!this.stats.flying; }
  hasBuff(kind: BuffKind): boolean { return this.buffs.some(b => b.kind === kind); }
}

export interface Projectile {
  id: number;
  from: number;
  /** unidade-alvo (0 = ponto no chão: tx, ty) */
  to: number;
  x: number;
  y: number;
  speed: number;
  kind: string;
  spell: SpellDef | null;
  done: boolean;
  /** ponto-alvo (células, centro) quando `to` = 0 */
  tx?: number;
  ty?: number;
}

/** Área de magia no chão (Wall of Fire, Poison Cloud, Blizzard, Light, Darkness, Wall of Earth). Dados simples (vão no snapshot). */
export interface SpellArea {
  id: number;
  spell: string;
  kind: "field" | "wall";
  /** quem lançou (id; pode já ter morrido) e o jogador dele */
  owner: number;
  player: number;
  x: number;
  y: number;
  radius: number;
  /** tique em que some; próximo tique de efeito e período (tiques) */
  until: number;
  next: number;
  period: number;
  min: number;
  max: number;
  element: string;
  effects: SpellEffect[];
  /** Wall of Earth: células bloqueadas (índices da grade) */
  cells?: number[];
}

export interface Loot { id: number; x: number; y: number; gold: number; items: string[]; }

/** Ajustes de IA por jogador (Game Options do original, mensagem 0x46 ao servidor) [exe 0x4f67d5]. */
export interface PlayerAi {
  /** Formation Mode: 0 desligado, 1 automático, 2 ligado */
  formation: number;
  /** Retreat Mode ("WimpyMode"): 0 nunca, 1 vida baixa (10%), 2 vida média (30%) */
  retreat: number;
  /** AutoCasting: bits 0..2 = alvos (1 próprias, 2 aliadas, 4 neutras); 8 = nível 1 (Heal/Shield), 0x10 = nível 2 (Bless/Haste),
   *  0x20 = nível 3 (proteções/Invisibility) [exe 0x56bb53, 0x56bc7b]; CTRL+U cicla 8 → 0x18 → 0x38 [exe 0x41a54a] */
  autocast: number;
}

/** Armadilha do script ("Set trap"): quem pisar perto de (x,y) recebe a magia lançada de (fromX,fromY); Teleport leva a unidade a (toX,toY). */
export interface Trap {
  x: number; y: number; spell: SpellDef; fromX: number; fromY: number; toX: number; toY: number; ready: number;
  /** unidades que chegaram à zona por outro teleporte de armadilha: só disparam esta de novo depois de sair e voltar (a pirâmide da missão 93 fica ao lado do
   *  teleporte de saída; sem isto o herói que chega pela armadilha do enigma era devolvido na hora) */
  exempt?: number[];
}

export class World {
  readonly grid: Grid;
  readonly units: Unit[] = [];
  readonly byId = new Map<number, Unit>();
  readonly projectiles: Projectile[] = [];
  readonly areas: SpellArea[] = [];
  readonly traps: Trap[] = [];
  readonly loot: Loot[] = [];
  readonly events: SimEvent[] = [];
  readonly rng: Rng;
  /** dip[a][b] = bits de diplomacia de a para b (1-based) */
  readonly dip: number[][];
  readonly money: number[];
  /** ajustes de IA por jogador (índice = jogador) */
  readonly playerAi: PlayerAi[];
  tick = 0;
  /** jogador humano (o do herói): suas unidades usam autocast/Retreat Mode em vez da IA de conjurador */
  humanPlayer = 1;
  private nextId = 1;
  /** Saco no chão da célula (mapa/script): junta com o que já houver ali. */
  addLoot(x: number, y: number, gold: number, items: string[]): void {
    let l = this.loot.find(s => s.x === x && s.y === y);
    if (!l) this.loot.push(l = { id: this.nextId++, x, y, gold: 0, items: [] });
    l.gold += gold; l.items.push(...items);
  }
  /** tabela de magias (data/spells.json) — instalada por behaviors.ts `installMissionAi` */
  spellTable?: SpellTable;
  /** invocação (Summon): a cena/behaviors fornece como criar a criatura; sem ela, Summon só avisa */
  summonFactory?: (caster: Unit, x: number, y: number, power: number) => UnitInit | undefined;
  /** chamado quando uma unidade morre (o host do script e a cena usam) */
  onDeath?: (u: Unit, killer: Unit | undefined) => void;

  constructor(grid: Grid, players: number, seed = 1234) {
    this.grid = grid;
    this.rng = new Rng(seed);
    this.dip = Array.from({ length: players + 1 }, () => new Array(players + 1).fill(0));
    this.money = new Array(players + 1).fill(0);
    this.playerAi = Array.from({ length: players + 1 }, () => ({ formation: 1, retreat: 0, autocast: 8 | 3 }));
  }

  // ------------------------------------------------------------------------------------------- unidades

  spawn(init: UnitInit): Unit {
    const u = new Unit(this.nextId++, init);
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying) ?? { x: u.cx, y: u.cy };
    u.cx = c.x; u.cy = c.y; u.x = c.x + 0.5; u.y = c.y + 0.5; u.home = { x: c.x, y: c.y };
    this.units.push(u);
    this.byId.set(u.id, u);
    this.occupy(u);
    return u;
  }

  get(id: number): Unit | undefined { return this.byId.get(id); }

  private occupy(u: Unit): void { if (!u.phased && u.alive) this.grid.occ[this.grid.idx(u.cx, u.cy)] = u.id; }
  private release(u: Unit): void {
    const i = this.grid.idx(u.cx, u.cy);
    if (this.grid.occ[i] === u.id) this.grid.occ[i] = 0;
  }

  phaseOut(u: Unit): void {
    if (u.phased) return;
    this.release(u);
    u.phased = true;
    u.path = []; u.order = { type: "none" }; u.target = 0;
    if (u.state !== "dead" && u.state !== "dying") this.setState(u, "idle");
  }

  phaseIn(u: Unit): void {
    if (!u.phased) return;
    u.phased = false;
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying, 12, u.id) ?? { x: u.cx, y: u.cy };
    u.cx = c.x; u.cy = c.y; u.x = c.x + 0.5; u.y = c.y + 0.5;
    this.occupy(u);
  }

  teleport(u: Unit, x: number, y: number): void {
    this.release(u);
    const c = this.grid.nearestFree(x, y, u.flying, 12, u.id) ?? { x, y };
    u.cx = c.x; u.cy = c.y; u.x = c.x + 0.5; u.y = c.y + 0.5;
    u.path = [];
    this.occupy(u);
  }

  // ------------------------------------------------------------------------------------------- diplomacia

  hostile(a: number, b: number): boolean { return a !== b && ((this.dip[a]?.[b] ?? 0) & DIP_WAR) !== 0; }
  /** u considera v inimigo (u ataca v por iniciativa própria) */
  isEnemy(u: Unit, v: Unit): boolean { return !u.helpless && !v.helpless && this.hostile(u.player, v.player); }
  /** v é do mesmo jogador de u ou aliado dele */
  isFriend(u: Unit, v: Unit): boolean { return u.player === v.player || ((this.dip[u.player]?.[v.player] ?? 0) & DIP_ALLY) !== 0; }
  setDiplomacy(a: number, b: number, value: number): void {
    if (!this.dip[a] || this.dip[a]![b] === undefined) return;
    const old = this.dip[a]![b]!;
    // mantém bits de visão; troca guerra/aliança
    const nv = (old & ~3) | (value === 1 ? DIP_WAR : value === 2 ? 2 : 0);
    if (nv === old) return;
    this.dip[a]![b] = nv;
    this.events.push({ type: "diplomacy", a, b, value });
  }
  /** valor de diplomacia no formato do script (0 paz, 1 guerra, 2 aliado) */
  diplomacyValue(a: number, b: number): number {
    const v = this.dip[a]?.[b] ?? 0;
    return v & DIP_WAR ? 1 : v & 2 ? 2 : 0;
  }

  // ------------------------------------------------------------------------------------------- ordens

  command(u: Unit, o: Order): void {
    if (!u.active) return;
    u.order = o;
    u.resume = null;
    u.path = []; u.pathGoal = null; u.waitTicks = 0; u.repathIn = 0;
    if (o.type === "attack") u.target = o.target;
    else if (o.type !== "cast") u.target = 0;
    if (o.type === "retreat") { u.fleeX = -1; u.fleeY = -1; }
    if (o.type === "guard") u.home = { x: o.x, y: o.y };
  }

  /** Volta à ordem interrompida (patrulha/guarda do jogador) ou fica parado. */
  resumeOrNone(u: Unit): void {
    const r = u.resume;
    this.command(u, r ?? { type: "none" });
  }

  // ------------------------------------------------------------------------------------------- laço

  step(): void {
    this.tick++;
    for (const u of this.units) {
      u.stateTime++;
      if (u.state === "dead") continue;
      if (u.state === "dying") {
        if (u.stateTime >= u.timing.dyingTicks) this.setState(u, "dead");
        continue;
      }
      if (u.phased) continue;
      if (u.buffs.length) this.expireBuffs(u);
      this.regen(u);
      if (!u.active) continue;
      if (u.cooldown > 0) u.cooldown--;
      if (this.stunned(u)) { if (u.state === "move" || u.state === "attack" || u.state === "cast") this.setState(u, "idle"); continue; }
      if ((this.tick + u.id) % 4 === 0) {
        if (u.isHero) heroThink(this, u);
        else if (!u.suspended && !u.helpless) aiThink(this, u); // caído (vida 0 do mapa/script): não age nem se cura sozinho
      }
      this.act(u);
    }
    this.stepProjectiles();
    if (this.areas.length) this.stepAreas();
    if (this.traps.length) this.stepTraps();
  }

  /** Regeneração [exe 0x50fc5a], aplicada 1×/s por unidade (recomendação da frente DADOS; o jogo chama a cada 4 tiques, rápido demais
   *  sem a taxa real do servidor): vida += 2 × vidaMax × k / healthRegen (healthRegen = PERÍODO; k = 3 se a unidade não age há 3,2 s),
   *  resto fracionário acumulado; idem mana com manaRegen. Também aplica o veneno (Poison Cloud) 1×/s. */
  private regen(u: Unit): void {
    if ((this.tick + u.id) % TICKS_PER_SEC !== 0) return;
    const poison = u.buffs.find(b => b.kind === "poison");
    if (poison) {
      const dmg = Math.max(1, Math.floor(poison.amount * (100 - this.resistOf(u, "water")) / 100 + 0.75));
      this.damage(poison.from ? this.get(poison.from) : undefined, u, dmg, "water", true);
      if (!u.alive) return;
    }
    if (u.helpless) return; // inconsciente (vida 0 do script): sem regeneração até acordar
    const k = this.tick - u.lastActionTick > 3.2 * TICKS_PER_SEC ? 3 : 1;
    const hr = u.stats.healthRegen ?? 0;
    // aproximação nossa (docs/GAPS.md): vida não regenera em combate (dano levado nos últimos 5 s)
    if (hr > 0 && u.hp < u.maxHp && this.tick - u.lastHurtTick > 5 * TICKS_PER_SEC) {
      u.regenAcc += 2 * u.maxHp * k / hr;
      const add = Math.floor(u.regenAcc);
      if (add > 0) { u.regenAcc -= add; u.hp = Math.min(u.maxHp, u.hp + add); }
    } else u.regenAcc = 0;
    const mr = u.stats.manaRegen ?? 0;
    if (mr > 0 && u.mana < u.maxMana) {
      u.manaAcc += 2 * u.maxMana * k / mr;
      const add = Math.floor(u.manaAcc);
      if (add > 0) { u.manaAcc -= add; u.mana = Math.min(u.maxMana, u.mana + add); }
    } else u.manaAcc = 0;
  }

  private expireBuffs(u: Unit): void {
    if (!u.buffs.some(b => b.until <= this.tick)) return;
    const keep: Buff[] = [];
    for (const b of u.buffs) {
      if (b.until > this.tick) { keep.push(b); continue; }
      if (b.kind === "control" && b.data) this.setOwner(u, b.data);
      if (b.spell !== "aura") this.events.push({ type: "effect", unit: u.id, spell: b.spell, kind: b.kind, on: false });
    }
    u.buffs = keep;
  }

  // ------------------------------------------------------------------------------------------- atributos efetivos

  private buffSum(u: Unit, kind: BuffKind): number {
    let s = 0;
    for (const b of u.buffs) if (b.kind === kind) s += b.amount;
    return s;
  }
  /** absorção/defesa/ataque efetivos (com efeitos temporários); a defesa cai pela metade enquanto a unidade morre [exe] */
  absorptionOf(u: Unit): number { return u.stats.absorption + this.buffSum(u, "absorption"); }
  defenseOf(u: Unit): number {
    const d = Math.max(0, u.stats.defense + this.buffSum(u, "defense"));
    return u.state === "dying" ? Math.floor(d / 2) : d;
  }
  attackOf(u: Unit): number { return u.stats.attack + this.buffSum(u, "attack"); }
  /** velocidade (células/s): Haste/Slow somam em unidades brutas do jogo (÷16, docs/DATA.md); Stone Curse = 0 */
  speedOf(u: Unit): number {
    if (u.hasBuff("stone")) return 0;
    return Math.max(0.15, u.stats.speed + this.buffSum(u, "speed") / 16);
  }
  /** visão (células): Light/Darkness e itens de scanRange */
  sightOf(u: Unit): number { return Math.max(1, u.stats.sight + this.buffSum(u, "sight")); }
  /** proteção (%) contra a escola, com Protection from X (máx. 100) */
  resistOf(u: Unit, element: string): number {
    const base = (u.stats.resist as Record<string, number>)[element] ?? 0;
    return Math.max(-100, Math.min(100, base + this.buffSum(u, `resist.${element}` as BuffKind)));
  }
  stunned(u: Unit): boolean { return u.buffs.length > 0 && u.hasBuff("stone"); }
  /** `viewer` enxerga `u`? Invisibility esconde de quem não tem "See invisible" suficiente [est: seeInvisible × 10 ≥ poder] */
  canSee(viewer: Unit, u: Unit): boolean {
    if (!u.buffs.length) return true;
    const inv = u.buffs.find(b => b.kind === "invisible");
    if (!inv) return true;
    return (viewer.stats.seeInvisible ?? 0) * 10 >= inv.amount;
  }

  private setState(u: Unit, s: UnitState): void {
    if (u.state === s) return;
    u.state = s; u.stateTime = 0;
  }

  // ------------------------------------------------------------------------------------------- consultas para a IA

  /** Inimigo visível mais próximo de `u` dentro de `radius` (células), opcionalmente medido a partir de `from`. */
  nearestEnemy(u: Unit, radius: number, filter?: (v: Unit) => boolean, from?: Cell): Unit | undefined {
    let best: Unit | undefined, bd = Infinity;
    const ox = from ? from.x + 0.5 : u.x, oy = from ? from.y + 0.5 : u.y;
    for (const v of this.units) {
      if (v === u || !v.active || !this.isEnemy(u, v) || !this.canSee(u, v)) continue;
      if (filter && !filter(v)) continue;
      const fd = (v.x - ox) ** 2 + (v.y - oy) ** 2;
      if (fd > radius * radius) continue;
      const d = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
      if (d < bd && lineOfSight(this.grid, u.cx, u.cy, v.cx, v.cy, BLOCK_STRUCTURE)) { bd = d; best = v; }
    }
    return best;
  }

  /** Há inimigo (em qualquer sentido da diplomacia) a ≤ r células? (fuga/recuo) */
  nearestEnemyAny(u: Unit, r: number): Unit | undefined {
    let best: Unit | undefined, bd = r * r;
    for (const v of this.units) {
      if (v === u || !v.active || (!this.isEnemy(u, v) && !this.isEnemy(v, u))) continue;
      const d = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
      if (d <= bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Unidades vivas num raio (células) de (x,y). */
  unitsInRadius(x: number, y: number, radius: number, filter?: (v: Unit) => boolean): Unit[] {
    const out: Unit[] = [];
    const r2 = radius * radius;
    for (const v of this.units) {
      if (!v.active) continue;
      if ((v.x - x) ** 2 + (v.y - y) ** 2 > r2) continue;
      if (filter && !filter(v)) continue;
      out.push(v);
    }
    return out;
  }

  /** Alcance de ataque efetivo [exe 0x56ac5b]: magia escolhida (se houver mana) senão a arma. */
  attackRange(u: Unit): number { return u.weaponSpell ? Math.max(u.stats.range, u.weaponSpell.range) : u.stats.range; }

  validTarget(u: Unit, id: number): boolean {
    const t = this.get(id);
    return !!t && t.active && t !== u;
  }

  // ------------------------------------------------------------------------------------------- execução das ordens

  private act(u: Unit): void {
    if (u.state === "attack" || u.state === "cast") { this.progressAttack(u); return; }
    const o = u.order;
    switch (o.type) {
      case "none":
      case "hold":
        this.stop(u);
        return;
      case "guard":
        // a IA (ai.ts) decide atacar (com volta à guarda em `resume`); sem alvo, volta ao posto [exe 0x56a5fc]
        if ((u.cx !== o.x || u.cy !== o.y) && !this.walkTo(u, o.x, o.y, 0)) this.stop(u);
        else if (u.cx === o.x && u.cy === o.y) this.stop(u);
        return;
      case "move": {
        if (o.attackMove && (this.tick + u.id) % 4 === 0) {
          const e = this.nearestEnemy(u, this.sightOf(u));
          if (e) { this.command(u, { type: "attack", target: e.id }); return; }
        }
        if (u.cx === o.x && u.cy === o.y) { this.command(u, { type: "none" }); this.stop(u); return; }
        if (!this.walkTo(u, o.x, o.y, 0)) { this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
      case "retreat": {
        if (u.fleeX < 0) {
          const c = this.fleeCell(u, Math.max(6, this.sightOf(u)));
          if (!c) { this.command(u, { type: "none" }); this.stop(u); return; }
          u.fleeX = c.x; u.fleeY = c.y;
        }
        if ((u.cx === u.fleeX && u.cy === u.fleeY) || !this.walkTo(u, u.fleeX, u.fleeY, 0)) { this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
      case "pickup": {
        if (u.cx === o.x && u.cy === o.y) { this.pickupAt(u); this.command(u, { type: "none" }); this.stop(u); return; }
        if (!this.walkTo(u, o.x, o.y, 0)) { this.pickupAt(u); this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
      case "follow": {
        const lead = this.get(o.unit);
        if (!lead || !lead.active) { this.command(u, { type: "none" }); return; }
        const slot = this.formationCell(u, lead);
        if (slot) {
          if (u.cx === slot.x && u.cy === slot.y) { this.stop(u); u.dir = lead.dir; return; }
          if (!this.walkTo(u, slot.x, slot.y, 0)) this.stop(u);
          return;
        }
        const d = Math.max(Math.abs(lead.cx - u.cx), Math.abs(lead.cy - u.cy));
        if (d <= o.range) { this.stop(u); return; }
        this.walkTo(u, lead.cx, lead.cy, o.range);
        return;
      }
      case "patrol": {
        if ((this.tick + u.id) % 4 === 0) {
          const e = this.nearestEnemy(u, this.sightOf(u));
          if (e) { const back = { ...o }; this.command(u, { type: "attack", target: e.id }); u.resume = back; return; }
        }
        const tx = o.toB ? o.bx : o.ax, ty = o.toB ? o.by : o.ay;
        if (Math.max(Math.abs(u.cx - tx), Math.abs(u.cy - ty)) <= 1) { o.toB = !o.toB; u.path = []; return; }
        this.walkTo(u, tx, ty, 1);
        return;
      }
      case "roam":
        this.stop(u);
        return;
      case "defend": {
        // acompanha quem defende; a IA (ai.ts) escolhe os alvos
        const lead = this.get(o.unit);
        const near = Math.max(1, Math.floor(o.range / 2));
        if (!lead || !lead.active || lead === u || Math.max(Math.abs(lead.cx - u.cx), Math.abs(lead.cy - u.cy)) <= near) { this.stop(u); return; }
        if (!this.walkTo(u, lead.cx, lead.cy, near)) this.stop(u);
        return;
      }
      case "attack":
      case "cast": {
        const t = o.type === "attack" ? this.get(o.target) : o.target ? this.get(o.target) : undefined;
        if (o.type === "attack" && (!t || !t.active)) { this.resumeOrNone(u); this.stop(u); return; }
        const spell = o.type === "cast" ? u.spells.find(s => s.id === o.spell) : undefined;
        if (o.type === "cast" && !spell) { this.command(u, { type: "none" }); return; }
        if (o.type === "cast" && t && !t.active) { this.command(u, { type: "none" }); this.stop(u); return; }
        const tx = t ? t.cx : (o.type === "cast" ? o.x ?? u.cx : u.cx), ty = t ? t.cy : (o.type === "cast" ? o.y ?? u.cy : u.cy);
        const range = spell ? spell.range : this.attackRange(u);
        if (this.inRange(u, tx, ty, range) && (range <= 1 || lineOfSight(this.grid, u.cx, u.cy, tx, ty, BLOCK_STRUCTURE))) {
          // chegou: termina o passo atual antes de bater
          if (u.state === "move" && (Math.abs(u.x - (u.cx + 0.5)) > 0.02 || Math.abs(u.y - (u.cy + 0.5)) > 0.02)) { this.moveStep(u); return; }
          u.path = [];
          if (tx !== u.cx || ty !== u.cy) u.dir = dirFromDelta(tx - u.cx, ty - u.cy);
          if (u.cooldown > 0) { this.stop(u); return; }
          if (spell) {
            if (u.mana < spell.mana) { if (u.isHero) this.events.push({ type: "message", text: "Not enough mana" }); this.command(u, { type: "none" }); this.stop(u); return; }
            this.beginCast(u, spell, t, tx, ty, false);
          } else {
            // magia de chance no lugar do golpe [exe 0x56acc8] (sorteada a cada golpe; ver notes/ai-behaviors.md)
            const proc = t ? this.rollProc(u, t) : null;
            if (proc && t) { this.beginCast(u, proc, t, t.cx, t.cy, true); return; }
            u.castSpell = null;
            u.target = t!.id;
            this.setState(u, "attack");
            u.lastActionTick = this.tick;
            this.breakInvisibility(u);
            this.events.push({ type: "attack", unit: u.id, target: t!.id });
          }
          u.hitDone = false;
          return;
        }
        // ainda longe: anda até ficar ao alcance
        const near = range <= 1 ? 1 : Math.max(1, Math.floor(range * 0.7));
        if (!this.walkTo(u, tx, ty, near)) { if (!u.isHero) this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
    }
  }

  /** Começa a lançar `spell` (gasta a mana já aqui). `auto` = decidida pela IA/autocast (a ordem do jogador continua). */
  beginCast(u: Unit, spell: SpellDef, t: Unit | undefined, tx: number, ty: number, auto: boolean): void {
    u.mana = Math.max(0, u.mana - spell.mana);
    u.castSpell = spell;
    u.castAuto = auto;
    u.target = t ? t.id : 0;
    u.castX = tx; u.castY = ty;
    if (tx !== u.cx || ty !== u.cy) u.dir = dirFromDelta(tx - u.cx, ty - u.cy);
    this.setState(u, "cast");
    u.hitDone = false;
    u.lastActionTick = this.tick;
    if (spell.kind !== "buff" && spell.kind !== "shield" && spell.kind !== "heal") this.breakInvisibility(u);
    this.events.push({ type: "cast", unit: u.id, spell: spell.id });
    this.events.push({ type: "spell", unit: u.id, spell: spell.id, target: t?.id, x: tx, y: ty, auto });
  }

  /** Spell 1..3 / Probability 1..3 do template: r = rand(0..99) < chance → essa magia (a última que passar) [exe 0x56acc8]. */
  private rollProc(u: Unit, t: Unit): SpellDef | null {
    if (!u.procSpells.length) return null;
    let pick: SpellDef | null = null;
    for (const p of u.procSpells) if (this.rng.int(0, 99) < p.chance) pick = p.spell;
    if (!pick) return null;
    // Teleport só se o alvo estiver a mais de 2 células [exe 0x56ad82]
    if (Number(pick.id) === SPELL.Teleport) return Math.max(Math.abs(t.cx - u.cx), Math.abs(t.cy - u.cy)) > 2 ? pick : null;
    return pick;
  }

  private breakInvisibility(u: Unit): void {
    if (!u.buffs.length || !u.hasBuff("invisible")) return;
    u.buffs = u.buffs.filter(b => b.kind !== "invisible");
    this.events.push({ type: "effect", unit: u.id, spell: String(SPELL.Invisibility), kind: "invisible", on: false });
  }

  private inRange(u: Unit, tx: number, ty: number, range: number): boolean {
    if (range <= 1) return Math.max(Math.abs(tx - u.cx), Math.abs(ty - u.cy)) <= 1;
    return Math.hypot(tx - u.cx, ty - u.cy) <= range + 0.5;
  }

  private stop(u: Unit): void {
    if (u.state === "move") {
      // termina o passo em andamento
      if (Math.abs(u.x - (u.cx + 0.5)) > 0.02 || Math.abs(u.y - (u.cy + 0.5)) > 0.02) { this.moveStep(u); return; }
      this.setState(u, "idle");
    }
    u.path = [];
  }

  /** Anda em direção a (tx,ty) até ficar a `near` células (Chebyshev). Devolve false se desistiu (sem caminho). */
  walkTo(u: Unit, tx: number, ty: number, near: number): boolean {
    const mid = Math.abs(u.x - (u.cx + 0.5)) > 0.02 || Math.abs(u.y - (u.cy + 0.5)) > 0.02;
    if (mid) { this.moveStep(u); return true; }
    if (Math.max(Math.abs(tx - u.cx), Math.abs(ty - u.cy)) <= near) { this.stop(u); return true; }
    const goalChanged = !u.pathGoal || u.pathGoal.x !== tx || u.pathGoal.y !== ty;
    if (u.repathIn > 0) u.repathIn--;
    if (u.path.length === 0 || (goalChanged && u.repathIn <= 0)) {
      const p = findPath(this.grid, u.cx, u.cy, tx, ty, { flying: u.flying, near });
      u.pathGoal = { x: tx, y: ty };
      u.repathIn = 10;
      if (!p || p.length === 0) { this.stop(u); u.waitTicks++; return u.waitTicks < 20; }
      u.path = p;
    }
    const next = u.path[0]!;
    if (!this.grid.passable(next.x, next.y, u.flying)) { u.path = []; return true; }
    let occ = this.grid.occ[this.grid.idx(next.x, next.y)]!;
    if (occ !== 0 && occ !== u.id && u.waitTicks >= 3 && (u.order.type === "follow" || u.order.type === "move") && u.target === 0) {
      // (só quem anda/segue, nunca em combate)
      // aliado parado na frente (escolta/seguidor satisfeito com a distância): troca de lugar em vez de esperar para sempre num desfiladeiro
      const v = this.byId.get(occ);
      if (v && v !== u && !v.isHero && (v.state === "idle" || v.path.length === 0 || (v.path[0]?.x === u.cx && v.path[0]?.y === u.cy)) && v.active && this.isFriend(u, v)) {
        v.cx = u.cx; v.cy = u.cy; v.x = u.cx + 0.5; v.y = u.cy + 0.5; v.path = []; v.pathGoal = null;
        this.grid.occ[this.grid.idx(next.x, next.y)] = 0;
        this.grid.occ[this.grid.idx(u.cx, u.cy)] = v.id; // v assume a célula de u; u segue para a de v (o release abaixo não apaga a de v)
        occ = 0;
      }
    }
    if (occ !== 0 && occ !== u.id) {
      u.waitTicks++;
      if (u.state === "move") this.setState(u, "idle");
      if (u.waitTicks % 8 === 0) {
        // desvia: bloqueia unidades próximas e recalcula
        const extra = new Set<number>();
        for (const v of this.units) {
          if (v === u || !v.active) continue;
          if (Math.abs(v.cx - u.cx) <= 3 && Math.abs(v.cy - u.cy) <= 3 && !(v.cx === tx && v.cy === ty)) extra.add(this.grid.idx(v.cx, v.cy));
        }
        const p = findPath(this.grid, u.cx, u.cy, tx, ty, { flying: u.flying, near, extraBlocked: extra, maxNodes: 4000 });
        if (p && p.length) u.path = p;
      }
      return u.waitTicks < 120;
    }
    u.waitTicks = 0;
    // reserva a próxima célula e libera a atual
    this.release(u);
    u.cx = next.x; u.cy = next.y;
    this.occupy(u);
    u.path.shift();
    u.dir = dirFromDelta(next.x + 0.5 - u.x, next.y + 0.5 - u.y);
    this.setState(u, "move");
    this.moveStep(u);
    return true;
  }

  /** Avança a posição contínua em direção ao centro da célula ocupada. */
  private moveStep(u: Unit): void {
    const tx = u.cx + 0.5, ty = u.cy + 0.5;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    const cost = u.flying ? 8 : this.grid.cost[this.grid.idx(u.cx, u.cy)]!;
    const v = this.speedOf(u) * (8 / Math.max(8, cost)) * (TICK_MS / 1000);
    if (u.state !== "move") this.setState(u, "move");
    u.walkTime++;
    u.lastActionTick = this.tick;
    if (d <= v) { u.x = tx; u.y = ty; this.autoPickup(u); }
    else { u.x += (dx / d) * v; u.y += (dy / d) * v; }
  }

  /** Célula de fuga: a ~`dist` células, na direção oposta à soma dos inimigos próximos [exe 0x56c9bc: foge dos inimigos a ≤ raio+5]. */
  fleeCell(u: Unit, dist: number, radius = 10): Cell | null {
    let vx = 0, vy = 0, n = 0;
    for (const v of this.units) {
      if (!v.active || v === u || !this.isEnemy(v, u) && !this.isEnemy(u, v)) continue;
      const dx = u.x - v.x, dy = u.y - v.y, d = Math.hypot(dx, dy);
      if (d > radius || d < 0.01) continue;
      vx += dx / d; vy += dy / d; n++;
    }
    if (!n) return null;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const ax = vx * c - vy * s, ay = vx * s + vy * c;
      for (let r = dist; r >= 2; r -= 2) {
        const x = Math.floor(u.x + ax * r), y = Math.floor(u.y + ay * r);
        if (!this.grid.passable(x, y, u.flying)) continue;
        const free = this.grid.nearestFree(x, y, u.flying, 1, u.id);
        if (free) return free;
      }
    }
    return null;
  }

  /** Célula da formação atrás do líder (Formation Mode ligado; "auto" só enquanto o líder anda) [est — ver notes/ai-behaviors.md]. */
  formationCell(u: Unit, lead: Unit): Cell | null {
    if (u.formationSlot < 0) return null;
    const mode = this.playerAi[u.player]?.formation ?? 0;
    if (mode === 0 || (mode === 1 && lead.state !== "move" && lead.path.length === 0)) return null;
    const a = lead.dir * Math.PI / 8; // 0 = sul (0,1), 4 = oeste (-1,0)
    const fx = -Math.sin(a), fy = Math.cos(a);
    const rx = -fy, ry = fx;
    const row = 1 + Math.floor(u.formationSlot / 3), col = (u.formationSlot % 3) - 1;
    const x = Math.round(lead.cx - fx * row + rx * col), y = Math.round(lead.cy - fy * row + ry * col);
    if (!this.grid.passable(x, y, u.flying)) return this.grid.nearestFree(x, y, u.flying, 2, u.id);
    return { x, y };
  }

  // ------------------------------------------------------------------------------------------- combate

  private progressAttack(u: Unit): void {
    const t = u.target ? this.get(u.target) : undefined;
    if (t && t.active && t !== u) u.dir = dirFromDelta(t.cx - u.cx, t.cy - u.cy);
    if (!u.hitDone && u.stateTime >= u.timing.hitTick) {
      u.hitDone = true;
      if (u.state === "cast" && u.castSpell) this.releaseSpell(u, u.castSpell, t, u.castX, u.castY);
      else if (t && t.active) {
        if (u.weaponSpell) this.launch(u, t, u.weaponSpell, u.weaponSpell.element);
        else if (u.stats.range > 1) this.launch(u, t, null, u.typeId === 70 ? "sonic" : u.stats.attackSkill === "fire" ? "fire" : "arrow");
        else if (Math.max(Math.abs(t.cx - u.cx), Math.abs(t.cy - u.cy)) <= 1) this.resolveHit(u, t, null);
      }
    }
    if (u.stateTime >= u.timing.attackTicks) {
      const wasCast = u.state === "cast";
      const auto = u.castAuto;
      this.setState(u, "idle");
      u.cooldown = u.timing.attackDelay;
      u.castAuto = false;
      if (wasCast && !auto && u.order.type === "cast") this.command(u, { type: "none" });
    }
  }

  /** Efeito da magia no momento em que sai da mão (tique `hitTick` da animação). */
  releaseSpell(u: Unit, s: SpellDef, t: Unit | undefined, x: number, y: number): void {
    const id = Number(spellKey(s));
    const friendOrSelf = t && t.active && !this.isEnemy(u, t) ? t : u;
    switch (s.kind) {
      case "shield":
      case "buff":
        this.applyBuffs(u, s.target === "self" ? u : friendOrSelf, s);
        this.supportExp(u, s);
        return;
      case "heal": {
        const who = friendOrSelf;
        const amount = this.rng.int(s.min, s.max);
        who.hp = Math.min(who.maxHp, who.hp + amount);
        this.events.push({ type: "heal", unit: who.id, amount });
        this.supportExp(u, s);
        return;
      }
      case "debuff":
        if (t && t.active) { this.applyBuffs(u, t, s); this.provoke(u, t); }
        return;
      case "bolt":
      case "drain":
        if (t && t.active) this.launch(u, t, s, s.element);
        return;
      case "ball":
        if (t && t.active) this.launch(u, t, s, s.element);
        else this.launchAt(u, x, y, s);
        return;
      case "cone":
        this.cone(u, s, t ? t.x : x + 0.5, t ? t.y : y + 0.5);
        return;
      case "field":
      case "wall":
        this.createArea(u, s, t ? t.cx : x, t ? t.cy : y);
        if (s.defensive) this.supportExp(u, s);
        return;
      case "teleport": {
        const fx = u.cx, fy = u.cy;
        const tx = t && t !== u ? t.cx : x, ty = t && t !== u ? t.cy : y;
        if (tx === u.cx && ty === u.cy) return;
        this.teleport(u, tx, ty);
        this.command(u, { type: "none" });
        this.events.push({ type: "teleport", unit: u.id, x: u.cx, y: u.cy, fromX: fx, fromY: fy });
        this.supportExp(u, s);
        return;
      }
      case "control":
        if (t && t.active) this.controlSpirit(u, t, s);
        return;
      case "summon":
        this.summon(u, s, x, y);
        return;
      default:
        if (t && t.active) this.launch(u, t, s, s.element);
        void id;
    }
  }

  /** Aplica os efeitos da magia em `who` (renova o mesmo efeito da mesma magia). */
  private applyBuffs(src: Unit, who: Unit, s: SpellDef): void {
    const until = this.tick + Math.max(1, Math.round(s.duration * TICKS_PER_SEC));
    const effects = s.effects?.length ? s.effects : [{ kind: "absorption" as BuffKind, amount: s.min }];
    who.buffs = who.buffs.filter(b => b.spell !== spellKey(s));
    for (const e of effects) {
      who.buffs.push({ kind: e.kind, amount: e.amount, until, spell: spellKey(s), from: src.id });
      this.events.push({ type: "effect", unit: who.id, spell: s.id, kind: e.kind, on: true });
    }
    if (s.kind === "shield") this.events.push({ type: "buff", unit: who.id, spell: s.id, amount: s.min });
    if (effects.some(e => e.kind === "stone") && (who.state === "attack" || who.state === "cast" || who.state === "move")) {
      who.path = []; this.setState(who, "idle");
    }
  }

  private launch(u: Unit, t: Unit, spell: SpellDef | null, kind: string): void {
    const p: Projectile = { id: this.nextId++, from: u.id, to: t.id, x: u.x, y: u.y, speed: spell ? spell.speed ?? 9 : 11, kind, spell, done: false };
    this.projectiles.push(p);
    this.events.push({ type: "projectile", id: p.id });
  }

  private launchAt(u: Unit, x: number, y: number, spell: SpellDef): void {
    const p: Projectile = { id: this.nextId++, from: u.id, to: 0, x: u.x, y: u.y, speed: spell.speed ?? 9, kind: spell.element, spell, done: false, tx: x + 0.5, ty: y + 0.5 };
    this.projectiles.push(p);
    this.events.push({ type: "projectile", id: p.id });
  }

  private stepProjectiles(): void {
    for (const p of this.projectiles) {
      if (p.done) continue;
      const t = p.to ? this.get(p.to) : undefined;
      if (p.to && (!t || !t.active)) { p.done = true; continue; }
      const gx = t ? t.x : p.tx ?? p.x, gy = t ? t.y : p.ty ?? p.y;
      const dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy), v = p.speed * TICK_MS / 1000;
      if (d <= v + 0.2) {
        p.done = true;
        p.x = gx; p.y = gy;
        this.events.push({ type: "projectileHit", id: p.id });
        const src = this.get(p.from);
        if (p.spell?.kind === "ball") { if (src) this.blast(src, p.spell, gx, gy); }
        else if (src && t) this.resolveHit(src, t, p.spell);
      } else { p.x += dx / d * v; p.y += dy / d * v; }
    }
    if (this.projectiles.length > 64) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i]!.done) this.projectiles.splice(i, 1);
    }
  }

  /** Explosão (Fireball): dano da magia em todos (menos quem lançou) a ≤ raio (mín. 1) do ponto. */
  private blast(src: Unit, s: SpellDef, x: number, y: number): void {
    const radius = Math.max(1, s.radius ?? 1) + 0.5;
    this.events.push({ type: "blast", spell: s.id, x, y, radius, unit: src.id });
    this.splash++;
    for (const v of this.unitsInRadius(x, y, radius, v => v !== src)) this.resolveHit(src, v, s);
    this.splash--;
  }

  /** Jato/leque (Acid Stream, Prismatic Spray): todos os não aliados num cone de ±30° até o alcance [est]. */
  private cone(src: Unit, s: SpellDef, x: number, y: number): void {
    const dx = x - src.x, dy = y - src.y, len = Math.hypot(dx, dy) || 1;
    const reach = Math.max(s.range, s.radius ?? 0) + 0.5;
    const half = Number(spellKey(s)) === SPELL.PrismaticSpray ? Math.PI / 4 : Math.PI / 6;
    this.events.push({ type: "blast", spell: s.id, x, y, radius: reach, unit: src.id });
    for (const v of this.unitsInRadius(src.x, src.y, reach, v => v !== src && !this.isFriend(src, v))) {
      const vx = v.x - src.x, vy = v.y - src.y, vl = Math.hypot(vx, vy) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * dx + vy * dy) / (vl * len))));
      if (ang <= half || vl < 1.2) { this.splash++; this.resolveHit(src, v, s); this.splash--; }
    }
  }

  private createArea(src: Unit, s: SpellDef, x: number, y: number): void {
    const dur = Math.max(1, s.areaDuration || s.duration || 5);
    const a: SpellArea = {
      id: this.nextId++, spell: spellKey(s), kind: s.kind === "wall" ? "wall" : "field", owner: src.id, player: src.player,
      x, y, radius: Math.max(0, s.radius ?? 0), until: this.tick + Math.round(dur * TICKS_PER_SEC),
      next: this.tick, period: Math.max(1, Math.round((s.areaFrequency ?? 1) * TICKS_PER_SEC)),
      min: s.min, max: s.max, element: s.element, effects: (s.effects ?? []).map(e => ({ ...e })),
    };
    if (a.kind === "wall") {
      // linha perpendicular à direção de quem lança, comprimento 2×raio+1 [est]
      const dx = x - src.cx, dy = y - src.cy, l = Math.hypot(dx, dy) || 1;
      const px = -dy / l, py = dx / l;
      const cells: number[] = [];
      for (let i = -a.radius; i <= a.radius; i++) {
        const cx = Math.round(x + px * i), cy = Math.round(y + py * i);
        if (!this.grid.inside(cx, cy)) continue;
        const idx = this.grid.idx(cx, cy);
        if (this.grid.occ[idx] || cells.includes(idx)) continue;
        cells.push(idx);
      }
      a.cells = cells;
      this.applyWall(a, true);
    }
    // fogo e gelo dissipam a névoa venenosa que cobrem [est: a água "lava" o veneno e o fogo o queima — é assim que o enigma da missão 95 (camada 2
    // vazia nas 9 células) pode ser resolvido; o original não foi decifrado]
    if ([SPELL.WallOfFire, SPELL.Blizzard, SPELL.Fireball].includes(Number(spellKey(s)) as never)) this.dispelClouds(x, y, a.radius);
    this.areas.push(a);
    this.events.push({ type: "area", id: a.id, spell: a.spell, x, y, radius: a.radius, on: true });
  }

  /** Remove as nuvens (camada 2) cujas células encostam no círculo (x,y,raio). */
  dispelClouds(x: number, y: number, radius: number): void {
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const c = this.areas[i]!;
      if (spellLayer(Number(c.spell)) !== 2 || Math.hypot(c.x - x, c.y - y) > c.radius + radius + 0.5) continue;
      this.areas.splice(i, 1);
      this.events.push({ type: "area", id: c.id, spell: c.spell, x: c.x, y: c.y, radius: c.radius, on: false });
    }
  }

  /** Marca/desmarca as células de uma Wall of Earth na grade. */
  applyWall(a: SpellArea, on: boolean): void {
    for (const i of a.cells ?? []) {
      if (on) this.grid.block[i]! |= BLOCK_SPELL;
      else this.grid.block[i]! &= ~BLOCK_SPELL;
    }
  }

  private stepAreas(): void {
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const a = this.areas[i]!;
      if (this.tick >= a.until) {
        if (a.kind === "wall") this.applyWall(a, false);
        this.areas.splice(i, 1);
        this.events.push({ type: "area", id: a.id, spell: a.spell, x: a.x, y: a.y, radius: a.radius, on: false });
        continue;
      }
      if (a.kind === "wall" || this.tick < a.next) continue;
      a.next = this.tick + a.period;
      const src = this.get(a.owner);
      const inside = this.unitsInRadius(a.x + 0.5, a.y + 0.5, a.radius + 0.5);
      for (const v of inside) {
        if (a.max > 0) {
          const res = this.resistOf(v, a.element);
          const dmg = Math.floor(this.rng.int(a.min, a.max) * (100 - res) / 100 + 0.75);
          if (dmg > 0) { this.splash++; this.damage(src && src.alive ? src : undefined, v, dmg, a.element, !src || !src.alive); this.splash--; }
          if (!v.active) continue;
        }
        for (const e of a.effects) {
          if (e.kind === "sight") {
            // Light/Darkness: efeito enquanto estiver dentro (renovado a cada período)
            v.buffs = v.buffs.filter(b => !(b.spell === "aura" && b.kind === "sight" && b.from === a.id));
            v.buffs.push({ kind: "sight", amount: e.amount, until: this.tick + a.period + 1, spell: "aura", from: a.id });
          } else {
            const dur = Number(a.spell) === SPELL.PoisonCloud ? 8 * TICKS_PER_SEC : a.period + 1;
            v.buffs = v.buffs.filter(b => !(b.kind === e.kind && b.spell === a.spell));
            v.buffs.push({ kind: e.kind, amount: e.amount, until: this.tick + dur, spell: a.spell, from: a.owner });
          }
        }
      }
    }
  }

  /** Control Spirit ("Animate Dead"): morto-vivo/espírito inimigo passa para o lado de quem lança por `duration` [est]. */
  private controlSpirit(u: Unit, t: Unit, s: SpellDef): void {
    if (!UNDEAD_TYPES.has(t.typeId) || t.isHero) { this.events.push({ type: "message", text: "The spell has no effect" }); return; }
    // nível do alvo limita: poder ≥ 20 × (nível − 1) [est]
    if ((s.power ?? 0) < 20 * ((t.stats.level ?? 1) - 1)) { this.events.push({ type: "message", text: "The spell has no effect" }); return; }
    const original = t.buffs.find(b => b.kind === "control")?.data ?? t.player;
    t.buffs = t.buffs.filter(b => b.kind !== "control");
    t.buffs.push({ kind: "control", amount: 1, until: this.tick + Math.round(s.duration * TICKS_PER_SEC), spell: s.id, from: u.id, data: original });
    this.setOwner(t, u.player);
    this.command(t, { type: "none" });
    t.ai = { type: "defend", unit: u.id, range: 4 };
    this.events.push({ type: "effect", unit: t.id, spell: s.id, kind: "control", on: true });
  }

  setOwner(u: Unit, player: number): void {
    if (u.player === player) return;
    u.player = player;
    u.target = 0;
    if (u.order.type === "attack") u.order = { type: "none" };
    this.events.push({ type: "owner", unit: u.id, player });
  }

  private summon(u: Unit, s: SpellDef, x: number, y: number): void {
    const init = this.summonFactory?.(u, x, y, s.power ?? 0);
    if (!init) { this.events.push({ type: "message", text: "Summon is not available" }); return; }
    const c = this.grid.nearestFree(u.cx, u.cy, !!init.stats.flying, 4) ?? { x: u.cx, y: u.cy };
    const m = this.spawn({ ...init, x: c.x, y: c.y, player: u.player });
    m.dynamic = true;
    m.ai = { type: "defend", unit: u.id, range: 4 };
    m.buffs.push({ kind: "control", amount: 1, until: this.tick + Math.round(Math.max(30, s.duration) * TICKS_PER_SEC), spell: s.id, from: u.id, data: 0 });
    this.events.push({ type: "summon", unit: m.id, by: u.id });
  }

  /** Resolve um golpe/projétil/explosão. Fórmulas [exe] (docs/DATA.md, seção DADOS):
   *  físico: dano bruto = rand[min,max] (Bless no atacante: chance = poder % → máximo; Curse: chance → mínimo [exe 0x516ceb]);
   *  r = rand(0..200) − 100; acerta se ataque + r > defesa do alvo, ou r ≥ 90, ou `alwaysHit`;
   *  dano −= absorção (mín. 0; `alwaysHit` ignora); dano = int(dano × (100 − resistFísica[tipo da arma]) / 100 + 0,75).
   *  magia: sem teste de acerto nem absorção; dano = int(d × (100 − proteção da escola)/100 + 0,75). Drain Life devolve o dano. */
  resolveHit(a: Unit, t: Unit, spell: SpellDef | null): void {
    if (!t.active) return;
    let dmg: number;
    if (spell) {
      if (spell.max <= 0 && spell.kind !== "drain") return;
      const res = this.resistOf(t, spell.element);
      dmg = Math.floor(this.rng.int(spell.min, spell.max) * (100 - res) / 100 + 0.75);
    } else {
      dmg = this.rng.int(a.stats.damage.min, a.stats.damage.max);
      if (a.buffs.length) {
        const bless = a.buffs.find(b => b.kind === "bless"), curse = a.buffs.find(b => b.kind === "curse");
        if (bless && this.rng.int(0, 99) < bless.amount) dmg = a.stats.damage.max;
        if (curse && this.rng.int(0, 99) < curse.amount) dmg = a.stats.damage.min;
      }
      const r = this.rng.int(0, 200) - 100;
      const hit = !!a.stats.alwaysHit || r >= 90 || this.attackOf(a) + r > this.defenseOf(t);
      if (!hit) { this.events.push({ type: "miss", unit: a.id, target: t.id }); this.provoke(a, t); return; }
      if (!a.stats.alwaysHit) dmg = Math.max(0, dmg - this.absorptionOf(t));
      const at = a.stats.attackType;
      const rp = at && t.stats.resistPhysical ? Math.min(100, t.stats.resistPhysical[at] ?? 0) : 0;
      dmg = Math.floor(dmg * (100 - rp) / 100 + 0.75);
    }
    if (dmg <= 0) { this.events.push({ type: "miss", unit: a.id, target: t.id }); this.provoke(a, t); return; }
    if (a.heroInfo && !t.stats.noXp && t.player !== a.player && !t.isHero) {
      const skill = spell ? spell.element : a.heroInfo.mage ? "" : (a.stats.attackType ?? "");
      if (skill) this.gainExp(a, skill, Math.floor(t.stats.exp * 0.5 * Math.min(dmg, Math.max(0, t.hp)) / t.maxHp + 1), t.typeId);
    }
    const dealt = Math.min(dmg, Math.max(0, t.hp));
    this.damage(a, t, dmg, spell?.element);
    if (spell?.kind === "drain" && a.active && dealt > 0) {
      a.hp = Math.min(a.maxHp, a.hp + dealt);
      this.events.push({ type: "heal", unit: a.id, amount: dealt });
    }
  }

  /** Abates por tipo de monstro (a experiência cai com 10/(n+10)). */
  readonly killsByType = new Map<number, number>();

  /** Experiência [exe 0x513128]: base × (Mind/30 + 0,25) × 10/(n+10); ÷8 (arred. p/ cima) fora do alinhamento (exceto Astral e Shooting);
   *  limitada a exp(skill+1) − exp(skill) por evento. Guerreiros só ganham com a arma, magos só com magias. */
  private gainExp(a: Unit, skill: string, base: number, typeId: number): void {
    const info = a.heroInfo!;
    const n = this.killsByType.get(typeId) ?? 0;
    let xp = base * ((a.stats.mind ?? 0) / 30 + 0.25) * 10 / (n + 10);
    if (skill !== info.alignment && skill !== "astral" && skill !== "shooting") xp = Math.ceil(xp / 8);
    const cur = info.skillExp[skill] ?? 0, v = skillFromExp(cur);
    xp = Math.floor(Math.min(xp, skillExp(v + 1) - skillExp(v)));
    if (xp <= 0) return;
    info.skillExp[skill] = cur + xp;
    a.exp += xp;
    this.events.push({ type: "exp", unit: a.id, amount: xp });
    if (skillFromExp(cur + xp) > v) this.events.push({ type: "levelup", unit: a.id });
  }

  /** Magia de suporte lançada: int(nível × 0,5 + 0,5) de experiência na escola. */
  private supportExp(u: Unit, s: SpellDef): void {
    if (!u.heroInfo || !u.heroInfo.mage || s.mana <= 0) return;
    const xp = Math.floor(s.level * 0.5 + 0.5);
    if (xp <= 0) return;
    u.heroInfo.skillExp[s.element] = (u.heroInfo.skillExp[s.element] ?? 0) + xp;
    u.exp += xp;
    this.events.push({ type: "exp", unit: u.id, amount: xp });
  }

  /** >0 enquanto uma magia de área (explosão, jato, campo) aplica dano */
  private splash = 0;

  /** Aplica dano. `quiet` = dano de efeito (veneno/área sem dono): não conta como agressão. Dano colateral de área de uma facção da IA em quem não é inimigo
   *  dela (o herói no meio de uma guerra entre bandos, missão 100) também é silencioso: sem isso a Fireball do mago dos cavaleiros bons os deixava
   *  hostis ao herói e o script falhava a missão ("Knights attacked"). A área lançada pelo jogador continua irritando quem atinge. */
  damage(a: Unit | undefined, t: Unit, dmg: number, element?: string, quiet = false): void {
    if (a && !quiet && this.splash > 0 && a.player !== 1 && !this.hostile(a.player, t.player)) quiet = true;
    t.hp -= dmg;
    t.lastHurtTick = this.tick;
    if (a && !quiet) { t.lastAttacker = a.id; this.provoke(a, t); }
    this.events.push({ type: "hit", unit: a?.id ?? 0, target: t.id, amount: dmg, element });
    if (t.hp <= 0) this.kill(t, a);
    else if (a && !quiet && a.player !== t.player) this.alertGroup(t, a);
  }

  /** Alerta: companheiros do mesmo jogador num raio de 6 células que estejam parados/vigiando passam a atacar o agressor [est]. */
  private alertGroup(t: Unit, a: Unit): void {
    for (const v of this.units) {
      if (v === t || !v.active || v.player !== t.player || v.isHero) continue;
      if (Math.abs(v.cx - t.cx) > 6 || Math.abs(v.cy - t.cy) > 6) continue;
      v.alertTarget = a.id; v.alertTick = this.tick;
    }
  }

  /** Atacar uma unidade em paz deixa o dono dela hostil ao agressor (é assim que se "irrita" Skrakan ou o ogro). */
  private provoke(a: Unit, t: Unit): void {
    if (a.player === t.player) return;
    if (this.splash > 0 && a.player !== 1 && !this.hostile(a.player, t.player)) return; // dano colateral de área da IA (ver `damage`)
    if (!this.hostile(t.player, a.player)) this.setDiplomacy(t.player, a.player, 1);
    // a guerra vale nos dois sentidos [est]: o script da missão 20 vigia a diplomacia do herói PARA os camponeses (1 -> 3) e o da
    // 21 a deles para o herói (2 -> 1); aliados (valor 2) não são tocados
    if (!this.hostile(a.player, t.player) && !((this.dip[a.player]?.[t.player] ?? 0) & 2)) this.setDiplomacy(a.player, t.player, 1);
  }

  kill(t: Unit, killer?: Unit): void {
    if (!t.alive) return;
    t.hp = 0;
    this.release(t);
    t.path = []; t.order = { type: "none" };
    this.setState(t, "dying");
    this.events.push({ type: "death", unit: t.id, killer: killer?.id ?? 0 });
    if (killer?.isHero) this.killsByType.set(t.typeId, (this.killsByType.get(t.typeId) ?? 0) + 1);
    // loot: saco que a unidade carrega (bags do mapa) + tesouro do template (chance %, faixa de ouro)
    const tr = t.stats.treasure;
    let gold = t.gold;
    // [exe 0x510a70]: ouro se goldChance > rand(100): goldMin + rand(goldMax)
    if (!t.isHero && !t.dynamic && tr && tr.goldMin >= 0 && tr.goldChance > this.rng.int(0, 100)) gold += Math.min(100000, tr.goldMin + this.rng.int(0, Math.max(0, tr.goldMax)));
    if (!t.isHero && (gold > 0 || t.items.length)) {
      this.loot.push({ id: this.nextId++, x: t.cx, y: t.cy, gold, items: [...t.items] });
      this.events.push({ type: "loot", x: t.cx, y: t.cy, gold });
      t.gold = 0; t.items = [];
    }
    this.onDeath?.(t, killer);
  }

  private autoPickup(u: Unit): void { if (u.isHero) this.pickupAt(u); }

  private pickupAt(u: Unit): void {
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i]!;
      if (l.x !== u.cx || l.y !== u.cy) continue;
      u.gold += l.gold;
      this.money[u.player] = (this.money[u.player] ?? 0) + l.gold;
      u.items.push(...l.items);
      this.loot.splice(i, 1);
      this.events.push({ type: "pickup", unit: u.id, gold: l.gold, items: [...l.items] });
    }
  }

  // ------------------------------------------------------------------------------------------- consultas

  unitsOfPlayer(p: number): Unit[] { return this.units.filter(u => u.player === p && u.alive); }

  unitAtCell(x: number, y: number): Unit | undefined {
    const id = this.grid.inside(x, y) ? this.grid.occ[this.grid.idx(x, y)] : 0;
    return id ? this.get(id) : undefined;
  }

  /** "Set trap" do script: registra a armadilha (persistente; reage a cada unidade a ≤ 1 célula do gatilho, no máx. 1×/2 s). */
  addTrap(t: Omit<Trap, "ready">): void { this.traps.push({ ...t, ready: 0 }); }

  private inTrapZone(t: Trap, u: Unit): boolean { return Math.abs(u.cx - t.x) <= 1 && Math.abs(u.cy - t.y) <= 1; }

  private stepTraps(): void {
    for (const t of this.traps) {
      if (t.exempt?.length) t.exempt = t.exempt.filter(id => { const u = this.get(id); return !!u && u.active && this.inTrapZone(t, u); });
      if (this.tick < t.ready) continue;
      const v = this.units.find(u => u.active && this.inTrapZone(t, u) && !t.exempt?.includes(u.id));
      if (!v) continue;
      t.ready = this.tick + 2 * TICKS_PER_SEC;
      if (t.spell.kind === "teleport") {
        const fx = v.cx, fy = v.cy;
        this.teleport(v, t.toX, t.toY);
        this.events.push({ type: "teleport", unit: v.id, x: v.cx, y: v.cy, fromX: fx, fromY: fy });
        for (const o of this.traps) if (o !== t && this.inTrapZone(o, v)) (o.exempt ??= []).push(v.id);
      } else this.castFromPoint(t.spell, t.fromX, t.fromY, v);
    }
  }

  /** Área de magia (campo/parede) de `spell` que cobre a célula (x,y); `spell` 0 = qualquer. */
  areaAt(x: number, y: number, spell = 0): SpellArea | undefined {
    const idx = this.grid.inside(x, y) ? this.grid.idx(x, y) : -1;
    return this.areas.find(a => (!spell || Number(a.spell) === spell)
      && (a.kind === "wall" ? (a.cells?.includes(idx) ?? false) || (Math.floor(a.x) === x && Math.floor(a.y) === y) : Math.hypot(a.x + 0.5 - (x + 0.5), a.y + 0.5 - (y + 0.5)) <= a.radius + 0.5));
  }

  /** "Spell on Tile": há área de magia da `layer` cobrindo a célula (x,y)? (fila de camadas em spells.ts `spellLayer`) */
  areaOnLayer(x: number, y: number, layer: number): SpellArea | undefined {
    const idx = this.grid.inside(x, y) ? this.grid.idx(x, y) : -1;
    return this.areas.find(a => spellLayer(Number(a.spell)) === layer
      && (a.kind === "wall" ? (a.cells?.includes(idx) ?? false) || (Math.floor(a.x) === x && Math.floor(a.y) === y) : Math.hypot(a.x - x, a.y - y) <= a.radius + 0.5));
  }

  /** "Unit Spell Duration" do script: o efeito da magia `spell` em `u` passa a durar `duration` tiques a partir de agora; devolve se achou. */
  setBuffDuration(u: Unit, spell: number, duration: number): boolean {
    let found = false;
    for (const b of u.buffs) if (Number(b.spell) === spell) { b.until = this.tick + Math.max(0, Math.round(duration)); found = true; }
    return found;
  }

  /** "Tile Spell Duration" do script (missão 71: a parede some com duração 1 e é mantida com 30000): a área de `spell` na célula passa a durar
   *  `duration` tiques a partir de agora [est: a unidade do original não está decifrada; 1 = some já, valor alto = fica]. Devolve se achou a área. */
  setAreaDuration(x: number, y: number, spell: number, duration: number): boolean {
    const a = this.areaAt(x, y, spell);
    if (!a) return false;
    a.until = this.tick + Math.max(0, Math.round(duration));
    return true;
  }

  /** "Make spell effect" sem unidade no destino: campos/paredes (Poison Cloud...) viram área no ponto; o resto é ignorado. */
  castAtPoint(spell: SpellDef, fromX: number, fromY: number, toX: number, toY: number): void {
    if (spell.kind !== "field" && spell.kind !== "wall") return;
    const ref = this.units[0];
    if (!ref) return;
    const virt = new Unit(0, { kind: "virtual", typeId: 0, player: 0, x: fromX, y: fromY, stats: { ...ref.stats, name: "VirtualCaster" }, timing: ref.timing });
    this.createArea(virt, spell, toX, toY);
  }

  /** Lança uma magia "de fora" (ação de script "Cast spell on unit", armadilhas): projétil/efeito de (x,y) sem unidade de origem.
   *  Usa uma unidade-fonte virtual do jogador 0 só para o cálculo. */
  castFromPoint(spell: SpellDef, fromX: number, fromY: number, target: Unit): void {
    if (!target.active) return;
    const virt = new Unit(0, { kind: "virtual", typeId: 0, player: 0, x: fromX, y: fromY, stats: { ...target.stats, name: "VirtualCaster" }, timing: target.timing });
    if (spell.kind === "heal") { const n = this.rng.int(spell.min, spell.max); target.hp = Math.min(target.maxHp, target.hp + n); this.events.push({ type: "heal", unit: target.id, amount: n }); return; }
    if (spell.kind === "buff" || spell.kind === "shield" || spell.kind === "debuff") { this.applyBuffs(virt, target, spell); return; }
    if (spell.kind === "field" || spell.kind === "wall") { this.createArea(virt, spell, target.cx, target.cy); return; }
    const res = this.resistOf(target, spell.element);
    const dmg = Math.floor(this.rng.int(spell.min, spell.max) * (100 - res) / 100 + 0.75);
    this.events.push({ type: "blast", spell: spell.id, x: target.x, y: target.y, radius: Math.max(0.5, spell.radius ?? 0), unit: 0 });
    if (dmg > 0) this.damage(undefined, target, dmg, spell.element);
  }
}
