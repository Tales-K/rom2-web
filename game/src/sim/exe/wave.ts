/**
 * Porta literal do servidor do allods2.exe: ondas e caminho (lote 5b). Busca por inundação (`Path_WaveSearch`), as expansões
 * de onda, o caminho de volta (backtrace) para as listas da unidade, a marcação da pegada da unidade no mapa de ocupação e o
 * refazer do caminho dinâmico. Uma função do exe = uma função daqui; prova em sim/test/exe_wave.ts contra os pares do oráculo.
 *
 * Portadas: 0x54d76e Path_WaveSearch, 0x54d72d, 0x555dc2 Path_RefreshDynamic, 0x55d010 0x55d830 0x55e050 0x55e870 (ondas de
 * 1 célula), 0x55c6f0 0x55c910 0x55cb30 0x55cdf0 (ondas de unidade grande), 0x54e886 Path_BacktraceDynamic, 0x54e58c
 * Path_BacktraceStatic, 0x55c440 Path_TargetFree, 0x55cd50, 0x55c5a0 Unit_FootprintCheck, 0x5563ca, 0x55be86 (pegada),
 * 0x55c1fe 0x55c2ce (tira/põe a unidade na célula), 0x550a96 0x550a53 0x550966 0x5508a0 (registro de ocupação → grades),
 * 0x550e12 0x550ed5 0x55f350, 0x551edb 0x559bc9 (unidade/estrutura na célula), 0x558fe9 AI_TeleportTargetDist, 0x556f56,
 * 0x56ac5b AI_AttackRange, 0x51c391 Unit_GetBookSpell.
 *
 * Cópias no exe: as quatro ondas de 1 célula, as quatro de unidade grande, os dois backtraces e 0x55c440/0x55cd50 são o mesmo
 * código instrução a instrução, mudando só constantes (conferido no assembly normalizado: grade +0x10000/+0x20000, fila
 * A/B, lista +0x1c8/+0x1e4, grade do teste de alvo livre). Cada endereço tem a sua função exportada; o corpo comum fica num
 * auxiliar privado com as constantes como parâmetros.
 *
 * `this` de todas é o objeto de mapa/caminho (`MapRec`, espelhado byte a byte pelo offset). Ponteiros de unidade guardados
 * em registros de ocupação são u32 comparados a `UnitRec.addr`.
 */
import { cellIdxOff00000, cellIdxOff10000, cellIdxOff20000, cellIndex, cellOff00000, cellOff10000, cellOff20000, cellFlagMark40, fn_0x55f330,
  gridChebyshevDist, mapObjCellOf, occRecClear, occRecCopy, occRecIsEmpty, orMaskInto, unitPassMaskAnd } from "./walk";
import { mapObjCellX, mapObjCellY, pathCostCellOff, pathUnlabeledTargetRing, unitApproachCell, vtGetSize } from "./path";
import {
  EXE_GLOBALS, MAP_DEFAULT_COST_OFF, MAP_FOOT_OFF, MAP_DYN_LEN_OFF, MAP_DYN_NEAR_OFF, MAP_HEIGHT_OFF, MAP_MASK_OFF, MAP_OCC_UNIT3_OFF,
  MAP_OCC_UNIT_OFF, MAP_QA_N_OFF, MAP_QA_OFF, MAP_QA_X_OFF, MAP_QA_Y_OFF, MAP_QB_N_OFF, MAP_QB_OFF, MAP_QB_X_OFF, MAP_QB_Y_OFF,
  MAP_WAVES_DYNAMIC_OFF, MAP_WAVES_STATIC_OFF, MAP_WIDTH_OFF, FLAGS_OFF, PATH_COST_OFF,
  type BookSpellRec, type MapRec, type OccRec, type SpellBookRec, type UnitRec,
} from "./types";
import { CListWord } from "./mfc";

/** 0x582c40 (CRT abs, cdecl). */
function crtAbs(v: number): number {
  return (v < 0 ? -v : v) | 0;
}

function costAt(m: MapRec, off: number): number {
  return m.cost[(off - PATH_COST_OFF) >> 1];
}

function setCostAt(m: MapRec, off: number, v: number): void {
  m.cost[(off - PATH_COST_OFF) >> 1] = v;
}

/** `_memset(this + off, 0xff, n)` (0x5827b0). */
function memsetFF(m: MapRec, off: number, n: number): void {
  if (off < 0 || off + n > m.mem.length) throw new Error(`memset fora do MapRec: +0x${off.toString(16)} n=0x${n.toString(16)}`);
  m.mem.fill(0xff, off, off + n);
}

// ---------------------------------------------------------------------------------------------------------------- ondas

/**
 * Corpo de 0x55d010/0x55d830/0x55e050/0x55e870: relaxa os 8 vizinhos da célula `from` (diagonais −0x101, −0xff, +0xff, +0x101
 * e depois ortogonais −0x100, −1, +1, +0x100; índices u16). Vizinho com (grade[v] & mask) == 0: custo = custo[from] + 3
 * (diagonal) / + 2 (ortogonal), ou, com `useCost`, custo[from] + passo[v] (+ passo[v]>>1 na diagonal); se menor (sem sinal,
 * 16 bits) que custo[v], grava e empilha v na fila (`qOff`, contagem em `nOff`).
 */
function wave1(m: MapRec, from: number, mask: number, useCost: number, gridOff: number, nOff: number, qOff: number): void {
  const p2 = from & 0xffff;
  const msk = mask & 0xff;
  const step = (d: number, diag: boolean): void => {
    const v = (p2 + d) & 0xffff;
    if ((m.mem[v + gridOff] & msk) !== 0) return;
    let c: number;
    if (useCost === 0) c = m.cost[p2] + (diag ? 3 : 2);
    else {
      const b = m.mem[v];
      c = diag ? m.cost[p2] + b + (b >> 1) : m.cost[p2] + b;
    }
    c &= 0xffff;
    if (c < m.cost[v]) {
      m.cost[v] = c;
      const n = m.u16(nOff);
      m.setU16(qOff + n * 2, v);
      m.setU16(nOff, n + 1);
    }
  };
  step(-0x101, true);
  step(-0xff, true);
  step(0xff, true);
  step(0x101, true);
  step(-0x100, false);
  step(-1, false);
  step(1, false);
  step(0x100, false);
}

/** 0x55d010 Path_WaveStaticAtoB (thiscall, ret 0x10): onda na grade estática (+0x10000), empilha na fila B. */
export function pathWaveStaticAtoB(m: MapRec, _u: UnitRec, from: number, mask: number, useCost: number): void {
  wave1(m, from, mask, useCost, MAP_MASK_OFF, MAP_QB_N_OFF, MAP_QB_OFF);
}

/** 0x55d830 Path_WaveStaticBtoA (thiscall, ret 0x10): onda na grade estática, empilha na fila A. */
export function pathWaveStaticBtoA(m: MapRec, _u: UnitRec, from: number, mask: number, useCost: number): void {
  wave1(m, from, mask, useCost, MAP_MASK_OFF, MAP_QA_N_OFF, MAP_QA_OFF);
}

/** 0x55e050 Path_WaveDynamicAtoB (thiscall, ret 0x10): onda na grade dinâmica (+0x20000), empilha na fila B. */
export function pathWaveDynamicAtoB(m: MapRec, _u: UnitRec, from: number, mask: number, useCost: number): void {
  wave1(m, from, mask, useCost, FLAGS_OFF, MAP_QB_N_OFF, MAP_QB_OFF);
}

/** 0x55e870 Path_WaveDynamicBtoA (thiscall, ret 0x10): onda na grade dinâmica, empilha na fila A. */
export function pathWaveDynamicBtoA(m: MapRec, _u: UnitRec, from: number, mask: number, useCost: number): void {
  wave1(m, from, mask, useCost, FLAGS_OFF, MAP_QA_N_OFF, MAP_QA_OFF);
}

/**
 * Corpo de 0x55c440/0x55cd50: 1 se nenhuma célula do quadrado lado×lado a partir de `cell` tem (grade & máscara de passagem
 * da unidade) ≠ 0. Lado lido uma vez (slot +0x1c); x (local_c) por fora, y por dentro.
 */
function footprintFree(m: MapRec, u: UnitRec, cell: number, gridIdxOff: (idx: number) => number): number {
  const uVar2 = vtGetSize(u);
  for (let lc = 0; ; lc++) {
    if ((uVar2 & 0xff) <= lc) return 1;
    for (let l10 = 0; l10 < (uVar2 & 0xff); l10++) {
      const b = u.walk.passMask & 0xff;
      const off = gridIdxOff(l10 * 0x100 + lc + (cell & 0xffff));
      if (unitPassMaskAnd(m.mem[off], b) !== 0) return 0;
    }
  }
}

/** 0x55c440 Path_TargetFree (thiscall, ret 8): pegada livre na grade estática (+0x10000). */
export function pathTargetFree(m: MapRec, u: UnitRec, cell: number): number {
  return footprintFree(m, u, cell, cellIdxOff10000);
}

/** 0x55cd50 (thiscall, ret 8): pegada livre na grade dinâmica (+0x20000). */
export function fn_0x55cd50(m: MapRec, u: UnitRec, cell: number): number {
  return footprintFree(m, u, cell, cellIdxOff20000);
}

/**
 * Corpo de 0x55c6f0/0x55c910/0x55cb30/0x55cdf0 (unidade grande): para os 9 deslocamentos (dx por fora, dy por dentro, incluindo
 * (0,0)) com pegada livre em (x+dx, y+dy): custo = custo(x,y) + passo(viz) [tipo 1] ou + 2 nos ortogonais; + passo + passo>>1
 * [tipo 1] ou + 3 nas diagonais; se menor que custo(viz), grava e empilha (x,y) do vizinho nas filas de bytes.
 */
function waveBig(m: MapRec, u: UnitRec, x: number, y: number, free: (m: MapRec, u: UnitRec, cell: number) => number,
                 nOff: number, qxOff: number, qyOff: number): void {
  const p2 = x & 0xff, p3 = y & 0xff;
  for (let l10 = -1; l10 < 2; l10++) {
    for (let l14 = -1; l14 < 2; l14++) {
      if (free(m, u, (p3 + l14) * 0x100 + p2 + l10) === 0) continue;
      const ny = (p3 + l14) & 0xff;   // local_8
      const nx = (p2 + l10) & 0xff;   // local_18
      let c: number;
      if (l10 === 0 || l14 === 0) {
        if (fn_0x55f330(u) === 1) {
          const s = costAt(m, pathCostCellOff(m, p2, p3));
          c = s + m.mem[cellOff00000(nx, ny)];
        } else {
          c = costAt(m, pathCostCellOff(m, p2, p3)) + 2;
        }
      } else if (fn_0x55f330(u) === 1) {
        const s = costAt(m, pathCostCellOff(m, p2, p3));
        const b = m.mem[cellOff00000(nx, ny)];
        c = s + b + (m.mem[cellOff00000(nx, ny)] >> 1);
      } else {
        c = costAt(m, pathCostCellOff(m, p2, p3)) + 3;
      }
      c &= 0xffff;
      if (c < costAt(m, pathCostCellOff(m, nx, ny))) {
        setCostAt(m, pathCostCellOff(m, nx, ny), c);
        const n = m.u16(nOff);
        m.mem[qxOff + n] = nx;
        m.mem[qyOff + n] = ny;
        m.setU16(nOff, n + 1);
      }
    }
  }
}

/** 0x55c6f0 (thiscall, ret 0xc): onda de unidade grande na grade estática (0x55c440), empilha na fila B. */
export function fn_0x55c6f0(m: MapRec, u: UnitRec, x: number, y: number): void {
  waveBig(m, u, x, y, pathTargetFree, MAP_QB_N_OFF, MAP_QB_X_OFF, MAP_QB_Y_OFF);
}

/** 0x55c910 (thiscall, ret 0xc): idem, empilha na fila A. */
export function fn_0x55c910(m: MapRec, u: UnitRec, x: number, y: number): void {
  waveBig(m, u, x, y, pathTargetFree, MAP_QA_N_OFF, MAP_QA_X_OFF, MAP_QA_Y_OFF);
}

/** 0x55cb30 (thiscall, ret 0xc): onda de unidade grande na grade dinâmica (0x55cd50), empilha na fila B. */
export function fn_0x55cb30(m: MapRec, u: UnitRec, x: number, y: number): void {
  waveBig(m, u, x, y, fn_0x55cd50, MAP_QB_N_OFF, MAP_QB_X_OFF, MAP_QB_Y_OFF);
}

/** 0x55cdf0 (thiscall, ret 0xc): idem, empilha na fila A. */
export function fn_0x55cdf0(m: MapRec, u: UnitRec, x: number, y: number): void {
  waveBig(m, u, x, y, fn_0x55cd50, MAP_QA_N_OFF, MAP_QA_X_OFF, MAP_QA_Y_OFF);
}

// ------------------------------------------------------------------------------------------------------------ backtrace

/** Prefixo da exceção do caso indefinido do backtrace (deslocamento lido de locais não inicializados). */
export const BACKTRACE_UB = "0x54e886/0x54e58c: lixo de pilha";

/**
 * Corpo de 0x54e886/0x54e58c: do alvo (tx,ty) à origem (x0,y0) pelo vizinho de menor custo, pondo cada célula na CABEÇA da
 * lista (a lista fica origem → alvo). Vizinhos dentro de [8, largura+8]×[8, altura+8], dx por fora e dy por dentro, (0,0)
 * incluído. Ortogonal: custo(viz) + passo da célula ATUAL [tipo 1] ou + 2, aceita com ≤ (o último empate fica); diagonal:
 * custo(viz) + passo(atual) + passo(atual)>>1 [tipo 1] ou + 3, aceita com <. Custo 0xffff = não alcançado (pula). Mais de
 * 1000 passos: esvazia a lista; senão tira a cabeça (a própria origem). Se no 1º passo nenhum vizinho serve, o exe anda
 * pelo conteúdo não inicializado de [ebp-0xc]/[ebp-0x10] (lixo da pilha das chamadas anteriores): indefinido, não reproduzível
 * aqui; a porta lança `BACKTRACE_UB` (nos pares do corpus não ocorre; na varredura, só com o alvo alternativo fora da borda).
 */
function backtrace(m: MapRec, u: UnitRec, list: CListWord, x0: number, y0: number, tx: number, ty: number): void {
  let steps = 0;                                  // word [ebp-0x24]
  list.addHead(cellIndex(tx, ty));
  let cx = tx & 0xff;                             // byte [ebp-0x14]
  let cy = ty & 0xff;                             // byte [ebp-0x1c]
  let bdx = 0, bdy = 0;                           // [ebp-0xc], [ebp-0x10]: não inicializados no exe até a 1ª escolha
  let chosen = false;
  while (cx !== (x0 & 0xff) || cy !== (y0 & 0xff)) {
    let best = 0xffff;                            // word [ebp-4]
    steps = (steps + 1) & 0xffff;
    if (steps > 1000) break;
    if (steps === 2 && !chosen) {
      // Nenhum vizinho no 1º passo (alvo fora de [8, lado+8] e vizinhos não alcançados): o exe soma lixo de pilha a (x,y).
      throw new Error(`${BACKTRACE_UB}: (${tx},${ty}) sem vizinho no 1º passo`);
    }
    for (let dx = -1; dx < 2; dx++) {             // char [ebp-0x18]
      for (let dy = -1; dy < 2; dy++) {           // char [ebp-0x20]
        const nx = cx + dx;                       // [ebp-0x28]
        const ny = cy + dy;                       // [ebp-8]
        if (nx < 8 || nx > m.i32(MAP_WIDTH_OFF) + 8 || ny < 8 || ny > m.i32(MAP_HEIGHT_OFF) + 8) continue;
        if (dx === 0 || dy === 0) {
          let c = costAt(m, pathCostCellOff(m, nx & 0xff, ny & 0xff));
          if (c === 0xffff) continue;
          if (fn_0x55f330(u) === 1) c = (c + m.mem[cellOff00000(cx, cy)]) & 0xffff;
          else c = (c + 2) & 0xffff;
          if (c <= best) { best = c; bdx = dx; bdy = dy; chosen = true; }
        } else {
          let c = costAt(m, pathCostCellOff(m, nx & 0xff, ny & 0xff));
          if (c === 0xffff) continue;
          if (fn_0x55f330(u) === 1) {
            c = (c + m.mem[cellOff00000(cx, cy)]) & 0xffff;
            c = (c + (m.mem[cellOff00000(cx, cy)] >> 1)) & 0xffff;
          } else c = (c + 3) & 0xffff;
          if (c < best) { best = c; bdx = dx; bdy = dy; chosen = true; }
        }
      }
    }
    cx = (cx + bdx) & 0xff;
    cy = (cy + bdy) & 0xff;
    list.addHead(cellIndex(cx, cy));
  }
  if (steps > 1000) list.removeAll();
  else list.removeHead();
}

/** 0x54e886 Path_BacktraceDynamic (thiscall, ret 0x14): volta para a lista dinâmica (unidade+0x1e4). */
export function pathBacktraceDynamic(m: MapRec, u: UnitRec, x0: number, y0: number, tx: number, ty: number): void {
  backtrace(m, u, u.pathDynamic, x0, y0, tx, ty);
}

/** 0x54e58c Path_BacktraceStatic (thiscall, ret 0x14): volta para a lista estática (unidade+0x1c8). */
export function pathBacktraceStatic(m: MapRec, u: UnitRec, x0: number, y0: number, tx: number, ty: number): void {
  backtrace(m, u, u.pathStatic, x0, y0, tx, ty);
}

// ------------------------------------------------------------------------------------------------ pegada e ocupação

/**
 * 0x55c5a0 Unit_FootprintCheck (thiscall, ret 0xc): 1 se nenhuma célula do quadrado lado×lado com canto em `cell` tem
 * (grade & máscara de passagem) ≠ 0; grade dinâmica (+0x20000) com `useStatic` 0, estática (+0x10000) senão.
 */
export function unitFootprintCheck(m: MapRec, u: UnitRec, cell: number, useStatic: number): number {
  const size = vtGetSize(u) & 0xff;
  const x = cell & 0xff;
  const y = (cell >> 8) & 0xff;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const b = u.walk.passMask & 0xff;
      const off = useStatic === 0 ? cellOff20000(x + i, y + j) : cellOff10000(x + i, y + j);
      if (unitPassMaskAnd(m.mem[off], b) !== 0) return 0;
    }
  }
  return 1;
}

/** 0x5563ca (thiscall, ret 4): pegada livre na célula atual nas duas grades (dinâmica e depois estática). */
export function fn_0x5563ca(m: MapRec, u: UnitRec): number {
  let r = unitFootprintCheck(m, u, mapObjCellOf(u.mapObj), 0);
  if (r !== 0) {
    r = unitFootprintCheck(m, u, mapObjCellOf(u.mapObj), 1);
    if (r !== 0) return 1;
  }
  return 0;
}

/** 0x55f350 (thiscall): devolve 1 (método vazio de um objeto da célula). */
export function fn_0x55f350(): number {
  return 1;
}

/** 0x550ed5 (thiscall, ret 4): lê o bit 0x80 da grade dinâmica da célula e descarta. */
export function fn_0x550ed5(m: MapRec, cell: number): void {
  unitPassMaskAnd(m.mem[cellIdxOff20000(cell)], 0x80);
}

/** 0x550e12 (thiscall, ret 4): marca o bit 0x80 na grade dinâmica da célula. */
export function fn_0x550e12(m: MapRec, cell: number): void {
  fn_0x550ed5(m, cell);
  orMaskInto(m.mem, cellIdxOff20000(cell), 0x80);
}

/**
 * 0x550a96 (thiscall, ret 4): reaplica um registro de ocupação `r` às grades da sua célula (r+0x3a): estática ← r[1] | 0x20,
 * passo ← r[0], dinâmica ← estática; +0x40 se há unidade (r+0x2c), +0x80 se há unidade de tipo 3 (r+0x30); estrutura (r+0xc):
 * pelo bit da célula na máscara dela, | 5 nas duas grades ou & 0xfa e passo padrão; cada objeto em r+0x14..+0x28 quadruplica o
 * passo (byte); r+0x20 bloqueia (| 5); o bit 0x10 que a célula já tinha na grade estática é mantido nas duas.
 */
export function fn_0x550a96(m: MapRec, r: OccRec): void {
  const cell = (r.b[0x3a] | (r.b[0x3b] << 8)) & 0xffff;
  const bVar1 = m.mem[cell + MAP_MASK_OFF];
  m.mem[cellIdxOff10000(cell)] = r.b[1];
  m.mem[cellIdxOff00000(cell)] = r.b[0];
  orMaskInto(m.mem, cellIdxOff10000(cell), 0x20);
  m.mem[cellIdxOff20000(cell)] = m.mem[cellIdxOff10000(cell)];
  if (r.u32(0x2c) !== 0) cellFlagMark40(m, cell);
  if (r.u32(0x30) !== 0) fn_0x550e12(m, cell);
  if (r.u32(0xc) !== 0) {
    const s = m.structAt(r.u32(0xc));
    const sy = mapObjCellY(s.mapObj) & 0xff;
    const w = s.width & 0xff;
    const sx = mapObjCellX(s.mapObj) & 0xff;
    const bit = (Math.imul(((cell >> 8) & 0xff) - sy, w) + ((cell & 0xff) - sx)) & 0x1f;
    if (((s.cellMask >>> 0) & (1 << bit)) === 0) {
      m.mem[cell + MAP_MASK_OFF] &= 0xfa;
      m.mem[cell + FLAGS_OFF] &= 0xfa;
      m.mem[cell] = m.mem[MAP_DEFAULT_COST_OFF];
    } else {
      m.mem[cell + MAP_MASK_OFF] |= 5;
      m.mem[cell + FLAGS_OFF] |= 5;
    }
  }
  for (let i = 0; i < 6; i++) {
    if (r.u32(i * 4 + 0x14) !== 0) {
      if (fn_0x55f350() !== 0) m.mem[cell] = (m.mem[cell] << 2) & 0xff;
    }
  }
  if (r.u32(0x20) !== 0) {
    m.mem[cell + MAP_MASK_OFF] |= 5;
    m.mem[cell + FLAGS_OFF] |= 5;
  }
  if ((bVar1 & 0x10) !== 0) {
    m.mem[cell + MAP_MASK_OFF] |= 0x10;
    m.mem[cell + FLAGS_OFF] |= 0x10;
  }
}

/** 0x550a53 (thiscall, ret 4): se a célula tem registro de ocupação, reaplica-o às grades (0x550a96). */
export function fn_0x550a53(m: MapRec, cell: number): void {
  if (m.occ.lookup(cell, m.occCur)) fn_0x550a96(m, m.occCur);
}

/**
 * 0x550966 (thiscall, ret 4): desfaz o registro de ocupação da célula: devolve passo e máscara estática guardados (r[0], r[1]),
 * tira a chave do CMap e mantém o bit 0x10 que a célula tinha. 1 se havia registro.
 */
export function fn_0x550966(m: MapRec, cell: number): number {
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  const bVar1 = m.mem[(cell & 0xffff) + MAP_MASK_OFF];
  m.mem[cellIdxOff00000(cell)] = m.occCur.b[0];
  m.mem[cellIdxOff10000(cell)] = m.occCur.b[1];
  m.occ.removeKey(cell);
  if ((bVar1 & 0x10) !== 0) {
    m.mem[(cell & 0xffff) + MAP_MASK_OFF] |= 0x10;
    m.mem[(cell & 0xffff) + FLAGS_OFF] |= 0x10;
  }
  return 1;
}

/**
 * 0x5508a0 (thiscall, ret 4): cria o registro de ocupação da célula se não existe: zera o corrente, guarda passo e máscara
 * estática da célula (r[0], r[1]) e a célula (r+0x3a), grava no CMap e marca 0x20 na grade estática.
 */
export function fn_0x5508a0(m: MapRec, cell: number): void {
  const r = m.occCur;
  if (!m.occ.lookup(cell, r)) {
    occRecCopy(r, r);
    occRecClear(r);
    r.b[0] = m.mem[cellIdxOff00000(cell)];
    r.b[1] = m.mem[cellIdxOff10000(cell)];
    r.b[0x3a] = cell & 0xff;
    r.b[0x3b] = (cell >> 8) & 0xff;
    m.occ.setAt(cell, r);
    orMaskInto(m.mem, cellIdxOff10000(cell), 0x20);
  }
}

/** Ponteiro de unidade em MapRec+off (u32 do registro corrente) é `u`? */
function occUnitIs(m: MapRec, off: number, u: UnitRec): boolean {
  return m.u32(off) === (u.addr >>> 0);
}

/**
 * 0x55c1fe (thiscall, ret 8): tira a unidade do registro de ocupação da célula (se a célula tem registro): zera o ponteiro
 * dela (+0x30 se tipo 3, +0x2c senão), reaplica às grades, grava, e desfaz o registro se ficou vazio.
 */
export function fn_0x55c1fe(m: MapRec, u: UnitRec, cell: number): void {
  const r = m.occCur;
  if ((m.mem[(cell & 0xffff) + MAP_MASK_OFF] & 0x20) !== 0 && m.occ.lookup(cell, r)) {
    if (fn_0x55f330(u) === 3) {
      if (occUnitIs(m, MAP_OCC_UNIT3_OFF, u)) m.setU32(MAP_OCC_UNIT3_OFF, 0);
    } else if (occUnitIs(m, MAP_OCC_UNIT_OFF, u)) {
      m.setU32(MAP_OCC_UNIT_OFF, 0);
    }
    fn_0x550a96(m, r);
    m.occ.setAt(cell, r);
    if (occRecIsEmpty(r) !== 0) fn_0x550966(m, cell);
  }
}

/**
 * 0x55c2ce (thiscall, ret 8): põe a unidade no registro de ocupação da célula (criando-o com 0x5508a0 se preciso). Se o
 * lugar (+0x30 tipo 3 / +0x2c) já tem OUTRA unidade, não faz nada; senão grava a unidade, reaplica às grades e grava.
 */
export function fn_0x55c2ce(m: MapRec, u: UnitRec, cell: number): void {
  const r = m.occCur;
  if ((m.mem[(cell & 0xffff) + MAP_MASK_OFF] & 0x20) === 0 || !m.occ.lookup(cell, r)) {
    fn_0x5508a0(m, cell);
    if (!m.occ.lookup(cell, r)) return;
  }
  if (fn_0x55f330(u) === 3) {
    if (m.u32(MAP_OCC_UNIT3_OFF) !== 0 && !occUnitIs(m, MAP_OCC_UNIT3_OFF, u)) return;
    m.setU32(MAP_OCC_UNIT3_OFF, u.addr);
  } else {
    if (m.u32(MAP_OCC_UNIT_OFF) !== 0 && !occUnitIs(m, MAP_OCC_UNIT_OFF, u)) return;
    m.setU32(MAP_OCC_UNIT_OFF, u.addr);
  }
  fn_0x550a96(m, r);
  m.occ.setAt(cell, r);
}

/**
 * 0x55be86 (thiscall, ret 0xc): marca a pegada da unidade no mapa de ocupação. Rascunho 8×8 em this+0xa452c (índice x*8+y,
 * área (lado+2)² a partir de (célula atual − 1)): 1 = tirar; com `mode` 0, a pegada na célula `cell` vira 2 (pôr); com `mode`
 * ≠ 2, a pegada atual vira 3 (pôr). Percorre o quadrado chamando 0x55c1fe (1) ou 0x55c2ce (2, 3) e guarda em andar+0x80 a
 * célula marcada (`cell`, a atual, ou 0 para `mode` 2). O lado é relido do slot +0x1c a cada teste de laço, como no exe.
 */
export function fn_0x55be86(m: MapRec, u: UnitRec, cell: number, mode: number): void {
  const p2 = cell >>> 0;
  const md = mode & 0xff;
  vtGetSize(u);
  m.mem.fill(0, MAP_FOOT_OFF, MAP_FOOT_OFF + 0x40);
  for (let lc = 0; lc < (vtGetSize(u) & 0xff) + 2; lc++) {
    for (let l10 = 0; l10 < (vtGetSize(u) & 0xff) + 2; l10++) m.mem[MAP_FOOT_OFF + l10 + lc * 8] = 1;
  }
  if (md === 0) {
    const bVar5 = mapObjCellX(u.mapObj) & 0xff;
    const bVar6 = mapObjCellY(u.mapObj) & 0xff;
    for (let lc = 1; lc < (vtGetSize(u) & 0xff) + 1; lc++) {
      for (let l10 = 1; l10 < (vtGetSize(u) & 0xff) + 1; l10++) {
        const off = MAP_FOOT_OFF + l10 + (((p2 & 0xffff) >> 8) - bVar6) + (lc + ((p2 & 0xff) - bVar5)) * 8;
        if (off < 0 || off >= m.mem.length) throw new Error(`0x55be86: escrita fora do MapRec (+0x${off.toString(16)})`);
        m.mem[off] = 2;
      }
    }
  }
  if (md !== 2) {
    for (let lc = 1; lc < (vtGetSize(u) & 0xff) + 1; lc++) {
      for (let l10 = 1; l10 < (vtGetSize(u) & 0xff) + 1; l10++) m.mem[MAP_FOOT_OFF + l10 + lc * 8] = 3;
    }
  }
  const sVar2 = ((mapObjCellX(u.mapObj) & 0xff) - 1) << 16 >> 16;
  const sVar4 = ((mapObjCellY(u.mapObj) & 0xff) - 1) << 16 >> 16;
  for (let lc = 0; lc < (vtGetSize(u) & 0xff) + 2; lc++) {
    for (let l10 = 0; l10 < (vtGetSize(u) & 0xff) + 2; l10++) {
      const c = ((l10 + sVar4) * 0x100 + lc + sVar2) & 0xffff;
      switch (m.mem[MAP_FOOT_OFF + l10 + lc * 8]) {
        case 0: break;
        case 1: fn_0x55c1fe(m, u, c); break;
        case 2: fn_0x55c2ce(m, u, c); break;
        case 3: fn_0x55c2ce(m, u, c); break;
      }
    }
  }
  if (md === 0) u.walk.footCell = p2 & 0xffff;
  else if (md === 1) u.walk.footCell = mapObjCellOf(u.mapObj);
  else if (md === 2) u.walk.footCell = 0;
}

/** 0x551edb (thiscall, ret 4): unidade (u32, occCur+4) do registro de ocupação da célula, ou 0. */
export function fn_0x551edb(m: MapRec, cell: number): number {
  if ((m.mem[(cell & 0xffff) + MAP_MASK_OFF] & 0x20) === 0) return 0;
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  return m.occCur.u32(4) >>> 0;
}

/** 0x559bc9 (thiscall, ret 4): estrutura (u32, occCur+0xc) do registro de ocupação da célula, ou 0. */
export function fn_0x559bc9(m: MapRec, cell: number): number {
  if ((m.mem[(cell & 0xffff) + MAP_MASK_OFF] & 0x20) === 0) return 0;
  if (!m.occ.lookup(cell, m.occCur)) return 0;
  return m.occCur.u32(0xc) >>> 0;
}

// ------------------------------------------------------------------------------------------------------------- alcance

/** 0x558fe9 AI_TeleportTargetDist (stdcall, ret 8): max(|Δx|, |Δy|) entre duas células (índices); devolve AL. */
export function aiTeleportTargetDist(a: number, b: number): number {
  const dx = crtAbs((a & 0xff) - (b & 0xff)) & 0xff;
  const dy = crtAbs((((a & 0xffff) >> 8) & 0xff) - (((b & 0xffff) >> 8) & 0xff)) & 0xff;
  return dx > dy ? dx : dy;
}

/**
 * 0x556f56 (stdcall, ret 0xc): distância por eixo da célula `a` ao quadrado lado×`size` com canto em `b` (0 dentro dele no
 * eixo), o maior dos dois eixos; devolve AL.
 */
export function fn_0x556f56(a: number, b: number, size: number): number {
  const ax = a & 0xff, bx = b & 0xff;
  const ay = ((a & 0xffff) >> 8) & 0xff, by = ((b & 0xffff) >> 8) & 0xff;
  let dx: number, dy: number;
  if (ax < bx) {
    dx = (bx - ax - (size & 0xff) + 1) | 0;
    if (dx < 0) dx = 0;
  } else dx = ax - bx;
  if (ay < by) {
    dy = (by - ay - (size & 0xff) + 1) | 0;
    if (dy < 0) dy = 0;
  } else dy = ay - by;
  return dx > dy ? dx & 0xff : dy & 0xff;
}

/** 0x51c391 Unit_GetBookSpell (thiscall, ret 4): magia `idx` do livro (null se fora ou vazia); guarda `idx` em +0x18. */
export function unitGetBookSpell(book: SpellBookRec, idx: number): BookSpellRec | null {
  if ((idx | 0) < book.spells.length) {
    if (book.spells[idx] === null) return null;
    book.last = idx | 0;
    return book.spells[idx];
  }
  return null;
}

/** 0x56ac5b AI_AttackRange (cdecl): alcance da magia escolhida se há mana para ela, senão o alcance da unidade (+0x12c); AL. */
export function aiAttackRange(u: UnitRec): number {
  if ((u.ai.spellSlot & 0xff) !== 0) {
    const s = unitGetBookSpell(u.book, u.ai.spellSlot & 0xff);
    if (s !== null && ((s.cost << 16) >> 16) <= ((u.mana << 16) >> 16)) return s.range & 0xff;
  }
  return u.attackRange & 0xff;
}

// --------------------------------------------------------------------------------------------------------------- busca

/**
 * 0x54d76e Path_WaveSearch (thiscall, ret 0x1c): inundação de (fx,fy) até (tx,ty) e caminho de volta para a lista da
 * unidade. `isStatic` ≠ 0: grade estática e lista +0x1c8 (esvaziada antes); 0: grade dinâmica, lista +0x1e4, com a pegada da
 * própria unidade tirada do mapa durante a onda (0x55be86 modo 2 e depois 1). Unidade de lado 1: ondas por índice limitadas
 * a dist + max(dist>>2, ondas extras) passos duplos (1000 se o alvo é livre na grade estática e o dono tem +0x2c = 0), com o
 * custo apagado só numa faixa ±(passos*257+0x200) em volta da origem; lado > 1: ondas por (x,y) com a grade inteira apagada.
 * Alvo não alcançado: célula alternativa por 0x5585f4 (anel) ou, na dinâmica com `target`, por 0x557f08 (aproximação).
 */
export function pathWaveSearch(m: MapRec, u: UnitRec, fx: number, fy: number, tx: number, ty: number, isStatic: number,
                               target: UnitRec | null): void {
  const p2 = fx & 0xff, p3 = fy & 0xff, p4 = tx & 0xff, p5 = ty & 0xff;
  let uVar16 = 0;                                     // word [ebp-0x14]
  const uVar4 = ((p5 << 8) + p4) & 0xffff;            // word [ebp-8] célula-alvo
  const uVar7 = vtGetSize(u) & 0xff;                  // [ebp-4]
  if (isStatic !== 0) u.pathStatic.removeAll();
  const uVar15 = gridChebyshevDist(p2, p3, p4, p5) & 0xffff; // word [ebp-0x18]
  if (p2 === p4 && p3 === p5) return;
  m.setU16(MAP_QA_N_OFF, 0);
  m.setU16(MAP_QB_N_OFF, 0);
  m.mem[MAP_QA_X_OFF + m.u16(MAP_QA_N_OFF)] = p2;
  m.mem[MAP_QA_Y_OFF + m.u16(MAP_QA_N_OFF)] = p3;
  m.setU16(MAP_QA_N_OFF, m.u16(MAP_QA_N_OFF) + 1);
  if (isStatic !== 0) {
    if (uVar7 === 1) {
      m.setU16(MAP_QA_OFF, (p3 << 8) + p2);
      const mask = u.walk.passMask & 0xff;            // [ebp-0x28]
      const useCost = fn_0x55f330(u) === 1 ? 1 : 0;   // [ebp-0xc]
      let lim: number;                                // word [ebp-0x24]
      if ((uVar15 >> 2) > m.i32(MAP_WAVES_STATIC_OFF)) lim = (uVar15 + (uVar15 >> 2)) & 0xffff;
      else lim = (uVar15 + m.i32(MAP_WAVES_STATIC_OFF)) & 0xffff;
      if (u.owner.f2c === 0 && pathTargetFree(m, u, (p5 << 8) + p4) !== 0) {
        lim = 1000;
        memsetFF(m, PATH_COST_OFF, 0x20000);
        setCostAt(m, pathCostCellOff(m, p2, p3), 0);
      } else {
        clearCostBand(m, p2, p3, lim);
        setCostAt(m, pathCostCellOff(m, p2, p3), 0);
      }
      while (m.cost[uVar4] === 0xffff && m.u16(MAP_QA_N_OFF) !== 0 && uVar16 < lim) {
        m.setU16(MAP_QB_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QA_N_OFF); i++) pathWaveStaticAtoB(m, u, m.u16(MAP_QA_OFF + i * 2), mask, useCost);
        uVar16 = (uVar16 + 1) & 0xffff;
        m.setU16(MAP_QA_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QB_N_OFF); i++) pathWaveStaticBtoA(m, u, m.u16(MAP_QB_OFF + i * 2), mask, useCost);
        uVar16 = (uVar16 + 1) & 0xffff;
      }
    } else {
      memsetFF(m, PATH_COST_OFF, 0x20000);
      setCostAt(m, pathCostCellOff(m, p2, p3), 0);
      while (costAt(m, pathCostCellOff(m, p4, p5)) === 0xffff && m.u16(MAP_QA_N_OFF) > 0 &&
             uVar16 < uVar15 + m.i32(MAP_WAVES_STATIC_OFF)) {
        m.setU16(MAP_QB_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QA_N_OFF); i++) fn_0x55c6f0(m, u, m.mem[MAP_QA_X_OFF + i], m.mem[MAP_QA_Y_OFF + i]);
        uVar16 = (uVar16 + 1) & 0xffff;
        m.setU16(MAP_QA_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QB_N_OFF); i++) fn_0x55c910(m, u, m.mem[MAP_QB_X_OFF + i], m.mem[MAP_QB_Y_OFF + i]);
        uVar16 = (uVar16 + 1) & 0xffff;
      }
    }
  } else {
    if (u.walk.footCell !== 0) mapObjCellOf(u.mapObj);
    fn_0x55be86(m, u, mapObjCellOf(u.mapObj), 2);
    if (uVar7 === 1) {
      m.setU16(MAP_QA_OFF, (p3 << 8) + p2);
      const mask = u.walk.passMask & 0xff;
      const useCost = fn_0x55f330(u) === 1 ? 1 : 0;
      let lim: number;
      if ((uVar15 >> 2) > m.i32(MAP_WAVES_DYNAMIC_OFF)) lim = (uVar15 + (uVar15 >> 2)) & 0xffff;
      else lim = (uVar15 + m.i32(MAP_WAVES_DYNAMIC_OFF)) & 0xffff;
      clearCostBand(m, p2, p3, lim);
      setCostAt(m, pathCostCellOff(m, p2, p3), 0);
      while (m.cost[uVar4] === 0xffff && m.u16(MAP_QA_N_OFF) !== 0 && uVar16 < lim) {
        m.setU16(MAP_QB_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QA_N_OFF); i++) pathWaveDynamicAtoB(m, u, m.u16(MAP_QA_OFF + i * 2), mask, useCost);
        uVar16 = (uVar16 + 1) & 0xffff;
        m.setU16(MAP_QA_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QB_N_OFF); i++) pathWaveDynamicBtoA(m, u, m.u16(MAP_QB_OFF + i * 2), mask, useCost);
        uVar16 = (uVar16 + 1) & 0xffff;
      }
    } else {
      memsetFF(m, PATH_COST_OFF, 0x20000);
      setCostAt(m, pathCostCellOff(m, p2, p3), 0);
      while (costAt(m, pathCostCellOff(m, p4, p5)) === 0xffff && m.u16(MAP_QA_N_OFF) > 0 &&
             uVar16 < uVar15 + m.i32(MAP_WAVES_DYNAMIC_OFF)) {
        m.setU16(MAP_QB_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QA_N_OFF); i++) fn_0x55cb30(m, u, m.mem[MAP_QA_X_OFF + i], m.mem[MAP_QA_Y_OFF + i]);
        uVar16 = (uVar16 + 1) & 0xffff;
        m.setU16(MAP_QA_N_OFF, 0);
        for (let i = 0; i < m.u16(MAP_QB_N_OFF); i++) fn_0x55cdf0(m, u, m.mem[MAP_QB_X_OFF + i], m.mem[MAP_QB_Y_OFF + i]);
        uVar16 = (uVar16 + 1) & 0xffff;
      }
    }
    fn_0x55be86(m, u, mapObjCellOf(u.mapObj), 1);
  }
  if (costAt(m, pathCostCellOff(m, p4, p5)) !== 0xffff) {
    if (isStatic !== 0) pathBacktraceStatic(m, u, p2, p3, p4, p5);
    else pathBacktraceDynamic(m, u, p2, p3, p4, p5);
    return;
  }
  if (isStatic !== 0) {
    const to = ((p5 << 8) + p4) & 0xffff;              // word [ebp-0x10]
    const alt = pathUnlabeledTargetRing(m, u, 0, to, (uVar15 >> 2) + 4) & 0xffff; // word [ebp-0x1c]
    if (fn_0x559bc9(m, to) !== 0) {
      if (aiTeleportTargetDist(alt, to) > 2) { /* stub: cliente (0x5052d2 Server_SendMsg92(0x6831a8, 1, 0, dono)) */ }
    } else if (aiTeleportTargetDist(alt, to) > 1) { /* stub: cliente (0x5052d2 Server_SendMsg92(0x6831a8, 1, 0, dono)) */ }
    if ((u.type.stats.f20 & 0xff) === 0x12 && (u.ai.task & 0xff) === 5) {
      const d = fn_0x556f56(alt, to, vtGetSize(u)) & 0xff;
      if (d > (aiAttackRange(u) & 0xff)) u.ai.f16 = EXE_GLOBALS.w6044c4;
    }
    if (alt === 0) u.pathStatic.removeAll();
    else pathBacktraceStatic(m, u, p2, p3, alt & 0xff, (alt >> 8) & 0xff);
    return;
  }
  let alt: number;
  if (target === null) alt = pathUnlabeledTargetRing(m, u, 0, ((p5 << 8) + p4) & 0xffff, 8) & 0xffff;
  else alt = unitApproachCell(m, u, target) & 0xffff;
  if (alt !== 0) pathBacktraceDynamic(m, u, p2, p3, alt & 0xff, (alt >> 8) & 0xff);
}

/** Faixa apagada da onda de 1 célula: custo ← 0xffff em [max(o−d,0), min(o+d,0x10000)) com d = lim*0x100 + lim + 0x200. */
function clearCostBand(m: MapRec, x: number, y: number, lim: number): void {
  const o = (y << 8) + x;
  const d = (lim & 0xffff) * 0x100 + 0x200 + (lim & 0xffff);
  const lo = o - d > 0 ? o - d : 0;
  const hi = ((o + d) >>> 0) < 0x10000 ? o + d : 0x10000;
  memsetFF(m, PATH_COST_OFF + lo * 2, hi * 2 - lo * 2);
}

/** 0x54d72d (fastcall, ret 0x14): Path_WaveSearch a partir da célula atual da unidade. */
export function fn_0x54d72d(m: MapRec, u: UnitRec, tx: number, ty: number, isStatic: number, target: UnitRec | null): void {
  const y = mapObjCellY(u.mapObj);
  const x = mapObjCellX(u.mapObj);
  pathWaveSearch(m, u, x, y, tx, ty, isStatic, target);
}

/**
 * 0x555dc2 Path_RefreshDynamic (thiscall, ret 8): refaz o caminho dinâmico até um ponto da lista estática: com a lista estática
 * maior que +0x58598, a cabeça (se está a mais de +0x58594 células, Chebyshev) ou o (+0x58594+1)-ésimo elemento; senão a
 * célula-alvo de andar+0x76. Sem caminho dinâmico para o alvo de andar: andar+0x98 = 1. Cabeça perto: sai da lista estática.
 */
export function pathRefreshDynamic(m: MapRec, u: UnitRec, target: UnitRec | null): void {
  let dist = 0;                                         // word [ebp-0xc]
  let mode = 0;                                         // byte [ebp-0x18]
  let tgt = 0;                                          // word [ebp-8]
  let head = 0;                                         // word [ebp-4]
  const cur = mapObjCellOf(u.mapObj) & 0xffff;          // word [ebp-0x20]
  const n = u.pathStatic.getCount() & 0xffff;           // word [ebp-0x10]
  if (n !== 0) {
    head = u.pathStatic.getHead();
    dist = gridChebyshevDist(cur & 0xff, (cur >> 8) & 0xff, head & 0xff, (head >> 8) & 0xff) & 0xff;
  }
  if (n <= m.i32(MAP_DYN_LEN_OFF)) {
    tgt = u.walk.f76 & 0xffff;
    mode = 1;
  } else if (dist > m.i32(MAP_DYN_NEAR_OFF)) {
    tgt = head;
    mode = 2;
  } else {
    const pos = { p: u.pathStatic.getHeadPosition() };
    for (let i = 0; i < m.i32(MAP_DYN_NEAR_OFF) + 1; i++) tgt = CListWord.getNext(pos);
    mode = 3;
  }
  fn_0x54d72d(m, u, tgt & 0xff, (tgt >> 8) & 0xff, 0, target);
  if (u.pathDynamic.getCount() === 0 && mode === 1) u.walk.f98 = 1;
  if (n !== 0 && dist <= m.i32(MAP_DYN_NEAR_OFF)) u.pathStatic.removeHead();
}
