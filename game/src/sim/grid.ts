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
  /** velocidade F do exe por id de tile (`[0x670e48]+célula`, medida no original; tools/refcap/diff/tile_speed.py) — prevalece
   *  sobre o custo da classe */
  speed?: Record<string, number>;
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
  /** altura por célula (map.alt; o exe guarda a mesma em `[0x670e48]+0x944f4`): acelera a descida / freia a subida do andar */
  /** estruturas com máscara de passagem (data.bin Buildings.Passability), na ordem do mapa: canto, largura, altura, máscara (bit
   *  dy×w + dx = bloqueia) e o bloqueio que cada célula do pé tinha antes da estrutura — o exe guarda um registro de ocupação por
   *  célula do pé (sim/exe/mapbuild.ts) */
  readonly structs: { x: number; y: number; w: number; h: number; pass: number; under: Uint8Array }[] = [];
  readonly alt: Int16Array;
  minCost = 6;

  constructor(w: number, h: number, classes: string[] = []) {
    this.w = w; this.h = h;
    this.alt = new Int16Array(w * h);
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
  static fromMap(map: MapLike, terr: TerrainTable | undefined, objects: Record<string, { name: string }>, structures: Record<string, { name: string; tw: number; th: number; pass?: number }>): Grid {
    const g = new Grid(map.w, map.h, terr?.classes ?? []);
    const costByClass = terr ? terr.classes.map(c => terr.cost[c] ?? 8) : [];
    const blockedClass = terr ? terr.classes.map(c => terr.blocked.includes(c)) : [];
    g.minCost = Math.max(1, Math.min(...(costByClass.length ? costByClass : [8]), ...Object.values(terr?.speed ?? {})));
    for (let i = 0; i < map.w * map.h; i++) {
      const id = (map.tiles[i] ?? 0) & 0x1fff;
      const cls = terr?.tile[String(id)] ?? 0;
      g.terrain[i] = cls;
      g.cost[i] = terr?.speed?.[String(id)] ?? costByClass[cls] ?? 8;
      g.alt[i] = map.alt?.[i] ?? 0;
      // bloqueio do terreno pela regra do exe (0x5547e6, plano de passagem `[0x670e48]+0x10000` bit 1), não pela classe visual
      if (terr ? exeTileBlocked(id) : blockedClass[cls]) g.block[i]! |= BLOCK_TERRAIN;
    }
    // bit 0x2000 do tile cru (lista `tileBlock` do JSON do mapa) também bloqueia [exe 0x5547e6]
    for (const i of map.tileBlock ?? []) if (i >= 0 && i < map.w * map.h) g.block[i]! |= BLOCK_TERRAIN;
    // borda: as 8 células em volta da área útil valem 0x1f no plano de passagem do exe (0x553b99) — nada anda nem voa ali
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (x < MAP_BORDER || y < MAP_BORDER || x >= map.w - MAP_BORDER || y >= map.h - MAP_BORDER || x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1) g.block[y * map.w + x]! |= BLOCK_BORDER;
    }
    // todo objeto de cenário bloqueia (0x5548f1: byte do objeto ≠ 0 → 5), inclusive arbustos, ossos e pedrinhas (medido: 0 de 1300
    // células com objeto livres no original, fora as cobertas por ponte)
    for (const [ox, oy] of map.objs) {
      if (g.inside(ox, oy)) g.block[g.idx(ox, oy)]! |= BLOCK_OBJECT;
    }
    for (const s of map.structures) {
      // ponte de madeira de tamanho variável (tipo 0x21, com ou sem o bit 0x1000000; +8 bytes no .alm = largura, altura): o tabuleiro
      // inteiro passa sobre a água [est: a máscara de 1×1 do data.bin não cobre o tamanho variável; travessias da missão 76]
      if ((s.kind & 0xffffff) === 0x21 && s.extra && s.extra.length >= 2) {
        const x0 = Math.floor(s.x), y0 = Math.floor(s.y);
        for (let dy = 0; dy < s.extra[1]!; dy++) for (let dx = 0; dx < s.extra[0]!; dx++) {
          const x = x0 + dx, y = y0 + dy;
          if (!g.inside(x, y)) continue;
          const i = g.idx(x, y);
          g.block[i]! &= ~(BLOCK_TERRAIN | BLOCK_OBJECT | BLOCK_STRUCTURE);
          if (((map.tiles[i] ?? 0) & 0x300) === 0x200) g.cost[i] = 8;
        }
        continue;
      }
      const def = structures[String(s.kind)];
      if (!def) continue;
      const x0 = Math.floor(s.x), y0 = Math.floor(s.y);
      const bridge = /bridge/i.test(def.name);
      const rec = def.pass !== undefined ? { x: x0, y: y0, w: def.tw, h: def.th, pass: def.pass >>> 0, under: new Uint8Array(def.tw * def.th) } : null;
      if (rec) g.structs.push(rec);
      for (let dy = 0; dy < def.th; dy++) for (let dx = 0; dx < def.tw; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (!g.inside(x, y)) continue;
        const i = g.idx(x, y);
        if (rec) rec.under[dy * def.tw + dx] = g.block[i]!;
        if (def.pass !== undefined) {
          // máscara de passagem da estrutura (data.bin Buildings.Passability; bit dy×tw + dx) [exe 0x550bbf]: 1 → `| 5` (bloqueia),
          // 0 → `& 0xfa` (livra o terreno e o objeto embaixo: o tabuleiro da ponte sobre a água, os cantos das casas); F fica o do tile
          if ((def.pass >>> (dy * def.tw + dx)) & 1) g.block[i]! |= BLOCK_STRUCTURE;
          else {
            g.block[i]! &= ~(BLOCK_TERRAIN | BLOCK_OBJECT | BLOCK_STRUCTURE);
            if (((map.tiles[i] ?? 0) & 0x300) === 0x200) g.cost[i] = 8;   // água sob a ponte: F = 8 (0x55494d)
          }
          continue;
        }
        if (bridge) { g.block[i]! &= ~(BLOCK_TERRAIN | BLOCK_OBJECT); if (((map.tiles[i] ?? 0) & 0x300) === 0x200) g.cost[i] = 8; }
        else if (!/pointer/i.test(def.name) && !FLAT_STRUCTURE.test(def.name)) g.block[i]! |= BLOCK_STRUCTURE;
      }
    }
    return g;
  }
}

/** Largura da borda intransponível em volta da área útil do mapa (plano de passagem do exe = 0x1f, 0x553b99). */
export const MAP_BORDER = 8;

/** Peso de transição por linha (bits 4–5 do id) × posição (bits 0–3) do exe (`[0x670e48]+0x540a6`, escrito em 0x553f34). */
const EXE_TILE_W = [
  [2, 3, 2, 4, 3, 4, 2, 2, 2, 2, 4, 4, 4, 4],
  [3, 5, 3, 3, 1, 3, 2, 4, 2, 2, 4, 2, 4, 4],
  [2, 3, 2, 4, 3, 4, 2, 4, 2, 2, 4, 2, 4, 4],
  [5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 4, 4, 4, 4],
];

/** Tile intransponível para quem anda, como o exe monta o plano de passagem (0x5547e6 + classe 0x55494d): água (id & 0x300 = 0x200,
 *  arquivos 32–47) ou classe 8 = rocha (grupo de arquivos 28–31, `(id & 0x3c0) >> 6 = 7`, com peso da tabela > 2; os demais tiles do
 *  grupo são classe 6). O bit 0x2000 do tile cru (também bloqueia) não chega ao JSON do mapa (alm_export guarda `& 0x1fff`). */
export function exeTileBlocked(id: number): boolean {
  if ((id & 0x300) === 0x200) return true;
  if (((id & 0x3c0) >> 6) !== 7) return false;
  const idx = id & 0xf;
  return idx < 14 && EXE_TILE_W[(id & 0x30) >> 4]![idx]! > 2;
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
  /** células com o bit 0x2000 do tile cru (intransponíveis) */
  tileBlock?: number[];
  alt: number[];
  objs: [number, number, number][];
  structures: { x: number; y: number; kind: number; hp: number; owner: number; id: number; extra?: number[] }[];
  units: { x: number; y: number; kind: number; player: number; [k: string]: unknown }[];
  players: { id: number; name: string; [k: string]: unknown }[];
}
