#!/usr/bin/env python3
"""Quick check: Archmage (hard) Newt beats Apprentice (easy) LizWiz more often over seeded 3-player sims."""
import os, sys
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ai_sim as SIM

N = 20
wins = defaultdict(int)
for seed in range(N):
    _, _, final, _ = SIM.play(
        seed=1000 + seed,
        levels={'Newt': 'hard', 'LizWiz': 'easy', 'Keith': 'normal'},
        ai_seed=1000 + seed,
        max_rounds=45,
        players='Keith,Newt,LizWiz',
    )
    ranked = sorted(final.items(), key=lambda x: (-x[1][0], -x[1][1]))
    top = ranked[0][1][0]
    leaders = [n for n, (vp, _) in final.items() if vp == top]
    if len(leaders) == 1:
        wins[leaders[0]] += 1
    else:
        wins['ties'] += 1

total = sum(wins.values())
print(f'games={N} players=Keith,Newt,LizWiz levels Newt=hard LizWiz=easy Keith=normal')
print(f"wins: Newt(hard)={wins['Newt']} LizWiz(easy)={wins['LizWiz']} Keith={wins['Keith']} ties={wins['ties']} (recorded {total}/{N})")
assert total == N, f'every game must have one winner or tie: {dict(wins)}'
assert wins['Newt'] > wins['LizWiz'], f"expected hard to beat easy on average: {dict(wins)}"
