#!/usr/bin/env python3
"""Quick check: Archmage (hard) Newt beats Apprentice (easy) LizWiz more often over seeded head-to-head sims."""
import os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ai_sim as SIM

N = 20
wins = {'Newt': 0, 'LizWiz': 0, 'Keith': 0, 'ties': 0}
for seed in range(N):
    _, _, final, _ = SIM.play(
        seed=1000 + seed,
        levels={'Newt': 'hard', 'LizWiz': 'easy', 'Keith': 'normal'},
        ai_seed=1000 + seed,
        max_rounds=45,
    )
    ranked = sorted(final.items(), key=lambda x: (-x[1][0], -x[1][1]))
    top = ranked[0][1][0]
    leaders = [n for n, (vp, _) in final.items() if vp == top]
    if len(leaders) > 1:
        wins['ties'] += 1
    else:
        wins[leaders[0]] = wins.get(leaders[0], 0) + 1

print(f'games={N} levels Newt=hard LizWiz=easy Keith=normal')
print(f"wins: Newt(hard)={wins['Newt']} LizWiz(easy)={wins['LizWiz']} Keith={wins['Keith']} ties={wins['ties']}")
assert wins['Newt'] > wins['LizWiz'], f"expected hard to beat easy on average: {wins}"
