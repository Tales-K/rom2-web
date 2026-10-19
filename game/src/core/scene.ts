import { Container } from "pixi.js";
import type { Game } from "./game";

/** Resolução lógica do jogo (o canvas é escalado por CSS para caber na janela). */
export const SCREEN_W = 1024;
export const SCREEN_H = 768;

/**
 * Uma tela do jogo. Cada cena fica em src/scenes/<Nome>Scene.ts e exporta a classe como `default`.
 * - `root` é o Container da cena (já anexado ao stage quando `enter` é chamado).
 * - `enter` pode ser async (carregar texturas, dados). O SceneManager espera antes de mostrar a cena.
 * - `update` roda a cada frame (dt em milissegundos).
 * - `exit` deve parar sons/vídeos e liberar listeners; o Container é destruído pelo SceneManager.
 */
export abstract class Scene {
  readonly root = new Container();
  constructor(protected readonly game: Game) {}
  async enter(_params?: unknown): Promise<void> {}
  update(_dtMs: number): void {}
  exit(): void {}
}

export type SceneFactory = () => Promise<{ default: new (game: Game) => Scene }>;

export class SceneManager {
  private current?: Scene;
  private currentName = "";
  private switching = false;

  constructor(private readonly game: Game, private readonly registry: Record<string, SceneFactory>) {}

  get name(): string { return this.currentName; }

  private pending?: { name: string; params?: unknown };

  /**
   * Troca de cena. Se já houver uma troca em andamento (por exemplo `go` chamado dentro de `enter()`), o pedido fica na fila
   * e é executado logo depois (vale o mais recente).
   */
  async go(name: string, params?: unknown): Promise<void> {
    const factory = this.registry[name];
    if (!factory) throw new Error(`Cena desconhecida: ${name}`);
    if (this.switching) { this.pending = { name, params }; return; }
    this.switching = true;
    try {
      const mod = await factory();
      const next = new mod.default(this.game);
      if (this.current) {
        this.current.exit();
        this.game.app.stage.removeChild(this.current.root);
        this.current.root.destroy({ children: true });
      }
      this.game.app.stage.addChild(next.root);
      this.current = next;
      this.currentName = name;
      await next.enter(params);
      console.info(`[cena] ${name}`, params ?? "");
    } finally {
      this.switching = false;
    }
    const next = this.pending;
    this.pending = undefined;
    if (next) await this.go(next.name, next.params);
  }

  update(dtMs: number): void { this.current?.update(dtMs); }
}
