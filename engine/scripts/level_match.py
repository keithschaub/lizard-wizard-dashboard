"""Strength check for AI levels. Usage: level_match.py SPECIAL BASE SEED  -> JSON line.
All seats 'balanced' profile (so only the level differs); the SPECIAL-level seat rotates with the seed."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_sim as SIM, ai_policy as AI
special, base, seed = sys.argv[1], sys.argv[2], int(sys.argv[3])
seats = ['Keith', 'Newt', 'LizWiz', 'Gecko']; hero = seats[seed % 4]
levels = {n: (special if n == hero else base) for n in seats}
T = []; orig = AI.choose_action
def timed(view, me):
    t = time.time(); r = orig(view, me)
    if (view.get('meta') or {}).get('ai_levels', {}).get(me) == 'hard': T.append(time.time() - t)
    return r
AI.choose_action = timed
t0 = time.time(); s, tr, fin, mix = SIM.play(seed, profiles={n: 'balanced' for n in seats}, levels=levels)
vp = {n: fin[n][0] for n in fin}; best_other = max(vp[n] for n in seats if n != hero)
w = max(seats, key=lambda n: (vp[n], fin[n][1]))
print(json.dumps(dict(special=special, base=base, seed=seed, hero=hero, rounds=s['meta']['round'], vp=vp,
                      mana={n: fin[n][1] for n in fin}, winner=w, hero_won=w == hero, margin=vp[hero] - best_other,
                      hero_vs_avg=vp[hero] - sum(vp[n] for n in seats if n != hero) / 3, secs=round(time.time() - t0, 1), hard_dec=(len(T), round(sum(T) / len(T), 3) if T else None, round(max(T), 3) if T else None),
                      mix={n: dict(m) for n, m in mix.items()})))
