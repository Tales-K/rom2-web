/**
 * Inventário do herói na missão (lógica, sem PixiJS): mochila (`hero.inventory`), equipamento (`hero.equipment`) e ouro, sempre
 * gravados direto em `game.state.hero` (o save do meio da missão leva o herói junto do snapshot).
 *
 * Ponte com a simulação: o `Unit.items` do herói é um ESPELHO de tudo que ele carrega (mochila + vestido), porque os valores do
 * script ("unit has item", "Item to point") e o "Give All"/saques da sim mexem em `Unit.items`. `absorb()` traz para a mochila o que
 * a sim acrescentou (saco recolhido, Give All de Skrakan) e tira o que o script removeu; depois a cena regrava o espelho.
 *
 * Regras (docs/GAPS.md): slots = os de items.json (weapon, shield, helm, cuirass, mail, bracers, gauntlets, boots, amulet, ring);
 * arma de duas mãos tira o escudo; `usableBy` filtra por classe; itens idênticos empilham; carga = peso/2 contra Body×10+1
 * (a fórmula de velocidade de `heroDerived`, allods2.exe 0x51366b).
 */
import type { HeroState } from "../core/state";
import type { ItemDef, MissionData } from "./setup";

export const EQUIP_SLOTS = ["weapon", "shield", "helm", "cuirass", "mail", "bracers", "gauntlets", "boots", "amulet", "ring"] as const;
export type EquipSlot = typeof EQUIP_SLOTS[number];

export interface UseEffect {
  health?: number; mana?: number;
  /** atributos permanentes (Potion of Body/Mind/Reaction/Spirit) */
  attrs?: Partial<Record<"body" | "mind" | "agility" | "spirit", number>>;
  /** efeito temporário (regeneração/absorção) */
  timed?: { kind: "healthRegen" | "manaRegen" | "absorption"; amount: number; seconds: number };
  /** pergaminho: id da magia e poder */
  scroll?: { spell: number; power: number };
}

type Bag = Map<string, number>;
const bagOf = (ids: string[]): Bag => { const m: Bag = new Map(); for (const i of ids) m.set(i, (m.get(i) ?? 0) + 1); return m; };

export class HeroInventory {
  /** espelho da última sincronização com `Unit.items` */
  private last: string[] = [];

  constructor(public hero: HeroState, private readonly data: MissionData) {
    hero.inventory ??= [];
    hero.equipment ??= {};
  }

  def(id: string): ItemDef | undefined { return this.data.items?.[id]; }
  name(id: string): string { return String(this.def(id)?.name ?? `Item ${id}`); }
  kind(id: string): string { return String(this.def(id)?.kind ?? ""); }
  isQuest(id: string): boolean { return this.kind(id) === "quest"; }
  slotOf(id: string): EquipSlot | undefined {
    const s = String(this.def(id)?.slot ?? "none");
    return (EQUIP_SLOTS as readonly string[]).includes(s) ? s as EquipSlot : undefined;
  }
  usableByHero(id: string): boolean {
    const u = this.def(id)?.usableBy;
    return !u || !u.length || u.includes(this.hero.heroClass);
  }
  /** usável com clique direito (poção, pergaminho) */
  consumable(id: string): boolean { const k = this.kind(id); return k === "potion" || k === "scroll"; }

  // ------------------------------------------------------------------ peso / carga
  weight(): number {
    let w = 0;
    for (const id of Object.values(this.hero.equipment)) if (id) w += Number(this.def(id)?.weight) || 0;
    for (const e of this.hero.inventory) w += (Number(this.def(e.id)?.weight) || 0) * Math.max(1, e.count ?? 1);
    return w;
  }
  /** capacidade (heroDerived: carga = peso/2 ≥ Body×10+1 reduz a velocidade) */
  capacity(): number { return Math.max(1, (this.hero.stats?.body ?? 20) * 10 + 1); }
  overloaded(): boolean { return Math.floor(this.weight() / 2) >= this.capacity(); }

  // ------------------------------------------------------------------ mochila
  count(i: number): number { return Math.max(1, this.hero.inventory[i]?.count ?? 1); }

  add(id: string, n = 1, at?: number): void {
    const inv = this.hero.inventory;
    const e = inv.find(x => x.id === id);
    if (e) { e.count = Math.max(1, e.count ?? 1) + n; return; }
    const ne = n > 1 ? { id, count: n } : { id };
    if (at !== undefined && at >= 0 && at < inv.length) inv.splice(at, 0, ne); else inv.push(ne);
  }

  /** tira `n` unidades da posição `i`; devolve o id */
  take(i: number, n = 1): string | undefined {
    const inv = this.hero.inventory;
    const e = inv[i];
    if (!e) return undefined;
    const c = Math.max(1, e.count ?? 1);
    if (c > n) e.count = c - n; else inv.splice(i, 1);
    return e.id;
  }

  /** move a pilha `from` para a posição `to` (reordenar na barra) */
  move(from: number, to: number): void {
    const inv = this.hero.inventory;
    if (from === to || !inv[from]) return;
    const [e] = inv.splice(from, 1);
    inv.splice(Math.max(0, Math.min(inv.length, to)), 0, e!);
  }

  // ------------------------------------------------------------------ equipamento
  /** Equipa o item da posição `i` da mochila. Devolve a mensagem de erro ou "" se deu certo. */
  equipFromPack(i: number): string {
    const e = this.hero.inventory[i];
    if (!e) return "";
    const err = this.canEquip(e.id);
    if (err) return err;
    const id = this.take(i)!;
    this.equip(id, i);
    return "";
  }

  canEquip(id: string): string {
    const slot = this.slotOf(id);
    if (!slot) return this.consumable(id) ? "" : "This item cannot be worn";
    if (!this.usableByHero(id)) return `${this.hero.heroClass === "mage" ? "Mages" : "Fighters"} cannot use this item`;
    if (slot === "shield") {
      const w = this.hero.equipment.weapon;
      if (w && this.def(w)?.twoHanded) return "";   // a arma de duas mãos volta para a mochila (abaixo)
    }
    return "";
  }

  /** veste `id` (já fora da mochila); o que estava no slot (e o escudo, se a arma for de duas mãos) volta para a mochila */
  equip(id: string, packPos?: number): void {
    const slot = this.slotOf(id);
    if (!slot) { this.add(id, 1, packPos); return; }
    const eq = this.hero.equipment;
    const old = eq[slot];
    if (old) this.add(old, 1, packPos);
    eq[slot] = id;
    if (slot === "weapon" && this.def(id)?.twoHanded && eq.shield) { this.add(eq.shield); eq.shield = undefined; }
    if (slot === "shield" && eq.weapon && this.def(eq.weapon)?.twoHanded) { this.add(eq.weapon); eq.weapon = undefined; }
    for (const k of Object.keys(eq)) if (!eq[k]) delete eq[k];
  }

  /** tira o item do slot (vai para a mochila na posição `at`, ou devolve o id se `toPack` = false) */
  unequip(slot: string, toPack = true, at?: number): string | undefined {
    const id = this.hero.equipment[slot];
    if (!id) return undefined;
    delete this.hero.equipment[slot];
    if (toPack) this.add(id, 1, at);
    return id;
  }

  // ------------------------------------------------------------------ uso
  /** Efeito de uma poção/pergaminho (items.json `effects`/`spell`). Não consome: a cena chama `take` se aplicar. */
  useEffect(id: string): UseEffect | null {
    const d = this.def(id);
    if (!d) return null;
    const fx = (d.effects ?? {}) as Record<string, number>;
    const dur = Number(/duration\s+(\d+)/i.exec(String(d.effectsText ?? ""))?.[1] ?? 0);
    if (d.kind === "scroll") {
      const sp = Number(d.spell ?? 0);
      return sp > 0 ? { scroll: { spell: sp, power: Number(d.spellPower ?? 50) } } : null;
    }
    if (d.kind !== "potion") return null;
    const out: UseEffect = {};
    if (fx.health) out.health = fx.health;
    if (fx.mana) out.mana = fx.mana;
    const attrs: UseEffect["attrs"] = {};
    if (fx.body) attrs.body = fx.body;
    if (fx.mind) attrs.mind = fx.mind;
    if (fx.reaction) attrs.agility = fx.reaction;
    if (fx.spirit) attrs.spirit = fx.spirit;
    if (Object.keys(attrs).length) out.attrs = attrs;
    if (fx.healthRegeneration) out.timed = { kind: "healthRegen", amount: fx.healthRegeneration, seconds: dur || 60 };
    else if (fx.manaRegeneration) out.timed = { kind: "manaRegen", amount: fx.manaRegeneration, seconds: dur || 60 };
    else if (fx.absorbtion || fx.absorption) out.timed = { kind: "absorption", amount: fx.absorbtion || fx.absorption!, seconds: dur || 30 };
    // poções antigas sem efeitos no JSON: pelo nome
    if (!Object.keys(out).length) { const n = this.name(id); if (/mana/i.test(n)) out.mana = 30; else if (/heal/i.test(n)) out.health = 30; }
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------------ espelho na simulação
  /** todos os ids carregados (mochila expandida pelas quantidades + vestidos) */
  mirror(): string[] {
    const out: string[] = [];
    for (const e of this.hero.inventory) for (let k = 0; k < Math.max(1, e.count ?? 1); k++) out.push(e.id);
    for (const id of Object.values(this.hero.equipment)) if (id) out.push(id);
    return out;
  }

  /** marca o espelho atual como sincronizado (depois de montar/restaurar a missão) */
  markSynced(items: string[]): void { this.last = [...items]; }

  /**
   * Compara `Unit.items` com o último espelho: o que entrou vai para a mochila (devolvido em `added`), o que saiu é tirado
   * (mochila primeiro, depois equipamento). Devolve o novo espelho para a cena gravar em `Unit.items`.
   */
  absorb(items: string[]): { mirror: string[]; added: string[]; removed: string[] } {
    const cur = bagOf(items), prev = bagOf(this.last);
    const added: string[] = [], removed: string[] = [];
    for (const [id, n] of cur) for (let k = prev.get(id) ?? 0; k < n; k++) added.push(id);
    for (const [id, n] of prev) for (let k = cur.get(id) ?? 0; k < n; k++) removed.push(id);
    for (const id of added) this.add(id);
    for (const id of removed) {
      const i = this.hero.inventory.findIndex(e => e.id === id);
      if (i >= 0) this.take(i);
      else { const slot = Object.keys(this.hero.equipment).find(s => this.hero.equipment[s] === id); if (slot) delete this.hero.equipment[slot]; }
    }
    const m = this.mirror();
    this.last = [...m];
    return { mirror: m, added, removed };
  }

  // ------------------------------------------------------------------ descrição (dica)
  /**
   * Dica do item como o original a mostra sobre a boneca e a barra (refs/original/m10_hover_portrait e grade de dicas): nome, "Damage a-b",
   * "Attack +n", "Defense +n", "Absorption +n" — sem peso nem preço. Efeitos de poções/pergaminhos e "Not usable" são extensões nossas
   * (o herói da missão 10 só tem armadura e uma espada; não há captura de poção).
   */
  hintLines(id: string): string[] {
    const d = this.def(id);
    const L: string[] = [this.name(id)];
    if (!d) return L;
    const dmg = d.damage as { min: number; max: number } | undefined;
    if (dmg && (dmg.min || dmg.max)) L.push(`Damage ${dmg.min}-${dmg.max}`);
    if (d.toHit) L.push(`Attack +${d.toHit}`);
    if (d.defense) L.push(`Defense +${d.defense}`);
    if (d.absorption) L.push(`Absorption +${d.absorption}`);
    const fx = Array.isArray(d.effectsText) ? (d.effectsText as string[]).join("; ") : String(d.effectsText ?? "");
    if (fx) for (const part of fx.split(/;\s*/)) if (part) L.push(prettyEffect(part));
    if (d.kind === "scroll" && d.spellName) L.push(`Spell: ${d.spellName}`);
    if (!this.usableByHero(id)) L.push(`Not usable by ${this.hero.heroClass === "mage" ? "mages" : "fighters"}`);
    return L;
  }

  /** Linhas da dica do item: nome, dano/defesa/absorção, efeitos, peso, preço, classe. */
  describe(id: string): { lines: string[]; usable: boolean } {
    const d = this.def(id);
    if (!d) return { lines: [this.name(id)], usable: true };
    const L: string[] = [this.name(id)];
    const dmg = d.damage as { min: number; max: number } | undefined;
    if (dmg && (dmg.min || dmg.max)) L.push(`Damage ${dmg.min}-${dmg.max}`);
    if (d.toHit) L.push(`Attack +${d.toHit}`);
    if (d.defense) L.push(`Defense +${d.defense}`);
    if (d.absorption) L.push(`Absorb +${d.absorption}`);
    if (d.twoHanded) L.push("Two-handed");
    const fx = Array.isArray(d.effectsText) ? (d.effectsText as string[]).join("; ") : String(d.effectsText ?? "");
    if (fx) for (const part of fx.split(/;\s*/)) if (part) L.push(prettyEffect(part));
    if (d.kind === "scroll" && d.spellName) L.push(`Spell: ${d.spellName}`);
    if (d.kind === "quest") L.push("Quest item");
    if (d.weight) L.push(`Weight ${d.weight}`);
    if (d.price && d.kind !== "quest") L.push(`Price ${d.price}`);
    const usable = this.usableByHero(id);
    if (!usable) L.push(`Not usable by ${this.hero.heroClass === "mage" ? "mages" : "fighters"}`);
    return { lines: L, usable };
  }
}

/** "health=+30" -> "Health +30"; "absorbtion=+50: duration 30" -> "Absorb +50 (30 s)" */
function prettyEffect(s: string): string {
  const m = /^(\w+)\s*=\s*([+-]?\d+)(?::\s*duration\s+(\d+))?/i.exec(s.trim());
  if (!m) return s.trim();
  const names: Record<string, string> = {
    health: "Health", mana: "Mana", absorbtion: "Absorb", absorption: "Absorb", body: "Body", mind: "Mind", reaction: "Agility", spirit: "Spirit",
    healthRegeneration: "Health regeneration", manaRegeneration: "Mana regeneration", defence: "Defense", defense: "Defense",
  };
  const v = Number(m[2]);
  return `${names[m[1]!] ?? m[1]} ${v >= 0 ? "+" : ""}${v}${m[3] ? ` (${m[3]} s)` : ""}`;
}
