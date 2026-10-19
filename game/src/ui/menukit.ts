/**
 * Kit visual das janelas de menu do jogo (menu Esc, Load/Save Game, opções, confirmação), com a arte original:
 *   graphics/interface/lm.256       moldura roxa com caveiras douradas (conjunto grande e pequeno)   -> assets/ui/gamemenu/lm_NN
 *   graphics/interface/scrlbars.256 barras de rolagem / botões de estrela                              -> scr_NN
 *   graphics/interface/radiob.256   botões de rádio e caixas de seleção                                -> radio_N
 * (convertidos por tools/pipeline/gamemenu.py). Sem os arquivos, tudo cai num desenho simples com Graphics.
 * A arte está em 640x480: as peças são desenhadas num contêiner escalado 1,6× (K); o texto (makeText) fica em pixels de tela.
 */
import { Assets, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite, type FederatedPointerEvent } from "pixi.js";
import { SCREEN_H, SCREEN_W } from "../core/scene";
import { pushKeyLayer } from "./modal";
import { makeText, type GameText } from "./text";

const DIR = "assets/ui/gamemenu/";
export const K = SCREEN_W / 640;

/** Cores do texto dos menus (dourado sobre roxo, como no original). */
export const COL = {
  text: 0xcaa860,
  hover: 0xfff0b8,
  key: 0xff9a40,
  dim: 0x7a6650,
  title: 0xf0c868,
  info: 0xd8c8a8,
  sel: 0xfff4c8,
  error: 0xff8a6a,
  ok: 0xa8e090,
};

export interface MenuKit {
  ok: boolean;
  lm: Texture[];
  scr: Texture[];
  radio: Texture[];
  diskette?: Texture;
}

interface KitMeta { lm: { file: string }[]; scr: { file: string }[]; radio: { file: string }[]; diskette?: string; }

let kitPromise: Promise<MenuKit> | undefined;
let kitCache: MenuKit | undefined;

/** Carrega (uma vez) as texturas do kit. Nunca rejeita: sem arquivos devolve `{ ok: false }`. */
export function loadMenuKit(): Promise<MenuKit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      try {
        // o Vite (dev) só serve em "/" os arquivos de public/ que existiam quando o servidor subiu (watch ignora public/);
        // arquivos gerados depois respondem com o index.html — então tentamos também "/public/..." (servido da raiz do projeto)
        const tryMeta = async (base: string): Promise<KitMeta | null> => {
          try { const r = await fetch(base + "gamemenu.json"); return r.ok ? await r.json() as KitMeta : null; } catch { return null; }
        };
        let base = DIR;
        let m = await tryMeta(base);
        if (!m && import.meta.env?.DEV) { base = "/public/" + DIR; m = await tryMeta(base); }
        if (!m) throw new Error("gamemenu.json ausente (rode tools/pipeline/gamemenu.py)");
        const load = (l: { file: string }[]) => Promise.all(l.map(x => Assets.load<Texture>(base + x.file)));
        const [lm, scr, radio, diskette] = await Promise.all([load(m.lm), load(m.scr), load(m.radio), m.diskette ? Assets.load<Texture>(base + m.diskette) : Promise.resolve(undefined)]);
        kitCache = { ok: lm.length >= 18 && scr.length >= 26 && radio.length >= 4, lm, scr, radio, diskette };
      } catch (err) {
        console.warn("[menukit] arte dos menus indisponível, usando desenho simples:", (err as Error)?.message ?? err);
        kitCache = { ok: false, lm: [], scr: [], radio: [] };
      }
      return kitCache;
    })();
  }
  return kitPromise;
}

export function menuKitNow(): MenuKit | undefined { return kitCache; }

if (typeof window !== "undefined") void loadMenuKit();

// ------------------------------------------------------------------ moldura

/** Moldura (fundo roxo + bordas + caveiras) de `w`×`h` pixels de tela. `small` usa o conjunto pequeno (caixas internas). */
export function frame(kit: MenuKit, w: number, h: number, small = false, scale = K): Container {
  const c = new Container();
  if (!kit.ok) {
    c.addChild(new Graphics().roundRect(0, 0, w, h, small ? 4 : 10).fill(small ? 0x1c0f22 : 0x2a1630).stroke({ color: 0xc8a040, width: small ? 2 : 3 }));
    return c;
  }
  const b = small ? 9 : 0;
  const t = (i: number) => kit.lm[b + i]!;
  const art = new Container();
  art.scale.set(scale);
  const W = Math.max(w / scale, t(1).width * 2), H = Math.max(h / scale, t(1).height * 2);
  const cw = t(1).width, ch = t(1).height;
  const tile = (tex: Texture, x: number, y: number, tw: number, th: number, phase = 0) => {
    if (tw <= 0 || th <= 0) return;
    const s = new TilingSprite({ texture: tex, width: tw, height: th });
    s.position.set(x, y);
    if (phase) s.tilePosition.set(phase, phase);
    art.addChild(s);
  };
  // o miolo entra alguns px por baixo das bordas: com escala fracionária (K = 1,6) a emenda do TilingSprite deixava um
  // retângulo fino e mais escuro visível no interior da moldura (linhas atrás do conteúdo)
  const ov = 8;
  // fase do mosaico: o original começa a repetir o fundo em (cw, ch) da janela (medido em refs/original/load_game_screen.png); o miolo
  // estendido `ov` px por baixo das bordas continua com a mesma fase
  tile(t(0), cw - ov, ch - ov, W - 2 * cw + 2 * ov, H - 2 * ch + 2 * ov, ov);
  tile(t(2), cw, 0, W - 2 * cw, ch);
  tile(t(7), cw, H - ch, W - 2 * cw, ch);
  tile(t(4), 0, ch, cw, H - 2 * ch);
  tile(t(5), W - cw, ch, cw, H - 2 * ch);
  const corner = (i: number, x: number, y: number) => { const s = new Sprite(t(i)); s.position.set(x, y); art.addChild(s); };
  corner(1, 0, 0); corner(3, W - cw, 0); corner(6, 0, H - ch); corner(8, W - cw, H - ch);
  c.addChild(art);
  return c;
}

// ------------------------------------------------------------------ texto com tecla de atalho ("~Save Game")

export function parseHotkey(label: string): { text: string; key?: string; at: number } {
  const i = label.indexOf("~");
  if (i < 0 || i === label.length - 1) return { text: label.replace(/~/g, ""), at: -1 };
  const text = label.slice(0, i) + label.slice(i + 1);
  return { text, key: text[i]!.toLowerCase(), at: i };
}

/** Rótulo com a letra de atalho destacada; `setColor` troca a cor do resto. */
export function hotkeyText(label: string, size: number, color: number): { view: Container; key?: string; text: string; setColor(c: number): void; width: number } {
  const p = parseHotkey(label);
  const view = new Container();
  const parts: { t: GameText; hot: boolean }[] = [];
  const chunks = p.at < 0 ? [[p.text, false]] as [string, boolean][] : [[p.text.slice(0, p.at), false], [p.text[p.at]!, true], [p.text.slice(p.at + 1), false]] as [string, boolean][];
  let x = 0;
  for (const [s, hot] of chunks) {
    if (!s) continue;
    const t = makeText(s, { size, color: 0xffffff, stroke: 0x000000 });
    t.tint = hot ? COL.key : color;
    t.position.set(x, 0);
    // espaços no fim de um pedaço não contam na largura do BitmapText: compensa
    x += t.width + (/\s$/.test(s) ? size * 0.3 : 0);
    view.addChild(t);
    parts.push({ t, hot });
  }
  return {
    view, key: p.key, text: p.text, width: x,
    setColor: (c: number) => { for (const q of parts) if (!q.hot) q.t.tint = c; },
  };
}

// ------------------------------------------------------------------ itens clicáveis

export interface Item extends Container {
  label: string;
  key?: string;
  enabled: boolean;
  activate(): void;
  setFocus(on: boolean): void;
  setEnabled(on: boolean): void;
}

/**
 * Item de menu: estrela (scr_24/25) + rótulo. `center`: rótulo centrado em `width`. Clique ou Enter (quando em foco) chamam `onClick`.
 */
export function menuItem(kit: MenuKit, label: string, width: number, onClick: () => void, opts: { size?: number; center?: boolean; star?: boolean; height?: number } = {}): Item {
  const size = opts.size ?? 22;
  const h = opts.height ?? Math.round(size * 1.6);
  const c = new Container() as Item;
  const hit = new Graphics().rect(0, 0, width, h).fill({ color: 0xffffff, alpha: 0.001 });
  const glow = new Graphics().roundRect(0, 2, width, h - 4, 6).fill({ color: 0xc080ff, alpha: 0.16 });
  glow.visible = false;
  c.addChild(hit, glow);
  const star = opts.star !== false && kit.ok ? new Sprite(kit.scr[24]) : undefined;
  const lbl = hotkeyText(label, size, COL.text);
  const starW = star ? h * 0.8 : 0;
  if (star) { star.width = star.height = starW; star.position.set(opts.center ? 0 : 4, (h - starW) / 2); c.addChild(star); }
  const tx = opts.center ? Math.max(starW + 6, (width - lbl.width) / 2) : starW + 14;
  lbl.view.position.set(tx, (h - size * 1.05) / 2);
  if (star && opts.center) star.x = tx - starW - 8;
  c.addChild(lbl.view);
  c.label = lbl.text; c.key = lbl.key; c.enabled = true;
  let focus = false, pressed = false;
  const paint = () => {
    const col = !c.enabled ? COL.dim : focus ? COL.hover : COL.text;
    lbl.setColor(col);
    glow.visible = focus && c.enabled;
    if (star && kit.ok) star.texture = kit.scr[focus && c.enabled ? 25 : 24]!;
    if (star) star.alpha = c.enabled ? 1 : 0.45;
    c.scale.set(pressed ? 0.98 : 1);
  };
  c.setFocus = on => { focus = on; paint(); };
  c.setEnabled = on => { c.enabled = on; c.cursor = on ? "pointer" : "default"; paint(); };
  c.activate = () => { if (c.enabled) onClick(); };
  c.eventMode = "static"; c.cursor = "pointer";
  c.hitArea = new Rectangle(0, 0, width, h);
  c.on("pointerover", () => c.emit("focusme" as never, c as never));
  c.on("pointerdown", () => { pressed = true; paint(); });
  c.on("pointerupoutside", () => { pressed = false; paint(); });
  c.on("pointertap", () => { pressed = false; paint(); c.activate(); });
  paint();
  return c;
}

/** Cores do menu do jogo original (refs/original/mission_menu.png): texto cinza-claro, foco dourado, caixa com relevo de 1 px. */
export const CLASSIC = { text: 0xd6d3d6, focus: 0xbd9e4a, dim: 0x737173, light: 0x294539, dark: 0x000c08, slotW: 208, slotH: 28, pitch: 30 };

/**
 * Item do menu do jogo como no original: caixa 208×28 com relevo (linha clara em cima/esquerda, escura embaixo/direita),
 * rótulo centrado em font1 com sombra, letra de atalho sublinhada; foco = dourado. Medido em refs/original/mission_menu.png.
 */
export interface ClassicItemOpts {
  width?: number; height?: number;
  /** espessura (px) do filete escuro de baixo/direita: 1 no menu do jogo, 2 nos botões Ok/Delete/Cancel do Load Game */
  edge?: number;
  /** botão apertado: relevo invertido (claro embaixo/direita, escuro em cima/esquerda) e rótulo dourado (Load Game) */
  pressRelief?: boolean;
  /** y do rótulo (padrão 5) */
  textY?: number;
}

export function classicMenuItem(label: string, onClick: () => void, opts: ClassicItemOpts = {}): Item {
  const w = opts.width ?? CLASSIC.slotW, h = opts.height ?? CLASSIC.slotH, e = opts.edge ?? 1;
  const c = new Container() as Item;
  const box = new Graphics();
  const drawBox = (down = false) => {
    const lt = down ? CLASSIC.dark : CLASSIC.light, dk = down ? CLASSIC.light : CLASSIC.dark;
    box.clear();
    if (e === 1) box.rect(0, 0, w, 1).fill(lt).rect(0, 0, 1, h).fill(lt).rect(0, h - 1, w, 1).fill(dk).rect(w - 1, 0, 1, h).fill(dk);
    else box.rect(0, 0, w - e, 1).fill(lt).rect(0, 0, 1, h - e).fill(lt).rect(1, h - e, w - 1, e).fill(dk).rect(w - e, 1, e, h - 1).fill(dk);
  };
  drawBox();
  const hit = new Graphics().rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.001 });
  c.addChild(hit, box);
  const p = parseHotkey(label);
  const txt = makeText(p.text, { font: "font1", color: 0xffffff });
  const tx = Math.round((w - txt.width) / 2);
  const ty = opts.textY ?? 5;
  txt.position.set(tx, ty);
  c.addChild(txt);
  let under: Graphics | undefined;
  if (p.at >= 0) {
    // largura até a letra (inclusive) − largura da letra: o BitmapText não conta espaços no fim de um pedaço
    const upto = makeText(p.text.slice(0, p.at + 1), { font: "font1", shadow: false });
    const ch = makeText(p.text[p.at]!, { font: "font1", shadow: false });
    const uw = Math.max(1, Math.round(ch.width)), ux = tx + Math.round(upto.width) - uw;
    upto.destroy(); ch.destroy();
    under = new Graphics().rect(ux + 1, 21 + ty - 5, uw, 1).fill(0x000000).rect(ux, 19 + ty - 5, uw, 1).fill(0xffffff);
    c.addChild(under);
  }
  c.label = p.text; c.key = p.key; c.enabled = true;
  let focus = false, down = false;
  const paint = () => {
    const col = !c.enabled ? CLASSIC.dim : focus || down ? CLASSIC.focus : CLASSIC.text;
    txt.tint = col;
    if (under) under.tint = col;
    if (opts.pressRelief) drawBox(down && c.enabled);
  };
  c.setFocus = on => { focus = on; paint(); };
  c.setEnabled = on => { c.enabled = on; c.cursor = on ? "pointer" : "default"; paint(); };
  c.activate = () => { if (c.enabled) onClick(); };
  c.eventMode = "static"; c.cursor = "pointer";
  c.hitArea = new Rectangle(0, 0, w, h);
  c.on("pointerover", () => c.emit("focusme" as never, c as never));
  c.on("pointerout", () => c.emit("blurme" as never, c as never));
  if (opts.pressRelief) {
    c.on("pointerdown", () => { down = true; paint(); });
    c.on("pointerup", () => { down = false; paint(); });
    c.on("pointerupoutside", () => { down = false; paint(); });
  }
  c.on("pointertap", () => c.activate());
  paint();
  return c;
}

/** Lista vertical de itens com foco por mouse/teclado (setas, Enter, letras de atalho). */
export class ItemColumn {
  readonly items: Item[] = [];
  focus = -1;
  private stick = -1;
  /** blurOnOut: o foco do mouse some quando o ponteiro sai do item (Load Game: o realce só existe sob o mouse) */
  constructor(readonly view: Container, private readonly blurOnOut = false) {}
  add(it: Item): Item {
    this.items.push(it);
    this.view.addChild(it);
    it.on("focusme" as never, () => { this.stick = -1; this.setFocus(this.items.indexOf(it)); });
    if (this.blurOnOut) {
      // o item clicado continua em foco (dourado) até o mouse passar por outro (refs/original/load_game_delete_confirm: Delete)
      it.on("pointertap", () => { this.stick = this.items.indexOf(it); });
      it.on("blurme" as never, () => { const i = this.items.indexOf(it); if (this.focus === i && this.stick !== i) this.setFocus(-1); });
    }
    return it;
  }
  setFocus(i: number): void {
    this.focus = i;
    this.items.forEach((it, j) => it.setFocus(j === i));
  }
  move(d: number): void {
    const n = this.items.length;
    if (!n) return;
    let i = this.focus;
    for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (this.items[i]!.enabled) break; }
    this.setFocus(i);
  }
  /** Trata a tecla; devolve true se usou. */
  key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k === "ArrowDown" || (k === "Tab" && !e.shiftKey)) { this.move(1); return true; }
    if (k === "ArrowUp" || (k === "Tab" && e.shiftKey)) { this.move(-1); return true; }
    if ((k === "Enter" || k === " ") && this.focus >= 0) { this.items[this.focus]!.activate(); return true; }
    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const it = this.items.find(x => x.key === k.toLowerCase() && x.enabled);
      if (it) { this.setFocus(this.items.indexOf(it)); it.activate(); return true; }
    }
    return false;
  }
}

// ------------------------------------------------------------------ controles das opções

/** Caixa de seleção (radio_02/03) + rótulo. */
/** `classic`: caixa no tamanho natural (19 px) e rótulo em font1 branco 9 px à direita (Sound Options do original). */
export function checkbox(kit: MenuKit, label: string, value: boolean, onChange: (v: boolean) => void, size = 20, classic = false): Container & { set(v: boolean): void } {
  const c = new Container() as Container & { set(v: boolean): void };
  const box = kit.ok ? new Sprite(kit.radio[value ? 3 : 2]) : new Graphics();
  const bs = classic ? 19 : 30;
  if (!classic) box.width = box.height = bs;
  const t = classic ? makeText(label, { font: "font1", color: 0xffffff }) : makeText(label, { size, color: 0xffffff, stroke: 0x000000 });
  t.tint = classic ? CLASSIC.text : COL.text;
  if (classic) t.position.set(bs + 9, 3); else t.position.set(bs + 12, (bs - size * 1.05) / 2);
  c.addChild(box, t);
  let v = value;
  const paint = () => {
    if (box instanceof Sprite) box.texture = kit.radio[v ? 3 : 2]!;
    else box.clear().rect(0, 0, bs, bs).fill(0x1c0f22).stroke({ color: 0xc8a040, width: 2 }).rect(7, 7, bs - 14, bs - 14).fill(v ? 0xd080ff : 0x1c0f22);
  };
  c.set = nv => { v = nv; paint(); };
  c.eventMode = "static"; c.cursor = "pointer";
  c.on("pointertap", () => { v = !v; paint(); onChange(v); });
  c.on("pointerover", () => { t.tint = classic ? CLASSIC.focus : COL.hover; });
  c.on("pointerout", () => { t.tint = classic ? CLASSIC.text : COL.text; });
  paint();
  return c;
}

/** Grupo de botões de rádio (radio_00/01) numa linha. */
export function radioGroup<T extends string>(kit: MenuKit, options: { value: T; label: string }[], value: T, onChange: (v: T) => void, gap = 26, size = 18): Container {
  const c = new Container();
  let cur = value;
  const marks: { s: Sprite | Graphics; v: T }[] = [];
  const bs = 28;
  let x = 0;
  const paint = () => {
    for (const m of marks) {
      if (m.s instanceof Sprite) m.s.texture = kit.radio[m.v === cur ? 1 : 0]!;
      else m.s.clear().circle(bs / 2, bs / 2, bs / 2 - 2).fill(0x1c0f22).stroke({ color: 0xc8a040, width: 2 }).circle(bs / 2, bs / 2, 6).fill(m.v === cur ? 0xd080ff : 0x1c0f22);
    }
  };
  for (const o of options) {
    const row = new Container();
    const s = kit.ok ? new Sprite(kit.radio[0]) : new Graphics();
    s.width = s.height = bs;
    const t = makeText(o.label, { size, color: COL.text, stroke: 0x000000 });
    t.position.set(bs + 8, (bs - size * 1.05) / 2);
    row.addChild(s, t);
    row.position.set(x, 0);
    row.eventMode = "static"; row.cursor = "pointer";
    row.on("pointertap", () => { if (cur !== o.value) { cur = o.value; paint(); onChange(cur); } });
    c.addChild(row);
    marks.push({ s, v: o.value });
    x += bs + 8 + t.width + gap;
  }
  paint();
  return c;
}

/** Barra deslizante horizontal (trilho scr_01 + cursor scr_04). `value` em [min, max]. */
export function slider(kit: MenuKit, width: number, min: number, max: number, value: number, onChange: (v: number) => void, step = 0): Container & { set(v: number): void } {
  const c = new Container() as Container & { set(v: number): void };
  const h = 30;
  const track = kit.ok ? new TilingSprite({ texture: kit.scr[1]!, width: width / K, height: 24 }) : new Graphics().roundRect(0, 8, width, 14, 6).fill(0x3a1f48).stroke({ color: 0xc8a040, width: 2 });
  if (track instanceof TilingSprite) { track.scale.set(K * 0.8); track.width = width / (K * 0.8); track.y = (h - 24 * K * 0.8) / 2; }
  const thumb = kit.ok ? new Sprite(kit.scr[4]) : new Graphics().roundRect(0, 0, 18, h, 6).fill(0xd8a24a);
  if (thumb instanceof Sprite) { thumb.height = h + 4; thumb.width = h + 4; thumb.y = -2; }
  c.addChild(track, thumb);
  let v = value;
  const tw = () => thumb.width;
  const place = () => { thumb.x = ((v - min) / (max - min || 1)) * (width - tw()); };
  const fromX = (x: number) => {
    let nv = min + Math.max(0, Math.min(1, (x - tw() / 2) / (width - tw()))) * (max - min);
    if (step > 0) nv = Math.round(nv / step) * step;
    nv = Math.max(min, Math.min(max, nv));
    if (nv !== v) { v = nv; place(); onChange(v); }
  };
  c.set = nv => { v = Math.max(min, Math.min(max, nv)); place(); };
  c.eventMode = "static"; c.cursor = "pointer";
  c.hitArea = new Rectangle(-6, -6, width + 12, h + 12);
  let drag = false;
  c.on("pointerdown", (e: FederatedPointerEvent) => { drag = true; fromX(c.toLocal(e.global).x); });
  c.on("globalpointermove", (e: FederatedPointerEvent) => { if (drag) fromX(c.toLocal(e.global).x); });
  c.on("pointerup", () => { drag = false; });
  c.on("pointerupoutside", () => { drag = false; });
  place();
  return c;
}

// ------------------------------------------------------------------ janela modal

export interface MenuWindow {
  /** contêiner da janela inteira (escurecimento + moldura + conteúdo); filho de `parent` */
  root: Container;
  /** conteúdo em pixels de tela, origem no canto superior esquerdo da moldura */
  body: Container;
  x: number; y: number; w: number; h: number;
  /** fecha e destrói (idempotente) */
  close(): void;
  readonly closed: boolean;
  /** some/reaparece sem fechar (o menu do jogo some enquanto uma subjanela está aberta) */
  setVisible(v: boolean): void;
}

/**
 * Abre uma janela modal centrada: escurece a cena, bloqueia cliques, empilha um tratador de teclado (Esc → `onEscape`, padrão fechar).
 * Se o contêiner for destruído por fora (troca de cena, a cena destruiu o "modal"), a camada de teclado sai junto.
 */
/** `artScale`: escala da arte da moldura (padrão K = 1,6; 1 = tamanho natural, como o original em 1024×768);
 *  `offset`: deslocamento (x, y) a partir do centro da tela (o menu do jogo original fica 4 px acima/à esquerda do centro). */
/** Esc dentro de uma subjanela do menu do jogo (Save/Load/Sound...) fecha o menu inteiro e volta ao jogo, como no original
 *  (town_save_screen / town_sound_options: Esc devolve a cidade, não o menu). `sub()` de ui/gamemenu.ts arma/desarma. */
export const menuStack: { escAll: (() => void) | null } = { escAll: null };

export function openWindow(parent: Container, kit: MenuKit, opts: { w: number; h: number; title?: string; dim?: number; artScale?: number; offset?: number; onKey?: (e: KeyboardEvent) => void; onEscape?: () => void; onClose?: () => void }): MenuWindow {
  const root = new Container();
  const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: opts.dim ?? 0.55 });
  dim.eventMode = "static";
  root.addChild(dim);
  const off = opts.offset ?? 0, sc = opts.artScale ?? K;
  const x = Math.round((SCREEN_W - opts.w) / 2) + off, y = Math.round((SCREEN_H - opts.h) / 2) + off;
  const fr = frame(kit, opts.w, opts.h, false, sc);
  fr.position.set(x, y);
  fr.eventMode = "static";
  root.addChild(fr);
  if (!kit.ok) {
    // a arte ainda estava carregando: troca a moldura simples pela original quando chegar
    void loadMenuKit().then(k => {
      if (!k.ok || root.destroyed) return;
      const nf = frame(k, opts.w, opts.h, false, sc);
      nf.position.set(x, y); nf.eventMode = "static";
      root.addChildAt(nf, root.getChildIndex(fr));
      fr.destroy({ children: true });
    });
  }
  const body = new Container();
  body.position.set(x, y);
  root.addChild(body);
  if (opts.title) {
    const t = makeText(opts.title, { size: 28, color: COL.title, bold: true, stroke: 0x000000 });
    t.anchor.set(0.5, 0);
    t.position.set(opts.w / 2, 30);
    body.addChild(t);
  }
  let closed = false;
  const win: MenuWindow = {
    root, body, x, y, w: opts.w, h: opts.h,
    get closed() { return closed; },
    close: () => {
      if (closed) return;
      closed = true;
      pop();
      if (!root.destroyed) root.destroy({ children: true });
      opts.onClose?.();
    },
    setVisible: v => { root.visible = v; },
  };
  const pop = pushKeyLayer(e => {
    if (!root.visible) return;
    if (e.key === "Escape") { const all = menuStack.escAll; (opts.onEscape ?? win.close)(); all?.(); return; }
    opts.onKey?.(e);
  });
  root.on("destroyed", () => { if (!closed) { closed = true; pop(); opts.onClose?.(); } });
  parent.addChild(root);
  return win;
}

/** Linha de texto simples (atalho). */
export function label(text: string, size = 18, color: number = COL.info, opts: { wrap?: number; align?: "left" | "center" | "right"; bold?: boolean } = {}): GameText {
  return makeText(text, { size, color, stroke: 0x000000, wrap: opts.wrap, align: opts.align, bold: opts.bold });
}
