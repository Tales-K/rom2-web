import type { Game } from "../core/game";
import type { HeroState } from "../core/state";
import { FALLBACK_ITEMS, type ItemDef, type Shelf, type SlotId } from "./items_fallback";

export type { ItemDef, Shelf, SlotId };

/** Campos de data/items.json (frente DADOS) que esta frente usa. */
interface RawItem {
  id?: number; name?: string; price?: number; kind?: string; slot?: string; slotId?: number; shape?: string; material?: string;
  weight?: number; defense?: number; absorption?: number; damage?: { min?: number; max?: number } | null; usableBy?: string[];
  twoHanded?: boolean; effectsText?: string[] | string; icon?: string | number;
}

/**
 * Catálogo de itens: `data/items.json` (frente DADOS) quando existe, senão o catálogo provisório (items_fallback.ts).
 * Ids desconhecidos viram itens genéricos. Nomes de slot seguem o items.json: weapon, shield, helm, cuirass, mail, bracers, gauntlets, boots, amulet, ring.
 */
export class ItemCatalog {
  private byId = new Map<string, ItemDef>();
  /** nomes de arquivo de ícone disponíveis em assets/ui/shop/icons */
  icons = new Set<string>();
  private iconList: string[] = [];
  fromJson = false;

  static async load(game: Game): Promise<ItemCatalog> {
    const c = new ItemCatalog();
    const meta = await game.data.tryJson<{ icons?: string[] }>("assets/ui/shop/shop.json");
    for (const n of meta?.icons ?? []) c.icons.add(n);
    c.iconList = [...c.icons].sort();
    const raw = await game.data.tryJson<Record<string, RawItem>>("data/items.json");
    if (raw && typeof raw === "object") {
      for (const [key, r] of Object.entries(raw)) {
        const d = c.normalize(key, r);
        if (d) c.byId.set(key, d);
      }
      c.fromJson = c.byId.size > 0;
    }
    if (!c.fromJson) for (const it of FALLBACK_ITEMS) c.byId.set(it.id, it);
    return c;
  }

  /** Ícone (graphics/inventory/AABBCCC.16a): o id do item guarda material (nibble alto), tipo (nibble baixo do byte alto) e variante (byte baixo). */
  private resolveIcon(r: RawItem): string {
    if (r.icon !== undefined) {
      const s = String(r.icon).replace(/\.(16a|png)$/i, "").padStart(7, "0");
      if (this.icons.has(s)) return s;
    }
    const id = Number(r.id ?? 0);
    const lo = id & 0xff, sl = (id >> 8) & 0xf, mat = (id >> 12) & 0xf;
    const p = (a: number, b: number, c: number) => `${String(a).padStart(2, "0")}${String(b).padStart(2, "0")}${String(c).padStart(3, "0")}`;
    for (const cand of [p(mat, sl, lo), p(mat, sl, lo + 100), p(0, sl, lo), p(0, sl, lo + 100), p(mat, sl, lo + 200)]) if (this.icons.has(cand)) return cand;
    // aproximação (ver GAPS): o ícone mais parecido do mesmo tipo (mesmo "slot") e variante mais próxima
    let best = "0014001", bestScore = Infinity;
    const slotStr = String(sl).padStart(2, "0");
    for (const ic of this.iconList) {
      if (ic.slice(2, 4) !== slotStr) continue;
      const score = Math.abs((Number(ic.slice(4)) % 100) - (lo % 100)) + (ic.slice(0, 2) === String(mat).padStart(2, "0") ? 0 : 3);
      if (score < bestScore) { bestScore = score; best = ic; }
    }
    return best;
  }

  private normalize(key: string, r: RawItem): ItemDef | undefined {
    if (!r || typeof r !== "object" || typeof r.name !== "string") return undefined;
    const slot = String(r.slot ?? "none");
    const kind = String(r.kind ?? "");
    let shelf: Shelf;
    if (kind === "weapon") shelf = "weapon";
    else if (kind === "armor" || kind === "shield") shelf = "armor";
    else if (kind === "scroll" || kind === "potion" || kind === "book") shelf = "potion";
    else shelf = "magic";
    if (slot === "amulet" || slot === "ring") shelf = "magic";
    const dmg = r.damage && typeof r.damage === "object" ? r.damage : undefined;
    const fx = Array.isArray(r.effectsText) ? r.effectsText.join("; ") : r.effectsText;
    const item: ItemDef = {
      id: key, name: r.name, shelf, slot, price: Number(r.price ?? 0) || 0, icon: this.resolveIcon(r),
      damage: dmg ? [Number(dmg.min ?? 0), Number(dmg.max ?? dmg.min ?? 0)] : undefined,
      defense: r.defense, absorption: r.absorption, weight: r.weight, twoHanded: r.twoHanded,
      desc: fx, kind, shape: r.shape, material: r.material, usableBy: r.usableBy,
    };
    return item;
  }

  get(id: string): ItemDef {
    return this.byId.get(String(id)) ?? { id: String(id), name: String(id).replace(/_/g, " "), shelf: "magic", slot: "none", price: 10, icon: "0014001" };
  }

  has(id: string): boolean { return this.byId.has(String(id)); }

  /**
   * Item à venda gerado pela campanha (campaign/shops.ts): livros levam a magia no id ("<id>#<magia>", nome "Book Fire (Fire
   * Arrow)", preço = bookCost); os demais já existem no items.json. Devolve a definição registrada.
   */
  registerStock(it: { id: string; base: number; name: string; price: number; spell?: number }): ItemDef {
    const cur = this.byId.get(it.id);
    if (cur) return cur;
    const base = this.byId.get(String(it.base));
    const def: ItemDef = base ? { ...base, id: it.id, name: it.name, price: it.price } : { id: it.id, name: it.name, shelf: "magic", slot: "none", price: it.price, icon: "0014001" };
    this.byId.set(it.id, def);
    return def;
  }

  /** Itens à venda numa prateleira da loja de Plagat (primeira cidade: só itens comuns e baratos; filtrados pela classe do herói). */
  stock(shelf: Shelf, hero?: HeroState): ItemDef[] {
    const out: ItemDef[] = [];
    for (const it of this.byId.values()) {
      if (it.shelf !== shelf || it.price <= 0) continue;
      if (hero && it.usableBy && it.usableBy.length && !it.usableBy.includes(hero.heroClass)) continue;
      if (this.fromJson) {
        if (it.name.startsWith("Magic ") || it.name === "Beard") continue;
        if (shelf === "weapon" || shelf === "armor") { if (it.shape !== "Common" || it.price > 900) continue; }
        else if (shelf === "magic") { if (it.price > 3000 || it.shape === "Bad") continue; }
        else if (it.price > 1500 || it.name.startsWith("Elven")) continue;
      } else if (it.price > 900) continue;
      out.push(it);
    }
    // variantes do mesmo nome (preços diferentes): mantém a mais barata
    const best = new Map<string, ItemDef>();
    for (const it of out) { const b = best.get(it.name); if (!b || it.price < b.price) best.set(it.name, it); }
    return [...best.values()].sort((x, y) => x.price - y.price || x.name.localeCompare(y.name));
  }

  iconPath(it: ItemDef): string {
    return `assets/ui/shop/icons/${this.icons.has(it.icon) || this.icons.size === 0 ? it.icon : "0014001"}.webp`;
  }

  /** Preço de venda: metade do de compra (aproximação — ver GAPS). */
  sellPrice(it: ItemDef): number { return Math.max(1, Math.floor(it.price / 2)); }
}
