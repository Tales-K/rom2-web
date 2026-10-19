import { Assets, Texture } from "pixi.js";

/** Carrega JSON e texturas de public/ com cache. Caminhos relativos a public/ (ex.: "data/maps/10.json", "assets/terrain/tile1-00.png"). */
export class DataStore {
  private json = new Map<string, Promise<unknown>>();

  getJson<T>(path: string): Promise<T> {
    let p = this.json.get(path);
    if (!p) {
      p = fetch(path).then(r => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.json(); });
      this.json.set(path, p);
    }
    return p as Promise<T>;
  }

  async tryJson<T>(path: string): Promise<T | undefined> {
    try { return await this.getJson<T>(path); } catch { this.json.delete(path); return undefined; }
  }

  texture(path: string): Promise<Texture> { return Assets.load<Texture>(path); }

  async textures(paths: string[]): Promise<Texture[]> { return Promise.all(paths.map(p => this.texture(p))); }

  async tryText(path: string): Promise<string | undefined> {
    try { const r = await fetch(path); return r.ok ? await r.text() : undefined; } catch { return undefined; }
  }
}
