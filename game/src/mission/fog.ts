/**
 * Névoa de guerra: células nunca vistas ficam pretas, células já exploradas mas fora da visão ficam escurecidas.
 * Visão de cada unidade do jogador 1 (e de quem compartilha visão com ele): com o relevo, a do exe (mission/sight.ts: alcance que
 * se gasta por passo e por subida, frente RELEVO); sem relevo (testes), o raio antigo `sight + 1,4`. Uma textura de 1 px por
 * célula, esticada ×32 com filtro linear (borda suave, degradê de ~32 px, como no original) — na malha do relevo quando há altitude.
 * `explored` também alimenta o minimapa (só o explorado aparece no cristal).
 */
import { type Container, MeshSimple, Sprite, Texture } from "pixi.js";
import type { World } from "../sim/world";
import type { Relief } from "./relief";
import { markVisible } from "./sight";

export class Fog {
  private readonly relief?: Relief;
  readonly explored: Uint8Array;
  readonly visible: Uint8Array;
  /** o que vai para a cena: sprite esticado ×32 (mapa plano) ou malha com o relevo (cada vértice sobe a altitude, como o terreno) */
  readonly sprite: Container;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly tex: Texture;
  enabled = true;

  constructor(readonly w: number, readonly h: number, relief?: Relief) {
    this.relief = relief;
    this.explored = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
    this.canvas = document.createElement("canvas");
    // com relevo: 1 texel por VÉRTICE ((w+1)×(h+1)), o vértice fica claro se alguma das 4 células em volta é vista e o escuro
    // é interpolado dentro da célula (borda meia célula mais para fora que a amostragem por célula; capturas m10/m20 do original)
    const tw = relief ? w + 1 : w, th = relief ? h + 1 : h;
    this.canvas.width = tw; this.canvas.height = th;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(tw, th);
    this.tex = Texture.from(this.canvas);
    // o original tem borda suave (degradê de ~1 célula, docs/REQUESTS.md MOTOR-B): textura de 1 px por célula esticada com filtro linear
    this.tex.source.scaleMode = "linear";
    if (relief) {
      // grade de (w+1)×(h+1) vértices nos cantos das células, cada um no centro do seu texel
      const W = w + 1, H = h + 1;
      const vertices = new Float32Array(W * H * 2), uvs = new Float32Array(W * H * 2), indices = new Uint32Array(w * h * 6);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        vertices[i * 2] = x * 32; vertices[i * 2 + 1] = y * 32 - relief.v(x, y);
        uvs[i * 2] = (x + 0.5) / W; uvs[i * 2 + 1] = (y + 0.5) / H;
      }
      let k = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
        indices[k++] = a; indices[k++] = b; indices[k++] = c; indices[k++] = b; indices[k++] = d; indices[k++] = c;
      }
      this.sprite = new MeshSimple({ texture: this.tex, vertices, uvs, indices });
    } else {
      const s = new Sprite(this.tex);
      s.scale.set(32);
      this.sprite = s;
    }
    this.sprite.eventMode = "none";
  }

  isVisible(x: number, y: number): boolean {
    if (!this.enabled) return true;
    const cx = Math.floor(x), cy = Math.floor(y);
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h && this.visible[cy * this.w + cx] === 1;
  }

  update(world: World, player = 1): void {
    const { w, h } = this;
    this.visible.fill(0);
    for (const u of world.units) {
      if (!u.active) continue;
      const shared = u.player === player || ((world.dip[u.player]?.[player] ?? 0) & 0x10) !== 0;
      if (!shared) continue;
      const rel = this.relief;
      if (rel) { markVisible(w, h, (x, y) => rel.v(x, y), Math.floor(u.x), Math.floor(u.y), u.stats.sight, this.visible, this.explored); continue; }
      const r = Math.max(2, u.stats.sight + 1.4), r2 = r * r;   // raio medido no minimapa do original (m10_hud: +7 células com sight 6.4)
      const x0 = Math.max(0, Math.floor(u.x - r)), x1 = Math.min(w - 1, Math.ceil(u.x + r));
      const y0 = Math.max(0, Math.floor(u.y - r)), y1 = Math.min(h - 1, Math.ceil(u.y + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - u.x, dy = y + 0.5 - u.y;
        if (dx * dx + dy * dy <= r2) { const i = y * w + x; this.visible[i] = 1; this.explored[i] = 1; }
      }
    }
    const d = this.img.data;
    const cell = (i: number) => !this.enabled || this.visible[i] ? 0 : this.explored[i] ? 110 : 255;
    if (this.relief) {
      const W = w + 1;
      for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
        let a = 255;
        for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x; xx++) {
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) a = Math.min(a, cell(yy * w + xx));
        }
        d[(y * W + x) * 4 + 3] = a;
      }
    } else {
      for (let i = 0; i < w * h; i++) d[i * 4 + 3] = cell(i);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.source.update();
  }
}
