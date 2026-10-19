import { Container, Graphics, Rectangle, Sprite, TilingSprite, type FederatedPointerEvent } from "pixi.js";
import type { MenuKit } from "./menukit";

/**
 * Controle de volume horizontal das janelas do original (Sound Options; medido em refs/original/town_sound_options.png):
 * botão de estrela 24×24 em cada ponta, trilho roxo entre eles (scrlbars.256, quadro 1 repetido) e o cursor dourado (quadro 4)
 * que se arrasta. Os botões movem 1/16 do curso. Componente ÚNICO para qualquer slider desse estilo.
 */
export const SLIDER = { btn: 24, step: 1 / 16, left: 0, right: 2, leftHot: 3, rightHot: 5, track: 7, thumb: 4 };

export class ClassicSlider extends Container {
  private v: number;
  private readonly thumb: Sprite | Graphics;
  private readonly trackW: number;
  private drag = false;

  /** `width` = largura total (botão + trilho + botão); `value` 0..1 */
  constructor(kit: MenuKit, totalW: number, value: number, private readonly onChange: (v: number) => void) {
    super();
    this.v = value;
    const B = SLIDER.btn, width = totalW;
    this.trackW = width - 2 * B;
    const S = (n: number) => kit.scr[n];
    const mk = (n: number, x: number, d: number): Sprite | Graphics => {
      const s = kit.ok ? new Sprite(S(n)) : new Graphics().rect(0, 0, B, B).fill(0x5a2f6a).stroke({ color: 0xc8a040, width: 1 });
      s.position.set(x, 0);
      s.eventMode = "static"; s.cursor = "pointer";
      s.on("pointerdown", (e: FederatedPointerEvent) => { e.stopPropagation(); this.set(this.v + d * SLIDER.step, true); });
      if (kit.ok) {   // sob o mouse a estrela fica rosa (quadros 3 e 5)
        const hot = d < 0 ? SLIDER.leftHot : SLIDER.rightHot;
        s.on("pointerover", () => { (s as Sprite).texture = S(hot)!; });
        s.on("pointerout", () => { (s as Sprite).texture = S(n)!; });
      }
      return s;
    };
    if (kit.ok) {
      const track = new TilingSprite({ texture: S(SLIDER.track)!, width: this.trackW, height: B });
      track.position.set(B, 0);
      this.addChild(track);
    } else this.addChild(new Graphics().rect(B, 8, this.trackW, 8).fill(0x3a1f48));
    this.thumb = kit.ok ? new Sprite(S(SLIDER.thumb)) : new Graphics().rect(0, 0, 12, B).fill(0xd8a24a);
    this.addChild(mk(SLIDER.left, 0, -1), mk(SLIDER.right, width - B, 1), this.thumb);
    this.eventMode = "static";
    this.hitArea = new Rectangle(B, 0, this.trackW, B);
    this.on("pointerdown", (e: FederatedPointerEvent) => { this.drag = true; this.fromX(this.toLocal(e.global).x); });
    this.on("globalpointermove", (e: FederatedPointerEvent) => { if (this.drag) this.fromX(this.toLocal(e.global).x); });
    this.on("pointerup", () => { this.drag = false; });
    this.on("pointerupoutside", () => { this.drag = false; });
    this.place();
  }

  private place(): void {
    const tw = this.thumb.width;
    this.thumb.position.set(SLIDER.btn + Math.round(this.v * (this.trackW - tw)), 0);
  }

  private fromX(x: number): void {
    const tw = this.thumb.width;
    this.set((x - SLIDER.btn - tw / 2) / (this.trackW - tw), true);
  }

  get value(): number { return this.v; }

  set(v: number, notify = false): void {
    const nv = Math.max(0, Math.min(1, v));
    const ch = nv !== this.v;
    this.v = nv;
    this.place();
    if (notify && ch) this.onChange(nv);
  }
}
