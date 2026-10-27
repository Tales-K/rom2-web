/**
 * Porta literal do servidor do allods2.exe: folhas do subsistema de andar (lote 5a): objeto de mapa, registro de ocupação de
 * célula, grades por célula, máscaras de passagem e acessores. Uma função do exe = uma função daqui; prova em
 * sim/test/exe_walk.ts contra os pares do oráculo (refs/oracle/pairs/<episodio>/<addr>.jsonl).
 *
 * Portadas: 0x54f9b9 0x54fa43 0x54fa22 (inicialização do objeto de mapa), 0x54fc41 (posição fina), 0x54ff9e Obj_CellOf,
 * 0x551383 Unit_SubCellCenter, 0x5551d6 (volta ao centro da célula), 0x551463 Grid_ChebyshevDist, 0x5514ce, 0x55915a,
 * 0x5160ef, 0x540360, 0x55c500 (OR de máscara), 0x55c550 Unit_PassMaskAnd, 0x550eae e 0x550de0 (bit 0x40 da grade de flags),
 * 0x542380 e 0x55f330 (slot 0x20 das vtables de unidade), 0x55687d, 0x55f9c0 0x55f9f0 0x55fa20 0x55fa50 0x55fa70 0x55fa90 0x542dc0 (endereço de célula em grades), 0x54f89a 0x54f84c 0x55b95f 0x5604f0
 * 0x55385f 0x5513b6 (registro de ocupação 0x3c bytes).
 *
 * Funções que no exe devolvem ponteiro para dentro de `this` devolvem aqui o DESLOCAMENTO a partir de `this` (como
 * pathCostCellOff em path.ts); as grades espelhadas (`FlagGridRec.flags`, `PathRec.cost`) subtraem a base do seu bloco.
 */
import { FLAGS_OFF, GRID10000_OFF, OccRec, type ByteGridRec, type FlagGridRec, type MapObjRec, type SessionRec, type UnitRec } from "./types";

/** 0x582c40 (CRT abs, cdecl): |v| em 32 bits (INT_MIN fica como está). */
function crtAbs(v: number): number {
  return (v < 0 ? -v : v) | 0;
}

/** 0x54f9b9 (thiscall): inicializa o objeto de mapa na célula (x,y) com fração 0x80,0x80 e guarda o 3º argumento em +8. */
export function mapObjInit(o: MapObjRec, x: number, y: number, owner: number): void {
  o.x = x & 0xff;
  o.y = y & 0xff;
  o.cell = y & 0xff;                       // *(ushort*)(this+2) = param_2
  o.cell = (o.cell << 8) & 0xffff;         // <<= 8 (short)
  o.cell = (o.cell + (x & 0xff)) & 0xffff; // += param_1
  o.fx = 0x80;
  o.fy = 0x80;
  o.owner = owner >>> 0;
}

/** 0x54fa43 (thiscall): `p1` empacota x no byte baixo e y no byte seguinte. */
export function mapObjInitPacked(o: MapObjRec, p1: number, owner: number): void {
  mapObjInit(o, p1 & 0xff, (p1 >> 8) & 0xff, owner);
}

/** 0x54fa22 (thiscall): igual a 0x54fa43 com `p1` de 16 bits; devolve `this`. */
export function mapObjInitPacked16(o: MapObjRec, p1: number, owner: number): MapObjRec {
  mapObjInitPacked(o, p1 & 0xffff, owner);
  return o;
}

/** 0x54fc41 (thiscall): posição fina; p1/p2 = x/y em 1/256 de célula (célula no byte alto, fração no baixo). */
export function mapObjSetFine(o: MapObjRec, p1: number, p2: number): void {
  o.x = (p1 >> 8) & 0xff;
  o.y = (p2 >> 8) & 0xff;
  o.fx = p1 & 0xff;
  o.fy = p2 & 0xff;
  o.cell = (o.y * 0x100 + o.x) & 0xffff;
}

/** 0x54ff9e Obj_CellOf (fastcall): índice da célula do objeto de mapa (short em +2). */
export function mapObjCellOf(o: MapObjRec): number {
  return o.cell & 0xffff;
}

/** 0x551383 Unit_SubCellCenter (fastcall): 1 se a fração é (0x80,0x80), o centro da célula. */
export function mapObjSubCellCenter(o: MapObjRec): number {
  return o.fx === 0x80 && o.fy === 0x80 ? 1 : 0;
}

/** 0x5551d6 (fastcall): volta a fração ao centro da célula. */
export function mapObjCenterFraction(o: MapObjRec): void {
  o.fx = 0x80;
  o.fy = 0x80;
}

/** 0x551463 Grid_ChebyshevDist (cdecl na lista do Ghidra; ret 0x10): max(|x1-x2|, |y1-y2|) com coordenadas em byte; devolve AL. */
export function gridChebyshevDist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = crtAbs((x1 & 0xff) - (x2 & 0xff)) & 0xff;
  const dy = crtAbs((y1 & 0xff) - (y2 & 0xff)) & 0xff;
  return dx > dy ? dx : dy;
}

/** 0x5514ce (fastcall, ECX = ponteiro de byte): `v` = o byte apontado; devolve AL = ((v+8) & 0xff) >> 4. */
export function fn_0x5514ce(v: number): number {
  return (((v + 8) & 0xff) >> 4) & 0xff;
}

/**
 * 0x55915a (stdcall, 1 argumento): velocidade da unidade: o byte +0x44 do registro-base do tipo ([[u+0x70]+0x3c]) quando ≠ 0,
 * senão o short +0x8c da unidade (com sinal). Devolve EAX inteiro.
 */
export function fn_0x55915a(u: UnitRec): number {
  const b = u.type.stats.speedByte & 0xff;
  return b !== 0 ? b : (u.speed << 16) >> 16;
}

/** 0x542380 (fastcall; alvo do slot +0x20 das vtables 0x5d0eb0/0x5d0f40/0x5d0fb8): byte +0x4a da unidade. */
export function unitGetKind(u: UnitRec): number {
  return u.kind & 0xff;
}

/** 0x55f330 (fastcall): chamada virtual `(*(*u + 0x20))(u)`; devolve AL. */
export function fn_0x55f330(u: UnitRec): number {
  switch (u.vtbl) {
    case 0x5d0eb0: case 0x5d0f40: case 0x5d0fb8: return unitGetKind(u);
  }
  throw new Error(`vtable 0x${u.vtbl.toString(16)} sem slot +0x20 espelhado`);
}

/** 0x5160ef (fastcall): byte +0x43 da unidade. */
export function unitByte43(u: UnitRec): number {
  return u.f43 & 0xff;
}

/** 0x540360 (fastcall): u32 em +0x18b0 do objeto-sessão. */
export function sessionField18b0(s: SessionRec): number {
  return s.f18b0 >>> 0;
}

/** 0x55c500 (cdecl com ponteiro de byte): *p |= m. `buf[i]` é o byte apontado. */
export function orMaskInto(buf: Uint8Array, i: number, m: number): void {
  buf[i] = (buf[i] | m) & 0xff;
}

/** 0x55c550 Unit_PassMaskAnd (thiscall, ret 8): AND de dois bytes; devolve EAX (0..255). */
export function unitPassMaskAnd(a: number, b: number): number {
  return (a & 0xff) & (b & 0xff);
}

/** 0x55f9c0 (cdecl): índice de célula y*256+x (bytes). */
export function cellIndex(x: number, y: number): number {
  return (y & 0xff) * 0x100 + (x & 0xff);
}

/** 0x55f9f0 (thiscall): deslocamento da célula (x,y) na grade de bytes em this+0. */
export function cellOff00000(x: number, y: number): number {
  return (y & 0xff) * 0x100 + (x & 0xff);
}

/** 0x542dc0 (thiscall): deslocamento da célula (x,y) na grade de bytes em this+0x10000. */
export function cellOff10000(x: number, y: number): number {
  return (y & 0xff) * 0x100 + (x & 0xff) + GRID10000_OFF;
}

/** 0x55fa20 (thiscall): deslocamento da célula (x,y) na grade de bytes em this+0x20000. */
export function cellOff20000(x: number, y: number): number {
  return (y & 0xff) * 0x100 + (x & 0xff) + FLAGS_OFF;
}

/** 0x55fa50 (thiscall): deslocamento = índice (short sem sinal) na grade em this+0. */
export function cellIdxOff00000(idx: number): number {
  return idx & 0xffff;
}

/** 0x55fa70 (thiscall): deslocamento = índice na grade em this+0x10000. */
export function cellIdxOff10000(idx: number): number {
  return (idx & 0xffff) + GRID10000_OFF;
}

/** 0x55fa90 (thiscall): deslocamento = índice na grade de flags em this+0x20000. */
export function cellIdxOff20000(idx: number): number {
  return (idx & 0xffff) + FLAGS_OFF;
}

/** 0x550eae (thiscall, ret 4): flags da célula `idx` AND 0x40 (0 ou 0x40); devolve EAX. */
export function cellFlagTest40(g: FlagGridRec, idx: number): number {
  const off = cellIdxOff20000(idx);
  const bVar2 = 0x40;
  return unitPassMaskAnd(g.flags[off - FLAGS_OFF], bVar2);
}

/** 0x550de0 (thiscall, ret 4): marca o bit 0x40 nas flags da célula `idx` (depois de ler o mesmo bit por 0x550eae, sem efeito). */
export function cellFlagMark40(g: FlagGridRec, idx: number): void {
  cellFlagTest40(g, idx);
  const bVar2 = 0x40;
  const off = cellIdxOff20000(idx);
  orMaskInto(g.flags, off - FLAGS_OFF, bVar2);
}

/** 0x55b95f (fastcall): identidade (construtor vazio de membro); devolve o argumento. */
export function fn_0x55b95f(x: number): number {
  return x;
}

/** 0x54f89a (fastcall): memset(this, 0, 0x3c). */
export function occRecClear(r: OccRec): void {
  r.b.fill(0);
}

/** 0x54f84c (fastcall): construtor do registro de ocupação (membro em +0x34 vazio; depois zera os 0x3c bytes). */
export function occRecConstruct(r: OccRec): OccRec {
  fn_0x55b95f(0x34);
  occRecClear(r);
  return r;
}

/** 0x5604f0 (cdecl): zera `n` registros contíguos e constrói cada um (o `operator new` de colocação 0x401f20 nunca devolve nulo). */
export function occRecArrayInit(recs: OccRec[], n: number): void {
  for (let i = 0; i < n; i++) recs[i].b.fill(0);   // memset(p, 0, n*0x3c)
  for (let i = 0; i < n; i++) occRecConstruct(recs[i]);
}

/** 0x55385f (thiscall): memcpy(this, src, 0x3c). */
export function occRecCopy(dst: OccRec, src: OccRec): void {
  dst.b.set(src.b);
}

/** 0x5513b6 (fastcall): 1 se o registro está vazio (campos +4,+8,+0xc,+0x10, +2, +0x34, +0x2c, +0x30 todos zero), senão 0. */
export function occRecIsEmpty(r: OccRec): number {
  let v = 1;
  if (r.u32(4) !== 0 || r.u32(8) !== 0 || r.u32(0xc) !== 0 || r.u32(0x10) !== 0 || r.u8_02 !== 0 || r.u8_34 !== 0 ||
      r.u32(0x2c) !== 0 || r.u32(0x30) !== 0) v = 0;
  return v;
}

/**
 * 0x55687d (thiscall, ret 0xc): `grid` = bytes em this+0. Pelo tipo (slot +0x20) da unidade: 1 → velocidade*8 / grade[y*256+x]
 * (divisão inteira com sinal; divisor 0 é #DE no exe e aqui exceção); 2 ou 3 → só a velocidade (AX); outro → 0 (AX).
 * Nos ramos ≠ 1 só AX é retorno (o resto de EAX é sobra de registrador, o ponteiro da unidade).
 */
export function fn_0x55687d(grid: ByteGridRec, u: UnitRec, x: number, y: number): number {
  const bVar2 = fn_0x55f330(u);
  if (bVar2 === 1) {
    const esi = ((u.speed << 16) >> 16) << 3;
    const div = grid.bytes[cellOff00000(x, y)];
    if (div === 0) throw new Error("0x55687d: divisão por zero (#DE no exe)");
    return Math.trunc(esi / div) | 0;
  }
  if (bVar2 < 2 || 3 < bVar2) return 0;
  return u.speed & 0xffff;
}
