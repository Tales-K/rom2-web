/**
 * Estoque das lojas (puro). Configuração [cidade][prateleira] = {min,max,count,qty,mask} no estado da campanha (Scenario.dll);
 * candidatos de cada prateleira em data/campaign-shops.json (gerados pelo exe a partir da máscara, na progressão canônica).
 *
 * Geração (exe 0x5254e7): sorteia `count` candidatos (com reposição; pesos 1,6^k não decifrados → uniforme), cada um com
 * 1 + rand(qty) unidades; livros+poções: as 6 poções fixas sempre, com 50 + rand(50) unidades [exe 0x525f67].
 * Semente estável por save + cidade + estágio: reabrir a loja mostra o mesmo estoque até o estágio (ou a máscara) mudar.
 * Bit Elven (0x80000) acrescentado à prateleira 3 da loja druida (conversa 675/78): candidatos = itens Elven do items.json com
 * material da máscara e preço na faixa (aproximação: campaign-shops.json não tem essa variante).
 */
import { hashSeed, rng, stageOf } from "./engine";
import type { CampaignState, PoolItem, ShopsData, StockItem, TownStock } from "./types";

const MAT_BITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];   // bit k -> material (Bone, 13, é pulado) [exe 0x524c77]
const MATERIALS = ["Iron", "Bronze", "Steel", "Silver", "Gold", "Mithrill", "Adamantium", "Meteoric", "Wood", "Magic Wood", "Leather",
  "Hard Leather", "Dragon Leather", "Bone", "Crystal", "None"];
export const ELVEN_BIT = 0x80000;

/** Chave de estágio do campaign-shops.json: a maior ≤ estágio (ou a menor). */
export function stageKey(keys: string[], stage: number): string | undefined {
  const ns = keys.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  let best: number | undefined;
  for (const n of ns) if (n <= stage) best = n;
  return String(best ?? ns[0]);
}

/** Categoria (para itens vendidos pelo jogador) de cada prateleira pela máscara. */
export function shelfAccepts(mask: number): { weapons: boolean; armor: boolean; shields: boolean; mageArmor: boolean; books: boolean; magic: boolean } {
  return {
    weapons: !!(mask & 0x1000000), armor: !!(mask & 0x400000), shields: !!(mask & 0x800000),
    mageArmor: !!(mask & 0x8000000) && !!(mask & 0x20000000), books: !!(mask & 0x4000000), magic: !!(mask & 0x20000000),
  };
}

export function generateStock(st: CampaignState, shops: ShopsData, town: number, pool: PoolItem[] = []): TownStock {
  const stage = stageOf(st);
  const cfg = st.shops[String(town)] ?? [];
  const byStage = shops.towns[String(town)] ?? {};
  const sk = stageKey(Object.keys(byStage), stage);
  const data = sk ? byStage[sk] ?? [] : [];
  const key = `${sk}|${cfg.map(c => `${c.mask >>> 0}:${c.min}:${c.max}`).join(",")}`;
  const r = rng(hashSeed(st.seed, town, key));
  const shelves: StockItem[][] = [];
  for (let s = 0; s < 4; s++) {
    const d = data.find(x => x.shelf === s);
    const c = cfg[s] ?? (d ? { min: d.min, max: d.max, count: d.count, qty: d.qty, mask: parseInt(d.mask, 16) } : undefined);
    const items = new Map<string, StockItem>();
    const add = (it: StockItem) => {
      const e = items.get(it.id);
      if (e) e.count += it.count; else items.set(it.id, { ...it });
    };
    if (!c) { shelves.push([]); continue; }
    const lo = c.min ?? 0, hi = c.max ?? Infinity;
    const cands: StockItem[] = [];
    const fixed: StockItem[] = [];
    for (const k of d?.candidates ?? []) {
      if (k.id === null || k.price === null || k.inItemsJson === false) continue;
      const it: StockItem = {
        id: k.spell !== undefined ? `${k.id}#${k.spell}` : String(k.id), base: k.id, name: k.name, price: k.price, count: 1,
        ...(k.spell !== undefined ? { spell: k.spell } : {}),
      };
      if (k.fixed) fixed.push(it);
      else if (k.spell !== undefined || (k.price >= lo && k.price <= hi) || (c.mask & 0x20000000)) cands.push(it);
    }
    if ((c.mask & ELVEN_BIT) && town === 3) {
      const mats = new Set(MAT_BITS.filter((_, k) => (c.mask >>> k) & 1).map(i => MATERIALS[i]));
      for (const p of pool) {
        if (p.shape !== "Elven" || !p.material || !mats.has(p.material) || p.price < lo || p.price > hi) continue;
        if (!["weapon", "armor", "shield"].includes(p.kind ?? "")) continue;
        cands.push({ id: String(p.id), base: p.id, name: p.name, price: p.price, count: 1 });
      }
    }
    if (cands.length) {
      for (let n = 0; n < c.count; n++) {
        const it = cands[Math.floor(r() * cands.length)];
        add({ ...it, count: 1 + Math.floor(r() * Math.max(1, c.qty)) });
      }
    }
    for (const f of fixed) add({ ...f, count: 50 + Math.floor(r() * 50) });
    shelves.push([...items.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name)));
  }
  return { key, shelves };
}

/**
 * Estoque atual da loja da cidade (gera e guarda em `st.stock` se o estágio/configuração mudou).
 * O estoque persiste no save: compras e vendas o alteram (takeFromStock/putInStock).
 */
export function shopStock(st: CampaignState, shops: ShopsData, town: number, pool: PoolItem[] = []): TownStock {
  const fresh = generateStock(st, shops, town, pool);
  const cur = st.stock[String(town)];
  if (cur && cur.key === fresh.key) return cur;
  st.stock[String(town)] = fresh;
  return fresh;
}

export function takeFromStock(st: CampaignState, town: number, shelf: number, id: string, n = 1): boolean {
  const s = st.stock[String(town)]?.shelves[shelf];
  const it = s?.find(x => x.id === id);
  if (!s || !it || it.count < n) return false;
  it.count -= n;
  if (it.count <= 0) s.splice(s.indexOf(it), 1);
  return true;
}

/** Item vendido pelo jogador vai para a prateleira cuja máscara aceita a categoria [exe 0x521d4c]. */
export function putInStock(st: CampaignState, town: number, item: StockItem, kind: "weapon" | "armor" | "shield" | "mageArmor" | "book" | "other"): number {
  const stock = st.stock[String(town)];
  const cfg = st.shops[String(town)] ?? [];
  if (!stock) return -1;
  let shelf = cfg.findIndex(c => {
    const a = shelfAccepts(c.mask);
    return kind === "weapon" ? a.weapons : kind === "armor" ? a.armor : kind === "shield" ? a.shields : kind === "mageArmor" ? a.mageArmor : kind === "book" ? a.books : false;
  });
  if (shelf < 0) shelf = cfg.findIndex(c => shelfAccepts(c.mask).magic);
  if (shelf < 0) shelf = 0;
  const s = stock.shelves[shelf] ?? (stock.shelves[shelf] = []);
  const e = s.find(x => x.id === item.id);
  if (e) e.count += item.count; else s.push({ ...item });
  return shelf;
}
