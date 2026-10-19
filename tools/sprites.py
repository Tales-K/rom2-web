"""Decodificador dos sprites .256 / .16a do Rage of Mages II (ver notes/formats.md; conferido por desmontagem do allods2.exe).

Layout: [paleta de 1024 bytes (256 x B,G,R,0), so se o bit 31 do trailer estiver ligado]
        N frames [u32 w][u32 h][u32 len][dados]   (N = trailer & 0x7fffffff)
        u32 trailer (ultimos 4 bytes)
Dados de cada frame: fluxo RLE linha a linha (ver decode_frame).
  .256: tokens de 1 byte: 00..3F literais (1 byte = indice), 40..7F pula linhas, 80..FF pula (t & 0x3f) pixels
  .16a: tokens de 2 bytes: 0x4000 pula linhas (testado primeiro), 0x8000 pula pixels, senao t literais de 2 bytes
  Uma linha termina quando a soma de pulos+literais chega a `w`.
Pixel .16a (16 bits): bit 0 = 0, bits 1..8 = indice da paleta, bits 9..12 = nivel de opacidade n (0..15);
  o blitter (0x45889b) faz cor*(n+1)/16 + fundo*(16-n)/16. Modo padrao "idx_alpha"; "legacy" = decodificacao antiga
  (indice = byte baixo, alfa 0..31), que deixava cursores/bandeiras pontilhados. rgb565/argb1555: alternativas descartadas.

Uso (com o venv do projeto, que tem Pillow):
  .venv/Scripts/python.exe tools/sprites.py <arquivo.256|.16a> <saida.png> [--scale N] [--mode idx_alpha|legacy] [--rgb]
  (a paleta e BGR por padrao -- confirmado visualmente; --rgb inverte)
"""
import struct
import sys

from PIL import Image


class RleError(ValueError):
    pass


GRAY = [(i, i, i) for i in range(256)]
NIBBLE_GRAY = [(i * 17,) * 3 for i in range(16)] + [(255, 255, 255)] * 240  # .16: valor 0..15 como intensidade


def read_sprite(path, palette=None):
    """Devolve (paleta, frames, wide). Trailer (u32 no fim, lido pelo carregador 0x424559 do allods2.exe):
    bit 31 = o arquivo traz paleta de 1024 bytes no inicio; bits 0..30 = numero de frames.
    Sem paleta (flechas de projectiles/archer|orc|xbowman): usa `palette` (lista de 256 tuplas na mesma ordem B,G,R
    do arquivo; ver bmp_palette) ou uma rampa de cinza."""
    b = open(path, "rb").read()
    if len(b) < 8:
        raise ValueError("arquivo curto demais")
    trailer = struct.unpack_from("<I", b, len(b) - 4)[0]
    count, has_pal = trailer & 0x7FFFFFFF, bool(trailer >> 31)
    nibble = path.lower().endswith(".16")  # .16 (fontes font1..3): 4 bits por pixel, sem paleta no arquivo
    if has_pal:
        pal = [tuple(b[i:i + 3]) for i in range(0, 1024, 4)]
        pos = 1024
    else:
        pal = list(palette) if palette else NIBBLE_GRAY if nibble else GRAY
        pos = 0
    wide = path.lower().endswith(".16a")
    frames = []
    for _ in range(count):
        w, h, n = struct.unpack_from("<III", b, pos)
        if w > 4096 or h > 4096 or pos + 12 + n > len(b) - 4:
            raise ValueError("frame %d fora do arquivo" % len(frames))
        frames.append((w, h, decode_frame(w, h, b[pos + 12:pos + 12 + n], wide, nibble)))
        pos += 12 + n
    return pal, frames, wide


def bmp_palette(path):
    """Paleta de um BMP de 8 bits (os .pal do jogo), na ordem B,G,R do arquivo (como a paleta embutida dos sprites)."""
    b = open(path, "rb").read()
    off = 14 + struct.unpack_from("<I", b, 14)[0]
    return [tuple(b[off + 4 * i:off + 4 * i + 3]) for i in range(256)]


def decode_frame(w, h, d, wide, nibble=False):
    """Devolve lista de h linhas, cada uma com w valores (None = transparente, int = pixel bruto).

    Semantica dos tokens conferida nos blitters do allods2.exe (0x454abc.. para .256, 0x45889b para .16a):
      .256: `t & 0xC0` == 0x00 -> t&0x3f literais | 0x40 -> pula t&0x3f linhas | 0x80 ou 0xC0 -> pula t&0x3f pixels
      .16a: testa 0x4000 primeiro (pula t&0x3fff linhas; vale tambem para 0xC000) | 0x8000 -> pula t&0x3fff pixels |
            senao t literais (palavras de 16 bits)
      .16 (nibble=True; blitter 0x454140): tokens como no .256, mas o literal t traz t BYTES = 2 pixels cada
            (nibble baixo primeiro); nibble alto 0 no ultimo byte = so 1 pixel (o jogo desconta 1 de x).
    """
    bs = 2 if wide else 1
    if wide:
        def kind(t):
            return ("v", t & 0x3fff) if t & 0x4000 else ("h", t & 0x3fff) if t & 0x8000 else ("l", t)
    else:
        def kind(t):
            k = t & 0xC0
            return ("l" if k == 0 else "v" if k == 0x40 else "h", t & 0x3f)
    i, rows = 0, []

    def rd():
        nonlocal i
        if i + bs > len(d):
            raise RleError("fim inesperado dos dados")
        v = int.from_bytes(d[i:i + bs], "little")
        i += bs
        return v

    row = []
    while len(rows) < h:
        k, t = kind(rd())
        if k == "v":
            # salto vertical: o jogo desce t linhas mantendo x. Aparece no inicio da linha e, no firebolt, depois de
            # um literal vazio ("00 41"); com x > 0 nao ocorre nos dados.
            if row:
                raise RleError("salto vertical no meio da linha")
            rows.extend([[None] * w for _ in range(min(t, h - len(rows)))])
            continue
        if k == "h":
            row.extend([None] * t)
        elif nibble:
            if i + t > len(d):
                raise RleError("literal passa do fim")
            for n in range(t):
                c = d[i + n]
                row.append(c & 15)
                if c >> 4:
                    row.append(c >> 4)
                elif n != t - 1:
                    raise RleError("nibble alto 0 no meio do literal")
            i += t
        else:
            if i + t * bs > len(d):
                raise RleError("literal passa do fim")
            row.extend(int.from_bytes(d[i + n * bs:i + n * bs + bs], "little") for n in range(t))
            i += t * bs
        if len(row) > w:
            raise RleError("linha passa da largura")
        if len(row) == w:
            rows.append(row)
            row = []
    if i != len(d):
        raise RleError("sobraram %d bytes" % (len(d) - i))
    return rows


def pixel16_index(v):
    """Indice da paleta de um pixel .16a: bits 1..8 (o bit 0 e sempre 0)."""
    return (v >> 1) & 0xFF


def pixel16_level(v):
    """Nivel de opacidade 0..15 de um pixel .16a: bits 9..12."""
    return (v >> 9) & 0xF


def pixel16_alpha(v):
    """Alfa 0..255 equivalente: o jogo faz cor*(n+1)/16 + fundo*(16-n)/16 (n = nivel); n=15 vira 255 (opaco)."""
    return (pixel16_level(v) + 1) * 16 - 1


def to_rgba(rows, palette, wide, mode="idx_alpha", bgr=True):
    pal = [(c[2], c[1], c[0]) if bgr else c for c in palette]
    out = []
    for row in rows:
        for v in row:
            if v is None:
                out.append((0, 0, 0, 0))
            elif not wide:
                out.append(pal[v] + (255,))
            elif mode == "idx_alpha":
                out.append(pal[pixel16_index(v)] + (pixel16_alpha(v),))
            elif mode == "legacy":  # decodificacao antiga (indice = byte baixo, alfa 0..31): so para comparacao
                out.append(pal[v & 0xff] + (min(v >> 8, 31) * 255 // 31,))
            elif mode == "rgb565":
                out.append(((v >> 11) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31, 255))
            else:  # argb1555
                out.append((((v >> 10) & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, (v & 31) * 255 // 31, 255 if v & 0x8000 else 0))
    return out


def atlas(path, scale=1, bgr=False, mode="idx_alpha", cols=8):
    palette, frames, wide = read_sprite(path)
    if not frames:
        raise ValueError("sem frames")
    cw, ch = max(f[0] for f in frames), max(f[1] for f in frames)
    nrows = (len(frames) + cols - 1) // cols
    img = Image.new("RGBA", (cols * cw, nrows * ch), (60, 60, 60, 255))
    for n, (w, h, rows) in enumerate(frames):
        tile = Image.new("RGBA", (w, h))
        tile.putdata(to_rgba(rows, palette, wide, mode, bgr))
        img.alpha_composite(tile, ((n % cols) * cw, (n // cols) * ch))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    return img


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    opts = dict(zip(a[2:], a[3:]))
    atlas(a[0], int(opts.get("--scale", 1)), "--rgb" not in a, opts.get("--mode", "idx_alpha")).save(a[1])
    print("ok", a[1])
