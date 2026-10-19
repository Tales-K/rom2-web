/**
 * Desenho do mapa da missão com PixiJS: terreno (tiles 32×32 em blocos de 16×16 com recorte pela câmera; água animada),
 * sombras, objetos/estruturas animados (worldanim.ts) e unidades num único container ordenado por Y, efeitos e projéteis
 * (effects.ts), luz do dia/noite (daynight.ts), sacos de loot, barras de vida e números de dano.
 * Unidades (frente MOTOR-B): atlas indexados com a paleta do nível do monstro (palette.ts), camada B de suavização
 * (Settings.smoothing), sombra inclinada como nas capturas do original, tempos das animações em 1/16 s (units.reg).
 */
import { ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Texture, type Text } from "pixi.js";
import type { Game } from "../core/game";
import { makeText } from "../ui/text";
import type { SimEvent } from "../sim/types";
import type { Unit, World } from "../sim/world";
import { ANIM_BASE, ANIM_UNIT_MS, UnitSheet, attackSeq, dyingSeq, idleSeq, moveSeq, phaseAt, simTicksToAnim, type AnimMeta, type UnitFrame } from "./anim";
import { daylight, gameMinutes, lightColor } from "./daynight";
import { type BarKind, barFill, drawBar, hpKind } from "./bars";
import { Effects } from "./effects";
import { loadPaletted } from "./palette";
import { Relief, lightParamsAt } from "./relief";
import type { MissionData } from "./setup";
import { TerrainMesh } from "./terrainmesh";
import { SHADOW_ALPHA, WorldAnim, makeShadow } from "./worldanim";

export const TILE = 32;
const CHUNK = 16;
/** tiques da simulação (50 ms) por fase dos ossos (corpo → esqueleto → ossos): 8 s, palpite (ver GAPS) */
const BONE_PHASE_TICKS = 160;
/** Ganho de brilho do mundo: as capturas do original (refs/original/mission10_idle_000) mostram terreno, objetos e sprites
 *  ≈1,55× mais claros que as cores das paletas (razão medida em blocos de terreno plano 1,4–1,7; placa 1,62); o HUD não.
 *  Provável iluminação do mapa (info.brightness/contrast + sol); ver GAPS. */
const WORLD_GAIN = 1.55;

/** Cores por jogador (faixa sob a unidade / minimapa). */
export const PLAYER_COLORS = [0xffffff, 0x4cff4c, 0xc0c0c0, 0xff4a4a, 0xd0d0d0, 0xffd84a, 0xff6fff, 0xff9a3c, 0x8cb4ff, 0x5af0f0];

/** Barras de vida/mana sobre a unidade, como o allods2.exe desenha (função virtual 0x4653a5 / auxiliar 0x460db1):
 *  - retângulo da seleção do units.reg (SelectionX1..X2, topo em SelectionY1); pontas = Ball.bmp 4×4 em (x1, y−2) e (x2−4, y−2);
 *  - trilho (x1+4 .. x2−4, linhas y−2..y+1): 0x404040, com a linha y−1 = 0x808080 e a linha y = 0x606060;
 *  - preenchimento = int(vida × (x2−x1−8) / vidaMax), mínimo 1 se vida ≠ 0: linhas y−2 e y+1 = escura (0x80), y−1 = clara (0xFF),
 *    y = média (0xC0); verde, amarelo se vida < máx/4·2 (metade), vermelho se vida < máx/4;
 *  - mana (se ManaMax > 0) 4 px abaixo, sempre azul, mínimo 1;
 *  - modo "apagado" (bandeira do mundo +0xab8 e unidade sem a bandeira +0x80 — interpretamos como "não selecionada"): só o
 *    preenchimento, com cores pela metade sobre o fundo escurecido, sem trilho. */

interface UnitView {
  root: Container;
  /** sombra (no container `shadows`, sob tudo) */
  shadow: Sprite;
  sprite: Sprite;
  /** camada B (suavização), filha do sprite */
  b?: Sprite;
  sheetB?: UnitSheet;
  bar: Container;
  barG: Graphics;
  balls: Sprite[];
  sheet?: UnitSheet;
  meta?: AnimMeta;
  offY: number;
  lift: number;
}

interface Floater { t: Text; y0: number; born: number; }
/** texto de dano do original (m10 combate, 19/10): algarismos font3 salmão 0xe77152 com sombra, a 2 px da ponta direita da barra e 10 px abaixo do trilho,
 *  subindo ~27 px/s por 1 s */
const DAMAGE_COLOR = 0xe77152, DAMAGE_LIFE_MS = 1000, DAMAGE_RISE_PX_S = 27;

export class MapView {
  readonly root = new Container();
  readonly terrain = new Container();
  readonly ground = new Container();
  /** sombras de objetos, estruturas e unidades (acima do chão, abaixo de tudo o que fica em pé) */
  readonly shadows = new Container();
  readonly sorted = new Container();
  /** mundo iluminado (terreno, chão, sombras, objetos, unidades, luz): recebe o ganho de brilho do original */
  readonly lit = new Container();
  private litFilter = (() => { const f = new ColorMatrixFilter(); f.brightness(WORLD_GAIN, false); return f; })();
  /** luz ambiente (dia/noite): retângulo multiplicativo do tamanho da vista */
  readonly light = new Sprite(Texture.WHITE);
  readonly fx = new Container();
  /** barras de vida/mana (acima das unidades) */
  readonly bars = new Container();
  readonly effects: Effects;
  private ballTex: Texture = Texture.EMPTY;
  private hoverFilter = (() => { const f = new ColorMatrixFilter(); f.brightness(1.5, false); return f; })();
  private chunks: Container[] = [];
  private chunkCols = 0;
  private tileTex: Texture[] = [];
  private sheets = new Map<string, UnitSheet>();
  private sheetsB = new Map<string, UnitSheet>();
  private views = new Map<number, UnitView>();
  private lootGfx = new Map<number, Container>();
  private floaters: Floater[] = [];
  private worldAnim?: WorldAnim;
  /** terreno: sprites de água por bloco (4 quadros, UnityAllods: arquivos tile3-00..15 = 4 grupos × 4 formas) */
  private water: { s: Sprite; w: number; g: number; r: number }[][] = [];
  private waterStep = -1;
  private visibleChunks = new Set<number>();
  private smoothing = true;
  selectedId = 0;
  /** unidade visível para o jogador (névoa de guerra); padrão: todas */
  isVisible: (u: Unit) => boolean = () => true;
  hoverId = 0;
  /** tom médio de cada tile (para o minimapa) */
  tileColor: number[] = [];
  /** tempos médios (ms) da atualização — diagnóstico de desempenho (`__mission.view.perf`) */
  perf = { update: 0, world: 0, units: 0, fx: 0 };
  /** relevo (altitude por vértice) e luz do terreno (mission/relief.ts) */
  readonly relief: Relief;
  /** terreno em malha com relevo (WebGL); sem ele, os sprites planos de `chunks` */
  private terrainMesh?: TerrainMesh;
  /** minuto (múltiplo de 20) da última luz calculada: o exe refaz a luz a cada 20 minutos do jogo */
  private lightSlot = -1;

  constructor(private readonly game: Game, private readonly data: MissionData, private readonly world: World) {
    this.relief = new Relief(data.map.w, data.map.h, data.map.alt);
    this.sorted.sortableChildren = true;
    this.light.blendMode = "multiply";
    this.light.visible = false;
    this.effects = new Effects(game, world, data.anim);
    this.effects.heightAt = (x, y) => this.relief.heightAt(x, y);
    this.fx.addChild(this.effects.layer);
    this.lit.addChild(this.terrain, this.ground, this.shadows, this.sorted, this.light);
    this.lit.filters = [this.litFilter];
    this.root.addChild(this.lit, this.bars, this.fx);
    // os eventos da simulação são consumidos (e esvaziados) pela cena antes do desenho: espiamos o push para os efeitos
    // (explosões, áreas, teleporte) sem depender da MissionScene
    const ev = world.events as SimEvent[];
    const push = ev.push.bind(ev);
    ev.push = (...items: SimEvent[]) => {
      for (const e of items) { try { this.onSimEvent(e); } catch { /* efeito visual não pode derrubar a simulação */ } }
      return push(...items);
    };
  }

  /** Evento da simulação (chamado pelo gancho do construtor). */
  onSimEvent(e: SimEvent): void { this.effects.onSimEvent(e); }

  async load(onProgress?: (s: string) => void): Promise<void> {
    const d = this.data, map = d.map;
    try { this.ballTex = await this.game.data.texture("assets/ui/hud/ball.png"); } catch { /* pontas sem bitmap */ }
    onProgress?.("terrain");
    const names = d.terrainNames.length ? d.terrainNames : Array.from({ length: 52 }, (_, i) => `tile${(i >> 4) + 1}-${String(i & 15).padStart(2, "0")}`);
    const files = await Promise.all(names.map(n => this.game.data.texture(`assets/terrain/${n}.png`).catch(() => Texture.EMPTY)));
    files.forEach((base, f) => {
      const rows = Math.floor((base.height || 0) / TILE);
      for (let r = 0; r < 16; r++) {
        this.tileTex[f * 16 + r] = r < rows ? new Texture({ source: base.source, frame: new Rectangle(0, r * TILE, TILE, TILE) }) : Texture.WHITE;
      }
    });
    this.tileColor = computeTileColors(files);
    this.updateTerrainLight(true);
    // terreno com relevo: malha por bloco (só WebGL); mapa plano ou outro renderizador: sprites por célula
    const webgl = (this.game.app.renderer as unknown as { name?: string }).name === "webgl";
    if (webgl && !this.relief.flat) {
      try {
        this.terrainMesh = new TerrainMesh(this.relief, map.tiles, files, WORLD_GAIN);
        this.terrain.addChild(this.terrainMesh.root);
      } catch (e) { console.warn("[view] terreno com relevo indisponível:", e); this.terrainMesh = undefined; }
    }
    // blocos de terreno
    this.chunkCols = Math.ceil(map.w / CHUNK);
    if (this.terrainMesh) this.chunkCols = 0;
    const chunkRows = Math.ceil(map.h / CHUNK);
    for (let cy = 0; cy < chunkRows; cy++) for (let cx = 0; cx < this.chunkCols; cx++) {
      const c = new Container();
      c.visible = false;
      const water: { s: Sprite; w: number; g: number; r: number }[] = [];
      for (let y = cy * CHUNK; y < Math.min(map.h, (cy + 1) * CHUNK); y++) for (let x = cx * CHUNK; x < Math.min(map.w, (cx + 1) * CHUNK); x++) {
        const id = (map.tiles[y * map.w + x] ?? 0) & 0x1fff;
        const s = new Sprite(this.tileTex[id] ?? Texture.WHITE);
        if (!this.tileTex[id]) s.tint = 0xff00ff;
        s.position.set(x * TILE, y * TILE);
        c.addChild(s);
        const f = id >> 4;
        if (f >= 32 && f <= 47) water.push({ s, w: (f - 32) & 3, g: (f - 32) >> 2, r: id & 15 });
      }
      this.water.push(water);
      this.chunks.push(c);
      this.terrain.addChild(c);
    }
    // objetos de cenário e estruturas animados (world.json); sem ele, o desenho estático antigo
    onProgress?.("objects");
    this.smoothing = this.game.state.settings.smoothing !== false;
    this.worldAnim = new WorldAnim(this.game, d, this.sorted, this.ground, this.shadows, this.relief);
    let animated = false;
    try { animated = await this.worldAnim.load(this.smoothing); } catch (e) { console.warn("[view] objetos animados indisponíveis:", e); }
    if (!animated) { this.worldAnim = undefined; await this.loadStaticWorld(); }
    await this.effects.load().catch(() => undefined);
    // folhas de animação das unidades presentes
    onProgress?.("units");
    await this.loadUnitSheets();
    for (const u of this.world.units) this.viewFor(u);
  }

  /** Estrutura do mapa (id do script) mostrada "destruída"/ligada (quadro `dead` de structures.reg): alavancas. */
  setStructureDead(id: number, dead: boolean): void { this.worldAnim?.setStructureDead(id, dead); }

  /** Objetos/estruturas estáticos (assets/objects, assets/structures) — reserva quando world.json falta. */
  private async loadStaticWorld(): Promise<void> {
    const d = this.data, map = d.map;
    const objIds = [...new Set(map.objs.map(o => o[2]))].filter(id => d.objects[String(id)]);
    const objTex = new Map<number, Texture>();
    await Promise.all(objIds.map(async id => { try { objTex.set(id, await this.game.data.texture(`assets/objects/obj_${id}.png`)); } catch { /* sem sprite */ } }));
    for (const [ox, oy, id] of map.objs) {
      const t = objTex.get(id), def = d.objects[String(id)];
      if (!t || !def) continue;
      const s = new Sprite(t);
      s.anchor.set(0.5, 1);
      s.position.set((ox + 0.5) * TILE, (oy + 1) * TILE - 4 - this.relief.cellAvg(ox, oy));
      s.zIndex = (oy + 1) * TILE - 6;
      this.sorted.addChild(s);
    }
    for (const st of map.structures) {
      const def = d.structures[String(st.kind)];
      if (!def) continue;
      let t: Texture | undefined;
      try { t = await this.game.data.texture(`assets/structures/st_${st.kind}.png`); } catch { continue; }
      const s = new Sprite(t);
      // (x,y) = centro da célula do canto superior esquerdo da pegada; a imagem tem FullHeight linhas com a pegada embaixo
      s.position.set((st.x - 0.5) * TILE, (st.y - 0.5 + def.th) * TILE - def.h - this.relief.heightAt(st.x + (def.tw - 1) / 2, st.y + (def.th - 1) / 2));
      const bridge = /bridge/i.test(def.name);
      s.zIndex = bridge ? -100000 : (st.y - 0.5 + def.th) * TILE - 2;
      if (bridge) this.ground.addChild(s); else this.sorted.addChild(s);
    }
  }

  /** Chave da folha de uma unidade: tipo + nível quando há paleta própria do nível (monsters/<x>/paletteN.pal). */
  private sheetKey(kind: string, level?: number): string {
    const m = this.data.anim[kind];
    const lv = level && level > 1 ? String(Math.min(9, level)) : "";
    return lv && m?.palettes?.[lv] ? `${kind}#${lv}` : kind;
  }

  private async loadUnitSheets(): Promise<void> {
    const d = this.data;
    const kinds = [...new Set(this.world.units.map(u => u.kind))];
    // sprites de morte emprestados: humanos/heróis sem bloco "morrer" usam o do tipo `Dying` de units.reg (4 = espadachim com escudo;
    // magos: 24 = Human Mage)
    for (const k of [...kinds]) {
      const fb = this.dyingFallbackKey(k);
      if (fb && !kinds.includes(fb)) kinds.push(fb);
    }
    // variantes de paleta: uma folha por (tipo, nível) presente no mapa
    const keys = new Map<string, { kind: string; level: string }>();
    for (const k of kinds) keys.set(k, { kind: k, level: "" });
    for (const u of this.world.units) {
      const key = this.sheetKey(u.kind, u.stats.level);
      if (!keys.has(key)) keys.set(key, { kind: u.kind, level: key.split("#")[1] ?? "" });
    }
    await Promise.all([...keys].map(async ([key, { kind, level }]) => {
      const m = d.anim[kind];
      if (!m) return;
      const pal = level ? m.palettes?.[level] : undefined;
      try { this.sheets.set(key, new UnitSheet(m, await loadPaletted(ANIM_BASE + m.image, pal, level))); } catch { /* sem atlas */ }
      if (this.smoothing && m.imageB) {
        try { this.sheetsB.set(key, new UnitSheet(m, await loadPaletted(ANIM_BASE + m.imageB, pal, level))); } catch { /* sem camada B */ }
      }
    }));
    // reserva: tira parada antiga (assets/units/unit_<ID>.png)
    await Promise.all(kinds.filter(k => !this.sheets.has(k) && d.unitsStatic[k]).map(async k => {
      const st = d.unitsStatic[k]!;
      try {
        const base = await this.game.data.texture(`assets/units/unit_${k}.png`);
        const meta: AnimMeta = { name: st.name, image: "", cellW: st.w, cellH: st.h, cols: 8, count: 8, flip: false, staticDirs: 8, dirs: 8, blocks: {} };
        this.sheets.set(k, new UnitSheet(meta, base));
      } catch { /* nada */ }
    }));
  }

  /** Tipo cujo sprite tem a animação de morte usada por `kind` quando o próprio sprite não tem (campo `Dying` de units.reg). */
  private dyingFallbackKey(kind: string): string | undefined {
    const m = this.data.anim[kind];
    if (!m || m.blocks.dying) return undefined;
    const want = /mage/.test(kind) ? "24" : String(m.Dying ?? "4");
    return this.data.anim[want]?.blocks.dying ? want : this.data.anim["4"]?.blocks.dying ? "4" : undefined;
  }

  private viewFor(u: Unit): UnitView {
    let v = this.views.get(u.id);
    if (v) return v;
    const key = this.sheetKey(u.kind, u.stats.level);
    const sheet = this.sheets.get(key) ?? this.sheets.get(u.kind);
    const sheetB = this.sheetsB.get(key) ?? this.sheetsB.get(u.kind);
    const meta = sheet?.meta;
    const root = new Container();
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    let b: Sprite | undefined;
    if (sheetB) { b = new Sprite(Texture.EMPTY); b.anchor.set(0.5); b.alpha = 0.5; sprite.addChild(b); }
    const bar = new Container();
    const barG = new Graphics();
    const balls = [0, 1, 2, 3].map(() => new Sprite(this.ballTex));
    bar.addChild(barG, ...balls);
    root.addChild(sprite);
    // as barras ficam numa camada acima de todas as unidades (o jogo as desenha depois dos sprites)
    this.bars.addChild(bar);
    const offY = meta?.CenterY && meta?.Height ? meta.CenterY - meta.Height / 2 : 0;
    const lift = u.flying ? Math.round((meta?.Z ?? 64) / 3) : 0;
    // sombra: a silhueta inclinada a partir do pé (voadores: projetada no chão sob a unidade)
    const shadow = makeShadow(Texture.EMPTY, 0.5, meta ? 0.5 + offY / meta.cellH : 0.5);
    shadow.visible = false;
    this.shadows.addChild(shadow);
    v = { root, shadow, sprite, b, sheetB, bar, barG, balls, sheet, meta, offY, lift };
    this.views.set(u.id, v);
    this.sorted.addChild(root);
    return v;
  }

  /** Atualiza a apresentação. `view` = retângulo visível em px do mundo; `now` = relógio em ms. */
  update(view: { x: number; y: number; w: number; h: number }, now: number): void {
    const t0 = performance.now();
    // recorte do terreno por bloco
    const x0 = Math.max(0, Math.floor(view.x / (CHUNK * TILE))), x1 = Math.min(this.chunkCols - 1, Math.floor((view.x + view.w) / (CHUNK * TILE)));
    const y0 = Math.max(0, Math.floor(view.y / (CHUNK * TILE))), y1 = Math.floor((view.y + view.h) / (CHUNK * TILE));
    const vis = new Set<number>();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = cy * this.chunkCols + cx; if (this.chunks[i]) vis.add(i); }
    for (const i of this.visibleChunks) if (!vis.has(i)) this.chunks[i]!.visible = false;
    // água: 4 quadros, um a cada 5 unidades de tempo (UnityAllods MapView: LevelTime % 20 / 5)
    const step = Math.floor(now / (5 * ANIM_UNIT_MS)) & 3;
    for (const i of vis) {
      const fresh = !this.visibleChunks.has(i);
      if (fresh) this.chunks[i]!.visible = true;
      if (fresh || step !== this.waterStep) {
        for (const wt of this.water[i] ?? []) {
          const t = this.tileTex[(32 + 4 * ((wt.g + step) & 3) + wt.w) * 16 + wt.r];
          if (t) wt.s.texture = t;
        }
      }
    }
    this.waterStep = step;
    this.visibleChunks = vis;
    if (this.terrainMesh) { this.updateTerrainLight(false); this.terrainMesh.update(view, step); }
    const t1 = performance.now();
    this.worldAnim?.update(view, now);
    const t2 = performance.now();
    const margin = 160;
    for (const u of this.world.units) {
      const v = this.viewFor(u);
      const px = u.x * TILE, py = u.y * TILE;
      const onScreen = px > view.x - margin && px < view.x + view.w + margin && py > view.y - margin && py < view.y + view.h + margin * 1.5;
      v.root.visible = !u.phased && onScreen && this.isVisible(u) && !(u.state === "dead" && !v.sheet?.meta.blocks.bones && !v.sheet?.meta.blocks.dying && !this.dyingFallbackKey(u.kind));
      // barra de vida/mana só na unidade PRÓPRIA selecionada (capturas do original m10: nenhum inimigo, nem selecionado, nem o herói sem seleção,
      // mostra barra; o exe 0x465... desenha as dos demais em modo "apagado" que não aparece)
      v.bar.visible = v.root.visible && u.alive && u.state !== "dying" && u.id === this.selectedId && !this.world.hostile(u.player, 1);
      // sombra só de unidade não morta (o UnityAllods a esconde nos mortos)
      v.shadow.visible = v.root.visible && u.state !== "dead";
      if (!v.root.visible) continue;
      // relevo: o sprite sobe a altura do chão no ponto da unidade; a ordem continua pela linha no chão
      const gy = py - this.unitLift(u);
      v.root.position.set(px, gy);
      v.root.zIndex = u.state === "dead" ? py - 10000 : py + (u.flying ? 64 : 0);
      this.updateSprite(u, v, now);
      // unidade sob o cursor fica mais clara (UnityAllods: luminosidade 0,5 → 0,75); o original não tem anel de seleção
      v.sprite.filters = u.alive && u.id === this.hoverId ? [this.hoverFilter] : null;
      if (u.buffs.length) this.effects.unitLook(u, v.sprite);
      if (v.shadow.visible) {
        v.shadow.texture = v.sprite.texture;
        v.shadow.scale.x = v.sprite.scale.x;
        v.shadow.position.set(px, gy);
        v.shadow.alpha = SHADOW_ALPHA * Math.min(1, v.sprite.alpha);
      }
      if (v.bar.visible) this.drawBars(u, v);
    }
    const t3 = performance.now();
    this.effects.listener = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    this.effects.update(now);
    this.updateLight(view);
    // o filtro de brilho só precisa da área visível (coordenadas locais do mundo); sem isso o Pixi renderiza os blocos inteiros
    const fa = this.lit.filterArea ?? new Rectangle();
    fa.x = Math.floor(view.x) - 2; fa.y = Math.floor(view.y) - 2; fa.width = Math.ceil(view.w) + 4; fa.height = Math.ceil(view.h) + 4;
    this.lit.filterArea = fa;
    this.updateLoot();
    // números flutuantes
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      const age = performance.now() - f.born;
      f.t.y = Math.round(f.y0 - age * DAMAGE_RISE_PX_S / 1000);
      if (age >= DAMAGE_LIFE_MS) { f.t.destroy(); this.floaters.splice(i, 1); }
    }
    const t4 = performance.now();
    const a = 0.1;
    this.perf.update += (t4 - t0 - this.perf.update) * a;
    this.perf.world += (t2 - t1 - this.perf.world) * a;
    this.perf.units += (t3 - t2 - this.perf.units) * a;
    this.perf.fx += (t4 - t3 - this.perf.fx) * a;
  }

  /** Luz do terreno pela hora do dia (exe: refeita a cada 20 minutos do jogo com os parâmetros de 0x474d98). */
  private updateTerrainLight(force: boolean): void {
    if (this.relief.flat) return;
    const info = (this.data.map as unknown as { info?: { startTime?: number } }).info;
    const dayNight = this.game.state.settings.dayNight !== false && typeof info?.startTime === "number";
    const min = dayNight ? gameMinutes(info!.startTime!, this.world.tick * 0.05) : 0;
    const slot = dayNight ? Math.floor(min / 20) : -2;
    if (!force && slot === this.lightSlot) return;
    this.lightSlot = slot;
    this.relief.computeLight(lightParamsAt(slot * 20, dayNight));
    this.terrainMesh?.refreshLight();
  }

  /** Altura (px) da unidade no seu ponto (bilinear do exe). */
  unitLift(u: Unit): number { return this.relief.heightAt(u.x, u.y); }

  /** Luz ambiente (dia/noite) sobre o mapa; desligada pela opção "Day/Night changes". */
  private updateLight(view: { x: number; y: number; w: number; h: number }): void {
    const info = (this.data.map as unknown as { info?: { startTime?: number } }).info;
    const on = this.game.state.settings.dayNight !== false && typeof info?.startTime === "number";
    const d = on ? daylight(gameMinutes(info!.startTime!, this.world.tick * 0.05)) : 1;
    this.light.visible = d < 0.999;
    if (!this.light.visible) return;
    this.light.tint = lightColor(d);
    this.light.position.set(view.x - 64, view.y - 64);
    this.light.width = view.w + 128;
    this.light.height = view.h + 192;
  }

  /** Barras de vida/mana no estilo do allods2.exe (ver BAR_LEVELS acima). Coordenadas: retângulo de seleção do units.reg
   *  relativo ao canto do sprite (CenterX/CenterY = ponto da unidade). */
  /** Retângulo da barra de vida (px do mundo): x1..x2 = seleção do units.reg, y = SelectionY1 (allods2.exe 0x4653a5). */
  private barGeometry(u: Unit, v: UnitView | undefined): { x1: number; x2: number; y: number } {
    const m = v?.meta as (AnimMeta & { SelectionX1?: number; SelectionX2?: number; SelectionY1?: number }) | undefined;
    const px = u.x * TILE, py = u.y * TILE - this.unitLift(u);
    const cx = m?.CenterX ?? (m?.Width ?? 64) / 2, cy = m?.CenterY ?? (m?.Height ?? 64) / 2;
    return {
      x1: Math.round(px + (m?.SelectionX1 ?? cx - 16) - cx), x2: Math.round(px + (m?.SelectionX2 ?? cx + 16) - cx),
      y: Math.round(py + (m?.SelectionY1 ?? cy - 30) - cy - (v?.lift ?? 0)),
    };
  }

  private drawBars(u: Unit, v: UnitView): void {
    const { x1, x2, y: y0 } = this.barGeometry(u, v);
    let y = y0;
    const g = v.barG;
    g.clear();
    const dim = false;
    const inner = Math.max(0, x2 - x1 - 8);
    const row = (kind: BarKind, value: number, max: number, minOne: boolean, yy: number, ball: number) => {
      const fill = barFill(value, max, inner, minOne);
      const b0 = v.balls[ball]!, b1 = v.balls[ball + 1]!;
      b0.visible = b1.visible = true;
      b0.position.set(x1, yy - 2); b1.position.set(x2 - 4, yy - 2);
      b0.alpha = b1.alpha = 1;
      drawBar(g, x1 + 4, yy - 2, inner, fill, kind, dim);
    };
    const hp = Math.ceil(u.hp);
    row(hpKind(hp, u.maxHp), hp, u.maxHp, false, y, 0);
    const mana = u.maxMana > 0;
    v.balls[2]!.visible = v.balls[3]!.visible = false;
    if (mana) { y += 4; row("blue", Math.floor(u.mana), u.maxMana, true, y, 2); }
  }

  private updateSprite(u: Unit, v: UnitView, now: number): void {
    const sh = v.sheet;
    v.sprite.position.set(0, -v.offY - v.lift);
    v.sprite.alpha = 1;
    if (!sh) { v.sprite.texture = Texture.WHITE; v.sprite.width = 16; v.sprite.height = 24; v.sprite.tint = PLAYER_COLORS[u.player % PLAYER_COLORS.length]!; return; }
    const m = sh.meta;
    let fr: UnitFrame | null = null;
    let fromKey = this.sheetKey(u.kind, u.stats.level);
    switch (u.state) {
      // passo: MoveAnimTime em 1/16 s sobre o tempo andado (acompanha a velocidade do jogo); MoveBegin não é animado
      case "move": fr = sh.block("move", u.dir, phaseAt(moveSeq(m), Math.floor(simTicksToAnim(u.walkTime)), true)); break;
      case "attack": case "cast": {
        // a animação de ataque é esticada para o ciclo de ataque da unidade (charge+relax)
        const seq = attackSeq(m), total = seq.reduce((a, e) => a + e.t, 0) || 1;
        fr = sh.block("attack", u.dir, phaseAt(seq, Math.floor(u.stateTime / Math.max(1, u.timing.attackTicks) * total), false));
        break;
      }
      case "dying": {
        const fk = m.blocks.dying ? undefined : this.dyingFallbackKey(u.kind);
        const ds = fk ? this.sheets.get(fk) : sh;
        const dm = ds?.meta;
        if (ds && dm?.blocks.dying) {
          const seq = dyingSeq(dm), total = seq.reduce((a, e) => a + e.t, 0) || 1;
          fr = ds.block("dying", u.dir, phaseAt(seq, Math.floor(u.stateTime / Math.max(1, u.timing.dyingTicks) * total), false));
          if (fk) fromKey = fk;
        }
        if (!fr) { fr = sh.still(u.dir); v.sprite.alpha = Math.max(0, 1 - u.stateTime / u.timing.dyingTicks); }
        break;
      }
      case "dead": {
        const fk = m.blocks.dying ? undefined : this.dyingFallbackKey(u.kind);
        const ds = fk ? this.sheets.get(fk) : sh;
        const dm = ds?.meta;
        const b = dm?.blocks.bones;
        if (fk) fromKey = fk;
        // ossos: corpo → esqueleto → ossos, uma fase a cada BONE_PHASE_TICKS (aproximação)
        if (ds && b) fr = ds.block("bones", u.dir, Math.min(b.phases - 1, Math.floor(u.stateTime / BONE_PHASE_TICKS)));
        else if (ds && dm?.blocks.dying) fr = ds.block("dying", u.dir, dm.blocks.dying.phases - 1);
        else { fr = sh.still(u.dir); v.sprite.alpha = 0; }
        break;
      }
      default:
        // ocioso: só os 5 tipos com IdlePhases (fantasma, morcego, dragão, abelha, súcubo); os demais ficam parados como no
        // original (heróis/humanos não têm quadros de ocioso — conferido nas capturas refs/original/mission10_idle_*)
        fr = m.blocks.idle ? sh.block("idle", u.dir, phaseAt(idleSeq(m), Math.floor((now + u.id * 337) / ANIM_UNIT_MS), true)) : null;
    }
    if (!fr) fr = sh.still(u.dir);
    v.sprite.texture = fr.tex;
    v.sprite.scale.set(fr.flipX ? -1 : 1, 1);
    if (v.b) {
      const bs = this.sheetsB.get(fromKey);
      v.b.visible = !!bs;
      if (bs) v.b.texture = bs.frame(fr.i);
    }
  }

  private updateLoot(): void {
    const alive = new Set<number>();
    for (const l of this.world.loot) {
      alive.add(l.id);
      if (this.lootGfx.has(l.id)) continue;
      const c = new Container();
      const g = new Graphics()
        .ellipse(0, 6, 9, 4).fill({ color: 0x000000, alpha: 0.35 })
        .roundRect(-7, -6, 14, 12, 4).fill(0x8a5a2a).stroke({ color: 0x3a2410, width: 1 })
        .rect(-3, -9, 6, 4).fill(0x6a4018)
        .circle(3, -2, 2).fill(0xffd84a);
      c.addChild(g);
      c.position.set((l.x + 0.5) * TILE, (l.y + 0.5) * TILE - this.relief.heightAt(l.x + 0.5, l.y + 0.5));
      this.ground.addChild(c);
      this.lootGfx.set(l.id, c);
    }
    for (const [id, c] of this.lootGfx) if (!alive.has(id)) { c.destroy({ children: true }); this.lootGfx.delete(id); }
  }

  floatText(u: Unit, text: string, _color?: number): void {
    if (this.game.state.settings.damagePoints === false) return;
    const v = this.views.get(u.id);
    const g = this.barGeometry(u, v);
    const t = makeText(text, { font: "font3", color: DAMAGE_COLOR });
    // vários números do mesmo alvo no mesmo instante não se sobrepõem: desloca 8 px para baixo cada um
    const stack = this.floaters.filter(f => f.t.x === g.x2 + 2 && performance.now() - f.born < 150).length;
    t.position.set(g.x2 + 2, g.y + 10 + stack * 8);
    this.fx.addChild(t);
    this.floaters.push({ t, y0: t.y, born: performance.now() });
  }

  /** Unidade sob o ponto (px do mundo), usando a caixa do sprite. */
  pick(wx: number, wy: number, filter?: (u: Unit) => boolean): Unit | undefined {
    let best: Unit | undefined, bd = Infinity;
    for (const u of this.world.units) {
      if (!u.active || !this.isVisible(u)) continue;
      if (filter && !filter(u)) continue;
      const v = this.views.get(u.id);
      const cy = u.y * TILE - this.unitLift(u) - (v ? v.offY + v.lift : 0);
      const hw = Math.max(12, Math.min(28, (v?.sheet?.meta.cellW ?? 32) * 0.35));
      const hh = Math.max(16, Math.min(40, (v?.sheet?.meta.cellH ?? 40) * 0.45));
      const dx = wx - u.x * TILE, dy = wy - cy;
      if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) {
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = u; }
      }
    }
    return best;
  }
}

/** Cor média de cada tile (id = arquivo*16 + linha), lida das texturas carregadas. */
function computeTileColors(files: Texture[]): number[] {
  const out: number[] = [];
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  files.forEach((t, f) => {
    const res = (t.source as unknown as { resource?: CanvasImageSource }).resource;
    if (!ctx || !res || !t.width) return;
    cv.width = t.width; cv.height = t.height;
    try {
      ctx.drawImage(res, 0, 0);
      for (let r = 0; r < Math.floor(t.height / TILE); r++) {
        const px = ctx.getImageData(0, r * TILE, TILE, TILE).data;
        let R = 0, G = 0, B = 0;
        for (let i = 0; i < px.length; i += 16) { R += px[i]!; G += px[i + 1]!; B += px[i + 2]!; }
        const n = px.length / 16;
        out[f * 16 + r] = ((R / n) << 16) | ((G / n) << 8) | (B / n);
      }
    } catch { /* imagem não legível */ }
  });
  return out;
}
