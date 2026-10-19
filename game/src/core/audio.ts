import type { GameState } from "./state";

/**
 * Música, efeitos e falas. Arquivos em public/assets/audio/ (gerados por tools/pipeline/media.py):
 *   music/<nome>.ogg|.mp3      (menu, map, chrgen, credit, b00..b16)      -> game.audio.playMusic("menu")
 *   sfx/<caminho>.ogg          (hierarquia de extracted/sfx)             -> game.audio.playSfx("click00") ou playSfx(5)
 *   speech/<caminho>.ogg       (hierarquia de extracted/speech)           -> game.audio.playSpeech("talk/2004t043p01")
 * Mapa de efeitos: public/data/sfx.json (ids numéricos do sfx.reg -> nome -> arquivo; ver docs/DATA.md, seção MÍDIA).
 *
 * Política de autoplay: o navegador só toca áudio depois de um gesto do usuário. O AudioManager escuta o primeiro
 * pointerdown/keydown por conta própria (a BootScene também chama `unlock()`); uma música pedida antes disso fica
 * pendente e começa assim que o gesto acontecer.
 * Volumes: se `attach(state)` foi chamado, os volumes vêm de `state.settings` (musicVolume/sfxVolume/speechVolume) e
 * mudanças ali (menu de opções) são refletidas em até ~100 ms; sem `attach`, valem os valores internos.
 */

interface SfxIndex {
  base: string;
  ids: Record<string, string>;
  names: Record<string, string>;
  groups: Record<string, string[]>;
}

interface Track {
  el: HTMLAudioElement;
  name: string;
  level: number;          // fator de fade 0..1 (multiplica o volume de música)
  target: number;         // para onde o fade caminha
  rate: number;           // variação de level por ms
  action: "none" | "remove" | "pause";
  blocked: boolean;       // play() foi recusado pela política de autoplay
  triedAlt: boolean;      // já tentou a extensão de reserva
  ext: string;
  loop: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const MAX_VOICES = 32;

export class AudioManager {
  private state?: GameState;
  private _music = 0.6;
  private _sfx = 0.8;
  private _speech = 0.9;
  unlocked = false;
  /** Extensão preferida (ogg; mp3 se o navegador não tocar Vorbis). */
  ext = "ogg";

  private cur?: Track;
  private tracks = new Set<Track>();
  private userPaused = false;
  private duck = 1;

  private ctx?: AudioContext;
  private sfxGain?: GainNode;
  private sfxIndex?: Promise<SfxIndex | null>;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private voices = 0;
  private lastSfxAt = new Map<string, number>();
  /** "escopo" dos efeitos: cada cena que quer poder calar os seus sons ao sair (ex.: "mission") marca um escopo ao entrar */
  private sfxScope = "";
  private scopeEpoch = new Map<string, number>();
  private active = new Set<{ src: AudioBufferSourceNode; scope: string }>();

  private speechEl?: HTMLAudioElement;
  private speechDone?: () => void;
  /** geração da sequência de falas em curso (`playSpeechSeq`); qualquer outra fala/parada a invalida */
  private speechSeq = 0;

  constructor() {
    if (typeof window === "undefined") return;
    try {
      const probe = new Audio();
      if (!probe.canPlayType('audio/ogg; codecs="vorbis"')) this.ext = "mp3";
    } catch { /* sem suporte a Audio */ }
    const gesture = () => this.unlock();
    this.gestureHandler = gesture;
    for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, gesture, { capture: true });
    setInterval(() => this.tick(50), 50);
  }
  private gestureHandler?: () => void;

  // ------------------------------------------------------------ configuração

  /** Liga os volumes a `game.state.settings` (chamado pelas cenas de mídia; idempotente). */
  attach(state: GameState): void { this.state = state; this.tick(0); }

  get musicVolume(): number { return this.state?.settings.musicVolume ?? this._music; }
  set musicVolume(v: number) { this._music = clamp01(v); if (this.state) this.state.settings.musicVolume = this._music; this.applyVolumes(); }
  get sfxVolume(): number { return this.state?.settings.sfxVolume ?? this._sfx; }
  set sfxVolume(v: number) { this._sfx = clamp01(v); if (this.state) this.state.settings.sfxVolume = this._sfx; if (this.sfxGain) this.sfxGain.gain.value = this._sfx; }
  get speechVolume(): number { return this.state?.settings.speechVolume ?? this._speech; }
  set speechVolume(v: number) { this._speech = clamp01(v); if (this.state) this.state.settings.speechVolume = this._speech; if (this.speechEl) this.speechEl.volume = this._speech; }

  /** Libera o áudio (primeiro gesto do usuário). */
  unlock(): void {
    if (!this.unlocked) {
      this.unlocked = true;
      if (this.gestureHandler) for (const ev of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(ev, this.gestureHandler, { capture: true });
    }
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    const c = this.cur;
    if (c && c.blocked && !this.userPaused) this.start(c);
  }

  // ------------------------------------------------------------ música

  get currentMusic(): string { return this.cur?.name ?? ""; }

  playMusic(name: string, opts: { loop?: boolean; fadeMs?: number } = {}): void {
    const fadeMs = opts.fadeMs ?? 600;
    this.userPaused = false;
    const c = this.cur;
    if (c && c.name === name && c.target > 0 && !c.el.ended) {
      if (c.el.paused) this.start(c);
      return;
    }
    if (c) this.fadeTrack(c, 0, Math.min(fadeMs, 600), "remove");
    const t: Track = {
      el: new Audio(), name, level: 0, target: 1, rate: 1 / Math.max(1, fadeMs), action: "none",
      blocked: false, triedAlt: false, ext: this.ext, loop: opts.loop ?? true,
    };
    t.el.preload = "auto";
    t.el.loop = t.loop;
    t.el.volume = 0;
    t.el.src = `assets/audio/music/${name}.${t.ext}`;
    t.el.addEventListener("error", () => this.onTrackError(t));
    // exclusividade: qualquer outra faixa ainda viva (ex.: um crossfade da missão em andamento) também sai
    for (const o of this.tracks) if (o !== t && !(o.target === 0 && o.action === "remove")) this.fadeTrack(o, 0, Math.min(fadeMs, 600), "remove");
    this.tracks.add(t);
    this.cur = t;
    this.start(t);
  }

  stopMusic(fadeMs = 400): void {
    this.cur = undefined;
    this.userPaused = false;
    for (const o of this.tracks) this.fadeTrack(o, 0, fadeMs, "remove");
  }

  /** Pausa a música atual (com fade curto); `resumeMusic` continua de onde parou. */
  pauseMusic(fadeMs = 250): void {
    this.userPaused = true;
    if (this.cur) this.fadeTrack(this.cur, 0, fadeMs, "pause");
  }

  resumeMusic(fadeMs = 250): void {
    this.userPaused = false;
    const c = this.cur;
    if (!c) return;
    c.action = "none";
    c.target = 1; c.rate = 1 / Math.max(1, fadeMs);
    if (c.el.paused) this.start(c);
  }

  setMusicVolume(v: number): void { this.musicVolume = v; }
  setSfxVolume(v: number): void { this.sfxVolume = v; }
  setSpeechVolume(v: number): void { this.speechVolume = v; }

  private fadeTrack(t: Track, to: number, ms: number, action: Track["action"]): void {
    t.target = to;
    t.rate = (ms <= 0 ? 1 : 1 / ms);
    t.action = action;
    if (ms <= 0) { t.level = to; this.tick(0); }
  }

  private start(t: Track): void {
    const p = t.el.play();
    if (!p) return;
    p.then(() => { t.blocked = false; }).catch((err: unknown) => {
      const n = (err as { name?: string })?.name;
      if (n === "NotAllowedError") { t.blocked = true; return; }          // espera o gesto do usuário
      if (n === "AbortError") return;                                     // substituída por outra chamada
      console.warn("[audio] música indisponível:", t.name, (err as Error)?.message ?? err);
      this.onTrackError(t);
    });
  }

  private onTrackError(t: Track): void {
    if (!t.triedAlt && this.tracks.has(t)) {
      t.triedAlt = true;
      t.ext = t.ext === "ogg" ? "mp3" : "ogg";
      t.el.src = `assets/audio/music/${t.name}.${t.ext}`;
      this.start(t);
      return;
    }
    console.warn("[audio] música ausente:", t.name);
    this.tracks.delete(t);
    if (this.cur === t) this.cur = undefined;
  }

  /** Avança fades e sincroniza volumes (também chamado em intervalo fixo; independe de requestAnimationFrame). */
  private tick(dtMs: number): void {
    const vol = this.musicVolume * this.duck;
    for (const t of [...this.tracks]) {
      if (t.level !== t.target) {
        const step = t.rate * dtMs;
        t.level = t.level < t.target ? Math.min(t.target, t.level + step) : Math.max(t.target, t.level - step);
      }
      t.el.volume = clamp01(t.level * vol);
      if (t.level === t.target && t.target === 0) {
        if (t.action === "remove") {
          t.el.pause(); t.el.removeAttribute("src"); t.el.load();
          this.tracks.delete(t);
        } else if (t.action === "pause") {
          t.el.pause(); t.action = "none";
        }
      }
    }
  }

  private applyVolumes(): void { this.tick(0); }

  // ------------------------------------------------------------ efeitos (WebAudio, com buffers em cache)

  private getCtx(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    if (!this.unlocked) return undefined;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      this.ctx = new Ctor();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    } catch { this.ctx = undefined; }
    return this.ctx;
  }

  private loadIndex(): Promise<SfxIndex | null> {
    if (!this.sfxIndex) {
      this.sfxIndex = fetch("data/sfx.json")
        .then(r => (r.ok ? (r.json() as Promise<SfxIndex>) : null))
        .catch(() => null);
    }
    return this.sfxIndex;
  }

  /** Converte id numérico / nome ("click00", "units/sword", "units\\sword") em caminho do arquivo (sorteia dentro de grupos de variantes). */
  private async resolveSfx(key: string | number): Promise<string | undefined> {
    const idx = await this.loadIndex();
    let name = String(key).replace(/\\/g, "/").replace(/^sfx\//, "").replace(/\.(ogg|mp3|wav)$/i, "");
    if (idx && /^\d+$/.test(name)) { const n = idx.ids[name]; if (!n) return undefined; name = n; }
    if (!idx) return `assets/audio/sfx/${name}.${this.ext}`;
    if (idx.names[name]) return idx.names[name];
    const g = idx.groups[name];
    if (g && g.length) { const pick = g[Math.floor(Math.random() * g.length)]; return idx.names[pick]; }
    return undefined;
  }

  private loadBuffer(path: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(path);
    if (!p) {
      const ctx = this.getCtx();
      p = !ctx ? Promise.resolve(null)
        : fetch(path).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(b => ctx.decodeAudioData(b))
          .catch(err => { console.warn("[audio] sfx falhou:", path, (err as Error)?.message ?? err); return null; });
      if (ctx) this.buffers.set(path, p);
    }
    return p;
  }

  /** Efeitos tocados daqui em diante pertencem a `scope` ("" = nenhum); veja `stopSfxScope`. */
  setSfxScope(scope: string): void { this.sfxScope = scope; }

  /** Cala os efeitos do escopo que ainda tocam e cancela os que ainda estão sendo carregados/decodificados. */
  stopSfxScope(scope: string): void {
    this.scopeEpoch.set(scope, (this.scopeEpoch.get(scope) ?? 0) + 1);
    for (const a of [...this.active]) if (a.scope === scope) { try { a.src.stop(); } catch { /* já terminou */ } }
    if (this.sfxScope === scope) this.sfxScope = "";
  }

  /** Toca um efeito por nome ou id do sfx.reg. `volume` (0..1) multiplica o volume de efeitos. */
  playSfx(nameOrId: string | number, volume = 1): void {
    if (!this.unlocked) return;
    const scope = this.sfxScope, epoch = this.scopeEpoch.get(scope) ?? 0;
    const key = String(nameOrId);
    const now = performance.now();
    if (now - (this.lastSfxAt.get(key) ?? -1e9) < 30) return;          // evita rajadas idênticas no mesmo quadro
    this.lastSfxAt.set(key, now);
    void this.resolveSfx(nameOrId).then(path => {
      if (!path) return null;
      return this.loadBuffer(path);
    }).then(buf => {
      const ctx = this.ctx;
      if (!buf || !ctx || !this.sfxGain || this.voices >= MAX_VOICES) return;
      if (scope && (this.scopeEpoch.get(scope) ?? 0) !== epoch) return;      // a cena do efeito já saiu
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = clamp01(volume);
      src.connect(g); g.connect(this.sfxGain);
      this.voices++;
      const rec = { src, scope };
      this.active.add(rec);
      src.onended = () => { this.voices--; this.active.delete(rec); g.disconnect(); };
      src.start();
    }).catch(() => undefined);
  }

  /** Pré-carrega efeitos (por nome ou id) para evitar atraso na primeira vez. */
  async preloadSfx(keys: Array<string | number>): Promise<void> {
    if (!this.unlocked) return;
    await Promise.all(keys.map(async k => { const p = await this.resolveSfx(k); if (p) await this.loadBuffer(p); }));
  }

  // ------------------------------------------------------------ falas

  /**
   * Toca uma fala (ex.: "talk/2004t043p01", sem extensão, relativo a assets/audio/speech/). Interrompe a fala anterior,
   * abaixa a música enquanto toca e resolve quando termina (ou falha/ é interrompida).
   */
  playSpeech(id: string, opts: { volume?: number; duck?: boolean } = {}): Promise<void> {
    this.speechSeq++;   // uma fala avulsa também interrompe uma sequência em curso
    return this.speak(id, opts);
  }

  private speak(id: string, opts: { volume?: number; duck?: boolean }): Promise<void> {
    this.speechDone?.();
    if (!this.unlocked) return Promise.resolve();
    const path = `assets/audio/speech/${id.replace(/\\/g, "/").replace(/\.(ogg|mp3|wav)$/i, "")}.${this.ext}`;
    return new Promise<void>(resolve => {
      const el = new Audio(path);
      el.volume = clamp01(this.speechVolume * (opts.volume ?? 1));
      this.speechEl = el;
      const useDuck = opts.duck !== false;
      if (useDuck) this.duck = 0.4;
      const done = () => {
        if (this.speechDone !== done) return;
        this.speechDone = undefined;
        if (this.speechEl === el) this.speechEl = undefined;
        if (useDuck) this.duck = 1;
        el.pause(); el.removeAttribute("src");
        resolve();
      };
      this.speechDone = done;
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
      el.play().catch(done);
    });
  }

  /**
   * Toca várias falas em sequência (ex.: as partes p1..p3 da descrição de um item no lojista). `stopSpeech()` ou um novo
   * `playSpeech`/`playSpeechSeq` interrompe a sequência inteira; resolve ao terminar a última (ou ao ser interrompida).
   */
  async playSpeechSeq(ids: string[], opts: { volume?: number; duck?: boolean } = {}): Promise<void> {
    const token = ++this.speechSeq;
    for (const id of ids) {
      if (token !== this.speechSeq) return;
      await this.speak(id, opts);
    }
  }

  stopSpeech(): void { this.speechSeq++; this.speechDone?.(); }

  /** Para tudo (música sem fade, falas e efeitos em andamento). */
  stopAll(): void {
    this.stopSpeech(); this.stopMusic(0);
    for (const a of [...this.active]) { try { a.src.stop(); } catch { /* já terminou */ } }
  }

  /** Estado resumido para depuração: `game.audio.debug()`. */
  debug(): { music: string; time: number; paused: boolean; volume: number; unlocked: boolean; blocked: boolean; tracks: number } {
    const c = this.cur;
    return { music: c?.name ?? "", time: c?.el.currentTime ?? 0, paused: c?.el.paused ?? true, volume: c?.el.volume ?? 0, unlocked: this.unlocked, blocked: !!c?.blocked, tracks: this.tracks.size };
  }
}
