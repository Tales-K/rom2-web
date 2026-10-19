import type { Container } from "pixi.js";
import { makeText } from "./text";

/**
 * Ficha do herói em font2, no formato do original (painel verde da criação de personagem e painel de texto do HUD da missão,
 * que no original é a mesma ficha): nome; BODY/AGILITY/MIND/SPIRIT + HEALTH/MANA; DMG/ABSORB, ATTACK/DEFENSE; SKILLS/RESISTANCE
 * (5 linhas); WEIGHT, XP; SIGHT, SPEED. Posições medidas pixel a pixel em refs/original/chargen_b_fighter.png, relativas ao
 * canto superior esquerdo do bitmap do painel (fullstatsl.bmp 160×242; no HUD, textbackr.bmp tem o mesmo formato).
 */
export interface HeroSheet {
  name: string;
  /** 2ª linha do título (clã, Multiplayer: refs/original/mp_char_*; ficha completa, nome em y=17 e clã em y=27) */
  name2?: string;
  /** rótulos já traduzidos (main.json: 15..46); o original escreve tudo em maiúsculas */
  labels: { attrs: [string, string, string, string]; health: string; mana: string; dmg: string; absorb: string; attack: string; defense: string;
    skills: string; resistance: string; skillNames: string[]; resistNames: string[]; weight: string; xp: string; sight: string; speed: string };
  attrs: [number, number, number, number];
  health: [number, number]; mana: [number, number];
  damage: [number, number]; absorb: number; attack: number; defense: number;
  skills: number[]; resists: number[];
  weight: number; xp: number; sight: number; speed: number;
  /** Variante da taverna (refs/original/inn_*.png): 2ª linha do título, sem ATTACK (mago), sem WEIGHT/XP, rodapé ("spellcaster") */
  inn?: { name2?: string; hideAttack?: boolean; footer?: string };
}

/** Cores do original (RGB565): rótulos dourados, valores verdes, títulos laranja. */
export const SHEET_COLORS = { label: 0xbd9e4a, value: 0x6b9a7b, title: 0x945900 };

/** Desenha a ficha em `g` (limpa antes). `ox, oy` = canto do painel (na criação: 0, 238 da tela 640×480). */
export function drawHeroSheet(g: Container, s: HeroSheet, ox = 0, oy = 0): void {
  g.removeChildren().forEach(o => o.destroy());
  const { label: GOLD, value: GREEN, title: ORANGE } = SHEET_COLORS;
  const put = (text: string, x: number, y: number, color: number, align: "left" | "right" | "center" = "left") => {
    const t = makeText(text.toUpperCase(), { font: "font2", color });
    t.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0);
    t.position.set(ox + x, oy + y);
    g.addChild(t);
  };
  const L = s.labels;
  if (s.inn?.name2) { put(s.name, 84, 16, GOLD, "center"); put(s.inn.name2, 84, 27, GOLD, "center"); }
  else { put(s.name, 84, 17, GOLD, "center"); if (s.name2) put(s.name2, 84, 27, GOLD, "center"); }
  L.attrs.forEach((lb, i) => { put(lb, 18, 43 + 10 * i, GOLD); put(String(s.attrs[i]), 92, 43 + 10 * i, GREEN, "right"); });
  put(L.health, 127, 43, GOLD, "center"); put(`${s.health[0]}/${s.health[1]}`, 127, 53, GREEN, "center");
  put(L.mana, 127, 63, GOLD, "center"); put(`${s.mana[0]}/${s.mana[1]}`, 127, 73, GREEN, "center");
  put(L.dmg, 18, 87, GOLD); put(`${s.damage[0]}-${s.damage[1]}`, 82, 87, GREEN, "right");
  put(L.absorb, 86, 87, GOLD); put(String(s.absorb), 152, 87, GREEN, "right");
  if (!s.inn?.hideAttack) { put(L.attack, 18, 97, GOLD); put(String(s.attack), 82, 97, GREEN, "right"); }
  put(L.defense, 86, 97, GOLD); put(String(s.defense), 152, 97, GREEN, "right");
  put(L.skills, 18, 111, ORANGE); put(L.resistance, 86, 111, ORANGE);
  for (let i = 0; i < 5; i++) {
    const y = 121 + 10 * i;
    put(L.skillNames[i] ?? "", 18, y, GOLD); put(String(s.skills[i] ?? 0), 82, y, GREEN, "right");
    put(L.resistNames[i] ?? "", 86, y, GOLD); put(String(s.resists[i] ?? 0), 152, y, GREEN, "right");
  }
  if (s.inn) { if (s.inn.footer) put(s.inn.footer, 84, 173, GOLD, "center"); }
  else {
    put(L.weight, 28, 173, GOLD); put(s.weight.toFixed(1), 139, 173, GREEN, "right");
    put(L.xp, 28, 185, GOLD); put(String(s.xp), 139, 185, GREEN, "right");
  }
  put(L.sight, 52, 199, GOLD); put((Math.floor(s.sight * 10) / 10).toFixed(1), 118, 199, GREEN, "right");
  put(L.speed, 52, 209, GOLD); put(String(s.speed), 118, 209, GREEN, "right");
}

/**
 * Índice (main.txt, base 0) do texto da dica sob o ponto (u, v) da ficha: u = x − 864 e v = y − 571 no painel de texto da missão
 * (BODY em 870,571; mesmas linhas de mission/hud.ts hoverLines, 19/10). Linhas de 10 px: atributos 155..158 (coluna da direita: vida
 * 159, mana 160), DMG/ATTACK 161/162 (direita: absorção 163, defesa 164), títulos Skills/Resistance 168/169, habilidades 171..175
 * (mago 176..180), peso 165 e XP 170 (só na missão: na tela "New Character" do Multiplayer essas duas linhas não têm dica, medido
 * com varredura em 10 px), sight 166 e speed 167. Devolve undefined fora das linhas.
 */
export function sheetHintIndex(u: number, v: number, mage: boolean, weightXp = true): number | undefined {
  if (v < 0 || v >= 176) return undefined;
  const k = Math.floor(v / 10);
  if (k < 4) return u < 80 ? 155 + k : k < 2 ? 159 : 160;
  const t = v - 44;
  if (t >= 0 && t < 20) return u < 72 ? 161 + Math.floor(t / 10) : 163 + Math.floor(t / 10);
  const s = v - 68;
  if (s >= 0 && s < 10) return u < 72 ? 168 : 169;
  if (s >= 10 && s < 60) return (mage ? 176 : 171) + Math.floor((s - 10) / 10);
  const w = v - 130;
  if (weightXp && w >= 0 && w < 10) return 165;
  if (weightXp && w >= 12 && w < 22) return 170;
  const q = v - 156;
  if (u >= 36 && u < 126 && q >= 0 && q < 10) return 166;
  if (u >= 36 && u < 126 && q >= 10 && q < 20) return 167;
  return undefined;
}
