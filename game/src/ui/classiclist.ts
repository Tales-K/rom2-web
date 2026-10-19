import { Container, Graphics, Rectangle, Sprite, TilingSprite, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import type { MenuKit } from "./menukit";
import { frameRect } from "./frame640";
import { Hint } from "./hint";
import { makeText, type GameText } from "./text";

/**
 * Lista com barra de rolagem das janelas do original (Load Game do menu principal; medida em refs/original/load_game_*.png, 640×480
 * em tamanho natural). Componente ÚNICO para as telas Load/Save (ui/saveui.ts) e qualquer outra lista de linhas do mesmo estilo.
 *
 *  - Cada linha tem 18 px + 1 px de vão (passo 19), largura 381, relevo "afundado": filete escuro (0x080808) em cima/à esquerda e
 *    claro (0x5a7163) embaixo/à direita; o miolo é o fundo roxo da janela. Texto em font1 (0xd6d3d6) a 4 px da borda.
 *  - Linha escolhida: miolo preto (0x080808) e texto dourado (0xbd9e4a). O mouse sobre uma linha NÃO a realça (só mostra a dica).
 *  - Barra de rolagem à direita (scrlbars.256, quadros 18 cima / 19 trilho / 20 baixo / 22 cursor; 21 e 23 = cima/baixo sob o mouse):
 *    os botões de seta MOVEM A ESCOLHA (não a janela de linhas) e o cursor mostra a posição da escolha na lista
 *    (y = 20 + floor(escolha·128/(n−1))). A janela de linhas só rola para manter a escolha visível.
 */
export const LIST = {
  rows: 10, rowH: 18, pitch: 19, width: 381, textX: 4, textY: -1,
  text: 0xd6d3d6, sel: 0xbd9e4a, dark: 0x080808, light: 0x5a7163, selLight: 0x212821,
  sbX: 384, thumbY: 20, thumbRange: 128, downY: 168,
};

export interface ListHint { show(lines: string[], gx: number, gy: number): void; hide(): void }

/**
 * Dica (ui/hint.ts, etiqueta dourada junto do cursor) para janelas que vivem na tela 1024×768 e não dentro do Frame640: cria o
 * contêiner deslocado (192,144) no `parent`, converte as coordenadas de tela do ponteiro e some junto com `destroy()`.
 */
export function screenHint(parent: Container): ListHint & { destroy(): void } {
  const host = new Container();
  const r = frameRect();
  host.position.set(r.x, r.y);
  host.eventMode = "none";
  parent.addChild(host);
  const hint = new Hint(host);
  return {
    show: (lines, gx, gy) => hint.show(lines, gx - host.x + 2, gy - host.y),
    hide: () => hint.hide(),
    destroy: () => { if (!host.destroyed) host.destroy({ children: true }); },
  };
}

export interface ClassicListOpts {
  rows?: number;
  width?: number;
  onSelect?: (index: number) => void;
  onActivate?: (index: number) => void;
  /** linhas da dica ao passar o mouse sobre o item `index` (undefined = sem dica) */
  tip?: (index: number) => string[] | undefined;
  hint?: ListHint;
}

export class ClassicList extends Container {
  private items: string[] = [];
  private itemTint: Array<number | undefined> = [];
  private top = 0;
  sel = 0;
  private readonly nRows: number;
  /** largura das linhas (381 nas janelas Load/Save; 285 em "View Cutscenes"); a barra de rolagem fica 3 px depois */
  private readonly w: number;
  /** posição do botão "baixo" e curso do cursor da barra: 10 linhas = 168 e 128; com menos linhas encolhem (Save: 7 linhas) */
  private readonly downY: number;
  private readonly range: number;
  private readonly bg: Graphics[] = [];
  private readonly txt: GameText[] = [];
  private thumb!: Sprite | Graphics;
  private upBtn!: Sprite | Graphics;
  private downBtn!: Sprite | Graphics;

  constructor(private readonly kit: MenuKit, private readonly o: ClassicListOpts = {}) {
    super();
    this.nRows = o.rows ?? LIST.rows;
    this.w = o.width ?? LIST.width;
    this.downY = this.nRows * LIST.pitch - 22;
    this.range = this.downY - 40;
    for (let i = 0; i < this.nRows; i++) {
      const g = new Graphics();
      g.position.set(0, i * LIST.pitch);
      g.eventMode = "static"; g.cursor = "pointer";
      g.hitArea = new Rectangle(0, 0, this.w, LIST.rowH);
      g.on("pointertap", (e: FederatedPointerEvent) => {
        const idx = this.top + i;
        if (idx >= this.items.length) return;
        if (this.sel === idx && e.detail >= 2) { this.o.onActivate?.(idx); return; }
        this.select(idx);
      });
      g.on("pointerover", (e: FederatedPointerEvent) => this.showTip(this.top + i, e));
      g.on("pointermove", (e: FederatedPointerEvent) => this.showTip(this.top + i, e));
      g.on("pointerout", () => this.o.hint?.hide());
      const t = makeText("", { font: "font1", color: LIST.text });
      t.position.set(LIST.textX, i * LIST.pitch + LIST.textY);
      t.eventMode = "none";
      this.addChild(g, t);
      this.bg.push(g); this.txt.push(t);
    }
    this.buildScroll();
    this.eventMode = "static";
    this.on("wheel", (e: FederatedWheelEvent) => this.select(this.sel + (e.deltaY > 0 ? 1 : -1)));
    this.paint();
  }

  private showTip(idx: number, e: FederatedPointerEvent): void {
    const h = this.o.hint;
    if (!h) return;
    const lines = idx < this.items.length ? this.o.tip?.(idx) : undefined;
    if (lines?.length) h.show(lines, e.global.x, e.global.y); else h.hide();
  }

  private buildScroll(): void {
    const k = this.kit, S = (n: number) => k.scr[n];
    const mk = (frame: number, y: number, fallback: number): Sprite | Graphics => {
      const s = k.ok ? new Sprite(S(frame)) : new Graphics().rect(0, 0, 24, 24).fill(fallback).stroke({ color: 0xc8a040, width: 1 });
      s.position.set(this.w + 3, y);
      return s;
    };
    if (k.ok) {
      const track = new TilingSprite({ texture: S(19)!, width: 24, height: this.downY - 24 });
      track.position.set(this.w + 3, 24);
      this.addChild(track);
    } else {
      this.addChild(new Graphics().rect(this.w + 3, 24, 24, this.downY - 24).fill(0x3a1f48));
    }
    this.upBtn = mk(18, 0, 0x5a2f6a); this.downBtn = mk(20, this.downY, 0x5a2f6a);
    this.thumb = mk(22, LIST.thumbY, 0xd8a24a);
    for (const [b, d, hov, norm] of [[this.upBtn, -1, 21, 18], [this.downBtn, 1, 23, 20]] as const) {
      b.eventMode = "static"; b.cursor = "pointer";
      b.on("pointertap", () => this.select(this.sel + d));
      if (k.ok) {
        b.on("pointerover", () => { (b as Sprite).texture = S(hov)!; });
        b.on("pointerout", () => { (b as Sprite).texture = S(norm)!; });
      }
    }
    this.thumb.eventMode = "none";
    this.addChild(this.upBtn, this.downBtn, this.thumb);
  }

  /** Troca o conteúdo; mantém a escolha dentro do intervalo. `tints`: cor própria por item (ex.: salvo danificado). */
  setItems(items: string[], tints: Array<number | undefined> = []): void {
    this.items = items; this.itemTint = tints;
    this.sel = Math.max(0, Math.min(this.sel, items.length - 1));
    this.top = Math.max(0, Math.min(this.top, Math.max(0, items.length - this.nRows)));
    this.paint();
  }

  get count(): number { return this.items.length; }

  select(i: number, notify = true): void {
    if (!this.items.length) return;
    const n = Math.max(0, Math.min(this.items.length - 1, i));
    const changed = n !== this.sel;
    this.sel = n;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + this.nRows) this.top = this.sel - this.nRows + 1;
    this.paint();
    if (notify && changed) this.o.onSelect?.(this.sel);
  }

  /** Teclas de navegação; devolve true se usou. */
  key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k === "ArrowDown") this.select(this.sel + 1);
    else if (k === "ArrowUp") this.select(this.sel - 1);
    else if (k === "PageDown") this.select(this.sel + this.nRows);
    else if (k === "PageUp") this.select(this.sel - this.nRows);
    else if (k === "Home") this.select(0);
    else if (k === "End") this.select(this.items.length - 1);
    else return false;
    return true;
  }

  private paint(): void {
    for (let i = 0; i < this.nRows; i++) {
      const idx = this.top + i, has = idx < this.items.length, on = has && idx === this.sel;
      const g = this.bg[i]!, w = this.w, h = LIST.rowH;
      g.clear();
      if (on) g.rect(0, 0, w, h).fill(LIST.dark).rect(0, h - 1, w, 1).fill(LIST.selLight);
      else g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.001 }).rect(0, 0, w, 1).fill(LIST.dark).rect(0, 0, 1, h).fill(LIST.dark)
        .rect(1, h - 1, w - 1, 1).fill(LIST.light).rect(w - 1, 1, 1, h - 1).fill(LIST.light);
      const t = this.txt[i]!;
      t.text = has ? this.items[idx]! : "";
      t.tint = on ? LIST.sel : this.itemTint[idx] ?? LIST.text;
    }
    const n = this.items.length;
    this.thumb.y = LIST.thumbY + (n > 1 ? Math.floor(this.sel * this.range / (n - 1)) : 0);
  }
}
