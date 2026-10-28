/**
 * Porta literal do servidor do allods2.exe: a visão de uma unidade (etapa 9, lote 2; notes/pensamento.md). O objeto de visão vive em
 * mapa+0x58ec0 (`MAP_VISION_OFF`, dentro do buffer do MapRec): tabelas fixas da janela 41×41 (+0x22000 pai de cada célula, i8 dx/dy;
 * +0x28000 custo do passo, i16: 128 reto, 181 diagonal), o orçamento por célula (+0x24000, i32 [x × 0x100 + y × 4]), o deslocamento
 * (+0x2a004: 7) e o mapa de células vistas (+0x2a008, u8 por célula y × 256 + x).
 * Portadas:
 *  - 0x552c28 Vision_Compute (thiscall; unidade, célula): zera o orçamento, põe (visão +0xa5 << 7) + 64 no centro, marca a própria célula
 *    e, anel a anel (1..19), cada célula do anel dentro da área útil herda o orçamento do pai menos o custo do passo e a subida (altura da
 *    célula − altura da unidade); orçamento > 0 = célula vista; para no 1.º anel em que nenhuma célula ficou com orçamento (0x552af8).
 *  - 0x552af8 (thiscall): uma célula da janela (x, y; `base` = célula do canto; `alt0` = altura da unidade). Devolve true = esgotada.
 *  - 0x559536 (thiscall; `this` = mapa): a célula (x, y) está na área útil (+0x58eb8..+0x58ebb).
 *  - 0x553329 Vision_UnitMap → Vision_Compute; 0x553681: zera o mapa de células vistas.
 */
import { mapObjCellOf } from "./walk";
import { MAP_ALT_OFF, MAP_RECT_OFF, MAP_VISION_OFF, VIS_BUDGET_OFF, VIS_COST_OFF, VIS_PARENT_OFF, VIS_SEEN_OFF, VIS_SHIFT_OFF, type MapRec, type UnitRec } from "./types";

const V = MAP_VISION_OFF;

/** 0x559536 (thiscall; `this` = mapa): 1 se (x, y) (bytes) está dentro de x0..x1, y0..y1 (+0x58eb8..bb). */
export function fn_0x559536(m: MapRec, param_1: number, param_2: number): number {
  const x = param_1 & 0xff, y = param_2 & 0xff, r = m.mem;
  if (x < r[MAP_RECT_OFF]! || r[MAP_RECT_OFF + 2]! < x || y < r[MAP_RECT_OFF + 1]! || r[MAP_RECT_OFF + 3]! < y) return 0;
  return 1;
}

/** 0x552af8 (thiscall; `this` = objeto de visão). `param_1` = x, `param_2` = y na janela (0..40), `param_3` = célula do canto (pode ser
 *  negativa), `param_4` = altura da unidade. Devolve true quando o orçamento da célula fica < 1. */
export function fn_0x552af8(m: MapRec, param_1: number, param_2: number, param_3: number, param_4: number): boolean {
  const local_8 = (param_2 * 0x100 + param_1) | 0;
  const dv = m.dv;
  const pdx = dv.getInt8(V + VIS_PARENT_OFF + param_2 * 2 + param_1 * 0x80);
  const pdy = dv.getInt8(V + VIS_PARENT_OFF + param_2 * 2 + param_1 * 0x80 + 1);
  const b = (dv.getInt32(V + VIS_BUDGET_OFF + (param_2 + pdy) * 4 + (param_1 + pdx) * 0x100, true)
    - ((dv.getInt16(V + VIS_COST_OFF + param_2 * 2 + param_1 * 0x80, true) + (dv.getInt8(MAP_ALT_OFF + param_3 + local_8) - param_4)) | 0)) | 0;
  dv.setInt32(V + VIS_BUDGET_OFF + param_2 * 4 + param_1 * 0x100, b, true);
  const bVar1 = b < 1;
  if (!bVar1) m.mem[V + VIS_SEEN_OFF + param_3 + local_8] = 1;
  return bVar1;
}

/** 0x552c28 Vision_Compute (thiscall; `this` = objeto de visão): células vistas pela unidade `u` a partir da célula `param_2` (u16). */
export function visionCompute(m: MapRec, u: UnitRec, param_2: number): void {
  const iVar6 = (param_2 & 0xff) - 0x14;
  const iVar8 = ((param_2 & 0xffff) >> 8) - 0x14;
  const iVar10 = iVar8 * 0x100 + iVar6;
  m.mem.fill(0, V + VIS_BUDGET_OFF, V + VIS_BUDGET_OFF + 0x4000);
  const shift = m.u32(V + VIS_SHIFT_OFF);
  m.dv.setInt32(V + 0x25450, (((u.fa5 & 0xff) << (shift & 0x1f)) + (1 << ((shift - 1) & 0x1f))) | 0, true);
  let uVar5 = mapObjCellOf(u.mapObj) & 0xffff;
  m.mem[V + VIS_SEEN_OFF + uVar5] = 1;
  uVar5 = mapObjCellOf(u.mapObj) & 0xffff;
  const iVar9 = m.i8(MAP_ALT_OFF + uVar5);
  for (let local_1c = 1; local_1c <= 0x13; local_1c++) {
    let bVar3 = true;
    for (let local_28 = -local_1c; local_28 < local_1c + 1; local_28++) {
      const cVar2 = iVar8, cVar1 = iVar6;   // (char) dos cantos: a soma vira byte em 0x559536
      if (fn_0x559536(m, cVar1 + local_28 + 0x14, cVar2 + 0x14 - local_1c) !== 0
        && !fn_0x552af8(m, local_28 + 0x14, 0x14 - local_1c, iVar10, iVar9)) bVar3 = false;
      if (fn_0x559536(m, cVar1 + local_28 + 0x14, cVar2 + local_1c + 0x14) !== 0
        && !fn_0x552af8(m, local_28 + 0x14, local_1c + 0x14, iVar10, iVar9)) bVar3 = false;
      if (fn_0x559536(m, cVar1 + 0x14 - local_1c, cVar2 + local_28 + 0x14) !== 0
        && !fn_0x552af8(m, 0x14 - local_1c, local_28 + 0x14, iVar10, iVar9)) bVar3 = false;
      if (fn_0x559536(m, cVar1 + local_1c + 0x14, cVar2 + 0x14 - local_28) !== 0
        && !fn_0x552af8(m, local_1c + 0x14, 0x14 - local_28, iVar10, iVar9)) bVar3 = false;
    }
    if (bVar3) break;
  }
}

/** 0x553329 Vision_UnitMap (thiscall): Vision_Compute(unidade, célula). */
export function visionUnitMap(m: MapRec, u: UnitRec, cell: number): void {
  visionCompute(m, u, cell & 0xffff);
}

/** 0x553681 (fastcall): zera o mapa de células vistas (+0x2a008, 0x10000 bytes). */
export function fn_0x553681(m: MapRec): void {
  m.mem.fill(0, V + VIS_SEEN_OFF, V + VIS_SEEN_OFF + 0x10000);
}

/** Célula vista no mapa de visão corrente (leitura; 0x571c4d: `*(char *)(visão + célula + 0x2a008)`). */
export function visionSeen(m: MapRec, cell: number): number {
  return m.mem[V + VIS_SEEN_OFF + (cell & 0xffff)]!;
}
