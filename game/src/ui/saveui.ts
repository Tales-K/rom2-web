/**
 * Telas "Load Game" e "Save Game" (textos de main/text/dialogs.txt: "Load Game / Select Game to load / Confirm selection / Cancel /
 * <<< Empty Slot >>> / Save Game / Enter a name for the saved game / Saved Games"), com a moldura e as barras de rolagem originais
 * (ui/menukit.ts). Slots: core/save.ts (0 = Autosave, 1..SLOT_COUNT manuais).
 *
 *   openLoadGame(game, parent)                       lista todos os slots; Confirm carrega e troca de cena (cidade ou missão)
 *   openSaveGame(game, parent, { mission })          lista os slots manuais + campo de nome; `mission()` = snapshot da missão
 *
 * Extras nossos (não existem no original): apagar (Delete), exportar/importar arquivo .json, linha de detalhes do slot.
 * Teclado: setas/PageUp/PageDown/Home/End escolhem, Enter confirma, Esc cancela; Load: Del apaga; Save: digitar edita o nome.
 */
import { Container, Graphics, Rectangle, Sprite, TilingSprite, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import type { Game } from "../core/game";
import { AUTOSAVE_SLOT, type SlotMeta } from "../core/save";
import type { MissionSave } from "../core/savedata";
import type { ResumeTarget } from "../core/state";
import { ConfirmDialog } from "./dialog";
import { CLASSIC, COL, ItemColumn, classicMenuItem, frame, label, loadMenuKit, menuItem, menuKitNow, openWindow, type MenuKit, type MenuWindow } from "./menukit";
import { ClassicList, LIST, screenHint } from "./classiclist";
import { applyThemeCursor } from "./cursor";
import { makeText, type GameText } from "./text";

/** Textos de dialogs.txt (linhas 25..35, base 1) com reserva. */
const T = {
  loadTitle: "Load Game", loadPrompt: "Select Game to load", confirm: "Confirm selection", cancel: "Cancel", empty: " <<< Empty Slot >>>",
  saveTitle: "Save Game", savePrompt: "Enter a name for the saved game", saved: "Saved Games",
  // janela Load Game do original: título (índice 151), Ok (0), Delete (157) e a dica de duas linhas (158, "#" separa)
  title: "Load Saved Game", ok: "Ok", del: "Delete", delTip: ["Delete selected", "saved game"],
};
let textsLoaded = false;
async function loadTexts(game: Game): Promise<void> {
  if (textsLoaded) return;
  const d = await game.data.tryJson<{ lines: string[] }>("data/texts/dialogs.json");
  const l = d?.lines;
  if (l && l[24] === "Load Game") {
    Object.assign(T, { loadTitle: l[24], loadPrompt: l[25], confirm: l[26], cancel: l[27], empty: l[28], saveTitle: l[29], savePrompt: l[30], saved: l[31] });
    if (l[151] && l[157] && l[158]) Object.assign(T, { title: l[151], ok: l[0], del: l[157], delTip: l[158].split("#") });
  }
  textsLoaded = true;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function describe(m: SlotMeta): string {
  if (m.damaged) return "This saved game is damaged and cannot be loaded.";
  const cls = m.heroClass === "mage" ? "Mage" : m.heroClass === "fighter" ? "Warrior" : "";
  const who = m.hero ? `${m.hero}${cls ? ` (${cls}${m.level ? `, skill ${m.level}` : ""})` : ""}` : "";
  return [who, m.place, formatDate(m.date)].filter(Boolean).join("   -   ");
}

// ------------------------------------------------------------------ ações

/** Carrega um slot e troca de cena (cidade, ou missão com `resume`). Devolve false se o slot não puder ser carregado. */
export function loadSlotAndGo(game: Game, slot: number): boolean {
  let target: ResumeTarget | null = null;
  try { target = game.state.loadFromSlot(slot); } catch (err) { console.error("[load]", err); target = null; }
  if (!target) { game.audio.playSfx("error"); return false; }
  game.audio.playSfx("click_ok");
  console.info(`[load] slot ${slot} ->`, target.scene, target.params ?? "");
  void game.go(target.scene, target.params);
  return true;
}

function downloadText(name: string, text: string): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) { console.error("[export]", err); }
}

function pickFile(): Promise<string | null> {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.style.display = "none";
    inp.onchange = () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) { resolve(null); return; }
      f.text().then(resolve, () => resolve(null));
    };
    document.body.appendChild(inp);
    inp.click();
  });
}

export interface LoadGameOpts {
  /** cursor temático enquanto a janela estiver aberta (menu principal: "default", a seta dourada do original) */
  cursor?: "default" | "select";
  /** chamado no lugar do carregamento padrão (loadSlotAndGo) */
  onLoad?: (slot: number) => void;
  onClose?: () => void;
  dim?: number;
}

/** dd.mm.aaaa  hh:mm:ss (dica da linha, como no original) */
function tipDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Tela "Load Game" como no original (refs/original/load_game_*.png): moldura 480×352 em tamanho natural (4 px acima/à esquerda do
 *  centro), título "Load Saved Game", lista de saves existentes (sem linhas "<<< Empty Slot >>>"), botões Ok/Delete/Cancel e dicas.
 *  Extras nossos sem botão: E = exportar o save escolhido, I = importar um arquivo. */
export function openLoadGame(game: Game, parent: Container, opts: LoadGameOpts = {}): MenuWindow {
  const kit0 = menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] };
  const W = 480, H = 352;
  let list!: ClassicList;
  let slots: number[] = [];
  let metas: Array<SlotMeta | null> = [];
  const cols = new ItemColumn(new Container(), true);
  const win = openWindow(parent, kit0, {
    w: W, h: H, dim: opts.dim ?? 0.28, artScale: 1, offset: -4,
    onKey: e => {
      if (!list) return;
      if (list.key(e)) return;
      if (e.key === "Enter") confirm();
      else if (e.key === "Delete") void remove();
      else if (e.key === "e" || e.key === "E") exportSel();
      else if (e.key === "i" || e.key === "I") void importSel();
      else cols.key(e);
    },
    onClose: () => { listHint.destroy(); restoreCursor?.(); opts.onClose?.(); },
  });
  const restoreCursor = opts.cursor ? applyThemeCursor(game.app, opts.cursor) : undefined;
  // dicas junto do cursor (etiqueta de ui/hint.ts em coordenadas de tela)
  const listHint = screenHint(parent);
  const refresh = () => {
    metas = game.state.saves.list();
    slots = metas.flatMap((m, i) => (m ? [i] : []));
    list.setItems(slots.map(i => { const m = metas[i]!; return (i === AUTOSAVE_SLOT ? "* " : "") + m.name + (m.damaged && !/damaged/i.test(m.name) ? " (damaged)" : ""); }),
      slots.map(i => (metas[i]!.damaged ? COL.error : undefined)));
  };
  const cur = (): { slot: number; meta: SlotMeta } | undefined => { const slot = slots[list.sel]; return slot === undefined ? undefined : { slot, meta: metas[slot]! }; };
  const confirm = () => {
    const c = cur();
    if (!c || c.meta.damaged) { game.audio.playSfx("error"); return; }
    win.close();
    if (opts.onLoad) opts.onLoad(c.slot);
    else loadSlotAndGo(game, c.slot);
  };
  const remove = async () => {
    const c = cur();
    if (!c) { game.audio.playSfx("error"); return; }
    const ok = await ConfirmDialog.ask(parent, `Are you sure you want to delete game '${c.meta.name}' ?`, { yes: "Yes", no: "No" });
    if (!ok || win.closed) return;
    game.state.saves.remove(c.slot);
    refresh();
  };
  const exportSel = () => {
    const c = cur();
    const text = c ? game.state.saves.exportSlot(c.slot) : null;
    if (!c || !text) { game.audio.playSfx("error"); return; }
    downloadText(`allods2-save-${c.slot}-${c.meta.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 30)}.json`, text);
  };
  const importSel = async () => {
    const text = await pickFile();
    if (text == null || win.closed) return;
    const free = game.state.saves.firstFreeSlot();
    const slot = free > 0 ? free : cur()?.slot ?? 1;
    if (slot === AUTOSAVE_SLOT) return;
    const r = game.state.saves.importText(text, slot);
    refresh();
    if (r.ok) { const i = slots.indexOf(slot); if (i >= 0) list.select(i, false); } else game.audio.playSfx("error");
  };

  void (async () => {
    const [, kit] = await Promise.all([loadTexts(game), loadMenuKit()]);
    if (win.closed) return;
    const b = win.body;
    const title = makeText(T.title, { font: "font1", color: CLASSIC.text });
    title.anchor.set(0.5, 0); title.position.set(244, 31);
    const prompt = makeText(T.loadTitle, { font: "font1", color: CLASSIC.focus });
    prompt.position.set(41, 67);
    b.addChild(title, prompt);
    list = new ClassicList(kit, {
      onActivate: () => confirm(), hint: listHint,
      tip: i => { const m = metas[slots[i]!]; return m ? [`${m.name}   ${tipDate(m.date)}`] : undefined; },
    });
    list.position.set(40, 92);
    b.addChild(list);
    const mk = (label: string, x: number, fn: () => void, tip: string[]) => {
      const it = cols.add(classicMenuItem(label, fn, { width: 97, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, 308);
      it.on("pointerover", (e: FederatedPointerEvent) => listHint.show(tip, e.global.x, e.global.y));
      it.on("pointermove", (e: FederatedPointerEvent) => listHint.show(tip, e.global.x, e.global.y));
      it.on("pointerout", () => listHint.hide());
      it.on("pointerdown", () => listHint.hide());   // apertado: a dica some (refs/original/load_game_press_ok)
      return it;
    };
    mk(T.ok, 73, confirm, [T.confirm]);
    mk(T.del, 195, () => void remove(), T.delTip);
    mk(T.cancel, 317, () => win.close(), [T.cancel]);
    b.addChild(cols.view);
    refresh();
  })();
  return win;
}

export interface SaveGameOpts {
  /** missão em andamento: devolve o snapshot (sim/snapshot.ts) e o título para a lista */
  mission?: () => MissionSave | undefined;
  missionTitle?: string;
  onSaved?: (slot: number) => void;
  onClose?: () => void;
  /** escurecimento do fundo (padrão 0,28; na cidade o original escurece ~22%) */
  dim?: number;
}

const NAME_MAX = 32;
/** caixa do nome na janela Save (coordenadas da janela) e meio período do cursor de texto (a medir) */
const FIELD = { x: 40, y: 67, w: 409, h: 26 };

/**
 * Tela "Save Game" como no original (refs/original/town_save_*.png, 19/10): janela 480×352 em tamanho natural (mesma moldura da Load),
 * título "Save Game", campo de nome vazio (caixa afundada 409×26), "Saved Games" dourado, lista de 7 linhas com "<<< Empty Slot >>>" na
 * 1ª e os saves existentes depois (ClassicList, como a Load), botões Ok/Delete/Cancel (97×24) e a dica "NOME  dd.mm.aaaa  hh:mm:ss".
 * Escolher uma linha copia o nome para o campo com o cursor de texto no INÍCIO (digitar insere antes: "Testplagat start"); digitar com a
 * linha vazia escolhida escreve no campo vazio. Esc fecha tudo (menu incluso: ui/menukit.ts menuStack).
 */
export function openSaveGame(game: Game, parent: Container, opts: SaveGameOpts = {}): MenuWindow {
  const kit0 = menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] };
  const W = 480, H = 352;
  let list!: ClassicList;
  let slots: number[] = [];                       // slot de cada linha (0 = nova)
  let metas: Array<SlotMeta | null> = [];
  let field!: GameText;
  let caretG!: Graphics;
  let name = "", caret = 0, caretT = 0;
  const cols = new ItemColumn(new Container(), true);
  const hero = game.state.hero;
  const place = opts.missionTitle ?? (game.state.progress.town.charAt(0).toUpperCase() + game.state.progress.town.slice(1));
  const defaultName = () => `${hero?.name ?? "Hero"} - ${place}`;
  const listHint = screenHint(parent);
  const win = openWindow(parent, kit0, {
    w: W, h: H, dim: opts.dim ?? 0.28, artScale: 1, offset: -4,
    onKey: e => {
      if (!list) return;
      if (list.key(e)) return;
      if (e.key === "Enter") { void confirm(); return; }
      if (e.key === "Backspace") { if (caret > 0) { name = name.slice(0, caret - 1) + name.slice(caret); caret--; paintField(); } return; }
      if (e.key === "Delete") { name = name.slice(0, caret) + name.slice(caret + 1); paintField(); return; }
      if (e.key === "ArrowLeft") { caret = Math.max(0, caret - 1); paintField(); return; }
      if (e.key === "ArrowRight") { caret = Math.min(name.length, caret + 1); paintField(); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const c = e.key;
        if (c >= " " && c <= "~" && name.length < NAME_MAX) { name = name.slice(0, caret) + c + name.slice(caret); caret++; paintField(); }
        return;
      }
      cols.key(e);
    },
    onClose: () => { ticker(); listHint.destroy(); opts.onClose?.(); },
  });
  // original (town_save_caret_seq, 30 quadros parados por 3 s; town_save_typed_row2): a barra do cursor só aparece com texto depois dela (digitar no meio); no fim do texto ou no início do campo não há barra e ela não pisca
  const caretShown = () => caret > 0 && caret < name.length;
  const placeCaret = () => {
    const probe = makeText(name.slice(0, caret), { font: "font1", color: CLASSIC.text });
    caretG.position.set(FIELD.x + 4 + Math.ceil(probe.width), FIELD.y + 5);
    probe.destroy();
    caretG.visible = caretShown();
  };
  const paintField = () => {
    if (!field) return;
    field.text = name;
    caretT = 0;
    placeCaret();
  };
  const tick = () => { caretT += game.app.ticker.deltaMS; };
  game.app.ticker.add(tick);
  const ticker = () => game.app.ticker.remove(tick);
  const refresh = () => {
    const all = game.state.saves.list();
    slots = [0]; metas = [null];
    for (let i = 1; i < all.length; i++) if (all[i]) { slots.push(i); metas.push(all[i]); }
    list.setItems([T.empty, ...metas.slice(1).map(m => m!.name)], [undefined, ...metas.slice(1).map(m => (m!.damaged ? COL.error : undefined))]);
  };
  const onSelect = (i: number) => {
    const m = metas[i];
    name = m && !m.damaged ? m.name : "";
    caret = 0;
    paintField();
  };
  const confirm = async () => {
    if (!hero) { game.audio.playSfx("error"); return; }
    const i = list.sel;
    const m = metas[i];
    let slot = slots[i]!;
    if (!m) { slot = game.state.saves.firstFreeSlot(); if (slot <= 0) slot = game.state.lastSlot >= 1 ? game.state.lastSlot : 1; }
    const nm = name.trim() || defaultName();
    if (m && !(await ConfirmDialog.ask(parent, `Overwrite the saved game "${m.name}"?`, { title: T.saveTitle }))) return;
    if (win.closed) return;
    let snap: MissionSave | undefined;
    try { snap = opts.mission?.(); } catch (err) { console.error("[save] snapshot da missão falhou:", err); game.audio.playSfx("error"); return; }
    const r = game.state.saveToSlot(slot, nm, snap, opts.missionTitle);
    if (!r.ok) { game.audio.playSfx("error"); refresh(); return; }
    game.audio.playSfx("click_ok");
    console.info(`[save] slot ${slot} "${r.meta.name}" (${(r.meta.bytes / 1024).toFixed(1)} KB)`);
    win.close();
    opts.onSaved?.(slot);
  };
  const remove = async () => {
    const m = metas[list.sel];
    if (!m) { game.audio.playSfx("error"); return; }
    const ok = await ConfirmDialog.ask(parent, `Are you sure you want to delete game '${m.name}' ?`, { yes: "Yes", no: "No" });
    if (!ok || win.closed) return;
    game.state.saves.remove(slots[list.sel]!);
    refresh();
    onSelect(list.sel);
  };

  void (async () => {
    const [, kit] = await Promise.all([loadTexts(game), loadMenuKit()]);
    if (win.closed) return;
    const b = win.body;
    const title = makeText(T.saveTitle, { font: "font1", color: CLASSIC.text });
    title.anchor.set(0.5, 0); title.position.set(244, 31);
    const head = makeText(T.saved, { font: "font1", color: CLASSIC.focus });
    head.position.set(40, 103);
    // campo de nome: caixa afundada (mesmo relevo das linhas da lista), texto à esquerda, cursor "|" piscando
    const fb = new Graphics().rect(0, 0, FIELD.w, FIELD.h).fill({ color: 0xffffff, alpha: 0.001 }).rect(0, 0, FIELD.w, 1).fill(LIST.dark).rect(0, 0, 1, FIELD.h).fill(LIST.dark)
      .rect(1, FIELD.h - 1, FIELD.w - 1, 1).fill(LIST.light).rect(FIELD.w - 1, 1, 1, FIELD.h - 1).fill(LIST.light);
    fb.position.set(FIELD.x, FIELD.y);
    field = makeText("", { font: "font1", color: CLASSIC.text });
    field.position.set(FIELD.x + 4, FIELD.y - 1);
    caretG = new Graphics().rect(0, 0, 1, 15).fill(CLASSIC.text).rect(1, 0, 1, 15).fill(0x8a8a8a);
    b.addChild(title, head, fb, field, caretG);
    list = new ClassicList(kit, {
      rows: 7, hint: listHint, onSelect, onActivate: () => void confirm(),
      tip: i => { const m = metas[i]; return m ? [`${m.name}   ${tipDate(m.date)}`] : undefined; },
    });
    list.position.set(40, 128);
    b.addChild(list);
    const mk = (label: string, x: number, fn: () => void, tip: string[]) => {
      const it = cols.add(classicMenuItem(label, fn, { width: 97, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, 287);
      it.on("pointerover", (e: FederatedPointerEvent) => listHint.show(tip, e.global.x, e.global.y));
      it.on("pointermove", (e: FederatedPointerEvent) => listHint.show(tip, e.global.x, e.global.y));
      it.on("pointerout", () => listHint.hide());
      it.on("pointerdown", () => listHint.hide());
      return it;
    };
    mk(T.ok, 73, () => void confirm(), [T.confirm]);
    mk(T.del, 195, () => void remove(), T.delTip);
    mk(T.cancel, 317, () => win.close(), [T.cancel]);
    b.addChild(cols.view);
    refresh();
    list.select(0, false);
    paintField();
  })();
  return win;
}
