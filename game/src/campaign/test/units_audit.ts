/**
 * Auditoria SISTEMÁTICA de sprites e retratos (28/10, item 10: Igles com o sprite genérico na missão 30 — nenhum teste olhava o modelo
 * que o jogo resolve para cada unidade nomeada). Para cada missão da campanha monta a missão como a cena (sim/test/loader startRun,
 * com Igles/Dina quando a campanha os manda) e, para as unidades NOMEADAS/DE ROTEIRO (herói, companheiros, quem fala nos textos
 * event*, unidades com id de roteiro, templates de herói), compara:
 *   - sprite: `kind` resolvido × o que os dados do original prescrevem (unit-templates.json do data.bin: template `kind: "hero"` →
 *     ramo de herói do exe 0x5143e4 = graphics/units/heroes/<arma do equipamento>; senão o modelo `typeId` do template);
 *   - retrato: mission/portraitrules.ts × regra do exe 0x494832/0x49510c (humano → boneca; monstro → graphics/infowindow/<InfoPicture><face>,
 *     que tem de existir em assets/ui/hud/info/; sem bitmap → quadro do sprite).
 * Também a taverna: cartão de cada frequentador (campaign.json npcs[].portrait) × `inn\Unit<typeId do template>` (exe 0x499783;
 * grupo = HeroFighter/HeroMage). Roda sozinho (`npx tsx src/campaign/test/units_audit.ts`) e dentro do e2e (campaign/test/e2e.ts).
 */
import { COMPANION_TEMPLATE, defaultHero, heroSpriteKey, templateSpriteKey, type MissionData } from "../../mission/setup";
import { portraitKeyFor } from "../../mission/portraitrules";
import { innSpriteName } from "../../town/innview";
import { fileExists, loadData, startRun } from "../../sim/test/loader";
import { campaignData as D, check } from "../../sim/test/pilot";
import type { TemplateJson } from "../../sim/stats";

export interface UnitRow {
  mission: number; id: number; name: string; scriptId: number; npc: number; why: string;
  sprite: string; spriteExpected: string; portrait: string; portraitExpected: string; portraitFile: boolean;
}

/** Sprite que os dados do original prescrevem para a unidade (template de herói → heróis; senão o modelo do template ou do mapa). */
function expectedSprite(u: { isHero: boolean; npc: number; kind: string }, data: MissionData, hero: ReturnType<typeof defaultHero>): string {
  if (u.isHero) return heroSpriteKey(hero, data.anim, data.items);
  const tpl = u.npc ? data.templates?.[String(u.npc)] as (TemplateJson & { typeId?: number }) | undefined : undefined;
  if (!tpl?.typeId) return u.kind;
  return templateSpriteKey(tpl, data);
}

/** Retrato que a regra do exe prescreve: "doll" para humanos (template human/hero ou tipo < 64 sem template), senão o bitmap de infowindow. */
function expectedPortrait(u: { isHero: boolean; npc: number; kind: string; typeId: number }, data: MissionData): string {
  if (u.isHero) return "doll";
  const tpl = u.npc ? data.templates?.[String(u.npc)] : undefined;
  const human = tpl ? tpl.kind === "human" || tpl.kind === "hero" : u.typeId < 64;
  if (human) return "doll";
  const am = data.anim[u.kind];
  if (!am?.InfoPicture) return `sprite:${u.kind}`;
  const face = Number(tpl?.face ?? 0);
  return (am.InfoPicture + (face > 1 ? String(face) : "")).toLowerCase();
}

/** Linhas da missão `id`: unidades nomeadas/de roteiro com o que o jogo resolve e o que o original prescreve. */
export async function auditMission(id: number): Promise<UnitRow[]> {
  const data = await loadData(id);
  const hero = defaultHero();
  const companions = [...(id >= 30 ? [10002] : []), ...(id >= 50 ? [10003] : [])];
  const r = startRun(data, hero, undefined, { companions });
  const w = r.b.world;
  const speakers = new Set<number>();
  for (const [sec, lines] of Object.entries(data.texts?.sections ?? {})) {
    if (!sec.startsWith("event")) continue;
    for (const l of lines) { const n = Number(l.tags?.npc ?? 0); if (n && n !== 21) speakers.add(n); }
  }
  const rows: UnitRow[] = [];
  for (const u of w.units) {
    const tpl = u.npc ? data.templates?.[String(u.npc)] : undefined;
    const why = u.isHero ? "herói" : COMPANION_TEMPLATE[u.scriptId] ? "companheiro" : speakers.has(u.npc) ? "fala" : tpl?.kind === "hero" ? "template de herói" : u.scriptId && u.scriptId >= 10000 ? "roteiro" : "";
    if (!why) continue;
    const portrait = portraitKeyFor(u, data);
    const bitmap = !portrait.startsWith("doll:") && !portrait.startsWith("sprite:");
    rows.push({
      mission: id, id: u.id, name: u.name, scriptId: u.scriptId, npc: u.npc, why,
      sprite: u.kind, spriteExpected: expectedSprite(u, data, hero),
      portrait, portraitExpected: expectedPortrait(u, data), portraitFile: bitmap ? fileExists(`assets/ui/hud/info/${portrait}.png`) : true,
    });
  }
  return rows;
}

export function rowProblems(x: UnitRow): string[] {
  const p: string[] = [];
  if (x.sprite !== x.spriteExpected) p.push(`sprite ${x.sprite} ≠ ${x.spriteExpected}`);
  const ok = x.portraitExpected === "doll" ? x.portrait.startsWith("doll:") : x.portrait === x.portraitExpected;
  if (!ok) p.push(`retrato ${x.portrait} ≠ ${x.portraitExpected}`);
  if (!x.portraitFile) p.push(`bitmap assets/ui/hud/info/${x.portrait}.png não existe`);
  return p;
}

/** Taverna: cartão de cada frequentador de campaign.json × Unit<typeId do template> (grupo 21..30 = HeroFighter/HeroMage). */
export function auditInn(): string[] {
  const tpls = D as unknown as { npcs: Record<string, { serverId?: number; portrait?: string | null }> };
  const problems: string[] = [];
  const templates = (globalThis as { __tpls?: Record<string, { typeId?: number; mage?: boolean }> }).__tpls;
  for (const [npc, def] of Object.entries(tpls.npcs)) {
    const n = Number(npc);
    const card = innSpriteName(def.portrait);
    let want: string;
    if (n >= 21 && n <= 30) want = templates?.[String(def.serverId ?? n)]?.mage ? "heromage" : "herofighter";
    else { const t = templates?.[String(def.serverId ?? n)]; want = t?.typeId ? `unit${t.typeId}` : "unit1"; }
    if (card !== want) problems.push(`taverna: npc ${npc} cartão ${card} ≠ ${want}`);
  }
  return problems;
}

/** Roda a auditoria inteira; imprime só os desvios (e um resumo) e registra as verificações no `check` do piloto. */
export async function auditUnits(ids: number[] = Object.keys(D.missions).map(Number)): Promise<{ rows: UnitRow[]; problems: string[] }> {
  console.log("\n[AUDITORIA. sprite e retrato de cada unidade nomeada/de roteiro por missão × dados do original]");
  const rows: UnitRow[] = [];
  const problems: string[] = [];
  for (const id of ids.sort((a, b) => a - b)) {
    const rs = await auditMission(id);
    rows.push(...rs);
    for (const x of rs) for (const p of rowProblems(x)) problems.push(`missão ${id}: ${x.name} (unidade ${x.id}, ${x.why}${x.npc ? `, template ${x.npc}` : ""}): ${p}`);
  }
  const tplFile = await loadData(ids[0] ?? 10);
  (globalThis as { __tpls?: unknown }).__tpls = tplFile.templates;
  problems.push(...auditInn());
  const byWhy = new Map<string, number>();
  for (const x of rows) byWhy.set(x.why, (byWhy.get(x.why) ?? 0) + 1);
  console.log(`  ${rows.length} unidades em ${ids.length} missões (${[...byWhy].map(([k, v]) => `${k} ${v}`).join(", ")}); ${problems.length} desvio(s)`);
  for (const p of problems) console.log(`    - ${p}`);
  check(problems.length === 0, `sprites e retratos das unidades nomeadas/de roteiro batem com os dados do original (${problems.length} desvio(s))`);
  return { rows, problems };
}

const self = (globalThis as { process?: { argv: string[] } }).process?.argv[1] ?? "";
if (/units_audit/.test(self)) {
  const { rows, problems } = await auditUnits();
  if ((globalThis as { process?: { argv: string[] } }).process?.argv.includes("--tabela")) {
    for (const x of rows) console.log(`  m${x.mission}\t${x.id}\t${x.name}\t${x.why}\t${x.sprite}\t${x.portrait}`);
  }
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = problems.length ? 1 : 0;
}
