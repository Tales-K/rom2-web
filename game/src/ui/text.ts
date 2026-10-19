import { Assets, BitmapText, Text, TextStyle } from "pixi.js";

/** Fontes bitmap originais desenhadas pixel a pixel (sem reamostragem), para as telas em 640×480 (ui/frame640.ts):
 *  font1 16×15 decorativa · font2 8×10 maiúsculas (painel de estatísticas, HUD) · font3 8×6 algarismos · font4 Times 16 px. */
export type PixelFont = "font1" | "font2" | "font3" | "font4";

export interface TextOpts {
  size?: number; color?: number | string; bold?: boolean; wrap?: number; align?: "left" | "center" | "right"; stroke?: number | string;
  /** Fonte original em tamanho natural (ignora `size`/`stroke`; use `scale` para múltiplos inteiros). Com font4, `bold` = glifo
   *  desenhado em x e x+1, como o original faz nos rótulos e botões ("Name:", "Accept", valores dos atributos). */
  font?: PixelFont;
  /** Com `font`: sombra preta 1 px abaixo/à direita, como o jogo faz nos painéis (padrão: true para font1..3, false para font4). */
  shadow?: boolean;
  /** Com `font`: multiplicador inteiro do tamanho natural (padrão 1). */
  scale?: number;
}

/**
 * ÚNICO ponto de criação de texto do jogo.
 *
 * Duas famílias de fontes bitmap, ambas geradas por tools/pipeline/menu.py a partir dos arquivos originais:
 *  - `opts.font` ("font1".."font4"): a fonte original em tamanho natural, 1 texel = 1 pixel (assets/ui/fonts/a2f{1..4}[s].fnt).
 *    É o que o original usa nas telas 640×480 (menu, criação de personagem, cidade...): font4 nos rótulos e botões ("Name:",
 *    "Accept", valores dos atributos) e font2 no painel de estatísticas. A cor (`color`) tinge o glifo (font1..3 trazem o tom
 *    0..15 de cada pixel; font4, o alfa). `shadow` acrescenta a sombra preta em (+1,+1).
 *  - sem `font`: `graphics/font4` assentada em 2× (assets/ui/fonts/a2font4*.fnt) para tamanhos livres em pixels da tela 1024×768
 *    (`size` = tamanho do "em"; variantes normal/negrito (`bold`: engrossa 1 px)/contorno (`stroke`)/negrito+contorno).
 * As fontes são carregadas em segundo plano assim que este módulo é importado; enquanto não estiverem prontas (ou se o arquivo
 * não existir) `makeText` devolve um `Text` com fonte de sistema, com a mesma API (`position`, `anchor`, `text`, `style`...).
 */
/**
 * Tipo devolvido por `makeText`. Em tempo de execução é um `BitmapText` (fonte original) ou um `Text` (fallback); os dois compartilham
 * `position/anchor/text/style/width/height/alpha/tint`. Para não quebrar quem declara variáveis `Text`, o tipo estático é `Text`.
 */
export type GameText = Text;

const FAMILY = "a2font4";
const BASE = "assets/ui/fonts/";
/** altura da célula (= tamanho natural) de cada fonte original */
export const PIXEL_FONT_SIZE: Record<PixelFont, number> = { font1: 15, font2: 10, font3: 6, font4: 16 };
const PIXEL_FAMILY: Record<PixelFont, string> = { font1: "a2f1", font2: "a2f2", font3: "a2f3", font4: "a2f4" };

let ready = false;
let pixelReady = false;
let loading: Promise<boolean> | undefined;

/** Carrega as variantes das fontes bitmap (idempotente). Resolve `true` se a fonte principal ficou disponível. */
export function loadFonts(): Promise<boolean> {
  if (!loading) {
    const pixel = Promise.all([...Object.values(PIXEL_FAMILY).flatMap(f => [f, f + "s"]), "a2f4b", "a2f4bs"].map(f => Assets.load(`${BASE}${f}.fnt`)))
      .then(() => { pixelReady = true; })
      .catch(err => { console.warn("[fonte] fontes pixel indisponíveis:", err?.message ?? err); });
    const main = Promise.all(["", "b", "o", "bo"].map(v => Assets.load(`${BASE}${FAMILY}${v}.fnt`)))
      .then(() => { ready = true; return true; })
      .catch(err => { console.warn("[fonte] bitmap indisponível, usando fonte de sistema:", err?.message ?? err); return false; });
    loading = Promise.all([main, pixel]).then(([ok]) => ok);
  }
  return loading;
}

export function fontsReady(): boolean { return ready; }

if (typeof window !== "undefined") void loadFonts();

export function makeText(str: string, opts: TextOpts = {}): GameText {
  const align = opts.align ?? "left";
  if (opts.font && pixelReady) {
    const shadow = opts.shadow ?? opts.font !== "font4";
    const k = Math.max(1, Math.round(opts.scale ?? 1));
    return new BitmapText({
      text: str,
      style: {
        fontFamily: PIXEL_FAMILY[opts.font] + (opts.bold && opts.font === "font4" ? "b" : "") + (shadow ? "s" : ""),
        fontSize: PIXEL_FONT_SIZE[opts.font] * k,
        fill: opts.color ?? 0xffffff,
        align,
        wordWrap: !!opts.wrap,
        wordWrapWidth: opts.wrap ?? 0,
      },
    }) as unknown as Text;
  }
  const size = opts.font ? PIXEL_FONT_SIZE[opts.font] * (opts.scale ?? 1) : (opts.size ?? 16);
  if (ready) {
    const family = FAMILY + (opts.bold ? "b" : "") + (opts.stroke !== undefined ? "o" : "");
    return new BitmapText({
      text: str,
      style: {
        fontFamily: family,
        fontSize: size,
        fill: opts.color ?? 0xe8dcc0,
        align,
        wordWrap: !!opts.wrap,
        wordWrapWidth: opts.wrap ?? 0,
      },
    }) as unknown as Text;
  }
  const style = new TextStyle({
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: size,
    fill: opts.color ?? 0xe8dcc0,
    fontWeight: opts.bold ? "bold" : "normal",
    wordWrap: !!opts.wrap,
    wordWrapWidth: opts.wrap ?? 0,
    align,
    stroke: opts.stroke !== undefined ? { color: opts.stroke, width: 3 } : undefined,
  });
  return new Text({ text: str, style });
}
