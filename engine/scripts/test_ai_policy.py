"""Tests for scripts/ai_policy.py (Nov 2, 2026). Run: python3 scripts/test_ai_policy.py [--quick]
 1. decisions + one-line reasons for every AI seat on game/g4_state.json and the /tmp g4 backups
 2. no-peeking guard: full state refused; hidden deck order / other hands / other true mana+gold / seeds changed -> same decisions
 3. scoring.pairing == brute force on random small cases
 4. bid sanity: no bid limit exceeds the value bound; low-value cards (e.g. +1 VP Reptilius Venenum) stay cheap even
    with 128 mana on the final turn
 5. audit_tracks: cap 12 / floor 1 applied step by step (old version's false alarm reproduced)
 6. replay of the logged g4 auctions: new limit vs what each AI actually did (flags 'gave up early')
 7. AI-vs-AI sims: final scores + action-type mix per profile
game/g4_state.json is only READ."""
import json, os, sys, copy, random, glob, time, math, hashlib
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ai_policy as AI, scoring as S, actions as A
R = os.path.join(HERE, '..'); G4 = os.path.join(R, 'game', 'g4_state.json')
AIS = ['Newt', 'LizWiz', 'Gecko']; QUICK = '--quick' in sys.argv
FAIL = []
def check(ok, msg):
    print(('  PASS ' if ok else '  FAIL ') + msg)
    if not ok: FAIL.append(msg)
def md5(f): return hashlib.md5(open(f, 'rb').read()).hexdigest()
G4_MD5 = md5(G4)
def load(f): return json.load(open(f))
def decide(s, me):
    act, why = AI.choose_action(AI.public_view(s, me), me)
    return {k: v for k, v in act.items() if k not in ('value',)}, why

# ------------------------------------------------------------------ 1. decisions
print('=== 1. Decisions (public view only) ===')
STATES = [G4] + [f'/tmp/g4_{t}_pre.json' for t in ('r26', 'r28', 'r29', 'r30')]
for f in STATES:
    if not os.path.exists(f): print('  (missing)', f); continue
    s = load(f); print(f"-- {os.path.basename(f)} (round {s['meta']['round']}, end triggered: {bool(s['meta'].get('game_end_triggered'))})")
    for me in AIS:
        t = time.time(); act, why = decide(s, me)
        print(f"  {me:6s} [{act.get('profile')}] {act['type']:8s} {why}  ({time.time() - t:.2f}s)")
        for w in [x for x in s.get('wiz_face', []) if x]:
            bd = AI.bid_breakdown(AI.public_view(s, me), me, w)
            print(f"           bid {AI.cname(w)}: limit {bd['limit']} of {AI.P(s, me)['mana']} mana (worth {bd['total']} VP, cap {bd['value_cap']})")

# ------------------------------------------------------------------ 2. guard
print('\n=== 2. No-peeking guard ===')
s = load('/tmp/g4_r26_pre.json')
for me in AIS:
    try: AI.choose_action(s, me); check(False, f'{me}: full state accepted')
    except PermissionError as e: check(True, f'{me}: full state refused ({e})')
try: AI.choose_action(AI.public_view(s, 'Newt'), 'Gecko'); check(False, 'wrong-viewer view accepted')
except PermissionError as e: check(True, f'wrong viewer refused ({e})')
v = AI.public_view(s, 'Newt')
check(all(isinstance(v[k], int) for k in AI.DECK_KEYS if k in v), 'all deck lists reduced to counts in the view')
check(all(isinstance(p['hand'], int) for p in v['players'] if p['name'] != 'Newt'), "other players' hands are counts")
def perturb(s, me, k):
    t = copy.deepcopy(s); rng = random.Random(k)
    for key in AI.DECK_KEYS:
        if isinstance(t.get(key), list): rng.shuffle(t[key])
    others = [p for p in t['players'] if p['name'] != me]
    pool = [c for p in others for c in p['hand']] + t['reag_list']; rng.shuffle(pool)
    for p in others:
        n = len(p['hand']); p['hand'] = pool[:n]; pool = pool[n:]
        p['mana'] = rng.randint(0, 150); p['gold'] = rng.randint(0, 12)
    t['reag_list'] = pool + t['reag_list'][len(t['reag_list']):]
    for key in AI.SECRET_KEYS: t[key] = rng.randint(1, 10 ** 9)
    return t
for f in STATES:
    if not os.path.exists(f): continue
    s = load(f)
    for me in AIS:
        base = decide(s, me); same = all(decide(perturb(s, me, k), me) == base for k in range(3 if QUICK else 6))
        check(same, f"{os.path.basename(f)} {me}: decision unchanged under hidden deck/hand/mana/seed perturbation ({base[0]['type']})")
        bl = [AI.bid_limit(AI.public_view(s, me), me, w) for w in s['wiz_face'] if w]
        bl2 = [AI.bid_limit(AI.public_view(perturb(s, me, 9), me), me, w) for w in s['wiz_face'] if w]
        check(bl == bl2, f"{os.path.basename(f)} {me}: bid limits unchanged under perturbation {bl}")

# levels: every level reads only the public view; HARD's lookahead samples hidden cards from public counts only
for f in ['/tmp/g4_r26_pre.json', '/tmp/g4_r28_pre.json']:
    if not os.path.exists(f): continue
    for lvl in ('easy', 'hard'):
        s = load(f); s['meta']['ai_levels'] = {n: lvl for n in AIS}
        for me in (['Newt', 'Gecko'] if QUICK else AIS):
            t0 = time.time(); base = decide(s, me); dt = time.time() - t0
            same = all(decide(perturb(s, me, k), me) == base for k in range(2))
            check(same, f"{os.path.basename(f)} {lvl.upper()} {me}: unchanged under hidden perturbation ({base[0]['type']}, {dt:.2f}s)")
            if lvl == 'hard': check(dt < 1.5, f"HARD {me} decision time {dt:.2f}s < 1.5s")

# ------------------------------------------------------------------ 3. pairing
print('\n=== 3. scoring.pairing vs brute force ===')
rng = random.Random(5); WZ = list(AI.WIZ_BONUS); TW = list(AI.TOWER); bad = 0
for _ in range(150):
    p = {'wizards': ['assets/' + x for x in rng.sample(WZ, rng.randint(0, 5))], 'towers': ['assets/' + x for x in rng.sample(TW, rng.randint(0, 5))]}
    if S.pairing(p) != S._pairing_brute(p): bad += 1
check(bad == 0, f'pairing == brute force on 150 random cases ({bad} mismatches)')

# ------------------------------------------------------------------ 4. bid sanity
print('\n=== 4. Bid sanity (no overbidding) ===')
worst = []
for f in STATES:
    if not os.path.exists(f): continue
    s = load(f)
    for me in AIS:
        for rich in (None, 128):
            t = copy.deepcopy(s)
            if rich: AI.P(t, me)['mana'] = rich; t['meta']['game_end_triggered'] = t['meta'].get('game_end_triggered') or {'r': 0, 'by': 'test'}
            vw = AI.public_view(t, me)
            for w in ['assets/' + x for x in AI.WIZ_BONUS]:
                if not any(w in x for x in t['wiz_face'] if x): t['wiz_face'] = [w] + [x for x in t['wiz_face'] if x][:1]
                vw = AI.public_view(t, me); bd = AI.bid_breakdown(vw, me, w)
                bound = math.ceil(AI.MAX_ALT_RATE * max(0, bd['total']))
                worst.append((bd['limit'] - bound, me, AI.cname(w), bd['limit'], bd['total'], os.path.basename(f), rich))
                if bd['limit'] > bound or bd['limit'] > AI.P(vw, me)['mana']:
                    check(False, f"{me} {AI.cname(w)} limit {bd['limit']} > bound {bound} ({f}, mana {rich})")
                if bd['total'] <= 2.5 and bd['limit'] > 15:
                    check(False, f"{me} low-value {AI.cname(w)} (worth {bd['total']} VP) limit {bd['limit']} > 15")
check(all(x[0] <= 0 for x in worst), f'{len(worst)} wizard x AI x state x mana cases: every limit <= ceil(MAX_ALT_RATE(6) x VP swing) and <= mana; low-value (<=2.5 VP) <= 15')
t = load('/tmp/g4_r30_pre.json'); t['meta']['game_end_triggered'] = {'r': 30, 'by': 'test'}
rep = 'assets/Wizard_Reptilius_Venenum.jpg'; t['wiz_face'] = [rep]
for me in AIS:
    AI.P(t, me)['mana'] = 128; bd = AI.bid_breakdown(AI.public_view(t, me), me, rep)
    print(f"  final turn, 128 mana: {me} Reptilius Venenum (Alchemy): gain {bd['gain']} deny {bd['deny']} worth {bd['total']} VP -> limit {bd['limit']} (alt {bd['alt_rate']} mana/VP)")
    check(bd['limit'] <= math.ceil(AI.MAX_ALT_RATE * bd['total']) and bd['limit'] < 35, f'{me}: Reptilius limit {bd["limit"]} sane (was up to 128)')

# ------------------------------------------------------------------ 5. audit_tracks
print('\n=== 5. audit_tracks (cap 12 / floor 1 in log order) ===')
for f in [G4] + sorted(glob.glob('/tmp/g4_r*_pre.json')):
    m = A.audit_tracks(load(f))
    if m: check(False, f'{os.path.basename(f)}: {m}')
check(True, 'g4 final state + all backups: no track mismatches')
s = load('/tmp/g4_r26_pre.json'); s['meta']['log'] = []; s['reag_played'] = []; s['reag_discard'] = []
s['tracks'] = {k: 1 for k in s['tracks']}
gc = [c for c in json.load(open(os.path.join(R, 'cards', 'reagent_cards.json')))['cards'] if 'Horn' in [x.replace(' ', '_') for x in c['increase_icons_in_print_order']]][0]
r = 'Horn'
for i in range(14):    # 14 Horn-raising gathers: track caps at 12, then sell 11 (track 1), then 2 more raises
    s['meta']['log'].append({'act': 'gather', 'card': gc['id'], 'inc': [r]})
    s['tracks'][r] = min(12, s['tracks'][r] + 1)
s['meta']['log'].append({'act': 'convert', 'reagent': r, 'n': 11}); s['tracks'][r] = max(1, s['tracks'][r] - 11)
for i in range(2): s['meta']['log'].append({'act': 'gather', 'card': gc['id'], 'inc': [r]}); s['tracks'][r] += 1
for e in s['meta']['log']:
    if e['act'] == 'gather': s['reag_discard'].append('assets/' + gc['id'] + '.jpg')
s['meta']['log'] = [e for e in s['meta']['log']]
for k in s['tracks']:
    if k != r: s['tracks'][k] = 1 + sum(1 for e in s['meta']['log'] if e['act'] == 'gather' for n in A._cards()[0][gc['id']]['increase_icons_in_print_order'] if A.norm(n) == k and False)
new = A.audit_tracks(s); print(f'  synthetic Horn: actual track {s["tracks"][r]}; new audit mismatches: {new.get(r)}')
raw = 1 + 16 - 11
check(r not in new and raw != s['tracks'][r], f'new audit OK where the old raw sum ({raw}) would flag a false violation (actual {s["tracks"][r]})')

# ------------------------------------------------------------------ 6. auction replay
print('\n=== 6. Replay of logged g4 auctions: new limit vs actual ===')
F = load(G4)['meta']['log']
BK = sorted([(len(load(f)['meta']['log']), f) for f in glob.glob('/tmp/g4_r*_pre.json')])
BK = [(n, f) for n, f in BK if load(f)['meta']['log'] == F[:n]]
def wizpath(item): return 'assets/Wizard_' + item.replace('Wizard_', '').replace('.jpg', '') + '.jpg'
def replay(s, ev):
    for e in ev:
        a = e.get('act'); who = e.get('who') or e.get('won'); p = A.P(s, who) if who in [q['name'] for q in s['players']] else None
        if not p: continue
        if a == 'auction':
            w = wizpath(e['item']); s['wiz_face'] = [x for x in s['wiz_face'] if not (x and x.endswith(os.path.basename(w)))]
            p['wizards'].append(w); p['mana'] -= e['price']
        elif a == 'convert':
            p['mana'] += e['gain']; s['tracks'][e['reagent']] = e.get('track_after', s['tracks'][e['reagent']])
            for _ in range(e['n']):
                if e['reagent'] in p['tok']: p['tok'].remove(e['reagent'])
        elif a == 'convert1':
            p['mana'] += e['gain']
            for r_ in e['reagents']:
                if r_ in p['tok']: p['tok'].remove(r_)
        elif a == 'gather':
            p['tok'] += e.get('got', []) + e.get('bonus', [])
            for n in e.get('inc', []): s['tracks'][n] = min(12, s['tracks'][n] + 1)
        elif a == 'build':
            p['towers'].append('assets/' + e['tower'] + ('' if e['tower'].endswith('.jpg') else '.jpg'))
            if isinstance(e.get('paid'), list):
                for r_ in e['paid']:
                    if r_ in p['tok']: p['tok'].remove(r_)
        elif a == 'research':
            p['mana'] -= 5; p['spells'].append({'img': 'assets/' + e['spell'], 'cast': bool(e.get('cast'))})
rows = []
for i, e in enumerate(F):
    if e.get('act') != 'auction': continue
    cand = [(n, f) for n, f in BK if n <= i]
    if not cand: continue
    n, f = cand[-1]; s = load(f); replay(s, F[n:i]); w = wizpath(e['item'])
    if not any(x and x.endswith(os.path.basename(w)) for x in s['wiz_face']): s['wiz_face'] = [w] + [x for x in s['wiz_face'] if x]
    tail = e.get('bids_tail') or []
    for me in AIS:
        bd = AI.bid_breakdown(AI.public_view(s, me), me, w)
        bids = [x[1] for x in tail if x[0] == me and isinstance(x[1], int)]
        did = 'won @%d' % e['price'] if e['won'] == me else (('max bid %d' % max(bids)) if bids else ('passed' if any(x[0] == me for x in tail) else 'no record'))
        early = e['won'] != me and bd['limit'] >= e['price'] + 1
        rows.append((e['r'], AI.cname(w)[:22], me, A.P(s, me)['mana'], bd['gain'], bd['total'], bd['flat3'], bd['limit'], did, e['won'], e['price'], early))
print(f"  {'rd':>2} {'wizard':22s} {'AI':6s} {'mana':>4} {'+VP':>4} {'worth':>6} {'old3x':>5} {'NEW':>4}  {'actual':12s} {'winner':6s} {'price':>5}  flag")
for r_ in rows:
    print(f"  {r_[0]:>2} {r_[1]:22s} {r_[2]:6s} {r_[3]:>4} {r_[4]:>4} {r_[5]:>6} {r_[6]:>5} {r_[7]:>4}  {r_[8]:12s} {r_[9]:6s} {r_[10]:>5}  {'GAVE UP EARLY (new limit beats price)' if r_[11] else ''}")
rec = [r_ for r_ in rows if r_[8] != 'no record']
print(f"  with a logged bid/pass for that AI: {sum(1 for r_ in rec if r_[11])} of {len(rec)} rows gave up below the new limit")
print(f"  {sum(1 for r_ in rows if r_[11])} of {len(rows)} AI-auction rows: old play gave up below the new limit. (State before each auction is the round backup + replayed log events; AI mana is ledger-exact for the backup, approximate for replayed events.)")

# ------------------------------------------------------------------ 7. AI-vs-AI sims
print('\n=== 7. AI-vs-AI sims ===')
import ai_sim as SIM
CATS = ['gather', 'convert', 'recruit', 'build', 'research', 'cast', 'familiar', 'dungeon']
games = [(4242, None), (31337, None), (777, {'Keith': 'random', 'Newt': 'tycoon', 'LizWiz': 'spellslinger', 'Gecko': 'delver'})]
if QUICK: games = games[:1]
by_prof = {}; old_false = 0
for seed, prof in games:
    t = time.time(); s, tr, fin, mix = SIM.play(seed, profiles=prof)
    profs = s['meta']['ai_profiles']
    print(f"  seed {seed} (ai_seed {s['meta']['ai_seed']}): ended round {s['meta']['round']} in {time.time() - t:.1f}s; final (VP, mana): {fin}; illegal: {sum(m['illegal'] for m in mix.values())}")
    m_ = A.audit_tracks(s); check(not m_, f'seed {seed}: audit_tracks clean on final sim state {m_ or ""}')
    for n, m in mix.items():
        by_prof.setdefault(profs[n], Counter()).update(m)
    mx = max(fin, key=lambda k: fin[k]); print(f"    winner {mx} ({profs[mx]})")
print(f"  {'profile':13s} " + ' '.join(f'{c:>8s}' for c in CATS) + '  (share of actions; cast/dungeon also count inside research/familiar)')
for pr, m in sorted(by_prof.items()):
    tot = sum(m[c] for c in ('gather', 'convert', 'recruit', 'build', 'research', 'familiar')) + m['dungeon'] * 0 or 1
    print(f"  {pr:13s} " + ' '.join(f'{100 * m[c] / tot:7.0f}%' for c in CATS) + f"   attacks {m['attack']}, auctions opened {m['recruit_open']}")
allm = sum(by_prof.values(), Counter())
check(allm['cast'] > 0 and allm['dungeon'] > 0, f"spells cast ({allm['cast']}) and dungeon entered ({allm['dungeon']}) in sims")
mixes = {pr: tuple(round(m[c] / max(1, sum(m.values())), 2) for c in CATS) for pr, m in by_prof.items()}
check(len(set(mixes.values())) == len(mixes), 'every profile has a distinct action mix')
check(md5(G4) == G4_MD5, 'game/g4_state.json unchanged by tests')
print('\nRESULT:', 'ALL PASS' if not FAIL else f'{len(FAIL)} FAIL(S): ' + '; '.join(FAIL))
