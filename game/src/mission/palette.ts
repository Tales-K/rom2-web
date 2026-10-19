/**
 * Texturas indexadas com troca de paleta (frente MOTOR-B).
 * Os atlas de unidades/objetos/estruturas são PNG de 8 bits com paleta (PLTE) e um índice transparente (tRNS), gerados por
 * tools/pipeline/anim_world.py. Para as variantes de cor dos monstros (paletteN.pal = nível N) baixamos os bytes do PNG,
 * trocamos o bloco PLTE (mesmo tamanho, CRC recalculado) e decodificamos de novo — sem shader e sem atlas duplicado no disco.
 */
import { Assets, Texture } from "pixi.js";

let crcTable: Uint32Array | undefined;
function crc32(buf: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copia o PNG trocando as cores do PLTE pelas de `rgb` (R,G,B × 256). Devolve undefined se não houver PLTE. */
export function patchPalette(png: Uint8Array, rgb: Uint8Array): Uint8Array | undefined {
  const out = png.slice();
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let p = 8;
  while (p + 8 <= out.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(out[p + 4]!, out[p + 5]!, out[p + 6]!, out[p + 7]!);
    if (type === "PLTE") {
      const n = Math.min(len, rgb.length);
      out.set(rgb.subarray(0, n), p + 8);
      dv.setUint32(p + 8 + len, crc32(out, p + 4, p + 8 + len));
      return out;
    }
    if (type === "IDAT" || type === "IEND") return undefined;
    p += 12 + len;
  }
  return undefined;
}

const variantCache = new Map<string, Promise<Texture>>();

/**
 * Textura do atlas `url` com a paleta `paletteB64` (RGB × 256 em base64). Sem paleta → Assets.load comum (cache do Pixi).
 * Falhas na troca caem na textura original.
 */
export function loadPaletted(url: string, paletteB64?: string, key?: string): Promise<Texture> {
  if (!paletteB64) return Assets.load<Texture>(url);
  const k = `${url}#${key ?? paletteB64.slice(0, 32)}`;
  let p = variantCache.get(k);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        const png = new Uint8Array(await r.arrayBuffer());
        const patched = patchPalette(png, b64(paletteB64));
        if (!patched) throw new Error("PNG sem PLTE");
        const buf = new ArrayBuffer(patched.byteLength);
        new Uint8Array(buf).set(patched);
        const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
        return Texture.from(bmp);
      } catch (e) {
        console.warn("[paleta] variante falhou, usando a original:", e);
        return Assets.load<Texture>(url);
      }
    })();
    variantCache.set(k, p);
  }
  return p;
}
