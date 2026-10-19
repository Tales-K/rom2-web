import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import type { Game } from "../core/game";
import { applyThemeCursor } from "./cursor";
import { ConfirmDialog } from "./dialog";
import { frame640, type Frame640 } from "./frame640";
import { drawHeroSheet, sheetHintIndex, type HeroSheet } from "./herosheet";
import { Hint } from "./hint";
import { pushKeyLayer } from "./modal";
import { loadFonts, makeText, type GameText } from "./text";
import { loadTexOr } from "../town/common";

/**
 * Tela "New Character" do Multiplayer do menu principal ("loader" do original; refs/original/menu_multiplayer.png e mp_*, 19/10):
 * lista de personagens na coluna de pedra (uma linha por personagem "Nome|Clã" + a linha "New Character"; a escolhida ganha uma barra
 * escura de 206×20 e o texto vai a 0xffff73 sob o mouse e depois de clicada), painel de madeira com Gold / Monsters Killed / Players
 * Killed / Died do personagem escolhido, ficha completa no painel verde e a boneca na moldura oval ("No units selected" quando a escolhida
 * é "New Character"), placas Accept / Delete / Rename / Cancel. Imagens: tools/pipeline/menu.py (graphics/interface/chrgen/loader,
 * chrgen/buttonsarea, fullstatsl, humanbackr), tudo em escala 1 no quadro 640×480 (ui/frame640.ts).
 *
 * Comportamento do original (sem rede; refs/original/mp_*): Esc não faz nada; só soltar o botão sobre a placa age (soltar fora cancela);
 * Cancel volta ao menu; Accept em "New Character" abre a criação (Name/Clan, ChargenScene `multi`); Delete pede confirmação ("Are you sure
 * you want to delete character 'Nome|Clã' ?" Yes/No); Rename edita SÓ o clã no lugar da linha (campo afundado, cursor no início,
 * Enter confirma, Esc cancela); Delete/Rename sem personagem escolhido não fazem nada; passar o mouse na placa só acende o rótulo
 * (0xffff73) e apertada a placa desce 1 px; sobre a ficha aparecem as dicas de cada linha (main.txt 155..170; sem peso/XP).
 * Accept com um personagem escolhido entra no jogo em rede: o original pede o DirectPlay do Windows (não instalado na máquina de
 * captura, o jogo trava); aqui mostramos um aviso (decisão em docs/GAPS.md).
 */
const DIR = "assets/ui/chargen/";
const GOLD = 0xbd9e4a, HOVER = 0xffff73;
/** retângulos das placas no painel de botões (x 8..138; 48 px de passo) e centro do rótulo (medido nas capturas) */
const PLATE_X = 8, PLATE_W = 130, PLATE_H = 38, PLATE_Y = [22, 70, 118, 166];
const LABEL_LINE = [238, 240, 241, 78];        // Accept, Delete, Rename, Cancel (main.txt, base 0)
/** barra/linhas da lista: barra 206×20 em (216, 68 + 16 i) */
const ROW_X = 216, ROW_W = 206, ROW_Y = 68, ROW_PITCH = 16, ROW_H = 20, MAX_ROWS = 4;
export const MP_STORE = "allods2web.mpchars";

export interface MpChar {
  name: string; clan: string; cls: string;
  gold: number; monsters: number; players: number; died: number;
  /** ficha pronta (painel verde) e parâmetros da boneca (retrato) */
  sheet?: HeroSheet;
  doll?: { female: boolean; mage: boolean; face: number; items: number[] };
}

export function loadMpChars(): MpChar[] {
  try {
    const a = JSON.parse(localStorage.getItem(MP_STORE) ?? "[]");
    return Array.isArray(a) ? a.filter(c => c && typeof c.name === "string").slice(0, MAX_ROWS - 1) : [];
  } catch { return []; }
}
export function saveMpChars(list: MpChar[]): void {
  try { localStorage.setItem(MP_STORE, JSON.stringify(list.slice(0, MAX_ROWS - 1))); } catch { /* sem armazenamento */ }
}

export interface MultiCharOpts {
  /** Cancel: volta ao menu */
  onClose: () => void;
  /** Accept em "New Character": abre a criação (Name/Clan) */
  onNew: () => void;
}

export interface MultiChar { close(): void; readonly closed: boolean; readonly root: Container }

/** Abre a tela por cima de `parent` (a cena do menu). Devolve o controle; fechar remove tudo e restaura o cursor. */
export function openMultiCharacter(game: Game, parent: Container, opts: MultiCharOpts): MultiChar {
  const root = new Container();
  const f: Frame640 = frame640(root);
  parent.addChild(root);
  let closed = false;
  let keyHandler: ((e: KeyboardEvent) => void) | undefined;
  const restoreCursor = applyThemeCursor(game.app, "select");
  const popKeys = pushKeyLayer(e => keyHandler?.(e));   // Esc e as demais teclas não fazem nada fora da edição do clã
  const ctl: MultiChar = {
    get closed() { return closed; }, root,
    close() {
      if (closed) return;
      closed = true; popKeys(); restoreCursor();
      if (!root.destroyed) root.destroy({ children: true });
    },
  };

  void (async () => {
    await loadFonts();
    const [mainJson, tList, tCenter, tBtn, tStats, tPortrait] = await Promise.all([
      game.data.tryJson<{ lines: string[] }>("data/texts/main.json"),
      loadTexOr(game, DIR + "ld_list.webp"), loadTexOr(game, DIR + "ld_center.webp"), loadTexOr(game, DIR + "ld_buttons.webp"),
      loadTexOr(game, DIR + "pb_stats.webp"), loadTexOr(game, DIR + "pb_portrait.webp"),
    ]);
    if (closed) return;
    const line = (n: number, fallback: string): string => (mainJson?.lines?.[n] ?? "") || fallback;
    const at = (t: Texture, x: number, y: number): Sprite => { const s = new Sprite(t); s.position.set(x, y); return s; };

    f.addChild(at(tList, 0, 0), at(tCenter, 160, 0), at(tBtn, 480, 0), at(tStats, 0, 238), at(tPortrait, 480, 238));
    const dyn = new Container();      // lista, madeira, ficha, boneca: refeitos a cada mudança
    const portrait = new Container(); portrait.position.set(480, 240);
    const sheet = new Container();
    f.addChild(dyn, sheet, portrait);

    // ------------------------------------------------------------------ estado
    let chars = loadMpChars();
    let sel = 0;                 // índice da linha escolhida (chars.length = "New Character")
    let focus = -1;              // linha clicada por último (texto amarelo)
    let hoverRow = -1;
    let edit: { text: string; caret: number } | undefined;
    const newRow = (): number => chars.length;
    const label = (c: MpChar): string => `${c.name}|${c.clan}`;
    let portraitKey = "";

    const drawDynamic = () => {
      dyn.removeChildren().forEach(c => c.destroy());
      // linhas da lista (a barra escura da escolhida vem antes do texto)
      const rows = [...chars.map(label), line(120, "New Character")];
      rows.forEach((txt, i) => {
        const y = ROW_Y + ROW_PITCH * i;
        const isSel = sel === i;
        if (isSel) {
          const bar = new Graphics().rect(ROW_X, y, ROW_W, ROW_H).fill({ color: 0x000000, alpha: 0.5 });
          if (edit && isSel) bar.rect(ROW_X, y, ROW_W, 1).fill(0x080808).rect(ROW_X, y, 1, ROW_H).fill(0x080808).rect(ROW_X, y + ROW_H, ROW_W + 1, 1).fill(0x5a7163).rect(ROW_X + ROW_W, y, 1, ROW_H).fill(0x5a7163);
          bar.eventMode = "none"; dyn.addChild(bar);
        }
        if (edit && isSel) {
          const t = makeText(edit.text, { font: "font4", color: GOLD, bold: true });
          t.position.set(ROW_X + 6, y + 2);
          const w = edit.caret > 0 ? makeText(edit.text.slice(0, edit.caret), { font: "font4", color: GOLD, bold: true }).width : 0;
          const caret = new Graphics().rect(ROW_X + 4 + Math.round(w), y + 4, 2, 13).fill(0xffffff);
          dyn.addChild(t, caret);
          return;
        }
        const t = makeText(txt, { font: "font4", color: hoverRow === i || focus === i ? HOVER : GOLD, bold: true });
        t.anchor.set(0.5, 0); t.position.set(ROW_X + ROW_W / 2 + 1, y + 2);
        dyn.addChild(t);
      });

      const c = chars[sel];
      // madeira: Gold / Monsters Killed / Players Killed / Died (rótulos em font2, valores em font4)
      if (c) {
        const items: Array<[string, number]> = [[line(89, "gold"), c.gold], [line(244, "Monsters Killed"), c.monsters], [line(245, "Players Killed"), c.players], [line(246, "Died"), c.died]];
        const ys = [54, 88, 121, 156];
        items.forEach(([lbl, val], i) => {
          const a = makeText(lbl.toUpperCase(), { font: "font2", color: GOLD });
          a.anchor.set(0.5, 0.5); a.position.set(88, ys[i]);
          const b = makeText(String(val), { font: "font4", color: GOLD });
          b.anchor.set(0.5, 0.5); b.position.set(88, ys[i] + 14);
          dyn.addChild(a, b);
        });
      } else {
        for (const [i, fb] of [[47, "No units"], [48, "selected"]] as const) {
          const t = makeText(line(i, fb).toUpperCase(), { font: "font2", color: GOLD });
          t.anchor.set(0.5, 0); t.position.set(551, 292 + 12 * (i - 47));
          dyn.addChild(t);
        }
      }
      if (c?.sheet) drawHeroSheet(sheet, c.sheet, 0, 238); else sheet.removeChildren().forEach(o => o.destroy());
      void drawPortrait(c);
    };

    const drawPortrait = async (c: MpChar | undefined) => {
      const key = c ? `${c.cls}:${c.name}` : "";
      if (key === portraitKey) return;
      portraitKey = key;
      portrait.removeChildren().forEach(o => o.destroy({ children: true }));
      if (!c?.doll) return;
      try {
        const { buildDoll } = await import("../mission/hud");
        const doll = await buildDoll(game, { ...c.doll, hero: true });
        if (closed || portraitKey !== key || portrait.destroyed) { doll?.destroy({ children: true }); return; }
        if (doll) portrait.addChild(doll);
      } catch (err) { console.warn("[multiplayer] retrato indisponível:", (err as Error)?.message ?? err); }
    };

    // barra do título fica por trás do texto da 1ª linha (a barra segue a escolhida); aqui só a ordem de desenho
    drawDynamic();

    // ------------------------------------------------------------------ placas
    const labels: GameText[] = [];
    const lifts: Sprite[] = [];
    PLATE_Y.forEach((py, i) => {
      // pressionada: o conteúdo da placa desce 1 px (cópia do retângulo da placa; o resto fica como está)
      const tex = new Texture({ source: tBtn.source, frame: new Rectangle(PLATE_X, py + 1, PLATE_W, PLATE_H) });
      const s = new Sprite(tex); s.position.set(480 + PLATE_X, py + 2); s.visible = false;
      f.addChild(s); lifts.push(s);
      const t = makeText(line(LABEL_LINE[i], ["Accept", "Delete", "Rename", "Cancel"][i]), { font: "font4", color: GOLD, bold: true });
      t.anchor.set(0.5, 0); t.position.set(480 + 74, py + 9);
      labels.push(t);
      f.addChild(t);
    });
    const tip = new Hint(f);

    let hover = -1, down = -1;
    const refresh = () => {
      labels.forEach((t, i) => { (t.style as { fill: number }).fill = hover === i || down === i ? HOVER : GOLD; });
      lifts.forEach((s, i) => { s.visible = down === i && hover === i; });
    };
    const plateAt = (x: number, y: number): number => {
      for (let i = 0; i < 4; i++) if (x >= 480 + PLATE_X && x < 480 + PLATE_X + PLATE_W && y >= PLATE_Y[i] && y < PLATE_Y[i] + PLATE_H + 1) return i;
      return -1;
    };
    const rowAt = (x: number, y: number): number => {
      if (x < ROW_X || x >= ROW_X + ROW_W) return -1;
      for (let i = 0; i <= chars.length; i++) if (y >= ROW_Y + 2 + ROW_PITCH * i && y < ROW_Y + 2 + ROW_PITCH * (i + 1)) return i;
      return -1;
    };
    const busy = () => ConfirmDialog.active || closed;

    const act = async (i: number) => {
      game.audio.playSfx("click_ok");
      const c = chars[sel];
      if (i === 3) { ctl.close(); opts.onClose(); return; }
      if (i === 0) {
        if (!c) { ctl.close(); opts.onNew(); return; }
        // entrar em partida em rede: o original pede o DirectPlay do Windows; sem rede aqui
        void ConfirmDialog.ask(root, "Network games are not available in this version.", { yes: line(75, "Yes"), no: line(76, "No") });
        return;
      }
      if (!c || edit) return;                      // Delete / Rename sem personagem escolhido: nada (original)
      if (i === 1) {
        const ok = await ConfirmDialog.ask(root, `Are you sure you want to delete character '${label(c)}' ?`, { yes: line(75, "Yes"), no: line(76, "No") });
        if (!ok || closed) return;
        chars.splice(sel, 1); saveMpChars(chars);
        sel = 0; focus = -1; portraitKey = "x"; drawDynamic();
      } else if (i === 2) {
        edit = { text: c.clan, caret: 0 };         // edita só o clã, cursor no início
        drawDynamic();
      }
    };

    const commit = (ok: boolean) => {
      if (!edit) return;
      const c = chars[sel];
      if (ok && c) { c.clan = edit.text; if (c.sheet) c.sheet = { ...c.sheet, name2: edit.text }; saveMpChars(chars); }
      edit = undefined; drawDynamic();
    };
    keyHandler = e => {
      if (!edit || ConfirmDialog.active) return;
      const k = e.key;
      if (k === "Enter") commit(true);
      else if (k === "Escape") commit(false);
      else if (k === "Backspace") { if (edit.caret > 0) { edit.text = edit.text.slice(0, edit.caret - 1) + edit.text.slice(edit.caret); edit.caret--; drawDynamic(); } }
      else if (k === "Delete") { edit.text = edit.text.slice(0, edit.caret) + edit.text.slice(edit.caret + 1); drawDynamic(); }
      else if (k === "ArrowLeft") { edit.caret = Math.max(0, edit.caret - 1); drawDynamic(); }
      else if (k === "ArrowRight") { edit.caret = Math.min(edit.text.length, edit.caret + 1); drawDynamic(); }
      else if (k === "Home") { edit.caret = 0; drawDynamic(); }
      else if (k === "End") { edit.caret = edit.text.length; drawDynamic(); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /[\p{L}\p{N} '\-.]/u.test(k) && edit.text.length < 16) {
        edit.text = edit.text.slice(0, edit.caret) + k + edit.text.slice(edit.caret); edit.caret++; drawDynamic();
      }
    };

    // ------------------------------------------------------------------ ponteiro
    f.on("pointermove", (e: FederatedPointerEvent) => {
      if (busy()) return;
      const p = f.local(e);
      const h = plateAt(p.x, p.y);
      if (h !== hover) { hover = h; refresh(); }
      const r = rowAt(p.x, p.y);
      if (r !== hoverRow) { hoverRow = r; if (!edit) drawDynamic(); }
      // dicas da ficha (mesmas linhas da missão; sem peso/XP) ou, sem personagem, a da resistência sobre o painel verde
      const c = chars[sel];
      if (p.x >= 0 && p.x < 160 && p.y >= 238 && p.y < 480) {
        const idx = c?.sheet ? sheetHintIndex(p.x - 13, p.y - 282, !!c.doll?.mage, false) : 188;
        const text = idx === undefined ? "" : line(idx, "");
        if (text) { tip.show(text.replace(/~~/g, "~").split("#").filter(Boolean), p.x + 1, p.y, true); return; }
      }
      tip.hide();
    });
    f.on("pointerleave", () => { hover = -1; hoverRow = -1; tip.hide(); refresh(); if (!edit) drawDynamic(); });
    f.on("pointerdown", (e: FederatedPointerEvent) => {
      if (busy() || e.button !== 0) return;
      const p = f.local(e);
      down = plateAt(p.x, p.y); refresh();
      const r = rowAt(p.x, p.y);
      if (r >= 0 && !edit) { sel = r; focus = r; drawDynamic(); }
    });
    const release = (e: FederatedPointerEvent, inside: boolean) => {
      if (busy()) return;
      const was = down; down = -1;
      const p = f.local(e);
      refresh();
      if (inside && was >= 0 && plateAt(p.x, p.y) === was) void act(was);
    };
    f.on("pointerup", e => release(e, true));
    f.on("pointerupoutside", e => release(e, false));
  })();

  return ctl;
}
