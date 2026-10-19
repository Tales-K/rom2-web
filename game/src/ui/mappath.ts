/**
 * Rede de estradas do mapa-múndi, como o allods2.exe a monta (engenharia reversa de 19/10, exe 0x471f0d/0x4721ff; validada contra 52 trilhas
 * capturadas do original: 1026 de 1046 bolinhas idênticas, as demais são bolinhas coladas em uma só mancha na captura).
 *
 * Bitmap de caminhos (graphics/global.map/pathmap.bmp e umoirpath.bmp, 640×480): 0 = nada, 1 = estrada, 2 = nó (local do mapa).
 *  1. Os nós são percorridos em ordem de varredura (linha a linha). De cada nó, uma BUSCA EM PROFUNDIDADE recursiva visita os pixels de
 *     estrada pela vizinhança 8 (x de x−1 a x+1 por fora, y de y−1 a y+1 por dentro), marca cada pixel visitado (a marca vale para as buscas
 *     seguintes) e acrescenta CADA pixel visitado à lista (sem retirar becos); para no primeiro nó diferente da origem que encontra. A lista
 *     (origem, pixels visitados..., nó achado) vira a aresta origem↔nó (a volta é a lista invertida); repete-se a busca da origem até não
 *     achar mais nós novos.
 *  2. A rota entre dois locais é o menor caminho no grafo de nós (peso = nº de pixels da aresta) e a trilha é a CONCATENAÇÃO das listas das
 *     arestas, sem remover o nó repetido entre uma aresta e a seguinte.
 *  3. As bolinhas vão nos índices 0, 8, 16... dessa lista (uma a cada 8 pixels visitados, não 8 px de distância).
 */
export interface Pt { x: number; y: number }

const W = 640, H = 480;

export class PathNet {
  private readonly nodes: number[] = [];                 // índice do pixel (y·640 + x), em ordem de varredura
  private readonly nodeAt = new Map<number, number>();
  private readonly adj: Array<Map<number, number[]>> = [];
  private readonly cache = new Map<string, Pt[]>();

  /** `map`: 640×480 com 0/1/2. */
  constructor(private readonly map: Uint8Array) {
    for (let p = 0; p < W * H; p++) if (map[p] === 2) { this.nodeAt.set(p, this.nodes.length); this.nodes.push(p); this.adj.push(new Map()); }
    this.build();
  }

  get size(): number { return this.nodes.length; }

  /** Índice do nó em (x, y) ou, se não houver, o mais próximo (até 6 px). */
  nodeIndex(p: Pt): number {
    const exact = this.nodeAt.get(p.y * W + p.x);
    if (exact !== undefined) return exact;
    let best = -1, bd = 6 * 6 + 1;
    this.nodes.forEach((q, i) => { const dx = (q % W) - p.x, dy = ((q / W) | 0) - p.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  private build(): void {
    const { map } = this;
    const visited = new Uint16Array(W * H);
    // busca em profundidade iterativa equivalente à recursão do exe: cada quadro guarda a posição e o próximo vizinho (0..8)
    const dfs = (sx: number, sy: number, list: number[]): boolean => {
      const start = sy * W + sx;
      const stackP: number[] = [start], stackK: number[] = [0], stackD: number[] = [2];
      while (stackP.length) {
        const top = stackP.length - 1, p = stackP[top], x = p % W, y = (p / W) | 0;
        let k = stackK[top], descended = false;
        while (k < 9) {
          const nx = x - 1 + ((k / 3) | 0), ny = y - 1 + (k % 3);   // x por fora, y por dentro
          k++;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || (nx === x && ny === y)) continue;
          const q = ny * W + nx, v = map[q];
          if (v === 1 && visited[q] === 0) {
            visited[q] = stackD[top];
            list.push(q);
            stackK[top] = k;
            stackP.push(q); stackK.push(0); stackD.push(stackD[top] + 1);
            descended = true;
            break;
          } else if (v === 2 && q !== start) {
            list.push(q);
            return true;
          }
        }
        if (descended) continue;
        stackP.pop(); stackK.pop(); stackD.pop();
      }
      return false;
    };
    this.nodes.forEach((p, i) => {
      visited[p] = 1;
      for (;;) {
        const list = [p];
        if (!dfs(p % W, (p / W) | 0, list)) break;
        const j = this.nodeAt.get(list[list.length - 1]);
        if (j === undefined) break;
        if (!this.adj[i].has(j)) { this.adj[i].set(j, list); this.adj[j].set(i, list.slice().reverse()); }
      }
    });
  }

  /** Pixels da trilha de `a` até `b` (listas das arestas concatenadas); [] se não houver rota. */
  route(a: Pt, b: Pt): Pt[] {
    const key = `${a.x},${a.y}>${b.x},${b.y}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = this.nodeIndex(a), t = this.nodeIndex(b);
    let out: Pt[] = [];
    if (s >= 0 && t >= 0) {
      const dist = new Float64Array(this.nodes.length).fill(Infinity), prev = new Int32Array(this.nodes.length).fill(-1);
      const done = new Uint8Array(this.nodes.length);
      dist[s] = 0;
      for (;;) {                                       // Dijkstra simples (≤ 100 nós)
        let u = -1, best = Infinity;
        for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0 || u === t) break;
        done[u] = 1;
        for (const [v, l] of this.adj[u]) if (dist[u] + l.length - 1 < dist[v]) { dist[v] = dist[u] + l.length - 1; prev[v] = u; }
      }
      if (Number.isFinite(dist[t])) {
        const nodes: number[] = [];
        for (let v = t; v >= 0; v = prev[v]) nodes.push(v);
        nodes.reverse();
        const px: number[] = [];
        for (let k = 0; k + 1 < nodes.length; k++) px.push(...this.adj[nodes[k]].get(nodes[k + 1])!);
        out = px.map(p => ({ x: p % W, y: (p / W) | 0 }));
      }
    }
    this.cache.set(key, out);
    return out;
  }

  /** Bolinhas da trilha: os pixels de índice 0, 8, 16... da rota. */
  dots(a: Pt, b: Pt, step = 8): Pt[] {
    return this.route(a, b).filter((_, i) => i % step === 0);
  }
}
