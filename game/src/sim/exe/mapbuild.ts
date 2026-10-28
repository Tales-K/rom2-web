/**
 * Montagem do `MapRec` (objeto de mapa/caminho do servidor) a partir da `Grid` da missão, para o andar portado rodar no jogo.
 * NÃO é porta: o carregador de mapa do exe não está portado. As regras abaixo foram medidas contra a imagem do tique 0 das
 * missões 10 e 20 (refs/oracle/ticks, `exe.mem`): custo por célula (+0x0) e altura (+0x944f4) iguais à `Grid` em 100 % das
 * células; a máscara (+0x10000) é função dos bits de bloqueio (borda → 0x1f, terreno → 1, objeto/estrutura → 5; estrutura com
 * registro de ocupação → 0x25) e a grade dinâmica (+0x20000) começa igual a ela. Estruturas com máscara de passagem: um registro
 * de ocupação (OccRec) por célula do pé, como no tique 0 do original (r[0] = passo do tile, r[1] = máscara de antes, +0xc = a
 * estrutura, +0x3a = a célula; máscara 0x20 nas células livres, 0x25 nas bloqueadas), que 0x550a96 reaplica quando uma pegada passa (passo
 * padrão 6 nas livres). [est] Objetos e sacos não ganham registro.
 * Constantes do objeto (+0x50000.. +0x58e98): iguais nas 3 imagens do oráculo.
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
      m.mem[c] = g.cost[i]! & 0xff;
      m.mem[MAP_MASK_OFF + c] = mk;
      m.mem[FLAGS_OFF + c] = mk;
      m.mem[MAP_ALT_OFF + c] = g.alt[i]! & 0xff;
    }
  }
  // registros de ocupação das estruturas (endereço sintético por estrutura: identidade do ponteiro OccRec+0xc)
  g.structs.forEach((s, k) => {
    const addr = (0x20000000 + k * 0x100) >>> 0;
    const st = new CellStructRec();
    st.mapObj.x = s.x & 0xff; st.mapObj.y = s.y & 0xff; st.mapObj.cell = ((s.y & 0xff) << 8) | (s.x & 0xff);
    st.width = s.w & 0xff; st.cellMask = s.pass >>> 0;
    m.structs.set(addr, st);
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h || x > 255 || y > 255) continue;
      const c = y * 256 + x, under = exeMaskOf(s.under[dy * s.w + dx]!) & 0x1f;
      const r = new OccRec();
      r.b[0] = m.mem[c]!; r.b[1] = under;
      r.b[0xc] = addr & 0xff; r.b[0xd] = (addr >>> 8) & 0xff; r.b[0xe] = (addr >>> 16) & 0xff; r.b[0xf] = (addr >>> 24) & 0xff;
      r.b[0x3a] = c & 0xff; r.b[0x3b] = (c >> 8) & 0xff;
      m.occ.setAt(c, r);
      if (((s.pass >>> (dy * s.w + dx)) & 1) === 0) { m.mem[MAP_MASK_OFF + c] = 0x20; m.mem[FLAGS_OFF + c] = 0x20; }
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
  m.mem[MAP_RECT_OFF] = MAP_BORDER; m.mem[MAP_RECT_OFF + 1] = MAP_BORDER;
  m.mem[MAP_RECT_OFF + 2] = Math.max(0, Math.min(255, g.w - MAP_BORDER - 1)); m.mem[MAP_RECT_OFF + 3] = Math.max(0, Math.min(255, g.h - MAP_BORDER - 1));
  m.world = new WorldRec(m);
  return m;
}
