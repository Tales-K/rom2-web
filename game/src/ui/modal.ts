/**
 * Pilha de janelas modais para o teclado. Um único ouvinte `keydown` (fase de captura, em `window`) entrega cada tecla só à janela do
 * topo e impede que ela chegue à cena por baixo (e às janelas de baixo). Use em todas as janelas por cima de uma cena
 * (menu do jogo, Load/Save, opções, ConfirmDialog).
 *
 *   const pop = pushKeyLayer(e => { if (e.key === "Escape") close(); });   ...   pop();   // ao fechar
 *
 * As cenas que registram o próprio ouvinte em captura antes da janela abrir (MenuScene) devem consultar `modalOpen()`.
 */
type Handler = (e: KeyboardEvent) => void;

const stack: { h: Handler }[] = [];
let installed = false;

function onKey(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  e.stopImmediatePropagation();
  // teclas de navegação do navegador que atrapalhariam (rolar a página, voltar)
  if (["Escape", "Enter", " ", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Backspace", "F2", "F3"].includes(e.key)) e.preventDefault();
  try { top.h(e); } catch (err) { console.error("[modal] erro no teclado:", err); }
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  window.addEventListener("keydown", onKey, true);
  installed = true;
}
install();   // já na importação: assim fica antes dos ouvintes de captura das cenas

/** Empilha um tratador de teclado; devolve a função que o remove (idempotente). */
export function pushKeyLayer(h: Handler): () => void {
  install();
  const entry = { h };
  stack.push(entry);
  return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
}

/** Há alguma janela modal aberta? */
export function modalOpen(): boolean { return stack.length > 0; }
