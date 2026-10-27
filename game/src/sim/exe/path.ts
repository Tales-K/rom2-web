/**
 * Porta literal do servidor do allods2.exe: busca de caminho (ondas, backtrace, aproximação). Uma função do exe = uma função
 * daqui, mesmo fluxo de controle; prova em sim/test/exe_path.ts contra os pares do oráculo (refs/oracle/pairs/<episodio>/<addr>.jsonl).
 *
 * Portadas: 0x54ffb0 0x54ffc0 0x54ff5b 0x54ff7c (objeto de mapa), 0x542360 (vtable unidade +0x1c), 0x50d884 0x50d8c0,
 * 0x55f970, 0x557cf1 Dir_Sector16, 0x557f08 Unit_ApproachCell, 0x55f9a0, 0x5585f4 Path_UnlabeledTargetRing.
 *
 * x87: o exe roda com FPCW 0x27f (precisão de 53 bits, arredondamento ao par), então cada operação da FPU é uma operação de
 * double do JS; `fstp dword` (variável float do C) é Math.fround; `CRT_ftol` 0x582c0c é `fistp qword` truncando (ftol abaixo).
 */
import { PATH_COST_OFF, PATH_RING_STEP_OFF, type MapObjRec, type PathRec, type UnitRec } from "./types";

const f32 = Math.fround;

/** CRT_ftol 0x582c0c: `fistp qword` com RC=truncar; devolve EAX (32 bits baixos). Fora de int64 / NaN → indefinido 0x80000000_00000000. */
export function crtFtol(v: number): number {
  if (!(Math.abs(v) < 2 ** 63)) return 0;
  return Math.trunc(v) | 0;
}

/** 0x54ffb0 (fastcall): byte +0x00 do objeto de mapa (célula x). */
export function mapObjCellX(o: MapObjRec): number {
  return o.x & 0xff;
}

/** 0x54ffc0 (fastcall): byte +0x01 do objeto de mapa (célula y). */
export function mapObjCellY(o: MapObjRec): number {
  return o.y & 0xff;
}

/** 0x54ff5b (fastcall): x fino = célula*0x100 + fração (short). */
export function mapObjFineX(o: MapObjRec): number {
  return ((o.x & 0xff) * 0x100 + (o.fx & 0xff)) & 0xffff;
}

/** 0x54ff7c (fastcall): y fino = célula*0x100 + fração (short). */
export function mapObjFineY(o: MapObjRec): number {
  return ((o.y & 0xff) * 0x100 + (o.fy & 0xff)) & 0xffff;
}

/** 0x542360 (thiscall): byte +0x49 da unidade (lado em células). Alvo do slot +0x1c das vtables 0x5d0eb0/0x5d0f40/0x5d0fb8. */
export function unitGetSize(u: UnitRec): number {
  return u.size & 0xff;
}

/** Chamada virtual `(*(*u + 0x1c))(u)`: as três vtables de unidade apontam o slot para 0x542360. */
export function vtGetSize(u: UnitRec): number {
  switch (u.vtbl) {
    case 0x5d0eb0: case 0x5d0f40: case 0x5d0fb8: return unitGetSize(u);
  }
  throw new Error(`vtable 0x${u.vtbl.toString(16)} sem slot +0x1c espelhado`);
}

/** 0x50d884 (thiscall): x fino do centro = x fino + (lado-1)*0x80 (short). */
export function unitCenterX(u: UnitRec): number {
  const s = mapObjFineX(u.mapObj);
  const v = vtGetSize(u);
  return (s + (((v & 0xff) - 1) << 7)) & 0xffff;
}

/** 0x50d8c0 (thiscall): y fino do centro = y fino + (lado-1)*0x80 (short). */
export function unitCenterY(u: UnitRec): number {
  const s = mapObjFineY(u.mapObj);
  const v = vtGetSize(u);
  return (s + (((v & 0xff) - 1) << 7)) & 0xffff;
}

/** 0x55f970 (thiscall): endereço da célula (x,y) na grade de custo, como deslocamento a partir de `this`. */
export function pathCostCellOff(_p: PathRec, x: number, y: number): number {
  return ((y & 0xff) * 0x100 + (x & 0xff)) * 2 + PATH_COST_OFF;
}

function costAt(p: PathRec, off: number): number {
  return p.cost[(off - PATH_COST_OFF) >> 1];
}

function ringStepAt(p: PathRec, off: number): number {
  const i = off - PATH_RING_STEP_OFF;
  if (i < 0 || i >= p.ringStep.length) throw new Error(`leitura de this+0x${off.toString(16)} fora do espelho de ringStep`);
  return p.ringStep[i];
}

/**
 * 0x557cf1 Dir_Sector16 (stdcall, ECX não usado): setor de 16 da direção p1→p2 pelos centros (x cresce para a direita, y
 * para baixo). Devolve só AL (o resto de EAX é sobra de registrador).
 */
export function dirSector16(p1: UnitRec, p2: UnitRec): number {
  const dx = (unitCenterX(p2) & 0xffff) - (unitCenterX(p1) & 0xffff);   // [ebp-0xc]
  const dy = (unitCenterY(p2) & 0xffff) - (unitCenterY(p1) & 0xffff);   // [ebp-0x14]
  let r = 0;
  const ax = (dx > 0 ? dx : -dx) & 0xffff;                              // word [ebp-0x10]
  const ay = (dy > 0 ? dy : -dy) & 0xffff;                              // word [ebp-4]
  if (dx > 0) {
    if (dy > 0) {
      if (ax > ay) r = ax > ay << 1 ? 4 : 5;
      else r = ay > ax << 1 ? 7 : 6;
    } else {
      if (ax > ay) r = ax > ay << 1 ? 3 : 2;
      else r = ay > ax << 1 ? 0 : 1;
    }
  } else if (dy > 0) {
    if (ax > ay) r = ax > ay << 1 ? 0xb : 0xa;
    else r = ay > ax << 1 ? 8 : 9;
  } else {
    if (ax > ay) r = ax > ay << 1 ? 0xc : 0xd;
    else r = ay > ax << 1 ? 0xf : 0xe;
  }
  return r;
}

/**
 * 0x557f08 Unit_ApproachCell (thiscall, ret 8): célula de aproximação de `attacker` (param_1) a `target` (param_2). Percorre
 * até 8 anéis crescentes em volta do alvo; em cada anel parte do ponto onde a reta centro-alvo→centro-atacante (inclinação
 * em float) cruza o lado voltado ao atacante e anda pelo anel nos dois sentidos, guardando a célula de menor custo da onda
 * (`cost` < melhor, primeiro achado no empate). Devolve (y<<8)+x da célula, ou AX=0 se nenhum anel tem custo < 0xffff.
 */
export function unitApproachCell(p: PathRec, attacker: UnitRec, target: UnitRec): number {
  let best = 0xffff;   // [ebp-0xc]
  let ring = 0;        // [ebp-0x44]
  let bx = 0, by = 0;  // [ebp-0x14], [ebp-0x1c]
  let meet = 0;        // [ebp-0x2c] escrito e nunca lido
  let x1 = (mapObjCellX(target.mapObj) & 0xff) + (vtGetSize(target) & 0xff);     // [ebp-0x3c] → [ebp-0x60]
  let y1 = (mapObjCellY(target.mapObj) & 0xff) + (vtGetSize(target) & 0xff);     // [ebp-0x4c] → [ebp-0x70]
  let x0 = (mapObjCellX(target.mapObj) & 0xff) - (vtGetSize(attacker) & 0xff);   // [ebp-0x18] → [ebp-0x40]
  let y0 = (mapObjCellY(target.mapObj) & 0xff) - (vtGetSize(attacker) & 0xff);   // [ebp-0x5c] → [ebp-0x50]
  const sector = dirSector16(target, attacker) & 0xff;                            // [ebp-0x64]
  const q = ((sector + 2) & 0xc) >> 2;
  const dir0 = q + 4;                                                            // [ebp-0x28]
  let dxf = f32((unitCenterX(target) & 0xffff) - (unitCenterX(attacker) & 0xffff)); // float [ebp-0x74]
  const dyf = f32((unitCenterY(target) & 0xffff) - (unitCenterY(attacker) & 0xffff)); // float [ebp-0x78]
  let slope = 0;       // float [ebp-8]
  let icpt = 0;        // [ebp-0x10]
  switch (dir0 - 4) {  // tabela 0x558574
    case 1: case 3: {  // 0x5580b0: y = x*slope + icpt
      if (dxf === 0) dxf = f32(dxf + 1.0);                                       // [0x5d1ab0]=0.0, [0x5d1ab4]=1.0
      slope = f32(dyf / dxf);
      const cy = f32(unitCenterY(target) & 0xffff);                              // float [ebp-0x94]
      const cx = unitCenterX(target) & 0xffff;
      icpt = crtFtol(cy - cx * slope);
      break;
    }
    case 0: case 2: {  // 0x558120: x = y*slope + icpt (sem guarda de divisão por zero)
      slope = f32(dxf / dyf);
      const cx = f32(unitCenterX(target) & 0xffff);                              // float [ebp-0xa0]
      const cy = unitCenterY(target) & 0xffff;
      icpt = crtFtol(cx - cy * slope);
      break;
    }
  }
  for (;;) {
    if (best !== 0xffff || ring >= 8) break;
    ring = ring + 1;
    let ax = 0, ay = 0; // [ebp-0x58], [ebp-0x6c]
    switch (dir0 - 4) { // tabela 0x558584
      case 0: ax = crtFtol((((y0 << 8) + 0x80) | 0) * slope + icpt) >> 8; ay = y0; break;
      case 1: ay = crtFtol((((x1 << 8) + 0x80) | 0) * slope + icpt) >> 8; ax = x1; break;
      case 2: ax = crtFtol((((y1 << 8) + 0x80) | 0) * slope + icpt) >> 8; ay = y1; break;
      case 3: ay = crtFtol((((x0 << 8) + 0x80) | 0) * slope + icpt) >> 8; ax = x0; break;
    }
    let d1 = dir0;               // [ebp-0x7c]
    let d2 = dir0;               // [ebp-4]
    let a1x = ax & 0xffff;       // word [ebp-0x30]
    let a2x = ax & 0xffff;       // word [ebp-0x38]
    let a1y = ay & 0xffff;       // word [ebp-0x54]
    let a2y = ay & 0xffff;       // word [ebp-0x68]
    const n = ((((x1 - x0 + y1 - y0) | 0) << 1) >> 1) + 1; // [ebp-0x20]
    for (let j = 0; j < n; j++) { // [ebp-0x34]
      let off = pathCostCellOff(p, a1x & 0xff, a1y & 0xff);
      if (costAt(p, off) < best) {
        off = pathCostCellOff(p, a1x & 0xff, a1y & 0xff);
        best = costAt(p, off);
        bx = a1x & 0xffff;
        by = a1y & 0xffff;
      }
      off = pathCostCellOff(p, a2x & 0xff, a2y & 0xff);
      if (costAt(p, off) < best) {
        off = pathCostCellOff(p, a2x & 0xff, a2y & 0xff);
        best = costAt(p, off);
        bx = a2x & 0xffff;
        by = a2y & 0xffff;
      }
      switch (d1) { // tabela 0x558594 (ja 0xb: fora de 0..11 não muda)
        case 0: case 4: case 8: if (a1x === x1) d1 = d1 + 1; break;
        case 1: case 5: case 9: if (a1y === y1) d1 = d1 + 1; break;
        case 2: case 6: case 10: if (a1x === x0) d1 = d1 + 1; break;
        case 3: case 7: case 11: if (a1y === y0) d1 = d1 + 1; break;
      }
      switch (d2) { // tabela 0x5585c4
        case 0: case 4: case 8: if (a2x === x0) d2 = d2 - 1; break;
        case 1: case 5: case 9: if (a2y === y0) d2 = d2 - 1; break;
        case 2: case 6: case 10: if (a2x === x1) d2 = d2 - 1; break;
        case 3: case 7: case 11: if (a2y === y1) d2 = d2 - 1; break;
      }
      a1x = (a1x + ringStepAt(p, PATH_RING_STEP_OFF + d1 * 2)) & 0xffff;
      a1y = (a1y + ringStepAt(p, PATH_RING_STEP_OFF + d1 * 2 + 1)) & 0xffff;
      a2x = (a2x - ringStepAt(p, PATH_RING_STEP_OFF + d2 * 2)) & 0xffff;
      a2y = (a2y - ringStepAt(p, PATH_RING_STEP_OFF + d2 * 2 + 1)) & 0xffff;
      if (j > 100) break;
      if (a1x === a2x && a1y === a2y) meet = j;
    }
    x0 = (x0 - 1) | 0;
    y0 = (y0 - 1) | 0;
    x1 = (x1 + 1) | 0;
    y1 = (y1 + 1) | 0;
  }
  void meet;
  if (best !== 0xffff) return ((by << 8) + bx) | 0;
  return 0; // `xor ax, ax`: só AX é definido
}

/** 0x55f9a0 (thiscall, ret 4): endereço da célula de índice `idx` (y*256+x, short) na grade de custo, relativo a `this`. */
export function pathCostIdxOff(_p: PathRec, idx: number): number {
  return (idx & 0xffff) * 2 + PATH_COST_OFF;
}

/**
 * 0x5585f4 Path_UnlabeledTargetRing (thiscall, ret 0x10): alvo sem rótulo na onda: anéis r = 1..R-1 em volta da célula
 * `center` (índice y*256+x), quatro lados por passo j = -r..r, menor custo < melhor (primeiro achado no empate); para no
 * primeiro anel que achou algo. Devolve o índice (AX) ou 0. `_param2` não é lido. O exe testa `lado == 2` e tem dois ramos
 * idênticos instrução a instrução (conferido no assembly: 0x55862e e 0x5587df); a cópia única abaixo é o mesmo fluxo.
 */
export function pathUnlabeledTargetRing(p: PathRec, unit: UnitRec, _param2: number, center: number, rings: number): number {
  const size = vtGetSize(unit) & 0xff;   // [ebp-8]
  const c0 = center & 0xffff;            // word [ebp-0xc]
  let best = 0xffff;                     // word [ebp-4]
  let found = 0;                         // word [ebp-0x14]
  void size;
  for (let r = 1; r < (rings & 0xffff); r++) {     // [ebp-0x18]
    for (let j = -r; j < r + 1; j++) {             // [ebp-0x1c]
      let c = ((r << 8) + (c0 + j)) & 0xffff;      // word [ebp-0x10]
      if (costAt(p, pathCostIdxOff(p, c)) < best) { best = costAt(p, pathCostIdxOff(p, c)); found = c; }
      c = (Math.imul(r, -0x100) + (c0 + j)) & 0xffff;
      if (costAt(p, pathCostIdxOff(p, c)) < best) { best = costAt(p, pathCostIdxOff(p, c)); found = c; }
      c = ((j << 8) + (c0 + r)) & 0xffff;
      if (costAt(p, pathCostIdxOff(p, c)) < best) { best = costAt(p, pathCostIdxOff(p, c)); found = c; }
      c = (c0 + ((j << 8) - r)) & 0xffff;
      if (costAt(p, pathCostIdxOff(p, c)) < best) { best = costAt(p, pathCostIdxOff(p, c)); found = c; }
    }
    if (best < 0xffff) break;
  }
  if (best === 0xffff) return 0;   // `xor ax, ax`
  return found;
}
