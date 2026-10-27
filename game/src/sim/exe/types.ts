/**
 * Registros espelhados do servidor do allods2.exe: cada campo leva o offset e o tamanho do original. Só existem os campos que
 * alguma função portada lê ou escreve (acrescente aqui, com offset/tamanho, quando uma porta nova precisar). Ponteiros do exe
 * viram referências a outro registro espelhado; vtables ficam como o endereço (despacho em `vtables.ts`).
 *
 * Lote piloto (sim/exe/path.ts): Unit_ApproachCell 0x557f08 e o seu fecho.
 * Lote 5a (sim/exe/walk.ts): objeto de mapa completo, registro de ocupação de célula, grade de flags, campos de unidade lidos pelos acessores.
 * Lote 5b (sim/exe/wave.ts): `MapRec` (o objeto de mapa/caminho inteiro, `this` das ondas), listas de caminho e sub-registros da unidade.
 */
import { CListWord, CMapShortOcc } from "./mfc";

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
}
/** Tipo da unidade (alvo do ponteiro unidade+0x70). */
export class UnitTypeRec {
  stats: UnitStatsRec = new UnitStatsRec(); // +0x3c ptr
}

/** Sub-registro de andar (alvo do ponteiro unidade+0x1c0). */
export class WalkRec {
  passMask = 0;   // +0x05 u8  máscara de passagem (AND com as grades +0x10000/+0x20000 do mapa)
  f76 = 0;        // +0x76 u16 célula-alvo do caminho dinâmico (0x555dc2)
  footCell = 0;   // +0x80 u16 célula onde a pegada da unidade está marcada (0x55be86; 0 = nenhuma)
  f98 = 0;        // +0x98 u32 posto a 1 por 0x555dc2 quando o caminho dinâmico fica vazio
}

/** Sub-registro de tarefa/IA (alvo do ponteiro unidade+0x1c4). */
export class AiRec {
  task = 0;       // +0x08 u8  tipo de tarefa (5 = ramo de alcance em 0x54d76e)
  f16 = 0;        // +0x16 i16
  spellSlot = 0;  // +0x78 u8  magia do livro escolhida (0 = nenhuma; 0x56ac5b)
}

/** Dono da unidade (alvo do ponteiro unidade+0x14). */
export class PlayerRec {
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
  type: UnitTypeRec = new UnitTypeRec(); // +0x070 ptr tipo da unidade
  speed = 0;                   // +0x08c i16 velocidade da unidade (0x55915a)
  mana = 0;                    // +0x09a i16 comparado ao custo da magia em 0x56ac5b
  attackRange = 0;             // +0x12c u8  alcance sem magia (0x56ac5b)
  book: SpellBookRec = new SpellBookRec(); // +0x140 ptr livro de magias
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
  readonly structs = new Map<number, CellStructRec>();

  u16(off: number): number { return this.dv.getUint16(off, true); }
  setU16(off: number, v: number): void { this.dv.setUint16(off, v & 0xffff, true); }
  i32(off: number): number { return this.dv.getInt32(off, true); }
  u32(off: number): number { return this.dv.getUint32(off, true); }
  setU32(off: number, v: number): void { this.dv.setUint32(off, v >>> 0, true); }
  structAt(addr: number): CellStructRec {
    const r = this.structs.get(addr >>> 0);
    if (!r) throw new Error(`estrutura 0x${(addr >>> 0).toString(16)} (OccRec+0xc) sem registro espelhado`);
    return r;
  }
}
