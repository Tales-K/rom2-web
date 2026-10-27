/**
 * Infraestrutura comum dos testes de porta contra o oráculo (exe_path.ts, exe_walk.ts): leitura dos pares gravados por
 * tools/re/oracle/fnprobe.py e reconstrução das entradas de uma chamada só pelos acessos que ela mesma fez.
 */
import { MapObjRec, UnitRec } from "../exe/types";

interface NodeProc { exitCode?: number; getBuiltinModule(name: string): unknown; }
export const proc = (globalThis as unknown as { process: NodeProc }).process;
export const { existsSync, readFileSync, readdirSync } = proc.getBuiltinModule("node:fs") as {
  existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string; readdirSync(p: string): string[];
};
export const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

export const PAIRS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "refs", "oracle", "pairs");

export interface Obj { unit: number; sub?: string; off: number; }
export interface Pair {
  t: number; seq: number; fn: string; this: number; args: number[]; eax: number; rng0: number; rng1: number; nrand: number;
  reads: [number, number, number][]; writes: [number, number, number, number][]; objs: Record<string, Obj>;
}

/** Unidades e objetos de mapa reconstruídos pelas leituras da chamada, via `objs`. */
export class Recon {
  units = new Map<number, UnitRec>();
  constructor(readonly d: Pair) {
    for (const [a, s, v] of d.reads) {
      const o = d.objs[String(a)];
      if (!o) continue;
      const u = this.unit(o.unit);
      if (o.sub === undefined) {
        if (o.off === 0x0 && s === 4) u.vtbl = v >>> 0;
        else if (o.off === 0x43 && s === 1) u.f43 = v;
        else if (o.off === 0x49 && s === 1) u.size = v;
        else if (o.off === 0x4a && s === 1) u.kind = v;
        else if (o.off === 0x8c && s === 2) u.speed = (v << 16) >> 16;
      } else if (o.sub === "+0x10" && s === 1) {
        if (o.off === 0) u.mapObj.x = v;
        else if (o.off === 1) u.mapObj.y = v;
        else if (o.off === 4) u.mapObj.fx = v;
        else if (o.off === 5) u.mapObj.fy = v;
      }
    }
  }
  unit(id: number): UnitRec {
    let u = this.units.get(id);
    if (!u) { u = new UnitRec(); u.mapObj = new MapObjRec(); this.units.set(id, u); }
    return u;
  }
  /** Unidade cujo endereço-base (off 0, sem sub-objeto) é `addr`. */
  unitAt(addr: number): UnitRec {
    const o = this.d.objs[String(addr)];
    if (!o || o.sub !== undefined || o.off !== 0) throw new Error(`0x${addr.toString(16)} não é base de unidade em objs`);
    return this.unit(o.unit);
  }
  /**
   * Objeto de mapa cujo endereço-base é `addr`. Os acessores 0x54ff5b..0x54ffc0 também servem objetos de mapa que não são de
   * unidade (sem entrada em `objs`): esses são remontados pelas leituras relativas a `addr`.
   */
  mapObjAt(addr: number): MapObjRec {
    const o = this.d.objs[String(addr)];
    if (o) {
      if (o.sub !== "+0x10" || o.off !== 0) throw new Error(`0x${addr.toString(16)} não é objeto de mapa em objs`);
      return this.unit(o.unit).mapObj;
    }
    const m = new MapObjRec();
    for (const [a, s, v] of this.d.reads) {
      if (s !== 1) continue;
      const r = a - addr;
      if (r === 0) m.x = v; else if (r === 1) m.y = v; else if (r === 4) m.fx = v; else if (r === 5) m.fy = v;
    }
    return m;
  }
}

/**
 * Memória de uma chamada: estado ANTES (primeiro `antes` de cada byte escrito; senão a leitura) e DEPOIS (com as escritas
 * aplicadas em ordem). Byte nunca tocado é desconhecido (`has` falso; os getters devolvem 0).
 */
export class CallMem {
  readonly init = new Map<number, number>();
  readonly fin = new Map<number, number>();
  readonly written = new Set<number>();
  constructor(d: Pair) {
    for (const [a, s, v] of d.reads) for (let i = 0; i < s; i++) this.init.set(a + i, Math.floor(v / 2 ** (8 * i)) & 0xff);
    const seen = new Set<number>();
    for (const [a, s, before] of d.writes) {
      for (let i = 0; i < s; i++) {
        if (seen.has(a + i)) continue;
        seen.add(a + i);
        this.init.set(a + i, Math.floor(before / 2 ** (8 * i)) & 0xff);
      }
    }
    for (const [k, v] of this.init) this.fin.set(k, v);
    for (const [a, s, , after] of d.writes) {
      for (let i = 0; i < s; i++) { this.fin.set(a + i, Math.floor(after / 2 ** (8 * i)) & 0xff); this.written.add(a + i); }
    }
  }
  has(a: number): boolean { return this.init.has(a); }
  u8(a: number): number { return this.init.get(a) ?? 0; }
  u16(a: number): number { return this.u8(a) | (this.u8(a + 1) << 8); }
  u32(a: number): number { return (this.u8(a) | (this.u8(a + 1) << 8) | (this.u8(a + 2) << 16) | (this.u8(a + 3) << 24)) >>> 0; }
  /** `n` bytes a partir de `a` no estado ANTES. */
  bytes(a: number, n: number): Uint8Array {
    const r = new Uint8Array(n);
    for (let i = 0; i < n; i++) r[i] = this.u8(a + i);
    return r;
  }
  /**
   * Compara o registro de `before.length` bytes em `base` depois da porta (`after`) com o original: todo byte que a porta
   * mudou foi escrito pelo original, e todo byte escrito pelo original está igual ao valor final.
   */
  checkRecord(base: number, before: Uint8Array, after: Uint8Array): string | null {
    for (let i = 0; i < before.length; i++) {
      const a = base + i;
      if (before[i] !== after[i] && !this.written.has(a)) return `+0x${i.toString(16)}: porta mudou ${before[i]}→${after[i]}, original não escreveu`;
      if (this.written.has(a) && after[i] !== this.fin.get(a)) return `+0x${i.toString(16)}: porta ${after[i]} ≠ original ${this.fin.get(a)}`;
    }
    return null;
  }
}
