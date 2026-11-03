"""Batch AI-vs-AI sims -> one table (seed, rounds, winner, scores, end mana, action mix). Usage: sim_report.py SEED[:rot] ..."""
import sys, os, json, time
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_sim as SIM
ROT = {'Keith': 'random', 'Newt': 'tycoon', 'LizWiz': 'spellslinger', 'Gecko': 'delver'}
out = []
for a in sys.argv[1:]:
    seed, rot = (int(a.split(':')[0]), ':rot' in a)
    t = time.time(); s, tr, fin, mix = SIM.play(seed, profiles=ROT if rot else None)
    out.append(dict(seed=a, rounds=s['meta']['round'], secs=round(time.time() - t, 1), profiles=s['meta']['ai_profiles'],
                    final={n: fin[n][0] for n in fin}, mana={n: fin[n][1] for n in fin}, mix={n: dict(m) for n, m in mix.items()}))
print(json.dumps(out))
