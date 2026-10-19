import type { Game } from "../core/game";
import { SCENES } from "../scenes/registry";

/**
 * Pré-carregamento em segundo plano da(s) próxima(s) cena(s): baixa o módulo da cena e, se ele exportar `prefetch(game)`,
 * as imagens/JSON que a cena vai pedir (via `game.data`, então a cena depois só reaproveita o cache do PixiJS/DataStore).
 * Roda em sequência, em tempo ocioso, e nunca lança erro. Cada cena é pré-carregada no máximo uma vez.
 */
type Module = { prefetch?: (game: Game) => Promise<void> };
const started = new Set<string>();
let chain: Promise<void> = Promise.resolve();

const idle = (): Promise<void> => new Promise(res => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(() => res(), { timeout: 1500 }); else setTimeout(res, 50);
});

export function warm(game: Game, names: string[]): void {
  if (location.search.includes("nowarm")) return;      // depuração/medição: desliga o pré-carregamento (?nowarm)
  for (const name of names) {
    if (started.has(name) || !SCENES[name]) continue;
    started.add(name);
    chain = chain.then(async () => {
      await idle();
      try {
        const mod = (await SCENES[name]()) as unknown as Module;
        await mod.prefetch?.(game);
      } catch (err) { console.warn("[prefetch]", name, (err as Error)?.message ?? err); started.delete(name); }
    });
  }
}

/** Carrega uma lista de texturas (sem rejeitar), uma de cada vez em grupos pequenos para não competir com a cena atual. */
export async function warmTextures(game: Game, paths: string[], group = 4): Promise<void> {
  for (let i = 0; i < paths.length; i += group) {
    await Promise.all(paths.slice(i, i + group).map(p => game.data.texture(p).catch(() => undefined)));
  }
}
