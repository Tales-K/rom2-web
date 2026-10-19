import type { GameState } from "./state";

/**
 * Reprodutor de vídeo (as cutscenes originais são Smacker .smk, convertidas para mp4 H.264+AAC por tools/pipeline/media.py).
 * Arquivos em public/assets/video/<nome>.mp4 (logos_nival, logos_publisher, intro, teleport, stars, crown, knights, druids).
 * O vídeo é um elemento <video> dentro do #overlay (por cima do canvas, na mesma escala), em TAMANHO NATURAL e centrado, sobre fundo preto
 * (como o allods2.exe: 640×360 no meio da tela de 1024×768 para as cutscenes, 640×480 para os logos; refs/original, 19/10), sem esmaecer.
 *
 * Robustez: nunca trava a cena que chamou. Se o arquivo faltar, não decodificar, ou o tempo parar de avançar por
 * muito tempo (watchdog), a promessa resolve com "error". Sem gesto prévio do usuário o navegador recusa vídeo com som:
 * nesse caso toca mudo e liga o som no primeiro gesto.
 */
export type VideoResult = "ended" | "skipped" | "error";

export class VideoPlayer {
  ext = "mp4";
  private state?: GameState;
  private current?: { name: string; finish: (r: VideoResult) => void; el: HTMLVideoElement };
  private preloaded = new Map<string, HTMLVideoElement>();

  /** Liga o volume a `state.settings` (speechVolume). Chamado pelas cenas de mídia; idempotente. */
  attach(state: GameState): void { this.state = state; }

  /** Nome do vídeo em reprodução ("" se nenhum). */
  get playing(): string { return this.current?.name ?? ""; }

  /** Começa a baixar um vídeo em segundo plano (para que o `play` seguinte não tenha espera). */
  preload(name: string): void {
    if (this.preloaded.has(name)) return;
    const v = document.createElement("video");
    v.preload = "auto"; v.muted = true; v.playsInline = true;
    v.src = `assets/video/${name}.${this.ext}`;
    v.addEventListener("error", () => this.preloaded.delete(name));
    this.preloaded.set(name, v);
  }

  /** Interrompe o vídeo atual (resolve a promessa de `play` com "skipped"). */
  stop(): void { this.current?.finish("skipped"); }

  /** Toca o vídeo e resolve quando termina ou quando o jogador pula (clique, Esc, Espaço ou Enter). */
  play(name: string, opts: { skippable?: boolean; volume?: number; fadeMs?: number; anyKey?: boolean } = {}): Promise<VideoResult> {
    const overlay = document.getElementById("overlay");
    if (!overlay) return Promise.resolve("error");
    this.current?.finish("skipped");
    return new Promise<VideoResult>(resolve => {
      const v = this.preloaded.get(name) ?? document.createElement("video");
      this.preloaded.delete(name);
      const fadeMs = opts.fadeMs ?? 0;
      // tela preta cobrindo a cena de trás + vídeo no tamanho natural (sem ampliar), no centro; o original não faz fade (opts.fadeMs > 0 liga um)
      const holder = document.createElement("div");
      holder.style.cssText = "position:absolute;inset:0;background:#000;display:flex;align-items:center;justify-content:center;";
      v.style.cssText = `flex:none;background:#000;object-fit:none;${fadeMs > 0 ? `opacity:0;transition:opacity ${fadeMs}ms linear;` : ""}`;
      holder.appendChild(v);
      v.playsInline = true;
      v.preload = "auto";
      v.muted = false;
      v.volume = clamp(opts.volume ?? this.state?.settings.speechVolume ?? 0.9);
      if (!v.src) v.src = `assets/video/${name}.${this.ext}`;

      let done = false;
      let lastT = -1, lastAdvance = performance.now(), watchdog = 0;
      const finish = (r: VideoResult) => {
        if (done) return;
        done = true;
        clearInterval(watchdog);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("pointerdown", onGesture, true);
        if (this.current?.el === v) this.current = undefined;
        v.pause(); v.removeAttribute("src"); v.load(); v.remove(); holder.remove();
        resolve(r);
      };
      const skippable = opts.skippable !== false;
      // anyKey: qualquer tecla pula (logos e abertura do original: Esc, Espaço, Enter e clique levam direto ao menu)
      const onKey = (e: KeyboardEvent) => { if (skippable && (opts.anyKey ? !["Shift", "Control", "Alt", "Meta"].includes(e.key) : ["Escape", " ", "Enter"].includes(e.key))) { e.preventDefault(); finish("skipped"); } };
      const onGesture = () => { if (v.muted) { v.muted = false; v.volume = clamp(opts.volume ?? this.state?.settings.speechVolume ?? 0.9); } };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("pointerdown", onGesture, true);
      if (skippable) holder.addEventListener("click", () => finish("skipped"));
      v.addEventListener("ended", () => finish("ended"));
      v.addEventListener("error", () => { console.warn("[video] falhou:", name, v.error?.message ?? ""); finish("error"); });
      v.addEventListener("playing", () => { if (fadeMs > 0) v.style.opacity = "1"; });

      // watchdog: sem avanço de currentTime por 6 s (ou 12 s antes do primeiro quadro) = travou
      watchdog = window.setInterval(() => {
        if (v.currentTime !== lastT) { lastT = v.currentTime; lastAdvance = performance.now(); return; }
        const limit = lastT <= 0 ? 12000 : 6000;
        if (!v.paused && performance.now() - lastAdvance > limit) { console.warn("[video] travou:", name); finish("error"); }
        else if (v.paused && performance.now() - lastAdvance > limit) { console.warn("[video] não iniciou:", name); finish("error"); }
      }, 500);

      this.current = { name, finish, el: v };
      overlay.appendChild(holder);
      v.play().catch((err: unknown) => {
        if ((err as { name?: string })?.name === "NotAllowedError") {
          // sem gesto do usuário: tenta mudo (o som volta no primeiro clique/tecla)
          v.muted = true;
          v.play().catch(() => finish("error"));
        } else finish("error");
      });
    });
  }
}

function clamp(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
