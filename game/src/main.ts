import { Application } from "pixi.js";
import { Game } from "./core/game";
import { SCREEN_H, SCREEN_W } from "./core/scene";
import { loadFonts } from "./ui/text";
import { installGameHotkeys } from "./ui/hotkeys";

async function start(): Promise<void> {
  const app = new Application();
  await app.init({ width: SCREEN_W, height: SCREEN_H, background: 0x000000, antialias: false, roundPixels: true, resolution: 1 });
  const frame = document.getElementById("frame")!;
  app.canvas.tabIndex = 0;
  frame.insertBefore(app.canvas, document.getElementById("overlay"));

  // escala o quadro 1024x768 para caber na janela, mantendo a proporção
  const fit = () => { frame.style.transform = `scale(${Math.min(innerWidth / SCREEN_W, innerHeight / SCREEN_H)})`; };
  addEventListener("resize", fit); fit();

  const game = new Game(app);
  (window as unknown as { game: Game }).game = game;   // depuração no console: game.go("mission", { id: 10 })
  installGameHotkeys(game);   // F2 salvar, F3 carregar, F10 menu em qualquer cena
  await loadFonts();   // fonte bitmap original: pronta antes da primeira cena
  await game.go("boot");
}

void start();
