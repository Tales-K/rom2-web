import type { Game } from "../core/game";
import type { HeroState } from "../core/state";
import type { Line } from "./common";

/**
 * Vozes das conversas da cidade/taverna.
 * Regra (descoberta pela frente MISSÃO): seção `npc<N>talk<M>` de town.json  ->  `speech/talk/<N 4 díg.><c><M 3 díg.>p<parte 2 díg.>`;
 * `accept`/`reject`/`about` seguem o mesmo padrão nas pastas de mesmo nome (about: M = 000) e as seções `*guard`/`*woman`... em `town/`.
 * Classe `c`: t = fala sem tag de sexo/classe; f = guerreiro, a = guerreira, m = mago, s = maga (o herói fala com a sua letra mesmo sem tag).
 * A lista de arquivos existentes vem de assets/ui/inn/voices.json (gerado por tools/pipeline/town.py), então voz ausente = silêncio, sem erro.
 */
type Kind = "talk" | "accept" | "reject" | "about" | "town";
const KINDS: Kind[] = ["talk", "accept", "reject", "about", "town"];

export class Voices {
  private have = new Set<string>();

  static async load(game: Game): Promise<Voices> {
    const v = new Voices();
    const j = await game.data.tryJson<Record<string, string[]>>("assets/ui/inn/voices.json");
    if (j) for (const k of KINDS) for (const n of j[k] ?? []) v.have.add(`${k}/${n}`);
    return v;
  }

  /** letra da classe do herói */
  static letter(hero: HeroState): string {
    return hero.heroClass === "mage" ? (hero.sex === "male" ? "m" : "s") : (hero.sex === "male" ? "f" : "a");
  }

  /** Id de fala (relativo a assets/audio/speech/) de uma linha da seção `section`, ou undefined se não existir arquivo. */
  find(section: string, line: Line, hero: HeroState): string | undefined {
    let kind: Kind, m: number, npc: number;
    const a = section.match(/^npc(\d+)(talk|accept|reject)(\d+)$/);
    const ab = section.match(/^npc(\d+)about$/);
    const g = section.match(/^(kaargguard|kaargman|kaargwoman|druidinnkeeper|druidshopkeeper)(\d+)$/);
    if (a) { kind = a[2] as Kind; m = Number(a[3]); npc = Number(a[1]); }
    else if (ab) { kind = "about"; m = 0; npc = Number(ab[1]); }
    else if (section === "plagatguard") { kind = "town"; m = 0; npc = line.npc || 97; }
    else if (g) { kind = "town"; m = Number(g[2]); npc = line.npc; }
    else return undefined;
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    const hasTag = !!line.tags && Object.keys(line.tags).some(k => k.startsWith("iam"));
    const mine = Voices.letter(hero);
    const order = hasTag || line.npc === 21 ? [mine, "t"] : ["t", mine];
    for (const c of order) {
      const who = line.npc || npc;            // a fala do herói (npc 21) tem arquivo 0021...; as demais, o npc da linha
      const id = `${kind}/${pad(who, 4)}${c}${pad(m, 3)}p${pad(line.part ?? 1, 2)}`;
      if (this.have.has(id)) return id;
    }
    return undefined;
  }

  /** Toca a voz da linha (interrompe a anterior). Sem arquivo, só interrompe a fala em curso. */
  say(game: Game, section: string, line: Line, hero: HeroState): void {
    const id = this.find(section, line, hero);
    if (!id) { game.audio.stopSpeech(); return; }
    void game.audio.playSpeech(id).catch(() => undefined);
  }
}
