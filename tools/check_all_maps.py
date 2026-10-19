import sys,glob,collections
sys.path.insert(0,"tools")
from alm import Alm
ok=0; bad=[]; tot=collections.Counter()
for p in sorted(glob.glob("C:/Users/TALES K/Games/allods2-extracted/scenario/*.alm"))+sorted(glob.glob("C:/GOG Games/Rage of Mages II/*.alm")):
    try:
        m=Alm(open(p,'rb').read()); ok+=1
        tot['actions']+=len(m.script_actions); tot['values']+=len(m.script_values); tot['triggers']+=len(m.script_triggers)
    except Exception as e: bad.append((p.split('/')[-1],repr(e)[:100]))
print("ok",ok,"de 57",dict(tot)); print(bad[:6])
