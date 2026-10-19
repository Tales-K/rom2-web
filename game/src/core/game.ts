import type { Application } from "pixi.js";
import { AudioManager } from "./audio";
import { DataStore } from "./data";
import { SceneManager } from "./scene";
import { GameState } from "./state";
import { VideoPlayer } from "./video";
import { SCENES } from "../scenes/registry";

/** Objeto único passado a todas as cenas: serviços compartilhados. */
export class Game {
  readonly audio = new AudioManager();
  readonly video = new VideoPlayer();
  readonly data = new DataStore();
  readonly state = new GameState();
  readonly scenes: SceneManager;

  constructor(readonly app: Application) {
    this.audio.attach(this.state);
    this.video.attach(this.state);
    this.scenes = new SceneManager(this, SCENES);
    app.ticker.add(t => this.scenes.update(t.deltaMS));
  }

  /** Atalho: troca de cena. */
  go(name: string, params?: unknown): Promise<void> { return this.scenes.go(name, params); }
}
