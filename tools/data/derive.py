"""Deriva os contratos JSON (game/public/data/{items,spells,unit-stats,unit-templates,classes}.json)
a partir de data.bin (tools/data/databin.py), itemname.pkt/.bin e dos textos do jogo.

Uso:  python tools/data/derive.py
Regras/fórmulas: ver docs/DATA.md (seção DADOS) e notes/data-bin-format.md.
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import databin  # noqa: E402

EXTRACTED = Path(r"C:\Users\TALES K\Games\allods2-extracted")
OUT = ROOT / "game" / "public" / "data"
TEXT = OUT / "texts"

TICKS_PER_SECOND = 25        # MapLogic.TICRATE (velocidade de jogo "normal")
REGEN_PERIOD_TICKS = 40      # regeneração a cada 40 tiques

# ---------------------------------------------------------------- tabelas fixas
PARAMS = ["", "price", "body", "mind", "reaction", "spirit", "health", "healthMax", "healthRegeneration", "mana",
          "manaMax", "manaRegeneration", "toHit", "damageMin", "damageMax", "defence", "absorbtion", "speed",
          "rotationSpeed", "scanRange", "protection0", "protectionFire", "protectionWater", "protectionAir",
          "protectionEarth", "protectionAstral", "fighterSkill0", "skillBlade", "skillAxe", "skillBludgeon",
          "skillPike", "skillShooting", "mageSkill0", "skillFire", "skillWater", "skillAir", "skillEarth",
          "skillAstral", "itemLore", "magicLore", "creatureLore", "castSpell", "teachSpell", "damage", "damageFire",
          "damageWater", "damageAir", "damageEarth", "damageAstral", "damageBonus", "spellPower", "consumable"]
SLOTS = {1: "weapon", 2: "shield", 3: "unused3", 4: "ring", 5: "amulet", 6: "helm", 7: "mail", 8: "cuirass",
         9: "bracers", 10: "gauntlets", 11: "unused11", 12: "boots", 14: "magic"}
ATTACK_TYPES = {1: "blade", 2: "axe", 3: "bludgeon", 4: "pike", 5: "shooting"}
SCHOOLS = {1: "fire", 2: "water", 3: "air", 4: "earth", 5: "astral"}
WEAPON_SKILLS = ["blade", "axe", "bludgeon", "pike", "shooting"]
MAGE_SKILLS = ["fire", "water", "air", "earth", "astral"]


def lines(name):
    return json.loads((TEXT / (name + ".json")).read_text(encoding="utf-8"))["lines"]


def rnd(x):
    """Arredondamento usado pelo jogo nos itens (meio para cima), conferido contra itemname.pkt."""
    return int(math.floor(x + 0.5))


# ---------------------------------------------------------------- carga
db = databin.parse(Path(databin.DEFAULT_SRC).read_bytes())
SHAPES = [r["name"] for r in db["shapes"]]
MATERIALS = [r["name"] for r in db["materials"]]
SHAPE_D = {r["name"]: r["doubles"] for r in db["shapes"]}
MAT_D = {r["name"]: r["doubles"] for r in db["materials"]}
# índices dos 9 doubles de Shape/Material (conferido contra itemname.pkt: 491/491 itens)
D_PRICE, D_WEIGHT, D_DAMAGE, D_TOHIT, D_DEFENCE, D_ABSORB, D_MAGCAP = 2, 3, 4, 5, 6, 7, 8
ITEM_COLS = ["shape", "material", "price", "weight", "slot", "attackType", "physicalMin", "physicalMax", "toHit",
             "defence", "absorbtion", "range", "charge", "relax", "twoHanded", "suitableFor", "otherParameter"]


def option_tables():
    """slot -> {optionIndex(1-based): row}; armaduras/escudos/armas."""
    t = {}
    for key in ("armors", "shields", "weapons"):
        for i, r in enumerate(db[key], start=1):
            d = dict(zip(ITEM_COLS, r["values"]))
            masks = struct.unpack("<7H", bytes(r["extra"]))  # por shape: máscara de bits de materiais permitidos
            d.update(name=r["name"], index=i, table=key, materialMasks=list(masks))
            t.setdefault(key, {})[i] = d
    return t


OPTIONS = option_tables()


def option_for(slot, idx):
    key = "weapons" if slot == 1 else "shields" if slot == 2 else "armors"
    return OPTIONS[key].get(idx)


def class_display(opt_name, material):
    """Nome do jogo: 'Soft X' + couro -> 'Leather X'; 'Wooden X' (escudo) + madeira -> 'Wood X'."""
    n = opt_name
    if n.startswith("Soft ") and material in ("Leather", "Hard Leather", "Dragon Leather"):
        n = n[5:]
    if n.startswith("Wooden ") and material in ("Wood", "Magic Wood"):
        n = n[7:]
    if n in ("Small", "Large", "Tower", "Soft Small", "Soft Large", "Wooden Small", "Wooden Large", "Wooden Tower"):
        n = n + " Shield"
    return n


def compute_item(shape, material, opt):
    """Estatísticas de um item = valor da classe × multiplicador do shape × multiplicador do material."""
    s, m = SHAPE_D[shape], MAT_D[material]

    def mul(base, k):
        return base * s[k] * m[k]

    out = {
        "price": max(0, rnd(mul(opt["price"], D_PRICE))),
        "weight": rnd(mul(opt["weight"], D_WEIGHT)),
        "magicCapacity": rnd(s[D_MAGCAP] * m[D_MAGCAP]),
    }
    if opt["physicalMax"] > 0:
        dmin = rnd(mul(opt["physicalMin"], D_DAMAGE))
        dmax = rnd(mul(opt["physicalMax"], D_DAMAGE))
        out["damage"] = {"min": dmin, "max": dmax}
    if opt["toHit"] > 0:
        out["toHit"] = rnd(mul(opt["toHit"], D_TOHIT))
    if opt["defence"] > 0:
        out["defense"] = rnd(mul(opt["defence"], D_DEFENCE))
    if opt["absorbtion"] > 0:
        out["absorption"] = int(mul(opt["absorbtion"], D_ABSORB) + 1e-9)  # absorção é truncada (pkt)
    return out


# ---------------------------------------------------------------- itens (itemname.pkt)
def read_pkt():
    d = (EXTRACTED / "world" / "data" / "itemname.pkt").read_bytes()
    n = struct.unpack_from("<I", d, 3)[0]
    p = 9
    out = []
    for _ in range(n):
        iid, _unk, flags, cnt, _size, _pid = struct.unpack_from("<HHBBBB", d, p)
        p += 8
        price = struct.unpack_from("<I", d, p)[0]
        p += 4
        eff = []
        for _ in range(cnt - 1):
            eff.append((d[p], d[p + 1]))  # valor sem sinal (Potion Fighter Bonus = 250)
            p += 2
        out.append({"id": iid, "flags": flags, "price": price, "effects": eff})
    assert p == len(d)
    return out


def decode_id(iid):
    return {"material": (iid >> 12) & 15, "slot": (iid >> 8) & 15, "shape": (iid >> 5) & 7, "option": iid & 31}


def effects_dict(eff):
    out = {}
    for k, v in eff:
        name = PARAMS[k] if k < len(PARAMS) else "param%d" % k
        out[name] = v
    return out


SPELL_NAMES = [r["name"] for r in db["spells"] if r["name"]]
SPELL_KEY = {n.replace(" ", "_").lower(): i for i, n in enumerate(SPELL_NAMES, start=1)}


def build_items():
    pkt = read_pkt()
    serv = lines("itemserv")
    disp = lines("itemname")
    binids = struct.unpack("<%dH" % len(pkt), (EXTRACTED / "world" / "data" / "itemname.bin").read_bytes())
    items, mismatch = {}, []
    for i, rec in enumerate(pkt):
        iid = rec["id"]
        assert binids[i] == iid
        f = decode_id(iid)
        e = effects_dict(rec["effects"])
        it = {"id": iid, "hex": "0x%04x" % iid, "name": disp[i], "serverName": serv[i], "price": rec["price"],
              "usableBy": [x for x, b in (("fighter", 2), ("mage", 4)) if rec["flags"] & b],
              "source": "itemname.pkt+data.bin"}
        if f["slot"] == 14:   # itens mágicos: livros, pergaminhos, poções, itens de missão
            idx = iid & 0xFF
            row = db["magicItems"][idx - 1]
            it.update(kind=("book" if row["name"].startswith("Book") else "scroll" if "Scroll" in row["name"]
                            else "potion" if row["name"].startswith("Potion") else "quest"),
                      slot="none", magicIndex=idx, weight=row["values"][1] if len(row["values"]) > 1 else 0,
                      effectsText=row["effects"])
            if "castSpell" in e:
                it["spell"] = e["castSpell"]
                it["spellName"] = SPELL_NAMES[e["castSpell"] - 1]
                it["spellPower"] = e.get("spellPower")
            if row["name"].startswith("Book"):
                it["school"] = row["name"].split()[1].lower()
            it["effects"] = {k: v for k, v in e.items() if k not in ("castSpell", "spellPower")}
            items[str(iid)] = it
            continue
        opt = option_for(f["slot"], f["option"])
        shape, material = SHAPES[f["shape"]], MATERIALS[f["material"]]
        calc = compute_item(shape, material, opt)
        it.update(kind="weapon" if f["slot"] == 1 else "shield" if f["slot"] == 2 else "armor",
                  shape=shape, material=material, itemClass=opt["name"], slot=SLOTS.get(f["slot"]), slotId=f["slot"],
                  weight=calc["weight"], magicCapacity=calc["magicCapacity"])
        # valores do pkt são a verdade do jogo; damageMax no pkt é a AMPLITUDE (max - min)
        if "damageMin" in e:
            it["damage"] = {"min": e["damageMin"], "max": e["damageMin"] + e.get("damageMax", 0)}
        if "toHit" in e:
            it["toHit"] = e["toHit"]
        if "defence" in e:
            it["defense"] = e["defence"]
        if "absorbtion" in e:
            it["absorption"] = e["absorbtion"]
        extra = {k: v for k, v in e.items() if k not in ("damageMin", "damageMax", "toHit", "defence", "absorbtion")}
        if extra:
            it["effects"] = extra
        add_weapon_fields(it, opt)
        # conferência da fórmula
        for k in ("damage", "toHit", "defense", "absorption", "price"):
            if it.get(k) != calc.get(k) and not (k == "price" and abs(it[k] - calc[k]) <= 1):
                mismatch.append((it["serverName"], k, it.get(k), calc.get(k)))
        items[str(iid)] = it
    return items, mismatch


def add_weapon_fields(it, opt):
    if opt["slot"] == 1:
        it["attackType"] = ATTACK_TYPES.get(opt["attackType"], "special%d" % opt["attackType"])
        it["range"] = max(1, opt["range"])
        it["charge"] = opt["charge"] if opt["charge"] > 0 else None
        it["relax"] = opt["relax"] if opt["relax"] > 0 else None
        it["twoHanded"] = opt["twoHanded"] == 2
        if opt["name"] in ("Staff", "Shaman Staff"):
            it["casterWeapon"] = True


def parse_item_spec(spec):
    """'Uncommon Steel Chain Helm {defence=10}' -> (shape, material, option, mods)."""
    spec = spec.strip().strip('"')
    mods = {}
    m = re.search(r"\{(.*)\}", spec)
    if m:
        for part in m.group(1).split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                k, v = k.strip(), v.strip()
                if k == "castSpell":
                    sp, _, pw = v.partition(":")
                    mods["castSpell"] = SPELL_KEY.get(sp.lower(), sp)
                    mods["spellPower"] = int(pw or 0)
                else:
                    mods[k[0].lower() + k[1:]] = int(v.lstrip("+"))
        spec = spec[:m.start()].strip()
    words = spec.split()
    shape = "Common"
    for s in sorted(SHAPES, key=len, reverse=True):
        if spec.startswith(s + " "):
            shape, spec = s, spec[len(s) + 1:]
            break
    material = "None"
    for mt in sorted(MATERIALS, key=len, reverse=True):
        if spec.startswith(mt + " "):
            material, spec = mt, spec[len(mt) + 1:]
            break
    name = spec.replace("Gauntless", "Gauntlets").replace("Cap", "Cap")
    cand = [name]
    if name.endswith(" Shield"):
        b = name[:-7]
        cand += [b, "Soft " + b, "Wooden " + b]
    cand += ["Soft " + name]
    for key in ("weapons", "shields", "armors"):
        for idx, o in OPTIONS[key].items():
            if o["name"] in cand:
                if (o["name"].startswith("Soft ") and material not in ("Leather", "Hard Leather", "Dragon Leather")
                        and name != o["name"]):
                    continue
                if (o["name"].startswith("Wooden ") and material not in ("Wood", "Magic Wood") and name != o["name"]):
                    continue
                return shape, material, o, mods, words
    return shape, material, None, mods, words


def item_id(shape, material, opt):
    return (MATERIALS.index(material) << 12) | (opt["slot"] << 8) | (SHAPES.index(shape) << 5) | opt["index"]


def resolve_equipment(spec, items, by_server):
    """Resolve um texto de equipamento de data.bin para um id de items.json (gerando o item se não existir)."""
    shape, material, opt, mods, _ = parse_item_spec(spec)
    if opt is None:
        return {"spec": spec, "id": None}
    iid = item_id(shape, material, opt)
    if str(iid) not in items:
        calc = compute_item(shape, material, opt)
        it = {"id": iid, "hex": "0x%04x" % iid,
              "name": ("" if shape == "Common" else shape + " ") + ("" if material == "None" else material + " ")
              + class_display(opt["name"], material),
              "serverName": "%s %s %s" % (shape, material, class_display(opt["name"], material)),
              "kind": "weapon" if opt["slot"] == 1 else "shield" if opt["slot"] == 2 else "armor",
              "shape": shape, "material": material, "itemClass": opt["name"], "slot": SLOTS.get(opt["slot"]),
              "slotId": opt["slot"], "usableBy": {1: ["fighter"], 2: ["mage"], 3: ["fighter", "mage"]}.get(
                  opt["suitableFor"], ["fighter", "mage"]),
              "source": "data.bin (calculado; nao esta em itemname.pkt)"}
        it.update(calc)
        add_weapon_fields(it, opt)
        items[str(iid)] = it
    out = {"id": iid, "name": items[str(iid)]["name"]}
    if mods:
        out["mods"] = mods
    return out


# ---------------------------------------------------------------- magias
def build_spells(items):
    desc = {}
    for ln in lines("spells"):
        if "#" in ln:
            t, d = ln.split("#", 1)
            desc[re.sub(r"\s*\(.*\)", "", t).strip().lower()] = (d.strip(), re.findall(r"\((.*?)\)", t))
    disp = lines("spell")
    cols = ["level", "manaCost", "sphere", "item", "target", "delivery", "maxRange", "effectSpeed", "distribution",
            "radius", "areaAffect", "areaDuration", "areaFrequency", "applyMethod", "duration", "frequency",
            "damageMin", "damageMax", "defensive", "skillOffset", "scrollCost", "bookCost"]
    scrolls = {}
    for it in items.values():
        if it.get("kind") == "scroll":
            scrolls.setdefault(it["spell"], {})["superScroll" if it["serverName"].startswith("Super") else "scroll"] = it["id"]
    out = {}
    for i, r in enumerate(db["spells"], start=1):
        if not r["name"]:
            continue
        v = dict(zip(cols, r["values"]))
        name = disp[i - 1] if i - 1 < len(disp) else r["name"]
        d, tags = desc.get(name.lower(), desc.get(r["name"].lower(), ("", [])))
        sp = {"id": i, "name": name, "internalName": r["name"], "school": SCHOOLS.get(v["sphere"]),
              "level": v["level"], "manaCost": v["manaCost"], "range": v["maxRange"] if v["maxRange"] >= 0 else None,
              "effectSpeed": v["effectSpeed"], "target": v["target"], "delivery": v["delivery"],
              "distribution": v["distribution"], "radius": v["radius"], "areaAffect": v["areaAffect"],
              "areaDuration": v["areaDuration"], "areaFrequency": v["areaFrequency"], "applyMethod": v["applyMethod"],
              "duration": v["duration"], "frequency": v["frequency"], "defensive": v["defensive"] == 1,
              "skillOffset": v["skillOffset"], "scrollCost": v["scrollCost"], "bookCost": v["bookCost"],
              "description": d, "castType": tags[0] if tags else None, "effects": r["effects"].strip('"') or None,
              # o texto exato de data.bin (definição+0x1c): o exe o lê sem tirar as aspas (Stone Curse: '"absorbtion=..."' não
              # casa nenhum nome em 0x51e8fa e o efeito fica sem tipo)
              "effectsRaw": r["effects"] or None,
              "source": "data.bin"}
        if v["damageMax"] >= 0:
            sp["damage"] = {"min": v["damageMin"], "max": v["damageMax"]}
        sp.update(scrolls.get(i, {}))
        out[str(i)] = sp
    return out


# ---------------------------------------------------------------- unidades
UNIT_INT_COLS = db["unitColumns"][1:57] + ["knownSpells", "skillFire", "skillWater", "skillAir", "skillEarth",
                                           "skillAstral"]
HUMAN_INT_COLS = ["body", "reaction", "mind", "spirit", "healthMax", "manaMax", "speed", "rotationSpeed",
                  "scanRange", "defence", "skillGeneral", "skill1", "skill2", "skill3", "skill4", "skill5",
                  "typeID", "face", "female", "attackChargeTime", "attackRelaxTime", "tokenSize", "movementType",
                  "dyingTime", "serverID", "knownSpells"]


def spell_list(mask):
    if mask is None or mask < 0:
        return []
    return [i for i in range(1, 32) if mask >> i & 1 and i <= len(SPELL_NAMES)]


def nz(v, default=0):
    return default if v is None or v < 0 else v


def pow11(v):
    return 1.1 ** v


def log11(v):
    return math.log(v) / math.log(1.1)


def skill_exp(v):
    """Experiência acumulada para atingir o valor de habilidade v."""
    return int((1.1 ** v - 1) * 1000) if v > 0 else 0


HERO_CAPS = {(False, False): (52, 50, 48, 46), (False, True): (50, 52, 46, 48),   # (mago?, mulher?) -> B/R/M/S
             (True, False): (48, 46, 52, 50), (True, True): (46, 48, 50, 52)}    # allods2.exe @0x5136a5


def human_stats(h, equip, items, hero=False, mage=False, exp_total=None, female=False):
    """Estatísticas derivadas de um humano/herói = allods2.exe @0x51366b (vtable de humanos, slot 0x58).
    Vale para heróis e NPCs humanos. Ver docs/DATA.md (seção DADOS)."""
    it = {}
    weight = 0
    for e in equip:
        if e.get("id") is None:
            continue
        x = items[str(e["id"])]
        weight += x.get("weight", 0)
        for k in ("defense", "absorption", "toHit"):
            it[k] = it.get(k, 0) + x.get(k, 0)
        if x.get("slot") == "weapon":
            it["weapon"] = x
        for k, v in (x.get("effects") or {}).items():
            it[k] = it.get(k, 0) + v
        for k, v in (e.get("mods") or {}).items():
            if k in ("castSpell", "spellPower"):
                continue
            k = {"defence": "defense", "absorbtion": "absorption"}.get(k, k)
            it[k] = it.get(k, 0) + v
    caps = HERO_CAPS[(bool(mage), bool(female))]
    base = [nz(h[k]) for k in ("body", "reaction", "mind", "spirit")]
    if hero:
        base = [min(c, v) for c, v in zip(caps, base)]
    body, reaction, mind, spirit = [v + it.get(k, 0) for v, k in zip(base, ("body", "reaction", "mind", "spirit"))]
    skills = [min(100, nz(h["skill%d" % k])) for k in range(1, 6)]
    skills = [s + it.get("skill" + n.capitalize(), 0) for s, n in zip(skills, MAGE_SKILLS if mage else WEAPON_SKILLS)]
    weapon = it.get("weapon")
    fighter = not mage
    wtype = 0
    if fighter:
        wtype = WEAPON_SKILLS.index(weapon["attackType"]) + 1 if weapon and weapon.get("attackType") in WEAPON_SKILLS else 0
    fskill = skills[wtype - 1] if wtype else 0
    if exp_total is None:
        exp_total = sum(skill_exp(nz(h["skill%d" % k])) for k in range(1, 6))
    f = 2 if fighter else 1
    hp = body * f
    hp = int(hp + log11(exp_total / 5000 + 1) * f)
    hp = int((pow11(body) / 100 + 1) * hp) + it.get("healthMax", 0)
    mp = 0
    if mage and (h["manaMax"] or 0) > 0:
        m = 1 if fighter else 2
        mp = spirit * 2
        mp = int(mp + log11(exp_total / 5000 + 1) * m)
        mp = int((pow11(spirit) / 100 + 1) * mp) + it.get("manaMax", 0)
    scan = (mind + reaction) / 25 + 4 + it.get("scanRange", 0)
    capacity = body * 10 + 1
    speed = reaction if reaction < 12 else reaction // 5 + 12
    if h["typeID"] in (19, 21):
        speed += 10
    load = weight // 2
    if load >= capacity:
        speed = max(6, speed - load // capacity)
    speed += it.get("speed", 0)
    rot = speed + it.get("rotationSpeed", 0)
    dbase = int(pow11(body) / 20)
    dmin = dbase + (fskill // 5 if wtype else 0)
    ddelta = dbase
    to_hit = int((pow11(body) + pow11(reaction)) / 5) + (3 * fskill if wtype else 0) + it.get("toHit", 0)
    if weapon and weapon.get("damage"):
        dmin += weapon["damage"]["min"]
        ddelta += weapon["damage"]["max"] - weapon["damage"]["min"]
    dmin += it.get("damageMin", 0)
    defense = reaction // 3 + it.get("defense", 0)
    pmax = min(100, 70 + spirit // 2)
    resist = {el: max(0, min(pmax, spirit // 2 + it.get("protection" + el.capitalize(), 0))) for el in MAGE_SKILLS}
    return {"body": body, "reaction": reaction, "mind": mind, "spirit": spirit, "health": hp,
            "mana": mp, "speed": speed, "turnSpeed": rot, "sight": round(scan, 2), "attack": to_hit,
            "damage": {"min": dmin, "max": dmin + ddelta}, "defense": defense,
            "absorption": it.get("absorption", 0), "resist": resist, "capacity": capacity,
            "range": weapon.get("range", 1) if weapon else 1,
            "attackSkill": WEAPON_SKILLS[wtype - 1] if wtype else "none",
            "charge": weapon.get("charge") if weapon else None, "relax": weapon.get("relax") if weapon else None,
            "skillValue": fskill, "expTotal": exp_total}


def build_units(items):
    unames = lines("unitname")
    regunits = json.loads((OUT / "units.json").read_text(encoding="utf-8"))
    templates = {}
    by_type = {}
    for idx, r in enumerate(db["units"], start=1):
        if not r["name"] or r["name"] == "Human":
            continue
        v = dict(zip(UNIT_INT_COLS, r["values"]))
        t = v["typeID"]
        level = 1
        m = re.search(r"\.(\d)$", r["name"])
        if m:
            level = int(m.group(1))
        equip = [resolve_equipment(s, items, None) for s in r["strings"] if s]
        weapon = None
        for e in equip:
            if e.get("id") is not None and items[str(e["id"])].get("slot") == "weapon":
                weapon = items[str(e["id"])]
        dmin, dmax = nz(v["physicalMin"]), nz(v["physicalMax"])
        if dmax < dmin:
            dmax = dmin
        delta = dmax - dmin
        if dmin >= 128 or delta > dmin + 255:   # bytes do jogo: min|0x80 e amplitude em unidades de 15 (@0x51164e)
            dmin, delta = min(dmin // 15, 127) * 15, min(delta // 15, 255) * 15
        dmax = dmin + delta
        spells = spell_list(v["knownSpells"])
        for e in equip:
            if (e.get("mods") or {}).get("castSpell"):
                spells.append(e["mods"]["castSpell"])
        name = unames[t] if 0 <= t < len(unames) and unames[t] else regunits.get(str(t), {}).get("name", r["name"])
        st = {
            "name": name, "template": r["name"], "serverId": v["serverID"], "typeId": t, "level": level,
            "health": nz(v["healthMax"]), "mana": nz(v["manaMax"]),
            "healthRegen": nz(v["HP regeneraton"]), "manaRegen": nz(v["MP regeneraton"]),
            "speed": nz(v["speed"], 1) or 1, "turnSpeed": nz(v["rotationSpeed"], 1) or 1, "sight": nz(v["scanRange"]),
            "attack": nz(v["toHit"]), "damage": {"min": dmin, "max": dmax},
            "defense": nz(v["defence"]), "absorption": nz(v["absorbtion"]),
            "range": max(1, weapon["range"]) if weapon and weapon.get("range") else 1,
            "attackSkill": "none", "attackKind": v["attackKind"], "alwaysHit": v["attackKind"] == 3,
            "charge": nz(v["attackChargeTime"]), "relax": nz(v["attackRelaxTime"]),
            "resist": {"fire": nz(v["prot Fire"]), "water": nz(v["prot Water"]), "air": nz(v["prot Air"]),
                       "earth": nz(v["prot Earth"]), "astral": nz(v["prot Astral"])},
            "resistPhysical": {"blade": nz(v["res.Blade"]), "axe": nz(v["res.Axe"]), "bludgeon": nz(v["res.Bludgeon"]),
                               "pike": nz(v["res.Pike"]), "shooting": nz(v["res.Shooting"])},
            "attributes": {"body": v["body"], "reaction": v["reaction"], "mind": v["mind"], "spirit": v["spirit"]},
            "exp": nz(v["XPvalue"]), "power": v["Power"],
            "tokenSize": v["tokenSize"], "movementType": v["movementType"], "dyingTime": v["dyingTime"],
            # face do monstro = sufixo da imagem de infowindow (InfoPicture + face se > 1: druid4, troll3; exe 0x49510c; GAME_DIFFS #71)
            "face": v["face"],
            "withdraw": v["Withdraw"], "wimpy": v["Wimpy"], "seeInvisible": v["See invisible"],
            "treasure": {"goldChance": v["treasure.1 Gold"], "goldMin": v["treasureMin.1"],
                         "goldMax": v["treasureMax.1"], "itemChance": v["treasure.2 Item"],
                         "itemMin": v["treasureMin.2"], "itemMax": v["treasureMax.2"],
                         "itemMask": v["treasureMask.2"]},
            "spells": sorted(set(spells)), "spellPower": v["Spell Power"],
            "spellProbabilities": [[v["Spell %d" % k], v["Probability %d" % k]] for k in (1, 2, 3)
                                   if v["Spell %d" % k] and v["Spell %d" % k] > 0],
            "magicSkills": {el: nz(v["skill" + el.capitalize()]) for el in MAGE_SKILLS},
            "equipment": equip, "flying": v["movementType"] == 3, "kind": "monster",
            "source": "data.bin",
            # o modelo cru (CArray de inteiros e as strings de equipamento, como o exe os lê: Monster_LoadTemplate 0x5114f3 e
            # 0x511959; o porte da criação, game/src/sim/exe/create.ts, os lê em vez dos derivados acima)
            "raw": r["values"], "rawItems": [x for x in r["strings"]],
        }
        if weapon:
            st["attackSkill"] = weapon.get("attackType") if weapon.get("attackType") in WEAPON_SKILLS else "shooting"
            st["projectile"] = weapon["itemClass"] if weapon["itemClass"] in ("Sonic Beam", "Flame Thrower",
                                                                              "Boulder Thrower") else None
        if weapon and weapon.get("casterWeapon"):
            st["attackSkill"] = SCHOOLS.get(SPELL_SCHOOL.get((equip[0].get("mods") or {}).get("castSpell")), "fire")
        templates[str(v["serverID"])] = st
        cur = by_type.get(t)
        if cur is None or (st["level"], st["serverId"]) < (cur["level"], cur["serverId"]):
            by_type[t] = st
    # humanos (typeID 1..24): unidades humanas, NPCs, heróis
    for idx, r in enumerate(db["humans"], start=1):
        if not r["name"]:
            continue
        h = dict(zip(HUMAN_INT_COLS, r["values"]))
        t = h["typeID"]
        mage = t in (23, 24) or (h["manaMax"] is not None and h["manaMax"] > 0 and h["skillGeneral"] >= 0 and t in (23, 24))
        equip = [resolve_equipment(s, items, None) for s in r["strings"] if s]
        hero = r["name"].startswith("Start_") or r["name"].endswith("_Hero")
        hs = human_stats(h, equip, items, hero=hero, mage=mage, female=h["female"] == 1)
        spells = spell_list(h["knownSpells"])
        staff_spell = next(((e.get("mods") or {}).get("castSpell") for e in equip
                            if (e.get("mods") or {}).get("castSpell")), None)
        if staff_spell:
            hs["attackSkill"] = SCHOOLS.get(SPELL_SCHOOL.get(staff_spell), "fire")
        name = unames[t] if 0 <= t < len(unames) and unames[t] else regunits.get(str(t), {}).get("name", r["name"])
        st = {"name": name, "template": r["name"], "serverId": h["serverID"], "typeId": t, "level": 1,
              "health": hs["health"], "mana": hs["mana"], "healthRegen": 100, "manaRegen": 50 if mage else 0,
              "speed": hs["speed"], "turnSpeed": hs["turnSpeed"], "sight": hs["sight"], "attack": hs["attack"],
              "damage": hs["damage"], "defense": hs["defense"], "absorption": hs["absorption"],
              "range": hs["range"], "attackSkill": hs["attackSkill"], "attackKind": -1,
              "charge": nz(h["attackChargeTime"]) or hs.get("charge") or 8,
              "relax": nz(h["attackRelaxTime"]) or hs.get("relax") or 4,
              "resist": hs["resist"], "resistPhysical": {k: 0 for k in WEAPON_SKILLS},
              "attributes": {"body": h["body"], "reaction": h["reaction"], "mind": h["mind"], "spirit": h["spirit"]},
              "skills": dict(zip(MAGE_SKILLS if mage else WEAPON_SKILLS, [nz(h["skill%d" % k]) for k in range(1, 6)])),
              "exp": 0, "female": h["female"] == 1, "face": h["face"], "spells": sorted(set(spells)),
              "weaponSpell": staff_spell,
              "equipment": equip, "kind": "hero" if hero else "human", "mage": mage,
              "source": "data.bin (atributos) + fórmulas de MapHuman (derivados)",
              # o modelo cru (0x514cf2 / 0x5145d1; game/src/sim/exe/create.ts)
              "raw": r["values"], "rawItems": [x for x in r["strings"]]}
        key = str(h["serverID"])
        if key in templates:
            key = "h" + key
        templates[key] = st
        cur = by_type.get(t)
        if t > 0 and (cur is None or (cur["kind"] != "human" and st["kind"] == "human")
                      or (cur["kind"] == st["kind"] == "human" and st["serverId"] < cur["serverId"])):
            by_type[t] = st
    # typeIDs de units.json sem template (ex.: 2 Unarmed Fighter with Shield) -> estimados a partir do vizinho
    unit_stats = {}
    for k in sorted(regunits, key=int):
        t = int(k)
        st = by_type.get(t)
        if st is None:
            near = by_type.get(t - 1) or by_type.get(t + 1) or by_type.get(1)
            st = dict(near, name=regunits[k]["name"], typeId=t, source="estimated (copiado de %s)" % near["template"])
        e = {kk: st[kk] for kk in ("name", "health", "mana", "speed", "turnSpeed", "sight", "attack", "damage",
                                   "defense", "absorption", "range", "attackSkill", "resist", "exp", "source")}
        e.update(template=st["template"], serverId=st["serverId"], level=st["level"], kind=st["kind"],
                 healthRegen=st["healthRegen"], manaRegen=st["manaRegen"], charge=st["charge"], relax=st["relax"],
                 resistPhysical=st["resistPhysical"], spells=st["spells"],
                 speedCellsPerSec=round(st["speed"] * TICKS_PER_SECOND / 400, 3),
                 levels={str(x["level"]): x["serverId"] for x in templates.values()
                         if x["typeId"] == t and x["kind"] == "monster"})
        unit_stats[k] = e
    return unit_stats, templates


SPELL_SCHOOL = {}


def build_classes(items, templates):
    starts = {"male_fighter": "Start_MF", "female_fighter": "Start_FF", "male_mage": "Start_MM", "female_mage": "Start_FM"}
    caps = {"male_fighter": (52, 50, 48, 46), "female_fighter": (50, 52, 46, 48),
            "male_mage": (48, 46, 52, 50), "female_mage": (46, 48, 50, 52)}
    out = {"attributes": ["body", "reaction", "mind", "spirit"],
           "attributeLabels": {"body": "Body", "reaction": "Agility", "mind": "Mind", "spirit": "Spirit"},
           "classes": {}, "source": "data.bin (Humans: Start_MF/FF/MM/FM) + fórmulas de MapHuman"}
    for key, tname in starts.items():
        t = next(x for x in templates.values() if x["template"] == tname)
        mage = key.endswith("mage")
        a = t["attributes"]
        cap = dict(zip(out["attributes"], caps[key]))
        out["classes"][key] = {
            "label": {"male_fighter": "Male Warrior", "female_fighter": "Female Warrior", "male_mage": "Male Mage",
                      "female_mage": "Female Mage"}[key],
            "template": tname, "serverId": t["serverId"], "mage": mage, "female": key.startswith("female"),
            "unitType": t["typeId"], "face": t["face"],
            "attributes": a, "attributeMax": cap,
            "attributeMin": {k: max(1, a[k] - 15) for k in a},
            "freePoints": 0,
            "skills": t["skills"],
            "alignment": {"options": MAGE_SKILLS if mage else WEAPON_SKILLS, "default": MAGE_SKILLS[0] if mage else WEAPON_SKILLS[0],
                          "bonusSkill": 20},
            "startItems": t["equipment"], "startSpells": t["spells"], "weaponSpell": t.get("weaponSpell"),
            "derived": {k: t[k] for k in ("health", "mana", "speed", "sight", "attack", "damage", "defense", "absorption", "resist")},
        }
    out["rules"] = {
        "pointBuy": "diminuir um atributo dá 1 ponto para aumentar outro (troca 1:1); sem pontos livres iniciais "
                    "(town.txt tips7). Máximos por classe/sexo do allods2.exe; mínimos ESTIMADOS (inicial-15).",
        "alignment": "escolher uma das 5 armas (guerreiro) ou 5 esferas (mago) dá habilidade inicial 20 nela "
                     "(town.txt tips5/tips6); as outras ficam 0. As magias iniciais não mudam. Habilidades fora do "
                     "alinhamento ganham 1/8 da experiência (exceto Astral e Shooting).",
        "skillExperience": "exp(v) = int((1.1^v - 1) * 1000); habilidade = maior v com exp(v) <= experiência daquela habilidade (máx. 100)",
        "experienceGain": "por golpe: int(expAlvo*0.5*dano/vidaMaxAlvo + 1) * (Mind/30 + 0.25) * 10/(n+10) "
                          "(n = abates anteriores do mesmo tipo); /8 fora do alinhamento; máx. 1 nível por evento",
        "healthMax": "int((1.1^Body/100 + 1) * int(Body*f + log_1.1(expTotal/5000 + 1)*f)), f = 2 guerreiro / 1 mago",
        "manaMax": "mago: int((1.1^Spirit/100 + 1) * int(Spirit*2 + log_1.1(expTotal/5000 + 1)*2)); guerreiro: sem mana",
        "toHit": "int((1.1^Body + 1.1^Reaction)/5) + 3*skillDaArma + itens",
        "damage": "b = int(1.1^Body/20); min = b + skill div 5 + minArma; max = min + b + (maxArma - minArma)",
        "defense": "Reaction div 3 + itens",
        "speed": "Reaction < 12 ? Reaction : Reaction div 5 + 12; sobrecarga (peso/2 >= Body*10+1) reduz",
        "sight": "(Mind + Reaction)/25 + 4",
        "protection": "Spirit div 2 + itens, máx. min(100, 70 + Spirit div 2)",
        "difficulty": {"easy": {"enemyHealth": 0.5}, "normal": {}, "hard": {"enemyHealth": 1.5, "enemyAttack": 50, "enemyDefense": 50}},
    }
    out["skillExpTable"] = [skill_exp(v) for v in range(0, 101)]
    out["heroTemplates"] = {"Fighter_Hero": next(x["serverId"] for x in templates.values() if x["template"] == "Fighter_Hero"),
                            "Mage_Hero": next(x["serverId"] for x in templates.values() if x["template"] == "Mage_Hero")}
    return out


def build_map_units(templates):
    """Para cada mapa: serverId (template de data.bin) e nível de cada unidade, na mesma ordem de maps/<n>.json units[]."""
    sys.path.insert(0, str(ROOT / "tools"))
    from alm import Alm
    game = Path(r"C:\Users\TALES K\Games\a2_run")   # os .alm de multijogador da cópia de execução (iguais aos da instalação)
    out, missing = {}, set()
    for folder, prefix in ((EXTRACTED / "scenario", ""), (game, "mp_")):
        for f in sorted(folder.glob("*.alm")):
            name = prefix + f.stem
            if not (OUT / "maps" / (name + ".json")).exists():
                continue
            a = Alm(f.read_bytes())
            lst = []
            for u in a.units:
                raw = u["raw"]
                sid = raw[6]
                lst.append({"serverId": sid, "level": raw[3], "kind": raw[2]})
                if str(sid) not in templates and "h%d" % sid not in templates:
                    missing.add(sid)
            out[name] = lst
    return out, sorted(missing)


def main():
    items, mismatch = build_items()
    spells = build_spells(items)
    for k, s in spells.items():
        SPELL_SCHOOL[int(k)] = [n for n, v in SCHOOLS.items() if v == s["school"]][0]
    unit_stats, templates = build_units(items)
    classes = build_classes(items, templates)
    map_units, missing = build_map_units(templates)
    (OUT / "map-unit-templates.json").write_text(json.dumps(map_units, separators=(",", ":")), encoding="utf-8")
    print("map-unit-templates: %d mapas; serverIds sem template: %s" % (len(map_units), missing))
    for name, data in (("items", items), ("spells", spells), ("unit-stats", unit_stats),
                       ("unit-templates", templates), ("classes", classes)):
        (OUT / (name + ".json")).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("items=%d (pkt=491) spells=%d unit-stats=%d templates=%d" % (len(items), len(spells), len(unit_stats),
                                                                       len(templates)))
    print("divergencias formula x pkt: %d" % len(mismatch))
    for m in mismatch[:40]:
        print("  ", m)


if __name__ == "__main__":
    main()
