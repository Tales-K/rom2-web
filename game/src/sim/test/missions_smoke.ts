/**
 * Teste de fumaça das 46 missões (headless). Rodar em game/:  npm run test:missions  [-- <id> ...]  [--ticks=600] [--write]
 * Monta o mundo de cada missão como a MissionScene, roda ~600 tiques com o herói parado e relata: exceções, avisos do
 * runtime/host (ação sem suporte), unidades sem template/stats/animação, estruturas/objetos sem sprite, jogadores/diplomacia
 * e referências do script sem alvo. `--write` regrava a tabela em notes/missions.md (entre os marcadores SMOKE).
 */
import { fileExists, json, loadData, proc, run, startRun, PUB } from "./loader";

const { readdirSync, readFileSync, writeFileSync, existsSync } = proc.getBuiltinModule("node:fs") as {
  readdirSync(p: string): string[]; readFileSync(p: string, e: "utf8"): string; writeFileSync(p: string, s: string): void; existsSync(p: string): boolean;
};
const { join } = proc.getBuiltinModule("node:path") as { join(...p: string[]): string };

const args = proc.argv.slice(2);
const TICKS = Number(args.find(a => a.startsWith("--ticks="))?.slice(8) ?? 600);
const WRITE = args.includes("--write");
const only = args.filter(a => /^\d+$/.test(a)).map(Number);

interface RawParam { type: string; value: number }
interface RawScript {
  units?: { id: number }[]; groups?: { id: number }[];
  values?: { params: RawParam[] }[]; actions?: { params: RawParam[] }[];
}
interface Row {
  id: number; name: string; units: number; structs: number; objs: number; exc: string[]; warns: string[]; noTpl: string[]; noAnim: string[];
  noSprite: string[]; players: string[]; refs: string[]; alive: number; heroHp: string; outcome: string; msgs: number; subs: string;
}
const blank = (id: number): Row => ({ id, name: "?", units: 0, structs: 0, objs: 0, exc: [], warns: [], noTpl: [], noAnim: [], noSprite: [], players: [], refs: [], alive: 0, heroHp: "-", outcome: "-", msgs: 0, subs: "" });

const ids = readdirSync(join(PUB, "data", "scripts")).filter(f => /^\d+\.json$/.test(f)).map(f => parseInt(f)).sort((a, b) => a - b)
  .filter(i => !only.length || only.includes(i));
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

async function one(id: number): Promise<Row> {
  const row = blank(id);
  const data = await loadData(id);
  const map = data.map;
  row.name = (data.texts?.sections.briefing?.[0]?.text.split(/\r?\n/)[0] ?? String(map.name ?? "")).replace(/[|]/g, "/");
  row.units = map.units.length; row.structs = map.structures.length; row.objs = map.objs.length;
  const raw = json<RawScript>(`data/scripts/${id}.json`);
  // ---- dados estáticos
  map.units.forEach((mu, i) => {
    const kind = String(mu.kind);
    const sid = mu.serverId ?? data.mapTemplates?.[i]?.serverId;
    const hasTpl = sid != null && !!data.templates?.[String(sid)]?.health;
    const hasStats = !!data.stats?.[kind]?.health;
    if (!hasTpl && !hasStats) row.noTpl.push(`${kind}${data.unitsStatic[kind]?.name ? ":" + data.unitsStatic[kind]!.name : ""}`);
    if (!data.anim[kind]) row.noAnim.push(kind);
  });
  for (const [, , oid] of map.objs) if (!data.objects[String(oid)] || !fileExists(`assets/objects/obj_${oid}.png`)) row.noSprite.push(`obj${oid}`);
  for (const st of map.structures) if (!data.structures[String(st.kind)] || !fileExists(`assets/structures/st_${st.kind}.png`)) row.noSprite.push(`st${st.kind}`);
  const np = map.players.length;
  map.units.forEach((mu, i) => { if (mu.player < 1 || mu.player > np) row.players.push(`unidade ${i} jogador ${mu.player} fora de 1..${np}`); });
  for (const p of map.players) {
    if (!Array.isArray(p.diplomacy) || p.diplomacy.length !== np) row.players.push(`jogador ${p.id}: diplomacia com ${p.diplomacy?.length ?? 0} entradas (esperado ${np})`);
  }
  for (let a = 0; a < np; a++) for (let b = a + 1; b < np; b++) {
    const x = (map.players[a]!.diplomacy?.[b] ?? 0) & 3, y = (map.players[b]!.diplomacy?.[a] ?? 0) & 3;
    if (x !== y && (x === 2 || y === 2)) row.players.push(`aliança assimétrica ${a + 1}->${b + 1}=${x} / ${b + 1}->${a + 1}=${y}`);
  }
  // ---- referências do script
  if (raw) {
    const unitIds = new Set((raw.units ?? []).map(u => u.id)); const groupIds = new Set((raw.groups ?? []).map(g => g.id));
    for (const e of [...(raw.values ?? []), ...(raw.actions ?? [])]) for (const p of e.params) {
      if (p.type === "unit" && p.value && !unitIds.has(p.value) && !(p.value >= 10001 && p.value <= 10003)) row.refs.push(`unit#${p.value}`);
      if (p.type === "group" && p.value && !groupIds.has(p.value)) row.refs.push(`group#${p.value}`);
      if (p.type === "player" && (p.value < 1 || p.value > np)) row.refs.push(`player#${p.value}`);
    }
  } else row.refs.push("sem script");
  // ---- simulação
  try {
    const r = startRun(data);
    run(r, TICKS);
    const w = r.b.world;
    row.alive = w.units.filter(u => u.alive && u !== r.b.hero).length;
    row.heroHp = `${Math.ceil(r.b.hero.hp)}/${r.b.hero.maxHp}`;
    row.outcome = r.outcome ? (r.outcome.ok ? "COMPLETE" : `FAIL${r.outcome.cause}`) : "-";
    row.msgs = r.messages.length;
    row.subs = [...r.subs].map(([k, v]) => `${k}=${v}`).join(",");
    for (const l of r.logs) row.warns.push(l.msg.replace(/^\[script \d+\] /, ""));
  } catch (e) {
    row.exc.push(e instanceof Error ? `${e.message} @ ${(e.stack ?? "").split("\n").slice(1, 3).map(s => s.trim()).join(" ")}` : String(e));
  }
  return row;
}

const rows: Row[] = [];
for (const id of ids) {
  try { rows.push(await one(id)); } catch (e) { const r = blank(id); r.exc.push(`carga: ${e instanceof Error ? e.message : e}`); rows.push(r); }
}

const sum = (a: string[], n = 6): string => { const u = uniq(a); return u.length ? u.slice(0, n).join(" ") + (u.length > n ? ` (+${u.length - n})` : "") : ""; };
let bad = 0;
const lines: string[] = [];
lines.push(`| Missão | Nome | Un. | Est. | Obj. | Exceção | Avisos runtime/host | Sem template/stats | Sem anim | Sem sprite | Jogadores | Refs script | Vivos | Herói | Msgs | Subs | Desfecho (${TICKS} tiques) |`);
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const issues = r.exc.length + r.warns.length + r.noTpl.length + r.noAnim.length + r.noSprite.length + r.players.length + r.refs.length;
  if (r.exc.length) bad++;
  const cell = (a: string[]) => sum(a.map(s => s.replace(/\|/g, "/").replace(/\n/g, " "))) || "-";
  lines.push(`| ${r.id} | ${r.name} | ${r.units} | ${r.structs} | ${r.objs} | ${cell(r.exc)} | ${cell(r.warns)} | ${cell(r.noTpl)} | ${cell(r.noAnim)} | ${cell(r.noSprite)} | ${cell(r.players)} | ${cell(r.refs)} | ${r.alive} | ${r.heroHp} | ${r.msgs} | ${r.subs || "-"} | ${r.outcome} |`);
  if (issues) {
    const parts: [string, string[]][] = [["warn", r.warns], ["semTpl", r.noTpl], ["semAnim", r.noAnim], ["semSprite", r.noSprite], ["jog", r.players], ["ref", r.refs]];
    console.log(`#${r.id} ${r.name}: ${r.exc.length ? "EXCEÇÃO " : ""}${parts.filter(([, a]) => a.length).map(([k, a]) => `${k}=${sum(a, 4)}`).join(" | ")}`);
  }
  for (const e of r.exc) console.log("   !! " + e);
}
console.log(`\n${rows.length} missões; ${bad} com exceção; ${rows.filter(r => r.outcome !== "-").length} com desfecho em ${TICKS} tiques`);
if (WRITE) {
  const p = join(PUB, "..", "..", "notes", "missions.md");
  const A = "<!-- SMOKE:BEGIN -->", B = "<!-- SMOKE:END -->";
  let md = existsSync(p) ? readFileSync(p, "utf8") : `# Missões — notas e relatório do teste de fumaça\n\n${A}\n${B}\n`;
  if (!md.includes(A)) md += `\n${A}\n${B}\n`;
  md = md.replace(new RegExp(`${A}[\\s\\S]*?${B}`), `${A}\n${lines.join("\n")}\n${B}`);
  writeFileSync(p, md);
  console.log("notes/missions.md atualizado");
}
proc.exitCode = bad ? 1 : 0;
