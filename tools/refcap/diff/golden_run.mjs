#!/usr/bin/env node
/**
 * Executor do CORPUS DOURADO (refs/golden/; notes/golden-corpus.md): roda TODOS os episódios medidos no jogo original só no NOSSO motor
 * (headless, sem original) e compara com o traço guardado por janelas com ressincronização (mesmo algoritmo de run_pair.py).
 *
 *   npm run golden                       (na pasta game)       todos os episódios, resumo + diferença contra refs/golden/last_run.json
 *   npm run golden -- --ci               falha (exit 1) se uma assinatura resolvida voltar ou se % limpo cair > 1 ponto
 *   npm run golden -- --episode <id,..>  só esses (não grava last_run)       --show [assinatura]  detalha uma divergência
 *   npm run golden -- --rebaseline       grava esta execução como nova referência (tira o rótulo provisório)
 *   opções: --jobs N (processos, padrão min(cpus-2, 8)), --no-save, --provisional "texto" (rótulo do 1º baseline)
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const GAME = join(ROOT, "game");
const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const opt = k => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const GOLD = resolve(opt("--gold") ?? join(ROOT, "refs", "golden"));
const ORIG_SECS_PER_EP = 8;           // notes/differential-fuzz.md: ~8 s de original por episódio de 60 s (+ abrir o jogo e carregar o save)
const RETRIES = 5, RETRY_WAIT_MS = Number(process.env.GOLDEN_RETRY_WAIT_MS ?? 60000);

const sha1 = b => createHash("sha1").update(b).digest("hex");
const sha256 = b => createHash("sha256").update(b).digest("hex");
const rd = p => JSON.parse(readFileSync(p, "utf8"));
const pad = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Hash do código do motor e dos dados lidos: game/src/sim/**, mission/setup.ts, script/**, dados da missão (game/public). */
function engineHash(missions) {
  const files = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|json)$/.test(e.name)) files.push(p); } };
  walk(join(GAME, "src", "sim"));
  walk(join(GAME, "src", "script"));
  files.push(join(GAME, "src", "mission", "setup.ts"));
  const pub = join(GAME, "public");
  for (const f of readdirSync(join(pub, "data"))) if (f.endsWith(".json")) files.push(join(pub, "data", f));
  files.push(join(pub, "assets", "ui", "hud", "terrain.json"));
  for (const m of missions) for (const f of [`data/maps/${m}.json`, `data/scripts/${m}.json`, `data/texts/mission${m}.json`, `assets/ui/hud/missions/${m}.json`]) files.push(join(pub, f));
  const h = createHash("sha1");
  for (const f of files.filter(existsSync).sort()) { h.update(relative(ROOT, f).replace(/\\/g, "/")); h.update(readFileSync(f)); }
  return h.digest("hex").slice(0, 16);
}

function loadManifest() {
  const p = join(GOLD, "manifest.json");
  if (!existsSync(p)) { console.error(`sem corpus em ${GOLD} (rode tools/refcap/diff/golden_ingest.py --migrate)`); process.exit(2); }
  return rd(p);
}

function verifyCorpus(m) {
  const bad = [];
  for (const e of m.episodes) for (const [fn, info] of Object.entries(e.files)) {
    const p = join(GOLD, "episodes", e.id, fn);
    if (!existsSync(p) || sha256(readFileSync(p)) !== info.sha256) bad.push(`${e.id}/${fn}`);
  }
  return bad;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Roda um trabalhador (tsx) sobre `ids`; refaz até RETRIES vezes só o que faltou (edição em andamento do motor / tsx quebrado). */
async function runChunk(ids, show) {
  const out = new Map();
  let todo = [...ids], lastErr = "";
  for (let att = 1; att <= RETRIES && todo.length; att++) {
    const args = [join(GAME, "node_modules", "tsx", "dist", "cli.mjs"), join(HERE, "golden_worker.mts"), "--gold", GOLD, "--ids", todo.join(","), ...(show ? ["--show"] : [])];
    const err = await new Promise(res => {
      const ch = spawn(process.execPath, args, { cwd: GAME, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "", e = "";
      ch.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith("@@RESULT ")) { const r = JSON.parse(l.slice(9)); out.set(r.id, r); } } });
      ch.stderr.on("data", d => { e += d; });
      ch.on("close", code => res(code === 0 ? "" : (e.trim().split("\n").slice(-6).join("\n") || `saída ${code}`)));
    });
    todo = todo.filter(i => !out.has(i));
    if (!todo.length) break;
    lastErr = err;
    if (att < RETRIES) { console.error(`[golden] trabalhador falhou (${att}/${RETRIES}): ${lastErr.split("\n").pop()}; nova tentativa em ${RETRY_WAIT_MS / 1000} s`); await sleep(RETRY_WAIT_MS); }
  }
  if (todo.length) throw new Error(`falha nos episódios ${todo.join(",")} após ${RETRIES} tentativas:\n${lastErr}`);
  return out;
}

const magOf = d => {
  if (d.field === "pos" && Array.isArray(d.orig) && Array.isArray(d.ours)) return Math.hypot(d.orig[0] - d.ours[0], d.orig[1] - d.ours[1]);
  if ((d.field === "hp" || d.field === "mana") && typeof d.orig === "number") return Math.abs(d.orig - d.ours);
  return null;
};

function aggregate(results) {
  const sigs = new Map();
  let nwin = 0, ndiv = 0, w0 = 0, w0div = 0;
  const win0 = new Map();
  for (const r of results) for (const w of r.windows) {
    nwin++;
    if (w.pass === 0) { w0++; win0.set(`${r.id}@${w.start}`, w.div ? w.div.sig : null); if (w.div) w0div++; }
    const d = w.div;
    if (!d) continue;
    ndiv++;
    let g = sigs.get(d.sig);
    if (!g) sigs.set(d.sig, g = { sig: d.sig, count: 0, episodes: new Set(), magSum: 0, magN: 0, secSum: 0, first: null });
    g.count++; g.episodes.add(r.id); g.secSum += d.sec;
    const mg = magOf(d); if (mg !== null) { g.magSum += mg; g.magN++; }
    if (!g.first) g.first = { episode: r.id, window: [w.start, w.end], pass: w.pass, ...d };
  }
  // métricas tolerantes (fase 7): ±1 / ±2 tiques de 16/s por campo e só a ordem dos eventos; assinaturas do que sobra no ±1
  let t1 = 0, t2 = 0, ord = 0;
  const sig1 = new Map();
  for (const r of results) for (const w of r.windows) {
    if (!w.tol) continue;
    if (!w.tol.t1) t1++; else sig1.set(w.tol.t1, (sig1.get(w.tol.t1) ?? 0) + 1);
    if (!w.tol.t2) t2++;
    if (w.tol.ord) ord++;
  }
  const pct = n => nwin ? +(100 * n / nwin).toFixed(2) : 100;
  const tolerant = { t1: pct(t1), t2: pct(t2), order: pct(ord), sigsT1: [...sig1].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([sig, count]) => ({ sig, count })) };
  const list = [...sigs.values()].sort((a, b) => b.count - a.count || (a.sig < b.sig ? -1 : 1)).map(g => ({
    sig: g.sig, count: g.count, episodes: g.episodes.size, mag: g.magN ? +(g.magSum / g.magN).toFixed(3) : null, avgSec: +(g.secSum / g.count).toFixed(2), first: g.first }));
  return { episodes: results.length, windows: nwin, divergent: ndiv, cleanPct: nwin ? +(100 * (nwin - ndiv) / nwin).toFixed(2) : 100,
    tolerant, win0: Object.fromEntries(win0), win0Total: w0, win0Div: w0div, signatures: list };
}

function diffRuns(cur, last, history) {
  const L = new Map((last?.signatures ?? []).map(s => [s.sig, s]));
  const C = new Map(cur.signatures.map(s => [s.sig, s]));
  const reg = [], imp = [], same = [], reappeared = [];
  for (const [sig, c] of C) {
    const l = L.get(sig);
    if (history?.sigs?.[sig]?.resolved) { reappeared.push({ sig, count: c.count }); continue; }
    if (!last) same.push(sig);
    else if (!l) reg.push({ sig, why: `nova (${c.count})` });
    else if (c.count > l.count) reg.push({ sig, why: `${l.count} -> ${c.count}` });
    else if (l.mag !== null && c.mag !== null && c.mag > l.mag * 1.25 + 0.05) reg.push({ sig, why: `magnitude ${l.mag} -> ${c.mag}` });
    else if (c.count < l.count) imp.push({ sig, why: `${l.count} -> ${c.count}` });
    else same.push(sig);
  }
  for (const [sig, l] of L) if (!C.has(sig)) imp.push({ sig, why: `${l.count} -> 0 (resolvida)` });
  let worse = 0, better = 0;
  const w0 = last?.win0 ?? {};
  for (const [k, s] of Object.entries(cur.win0)) if (k in w0) { if (!w0[k] && s) worse++; else if (w0[k] && !s) better++; }
  return { regressions: reg, improvements: imp, same: same.length, reappeared, windowsWorse: worse, windowsBetter: better };
}

/** Função do C decompilado (index.tsv de allods2-decomp) que contém o endereço de retorno `ret`. */
function decompIndex() {
  const p = join(process.env.A2_DECOMP ?? "C:\\Users\\TALES K\\Games\\allods2-decomp", "index.tsv");
  if (!existsSync(p)) return () => "";
  const rows = readFileSync(p, "utf8").split("\n").slice(1).map(l => l.split("\t")).filter(r => r[0]?.startsWith("0x"))
    .map(r => [parseInt(r[0], 16), r[1]]).sort((a, b) => a[0] - b[0]);
  return ret => { let lo = 0, hi = rows.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m][0] <= ret) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? "?" : `${rows[k][1]}@0x${rows[k][0].toString(16)}`; };
}

/** Replay dos sorteios (DIFF-FUZZ fase 6): limpas com × sem replay e, por site do original, gravados × consumidos. */
function aggregateReplay(results, sitesInfo) {
  const eps = results.filter(r => r.replay);
  if (!eps.length) return null;
  const on = eps.reduce((a, r) => ({ w: a.w + r.replay.on.windows, c: a.c + r.replay.on.clean }), { w: 0, c: 0 });
  const off = eps.reduce((a, r) => ({ w: a.w + r.replay.off.windows, c: a.c + r.replay.off.clean }), { w: 0, c: 0 });
  const S = new Map();
  for (const r of eps) for (const [k, v] of Object.entries(r.replay.sites)) {
    const g = S.get(k) ?? { site: k, rec: 0, used: 0, miss: 0, argdiff: 0, kind: v.kind, eps: 0 };
    g.rec += v.rec; g.used += v.used; g.miss += v.miss; g.argdiff += v.argdiff; g.eps++; g.kind ??= v.kind;
    if (v.off) { g.off ??= {}; for (const [d, n] of Object.entries(v.off)) g.off[d] = (g.off[d] ?? 0) + n; }
    if (v.first) { g.first ??= {}; for (const [d, n] of Object.entries(v.first)) g.first[d] = (g.first[d] ?? 0) + n; }
    S.set(k, g);
  }
  const fn = decompIndex();
  const sites = [...S.values()].map(g => {
    const num = /^\d+$/.test(g.site) ? Number(g.site) : null;
    const info = num !== null ? sitesInfo?.[`0x${num.toString(16)}`] : null;
    return { ...g, ret: num !== null ? `0x${num.toString(16)}` : g.site, func: num !== null ? fn(num) : "(nosso, sem site no original)", unused: g.rec - g.used,
      class: info?.class ?? null };
  }).sort((a, b) => b.unused - a.unused || b.miss - a.miss);
  return { episodes: eps.length, on: { ...on, pct: on.w ? +(100 * on.c / on.w).toFixed(2) : 0 }, off: { ...off, pct: off.w ? +(100 * off.c / off.w).toFixed(2) : 0 },
    recorded: sites.reduce((a, s) => a + s.rec, 0), used: sites.reduce((a, s) => a + s.used, 0), sites };
}

function fmtSig(s) { return `${String(s.count).padStart(4)} x ${s.sig}  (${s.episodes} ep${s.mag !== null ? `, mag ${s.mag}` : ""})`; }

async function main() {
  const m = loadManifest();
  const bad = verifyCorpus(m);
  if (bad.length) { console.error(`CORPUS ADULTERADO/AUSENTE (hash): ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` ... (${bad.length})` : ""}`); process.exit(2); }
  let eps = m.episodes;
  const only = opt("--episode");
  if (only) { const want = only.split(","); const ex = eps.filter(e => want.includes(e.id)); eps = ex.length ? ex : eps.filter(e => want.some(w => e.id.includes(w))); if (!eps.length) { console.error("episódio não encontrado"); process.exit(2); } }
  const missions = [...new Set(m.episodes.map(e => e.mission))];
  const t0 = Date.now();
  const hashBefore = engineHash(missions);
  const jobs = Math.max(1, Math.min(Number(opt("--jobs") ?? Math.min(cpus().length - 2, 8)), eps.length));
  const show = flag("--show") && !!only;
  const ids = eps.map(e => e.id);
  const chunks = Array.from({ length: jobs }, () => []);
  ids.forEach((id, i) => chunks[i % jobs].push(id));
  const maps = await Promise.all(chunks.filter(c => c.length).map(c => runChunk(c, show)));
  const byId = new Map(maps.flatMap(x => [...x]));
  const results = ids.map(id => byId.get(id));
  const wall = (Date.now() - t0) / 1000;
  const hashAfter = engineHash(missions);

  const cur = aggregate(results);
  const sitesP = join(GOLD, "sites.json");
  const rep = aggregateReplay(results, existsSync(sitesP) ? rd(sitesP).sites : null);
  if (rep) cur.replay = rep;
  const lastP = join(GOLD, "last_run.json"), histP = join(GOLD, "history.json");
  const last = existsSync(lastP) ? rd(lastP) : null;
  const history = existsSync(histP) ? rd(histP) : { sigs: {} };
  const full = !only;
  const df = only ? { regressions: [], improvements: [], same: 0, reappeared: [], windowsWorse: 0, windowsBetter: 0 } : diffRuns(cur, last, history);
  const codeChanged = !last || last.engineHash !== hashBefore;
  const now = new Date();
  const run = { when: now.toISOString(), engineHash: hashBefore, engineHashEnd: hashAfter, codeChangedDuringRun: hashBefore !== hashAfter, codeChangedSinceLast: codeChanged,
    corpus: { episodes: m.episodes.length, updated: m.updated }, jobs, wallSeconds: +wall.toFixed(1), cpuSeconds: +(results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1),
    partial: !full, ...cur };

  // histórico de assinaturas resolvidas
  const curSigs = new Set(cur.signatures.map(s => s.sig));
  if (full) {
    for (const s of cur.signatures) { const h = history.sigs[s.sig] ??= { firstSeen: run.when, resolved: false }; if (h.resolved) { h.resolved = false; h.reappearedAt = run.when; } }
    for (const [sig, h] of Object.entries(history.sigs)) if (!curSigs.has(sig) && !h.resolved) { h.resolved = true; h.resolvedAt = run.when; }
  }
  const ciFail = [];
  if (flag("--ci")) {
    for (const r of df.reappeared) ciFail.push(`assinatura resolvida voltou: ${r.sig} (${r.count})`);
    if (last && cur.cleanPct < last.cleanPct - 1) ciFail.push(`% de janelas limpas caiu ${last.cleanPct} -> ${cur.cleanPct}`);
    if (hashBefore !== hashAfter) ciFail.push("o código mudou durante a execução (resultado inválido)");
  }

  if (!existsSync(join(GOLD, "runs"))) mkdirSync(join(GOLD, "runs"), { recursive: true });
  const runFile = join(GOLD, "runs", `${stamp(now)}${only ? "_parcial" : ""}.json`);
  writeFileSync(runFile, JSON.stringify({ ...run, diff: df, results }, null, 0));
  const saveBaseline = full && !flag("--ci") && !flag("--no-save");
  const rebase = flag("--rebaseline");
  if (saveBaseline || (rebase && full)) {
    const keep = !rebase && last?.provisional ? last.provisional : null;
    const prov = rebase ? null : (opt("--provisional") ?? keep ?? (last ? null : "provisório, DIFF-FUZZ fase 4 em andamento"));
    if (rebase) for (const h of Object.values(history.sigs)) { h.resolved = false; delete h.reappearedAt; }
    writeFileSync(lastP, JSON.stringify({ ...run, provisional: prov }, null, 1));
    writeFileSync(histP, JSON.stringify(history, null, 1));
  }

  // ---- resumo (<= 40 linhas)
  const out = [];
  const prov = (last?.provisional ?? null);
  out.push(`GOLDEN: ${cur.episodes} episodios, ${cur.windows} janelas, ${cur.windows - cur.divergent} limpas (${cur.cleanPct}%), ${cur.signatures.length} assinaturas`);
  { const T = cur.tolerant, L = last?.tolerant;
    out.push(`limpas estrito ${cur.cleanPct}% | +-1 tique ${T.t1}% | +-2 tiques ${T.t2}% | so ordem dos eventos ${T.order}%${L && !only ? ` (antes ${last.cleanPct}/${L.t1}/${L.t2}/${L.order})` : ""}`);
    out.push(`  sobra no +-1: ${T.sigsT1.slice(0, 4).map(s => `${s.count} ${s.sig}`).join("; ")}`); }
  { const rg = results.reduce((a, r) => (r.rng ? { n: a.n + r.rng.n, sync: a.sync + r.rng.sync, orig: a.orig + r.rng.orig, ours: a.ours + r.rng.ours } : a), { n: 0, sync: 0, orig: 0, ours: 0 });
    if (rg.n) out.push(`rand(): 1o segundo de ${rg.n} janelas com a mesma contagem de sorteios ${rg.sync} (${(100 * rg.sync / rg.n).toFixed(1)}%); media original ${(rg.orig / rg.n).toFixed(1)}/s, nosso ${(rg.ours / rg.n).toFixed(1)}/s`); }
  out.push(`tempo: ${wall.toFixed(1)} s (${jobs} processos; ${run.cpuSeconds} s de CPU) vs original ~${Math.round(cur.episodes * ORIG_SECS_PER_EP / 60)} min (${ORIG_SECS_PER_EP} s/ep) -> ${(cur.episodes * ORIG_SECS_PER_EP / wall).toFixed(0)}x mais rapido`);
  out.push(`codigo do motor ${hashBefore}${codeChanged ? " [CODIGO MUDOU desde a ultima execucao]" : " [igual a ultima execucao]"}${hashBefore !== hashAfter ? " [MUDOU DURANTE A EXECUCAO: resultado nao confiavel]" : ""}`);
  if (prov) out.push(`referencia (last_run.json): PROVISORIA - ${prov}${last ? ` (de ${last.when.slice(0, 19)})` : ""}`);
  out.push(only ? "vs anterior: (execucao parcial: sem comparacao)" : `vs anterior: ${last ? `limpas ${last.cleanPct}% -> ${cur.cleanPct}% | janelas piores ${df.windowsWorse}, melhores ${df.windowsBetter}, assinaturas iguais ${df.same}` : "sem execucao anterior (esta vira a referencia)"}`);
  const sect = (t, arr) => { if (!arr.length) return; out.push(`${t} (${arr.length}):`); for (const x of arr.slice(0, 5)) out.push(`  ${x.sig}  ${x.why ?? "x" + x.count}`); if (arr.length > 5) out.push(`  ... +${arr.length - 5}`); };
  sect("REAPARECEU (era resolvida)", df.reappeared);
  sect("REGRESSOES", df.regressions);
  sect("MELHORIAS", df.improvements);
  if (rep) {
    out.push(`replay dos sorteios (${rep.episodes} ep. gravados): limpas COM replay ${rep.on.pct}% (${rep.on.c}/${rep.on.w}) x SEM ${rep.off.pct}% (${rep.off.c}/${rep.off.w}); sorteios do original consumidos ${rep.used}/${rep.recorded} (${(100 * rep.used / Math.max(1, rep.recorded)).toFixed(1)}%)`);
    out.push("  sites por sorteios NAO consumidos (gravados/consumidos/faltou/arg diferente):");
    for (const s of rep.sites.slice(0, 8)) out.push(`  ${String(s.unused).padStart(7)} ${s.ret.padEnd(9)} ${String(s.kind ?? "").padEnd(6)} ${s.rec}/${s.used}/${s.miss}/${s.argdiff} ${s.func}${s.class ? ` [${s.class}]` : ""}`);
    if (rep.sites.length > 8) out.push(`  ... +${rep.sites.length - 8} sites (todos em refs/golden/runs/<data>.json: replay.sites)`);
  }
  out.push("assinaturas mais frequentes (campo|unidade|detalhe):");
  for (const s of cur.signatures.slice(0, 10)) out.push("  " + fmtSig(s));
  if (cur.signatures.length > 10) out.push(`  ... +${cur.signatures.length - 10} (JSON completo: ${relative(ROOT, runFile).replace(/\\/g, "/")})`);
  if (only) out.push("(execucao parcial: last_run.json nao foi atualizado)");
  else if (flag("--ci")) out.push(ciFail.length ? "CI: FALHOU - " + ciFail.join("; ") : "CI: ok");
  console.log(out.slice(0, 40).join("\n"));

  if (flag("--show")) {
    let target = only ? results[0] : null, sig = opt("--show");
    if (!only) { // sem --episode: detalha o 1º exemplo da assinatura pedida (ou da mais frequente) rodando só esse episódio
      const g = cur.signatures.find(s => !sig || s.sig === sig) ?? cur.signatures[0];
      if (g) { sig = g.sig; target = (await runChunk([g.first.episode], true)).get(g.first.episode); }
    }
    for (const w of (target?.windows ?? []).filter(w => w.div && (!sig || w.div.sig === sig || only))) {
      const d = w.div;
      console.log(`\n${target.id} janela ${w.start}-${w.end} (passada ${w.pass}) t=${d.sec}s unidade ${d.unit} (${d.who}) ${d.sig}\n  original ${JSON.stringify(d.orig)}  nosso ${JSON.stringify(d.ours)}  tambem: ${d.also.join(", ") || "-"}`);
      for (const r of d.rows ?? []) console.log(`  ${String(r.step).padStart(4)}  o ${r.orig ? JSON.stringify(r.orig) : "-"}\n        n ${r.ours ? JSON.stringify(r.ours) : "-"}`);
      if (!only) break;
    }
  }
  process.exit(ciFail.length ? 1 : 0);
}

main().catch(e => { console.error(e.message ?? e); process.exit(2); });
