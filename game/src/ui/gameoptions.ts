import { Container } from "pixi.js";
import type { Game } from "../core/game";
import type { Settings } from "../core/state";
import { CLASSIC, ItemColumn, checkbox, classicMenuItem, loadMenuKit, menuKitNow, openWindow, type MenuWindow } from "./menukit";
import { ClassicSlider } from "./classicslider";
import { classicRadio } from "./classicradio";
import { setTipsEnabled, tipsEnabled } from "./tipwin";
import { makeText } from "./text";

/** curso do controle de velocidade: 1,5 (padrão) no meio, como na captura do original */
const SPEEDS = { min: 0.25, max: 2.75 };

/**
 * "Game Options" como no original (refs/original/mission_game_options.png, 19/10): janela 576×416, "Game Speed" (controle de volume horizontal),
 * coluna esquerda Day/Night changes / Smoothing / Shadows / Dynamic lighting / Object animations, coluna direita Show Health / Display damage
 * points / Tips / Alt. message colors e "AutoCast for units:" (Own / Allies / Neutral), três grupos de opção (Formation Mode, Retreat Mode,
 * AutoCast mode) e Ok / Cancel (Cancel e Esc desfazem as mudanças). Só velocidade, suavização, dia/noite, vida, formação e recuo têm efeito;
 * os demais campos são gravados em game.state.settings (ui/../core/state.ts).
 */
export function openGameOptions(game: Game, parent: Container, opts: { onChange?: (s: Settings) => void; onClose?: () => void } = {}): MenuWindow {
  const W = 576, H = 416;
  const st = game.state;
  const before = { ...st.settings }, tipsBefore = tipsEnabled();
  const cols = new ItemColumn(new Container(), true);
  let done = false;
  const win = openWindow(parent, menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, {
    w: W, h: H, dim: 0, artScale: 1, offset: -4, onKey: e => { if (e.key === "Enter") ok(); else cols.key(e); },
    onEscape: () => cancel(),
    onClose: () => { if (!done) { Object.assign(st.settings, before); setTipsEnabled(tipsBefore); } opts.onClose?.(); },
  });
  const changed = () => { st.saveSettings(); opts.onChange?.(st.settings); };
  const ok = () => { done = true; changed(); win.close(); };
  const cancel = () => { Object.assign(st.settings, before); setTipsEnabled(tipsBefore); changed(); done = true; win.close(); };
  void loadMenuKit().then(kit => {
    if (win.closed) return;
    const b = win.body;
    const T = (text: string, x: number, y: number, center = false) => {
      const t = makeText(text, { font: "font1", color: CLASSIC.text });
      if (center) t.anchor.set(0.5, 0);
      t.position.set(x, y);
      b.addChild(t);
      return t;
    };
    T("Game Options", 292, 19, true);
    T("Game Speed", 136, 55, true);
    const sl = new ClassicSlider(kit, 192, (st.settings.gameSpeed - SPEEDS.min) / (SPEEDS.max - SPEEDS.min), v => { st.settings.gameSpeed = Math.round((SPEEDS.min + v * (SPEEDS.max - SPEEDS.min)) * 20) / 20; changed(); });
    sl.position.set(40, 84);
    b.addChild(sl);
    const S = st.settings as unknown as Record<string, unknown>;
    const first: { label: ReturnType<typeof makeText> }[] = [];
    const cb = (text: string, key: string, x: number, cy: number, get?: () => boolean, set?: (v: boolean) => void) => {
      const c = checkbox(kit, text, get ? get() : S[key] !== false, v => { if (set) set(v); else S[key] = v; changed(); }, 14, true);
      c.position.set(x - 1, cy - 12);
      b.addChild(c);
      return c;
    };
    // coluna esquerda e direita (centros em y da janela = y de tela − 172)
    [["Day/Night changes", "dayNight"], ["Smoothing", "smoothing"], ["Shadows", "shadows"], ["Dynamic lighting", "dynamicLighting"], ["Object animations", "objectAnimations"]]
      .forEach(([t, k], i) => cb(t!, k!, 43, 133 + 28 * i));
    cb("Show Health", "showHealth", 283, 54);
    cb("Display damage points", "damagePoints", 283, 82);
    cb("Tips", "tips", 283, 110, () => tipsEnabled(), v => setTipsEnabled(v));
    cb("Alt. message colors", "altColors", 283, 138);
    T("AutoCast for units:", 280, 153);
    [["Own", "autoCastOwn"], ["Allies", "autoCastAllies"], ["Neutral", "autoCastNeutral"]].forEach(([t, k], i) => cb(t!, k!, 283, 189 + 28 * i));
    void first;
    // três grupos de opção
    const group = <V extends string>(title: string, x: number, items: [V, string][], cur: V, set: (v: V) => void) => {
      T(title, x, 263);
      const rs: ReturnType<typeof classicRadio>[] = [];
      items.forEach(([v, label], i) => {
        const r = classicRadio(kit, label, v === cur, () => { set(v); rs.forEach((q, j) => q.set(items[j]![0] === v)); changed(); });
        r.position.set(x + 2, 289 + 24 * i);
        b.addChild(r); rs.push(r);
      });
    };
    group("Formation Mode", 40, [["off", "Off"], ["auto", "Auto"], ["on", "On"]], st.settings.formationMode, v => { st.settings.formationMode = v; });
    group("Retreat Mode", 208, [["never", "Never"], ["low", "Low Health"], ["medium", "Medium Health"]], st.settings.retreatMode, v => { st.settings.retreatMode = v; });
    group("AutoCast mode:", 376, [["min", "Minimum"], ["avg", "Average"], ["max", "Maximum"]], st.settings.autoCastMode ?? "avg", v => { st.settings.autoCastMode = v; });
    const mk = (label: string, x: number, fn: () => void) => {
      const it = cols.add(classicMenuItem(label, fn, { width: 166, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, 368);
    };
    mk("Ok", 84, ok);
    mk("Cancel", 334, cancel);
    b.addChild(cols.view);
  });
  return win;
}
