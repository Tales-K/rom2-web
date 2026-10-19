import { Container, Graphics, Point, Rectangle, type FederatedPointerEvent, type PointData } from "pixi.js";
import { SCREEN_H, SCREEN_W } from "../core/scene";

/**
 * Enquadramento das telas "640×480" do original (menu principal, criação de personagem, cidade, taverna, loja, mapa-múndi...).
 *
 * O allods2.exe em 1024×768 (opção -1024) NÃO amplia essas telas: desenha a arte 640×480 em tamanho natural no centro da tela,
 * com borda preta (x 192..831, y 144..623; conferido em refs/original/menu_main.png, chargen_*.png). Só a missão ocupa a tela toda.
 *
 * Toda a arte dessas telas é gerada em escala 1,0 (coordenadas 640×480) pelos pipelines (tools/pipeline/menu.py) e montada
 * dentro de um `Frame640`: um Container centralizado cuja escala é `UI_SCALE`.
 *
 *   UI_SCALE = 1    → como o original (padrão): 640×480 no centro, pixel a pixel, borda preta.
 *   UI_SCALE = 1.6  → amplia para ocupar 1024×768 (como o projeto fazia antes; a arte é reamostrada pela GPU, filtro linear).
 *
 * Este é o ÚNICO ponto de configuração: as cenas só usam `frame640()` / `Frame640.local()`.
 * Uso típico numa cena:
 *   const f = frame640(this.root);                  // fundo preto na tela toda + contêiner 640×480 centralizado
 *   f.addChild(bgSprite, ...);                      // tudo em coordenadas 640×480
 *   f.on("pointermove", e => { const p = f.local(e); hit.at(p.x, p.y); });
 */
export const UI_SCALE: number = 1;

export const ART_W = 640;
export const ART_H = 480;

/** Retângulo ocupado pela tela 640×480 em coordenadas da tela 1024×768 (com a escala atual). */
export function frameRect(scale = UI_SCALE): Rectangle {
  const w = Math.round(ART_W * scale), h = Math.round(ART_H * scale);
  return new Rectangle(Math.floor((SCREEN_W - w) / 2), Math.floor((SCREEN_H - h) / 2), w, h);
}

export class Frame640 extends Container {
  /** Fundo preto que cobre a tela inteira (a "borda" do original); fica atrás do quadro, no mesmo pai. */
  readonly border: Graphics;
  private readonly tmp = new Point();

  constructor(readonly frameScale = UI_SCALE) {
    super();
    const r = frameRect(frameScale);
    this.position.set(r.x, r.y);
    this.scale.set(frameScale);
    this.border = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    this.border.eventMode = "none";
    // a área clicável cobre só os 640×480 (cliques na borda preta não são da cena, como no original)
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, ART_W, ART_H);
  }

  /** Converte um ponto global (evento do Pixi ou coordenadas 1024×768) para coordenadas 640×480 do quadro. */
  local(p: FederatedPointerEvent | PointData): Point {
    const g = "global" in p ? p.global : p;
    return this.toLocal(g, undefined, this.tmp).clone();
  }

  /** Converte coordenadas 640×480 do quadro em coordenadas da tela 1024×768. */
  screen(x: number, y: number): Point {
    return new Point(this.x + x * this.frameScale, this.y + y * this.frameScale);
  }

  /** O ponto global cai dentro dos 640×480? */
  contains(p: FederatedPointerEvent | PointData): boolean {
    const l = this.local(p);
    return l.x >= 0 && l.y >= 0 && l.x < ART_W && l.y < ART_H;
  }
}

/**
 * Cria o enquadramento dentro de `parent` (normalmente `scene.root`): acrescenta o fundo preto da tela inteira e o quadro
 * 640×480 centralizado, e devolve o quadro. Elementos que precisam da tela toda (cortina de fade, diálogos) continuam no `parent`.
 */
export function frame640(parent: Container, scale = UI_SCALE): Frame640 {
  const f = new Frame640(scale);
  parent.addChild(f.border, f);
  return f;
}
