import { Container, Graphics } from "pixi.js";
import { frame, loadMenuKit, menuKitNow } from "./menukit";
import { pushKeyLayer } from "./modal";
import { makeText } from "./text";
import { bevelButton } from "./bevelbtn";

/**
 * Janela de entrada numérica do original ("How much gold do you want to drop?"): moldura dos menus (conjunto grande de caveiras, 288×160),
 * duas linhas de texto em font1 centradas, campo afundado com o valor em font1 e botões "Ok"/"Cancel" chanfrados (70×20).
 * Medido em refs/original/m10_drop_money*.png (19/10): janela em (100,568) do cliente 1024×768, campo (31,65) 237×21, botões em (68,118)
 * e (158,118); o campo é um editor de texto que abre com "0" e o cursor ANTES dele (digitar 250 dá "2500"). Dígitos, Backspace/Delete,
 * setas, Enter = Ok, Esc = Cancel. Resolve a quantia ou null.
 */
export const NUM_W = 288, NUM_H = 160;

export function askNumber(parent: Container, opts: { x: number; y: number; lines: string[]; max: number; ok?: string; cancel?: string }): Promise<number | null> {
  return new Promise(resolve => {
    const root = new Container();
    root.position.set(opts.x, opts.y);
    // bloqueia cliques nos itens por baixo (a janela é modal)
    const shield = new Graphics().rect(-opts.x, -opts.y, 1024, 768).fill({ color: 0x000000, alpha: 0.001 });
    shield.eventMode = "static";
    root.addChild(shield);
    const fr = new Container();
    const build = () => { fr.removeChildren().forEach(c => c.destroy({ children: true })); fr.addChild(frame(menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, NUM_W, NUM_H, false, 1)); };
    build();
    if (!menuKitNow()?.ok) void loadMenuKit().then(k => { if (k.ok && !root.destroyed) build(); });
    root.addChild(fr);

    opts.lines.forEach((s, i) => {
      const t = makeText(s, { font: "font1", color: 0xffffff, shadow: true });
      t.anchor.set(0.5, 0);
      t.position.set(148, 19 + 20 * i);
      root.addChild(t);
    });
    // campo afundado: filete escuro em cima/à esquerda, claro embaixo/à direita
    const fx = 31, fy = 65, fw = 237, fh = 21;
    root.addChild(new Graphics().rect(fx, fy, fw, fh).fill({ color: 0x000000, alpha: 0.001 })
      .rect(fx, fy, fw, 1).fill(0x080808).rect(fx, fy, 1, fh).fill(0x080808)
      .rect(fx, fy + fh - 1, fw, 1).fill(0x5a7163).rect(fx + fw - 1, fy, 1, fh).fill(0x5a7163));
    let value = "0", caret = 0;
    const field = makeText(value, { font: "font1", color: 0xffffff, shadow: true });
    field.position.set(fx + 3, fy + 1);
    const bar = new Graphics();
    root.addChild(field, bar);
    const paint = () => {
      field.text = value;
      const before = makeText(value.slice(0, caret), { font: "font1", color: 0xffffff });
      const w = caret ? Math.ceil(before.width) : 0;
      before.destroy();
      bar.clear().rect(fx + 3 + w, fy + 3, 2, 14).fill(0xffffff);
    };
    paint();
    // cursor piscando (~0,55 s ligado / 0,55 s desligado, como o da criação de personagem)
    const blink = window.setInterval(() => { bar.visible = !bar.visible; }, 550);

    let done = false;
    const pop = pushKeyLayer(e => {
      bar.visible = true;
      if (e.key === "Escape") finish(null);
      else if (e.key === "Enter") finish(Math.min(opts.max, Number(value) || 0));
      else if (/^[0-9]$/.test(e.key)) {
        const nv = value.slice(0, caret) + e.key + value.slice(caret);
        if (nv.length <= 9) { value = nv; caret++; }
        paint();
      } else if (e.key === "Backspace") { if (caret) { value = value.slice(0, caret - 1) + value.slice(caret); caret--; paint(); } }
      else if (e.key === "Delete") { value = value.slice(0, caret) + value.slice(caret + 1); paint(); }
      else if (e.key === "ArrowLeft") { caret = Math.max(0, caret - 1); paint(); }
      else if (e.key === "ArrowRight") { caret = Math.min(value.length, caret + 1); paint(); }
      else if (e.key === "Home") { caret = 0; paint(); }
      else if (e.key === "End") { caret = value.length; paint(); }
    });
    function finish(v: number | null): void {
      if (done) return;
      done = true;
      pop();
      window.clearInterval(blink);
      if (!root.destroyed) root.destroy({ children: true });
      resolve(v);
    }
    const ok = bevelButton(opts.ok ?? "Ok", 70, 20, () => finish(Math.min(opts.max, Number(value) || 0)), { font: "font1" });
    ok.position.set(68, 118);
    const no = bevelButton(opts.cancel ?? "Cancel", 70, 20, () => finish(null), { font: "font1" });
    no.position.set(158, 118);
    root.addChild(ok, no);
    root.on("destroyed", () => { if (!done) { done = true; pop(); window.clearInterval(blink); resolve(null); } });
    parent.addChild(root);
  });
}
