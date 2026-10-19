/** Tipos e constantes da simulação (sem PixiJS, sem DOM). Ver README.md desta pasta. */

/** Passo fixo da simulação. */
export const TICK_MS = 50;
export const TICKS_PER_SEC = 1000 / TICK_MS;

/** Atributos de combate de um tipo de unidade (contrato de `data/unit-stats.json`, docs/DATA.md). */
export interface UnitStats {
  name: string;
  health: number;
  mana: number;
  /** velocidade normalizada em células por segundo (ver stats.ts: `normalizeSpeed`) */
  speed: number;
  sight: number;
  attack: number;
  damage: { min: number; max: number };
  defense: number;
  absorption: number;
  /** alcance em células (1 = corpo a corpo) */
  range: number;
  attackSkill: string;
  resist: { fire: number; water: number; air: number; earth: number; astral: number };
  exp: number;
  /** voa (ignora terreno bloqueado) */
  flying?: boolean;
  source?: string;
  /** tiques do jogo original (25/s) até o golpe sair / de recuperação (data.bin; golpe em charge/12,5 s, ciclo em (charge+relax)/12,5 s) */
  charge?: number;
  relax?: number;
  /** PERÍODO de regeneração (data.bin; maior = mais lenta) [exe 0x50fc5a]: por chamada, vida += 2 × vidaMax × k / healthRegen
   *  (k = 3 descansando). Aplicado 1×/s (recomendação da frente DADOS). Heróis: 100 (vida) e 50 (mana). 0 = não regenera. */
  healthRegen?: number;
  manaRegen?: number;
  /** acerta sempre e ignora absorção (attackKind 3: morcegos, súcubos) [exe 0x516f6f] */
  alwaysHit?: boolean;
  /** resistência física por tipo de arma (%) */
  resistPhysical?: Record<string, number>;
  /** tipo de dano físico da arma (blade|axe|bludgeon|pike|shooting) */
  attackType?: string;
  /** tesouro: chance % e faixa de ouro */
  treasure?: { goldChance: number; goldMin: number; goldMax: number };
  /** não dá experiência (quest.noXp) */
  noXp?: boolean;
  /** atributo Mind (bônus de experiência do herói; IA: Mind > 59 alterna magia/arma) */
  mind?: number;
  /** magias conhecidas (ids de spells.json; bits de knownSpells do template) */
  spellIds?: number[];
  /** "Spell N / Probability N" do template: magia lançada no lugar do golpe com chance % [exe 0x56acc8] */
  procSpells?: [number, number][];
  /** "Spell Power" do template (poder das magias de `procSpells`) */
  procPower?: number;
  /** habilidade mágica por escola (monstros: magicSkills; humanos: skills) — poder das magias conhecidas */
  magicSkills?: Record<string, number>;
  /** "Withdraw" (vida absoluta: recua de inimigos a ≤ 2 células) e "Wimpy" (vida absoluta: foge) do template [exe 0x56cd11/0x56cb0c] */
  withdraw?: number;
  wimpy?: number;
  /** "See invisible" do template */
  seeInvisible?: number;
  /** nível do template (1..5) */
  level?: number;
}

/** Bits de diplomacia (bloco 5 do .alm): bit0 = guerra, bit1 = aliado, 0x10 = visão compartilhada. */
export const DIP_WAR = 1;
export const DIP_ALLY = 2;

/** Direções: 0 = S, 4 = O (oeste), 8 = N, 12 = L (leste), sentido S→O→N→L (como os sprites do jogo). */
export function dirFromDelta(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  // ângulo medido a partir do sul (0,1), girando para o oeste (-1,0)
  const a = Math.atan2(-dx, dy); // 0 = sul, +pi/2 = oeste
  let d = Math.round(a / (Math.PI / 8));
  d = ((d % 16) + 16) % 16;
  return d;
}

export interface Cell { x: number; y: number; }

/** Ordem dada a uma unidade (jogador ou IA). */
export type Order =
  | { type: "none" }
  | { type: "move"; x: number; y: number; attackMove?: boolean }
  | { type: "attack"; target: number; forced?: boolean }
  | { type: "cast"; spell: string; target?: number; x?: number; y?: number }
  | { type: "hold" }
  /** vigiar a posição (raio `range`, padrão MinimalGuardRange = 8): ataca quem entrar e volta ao posto [exe 0x56a5fc] */
  | { type: "guard"; x: number; y: number; range?: number }
  /** recuar: fugir dos inimigos próximos e parar longe deles */
  | { type: "retreat" }
  | { type: "defend"; unit: number; range: number }
  | { type: "follow"; unit: number; range: number }
  | { type: "patrol"; ax: number; ay: number; bx: number; by: number; toB: boolean }
  | { type: "roam"; cx: number; cy: number; range: number }
  | { type: "pickup"; x: number; y: number };

export type UnitState = "idle" | "move" | "attack" | "cast" | "dying" | "dead";

/** Eventos emitidos pela simulação para a apresentação (render, sons, HUD). Consumidos e esvaziados a cada quadro. */
export type SimEvent =
  | { type: "attack"; unit: number; target: number }
  | { type: "hit"; unit: number; target: number; amount: number; element?: string }
  | { type: "miss"; unit: number; target: number }
  | { type: "death"; unit: number; killer: number }
  | { type: "projectile"; id: number }
  | { type: "projectileHit"; id: number }
  | { type: "cast"; unit: number; spell: string }
  | { type: "heal"; unit: number; amount: number }
  | { type: "buff"; unit: number; spell: string; amount: number }
  | { type: "loot"; x: number; y: number; gold: number }
  | { type: "pickup"; unit: number; gold: number; item?: string; items?: string[] }
  | { type: "exp"; unit: number; amount: number }
  | { type: "levelup"; unit: number }
  | { type: "diplomacy"; a: number; b: number; value: number }
  | { type: "message"; text: string }
  /** magia lançada (complementa "cast" com alvo/ponto) */
  | { type: "spell"; unit: number; spell: string; target?: number; x?: number; y?: number; auto?: boolean }
  /** explosão/área instantânea (Fireball, Acid Stream, Prismatic Spray) em (x,y) com raio */
  | { type: "blast"; spell: string; x: number; y: number; radius: number; unit: number }
  /** área persistente criada/removida (Wall of Fire, Poison Cloud, Blizzard, Light, Darkness, Wall of Earth) — ver `world.areas` */
  | { type: "area"; id: number; spell: string; x: number; y: number; radius: number; on: boolean }
  /** efeito temporário aplicado/removido numa unidade (Bless, Haste, Slow, Curse, Stone Curse, Invisibility, proteções...) */
  | { type: "effect"; unit: number; spell: string; kind: string; on: boolean }
  | { type: "teleport"; unit: number; x: number; y: number; fromX: number; fromY: number }
  /** unidade mudou de dono (Control Spirit / fim do controle) */
  | { type: "owner"; unit: number; player: number }
  | { type: "summon"; unit: number; by: number }
  /** comportamento automático: fuga/recuo por vida baixa */
  | { type: "flee"; unit: number };
