"""Cause-before-effect check for meta.log: every turn must read in order in the banners and the Chronicle.

Plays seeded all-AI games through the web glue the live app uses (lw_web.ai_step -> turn.ai_turn -> ai_sim.apply_action)
and wraps each engine action. Fails if an action's own entry is preceded by anything it caused (an achievement, cast,
mana trigger, reshuffle or Spell Shield logged before the summon, build, auction, gather or attack behind it), and runs
pattern checks over every finished log. Only the committed state counts; previews and AI look-ahead run on copies.

Usage: python3 tools/test_turn_order.py [GAMES] [FIRST_SEED]
"""
import collections, functools, json, os, random, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'engine', 'web'))
import lw_web as W  # noqa: E402

A, SE, SIM = W.A, W.SE, W.SIM

# engine function -> the acts its own entry may carry
PARENTS = {
    (A, 'summon_familiar'): ('summon',), (A, 'build_tower'): ('build',), (A, 'recruit'): ('auction',),
    (A, 'gather'): ('gather',), (A, 'research'): ('research',), (A, 'cast_spell'): ('cast',),
    (A, 'flame_bolt'): ('flame_bolt', 'flame_bolt_blocked'), (A, 'charm'): ('charm', 'charm_blocked'),
    (A, 'disintegrate'): ('disintegrate', 'disintegrate_blocked'), (A, 'earthquake'): ('earthquake', 'earthquake_blocked'),
    (A, 'mana_drain'): ('mana_drain', 'mana_drain_blocked'), (A, 'creation'): ('creation',), (A, 'scry_dungeon'): ('scry_dungeon',),
    (A, 'convert'): ('convert',), (A, 'convert_adept'): ('convert',),
    (SE, 'dungeon_delve'): ('dungeon',), (SE, 'new_research'): ('new_research',), (SE, 'swapo'): ('swapo', 'swapo_blocked'),
    (SE, 'obscure'): ('obscure', 'obscure_blocked'), (SE, 'demonic_possession'): ('demonic_possession', 'demonic_possession_blocked'),
    (SE, 'invisibility_potion'): ('invisibility_potion', 'invisibility_potion_blocked'),
}
HITS = []
CTX = {'game': None, 'live': None}


def _wrap(mod, name, acts):
    f = getattr(mod, name)

    @functools.wraps(f)
    def g(s, *a, **kw):
        log = s['meta'].setdefault('log', []); n0 = len(log)
        out = f(s, *a, **kw)
        if s is not CTX['live']: return out
        new = log[n0:]
        own = [i for i, e in enumerate(new) if e.get('act') in acts]
        if own:
            parent = new[own[0]]
            for e in new[:own[0]]:
                HITS.append(f"game {CTX['game']} r{s['meta'].get('round')}: {e.get('act')} logged before its {parent.get('act')} ({name})")
        return out
    setattr(mod, name, g)


for (m, n), acts in PARENTS.items(): _wrap(m, n, acts)
_orig_commit = W._commit


def _commit_live(fn, *a, **kw):
    def run(t, *aa, **kk):
        CTX['live'] = t
        return fn(t, *aa, **kk)
    return _orig_commit(run, *a, **kw)


W._commit = _commit_live


def turn_segments(log):
    seg = []
    for e in log:
        if e.get('act') == 'turn' and seg:
            yield seg; seg = []
        seg.append(e)
    if seg: yield seg


def pattern_checks(log, game):
    """Rules on the finished log; these also cover glue code that is not a wrapped engine function (rise_use, ai_sim)."""
    out = []
    for seg in turn_segments(log):
        for k, e in enumerate(seg):
            a = e.get('act'); rest = seg[k + 1:]; where = f"game {game} r{e.get('r')}"
            if a == 'shield_used' and not e.get('folded'):
                out.append(f"{where}: Spell Shield used with no blocked attack to fold into")
            if str(a).endswith('_blocked') and e.get('shield') and not (rest and rest[0].get('act') == 'shield_used'):
                out.append(f"{where}: {a} lost its folded shield_used entry (the log length must not change)")
            if a == 'cast':
                for x in rest:
                    if x.get('act') in ('summon', 'rise') and x.get('who') == e.get('who') and \
                            any(W.spell_key_of(c) == W.spell_key_of(e['spell']) for c in x.get('cast', [])):
                        out.append(f"{where}: cast {e['spell']} before the {x['act']} that enabled it"); break
            if a == 'achievement':
                for x in rest[:3]:
                    if x.get('act') in ('summon', 'rise') and x.get('who') == e.get('who') and x.get('use') == 'gather':
                        out.append(f"{where}: achievement {e.get('tile')} before the {x['act']} that earned it"); break
            if a == 'trigger' and e.get('by'):
                for x in rest:
                    if x.get('act') in ('build', 'auction', 'summon') and (x.get('who') or x.get('won')) == e['by']:
                        out.append(f"{where}: {e.get('spell')} trigger before {e['by']}'s {x['act']}"); break
            if a == 'reshuffle_reagents' and rest and rest[0].get('act') == 'gather':
                out.append(f"{where}: reagent reshuffle before the gather that emptied the deck")
    return out


PROFILES = ['balanced', 'spellslinger', 'delver', 'tycoon']
# All-AI turns can open more auctions than a human seat allows; that invariant is unrelated to log order.
KNOWN_STOPS = ('auction',)


def play(seed, players, max_steps=400):
    path = f'/tmp/turn_order_{seed}_{os.getpid()}.json'
    if os.path.exists(path): os.remove(path)
    s = SIM.new_game(seed, path=path, players=players)
    os.remove(path)
    names = players.split(','); rnd = random.Random(seed)
    s['meta']['humans'] = []
    s['meta']['ai_profiles'] = {n: PROFILES[(i + seed) % 4] for i, n in enumerate(names)}
    s['meta']['ai_seed'] = seed; s['meta']['ai_random'] = True
    s['meta']['ai_levels'] = {n: rnd.choice(['easy', 'normal', 'hard']) for n in names}
    W.load(json.dumps(s), viewer=names[0]); CTX['game'] = seed
    errs = []
    for _ in range(max_steps):
        try: r = W.ai_step()
        except Exception as ex: errs.append(repr(ex)); break
        if r['status'] == 'over' or W.st()['meta'].get('game_over'): break
        if r['status'] != 'done': errs.append('status ' + r['status']); break
    return W.st(), errs


def main():
    games = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    first = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    turns = 0; pats = []; acts = collections.Counter(); stray = []
    for seed in range(first, first + games):
        players = ['Keith,Newt', 'Keith,Newt,LizWiz', 'Keith,Newt,LizWiz,Gecko'][seed % 3]
        s, errs = play(seed, players)
        log = s['meta']['log']
        turns += sum(1 for e in log if e.get('act') == 'turn')
        acts.update(e.get('act') for e in log)
        pats += pattern_checks(log, seed)
        stray += [f'game {seed}: {e}' for e in errs if not any(k in e.lower() for k in KNOWN_STOPS)]
    covered = {a: acts[a] for a in ('summon', 'rise', 'achievement', 'cast', 'trigger', 'reshuffle_reagents', 'build', 'auction') if acts[a]}
    print(f'games={games} turns={turns} entries: {covered}')
    blocked = sum(v for a, v in acts.items() if str(a).endswith('_blocked'))
    print(f'blocked attacks: {blocked}')
    for line in HITS + pats + stray: print('  FAIL', line)
    bad = len(HITS) + len(pats) + len(stray)
    print(f'RESULT: {bad} order violations' + (' -> ALL PASS' if not bad else ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
