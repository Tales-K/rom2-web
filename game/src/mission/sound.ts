/**
 * Sons da missão. Cada tipo de unidade tem `Sound = [ataque, impacto/material, dor 1, dor 2, morte]` em units.reg
 * (ids de sfx.reg, por exemplo [100 sword, 200 metal1, 220 easy1, 221 easy2, 240 dead1]); `game.audio.playSfx(id)` resolve o id
 * por data/sfx.json (frente MÍDIA). Volume cai com a distância até o centro da tela.
 */
import type { Game } from "../core/game";
import type { Unit } from "../sim/world";
import type { AnimTable } from "./anim";
import { spellSfx } from "./effects";

/** Sons de interface (ids de sfx.reg). Itens: o original não tem som próprio para vestir/beber em sfx.reg; usamos cliques. */
const UI: Record<string, number | string> = { click: 1, message: 15, complete: 14, failed: 16, gold: 11, error: 6, equip: 4, drop: 3, potion: 8, book: 7 };

export class MissionAudio {
  private last = new Map<string, number>();
  constructor(private readonly game: Game, private readonly anim: AnimTable) {}

  private play(id: number | string | undefined, vol: number, key?: string): void {
    if (id === undefined || id === 0 || vol <= 0.03) return;
    const now = performance.now();
    const k = key ?? String(id);
    if (now - (this.last.get(k) ?? 0) < 90) return;
    this.last.set(k, now);
    try {
      this.game.audio.playSfx(id, vol);
    } catch { /* sem áudio */ }
  }

  private vol(u: Unit, cam: { x: number; y: number }): number {
    const dx = u.x * 32 - (cam.x + 424), dy = u.y * 32 - (cam.y + 384);
    const d = Math.hypot(dx, dy);
    return Math.max(0, Math.min(1, 1.2 - d / 700));
  }

  private sounds(u: Unit): number[] {
    const s = this.anim[u.kind]?.Sound;
    return Array.isArray(s) ? s : [];
  }

  attack(u: Unit, cam: { x: number; y: number }): void { this.play(this.sounds(u)[0], this.vol(u, cam)); }
  cast(u: Unit, cam: { x: number; y: number }, spell?: string): void { this.play(spell ? spellSfx(spell) : 90, this.vol(u, cam) * 0.6, "cast" + u.id); }
  hit(t: Unit, a: Unit | undefined, cam: { x: number; y: number }): void {
    const v = this.vol(t, cam);
    const s = this.sounds(t);
    if (a) this.play(this.sounds(a)[1] || s[1], v * 0.8, "imp" + t.id);
    this.play(s[2 + (t.id & 1)] || s[2], v * 0.7, "hurt" + t.id);
  }
  death(u: Unit, cam: { x: number; y: number }): void { this.play(this.sounds(u)[4], this.vol(u, cam)); }
  ui(name: keyof typeof UI | string): void { this.play(UI[name], 0.7, "ui" + name); }
}
