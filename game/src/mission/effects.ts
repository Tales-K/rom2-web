/**
 * Projéteis, impactos e efeitos de magia com os sprites originais (graphics/projectiles; frente MOTOR-B).
 * Ligações decifradas pelos próprios dados (ver docs/GAPS.md):
 *   - magia N (spells.json, 1..29) → projétil/efeito `8 + 2N` (ou `9 + 2N`) de projectiles.reg e som `508 + 2N` de sfx.reg
 *     (Fire Arrow 1 → 10 firebolt / 510 magic\arrow; Fireball 2 → 12 + explosão 13 / 512, 513; Ice Missile 5 → 18 / 518;
 *     Lightning 10 → 28 / 528; Stone Missile 16 → 40 meteorit / 540 "dust"; Heal 24 → 56 / 556; Shield 27 → 62 / 562 ...);
 *   - flechas: campo `Projectile` do units.reg do atirador (1 arco, 2 besta, 3 orc, 4 goblin);
 *   - layout: `dirs × phases` quadros; dirs 16 = 16 sentidos (0 = S, 4 = O, 8 = N, 12 = L), 9 = metade com espelho, 1 = sem rotação.
 * Tempo: 1 fase por 1/16 s. Os eventos da simulação (blast/area/teleport/effect) chegam por `onSimEvent`.
 */
import { Assets, ColorMatrixFilter, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Game } from "../core/game";
import { listenerPlace } from "../core/sounds";
import type { SimEvent } from "../sim/types";
import type { Projectile, Unit, World } from "../sim/world";
import { ANIM_UNIT_MS, dir16, type AnimTable } from "./animTiming";
import { auraVisible, projectileSpriteId, spellSpriteId } from "./fxrules";
import { GridAtlas, WORLD_BASE, loadWorldJson, type PrDef, type WorldJson } from "./worldanim";

const TILE = 32;
/** aura do Shield: puffs, ciclo de cada puff (5 quadros, ms) e semieixos da elipse (px) */
const AURA_PUFFS = 70, AURA_CYCLE_MS = 800, AURA_RX = 14, AURA_RY = 28;
/** altura de voo dos projéteis (px acima do chão) */
const FLY_H = 20;

/** Som de lançamento da magia `id` (1..29): sfx.reg 508 + 2×id (Wall of Fire 3 usa 90 magic\firewall; Blizzard 7 → 523). */
export function spellSfx(id: number | string): number {
  const n = Number(id);
  if (n === 3) return 90;
  if (n === 7) return 523;
  return 508 + 2 * n;
}

/** Projétil/efeito do projectiles.reg usado pela magia `id` (sem sprite → undefined). Regra em mission/fxrules.ts. */
export function spellProjectile(id: number | string, wj?: WorldJson): string | undefined {
  return spellSpriteId(id, k => !wj || !!wj.projectiles[k]);
}

/** Efeito de impacto/explosão por magia. */
const IMPACT: Record<number, string> = { 2: "13", 9: "27", 11: "30", 23: "54" };

interface FlyFx { sprite: Sprite; def: PrDef; atlas: GridAtlas; born: number; lastX: number; lastY: number; spell?: string; g?: Graphics; }
interface OneShot { sprite: Sprite; atlas: GridAtlas; def: PrDef; born: number; frameMs: number; loops: number; }
/** Aura persistente de uma magia sobre a unidade (Shield): nuvem de puffs do projétil 62 numa elipse em volta do corpo. */
interface AuraFx { puffs: { s: Sprite; ang: number; r: number; off: number }[]; atlas: GridAtlas; def: PrDef; }
interface AreaFx { sprites: { s: Sprite; off: number; cx: number; cy: number }[]; atlas: GridAtlas; def: PrDef; }

export class Effects {
  readonly layer = new Container();
  private wj?: WorldJson;
  private atlases = new Map<string, GridAtlas | null>();
  private loading = new Set<string>();
  private flying = new Map<number, FlyFx>();
  private shots: OneShot[] = [];
  private areas = new Map<number, AreaFx>();
  private auras = new Map<number, AuraFx>();
  private stone = (() => { const f = new ColorMatrixFilter(); f.desaturate(); return f; })();
  /** posição da câmera (centro, px do mundo) para o volume dos sons */
  listener = { x: 0, y: 0 };
  /** altura do chão (px) no ponto em células — relevo (mission/relief.ts); 0 = plano */
  heightAt: (x: number, y: number) => number = () => 0;
  /** unidade visível para o jogador (névoa de guerra; MapView.isVisible): auras só de quem se vê */
  isVisible: (u: Unit) => boolean = () => true;
  /** célula (coordenadas em células) visível para o jogador: projéteis, impactos e áreas na névoa não se desenham */
  isCellVisible: (x: number, y: number) => boolean = () => true;

  constructor(private readonly game: Game, private readonly world: World, private readonly anim: AnimTable) {}

  async load(): Promise<void> {
    this.wj = await loadWorldJson(this.game);
    if (!this.wj) return;
    // pré-carrega os que quase toda missão usa (flechas e as magias do herói)
    await Promise.all(["1", "2", "3", "4", "10", "12", "13", "18", "28", "40", "54", "56", "62", "smallxpl"].map(id => this.ensure(id)));
  }

  private ensure(id: string): GridAtlas | undefined {
    const c = this.atlases.get(id);
    if (c !== undefined) return c ?? undefined;
    const def = this.wj?.projectiles[id];
    if (!def) { this.atlases.set(id, null); return undefined; }
    if (!this.loading.has(id)) {
      this.loading.add(id);
      void Assets.load<Texture>(WORLD_BASE + def.image).then(t => {
        this.atlases.set(id, new GridAtlas(t, def.cw, def.ch, def.cols, def.count));
      }).catch(() => this.atlases.set(id, null));
    }
    return undefined;
  }

  private frameOf(def: PrDef, d16: number, phase: number): { i: number; flip: boolean } {
    const ph = ((phase % def.phases) + def.phases) % def.phases;
    if (def.dirs >= 16) return { i: (d16 % 16) * def.phases + ph, flip: false };
    if (def.dirs === 9) {
      const d = d16 <= 8 ? d16 : 16 - d16;
      return { i: d * def.phases + ph, flip: d16 > 8 };
    }
    if (def.dirs === 8) return { i: (Math.round(d16 / 2) % 8) * def.phases + ph, flip: false };
    return { i: ph, flip: false };
  }

  /** Sprite do projétil (regra pura em mission/fxrules.ts: magia, arma lançadora, golpe "fire", flecha do units.reg). */
  private projId(p: Projectile): string | undefined {
    const from = this.world.get(p.from);
    const pr = (kind: string): number | undefined => { const v = this.anim[kind]?.Projectile; return v === undefined || v === null ? undefined : Number(v); };
    return projectileSpriteId(p, from, pr, k => !this.wj || !!this.wj.projectiles[k]);
  }

  /** Som do efeito no ponto (células): sfx 500 + id do efeito (0x40d9b2 casos 0x86/0x8b/0x8c), posicional (0x41b1f8) com prioridade (10000−|vol|)/100. */
  private play(id: number, x: number, y: number, vol = 1): void {
    const p = listenerPlace(x, y, { x: this.listener.x - 424, y: this.listener.y - 384 });   // listener = centro da vista de 848×768 px
    if (p.vol * vol <= 0.01) return;
    try { this.game.audio.playSfx(id, p.vol * vol, { pan: p.pan, prio: p.prio, tag: "effect" }); } catch { /* sem áudio */ }
  }

  /** Efeito de uma vez no ponto (células). */
  spawn(id: string, x: number, y: number, opts: { lift?: number; frameMs?: number; loops?: number } = {}): void {
    const def = this.wj?.projectiles[id];
    const atlas = this.ensure(id);
    if (!def || !atlas) return;
    const s = new Sprite(atlas.frame(0));
    s.anchor.set(0.5);
    s.position.set(x * TILE, y * TILE - (opts.lift ?? 0) - this.heightAt(x, y));
    s.visible = this.isCellVisible(x, y);
    this.layer.addChild(s);
    this.shots.push({ sprite: s, atlas, def, born: performance.now(), frameMs: opts.frameMs ?? ANIM_UNIT_MS, loops: opts.loops ?? 1 });
  }

  /** Eventos da simulação (chamado pelo MapView). */
  onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case "blast": {
        const imp = IMPACT[Number(e.spell)];
        if (imp) this.spawn(imp, e.x, e.y, { lift: Number(e.spell) === 2 ? 0 : 8 });
        if (Number(e.spell) === 2) this.play(513, e.x, e.y);
        break;
      }
      case "teleport":
        this.spawn("54", e.fromX + 0.5, e.fromY + 0.5);
        this.spawn("54", e.x + 0.5, e.y + 0.5);
        break;
      default:
    }
  }

  /** Aparência das unidades sob efeitos (Stone Curse = cinza; Invisibility = meio transparente). */
  unitLook(u: Unit, sprite: Sprite): void {
    let stone = false, invis = false;
    for (const b of u.buffs) { if (b.kind === "stone") stone = true; else if (b.kind === "invisible") invis = true; }
    if (stone) sprite.filters = [this.stone];
    if (invis) sprite.alpha *= 0.5;
  }

  update(now: number): void {
    if (!this.wj) return;
    // projéteis em voo
    const alive = new Set<number>();
    for (const p of this.world.projectiles) {
      if (p.done) continue;
      alive.add(p.id);
      let f = this.flying.get(p.id);
      if (!f) {
        const id = this.projId(p);
        const def = id ? this.wj.projectiles[id] : undefined;
        const atlas = id ? this.ensure(id) : undefined;
        if (def && !atlas) continue; // atlas ainda carregando: aparece no próximo quadro
        if (def && atlas) {
          const s = new Sprite(atlas.frame(0));
          s.anchor.set(0.5);
          f = { sprite: s, def, atlas, born: now, lastX: p.x, lastY: p.y, spell: p.spell?.id };
        } else {
          // sem sprite no jogo (onda sônica do morcego, tipos desconhecidos): desenho simples
          const g = new Graphics();
          if (p.kind === "sonic") g.circle(0, 0, 5).stroke({ color: 0x9fe0ff, width: 2, alpha: 0.8 });
          else g.circle(0, 0, 3).fill({ color: 0xffe080 });
          f = { sprite: g as unknown as Sprite, def: undefined as unknown as PrDef, atlas: undefined as unknown as GridAtlas, born: now, lastX: p.x, lastY: p.y, g };
        }
        this.layer.addChild(f.g ?? f.sprite);
        this.flying.set(p.id, f);
        // flecha/virote: o som do disparo já sai no "attack" da unidade; magias: no "cast" da cena (MissionAudio)
      }
      (f.g ?? f.sprite).visible = this.isCellVisible(p.x, p.y);   // projétil dentro da névoa: não se desenha sobre ela
      if (f.g) {
        f.g.position.set(p.x * TILE, p.y * TILE - FLY_H - this.heightAt(p.x, p.y));
        f.lastX = p.x; f.lastY = p.y;
        continue;
      }
      const t = p.to ? this.world.get(p.to) : undefined;
      const tx = t ? t.x : p.tx ?? p.x, ty = t ? t.y : p.ty ?? p.y;
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy) > 0.01 ? dir16(dx, dy) : dir16(p.x - f.lastX, p.y - f.lastY);
      const fr = this.frameOf(f.def, d, Math.floor((now - f.born) / ANIM_UNIT_MS));
      f.sprite.texture = f.atlas.frame(fr.i);
      f.sprite.scale.x = fr.flip ? -1 : 1;
      f.sprite.position.set(p.x * TILE, p.y * TILE - FLY_H - this.heightAt(p.x, p.y));
      f.lastX = p.x; f.lastY = p.y;
    }
    for (const [id, f] of this.flying) {
      if (alive.has(id)) continue;
      (f.g ?? f.sprite).destroy();
      this.flying.delete(id);
    }
    // efeitos de uma vez
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      const k = Math.floor((now - s.born) / s.frameMs);
      if (k >= s.def.count * s.loops) { s.sprite.destroy(); this.shots.splice(i, 1); continue; }
      s.sprite.texture = s.atlas.frame(k % (s.def.phases * Math.max(1, s.def.dirs)));
    }
    this.updateAreas(now);
    this.updateAuras(now);
  }

  /** Áreas persistentes (Wall of Fire, Poison Cloud, Blizzard, Wall of Earth): sprite animado por célula coberta. */
  private updateAreas(now: number): void {
    const live = new Set<number>();
    const w = this.world.grid.w;
    for (const a of this.world.areas) {
      live.add(a.id);
      if (this.areas.has(a.id)) continue;
      const id = spellProjectile(a.spell, this.wj);
      const def = id ? this.wj?.projectiles[id] : undefined;
      const atlas = id ? this.ensure(id) : undefined;
      if (!def || !atlas) continue;
      const cells: [number, number][] = [];
      if (a.cells?.length) for (const c of a.cells) cells.push([c % w, Math.floor(c / w)]);
      else {
        const r = Math.max(0, Math.round(a.radius));
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          cells.push([Math.floor(a.x) + dx, Math.floor(a.y) + dy]);
        }
      }
      const fx: AreaFx = { sprites: [], atlas, def };
      // sprites grandes (128 px) cobrem mais de uma célula: um a cada 2 células
      const step = def.cw >= 96 && !a.cells?.length ? 2 : 1;
      for (const [cx, cy] of cells) {
        if (step > 1 && ((cx + cy) & 1)) continue;
        const s = new Sprite(atlas.frame(0));
        s.anchor.set(0.5, def.ch > TILE * 1.5 ? 0.75 : 0.5);
        s.position.set((cx + 0.5) * TILE, (cy + 0.5) * TILE - this.heightAt(cx + 0.5, cy + 0.5));
        this.layer.addChild(s);
        fx.sprites.push({ s, off: (cx * 7 + cy * 13) % 16, cx, cy });
      }
      this.areas.set(a.id, fx);
      this.play(spellSfx(a.spell), a.x, a.y, 0.8);
    }
    for (const [id, fx] of this.areas) {
      if (!live.has(id)) { for (const { s } of fx.sprites) s.destroy(); this.areas.delete(id); continue; }
      const k = Math.floor(now / ANIM_UNIT_MS);
      for (const { s, off, cx, cy } of fx.sprites) {
        s.visible = this.isCellVisible(cx + 0.5, cy + 0.5);
        s.texture = fx.atlas.frame((k + off) % (fx.def.phases * Math.max(1, fx.def.dirs)));
      }
    }
  }

  /**
   * Shield (magia 27): enquanto dura o buff, uma nuvem translúcida de puffs (pr_62.webp, 5 quadros crescentes) em elipse de ~35×63 px ao redor
   * do corpo, centrada ~22 px acima dos pés (m10m_shield_cast / m10_mage do original). Cada puff percorre os 5 quadros e reaparece em outro
   * ponto da elipse [est: o ritmo exato do emissor não foi medido].
   */
  private updateAuras(now: number): void {
    const live = new Set<number>();
    for (const u of this.world.units) {
      if (!auraVisible(u, this.isVisible)) continue;   // mission/fxrules.ts: viva, ativa, com Shield e VISÍVEL (nada sobre a névoa)
      live.add(u.id);
      let fx = this.auras.get(u.id);
      if (!fx) {
        const def = this.wj?.projectiles["62"];
        const atlas = this.ensure("62");
        if (!def || !atlas) continue;
        fx = { puffs: [], atlas, def };
        for (let i = 0; i < AURA_PUFFS; i++) {
          const s = new Sprite(atlas.frame(0));
          s.anchor.set(0.5);
          s.alpha = 0.75;
          this.layer.addChild(s);
          fx.puffs.push({ s, ang: Math.random() * Math.PI * 2, r: 0.5 + 0.6 * Math.sqrt(Math.random()), off: Math.random() * AURA_CYCLE_MS });
        }
        this.auras.set(u.id, fx);
      }
      for (const p of fx.puffs) {
        const t = (now + p.off) % AURA_CYCLE_MS;
        const k = Math.min(fx.def.count - 1, Math.floor(t / (AURA_CYCLE_MS / fx.def.count)));
        const cycle = Math.floor((now + p.off) / AURA_CYCLE_MS);
        if (cycle !== (p as { cyc?: number }).cyc) { (p as { cyc?: number }).cyc = cycle; p.ang = Math.random() * Math.PI * 2; p.r = 0.5 + 0.6 * Math.sqrt(Math.random()); }
        p.s.texture = fx.atlas.frame(k);
        p.s.scale.set(1.1);
        p.s.position.set(u.x * TILE + Math.cos(p.ang) * AURA_RX * p.r, u.y * TILE - 22 - this.heightAt(u.x, u.y) + Math.sin(p.ang) * AURA_RY * p.r);
      }
    }
    for (const [id, fx] of this.auras) {
      if (live.has(id)) continue;
      for (const p of fx.puffs) p.s.destroy();
      this.auras.delete(id);
    }
  }
}
