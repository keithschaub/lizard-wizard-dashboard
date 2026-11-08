"""Start a new Lizard Wizard game with any mix of human and AI seats (Nov 2, 2026). Reuses deal4.py (rulebook SETUP A-L).
  python3 scripts/new_game.py --state game/g5_state.json --players Keith,Newt,John,LizWiz --humans Keith,John \
      --levels Newt=normal,LizWiz=normal --profiles Newt=spellslinger,LizWiz=delver --coach game/coaching_log_g5.md [--seed N]
Phase 1 (hands): 3 reagent cards each, tracks at 1, 20 mana, AI seats pick 2 unique tokens from their own hand.
Humans then pick with 'turn.py <name> pick R1 R2'; when every human has picked, turn.py deals the board (deal4.py board,
new random board seed, logged) and builds the dungeon (actions.ensure_dungeon). Refuses to overwrite a game in play.
3-player example (g6): --state game/g6_state.json --players Keith,Newt,LizWiz --humans Keith --levels Newt=normal,LizWiz=normal
      --profiles Newt=spellslinger,LizWiz=delver --coach game/coaching_log_g6.md
AI starting picks go through ai_policy.starting_pick (own hand only, simultaneous)."""
import argparse, json, os, sys, subprocess, secrets
HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.normpath(os.path.join(HERE, '..')) + '/'
def kv(x): return dict(p.split('=') for p in x.split(',')) if x else {}
ap = argparse.ArgumentParser(); ap.add_argument('--state', required=True); ap.add_argument('--seed', type=int)
ap.add_argument('--players', default='Keith,Newt,John,LizWiz'); ap.add_argument('--humans', default='Keith,John')
ap.add_argument('--levels', default=''); ap.add_argument('--profiles', default=''); ap.add_argument('--coach', default='')
ap.add_argument('--ai-seed', type=int)
a = ap.parse_args()
path = os.path.abspath(a.state); seed = a.seed if a.seed is not None else secrets.randbelow(10**6)
names = a.players.split(','); hum = [h for h in a.humans.split(',') if h]
assert all(h in names for h in hum), 'every human must be a seat'
lv = kv(a.levels); pf = kv(a.profiles); ais = [n for n in names if n not in hum]
assert set(lv) <= set(ais) and set(pf) <= set(ais), 'levels/profiles are for AI seats only'
assert all(l in ('easy', 'normal', 'hard', 'master') for l in lv.values())
ai_seed = a.ai_seed if a.ai_seed is not None else secrets.randbelow(10**6)
r = subprocess.run([sys.executable, os.path.join(HERE, 'deal4.py'), 'hands', '--seed', str(seed), '--ai-seed', str(ai_seed), '--players', a.players,
                    '--humans', ','.join(hum) or 'nobody', '--coach', a.coach or 'game/coaching_log_g4.md'],
                   env=dict(os.environ, LW_STATE=path), capture_output=True, text=True)
if r.returncode: sys.exit(r.stdout + r.stderr)
s = json.load(open(path)); m = s['meta']
m['humans'] = hum; m['ai_levels'] = {n: lv.get(n, 'normal') for n in ais}
m['ai_profiles'] = {n: pf.get(n, 'balanced') for n in ais}
m['ai_seed'] = ai_seed; m['ai_random'] = True
m['private_mats'] = True     # turn.py renders <game>_board.jpg + <game>_mats_<human>.jpg even with one human
m['mode'] = 'free-for-all (each AI plays only for itself; humans play for themselves)'
# hands seed stays ONLY in top-level seed/hands_seed (public_view strips those; anything in meta would be visible to the AI)
json.dump(s, open(path, 'w'), indent=1)
print(json.dumps(dict(state=path, hands_seed=seed, ai_seed=m['ai_seed'], seats=names, humans=hum, ai_levels=m['ai_levels'], ai_profiles=m['ai_profiles'])))
