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
 * célula = a célula do chão) é sincronizada num único ponto, depois de cada chamada do despachante (`dispatch`).
 *
 * DESPACHANTE INTEIRO (etapa 7, notes/despachante.md): toda tarefa IA+8 que o corpus alcança está portada. Ociosa de jogador de IA →
 * 0xb no pensamento (olhar em volta, 0x56e5bc, sorteios pelo `Rng` via `WorldRec.rng`); atacar/lançar em unidade → 5/8 (0x56eab5/
 * 0x56ebc0: ao alcance o exe começa a sub-ação 1/2 — golpe/magia — e a World entra com o EFEITO do motor antigo em `strikeBegin`/
 * `castBegin`, no tique em que a sub-ação nasce, e marca +0x136 (pronto) quando a máquina acaba); fim de caminho na cauda de
 * 0x56dca2 (0x56dc24 parar, patrulha pela lista [IA+0xb4], 0x56ed4e alvo ao alcance → tarefa 6). As listas do exe que isso lê
 * (unidades vivas mundo+4, tipo+0 por (dono, modelo), diplomacia +0xa8bc, eventos +0xbbec) são mantidas pela World (spawn, setState,
 * step, command). Único adaptador restante: tarefa 9 (0x56ec3f, exec 0: ordens com `near` > 0 — seguir, defender, magia no chão —
 * só o ramo de andar); a magia no chão lança pelo motor antigo.
 *
 * DANO FÍSICO (etapa 8a, lote 1, notes/maquina-de-acao.md): o golpe físico é calculado pela porta de Unit_PhysicalDamage 0x516f6f
 * (sim/exe/combat.ts) sobre os atributos de combate do registro (`syncCombat`: toHit, dano, tipo de arma, elemental, defesa, absorção,
 * proteções, resistências, bits +0x4c, efeitos +0x144 a partir de `stats`/`buffs`); 0x56e6b8 marca na vítima quem bateu (IA+0x54, +0x94,
 * +0x98 relógio de 16/s absoluto, +0x9c ponto de fuga: `hitClock16`/`fleeCell` são vistas) e 0x57977a declara a guerra na tabela do exe,
 * que volta para `dip` em `syncDiplomacyBack`. Bless/Curse no golpe (0x5106f4) e a invisibilidade andam na lista de efeitos do exe (lote 5).
 *
 * MÁQUINA DE AÇÃO (etapa 8a, lote 2): `act(u)` traduz a ordem para a tarefa do exe e chama UMA vez por tique a máquina portada
 * 0x50f12c (`machine`: efeitos → queda/morte → despachante 0x56dca2 → golpe/magia por fases +0x58/+0x6c). O golpe físico é inteiro do
 * exe (0x516c1f → 0x516ceb → 0x516f6f: a vida +0x94 — `hp` é uma vista — cai na porta); a magia sai pelos ganchos `spellSpendMana`/
 * `spellRelease`/`spellApply` (motor antigo, etapa 8b) no ponto exato (0x519998/0x519d7f/0x519db8); os efeitos (`buffs`) andam no gancho
 * `effectsTick` (laço +0x20). A queda (vida < 1: +0x13c = 1, defesa ÷ 2, contador da animação) e a morte (vida < −9) são decididas na
 * máquina; a World só faz a apresentação nos ganchos `fell`/`die` (estado dying/dead, eventos, `onDeath`, saque em `consumeDeath`).
 * Adaptadores do pensamento (etapa 8b): `thinkAfterDispatch` (magia escolhida no livro / de chance / da arma no lugar do golpe, 0x56b059/
 * 0x56acc8) e a magia no chão (tarefa 9, exec 0) como sub-ação 2 na célula; `actionDone` fecha a ordem de magia do motor antigo.
 *
 * MORTE (etapa 8a, lote 3): a máquina chama Unit_Die 0x510a70 portada (sim/exe/death.ts): sai das células, ouro/item do modelo
 * (`tpl.arr[0x26..0x2c]` de `stats.treasure`, sorteios 0x510cbc/0x510cf3/0x510d19), saco, herói do dono (vida −50) e o 1º desgaste
 * (0x5110b8, depois 1×/s em `worldSecondTick`); mochila, loja de itens, saco, efeitos e equipamento ficam no motor antigo pelos ganchos
 * `DieHooks` (`packDrop`, `lootItem`, `packCount`, `sackDrop`, `effectsOnDie`, `onDieHuman`) e a apresentação em `died` (`consumeDeath`).
 * O dano de magia (Spell_Release/Spell_Apply → vtable +0x54) também é o de 0x516f6f, com a struct da magia (dano B = min + rand(max − min)
 * contra a proteção do elemento; sorteios 0x5170f8 e 0x5172b7).
 *
 * LAÇO DE 1/s (etapa 9, lote 1, notes/pensamento.md): World_SecondTick 0x52bbb7 portado (sim/exe/regen.ts) roda no tique de servidor em
 * que o relógio de 16/s PRÉ-incremento ≡ 0xc (= `absClock16() % 16 == 13` aqui, com `EXE_GLOBALS.clock16` recuado de 1 durante a chamada),
 * ANTES das máquinas das unidades: Unit_Regen 0x50fc5a em cada unidade da lista `lists.all` (vida/mana +0x94/+0x9a com os restos +0xa2/+0xa3
 * e os períodos +0x98/+0x9e do registro — `mana`/`maxMana` são vistas; sangria de quem caiu), Corpse_Decay 0x5110b8 em `lists.corpses` e o
 * desgaste das invocações em `lists.magic` (Rand_One 0x51fa4e, CMap<uint,uint>). O contador de 1/s do exe ([[0x6044c4]+0]) é
 * `secClock()` = ⌊relógio de 16/s ÷ 16⌋ (vira no fim do tique ≡ 0xf). O veneno (efeito do motor antigo) continua em `poisonTick`.
 *
 * PENSAMENTO (etapa 9, lote 2, notes/pensamento.md): no tique do pensamento (`aiTick`) roda a porta de 0x56fe4d (sim/exe/think.ts) sobre
 * os registros espelhados: jogadores (`exeWorld.players`, um PlayerRec partilhado por jogador: +0x2c IA, +0x32 máscara, +0x38 herói),
 * grupos (`exeGroups`: o "tipo" unidade+0x70 É o grupo — lista de membros e os dados do comando +0x3c; grupo do mapa/script `u.group`,
 * senão um grupo por unidade) e as unidades. O comando do grupo vem do `AiMode`/da ordem (`exeGroupCmd`): Guard da carga → 0x12, Guard do
 * script → 1, hold → −1, move → 4, swarm → 5, jogador humano parado → 3 / andando → 4; o resto → 0 (tarefas por unidade = o gancho
 * `unitThink` = o `aiThink`/`heroThink` antigos, até o lote 3). Acordar os grupos é a porta de 0x55b5f1 (setores de 8×8; `f48` = sempre
 * acordado: todos no jogo normal, `alwaysAwake` nos estados importados). Depois do pensamento `syncOrdersFromTasks` lê a tarefa IA+8 que o
 * porte deixou (1 andar, 5 atacar, 0xb/0 parada) e a escreve na ordem da unidade (`exeTask` = a ordem vem do porte: `act` não a reinterpreta
 * na chegada). Visão: a porta de Vision_Compute (sim/exe/vision.ts) sobre as tabelas do objeto de visão no MapRec (mapbuild as copia).
 */
import { BLOCK_BORDER, BLOCK_SPELL, BLOCK_STRUCTURE, Grid, MAP_BORDER } from "./grid";
import { skillExp, skillFromExp } from "./stats";
import { lineOfSight } from "./los";
import { CellStructRec, MapRec, OccRec, UnitRec, WorldRec } from "./exe/types";
import { bookApplyKeep, listSet, scalarFields, type ExeGroupsJson } from "./exe/recio";
import { CListPtr, CListWord, type ListPos } from "./exe/mfc";
import { mapRecFromGrid, exeMaskOf } from "./exe/mapbuild";
import { unitActionMachine, type MachineHooks } from "./exe/action";
import { unitPhysicalDamage, unitStrikeBegin } from "./exe/combat";
import { corpseDecay, unitDie } from "./exe/death";
import { worldSecondTick } from "./exe/regen";
import { aiAutocast, aiCastAtTarget, aiIdleAlt, aiMoveTo, aiTeleportCast, aiIdleCasterSupport, fn_0x56fe4d, type ThinkHooks } from "./exe/think";
import { BookSpellRec, PlayerRec, UnitStatsRec, UnitTypeRec } from "./exe/types";
import { DmgRec, ItemMagicRec, ItemRec, SpellObjRec, SpellPayloadRec, TemplateRec } from "./exe/types";
import type { SpellObjsJson } from "./exe/recio";
import { fn_0x52c279 } from "./exe/spells";
import { randInclusive } from "./exe/rand";
import { vt30 } from "./exe/vtables";
import { NotPorted, dirFromDelta16, unitPlaceOnCells, unitRemoveFromCells, unitTurnStep, unitWalkNear } from "./exe/walk_action";
import { mapObjSetFine, mapObjSubCellCenter } from "./exe/walk";
import { BACKTRACE_UB, fn_0x55be86 } from "./exe/wave";
import { EXE_GLOBALS } from "./exe/types";
import { VIS_COST, VIS_PARENT } from "./vision_tables";
import { Rng, type RandSite } from "./rng";
import { castAt, exeFlee, legacyThink, pickOffensive } from "./ai";
import {
  ClientOrder, EMPTY_GROUP, aiGroupCmdGuard, aiGroupCmdMove, aiGroupCmdSwarm2, aiGuardLoad, clientOrder, fn_0x52ae43, fn_0x52af8c, fn_0x53d690,
  fn_0x5708ff, fn_0x570946, fn_0x570b8b, fn_0x570d26,
} from "./exe/orders";
import { canRevive, healDying, onFell, raiseDead, summonCreature, CORPSE } from "./necro";
import { selectedSpellRange } from "./spellattack";
import {
  EXE_TPS, SPELL, SPHERE_INDEX, isOffensive, powerScale, prismaticRays, spellDefColumns, spellKey, spellLayer, stoneCurseTicksMax, type BuffKind,
  type SpellDef, type SpellEffect, type SpellTable,
} from "./spells";
import { BLIZZARD_PULSES, PULSE_EXE_TICKS, acidSteps, areaCells, exeDir8 } from "./areas";
import {
  DIP_ALLY, DIP_WAR, TICK_MS, TICKS_PER_SEC,
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

/** Jogador do despejo do oráculo (tools/re/oracle/dump_ticks.py: `exe.world.players`): endereço, id, +0x2c, +0x32, +0x38 e os grupos
 *  (endereço, dados do comando em hex, membros = endereços das unidades, já traduzidos pelo importador). */
export interface ExePlayerSpec { a: number; id: number; f2c: number; f32: number; f38: number; groups: { a: number; data: string; units: number[] }[] }

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

/** Nome do tipo de efeito do exe (tabela 0x5f8f50) por efeito do motor antigo (`bookSpellRec` sem a tabela Spells). */
const FX_NAME: Partial<Record<string, string>> = {
  absorption: "absorbtion", defense: "defence", attack: "tohit", speed: "speed", sight: "scanrange", "resist.fire": "protectionfire",
  "resist.water": "protectionwater", "resist.air": "protectionair", "resist.earth": "protectionearth", "resist.astral": "protectionastral",
};

/** Efeito do motor antigo por tipo de efeito do exe (+0x3c: tabela 0x5f8f50). */
const FX_KIND: Partial<Record<number, BuffKind>> = {
  0xc: "attack", 0xf: "defense", 0x10: "absorption", 0x11: "speed", 0x13: "sight", 0x15: "resist.fire", 0x16: "resist.water",
  0x17: "resist.air", 0x18: "resist.earth", 0x19: "resist.astral",
};

/** Efeito do motor antigo pelo id da magia (+0xc) das cargas sem tipo que o motor antigo modele (Spell_WallObject: Invisibility, Bless,
 *  Curse) ou cujo efeito o exe faz pelo id (Light/Darkness em 0x51d175, Stone Curse e Poison): só para a apresentação. */
const FX_KIND_BY_ID: Partial<Record<number, BuffKind>> = {
  [SPELL.Invisibility]: "invisible", [SPELL.Bless]: "bless", [SPELL.Curse]: "curse", [SPELL.StoneCurse]: "stone", [SPELL.PoisonCloud]: "poison",
  [SPELL.Light]: "sight", [SPELL.Darkness]: "sight",
};

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
/** Tipo de arma (+0xb6 do exe = índice na tabela de 6 resistências físicas +0xce..): 0 sem arma (garras/mordidas), 1..5 as habilidades. */
const WTYPE_KEYS = ["none", "blade", "axe", "bludgeon", "pike", "shooting"] as const;
const WTYPE_INDEX: Record<string, number> = { none: 0, blade: 1, axe: 2, bludgeon: 3, pike: 4, shooting: 5 };
/** Elemento do dano B (+0xbb do exe; proteções +0xc4..+0xcc): 1 fogo, 2 água, 3 ar, 4 terra, 5 astral. */
const ELEMENT_INDEX: Record<string, number> = { fire: 1, water: 2, air: 3, earth: 4, astral: 5 };
/** a máquina de ação já rodou neste `World.act` (roda exatamente uma vez por tique por unidade, como no exe); rascunho do módulo */
let machineRan = false;
/** endereço sintético → definição da magia (World.spellAddr): rascunho do módulo, determinístico por (id, poder, mana) */
const SPELL_BY_ADDR = new Map<number, SpellDef>();
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
  // vtable: humanos (modelos < 0x40, kind "hero" no despejo) e o herói usam 0x5d0fb8; monstros 0x5d0eb0 (0x5d0f40 não aparece no corpus)
  r.vtbl = u.isHero || (u.typeId > 0 && u.typeId < 0x40) ? 0x5d0fb8 : 0x5d0eb0;
  r.size = Math.max(1, u.stats.size ?? 1) & 0xff;
  r.kind = u.stats.movement ?? (u.flying ? 3 : 1);
  r.walk.passMask = r.kind === 3 ? 0x82 : r.kind === 2 ? 0x44 : 0x41;
  r.walk.turnRate = (u.stats.turnSpeed ?? Math.round(u.stats.speed * 16)) & 0xff;
  r.walk.f09 = 0xff;
  r.walk.f08 = UNIT_GUARD_RADIUS;   // +0x1c0+8 = 5 (0x551346)
  r.speed = Math.round(u.stats.speed * 16);
  r.type.stats.f45 = 1;
  r.tpl = new TemplateRec();
  r.tpl.arr[0x21] = u.timing.dyingTicks;   // duração da queda (vtable +0x74 → modelo[0x21] / [0x17]): a da animação do motor
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
  /** vida (+0x94) e vida máxima (+0x96) do registro do exe: a porta do golpe (0x516ceb) e a máquina (0x50f12c) as escrevem. São shorts:
   *  valores fora de −32768..32767 (testes "imortais", console) saturam. */
  get hp(): number { return (this.rec.f94 << 16) >> 16; }
  set hp(v: number) { this.rec.f94 = Math.max(-32768, Math.min(32767, Math.round(v) | 0)); }
  get maxHp(): number { return (this.rec.f96 << 16) >> 16; }
  set maxHp(v: number) { this.rec.f96 = Math.max(-32768, Math.min(32767, Math.round(v) | 0)); }
  /** mana (+0x9a) e mana máxima (+0x9c) do registro do exe (shorts; a regeneração 0x50fc5a as escreve). */
  get mana(): number { return (this.rec.mana << 16) >> 16; }
  set mana(v: number) { this.rec.mana = Math.max(-32768, Math.min(32767, Math.round(v) | 0)); }
  get maxMana(): number { return (this.rec.f9c << 16) >> 16; }
  set maxMana(v: number) { this.rec.f9c = Math.max(-32768, Math.min(32767, Math.round(v) | 0)); }
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
  /** id do original nos estados importados (ordem do servidor em `serverOrder`); a trava `segundo % 4 == id % 4` da regeneração lê +4 do registro */
  regenSlot?: number;
  /** tiques seguidos no fim do caminho estático sem chegar (andar+0x90): a ordem desiste (adaptador `walkTo`/`chaseUnit`) */
  waitTicks = 0;
  order: Order = { type: "none" };
  ai: AiMode = { type: "guard", range: MINIMAL_GUARD_RANGE };
  /** posto (IA+0 do exe, célula y*256+x): vista sobre o registro — as tarefas portadas (0x56d4ba guarda, 0x56d52b Stand ground,
   *  0x569b62 patrulha) o escrevem; o motor antigo o lê e escreve por aqui */
  get home(): Cell { const c = this.rec.ai.f00 & 0xffff; return { x: c & 0xff, y: c >> 8 }; }
  set home(c: Cell) { this.rec.ai.f00 = ((c.y & 0xff) << 8) | (c.x & 0xff); }
  target = 0;
  cooldown = 0;
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
  /** tique da última mensagem "Not enough mana" (apresentação: Spell_SpendMana 0x519998 sem mana tenta de novo a cada tique) */
  noManaTick = -9999;
  /** guarda da carga do mapa (grupo comando 0x12, 0x5728fa): segundo (relógio 1/s) da última perseguição com o alvo inalcançável
   *  (`+0x1c4+0x16`, gravado em 0x54d76e), tique de 16/s do último golpe/magia recebido (`+0x98`, 0x56e6b8) e o ponto de fuga
   *  (`+0x9c`: 10 células a partir de quem bateu; 0 = nunca) */
  get unreachSec(): number { return this.rec.ai.f16 & 0xffff; }
  set unreachSec(v: number) { this.rec.ai.f16 = ((v & 0xffff) << 16) >> 16; }
  /** relógio de 16/s ABSOLUTO do último golpe/magia recebido (IA+0x98, 0x56e6b8; 0 = nunca) e o ponto de fuga (IA+0x9c) */
  get hitClock16(): number { return this.rec.ai.f98 >>> 0; }
  set hitClock16(v: number) { this.rec.ai.f98 = v >>> 0; }
  get fleeCell(): number { return this.rec.ai.f9c & 0xffff; }
  set fleeCell(v: number) { this.rec.ai.f9c = v & 0xffff; }
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
  /** vida do corpo depois da queda = a própria vida +0x94 (continua caindo: sangria, decomposição) — sim/necro.ts */
  get corpseHp(): number { return this.hp; }
  set corpseHp(v: number) { this.hp = v; }
  /** morte consumada (fim da animação e vida do corpo ≤ −10): a partir daqui o corpo só se decompõe e não volta com Heal */
  bodyDead = false;
  /** id de quem invocou (Summon, +0x148 do original); 0 = não invocada */
  summoner = 0;
  /** magia escolhida no livro (+0x1c4+0x78): unidade do jogador que ataca lança esta magia no lugar do golpe [exe 0x56b059] */
  selectedSpell: string | null = null;
  /** grupo do mapa/script (0 = nenhum) e raio de guarda DO GRUPO em volta do centroide (0 = guarda individual) [exe 0x57275f] */
  group = 0;
  groupRadius = 0;
  /** alvo que a guarda do grupo deu a esta unidade no último pensamento (`+0x1c4 +0x20`, 0x57240b) — vista para os testes/comparador */
  groupTarget = 0;
  /** a ordem corrente foi escrita pelo pensamento portado a partir da tarefa IA+8 (`syncOrdersFromTasks`): `act` não a reinterpreta */
  exeTask = false;
  /** não é do exe: o pensamento portado acabou de dar a tarefa de magia 8/9 (gancho `castTask`): `applyTaskOrder` escreve a ordem uma vez */
  castThisThink = false;
  /** o pensamento deste tique mandou a unidade fugir/recuar (AI_GroupFlee): a tarefa de andar vale sobre a ordem do gancho */
  fledThisThink = false;

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
    initUnitRec(this);
    this.home = { x: this.cx, y: this.cy };
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
  /** a área é a SpellArea do exe (lote 5: o endereço do objeto): só apresentação, as células são as que ela marca na ocupação; o
   *  motor antigo não a simula */
  exe?: number;
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
    this.exeWorld.allocGroupAddr = () => { const a = this.nextGroupAddr; this.nextGroupAddr = (a + 0x100) >>> 0; return a; };
    // `new` 0x401880 dos objetos de magia (Spell_Apply 0x519db8): endereços sintéticos, únicos no mundo
    this.exeWorld.allocObj = () => { const a = this.nextObjAddr; this.nextObjAddr = (a + 0x100) >>> 0; return a; };
    // a definição da magia pelo id (0x53e260; lote 5: SpellArea 0x518024): a tabela Spells de data.bin
    this.exeWorld.spellDefCol = (id, col) => { const row = this.spellTable?.[String(id)]; return row ? spellDefColumns(row)[col] ?? 0 : 0; };
    // a tabela de classes do mundo (+0xa54; igual nas 3 imagens do oráculo) desde a montagem: uma ordem dada antes do 1.º tique
    // (AI_TargetCost 0x5711ea em 0x570946) via tudo "não atacável" com a tabela zerada
    this.exeWorld.classTable.set([2, 1, 2, 4, 4, 2, 1, 0, 2, 1, 4, 0, 2, 1, 2, 4]);
    this.exeWorld.fa8b8 = MINIMAL_GUARD_RANGE;
    this.exeWorld.spellAt = (a) => {
      // [est: estado importado sem o despejo do exe] ação 0xd/0xe sem a magia em curso: uma magia sem definição (+4 = 0), que o gasto
      // 0x519998 e a aplicação 0x519db8 tratam como o exe (nada sai)
      if ((a >>> 0) === 0) { const r = new BookSpellRec(); r.hasDef = false; return r; }
      for (const u of this.units) for (const s of u.rec.book.spells) if (s && (s.addr >>> 0) === (a >>> 0)) return s;
      // magia de arma (o cajado: `weaponSpell`) ou de chance fora do livro: o registro da definição pelo endereço sintético
      const d = SPELL_BY_ADDR.get(a >>> 0);
      if (d) return this.bookSpellRec(d, a >>> 0);
      throw new Error(`magia 0x${(a >>> 0).toString(16)} fora dos livros espelhados`);
    };
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
    // rumo inicial do construtor de toda unidade (0x50e173, antes da colocação): andar+0 = andar+1 = Rand_Inclusive(0x80) + 0x40
    // (sul ± 90°); o servidor não lê a direção do .alm (0x561bf9) — etapa 9b, notes/carregador.md
    u.angle = (randInclusive(this.exeWorld, 0x80, 0x50e2b6) + 0x40) & 0xff;
    const c = this.grid.nearestFree(u.cx, u.cy, u.flying) ?? { x: u.cx, y: u.cy };
    u.x = c.x + 0.5; u.y = c.y + 0.5; u.home = { x: c.x, y: c.y };
    this.syncCombat(u);
    this.units.push(u);
    this.byId.set(u.id, u);
    this.exe.units.set(u.rec.addr, u.rec);
    u.rec.owner.f2c = this.isAiPlayerUnit(u) ? 1 : 0;
    u.rec.owner.f04 = u.player;
    // listas do exe: unidades vivas do mundo (+4, ordem de criação) e as do mesmo tipo (tipo+0: a lista é partilhada por modelo
    // [est]; o resto do registro do tipo — +0x45 grupo dormindo, +0x44, +0x20 — fica por unidade, como o despejo o traz)
    this.exeWorld.lists.all.addTail(u.rec.addr);
    u.rec.ai.f71 = (u.stats.seeInvisible ?? 0) & 0xff;
    this.exeGroupSync(u);
    this.occupy(u);
    return u;
  }
  // ------------------------------------------------------------------------------------------- jogadores e grupos do exe

  /** registros dos grupos de IA do exe por id (`u.group`; 0 → um grupo por unidade, id −u.id) e dos jogadores por número */
  readonly exeGroups = new Map<number, UnitTypeRec>();
  readonly exePlayers = new Map<number, PlayerRec>();
  private nextGroupAddr = 0x21000000;
  /** o próximo endereço sintético de objeto de magia (`WorldRec.allocObj`) */
  private nextObjAddr = 0x23000000;
  exePlayer(p: number): PlayerRec {
    let r = this.exePlayers.get(p);
    if (!r) {
      r = new PlayerRec();
      r.addr = (0x30000000 + p * 0x1000) >>> 0; r.f04 = p; r.f32 = (1 << p) & 0xffff; r.f2c = p === this.humanPlayer ? 0 : 1;
      this.exePlayers.set(p, r);
      this.exeWorld.playersByAddr.set(r.addr, r);
      // lista de jogadores na ordem do número (o exe: ordem de criação = a do mapa)
      this.exeWorld.players.removeAll();
      for (const q of [...this.exePlayers.keys()].sort((a, b) => a - b)) this.exeWorld.players.addTail(this.exePlayers.get(q)!.addr);
    }
    return r;
  }
  /** Modos/ordens sem tratador no exe executado pelo corpus (defend 0x56d5b9, follow 0x56d638, still 0x56dafe → tarefa 0x1a 0x56a909:
   *  exec 0, NotPorted): a unidade pensa no motor antigo (`legacyThink`), com o comando 0 no grupo e fora do despachante de tarefas. */
  private static legacyAi(a: AiMode): boolean { return a.type === "defend" || a.type === "follow" || a.type === "still"; }
  /** Ordens do lado humano sem `case` executado no corpus (0x4f515d): ficam no motor antigo [est] — pegar/andar perto (0x22), magia no
   *  chão (0xd), guarda (5), patrulha (0xb), defender (9), seguir, recuar, vagar, parado. */
  private static legacyOrder(o: Order): boolean {
    return o.type === "defend" || o.type === "follow" || o.type === "still" || o.type === "pickup" || o.type === "guard" || o.type === "patrol"
      || o.type === "retreat" || o.type === "roam" || (o.type === "move" && !!o.near) || (o.type === "cast" && !o.target);
  }
  legacyMode(u: Unit): boolean { return World.legacyAi(u.ai) || (!this.isAiPlayerUnit(u) && World.legacyOrder(u.order)); }
  /** Um grupo novo do exe (0x52ae43: vazio, comando 0, acordado) registrado no mundo espelhado. */
  private exeNewGroup(): UnitTypeRec {
    const g = fn_0x52ae43(new UnitTypeRec());
    g.addr = this.exeWorld.allocGroupAddr() >>> 0;
    this.exeWorld.groupsByAddr.set(g.addr, g);
    return g;
  }
  /** Assinatura do comando de grupo que o `AiMode` da unidade pede ao exe (o despachante do script 0x577cee → AI_GroupCmd_*), ou null
   *  quando nada muda por aqui (Guard de grupo do script: `initGroupGuard`; modos do motor antigo). */
  private exeGroupCmdKey(u: Unit): string | null {
    if (u.suspended || u.helpless) return null;
    const a = u.ai;
    switch (a.type) {
      case "guard": return u.group ? null : `g:${a.range | 0}`;
      case "hold": return "h";
      case "move": return `m:${a.x},${a.y}`;
      case "swarm": return `s:${a.x},${a.y}`;
      case "patrol": return `p:${a.x},${a.y}`;
      case "roam": return "r";
      default: return null;
    }
  }
  /** comando de grupo já aplicado (assinatura `exeGroupCmdKey`) por endereço do grupo */
  private readonly groupCmdApplied = new Map<number, string>();
  /** Guard do script já aplicado ao grupo de uma unidade do lado humano (assinatura `exeGroupCmdKey`), por id da unidade */
  private readonly humanScriptCmd = new Map<number, string>();
  /** Estado importado sem despejo (janelas do golden): o Guard do script no grupo ATUAL da unidade do lado humano — a ordem de ataque
   *  importada passa pelo cliente e a reagrupa, mas no original o ataque é do pensamento do grupo de comando 1 */
  exeScriptGuardNow(u: Unit): void {
    const key = this.exeGroupCmdKey(u);
    if (key === null || this.isAiPlayerUnit(u) || u.ai.type !== "guard") return;
    this.humanScriptCmd.set(u.id, key); this.exeApplyGroupCmd(u, u.rec.type, key);
  }
  /** O comando do script para o grupo (AI_GroupCommandDispatch 0x577cee): 1 Guard → AI_GroupCmd_Guard, 3 Stand ground → 0x570b8b,
   *  4 Move → AI_GroupCmd_Move, 5 Swarm2 → AI_GroupCmd_Swarm2 (o comando 2 Swarm do script, 0x5708bc, chega aqui como Swarm2 [est: o
   *  `AiMode` não os distingue]), 10 Attack → 0x570946 (o `AiMode` enxame com a ordem de atacar que o script deu), 14 Patrol → 0x570d26,
   *  17 Roam → 0x5708ff. */
  private exeApplyGroupCmd(u: Unit, g: UnitTypeRec, key: string): void {
    const wd = this.exeWorld, a = u.ai;
    switch (a.type) {
      case "guard": aiGroupCmdGuard(wd, g, a.range & 0xff); u.groupRadius = g.stats.f38 & 0xff; u.home = { x: u.rec.ai.f00 & 0xff, y: (u.rec.ai.f00 >> 8) & 0xff }; break;
      case "hold": fn_0x570b8b(wd, g); break;
      case "move": aiGroupCmdMove(wd, g, a.x & 0xff, a.y & 0xff); break;
      case "swarm": {
        const t = u.order.type === "attack" ? this.get(u.order.target) : undefined;
        if (t && t.alive) fn_0x570946(wd, g, t.rec); else aiGroupCmdSwarm2(wd, g, a.x & 0xff, a.y & 0xff);
        break;
      }
      case "patrol": {
        fn_0x570d26(wd, g, a.x & 0xff, a.y & 0xff);
        // 0x56d6b7 põe A = a célula de AGORA: no exe o script deu a ordem na célula de nascimento. Quem já tem a patrulha do motor
        // (nascimento ou estado importado no meio do caminho) fica com a lista [A, B] e o ponto corrente dela [est]
        for (const v of this.units) {
          const o = v.order;
          if (v.rec.type !== g || o.type !== "patrol") continue;
          const A = ((o.ay & 0xff) << 8) | (o.ax & 0xff), B = ((o.by & 0xff) << 8) | (o.bx & 0xff);
          listSet(v.rec.ai.patrol, A === B ? [A] : [A, B]);
          v.rec.ai.f02 = o.toB ? B : A;
        }
        break;
      }
      case "roam": fn_0x5708ff(wd, g); break;
      default: return;
    }
    void key;
  }
  /** O grupo do exe da unidade. Lado humano: um grupo por unidade [est: a seleção do cliente] que nasce com ela (parado = Stand ground
   *  0x570b8b [est]) e que só as ordens do cliente (`command` → `clientOrder`) trocam. Jogador de IA: o grupo do script (`u.group`) ou um
   *  por unidade; o comando vem do `AiMode` pela porta (`exeApplyGroupCmd`), aplicado uma vez por mudança. */
  private exeGroupSync(u: Unit): UnitTypeRec {
    const p = this.exePlayer(u.player);
    if (u.rec.owner !== p) u.rec.owner = p;
    if (!this.isAiPlayerUnit(u)) {
      if (u.rec.type.addr === 0 || u.rec.type === EMPTY_GROUP) {
        const g = this.exeNewGroup();
        fn_0x52af8c(g, u.rec);
        fn_0x53d690(p.groups, g.addr);
        fn_0x570b8b(this.exeWorld, g);
        this.exeGroups.set(-u.id, g);
      }
      const legacy = this.legacyMode(u);
      if (legacy && u.rec.type.stats.f20 !== 0) u.rec.type.stats.f20 = 0;
      // Guard do script numa unidade do lado humano (aliado da m10_mage): o despachante do script 0x577cee dá o comando 1 ao grupo dela
      // como a qualquer outro (traço: grupo do jogador 1 com comando 1) — uma vez por mudança DA UNIDADE (as ordens do cliente reagrupam
      // 0x5703c0 e trocam o comando depois; por grupo, o grupo novo recebia a guarda de volta: Putnik da missão 53 não andava)
      else if (!legacy && !u.isHero && u.ai.type === "guard") {
        const key = this.exeGroupCmdKey(u);
        if (key !== null && this.humanScriptCmd.get(u.id) !== key) { this.humanScriptCmd.set(u.id, key); this.exeApplyGroupCmd(u, u.rec.type, key); }
      }
      u.exeTask = !legacy;
      return u.rec.type;
    }
    const gid = u.group || -u.id;
    let g = this.exeGroups.get(gid);
    if (!g) {
      g = this.exeNewGroup();
      const d = g.stats, gs = this.groupState.get(gid);
      d.f48 = this.alwaysAwake ? (this.alwaysAwake.has(gid) ? 1 : 0) : 1;
      d.f38 = (gs?.base ?? u.groupRadius ?? 0) & 0xff; d.f2d = (gs?.radius ?? gs?.base ?? u.groupRadius ?? 0) & 0xff; d.f30 = gs?.combat ? 1 : 0;
      this.exeGroups.set(gid, g);
    }
    if (!p.groups.values().includes(g.addr)) {
      // o grupo é de um só dono (dono+0x28): a unidade que trocou de jogador (script) leva o grupo — senão ele pensava 2× por tique [est]
      for (const q of this.exePlayers.values()) if (q !== p) q.groups.remove(g.addr);
      p.groups.addTail(g.addr);
      g.owner = p;
    }
    if (u.rec.type !== g) {
      u.rec.type.members.remove(u.rec.addr);
      if (u.rec.type.members.count === 0 && u.rec.type.addr) {
        // grupo que ficou vazio: sai da lista do dono (como o exe apaga o grupo vazio ao regrupar)
        for (const q of this.exePlayers.values()) q.groups.remove(u.rec.type.addr);
      }
      u.rec.type = g;
      g.members.addTail(u.rec.addr);
      g.owner = p;
    }
    const legacy = this.legacyMode(u);
    if (legacy) { if (g.stats.f20 !== 0) g.stats.f20 = 0; }
    else {
      const key = this.exeGroupCmdKey(u);
      if (key !== null && this.groupCmdApplied.get(g.addr) !== key) { this.groupCmdApplied.set(g.addr, key); this.exeApplyGroupCmd(u, g, key); }
    }
    u.exeTask = !legacy;
    return g;
  }
  /** Os jogadores e grupos espelhados do exe no save (`WorldSnapshot.exeGroups`): os registros, as listas, os mapas e o comando de
   *  grupo já aplicado. Sem eles o restore refazia os grupos e reaplicava o comando do script (a patrulha 0x56d6b7 recalcula a visão). */
  exeGroupsToJson(): ExeGroupsJson {
    const w = this.exeWorld;
    const groups = [...new Set<UnitTypeRec>([...w.groupsByAddr.values(), ...this.exeGroups.values(), ...this.units.map(u => u.rec.type)])].filter(g => g !== EMPTY_GROUP);
    const players = [...new Set<PlayerRec>([...w.playersByAddr.values(), ...this.exePlayers.values(), ...this.units.map(u => u.rec.owner),
      ...groups.flatMap(g => g.owner ? [g.owner] : [])])];
    const gi = new Map(groups.map((g, i) => [g, i])), pi = new Map(players.map((p, i) => [p, i]));
    return {
      p: players.map(p => ({ f: scalarFields(p), g: p.groups.values() })),
      g: groups.map(g => ({ a: g.addr, m: g.members.values(), s: scalarFields(g.stats), o: g.owner ? pi.get(g.owner)! : -1 })),
      u: this.units.map(u => [u.id, u.rec.type === EMPTY_GROUP ? -1 : gi.get(u.rec.type)!, pi.get(u.rec.owner)!]),
      eg: [...this.exeGroups].map(([k, g]) => [k, gi.get(g)!]), ep: [...this.exePlayers].map(([k, p]) => [k, pi.get(p)!]),
      bg: [...w.groupsByAddr].map(([k, g]) => [k, gi.get(g)!]), bp: [...w.playersByAddr].map(([k, p]) => [k, pi.get(p)!]),
      pl: w.players.values(), ap: [...this.groupCmdApplied], next: this.nextGroupAddr, hs: [...this.humanScriptCmd],
    };
  }
  exeGroupsFromJson(j: ExeGroupsJson): void {
    const w = this.exeWorld;
    const players = j.p.map(x => { const p = new PlayerRec(); Object.assign(p, x.f); for (const a of x.g) p.groups.addTail(a); return p; });
    const groups = j.g.map(x => {
      const g = new UnitTypeRec();
      g.addr = x.a; Object.assign(g.stats, x.s); g.owner = x.o < 0 ? null : players[x.o]!;
      for (const a of x.m) g.members.addTail(a);
      return g;
    });
    for (const [id, t, o] of j.u) { const u = this.get(id); if (!u) continue; u.rec.type = t < 0 ? EMPTY_GROUP : groups[t]!; u.rec.owner = players[o]!; }
    this.exeGroups.clear(); for (const [k, i] of j.eg) this.exeGroups.set(k, groups[i]!);
    this.exePlayers.clear(); for (const [k, i] of j.ep) this.exePlayers.set(k, players[i]!);
    w.groupsByAddr.clear(); for (const [k, i] of j.bg) w.groupsByAddr.set(k, groups[i]!);
    w.playersByAddr.clear(); for (const [k, i] of j.bp) w.playersByAddr.set(k, players[i]!);
    w.players.removeAll(); for (const a of j.pl) w.players.addTail(a);
    this.groupCmdApplied.clear(); for (const [k, v] of j.ap) this.groupCmdApplied.set(k, v);
    this.humanScriptCmd.clear(); for (const [k, v] of j.hs ?? []) this.humanScriptCmd.set(k, v);
    this.nextGroupAddr = j.next;
  }
  /** Retrato dos jogadores e grupos do exe (o golden reaproveita o mundo entre janelas: `resetWorld` volta a ele antes do restore). */
  /** Os objetos de magia do mundo (lista [[0x6044c4]+0x7c]+4, os registros e as cargas presas) e o próximo endereço sintético. */
  exeSpellObjsToJson(): SpellObjsJson {
    const w = this.exeWorld;
    return {
      l: w.lists.spellObjs.values(), next: this.nextObjAddr,
      o: [...w.spellObjs.values()].map(o => ({ f: scalarFields(o), m: scalarFields(o.mapObj) })),
      p: [...w.payloads.values()].map(o => ({ f: scalarFields(o), m: scalarFields(o.mapObj), d: scalarFields(o.dmg), sk: [...o.dmg.sk] })),
    };
  }
  /** Os objetos de magia de volta (sem `j`: nenhum — save antigo, estado do tique 0). */
  exeSpellObjsFromJson(j?: SpellObjsJson): void {
    const w = this.exeWorld;
    w.lists.spellObjs.removeAll(); w.spellObjs.clear(); w.payloads.clear();
    if (!j) return;
    for (const x of j.o) { const o = new SpellObjRec(); Object.assign(o, x.f); Object.assign(o.mapObj, x.m); w.spellObjs.set(o.addr >>> 0, o); }
    for (const x of j.p) {
      const o = new SpellPayloadRec(); Object.assign(o, x.f); Object.assign(o.mapObj, x.m);
      Object.assign(o.dmg, x.d); o.dmg.sk.set(x.sk);
      w.payloads.set(o.addr >>> 0, o);
    }
    for (const a of j.l) w.lists.spellObjs.addTail(a);
    this.nextObjAddr = j.next;
  }
  exeGroupsSave(): () => void {
    const j = JSON.parse(JSON.stringify(this.exeGroupsToJson())) as ExeGroupsJson;
    return () => this.exeGroupsFromJson(j);
  }
  /** Estado exato do oráculo: jogadores (ordem da lista, campos), grupos (endereço, dados +0x3c, membros na ordem) e a tabela de
   *  classes, pelo despejo; as unidades passam a apontar para eles. `groupOf(addr)` = o grupo do motor (`u.group`) de uma unidade. */
  exeApplyPlayers(players: ExePlayerSpec[], classTable: string, groupOf: (addr: number) => number): void {
    const w = this.exeWorld;
    w.players.removeAll(); w.playersByAddr.clear(); w.groupsByAddr.clear(); this.exeGroups.clear(); this.exePlayers.clear();
    const byUnit = new Map<number, UnitTypeRec>();
    for (const p of players) {
      const pr = new PlayerRec();
      pr.addr = p.a >>> 0; pr.f04 = p.id; pr.f2c = p.f2c >>> 0; pr.f32 = p.f32 & 0xffff; pr.f38 = p.f38 >>> 0;
      for (const g of p.groups) {
        const gr = new UnitTypeRec();
        gr.addr = g.a >>> 0;
        if (g.data) {
          const b = new Uint8Array(g.data.match(/../g)!.map(h => parseInt(h, 16))), dv = new DataView(b.buffer), d = gr.stats;
          d.f0a = dv.getInt16(0x0a, true); d.f15 = b[0x15]!; d.f20 = b[0x20]!; d.f24 = dv.getUint32(0x24, true); d.f28 = dv.getUint16(0x28, true);
          d.f2a = b[0x2a]!; d.f2b = b[0x2b]!; d.f2c = b[0x2c]!; d.f2d = b[0x2d]!; d.f30 = dv.getInt32(0x30, true); d.f34 = dv.getInt32(0x34, true);
          d.f38 = b[0x38]!; d.f39 = b[0x39]!; d.speedByte = b[0x44]!; d.f45 = b[0x45]!; d.f48 = dv.getUint32(0x48, true);
        }
        for (const a of g.units) { gr.members.addTail(a >>> 0); byUnit.set(a >>> 0, gr); }
        gr.owner = pr;
        w.groupsByAddr.set(gr.addr, gr);
        pr.groups.addTail(gr.addr);
        const first = g.units[0];
        if (first !== undefined) { const gid = groupOf(first >>> 0); if (!this.exeGroups.has(gid)) this.exeGroups.set(gid, gr); }
      }
      w.playersByAddr.set(pr.addr, pr); w.players.addTail(pr.addr);
      this.exePlayers.set(p.id, pr);
    }
    const ct = classTable.match(/../g) ?? [];
    for (let i = 0; i < 16 && i < ct.length; i++) w.classTable[i] = (parseInt(ct[i]!, 16) << 24) >> 24;
    for (const r of this.exe.units.values()) {
      const g = byUnit.get(r.addr >>> 0);
      if (g) r.type = g;
      const pr = this.exePlayers.get(r.owner.f04);
      if (pr) r.owner = pr;
    }
    this.nextGroupAddr = 0x21000000;
    // o comando de grupo que o `AiMode` pede já está nos grupos importados (o original o aplicou): marcado como aplicado, senão o 1.º
    // passo fora do tique importado o reaplicava (Stand ground 0x570b8b zera IA+8 — m20_start, corrida sem reimportar, T=1)
    this.groupCmdApplied.clear();
    for (const u of this.units) {
      const g = byUnit.get(u.rec.addr >>> 0), key = g && !this.legacyMode(u) ? this.exeGroupCmdKey(u) : null;
      if (g && key !== null) this.groupCmdApplied.set(g.addr, key);
    }
  }
  /** Os registros de grupo/jogador de todas as unidades e os campos de IA que o pensamento lê (fora do estado exato do oráculo). */
  private exeSyncGroups(): void {
    for (const u of this.units) {
      const g = this.exeGroupSync(u), r = u.rec;
      r.ai.f40 = u.withdrawHp | 0; r.ai.f44 = u.wimpyHp | 0;
      for (let i = 0; i < 3; i++) { const ps = u.procSpells[i]; r.ai.f7c[i] = ps ? Number(ps.spell.base ?? ps.spell.id) | 0 : 0; r.ai.f88[i] = ps ? Math.round(ps.chance * 0x8000 / 100) | 0 : 0; }
      r.fa5 = Math.max(0, Math.floor(this.sightOf(u))) & 0xff;
      r.f88 = ((u.stats.mind ?? 0) << 16) >> 16;
      r.hasBook = u.spells.length > 0;
      if (r.book.src !== World.bookSig(u)) this.exeSyncBook(u);
      // IA+0x78: a magia escolhida na interface (CTRL+A; mensagem 0x46 sub 4 → 0x4f69a6) pelo id do livro (0 = golpe)
      { const s = u.selectedSpell ? u.spells.find(x => x.id === u.selectedSpell) : undefined; r.ai.spellSlot = s ? (Number(s.base ?? s.id) & 0xff) : 0; }
      void g;
    }
    this.exeWorld.players.removeAll();
    for (const q of [...this.exePlayers.keys()].sort((a, b) => a - b)) this.exeWorld.players.addTail(this.exePlayers.get(q)!.addr);
  }
  /** as magias do livro espelhado: as do motor antigo e as de chance (IA+0x7c: 0x56a981 as busca no livro por Unit_GetBookSpell 0x51c391) */
  private static bookSpells(u: Unit): SpellDef[] {
    return [...u.spells, ...u.procSpells.map(p => p.spell).filter(p => !u.spells.some(s => (s.base ?? s.id) === (p.base ?? p.id)))];
  }
  /** assinatura das magias que o livro espelha (a lista muda no lugar: pergaminhos, magias aprendidas) */
  private static bookSig(u: Unit): string {
    return World.bookSpells(u).map(s => `${s.base ?? s.id}:${s.range}:${s.mana}:${s.defensive ? 1 : 0}`).join(",");
  }
  /** Estado exato do oráculo: os ponteiros de magia do registro (IA+0x30 escolhida pelo pensamento, +0x64 em curso) apontam para as
   *  BookSpellRec do ORIGINAL; pelo id no livro despejado (`book` = [id, endereço]) viram as do livro espelhado (`spellAddr`). */
  exeImportSpellPtrs(u: Unit, book: [number, number][], f64?: number): void {
    const r = u.rec;
    if (r.book.src !== World.bookSig(u)) this.exeSyncBook(u);
    const ours = (a: number): number => {
      const e = book.find(([, ad]) => (ad >>> 0) === (a >>> 0));
      const s = e ? r.book.spells[e[0]] : null;
      if (s) return s.addr >>> 0;
      return !e && u.weaponSpell ? this.spellAddr(u.weaponSpell) : a >>> 0;   // fora do livro: a magia do cajado [est]
    };
    if (r.ai.f30) r.ai.f30 = ours(r.ai.f30);
    if (f64 !== undefined) r.f64 = f64 ? ours(f64) : 0;
    // a magia do cajado em curso: o exe a lança com o cajado em uso (+0x68 = +0x74; o poder vem dele, 0x5238c5)
    if (f64 && u.weaponSpell && (r.f64 >>> 0) === this.spellAddr(u.weaponSpell)) { this.syncCombat(u); r.f68 = r.f74; }
  }
  /** BookSpellRec de uma definição do motor antigo: id, alcance, custo, bit de apoio (+0xa) e a definição = as colunas da tabela Spells
   *  de data.bin (`spellTable`, spellDefColumns). Sem a tabela (testes de unidade): [est] o nível/esfera/dano da SpellDef (dano ÷ a escala
   *  do poder), [4] = 1 alvo unidade e [5] = 2 projétil pelo `kind`/`target`. */
  private bookSpellRec(s: SpellDef, addr: number): BookSpellRec {
    const r = new BookSpellRec(), id = Number(s.base ?? s.id) | 0;
    r.addr = addr >>> 0; r.id = id & 0xff; r.range = Math.max(0, Math.floor(s.range)) & 0xff; r.cost = (Math.round(s.mana) << 16) >> 16; r.f0a = s.defensive ? 1 : 0;
    const row = this.spellTable?.[String(id)];
    if (row) {
      r.def.set(spellDefColumns(row));
      r.effText = String(row.effects ?? "");   // definição+0x1c: o texto do efeito (0x51caa0 → 0x51e8fa)
    } else {
      // [est] sem a tabela: o texto do efeito montado dos efeitos da SpellDef (tipos de 0x5f8f50)
      const fx = (s.effects ?? []).map(e => `${FX_NAME[e.kind] ?? "unused_value_0"}=${e.amount}:duration ${Math.round(s.duration)}`);
      r.effText = fx[0] ?? "";
      const k = powerScale(s.power ?? 0);
      r.def[0] = s.level | 0; r.def[1] = Math.round(s.mana) | 0; r.def[2] = SPHERE_INDEX[s.element] ?? 0;
      r.def[4] = s.target === "point" || s.target === "self" ? 0 : 1;
      r.def[5] = s.kind === "bolt" || s.kind === "ball" || s.kind === "drain" ? 2 : 0;
      r.def[6] = Math.max(0, Math.floor(s.range)); r.def[7] = Math.max(1, Math.round((s.speed ?? 9) * 16));
      r.def[8] = s.kind === "bolt" || s.kind === "heal" || s.kind === "drain" ? 1 : 3;
      r.def[0x10] = s.max > 0 ? Math.round(s.min / k) : -1; r.def[0x11] = s.max > 0 ? Math.round(s.max / k) : -1;
    }
    return r;
  }
  /** A arma equipada (+0x74) que lança magia (o cajado: `weaponSpell`): a magia (+0x84), o efeito 0x29 (poder da magia, lido por
   *  0x5238c5) na lista +0x20 e +0x44 = 2 (o cajado da m10_mage nos pares de 0x510745: a ordem nova não cancela a magia dele). */
  private weaponItemSync(u: Unit, it: ItemRec): void {
    const s = u.weaponSpell;
    if (!s) { it.spell = null; it.magic.length = 0; return; }
    const a = this.spellAddr(s);
    it.addr = (a ^ 0x08000000) >>> 0;
    it.f44 = 2;
    if (!it.spell || (it.spell.addr >>> 0) !== a) it.spell = this.exeWorld.spellAt(a);
    const m = it.magic[0] ?? new ItemMagicRec();
    m.f3c = 0x29; m.f42 = (Math.round(s.power ?? 0) << 16) >> 16;
    it.magic.length = 0; it.magic.push(m);
  }
  /** O livro de magias espelhado (unidade+0x140: CArray de 28 slots indexado pelo id, como nas imagens do oráculo) a partir das magias do
   *  motor antigo: id, alcance, custo, bit de apoio (+0xa) e o endereço sintético que a máquina portada resolve (`spellAddr`). */
  private exeSyncBook(u: Unit): void {
    const b = u.rec.book;
    // a instância (Spell_Instance 0x5195b1) das magias que continuam no livro fica (e a do save, `keep`, entra uma vez)
    const prev = new Map(b.spells.flatMap((s, i) => (s ? [[i, [i, s.range, s.f0e, s.f0f, s.f10] as [number, number, number, number, number]] as const] : [])));
    for (const k of b.keep ?? []) prev.set(k[0], k);
    b.keep = [...prev.values()];
    b.src = World.bookSig(u); b.spells.length = 0;
    // 28 posições nas imagens do oráculo; quem conhece Curse (0x1c)/Slow (0x1d) tem o CArray maior (o índice é o id)
    const list = World.bookSpells(u), n = Math.max(0x1c, ...list.map(s => (Number(s.base ?? s.id) | 0) + 1).filter(k => k <= 0x1e));
    for (let i = 0; i < n; i++) b.spells.push(null);
    for (const s of list) {
      const id = Number(s.base ?? s.id) | 0;
      if (id < 0 || id >= n) continue;
      b.spells[id] = this.bookSpellRec(s, this.spellAddr(s));
    }
    bookApplyKeep(u.rec);
    b.keep = null;
  }
  /** AI_IdleCasterSupport 0x56c592 portado, chamado pelo pensamento do motor antigo (modos `legacyMode`): true se ficou com a tarefa 8
   *  (a ordem de magia do motor antigo é escrita a partir dela). */
  /** AI_Autocast 0x56bc7b portado, chamado pelo pensamento do motor antigo (modos `legacyMode`: defend/follow/still do lado humano):
   *  a tarefa 8 que ele deixa (IA+0x28 alvo, IA+0x30 magia) começa já a sub-ação 2 (o que 0x56ebc0 → 0x56e906 fariam) e a ordem do motor
   *  antigo fica — nesses modos a World reescreve IA+8 pela ordem a cada tique. true se começou a lançar. */
  exeAutocast(u: Unit): boolean {
    if (!u.alive || this.stunned(u)) return false;
    aiAutocast(this.exeWorld, u.rec, this.thinkHooks);
    if (!u.castThisThink) return false;
    u.castThisThink = false;
    const r = u.rec, s = this.spellFor(u, r.ai.f30), t = this.unitByAddr(r.ai.f28);
    if (!s) return false;
    this.castNow(u, s, t);
    return true;
  }
  /** AI_IdleCasterSupport 0x56c592 portado, chamado pelo motor antigo (idem). */
  exeIdleCasterSupport(u: Unit): boolean {
    aiIdleCasterSupport(this.exeWorld, u.rec, this.thinkHooks);
    if (!u.castThisThink) return false;
    this.applyTaskOrder(u);
    return true;
  }
  /** A ordem do motor antigo a partir da tarefa IA+8 que o porte deixou (1 andar para IA+0xa, 5 atacar IA+0xc, 8 magia IA+0x30 em IA+0x28,
   *  0xb/0 parada); só a apresentação: os registros (tarefa, destino, alvo, perseguição) já são os do exe. */
  private applyTaskOrder(u: Unit): void {
    const r = u.rec, task = r.ai.task & 0xff, cast = u.castThisThink;
    u.castThisThink = false;
    let o: Order;
    // classe +0x50 ainda 1 com IA+8 = 0/0xb a meio do último passo (IA+9 = 3: o pensamento largou a ordem) ou 6 (0x56eff3: atacar IA+0xc
    // sem perseguir): a unidade segue andando até o fim do passo (medido: herói da m10_start_s16 T=36, classe 1 e IA+8 = 0; m10_mage_s120
    // T=548, classe 1 e IA+8 = 6). Parada no centro (0x573198 → Stand ground ao lado do destino ocupado: classe 1 e IA+8 = 0) = "none"
    const walking = (r.task & 0xff) === 1 && (task === 6 || ((task === 0 || task === 0xb) && r.ai.sub === 3));
    if (task === 1 || walking) o = { type: "move", x: r.ai.f0a & 0xff, y: (r.ai.f0a >> 8) & 0xff };
    else if (task === 5 || task === 6) { const t = this.unitByAddr(r.ai.f0c); if (!t) return; o = { type: "attack", target: t.id }; }
    // tarefa de magia 8/9: só a nascida neste pensamento (gancho `castTask`); a que ficou de um pensamento anterior já virou ordem
    else if (task === 8) { const t = this.unitByAddr(r.ai.f28), s = SPELL_BY_ADDR.get(r.ai.f30 >>> 0); if (!cast || !t || !s) return; o = { type: "cast", spell: s.id, target: t.id, exe: true }; }
    else if (task === 9) { const s = SPELL_BY_ADDR.get(r.ai.f30 >>> 0); if (!cast || !s) return; o = { type: "cast", spell: s.id, x: r.ai.f3c & 0xff, y: (r.ai.f3c >> 8) & 0xff, exe: true }; }
    else if (task === 0xb || task === 0) o = { type: "none" };
    else return;
    const p = u.order;
    const same = p.type === o.type && (o.type !== "move" || (p.type === "move" && p.x === o.x && p.y === o.y)) && (o.type !== "attack" || (p.type === "attack" && p.target === o.target))
      && (o.type !== "cast" || (p.type === "cast" && p.spell === o.spell && p.target === o.target && p.x === o.x && p.y === o.y));
    if (same) return;
    u.order = o; u.resume = null; u.orderArmed = true; u.orderTick = -1e9; u.waitTicks = 0;
    if (o.type === "attack") { if (u.state !== "attack" && u.state !== "cast") u.target = o.target; u.lastTarget = o.target; }
    else if (o.type === "cast") { if (o.target) { u.target = o.target; u.lastTarget = o.target; } }
    else if (u.state !== "attack" && u.state !== "cast") u.target = 0;
    if (p.type !== o.type || o.type !== "move") u.decideTick = this.tick;
  }
  /** Depois do pensamento: `groupState`/`groupRadius`/`groupTarget` (vistas) e a ordem das unidades cujo grupo o porte comanda, a partir
   *  da tarefa IA+8 (`applyTaskOrder`). */
  private syncOrdersFromTasks(): void {
    for (const [gid, g] of this.exeGroups) {
      if (gid <= 0 || !this.groupState.has(gid)) continue;
      const gs = this.groupState.get(gid)!, d = g.stats;
      gs.radius = d.f2d & 0xff; gs.base = (d.f38 << 24) >> 24; gs.combat = (d.f30 | 0) !== 0;
    }
    for (const u of this.units) {
      const r = u.rec, cmd = (r.type.stats.f20 << 24) >> 24;
      u.groupRadius = u.group ? r.type.stats.f2d & 0xff : u.groupRadius;
      u.groupTarget = r.ai.f20 ? this.unitByAddr(r.ai.f20)?.id ?? 0 : 0;
      const driven = u.exeTask || u.fledThisThink || u.castThisThink;
      u.fledThisThink = false;
      void cmd;
      if (!driven || !u.alive || u.phased || u.suspended) continue;   // grupo suspenso pelo script: fica parado (como no motor antigo) [est]
      this.applyTaskOrder(u);
    }
  }
  /** O pensamento do exe (0x56fe4d) neste tique: relógio de 16/s ainda ≡ 6 (pré-incremento) e o contador de 1/s. */
  private exeThink(): void {
    EXE_GLOBALS.clock16 = this.absClock16() - 1;
    EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
    fn_0x56fe4d(this.exeWorld, this.exeWorld.players, this.thinkHooks);
    EXE_GLOBALS.clock16 = this.absClock16();
    this.syncOrdersFromTasks();
  }
  /** Ganchos do pensamento: magias (8b) no motor antigo e os modos sem tratador (`legacyMode`). */
  private readonly thinkHooks: ThinkHooks = {
    legacyThink: (_w, r) => {
      const u = this.unitByAddr(r.addr);
      if (!u || !this.legacyMode(u)) return false;
      if (u.alive && !u.phased && !u.suspended && !u.helpless && !this.stunned(u)) legacyThink(this, u);
      return true;
    },
    // 0x57a769: a escolha é a do motor antigo (8b); o fim é o do exe — AI_CastAtTarget 0x56c72b (tarefa 8 no alvo, portada), que o
    // `applyTaskOrder` torna a ordem de lançar (sem a tarefa, a ordem dada aqui era apagada pela tarefa 0 do pensamento)
    casterOffensiveSpell: (w, r, t) => {
      const u = this.unitByAddr(r.addr), tu = this.unitByAddr(t.addr);
      if (!u || !tu) return 0;
      const s = pickOffensive(this, u, tu);
      if (!s) return 0;
      if (r.book.src !== World.bookSig(u)) this.exeSyncBook(u);
      const b = r.book.spells[Number(s.base ?? s.id) | 0];
      if (!b) { this.command(u, castAt(u, s, tu)); u.orderTick = -1e9; return 1; }
      aiCastAtTarget(w, r, s.kind === "summon" ? r : t, b, this.thinkHooks);
      return 1;
    },
    traps: () => { for (let i = 0; i < this.traps.length; i++) this.rng.draw(0x57a409); },
    fleeTeleport: (_w, r) => { const u = this.unitByAddr(r.addr); if (u) { exeFlee(this, u, this.enemiesInSquare(u, UNIT_GUARD_RADIUS + 5), Math.max(1, Math.floor(u.stats.sight)) + 1, UNIT_GUARD_RADIUS); this.fleeTask(u); } },
    withdrawTeleport: (_w, r) => { const u = this.unitByAddr(r.addr); if (u) { exeFlee(this, u, this.enemiesInSquare(u, 2), Math.max(1, Math.max(1, Math.floor(u.stats.sight)) - 1)); this.fleeTask(u); } },
    fled: (_w, r) => { const u = this.unitByAddr(r.addr); if (u) { u.fledThisThink = true; if (u.order.type !== "retreat") this.events.push({ type: "flee", unit: u.id }); } },
    castTask: (_w, r) => { const u = this.unitByAddr(r.addr); if (u) u.castThisThink = true; },
  };

  /** Fim da fuga por magia do motor antigo (`exeFlee`, ganchos 0x56cb8c/0x56cef3) como no exe: o Teleport no ponto é AI_TeleportCast
   *  0x56969c (tarefa 9) e o andar é AI_MoveTo 0x56c8af (tarefa 1) — o `applyTaskOrder` os torna a ordem; sem isso a tarefa antiga
   *  do pensamento apagava a ordem de fuga. */
  private fleeTask(u: Unit): void {
    const o = u.order, r = u.rec;
    u.fledThisThink = true;
    if (o.type === "cast" && !o.target && o.x !== undefined && o.y !== undefined) {
      const sp = u.spells.find(x => x.id === o.spell);
      if (!sp) return;
      if (r.book.src !== World.bookSig(u)) this.exeSyncBook(u);
      const b = r.book.spells[Number(sp.base ?? sp.id) | 0];
      if (b) aiTeleportCast(this.exeWorld, r, ((o.y & 0xff) << 8) | (o.x & 0xff), b, this.thinkHooks);
    } else if (o.type === "retreat" && u.fleeX >= 0) aiMoveTo(r, ((u.fleeY & 0xff) << 8) | (u.fleeX & 0xff));
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

  /** Por tique (e ao restaurar): a tabela de diplomacia do exe (mundo+0xa8bc, bit 0 = guerra, lida por 0x57994d no fim de caminho),
   *  o id do dono (+0x14+4: o script pode passar a unidade a outro jogador) e a lista das unidades vivas (mundo+4: a morte tira —
   *  cadáveres vão para +0x44 —, a ressurreição põe de volta), refeita na ordem de criação, salvo no tique importado do oráculo
   *  (a lista veio do despejo). */
  private exeSyncWorld(): void {
    const w = this.exeWorld;
    w.helpless.clear(); for (const u of this.units) if (u.helpless) w.helpless.add(u.rec.addr >>> 0);
    for (let a = 0; a < this.dip.length && a < 0x46; a++) for (let b = 0; b < this.dip.length && b < 0x46; b++) {
      w.dipTable[8 + a * 0x46 + b] = a === b ? 0x12 : (this.dip[a]?.[b] ?? 0) & 0xff;   // bit 0 guerra, bit 1 aliança, 0x10 visão partilhada (0x57977a testa & 3; AI_AlliesScan 0x567b2d guarda o bit 1; 0x567c56 compara o byte inteiro com 2); consigo mesmo 0x12 (46 despejos do tique 0)
    }
    const heroOf = new Map<number, number>();
    for (const u of this.units) if (u.isHero) heroOf.set(u.player, u.rec.addr);
    // AutoCasting do jogador (Game Options, mensagem 0x46): [dono+0x34]+0x20 (0x56bb53/0x56bc7b)
    for (const [p, r] of this.exePlayers) r.autocast = (this.playerAi[p]?.autocast ?? 0) & 0xff;
    if (this.exeExact) { for (const u of this.units) { u.rec.owner.f04 = u.player; u.rec.owner.f38 = heroOf.get(u.player) ?? 0; } return; }
    this.exeSyncGroups();
    for (const [p, r] of this.exePlayers) { r.f04 = p; r.f38 = heroOf.get(p) ?? 0; r.f2c = p === this.humanPlayer ? 0 : 1; }
    // ordem de criação do exe: o herói ANTES das unidades do mapa (despejos m10/m20: [0x68d2dc]+4 começa no herói; o nosso o cria depois
    // do mapa) — 0x52b459 roda a unidade inteira (pensar, golpe, passo) na ordem da lista: com o herói por último, quem o persegue media a
    // distância com o passo dele por acabar (golden `pos|t75`). [est] O resto segue a nossa ordem (a do original não é a dos ids)
    const created = [...this.units.filter(u => u.isHero), ...this.units.filter(u => !u.isHero)];
    // as listas guardam a ordem que já têm (a do despejo num estado importado do oráculo, a de criação no jogo): sai quem não pertence
    // mais, quem entra vai para o fim (AddTail do exe) na ordem de criação. Refazer pela ordem dos ids trocava a ordem em que as unidades
    // rodam (e sorteiam) depois do tique importado — m20_start, corrida sem reimportar do tickcmp, T=1 (notes/carregador.md)
    // o herói vai sempre à frente (despejos m10/m20 e a regra de antes, acima): `spawn` o põe no fim de `lists.all`, depois do mapa
    const heroes = new Set(created.filter(u => u.isHero).map(u => u.rec.addr >>> 0));
    const stable = (l: CListPtr, want: (u: Unit) => boolean): void => {
      const ok = new Set(created.filter(want).map(u => u.rec.addr >>> 0));
      const cur = l.values().map(a => a >>> 0);
      const order = [...cur.filter(a => heroes.has(a)), ...cur.filter(a => !heroes.has(a))].filter(a => ok.has(a));
      const seen = new Set(order);
      for (const u of created) { const a = u.rec.addr >>> 0; if (ok.has(a) && !seen.has(a)) { order.push(a); seen.add(a); } }
      l.removeAll();
      for (const a of order) l.addTail(a);
    };
    stable(w.liveUnits, u => u.state !== "dead" && u.state !== "dying");
    // contentor [0x68d2dc] (World_SecondTick): todas as não consumadas (caídas incluídas), as criadas por magia e os cadáveres (na ordem
    // em que entraram: a da morte, como no exe)
    stable(w.lists.all, u => !u.bodyDead);
    stable(w.lists.corpses, u => u.bodyDead);
    stable(w.lists.magic, u => !!(u.dynamic || u.summoner));
  }

  /** Refaz as listas do mundo do exe a partir das unidades: vivas (mundo+4, na ordem dada ou na das unidades, só as de pé), as de
   *  cada tipo (tipo+0, por modelo [est]), a diplomacia e os donos. Estado importado/restaurado: os endereços dos registros mudaram. */
  exeRebuildLists(live?: number[], lists?: { all: number[]; magic: number[]; corpses: number[] }): void {
    const w = this.exeWorld;
    for (const u of this.units) u.rec.ai.f71 = (u.stats.seeInvisible ?? 0) & 0xff;
    this.exeSyncWorld();
    if (live) { w.liveUnits.removeAll(); for (const a of live) w.liveUnits.addTail(a >>> 0); }
    if (lists) {
      for (const k of ["all", "magic", "corpses"] as const) { w.lists[k].removeAll(); for (const a of lists[k]) w.lists[k].addTail(a >>> 0); }
    }
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

  /** `client` = a ordem é uma mensagem do cliente (interface, roteiro dos episódios): o servidor (0x4f515d) a trata mesmo igual à
   *  ordem em curso — o ataque repetido no mesmo alvo larga a perseguição (IA+8 = 0, andar+0x7c = 0) até o pensamento (medido: herói
   *  da m10_mage, T=463→464). As ordens internas do motor (retomadas, IA do motor antigo) só valem quando mudam. Antes de um passo
   *  com pensamento a mensagem espera o pensamento (`clientQueue`; as ordens do motor antigo, sem `clientOrder`, valem já).
   *  `now` = tratar já (a fila sendo esvaziada no passo). */
  command(u: Unit, o: Order, client = false, now = false): void {
    if (!u.active) return;
    if (client && !now && !this.isAiPlayerUnit(u) && !World.legacyAi(u.ai) && !World.legacyOrder(o) && this.aiTickAt(this.tick + 1)) {
      this.clientQueue.push([u, o]);
      return;
    }
    const resend = client && !this.isAiPlayerUnit(u) && sameOrder(u.order, o);
    if ((o.type === "attack" || o.type === "cast") && !this.isAiPlayerUnit(u)) {
      const p = u.order as { type: string; target?: number; spell?: string; x?: number; y?: number };
      const q = o as { type: string; target?: number; spell?: string; x?: number; y?: number };
      if (resend || p.type !== q.type || p.target !== q.target || p.spell !== q.spell || p.x !== q.x || p.y !== q.y) {
        u.orderArmed = false; u.orderTick = this.tick;
        // a mensagem do cliente larga a tarefa em curso até o pensamento (IA+8 = 0, alvo novo em IA+0xc; medido: herói da m10_start,
        // ataque novo em T=119) [est: o tratador da mensagem não está portado]
        const t = q.target ? this.get(q.target) : undefined;
        u.rec.ai.task = 0;
        if (q.type === "attack" && t) u.rec.ai.f0c = t.rec.addr;
      }
    } else u.orderArmed = true;
    // ordem nova do lado humano = a mensagem do cliente (Server_PacketDispatcher 0x4f515d, pacote 3; sim/exe/orders.ts `clientOrder`):
    // regrupa a unidade [est: seleção de uma] e despacha andar (4), atacar unidade (7), lançar em unidade (0xc), Stand ground (6).
    // As ordens sem `case` executado no corpus (andar "perto" = pegar/usar, pacote 0x22; magia no chão 0xd; guarda 5; patrulha 0xb;
    // defender 9; parado) ficam como estavam: só zeram a perseguição e o "parado" [est]
    if (!this.isAiPlayerUnit(u) && (resend || !sameOrder(u.order, o))) {
      const wd = this.exeWorld, r = u.rec;
      let g: UnitTypeRec | null = null;
      if (!World.legacyAi(u.ai) && !World.legacyOrder(o)) {
        if (o.type === "move" && !o.near) g = clientOrder(wd, [r], ClientOrder.Walk, o.x, o.y, null, 0);
        else if (o.type === "attack") { const t = this.get(o.target); if (t) g = clientOrder(wd, [r], ClientOrder.AttackUnit, 0, 0, t.rec, 0); }
        else if (o.type === "cast" && o.target) {
          const t = this.get(o.target), s = u.spells.find(x => x.id === o.spell);
          // o livro (+0x140) existe desde o nascimento no exe: espelhado aqui também, não só no pensamento (Unit_GetBookSpell em 0x4f515d)
          r.hasBook = u.spells.length > 0;
          if (r.book.src !== World.bookSig(u)) this.exeSyncBook(u);
          if (t && s) g = clientOrder(wd, [r], ClientOrder.CastAtUnit, 0, 0, t.rec, Number(s.base ?? s.id) | 0);
        } else if (o.type === "hold") g = clientOrder(wd, [r], ClientOrder.StandGround, 0, 0, null, 0);
      }
      if (g) this.exeGroups.set(-u.id, g);
      else { r.walk.chaseTarget = 0; r.ai.f50 = 0; }
    }
    if (!sameOrder(u.order, o)) u.decideTick = this.tick;
    // patrulha: a lista de pontos do exe (IA+0xb4, na ordem do roteiro: A = posto, B = ponto do script) e o ponto corrente IA+2
    if (o.type === "patrol") {
      const A = ((o.ay & 0xff) << 8) | (o.ax & 0xff), B = ((o.by & 0xff) << 8) | (o.bx & 0xff);
      listSet(u.rec.ai.patrol, A === B ? [A] : [A, B]);
      u.rec.ai.f02 = o.toB ? B : A;
    }
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
    if (!this.isAiPlayerUnit(u)) u.exeTask = !this.legacyMode(u);
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
    for (const u of m) { u.group = group; u.groupTarget = 0; }
    // o grupo do exe com todos os membros e o comando pela porta: AI_GuardLoad 0x570aba (carga do mapa, comando 0x12, raio 20) ou
    // AI_GroupCmd_Guard 0x5709d9 (script, comando 1, raio MinimalGuardRange); a visão +0xa5 e as células já têm de estar no registro
    let g: UnitTypeRec | null = null;
    for (const u of m) { u.rec.fa5 = Math.max(0, Math.floor(this.sightOf(u))) & 0xff; g = this.exeGroupSync(u); }
    if (!g) return;
    if (setup) aiGuardLoad(this.exeWorld, g, param & 0xff); else aiGroupCmdGuard(this.exeWorld, g, param & 0xff);
    const base = g.stats.f38 & 0xff;
    this.groupState.set(group, { base, radius: g.stats.f2d & 0xff, combat: (g.stats.f30 | 0) !== 0, cmd12: setup });
    for (const u of m) { u.groupRadius = base; u.home = { x: u.rec.ai.f00 & 0xff, y: (u.rec.ai.f00 >> 8) & 0xff }; }
  }

  /** estado da guarda de cada grupo de IA (comando `+0x3c`): raio-base `+0x38`, raio atual `+0x2d`, em combate `+0x30`; `cmd12` = Guard
   *  da carga do mapa (comando 0x12, 0x570aba → pensamento 0x5728fa; o Guard do script é o comando 1, 0x57275f) */
  groupState = new Map<number, GroupGuardState>();

  /** grupos sempre acordados (`+0x3c+0x48`, posto pelos gatilhos do script 0x562745 nos grupos que eles citam). `null` = não modelado:
   *  todos acordados (o jogo normal: `f48` = 1 em todos; o importador do diferencial deduz do estado exportado: ação 0x1b = dormindo) */
  alwaysAwake: Set<number> | null = null;
  /** há invisibilidade do ritual da missão 77 neste tique (ver `step`) */
  private ritualHidden = false;
  /** a unidade pertence a um grupo acordado (`+0x3c+0x45`, escrito pelo pensamento: 0x55b5f1 a cada 1 s; com mundo+0xbbe8 ≠ 0 todos) */
  awake(u: Unit): boolean { return (this.exeWorld.fbbe8 | 0) !== 0 || (u.rec.type.stats.f45 & 0xff) !== 0; }

  /** relógio de 16/s do original no nosso tique 0 (estado importado: `t16 − clock16()` no tique da importação); `null` = jogo normal
   *  (o pensamento segue `clockPhase`/AI_THINK_PHASE) */
  t16base: number | null = null;
  /** este tique é o do pensamento 1×/s (despachante de tarefas do exe) */
  thinkNow = false;
  /** unidades na ordem do servidor do exe: jogador e, dentro dele, id (o do original nos estados importados) */
  serverOrder(): Unit[] {
    // Server_ClockTick 0x4f8521 → 0x52b459 percorre [0x68d2dc]+4 (`lists.all`: ordem de criação, que NÃO é a dos ids — m20_start:
    // 24660 vem antes de 24621); quem não está na lista (cadáveres em `corpses`) vai depois, por (jogador, id)
    const byAddr = new Map<number, Unit>();
    for (const u of this.units) byAddr.set(u.rec.addr >>> 0, u);
    const out: Unit[] = [];
    for (const a of this.exeWorld.lists.all.values()) { const u = byAddr.get(a >>> 0); if (u) { out.push(u); byAddr.delete(a >>> 0); } }
    const rest = [...byAddr.values()].sort((a, b) => a.player - b.player || (a.regenSlot ?? a.id) - (b.regenSlot ?? b.id));
    return out.concat(rest);
  }

  /** contador de 1/s do exe (`[[0x6044c4]+0]`): ⌊relógio de 16/s absoluto ÷ 16⌋ — Server_Tick o incrementa no fim do tique cujo relógio
   *  (já incrementado) ≡ 0xf; medido nos pares de 0x50fc5a contra o despejo (`tick` = ⌊(t16 + 1) ÷ 16⌋ com t16 pré-incremento) */
  secClock(): number { return Math.floor(this.absClock16() / 16); }
  /** relógio de 16/s do exe (`[[0x6044c4]+4]`) no nosso tique: o tique de servidor k cai no nosso tique round(1,25·k) (a mesma conversão
   *  do pensamento calibrada em `thinkPhaseFor`), ou seja, k ≤ t ⇔ 1,25·k + 0,5 < t + 1 */
  clock16(t = this.tick): number { return Math.ceil(((2 * t + 1) * SERVER_TICKS_PER_SEC) / (2 * TICKS_PER_SEC)) - 1; }

  /** relógio de 16/s absoluto do exe ([[0x6044c4]+4]): o do estado importado (`t16base`) mais o nosso */
  absClock16(): number { return (this.t16base ?? 0) + this.clock16(); }

  /** Atributos de combate da unidade no registro do exe (0x516f6f lê os da vítima e do agressor): toHit +0xa6, dano +0xb4/+0xb5, tipo de
   *  arma +0xb6 (índice da tabela de resistências +0xce: 0 sem arma, 1 blade, 2 axe, 3 bludgeon, 4 pike, 5 shooting), dano elemental
   *  +0xb7..+0xbb, defesa +0xbe (÷ 2 caída), absorção +0xc0, proteções +0xc4..+0xcc, resistências físicas +0xce.., bit 0x10 de +0x4c
   *  (acerta sempre), vida e vida máxima, bits de efeito +0x144 (1 << id da magia) dos `buffs`. No estado importado do oráculo
   *  (`exeExact`) os efeitos já vêm do original. */
  syncCombat(u: Unit): void {
    const r = u.rec, s = u.stats, d = r.dmg;
    d.atk = ((this.attackOf(u) | 0) << 16) >> 16;
    d.dmin = s.damage.min & 0xff;
    d.dadd = Math.max(0, s.damage.max - s.damage.min) & 0xff;
    d.wtype = WTYPE_INDEX[s.attackType ?? "none"] ?? 0;
    const el = s.elemental;
    d.elA0 = (el?.aBase ?? 0) & 0xff; d.elA1 = (el?.aRange ?? 0) & 0xff; d.elB0 = (el?.bBase ?? 0) & 0xff; d.elB1 = (el?.bRange ?? 0) & 0xff;
    d.elK = (el?.element ?? 0) & 0xff;
    // habilidades (+0xa8 + 2 × esfera): a base do poder da magia em Spell_Apply 0x519db8 (herói: da experiência; os outros: data.bin)
    for (const [sch, i] of Object.entries(SPHERE_INDEX)) {
      d.sk[i] = ((u.heroInfo ? skillFromExp(u.heroInfo.skillExp[sch] ?? 0) : (s.magicSkills?.[sch] ?? 0)) << 16) >> 16;
    }
    r.fbe =((this.defenseOf(u) | 0) << 16) >> 16;
    r.fc0 = ((this.absorptionOf(u) | 0) << 16) >> 16;
    r.prot[1] = this.resistOf(u, "fire"); r.prot[2] = this.resistOf(u, "water"); r.prot[3] = this.resistOf(u, "air");
    r.prot[4] = this.resistOf(u, "earth"); r.prot[5] = this.resistOf(u, "astral");
    const rp = s.resistPhysical;
    for (let i = 0; i < WTYPE_KEYS.length; i++) r.resist[i] = rp ? Math.min(100, rp[WTYPE_KEYS[i]!] ?? 0) & 0xff : 0;
    r.f4c = (r.f4c & ~0x14) | (s.alwaysHit ? 0x10 : 0) | (u.spells.length ? 4 : 0);   // bit 4 = tem livro de magias (0x53a5a0: conjurador)
    r.f04 = (u.regenSlot ?? u.id) >>> 0; r.f0e = u.typeId & 0xffff;   // +4 = id do original nos estados importados (trava % 4 da regeneração)
    r.vtbl = u.isHero || (u.typeId > 0 && u.typeId < 0x40) ? 0x5d0fb8 : 0x5d0eb0;   // humanos/herói × monstros (os testes mudam `isHero` depois do spawn)
    { const mv = s.movement ?? (u.flying ? 3 : 1); r.kind = u.flying && mv < 2 ? 3 : mv; }   // +0x4a (> 1: some ao morrer); os testes mudam `flying` depois do spawn
    r.attackRange = this.attackRange(u) & 0xff;   // +0x12c (0x516ceb: distância ≤ alcance; AI_AttackRange 0x56ac5b sem magia escolhida)
    r.f1a0 = u.dynamic ? 1 : 0; r.f148 = u.summoner && !u.bodyDead ? unitAddr(u.summoner) : 0;   // Unit_Die 0x510a70 zera +0x148
    // regeneração (0x50fc5a): períodos +0x98/+0x9e dos dados (0 = não regenera), bônus +0xde/+0xe2 (não há nos `stats`); os restos
    // +0xa2/+0xa3 são do registro. No estado importado do oráculo vêm do despejo.
    if (!this.exeExact) { r.f98 = ((s.healthRegen ?? 0) << 16) >> 16; r.f9e = ((s.manaRegen ?? 0) << 16) >> 16; r.fde = 0; r.fe2 = 0; }
    // modelo (+0x3c): nome (0x510a70 procura "NPC": `noDrop`) e o saque [0x26] chance de ouro, [0x27] mín., [0x28] faixa, [0x29] chance
    // de item, [0x2a]/[0x2b] preço mín./máx., [0x2c] máscara (−1 sem tesouro, como nos modelos do oráculo)
    const tpl = r.tpl!, tr = s.treasure;
    tpl.name = (s.noDrop ? "NPC " : "") + s.name;
    // ouro mínimo negativo nos nossos dados = sem ouro (o original só sorteia com chance ≥ 0) [est: derive.py]
    const goldOk = !!tr && tr.goldMin >= 0;
    tpl.arr[0x26] = goldOk ? tr.goldChance | 0 : -1; tpl.arr[0x27] = goldOk ? tr.goldMin | 0 : -1; tpl.arr[0x28] = goldOk ? Math.max(0, tr.goldMax | 0) : -1;
    tpl.arr[0x29] = tr ? (tr.itemChance ?? 0) | 0 : -1; tpl.arr[0x2a] = tr ? (tr.itemMin ?? 0) | 0 : -1; tpl.arr[0x2b] = tr ? (tr.itemMax ?? 0) | 0 : -1;
    tpl.arr[0x2c] = tr ? (tr.itemMask ?? 0) | 0 : -1;
    r.f86 = ((s.reaction ?? 30) << 16) >> 16;
    // charge/relax (+0x134/+0x135) do data.bin; sem eles (dados antigos/genéricos dos testes) os tempos da animação, como antes (castTiming)
    r.f134 = (s.charge ?? Math.max(1, u.timing.hitTick)) & 0xff; r.f135 = (s.relax ?? Math.max(1, u.timing.attackTicks - u.timing.hitTick)) & 0xff;
    // arma equipada (+0x74): o peso +0x4a conta na espera; a arma que lança magia (`weaponSpell`, o cajado) leva a magia +0x84 e o poder
    // (efeito 0x29 da lista +0x20): a máquina 0x50f12c troca o golpe pela magia dela (conjurador) e 0x516ceb a solta depois do golpe
    if (s.weaponWeight !== undefined || u.weaponSpell) {
      r.f74 ??= new ItemRec();
      r.f74.f4a = ((s.weaponWeight ?? 0) << 16) >> 16;
      this.weaponItemSync(u, r.f74);
    } else r.f74 = null;
    if (!this.exeExact) {
      let e = 0;
      for (const b of u.buffs) { const id = Number(b.spell); if (id >= 1 && id < 32) e |= 1 << id; }
      // a invisibilidade dada pelo script (missão 77, `spell: "ritual"`) também é o efeito 0xc (AI_EnemyFilter 0x567a16 testa 0x1000)
      if (u.buffs.some(b => b.kind === "invisible")) e |= 1 << SPELL.Invisibility;
      // os efeitos da lista +0x20 do exe (0x51ce12 liga o bit, 0x51cc9f o apaga)
      e |= this.exeFxBits(u);
      r.effects = e >>> 0;
    }
  }

  /** Os campos derivados dos registros de todas as unidades (atributos de combate, modelo, dono): depois de um restore. */
  syncRecs(): void {
    this.exeSyncWorld();
    for (const u of this.units) this.syncCombat(u);
  }

  /** A guerra que 0x57977a declarou na tabela do exe (mundo+0xa8bc, bit 0) entra na diplomacia do motor (`dip`: evento, alvos largados). */
  private syncDiplomacyBack(): void {
    const t = this.exeWorld.dipTable, n = Math.min(this.dip.length, 0x46);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a !== b && (t[8 + a * 0x46 + b]! & 1) !== 0 && !this.hostile(a, b)) this.setDiplomacy(a, b, 1);
    }
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

  // ------------------------------------------------------------------------------------------- laço

  /** O passo do tique `t` roda o pensamento do exe (0x56fe4d). */
  private aiTickAt(t: number): boolean {
    // estado importado do original: o pensamento sai no tique de servidor com relógio de 16/s ≡ 7, ANTES do laço das unidades desse
    // tique (sonda rngprobe: os sorteios do apoio dos conjuradores vêm antes dos do olhar em volta)
    return this.t16base === null ? (t + this.clockPhase) % TICKS_PER_SEC === AI_THINK_PHASE
      : this.clock16(t) !== this.clock16(t - 1) && (((this.t16base + this.clock16(t)) % 16) + 16) % 16 === 7;
  }
  /** mensagens do cliente que chegaram antes de um passo com pensamento: Server_Tick 0x4f08c0 pensa (0x56fe4d) e só depois
   *  Server_ClockTick 0x4f8521 as trata (Server_ClientMessages 0x4f84c6) — o pensamento desse tique não as vê */
  private clientQueue: [Unit, Order][] = [];

  step(): void {
    this.tick++;
    const serverTick = this.clock16() !== this.clock16(this.tick - 1);
    const aiTick = this.aiTickAt(this.tick);
    this.thinkNow = aiTick;
    // o pensamento do exe (Server_Tick 0x4f08c0: `t16 & 15 == 6` → 0x56fe4d) roda ANTES de Server_ClockTick incrementar o relógio e
    // rodar as unidades: é o mesmo tique do nosso ≡ 7 (relógio já incrementado), mas os sorteios dele foram gravados com o relógio
    // anterior — no replay (golden) o bloco do pensamento busca a fila do tique − 1
    if (aiTick && this.t16base !== null) this.rng.shift = -1;
    this.exeSyncWorld();
    for (const u of this.units) this.syncCombat(u);
    // [est] a invisibilidade do ritual da missão 77 (mission/setup.ts, `spell: "ritual"`: "os guardas que aparecem não veem ninguém") não é
    // mecânica do exe — AI_EnemyFilter 0x567a16 só deixa ver o invisível a distância ≤ IA+0x71 de um membro do grupo; enquanto ela dura,
    // as unidades de IA ficam com IA+0x71 = 0
    if (!this.exeExact) {
      const ritual = this.units.some(v => v.alive && v.buffs.some(b => b.kind === "invisible" && b.spell === "ritual"));
      if (ritual || this.ritualHidden) for (const u of this.units) u.rec.ai.f71 = (ritual && this.isAiPlayerUnit(u) ? 0 : u.stats.seeInvisible ?? 0) & 0xff;
      this.ritualHidden = ritual;
    }
    if (aiTick) {
      // em tiques de 16/s: a ordem precisa ter chegado ≥ 2 tiques antes do pensamento (a do tique anterior só vale no tique dele)
      const s16 = (t: number) => Math.round(t * SERVER_TICKS_PER_SEC / TICKS_PER_SEC);
      for (const u of this.units) if (s16(this.tick) - s16(u.orderTick) >= 2) { if (!u.orderArmed) u.decideTick = this.tick; u.orderArmed = true; }
      // 0x56fe4d: acordar os grupos (0x55b5f1), esvaziar os eventos do mundo (0x57485b), AI_PlayerThink por jogador, as armadilhas (gancho)
      this.exeThink();
    }
    EXE_GLOBALS.clock16 = this.absClock16();
    // World_SecondTick 0x52bbb7 (regeneração/sangria 0x50fc5a, decomposição 0x5110b8, desgaste das invocações): Server_Tick a chama no
    // tique em que o relógio de 16/s ainda ≡ 0xc, ANTES de Server_ClockTick o incrementar e rodar as máquinas (pares: a regeneração lê
    // o relógio 28, a máquina do mesmo tique 29) — a vida que chega a −10 na sangria morre (Unit_Die) no mesmo tique
    if (serverTick && ((this.absClock16() % 16) + 16) % 16 === 13) {
      EXE_GLOBALS.clock16 = this.absClock16() - 1;
      EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
      worldSecondTick(this.exeWorld, this.exeHooks);
      EXE_GLOBALS.clock16 = this.absClock16();
    }
    // ordem do servidor: jogadores em ordem e, em cada um, as unidades por id (sonda rngprobe: a posição dos sorteios do olhar em volta
    // bate 9/9 com (jogador, id)); `regenSlot` = id do original nos estados importados
    // Server_ClockTick 0x4f8521: as mensagens do cliente (Server_ClientMessages 0x4f84c6) guardadas para depois do pensamento
    if (this.clientQueue.length) { const q = this.clientQueue; this.clientQueue = []; for (const [u, o] of q) this.command(u, o, true, true); }
    // Server_ClockTick 0x4f8521 → Server_WorldTick 0x4f04cf: os objetos de magia ([[0x6044c4]+0x7c]+4, 0x52c279) antes das unidades
    this.rng.shift = 0;
    if (this.exeWorld.lists.spellObjs.count) { EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff; fn_0x52c279(this.exeWorld, this.exeHooks); }
    const order = this.serverOrder();
    for (const u of order) {
      u.stateTime++;
      if (u.phased) continue;
      if (!u.alive) {
        // caída: a máquina 0x50f12c conta a animação da queda e decide a morte (vida < −9 → ação 0x10, gancho `die`); a animação do
        // motor (dying → dead) acompanha; consumada a morte (ação 0x10) a máquina não faz mais nada
        if (u.state === "dying" && u.stateTime >= u.timing.dyingTicks) this.setState(u, "dead");
        if (u.rec.act !== 0x10) this.machine(u);
        continue;
      }
      this.poisonTick(u);
      if (!u.active) continue;
      if (u.cooldown > 0) u.cooldown--;
      if (this.stunned(u)) { if (u.state === "move" || u.state === "attack" || u.state === "cast") this.setState(u, "idle"); continue; }
      // o pensamento que DECIDE (alvo, magia, fuga) é 1×/s, no `exeThink` (pelo porte: grupos, tarefas por unidade e ordens do cliente).
      // Só os modos sem tratador portado (`legacyMode`: defend/follow/still) pensam aqui no motor antigo, entre um pensamento e outro
      if (!this.isAiPlayerUnit(u) && !u.exeTask && (u.isHero || (this.tick + u.id) % 4 === 0) && !u.suspended && !u.helpless) legacyThink(this, u);
      this.act(u);
    }
    this.stepProjectiles();
    if (this.areas.length) this.stepAreas();
    if (this.traps.length) this.stepTraps();
  }

  /** Levanta quem estava morrendo (Heal que passa a vida de 0) [exe 0x510534]: volta ao estado normal com `hp`. */
  revive(u: Unit, hp: number, quiet = false): void {
    if (u.alive) return;
    const r = u.rec;
    // 0x510534: estado do corpo 0, defesa × 2 de volta, vida ≥ 1; ação/fase zeradas
    r.f13c = 0; r.fbe = ((((r.fbe << 16) >> 16) * 2) << 16) >> 16; r.act = 0; r.f58 = 0; r.f6c = 0;
    u.hp = Math.max(1, Math.min(u.maxHp, Math.round(hp)));
    u.bodyDead = false; u.felledBy = 0; u.silentFall = false;
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
    // como a queda da máquina 0x50f12c (que não deve cair de novo): +0x13c = 1, contador 0, tarefa/ação 0
    u.rec.f13c = 1; u.rec.f6c = 0; u.rec.task = 0; u.rec.act = 0;
    this.release(u);
    this.walkAbort(u); u.order = { type: "none" }; u.target = 0; u.castSpell = null;
    this.setState(u, "dead");
  }

  /** Veneno (Poison Cloud, efeito do motor antigo): 1 dano por segundo, na fase `(tique + id) % 16`. A regeneração de vida/mana é a porta
   *  de Unit_Regen 0x50fc5a em `worldSecondTick` (medido antes: herói 142 PV descansando +8/+9 a cada 4 s; cobra +1 a cada 4 s e +3 parada). */
  private poisonTick(u: Unit): void {
    if ((this.tick + u.id) % TICKS_PER_SEC !== 0) return;
    const poison = u.buffs.find(b => b.kind === "poison");
    if (!poison) return;
    const dmg = Math.max(1, Math.floor(poison.amount * (100 - this.resistOf(u, "water")) / 100 + 0.75));
    this.damage(poison.from ? this.get(poison.from) : undefined, u, dmg, "water", true);
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
    this.syncCombat(u);
  }

  // ------------------------------------------------------------------------------------------- atributos efetivos

  private buffSum(u: Unit, kind: BuffKind): number {
    let s = 0;
    for (const b of u.buffs) if (b.kind === kind) s += b.amount;
    return s + this.exeFxSum(u, kind);
  }
  /** Os efeitos com duração da lista +0x20 do exe (etapa 8b, lote 4: o Shield) no atributo `kind` do motor antigo: valor +0x40 dos que
   *  valem (nem acabados, +0x3d & 0x80, nem com a duração acabando agora: 0x51cc9f tira o efeito com +0x42 = 0). */
  exeFxSum(u: Unit, kind: BuffKind): number {
    const l = u.rec.fx;
    if (!l.count) return 0;
    let s = 0;
    for (const a of l.values()) {
      const e = this.exeWorld.payloads.get(a >>> 0);
      if (!e || (e.f3d & 0x80) || ((e.f3d & 1) && (e.f42 & 0xffff) === 0)) continue;
      const id = (e.fc << 16) >> 16, v = (e.f40 << 16) >> 16;
      if (id === SPELL.Light || id === SPELL.Darkness) {
        // 0x51d175: Light tira +0x40 da visão dos monstros (vtable+0x30 = 0), Darkness soma +0x40 (< 0) na dos humanos; o tipo do texto
        // (scanRange) não conta
        if (kind === "sight" && (id === SPELL.Light ? vt30(u.rec) === 0 : vt30(u.rec) !== 0)) s += id === SPELL.Light ? -v : v;
        continue;
      }
      if (FX_KIND[e.f3c & 0xff] !== kind) continue;
      s += v;
    }
    return s;
  }
  /** A unidade tem o efeito `id` na lista +0x20 do exe (bit +0x144 ligado por 0x51ce12, apagado por 0x51cc9f). */
  exeFxHas(u: Unit, id: number): boolean { return u.rec.fx.count !== 0 && (this.exeFxBits(u) & (1 << (id & 0x1f))) !== 0; }
  /** O maior +0x42 ÷ 16 dos efeitos 0xc (Invisibility) da lista +0x20 do exe (≥ 1). */
  private exeFxInvisPower(u: Unit): number {
    let p = 1;
    for (const a of u.rec.fx.values()) {
      const e = this.exeWorld.payloads.get(a >>> 0);
      if (e && ((e.fc << 16) >> 16) === SPELL.Invisibility && !(e.f3d & 0x80)) p = Math.max(p, (e.f42 & 0xffff) >> 4);
    }
    return p;
  }
  /** Não é do exe (testes, trapaças): os efeitos `id` da lista +0x20 acabam no tique seguinte (+0x42 = 1, como 0x516b2f faz com a
   *  invisibilidade; 0x51cc9f os tira). */
  exeFxExpire(u: Unit, id: number): void {
    for (const a of u.rec.fx.values()) {
      const e = this.exeWorld.payloads.get(a >>> 0);
      if (e && ((e.fc << 16) >> 16) === id && (e.f3d & 3)) e.f42 = 1;
    }
  }
  /** Os bits +0x144 (1 << id da magia) dos efeitos da lista +0x20 do exe que não acabaram. */
  exeFxBits(u: Unit): number {
    let e = 0;
    for (const a of u.rec.fx.values()) { const fx = this.exeWorld.payloads.get(a >>> 0); if (fx && !(fx.f3d & 0x80)) e |= 1 << (fx.fc & 0x1f); }
    return e >>> 0;
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
    if (u.hasBuff("stone")) return 0;   // a Stone Curse do exe (lote 5) para a unidade pela máquina (bit 0x40000 → IA+9 = 4), não aqui
    return Math.max(0.15, u.stats.speed + this.buffSum(u, "speed") / 16);
  }
  /** visão (células): Light/Darkness e itens de scanRange */
  sightOf(u: Unit): number { return Math.max(1, u.stats.sight + this.buffSum(u, "sight")); }
  /** proteção (%) contra a escola, com Protection from X (máx. 100) */
  resistOf(u: Unit, element: string): number {
    const base = (u.stats.resist as Record<string, number>)[element] ?? 0;
    return Math.max(-100, Math.min(100, base + this.buffSum(u, `resist.${element}` as BuffKind)));
  }
  /** Petrificada pelos `buffs` do motor antigo (script); a Stone Curse do exe (lote 5) fica com a máquina 0x50f12c, que segue rodando
   *  (é nela que o efeito desconta e acaba). */
  stunned(u: Unit): boolean { return u.buffs.length > 0 && u.hasBuff("stone"); }
  /** Invisível pelos `buffs` (script) ou pelo efeito 0xc da lista do exe. */
  invisible(u: Unit): boolean { return u.hasBuff("invisible") || this.exeFxHas(u, SPELL.Invisibility); }
  /** `viewer` enxerga `u`? Invisibility esconde de quem não tem "See invisible" suficiente [est: seeInvisible × 10 ≥ poder] */
  canSee(viewer: Unit, u: Unit): boolean {
    // o efeito 0xc do exe (lote 5) não guarda o poder: a duração +0x42 nasce poder × 16 (0x519db8), conta o que resta ÷ 16 [est]
    const inv = u.buffs.length ? u.buffs.find(b => b.kind === "invisible") : undefined;
    const amount = inv ? inv.amount : this.exeFxHas(u, SPELL.Invisibility) ? this.exeFxInvisPower(u) : 0;
    if (!amount) return true;
    return (viewer.stats.seeInvisible ?? 0) * 10 >= amount;
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
    machineRan = false;
    try {
    // ordem de andar: o pensamento (0x569321, tique ≡ 7) larga a tarefa 1 (IA+8 = 0) quando a CÉLULA já é a do destino, mesmo a meio
    // passo; a classe da tarefa (+0x50) só vira "parado" no pensamento em que a unidade já está no centro (medido: herói da m10_start
    // no centro em T=49 → as duas em T=50; da m10_mage a meio passo em T=97 → IA+8 = 0 em T=98, classe 1 até o pensamento seguinte)
    if (u.order.type === "move" && this.thinkNow && !u.exeTask && u.cx === u.order.x && u.cy === u.order.y) {
      if (u.rec.ai.sub === 3 && !u.order.arrived) { u.order.arrived = true; u.rec.ai.task = 0; }
      else this.command(u, { type: "none" });
    }
    // patrulha: o pensamento (0x569b62 → 0x56c8af) passa ao ponto seguinte quando a célula já é a do ponto, idem (medido: m20_start,
    // 24620, T=575→576); até lá Unit_WalkNear parado no ponto (ação 1)
    if (u.order.type === "patrol" && this.thinkNow) {
      if (u.cx === (r.ai.f02 & 0xff) && u.cy === (r.ai.f02 >> 8)) this.patrolAdvance(r);
    }
    // sub-ação em curso do exe (IA+9: 1 golpe, 2 magia, 3 passo, 4 efeito, 0xff parado): o despachante 0x56dca2 a continua antes de
    // qualquer ordem; a máquina de ação (0x50f12c = o golpe/a magia do motor antigo, `progressAttack`) roda depois dele no mesmo
    // tique. No fim (pronto = 1 no tique E) o despachante solta o pedido em E + 1 (ação 0) e a tarefa volta em E + 2 (sonda c1/c2:
    // Skrakan, Lightning a cada charge + relax + nível + rand(0..3) + 2 = 24–27 tiques)
    // [est] quem faz o ritual da missão 77 (invisibilidade `spell: "ritual"`, mission/setup.ts) só o faz: o Stand ground portado
    // (0x56a1fb) o mandaria golpear o guarda que aparece ao lado e o golpe tiraria a invisibilidade (0x516b2f) — falha 7
    if (u.exeTask && r.ai.sub === 0 && u.buffs.some(b => b.kind === "invisible" && b.spell === "ritual")) { this.stop(u); return; }
    if (r.ai.sub !== 0) { this.machine(u); return; }
    const o = u.order;
    switch (o.type) {
      case "none":
        // ociosa de jogador de IA: o pensamento (0x56afd9, tique ≡ 7) põe a tarefa IA+8 = 0xb, e o despachante olha em volta em todo
        // tique (0x56e5bc: sorteios 0x56e629/0x56e656, giro por 0x556454); a tarefa importada do oráculo vale até o pensamento.
        // A tarefa 6 (fim de caminho 0x56ed4e: atacar quem está ao alcance, 0x56eff3) também segue no despachante
        if (u.suspended) { this.stop(u); return; }
        if (!u.exeTask && this.idleTask(u) && this.thinkNow && r.ai.task !== 0xb) r.ai.task = 0xb;
        if ((r.ai.task === 0xb && this.idleTask(u)) || r.ai.task === 6) { this.machine(u); return; }
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
        // pelo porte (`exeTask`) a tarefa de andar é a do exe (0x56d032, 0x573198): o motor antigo não reescreve IA+8/IA+0xa. Com IA+8
        // largada pelo pensamento e a classe +0x50 ainda 1 (`applyTaskOrder`), parado como a ordem "none" (medido: herói da
        // m10_start_s16, T=44–50: IA+8 = 0 até o pensamento, sem voltar a andar)
        if (u.exeTask) {
          // [est] destino fora da área útil (a fuga de 0x5728fa para IA+0x9c = 0): no exe, lixo de pilha no backtrace 0x54e886; como no
          // `walkTo`, a célula limitada à área útil (medido: m20_mage_s404, 24639, T=288: o original anda para oeste)
          if (r.ai.task === 1 && !this.exeExact) {
            const x = r.ai.f0a & 0xff, y = (r.ai.f0a >> 8) & 0xff;
            const cx = Math.max(MAP_BORDER, Math.min(this.grid.w - MAP_BORDER - 1, x)), cy = Math.max(MAP_BORDER, Math.min(this.grid.h - MAP_BORDER - 1, y));
            if (cx !== x || cy !== y) r.ai.f0a = ((cy & 0xff) << 8) | (cx & 0xff);
          }
          if (r.ai.task !== 1 && r.ai.task !== 6 && r.ai.task !== 0xb) this.stop(u);
          else if (!this.machineUB(u)) { u.order = { type: "none" }; this.stop(u); return; }
          // o despachante acabou a tarefa de andar (fim do caminho 0x56dc24 → Stand ground 0x56dba1, classe 0xc; medido: herói da
          // m10_start_s16, ordem para a célula ocupada em T=55): a ordem apresentada também
          if ((r.task & 0xff) !== 1 && r.ai.task !== 1) u.order = { type: "none" };
          return;
        }
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
        // fim do caminho com o ponto bloqueado (cauda de 0x56dca2: IA+2 ← ponto seguinte da lista) deixa IA+8 = 0: a patrulha só
        // volta a andar no pensamento seguinte (medido: m20_start, 24620, T=234 → 240). O ponto corrente é IA+2 (lista IA+0xb4)
        if (r.ai.task !== 1 && !this.thinkNow) { this.stop(u); return; }
        if (!r.ai.patrol.find(r.ai.f02 & 0xffff, null)) r.ai.f02 = ((o.ay & 0xff) << 8) | (o.ax & 0xff);   // ponto importado fora da lista
        if (!this.walkTo(u, r.ai.f02 & 0xff, r.ai.f02 >> 8, 0)) this.patrolAdvance(r);   // ponto inalcançável: segue para o outro
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
        // lado humano pelo porte, alvo que caiu morto: no exe a tarefa e a classe +0x50 ficam (o despachante 0x56dca2 é quem a larga; o
        // pensamento do grupo escolhe a seguinte) — a ordem apresentada também, sem a volta do motor antigo (`resumeOrNone`). Golden
        // `task|hero` (m10_mage_s14 800: o herói segue com classe 3 e o mesmo alvo) e `target|t75` (m10_mage_s603 512: o aliado da
        // guarda do script segue no alvo morto até o pensamento e só então volta ao posto)
        // (com uma ordem para retomar — a guarda/patrulha do motor antigo que pôs este ataque — ela volta como antes)
        if (o.type === "attack" && t && !t.targetable && u.exeTask && !this.isAiPlayerUnit(u) && !u.resume) return;
        if (o.type === "attack" && (!t || !t.targetable)) { this.resumeOrNone(u); this.stop(u); return; }
        // lado humano: a ordem nova espera o pensamento 1×/s (termina o passo em curso e fica parado até lá)
        if (!u.orderArmed) { this.stop(u); return; }
        // o alvo (de pé ou caído) só segue sendo alvo enquanto há guerra: a paz que chega no meio da luta (feras da missão 53 depois dos
        // necromantes; Igles ainda batendo no lagarto) solta o alvo em vez de reabrir a guerra no próximo golpe; só o clique forçado insiste
        if (o.type === "attack" && t && t.player !== u.player && !o.forced && !this.hostile(u.player, t.player) && !this.hostile(t.player, u.player)) { this.resumeOrNone(u); this.stop(u); return; }
        const spell = o.type === "cast" ? u.spells.find(s => s.id === o.spell) ?? u.procSpells.find(p => p.spell.id === o.spell)?.spell : undefined;
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
          else if (!this.exeExact || r.ai.task !== 8) { r.ai.task = 8; r.ai.f28 = t.rec.addr; r.ai.range = spell!.range & 0xff; r.ai.f30 = this.spellAddr(spell!); }
          this.machine(u);
          // lado humano pelo porte: a magia começou (0x56e906 com +0x60 = 0 → 0x56dbc6, Stand ground: classe 0xd → 0xc, posto = a
          // célula) — a ordem apresentada acaba no mesmo tique, como a de andar (medido: herói da m10_mage, T=241→242)
          if (o.type === "cast" && u.exeTask && !this.isAiPlayerUnit(u) && (r.task & 0xff) !== 0xd && (r.ai.sub as number) === 2) { u.order = { type: "none" }; return; }
          // a perseguição acabou sem alcançar o alvo (fim de caminho, 0x56ed4e: a tarefa virou 0, 0xb ou 6). Ataque de jogador de IA:
          // a ordem antiga acaba (o pensamento do exe decide a seguinte) e o alvo fica fora da escolha da IA por uns segundos
          // (Unit.unreachTarget); lado humano e magias: a ordem fica e a tarefa volta a 5/8 no tique seguinte (no exe, no pensamento)
          const sub: number = r.ai.sub;
          if (o.type === "attack" && r.ai.task !== 5 && sub !== 1 && sub !== 2 && this.isAiPlayerUnit(u)) { u.unreachTarget = t.id; u.unreachTick = this.tick; this.resumeOrNone(u); }
          return;
        }
        // magia no chão (tarefa 9 do exe, 0x56ec3f: exec 0 no corpus, sem porta): anda até o alcance e, ao alcance e de frente, começa
        // a sub-ação 2 na célula (o que 0x56e906 faria: IA+9 = 2, ação 0xe, +0x60 = célula, +0x64 = magia); a máquina portada faz o resto
        const tx = o.type === "cast" ? o.x ?? u.cx : u.cx, ty = o.type === "cast" ? o.y ?? u.cy : u.cy;
        const range = spell!.range;
        if (this.inRange(u, tx, ty, range)) {
          if (this.turning(u, tx, ty)) { this.stop(u); return; }
          r.ai.task = 0;
          r.ai.sub = 2; r.ai.f15 = 0; r.act = 0xe; r.ai.f5c = 0; r.f5c = 0; r.f60 = (((ty & 0xff) << 8) | (tx & 0xff)) >>> 0;
          r.f64 = this.spellAddr(spell!); r.ready = 0; u.castAuto = false;
          this.machine(u);
          return;
        }
        const near = range <= 1 ? 1 : Math.max(1, Math.floor(range * 0.7));
        if (!this.walkTo(u, tx, ty, near)) { if (!u.isHero) this.command(u, { type: "none" }); this.stop(u); }
        return;
      }
    }
    } finally {
      // a máquina de ação do exe (0x50f12c) roda uma vez por tique para toda unidade, com a tarefa que a ordem deixou (0 = parada)
      if (!machineRan) this.machine(u);
    }
  }

  /** Apresentação do começo da magia `spell` (a mana já saiu em Spell_SpendMana 0x519998). `auto` = decidida pela IA/autocast (a
   *  ordem do jogador continua). */
  beginCast(u: Unit, spell: SpellDef, t: Unit | undefined, tx: number, ty: number, auto: boolean): void {
    u.castSpell = spell;
    u.castAuto = auto;
    u.target = t ? t.id : 0;
    u.castX = tx; u.castY = ty;
    // o rumo é do registro (andar+0, o giro do exe antes da sub-ação): o pacote da magia ao cliente (0x5041d6) não vira a unidade
    // (medido: herói da m10_mage com o cajado, T=854→855: rumo 64 mantido ao lançar no alvo a leste-nordeste)
    this.setState(u, "cast");
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
    this.syncCombat(u);
    this.events.push({ type: "effect", unit: u.id, spell: String(SPELL.Invisibility), kind: "invisible", on: false });
  }

  private inRange(u: Unit, tx: number, ty: number, range: number): boolean {
    if (range <= 1) return Math.max(Math.abs(tx - u.cx), Math.abs(ty - u.cy)) <= 1;
    return Math.hypot(tx - u.cx, ty - u.cy) <= range + 0.5;
  }

  /** Parada: a tarefa do exe fica 0 (o despachante não faz nada e deixa a ação 0), como o pensamento ao largar a ordem. */
  private stop(u: Unit): void {
    if (u.state === "move") this.setState(u, "idle");
    u.rec.ai.task = 0;
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
      // as classes com alvo (3: IA+0xc, 8: IA+0x10) só com o ponteiro escrito: o despachante portado (0x569321) o lê quando a unidade
      // volta ao pensamento do exe [est: a classe do motor antigo é só para o ramo do fim de caminho de 0x56dca2]
      case "attack": { const t = this.get(u.order.target); if (!t) break; u.rec.ai.f0c = t.rec.addr; return 3; }
      // a magia da tarefa 8/9 do exe (AI_CastAtTarget 0x56c72b, o autocast): o exe não muda a classe +0x50
      case "cast": { if (u.order.exe) return u.rec.task; const t = u.order.target ? this.get(u.order.target) : undefined; if (!t) break; u.rec.ai.f10 = t.rec.addr; return 8; }
    }
    return u.isHero ? 0xc : 0xb;
  }

  /** Adaptador da tarefa 9 do exe (0x56ec3f, exec 0 no corpus: só o ramo de andar; ver o cabeçalho deste arquivo). */
  private readonly exeHooks: MachineHooks = {
    task: r => {
      switch (r.ai.task) {
        case 9: unitWalkNear(this.exeWorld, r, r.ai.f3c & 0xffff, r.ai.range & 0xff); r.act = 1; return true;   // ramo de andar de 0x56ec3f
      }
      return false;
    },
    // laço dos efeitos (+0x20) no começo da máquina: os `buffs` expiram aqui
    effectsTick: r => { const u = this.unitByAddr(r.addr); if (u && u.buffs.length) this.expireBuffs(u); },
    // 0x516b2f/0x519998: a invisibilidade dos `buffs` (script) acaba no golpe/na magia (a da lista +0x20 é a porta)
    effectExpire: (r, type) => { const u = this.unitByAddr(r.addr); if (u && type === 0xc) this.breakInvisibility(u); },
    // 0x519998/0x519d7f portados (exe/spells.ts): o pacote ao cliente começa a apresentação; Spell_Apply e o Prismatic Spray ainda
    // são o motor antigo
    clientCast: (sp, r, t, x, y) => this.hookCastStart(sp, r, t, x, y),
    noMana: (_sp, r) => { const u = this.unitByAddr(r.addr); if (u?.isHero && this.tick - u.noManaTick >= TICKS_PER_SEC * 2) { u.noManaTick = this.tick; this.events.push({ type: "message", text: "Not enough mana" }); } },
    // Spell_Apply 0x519db8 portado (exe/spells.ts) na cura e no dano preso ao alvo; os outros `case` ainda são o motor antigo
    spellApply: (sp, r, t, x, y) => this.hookRelease(sp, r, t, x, y),
    spellPrismatic: (sp, r, t, x, y) => { this.hookCastStart(sp, r, t, x, y); this.hookRelease(sp, r, t, x, y); },
    xpOnCast: (r, _t, id) => this.hookXpOnCast(r, id),
    revive: r => { const u = this.unitByAddr(r.addr); if (u && !u.alive) this.revive(u, u.hp); },
    clientHeal: (t, amount) => { const u = this.unitByAddr(t.addr); if (u) this.events.push({ type: "heal", unit: u.id, amount }); },
    clientSpellHit: (a, t, dmg, id) => this.hookSpellHit(a, t, dmg, id),
    clientMissile: (sp, r, t, ticks) => this.hookMissile(sp, r, t, ticks),
    clientArea: o => this.hookArea(o),
    clientHit: (a, t, dmg) => this.hookHit(a, t, dmg),
    xpOnHit: (a, t, dmg, p3) => this.hookXp(a, t, dmg, p3),
    fell: r => this.hookFell(r),
    actionDone: r => this.hookDone(r),
    thinkAfterDispatch: r => this.hookStrikeBorn(r),
    // Unit_Die 0x510a70: mochila, loja, saco, efeitos e equipamento vivem no motor antigo
    packDrop: r => { const u = this.unitByAddr(r.addr); if (u) { u.gold = 0; u.items = []; } },
    lootItem: (r, min, max) => {
      const u = this.unitByAddr(r.addr);
      if (!u || !this.itemPool?.length) return;
      // Shop_Init/Shop_Gen (0x5254e7/0x525f67): a loja dos itens de preço em [min, max] (máscara [est]); 1 sorteado (0x510ddf), marcado +0x42 = 1
      const pool = this.itemPool.filter(([, price]) => price >= min && price <= max);
      if (pool.length) u.items.push(pool[this.rng.exe(pool.length - 1, 0x510ddf)]![0]);
    },
    // 0x53de20: itens da mochila; o ouro que a unidade carrega no motor antigo (`gold`) também a faz não vazia [est: no exe o dinheiro
    // carregado vive na mochila], senão o saco só caía quando o sorteio do modelo dava ouro
    packCount: r => { const u = this.unitByAddr(r.addr); return u ? u.items.length + (u.gold > 0 ? 1 : 0) : 0; },
    sackDrop: (r, gold) => {
      const u = this.unitByAddr(r.addr);
      if (!u) return;
      // Sack_Create 0x52acf6 (o saco se junta ao da célula, 0x52ab07): o herói morto não deixa saco no motor antigo [est]
      if (!u.isHero) { this.addLoot(u.cx, u.cy, u.gold + gold, [...u.items]); this.events.push({ type: "loot", x: u.cx, y: u.cy, gold: u.gold + gold }); }
      u.gold = 0; u.items = [];
    },
    effectsOnDie: r => { const u = this.unitByAddr(r.addr); if (u) u.buffs = []; },
    // vtable+0x58 (0x51366b, portado e provado em exe/effects.ts): no mundo os atributos ainda são do motor antigo (`syncCombat`, que soma
    // os efeitos da lista +0x20 em `buffSum`)
    recompute: r => { const u = this.unitByAddr(r.addr); if (u) this.syncCombat(u); },
    clientEffect: (r, id, type, v, on) => {
      const u = this.unitByAddr(r.addr);
      if (!u) return;
      this.events.push({ type: "effect", unit: u.id, spell: String(id), kind: FX_KIND_BY_ID[id] ?? FX_KIND[type] ?? "absorption", on });
      if (on && id === SPELL.Shield) this.events.push({ type: "buff", unit: u.id, spell: String(id), amount: v });
    },
    onDieHuman: () => { /* 0x512697: o equipamento já está na mochila do motor antigo */ },
    // Unit_Die de quem ainda estava de pé (desgaste das invocações em World_SecondTick): a queda da apresentação antes da morte consumada
    died: r => { const u = this.unitByAddr(r.addr); if (u) { if (u.alive) this.fall(u); this.consumeDeath(u); } },
  };

  /** Ponto seguinte da patrulha (adaptador do pensamento 0x569b62: a mesma volta pela lista IA+0xb4 que a cauda de 0x56dca2 faz —
   *  Find do ponto corrente, o seguinte, ou a cabeça no fim). */
  private patrolAdvance(r: UnitRec): void {
    const pos: ListPos = { p: r.ai.patrol.find(r.ai.f02 & 0xffff, null) };
    if (pos.p === null) { if (r.ai.patrol.head) r.ai.f02 = r.ai.patrol.getHead(); return; }
    CListWord.getNext(pos);
    r.ai.f02 = pos.p === null ? r.ai.patrol.getHead() : CListWord.getNext(pos);
  }

  /** Um tique da máquina de ação portada (0x50f12c: efeitos, queda/morte, despachante 0x56dca2, golpe/magia) para a unidade e a
   *  sincronização do motor: `grid.occ` (célula do chão), estado de animação (ação 1 andar/girar, 3 golpe, 0xd/0xe magia), chegada ao
   *  centro (saque automático). Campos que o motor antigo ainda calcula (velocidade com Haste/Slow, mana, dono, classe da tarefa) entram
   *  no registro antes, salvo no tique importado do oráculo (`exeExact`). */
  private machine(u: Unit): void {
    machineRan = true;
    const r = u.rec, cx0 = u.cx, cy0 = u.cy;
    const f0 = (r.mapObj.x << 24) | (r.mapObj.y << 16) | (r.mapObj.fx << 8) | r.mapObj.fy;
    if (!this.exeExact) {
      r.speed = Math.round(this.speedOf(u) * 16);
      r.walk.turnRate = (u.stats.turnSpeed ?? Math.round(u.stats.speed * 16)) & 0xff;
      r.attackRange = this.attackRange(u) & 0xff;   // +0x12c (AI_AttackRange 0x56ac5b sem magia escolhida no registro)
      if (!u.exeTask) r.task = this.taskClass(u);   // pelo porte, a classe +0x50 vem dos tratadores das ordens (exe/orders.ts)
    }
    EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
    // [est: estado importado sem o despejo do exe — janelas do golden] a magia em curso (+0x64) não vem no estado exportado: a do motor
    // antigo (no exe +0x64 nunca é 0 com a ação 0xd/0xe)
    if ((r.act === 0xd || r.act === 0xe) && (r.f64 >>> 0) === 0 && u.castSpell) r.f64 = this.spellAddr(u.castSpell);
    try {
      unitActionMachine(this.exeWorld, r, this.exeHooks);
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
    // estado de animação pela ação do exe: 1 andar/girar (o giro do olhar em volta, tarefa 0xb, fica no estado ocioso: a IA antiga
    // decide sobre "idle"), 3 golpe, 0xd/0xe magia; o alvo do golpe/da magia (+0x5c) para a apresentação
    if (!u.alive) { /* caída/morta: o estado dying/dead é da apresentação (ganchos fell/die) */ }
    else if (r.act === 1 && r.ai.task !== 0xb) { this.setState(u, "move"); if (moved) u.walkTime++; }
    else if (r.act === 3) { if (u.state !== "attack") this.setState(u, "attack"); u.target = this.unitByAddr(r.f5c)?.id ?? 0; }
    else if (r.act === 0xd || r.act === 0xe) { if (u.state !== "cast") this.setState(u, "cast"); if (r.act === 0xd) u.target = this.unitByAddr(r.f5c)?.id ?? 0; }
    else if (u.state === "move" || u.state === "attack" || u.state === "cast") this.setState(u, "idle");
    if (moved && mapObjSubCellCenter(r.mapObj) !== 0) { this.autoPickup(u); u.arriveTick = this.tick; }
  }

  // ------------------------------------------------------------------------------- ganchos da máquina de ação (magia, HUD, pensamento)

  /** magias que a máquina portada referencia por endereço (+0x64 = IA+0x30 do exe): as nossas ganham um endereço sintético determinístico
   *  por (id, poder, mana) — estável entre save/restore e entre corridas (a definição é função deles: `buildSpell`); o mapa é rascunho
   *  do módulo (não é estado do mundo) */
  private spellAddr(s: SpellDef): number {
    let h = 0x811c9dc5 | 0;
    const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193) | 0; };
    for (let i = 0; i < s.id.length; i++) mix(s.id.charCodeAt(i));
    mix(Math.round(s.power ?? 0)); mix(Math.round(s.mana));
    const a = (0x70000000 + (h & 0x0fffffff)) >>> 0;
    SPELL_BY_ADDR.set(a, s);
    return a;
  }
  /** a magia do endereço `addr`; estado importado (endereço do original): a da ordem de lançar ou a em curso */
  private spellFor(u: Unit, addr: number): SpellDef | undefined {
    const s = SPELL_BY_ADDR.get(addr >>> 0);
    // o mapa é do módulo (vários mundos no mesmo processo, objetos refeitos pelo restore): a definição igual da própria unidade
    if (s) return [...u.spells, u.castSpell, u.weaponSpell, ...u.procSpells.map(p => p.spell)]
      .find(x => !!x && x.id === s.id && Math.round(x.power ?? 0) === Math.round(s.power ?? 0) && Math.round(x.mana) === Math.round(s.mana)) ?? s;
    const o = u.order;
    return (o.type === "cast" ? u.spells.find(x => x.id === o.spell) : undefined) ?? u.castSpell ?? undefined;
  }
  /** a magia (do livro, de chance ou da arma) no lugar do golpe: a sub-ação 1 recém-nascida vira 2 (o que 0x56e906 faria no exe). */
  private asCast(u: Unit, spell: SpellDef, t: Unit | undefined, x: number, y: number): void {
    const r = u.rec;
    r.ai.sub = 2; r.ai.f15 = 0; r.act = t ? 0xd : 0xe; r.ai.f5c = t ? 1 : 0; r.f5c = t ? t.rec.addr : 0;
    r.f60 = (((y & 0xff) << 8) | (x & 0xff)) >>> 0; r.f64 = this.spellAddr(spell); r.ready = 0;
    u.castAuto = true;
  }
  /** Magia decidida pela IA/autocast fora de uma ordem (apoio aos aliados, Heal/Shield): começa a sub-ação 2 do exe como 0x56e906
   *  faria (IA+9 = 2, ação 0xd/0xe, +0x5c/+0x60/+0x64); a máquina gasta a mana no mesmo tique e lança depois da carga; a ordem fica. */
  castNow(u: Unit, spell: SpellDef, t: Unit | undefined, x = t?.cx ?? u.cx, y = t?.cy ?? u.cy): void {
    this.asCast(u, spell, t, x, y);
  }
  /** Adaptador do pensamento (0x56b059 magia escolhida no livro, 0x56acc8 magia de chance; a magia da arma): logo depois do
   *  despachante, no tique em que a sub-ação 1 nasce (IA+0x15 = 0, ação 3, fase 0), decide lançar no lugar do golpe. */
  private hookStrikeBorn(r: UnitRec): void {
    if (!(r.ai.sub === 1 && r.ai.f15 === 0 && r.act === 3 && r.f58 === 0)) return;
    const u = this.unitByAddr(r.addr), t = this.unitByAddr(r.f5c);
    if (!u || !t) return;
    // magia de chance: no exe é o pensamento (AI_Task_Attack 0x56acc8, sorteio 0x56ad33 → 0x56a981, tarefa 8/9) — portado para as
    // unidades que o pensamento comanda (`exeTask`); as dos modos do motor antigo (`legacyMode`) ainda sorteiam no golpe
    const proc = t.active && !u.exeTask ? this.rollProc(u, t) : null;
    if (proc) { this.asCast(u, proc, t, t.cx, t.cy); return; }
    u.castSpell = null;
    this.breakInvisibility(u);
    this.events.push({ type: "attack", unit: u.id, target: t.id });
  }
  /** Pacote da magia ao cliente (0x5041d6/0x5042ba, no fim de Spell_SpendMana 0x519998 portado): a apresentação começa a magia
   *  (estado "cast", eventos, invisibilidade quebrada pelo motor antigo); a mana e +0x138 já são do registro. */
  private hookCastStart(sp: number, r: UnitRec, tr: UnitRec | null, x: number, y: number): void {
    const u = this.unitByAddr(r.addr);
    if (!u) return;
    const spell = this.spellFor(u, sp), t = tr ? this.unitByAddr(tr.addr) : undefined;
    if (!spell) return;
    this.beginCast(u, spell, t, t ? t.cx : x, t ? t.cy : y, u.castAuto);
  }
  /** 0x519db8 Spell_Apply (motor antigo; Spell_Release 0x519d7f e o golpe da arma 0x516ceb portados a chamam): a magia sai. */
  private hookRelease(sp: number, r: UnitRec, tr: UnitRec | null, x: number, y: number): void {
    const u = this.unitByAddr(r.addr);
    if (!u) return;
    const spell = this.spellFor(u, sp) ?? u.castSpell, t = tr ? this.unitByAddr(tr.addr) : undefined;
    if (!spell) return;
    this.releaseSpell(u, spell, t, t ? t.cx : x, t ? t.cy : y);
  }
  /** 0x504b1d ('s' ao cliente) depois do golpe de `a` em `t` (a vida já caiu na porta): evento de HUD, flecha só de desenho, alerta. */
  private hookHit(ar: UnitRec, tr: UnitRec, dmg: number): void {
    const a = this.unitByAddr(ar.addr), t = this.unitByAddr(tr.addr);
    if (!a || !t) return;
    if (a.stats.range > 1) this.launch(a, t, null, a.typeId === 70 ? "sonic" : a.stats.attackSkill === "fire" ? "fire" : "arrow", true);
    if (dmg <= 0) { this.events.push({ type: "miss", unit: a.id, target: t.id }); return; }
    t.lastHurtTick = this.tick;
    t.lastAttacker = a.id;
    this.events.push({ type: "hit", unit: a.id, target: t.id, amount: dmg, element: undefined });
    if (t.hp <= 0) t.felledBy = a.id;
    else if (a.player !== t.player && t.alive) this.alertGroup(t, a);
  }
  /** 0x513128 Unit_XPOnHit (motor antigo): experiência do herói pelo golpe ou pela magia `id` (`gainExp` na escola dela); `dmg` já saiu
   *  da vida. */
  private hookXp(ar: UnitRec, tr: UnitRec, dmg: number, id = 0): void {
    const a = this.unitByAddr(ar.addr), t = this.unitByAddr(tr.addr);
    if (!a || !t || !a.heroInfo) return;
    const hpBefore = t.hp + dmg;
    if (t.alive && !t.stats.noXp && !t.dynamic && t.player !== a.player && !t.isHero) {
      const skill = id ? String(this.spellTable?.[String(id)]?.school ?? "").toLowerCase() : a.heroInfo.mage ? "" : (a.stats.attackType ?? "");
      if (skill) this.gainExp(a, skill, Math.floor(t.stats.exp * 0.5 * Math.min(dmg, Math.max(0, hpBefore)) / t.maxHp + 1), t.typeId);
    }
  }
  /** 0x5131ef (vtable+0x70 dos humanos, motor antigo [est]): a experiência de apoio da magia lançada (`supportExp`, só nas defensivas). */
  private hookXpOnCast(r: UnitRec, id: number): void {
    const u = this.unitByAddr(r.addr);
    const s = u ? [...u.spells, u.castSpell, u.weaponSpell].find(x => !!x && Number(x.base ?? x.id) === id) : undefined;
    if (u && s && s.defensive) this.supportExp(u, s);
  }
  /** 0x504b1d 's' ao cliente depois do dano da magia (0x51e65b portado; a vida já caiu): evento de HUD, agressor, alerta do grupo. */
  private hookSpellHit(ar: UnitRec | null, tr: UnitRec, dmg: number, id: number): void {
    const a = ar ? this.unitByAddr(ar.addr) : undefined, t = this.unitByAddr(tr.addr);
    if (!t) return;
    t.lastHurtTick = this.tick;
    if (a) t.lastAttacker = a.id;
    const element = String(this.spellTable?.[String(id)]?.school ?? "").toLowerCase() || undefined;
    this.events.push({ type: "hit", unit: a?.id ?? 0, target: t.id, amount: dmg, element });
    if (t.hp <= 0) { if (a) t.felledBy = a.id; }
    else if (a && a.player !== t.player && t.alive) this.alertGroup(t, a);
  }
  /** o projétil da magia portada (0x518d1e na lista do mundo): só o desenho, com o voo do exe (`ticks` de 16/s). */
  /** 0x5045a5 (a área ao cliente): a apresentação da SpellArea do exe `o` (`world.areas` com `exe`) são as células do quadrado do raio em
   *  que a vaga dela no registro de ocupação é ela (lidas sem mexer no registro corrente); sem células, some. */
  private hookArea(o: SpellObjRec): void {
    const m = this.exe, r = o.f4d & 0xff, cx = o.mapObj.x & 0xff, cy = o.mapObj.y & 0xff, tmp = new OccRec();
    const slot = ({ 3: 0, 6: 2, 0xe: 5, 0xf: 4, 0x11: 3 } as Record<number, number>)[o.fc & 0xffff] ?? 0;   // 0x518ba3
    const cells: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy, c = ((y & 0xff) << 8) | (x & 0xff);
      if (!this.grid.inside(x, y) || (m.mem[c + 0x10000]! & 0x20) === 0 || !m.occ.lookup(c, tmp)) continue;
      if ((tmp.u32(0x14 + slot * 4) >>> 0) === (o.addr >>> 0)) cells.push(this.grid.idx(x, y));
    }
    const i = this.areas.findIndex(a => a.exe === (o.addr >>> 0));
    if (!cells.length) {
      if (i < 0) return;
      const a = this.areas[i]!;
      this.areas.splice(i, 1);
      this.events.push({ type: "area", id: a.id, spell: a.spell, x: a.x, y: a.y, radius: a.radius, on: false });
      return;
    }
    if (i >= 0) { this.areas[i]!.cells = cells; return; }
    const src = o.f3c ? this.unitByAddr(o.f3c) : undefined, never = Number.MAX_SAFE_INTEGER;
    const a: SpellArea = {
      id: this.nextId++, spell: String(o.fc & 0xffff), kind: "field", owner: src?.id ?? 0, player: src?.player ?? 0, x: cx, y: cy, radius: r,
      until: never, next: never, period: 0, min: 0, max: 0, element: "", effects: [], cells, exe: o.addr >>> 0,
    };
    this.areas.push(a);
    this.events.push({ type: "area", id: a.id, spell: a.spell, x: cx, y: cy, radius: r, on: true });
  }

  private hookMissile(sp: number, r: UnitRec, tr: UnitRec | null, ticks: number): void {
    const u = this.unitByAddr(r.addr), t = tr ? this.unitByAddr(tr.addr) : undefined;
    if (!u || !t) return;
    const s = this.spellFor(u, sp);
    if (!s || t === u) return;
    this.launch(u, t, { ...s, flightTime: Math.max(1, ticks) / SERVER_TICKS_PER_SEC }, s.element, true);
  }
  /** queda (Server_Event 0x4001): a apresentação da queda. */
  private hookFell(r: UnitRec): void {
    const u = this.unitByAddr(r.addr);
    if (u) this.fall(u, u.felledBy ? this.get(u.felledBy) : undefined);
  }
  /** fim da espera (+0x136 = 1): fecha a ordem de magia do motor antigo (a IA relança a magia escolhida; a ordem do jogador acaba). */
  private hookDone(r: UnitRec): void {
    const u = this.unitByAddr(r.addr);
    if (!u) return;
    const wasCast = r.act === 0xd || r.act === 0xe;
    const auto = u.castAuto, finished = u.castSpell, finishedTarget = u.target;
    u.cooldown = 0;
    u.castAuto = false;
    // a sub-tarefa de ataque da IA relança a magia escolhida no mesmo alvo assim que a espera acaba (sonda c1/c2); a ordem do jogador
    // só se cumpre se for a desta magia (a IA pode ter dado outra durante o lançamento: fuga, outro alvo, outra magia)
    if (wasCast && !auto && u.order.type === "cast" && u.order.spell === finished?.id && (u.order.target ?? 0) === finishedTarget) {
      const o = u.order, sdef = u.spells.find(x => x.id === o.spell);
      if (!(this.isAiPlayerUnit(u) && o.target && o.target !== u.id && sdef && isOffensive(sdef) && sdef.kind !== "summon")) this.command(u, { type: "none" });
    }
  }
  private readonly notPortedSeen = new Set<string>();

  /** Ordem de andar até (tx,ty), parando a `near` células (adaptador fino, mesma assinatura para mission/, script/, HUD): tarefa do
   *  exe IA+8 = 1 até a célula IA+0xa (0x56dca2 → Unit_WalkNear 0x56e4ac, perto 0); com `near` > 0, o ramo de andar da tarefa 9
   *  (0x56ec3f: Unit_WalkNear até IA+0x3c parando a IA+0x14). Devolve false quando desiste: 20 tiques no fim do caminho estático
   *  (andar+0x90) sem chegar a `near` (alvo inalcançável). */
  /** A máquina de ação; false no caso indefinido do exe (lixo de pilha no backtrace 0x54e886) [est]: o alvo alternativo caiu fora da
   *  borda — ex.: a fuga de 0x5728fa para IA+0x9c = 0 de quem nunca foi golpeado. Tratado como destino inalcançável. */
  private machineUB(u: Unit): boolean {
    try { this.machine(u); }
    catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith(BACKTRACE_UB)) throw e;
      u.rec.ai.sub = 0; u.waitTicks = 0;
      return false;
    }
    return true;
  }
  walkTo(u: Unit, tx: number, ty: number, near: number): boolean {
    // destino limitado à área útil (o original anda até a 1ª célula fora da borda; ordens de andar na borda medidas na m10)
    tx = Math.max(MAP_BORDER, Math.min(this.grid.w - MAP_BORDER - 1, tx)); ty = Math.max(MAP_BORDER, Math.min(this.grid.h - MAP_BORDER - 1, ty));
    const r = u.rec, cell = ((ty & 0xff) << 8) | (tx & 0xff);
    if (near > 0) {
      if (!this.exeExact || r.ai.task !== 9) { r.ai.task = 9; r.ai.f3c = cell; r.ai.range = near & 0xff; }
    } else if (!this.exeExact || r.ai.task !== 1) { r.ai.task = 1; r.ai.f0a = cell; }
    if (!this.machineUB(u)) return false;
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
        // Teleport que falha — c1 — espera os 24–27 completos): a máquina 0x50f12c só soma o nível com +0x64 ≠ 0 — o salto o zera [est]
        if (u.cx !== fx || u.cy !== fy) u.rec.f64 = 0;
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
    this.syncCombat(who);
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
        else if (src && t && p.spell) this.resolveHit(src, t, p.spell);
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

  /** Summon [exe 0x51a595]: Squirrel/Turtle/Foot_Animated do nível Astral÷25+1, sem duração (desgaste em World_SecondTick 0x52bbb7) — sim/necro.ts. */
  private summon(u: Unit, s: SpellDef, _x: number, _y: number): void { summonCreature(this, u, s); }

  /** Um golpe físico de `a` em `t` fora da máquina de ação (testes, console): o mesmo caminho da fase 5 da máquina (0x516c1f →
   *  0x516ceb → 0x516f6f) sobre os registros sincronizados, com os ganchos de HUD/experiência. */
  strike(a: Unit, t: Unit): void {
    this.syncCombat(a); this.syncCombat(t);
    EXE_GLOBALS.clock16 = this.absClock16();
    unitStrikeBegin(this.exeWorld, a.rec, t.rec, this.exeHooks);
    this.syncDiplomacyBack();
  }

  /** Resolve o dano de uma magia (projétil/explosão/jato) [exe]: sem teste de acerto nem absorção; dano = int(d × (100 − proteção da
   *  escola)/100 + 0,75); Drain Life devolve o dano. O golpe físico é inteiro da máquina de ação portada (0x516ceb → 0x516f6f). */
  resolveHit(a: Unit, t: Unit, spell: SpellDef): void {
    if (!t.targetable) return;
    // golpe em quem caiu só vale com guerra; e o golpe de uma ordem de ataque comum que chega depois da paz (feras da 53, no meio do
    // golpe) não reabre a guerra: só o ataque forçado (Ctrl+clique), a magia e a área insistem
    if (a.player !== t.player && !this.hostile(a.player, t.player) && !this.hostile(t.player, a.player)
      && !(a.order.type === "attack" && a.order.forced) && (!t.active || (!spell && !this.splash && a.order.type === "attack"))) return;
    if (spell.max <= 0 && spell.kind !== "drain") return;
    // Spell_Release/Spell_Apply → vtable +0x54 (0x516f6f) com a struct da magia: sem dano físico, dano B = min + rand(max − min) contra a
    // proteção do elemento (sorteios 0x5170f8 e 0x5172b7); marca o agressor na vítima e chama 0x56e6b8 (IA+0x54, evento, diplomacia)
    const info = new DmgRec();
    info.elB0 = spell.min & 0xff; info.elB1 = Math.max(0, spell.max - spell.min) & 0xff; info.elK = ELEMENT_INDEX[spell.element] ?? 0;
    this.syncCombat(a); this.syncCombat(t);
    EXE_GLOBALS.clock16 = this.absClock16();
    const dmg = unitPhysicalDamage(this.exeWorld, t.rec, info, a.rec, this.exeHooks);
    this.syncDiplomacyBack();
    if (dmg <= 0) { this.events.push({ type: "miss", unit: a.id, target: t.id }); this.provoke(a, t); return; }
    // unidade invocada/levantada (+0x1a0) não dá experiência [exe 0x512900]
    if (a.heroInfo && t.alive && !t.stats.noXp && !t.dynamic && t.player !== a.player && !t.isHero) {   // golpe em quem já caiu não dá experiência
      const skill = spell.element;
      if (skill) this.gainExp(a, skill, Math.floor(t.stats.exp * 0.5 * Math.min(dmg, Math.max(0, t.hp)) / t.maxHp + 1), t.typeId);
    }
    const dealt = Math.min(dmg, Math.max(0, t.hp));
    this.damage(a, t, dmg, spell.element);
    if (spell.kind === "drain" && a.active && dealt > 0) {
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
    // vida ≤ 0: a queda é decidida pela máquina de ação da própria unidade (0x50f12c, próximo tique dela) — gancho `fell`
    if (t.hp <= 0) { if (a) t.felledBy = a.id; }
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
   *  completo: queda (`fall`) → sangria (Unit_Regen) → `consumeDeath` (gancho `died` de Unit_Die). */
  kill(t: Unit, killer?: Unit): void {
    const r = t.rec;
    this.syncCombat(t);   // modelo/saque/dono no registro (Unit_Die lê +0x0e, +0x3c, +0x1a0, dono+0x38)
    if (!t.alive) {
      // inconsciente/sangrando: a morte decretada leva o corpo a −10 e a consuma (Unit_Die)
      if (!t.downed) return;
      t.corpseHp = Math.min(t.corpseHp, CORPSE.DEATH);
      if (killer) t.felledBy = killer.id;
      r.act = 0x10;
      EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
      unitDie(this.exeWorld, r, this.exeHooks);
      return;
    }
    t.hp = Math.min(t.hp, CORPSE.DEATH);
    // o que a máquina 0x50f12c faria na queda e no fim da animação: +0x13c = 1, defesa ÷ 2, tarefa/ação 0 e, consumada, Unit_Die
    r.f13c = 1; r.f6c = 0; r.fbe = (Math.trunc(((r.fbe << 16) >> 16) / 2) << 16) >> 16; r.task = 0; r.act = 0;
    this.fall(t, killer);
    r.act = 0x10;
    EXE_GLOBALS.w6044c4 = this.secClock() & 0xffff;
    unitDie(this.exeWorld, r, this.exeHooks);
  }

  /** Estado importado do original: unidade caída (vida ≤ 0, sem 0x10) com `cnt` tiques do contador da animação (+0x6c) por andar. */
  importFallen(t: Unit, cnt: number): void {
    const r = t.rec;
    r.f13c = 1; r.f6c = cnt & 0xff; r.task = 0; r.act = 0;
    t.silentFall = true;
    this.fall(t, undefined);
    t.silentFall = false;
    t.stateTime = Math.max(0, t.timing.dyingTicks - 1 - (cnt & 0xff));
  }

  /** Queda [exe 0x50f12c: vida ≤ 0 → +0x13c = 1, defesa ÷ 2, animação]: a unidade deita. Vida exatamente 0 = inconsciente estável; < 0 =
   *  sangrando (−1 a cada 4 s) até −10 (sim/necro.ts); no meio do caminho ainda é alvo de golpes e de Heal (que a levanta). Saque, abate e
   *  experiência só na morte consumada (`consumeDeath`). `onDeath` (herói/companheiro/VIP caído = falha da missão) vale já na queda: no
   *  original o herói com a vida zerada dá "Mission Failed" ~3 s depois (notes/original-capture.md, `run_defeat.py`). */
  private fall(t: Unit, killer?: Unit): void {
    if (!t.alive) return;
    onFell(t, t.hp);   // vida depois do golpe (≤ 0, sem limite) = vida do corpo (+0x94 segue negativa, como no exe)
    t.felledBy = killer?.id ?? 0;
    // a unidade caída continua nas células do exe até a morte consumada (0x510a70 → 0x553891); o passo em curso fica onde está
    t.order = { type: "none" };
    this.setState(t, "dying");
    if (t.silentFall) return;   // "vida 0" do script (knockOut): sem evento nem falha de missão
    this.events.push({ type: "fall", unit: t.id, killer: killer?.id ?? 0 });
    this.onDeath?.(t, killer);
  }

  /** Morte consumada [exe 0x50f12c → 0x510a70]: fim da animação de queda E vida do corpo ≤ −10. Abate (experiência cai com 10/(n+10)),
   *  evento `death` (hall da fama) e saque; o corpo passa a se decompor (`onConsumed`). */
  consumeDeath(t: Unit): void {
    if (t.alive || t.bodyDead) return;
    // Unit_Die 0x510a70 já saiu das células do exe e voltou ao centro; aqui só a ocupação do motor antigo e o corpo
    const i = this.grid.idx(t.cx, t.cy);
    if (this.grid.occ[i] === t.id) this.grid.occ[i] = 0;
    t.bodyDead = true;
    this.exeWorld.lists.all.remove(t.rec.addr); this.exeWorld.lists.corpses.addTail(t.rec.addr);   // contentor [0x68d2dc] (0x52bbb7)
    const killer = t.felledBy ? this.get(t.felledBy) : undefined;
    if (t.silentFall) { t.silentFall = false; this.onDeath?.(t, killer); }   // caiu por "vida 0" do script (knockOut): as regras de falha só agora
    this.events.push({ type: "death", unit: t.id, killer: t.felledBy });
    if (killer?.isHero) this.killsByType.set(t.typeId, (this.killsByType.get(t.typeId) ?? 0) + 1);
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
    // os efeitos da lista +0x20 do exe (lote 5): a duração +0x42 (u16; ≥ 0x2581 não desconta em 0x51cc9f) [est]
    for (const a of u.rec.fx.values()) {
      const e = this.exeWorld.payloads.get(a >>> 0);
      if (e && ((e.fc << 16) >> 16) === spell && !(e.f3d & 0x80)) { e.f42 = Math.max(1, Math.min(0xffff, Math.round(duration))); found = true; }
    }
    return found;
  }

  /** "Tile Spell Duration" do script (missão 71: a parede some com duração 1 e é mantida com 30000): a área de `spell` na célula passa a durar
   *  `duration` tiques a partir de agora [est: a unidade do original não está decifrada; 1 = some já, valor alto = fica]. Devolve se achou a área. */
  setAreaDuration(x: number, y: number, spell: number, duration: number): boolean {
    const a = this.areaAt(x, y, spell);
    if (!a) return false;
    // a SpellArea do exe (lote 5): os tiques que faltam +0x50 (i16) [est]
    const o = a.exe !== undefined ? this.exeWorld.spellObjs.get(a.exe) : undefined;
    if (o) { o.f50 = (Math.max(0, Math.min(0x7fff, Math.round(duration))) << 16) >> 16; return true; }
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
