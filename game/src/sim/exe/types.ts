/**
 * Registros espelhados do servidor do allods2.exe: cada campo leva o offset e o tamanho do original. Só existem os campos que
 * alguma função portada lê ou escreve (acrescente aqui, com offset/tamanho, quando uma porta nova precisar). Ponteiros do exe
 * viram referências a outro registro espelhado; vtables ficam como o endereço (despacho em `vtables.ts`).
 *
 * Lote piloto (sim/exe/path.ts): Unit_ApproachCell 0x557f08 e o seu fecho.
 */

/** Objeto de mapa da unidade (alvo do ponteiro unidade+0x10). Coordenadas em células e fração (1/256 de célula). */
export class MapObjRec {
  x = 0;  // +0x00 u8  célula x            (0x54ffb0, 0x54ff5b)
  y = 0;  // +0x01 u8  célula y            (0x54ffc0, 0x54ff7c)
  fx = 0; // +0x04 u8  fração x (0..255)   (0x54ff5b)
  fy = 0; // +0x05 u8  fração y (0..255)   (0x54ff7c)
}

/** Unidade do servidor (0x1d0 bytes). */
export class UnitRec {
  vtbl = 0;                    // +0x000 u32 vtable (0x5d0eb0 / 0x5d0f40 / 0x5d0fb8)
  mapObj: MapObjRec = new MapObjRec(); // +0x010 ptr objeto de mapa
  size = 0;                    // +0x049 u8  lado em células (lido pelo slot 0x1c da vtable, 0x542360)
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
