/**
 * Objetos de cenário e estruturas animados + sombras (frente MOTOR-B).
 * Dados: assets/ui/hud/anim/world/world.json (tools/pipeline/anim_world.py):
 *   - objetos (objects.reg): quadro = AnimationFrame + Index no atlas do arquivo; AnimationTime em 1/16 s (árvores
 *     balançam: 7 quadros × 4 = 1,75 s, conferido nas capturas do original); cada objeto começa numa fase aleatória estável;
 *   - estruturas (structures.reg): fases montadas (AnimMask/AnimFrame/AnimTime: moinhos, poços, fogueira, igreja, ponte...);
 *   - camada B (contorno de suavização a 50%) quando Settings.smoothing está ligado;
 *   - sombra = a própria silhueta em preto (alfa SHADOW_ALPHA) inclinada para cima/esquerda (SHADOW_SHEAR px por px de altura
 *     acima do pé), como nas capturas do original; estruturas inclinam a partir da linha ShadowY (px acima da base da imagem;
 *     ≥ 10000 = sem sombra) e as planas (Flat: pontes, fogueira, símbolo) não têm sombra.
 * Só os blocos de 16×16 células visíveis são animados/desenhados.
 */
import { Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Game } from "../core/game";
import { ANIM_UNIT_MS } from "./animTiming";
import type { Relief } from "./relief";
import type { MissionData } from "./setup";

export const WORLD_BASE = "assets/ui/hud/anim/world/";
const TILE = 32;
const CHUNK = 16;
/** inclinação da sombra (px para a esquerda por px de altura) e opacidade — medidas nas capturas do original (ver GAPS) */
export const SHADOW_SHEAR = 0.75;
export const SHADOW_ALPHA = 0.4;
const SHADOW_SKEW = Math.atan(SHADOW_SHEAR);
const SHADOW_SY = 1 / Math.cos(SHADOW_SKEW);
/** Antes da frente RELEVO, objetos e estruturas subiam 22 px fixos (medidos na missão 10). Agora sobem a altitude como no exe
 *  (mission/relief.ts): objetos = média truncada dos 4 cantos da célula; estruturas = altura bilinear no centro da pegada.
 *  OBJ_LIFT fica só como sobra constante (0 = nenhuma). */
export const OBJ_LIFT = 0;

export interface ObjDef { name: string; file: number; frames: number[]; times: number[]; ax: number; ay: number; }
export interface ObjFile { image: string; imageB?: string; cw: number; ch: number; cols: number; count: number; sizes: [number, number][]; }
export interface StDef {
  name: string; image: string; imageB?: string; w: number; h: number; count: number; tw: number; th: number; fh: number;
  dead: number; shadowY: number; flat: boolean; light?: number; frames?: number[]; times?: number[];
}
export interface PrDef { image: string; cw: number; ch: number; cols: number; count: number; phases: number; dirs: number; homing: boolean; sfx: boolean; src: string; }
export interface WorldJson {
  objects: Record<string, ObjDef>;
  objectFiles: Record<string, ObjFile>;
  structures: Record<string, StDef>;
  projectiles: Record<string, PrDef>;
}

/** Atlas em grade: texturas dos quadros fatiadas sob demanda. */
export class GridAtlas {
  private frames: (Texture | undefined)[] = [];
  constructor(readonly base: Texture, readonly cw: number, readonly ch: number, readonly cols: number, readonly count: number) {}
  frame(i: number): Texture {
    const n = Math.max(0, Math.min(this.count - 1, i | 0));
    let t = this.frames[n];
    if (!t) {
      t = new Texture({ source: this.base.source, frame: new Rectangle((n % this.cols) * this.cw, Math.floor(n / this.cols) * this.ch, this.cw, this.ch) });
      this.frames[n] = t;
    }
    return t;
  }
}

/** Hash inteiro estável (fase inicial dos objetos). */
export function hash3(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Quadro (índice em `frames`) de uma sequência (times em 1/16 s) no instante `ms`. */
export function seqIndex(times: number[], ms: number): number {
  let total = 0;
  for (const t of times) total += t;
  if (!total) return 0;
  let k = Math.floor(ms / ANIM_UNIT_MS) % total;
  for (let i = 0; i < times.length; i++) { if (k < times[i]!) return i; k -= times[i]!; }
  return 0;
}

interface Item {
  sprite: Sprite;
  b?: Sprite;
  shadow?: Sprite;
  atlas: GridAtlas;
  atlasB?: GridAtlas;
  frames: number[];
  times: number[];
  offset: number;
  cur: number;
}

let worldJson: Promise<WorldJson | undefined> | undefined;
export function loadWorldJson(game: Game): Promise<WorldJson | undefined> {
  worldJson ??= game.data.tryJson<WorldJson>(WORLD_BASE + "world.json");
  return worldJson;
}

/** Cria a sombra de um sprite: mesma textura/âncora, preta, inclinada. `pivotY` = px abaixo do ponto de âncora onde a sombra "pisa"
 *  (0 = no pé). */
export function makeShadow(tex: Texture, ax: number, ay: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(ax, ay);
  s.tint = 0x000000;
  s.alpha = SHADOW_ALPHA;
  s.skew.x = SHADOW_SKEW;
  s.scale.y = SHADOW_SY;
  return s;
}

export class WorldAnim {
  private chunks: Item[][] = [];
  private animated: Item[][] = [];
  private chunkCols = 0;
  private visibleChunks = new Set<number>();
  private atlases = new Map<string, Promise<GridAtlas | undefined>>();
  /** quantos objetos/estruturas foram montados (diagnóstico) */
  stats = { objects: 0, structures: 0, animated: 0 };

  constructor(private readonly game: Game, private readonly data: MissionData, private readonly sorted: Container,
    private readonly ground: Container, private readonly shadows: Container, private readonly relief?: Relief) {}

  private atlas(image: string, cw: number, ch: number, cols: number, count: number): Promise<GridAtlas | undefined> {
    let p = this.atlases.get(image);
    if (!p) {
      p = Assets.load<Texture>(WORLD_BASE + image).then(t => { t.source.scaleMode = "nearest"; return new GridAtlas(t, cw, ch, cols, count); })
        .catch(() => undefined);
      this.atlases.set(image, p);
    }
    return p;
  }

  /** estruturas estáticas por id do mapa (quadro "vivo" e quadro "destruída" = `dead` de structures.reg): alavancas ligadas mostram o 2º quadro */
  private byStructure = new Map<number, { it: Item; alive: number; dead: number }>();

  /** Troca o quadro de uma estrutura entre o normal e o "destruído" (alavanca ligada); sem efeito se a estrutura é animada. */
  setStructureDead(id: number, dead: boolean): void {
    const s = this.byStructure.get(id);
    if (!s) return;
    const f = dead ? s.dead : s.alive, t = s.it.atlas.frame(f);
    s.it.sprite.texture = t;
    if (s.it.b && s.it.atlasB) s.it.b.texture = s.it.atlasB.frame(f);
    if (s.it.shadow) s.it.shadow.texture = t;
  }

  private add(cx: number, cy: number, it: Item): void {
    const k = Math.floor(cy / CHUNK) * this.chunkCols + Math.floor(cx / CHUNK);
    (this.chunks[k] ??= []).push(it);
    if (it.frames.length > 1) (this.animated[k] ??= []).push(it);
    it.sprite.visible = false;
    if (it.b) it.b.visible = false;
    if (it.shadow) it.shadow.visible = false;
  }

  /** Monta objetos e estruturas. Devolve false se world.json não existir (a cena usa o desenho estático antigo). */
  async load(smoothing: boolean): Promise<boolean> {
    const wj = await loadWorldJson(this.game);
    if (!wj) return false;
    const map = this.data.map;
    this.chunkCols = Math.ceil(map.w / CHUNK);
    // --- objetos
    const files = new Map<number, [GridAtlas | undefined, GridAtlas | undefined]>();
    const used = [...new Set(map.objs.map(o => wj.objects[String(o[2])]?.file).filter((f): f is number => f !== undefined))];
    await Promise.all(used.map(async f => {
      const fe = wj.objectFiles[String(f)];
      if (!fe) return;
      const [a, b] = await Promise.all([
        this.atlas(fe.image, fe.cw, fe.ch, fe.cols, fe.count),
        smoothing && fe.imageB ? this.atlas(fe.imageB, fe.cw, fe.ch, fe.cols, fe.count) : Promise.resolve(undefined),
      ]);
      files.set(f, [a, b]);
    }));
    for (const [ox, oy, id] of map.objs) {
      const def = wj.objects[String(id)];
      const fe = def ? wj.objectFiles[String(def.file)] : undefined;
      const [atlas, atlasB] = def ? files.get(def.file) ?? [] : [];
      if (!def || !fe || !atlas) continue;
      const offset = hash3(ox, oy, id) % 100000;
      const k0 = def.frames.length > 1 ? seqIndex(def.times, offset) : 0;
      const tex = atlas.frame(def.frames[k0]!);
      const ax = def.ax / fe.cw, ay = def.ay / fe.ch;
      const s = new Sprite(tex);
      s.anchor.set(ax, ay);
      const px = (ox + 0.5) * TILE, py = (oy + 0.5) * TILE - OBJ_LIFT - (this.relief?.cellAvg(ox, oy) ?? 0);
      s.position.set(px, py);
      // mesma ordem de antes: o objeto fica na frente de unidades da mesma linha de células
      s.zIndex = (oy + 1) * TILE - 6;
      let b: Sprite | undefined;
      if (atlasB) {
        b = new Sprite(atlasB.frame(def.frames[k0]!));
        b.anchor.set(ax, ay);
        b.alpha = 0.5;
        s.addChild(b);
        b.position.set(0, 0);
        b.anchor.set(ax, ay);
      }
      const sh = makeShadow(tex, ax, ay);
      sh.position.set(px, py);
      this.shadows.addChild(sh);
      this.sorted.addChild(s);
      const it: Item = { sprite: s, b, shadow: sh, atlas, atlasB, frames: def.frames, times: def.times, offset, cur: k0 };
      this.add(ox, oy, it);
      this.stats.objects++;
      if (def.frames.length > 1) this.stats.animated++;
    }
    // --- estruturas
    for (const st of map.structures) {
      const def = wj.structures[String(st.kind)];
      if (!def) continue;
      const [atlas, atlasB] = await Promise.all([
        this.atlas(def.image, def.w, def.h, def.count, def.count),
        smoothing && def.imageB ? this.atlas(def.imageB, def.w, def.h, def.count, def.count) : Promise.resolve(undefined),
      ]);
      if (!atlas) continue;
      const frames = def.frames?.length ? def.frames : [0];
      const times = def.times?.length ? def.times : [];
      const offset = hash3(Math.floor(st.x), Math.floor(st.y), st.kind) % 100000;
      const k0 = frames.length > 1 ? seqIndex(times, offset) : 0;
      const s = new Sprite(atlas.frame(frames[k0]!));
      // (x,y) = centro da célula do canto superior esquerdo da pegada; a imagem tem FullHeight linhas com a pegada embaixo
      // relevo: altura bilinear no centro da pegada (exe 0x46025d: x + (tw·128 − 128) em 1/256 de célula)
      const lift = OBJ_LIFT + (this.relief?.heightAt(st.x + (def.tw - 1) / 2, st.y + (def.th - 1) / 2) ?? 0);
      const left = (st.x - 0.5) * TILE, bottom = (st.y - 0.5 + def.th) * TILE - lift;
      s.position.set(left, bottom - def.h);
      const bridge = /bridge/i.test(def.name);
      s.zIndex = bridge ? -100000 : bottom + lift - 2;
      let b: Sprite | undefined;
      if (atlasB) { b = new Sprite(atlasB.frame(frames[k0]!)); b.alpha = 0.5; s.addChild(b); }
      let sh: Sprite | undefined;
      if (!def.flat && def.shadowY > 0 && def.shadowY < 10000 && !bridge) {
        // a sombra inclina a partir da linha ShadowY (px acima da base da imagem)
        const ay = Math.max(0, Math.min(1, (def.h - def.shadowY) / def.h));
        sh = makeShadow(atlas.frame(frames[k0]!), 0, ay);
        sh.position.set(left, bottom - def.shadowY);
        this.shadows.addChild(sh);
      }
      if (bridge || def.flat) this.ground.addChild(s); else this.sorted.addChild(s);
      const it: Item = { sprite: s, b, shadow: sh, atlas, atlasB, frames, times, offset, cur: k0 };
      // a estrutura pode ocupar vários blocos: registra no bloco do canto e no do pé (o que estiver visível a mostra)
      this.add(Math.floor(st.x), Math.floor(st.y), it);
      if (st.id != null && frames.length === 1) this.byStructure.set(st.id, { it, alive: frames[0]!, dead: def.dead });
      this.stats.structures++;
      if (frames.length > 1) this.stats.animated++;
    }
    return true;
  }

  /** Atualiza visibilidade por bloco e o quadro dos animados visíveis. `view` em px do mundo; `now` em ms. */
  update(view: { x: number; y: number; w: number; h: number }, now: number): void {
    // margem: árvores (128 px) e estruturas grandes (até ~11 tiles) passam da borda do bloco
    const m = 6 * TILE;
    const x0 = Math.max(0, Math.floor((view.x - m) / (CHUNK * TILE))), x1 = Math.floor((view.x + view.w + m) / (CHUNK * TILE));
    const y0 = Math.max(0, Math.floor((view.y - m) / (CHUNK * TILE))), y1 = Math.floor((view.y + view.h + m * 1.5) / (CHUNK * TILE));
    const want = new Set<number>();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= Math.min(this.chunkCols - 1, x1); cx++) want.add(cy * this.chunkCols + cx);
    for (const k of this.visibleChunks) if (!want.has(k)) this.setChunk(k, false);
    for (const k of want) if (!this.visibleChunks.has(k)) this.setChunk(k, true);
    this.visibleChunks = want;
    for (const k of want) {
      const list = this.animated[k];
      if (!list) continue;
      for (const it of list) {
        const i = seqIndex(it.times, now + it.offset);
        if (i === it.cur) continue;
        it.cur = i;
        const f = it.frames[i]!;
        const t = it.atlas.frame(f);
        it.sprite.texture = t;
        if (it.b && it.atlasB) it.b.texture = it.atlasB.frame(f);
        if (it.shadow) it.shadow.texture = t;
      }
    }
  }

  private setChunk(k: number, on: boolean): void {
    for (const it of this.chunks[k] ?? []) {
      it.sprite.visible = on;
      if (it.shadow) it.shadow.visible = on;
    }
  }
}
