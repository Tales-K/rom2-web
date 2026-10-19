// Captura automatica do NOSSO jogo (servidor Vite de desenvolvimento) para comparacao com o original.
//
//   node tools/refcap/ours/capture.mjs [--only id,id] [--url http://127.0.0.1:5173/] [--out refs/ours]
//                                       [--browser caminho.exe] [--headful] [--realtime] [--retries 3]
//
// Para cada cenario de tools/refcap/scenarios.json com receita em recipes.mjs, prepara o estado do jogo
// (heroi, cena, mouse, vida...) e salva refs/ours/<id>.png (1024x768, devicePixelRatio 1) ou a sequencia
// refs/ours/<id>_000.png..., mais refs/ours/<id>.json com metadados (posicao do mouse, cursor, cena, avisos).
//
// - Navegador: Chrome ou Edge ja instalados (puppeteer-core NAO baixa navegador). Headless "new" + ANGLE/SwiftShader
//   (WebGL por software: o resultado nao depende da GPU da maquina).
// - O Vite recarrega a pagina quando alguem salva arquivos em game/src: a navegacao e detectada e o cenario e repetido.
// - Cursor: na missao o cursor e desenhado no proprio canvas (sai no PNG). Nas outras cenas o cursor e CSS
//   (`url(cursor.png) x y`), que nao aparece em screenshots: ele e composto no PNG na posicao do mouse. Se o canvas
//   estiver com um cursor do sistema (ex.: "pointer"), nada e desenhado e o metadado registra o aviso.
// - Sequencias: por padrao usam tempo virtual (performance.now congelado e avancado de `interval_ms` a cada quadro,
//   com o ticker do Pixi avancado manualmente), entao o intervalo entre quadros e exato mesmo com o WebGL por software
//   lento. `--realtime` usa o relogio real (registra os instantes efetivos no .json).
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPES, genericRecipe } from "./recipes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const W = 1024, H = 768;

// ------------------------------------------------------------------------------------------- argumentos
function parseArgs(argv) {
  const a = { only: null, url: "http://127.0.0.1:5173/", out: path.join(ROOT, "refs/ours"), browser: null, headful: false, realtime: false, retries: 3, list: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === "--only") a.only = v().split(",").map(s => s.trim()).filter(Boolean);
    else if (k === "--url") a.url = v();
    else if (k === "--out") a.out = path.resolve(v());
    else if (k === "--browser") a.browser = v();
    else if (k === "--headful") a.headful = true;
    else if (k === "--realtime") a.realtime = true;
    else if (k === "--retries") a.retries = Number(v());
    else if (k === "--list") a.list = true;
    else if (k === "-h" || k === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).join("\n")); process.exit(0); }
    else throw new Error(`argumento desconhecido: ${k}`);
  }
  return a;
}

function findBrowser(explicit) {
  const cands = [explicit, process.env.REFCAP_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error("Chrome/Edge nao encontrado; use --browser <caminho>");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// relogio virtual injetado antes de qualquer script da pagina (usado nas sequencias)
const CLOCK_SCRIPT = `(() => {
  const pn = performance.now.bind(performance);
  let frozen = null, off = 0;
  performance.now = () => frozen !== null ? frozen : pn() + off;
  window.__refcapClock = {
    freeze() { if (frozen === null) frozen = pn() + off; return frozen; },
    advance(ms) { if (frozen === null) frozen = pn() + off; frozen += ms; return frozen; },
    release() { if (frozen !== null) { off = frozen - pn(); frozen = null; } },
    get frozen() { return frozen !== null; },
  };
})();`;

class Reloaded extends Error { constructor() { super("a pagina recarregou (Vite)"); } }

// ------------------------------------------------------------------------------------------- sessao
class Session {
  constructor(browser, opts) { this.browser = browser; this.opts = opts; this.navs = 0; this.page = null; this.save = null; this.log = []; }

  async open() {
    if (this.page) await this.page.close().catch(() => {});
    const page = await this.browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(CLOCK_SCRIPT);
    page.on("framenavigated", f => { if (f === page.mainFrame()) this.navs++; });
    page.on("pageerror", e => this.log.push(`[pageerror] ${e.message}`));
    page.on("console", m => { if (m.type() === "error" || m.type() === "warning") this.log.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
    this.page = page;
    await this.boot();
  }

  /** carrega a URL e espera o jogo chegar a cena "boot" (antes disso um game.go seria sobrescrito pelo main.ts) */
  async boot() {
    const page = this.page;
    await page.goto(this.opts.url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.game && window.game.scenes && window.game.scenes.name === "boot", { timeout: 60000 });
    const rect = await page.evaluate(() => { const r = game.app.canvas.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio, cw: game.app.canvas.width, ch: game.app.canvas.height }; });
    if (rect.x !== 0 || rect.y !== 0 || rect.w !== W || rect.h !== H || rect.dpr !== 1 || rect.cw !== W || rect.ch !== H)
      throw new Error(`canvas fora de 0,0 1024x768 @1x: ${JSON.stringify(rect)}`);
    await page.evaluate(() => { game.audio.unlock?.(); });
    this.bootNavs = this.navs;
  }

  checkReload() { if (this.navs !== this.bootNavs) throw new Reloaded(); }

  async eval(fn, ...args) {
    try { const r = await this.page.evaluate(fn, ...args); this.checkReload(); return r; }
    catch (e) { if (this.navs !== this.bootNavs || /context was destroyed|Target closed|detached/i.test(String(e))) throw new Reloaded(); throw e; }
  }

  /** troca de cena e espera terminar (enter() concluido, sem troca pendente) */
  async go(name, params, settleMs = 900) {
    await this.eval(async (n, p) => { await game.go(n, p ?? undefined); }, name, params ?? null);
    await this.waitScene(name);
    await sleep(settleMs);
    this.checkReload();
  }

  async waitScene(name, timeout = 60000) {
    const t0 = Date.now();
    for (;;) {
      const st = await this.eval(() => ({ name: game.scenes.name, switching: game.scenes.switching, pending: !!game.scenes.pending }));
      if (st.name === name && !st.switching && !st.pending) return;
      if (Date.now() - t0 > timeout) throw new Error(`cena ${name} nao ficou pronta (atual: ${JSON.stringify(st)})`);
      await sleep(100);
    }
  }

  async mouse(x, y) {
    this.mousePos = { x: Math.round(x), y: Math.round(y) };
    // dois passos: alguns codigos so reagem a "pointermove" com mudanca de posicao
    await this.page.mouse.move(this.mousePos.x + 1, this.mousePos.y + 1);
    await this.page.mouse.move(this.mousePos.x, this.mousePos.y, { steps: 2 });
    this.checkReload();
  }

  /** garante um heroi criado pela propria tela de criacao (guerreiro "Aldor"; com `extra.mage` o mago "Gildarius") e restaura o save a cada cenario */
  async ensureHero(extra) {
    const mage = !!(extra && extra.mage);
    this.saves ??= {};
    const key = mage ? "mage" : "fighter";
    if (!this.saves[key]) {
      await this.go("chargen", null, 700);
      await this.eval((win, nm) => { const sc = game.scenes.current; sc.pickWin(win); if (!sc.name || !sc.name.trim()) { sc.name = nm; sc.updateName(); } sc.accept(); }, mage ? 4 : 1, mage ? "Gildarius" : "Aldor");
      await this.waitScene("town");
      // guarda heroi+progresso em memoria (independe do formato/slots do save em localStorage)
      this.saves[key] = await this.eval(() => game.state.hero ? JSON.stringify({ hero: game.state.hero, progress: game.state.progress }) : null);
      if (!this.saves[key]) throw new Error("a criacao de personagem nao criou o heroi (game.state.hero vazio)");
    }
    this.save = this.saves[key];
    await this.eval((s, ex) => {
      const d = JSON.parse(s);
      if (ex && ex.flags) Object.assign(d.progress.flags, ex.flags);
      game.state.hero = d.hero;
      game.state.progress = d.progress;
      if ("pendingMission" in game.state) game.state.pendingMission = undefined;
    }, this.save, extra ?? null);
  }

  async cursorInfo() {
    return this.eval(() => {
      const c = game.app.canvas.style.cursor || getComputedStyle(game.app.canvas).cursor;
      const m = window.__mission;
      const drawn = !!(m && m === game.scenes.current && m.cursor && m.cursor.visible && !m.cursor.destroyed);
      return { css: c, computed: getComputedStyle(game.app.canvas).cursor, scene: game.scenes.name, gameDrawn: drawn };
    });
  }

  /** screenshot do quadro 1024x768; compoe o cursor CSS tematico na posicao do mouse quando houver */
  async shot(file, meta) {
    const page = this.page;
    let buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H }, captureBeyondViewport: false });
    this.checkReload();
    const cur = await this.cursorInfo();
    meta.cursor = { css: cur.css, computed: cur.computed, drawn: "nenhum" };
    const m = /url\(["']?([^"')]+)["']?\)\s*(\d+)?\s*(\d+)?/.exec(cur.css || "");
    const warn = w => { if (!meta.warnings.includes(w)) meta.warnings.push(w); };
    if (cur.gameDrawn) {
      meta.cursor.drawn = "pelo jogo (canvas)";
      if (cur.css !== "none" && this.mousePos) warn(`cursor do sistema tambem visivel sobre o canvas (style.cursor="${cur.css}", efetivo "${cur.computed}") alem do cursor desenhado pelo jogo`);
    } else if (cur.css === "none") meta.cursor.drawn = "nenhum (css none, jogo nao desenhou)";
    else if (m && this.mousePos) {
      const b64 = await this.eval(async (png, url, hx, hy, mx, my) => {
        const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        const [base, cur] = await Promise.all([load("data:image/png;base64," + png), load(url)]);
        const cv = document.createElement("canvas"); cv.width = base.width; cv.height = base.height;
        const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(base, 0, 0); ctx.drawImage(cur, mx - hx, my - hy);
        return cv.toDataURL("image/png").split(",")[1];
      }, buf.toString("base64"), m[1], Number(m[2] ?? 0), Number(m[3] ?? 0), this.mousePos.x, this.mousePos.y);
      buf = Buffer.from(b64, "base64");
      meta.cursor.drawn = `CSS composto (${m[1]}, ponta ${m[2] ?? 0},${m[3] ?? 0})`;
    } else if (this.mousePos) {
      meta.cursor.drawn = "nenhum";
      warn(`cursor do sistema "${cur.css || "default"}" (nao tematico) sobre o canvas: nao aparece na captura`);
    }
    fs.writeFileSync(file, buf);
  }

  /** sequencia de N quadros a cada intervalo (tempo virtual por padrao) */
  async sequence(id, n, intervalMs, meta) {
    const files = [];
    const times = [];
    const virtual = !this.opts.realtime;
    if (virtual) await this.eval(() => { game.app.ticker.stop(); __refcapClock.freeze(); });
    try {
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        if (virtual) {
          await this.eval(ms => { const t = __refcapClock.advance(ms); game.app.ticker.update(t); }, intervalMs);
          await this.eval(() => new Promise(r => requestAnimationFrame(() => r())));   // deixa o compositor mostrar o quadro
        } else {
          const due = t0 + i * intervalMs;
          if (Date.now() < due) await sleep(due - Date.now());
        }
        const f = path.join(this.opts.out, `${id}_${String(i).padStart(3, "0")}.png`);
        times.push(virtual ? i * intervalMs : Date.now() - t0);
        await this.shot(f, { warnings: meta.warnings });
        files.push(path.basename(f));
      }
    } finally {
      if (virtual) await this.page.evaluate(() => { __refcapClock.release(); game.app.ticker.start(); }).catch(() => {});
    }
    meta.frames = files; meta.frame_times_ms = times; meta.clock = virtual ? "virtual" : "real";
  }
}

// ------------------------------------------------------------------------------------------- principal
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scen = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/refcap/scenarios.json"), "utf8")).scenarios;
  if (opts.list) { for (const s of scen) console.log(`${RECIPES[s.id] || s.scene || s.enter || s.mission ? "ok   " : "SEM  "} ${s.id}  ${s.desc}`); return; }
  const todo = scen.filter(s => !opts.only || opts.only.includes(s.id));
  if (opts.only) for (const id of opts.only) if (!scen.some(s => s.id === id)) console.warn(`[aviso] cenario desconhecido: ${id}`);
  fs.mkdirSync(opts.out, { recursive: true });

  const exe = findBrowser(opts.browser);
  const profile = process.env.REFCAP_PROFILE ? path.resolve(process.env.REFCAP_PROFILE) : path.join(HERE, ".profile");
  fs.rmSync(profile, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: exe, headless: !opts.headful, userDataDir: profile,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
      `--window-size=${W},${H}`, "--force-device-scale-factor=1", "--hide-scrollbars", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--no-first-run", "--no-default-browser-check"],
  });
  const version = await browser.version();
  console.log(`[refcap] ${version} (${exe}) -> ${path.relative(ROOT, opts.out)}`);
  const sess = new Session(browser, opts);
  const summary = [];
  try {
    await sess.open();
    for (const s of todo) {
      const recipe = RECIPES[s.id] ?? ((s.scene || s.enter || s.mission) ? genericRecipe : null);
      if (!recipe) { console.warn(`[aviso] ${s.id}: sem receita em recipes.mjs (pulado)`); summary.push({ id: s.id, ok: false, error: "sem receita" }); continue; }
      let ok = false, lastErr = "";
      for (let attempt = 1; attempt <= opts.retries && !ok; attempt++) {
        const meta = { id: s.id, desc: s.desc, browser: version, url: opts.url, captured_at: new Date().toISOString(), warnings: [], attempt };
        sess.mousePos = null; sess.log = [];
        try {
          // cada cenario parte de uma pagina "limpa" de cena (o save e restaurado pela receita)
          const ctx = { sess, meta, scenario: s, sleep, W, H };
          const plan = await recipe(ctx);            // a receita prepara o estado e devolve { sequence? }
          meta.scene = await sess.eval(() => game.scenes.name);
          meta.mouse = sess.mousePos;
          // remove sobras de execucoes anteriores do mesmo cenario
          for (const f of fs.readdirSync(opts.out)) if (f === `${s.id}.png` || new RegExp(`^${s.id}_\\d{3}\\.png$`).test(f)) fs.rmSync(path.join(opts.out, f));
          if (s.sequence) await sess.sequence(s.id, s.sequence, s.interval_ms ?? 100, meta);
          else await sess.shot(path.join(opts.out, `${s.id}.png`), meta);
          if (plan && plan.after) await plan.after();
          sess.checkReload();
          meta.page_log = sess.log.slice(0, 20);
          fs.writeFileSync(path.join(opts.out, `${s.id}.json`), JSON.stringify(meta, null, 1));
          ok = true;
          console.log(`[ok] ${s.id}${s.sequence ? ` (${s.sequence} quadros, relogio ${meta.clock})` : ""}${meta.warnings.length ? `  avisos: ${meta.warnings.join(" | ")}` : ""}`);
        } catch (e) {
          lastErr = String(e && e.stack || e);
          const reloaded = e instanceof Reloaded;
          console.warn(`[falha] ${s.id} tentativa ${attempt}: ${reloaded ? "a pagina recarregou (Vite) - repetindo" : lastErr.split("\n")[0]}`);
          if (sess.log.length) console.warn("   " + sess.log.slice(0, 5).join("\n   "));
          await sleep(reloaded ? 2500 : 500);
          await sess.open().catch(err => console.warn(`[falha] reabrir: ${err}`));
        }
      }
      summary.push({ id: s.id, ok, error: ok ? undefined : lastErr.split("\n")[0] });
    }
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(opts.out, "_capture.json"), JSON.stringify({ at: new Date().toISOString(), browser: version, results: summary }, null, 1));
  const bad = summary.filter(r => !r.ok);
  console.log(`[refcap] ${summary.length - bad.length}/${summary.length} cenarios capturados${bad.length ? `; falharam: ${bad.map(b => b.id).join(", ")}` : ""}`);
  process.exitCode = bad.length ? 1 : 0;
}

main().catch(e => { console.error(e); process.exit(2); });
