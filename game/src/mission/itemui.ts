/**
 * Barra de inventário da missão (a "mochila" do original) e arrastar-e-soltar de itens.
 *
 * Arte original (graphics/interface, exportada em assets/ui/hud/): `inv1024l` | seta esq. (invframe x 0..32) | 9 células de 80×90
 * (fundo de invframe x = 32 + pos·80: 1ª célula pos 0, última pos 4, meio (i%3)+1) | seta dir. (invframe x 432..464) | `inv1024r`
 * (sob o painel). Destaque das setas: invarrow1/2 (mouse em cima, esq./dir.), invarrow3/4 (apertada). Célula com item: `backinv`
 * 80×80 em y+6 + ícone 80×80 (graphics/inventory, assets/ui/shop/icons); quantidade (> 1) em font2 0xBD9E4A no canto inferior
 * esquerdo; o ouro é um pseudo-item no fim da mochila (UnityAllods MapViewInventory/ItemView, que leram o allods2.exe:
 * nº de células = (largura − 176 − 64) / 80 = 9 em 1024×768).
 *
 * Interação (como o original/UnityAllods): arrastar uma célula para a boneca (moldura oval) veste; da boneca para a barra tira;
 * para o mapa larga no chão (saco sob o herói); arrastar o ouro para o mapa abre "Drop money"; clique direito ou duplo = vestir/usar;
 * Shift ao arrastar = a pilha inteira. A boneca usa o teste de alfa por camada (MapViewHuman.GetHumanItemByPoint).
 */
import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { SCREEN_H, SCREEN_W } from "../core/scene";
import type { Game } from "../core/game";
import { makeText, type GameText } from "../ui/text";
import { COL, ItemColumn, classicMenuItem, label, loadMenuKit, menuKitNow, openWindow } from "../ui/menukit";
import { ItemCatalog } from "../town/items";
import type { HeroInventory } from "./inventory";
import { PANEL_X } from "./hud";
import { askNumber } from "../ui/numdialog";
/** janela "Drop money" no cliente 1024×768 (medida no original) */
const DROP_X = 100, DROP_Y = 568;

const HUD = "assets/ui/hud/";
export const BAR_H = 90;
export const BAR_Y = SCREEN_H - BAR_H;
const CELLS = Math.floor((SCREEN_W - 176 - 64) / 80);   // 9
const CELL_X0 = 64;                                    // inv1024l (32) + seta (32)
const ARROW_R_X = CELL_X0 + CELLS * 80;
/** área da boneca (retrato 160×240) em coordenadas de tela */
export const DOLL_RECT = new Rectangle(PANEL_X + 16, 240, 160, 240);

/** O que a barra pede à cena. */
export interface ItemUiHost {
  inv: HeroInventory;
  /** ouro total que o herói carrega (cidade + recolhido na missão) */
  gold(): number;
  /** equipamento/mochila mudaram: recalcular atributos, espelho da sim e boneca */
  changed(equipment: boolean): void;
  /** usa a poção/pergaminho da posição i (a cena aplica o efeito e consome) */
  use(i: number): void;
  /** larga itens no chão sob o herói */
  dropItems(ids: string[]): void;
  /** larga ouro no chão */
  dropGold(amount: number): void;
  /** slot do item vestido sob o ponto (coordenadas locais da boneca 160×240) ou undefined */
  dollSlotAt(x: number, y: number): string | undefined;
  /** a boneca do herói está na moldura (herói selecionado)? */
  dollShown(): boolean;
  /** o herói está selecionado? Senão a barra mostra só "No hero selected" (main.txt 51) */
  heroSelected(): boolean;
  say(text: string, ms?: number): void;
  sfx(name: string): void;
  /** pausa enquanto a janela "Drop money" está aberta */
  setPaused(on: boolean): void;
}

type DragSrc = { kind: "pack"; index: number } | { kind: "gold" } | { kind: "body"; slot: string };
interface Drag { src: DragSrc; id: string; count: number; sprite?: Sprite; x0: number; y0: number; started: boolean; }

let catalog: Promise<ItemCatalog> | undefined;

export class ItemUi {
  readonly root = new Container();
  /** hit da boneca: a cena/HUD o coloca sob os botões livro/mochila da moldura */
  readonly dollHit = new Graphics();
  readonly dragLayer = new Container();
  private bar = new Container();
  private cells = new Container();
  private arrows: Sprite[] = [];
  private tex = new Map<string, Texture>();
  private icons = new Map<string, Texture | null>();
  private cat?: ItemCatalog;
  private scroll = 0;
  private sig = "";
  private drag: Drag | null = null;
  private held: { dir: -1 | 1; next: number } | null = null;
  private hoverArrow = 0;
  private lastClick = { t: 0, key: "" };
  open = false;

  constructor(private readonly game: Game, private readonly host: ItemUiHost) {}

  async load(): Promise<void> {
    const names = ["inv1024l", "inv1024r", "invframe", "invarrow1", "invarrow2", "invarrow3", "invarrow4", "backinv"];
    await Promise.all(names.map(async n => { try { this.tex.set(n, await this.game.data.texture(`${HUD}${n}.png`)); } catch { /* sem arte */ } }));
    try { this.tex.set("money", await this.game.data.texture("assets/ui/shop/money.webp")); } catch { /* sem ícone */ }
    catalog ??= ItemCatalog.load(this.game);
    this.cat = await catalog.catch(() => undefined);
    const T = (n: string) => this.tex.get(n);
    const frame = T("invframe");
    const sub = (x: number, w: number) => frame ? new Texture({ source: frame.source, frame: new Rectangle(x, 0, w, BAR_H) }) : Texture.EMPTY;
    const put = (t: Texture | undefined, x: number, y = 0) => { const s = new Sprite(t ?? Texture.EMPTY); s.position.set(x, y); this.bar.addChild(s); return s; };
    this.bar.addChild(new Graphics().rect(0, 0, PANEL_X, BAR_H).fill(0x000000));
    put(T("inv1024r"), ARROW_R_X + 32);
    put(T("inv1024l"), 0);
    put(sub(0, 32), 32);
    for (let i = 0; i < CELLS; i++) put(sub(32 + 80 * (i === 0 ? 0 : i === CELLS - 1 ? 4 : (i % 3) + 1), 80), CELL_X0 + i * 80);
    put(sub(432, 32), ARROW_R_X);
    this.bar.addChild(this.cells);
    for (const [i, x] of [[1, 32], [2, ARROW_R_X], [3, 32], [4, ARROW_R_X]] as const) {
      const s = put(T(`invarrow${i}`), x, 2); s.visible = false; this.arrows[i] = s;
    }
    const hit = new Graphics().rect(0, 0, PANEL_X, BAR_H).fill({ color: 0, alpha: 0.001 });
    hit.eventMode = "static";
    hit.on("pointerdown", e => this.onBarDown(e));
    this.bar.addChild(hit);
    this.bar.position.set(0, BAR_Y);
    this.bar.visible = false;
    this.root.addChild(this.bar);

    this.dollHit.rect(0, 0, DOLL_RECT.width, DOLL_RECT.height).fill({ color: 0, alpha: 0.001 });
    this.dollHit.eventMode = "static";
    this.dollHit.on("pointerdown", e => this.onDollDown(e));
  }

  setOpen(on: boolean): void {
    this.open = on;
    this.bar.visible = on;
    this.sig = "";
    if (!on) this.cancelDrag();
  }

  /** dentro da barra (para a cena não tratar como clique no mapa) */
  contains(x: number, y: number): boolean { return this.open && y >= BAR_Y && x < PANEL_X; }
  get dragging(): boolean { return !!this.drag?.started; }

  // ------------------------------------------------------------------ desenho

  private entries(): { id: string; count: number; gold?: boolean }[] {
    const inv = this.host.inv.hero.inventory;
    const out: { id: string; count: number; gold?: boolean }[] = inv.map(e => ({ id: e.id, count: Math.max(1, e.count ?? 1) }));
    out.push({ id: "gold", count: this.host.gold(), gold: true });
    return out;
  }

  private icon(id: string): Texture | undefined {
    if (this.icons.has(id)) return this.icons.get(id) ?? undefined;
    this.icons.set(id, null);
    if (!this.cat) return undefined;
    const path = this.cat.iconPath(this.cat.get(id));
    void this.game.data.texture(path).then(t => { this.icons.set(id, t); this.sig = ""; }).catch(() => { /* sem ícone */ });
    return undefined;
  }

  private redraw(): void {
    const list = this.entries();
    this.scroll = Math.max(0, Math.min(this.scroll, list.length - CELLS));
    const dragKey = this.drag?.started ? JSON.stringify(this.drag.src) + this.drag.count : "";
    const sig = JSON.stringify(list) + "|" + this.scroll + "|" + dragKey + (this.host.heroSelected() ? "" : "|nohero");
    if (sig === this.sig) return;
    this.sig = sig;
    this.cells.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!this.host.heroSelected()) {
      const t = makeText("NO HERO SELECTED", { font: "font2", color: 0xbd9e4a });
      t.anchor.set(0.5, 0); t.position.set(455, 38);   // medido em m20_bag_open (glyphs em 407..503, y 720)
      this.cells.addChild(t);
      return;
    }
    for (let k = 0; k < CELLS; k++) {
      const e = list[this.scroll + k];
      if (!e) break;
      const x = CELL_X0 + k * 80;
      const back = this.tex.get("backinv");
      if (back) { const b = new Sprite(back); b.position.set(x, 6); this.cells.addChild(b); }
      let shown = e.count;
      const src = this.drag?.started ? this.drag.src : undefined;
      if (src && ((src.kind === "pack" && src.index === this.scroll + k) || (src.kind === "gold" && e.gold))) shown -= this.drag!.count;
      const t = e.gold ? this.tex.get("money") : this.icon(e.id);
      if (t) {
        const s = new Sprite(t);
        s.position.set(x, 6);
        s.width = s.height = 80;
        // arrastado: meio apagado (ItemView desenha a 0,25 o item em arrasto)
        if (shown <= 0) s.alpha = 0.25;
        this.cells.addChild(s);
      } else {
        const n = makeText(this.host.inv.name(e.id), { size: 11, color: 0xd8c8a8, wrap: 72, align: "center" });
        n.anchor.set(0.5); n.position.set(x + 40, 46); this.cells.addChild(n);
      }
      if (e.gold || shown > 1) {
        // quantidade/ouro em font2 dourada com sombra, no canto inferior esquerdo da célula (medido em m10_bag_open)
        const txt = makeText(e.gold ? fmtMoney(Math.max(0, shown)) : String(shown), { font: "font2", color: 0xbd9e4a });
        txt.position.set(x + 3, 6 + 67);
        this.cells.addChild(txt);
      }
      if (!e.gold && !this.host.inv.usableByHero(e.id)) {
        this.cells.addChild(new Graphics().rect(x + 2, 8, 76, 76).fill({ color: 0x600000, alpha: 0.25 }));
      }
    }
  }

  /** chamado a cada quadro pela cena (posição do ponteiro em tela) */
  update(px: number, py: number, inside: boolean, now: number): void {
    if (this.open) {
      this.redraw();
      // setas: destaque e rolagem contínua (uma célula a cada 100 ms, como no UnityAllods)
      const onBar = inside && py >= BAR_Y && px < PANEL_X;
      this.hoverArrow = onBar ? (px >= 32 && px < 64 ? 1 : px >= ARROW_R_X && px < ARROW_R_X + 32 ? 2 : 0) : 0;
      const pressed = this.held ? (this.held.dir < 0 ? 1 : 2) : 0;
      this.arrows.forEach((s, i) => { if (s) s.visible = pressed ? i === pressed + 2 : i === this.hoverArrow; });
      if (this.held && now >= this.held.next) { this.scrollBy(this.held.dir); this.held.next = now + 100; }
    }
    if (this.drag?.sprite) this.drag.sprite.position.set(px - 40, py - 40);
  }

  private scrollBy(d: number): void {
    const max = Math.max(0, this.entries().length - CELLS);
    const ns = Math.max(0, Math.min(max, this.scroll + d));
    if (ns !== this.scroll) { this.scroll = ns; this.host.sfx("click"); }
  }

  // ------------------------------------------------------------------ dica

  /**
   * Linhas da dica sob o ponteiro, no estilo do original (a caixa dourada de ui/hint.ts é desenhada pelo HUD): "Money" no ouro,
   * dica do item na célula/na boneca, "Your hero's inventory" na célula vazia, "Scroll left/right" nas setas (main.txt 74, 58, 54, 55).
   */
  hintLines(px: number, py: number, inside: boolean): string[] {
    if (!inside || this.drag?.started) return [];
    const cell = this.cellAt(px, py);
    if (cell) return cell.gold ? ["Money"] : this.host.inv.hintLines(cell.id);
    if (this.open && py >= BAR_Y && px < PANEL_X) {
      if (px >= 32 && px < 64) return ["Scroll left"];
      if (px >= ARROW_R_X && px < ARROW_R_X + 32) return ["Scroll right"];
      if (py >= BAR_Y + 6 && py < BAR_Y + 86 && px >= CELL_X0 && px < ARROW_R_X) return ["Your hero's inventory"];
    }
    if (this.host.dollShown() && DOLL_RECT.contains(px, py)) {
      const slot = this.host.dollSlotAt(px - DOLL_RECT.x, py - DOLL_RECT.y);
      const id = slot ? this.host.inv.hero.equipment[slot] : undefined;
      if (id) return this.host.inv.hintLines(id);
    }
    return [];
  }

  // ------------------------------------------------------------------ entrada

  private cellAt(px: number, py: number): { index: number; id: string; count: number; gold?: boolean } | undefined {
    if (!this.open || !this.host.heroSelected() || py < BAR_Y + 6 || py >= BAR_Y + 86 || px < CELL_X0 || px >= ARROW_R_X) return undefined;
    const index = this.scroll + Math.floor((px - CELL_X0) / 80);
    const e = this.entries()[index];
    return e ? { index, ...e } : undefined;
  }

  private onBarDown(e: FederatedPointerEvent): void {
    const p = e.global;
    if (p.x >= 32 && p.x < 64) { this.held = { dir: -1, next: performance.now() + 250 }; this.scrollBy(-1); return; }
    if (p.x >= ARROW_R_X && p.x < ARROW_R_X + 32) { this.held = { dir: 1, next: performance.now() + 250 }; this.scrollBy(1); return; }
    const c = this.cellAt(p.x, p.y);
    if (!c) return;
    if (e.button === 2) { if (!c.gold) this.activate(c.index); return; }
    if (e.button !== 0) return;
    const key = c.gold ? "gold" : `p${c.index}`;
    const now = performance.now();
    if (this.lastClick.key === key && now - this.lastClick.t < 350) {
      this.lastClick.t = 0;
      if (c.gold) { if (this.host.gold() > 0) void this.askDropMoney(); } else this.activate(c.index);
      return;
    }
    this.lastClick = { t: now, key };
    const whole = e.shiftKey;
    this.drag = c.gold
      ? { src: { kind: "gold" }, id: "gold", count: c.count, x0: p.x, y0: p.y, started: false }
      : { src: { kind: "pack", index: c.index }, id: c.id, count: whole ? c.count : 1, x0: p.x, y0: p.y, started: false };
  }

  private onDollDown(e: FederatedPointerEvent): void {
    if (!this.host.dollShown()) return;
    const p = e.global;
    const slot = this.host.dollSlotAt(p.x - DOLL_RECT.x, p.y - DOLL_RECT.y);
    if (!slot) return;
    const id = this.host.inv.hero.equipment[slot];
    if (!id) return;
    if (e.button === 2) { this.unequip(slot); return; }
    if (e.button !== 0) return;
    const now = performance.now();
    if (this.lastClick.key === "b" + slot && now - this.lastClick.t < 350) { this.lastClick.t = 0; this.unequip(slot); return; }
    this.lastClick = { t: now, key: "b" + slot };
    this.drag = { src: { kind: "body", slot }, id, count: 1, x0: p.x, y0: p.y, started: false };
  }

  /** a cena repassa o movimento do ponteiro (tela) */
  pointerMove(px: number, py: number): void {
    const d = this.drag;
    if (!d || d.started) return;
    if (Math.abs(px - d.x0) + Math.abs(py - d.y0) < 5) return;
    d.started = true;
    const t = d.id === "gold" ? this.tex.get("money") : this.icon(d.id);
    if (t) { d.sprite = new Sprite(t); d.sprite.width = d.sprite.height = 80; d.sprite.alpha = 0.85; d.sprite.eventMode = "none"; this.dragLayer.addChildAt(d.sprite, 0); }
    this.sig = "";
    this.host.sfx("click");
  }

  /** a cena repassa o soltar do botão (tela); devolve true se consumiu o evento */
  pointerUp(px: number, py: number): boolean {
    this.held = null;
    const d = this.drag;
    this.drag = null;
    if (!d) return false;
    d.sprite?.destroy();
    this.sig = "";
    if (!d.started) return true;
    this.drop(d, px, py);
    return true;
  }

  cancelDrag(): void { this.drag?.sprite?.destroy(); this.drag = null; this.held = null; this.sig = ""; }

  private drop(d: Drag, px: number, py: number): void {
    const inv = this.host.inv;
    const onBar = this.open && py >= BAR_Y && px < PANEL_X;
    const onDoll = this.host.dollShown() && DOLL_RECT.contains(px, py);
    const onMap = px < PANEL_X && !onBar && px >= 0 && py >= 0 && py < SCREEN_H;
    const target = onBar ? Math.max(0, this.scroll + Math.floor((px - CELL_X0) / 80)) : -1;
    if (d.src.kind === "pack") {
      const i = d.src.index;
      if (onDoll) { this.activate(i, true); return; }
      if (onBar) { inv.move(i, Math.min(target, inv.hero.inventory.length - 1)); this.host.changed(false); return; }
      if (onMap) {
        if (inv.isQuest(d.id)) { this.host.say("You cannot drop this item"); this.host.sfx("error"); return; }
        const ids: string[] = [];
        for (let k = 0; k < d.count; k++) { const id = inv.take(i); if (id) ids.push(id); }
        this.host.dropItems(ids);
        this.host.changed(false);
      }
      return;
    }
    if (d.src.kind === "body") {
      const slot = d.src.slot;
      if (onBar) { inv.unequip(slot, true, Math.min(target, inv.hero.inventory.length)); this.host.changed(true); this.host.sfx("click"); return; }
      if (onMap) { const id = inv.unequip(slot, false); if (id) { this.host.dropItems([id]); this.host.changed(true); } }
      return;
    }
    // ouro: arrastar para o mapa não faz nada no original (m10: soltar no chão, na boneca ou em outra célula); o "Drop money" abre com o
    // duplo clique no ouro (refs/original/m10_drop_money, 19/10)
  }

  /** clique direito / duplo: veste (ou usa poção/pergaminho) o item da posição i */
  activate(i: number, fromDrag = false): void {
    const inv = this.host.inv;
    const e = inv.hero.inventory[i];
    if (!e) return;
    if (inv.consumable(e.id)) { if (!fromDrag) this.host.use(i); else this.host.say("Right-click the item to use it"); return; }
    const err = inv.equipFromPack(i);
    if (err) { this.host.say(err); this.host.sfx("error"); return; }
    this.host.sfx("equip");
    this.host.changed(true);
  }

  private unequip(slot: string): void {
    this.host.inv.unequip(slot, true);
    this.host.sfx("equip");
    this.host.changed(true);
  }

  // ------------------------------------------------------------------ "Drop money"

  private async askDropMoney(): Promise<void> {
    const max = this.host.gold();
    this.host.setPaused(true);
    const n = await askNumber(this.dragLayer, { x: DROP_X, y: DROP_Y, lines: ["How much gold do", "you want to drop ?"], max });
    this.host.setPaused(false);
    if (n && n > 0) this.host.dropGold(Math.min(max, n));
  }
}

export function fmtMoney(n: number): string { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// ------------------------------------------------------------------ teste de alfa (boneca)

const alphaCache = new WeakMap<object, { w: number; h: number; a: Uint8ClampedArray } | null>();

/** Opacidade (0..255) do pixel (x, y) de uma textura (lê a imagem de origem uma vez). */
export function alphaAt(t: Texture, x: number, y: number): number {
  const src = t.source as unknown as { resource?: CanvasImageSource & { width: number; height: number } };
  const res = src.resource;
  if (!res) return 0;
  let c = alphaCache.get(res);
  if (c === undefined) {
    try {
      const cv = document.createElement("canvas");
      cv.width = res.width; cv.height = res.height;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(res, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const a = new Uint8ClampedArray(cv.width * cv.height);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]!;
      c = { w: cv.width, h: cv.height, a };
    } catch { c = null; }
    alphaCache.set(res, c);
  }
  if (!c) return 0;
  const fx = Math.floor(x + t.frame.x), fy = Math.floor(y + t.frame.y);
  if (x < 0 || y < 0 || x >= t.frame.width || y >= t.frame.height || fx >= c.w || fy >= c.h) return 0;
  return c.a[fy * c.w + fx]!;
}
