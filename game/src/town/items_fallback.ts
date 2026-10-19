/**
 * Catálogo PROVISÓRIO de itens (frente CIDADE), usado enquanto `data/items.json` (frente DADOS) não existe
 * ou quando um id não aparece nele. Os ícones são os `.16a` reais de graphics/inventory (convertidos por tools/pipeline/town.py);
 * nomes, preços e valores abaixo são estimativas — ver docs/GAPS.md.
 */

export type Shelf = "weapon" | "armor" | "magic" | "potion";
/** nomes de slot do items.json: weapon, shield, helm, cuirass, mail, bracers, gauntlets, boots, amulet, ring (ou "none") */
export type SlotId = string;

export interface ItemDef {
  id: string;
  name: string;
  shelf: Shelf;
  slot: SlotId;
  price: number;
  /** nome do arquivo em assets/ui/shop/icons/<icon>.webp */
  icon: string;
  damage?: [number, number];
  defense?: number;
  absorption?: number;
  weight?: number;
  twoHanded?: boolean;
  desc?: string;
  kind?: string;
  shape?: string;
  material?: string;
  usableBy?: string[];
}

const w = (id: string, name: string, icon: string, price: number, dmg: [number, number], weight: number, extra: Partial<ItemDef> = {}): ItemDef =>
  ({ id, name, shelf: "weapon", slot: "weapon", price, icon, damage: dmg, weight, ...extra });
const a = (id: string, name: string, icon: string, slot: SlotId, price: number, defense: number, absorption: number, weight: number): ItemDef =>
  ({ id, name, shelf: "armor", slot, price, icon, defense, absorption, weight });

export const FALLBACK_ITEMS: ItemDef[] = [
  w("dagger", "Dagger", "0001002", 25, [2, 5], 1),
  w("short_sword", "Short Sword", "0001003", 60, [4, 9], 3),
  w("long_sword", "Long Sword", "0001004", 140, [6, 13], 4),
  w("broad_sword", "Broadsword", "0001006", 300, [9, 19], 6, { twoHanded: true }),
  w("morning_star", "Morning Star", "0001008", 120, [5, 12], 5),
  w("mace", "Mace", "0001009", 80, [4, 10], 4),
  w("flail", "Flail", "0001010", 110, [5, 12], 5),
  w("war_hammer", "War Hammer", "0001011", 170, [7, 15], 7),
  w("maul", "Maul", "0001012", 260, [10, 20], 11, { twoHanded: true }),
  w("spear", "Spear", "0001015", 70, [4, 10], 4),
  w("pike", "Pike", "0001017", 130, [6, 14], 6, { twoHanded: true }),
  w("battle_axe", "Battle Axe", "0001018", 190, [8, 16], 7),
  w("flanged_mace", "Flanged Mace", "0001019", 210, [8, 15], 7),
  w("hand_axe", "Hand Axe", "0001518", 55, [3, 8], 3),
  a("buckler", "Buckler", "0002001", "shield", 50, 2, 1, 2),
  a("round_shield", "Round Shield", "0002002", "shield", 120, 4, 2, 4),
  a("open_helm", "Open Helm", "0005002", "helm", 70, 2, 1, 2),
  a("full_helm", "Full Helm", "0006006", "helm", 150, 4, 2, 4),
  a("cuirass", "Cuirass", "0006010", "cuirass", 220, 6, 3, 9),
  a("mail_shirt", "Mail Shirt", "0008019", "mail", 160, 5, 2, 7),
  a("gauntlets", "Gauntlets", "0009020", "gauntlets", 60, 1, 1, 2),
  a("shoulder_plates", "Shoulder Plates", "0009022", "cuirass", 90, 3, 1, 3),
  a("bracers", "Bracers", "0010026", "bracers", 70, 2, 1, 2),
  a("greaves", "Greaves", "0012030", "boots", 110, 3, 2, 5),
  { id: "scroll_fire", name: "Scroll of Fire", shelf: "potion", slot: "none", price: 40, icon: "0014024", weight: 0, desc: "Single-use scroll." },
  { id: "scroll_heal", name: "Scroll of Healing", shelf: "potion", slot: "none", price: 55, icon: "0014012", weight: 0, desc: "Single-use scroll." },
  { id: "book_arcane", name: "Book of Spells", shelf: "magic", slot: "none", price: 200, icon: "0014001", weight: 1, desc: "A spell book." },
  { id: "book_water", name: "Book of Water", shelf: "magic", slot: "none", price: 220, icon: "0014002", weight: 1, desc: "A spell book." },
  { id: "book_earth", name: "Book of Earth", shelf: "magic", slot: "none", price: 220, icon: "0014003", weight: 1, desc: "A spell book." },
  { id: "wand_sparks", name: "Wand of Sparks", shelf: "magic", slot: "none", price: 180, icon: "0014036", weight: 1, desc: "A minor magic wand." },
];

/** Equipamento inicial usado só quando a cena é aberta sem herói (teste direto por #cena=...). Ids de data/items.json (260 = Iron Long Sword...). */
export const TEST_HERO_KIT = {
  inventory: ["4354", "3654", "3654", "4609", "5638"],
  equipment: { weapon: "260", cuirass: "2067", boots: "3102", bracers: "2326", gauntlets: "2586", mail: "46863" } as Record<string, string>,
};
