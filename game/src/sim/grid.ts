/**
 * Grade de passabilidade e custo por célula.
 * - Custo do terreno: `map.reg` (Terrain/Cost*: Land 8, Grass 8, Sand 14, Stones 12, Road 6...). A classe de cada id de tile vem de
 *   `assets/ui/hud/terrain.json` (gerado por tools/pipeline/mission.py olhando os pixels: água e rocha cinza bloqueiam).
 * - Objetos de cenário (árvores, pedras grandes) e pegadas de estruturas bloqueiam; pontes liberam a água embaixo.
 * - Ocupação dinâmica (uma unidade por célula) fica em `occ` e é mantida pelo World.
 */
export interface TerrainTable {
  classes: string[];
  cost: Record<string, number>;
  blocked: string[];
  tile: Record<string, number>;
}

export const BLOCK_TERRAIN = 1;
export const BLOCK_OBJECT = 2;
export const BLOCK_STRUCTURE = 4;
export const BLOCK_BORDER = 8;
/** parede de magia (Wall of Earth): bloqueia quem anda enquanto durar (World.areas) */
export const BLOCK_SPELL = 16;

export class Grid {
  readonly w: number;
  readonly h: number;
  /** custo de entrar na célula (>= 1); só vale onde block == 0 */
  readonly cost: Uint8Array;
  /** máscara de bloqueio estático */
  readonly block: Uint8Array;
  /** classe de terreno (índice em `classes`) */
  readonly terrain: Uint8Array;
  /** id (sim) da unidade que ocupa a célula, 0 = livre */
  readonly occ: Int32Array;
  readonly classes: string[];
  minCost = 6;

  constructor(w: number, h: number, classes: string[] = []) {
    this.w = w; this.h = h;
    this.cost = new Uint8Array(w * h).fill(8);
    this.block = new Uint8Array(w * h);
    this.terrain = new Uint8Array(w * h);
    this.occ = new Int32Array(w * h);
    this.classes = classes;
  }

  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x: number, y: number): number { return y * this.w + x; }

  /** passável para quem anda (ignora ocupação) */
  walkable(x: number, y: number): boolean { return this.inside(x, y) && this.block[y * this.w + x] === 0; }
  /** passável para quem voa: só a borda do mapa bloqueia */
  flyable(x: number, y: number): boolean { return this.inside(x, y) && (this.block[y * this.w + x] & BLOCK_BORDER) === 0; }

  passable(x: number, y: number, flying: boolean): boolean { return flying ? this.flyable(x, y) : this.walkable(x, y); }

  /** Célula livre (passável e desocupada) mais próxima de (x,y), em espiral até `maxR`. */
  nearestFree(x: number, y: number, flying = false, maxR = 12, ignore = 0): { x: number; y: number } | null {
    for (let r = 0; r <= maxR; r++) {
      let best: { x: number; y: number } | null = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx, cy = y + dy;
        if (!this.passable(cx, cy, flying)) continue;
        const o = this.occ[this.idx(cx, cy)]!;
        if (o !== 0 && o !== ignore) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: cx, y: cy }; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Constrói a grade a partir do mapa JSON. */
  static fromMap(map: MapLike, terr: TerrainTable | undefined, objects: Record<string, { name: string }>, structures: Record<string, { name: string; tw: number; th: number }>): Grid {
    const g = new Grid(map.w, map.h, terr?.classes ?? []);
    const costByClass = terr ? terr.classes.map(c => terr.cost[c] ?? 8) : [];
    const blockedClass = terr ? terr.classes.map(c => terr.blocked.includes(c)) : [];
    g.minCost = Math.max(1, Math.min(...(costByClass.length ? costByClass : [8])));
    for (let i = 0; i < map.w * map.h; i++) {
      const id = (map.tiles[i] ?? 0) & 0x1fff;
      const cls = terr?.tile[String(id)] ?? 0;
      g.terrain[i] = cls;
      g.cost[i] = costByClass[cls] ?? 8;
      if (blockedClass[cls]) g.block[i]! |= BLOCK_TERRAIN;
    }
    // borda: 1 célula em volta do mapa
    for (let x = 0; x < map.w; x++) { g.block[x]! |= BLOCK_BORDER; g.block[(map.h - 1) * map.w + x]! |= BLOCK_BORDER; }
    for (let y = 0; y < map.h; y++) { g.block[y * map.w]! |= BLOCK_BORDER; g.block[y * map.w + map.w - 1]! |= BLOCK_BORDER; }
    for (const [ox, oy, id] of map.objs) {
      const name = objects[String(id)]?.name ?? "";
      if (!objectBlocks(name)) continue;
      if (g.inside(ox, oy)) g.block[g.idx(ox, oy)]! |= BLOCK_OBJECT;
    }
    for (const s of map.structures) {
      const def = structures[String(s.kind)];
      if (!def) continue;
      const x0 = Math.floor(s.x), y0 = Math.floor(s.y);
      const bridge = /bridge/i.test(def.name);
      for (let dy = 0; dy < def.th; dy++) for (let dx = 0; dx < def.tw; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (!g.inside(x, y)) continue;
        const i = g.idx(x, y);
        if (bridge) { g.block[i]! &= ~(BLOCK_TERRAIN | BLOCK_OBJECT); g.cost[i] = 6; }
        else if (!/pointer/i.test(def.name) && !FLAT_STRUCTURE.test(def.name)) g.block[i]! |= BLOCK_STRUCTURE;
      }
    }
    return g;
  }
}

/** Estruturas "chão" (desenhos no solo que se pisa, não paredes): Magic Symbol (a armadilha de teleporte da missão 53 fica em cima de um),
 *  Teleport Pad, Saving Place, Crater (a cratera da Estrela, missões 50/60). Decisão nossa [est]: docs/GAPS.md [MISSÕES-C]. */
export const FLAT_STRUCTURE = /^(magic symbol|teleport pad|saving place|crater)/i;

/** Objetos que não bloqueiam a passagem (arbustos, pedrinhas, ossos, totens pequenos...). Decisão: ver docs/GAPS.md. */
export function objectBlocks(name: string): boolean {
  return !/bush|smallstone|small stone|bones|skull|grass|flower|pointer|stump|mushroom/i.test(name);
}

export interface MapLike {
  w: number; h: number;
  tiles: number[];
  alt: number[];
  objs: [number, number, number][];
  structures: { x: number; y: number; kind: number; hp: number; owner: number; id: number }[];
  units: { x: number; y: number; kind: number; player: number; [k: string]: unknown }[];
  players: { id: number; name: string; [k: string]: unknown }[];
}
