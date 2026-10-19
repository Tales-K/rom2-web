"""Leitor/extrator dos arquivos .res do Rage of Mages II / Allods 2 (magic "&YA1").

Somente leitura. Formato deduzido por engenharia reversa (ver notes/res-format.md).

Layout (little-endian):
  0x00  4s  magic "&YA1"
  0x04  u32 root_first   indice da primeira entrada filha da raiz
  0x08  u32 root_count   quantidade de filhos da raiz
  0x0C  u32 flags        0x01 / 0x10 / 0x11 (significado ainda desconhecido)
  0x10  u32 dir_offset   deslocamento da tabela de entradas
  0x14  u32 entry_count  total de entradas na tabela
  0x18  ...              dados dos arquivos
  dir_offset: entry_count * 32 bytes
    u32 zero?   (sempre 0 ate agora)
    u32 a       arquivo: offset dos dados | diretorio: indice do primeiro filho
    u32 b       arquivo: tamanho          | diretorio: quantidade de filhos
    u32 kind    0 = arquivo, 1 = diretorio
    16s name    ASCII, preenchido com NUL (ou 0xCD)

Uso:
  python -I ya1.py list    <arquivo.res> [--max N]
  python -I ya1.py extract <arquivo.res> <pasta_saida>
  python -I ya1.py check   <arquivo.res>
"""
import mmap
import os
import struct
import sys

MAGIC = b"&YA1"
ENTRY = struct.Struct("<IIII16s")
HEADER = struct.Struct("<4sIIIII")


class Node:
    __slots__ = ("name", "is_dir", "a", "b", "zero", "children")

    def __init__(self, name, is_dir, a, b, zero):
        self.name, self.is_dir, self.a, self.b, self.zero = name, is_dir, a, b, zero
        self.children = []


class Archive:
    def __init__(self, buf, base=0, length=None):
        self.buf = buf
        self.base = base
        self.length = len(buf) - base if length is None else length
        magic, self.root_first, self.root_count, self.flags, self.dir_offset, self.count = HEADER.unpack_from(buf, base)
        if magic != MAGIC:
            raise ValueError("magic invalido: %r" % magic)
        if self.dir_offset + self.count * ENTRY.size > self.length:
            raise ValueError("tabela de entradas fora do arquivo")
        self.entries = []
        for i in range(self.count):
            zero, a, b, kind, raw = ENTRY.unpack_from(buf, base + self.dir_offset + i * ENTRY.size)
            name = raw.split(b"\x00", 1)[0].split(b"\xcd", 1)[0].decode("latin-1")
            self.entries.append(Node(name, kind == 1, a, b, zero))
        for n in self.entries:
            if n.is_dir:
                if n.a + n.b > self.count:
                    raise ValueError("diretorio %r aponta para fora da tabela" % n.name)
                n.children = self.entries[n.a:n.a + n.b]
        if self.root_first + self.root_count > self.count:
            raise ValueError("raiz fora da tabela")
        self.root = self.entries[self.root_first:self.root_first + self.root_count]

    def data(self, node):
        if node.a + node.b > self.dir_offset:
            raise ValueError("dados de %r fora da area de dados" % node.name)
        return self.buf[self.base + node.a:self.base + node.a + node.b]

    def walk(self, nodes=None, prefix=""):
        for n in (self.root if nodes is None else nodes):
            path = prefix + n.name
            yield path, n
            if n.is_dir:
                yield from self.walk(n.children, path + "/")


def safe_join(root, rel):
    target = os.path.normpath(os.path.join(root, *rel.split("/")))
    if os.path.commonpath([os.path.abspath(root), os.path.abspath(target)]) != os.path.abspath(root):
        raise ValueError("caminho suspeito: %r" % rel)
    return target


def open_archive(path):
    f = open(path, "rb")
    return Archive(mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ))


def cmd_list(path, limit):
    ar = open_archive(path)
    print("flags=0x%x entradas=%d raiz=%d" % (ar.flags, ar.count, ar.root_count))
    for i, (p, n) in enumerate(ar.walk()):
        if limit and i >= limit:
            print("...")
            break
        print("%s %10s  %s" % ("D" if n.is_dir else "F", "%d filhos" % n.b if n.is_dir else n.b, p))


def cmd_check(path):
    ar = open_archive(path)
    files = [(p, n) for p, n in ar.walk() if not n.is_dir]
    covered = sorted((n.a, n.a + n.b, p) for p, n in files)
    overlaps = sum(1 for x, y in zip(covered, covered[1:]) if y[0] < x[1])
    nonzero = sum(1 for e in ar.entries if e.zero)
    nested = sum(1 for p, n in files if n.b >= 4 and ar.data(n)[:4] == MAGIC)
    used = sum(n.b for _, n in files)
    print("arquivos=%d diretorios=%d bytes_em_arquivos=%d area_de_dados=%d" % (
        len(files), ar.count - len(files), used, ar.dir_offset - HEADER.size))
    print("sobreposicoes=%d  campo_zero_nao_nulo=%d  arquivos_YA1_aninhados=%d" % (overlaps, nonzero, nested))


def extract(ar, nodes, out, rel=""):
    count = 0
    for n in nodes:
        target = safe_join(out, rel + n.name)
        if n.is_dir:
            os.makedirs(target, exist_ok=True)
            count += extract(ar, n.children, out, rel + n.name + "/")
        else:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as fh:
                fh.write(ar.data(n))
            count += 1
    return count


def cmd_extract(path, out):
    if os.path.exists(out) and os.listdir(out):
        sys.exit("pasta de saida nao esta vazia: " + out)
    os.makedirs(out, exist_ok=True)
    ar = open_archive(path)
    print("extraidos %d arquivos para %s" % (extract(ar, ar.root, out), out))


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == "list":
        cmd_list(a[1], int(a[3]) if len(a) >= 4 and a[2] == "--max" else 0)
    elif len(a) == 2 and a[0] == "check":
        cmd_check(a[1])
    elif len(a) == 3 and a[0] == "extract":
        cmd_extract(a[1], a[2])
    else:
        sys.exit(__doc__)
