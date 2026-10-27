/**
 * Registros espelhados do servidor do allods2.exe: cada campo leva o offset e o tamanho do original. Só existem os campos que
 * alguma função portada lê ou escreve (acrescente aqui, com offset/tamanho, quando uma porta nova precisar). Ponteiros do exe
 * viram referências a outro registro espelhado; vtables ficam como o endereço (despacho em `vtables.ts`).
 *
 * Lote piloto (sim/exe/path.ts): Unit_ApproachCell 0x557f08 e o seu fecho.
 * Lote 5a (sim/exe/walk.ts): objeto de mapa completo, registro de ocupação de célula, grade de flags, campos de unidade lidos pelos acessores.
 * Lote 5b (sim/exe/wave.ts): `MapRec` (o objeto de mapa/caminho inteiro, `this` das ondas), listas de caminho e sub-registros da unidade.
 * Lote 5c (sim/exe/walk_action.ts): o andar (`WalkRec` +0x00..+0xb1: giro, passo por tique, alvo), `WorldRec`, unidades por endereço.
 * Etapa 6 (sim/exe/action.ts): campos do despachante 0x56dca2 (unidade +0x50/+0x144, IA +0x14/+0x18, tipo +0x45, mundo +0xbbe8).
 * Etapa 7 (sim/exe/action.ts, rand.ts): olhar em volta (IA +0x54), o sorteio do mundo (mundo +0 divisor, `rng`); golpe/magia como
 * sub-ação (unidade +0x4c/+0x5c/+0x60/+0x64, IA +0x00/+0x30/+0x50/+0x5c/+0x60, a lista de eventos do mundo +0xbbec e o evento +0xbd98);
 * fim de caminho (0x56ed4e: listas do mundo +0x04/+0xa68/+0xa88, diplomacia +0xa8bc, dono +0x04, tipo +0x00, IA +0x71, patrulha IA+0xb4).
 */
import { CListEvent, CListPtr, CListWord, CMapShortOcc } from "./mfc";
import { Rng } from "../rng";

/** Objeto de mapa da unidade (alvo do ponteiro unidade+0x10). Coordenadas em células e fração (1/256 de célula). */
export class MapObjRec {
  x = 0;  // +0x00 u8  célula x            (0x54ffb0, 0x54ff5b)
  y = 0;  // +0x01 u8  célula y            (0x54ffc0, 0x54ff7c)
  cell = 0;  // +0x02 u16 índice da célula y*256+x (0x54ff9e Obj_CellOf; escrito por 0x54f9b9 / 0x54fc41)
  fx = 0; // +0x04 u8  fração x (0..255)   (0x54ff5b)
  fy = 0; // +0x05 u8  fração y (0..255)   (0x54ff7c)
  owner = 0; // +0x08 u32 3º argumento de 0x54f9b9 (ponteiro do dono; só guardado)
}

/** Registro de ocupação de célula (0x3c bytes; valor do CMap em this+0x54084 do mapa, copiado por 0x55385f). Só os campos lidos por 0x5513b6 têm nome. */
export class OccRec {
  static readonly SIZE = 0x3c;
  /** `b` pode ser uma vista dentro de outro registro (o registro corrente em MapRec+0x5402c). */
  constructor(readonly b: Uint8Array = new Uint8Array(OccRec.SIZE)) {}
  get u8_02(): number { return this.b[0x02]; }
  get u8_34(): number { return this.b[0x34]; }
  u32(off: number): number { return (this.b[off] | (this.b[off + 1] << 8) | (this.b[off + 2] << 16) | (this.b[off + 3] << 24)) | 0; }
}

/** Grade de flags por célula (mapa+0x20000, u8[0x10000], índice y*256+x): bit 0x40 marcado por 0x550de0 e lido por 0x550eae. */
export interface FlagGridRec {
  readonly flags: Uint8Array;
}
export const FLAGS_OFF = 0x20000;
/** Grade de bytes em mapa+0x0 (u8[0x10000], índice y*256+x): divisor lido por 0x55687d. */
export interface ByteGridRec {
  readonly bytes: Uint8Array;
}
/** Mapa+0x10000, u8[0x10000]: lido por 0x551edb/0x559bc9 (bit 0x20); só o deslocamento é portado no lote 5a. */
export const GRID10000_OFF = 0x10000;

/** Objeto-sessão com u32 em +0x18b0 (lido por 0x540360). */
export class SessionRec {
  f18b0 = 0; // +0x18b0 u32
}

/** Registro-base do tipo da unidade ([[unidade+0x70]+0x3c]). */
export class UnitStatsRec {
  f20 = 0;       // +0x20 u8  0x12 = ramo de alcance de ataque em 0x54d76e
  speedByte = 0; // +0x44 u8  se ≠ 0 vale como velocidade, senão usa unidade+0x8c (0x55915a)
  f45 = 0;       // +0x45 u8  0 (com mundo+0xbbe8 = 0 e IA+9 = 0) → ação 0x1b, grupo dormindo (0x56dca2)
}
/** Tipo da unidade (alvo do ponteiro unidade+0x70): começa por um CList<void*> das unidades que o partilham. */
export class UnitTypeRec {
  /** +0x00 CList<void*> (cabeçalho 0x1c) das unidades deste tipo: AI_EnemyFilter 0x567a16 as percorre para ver invisíveis
   *  [est: no motor, um registro por (dono, modelo)] */
  members = new CListPtr();
  stats: UnitStatsRec = new UnitStatsRec(); // +0x3c ptr
}

/** Sub-registro de andar (alvo do ponteiro unidade+0x1c0). Direções em 1/256 de volta (0x20 = 1/8). */
export class WalkRec {
  dir = 0;        // +0x00 u8  direção atual
  dirTarget = 0;  // +0x01 u8  direção desejada (0x556454, 0x555c7e)
  passMask = 0;   // +0x05 u8  máscara de passagem (AND com as grades +0x10000/+0x20000 do mapa)
  nextCell = 0;   // +0x06 u16 próxima célula (cabeça do caminho dinâmico; 0x555c7e)
  f09 = 0;        // +0x09 u8  contagem de refazer caminho (0xff = refazer já; 0x555411/0x55574d/0x56e4ac)
  turnRate = 0;   // +0x0a u8  passo de giro por tique (0x5551ef, 0x556454)
  f6c = 0;        // +0x6c u32 posto a 1 por 0x56e4ac
  stepFrom = 0;   // +0x70 u16 célula de onde o passo atual partiu (0x555c7e; lido por 0x56fc69 em outras unidades)
  f72 = 0;        // +0x72 u16 velocidade na célula atual (0x55687d; 0x55020a, 0x555b38)
  dest = 0;       // +0x74 u16 célula de destino da ordem (0x555411, 0x55574d)
  f76 = 0;        // +0x76 u16 célula-alvo do caminho dinâmico (0x555dc2)
  f78 = 0;        // +0x78 u8  tiques desde o último refazer do caminho dinâmico
  chaseTarget = 0; // +0x7c u32 unidade perseguida (endereço; 0x55574d)
  footCell = 0;   // +0x80 u16 célula onde a pegada da unidade está marcada (0x55be86; 0 = nenhuma)
  f82 = 0;        // +0x82 u8  célula x ao pôr nas células (0x55020a)
  f83 = 0;        // +0x83 u8  célula y
  f84 = 0;        // +0x84 u8  byte baixo do x fino
  f85 = 0;        // +0x85 u8  byte baixo do y fino
  f86 = 0;        // +0x86 u8  célula x ao tirar das células (0x55073f)
  f87 = 0;        // +0x87 u8  célula y
  f88 = 0;        // +0x88 u8  byte baixo do x fino
  f89 = 0;        // +0x89 u8  byte baixo do y fino
  f8a = 0;        // +0x8a u16 tamanho do caminho estático da perseguição (0x55574d)
  f8c = 0;        // +0x8c u16 célula do alvo perseguido quando o caminho foi feito (0x55574d)
  f90 = 0;        // +0x90 u32 1 = chegou ao fim do caminho estático (0x555411)
  f94 = 0;        // +0x94 u16 célula do alvo no último refazer dinâmico (0x55574d)
  f96 = 0;        // +0x96 u16 célula da unidade no último refazer dinâmico (0x55574d)
  f98 = 0;        // +0x98 u32 posto a 1 por 0x555dc2 quando o caminho dinâmico fica vazio
  f9c = 0;        // +0x9c u8  zerado ao começar um passo (0x555c7e)
  f9d = 0;        // +0x9d u8  tiques de giro contados (0x556454)
  turning = 0;    // +0xa0 u32 1 = girando (0x556454)
  turnTicks = 0;  // +0xa4 u8  tiques de giro previstos (0x556454)
  stepSpeed = 0;  // +0xa8 u16 velocidade do passo, 1..0x3f (0x559195)
  stepTicks = 0;  // +0xaa u16 tiques para atravessar a célula (0x559195)
  stepTick = 0;   // +0xac u16 tique corrente do passo (0x554fd2)
  stepDir = 0;    // +0xae u16 direção do passo, 0..7 (0x559195)
  stepDx = 0;     // +0xb0 i8  avanço x fino por tique (0x559195)
  stepDy = 0;     // +0xb1 i8  avanço y fino por tique
}

/** Sub-registro de tarefa/IA (alvo do ponteiro unidade+0x1c4). */
export class AiRec {
  f00 = 0;        // +0x00 u16 célula do posto do Stand ground (0x56d52b AI_StandGroundAt)
  f02 = 0;        // +0x02 u16 ponto corrente da patrulha (0x56dca2, tarefa +0x50 == 0xa)
  f04 = 0;        // +0x04 u32 posto a 1 no fim do caminho da patrulha (0x56dca2)
  task = 0;       // +0x08 u8  tipo de tarefa (5 = ramo de alcance em 0x54d76e); ação do despachante 0x56dca2 (1 andar, 10 girar)
  sub = 0;        // +0x09 u8  subestado do despachante (3 = continuar o passo: 0x555b38 por tique; posto por 0x56e4ac)
  f0a = 0;        // +0x0a u16 célula (lida por 0x56fc69 em outra unidade)
  f0c = 0;        // +0x0c u32 alvo do ataque (endereço; tarefa 5 0x56eab5 → 0x56ea52)
  f15 = 0;        // +0x15 u8  zerado por 0x56e4ac
  range = 0;      // +0x14 u8  alcance da perseguição (0x56ea52 → 0x55574d)
  f16 = 0;        // +0x16 i16
  target = 0;     // +0x18 u32 unidade perseguida pela tarefa 4 (endereço; 0x56ea52)
  f28 = 0;        // +0x28 u32 alvo da magia (endereço; tarefa 8 0x56ebc0 → 0x56ea52)
  f30 = 0;        // +0x30 u32 magia do livro escolhida (endereço do BookSpellRec; 0x569a80; copiada para unidade+0x64 por 0x56e906)
  f3c = 0;        // +0x3c u16 célula da magia no chão (tarefa 9 0x56ec3f → 0x56e4ac)
  f50 = 0;        // +0x50 u32 1 depois de 0x56dbc6 (parar + Stand ground); 0 por 0x56dbfb
  f54 = 0;        // +0x54 u32 1 = sofreu golpe/magia (0x56e6b8): a próxima olhada em volta gira sem o sorteio (0x56e5bc zera)
  f5c = 0;        // +0x5c u32 1 = a magia em curso mira uma unidade (0x56e906); 0 = célula (ação 0xe e evento 3 no despachante)
  f60 = 0;        // +0x60 u32 0 → 0x56e906 chama 0x56dbc6 (parar); zerado por 0x56d969
  f71 = 0;        // +0x71 u8  alcance de ver invisível (AI_EnemyFilter 0x567a16)
  spellSlot = 0;  // +0x78 u8  magia do livro escolhida (0 = nenhuma; 0x56ac5b)
  fb0 = 0;        // +0xb0 u16 destino do teleporte da célula (0x5503af, registro de ocupação de tipo 0x17)
  /** +0xb4 ptr CList<WORD> dos pontos da patrulha (y<<8 | x), na ordem do roteiro: 0x57b020 Find, 0x55f1f0 GetNext e 0x55f0d0
   *  GetHead no fim do caminho da patrulha (0x56dca2) */
  patrol = new CListWord();
}

/** Dono da unidade (alvo do ponteiro unidade+0x14). */
export class PlayerRec {
  f04 = 0;        // +0x04 i16 id do jogador (índice na tabela de diplomacia do mundo, 0x57994d)
  f2c = 0;        // +0x2c u32 0 → 0x54d76e testa Path_TargetFree (onda estática de 1000)
}

/** Magia do livro (elemento do CArray do livro). */
export class BookSpellRec {
  addr = 0;       // endereço no exe (identidade do ponteiro devolvido por 0x51c391)
  range = 0;      // +0x09 u8  alcance (0x56ac5b)
  cost = 0;       // +0x0c i16 custo de mana
}

/** Livro de magias (alvo do ponteiro unidade+0x140): CArray<BookSpellRec*> em +4 (m_pData +8, m_nSize +0xc). */
export class SpellBookRec {
  spells: (BookSpellRec | null)[] = []; // +0x04 CArray (ponteiro nulo = slot vazio)
  last = 0;       // +0x18 i32 último índice consultado (escrito por 0x51c391)
}

/** Unidade do servidor (0x1d0 bytes no registro de objs da sonda; as listas de caminho vão até +0x200). */
export class UnitRec {
  /** Endereço do registro no exe: identidade dos ponteiros de unidade guardados como u32 (OccRec +0x2c/+0x30, MapRec+0x54058). */
  addr = 0;
  vtbl = 0;                    // +0x000 u32 vtable (0x5d0eb0 / 0x5d0f40 / 0x5d0fb8)
  mapObj: MapObjRec = new MapObjRec(); // +0x010 ptr objeto de mapa
  owner: PlayerRec = new PlayerRec();  // +0x014 ptr dono
  f43 = 0;                     // +0x043 u8  lido por 0x5160ef
  size = 0;                    // +0x049 u8  lado em células (lido pelo slot 0x1c da vtable, 0x542360)
  kind = 0;                    // +0x04a u8  lido pelo slot 0x20 das vtables (0x542380); 1 = ramo "grade" de 0x55687d
  f4c = 0;                     // +0x04c u8  bits da unidade; bit 4 lido por 0x53a5a0 (tarefa 6, 0x56eff3)
  task = 0;                    // +0x050 u32 classe da tarefa (1 andar, 0xa patrulha, 0x18...: ramo do fim do caminho em 0x56dca2)
  act = 0;                     // +0x054 u32 ação corrente (1 = andar, 3 golpe, 0xd/0xe magia; 0x56e4ac, 0x56e8c3, 0x56e906)
  f5c = 0;                     // +0x05c u32 alvo do golpe/da magia em curso (endereço; 0x56e8c3 ← IA+0xc, 0x56e906 ← IA+0x28)
  f60 = 0;                     // +0x060 u32 célula da magia no chão (byte x, byte y; evento 3 do despachante)
  f64 = 0;                     // +0x064 u32 magia em curso (endereço do BookSpellRec; 0x56e906 ← IA+0x30)
  type: UnitTypeRec = new UnitTypeRec(); // +0x070 ptr tipo da unidade
  speed = 0;                   // +0x08c i16 velocidade da unidade (0x55915a)
  f94 = 0;                     // +0x094 i16 lido por 0x56fc69 (< 1: a unidade na célula não conta)
  mana = 0;                    // +0x09a i16 comparado ao custo da magia em 0x56ac5b
  attackRange = 0;             // +0x12c u8  alcance sem magia (0x56ac5b)
  book: SpellBookRec = new SpellBookRec(); // +0x140 ptr livro de magias
  ready = 0;                   // +0x136 u8  pedido pronto (0x56dca2: golpe, IA+9 == 1)
  effects = 0;                 // +0x144 u32 bits de efeito (0x40000 → IA+9 = 4 no despachante 0x56dca2)
  walk: WalkRec = new WalkRec();           // +0x1c0 ptr andar
  ai: AiRec = new AiRec();                 // +0x1c4 ptr tarefa/IA
  pathStatic = new CListWord();            // +0x1c8 CList<WORD> caminho estático (0x54e58c)
  pathDynamic = new CListWord();           // +0x1e4 CList<WORD> caminho dinâmico (0x54e886)
}

/** Short apontado pelo global [0x6044c4] (lido por 0x54d76e no ramo de alcance; esse ramo não roda no corpus). */
export const EXE_GLOBALS = { w6044c4: 0 };

/** Objeto de busca de caminho (o `this` de 0x557f08 / 0x55f970). */
export interface PathRec {
  /** +0x30000 u16[256*256] custo da onda por célula, índice y*256+x (0xffff = não alcançada). */
  readonly cost: Uint16Array;
  /** +0x54156 i8[2*N] passo (dx,dy) da volta no anel, indexado por direção*2 (+0 dx, +1 dy). */
  readonly ringStep: Int8Array;
}

export const PATH_COST_OFF = 0x30000;
export const PATH_RING_STEP_OFF = 0x54156;
/** Entradas (dx,dy) espelhadas em `ringStep` (direções 0..11; os pares só leram 1..10). */
export const PATH_RING_STEP_N = 12;

export function newPathRec(): PathRec {
  return { cost: new Uint16Array(256 * 256), ringStep: new Int8Array(PATH_RING_STEP_N * 2) };
}

/** Estrutura apontada por OccRec+0xc (objeto fixo na célula; lido por 0x550a96). */
export class CellStructRec {
  mapObj: MapObjRec = new MapObjRec(); // +0x10 ptr objeto de mapa (canto)
  width = 0;                           // +0x60 u8  largura em células
  cellMask = 0;                        // +0x64 u32 bit (dy*largura+dx): célula ocupada pela estrutura
}

export const MAP_MASK_OFF = 0x10000;
export const MAP_WIDTH_OFF = 0x50000;   // i32 largura (células jogáveis; borda de 8)
export const MAP_HEIGHT_OFF = 0x50004;  // i32 altura
export const MAP_QA_X_OFF = 0x50008;    // u8[0x1000] fila A (x) da onda de unidade grande
export const MAP_QA_Y_OFF = 0x51008;    // u8[0x1000] fila A (y)
export const MAP_QB_X_OFF = 0x52008;    // u8[0x1000] fila B (x)
export const MAP_QB_Y_OFF = 0x53008;    // u8[0x1000] fila B (y)
export const MAP_QA_N_OFF = 0x54008;    // u16 tamanho da fila A
export const MAP_QB_N_OFF = 0x5400a;    // u16 tamanho da fila B
export const MAP_OCC_CUR_OFF = 0x5402c; // OccRec corrente (0x3c)
export const MAP_OCC_UNIT_OFF = 0x54058;  // u32 = occCur+0x2c unidade (tipo ≠ 3) na célula
export const MAP_OCC_UNIT3_OFF = 0x5405c; // u32 = occCur+0x30 unidade de tipo 3 na célula
export const MAP_OCC_MAP_OFF = 0x54084; // CMap<short,OccRec> (cabeçalho 0x1c)
export const MAP_DEFAULT_COST_OFF = 0x5414b; // u8 custo de passo padrão (0x550a96)
export const MAP_QA_OFF = 0x54584;      // u16[0x1000] fila A (células) da onda de 1 célula
export const MAP_QB_OFF = 0x56584;      // u16[0x1000] fila B (células)
export const MAP_WAVES_STATIC_OFF = 0x58584;  // i32 ondas extras da busca estática
export const MAP_WAVES_DYNAMIC_OFF = 0x58588; // i32 ondas extras da busca dinâmica
export const MAP_DYN_NEAR_OFF = 0x58594;  // i32 distância (Chebyshev) até a qual o caminho dinâmico é refeito (0x555dc2)
export const MAP_DYN_LEN_OFF = 0x58598;   // i32 tamanho da lista estática acima do qual o alvo dinâmico sai dela
export const MAP_FOOT_OFF = 0xa452c;    // u8[8*8] rascunho da pegada (0x55be86)
export const MAP_RINGS_OFF = 0x5400c;   // objeto de 0x54ec6a: +4 CList<void*> de unidades (MapRec.ringUnits, cabeçalho 0x1c)
export const MAP_OCC_P04_OFF = 0x54030; // u32 = occCur+4 unidade (tipo 1/2) que ocupa a célula (0x5503af, 0x55073f, 0x551edb)
export const MAP_OCC_P08_OFF = 0x54034; // u32 = occCur+8 unidade de tipo 3
export const MAP_OCC_KIND_OFF = 0x54060; // u8 = occCur+0x34 tipo de objeto na célula (0x17 = teleporte)
export const MAP_OCC_TX_OFF = 0x54064;  // u8 = occCur+0x38 destino x do teleporte
export const MAP_OCC_TY_OFF = 0x54065;  // u8 = occCur+0x39 destino y
export const MAP_PATH_STATIC_N_OFF = 0x5858c; // i32 refazeres do caminho estático tolerados (0x555411)
export const MAP_DYN_TICKS_OFF = 0x58590; // i32 tiques entre refazeres do caminho dinâmico (0x555411, 0x55574d)
export const MAP_WORLD_OFF = 0x58d80;   // ptr mundo (WorldRec; `this` de 0x56fc69)
export const MAP_SPEED_MUL_OFF = 0x58d84; // i32 multiplicador de velocidade (0x559195)
export const MAP_DIR_DX_OFF = 0x58e88;  // i8[8] dx da direção 0..7 (0x559195)
export const MAP_DIR_DY_OFF = 0x58e90;  // i8[8] dy
export const MAP_DIR_CELL_OFF = 0x58e98; // i32[8] passo do índice de célula da direção (0x559195)
export const MAP_ALT_OFF = 0x944f4;     // i8[0x10000] altitude por célula (0x559195)

/**
 * Objeto de mapa/caminho do servidor (o `this` das ondas, de 0x55be86 e da ocupação; até +0xa456c): espelhado byte a byte
 * num único buffer pelo offset (um estouro de fila cai dentro do objeto como no exe), com vistas tipadas para as grades.
 * O CMap de ocupação (+0x54084) é objeto JS (mfc.ts); os 0x1c bytes do cabeçalho dele no buffer ficam sem uso.
 * Ponteiros guardados como u32 nos registros de ocupação resolvem-se por `structs` (endereço → registro espelhado).
 */
export class MapRec implements PathRec, FlagGridRec, ByteGridRec {
  static readonly SIZE = 0xa4570;
  readonly mem = new Uint8Array(MapRec.SIZE);
  readonly dv = new DataView(this.mem.buffer);
  /** +0x00000 u8[0x10000] custo de passo por célula. */
  readonly bytes = this.mem.subarray(0, 0x10000);
  /** +0x10000 u8[0x10000] máscara estática (0x20 = tem registro de ocupação; 0x10; 1|4 bloqueio). */
  readonly mask = this.mem.subarray(MAP_MASK_OFF, MAP_MASK_OFF + 0x10000);
  /** +0x20000 u8[0x10000] máscara dinâmica (FLAGS_OFF). */
  readonly flags = this.mem.subarray(FLAGS_OFF, FLAGS_OFF + 0x10000);
  readonly cost = new Uint16Array(this.mem.buffer, PATH_COST_OFF, 0x10000);
  readonly ringStep = new Int8Array(this.mem.buffer, PATH_RING_STEP_OFF, PATH_RING_STEP_N * 2);
  /** +0x5402c registro de ocupação corrente (vista no buffer). */
  readonly occCur = new OccRec(this.mem.subarray(MAP_OCC_CUR_OFF, MAP_OCC_CUR_OFF + OccRec.SIZE));
  /** +0x54084 CMap<short,OccRec> ocupação por célula. */
  occ = new CMapShortOcc();
  /** +0x54010 CList<void*> de endereços de unidade (dentro do objeto em +0x5400c; 0x54ec6a). */
  ringUnits = new CListPtr();
  /** +0x58d80 ponteiro para o mundo. */
  world: WorldRec | null = null;
  readonly structs = new Map<number, CellStructRec>();
  /** Unidades pelo endereço (ponteiros u32 guardados no mapa: occCur+4, lista de 0x54ec6a). */
  readonly units = new Map<number, UnitRec>();

  u16(off: number): number { return this.dv.getUint16(off, true); }
  setU16(off: number, v: number): void { this.dv.setUint16(off, v & 0xffff, true); }
  i32(off: number): number { return this.dv.getInt32(off, true); }
  u32(off: number): number { return this.dv.getUint32(off, true); }
  setU32(off: number, v: number): void { this.dv.setUint32(off, v >>> 0, true); }
  i8(off: number): number { return this.dv.getInt8(off); }
  unitAt(addr: number): UnitRec {
    const u = this.units.get(addr >>> 0);
    if (!u) throw new Error(`unidade 0x${(addr >>> 0).toString(16)} sem registro espelhado`);
    return u;
  }
  structAt(addr: number): CellStructRec {
    const r = this.structs.get(addr >>> 0);
    if (!r) throw new Error(`estrutura 0x${(addr >>> 0).toString(16)} (OccRec+0xc) sem registro espelhado`);
    return r;
  }
}

/** Evento do servidor para a IA (0x54 bytes; o rascunho em mundo+0xbd98 é copiado por valor para a lista mundo+0xbbec). Campos
 *  escritos pelo despachante 0x56dca2: +0 tipo (2 magia na unidade, 3 magia na célula), +4 x, +8 y, +0x2c unidade, +0x30 magia,
 *  +0x34 alvo. Os bytes não escritos ficam como estavam (o exe copia o rascunho inteiro). */
export const EVENT_SIZE = 0x54;

/** Mundo/servidor (o `this` de 0x56dca2, 0x56e4ac, 0x56fc69 e dos sorteios 0x57afc0/0x57afd0). */
export class WorldRec {
  divisor = 0x8000;                  // +0x0000 u32 divisor do objeto de sorteio uniforme (0x57afd0: rand() × n / divisor)
  /** +0x0004 CList<void*> das unidades vivas, na ordem de criação (0x56ed4e a percorre via mapa+0xa456c → mundo). */
  liveUnits = new CListPtr();
  /** +0xa68 (objeto +0xa64, lista em +4) CList<void*> dos candidatos a alvo no fim do caminho (0x56ed4e, 0x567ddf, 0x567a16). */
  cand = new CListPtr();
  /** +0xa88 (objeto +0xa84) CList<void*> dos candidatos caídos (vida +0x94 < 1; 0x567ddf). */
  dead = new CListPtr();
  /** +0xa8bc tabela de diplomacia: byte [8 + id(a) × 0x46 + id(b)], bit 0 = guerra (0x57994d). */
  dipTable = new Uint8Array(8 + 0x46 * 0x46);
  fbbe8 = 0;                         // +0xbbe8 u32 0 → 0x56dca2 testa o grupo dormindo (tipo+0x45)
  /** +0xbbec CList<Event> dos eventos para a IA (0x57b210 AddTail no despachante; 0x57b2b0 RemoveAll no pensamento 0x57485b). */
  events = new CListEvent();
  /** +0xbd98 rascunho do evento (0x54 bytes). */
  readonly evt = new Uint8Array(EVENT_SIZE);
  private readonly evtDv = new DataView(this.evt.buffer);
  evtSetU32(off: number, v: number): void { this.evtDv.setUint32(off, v >>> 0, true); }
  evtU32(off: number): number { return this.evtDv.getUint32(off, true); }
  /** o rand() do CRT (_tiddata+0x14) que 0x583290 usa: o `Rng` do motor (a World põe o seu aqui) */
  rng: Rng = new Rng();
  constructor(public map: MapRec) {} // +0xa50 ptr objeto de mapa/caminho
}
