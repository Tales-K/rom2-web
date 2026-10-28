/**
 * Gerador pseudoaleatório determinístico = o `rand()` do CRT MSVC que o allods2.exe usa (0x583290, notes/telemetry.md):
 * `seed = seed × 214013 + 2531011` (32 bits), retorno `(seed >> 16) & 0x7fff` (0..32767). O sorteio inteiro do jogo é
 * `rand(n) = (rand() × (n+1)) >> 15` = 0..n inclusive [exe 0x51fa25]; `int(a, b)` = a + rand(b − a). Toda aleatoriedade da
 * simulação passa por aqui (com a mesma semente e os sorteios na mesma ordem, o traço pode ser comparado tique a tique com o original).
 *
 * SITES (DIFF-FUZZ fase 6, notes/differential-fuzz.md): cada ponto de uso informa qual CHAMADOR do original ele representa (`site` =
 * endereço de retorno do chamador efetivo do rand() no exe, ex. 0x5170f8 = parte aleatória do dano em Unit_PhysicalDamage). No jogo
 * normal o site é ignorado (custo: um teste de `replay`). No modo REPLAY (só testes/golden) cada sorteio devolve o próximo valor gravado
 * no original para aquele site no mesmo tique de 16/s (fila por (tique, site)); fila vazia ou argumento diferente → registra
 * "faltou"/"divergiu" e cai no gerador normal. Ponto de uso sem site no original = string (`"ours:..."`), contado à parte.
 */
export type RandSite = number | string;

/** Gravação de um episódio do original (refs/golden/episodes/<id>/rand.json.gz; tools/refcap/diff/golden_rerecord.py) */
export interface RandRecording {
  t16_0: number;
  sites: { ret: string; kind: string }[];
  tick: number[]; site: number[]; a: number[]; b: number[]; val: number[];
}

export interface SiteStat { rec: number; used: number; miss: number; argdiff: number; kind?: string; off?: Record<number, number>; first?: Record<number, number> }

/** Filas por (relógio de 16/s absoluto, site) de uma gravação; `begin(t16a, t16b)` abre uma janela (cursores zerados, contagem dos
 *  gravados no intervalo de tiques [t16a, t16b)); `clock` diz o relógio de 16/s do nosso mundo no momento do sorteio. */
export class RngReplay {
  private q = new Map<string, number[]>();      // `${t16}:${site}` → índices da gravação
  private cur = new Map<string, number>();
  private seen = new Set<RandSite>();
  private byT16 = new Map<number, number[]>();
  readonly stats = new Map<RandSite, SiteStat>();
  counting = true;
  clock: () => number = () => 0;
  constructor(readonly rec: RandRecording) {
    rec.tick.forEach((tk, i) => {
      const t16 = rec.t16_0 + tk + 1;
      const ret = parseInt(rec.sites[rec.site[i]!]!.ret, 16);
      const k = `${t16}:${ret}`;
      let l = this.q.get(k); if (!l) this.q.set(k, l = []); l.push(i);
      let m = this.byT16.get(t16); if (!m) this.byT16.set(t16, m = []); m.push(i);
    });
  }
  private st(site: RandSite): SiteStat {
    let s = this.stats.get(site);
    if (!s) this.stats.set(site, s = { rec: 0, used: 0, miss: 0, argdiff: 0 });
    return s;
  }
  /** nova janela: relógio de 16/s absoluto do 1º tique e do fim (exclusivo) */
  begin(t16a: number, t16b: number): void {
    this.cur.clear();
    this.seen.clear();
    if (!this.counting) return;
    for (let t = t16a; t < t16b; t++) for (const i of this.byT16.get(t) ?? []) {
      const s = this.st(parseInt(this.rec.sites[this.rec.site[i]!]!.ret, 16));
      s.rec++; s.kind ??= this.rec.sites[this.rec.site[i]!]!.kind;
    }
  }
  /** valor cru gravado (0..32767) ou −1 (faltou/divergiu: o chamador usa o gerador normal) */
  take(site: RandSite, a: number, b: number, shift = 0): number {
    if (typeof site === "string") { if (this.counting) this.st(site).miss++; return -1; }
    const k = `${this.clock() + shift}:${site}`;
    const l = this.q.get(k);
    const j = this.cur.get(k) ?? 0;
    // diagnóstico (fase 7): o 1º sorteio de cada site na janela (antes de qualquer cascata) — acerto (0) ou atraso do gravado mais perto
    const first = this.counting && !this.seen.has(site);
    if (first) this.seen.add(site);
    if (!l || j >= l.length) {
      if (this.counting) {
        const s = this.st(site); s.miss++;
        // diagnóstico: o sorteio gravado mais perto (tiques de 16/s) ainda não consumido → histograma de atraso do nosso ponto de uso
        const t = this.clock() + shift;
        let found = 99;
        for (let d = 1; d <= 8; d++) for (const o of [-d, d]) {
          const k2 = `${t + o}:${site}`, l2 = this.q.get(k2);
          if (l2 && (this.cur.get(k2) ?? 0) < l2.length) { (s.off ??= {})[o] = (s.off[o] ?? 0) + 1; found = o; d = 99; break; }
        }
        if (first) (s.first ??= {})[found] = (s.first[found] ?? 0) + 1;
      }
      return -1;
    }
    if (first) { const s = this.st(site); (s.first ??= {})[0] = (s.first[0] ?? 0) + 1; }
    this.cur.set(k, j + 1);
    const i = l[j]!;
    if ((a !== -1 && this.rec.a[i] !== a) || (b !== -1 && this.rec.b[i] !== b)) { if (this.counting) this.st(site).argdiff++; return -1; }
    if (this.counting) this.st(site).used++;
    return this.rec.val[i]!;
  }
}

export class Rng {
  private s: number;
  /** modo replay (só testes/golden): ver RngReplay */
  replay: RngReplay | null = null;
  /** deslocamento (tiques de 16/s) do relógio do replay para o bloco em curso (pensamento da IA: −1, ver World.step) */
  shift = 0;
  constructor(seed = 0x2a11d052) { this.s = seed >>> 0; }
  /** rand() cru do CRT: 0..32767 */
  raw(): number {
    this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0;
    return (this.s >>> 16) & 0x7fff;
  }
  /** rand() cru (0..32767) do ponto de uso que representa o chamador `site` do original; `a`/`b` = argumento(s) do wrapper do exe
   *  (Rand_Inclusive(n): a = n; Rand_Range(a, b); 0x57afd0(n): a = n) só para conferir no replay (−1 = não conferir) */
  draw(site: RandSite, a = -1, b = -1): number {
    if (this.replay) { const v = this.replay.take(site, a, b, this.shift); if (v >= 0) return v; }
    return this.raw();
  }
  /** rand(n) do exe: 0..n inclusive [exe 0x51fa25] (n ≤ 0 → 0, sem consumir) */
  exe(n: number, site: RandSite = "ours:exe"): number { return n <= 0 ? 0 : Math.floor(this.draw(site, n) * (n + 1) / 32768); }
  /** [0, 1) com 15 bits */
  next(site: RandSite = "ours:next"): number { return this.draw(site) / 32768; }
  /** inteiro em [a, b] = a + rand(b − a) */
  int(a: number, b: number, site: RandSite = "ours:int"): number { return a + this.exe(b - a, site); }
  /** Rand_One(n) do exe 0x51fa4e = 1 + Rand_Inclusive(n − 1) = 1..n (n = 1 → 1 sem sorteio; n = 0 → 1 COM sorteio) */
  one(n: number, site: RandSite): number { return n === 1 ? 1 : 1 + Math.trunc(this.draw(site, n) * Math.max(0, n) / 32768); }
  /** Rand_Range(a, b) do exe 0x57aff0 = a + rand()×(b − a + 1)/32768 (1 sorteio mesmo com b = a) */
  range(a: number, b: number, site: RandSite): number { return a + Math.floor(this.draw(site, a, b) * (b - a + 1) / 32768); }
  /** 0x57afd0(n) = rand()×n/32768 (1 sorteio mesmo com n = 0) */
  scaled(n: number, site: RandSite): number { return Math.floor(this.draw(site, n) * n / 32768); }
  chance(p: number, site: RandSite = "ours:chance"): boolean { return this.next(site) < p; }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}
