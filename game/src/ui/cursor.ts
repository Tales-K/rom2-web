import type { Application } from "pixi.js";

/**
 * Cursores temáticos fora da missão (CSS; a missão desenha o próprio cursor no canvas).
 * Arquivos gerados por tools/pipeline/menu.py (graphics/cursors/<nome>/sprites.16a -> assets/ui/menu/*.png; PNG porque é CSS),
 * hotspots do allods2.exe (assets/ui/cursors/cursors.json):
 *   "select"  mão prateada apontando, ponta do dedo em (3,3) — menu principal e criação de personagem (etapa A)
 *   "default" seta dourada, ponta em (4,4)                   — criação de personagem (etapa B) e demais telas
 * (conferido nas capturas do original, refs/original/menu_main.png, chargen_a.png, chargen_b_fighter.png).
 */
export type ThemeCursor = "default" | "select";
const CURSORS: Record<ThemeCursor, { file: string; hx: number; hy: number }> = {
  default: { file: "assets/ui/menu/cursor.png", hx: 4, hy: 4 },
  select: { file: "assets/ui/menu/cursor_select.png", hx: 3, hy: 3 },
};

export function cursorCss(name: ThemeCursor = "default"): string {
  const c = CURSORS[name];
  return `url(${c.file}) ${c.hx} ${c.hy}, auto`;
}

/**
 * Aplica o cursor temático ao canvas. O PixiJS decide o cursor pelo `cursor` dos objetos sob o ponteiro ("pointer" nos botões),
 * então trocamos a tabela `cursorStyles` do sistema de eventos. Devolve uma função que restaura os estilos anteriores (chame em `exit`).
 * Chamar de novo (outra etapa da mesma cena) só troca a imagem; a restauração continua sendo a da primeira chamada.
 */
export function applyThemeCursor(app: Application, name: ThemeCursor = "default"): () => void {
  const styles = app.renderer.events.cursorStyles;
  const prev = { default: styles.default, pointer: styles.pointer };
  setThemeCursor(app, name);
  return () => {
    styles.default = prev.default;
    styles.pointer = prev.pointer;
    app.canvas.style.cursor = "";
  };
}

/** Troca o cursor temático já aplicado (sem mexer na restauração). */
export function setThemeCursor(app: Application, name: ThemeCursor): void {
  const styles = app.renderer.events.cursorStyles;
  const url = cursorCss(name);
  styles.default = url;
  styles.pointer = url;
  app.canvas.style.cursor = url;
}
