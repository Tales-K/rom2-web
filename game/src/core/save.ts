/**
 * SaveManager: slots de jogo salvos (como os `game%d.sav` do original), persistidos em localStorage.
 *
 *   slot 0       = "Autosave" (escrito por GameState.save()/autosave: fim de missão, sair da cidade, compras...)
 *   slots 1..N   = saves manuais nomeados (tela "Save Game")
 *
 * Chaves: `allods2web.slot.<n>` = SaveFile (JSON) e `allods2web.slots.v2` = índice com os metadados (listar sem ler os blobs).
 * O índice é reconstruído varrendo os slots se estiver ausente/corrompido. JSON corrompido num slot nunca lança: o slot aparece
 * como "damaged" na lista e `read` devolve null. O save antigo (`allods2web.save.v1`) é migrado para o slot 0 uma vez.
 * Sem DOM obrigatório: o armazenamento é injetável (`StorageLike`), o que permite testar em Node (src/sim/test/savemanager.ts).
 */
import { SAVE_VERSION, migrateSaveData, placeLabel, type SaveData } from "./savedata";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTOSAVE_SLOT = 0;
/** Número de slots manuais (1..SLOT_COUNT). O original tem uma lista rolável de jogos salvos; o total máximo não foi decifrado. */
export const SLOT_COUNT = 40;
export const SLOT_PREFIX = "allods2web.slot.";
export const INDEX_KEY = "allods2web.slots.v2";
export const LEGACY_KEY = "allods2web.save.v1";
export const LEGACY_DONE_KEY = "allods2web.save.v1.migrated";
export const FILE_FORMAT = "allods2web-save";

export interface SlotMeta {
  slot: number;
  /** nome dado pelo jogador ("Autosave" no slot 0) */
  name: string;
  hero?: string;
  heroClass?: string;
  level?: number;
  /** "Plagat", "Quest 10"... */
  place: string;
  scene: "town" | "mission";
  mission?: number;
  /** Date.now() do save */
  date: number;
  version: number;
  bytes: number;
  /** o conteúdo do slot não pôde ser lido */
  damaged?: boolean;
}

/** Conteúdo de um slot (e do arquivo exportado). */
export interface SaveFile { format: typeof FILE_FORMAT; meta: SlotMeta; data: SaveData; }

export type WriteResult = { ok: true; meta: SlotMeta } | { ok: false; error: "quota" | "storage" | "slot" | "invalid"; message: string };

/** localStorage se existir e funcionar; senão um armazenamento em memória (o jogo roda, só não persiste). */
export function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) { const k = "allods2web.probe"; ls.setItem(k, "1"); ls.removeItem(k); return ls; }
  } catch { /* modo privado/bloqueado */ }
  return memoryStorage();
}

export function memoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

function isQuota(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | undefined;
  return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

/** Nível exibido: `hero.level` ou o maior nível de habilidade (exp(v) = int((1,1^v − 1) × 1000), docs/DATA.md). */
export function heroLevel(d: SaveData): number | undefined {
  const h = d.hero;
  if (!h) return undefined;
  if (typeof h.level === "number") return h.level;
  const se = h.skillExp;
  if (!se) return undefined;
  const best = Math.max(0, ...Object.values(se));
  let v = 0;
  while (v < 100 && Math.floor((Math.pow(1.1, v + 1) - 1) * 1000) <= best) v++;
  return v || undefined;
}

export class SaveManager {
  private index: Record<number, SlotMeta> | null = null;

  constructor(readonly storage: StorageLike = defaultStorage(), readonly slotCount = SLOT_COUNT) {}

  private key(slot: number): string { return SLOT_PREFIX + slot; }
  private validSlot(slot: number): boolean { return Number.isInteger(slot) && slot >= 0 && slot <= this.slotCount; }

  // ------------------------------------------------------------------ índice
  private loadIndex(): Record<number, SlotMeta> {
    if (this.index) return this.index;
    let idx: Record<number, SlotMeta> | null = null;
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { version?: number; slots?: SlotMeta[] };
        if (p && Array.isArray(p.slots)) {
          idx = {};
          for (const m of p.slots) if (m && this.validSlot(m.slot) && typeof m.name === "string") idx[m.slot] = m;
        }
      }
    } catch { idx = null; }
    if (!idx) idx = this.rebuildIndex();
    this.index = idx;
    return idx;
  }

  /** Varre os slots e refaz o índice (índice ausente ou corrompido). */
  rebuildIndex(): Record<number, SlotMeta> {
    const idx: Record<number, SlotMeta> = {};
    for (let s = 0; s <= this.slotCount; s++) {
      let raw: string | null = null;
      try { raw = this.storage.getItem(this.key(s)); } catch { raw = null; }
      if (raw == null) continue;
      const f = this.parseFile(raw);
      idx[s] = f ? { ...f.meta, slot: s, bytes: raw.length } : { slot: s, name: "Damaged save", place: "?", scene: "town", date: 0, version: 0, bytes: raw.length, damaged: true };
    }
    this.index = idx;
    this.saveIndex();
    return idx;
  }

  private saveIndex(): void {
    try { this.storage.setItem(INDEX_KEY, JSON.stringify({ version: SAVE_VERSION, slots: Object.values(this.index ?? {}) })); } catch { /* índice é só cache */ }
  }

  private parseFile(raw: string): SaveFile | null {
    try {
      const f = JSON.parse(raw) as Partial<SaveFile>;
      if (!f || f.format !== FILE_FORMAT || !f.meta) return null;
      const data = migrateSaveData(f.data);
      if (!data) return null;
      return { format: FILE_FORMAT, meta: f.meta as SlotMeta, data };
    } catch { return null; }
  }

  // ------------------------------------------------------------------ consultas
  /** Metadados de todos os slots (índice = número do slot; null = vazio). */
  list(): Array<SlotMeta | null> {
    this.migrateLegacy();
    const idx = this.loadIndex();
    return Array.from({ length: this.slotCount + 1 }, (_, s) => idx[s] ?? null);
  }

  meta(slot: number): SlotMeta | null { return this.list()[slot] ?? null; }

  hasAny(): boolean { return this.list().some(m => m && !m.damaged); }

  /** Slot mais recente (por data), ignorando os danificados. */
  latest(): SlotMeta | null {
    let best: SlotMeta | null = null;
    for (const m of this.list()) if (m && !m.damaged && (!best || m.date > best.date)) best = m;
    return best;
  }

  firstFreeSlot(): number {
    const l = this.list();
    for (let s = 1; s <= this.slotCount; s++) if (!l[s]) return s;
    return -1;
  }

  /** Lê e valida o conteúdo de um slot (null se vazio ou corrompido; marca o slot como danificado). */
  read(slot: number): SaveData | null {
    if (!this.validSlot(slot)) return null;
    this.migrateLegacy();
    let raw: string | null = null;
    try { raw = this.storage.getItem(this.key(slot)); } catch { return null; }
    if (raw == null) return null;
    const f = this.parseFile(raw);
    if (!f) {
      const idx = this.loadIndex();
      if (!idx[slot]?.damaged) {
        idx[slot] = { ...(idx[slot] ?? { slot, name: "Damaged save", place: "?", scene: "town", date: 0, version: 0 }), bytes: raw.length, damaged: true } as SlotMeta;
        this.saveIndex();
      }
      return null;
    }
    return f.data;
  }

  // ------------------------------------------------------------------ escrita
  makeMeta(slot: number, name: string, data: SaveData, date: number, missionTitle?: string): SlotMeta {
    return {
      slot, name: (name || "").trim().slice(0, 40) || (slot === AUTOSAVE_SLOT ? "Autosave" : `Saved game ${slot}`),
      hero: data.hero?.name, heroClass: data.hero?.heroClass, level: heroLevel(data),
      place: placeLabel(data, missionTitle), scene: data.location.scene, mission: data.location.mission,
      date, version: SAVE_VERSION, bytes: 0,
    };
  }

  write(slot: number, name: string, data: SaveData, opts: { date?: number; missionTitle?: string } = {}): WriteResult {
    if (!this.validSlot(slot)) return { ok: false, error: "slot", message: `Invalid slot ${slot}` };
    const clean = migrateSaveData(JSON.parse(JSON.stringify(data)));
    if (!clean) return { ok: false, error: "invalid", message: "Invalid game data" };
    const meta = this.makeMeta(slot, name, clean, opts.date ?? Date.now(), opts.missionTitle);
    const file: SaveFile = { format: FILE_FORMAT, meta, data: clean };
    let text = JSON.stringify(file);
    meta.bytes = text.length;
    text = JSON.stringify(file);
    try {
      this.storage.setItem(this.key(slot), text);
    } catch (err) {
      return isQuota(err)
        ? { ok: false, error: "quota", message: "Not enough storage space. Delete some saved games." }
        : { ok: false, error: "storage", message: "Could not write the saved game." };
    }
    this.loadIndex()[slot] = meta;
    this.saveIndex();
    return { ok: true, meta };
  }

  remove(slot: number): void {
    if (!this.validSlot(slot)) return;
    try { this.storage.removeItem(this.key(slot)); } catch { /* ignora */ }
    delete this.loadIndex()[slot];
    this.saveIndex();
  }

  // ------------------------------------------------------------------ exportar/importar
  /** Conteúdo de arquivo (JSON legível) para baixar; null se o slot estiver vazio/danificado. */
  exportSlot(slot: number): string | null {
    const data = this.read(slot);
    const meta = this.meta(slot);
    if (!data || !meta) return null;
    return JSON.stringify({ format: FILE_FORMAT, meta, data } satisfies SaveFile, null, 1);
  }

  /** Importa um arquivo exportado (ou um save v1 cru) para `slot`. */
  importText(text: string, slot: number): WriteResult {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ok: false, error: "invalid", message: "This file is not a saved game." }; }
    const p = parsed as Partial<SaveFile> & { version?: number };
    const data = migrateSaveData(p && p.format === FILE_FORMAT ? p.data : parsed);
    if (!data || !data.hero) return { ok: false, error: "invalid", message: "This file is not a saved game." };
    const name = p && p.format === FILE_FORMAT && typeof p.meta?.name === "string" ? p.meta.name : "Imported game";
    return this.write(slot, name, data, { date: p?.meta?.date && typeof p.meta.date === "number" ? p.meta.date : undefined });
  }

  // ------------------------------------------------------------------ migração do save v1
  private legacyChecked = false;

  /** Copia `allods2web.save.v1` para o slot 0 (uma vez; a chave antiga fica intacta). Devolve true se migrou agora. */
  migrateLegacy(): boolean {
    if (this.legacyChecked) return false;
    this.legacyChecked = true;
    try {
      if (this.storage.getItem(LEGACY_DONE_KEY)) return false;
      const raw = this.storage.getItem(LEGACY_KEY);
      if (!raw) return false;
      const data = migrateSaveData(raw);
      if (!data || !data.hero) { this.storage.setItem(LEGACY_DONE_KEY, "invalid"); return false; }
      const idx = this.loadIndex();
      if (idx[AUTOSAVE_SLOT]) { this.storage.setItem(LEGACY_DONE_KEY, "skipped"); return false; }
      const r = this.write(AUTOSAVE_SLOT, "Autosave", data, { date: Date.now() });
      if (r.ok) this.storage.setItem(LEGACY_DONE_KEY, "1");
      return r.ok;
    } catch { return false; }
  }
}
