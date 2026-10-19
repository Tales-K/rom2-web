import { Container } from "pixi.js";
import { CLASSIC, ItemColumn, classicMenuItem, menuKitNow, openWindow, type MenuKit } from "./menukit";
import { justified } from "./tipwin";
import { makeText } from "./text";

export interface ConfirmOpts { title?: string; yes?: string; no?: string; width?: number; }

/**
 * Janela de confirmação modal (Sim/Não) como no original (refs/original/load_game_delete_confirm.png): moldura 288×222 em tamanho
 * natural, 4 px acima/à esquerda do centro, escurecendo 28% do que está atrás (como a janela Load Game); texto justificado em font1 (0xd6d3d6, passo 17, 1ª linha recuada
 * 10 px) e botões Yes/No de 84×24 (ui/menukit.ts classicMenuItem). Escurece/bloqueia cliques abaixo e recebe o teclado sozinha
 * (ui/modal.ts). Enter/Y/S confirmam; Esc/N cancelam. Devolve uma Promise<boolean>; a janela some sozinha ao responder.
 * `ConfirmDialog.active` continua valendo para quem o consulta. `title` (nosso, o original não tem) vai em dourado no topo.
 */
export class ConfirmDialog {
  static active = false;
  private static current?: (v: boolean) => void;

  /** Fecha a janela aberta (resolvendo `false`); use em `exit()` da cena. */
  static dismiss(): void { ConfirmDialog.current?.(false); }

  static ask(parent: Container, text: string, opts: ConfirmOpts = {}): Promise<boolean> {
    const kit: MenuKit = menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] };
    return new Promise(resolve => {
      ConfirmDialog.active = true;
      const w = opts.width ?? 288, pitch = 17, topY = opts.title ? 78 : 54;
      const body = justified(text, w - 72, CLASSIC.text, pitch, "font1", false, 8, 10);
      const lines = Math.max(1, Math.round((body.height + 4) / pitch));
      const h = Math.max(222, topY + lines * pitch + 28 + 24 + 20);
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        ConfirmDialog.active = false;
        ConfirmDialog.current = undefined;
        win.close();
        resolve(v);
      };
      const col = new ItemColumn(new Container());
      const win = openWindow(parent, kit, {
        w, h, dim: 0.28, artScale: 1, offset: -4,
        onEscape: () => finish(false),
        onKey: e => {
          const k = e.key.toLowerCase();
          if (k === "y" || k === "s") finish(true);
          else if (k === "n") finish(false);
          else if (k === "arrowleft" || k === "arrowright") col.move(1);
          else if (k === "enter" || k === " ") (col.focus >= 0 ? col.items[col.focus]!.activate() : finish(true));
        },
        onClose: () => { if (!done) { done = true; ConfirmDialog.active = false; ConfirmDialog.current = undefined; resolve(false); } },
      });
      ConfirmDialog.current = finish;
      if (opts.title) {
        const t = makeText(opts.title, { font: "font1", color: CLASSIC.focus });
        t.anchor.set(0.5, 0); t.position.set(w / 2, 31);
        win.body.addChild(t);
      }
      body.position.set(40, topY);
      win.body.addChild(body);
      const bw = 84, by = h - 51;
      const mk = (label: string, x: number, v: boolean) => col.add(classicMenuItem(label, () => finish(v), { width: bw, height: 24, edge: 2, textY: 2, pressRelief: true })).position.set(x, by);
      mk(opts.yes ?? "Yes", 42, true);
      mk(opts.no ?? "No", w - 119, false);   // medido: Yes em x=42 e No em x=169 numa janela de 288
      win.body.addChild(col.view);
    });
  }
}
