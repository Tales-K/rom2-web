import { Container, Graphics } from "pixi.js";
import { frame, loadMenuKit, menuKitNow, type MenuKit } from "./menukit";
import { pushKeyLayer } from "./modal";
import { makeText } from "./text";
import { bevelButton } from "./bevelbtn";

/**
 * Janela de dica do original ("Show tips next time" + CLOSE), aberta sobre a cidade/taverna/loja em 640×480 (ui/frame640.ts).
 * Texto em font2 dourada (0xbd9e4a) justificado, passo de linha 12 px, dentro da moldura dos menus (ui/menukit.ts).
 * Medido em refs/original/{town,inn,shop}_tip.png: 308×192; cidade em x=326,y=0; taverna em x=158,y=0; loja em (352-192... ver cena).
 * A caixa "Show tips next time" fica salva (localStorage) e vale para as 3 telas; desligada, a janela não abre mais.
 */
const KEY = "allods2web.showTips";
const GOLD = 0xbd9e4a;

export function tipsEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function setTipsEnabled(v: boolean): void {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* sem armazenamento */ }
}

export interface TipWindow { root: Container; close(): void; readonly closed: boolean }

/** Texto justificado (`ragged` = alinhado à esquerda com espaço fixo `space`, as janelas de dica do Multiplayer) em font2 (maiúsculas), colunas de `width` px, `pitch` px entre linhas. `space` = espaço mínimo (decide as quebras);
 *  a última linha usa `lastSpace` (janela de mensagem: mínimo 11, última linha com 9 — m20_dialog_1 x town_click_gate_guard). */
export function justified(text: string, width: number, color = GOLD, pitch = 12, font: "font1" | "font2" | "font4" = "font2", upper = true, space = 8, indent = 0, lastSpace = space, ragged = false, wrapFull = false): Container {
  const c = new Container();
  const words = (upper ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);
  const mk = (s: string) => makeText(s, { font, color, shadow: true });
  const lines: { w: string[]; ww: number[] }[] = [];
  let cur: string[] = [], curW: number[] = [], len = 0;
  for (const w of words) {
    const ww = mk(w).width;
    const avail = lines.length || wrapFull ? width : width - indent;   // wrapFull: as quebras ignoram o recuo (janelas de dica do Multiplayer; o recuo só desloca/estica a 1ª linha)
    if (cur.length && len + space + ww > avail) { lines.push({ w: cur, ww: curW }); cur = []; curW = []; len = 0; }
    len += (cur.length ? space : 0) + ww;
    cur.push(w); curW.push(ww);
  }
  if (cur.length) lines.push({ w: cur, ww: curW });
  lines.forEach((ln, i) => {
    const last = i === lines.length - 1;
    const natural = ln.ww.reduce((a, b) => a + b, 0);
    const off = i === 0 ? indent : 0;
    const gap = !ragged && !last && ln.w.length > 1 ? (width - off - natural) / (ln.w.length - 1) : (ragged ? space : lastSpace);
    let x = off;
    ln.w.forEach((w, k) => {
      const t = mk(w);
      t.position.set(Math.round(x), i * pitch);
      c.addChild(t);
      x += ln.ww[k] + gap;
    });
  });
  return c;
}

/**
 * Texto em font2 CENTRADO linha a linha, com espaço entre palavras de `space` px e quebra em `width` px (descrição do local no mapa-múndi:
 * refs/original/gm_*: espaço de 7 px, passo de 10 px, largura de quebra ~316). A origem do contêiner é o centro horizontal da 1ª linha.
 */
export function centeredWords(text: string, width: number, color: number, pitch = 10, space = 7, font: "font1" | "font2" | "font4" = "font2", upper = true): Container {
  const c = new Container();
  const words = (upper ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);
  const mk = (s: string) => makeText(s, { font, color, shadow: false });
  const lines: string[][] = [];
  let cur: string[] = [], len = 0;
  for (const w of words) {
    const ww = mk(w).width;
    if (cur.length && len + space + ww > width) { lines.push(cur); cur = []; len = 0; }
    len += (cur.length ? space : 0) + ww; cur.push(w);
  }
  if (cur.length) lines.push(cur);
  lines.forEach((ln, i) => {
    const ts = ln.map(mk);
    const total = ts.reduce((a, t) => a + t.width, 0) + space * (ts.length - 1);
    let x = -Math.round(total / 2);
    ts.forEach(t => { t.position.set(x, i * pitch); c.addChild(t); x += t.width + space; });
  });
  return c;
}

/**
 * Abre a janela de dica em (x, y) do `parent` (coordenadas 640×480). Modal: bloqueia cliques na cena e o teclado (Esc/Enter fecham).
 * `onClose` roda ao fechar (qualquer forma).
 */
export function showTipWindow(parent: Container, opts: { text: string; x: number; y: number; w?: number; h?: number; textW?: number; indent?: number; small?: boolean; textPos?: [number, number]; space?: number; ragged?: boolean; wrapFull?: boolean; gem?: [number, number]; btn?: [number, number]; onClose?: () => void }): TipWindow {
  const w = opts.w ?? 308, h = opts.h ?? 192;
  const root = new Container();
  const shield = new Graphics().rect(-2000, -2000, 5000, 5000).fill({ color: 0x000000, alpha: 0.001 });
  shield.eventMode = "static";
  root.addChild(shield);
  const win = new Container();
  win.position.set(opts.x, opts.y);
  root.addChild(win);
  const fr = new Container();
  win.addChild(fr);
  const buildFrame = (kit: MenuKit | undefined) => {
    fr.removeChildren().forEach(c => c.destroy({ children: true }));
    fr.addChild(frame(kit ?? { ok: false, lm: [], scr: [], radio: [] }, w, h, opts.small !== false, 1));
  };
  buildFrame(menuKitNow());
  if (!menuKitNow()?.ok) void loadMenuKit().then(k => { if (k.ok && !root.destroyed) buildFrame(k); });

  const body = justified(opts.text, opts.textW ?? w - 46, GOLD, 12, "font2", true, opts.space ?? 8, opts.indent ?? 6, undefined, opts.ragged, opts.wrapFull);
  body.position.set(23 + (opts.textPos?.[0] ?? -3), 22 + (opts.textPos?.[1] ?? 1));
  win.addChild(body);

  // caixa "Show tips next time" + botão CLOSE (linha de baixo)
  let on = tipsEnabled();
  const gem = new Graphics();
  const drawGem = () => {
    gem.clear().rect(0, 0, 11, 11).fill(0x1a0f1c).stroke({ color: 0x8a7a50, width: 1 });
    if (on) gem.rect(2, 2, 7, 7).fill(0xa050d0).rect(2, 2, 7, 2).fill(0xd8a0f0);
  };
  drawGem();
  gem.position.set(w - 262 + (opts.gem?.[0] ?? -3), h - 31 + (opts.gem?.[1] ?? 2));
  gem.eventMode = "static"; gem.cursor = "pointer";
  gem.on("pointertap", () => { on = !on; setTipsEnabled(on); drawGem(); });
  const lbl = makeText("SHOW TIPS NEXT TIME", { font: "font2", color: GOLD, shadow: true });
  lbl.position.set(w - 246 + (opts.gem?.[0] ?? -3), h - 31 + (opts.gem?.[1] ?? 2));
  lbl.eventMode = "static"; lbl.cursor = "pointer";
  lbl.on("pointertap", () => { on = !on; setTipsEnabled(on); drawGem(); });
  win.addChild(gem, lbl);

  let closed = false;
  const btn = bevelButton("CLOSE", 80, 18, () => close());
  btn.position.set(w - 108 + (opts.btn?.[0] ?? -8), h - 33 + (opts.btn?.[1] ?? 1));
  win.addChild(btn);

  const pop = pushKeyLayer(e => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") close(); });
  function close(): void {
    if (closed) return;
    closed = true;
    pop();
    if (!root.destroyed) root.destroy({ children: true });
    opts.onClose?.();
  }
  root.on("destroyed", () => { if (!closed) { closed = true; pop(); opts.onClose?.(); } });
  parent.addChild(root);
  return { root, close, get closed() { return closed; } };
}
