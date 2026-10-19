import type { Game } from "../core/game";

/**
 * Vozes dos lojistas (speech/shop, shop_druid, shop_kaarg). Regra decifrada em notes/voices.md (conferida contra data/items.json:
 * os 110 arquivos `s<NN>i<MM>p<K>` de cada loja caem em classes de item que existem):
 *   - `s<NN>i<MM>p<K>`: NN = (id do item >> 8) & 15 (slot: 1 arma, 2 escudo, 6 elmo, 8 peitoral, 9 braceletes, 10 luvas, 12 botas),
 *     MM = id & 31 (classe no slot; o material não conta: Iron Dagger 0x0102 e Silver Dagger 0x3142 = s01i02); K = parte da fala (1..3);
 *   - `books/<NN>`: NN = id da magia do livro [est]; `effects/<NN>`: id do efeito/encantamento [est].
 * O manifest `assets/audio/speech/voices.json` (tools/pipeline/voices.py) lista o que existe: sem arquivo = silêncio, sem erro.
 * A tela da loja (scenes/ShopScene.ts) ainda não chama este módulo (ver docs/GAPS.md [VOZES]).
 */
export type ShopDir = "shop" | "shop_druid" | "shop_kaarg";

interface ShopIndex { classes: Record<string, string[]>; books: number[]; effects: number[]; }

const pad2 = (n: number) => String(n).padStart(2, "0");

export class ShopVoices {
  private constructor(private readonly shops: Partial<Record<ShopDir, ShopIndex>>) {}

  static async load(game: Game): Promise<ShopVoices> {
    const j = await game.data.tryJson<{ shops?: Partial<Record<ShopDir, ShopIndex>> }>("assets/audio/speech/voices.json");
    return new ShopVoices(j?.shops ?? {});
  }

  /** Partes da fala do lojista para um item (pelo id do items.json); [] se a classe não tem voz. */
  item(dir: ShopDir, itemId: number): string[] {
    const key = `s${pad2((itemId >> 8) & 15)}i${pad2(itemId & 31)}`;
    // o manifest guarda os nomes reais (o original tem um "s01i9p2" sem zero em vez de s01i09p2)
    return (this.shops[dir]?.classes[key] ?? []).map(stem => `${dir}/${stem}`);
  }

  /** Fala do livro de magia (id da magia). */
  book(dir: ShopDir, spellId: number): string | undefined {
    return this.shops[dir]?.books.includes(spellId) ? `${dir}/books/${pad2(spellId)}` : undefined;
  }

  /** Fala do efeito/encantamento. */
  effect(dir: ShopDir, effectId: number): string | undefined {
    return this.shops[dir]?.effects.includes(effectId) ? `${dir}/effects/${pad2(effectId)}` : undefined;
  }

  /** Toca a descrição falada de um item (interrompe a anterior). */
  sayItem(game: Game, dir: ShopDir, itemId: number): void {
    const ids = this.item(dir, itemId);
    if (!ids.length) { game.audio.stopSpeech(); return; }
    void game.audio.playSpeechSeq(ids).catch(() => undefined);
  }
}
