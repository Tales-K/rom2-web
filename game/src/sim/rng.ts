/** Gerador pseudoaleatório determinístico (mulberry32). Toda aleatoriedade da simulação passa por aqui. */
export class Rng {
  private s: number;
  constructor(seed = 0x2a11d052) { this.s = seed >>> 0; }
  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** inteiro em [a, b] */
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}
