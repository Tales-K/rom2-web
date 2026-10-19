import { Container, Graphics, type Container as PContainer } from "pixi.js";
import { CLASSIC, ItemColumn, classicMenuItem, loadMenuKit, menuKitNow, openWindow, type MenuWindow } from "./menukit";
import { LIST } from "./classiclist";
import { makeText } from "./text";

/**
 * Diálogo do botão "Server" do menu principal (refs/original/menu_server_dialog.png, 19/10): "Retrieving server list from web page", "Enter URL:",
 * campo com a URL do servidor de listas e botões Ok / Cancel. Nesta versão não há multijogador: Ok e Cancel só fecham a janela.
 */
export function openServerDialog(parent: PContainer, opts: { onClose?: () => void } = {}): MenuWindow {
  const W = 576, H = 224;
  const cols = new ItemColumn(new Container(), true);
  const win = openWindow(parent, menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, { w: W, h: H, dim: 0.28, artScale: 1, offset: -4, onKey: e => cols.key(e), onClose: opts.onClose });
  void loadMenuKit().then(() => {
    if (win.closed) return;
    const b = win.body;
    const t = makeText("Retrieving server list from web page", { font: "font1", color: CLASSIC.text });
    t.anchor.set(0.5, 0); t.position.set(W / 2 + 4, 31);
    const p = makeText("Enter URL:", { font: "font1", color: CLASSIC.focus });
    p.position.set(41, 60);
    const fw = 503, fh = 23;
    const f = new Graphics().rect(0, 0, fw, fh).fill({ color: 0xffffff, alpha: 0.001 }).rect(0, 0, fw, 1).fill(LIST.dark).rect(0, 0, 1, fh).fill(LIST.dark)
      .rect(1, fh - 1, fw - 1, 1).fill(LIST.light).rect(fw - 1, 1, 1, fh - 1).fill(LIST.light);
    f.position.set(41, 84);
    const url = makeText("http://www.rageofimages.com/r2servers/text.asp", { font: "font1", color: CLASSIC.text });
    url.position.set(45, 83);
    b.addChild(t, p, f, url);
    const mk = (label: string, x: number, w: number) => {
      const it = cols.add(classicMenuItem(label, () => win.close(), { width: w, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, 204);
    };
    mk("Ok", 83, 166);
    mk("Cancel", 332, 167);
    b.addChild(cols.view);
  });
  return win;
}
