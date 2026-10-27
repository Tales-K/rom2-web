/**
 * Mundo da simulação: unidades, projéteis, áreas de magia, sacos de loot, diplomacia, combate, magias e ordens. Passo fixo
 * (TICK_MS = 62,5 ms, 16 Hz = o tique do servidor do exe, Server_Tick 0x4f08c0; DIFF-FUZZ fase 7), determinístico (toda aleatoriedade via `Rng`), sem dependência de PixiJS/DOM. A apresentação lê o
 * estado e consome `events`. A IA (o que cada unidade decide sozinha) fica em `ai.ts`; a montagem das magias/parâmetros de IA a
 * partir dos dados, em `behaviors.ts`. Fontes e aproximações: README.md desta pasta e notes/ai-behaviors.md.
 *
 * ANDAR (etapa 6, notes/integracao-andar.md): a fonte de verdade é o registro espelhado do servidor do exe (sim/exe/types.ts). Cada
 * `Unit` carrega `rec: UnitRec` (objeto de mapa, andar +0x1c0, IA +0x1c4, listas de caminho) e a `World` o `MapRec` (`exe`: grades,
 * ocupação) e o mundo (`exeWorld`). `x`, `y`, `cx`, `cy`, `dir` e `angle` da unidade são GETTERS/SETTERS sobre o registro (não há
 * cópia); o andar só muda o registro, pelas funções portadas. `act(u)` escreve a tarefa do exe (IA+8 = 1 andar / 4 perseguir, IA+0xa
 * célula, IA+0x18/+0x14 alvo e alcance) a partir da ordem e chama o despachante portado (0x56dca2, sim/exe/action.ts); com IA+9 == 3
 * (passo em curso) o despachante só continua o passo, antes de qualquer ordem. `grid.occ` (ocupação do motor, uma unidade por
 * célula = a célula do chão) é sincronizada num único ponto, depois de cada chamada do despachante (`dispatch`). Adaptadores do
 * motor antigo (chamados do exe ainda não portados): fim do caminho de andar (0x56dc24: nada), da patrulha (próximo ponto da nossa
 * ordem de patrulha) e das demais tarefas (0x56ed4e: inimigo ao alcance → ataca, senão ordem nenhuma); ordens com `near` > 0 (seguir,
 * defender, magia no chão) chamam Unit_WalkNear 0x56e4ac direto (no exe, tarefas não portadas).
 */
import { BLOCK_BORDER, BLOCK_SPELL, BLOCK_STRUCTURE, Grid, MAP_BORDER } from "./grid";
import { skillExp, skillFromExp } from "./stats";
import { lineOfSight } from "./los";
import { CellStructRec, MapRec, OccRec, UnitRec, WorldRec } from "./exe/types";
import { mapRecFromGrid, exeMaskOf } from "./exe/mapbuild";
import { unitActionDispatcher, type DispatchHooks } from "./exe/action";
import { NotPorted, dirFromDelta16, unitPlaceOnCells, unitRemoveFromCells, unitTurnStep, unitWalkNear } from "./exe/walk_action";
import { mapObjSetFine, mapObjSubCellCenter } from "./exe/walk";
import { fn_0x55be86 } from "./exe/wave";
import { EXE_GLOBALS } from "./exe/types";
import { VIS_COST, VIS_PARENT } from "./vision_tables";
import { Rng, type RandSite } from "./rng";
import { aiThink, heroThink } from "./ai";
import { canRevive, healDying, onConsumed, onFell, raiseDead, stepCorpses, stepSummons, summonCreature, CORPSE } from "./necro";
import { selectedSpellRange, spellAttack } from "./spellattack";
import {
  EXE_TPS, SPELL, isOffensive, prismaticRays, spellKey, spellLayer, stoneCurseTicksMax, type BuffKind, type SpellDef, type SpellEffect, type SpellTable,
} from "./spells";
import { BLIZZARD_PULSES, PULSE_EXE_TICKS, acidSteps, areaCells, exeDir8 } from "./areas";
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
  /** "Stand still" (tecla L): não ataca nem persegue ninguém */
  | { type: "still" }
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

/** Raio de guarda DA UNIDADE (`+0x1c0 +8`): o construtor do objeto 0x551346 grava 5 e nenhuma rotina o altera depois — vale para
 *  todas as unidades. É o raio do gatilho do Wimpy (raio + 5, 0x56cb0c), dos inimigos de quem se foge (0x56cb8c) e da tarefa Guard
 *  da unidade (0x56a5fc → 0x567988). O raio do GRUPO (`grupo+0x3c +0x2d`, ≥ MinimalGuardRange) é outro: ver ai.ts `guardRadius`. */
export const UNIT_GUARD_RADIUS = 5;
/** orçamento da janela 41×41 da visão (World.markVision), reaproveitado */
const VIS_BUDGET = new Int32Array(41 * 41);
let VIS_SEEN = new Uint8Array(0);

/** Tiques do servidor do original por segundo (relógio `[[0x6044c4]+4]`; a máquina de ação 0x50f12c anda 1 passo por tique). */
export const SERVER_TICKS_PER_SEC = 16;
function sameOrder(a: Order, b: Order): boolean {
  const p = a as { type: string; target?: number; spell?: string; x?: number; y?: number }, q = b as typeof p;
  return p.type === q.type && p.target === q.target && p.spell === q.spell && p.x === q.x && p.y === q.y;
}

/**
 * Ciclo de uma magia na máquina de ação do servidor [exe 0x50f12c; medido com a sonda de tools/refcap/original/demo_wimpy_mage.py
 * --cast-probe, scratch/demo_wimpy/c1..c2]: a mana sai no INÍCIO (0x519998, fase 0); fase 5 = carga de `charge` tiques; a magia sai
 * (0x519d7f/0x519db8); fase 7 = espera de `relax + rand(0..3) + Complication Level da magia` tiques (0x50f7b0: 0x51fa25(3) e o 1º
 * inteiro da definição, `spells.json level`); depois a IA/ordem já pode lançar outra. Skrakan (charge 8, relax 4): Lightning (nível
 * 10) a cada 24–27 tiques = 1,5–1,7 s; Stone Curse/Teleport (nível 20) a cada 34–37 = 2,1–2,3 s. Para quem tem arma o exe ainda soma
 * `clamp((arma+0x4a + (30 − Reaction)×5) div 12, 0, 12)` à espera (`weaponWait`, arma+0x4a = peso do item: types.ts `weaponWaitTicks`).
 * Devolve os tiques DO NOSSO SIM (16/s, os mesmos do exe) contados do início do lançamento, ou null sem charge (usa a animação).
 */
export function castTiming(charge: number | undefined, relax: number | undefined, level: number, roll: number, weaponWait = 0): { hit: number; end: number } | null {
  if (!charge || charge <= 0) return null;
  const k = TICKS_PER_SEC / SERVER_TICKS_PER_SEC;
  const hit = Math.max(1, Math.round(charge * k));
  return { hit, end: Math.max(hit + 1, Math.round((charge + Math.max(0, relax ?? 0) + roll + Math.max(0, level | 0) + Math.max(0, weaponWait)) * k)) };
}

/** Fase do pensamento da IA dos jogadores de IA (0x570087 → grupos → 0x57377d), 1×/s: tique do relógio de 16/s ≡ 7 (sonda c1/c2 e
 *  m110: os inícios de ação dos dois lados se concentram na fase 7) → fase 9 do sim no jogo normal (estados importados: `thinkPhaseFor`). */
export const AI_THINK_PHASE = 9;

/** `World.clockPhase` para um estado cujo relógio de 16/s do exe vale `t16` no tique 0: o pensamento sai no tique relativo
 *  `(7 − t16) mod 16` (× TICKS_PER_SEC/16 no nosso; 1 a 16/s) — m10_start (t16 = 21): 2, 18, ... 146 = 9,125 s (cobra 24596 reage aí, medido). */
export function thinkPhaseFor(t16: number): number {
  const rel = (((7 - t16) % 16) + 16) % 16;
  return (((AI_THINK_PHASE - Math.round(rel * TICKS_PER_SEC / SERVER_TICKS_PER_SEC)) % TICKS_PER_SEC) + TICKS_PER_SEC) % TICKS_PER_SEC;
}

/** Tipos de unidade "espírito/morto-vivo" (fantasma 69, zumbis/esqueletos 82..98). Animate Dead NÃO os controla (era a leitura antiga
 *  "Control Spirit"): levanta corpos e recusa os de tipo 82..98 [exe 0x51a9a4] — ver sim/necro.ts. */
export const UNDEAD_TYPES = new Set([69, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98]);

/** Endereço sintético do registro da unidade (identidade dos ponteiros u32 guardados no MapRec; o importador do oráculo troca pelo real). */
export const unitAddr = (id: number): number => (0x10000000 + id * 0x200) >>> 0;

/** Campos do registro que vêm dos dados da unidade (o exe os monta ao criar a unidade): lado (+0x49 = TokenSize) e tipo de movimento
 *  (+0x4a = MovementType) do modelo; [est] pelos valores medidos no oráculo: vtable de monstro/humano, máscara de passagem por tipo
 *  (1 anda 0x41, 2 0x44, 3 voa 0x82), dono +0x2c = 1 nos jogadores de IA. */
function initUnitRec(u: Unit): void {
  const r = u.rec;
  r.addr = unitAddr(u.id);
  r.vtbl = u.isHero ? 0x5d0fb8 : 0x5d0eb0;
  r.size = Math.max(1, u.stats.size ?? 1) & 0xff;
  r.kind = u.stats.movement ?? (u.flying ? 3 : 1);
  r.walk.passMask = r.kind === 3 ? 0x82 : r.kind === 2 ? 0x44 : 0x41;
  r.walk.turnRate = (u.stats.turnSpeed ?? Math.round(u.stats.speed * 16)) & 0xff;
  r.walk.f09 = 0xff;
  r.speed = Math.round(u.stats.speed * 16);
  r.f94 = u.hp; r.mana = u.mana;
  r.type.stats.f45 = 1;
  r.type.stats.f20 = u.isHero ? 4 : 0x12;
  r.owner.f2c = u.isHero ? 0 : 1;
  r.ai.f16 = -36;   // +0x1c4+0x16 = 0xffdc em todas as unidades das imagens do oráculo ("nunca")
}

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
  /** registro espelhado do servidor do exe (sim/exe/types.ts): FONTE DE VERDADE da posição, da direção e do andar (caminhos,
   *  passo em curso, tarefa IA+8/+9). Os campos abaixo são vistas sobre ele. */
  readonly rec = new UnitRec();
  /** posição contínua em células (centro da célula = x + 0.5): objeto de mapa +0/+4 (célula e fração em 1/256) */
  get x(): number { return this.rec.mapObj.x + this.rec.mapObj.fx / 256; }
  set x(v: number) { const f = Math.round(v * 256); mapObjSetFine(this.rec.mapObj, f, (this.rec.mapObj.y << 8) | this.rec.mapObj.fy); }
  get y(): number { return this.rec.mapObj.y + this.rec.mapObj.fy / 256; }
  set y(v: number) { const f = Math.round(v * 256); mapObjSetFine(this.rec.mapObj, (this.rec.mapObj.x << 8) | this.rec.mapObj.fx, f); }
  /** célula do chão (a da posição fina; o exe reserva a seguinte só pela pegada, andar+0x80) */
  get cx(): number { return this.rec.mapObj.x; }
  set cx(v: number) { mapObjSetFine(this.rec.mapObj, ((v & 0xff) << 8) | this.rec.mapObj.fx, (this.rec.mapObj.y << 8) | this.rec.mapObj.fy); }
  get cy(): number { return this.rec.mapObj.y; }
  set cy(v: number) { mapObjSetFine(this.rec.mapObj, (this.rec.mapObj.x << 8) | this.rec.mapObj.fx, ((v & 0xff) << 8) | this.rec.mapObj.fy); }
  /** direção do sprite 0..15 a partir do SUL (0 S, 4 O, 8 N, 12 L) = vista do rumo do exe (andar+0, 0..255 a partir do norte).
   *  Escrever é virar na hora (giro já acabado): rumo e rumo desejado (andar+1) iguais. */
  get dir(): number { return ((this.rec.walk.dir >> 4) + 8) & 15; }
  set dir(d: number) { this.rec.walk.dir = this.rec.walk.dirTarget = ((((d | 0) - 8) & 15) << 4) & 0xff; }
  /** rumo fino 0..255 do exe (do norte, horário): andar+0 (escrever fixa também andar+1, como `dir`) */
  get angle(): number { return this.rec.walk.dir; }
  set angle(v: number) { this.rec.walk.dir = this.rec.walk.dirTarget = v & 0xff; }
  state: UnitState = "idle";
  /** ticks desde a última troca de estado */
  stateTime = 0;
  /** ticks acumulados andando (para a animação de passo) */
  walkTime = 0;
  /** ordem de ataque/magia de unidade do lado humano já liberada pelo pensamento 1×/s (o exe só começa a perseguir/lançar no tique
   *  ≡ 7 do relógio de 16/s: teste diferencial, atraso 2–19 tiques; andar começa na hora) */
  orderArmed = true;
  /** tique (nosso) em que a ordem ainda não liberada chegou: a do mesmo tique de 16/s do pensamento perde a vez (o exe pensa antes
   *  de tratar as mensagens do cliente) */
  orderTick = 0;
  /** último alvo de ataque (espelho de +0x1c4+0xc do exe): sobrevive ao Stop; o Stand ground volta a ele se ainda estiver ao alcance */
  lastTarget = 0;
  /** id usado na trava `segundo % 4 == id % 4` da regeneração de vida (padrão: o próprio id; estado importado: o id do original) */
  regenSlot?: number;
  /** tiques seguidos no fim do caminho estático sem chegar (andar+0x90): a ordem desiste (adaptador `walkTo`/`chaseUnit`) */
  waitTicks = 0;
  order: Order = { type: "none" };
  ai: AiMode = { type: "guard", range: MINIMAL_GUARD_RANGE };
  home: Cell;
  target = 0;
  cooldown = 0;
  hitDone = false;
  phased = false;
  suspended = false;
  /** "vida 0" do script/mapa (ogro meio morto da missão 74, refém da 50, druida da 101): a unidade está inconsciente de verdade
   *  (`downed`, vida 0, sprite deitado: `World.knockOut`) e a IA/o piloto automático NÃO a escolhem como alvo (não a tratam como inimigo).
   *  Uma ordem direta de ataque ainda a acerta, como a qualquer caído. */
  helpless = false;
  /** id de quem deu o último golpe/queda (crédito do abate na morte consumada: sim/necro.ts) */
  felledBy = 0;
  /** caiu por `World.knockOut` ("vida 0" do script): a falha de missão (`onDeath`) fica para a morte consumada */
  silentFall = false;
  lastAttacker = 0;
  lastHurtTick = -9999;
  /** guarda da carga do mapa (grupo comando 0x12, 0x5728fa): segundo (relógio 1/s) da última perseguição com o alvo inalcançável
   *  (`+0x1c4+0x16`, gravado em 0x54d76e), tique de 16/s do último golpe/magia recebido (`+0x98`, 0x56e6b8) e o ponto de fuga
   *  (`+0x9c`: 10 células a partir de quem bateu; 0 = nunca) */
  get unreachSec(): number { return this.rec.ai.f16 & 0xffff; }
  set unreachSec(v: number) { this.rec.ai.f16 = ((v & 0xffff) << 16) >> 16; }
  hitClock16 = -100000;
  fleeCell = 0;
  /** alvo da última perseguição que acabou sem o alcançar (fim de caminho, 0x56ed4e) e o tique: a IA não o escolhe de novo por 5 s
   *  [est: evita a unidade presa a um alvo inalcançável (cerca, casa) sendo re-escolhido a cada pensamento; o exe guarda o segundo
   *  em IA+0x16 (0x54d76e) e o pensamento do grupo pesa isso de outro modo] */
  unreachTarget = 0;
  unreachTick = -1e9;
  castSpell: SpellDef | null = null;
  /** ponto-alvo da magia em lançamento (magias de área/teleporte) */
  castX = 0;
  castY = 0;
  /** a magia em lançamento foi decidida pela IA/autocast (não gasta a ordem do jogador) */
  castAuto = false;
  /** magia em lançamento: `stateTime` em que ela sai (fim da carga) e em que a unidade volta a agir (fim da espera); 0 = tempos da
   *  animação [exe 0x50f12c, ver `castTiming`] */
  castHit = 0;
  castEnd = 0;
  /** fase 7 do ciclo do exe sem o rand(0..3): relax + nível da magia + espera da arma (tiques de 16/s; World.beginCycle) */
  cycleRest = 0;
  /** tique em que a ordem mudou ou foi armada (a sub-tarefa recomeça) e em que a unidade chegou ao centro de uma célula: a magia só
   *  começa no tique SEGUINTE a qualquer um dos dois (World.act; medido no golden: Heal/magias da IA 1 tique depois) */
  decideTick = -99;
  arriveTick = -99;
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
  /** vida do corpo depois da morte (a vida +0x94 do original continua caindo: sangria, decomposição) — sim/necro.ts */
  corpseHp = 0;
  /** morte consumada (fim da animação e vida do corpo ≤ −10): a partir daqui o corpo só se decompõe e não volta com Heal */
  bodyDead = false;
  /** id de quem invocou (Summon, +0x148 do original); 0 = não invocada */
  summoner = 0;
  /** magia escolhida no livro (+0x1c4+0x78): unidade do jogador que ataca lança esta magia no lugar do golpe [exe 0x56b059] */
  selectedSpell: string | null = null;
  /** grupo do mapa/script (0 = nenhum) e raio de guarda DO GRUPO em volta do centroide (0 = guarda individual) [exe 0x57275f] */
  group = 0;
  groupRadius = 0;
  /** alvo que a guarda do grupo deu a esta unidade no último pensamento (`+0x1c4 +0x20`, 0x57240b) */
  groupTarget = 0;

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
    this.x = Math.floor(init.x) + 0.5; this.y = Math.floor(init.y) + 0.5;
    this.dir = 0;
    this.home = { x: this.cx, y: this.cy };
    initUnitRec(this);
  }

  get alive(): boolean { return this.state !== "dying" && this.state !== "dead"; }
  /** presente no mapa (vivo e não "phased out") */
  get active(): boolean { return this.alive && !this.phased; }
  /** caído: inconsciente (vida exatamente 0, estável) ou sangrando (−10 < vida < 0); a morte ainda não foi consumada (sim/necro.ts).
   *  Continua alvo de golpes e de Heal [exe 0x567a16 só olha diplomacia/Invisibility; 0x51a2b8: vida > −10]. */
  get downed(): boolean { return !this.alive && !this.bodyDead && !this.phased && this.corpseHp > CORPSE.CONSUMED; }
  /** pode receber golpe: de pé ou caído */
  get targetable(): boolean { return this.active || this.downed; }
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
  /** só desenho: o golpe à distância (flecha, pedra, onda do morcego) já resolveu o dano ao sair [exe 0x50f58d → 0x516c1f] */
  visual?: boolean;
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
  /** células cobertas (índices da grade): parede/campo do exe (notes/combat-formulas.md §4); Wall of Earth bloqueia estas */
  cells?: number[];
  /** área progressiva (Blizzard: pulsos em célula sorteada; Acid Stream: fileiras que se abrem) [exe 0x51806c] */
  prog?: "blizzard" | "acid";
  /** direção 0..7 do exe (quem lança → alvo), passo atual e tique de início da área progressiva */
  dir?: number;
  step?: number;
  t0?: number;
}

export interface Loot { id: number; x: number; y: number; gold: number; items: string[]; }
export interface GroupGuardState { base: number; radius: number; combat: boolean; cmd12?: boolean }

/** Quadro do desenho do saco pelo valor (ouro + valor dos itens): min(int(log10(valor)), n−1) [exe 0x4b1fa9]; valor < 1 → 0. */
export function sackFrame(value: number, frames = 6): number {
  return value < 1 ? 0 : Math.max(0, Math.min(frames - 1, Math.floor(Math.log10(value) + 1e-9)));
}

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
  /** fase do relógio (tiques nossos) somada a `tick` no teste do pensamento 1×/s da IA: 0 = missão recém-criada; um estado
   *  importado do original (tools/refcap/diff) acerta a fase pelo relógio de 16/s do save (`thinkPhaseFor`) */
  clockPhase = 0;
  /** relógio de 1/s da regeneração ([[0x6044c4]+0]): fase (tiques nossos somados a `tick`) e valor no tique 0 — o estado importado do
   *  original acerta os dois (o segundo do exe vira com o relógio de 16/s ≡ 13 nos saves medidos) */
  secPhase = 0;
  secBase = 0;
  /** jogador humano (o do herói): suas unidades usam autocast/Retreat Mode em vez da IA de conjurador */
  humanPlayer = 1;
  private nextId = 1;
  /** Saco no chão da célula (mapa/script): junta com o que já houver ali. */
  addLoot(x: number, y: number, gold: number, items: string[]): void {
    let l = this.loot.find(s => s.x === x && s.y === y);
    if (!l) this.loot.push(l = { id: this.nextId++, x, y, gold: 0, items: [] });
    l.gold += gold; l.items.push(...items);
  }
  /** itens sorteáveis no saque de monstro: [id, preço] (items.json, sem itens de missão) — instalado por mission/setup.ts */
  itemPool?: [string, number][];
  /** preço (valor) de cada item, para o tamanho do saco [exe 0x52a895] — instalado por mission/setup.ts */
  itemPrice?: (id: string) => number;
  /** Valor do saco = ouro + soma dos valores dos itens [exe 0x52a895]; o desenho é o quadro min(int(log10(valor)), 5) [exe 0x4b1fa9]. */
  sackValue(l: Loot): number { return l.gold + l.items.reduce((s, i) => s + (this.itemPrice?.(i) ?? 0), 0); }
  /** tabela de magias (data/spells.json) — instalada por behaviors.ts `installMissionAi` */
  spellTable?: SpellTable;
  /** cria a unidade de um template do data.bin pelo nome (`template`: "Squirrel.2", "F_Zombie.1", "Ghost"...) para Summon e Animate Dead
   *  (sim/necro.ts escolhe o nome pelas regras do exe); a cena/loader fornecem (mission/setup.ts `summonFactoryFor`) */
  summonFactory?: (caster: Unit, x: number, y: number, power: number, template?: string) => UnitInit | undefined;
  /** chamado quando uma unidade morre (o host do script e a cena usam) */
  onDeath?: (u: Unit, killer: Unit | undefined) => void;
  /** células atingidas por magia de área que também age sobre ESTRUTURAS (Fireball, pulsos de Blizzard) [exe 0x518833 → 0x518681 com
   *  Map_StructureAtCell]: o host liga as alavancas atingidas (mission/host.ts `areaHitStructures`; medido na 103) */
  onAreaCells?: (cells: [number, number][], spell: string) => void;

  /** objeto de mapa/caminho do servidor do exe (grades, ocupação: fonte de verdade do andar), o mundo dele e a memória do mapa sem
   *  unidades (base para refazer a ocupação depois de restaurar um save antigo) */
  readonly exe: MapRec;
  readonly exeWorld: WorldRec;
  readonly exeBase: Uint8Array;
  /** ocupação do mapa sem unidades (registros das estruturas): célula → bytes do OccRec; e as estruturas (OccRec+0xc) */
  private readonly exeBaseOcc: [number, Uint8Array][] = [];
  private readonly exeBaseStructs: [number, CellStructRec][] = [];
  /** o estado do exe (registros, MapRec) deste tique veio do oráculo (sim/test/import_state.ts): os adaptadores não reescrevem os
   *  campos da tarefa que o estado já traz, e `dispatch` não sincroniza os campos que o motor antigo ainda calcula; vale um `step` */
  exeExact = false;

  constructor(grid: Grid, players: number, seed = 1234) {
    this.grid = grid;
    this.exe = mapRecFromGrid(grid);
    this.exeWorld = this.exe.world!;
    this.exeBase = this.exe.mem.slice();
    for (const a of this.exe.occ.table ?? []) for (let p = a; p; p = p.next) this.exeBaseOcc.push([p.key, p.value.b.slice()]);
    this.exeBaseStructs.push(...this.exe.structs);
    this.rng = new Rng(seed);
    this.exeWorld.rng = this.rng;   // os sorteios das funções portadas (0x57afc0) saem do mesmo gerador, nos mesmos sítios
    this.dip = Array.from({ length: players + 1 }, () => new Array(players + 1).fill(0));
    this.money = new Array(players + 1).fill(0);
    this.playerAi = Array.from({ length: players + 1 }, () => ({ formation: 1, retreat: 0, autocast: 0x18 | 1 }));
  }

  // ------------------------------------------------------------------------------------------- unidades

  spawn(init: UnitInit): Unit {
    const u = new Unit(this.nextId++, init);
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying) ?? { x: u.cx, y: u.cy };
    u.x = c.x + 0.5; u.y = c.y + 0.5; u.home = { x: c.x, y: c.y };
    this.units.push(u);
    this.byId.set(u.id, u);
    this.exe.units.set(u.rec.addr, u.rec);
    u.rec.owner.f2c = this.isAiPlayerUnit(u) ? 1 : 0;
    this.occupy(u);
    return u;
  }

  get(id: number): Unit | undefined { return this.byId.get(id); }
  /** Unidade do registro no endereço `addr` (ponteiros u32 do exe: alvo da perseguição andar+0x7c, IA+0x18). */
  unitByAddr(addr: number): Unit | undefined {
    if (!addr) return undefined;
    for (const u of this.units) if (u.rec.addr === (addr >>> 0)) return u;
    return undefined;
  }

  /** Põe a unidade na célula: `grid.occ` e, no exe, o registro de ocupação e a pegada (0x55020a Unit_PlaceOnCells). */
  private occupy(u: Unit): void {
    if (u.phased || !u.alive) return;
    this.grid.occ[this.grid.idx(u.cx, u.cy)] = u.id;
    unitPlaceOnCells(this.exe, u.rec);
  }
  /** Tira a unidade da célula: `grid.occ` e, no exe, a pegada e o registro de ocupação (0x553891 Unit_RemoveFromCells). */
  private release(u: Unit): void {
    const i = this.grid.idx(u.cx, u.cy);
    if (this.grid.occ[i] === u.id) this.grid.occ[i] = 0;
    unitRemoveFromCells(this.exe, u.rec);
  }
  /** Interrompe o andar do exe (salto, queda, fora de fase): sem passo em curso nem caminho dinâmico. */
  private walkAbort(u: Unit): void {
    if (u.rec.ai.sub === 3) u.rec.ai.sub = 0;
    u.rec.pathDynamic.removeAll();
    u.rec.walk.stepTick = 0; u.rec.walk.stepTicks = 0;
  }

  phaseOut(u: Unit): void {
    if (u.phased) return;
    this.release(u);
    u.phased = true;
    this.walkAbort(u); u.order = { type: "none" }; u.target = 0;
    if (u.state !== "dead" && u.state !== "dying") this.setState(u, "idle");
  }

  phaseIn(u: Unit): void {
    if (!u.phased) return;
    u.phased = false;
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying, 12, u.id) ?? { x: u.cx, y: u.cy };
    u.x = c.x + 0.5; u.y = c.y + 0.5;
    this.occupy(u);
  }

  /** Põe a unidade EXATAMENTE na posição contínua (x, y) da célula (cx, cy), sem buscar célula livre (importação de estado do
   *  original, sim/test/import_state.ts). */
  placeExact(u: Unit, cx: number, cy: number, x = cx + 0.5, y = cy + 0.5): void {
    this.release(u);
    u.x = x; u.y = y;
    this.walkAbort(u);
    this.occupy(u);
  }

  teleport(u: Unit, x: number, y: number): void {
    this.release(u);
    const c = this.grid.nearestFree(x, y, u.flying, 12, u.id) ?? { x, y };
    u.x = c.x + 0.5; u.y = c.y + 0.5;
    this.walkAbort(u);
    this.occupy(u);
  }

  /** As estruturas do mapa (alvo dos ponteiros OccRec+0xc) de volta (o estado importado do oráculo usa as do original). */
  exeRestoreStructs(): void {
    this.exe.structs.clear();
    for (const [a, s] of this.exeBaseStructs) this.exe.structs.set(a, s);
  }

  /** Refaz a ocupação do exe a partir das unidades (save antigo sem o estado do MapRec; estado importado sem o despejo do exe): mapa
   *  sem unidades (com os registros das estruturas) + cada unidade ativa posta na sua célula (0x55020a) e, a meio passo, a pegada nas
   *  duas células do passo; paredes de magia de volta. [est] O passo 6 que 0x550a96 já tinha posto nas células livres das estruturas
   *  e a pegada de quem só gira para a célula seguinte não voltam. */
  exeResync(): void {
    this.exe.mem.set(this.exeBase);
    this.exe.occ.removeAll();
    this.exeRestoreStructs();
    const r = new OccRec();
    for (const [c, b] of this.exeBaseOcc) { r.b.set(b); this.exe.occ.setAt(c, r); }
    for (let i = 0; i < this.grid.block.length; i++) if (this.grid.block[i]! & BLOCK_SPELL) this.exeWallCell(i, true);
    this.exe.units.clear();
    for (const u of this.units) {
      this.exe.units.set(u.rec.addr, u.rec);
      if (!u.phased && u.alive) unitPlaceOnCells(this.exe, u.rec);
    }
    // a meio passo a pegada cobre as duas células do passo (0x555c7e / 0x554fd2: modo 0 na outra)
    for (const u of this.units) {
      const r = u.rec, cur = ((u.cy & 0xff) << 8) | (u.cx & 0xff);
      if (u.phased || !u.alive || r.ai.sub !== 3) continue;
      fn_0x55be86(this.exe, r, cur === (r.walk.stepFrom & 0xffff) ? r.walk.nextCell & 0xffff : r.walk.stepFrom & 0xffff, 0);
    }
  }

  /**
   * Condição de script V22 "Teleportation" (De X/Y → Para X/Y) [exe 0x5776fd → 0x55201a + 0x55a96c; notes/script-teleportation.md]: acha a unidade
   * na célula de origem (qualquer dono, só quem ocupa a célula — fora de fase/morta não conta) e a leva ao destino com a rotina do Teleport. Devolve 1 se
   * havia unidade na origem (mesmo que o destino esteja bloqueado e ela não saia do lugar: o exe testa a pegada no destino e, se falha, só deixa o
   * resultado em 1), 0 se a origem está vazia. Sem busca de célula livre próxima (diferente de `teleport`/magia): o destino tem de estar livre.
   */
  portalTeleport(fromX: number, fromY: number, toX: number, toY: number): number {
    const u = this.unitAtCell(fromX, fromY);
    if (!u || !u.alive) return 0;
    const g = this.grid;
    const free = g.inside(toX, toY) && g.passable(toX, toY, u.flying) && g.occ[g.idx(toX, toY)] === 0;
    if (!free) return 1;
    const fx = u.cx, fy = u.cy;
    this.teleport(u, toX, toY);
    this.events.push({ type: "teleport", unit: u.id, x: u.cx, y: u.cy, fromX: fx, fromY: fy });
    return 1;
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
    // fim da guerra: unidades da IA de `a` largam o alvo de `b` (senão o golpe seguinte reabre a guerra) [est: o exe escolhe alvos só entre
    // inimigos (0x567a16) a cada pensamento; o ataque em curso de uma unidade do jogador humano continua]
    if (old & DIP_WAR && !(nv & DIP_WAR) && a !== this.humanPlayer) {
      for (const u of this.units) {
        if (u.player !== a || !u.active) continue;
        const tid = u.order.type === "attack" ? u.order.target : u.order.type === "cast" ? u.order.target ?? 0 : 0;
        if (tid && this.get(tid)?.player === b) this.resumeOrNone(u);
      }
    }
  }
  /** valor de diplomacia no formato do script (0 paz, 1 guerra, 2 aliado) */
  diplomacyValue(a: number, b: number): number {
    const v = this.dip[a]?.[b] ?? 0;
    return v & DIP_WAR ? 1 : v & 2 ? 2 : 0;
  }

  // ------------------------------------------------------------------------------------------- ordens

  command(u: Unit, o: Order): void {
    if (!u.active) return;
    if ((o.type === "attack" || o.type === "cast") && !this.isAiPlayerUnit(u)) {
      const p = u.order as { type: string; target?: number; spell?: string; x?: number; y?: number };
      const q = o as { type: string; target?: number; spell?: string; x?: number; y?: number };
      if (p.type !== q.type || p.target !== q.target || p.spell !== q.spell || p.x !== q.x || p.y !== q.y) {
        u.orderArmed = false; u.orderTick = this.tick;
        // a mensagem do cliente larga a tarefa em curso até o pensamento (IA+8 = 0, alvo novo em IA+0xc; medido: herói da m10_start,
        // ataque novo em T=119) [est: o tratador da mensagem não está portado]
        const t = q.target ? this.get(q.target) : undefined;
        u.rec.ai.task = 0;
        if (q.type === "attack" && t) u.rec.ai.f0c = t.rec.addr;
      }
    } else u.orderArmed = true;
    // ordem nova do lado humano: a mensagem do cliente zera a perseguição (andar+0x7c; medido: herói da m10_start, T=119 ataque e
    // T=429 andar); a de andar já põe a tarefa 1 e o destino (IA+8, IA+0xa)
    if (!this.isAiPlayerUnit(u) && !sameOrder(u.order, o)) {
      u.rec.walk.chaseTarget = 0;
      if (o.type === "move") {
        const x = Math.max(MAP_BORDER, Math.min(this.grid.w - MAP_BORDER - 1, o.x)), y = Math.max(MAP_BORDER, Math.min(this.grid.h - MAP_BORDER - 1, o.y));
        u.rec.ai.task = 1; u.rec.ai.f0a = ((y & 0xff) << 8) | (x & 0xff);
      }
    }
    if (!sameOrder(u.order, o)) u.decideTick = this.tick;
    u.order = o;
    u.resume = null;
    // o caminho (registro do exe) fica: o exe só o limpa quando o destino do estático muda (0x555411) ou o alvo da perseguição muda
    u.waitTicks = 0;
    // golpe/lançamento em curso termina no alvo dele (a IA do exe troca a sub-tarefa; a ação em andamento vai até o fim, 0x50f12c)
    if (u.state === "attack" || u.state === "cast") { /* u.target fica */ }
    else if (o.type === "attack") u.target = o.target;
    if (o.type === "attack") u.lastTarget = o.target;
    else if (o.type !== "cast") u.target = 0;
    if (o.type === "retreat") { u.fleeX = -1; u.fleeY = -1; }
    if (o.type === "guard") u.home = { x: o.x, y: o.y };
  }

  /** Volta à ordem interrompida (patrulha/guarda do jogador) ou fica parado. */
  resumeOrNone(u: Unit): void {
    const r = u.resume;
    this.command(u, r ?? { type: "none" });
  }

  // ------------------------------------------------------------------------------------------- guarda de grupo

  /** Unidade de um jogador de IA (decide 1×/s pela IA do jogador; as do jogador humano usam autocast/ordens). */
  isAiPlayerUnit(u: Unit): boolean { return !u.isHero && u.player !== this.humanPlayer; }

  /** Comando Guard de um grupo de IA [exe 0x5709d9 → 0x57026e → 0x56f850 e 0x5726f7]: posto de cada unidade = a própria célula (0x56d4ba);
   *  raio-base do grupo = max(Chebyshev(unidade, centroide) + scanRange) das unidades (`+0x2c`), elevado ao parâmetro do comando (> 0) ou, sem
   *  ele, a MinimalGuardRange (`+0x38`); no 1º pensamento o raio vira `base + 4 + rand(−1..1)` (`+0x2d`) e fica. [est] o rand(−1..1) do exe
   *  vira um hash do número do grupo (não desloca a sequência de sorteios dos pilotos). */
  initGroupGuard(group: number, units: Unit[], param = 0, setup = false): void {
    const m = units.filter(u => u.alive && this.isAiPlayerUnit(u));
    if (!group || !m.length) return;
    const cx = Math.floor(m.reduce((s, u) => s + u.cx, 0) / m.length), cy = Math.floor(m.reduce((s, u) => s + u.cy, 0) / m.length);
    let geom = 0;
    for (const u of m) geom = Math.max(geom, Math.max(Math.abs(u.cx - cx), Math.abs(u.cy - cy)) + Math.max(0, Math.floor(u.stats.sight)));
    // raio-base (+0x38): com parâmetro, max(geometria, parâmetro); sem ele e abaixo de MinimalGuardRange (ai.reg: 8), o Guard da
    // carga do mapa (0x570aba, comando 0x12) usa 20 e o Guard do script (0x5709d9) usa 8 — conferido nos grupos exportados das
    // missões 10 e 20 (unidades sozinhas: 20 fora de combate, 25 = 20 + 4 + 1 em combate)
    const base = param > 0 ? Math.max(geom, param) : geom >= MINIMAL_GUARD_RANGE ? geom : setup ? 20 : MINIMAL_GUARD_RANGE;
    this.groupState.set(group, { base, radius: base, combat: false, cmd12: setup });
    for (const u of m) { u.group = group; u.groupRadius = base; u.groupTarget = 0; u.home = { x: u.cx, y: u.cy }; }
  }

  /** estado da guarda de cada grupo de IA (comando `+0x3c`): raio-base `+0x38`, raio atual `+0x2d`, em combate `+0x30`; `cmd12` = Guard
   *  da carga do mapa (comando 0x12, 0x570aba → pensamento 0x5728fa; o Guard do script é o comando 1, 0x57275f) */
  groupState = new Map<number, GroupGuardState>();

  /** grupos de IA "acordados" (`+0x3c+0x45`), refeito no início de cada pensamento da IA [exe 0x56fe4d → 0x55b5f1]: grupo com alguma
   *  unidade ferida (vida < máx.) ou num bloco de 8×8 células a ≤ 2 blocos (Chebyshev) do bloco de alguma unidade do jogador humano.
   *  Grupo dormindo não pensa (0x570087) e o despachante de ações das unidades dele não roda (0x56dca2: ação 0x1b). `null` = todos. */
  activeGroups: Set<number> | null = null;
  /** grupos sempre acordados (`+0x3c+0x48`, posto pelos gatilhos do script 0x562745 nos grupos que eles citam). `null` = não modelado:
   *  todos acordados (o jogo normal; o importador do diferencial deduz do estado exportado: ação 0x1b = dormindo) */
  alwaysAwake: Set<number> | null = null;
  computeActiveGroups(): void {
    if (!this.alwaysAwake) { this.activeGroups = null; return; }
    const marks: [number, number][] = [];
    for (const u of this.units) if (u.alive && (u.isHero || u.player === this.humanPlayer)) marks.push([Math.floor(u.x) >> 3, Math.floor(u.y) >> 3]);
    const act = new Set<number>(this.alwaysAwake);
    for (const u of this.units) {
      if (!u.group || act.has(u.group) || !u.alive || !this.isAiPlayerUnit(u)) continue;
      if (u.hp < u.maxHp) { act.add(u.group); continue; }
      const bx = Math.floor(u.x) >> 3, by = Math.floor(u.y) >> 3;
      if (marks.some(([x, y]) => Math.abs(x - bx) <= 2 && Math.abs(y - by) <= 2)) act.add(u.group);
    }
    this.activeGroups = act;
  }
  /** a unidade pertence a um grupo acordado (sem grupo: sempre) */
  awake(u: Unit): boolean { return !u.group || !this.activeGroups || this.activeGroups.has(u.group); }

  /** relógio de 16/s do original no nosso tique 0 (estado importado: `t16 − clock16()` no tique da importação); `null` = jogo normal
   *  (o pensamento segue `clockPhase`/AI_THINK_PHASE) */
  t16base: number | null = null;
  /** este tique é o do pensamento 1×/s (despachante de tarefas do exe) */
  thinkNow = false;
  /** unidades na ordem do servidor do exe: jogador e, dentro dele, id (o do original nos estados importados) */
  serverOrder(): Unit[] {
    return [...this.units].sort((a, b) => a.player - b.player || (a.regenSlot ?? a.id) - (b.regenSlot ?? b.id));
  }

  /** contador de 1/s do exe (`[[0x6044c4]+0]`) no nosso relógio: o mesmo da regeneração */
  secClock(): number { return this.secBase + Math.floor((this.tick + this.secPhase) / TICKS_PER_SEC); }
  /** relógio de 16/s do exe (`[[0x6044c4]+4]`) no nosso tique: o tique de servidor k cai no nosso tique round(1,25·k) (a mesma conversão
   *  do pensamento calibrada em `thinkPhaseFor`), ou seja, k ≤ t ⇔ 1,25·k + 0,5 < t + 1 */
  clock16(t = this.tick): number { return Math.ceil(((2 * t + 1) * SERVER_TICKS_PER_SEC) / (2 * TICKS_PER_SEC)) - 1; }

  /** 0x56e6b8 (chamada em todo golpe físico — acerto ou não — e em magias com dano): marca o tique de 16/s e o ponto de fuga da
   *  vítima = célula da vítima + 10 × (vítima − atacante) / max(|dx|,|dy|) em coordenadas finas, truncado (ftol), palavra y<<8 + x. */
  noteAttacked(a: Unit, t: Unit): void {
    t.hitClock16 = this.clock16();
    t.rec.ai.f54 = 1;   // IA+0x54 = 1: a próxima olhada em volta (0x56e5bc, tarefa 0xb) gira sem o sorteio de 204
    const dx = Math.floor(t.x * 256) - Math.floor(a.x * 256), dy = Math.floor(t.y * 256) - Math.floor(a.y * 256);
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (!m) { t.fleeCell = 0; return; }
    const X = Math.trunc(Math.floor(t.x) + dx * (10 / m)), Y = Math.trunc(Math.floor(t.y) + dy * (10 / m));
    t.fleeCell = ((Y << 8) + X) & 0xffff;
  }
  /** mapa de células vistas (zerado) do tamanho do mapa (rascunho do módulo: não faz parte do estado do mundo) */
  private visionScratch(): Uint8Array {
    const n = this.grid.w * this.grid.h;
    if (VIS_SEEN.length !== n) VIS_SEEN = new Uint8Array(n); else VIS_SEEN.fill(0);
    return VIS_SEEN;
  }

  /** Células que a unidade vê (0x552c28): orçamento `(scan << 7) + 64` no centro de uma janela 41×41; cada célula herda o orçamento do
   *  "pai" (tabela fixa, a vizinha em direção ao centro) menos o passo (128 reto, 181 diagonal) e menos a diferença de altura para a
   *  unidade (subir gasta, descer devolve); vê quem fica com orçamento > 0. Anéis 1..19; para no 1º anel sem nenhuma célula vista;
   *  células fora da área útil não contam. Devolve a marca por célula (índice y×W + x) em `out`. */
  markVision(u: Unit, out: Uint8Array): void {
    const g = this.grid, W = g.w, ux = Math.floor(u.x), uy = Math.floor(u.y);
    const scan = Math.max(0, Math.floor(this.sightOf(u)));
    const bud = VIS_BUDGET; bud.fill(0);
    bud[20 * 41 + 20] = (scan << 7) + 64;
    if (g.inside(ux, uy)) out[uy * W + ux] = 1;
    const ualt = g.inside(ux, uy) ? g.alt[uy * W + ux]! : 0;
    const x0 = MAP_BORDER, y0 = MAP_BORDER, x1 = W - MAP_BORDER - 1, y1 = g.h - MAP_BORDER - 1;
    const cell = (lx: number, ly: number): boolean => {
      const ax = ux - 20 + lx, ay = uy - 20 + ly;
      if (ax < x0 || ax > x1 || ay < y0 || ay > y1) return false;
      const k = lx * 41 + ly;
      const p = (lx + VIS_PARENT[k * 2]!) * 41 + ly + VIS_PARENT[k * 2 + 1]!;
      const b = bud[p]! - (VIS_COST[k]! + g.alt[ay * W + ax]! - ualt);
      bud[k] = b;
      if (b > 0) { out[ay * W + ax] = 1; return true; }
      return false;
    };
    for (let r = 1; r < 20; r++) {
      let any = false;
      for (let k = -r; k <= r; k++) {
        if (cell(20 + k, 20 - r)) any = true;
        if (cell(20 + k, 20 + r)) any = true;
        if (cell(20 - r, 20 + k)) any = true;
        if (cell(20 + r, 20 + k)) any = true;
      }
      if (!any) break;
    }
  }

  /** Pensamento da guarda dos grupos de IA, 1×/s [exe 0x57275f]: centroide atual do grupo (média inteira das células, 0x56fa63);
   *  inimigos vistos por alguma unidade do grupo (mapa de visão 0x571c4d → filtro de diplomacia/Invisibility 0x567a16) a Chebyshev ≤ raio
   *  do centroide (0x567e92); cada unidade recebe o de menor custo (0x57240b → 0x5711ea): distância de Chebyshev (para quem atira, o que
   *  falta além do alcance + 1), × 256, + 0x7f se o alvo está petrificado. Sem alvo a unidade volta ao próprio posto (0x56c8af).
   *  [est] visão = raio `sightOf` de cada unidade do grupo; a tabela de preferência por classe (+0xa54) e o desempate 0x55aa21 não são
   *  modelados (empate = o mais perto em Euclides). */
  private thinkGroups(): void {
    const groups = new Map<number, Unit[]>();
    for (const u of this.units) {
      if (!u.group || u.groupRadius <= 0 || !u.active || u.phased || u.suspended || u.helpless || !this.isAiPlayerUnit(u)) continue;
      let g = groups.get(u.group);
      if (!g) groups.set(u.group, (g = []));
      g.push(u);
    }
    for (const [gid, m] of groups) {
      if (this.activeGroups && !this.activeGroups.has(gid)) continue;   // grupo dormindo não pensa (0x570087)
      const guards = m.filter(u => u.ai.type === "guard");
      if (!guards.length) continue;
      const cx = Math.floor(m.reduce((s, u) => s + Math.floor(u.x), 0) / m.length), cy = Math.floor(m.reduce((s, u) => s + Math.floor(u.y), 0) / m.length);
      const gs: GroupGuardState = this.groupState.get(gid) ?? { base: guards[0]!.groupRadius, radius: guards[0]!.groupRadius, combat: false };
      const r = gs.radius;
      const foes: Unit[] = [];
      // visão do GRUPO (0x571c4d): células vistas por alguma unidade (orçamento com relevo, World.markVision); entra quem está numa
      // delas (célula do CHÃO = floor da posição fina, objeto de mapa do exe), passa no filtro de diplomacia/Invisibility (0x567a16) e
      // fica a Chebyshev ≤ raio do centroide (0x567e92)
      const seen = this.visionScratch(); for (const u of m) this.markVision(u, seen);
      const W = this.grid.w;
      for (const v of this.units) {
        const vx = Math.floor(v.x), vy = Math.floor(v.y);
        if (!v.targetable || v.helpless || !this.grid.inside(vx, vy) || !seen[vy * W + vx] || Math.max(Math.abs(vx - cx), Math.abs(vy - cy)) > r) continue;
        if (m.some(u => this.isEnemy(u, v) && this.canSee(u, v))) foes.push(v);
      }
      // raio (0x5726f7 / 0x57272c): o teste de 0x57275f/0x5728fa é `FUN_0055f220(grupo)` = a 1ª UNIDADE do grupo (não um inimigo): grupo
      // com unidades → no 1º pensamento acordado o raio vira base + 4 + rand(−1..1) e `+0x30` = 1 para sempre; grupo vazio → base + rand(−1..1).
      // (os grupos exportados em "combate" sem alvo nenhum e com raio = base + 3..5 confirmam)
      if (m.length) { if (!gs.combat) { gs.radius = gs.base + 4 + this.rng.range(-1, 1, 0x572718); gs.combat = true; } }
      else if (gs.combat) { gs.radius = gs.base + this.rng.range(-1, 1, 0x57274d); gs.combat = false; }
      this.groupState.set(gid, gs);
      for (const u of m) u.groupRadius = gs.radius;
      for (const u of guards) {
        const range = Math.max(1, this.attackRange(u));
        let best: Unit | undefined, bs = Infinity, be = Infinity;
        for (const v of foes) {
          if (!this.isEnemy(u, v)) continue;
          let d = Math.max(Math.abs(v.cx - u.cx), Math.abs(v.cy - u.cy));
          if (range > 1) d = d > range ? d - range + 1 : 1;
          const s = d * 256 + (v.hasBuff("stone") ? 0x7f : 0), e = Math.hypot(v.cx - u.cx, v.cy - u.cy);
          if (s < bs || (s === bs && e < be)) { bs = s; be = e; best = v; }
        }
        u.groupTarget = best?.id ?? 0;
      }
    }
  }

  // ------------------------------------------------------------------------------------------- laço

  step(): void {
    this.tick++;
    const serverTick = this.clock16() !== this.clock16(this.tick - 1);
    // estado importado do original: o pensamento sai no tique de servidor com relógio de 16/s ≡ 7, ANTES do laço das unidades desse
    // tique (sonda rngprobe: os sorteios do apoio dos conjuradores vêm antes dos do olhar em volta)
    const aiTick = this.t16base === null ? (this.tick + this.clockPhase) % TICKS_PER_SEC === AI_THINK_PHASE
      : serverTick && (((this.t16base + this.clock16()) % 16) + 16) % 16 === 7;
    this.thinkNow = aiTick;
    // o pensamento do exe (Server_Tick 0x4f08c0: `t16 & 15 == 6` → 0x56fe4d) roda ANTES de Server_ClockTick incrementar o relógio e
    // rodar as unidades: é o mesmo tique do nosso ≡ 7 (relógio já incrementado), mas os sorteios dele foram gravados com o relógio
    // anterior — no replay (golden) o bloco do pensamento busca a fila do tique − 1
    if (aiTick && this.t16base !== null) this.rng.shift = -1;
    if (aiTick) {
      // em tiques de 16/s: a ordem precisa ter chegado ≥ 2 tiques antes do pensamento (a do tique anterior só vale no tique dele)
      const s16 = (t: number) => Math.round(t * SERVER_TICKS_PER_SEC / TICKS_PER_SEC);
      for (const u of this.units) if (s16(this.tick) - s16(u.orderTick) >= 2) { if (!u.orderArmed) u.decideTick = this.tick; u.orderArmed = true; }
      this.computeActiveGroups();
      this.thinkGroups();
      // armadilhas do script [exe 0x57a47d → 0x57a307]: no fim do pensamento da IA cada uma sorteia 1 dos candidatos na zona
      // (Rand_Range(1, n): 1 rand() mesmo com n = 0) — a escolha em si continua em stepTraps
      for (let i = 0; i < this.traps.length; i++) this.rng.draw(0x57a409);
      // o pensamento consome a lista de eventos do mundo (+0xbbec: golpes e magias para a IA de grupo, 0x574899/0x574ba1 — etapa
      // 8) e a esvazia (0x57485b → 0x57b2b0 RemoveAll)
      this.exeWorld.events.removeAll();
    }
    // ordem do servidor: jogadores em ordem e, em cada um, as unidades por id (sonda rngprobe: a posição dos sorteios do olhar em volta
    // bate 9/9 com (jogador, id)); `regenSlot` = id do original nos estados importados
    const order = this.serverOrder();
    if (aiTick && this.t16base !== null) {
      // decisões da IA (fuga, alvo, apoio) no pensamento, antes do laço das unidades
      for (const u of order) {
        if (u.state === "dead" || u.state === "dying" || u.phased || !u.active || u.isHero || u.suspended || u.helpless || !this.isAiPlayerUnit(u)) continue;
        if (this.stunned(u) || !this.awake(u)) continue;
        aiThink(this, u, true);
      }
    }
    this.rng.shift = 0;
    for (const u of order) {
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
      // unidades do jogador humano: a cada 4 tiques; jogadores de IA: o pensamento que DECIDE (alvo, magia, fuga) é 1×/s, na fase
      // AI_THINK_PHASE [exe 0x570087]; entre um e outro só conferem o alvo atual (a sub-tarefa em curso continua no `act`)
      const decide = aiTick && this.isAiPlayerUnit(u) && this.t16base === null;
      // o herói confere a sub-tarefa em TODO tique (Stand ground do despachante 0x569321 → 0x56dbc6; a decisão vale no pensamento
      // seguinte): a cada 4 tiques, a 16/s, a conferência podia cair no próprio tique do pensamento (depois dele) e a ordem esperava 1 s a mais
      if (decide || u.isHero || (this.tick + u.id) % 4 === 0) {
        if (u.isHero) heroThink(this, u);
        else if (!u.suspended && !u.helpless) aiThink(this, u, decide || !this.isAiPlayerUnit(u)); // caído (vida 0 do mapa/script): não age nem se cura sozinho
      }
      this.act(u);
    }
    this.stepProjectiles();
    if (this.areas.length) this.stepAreas();
    if (this.traps.length) this.stepTraps();
    stepCorpses(this);   // sangria/decomposição dos corpos [exe 0x50fc5a/0x5110b8] (sim/necro.ts)
    stepSummons(this);   // desgaste das invocações [exe 0x52bbb7]
  }

  /** Levanta quem estava morrendo (Heal que passa a vida de 0) [exe 0x510534]: volta ao estado normal com `hp`. */
  revive(u: Unit, hp: number, quiet = false): void {
    if (u.alive) return;
    u.hp = Math.max(1, Math.min(u.maxHp, Math.round(hp)));
    u.corpseHp = 0; u.bodyDead = false; u.felledBy = 0; u.silentFall = false;
    this.walkAbort(u); u.order = { type: "none" }; u.target = 0; u.castSpell = null;
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying, 6, u.id) ?? { x: u.cx, y: u.cy };
    u.x = c.x + 0.5; u.y = c.y + 0.5;
    this.setState(u, "idle");
    this.occupy(u);
    if (!quiet) this.events.push({ type: "heal", unit: u.id, amount: u.hp });
  }

  /** "Vida 0" do mapa/script (refém da 50, druida chefe da 101, ogro da 74): a unidade fica inconsciente — vida exatamente 0, deitada, estável
   *  (não sangra nem regenera), alvo de golpes e de Heal — sem passar pela morte (nada de `fall`/`onDeath`/som). `helpless` mantém a IA e o
   *  piloto automático longe dela (o script cuida de quando acorda: mission/host.ts). */
  knockOut(u: Unit): void {
    u.helpless = true;
    if (!u.alive) { if (u.downed) u.corpseHp = 0; return; }
    u.silentFall = true;
    onFell(u, 0);
    u.hp = 0;
    this.release(u);
    this.walkAbort(u); u.order = { type: "none" }; u.target = 0; u.castSpell = null;
    this.setState(u, "dead");
  }

  /** Regeneração [exe 0x50fc5a]: chamada 1× por segundo do jogo (contador [[0x6044c4]+0], 1/s — medido no original, refs/trace/d_hp.jsonl)
   *  e só age no segundo em que `segundo % 4 == id % 4`, ou seja, **uma vez a cada 4 s por unidade**: vida += 2 × vidaMax × k / healthRegen
   *  (healthRegen = PERÍODO; k = 3 se a unidade não age há > 80 tiques de 16/s = 5 s), resto fracionário acumulado; idem mana. Também em
   *  combate (o exe não tem trava de combate). Medido: herói 142 PV descansando +8/+9 a cada 4 s (40 → 142 em 46,6 s); cobra (30 PV,
   *  período 60) +1 a cada 4 s e +3 depois de 5 s parada. O veneno (Poison Cloud) continua 1×/s. */
  private regen(u: Unit): void {
    if ((this.tick + u.id) % TICKS_PER_SEC === 0) {
      const poison = u.buffs.find(b => b.kind === "poison");
      if (poison) {
        const dmg = Math.max(1, Math.floor(poison.amount * (100 - this.resistOf(u, "water")) / 100 + 0.75));
        this.damage(poison.from ? this.get(poison.from) : undefined, u, dmg, "water", true);
        if (!u.alive) return;
      }
    }
    const t = this.tick + this.secPhase;
    if (t % TICKS_PER_SEC !== 0) return;
    if (u.helpless) return; // inconsciente (vida 0 do script): sem regeneração até acordar
    const k = this.tick - u.lastActionTick > 5 * TICKS_PER_SEC ? 3 : 1;
    // vida: só no segundo em que `segundo % 4 == id % 4` [exe 0x50fcd8]
    const hr = u.stats.healthRegen ?? 0;
    if ((this.secBase + Math.floor(t / TICKS_PER_SEC)) % 4 === (u.regenSlot ?? u.id) % 4) {
      if (hr > 0 && u.hp < u.maxHp) {
        u.regenAcc += 2 * u.maxHp * k / hr;
        const add = Math.floor(u.regenAcc);
        if (add > 0) { u.regenAcc -= add; u.hp = Math.min(u.maxHp, u.hp + add); }
      } else u.regenAcc = 0;
    }
    // mana: TODO segundo, sem a trava de id % 4 e sem o ×2 da vida [exe 0x50fdd5: mana×100 + resto += manaMax × (100 + bônus) × k /
    // período; medido no diferencial: maga com 99 de mana máx. e período 50 ganha +2 por segundo]
    const mr = u.stats.manaRegen ?? 0;
    if (mr > 0 && u.mana < u.maxMana) {
      u.manaAcc += u.maxMana * k / mr;
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
    return !u.alive ? Math.floor(d / 2) : d;   // +0x13c ≠ 0: a defesa fica pela metade enquanto a unidade está caída (Heal a dobra de volta)
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
      if (v === u || !v.targetable || !this.isEnemy(u, v) || !this.canSee(u, v)) continue;   // caídos também (a IA os escolhe)
      if (v.id === u.unreachTarget && this.tick - u.unreachTick < 5 * TICKS_PER_SEC) continue;   // inalcançável há pouco (ver Unit.unreachTarget)
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
  attackRange(u: Unit): number {
    const base = u.weaponSpell ? Math.max(u.stats.range, u.weaponSpell.range) : u.stats.range;
    return u.selectedSpell ? Math.max(base, selectedSpellRange(u)) : base;
  }

  validTarget(u: Unit, id: number): boolean {
    const t = this.get(id);
    return !!t && t.targetable && t !== u;
  }

  // ------------------------------------------------------------------------------------------- execução das ordens

  private act(u: Unit): void {
    const r = u.rec;
    // golpe/magia fora da sub-ação do exe (magia no chão: tarefa 9, sem porta): só a máquina de ação do motor antigo
    if (r.ai.sub === 0 && (u.state === "attack" || u.state === "cast")) { this.progressAttack(u); return; }
    // máquina parada com a sub-ação 1/2 ainda contando (estado importado a meio golpe/magia sem a máquina, ou golpe abortado): o
    // pedido fica pronto para o despachante soltar a sub-ação (+0x136)
    if ((r.ai.sub === 1 || r.ai.sub === 2) && r.ai.f15 > 0 && u.state !== "attack" && u.state !== "cast") r.ready = 1;
    // ordem de andar: o pensamento (0x569321, tique ≡ 7) larga a tarefa 1 (IA+8 = 0) quando a CÉLULA já é a do destino, mesmo a meio
    // passo; a classe da tarefa (+0x50) só vira "parado" no pensamento em que a unidade já está no centro (medido: herói da m10_start
    // no centro em T=49 → as duas em T=50; da m10_mage a meio passo em T=97 → IA+8 = 0 em T=98, classe 1 até o pensamento seguinte)
    if (u.order.type === "move" && this.thinkNow && u.cx === u.order.x && u.cy === u.order.y) {
      if (u.rec.ai.sub === 3 && !u.order.arrived) { u.order.arrived = true; u.rec.ai.task = 0; }
      else this.command(u, { type: "none" });
    }
    // patrulha: o pensamento (0x569b62 → 0x56c8af) passa ao ponto seguinte quando a célula já é a do ponto, idem (medido: m20_start,
    // 24620, T=575→576); até lá Unit_WalkNear parado no ponto (ação 1)
    if (u.order.type === "patrol" && this.thinkNow) {
      const p = u.order;
      if (u.cx === (p.toB ? p.bx : p.ax) && u.cy === (p.toB ? p.by : p.ay)) p.toB = !p.toB;
    }
    // sub-ação em curso do exe (IA+9: 1 golpe, 2 magia, 3 passo, 4 efeito, 0xff parado): o despachante 0x56dca2 a continua antes de
    // qualquer ordem; a máquina de ação (0x50f12c = o golpe/a magia do motor antigo, `progressAttack`) roda depois dele no mesmo
    // tique. No fim (pronto = 1 no tique E) o despachante solta o pedido em E + 1 (ação 0) e a tarefa volta em E + 2 (sonda c1/c2:
    // Skrakan, Lightning a cada charge + relax + nível + rand(0..3) + 2 = 24–27 tiques)
    if (r.ai.sub !== 0) { this.dispatch(u); if (u.state === "attack" || u.state === "cast") this.progressAttack(u); return; }
    const o = u.order;
    switch (o.type) {
      case "none":
        // ociosa de jogador de IA: o pensamento (0x56afd9, tique ≡ 7) põe a tarefa IA+8 = 0xb, e o despachante olha em volta em todo
        // tique (0x56e5bc: sorteios 0x56e629/0x56e656, giro por 0x556454); a tarefa importada do oráculo vale até o pensamento
        if (this.idleTask(u)) {
          if (this.thinkNow && u.rec.ai.task !== 0xb) u.rec.ai.task = 0xb;
          if (u.rec.ai.task === 0xb) { this.dispatch(u); return; }
        }
        this.stop(u);
        return;
      case "hold":
      case "still":
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
        // no destino a tarefa de andar (IA+8 = 1) só acaba no pensamento (acima; medido: o herói da m10_start chega em T=43 e larga a
        // tarefa em T=50); até lá Unit_WalkNear 0x56e4ac dá ação 1 parada. Largada a meio passo (IA+8 = 0): parado até o pensamento.
        if (o.arrived) { this.stop(u); return; }
        // Andar para USAR (`near`, mission/interact.ts: no exe a tarefa 0xf, 0x56ecbc → Unit_WalkNear até a estrutura parando a 1): acaba ao ficar a `near` (a ação de usar substitui a tarefa)
        if (o.near && Math.max(Math.abs(u.cx - o.x), Math.abs(u.cy - o.y)) <= o.near) { this.command(u, { type: "none" }); this.stop(u); return; }
        if (!this.walkTo(u, o.x, o.y, o.near ?? 0)) { this.command(u, { type: "none" }); this.stop(u); }
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
        // fim do caminho com o ponto bloqueado (0x56dca2 → adaptador patrolNext) deixa IA+8 = 0: a patrulha só volta a andar no
        // pensamento seguinte (medido: m20_start, 24620, T=234 → 240)
        if (u.rec.ai.task !== 1 && !this.thinkNow) { this.stop(u); return; }
        const tx = o.toB ? o.bx : o.ax, ty = o.toB ? o.by : o.ay;
        if (!this.walkTo(u, tx, ty, 0)) o.toB = !o.toB;   // ponto inalcançável: segue para o outro
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
        if (o.type === "attack" && (!t || !t.targetable)) { this.resumeOrNone(u); this.stop(u); return; }
        // lado humano: a ordem nova espera o pensamento 1×/s (termina o passo em curso e fica parado até lá)
        if (!u.orderArmed) { this.stop(u); return; }
        // o alvo (de pé ou caído) só segue sendo alvo enquanto há guerra: a paz que chega no meio da luta (feras da missão 53 depois dos
        // necromantes; Igles ainda batendo no lagarto) solta o alvo em vez de reabrir a guerra no próximo golpe; só o clique forçado insiste
        if (o.type === "attack" && t && t.player !== u.player && !o.forced && !this.hostile(u.player, t.player) && !this.hostile(t.player, u.player)) { this.resumeOrNone(u); this.stop(u); return; }
        const spell = o.type === "cast" ? u.spells.find(s => s.id === o.spell) : undefined;
        if (o.type === "cast" && !spell) { this.command(u, { type: "none" }); return; }
        // Heal pode mirar quem ainda está morrendo (sangrando): levanta se a vida passar de 0 [exe 0x51a2b8] (sim/necro.ts)
        if (o.type === "cast" && t && !t.active && !(spell!.kind === "heal" && canRevive(this, u, t))) { this.command(u, { type: "none" }); this.stop(u); return; }
        if (t) {
          // alvo unidade: a tarefa do exe decide golpe/magia ou perseguição — 5 atacar (0x56eab5: de frente e ao alcance de
          // AI_AttackRange → golpe 0x56e8c3; senão 0x56ea52) ou 8 magia na unidade (0x56ebc0 → 0x56e906); o efeito do golpe/da magia
          // (máquina de ação do motor antigo) começa em `strikeBegin`/`castBegin`, depois do despachante. IA+0x14 = alcance (no exe o
          // pensamento 0x56acc8 e 0x56d969 o põem); nem magia nem golpe à distância pedem linha de visão (0x50f12c → 0x519998 só
          // confere mana; o Skrakan do original lança no herói de trás da torre, sonda c2)
          if (o.type === "attack") { if (!this.exeExact || r.ai.task !== 5) { r.ai.task = 5; r.ai.f0c = t.rec.addr; r.ai.range = this.attackRange(u) & 0xff; } }
          else if (!this.exeExact || r.ai.task !== 8) { r.ai.task = 8; r.ai.f28 = t.rec.addr; r.ai.range = spell!.range & 0xff; }
          this.dispatch(u);
          return;
        }
        // magia no chão (tarefa 9 do exe, 0x56ec3f: exec 0 no corpus, sem porta): anda até o alcance e lança pelo motor antigo
        const tx = o.type === "cast" ? o.x ?? u.cx : u.cx, ty = o.type === "cast" ? o.y ?? u.cy : u.cy;
        const range = spell!.range;
        if (this.inRange(u, tx, ty, range)) {
          if (u.cooldown > 0) { this.stop(u); return; }
          // começa no tique seguinte ao da ordem nova/armada ou da chegada ao centro [medido no golden, DIFF-FUZZ fase 7]
          if (u.decideTick === this.tick || u.arriveTick === this.tick - 1) { this.stop(u); return; }
          if (this.turning(u, tx, ty)) { this.stop(u); return; }
          if (u.mana < spell!.mana) { if (u.isHero) this.events.push({ type: "message", text: "Not enough mana" }); this.command(u, { type: "none" }); this.stop(u); return; }
          this.beginCast(u, spell!, undefined, tx, ty, false);
          u.hitDone = false;
          return;
        }
        const near = range <= 1 ? 1 : Math.max(1, Math.floor(range * 0.7));
        if (!this.walkTo(u, tx, ty, near)) { if (!u.isHero) this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
    }
  }

  /** Começo do golpe (sub-ação 1 recém-nascida: 0x56e8c3 pôs ação 3 e +0x5c = alvo; no exe Unit_ActionMachine 0x50f12c →
   *  Unit_StrikeBegin 0x516c1f, no mesmo tique, depois do despachante): a máquina de golpe do motor antigo. Magia escolhida no livro
   *  (0x56b059) ou magia de chance (0x56acc8) no lugar do golpe → a sub-ação vira 2 (magia), como 0x56e906 faria no pensamento. */
  private strikeBegin(u: Unit): void {
    const r = u.rec, t = this.unitByAddr(r.f5c);
    const abort = () => { r.ai.sub = 0; r.act = 0; };
    if (!t || !t.targetable || t === u || u.cooldown > 0) { abort(); return; }
    const asCast = (spell: SpellDef, tgt: Unit | undefined, x: number, y: number) => {
      this.beginCast(u, spell, tgt, x, y, true);
      r.ai.sub = 2; r.ai.f15 = 0; r.act = 0xd; r.ai.f5c = 1; r.f5c = tgt ? tgt.rec.addr : 0; r.ready = 0;
    };
    // unidade do jogador com magia escolhida no livro: lança a magia no lugar do golpe [exe 0x56b059] (sim/spellattack.ts)
    const sa = t.active && u.selectedSpell ? spellAttack(this, u, t) : null;   // em quem caiu só o golpe da arma
    if (sa === "stop") { this.command(u, { type: "none" }); abort(); return; }
    if (sa && (sa.target === u || !sa.target || Math.hypot(sa.target.cx - u.cx, sa.target.cy - u.cy) <= sa.spell.range + 0.5)) { asCast(sa.spell, sa.target, sa.x, sa.y); return; }
    // magia de chance no lugar do golpe [exe 0x56acc8] (sorteada a cada golpe; ver notes/ai-behaviors.md)
    const proc = t.active ? this.rollProc(u, t) : null;
    if (proc) { asCast(proc, t, t.cx, t.cy); return; }
    u.castSpell = null;
    u.target = t.id;
    this.setState(u, "attack");
    this.beginCycle(u, 0);     // golpe pela máquina de ação do exe (charge, relax + rand(0..3) + arma) [GAME_DIFFS #54]
    u.lastActionTick = this.tick;
    this.breakInvisibility(u);
    this.events.push({ type: "attack", unit: u.id, target: t.id });
    u.hitDone = false;
    r.ready = 0;
  }

  /** Começo da magia na unidade (sub-ação 2 recém-nascida: 0x56e906 pôs ação 0xd, +0x5c = alvo, +0x64 = magia IA+0x30; no exe a
   *  máquina 0x50f12c gasta a mana na fase 0, 0x519998): a magia vem da ordem de lançar do motor antigo (o registro só tem o endereço
   *  do livro do exe). Começa no tique seguinte ao da ordem nova/armada ou da chegada ao centro [medido no golden, DIFF-FUZZ fase 7:
   *  1º Heal/magia da janela 1 tique depois em 81/92 casos]: a sub-ação é desfeita e a tarefa 8 a refaz no tique seguinte. */
  private castBegin(u: Unit): void {
    const r = u.rec, t = this.unitByAddr(r.f5c), o = u.order;
    const abort = () => { r.ai.sub = 0; r.act = 0; };
    const spell = o.type === "cast" ? u.spells.find(s => s.id === o.spell) : undefined;
    if (!spell || !t) { abort(); return; }
    if (u.decideTick === this.tick || u.arriveTick === this.tick - 1 || u.cooldown > 0) { abort(); return; }
    if (u.mana < spell.mana) { if (u.isHero) this.events.push({ type: "message", text: "Not enough mana" }); this.command(u, { type: "none" }); abort(); return; }
    this.beginCast(u, spell, t, t.cx, t.cy, false);
    u.hitDone = false;
    r.ready = 0;
  }

  /** Ciclo da máquina de ação do exe (0x50f12c, 16 tiques/s) para golpe e magia: fase 5 = `charge` tiques até o golpe/a magia sair;
   *  então (0x50f7b7) fase 7 = relax + rand(0..3) + nível da magia + espera da arma. O rand(0..3) sai NO GOLPE (depois do dano), não
   *  no início; aqui o fim provisório é sem ele e `strikeCycle` o fixa no tique do golpe. Sem `charge` (dados antigos): animação. */
  private beginCycle(u: Unit, level: number): void {
    const ct = castTiming(u.stats.charge, u.stats.relax, level, 0, u.stats.weaponWait ?? 0);
    u.castHit = ct?.hit ?? 0; u.castEnd = ct?.end ?? 0;    u.cycleRest = Math.max(0, u.stats.relax ?? 0) + Math.max(0, level | 0) + Math.max(0, u.stats.weaponWait ?? 0);
  }

  /** Estado importado do original (teste diferencial): golpe em curso na fase 5 (faltam `cnt` tiques de 16/s para o golpe) ou 7 (já
   *  golpeou; faltam `cnt` para acabar a espera). */
  importStrike(u: Unit, t: Unit, phase: number, cnt: number): void {
    const k = TICKS_PER_SEC / SERVER_TICKS_PER_SEC;
    u.target = t.id; u.castSpell = null;
    this.setState(u, "attack");
    this.beginCycle(u, 0);
    if (phase === 5) { u.hitDone = false; u.stateTime = Math.max(0, u.castHit - Math.round(cnt * k)); }
    else { u.hitDone = true; u.castHit = 0; u.stateTime = 0; u.castEnd = Math.max(1, Math.round(cnt * k)); }
  }

  /** No tique do golpe/da magia: rand(0..3) do exe (Unit_ActionMachine, Rand_Inclusive(3) em 0x50f7b7) e o fim do ciclo. */
  private strikeCycle(u: Unit): void {
    const roll = this.rng.exe(3, 0x50f7b7);
    const k = TICKS_PER_SEC / SERVER_TICKS_PER_SEC;
    u.castEnd = Math.max(u.castHit + 1, Math.round(((u.stats.charge ?? 0) + u.cycleRest + roll) * k));
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
    this.beginCycle(u, spell.level);
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
    for (const p of u.procSpells) if (Math.floor(this.rng.draw(0x56ad33) * 100 / 32768) < p.chance) pick = p.spell;
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
    if (u.state === "move") this.setState(u, "idle");
    u.rec.act = 0;
  }

  /** A unidade cabe na tarefa de olhar em volta do exe (IA+8 = 0xb, 0x56afd9): ociosa, de jogador de IA, acordada, sem ordem. */
  private idleTask(u: Unit): boolean {
    return !u.isHero && u.alive && this.isAiPlayerUnit(u) && !u.helpless && !u.suspended && u.order.type === "none" && this.awake(u);
  }

  /** Giro no lugar até olhar para (tx, ty) antes de golpear/lançar: um passo de Unit_TurnStep (0x556454) por tique no rumo do exe
   *  (0x556b2c, 8 direções). Devolve true enquanto ainda está girando. */
  private turning(u: Unit, tx: number, ty: number): boolean {
    if (tx === u.cx && ty === u.cy) return false;
    const want = dirFromDelta16(u.rec, ((ty & 0xff) << 8) | (tx & 0xff)) & 0xff;
    if (u.rec.walk.dir === want) return false;
    unitTurnStep(u.rec, want);
    return true;
  }

  /** Classe da tarefa da unidade (+0x50) pela ordem: decide o ramo do fim do caminho do despachante (0x56dca2). [est] */
  private taskClass(u: Unit): number {
    switch (u.order.type) {
      case "move": case "pickup": case "retreat": case "follow": case "defend": return 1;
      case "patrol": return 0xa;
      case "attack": return 3;
      case "cast": return 8;
      default: return u.isHero ? 0xc : 0xb;
    }
  }

  /** Adaptadores das tarefas do exe ainda não portadas que o andar alcança (ver o cabeçalho deste arquivo). */
  private readonly exeHooks: DispatchHooks = {
    f56dc24: () => { /* 0x56d969 + visão: sem efeito no andar */ },
    patrolNext: r => {
      const u = this.unitByAddr(r.addr);
      if (!u || u.order.type !== "patrol") return;
      const o = u.order;
      o.toB = !o.toB;
      r.ai.f02 = ((o.toB ? o.by : o.ay) << 8) | (o.toB ? o.bx : o.ax);
    },
    f56ed4e: r => {
      const u = this.unitByAddr(r.addr);
      if (!u || u.isHero || !this.isAiPlayerUnit(u) || u.order.type !== "attack") return;
      // alvo ao alcance de ataque (fora o perseguido) → ataca esse; senão ociosa até o próximo pensamento
      const tgt = u.order.target, rr = Math.max(1, this.attackRange(u));
      const near = this.units.find(v => v.id !== tgt && v.targetable && this.isEnemy(u, v) && Math.max(Math.abs(v.cx - u.cx), Math.abs(v.cy - u.cy)) <= rr);
      u.unreachTarget = tgt; u.unreachTick = this.tick;
      this.stop(u);
      this.command(u, near ? { type: "attack", target: near.id } : { type: "none" });
    },
    task: r => {
      switch (r.ai.task) {
        case 9: unitWalkNear(this.exeWorld, r, r.ai.f3c & 0xffff, r.ai.range & 0xff); r.act = 1; return true;   // ramo de andar de 0x56ec3f
      }
      return false;
    },
  };

  /** Um tique do despachante portado (0x56dca2) para a unidade e a sincronização do motor: `grid.occ` (célula do chão), estado de
   *  animação (ação 1 = andar/girar), chegada ao centro (saque automático). Campos que o motor antigo ainda calcula (velocidade com
   *  Haste/Slow, vida, dono, classe da tarefa) entram no registro antes, salvo no tique importado do oráculo
   *  (`exeExact`). */
  private dispatch(u: Unit): void {
    const r = u.rec, cx0 = u.cx, cy0 = u.cy;
    const f0 = (r.mapObj.x << 24) | (r.mapObj.y << 16) | (r.mapObj.fx << 8) | r.mapObj.fy;
    if (!this.exeExact) {
      r.speed = Math.round(this.speedOf(u) * 16);
      r.walk.turnRate = (u.stats.turnSpeed ?? Math.round(u.stats.speed * 16)) & 0xff;
      r.f94 = u.hp; r.mana = u.mana;
      r.attackRange = this.attackRange(u) & 0xff;   // +0x12c (AI_AttackRange 0x56ac5b sem magia escolhida no registro)
      // grupo dormindo (tipo+0x45): quem dorme no motor antigo não recebe ordem de andar (a IA não pensa por ele); o teste do
      // despachante fica desligado para não parar uma ordem que o motor antigo deu
      r.type.stats.f45 = 1;
      r.owner.f2c = this.isAiPlayerUnit(u) ? 1 : 0;
      r.task = this.taskClass(u);
    }
    EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
    try {
      unitActionDispatcher(this.exeWorld, r, this.exeHooks);
    } catch (e) {
      if (!(e instanceof NotPorted)) throw e;
      // ramo do exe ainda não portado (exec 0 no corpus): a unidade para em vez de derrubar o jogo
      if (!this.notPortedSeen.has(e.addr)) { this.notPortedSeen.add(e.addr); console.warn(`[sim] andar: ${e.message} (unidade ${u.id})`); }
      r.ai.task = 0;
      if (r.ai.sub === 3) r.ai.sub = 0;
      this.stop(u);
      this.command(u, { type: "none" });
      return;
    }
    if (u.cx !== cx0 || u.cy !== cy0) {
      const i0 = this.grid.idx(cx0, cy0);
      if (this.grid.occ[i0] === u.id) this.grid.occ[i0] = 0;
      this.grid.occ[this.grid.idx(u.cx, u.cy)] = u.id;
    }
    const moved = ((r.mapObj.x << 24) | (r.mapObj.y << 16) | (r.mapObj.fx << 8) | r.mapObj.fy) !== f0;
    // ação 1 = andar/girar; o giro do olhar em volta (tarefa 0xb) fica no estado ocioso do motor (a IA antiga decide sobre "idle")
    if (r.act === 1 && r.ai.task !== 0xb) { this.setState(u, "move"); u.lastActionTick = this.tick; if (moved) u.walkTime++; }
    else if (u.state === "move") this.setState(u, "idle");
    if (moved && mapObjSubCellCenter(r.mapObj) !== 0) { this.autoPickup(u); u.arriveTick = this.tick; }
    // a máquina de ação do exe (0x50f12c) corre depois do despachante no mesmo tique: a sub-ação de golpe (1) ou magia (2) que
    // acabou de nascer (IA+0x15 = 0: 0x56e8c3 / 0x56e906 correram agora) entra na máquina do motor antigo
    if (r.ai.sub === 1 && r.ai.f15 === 0) this.strikeBegin(u);
    else if (r.ai.sub === 2 && r.ai.f15 === 0) this.castBegin(u);
  }
  private readonly notPortedSeen = new Set<string>();

  /** Ordem de andar até (tx,ty), parando a `near` células (adaptador fino, mesma assinatura para mission/, script/, HUD): tarefa do
   *  exe IA+8 = 1 até a célula IA+0xa (0x56dca2 → Unit_WalkNear 0x56e4ac, perto 0); com `near` > 0, o ramo de andar da tarefa 9
   *  (0x56ec3f: Unit_WalkNear até IA+0x3c parando a IA+0x14). Devolve false quando desiste: 20 tiques no fim do caminho estático
   *  (andar+0x90) sem chegar a `near` (alvo inalcançável). */
  walkTo(u: Unit, tx: number, ty: number, near: number): boolean {
    // destino limitado à área útil (o original anda até a 1ª célula fora da borda; ordens de andar na borda medidas na m10)
    tx = Math.max(MAP_BORDER, Math.min(this.grid.w - MAP_BORDER - 1, tx)); ty = Math.max(MAP_BORDER, Math.min(this.grid.h - MAP_BORDER - 1, ty));
    const r = u.rec, cell = ((ty & 0xff) << 8) | (tx & 0xff);
    if (near > 0) {
      if (!this.exeExact || r.ai.task !== 9) { r.ai.task = 9; r.ai.f3c = cell; r.ai.range = near & 0xff; }
    } else if (!this.exeExact || r.ai.task !== 1) { r.ai.task = 1; r.ai.f0a = cell; }
    this.dispatch(u);
    if (r.walk.f90 !== 0 && r.ai.sub !== 3 && Math.max(Math.abs(tx - u.cx), Math.abs(ty - u.cy)) > near) { u.waitTicks++; return u.waitTicks < 20; }
    u.waitTicks = 0;
    return true;
  }

  /** Unidades ativas em anéis de Chebyshev 0..r em volta de (cx,cy), na ORDEM de varredura do exe [0x54ec6a]: centro; depois, para cada
   *  anel k e j = −k..k: (x+j, y+k), (x+j, y−k) e, se |j| ≠ k, (x+k, y+j), (x−k, y+j). A IA pega o 1º da lista (alvo da guarda, Heal). */
  unitsInRings(cx: number, cy: number, r: number, filter?: (v: Unit) => boolean): Unit[] {
    const byCell = new Map<number, Unit>();
    for (const v of this.units) {
      if (!v.targetable || Math.abs(v.cx - cx) > r || Math.abs(v.cy - cy) > r) continue;
      const k = v.cy * 65536 + v.cx, cur = byCell.get(k);
      if (!cur || v.active || !cur.active) byCell.set(k, v);   // vale o último da célula, mas o corpo não esconde quem está em pé
    }
    const out: Unit[] = [];
    const take = (x: number, y: number) => { const v = byCell.get(y * 65536 + x); if (v && (!filter || filter(v))) out.push(v); };
    take(cx, cy);
    for (let k = 1; k <= r; k++) for (let j = -k; j <= k; j++) {
      take(cx + j, cy + k); take(cx + j, cy - k);
      if (Math.abs(j) !== k) { take(cx + k, cy + j); take(cx - k, cy + j); }
    }
    return out;
  }

  /** Linha de visão livre de estruturas entre duas unidades [est]. A guarda NÃO a usa (o filtro 0x567a16 do exe só olha diplomacia e
   *  Invisibility); fica para consultas de diagnóstico. */
  hasLos(u: Unit, v: Unit): boolean { return lineOfSight(this.grid, u.cx, u.cy, v.cx, v.cy, BLOCK_STRUCTURE); }

  /** Inimigos vivos a distância de Chebyshev ≤ r (quadrado 2r+1, como 0x54ec6a + filtro 0x567a16 do exe). */
  enemiesInSquare(u: Unit, r: number): Unit[] {
    return this.units.filter(v => v !== u && v.active && v.hp > 0 && (this.isEnemy(u, v) || this.isEnemy(v, u))
      && Math.abs(v.cx - u.cx) <= r && Math.abs(v.cy - u.cy) <= r);
  }

  /** Ponto de fuga do exe [0x56f765 + 0x558b92]: centroide dos inimigos (coordenadas finas, 1/256 de célula); a partir da unidade, anda
   *  `dist` células no eixo dominante da direção centroide→unidade e acompanha a reta no outro eixo; limitado a [8, W−9] × [8, H−9]. */
  exeFleePoint(u: Unit, foes: Unit[], dist: number): Cell {
    const fx = (v: Unit) => Math.floor(v.x * 256), fy = (v: Unit) => Math.floor(v.y * 256);
    const cx = Math.trunc(foes.reduce((s, v) => s + fx(v), 0) / foes.length), cy = Math.trunc(foes.reduce((s, v) => s + fy(v), 0) / foes.length);
    const ux = fx(u), uy = fy(u);
    const dx = ux - cx || 1, dy = uy - cy || 1;
    let nx: number, ny: number;
    if (Math.abs(dx) > Math.abs(dy)) {
      const k = dy / dx, b = uy - ux * k;
      nx = dx > 0 ? ux + dist * 256 : ux - dist * 256;
      ny = Math.trunc(nx * k + b);
    } else {
      const k = dx / dy, b = ux - uy * k;
      ny = dy > 0 ? uy + dist * 256 : uy - dist * 256;
      nx = Math.trunc(ny * k + b);
    }
    const clamp = (v: number, hi: number) => Math.max(8, Math.min(hi - 9, v >> 8));
    return { x: clamp(nx, this.grid.w), y: clamp(ny, this.grid.h) };
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
    if (mode === 0 || (mode === 1 && lead.state !== "move" && lead.rec.pathDynamic.isEmpty())) return null;
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
    const exeCast = (u.state === "cast" || u.state === "attack") && u.castEnd > 0;
    if (!u.hitDone && u.stateTime >= (exeCast ? u.castHit : u.timing.hitTick)) {
      u.hitDone = true;
      if (u.state === "cast" && u.castSpell) this.releaseSpell(u, u.castSpell, t, u.castX, u.castY);
      else if (t && t.targetable) {
        if (u.weaponSpell) this.launch(u, t, u.weaponSpell, u.weaponSpell.element);
        else if (u.stats.range > 1) {
          // golpe à distância [exe 0x50f52e → 0x50f58d → 0x516c1f → 0x516ceb]: fora as armas que lançam magia (0x542580 → ação 0xd), o
          // golpe se resolve NA HORA em que sai (vida −= dano em 0x516d98) — não há objeto de projétil no servidor, nem colisão com
          // estrutura/unidade no caminho, nem linha de visão; a flecha que voa é só desenho
          this.launch(u, t, null, u.typeId === 70 ? "sonic" : u.stats.attackSkill === "fire" ? "fire" : "arrow", true);
          this.resolveHit(u, t, null);
        }
        else if (Math.max(Math.abs(t.cx - u.cx), Math.abs(t.cy - u.cy)) <= 1) this.resolveHit(u, t, null);
      }
      if (exeCast) this.strikeCycle(u);     // depois do dano (Unit_StrikeBegin/Spell_Release), como no exe
    }
    if (u.stateTime >= (exeCast ? u.castEnd : u.timing.attackTicks)) {
      const wasCast = u.state === "cast";
      const auto = u.castAuto, finished = u.castSpell, finishedTarget = u.target;
      this.setState(u, "idle");
      u.cooldown = exeCast ? 0 : u.timing.attackDelay;
      u.rec.ready = 1;   // pedido pronto (+0x136): o despachante 0x56dca2 solta a sub-ação 1/2 no tique seguinte (IA+0x15 > 2)
      u.castHit = u.castEnd = 0;
      u.castAuto = false;
      // a sub-tarefa de ataque da IA relança a magia escolhida no mesmo alvo assim que a espera acaba (sonda c1/c2: Lightning a cada
      // 24–27 tiques sem esperar o pensamento de 1×/s); quem decide trocar de magia/alvo é o pensamento seguinte [exe 0x56acc8/0x57a769]
      // a ordem só se cumpre se for a desta magia (a IA pode ter dado outra durante o lançamento: fuga, outro alvo, outra magia)
      if (wasCast && !auto && u.order.type === "cast" && u.order.spell === finished?.id && (u.order.target ?? 0) === finishedTarget) {
        const o = u.order, s = u.spells.find(x => x.id === o.spell);
        if (!(this.isAiPlayerUnit(u) && o.target && o.target !== u.id && s && isOffensive(s) && s.kind !== "summon")) this.command(u, { type: "none" });
      }
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
        // quem ainda sangra (vida > −10, sem guerra) levanta se a cura passar a vida de 0 [exe 0x51a2b8 → 0x510534] (sim/necro.ts)
        if (t && !t.alive && healDying(this, u, t, s.min + this.rand1(s.max - s.min, 0x51a35f))) { this.supportExp(u, s); return; }
        this.healUnit(friendOrSelf, s);
        this.supportExp(u, s);
        return;
      }
      case "debuff":
        if (t && t.active) {
          if (id === SPELL.StoneCurse && !this.stoneCurse(u, t, s)) { this.provoke(u, t); return; }
          if (id !== SPELL.StoneCurse) this.applyBuffs(u, t, s);
          this.provoke(u, t);
        }
        return;
      case "drain":
        if (t && t.active) this.drainLife(u, t, s);
        return;
      case "bolt":
        if (id === SPELL.PrismaticSpray) { this.prismatic(u, t, s); return; }
        if (t && t.active) this.launch(u, t, s, s.element);
        return;
      case "ball":
        if (t && t.active) this.launch(u, t, s, s.element);
        else this.launchAt(u, x, y, s);
        return;
      case "cone":
        // Prismatic Spray: n alvos com dano cheio [exe 0x519c04]; Acid Stream: área progressiva a partir do alvo [exe 0x51806c]
        if (id === SPELL.PrismaticSpray) this.prismatic(u, t, s);
        else if (id === SPELL.AcidStream) this.createArea(u, s, t ? t.cx : x, t ? t.cy : y);
        else this.cone(u, s, t ? t.x : x + 0.5, t ? t.y : y + 0.5);
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
        // salto feito: a espera fica só relax + rand(0..3), sem o nível da magia (sonda c2: fase 7 com 5–7 tiques logo após o pouso;
        // Teleport que falha — c1 — espera os 24–27 completos)
        if (u.castEnd > 0 && (u.cx !== fx || u.cy !== fy)) u.cycleRest = Math.max(0, u.cycleRest - Math.max(0, s.level | 0));
        this.supportExp(u, s);
        return;
      }
      case "raise":
        // Animate Dead [exe 0x51a91f]: corpo da célula-alvo vira zumbi/esqueleto/fantasma de quem lança (sim/necro.ts)
        raiseDead(this, u, s, t, x, y);
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
      this.setState(who, "idle");
    }
  }

  /** Heal [exe 0x51a2b8]: só em unidade viva (vida > −10) que regenera (período ≠ 0, +0x98); cura dmin + rand1(dmax−dmin), até a vida máxima. */
  healUnit(who: Unit, s: SpellDef): number {
    if (!who.active || who.stats.healthRegen === 0) return 0;
    const amount = Math.min(s.min + this.rand1(s.max - s.min, 0x51a35f), Math.max(0, who.maxHp - who.hp));
    who.hp += amount;
    this.events.push({ type: "heal", unit: who.id, amount });
    return amount;
  }

  /** `rand1(n)` do exe = 1 + rand(n − 1) = 1..n (n = 0 → 1) [exe 0x51fa4e]. */
  rand1(n: number, site: RandSite = "ours:rand1"): number { return this.rng.one(n, site); }

  /** Drain Life [exe 0x51a3f3] (instantâneo): d = dmin + rand1(delta) reduzido pela proteção ASTRAL, até vida+10; tira do alvo e cura quem lança. */
  private drainLife(u: Unit, t: Unit, s: SpellDef): void {
    let d = s.min + this.rand1(s.max - s.min, 0x51a42a);
    d = Math.trunc(d * (100 - this.resistOf(t, "astral")) / 100);
    d = Math.min(d, t.hp + 10);
    this.events.push({ type: "blast", spell: s.id, x: t.x, y: t.y, radius: 0.5, unit: u.id });
    if (d <= 0) { this.provoke(u, t); return; }
    const before = t.hp;
    this.damage(u, t, d, "astral");
    const dealt = Math.max(0, before - Math.max(t.hp, -10));
    if (u.active && dealt > 0) {
      const h = Math.min(dealt, u.maxHp - u.hp);
      if (h > 0) { u.hp += h; this.events.push({ type: "heal", unit: u.id, amount: h }); }
    }
  }

  /** Stone Curse [exe 0x51b6ae]: duração = rand(int(p×15×16×2/100) × (100 − protTerra) div 100) tiques do exe; 0 = sem efeito. */
  private stoneCurse(u: Unit, t: Unit, s: SpellDef): boolean {
    const p = s.power ?? 0;
    const max = p > 255 ? Math.round(s.duration * EXE_TPS) : stoneCurseTicksMax(p, Math.max(0, this.resistOf(t, "earth")), s.mana <= 0);
    const ticks = p > 255 ? max : this.rng.exe(Math.max(0, max), 0x51b799);
    if (ticks <= 0) { this.events.push({ type: "message", text: "The spell has no effect" }); return false; }
    this.applyBuffs(u, t, { ...s, duration: ticks / EXE_TPS });
    return true;
  }

  /** Prismatic Spray [exe 0x519c04]: até min(p div 20 + 2, 7) alvos no alcance recebem o dano cheio (projéteis de 5 tiques). A escolha dos alvos
   *  (0x579ddf) não foi decifrada: [est] o alvo e os inimigos mais próximos dele dentro do alcance de quem lança. */
  private prismatic(u: Unit, t: Unit | undefined, s: SpellDef): void {
    const n = prismaticRays(Math.min(255, s.power ?? 0));
    const ox = t ? t.x : u.x, oy = t ? t.y : u.y;
    const cand = this.unitsInRadius(u.x, u.y, s.range + 0.5, v => v !== u && v !== t && this.isEnemy(u, v) && this.canSee(u, v))
      .sort((a, b) => Math.hypot(a.x - ox, a.y - oy) - Math.hypot(b.x - ox, b.y - oy));
    const targets = [...(t && t.active ? [t] : []), ...cand].slice(0, n);
    for (const v of targets) this.launch(u, v, s, s.element);
  }

  private launch(u: Unit, t: Unit, spell: SpellDef | null, kind: string, visual = false): void {
    // Lightning/Prismatic Spray: voo fixo de 5 tiques do exe [exe 0x519b6a]; os outros: Spell Effect Speed/16 células/s
    const ft = spell?.flightTime;
    const speed = ft ? Math.max(1, Math.hypot(t.x - u.x, t.y - u.y) / ft) : spell ? spell.speed ?? 9 : 11;
    const p: Projectile = { id: this.nextId++, from: u.id, to: t.id, x: u.x, y: u.y, speed, kind, spell, done: false, ...(visual ? { visual } : {}) };
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
      if (p.to && (!t || !t.targetable)) { p.done = true; continue; }
      const gx = t ? t.x : p.tx ?? p.x, gy = t ? t.y : p.ty ?? p.y;
      const dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy), v = p.speed * TICK_MS / 1000;
      if (d <= v + 0.2) {
        p.done = true;
        p.x = gx; p.y = gy;
        this.events.push({ type: "projectileHit", id: p.id });
        const src = this.get(p.from);
        if (p.visual) continue;
        if (p.spell?.kind === "ball") { if (src) this.blast(src, p.spell, gx, gy); }
        else if (src && t) this.resolveHit(src, t, p.spell);
      } else { p.x += dx / d * v; p.y += dy / d * v; }
    }
    if (this.projectiles.length > 64) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i]!.done) this.projectiles.splice(i, 1);
    }
  }

  /** Explosão instantânea (Fireball) [exe 0x518833]: todas as células do QUADRADO [x−r..x+r]² (r = Radius, Fireball 3×3); cada unidade
   *  nelas recebe o dano (o exe divide o dano por tamanho² e acerta uma vez por célula ocupada: no nosso motor de 1 célula é um acerto). */
  private blast(src: Unit, s: SpellDef, x: number, y: number): void {
    const r = Math.max(0, s.radius ?? 1), cx = Math.floor(x), cy = Math.floor(y);
    this.events.push({ type: "blast", spell: s.id, x, y, radius: r + 0.5, unit: src.id });
    this.splash++;
    for (const v of this.units) {
      if (!v.active || Math.abs(v.cx - cx) > r || Math.abs(v.cy - cy) > r) continue;
      this.resolveHit(src, v, s);
    }
    this.splash--;
    if (this.onAreaCells) {
      const cells: [number, number][] = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) cells.push([cx + dx, cy + dy]);
      this.onAreaCells(cells, spellKey(s));
    }
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
    const id = Number(spellKey(s));
    const exeToTicks = (t: number) => Math.round(t * TICKS_PER_SEC / EXE_TPS);
    // duração em tiques do exe: areaDuration×16 + int(p×16/10) [exe 0x51bcbc]; efeito quando (resto) mod 16 == 0 → 1×/s [exe 0x517d6c]
    const D = Math.max(1, Math.round((s.areaDuration || s.duration || 5) * EXE_TPS));
    const progressive = s.distribution === 5 || id === SPELL.Blizzard || id === SPELL.AcidStream;
    const a: SpellArea = {
      id: this.nextId++, spell: spellKey(s), kind: s.kind === "wall" ? "wall" : "field", owner: src.id, player: src.player,
      x, y, radius: Math.max(0, s.radius ?? 0), until: this.tick + exeToTicks(D) + 1,
      next: this.tick + exeToTicks(D % EXE_TPS || EXE_TPS), period: TICKS_PER_SEC,
      min: s.min, max: s.max, element: s.element, effects: (s.effects ?? []).map(e => ({ ...e })),
    };
    const dir = exeDir8(x - src.cx, y - src.cy);
    if (progressive) {
      // Blizzard: 32 pulsos; Acid Stream: 6 passos; um a cada 3 tiques do exe [exe 0x51806c]
      a.prog = id === SPELL.AcidStream ? "acid" : "blizzard";
      a.dir = dir; a.step = 0; a.t0 = this.tick;
      a.next = this.tick;
      a.until = this.tick + exeToTicks(((a.prog === "acid" ? 6 : BLIZZARD_PULSES) + 1) * PULSE_EXE_TICKS);
    } else {
      // parede (distribution 4) [exe 0x5182b6] ou campo em losango |dx|+|dy| ≤ r+1 [exe 0x5183a2]
      const shape = s.distribution === 4 || s.kind === "wall" ? "wall" : "diamond";
      const cells: number[] = [];
      for (const [cx, cy] of areaCells(shape, x, y, a.radius, dir)) {
        if (!this.grid.inside(cx, cy)) continue;
        const idx = this.grid.idx(cx, cy);
        if (a.kind === "wall" && this.grid.occ[idx]) continue; // Wall of Earth: não nasce onde há unidade [exe 0x518526]
        cells.push(idx);
      }
      a.cells = cells;
      if (a.kind === "wall") this.applyWall(a, true);
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
      this.exeWallCell(i, on);
    }
  }
  /** Parede de magia nas grades do exe [est: no exe ela é objeto na ocupação; aqui bloqueia como objeto, bits 1|4 nas duas grades]. */
  private exeWallCell(i: number, on: boolean): void {
    const x = i % this.grid.w, y = Math.floor(i / this.grid.w);
    if (x > 255 || y > 255) return;
    const c = y * 256 + x, m = this.exe.mem;
    for (const off of [0x10000, 0x20000]) m[off + c] = on ? m[off + c]! | 5 : (m[off + c]! & ~5) | (exeMaskOf(this.grid.block[i]!) & 5);
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
      const src = this.get(a.owner);
      let inside: Unit[];
      if (a.prog) {
        // pulso k no tique t0 + 3k (tiques do exe)
        const k = a.step ?? 0, total = a.prog === "acid" ? 6 : BLIZZARD_PULSES;
        if (k >= total) { a.until = this.tick; continue; }
        a.step = k + 1;
        a.next = (a.t0 ?? this.tick) + Math.round((k + 1) * PULSE_EXE_TICKS * TICKS_PER_SEC / EXE_TPS);
        const offs: [number, number][] = a.prog === "acid" ? acidSteps(a.dir ?? 0)[k] ?? []
          : [[this.rng.exe(5, 0x51814a) - 2, this.rng.exe(5, 0x51815c) - 2]];   // rand(5) − 2 = −2..+3 [exe 0x518143]
        const set = new Set(offs.map(([dx, dy]) => `${a.x + dx},${a.y + dy}`));
        inside = this.units.filter(v => v.active && set.has(`${v.cx},${v.cy}`));
        if (a.prog === "blizzard" && this.onAreaCells && offs.length) this.onAreaCells(offs.map(([dx, dy]) => [a.x + dx, a.y + dy]), String(a.spell));
        if (offs.length) this.events.push({ type: "blast", spell: a.spell, x: a.x + offs[0]![0] + 0.5, y: a.y + offs[0]![1] + 0.5, radius: 0.5, unit: a.owner });
      } else {
        a.next = this.tick + a.period;
        if (a.cells) {
          const set = new Set(a.cells);
          inside = this.units.filter(v => v.active && this.grid.inside(v.cx, v.cy) && set.has(this.grid.idx(v.cx, v.cy)));
        } else inside = this.unitsInRadius(a.x + 0.5, a.y + 0.5, a.radius + 0.5);
      }
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

  setOwner(u: Unit, player: number): void {
    if (u.player === player) return;
    u.player = player;
    u.target = 0;
    if (u.order.type === "attack") u.order = { type: "none" };
    this.events.push({ type: "owner", unit: u.id, player });
  }

  /** Summon [exe 0x51a595]: Squirrel/Turtle/Foot_Animated do nível Astral÷25+1, sem duração (desgaste em `stepSummons`) — sim/necro.ts. */
  private summon(u: Unit, s: SpellDef, _x: number, _y: number): void { summonCreature(this, u, s); }

  /** Resolve um golpe/projétil/explosão. Fórmulas [exe] (docs/DATA.md, seção DADOS):
   *  físico: dano bruto = rand[min,max] (Bless no atacante: chance = poder % → máximo; Curse: chance → mínimo [exe 0x516ceb]);
   *  r = rand(0..200) − 100; acerta se ataque + r > defesa do alvo, ou r ≥ 90, ou `alwaysHit`;
   *  dano −= absorção (mín. 0; `alwaysHit` ignora); dano = int(dano × (100 − resistFísica[tipo da arma]) / 100 + 0,75).
   *  magia: sem teste de acerto nem absorção; dano = int(d × (100 − proteção da escola)/100 + 0,75). Drain Life devolve o dano. */
  resolveHit(a: Unit, t: Unit, spell: SpellDef | null): void {
    if (!t.targetable) return;
    // golpe em quem caiu só vale com guerra; e o golpe de uma ordem de ataque comum que chega depois da paz (feras da 53, no meio do
    // golpe) não reabre a guerra: só o ataque forçado (Ctrl+clique), a magia e a área insistem
    if (a.player !== t.player && !this.hostile(a.player, t.player) && !this.hostile(t.player, a.player)
      && !(a.order.type === "attack" && a.order.forced) && (!t.active || (!spell && !this.splash && a.order.type === "attack"))) return;
    let dmg: number;
    if (spell) {
      if (spell.max <= 0 && spell.kind !== "drain") return;
      const res = this.resistOf(t, spell.element);
      dmg = Math.floor(this.rng.int(spell.min, spell.max) * (100 - res) / 100 + 0.75);
      if (dmg > 0) this.noteAttacked(a, t);
    } else {
      this.noteAttacked(a, t);   // 0x516f6f → 0x56e6b8 em todo golpe (acerto ou não)
      // 0x516f6f: Bless (rand(0..100) < poder → dano máximo) e Curse (→ só o mínimo) sorteiam ANTES; a parte aleatória
      // (rand(0..faixa)) só sai se nenhum dos dois passou — Bless vence o Curse
      let roll = true;
      dmg = a.stats.damage.min;
      if (a.buffs.length) {
        const bless = a.buffs.find(b => b.kind === "bless"), curse = a.buffs.find(b => b.kind === "curse");
        if (bless && this.rng.exe(100, 0x517057) < bless.amount) { dmg = a.stats.damage.max; roll = false; }
        if (curse && this.rng.exe(100, 0x5170b6) < curse.amount) roll = false;
      }
      if (roll) dmg = this.rng.int(a.stats.damage.min, a.stats.damage.max, 0x5170d3);
      const r = this.rng.exe(200, 0x5170f8) - 100;
      const hit = !!a.stats.alwaysHit || r >= 90 || this.attackOf(a) + r > this.defenseOf(t);
      // dano elemental extra da arma/criatura [exe 0x516f6f, struct +0x11..+0x15]: A = base + rand(faixa) (0x5171fd) SEMPRE, contra a
      // proteção de água; B = base + rand(faixa) (0x5172b7) só com acerto (ou sem dano físico), contra a proteção do elemento (1 fogo,
      // 2 água, 3 ar, 4 terra, 5 astral); cada parte: trunc(v × (100 − prot)/100 + 0,75), mín. 0
      const el = a.stats.elemental;
      let extra = 0;
      if (el) {
        const res = (v: number, key: string) => { const p = this.resistOf(t, key); return p ? Math.max(0, Math.trunc(v * (100 - p) / 100 + 0.75)) : v; };
        if (el.aRange + el.aBase) extra += res(this.rng.exe(el.aRange, 0x5171fd) + el.aBase, "water");
        if (el.bRange + el.bBase && (hit || a.stats.damage.max <= 0))
          extra += res(this.rng.exe(el.bRange, 0x5172b7) + el.bBase, ["fire", "water", "air", "earth", "astral"][el.element - 1] ?? "fire");
      }
      if (!hit) {
        if (extra <= 0) { this.events.push({ type: "miss", unit: a.id, target: t.id }); this.provoke(a, t); return; }
        dmg = 0;
      } else {
        if (!a.stats.alwaysHit) dmg = Math.max(0, dmg - this.absorptionOf(t));
        const at = a.stats.attackType;
        // golpe sem tipo de arma (garras/mordidas: índice 0 da tabela de 6 resistências do exe) usa a chave "none" — só o +god do console
        // (mission/console.ts, exe 0x5175fc) a preenche
        const rp = t.stats.resistPhysical ? Math.min(100, t.stats.resistPhysical[at ?? "none"] ?? 0) : 0;
        dmg = Math.floor(dmg * (100 - rp) / 100 + 0.75);
      }
      dmg += extra;
    }
    if (dmg <= 0) { this.events.push({ type: "miss", unit: a.id, target: t.id }); this.provoke(a, t); return; }
    // unidade invocada/levantada (+0x1a0) não dá experiência [exe 0x512900]
    if (a.heroInfo && t.alive && !t.stats.noXp && !t.dynamic && t.player !== a.player && !t.isHero) {   // golpe em quem já caiu não dá experiência
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
    // quem já caiu continua alvo: o golpe baixa a vida do corpo, sem limite (cobra caída do herói: −3 → −19, medido); a morte é consumada
    // pelo laço dos corpos quando a animação de queda acaba e a vida chega a ≤ −10 (sim/necro.ts)
    if (!t.alive) {
      if (t.bodyDead) return;
      t.corpseHp -= dmg;
      t.lastHurtTick = this.tick;
      if (a && !quiet) { t.lastAttacker = a.id; t.felledBy = a.id; this.provoke(a, t); }
      this.events.push({ type: "hit", unit: a?.id ?? 0, target: t.id, amount: dmg, element });
      return;
    }
    t.hp -= dmg;
    t.lastHurtTick = this.tick;
    if (a && !quiet) { t.lastAttacker = a.id; this.provoke(a, t); }
    this.events.push({ type: "hit", unit: a?.id ?? 0, target: t.id, amount: dmg, element });
    if (t.hp <= 0) this.fall(t, a);
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

  /** Morte decretada (console `#kill`, desgaste das invocações, pilotos/testes): a vida vai a ≤ −10, a unidade cai (a animação toca) e a morte
   *  é consumada NA HORA (saque, abate, `death`), sem a espera do fim da animação nem a janela de Heal. A morte por golpe passa pelo caminho
   *  completo: queda (`fall`) → sangria → `consumeDeath` em sim/necro.ts `stepCorpses`. */
  kill(t: Unit, killer?: Unit): void {
    if (!t.alive) {
      // inconsciente/sangrando: a morte decretada leva o corpo a −10 e a consuma
      if (!t.downed) return;
      t.corpseHp = Math.min(t.corpseHp, CORPSE.DEATH);
      if (killer) t.felledBy = killer.id;
      this.consumeDeath(t);
      return;
    }
    t.hp = Math.min(t.hp, CORPSE.DEATH);
    this.fall(t, killer);
    this.consumeDeath(t);
  }

  /** Queda [exe 0x50f12c: vida ≤ 0 → +0x13c = 1, defesa ÷ 2, animação]: a unidade deita. Vida exatamente 0 = inconsciente estável; < 0 =
   *  sangrando (−1 a cada 4 s) até −10 (sim/necro.ts); no meio do caminho ainda é alvo de golpes e de Heal (que a levanta). Saque, abate e
   *  experiência só na morte consumada (`consumeDeath`). `onDeath` (herói/companheiro/VIP caído = falha da missão) vale já na queda: no
   *  original o herói com a vida zerada dá "Mission Failed" ~3 s depois (notes/original-capture.md, `run_defeat.py`). */
  private fall(t: Unit, killer?: Unit): void {
    if (!t.alive) return;
    onFell(t, t.hp);   // vida depois do golpe (≤ 0, sem limite) = vida do corpo
    t.hp = 0;
    t.felledBy = killer?.id ?? 0;
    this.release(t);
    this.walkAbort(t); t.order = { type: "none" };
    this.setState(t, "dying");
    this.events.push({ type: "fall", unit: t.id, killer: killer?.id ?? 0 });
    this.onDeath?.(t, killer);
  }

  /** Morte consumada [exe 0x50f12c → 0x510a70]: fim da animação de queda E vida do corpo ≤ −10. Abate (experiência cai com 10/(n+10)),
   *  evento `death` (hall da fama) e saque; o corpo passa a se decompor (`onConsumed`). */
  consumeDeath(t: Unit): void {
    if (t.alive || t.bodyDead) return;
    onConsumed(t);
    const killer = t.felledBy ? this.get(t.felledBy) : undefined;
    if (t.silentFall) { t.silentFall = false; this.onDeath?.(t, killer); }   // caiu por "vida 0" do script (knockOut): as regras de falha só agora
    this.events.push({ type: "death", unit: t.id, killer: t.felledBy });
    if (killer?.isHero) this.killsByType.set(t.typeId, (this.killsByType.get(t.typeId) ?? 0) + 1);
    // saque [exe 0x510a70]: template com "NPC" no nome (ou unidade invocada, +0x1a0) perde o que carrega; monstro (tipo ≥ 0x40) sorteia
    // ouro (goldChance > rand(100): goldMin + rand(goldMax)) e um item (itemChance > rand(100): preço em [itemMin, itemMax]; máscara [est]);
    // o saco cai na célula da unidade e SE JUNTA ao saco que já estiver lá (um por célula) [exe 0x52ab07]
    const tr = t.stats.treasure;
    if (!t.isHero && (t.stats.noDrop || t.dynamic)) { t.gold = 0; t.items = []; }
    let gold = t.gold;
    const items = [...t.items];
    if (!t.isHero && !t.dynamic && tr && t.typeId >= 0x40) {
      // o rand(100) do ouro sai SEMPRE (0x510cbc), mesmo sem ouro no template
      if (tr.goldChance > this.rng.exe(100, 0x510cbc) && tr.goldMin >= 0) gold += Math.min(100000, tr.goldMin + this.rng.exe(Math.max(0, tr.goldMax), 0x510cf3));
      if ((tr.itemChance ?? 0) > this.rng.exe(100, 0x510d19) && this.itemPool?.length) {
        const pool = this.itemPool.filter(([, price]) => price >= (tr.itemMin ?? 0) && price <= (tr.itemMax ?? 0));
        if (pool.length) items.push(pool[this.rng.exe(pool.length - 1, 0x510ddf)]![0]);
      }
    }
    if (!t.isHero && (gold > 0 || items.length)) {
      this.addLoot(t.cx, t.cy, gold, items);
      this.events.push({ type: "loot", x: t.cx, y: t.cy, gold });
      t.gold = 0; t.items = [];
    }
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
    return this.areas.find(a => (!spell || Number(a.spell) === spell) && this.areaCovers(a, x, y, idx));
  }

  /** "Spell on Tile": há área de magia da `layer` cobrindo a célula (x,y)? (fila de camadas em spells.ts `spellLayer`) */
  areaOnLayer(x: number, y: number, layer: number): SpellArea | undefined {
    const idx = this.grid.inside(x, y) ? this.grid.idx(x, y) : -1;
    return this.areas.find(a => spellLayer(Number(a.spell)) === layer && this.areaCovers(a, x, y, idx));
  }

  /** A área cobre a célula? Áreas com células do exe (parede/losango) usam a lista; as antigas (saves v1/v2) usam o raio. */
  private areaCovers(a: SpellArea, x: number, y: number, idx: number): boolean {
    if (Math.floor(a.x) === x && Math.floor(a.y) === y) return true;
    if (a.cells) return a.cells.includes(idx);
    if (a.prog) return Math.abs(x - a.x) <= 3 && Math.abs(y - a.y) <= 3;
    return Math.hypot(a.x - x, a.y - y) <= a.radius + 0.5;
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
    if (spell.kind === "heal") { this.healUnit(target, spell); return; }
    if (spell.kind === "buff" || spell.kind === "shield" || spell.kind === "debuff") {
      // Stone Curse do script ("Cast spell to unit", missão 96): o caminho do script no exe não foi decifrado; mantém a duração fixa
      // 1,025^p × 10 s [est] em vez da sorteada da magia lançada (0..p×0,3 s), senão as estátuas da 96 acordam em segundos (docs/GAPS.md)
      const sc = Number(spellKey(spell)) === SPELL.StoneCurse;
      this.applyBuffs(virt, target, sc ? { ...spell, duration: Math.min(36000, Math.pow(1.025, spell.power ?? 0) * 10) } : spell);
      return;
    }
    if (spell.kind === "field" || spell.kind === "wall") { this.createArea(virt, spell, target.cx, target.cy); return; }
    const res = this.resistOf(target, spell.element);
    const dmg = Math.floor(this.rng.int(spell.min, spell.max) * (100 - res) / 100 + 0.75);
    this.events.push({ type: "blast", spell: spell.id, x: target.x, y: target.y, radius: Math.max(0.5, spell.radius ?? 0), unit: 0 });
    if (dmg > 0) this.damage(undefined, target, dmg, spell.element);
  }
}
