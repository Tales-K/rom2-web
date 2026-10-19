"""Leitor dos arquivos .reg do Rage of Mages II (base de dados em arvore; assinatura "&YA1", variante do contêiner .res).

Layout (little-endian):
  0x00 "&YA1", u32 0, u32 n_raiz, u32 flags (0x11), u32 n_entradas, u32 0, u32 0       (cabecalho de 0x1c bytes)
  0x1c n_entradas x 32 bytes:  u32 a, u32 b, u32 tipo, char[20] nome
  depois da tabela: area de dados
Tipos (confirmados em units.reg):
  0 = texto   (a = offset na area de dados, b = tamanho em bytes incluindo o NUL)
  1 = pasta   (a = indice do 1o filho, b = quantidade de filhos)
  2 = inteiro (a = valor)
  6 = vetor de inteiros u32 (a = offset na area de dados, b = tamanho em bytes)
Os filhos da raiz sao as n_raiz primeiras entradas.

Uso: python tools/reg.py <arquivo.reg> [--json saida.json]
"""
import json
import struct
import sys

HEAD = struct.Struct("<4s6I")
ENT = struct.Struct("<III20s")


class RegError(ValueError):
    pass


def parse(data):
    magic, z, nroot, flags, n, u1, u2 = HEAD.unpack_from(data, 0)
    if magic != b"&YA1":
        raise RegError("assinatura invalida")
    base = HEAD.size
    ds = base + ENT.size * n
    if ds > len(data):
        raise RegError("tabela passa do fim do arquivo")
    ents = []
    for i in range(n):
        a, b, k, raw = ENT.unpack_from(data, base + i * ENT.size)
        ents.append((a, b, k, raw.split(b"\0")[0].decode("latin-1")))
    unknown = set()

    def value(i, depth=0):
        a, b, k, name = ents[i]
        if k == 1:
            if a + b > n or depth > 32:
                raise RegError("pasta %r aponta para fora da tabela" % name)
            return {ents[c][3]: value(c, depth + 1) for c in range(a, a + b)}
        if k == 2:
            return a
        if k == 0:
            if ds + a + b > len(data):
                raise RegError("texto %r fora da area de dados" % name)
            return data[ds + a:ds + a + b].split(b"\0")[0].decode("latin-1")
        if k == 6:
            if ds + a + b > len(data):
                raise RegError("vetor %r fora da area de dados" % name)
            return list(struct.unpack_from("<%dI" % (b // 4), data, ds + a))
        unknown.add(k)
        return {"_kind": k, "a": a, "b": b}
    tree = {ents[i][3]: value(i) for i in range(nroot)}
    return tree, unknown


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    tree, unknown = parse(open(a[0], "rb").read())
    print("raiz:", len(tree), "tipos desconhecidos:", sorted(unknown))
    if "--json" in a:
        json.dump(tree, open(a[a.index("--json") + 1], "w", encoding="utf-8"), indent=1)
