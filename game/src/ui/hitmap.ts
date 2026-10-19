import type { FederatedPointerEvent } from "pixi.js";
/**
 * Mapa de acerto por pixel: um PNG em tons de cinza em que cada valor é o id de uma região clicável (0 = nada).
 * O jogo original usa "máscaras" assim (menumask.bmp etc.); tools/pipeline/menu.py as converte para ids pequenos.
 */
export class HitMap {
  constructor(readonly w: number, readonly h: number, private readonly data: Uint8Array) {}

  /** id da região no pixel (x, y) (coordenadas do próprio mapa); 0 fora/sem região. */
  at(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.data[iy * this.w + ix];
  }
}

export async function loadHitMap(url: string): Promise<HitMap> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return new HitMap(c.width, c.height, out);
}

/** Quadro 640×480 (ui/frame640.ts) visto pelos ponteiros: `local` converte o evento para coordenadas 640×480. */
interface PointerFrame {
  on(ev: string, fn: (e: FederatedPointerEvent) => void): unknown;
  local(e: FederatedPointerEvent): { x: number; y: number };
}

export interface HitHandlers {
  /** falso = ignora o ponteiro (cena ocupada, janela modal aberta) */
  enabled?: () => boolean;
  /** o ponteiro está sobre a região `id` (0 = nenhuma); chamado a cada movimento (quem recebe deduplica) */
  hover?: (id: number) => void;
  /** botão esquerdo apertado sobre a região `id` (0 = nenhuma) */
  down?: (id: number) => void;
  /** botão solto: `pressed` = região em que foi apertado, `over` = região sob o ponteiro ao soltar (clique = iguais e ≠ 0) */
  up?: (pressed: number, over: number) => void;
  /** botão solto fora do quadro */
  cancel?: () => void;
}

/**
 * Liga os eventos de ponteiro de um quadro 640×480 a um mapa de acerto (as máscaras do original): hover por região, apertar e soltar.
 * ÚNICO ponto dessa lógica: o menu principal e a etapa A da criação de personagem usam este helper. `scale` = escala da arte do
 * mapa em relação a 640×480 (menu.json/chargen.json "scale").
 */
export function bindHitRegions(frame: PointerFrame, hit: HitMap, scale: number, h: HitHandlers): { at: (e: FederatedPointerEvent) => number; hover: () => number } {
  let hover = 0, pressed = 0;   // `hover` = última região vista pelo ponteiro
  const ok = () => !h.enabled || h.enabled();
  const at = (e: FederatedPointerEvent): number => { const p = frame.local(e); return hit.at(p.x * scale, p.y * scale); };
  const setHover = (id: number) => { hover = id; h.hover?.(id); };
  frame.on("pointermove", e => { if (ok()) setHover(at(e)); });
  frame.on("pointerleave", () => { if (ok()) setHover(0); });
  frame.on("pointerdown", e => { if (!ok()) return; const id = at(e); setHover(id); pressed = id; h.down?.(id); });
  frame.on("pointerup", e => { const p = pressed; pressed = 0; h.up?.(p, ok() ? at(e) : 0); });
  frame.on("pointerupoutside", () => { pressed = 0; h.cancel?.(); });
  return { at, hover: () => hover };
}
