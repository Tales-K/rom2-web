import type { Container } from "pixi.js";
import type { Game } from "../core/game";
import { CLASSIC, ItemColumn, classicMenuItem, loadMenuKit, menuKitNow, openWindow, type MenuWindow } from "./menukit";
import { ClassicList } from "./classiclist";
import { makeText } from "./text";
import { unlockedCutscenes } from "./cutsceneGallery";
export { markCutscene, unlockedCutscenes } from "./cutsceneGallery";
import { Container as C } from "pixi.js";

/**
 * Janela "View Cutscenes" do menu principal (refs/original/menu_cutscenes.png, 19/10): moldura 384×352, título, lista de 9 linhas (largura 285; só
 * "Intro" no original sem campanha vista), botões Ok / Cancel (111×24). Ok toca a cena escolhida; Cancel/Esc fecham.
 */
export function openCutscenes(game: Game, parent: Container, opts: { onPlay: (id: string) => void; onClose?: () => void; dim?: number }): MenuWindow {
  const W = 384, H = 352;
  const items = unlockedCutscenes(game);
  const cols = new ItemColumn(new C(), true);
  let list!: ClassicList;
  const win = openWindow(parent, menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, {
    w: W, h: H, dim: opts.dim ?? 0.28, artScale: 1, offset: -4,
    onKey: e => { if (list?.key(e)) return; if (e.key === "Enter") play(); },
    onClose: opts.onClose,
  });
  const play = () => { const it = items[list.sel]; if (!it) return; win.close(); opts.onPlay(it.id); };
  void loadMenuKit().then(kit => {
    if (win.closed) return;
    const b = win.body;
    const title = makeText("View Cutscenes", { font: "font1", color: CLASSIC.text });
    title.anchor.set(0.5, 0); title.position.set(196, 31);
    b.addChild(title);
    list = new ClassicList(kit, { rows: 9, width: 285, onActivate: () => play() });
    list.position.set(40, 68);
    list.setItems(items.map(i => i.label));
    b.addChild(list);
    const mk = (label: string, x: number, fn: () => void) => {
      const it = cols.add(classicMenuItem(label, fn, { width: 111, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, 300);
    };
    mk("Ok", 56, play);
    mk("Cancel", 224, () => win.close());
    b.addChild(cols.view);
  });
  return win;
}
