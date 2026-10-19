/**
 * Terreno com relevo e luz por vértice (frente RELEVO; fórmulas em mission/relief.ts e notes/altitude.md).
 * Cada bloco de 16×16 células vira uma malha: a célula é desenhada em STRIPS faixas verticais cujas bordas de cima/baixo seguem
 * a altitude dos 4 cantos (o exe estica cada coluna de pixels entre as bordas interpoladas, 0x4575fe), com o brilho do vértice
 * (96 − L)/32 interpolado. As 52 colunas de tiles (graphics/terrain/tileN-MM) vão para um atlas único (1664×512) amostrado
 * sem filtro; a água troca só as coordenadas de textura (4 quadros, MapView). Só WebGL: sem ele a vista usa os sprites planos.
 */
import { Buffer, BufferUsage, Container, Geometry, Mesh, Shader, Texture, TextureSource } from "pixi.js";
import { type Relief, TILE_PX as TILE } from "./relief";

const CHUNK = 16;
/** faixas por célula: a interpolação por coluna do exe fica a ≤ 1 px nas células mais tortas */
const STRIPS = 4;
const VPC = (STRIPS + 1) * 2;   // vértices por célula
const IPC = STRIPS * 6;          // índices por célula

const VERT = `
in vec2 aPosition;
in vec2 aUV;
in float aGain;
out vec2 vUV;
out float vGain;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vGain = aGain;
}`;

const FRAG = `
in vec2 vUV;
in float vGain;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uScale;
void main() {
  vec4 c = texture(uTexture, vUV);
  finalColor = vec4(min(c.rgb * vGain * uScale, vec3(1.0)), c.a);
}`;

interface WaterCell { v: number; w: number; g: number; r: number; }

export class TerrainMesh {
  readonly root = new Container();
  private meshes: Mesh<Geometry, Shader>[] = [];
  private uvBufs: Buffer[] = [];
  private gainBufs: { buf: Buffer; x0: number; y0: number; x1: number; y1: number }[] = [];
  private water: WaterCell[][] = [];
  private chunkCols = 0;
  private visible = new Set<number>();
  private waterStep = -1;
  private atlasW = 0;
  private atlasH = 0;
  private shader?: Shader;

  /**
   * @param tiles ids de tile por célula (bloco 1 do .alm)
   * @param files colunas de tiles (52 arquivos, 16 linhas de 32 px)
   * @param scale divisor do ganho (o mundo inteiro já recebe o ganho WORLD_GAIN do filtro)
   */
  constructor(private readonly relief: Relief, private readonly tiles: number[], files: Texture[], scale: number) {
    const atlas = buildAtlas(files);
    this.atlasW = atlas.width; this.atlasH = atlas.height;
    const src = TextureSource.from(atlas);
    src.scaleMode = "nearest";
    this.shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG, name: "relief-terrain" },
      resources: { uTexture: src, reliefUniforms: { uScale: { value: 1 / scale, type: "f32" } } },
    });
    const { w, h } = relief;
    this.chunkCols = Math.ceil(w / CHUNK);
    const rows = Math.ceil(h / CHUNK);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < this.chunkCols; cx++) this.buildChunk(cx, cy);
  }

  private uvOf(id: number): [number, number] {
    const f = id >> 4, r = id & 15;
    return [f * TILE, r * TILE];
  }

  private buildChunk(cx: number, cy: number): void {
    const { w, h } = this.relief;
    const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(w, x0 + CHUNK), y1 = Math.min(h, y0 + CHUNK);
    const n = (x1 - x0) * (y1 - y0);
    const pos = new Float32Array(n * VPC * 2), uv = new Float32Array(n * VPC * 2), gain = new Float32Array(n * VPC);
    const idx = new Uint32Array(n * IPC);
    const water: WaterCell[] = [];
    const R = this.relief;
    let c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, c++) {
      const id = (this.tiles[y * w + x] ?? 0) & 0x1fff;
      const hTL = R.v(x, y), hTR = R.v(x + 1, y), hBL = R.v(x, y + 1), hBR = R.v(x + 1, y + 1);
      const v0 = c * VPC;
      for (let k = 0; k <= STRIPS; k++) {
        const f = k / STRIPS, px = x * TILE + f * TILE;
        const top = v0 + k * 2, bot = top + 1;
        pos[top * 2] = px; pos[top * 2 + 1] = y * TILE - (hTL + (hTR - hTL) * f);
        pos[bot * 2] = px; pos[bot * 2 + 1] = (y + 1) * TILE - (hBL + (hBR - hBL) * f);
      }
      this.writeUV(uv, v0, id);
      const i0 = c * IPC;
      for (let k = 0; k < STRIPS; k++) {
        const a = v0 + k * 2, b = a + 1, d = a + 2, e = a + 3;
        idx.set([a, d, b, d, e, b], i0 + k * 6);
      }
      const fi = id >> 4;
      if (fi >= 32 && fi <= 47) water.push({ v: v0, w: (fi - 32) & 3, g: (fi - 32) >> 2, r: id & 15 });
    }
    const posBuf = new Buffer({ data: pos, usage: BufferUsage.VERTEX });
    const uvBuf = new Buffer({ data: uv, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const gainBuf = new Buffer({ data: gain, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const gb = { buf: gainBuf, x0, y0, x1, y1 };
    this.writeGain(gb);
    this.gainBufs.push(gb);
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: posBuf, format: "float32x2" },
        aUV: { buffer: uvBuf, format: "float32x2" },
        aGain: { buffer: gainBuf, format: "float32" },
      },
      indexBuffer: idx,
    });
    const mesh = new Mesh({ geometry, shader: this.shader! });
    mesh.visible = false;
    this.meshes.push(mesh);
    this.uvBufs.push(uvBuf);
    this.water.push(water);
    this.root.addChild(mesh);
  }

  /** Brilho por vértice das faixas (Relief.shade nos 4 cantos, interpolado em x). */
  private writeGain(gb: { buf: Buffer; x0: number; y0: number; x1: number; y1: number }): void {
    const R = this.relief, gain = gb.buf.data as Float32Array;
    let c = 0;
    for (let y = gb.y0; y < gb.y1; y++) for (let x = gb.x0; x < gb.x1; x++, c++) {
      const gTL = R.shade(x, y), gTR = R.shade(x + 1, y), gBL = R.shade(x, y + 1), gBR = R.shade(x + 1, y + 1);
      const v0 = c * VPC;
      for (let k = 0; k <= STRIPS; k++) {
        const f = k / STRIPS;
        gain[v0 + k * 2] = gTL + (gTR - gTL) * f;
        gain[v0 + k * 2 + 1] = gBL + (gBR - gBL) * f;
      }
    }
  }

  /** Depois de `relief.computeLight` (troca da hora do dia): reescreve o brilho de todos os blocos. */
  refreshLight(): void {
    for (const gb of this.gainBufs) { this.writeGain(gb); gb.buf.update(); }
  }

  /** Coordenadas de textura das STRIPS+1 colunas da célula (atlas normalizado; meio texel para dentro nas bordas). */
  private writeUV(uv: Float32Array, v0: number, id: number): void {
    const [u0, t0] = this.uvOf(id);
    const W = this.atlasW, H = this.atlasH;
    for (let k = 0; k <= STRIPS; k++) {
      const u = (u0 + Math.min(TILE - 0.01, Math.max(0.01, k * TILE / STRIPS))) / W;
      const top = v0 + k * 2, bot = top + 1;
      uv[top * 2] = u; uv[top * 2 + 1] = (t0 + 0.01) / H;
      uv[bot * 2] = u; uv[bot * 2 + 1] = (t0 + TILE - 0.01) / H;
    }
  }

  /** Recorte por bloco e quadro da água (`step` 0..3). `view` em px do mundo. */
  update(view: { x: number; y: number; w: number; h: number }, step: number): void {
    // a borda de baixo sobe até 127 px com o relevo: margem de 4 células
    const m = 4 * TILE;
    const x0 = Math.max(0, Math.floor(view.x / (CHUNK * TILE))), x1 = Math.min(this.chunkCols - 1, Math.floor((view.x + view.w) / (CHUNK * TILE)));
    const y0 = Math.max(0, Math.floor((view.y - m) / (CHUNK * TILE))), y1 = Math.floor((view.y + view.h + m) / (CHUNK * TILE));
    const vis = new Set<number>();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = cy * this.chunkCols + cx; if (this.meshes[i]) vis.add(i); }
    for (const i of this.visible) if (!vis.has(i)) this.meshes[i]!.visible = false;
    for (const i of vis) {
      const fresh = !this.visible.has(i);
      if (fresh) this.meshes[i]!.visible = true;
      const wl = this.water[i]!;
      if (wl.length && (fresh || step !== this.waterStep)) {
        const buf = this.uvBufs[i]!, uv = buf.data as Float32Array;
        for (const wt of wl) this.writeUV(uv, wt.v, (32 + 4 * ((wt.g + step) & 3) + wt.w) * 16 + wt.r);
        buf.update();
      }
    }
    this.waterStep = step;
    this.visible = vis;
  }

  destroy(): void { this.root.destroy({ children: true }); this.shader?.destroy(); }
}

/** Atlas das colunas de tiles: arquivo f em x = 32·f; tile ausente = magenta (como antes). */
function buildAtlas(files: Texture[]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, files.length) * TILE;
  cv.height = 16 * TILE;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  files.forEach((t, f) => {
    const res = (t.source as unknown as { resource?: CanvasImageSource }).resource;
    if (!res || !t.width) return;
    try { ctx.clearRect(f * TILE, 0, TILE, Math.min(cv.height, t.height)); ctx.drawImage(res, 0, 0, TILE, Math.min(cv.height, t.height), f * TILE, 0, TILE, Math.min(cv.height, t.height)); } catch { /* imagem não legível */ }
  });
  return cv;
}
