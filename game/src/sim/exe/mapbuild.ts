/**
 * Montagem do `MapRec` (objeto de mapa/caminho do servidor) a partir da `Grid` da missão, para o andar portado rodar no jogo.
 * NÃO é porta: o carregador de mapa do exe não está portado. As regras abaixo foram medidas contra a imagem do tique 0 das
 * missões 10 e 20 (refs/oracle/ticks, `exe.mem`): custo por célula (+0x0) e altura (+0x944f4) iguais à `Grid` em 100 % das
 * células; a máscara (+0x10000) é função dos bits de bloqueio (borda → 0x1f, terreno → 1, objeto/estrutura → 5; estrutura com
 * registro de ocupação → 0x25) e a grade dinâmica (+0x20000) começa igual a ela. Estruturas com máscara de passagem: um registro
 * de ocupação (OccRec) por célula do pé, como no tique 0 do original (r[0] = passo do tile, r[1] = máscara de antes, +0xc = a
 * estrutura, +0x3a = a célula; máscara 0x20 nas células livres, 0x25 nas bloqueadas), que 0x550a96 reaplica quando uma pegada passa (passo
 * padrão 6 nas livres). [est] Objetos não ganham registro; os sacos entram pela World (0x5538c7, `exeSyncBags`).
 * Constantes do objeto (+0x50000.. +0x58e98): iguais nas 3 imagens do oráculo. Lote 3 da 9b (46 despejos do tique 0, `npm run loadcmp`):
 * o passo vem do tile pela classe 0x55494d e as tabelas do construtor 0x54d2d9 (0x553d51, 0x554626, 0x5536a4 → 0x552244) entram aqui.
 */
import { BLOCK_BORDER, BLOCK_OBJECT, BLOCK_SPELL, BLOCK_STRUCTURE, BLOCK_TERRAIN, MAP_BORDER, type Grid } from "../grid";
import { VIS_COST, VIS_PARENT } from "../vision_tables";
import {
  CellStructRec, OccRec, FLAGS_OFF, MAP_ALT_OFF, MAP_DEFAULT_COST_OFF, MAP_DIR_CELL_OFF, MAP_DIR_DX_OFF, MAP_DIR_DY_OFF, MAP_DYN_LEN_OFF, MAP_DYN_NEAR_OFF,
  MAP_DYN_TICKS_OFF, MAP_HEIGHT_OFF, MAP_MASK_OFF, MAP_PATH_STATIC_N_OFF, MAP_SPEED_MUL_OFF, MAP_WAVES_DYNAMIC_OFF, MAP_WAVES_STATIC_OFF,
  MAP_RECT_OFF, MAP_VISION_OFF, MAP_WIDTH_OFF, MapRec, VIS_COST_OFF, VIS_PARENT_OFF, VIS_SHIFT_OFF, WorldRec,
} from "./types";

/** Tamanho da tabela de baldes do CMap de ocupação (+0x54088) nas imagens. */
export const OCC_TABLE_SIZE = 100;

/** Máscara estática (+0x10000) de uma célula pelos bits de bloqueio da `Grid`. */
export function exeMaskOf(block: number): number {
  if (block & BLOCK_BORDER) return 0x1f;
  if (block & BLOCK_STRUCTURE) return 0x25;
  if (block & (BLOCK_OBJECT | BLOCK_SPELL)) return 5;
  if (block & BLOCK_TERRAIN) return 1;
  return 0;
}

/** Constantes do objeto de mapa (iguais nas 3 imagens do oráculo). */
export function initMapConstants(m: MapRec, w: number, h: number): void {
  m.dv.setInt32(MAP_WIDTH_OFF, w, true);
  m.dv.setInt32(MAP_HEIGHT_OFF, h, true);
  m.dv.setInt32(MAP_WAVES_STATIC_OFF, 5, true);
  m.dv.setInt32(MAP_WAVES_DYNAMIC_OFF, 3, true);
  m.dv.setInt32(MAP_PATH_STATIC_N_OFF, 16, true);
  m.dv.setInt32(MAP_DYN_TICKS_OFF, 32, true);
  m.dv.setInt32(MAP_DYN_NEAR_OFF, 3, true);
  m.dv.setInt32(MAP_DYN_LEN_OFF, 5, true);
  m.dv.setInt32(MAP_SPEED_MUL_OFF, 8, true);
  m.mem[MAP_DEFAULT_COST_OFF] = 6;
  const dx = [0, 1, 1, 1, 0, -1, -1, -1], dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  for (let d = 0; d < 8; d++) {
    m.dv.setInt8(MAP_DIR_DX_OFF + d, dx[d]!);
    m.dv.setInt8(MAP_DIR_DY_OFF + d, dy[d]!);
    m.dv.setInt32(MAP_DIR_CELL_OFF + d * 4, dy[d]! * 256 + dx[d]!, true);
  }
  const ring = [1, 0, 0, 1, -1, 0, 0, -1];
  for (let i = 0; i < m.ringStep.length; i++) m.ringStep[i] = ring[i % 8]!;
  m.occ.tableSize = OCC_TABLE_SIZE;
  initCtorTables(m);
}

/** Tabelas e campos fixos que o construtor do MapRec 0x54d2d9 grava (fora os ponteiros, que o comparador mascara): o tamanho do bloco
 *  dos contentores MFC (0x52b19a: CList em +0x54010; 0x5420f0 em +0x54068 e +0xa4510; 0x55f360 CMap +0x54084; 0x55f7f0 em +0xa44f4), 0x55f2f0
 *  (+0x54190+0x3f0 = 2), e 0x553d51: classe de canto por tile +0x540a6 (4 linhas de 0x10), pares de terreno por grupo +0x54126, +0x5413e, e
 *  o custo de passo por terreno +0x54146 (map.reg Terrain/Cost*: 0xff, Land, Grass, Flowers, Sand, Cracked = o padrão +0x5414b, Stones,
 *  Savanna, Mountain, Water, Road — os valores do map.reg de "World Data", iguais nos 46 despejos do tique 0). */
function initCtorTables(m: MapRec): void {
  m.mem[0x5400c + 4 + 0x18] = 10;   // 0x52b19a: CList<void*>(10) em +0x54010 (lista do anel)
  m.mem[0x54068 + 0x18] = 10;       // 0x5420f0(10)
  m.mem[0x54084 + 0x18] = 10;       // 0x55f360(10): CMap de ocupação, tamanho do bloco
  m.mem[0x54084 + 8] = OCC_TABLE_SIZE;  // 0x553d51 → 0x55f5d0(100, 1): baldes
  m.mem[0x54190 + 0x3f0] = 2;       // 0x55f2f0
  m.mem[0xa44f4 + 0x18] = 10;       // 0x55f7f0(10)
  m.mem[0xa4510 + 0x18] = 10;       // 0x5420f0(10)
  const corner = [
    [2, 3, 2, 4, 3, 4, 2, 2, 2, 2, 4, 4, 4, 4],
    [3, 5, 3, 3, 1, 3, 2, 4, 2, 2, 4, 2, 4, 4],
    [2, 3, 2, 4, 3, 4, 2, 4, 2, 2, 4, 2, 4, 4],
    [5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 4, 4, 4, 4],
  ];
  corner.forEach((row, r) => row.forEach((v, i) => { m.mem[0x540a6 + r * 0x10 + i] = v; }));
  [2, 1, 5, 1, 4, 1, 7, 1, 6, 1, 5, 6, 3, 7, 8, 6].forEach((v, i) => { m.mem[0x54126 + i] = v; });
  m.mem[0x5413e] = 10; m.mem[0x5413f] = 1;
  [0xff, 8, 8, 8, 0xe, 6, 0xc, 8, 0x10, 8, 6].forEach((v, i) => { m.mem[0x54146 + i] = v; });
}

/** 0x552244 (fastcall; objeto de visão): tabela dx² + dy² da janela 41×41 em +0x20000 ([x × 0x80 + y × 2], i16), como o construtor
 *  0x5536a4 a deixa (+0x20028 = +0x20000 + 0x14 × 2). */
export function fn_0x552244(m: MapRec, param_1: number): void {
  for (let local_c = 0; local_c < 0x15; local_c++) {
    for (let local_14 = 0; local_14 < 0x15; local_14++) {
      const local_8 = (local_c * local_c + local_14 * local_14) & 0xffff;
      m.setU16(param_1 + (local_c + 0x14) * 0x80 + 0x20028 + local_14 * 2, local_8);
      m.setU16(param_1 + 0x20000 + (local_c + 0x14) * 0x80 + (0x14 - local_14) * 2, local_8);
      m.setU16(param_1 + (0x14 - local_c) * 0x80 + 0x20028 + local_14 * 2, local_8);
      m.setU16(param_1 + 0x20000 + (0x14 - local_c) * 0x80 + (0x14 - local_14) * 2, local_8);
    }
  }
}

/** 0x55494d Path_RockClass (thiscall; mapa, tile & 0xffff03ff, &passo): classe do tile (8 = rocha; ≥ 0xd sem passo) e o passo dele pelas
 *  tabelas do construtor (+0x540a6 canto, +0x54126 par de terrenos do grupo, +0x54146 custo por terreno). Devolve [classe, passo]. */
export function pathRockClass(m: MapRec, param_1: number): [number, number] {
  let local_18 = 0xff;
  const bVar1 = local_18;
  let param_2 = 8;
  if ((param_1 & 0x300) === 0x200) {
    const uVar2 = param_1 & 0xf;
    local_18 = bVar1;
    if (uVar2 < 8) {
      if (uVar2 === 4) local_18 = ((param_1 & 0x30) >> 4) === 1 ? 1 : 9;
      else local_18 = 9;
    }
  } else {
    const iVar6 = (param_1 & 0x3c0) >> 6, iVar3 = (param_1 & 0x30) >> 4, uVar2 = param_1 & 0xf;
    if (uVar2 < 0xe) {
      const b1 = m.mem[iVar6 * 2 + 0x54126]!, uVar4 = b1;
      local_18 = m.mem[iVar6 * 2 + 0x54127]!;
      const uVar5 = local_18;
      const corner = m.mem[uVar2 + iVar3 * 0x10 + 0x540a6]!;
      if (2 < corner) local_18 = b1;
      const c4 = m.mem[uVar4 + 0x54146]!, c5 = m.mem[uVar5 + 0x54146]!;
      switch (corner) {
        case 1: param_2 = c5; break;
        case 2: param_2 = (c4 + c5 * 3) >> 2; break;
        case 3: param_2 = (c4 + c5) >> 1; break;
        case 4: param_2 = (c4 * 3 + c5) >> 2; break;
        case 5: param_2 = c4; break;
      }
    }
  }
  return [local_18, param_2];
}

/** O passo de uma célula como 0x554626 o põe na carga: o da classe (< 0xd) ou +0x54146 (0xff). */
export function tilePasso(m: MapRec, tile: number): number {
  const [bVar4, passo] = pathRockClass(m, tile & 0x3ff);
  return bVar4 < 0xd ? passo & 0xff : m.mem[0x54146]!;
}

/** MapRec da missão (sem unidades) a partir da `Grid`, com o mundo (`WorldRec`) apontado em +0x58d80. */
export function mapRecFromGrid(g: Grid): MapRec {
  const m = new MapRec();
  initMapConstants(m, g.w, g.h);
  m.mem.fill(1, 0, 0x10000);   // passo 1 fora da área do mapa (imagens do oráculo)
  for (let y = 0; y < g.h && y < 256; y++) {
    for (let x = 0; x < g.w && x < 256; x++) {
      const i = g.idx(x, y), c = y * 256 + x;
      const mk = exeMaskOf(g.block[i]!);
      m.mem[c] = g.tile ? tilePasso(m, g.tile[i]!) : g.cost[i]! & 0xff;
      m.mem[MAP_MASK_OFF + c] = mk;
      m.mem[FLAGS_OFF + c] = mk;
      m.mem[MAP_ALT_OFF + c] = g.alt[i]! & 0xff;
    }
  }
  // registros de ocupação das estruturas (endereço sintético por estrutura: identidade do ponteiro OccRec+0xc)
  g.structs.forEach((s, k) => {
    if (s.n === 0) return;
    const addr = (0x20000000 + k * 0x100) >>> 0;
    const st = new CellStructRec();
    st.mapObj.x = s.x & 0xff; st.mapObj.y = s.y & 0xff; st.mapObj.cell = ((s.y & 0xff) << 8) | (s.x & 0xff);
    st.width = s.w & 0xff; st.cellMask = s.pass >>> 0;
    m.structs.set(addr, st);
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) {
      if (dy * s.w + dx >= s.n) break;   // colocação interrompida (Grid.fromMap, 0x5599df)
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h || x > 255 || y > 255) continue;
      const c = y * 256 + x, under = exeMaskOf(s.under[dy * s.w + dx]!) & 0x1f;
      const r = new OccRec();
      r.b[0] = m.mem[c]!; r.b[1] = under;
      r.b[0xc] = addr & 0xff; r.b[0xd] = (addr >>> 8) & 0xff; r.b[0xe] = (addr >>> 16) & 0xff; r.b[0xf] = (addr >>> 24) & 0xff;
      r.b[0x3a] = c & 0xff; r.b[0x3b] = (c >> 8) & 0xff;
      m.occ.setAt(c, r);
      // célula livre do pé: 0x550a96 tira o bloqueio e põe o passo padrão (+0x5414b, CostCracked = 6) — os 46 despejos do tique 0
      if (((s.pass >>> (dy * s.w + dx)) & 1) === 0) { m.mem[MAP_MASK_OFF + c] = 0x20; m.mem[FLAGS_OFF + c] = 0x20; m.mem[c] = m.mem[MAP_DEFAULT_COST_OFF]!; }
      else { m.mem[MAP_MASK_OFF + c] = 0x25; m.mem[FLAGS_OFF + c] = 0x25; }
    }
  });
  // objeto de visão (0x552c28, sim/exe/vision.ts): tabelas fixas da janela 41×41 (pai e custo, vision_tables.ts, [x × 0x80 + y × 2]),
  // deslocamento do orçamento 7 e a área útil (+0x58eb8: 8..largura−9, 8..altura−9 — iguais nas imagens do oráculo)
  for (let x = 0; x < 41; x++) {
    for (let y = 0; y < 41; y++) {
      const k = x * 41 + y, o = x * 0x80 + y * 2;
      m.dv.setInt8(MAP_VISION_OFF + VIS_PARENT_OFF + o, VIS_PARENT[k * 2]!);
      m.dv.setInt8(MAP_VISION_OFF + VIS_PARENT_OFF + o + 1, VIS_PARENT[k * 2 + 1]!);
      m.dv.setInt16(MAP_VISION_OFF + VIS_COST_OFF + o, VIS_COST[k]!, true);
    }
  }
  m.dv.setUint32(MAP_VISION_OFF + VIS_SHIFT_OFF, 7, true);
  m.dv.setUint32(MAP_VISION_OFF + VIS_SHIFT_OFF - 4, 1 << 7, true);   // 0x5536a4: +0x2a000 = 1 << ScanShift
  fn_0x552244(m, MAP_VISION_OFF);
  m.mem[MAP_RECT_OFF] = MAP_BORDER; m.mem[MAP_RECT_OFF + 1] = MAP_BORDER;
  m.mem[MAP_RECT_OFF + 2] = Math.max(0, Math.min(255, g.w - MAP_BORDER - 1)); m.mem[MAP_RECT_OFF + 3] = Math.max(0, Math.min(255, g.h - MAP_BORDER - 1));
  // 0x554626: as duas pontas da área útil como célula (+0x58ebc = y0 × 0x100 + x0, +0x58ebe = y1 × 0x100 + x1)
  m.setU16(MAP_RECT_OFF + 4, (m.mem[MAP_RECT_OFF + 1]! << 8) + m.mem[MAP_RECT_OFF]!);
  m.setU16(MAP_RECT_OFF + 6, (m.mem[MAP_RECT_OFF + 3]! << 8) + m.mem[MAP_RECT_OFF + 2]!);
  m.world = new WorldRec(m);
  return m;
}
