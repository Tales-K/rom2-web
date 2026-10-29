/**
 * Ponte da criação portada das unidades do mapa (sim/exe/create.ts: 0x511959 monstro, 0x5145d1 humano) para o motor: o registro
 * criado do modelo cru (unit-templates.json `raw`/`rawItems`) vira os `UnitStats` (que `World.syncCombat` escreve de volta no registro a
 * cada tique) e os campos do registro que o motor não reescreve (atributos, bônus, experiência) passam à unidade criada.
 * Etapa 9b, lote 2 (notes/carregador.md); medido com `npm run loadcmp`.
 */
import { createFromTemplate, itemFromJson, type CreateItem, type CreateTemplate, type ItemJsonLike } from "../sim/exe/create";
import { UnitRec, type WorldRec } from "../sim/exe/types";
import type { TemplateJson } from "../sim/stats";
import type { UnitStats } from "../sim/types";

const WTYPE = [undefined, "blade", "axe", "bludgeon", "pike", "shooting"] as const;
const SCHOOLS = ["fire", "water", "air", "earth", "astral"] as const;
const s16 = (v: number) => (v << 16) >> 16;

export interface CreatedUnit { rec: UnitRec; stats: UnitStats }

/** Os itens do modelo, na posição do texto em `rawItems` (o `equipment` de derive.py é a mesma lista sem os textos vazios). */
function itemsOf(t: TemplateJson & { rawItems: string[] }, items: Record<string, ItemJsonLike> | undefined): (CreateItem | null)[] {
  const eq = (t.equipment as { id: number | null }[] | undefined) ?? [];
  let k = 0;
  return t.rawItems.map(spec => {
    if (!spec) return null;
    const e = eq[k++];
    const j = e?.id != null ? items?.[String(e.id)] : undefined;
    return j ? itemFromJson(j, spec) : null;
  });
}

/** O registro de uma unidade de modelo pela criação portada, e os `UnitStats` dele sobre `base` (statsFor). Sem modelo cru: null. */
export function createMapUnit(wd: WorldRec, tpl: TemplateJson | undefined, base: UnitStats, items: Record<string, ItemJsonLike> | undefined): CreatedUnit | null {
  const raw = tpl?.raw as number[] | undefined, rawItems = tpl?.rawItems as string[] | undefined;
  if (!tpl || !Array.isArray(raw) || !Array.isArray(rawItems)) return null;
  const human = tpl.kind === "human" || tpl.kind === "hero";
  const t: CreateTemplate = { name: String(tpl.template ?? ""), raw, rawItems };
  const rec = new UnitRec();
  const created = createFromTemplate(wd, rec, t, human, itemsOf(tpl as TemplateJson & { rawItems: string[] }, items));
  const d = rec.dmg, st: UnitStats = { ...base };
  st.health = Math.max(1, s16(rec.f96));
  st.mana = Math.max(0, s16(rec.f9c));
  st.healthRegen = s16(rec.f98); st.manaRegen = s16(rec.f9e);
  st.speed = s16(rec.speed) / 16; st.turnSpeed = rec.walk.turnRate & 0xff;
  st.sight = rec.fa5;
  st.attack = s16(d.atk);
  st.damage = { min: d.dmin & 0xff, max: (d.dmin & 0xff) + (d.dadd & 0xff) };
  st.defense = s16(rec.fbe); st.absorption = s16(rec.fc0);
  st.resist = { fire: s16(rec.prot[1]!), water: s16(rec.prot[2]!), air: s16(rec.prot[3]!), earth: s16(rec.prot[4]!), astral: s16(rec.prot[5]!) };
  st.resistPhysical = Object.fromEntries(WTYPE.slice(1).map((k, i) => [k!, rec.resist[i + 1]!]));
  st.elemental = d.elA0 || d.elA1 || d.elB0 || d.elB1 || d.elK ? { aBase: d.elA0, aRange: d.elA1, bBase: d.elB0, bRange: d.elB1, element: d.elK } : undefined;
  st.attackType = WTYPE[d.wtype & 0xff];
  st.charge = rec.f134; st.relax = rec.f135;
  st.range = Math.max(1, rec.attackRange & 0xff);
  st.alwaysHit = (rec.f4c & 0x10) !== 0;
  st.seeInvisible = rec.ai.f71; st.withdraw = rec.ai.f40; st.wimpy = rec.ai.f44;
  st.mind = s16(rec.f88); st.reaction = s16(rec.f86);
  st.magicSkills = Object.fromEntries(SCHOOLS.map((k, i) => [k, s16(d.sk[i + 1]!)]));
  // livro: o do modelo (máscara; humanos só com mana) — as magias de chance ficam em `procSpells` (o livro espelhado as junta)
  const mask = raw[0x38]! >>> 0;
  if (human || (mask !== 0 && mask !== 0xffffffff && raw.length > 0x37)) st.spellIds = created.book;
  else delete st.spellIds;
  if (!st.spellIds?.length) delete st.spellIds;
  return { rec, stats: st };
}

/** Os campos do registro criado que o motor não reescreve a partir dos `UnitStats` (atributos, bônus de itens, experiência, modelo). */
export function applyCreatedRec(dst: UnitRec, src: UnitRec): void {
  dst.f84 = src.f84; dst.f88 = src.f88; dst.f8a = src.f8a;
  dst.f8e = src.f8e; dst.f90 = src.f90; dst.f92 = src.f92;
  dst.skBase.set(src.skBase); dst.f130 = src.f130; dst.f1c = src.f1c; dst.f4b = src.f4b; dst.f0c = src.f0c; dst.f14c = src.f14c;
  dst.f23c.set(src.f23c);
  dst.fd4 = src.fd4; dst.fd5 = src.fd5; dst.fd6 = src.fd6; dst.fd7 = src.fd7; dst.fd8 = src.fd8; dst.fda = src.fda; dst.fdc = src.fdc;
  dst.fde = src.fde; dst.fe0 = src.fe0; dst.fe2 = src.fe2; dst.fe4 = src.fe4;
  Object.assign(dst.bdmg, { ...src.bdmg, sk: dst.bdmg.sk }); dst.bdmg.sk.set(src.bdmg.sk);
  Object.assign(dst.bdef, { ...src.bdef, prot: dst.bdef.prot, resist: dst.bdef.resist }); dst.bdef.prot.set(src.bdef.prot); dst.bdef.resist.set(src.bdef.resist);
  dst.ai.f4c = src.ai.f4c;
  dst.ai.f7c.set(src.ai.f7c); dst.ai.f88.set(src.ai.f88);
}

/** O carregador 0x561bf9 depois da criação (e da vtable+0x58): vida máx. (+0x22 da unidade do .alm) e vida (+0x20), −1 (ausente no
 *  JSON) = as do modelo; numa unidade humana (bit 0x10) com as duas iguais valem as do modelo. Devolve a vida inicial. */
export function applyAlmHealth(c: CreatedUnit, human: boolean, hp: number | undefined, maxHp: number | undefined): number {
  let h = hp ?? -1, mh = maxHp ?? -1;
  if (human && mh !== -1 && mh === h) { h = -1; mh = -1; }
  if (mh !== -1) c.rec.f96 = s16(mh);
  c.rec.f94 = h === -1 ? c.rec.f96 : s16(h);
  c.stats.health = Math.max(1, s16(c.rec.f96));
  return s16(c.rec.f94);
}
