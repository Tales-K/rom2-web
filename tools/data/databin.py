"""Parser de world/data/data.bin (Rage of Mages II / Allods 2).

data.bin é um arquivo de serialização MFC (CArchive) gerado pelo próprio jogo a partir de
planilhas .txt (Shapes.txt, Materials.txt, Magic.txt, Armors.txt, Shields.txt, Weapons.txt,
Magic Items.txt, Units.txt, Humans.txt, Buildings.txt, Spells.txt). O código de carga está em
allods2.exe: CDataBase::Serialize @0x4fac89 (ver notes/data-bin-format.md).

Uso:  python tools/data/databin.py [caminho/data.bin] [saida.json]
      (padrões: C:/Users/TALES K/Games/allods2-extracted/world/data/data.bin e data/databin_raw.json)
"""
import json
import struct
import sys
from pathlib import Path

DEFAULT_SRC = r"C:\Users\TALES K\Games\allods2-extracted\world\data\data.bin"
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "data" / "databin_raw.json"


class Reader:
    def __init__(self, data: bytes):
        self.d = data
        self.p = 0

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def i32s(self, n):
        v = list(struct.unpack_from("<%di" % n, self.d, self.p))
        self.p += 4 * n
        return v

    def f64s(self, n):
        v = list(struct.unpack_from("<%dd" % n, self.d, self.p))
        self.p += 8 * n
        return v

    def raw(self, n):
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    # CArchive >> CString: u8 len; 0xff -> u16 len; 0xffff -> u32 len (ANSI, cp1252)
    def cstring(self):
        n = self.u8()
        if n == 0xFF:
            n = self.u16()
            if n == 0xFFFE:
                raise ValueError("CString unicode nao suportado @%x" % self.p)
            if n == 0xFFFF:
                n = self.u32()
        return self.raw(n).decode("cp1252")

    # CArchive::ReadCount: WORD; 0xffff -> DWORD
    def count(self):
        n = self.u16()
        if n == 0xFFFF:
            n = self.u32()
        return n

    def string_array(self):
        return [self.cstring() for _ in range(self.count())]


def read_base(r):
    """CDataRow (Serialize @0x4fe3ab): nome + CArray<int> (um valor por coluna)."""
    name = r.cstring()
    vals = r.i32s(r.count())
    return {"name": name, "values": vals}


def read_shape(r):
    """Shape/Material (Serialize @0x4fe455): nome + 9 doubles (0x48 bytes)."""
    return {"name": r.cstring(), "doubles": r.f64s(9)}


def read_item(r):
    """Armor/Shield/Weapon (Serialize @0x4fe3f9): base + 14 bytes + CStringArray."""
    row = read_base(r)
    row["extra"] = list(r.raw(14))
    row["strings"] = r.string_array()
    return row


def read_magic(r):
    """Magic item (Serialize @0x4fe55d): base + 1 byte + CString (efeitos em texto)."""
    row = read_base(r)
    row["flag"] = r.u8()
    row["effects"] = r.cstring()
    return row


def read_unit(r):
    """Unit/monstro (Serialize @0x4fe8dc): base + 2 CStrings (knownSpells, EquipItem)."""
    row = read_base(r)
    row["strings"] = [r.cstring() for _ in range(2)]
    return row


def read_human(r):
    """Human (Serialize @0x4ff159): base + 10 CStrings (knownSpells? + itens equipados)."""
    row = read_base(r)
    row["strings"] = [r.cstring() for _ in range(10)]
    return row


def read_spell(r):
    """Spell (Serialize @0x4ff6e9): base + CString (efeitos)."""
    row = read_base(r)
    row["effects"] = r.cstring()
    return row


def read_table(r, reader, from_one):
    n = r.u32()
    start = 1 if from_one else 0   # tabelas que começam em 1 guardam um elemento 0 vazio não serializado
    return [reader(r) for _ in range(start, n)]


def parse(data: bytes):
    r = Reader(data)
    out = {}
    out["shapeColumns"] = r.string_array()
    out["shapes"] = read_table(r, read_shape, False)
    out["materials"] = read_table(r, read_shape, False)
    out["parameterColumns"] = r.string_array()
    out["parameters"] = read_table(r, read_base, False)
    out["itemColumns"] = r.string_array()
    out["armors"] = read_table(r, read_item, True)
    out["shields"] = read_table(r, read_item, True)
    out["weapons"] = read_table(r, read_item, True)
    out["magicItemColumns"] = r.string_array()
    out["magicItems"] = read_table(r, read_magic, True)
    out["unitColumns"] = r.string_array()
    out["units"] = read_table(r, read_unit, True)
    out["humanColumns"] = r.string_array()
    out["humans"] = read_table(r, read_human, True)
    out["buildingColumns"] = r.string_array()
    out["buildings"] = read_table(r, read_base, True)
    out["spellColumns"] = r.string_array()
    out["spells"] = read_table(r, read_spell, True)
    out["_end"] = r.p
    out["_size"] = len(data)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    db = parse(Path(src).read_bytes())
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")
    print("ok: %d/%d bytes; " % (db["_end"], db["_size"]) +
          ", ".join("%s=%d" % (k, len(v)) for k, v in db.items() if isinstance(v, list) and not k.endswith("Columns")))


if __name__ == "__main__":
    main()
