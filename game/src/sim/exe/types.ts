/**
 * Registros espelhados do servidor do allods2.exe: cada campo leva o offset e o tamanho do original. Só existem os campos que
 * alguma função portada lê ou escreve (acrescente aqui, com offset/tamanho, quando uma porta nova precisar). Ponteiros do exe
 * viram referências a outro registro espelhado; vtables ficam como o endereço (despacho em `vtables.ts`).
 *
 * Lote piloto (sim/exe/path.ts): Unit_ApproachCell 0x557f08 e o seu fecho.
 * Lote 5a (sim/exe/walk.ts): objeto de mapa completo, registro de ocupação de célula, grade de flags, campos de unidade lidos pelos acessores.
 */

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
  readonly b = new Uint8Array(OccRec.SIZE);
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
  speedByte = 0; // +0x44 u8  se ≠ 0 vale como velocidade, senão usa unidade+0x8c (0x55915a)
}
/** Tipo da unidade (alvo do ponteiro unidade+0x70). */
export class UnitTypeRec {
  stats: UnitStatsRec = new UnitStatsRec(); // +0x3c ptr
}

/** Unidade do servidor (0x1d0 bytes). */
export class UnitRec {
  vtbl = 0;                    // +0x000 u32 vtable (0x5d0eb0 / 0x5d0f40 / 0x5d0fb8)
  mapObj: MapObjRec = new MapObjRec(); // +0x010 ptr objeto de mapa
  f43 = 0;                     // +0x043 u8  lido por 0x5160ef
  size = 0;                    // +0x049 u8  lado em células (lido pelo slot 0x1c da vtable, 0x542360)
  kind = 0;                    // +0x04a u8  lido pelo slot 0x20 das vtables (0x542380); 1 = ramo "grade" de 0x55687d
  type: UnitTypeRec = new UnitTypeRec(); // +0x070 ptr tipo da unidade
  speed = 0;                   // +0x08c i16 velocidade da unidade (0x55915a)
}

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
