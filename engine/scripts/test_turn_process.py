"""Regression tests for the turn process (refactor Nov 2, 2026): one test per g3-g6 process failure that code can catch.
Never touches game/*.json (works on /tmp copies of a fresh seeded game). Run: python3 scripts/test_turn_process.py"""
import os, sys, json, re, subprocess, hashlib, time, copy, glob, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
R = os.path.normpath(os.path.join(HERE, '..'))
import actions as A, scoring as S, carddb as CD, spell_effects as SE, turn_package as TP, ai_policy as AI, ai_sim as SIM
import turn as T
PASS = FAIL = 0
def check(ok, msg):
    global PASS, FAIL
    PASS += bool(ok); FAIL += (not ok); print(('  PASS ' if ok else '  FAIL ') + msg)
def md5(f): return hashlib.md5(open(f, 'rb').read()).hexdigest()
G6 = os.path.join(R, 'game', 'g6_state.json'); G6_MD5 = md5(G6) if os.path.exists(G6) else None
TMP = '/tmp/lw_tp_test'; os.makedirs(TMP, exist_ok=True)
def turn(state, *args, render=False):
    cmd = [sys.executable, os.path.join(HERE, 'turn.py'), 'keith', *args, '--state', state, '--brief'] + ([] if render else ['--no-render'])
    t0 = time.time(); r = subprocess.run(cmd, capture_output=True, text=True); return r.returncode, r.stdout + r.stderr, time.time() - t0
def fresh(name, seed=4242, ai_seed=99):
    p = f'{TMP}/{name}.json'
    for f in glob.glob(p + '*') + glob.glob(f'{TMP}/{name}_*'): os.remove(f)
    subprocess.run([sys.executable, os.path.join(HERE, 'new_game.py'), '--state', p, '--players', 'Keith,Newt,LizWiz', '--humans', 'Keith',
                    '--profiles', 'Newt=spellslinger,LizWiz=delver', '--coach', f'{TMP}/{name}_coach.md', '--seed', str(seed), '--ai-seed', str(ai_seed)],
                   check=True, capture_output=True)
    rc, out, _ = turn(p, 'pick', 'Horn', 'Mandrake'); assert rc == 0, out
    return p
def load(p): return json.load(open(p))
def dump(s, p): json.dump(s, open(p, 'w'), indent=1)
def lines(out, tag): return [l for l in out.splitlines() if l.startswith(tag)]
BASE = fresh('base')

print('\n=== 1. Opponent turns are always recapped (Keith: "Did u skip the other\'s turn?") ===')
p = f'{TMP}/t1.json'; dump(load(BASE), p)
rc, out, dt = turn(p, 'convert1', 'Horn,Mandrake', render=True)
opp = lines(out, 'OPP:')
check(rc == 0 and len(opp) == 2 and opp[0].startswith('OPP: R1 Newt:') and opp[1].startswith('OPP: R1 LizWiz:'), f'after a convert: one OPP line per opponent turn ({len(opp)})')
check('QC: PASS' in out, 'package QC passes')
check(dt < 4.0, f'full turn incl. 2 AI turns + render in {dt:.2f}s (< 4s)')
TYPICAL = dt
rc, out, _ = turn(p, 'show')
check(rc == 0 and len(lines(out, 'OPP:')) == 2, '`show` re-prints the opponent turns since my previous turn')
s = load(p); segs = [dict(owner='Keith', r=1, entries=[]), dict(owner='LizWiz', r=1, entries=[])]   # Newt skipped
F = TP.qc(s, 'OPP: x', 'Keith', 'action', None, 0, {'all': segs, 'lined': {id(segs[1])}}, [], len(s['meta']['log']), 'gather', want_render=False)
check(any('turn order broken' in f for f in F), 'QC FAILS when a seat is skipped (Keith -> LizWiz, Newt missing)')
F = TP.qc(s, 'OPP: x', 'Keith', 'action', None, 0, {'all': segs[:1] + [dict(owner='Newt', r=1, entries=[])], 'lined': set()}, [], len(s['meta']['log']), 'gather', want_render=False)
check(any('without a recap line' in f for f in F), 'QC FAILS when an opponent turn has no recap line')
F = TP.qc(s, 'nothing here', 'Keith', 'action', None, 0, {'all': [], 'lined': set()}, [], len(s['meta']['log']), 'gather', want_render=False)
check(any('OPP section empty' in f for f in F), 'QC FAILS when the OPP section is empty')
q = load(p); rc, out, _ = turn(p, 'claim', 'x7 Toadstool')
check(rc != 0 or lines(out, 'OPP:'), 'claim of an unmet tile is refused (not an action)')
s = load(p); w = [x for x in s['wiz_face'] if x][0][len('assets/Wizard_'):-4]
rc, out, _ = turn(p, 'recruit', w, '1')
pend = load(p)['meta'].get('pending')
if pend:   # someone outbid me -> my auction waits on me: OPP must say why nobody else moved
    check(any('none yet' in l for l in lines(out, 'OPP:')), 'OPP never empty: says why no opponent moved (auction waiting on you)')
    check(lines(out, 'WIDGET') and 'Pass' in lines(out, 'WIDGET')[0] and f"Bid {pend['high'] + 1}" in lines(out, 'WIDGET')[0], 'bid step: widget is Pass / Bid high+1 (one step at a time)')
else:
    check(len(lines(out, 'OPP:')) == 2, 'won my own auction: both opponents then took their turns')

print('\n=== 2. Board + mats are always rendered, fresh, and QC\'d ===')
rc, out, _ = turn(f'{TMP}/t1.json', 'show', render=True)
bd = lines(out, 'BOARD:')[0].split(': ', 1)[1]; mt = lines(out, 'MATS:')[0].split(': ', 1)[1]
check(os.path.exists(bd) and os.path.exists(mt) and os.path.getsize(bd) > 30000 and os.path.getsize(mt) > 30000, f'BOARD and MATS exist and are real images ({os.path.basename(bd)}, {os.path.basename(mt)})')
s = load(f'{TMP}/t1.json')
F = TP.qc(s, 'OPP: x', 'Keith', 'action', {'board': bd, 'mats': mt}, time.time() + 60, {'all': [], 'lined': set()}, [], 10**6, 'show')
check(any('STALE' in f for f in F), 'QC FAILS on a stale render (older than the command)')
F = TP.qc(s, 'OPP: x', 'Keith', 'action', {'board': bd}, 0, {'all': [], 'lined': set()}, [], 10**6, 'show')
check(any('render mats: missing' in f for f in F), 'QC FAILS when the mats render is missing')

print('\n=== 3. Card images come from assets/enhanced (never the old photos) ===')
rc, out, _ = turn(f'{TMP}/t1.json', 'show')
imgs = re.findall(r' IMG (\S+)', out)
check(imgs and all('/assets/enhanced/' in x and os.path.exists(x) for x in imgs), f'every CARD/OCAST image is enhanced and exists ({len(imgs)})')
F = TP.qc(s, 'OPP: x', 'Keith', 'show', None, 0, {'all': [], 'lined': set()}, [os.path.join(R, 'assets', 'Spell_Charm.jpg')], 10**6, 'show', want_render=False)
check(any('non-enhanced' in f for f in F), 'QC FAILS on an old (non-enhanced) card photo')
miss = [k for k in CD._load()['cards'] if k.startswith(('Spell_', 'Wizard_', 'Dungeon_', 'Familiar_', 'Tower_')) and not os.path.exists(TP.enhanced(k))]
check(not miss, f'every carddb card has enhanced art ({len(miss)} missing: {miss[:4]})')
dm = [TP.dungeon_img(c) for c in json.load(open(os.path.join(R, 'assets', 'dungeon_from_photos.json')))['cards']]
check(all(os.path.exists(x) for x in dm), 'every dungeon card maps to an enhanced image')

print('\n=== 4. Opponent research/casts carry the card image + carddb text (OCAST) ===')
s = load(BASE)
ent = [{'r': 1, 'who': 'Newt', 'act': 'research', 'spell': 'Spell_Charm.jpg', 'cast': True}, {'r': 1, 'who': 'LizWiz', 'act': 'cast', 'spell': 'Spell_Energy_Circle.jpg'},
       {'r': 1, 'who': 'Newt', 'act': 'research', 'spell': 'Spell_Spirit_Shield.jpg', 'cast': False}, {'r': 1, 'who': 'Newt', 'act': 'new_research', 'took': 'Spell_Swapo.jpg'},
       {'r': 1, 'who': 'Keith', 'act': 'cast', 'spell': 'Spell_Charm.jpg'}]
oc = TP.ocast_lines(s, ent)
check(len(oc) == 4, f'OCAST for research+cast, gather-cast, research-only and New Research; none for Keith ({len(oc)})')
check(all('/assets/enhanced/' in l and '"' in l for l in oc) and CD.get('Spell_Charm.jpg')['effect'] in oc[0], 'OCAST text is carddb text, image is enhanced')
check('Energy Circle' in oc[1], 'Energy Circle cast is shown (the g6 miss)')

print('\n=== 5. Achievements are auto-claimed (missed 7 Towers) ===')
p = f'{TMP}/t5.json'; s = load(BASE); k = A.P(s, 'Keith')
k['towers'] = [t for t in s['tow_list'][:6]]; s['tow_list'] = s['tow_list'][6:]; s['tower_deck'] = len(s['tow_list'])
s['ach'] = ['7 Towers'] + s['ach'][1:]; tier, r_, _ = CD.tower_info(s['tower_face']); k['tok'] = [A.norm(r_)] * tier
dump(s, p); rc, out, _ = turn(p, 'build', 'reagent')
k2 = A.P(load(p), 'Keith')
check('7 Towers' in k2.get('achievements', []) and any("claimed '7 Towers'" in l for l in lines(out, 'ACH:')), 'building the 7th tower auto-claims 7 Towers and prints an ACH line')
s2 = load(p); s2['ach'].append('7 Towers'); A.P(s2, 'Keith')['achievements'] = []
F = TP.qc(s2, 'OPP: x', 'Keith', 'action', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
check(any('not auto-claimed' in f for f in F), 'QC FAILS when a claimable achievement is left unclaimed')
# x7 met by the gather, then the cast spends tokens: claim happens BEFORE the cast (rulebook 'on your turn, if you meet')
p = f'{TMP}/t5b.json'; s = load(BASE); k = A.P(s, 'Keith')
card = next(c for c in s['reag_list'] if CD.reagent_icons(c)[0].count('Nightshade') >= 1 and len(CD.reagent_icons(c)[0]) == 3)
s['reag_list'].remove(card); k['hand'][0] = card
k['tok'] = ['Nightshade'] * (7 - CD.reagent_icons(card)[0].count('Nightshade')) + ['Eye_of_Newt']
k.setdefault('spells', []).append({'img': 'assets/Spell_Block_Giant.jpg', 'cast': False})
s['ach'] = ['x7 Nightshade'] + s['ach'][1:]; dump(s, p)
rc, out, _ = turn(p, 'gather', os.path.basename(card)[8:-4], '--cast', 'Block_Giant')
check(rc == 0 and 'x7 Nightshade' in A.P(load(p), 'Keith').get('achievements', []), 'x7 reached by a gather is claimed before the cast spends it')

print('\n=== 6. Options: gather+cast, every hand card, every keep, every affordable action ===')
s = load(BASE); k = A.P(s, 'Keith'); k['tok'] = ['Mandrake', 'Mandrake', 'Foxglove', 'Foxglove']; k['mana'] = 30
k.setdefault('spells', []).append({'img': 'assets/Spell_Charm.jpg', 'cast': False})
O, U = TP.grouped_options(s, 'Keith'); req = TP.required_keys(s, 'Keith')
gc = [o for o in O if o['group'] == 'GATHER+CAST']
check(any('Charm' in o['label'] for o in gc) == any(r[0] == 'gathercast' for r in req), f'gather+cast options listed exactly when castable ({len(gc)})')
check(not (req - TP.emitted_keys(O)), f'every affordable action is in OPTIONS ({len(req)} required)')
for c in k['hand']:
    g, _, keeps = TP.gather_keeps(s, k, c)
    check(len([o for o in O if o['group'] == 'GATHER' and o['card'] == os.path.basename(c)[8:-4]]) == len(keeps), f'gather {os.path.basename(c)[8:-4]}: all {len(keeps)} distinct keeps listed')
W = TP.widget(O)
check({o['card'] for o in W if o['group'] == 'GATHER'} == {os.path.basename(c)[8:-4] for c in k['hand']} and len(W) == 6, 'widget top 6 includes every hand gather')
check(all(any(o['key'][:3] == ('summon', os.path.basename(f), u) for o in O) for f in s['fam_face'] if f for u in ('score', 'gather', 'dungeon', 'research')), 'all four familiar uses offered (dungeon/new research were missing)')
# random positions from AI-vs-AI sims: required keys always emitted
bad = 0; nst = 0
sim_s, _, _, _ = SIM.play(seed=31, max_rounds=14)
for n in ('Keith', 'Newt', 'LizWiz'):
    O, U = TP.grouped_options(sim_s, n); miss = TP.required_keys(sim_s, n) - TP.emitted_keys(O); bad += bool(miss); nst += 1
check(bad == 0, f'{nst} sim positions: no affordable action dropped')

print('\n=== 7. Put-backs are never auto-chosen ===')
p = f'{TMP}/t7.json'; s = load(BASE); k = A.P(s, 'Keith'); k['tok'] = ['Horn'] * 10; dump(s, p)
O, U = TP.grouped_options(s, 'Keith')
check(all('<ASK KEITH' in o['cmd'] for o in O if o['group'] == 'GATHER') and not any(re.search(r'--discard [A-Z]', o['cmd']) for o in O), 'over-storage gathers carry <ASK KEITH>, never a chosen --discard')
before = md5(p); c0 = os.path.basename(k['hand'][0])[8:-4]
keep = [] if len(CD.reagent_icons(k['hand'][0])[0]) <= 3 else ['--keep'] + CD.reagent_icons(k['hand'][0])[0][:3]
rc, out, _ = turn(p, 'gather', c0, *keep)
check(rc != 0 and 'PUT-BACK NEEDED' in out and md5(p) == before, 'gather over storage without --discard is refused (asks Keith), state untouched')
rc, out, _ = turn(p, 'gather', c0, *keep, '--discard', '<ASK', 'KEITH:', '3', 'tokens>')
check(rc != 0 and md5(p) == before, 'a placeholder --discard is refused')
rc, out, _ = turn(p, 'show')
check(any(l.startswith('PUTBACK:') and 'never choose' in l for l in out.splitlines()), 'package prints PUTBACK lines with the multi-select pool')

print('\n=== 8. Spirit Shield (Enchantment, dungeon) is not Spell Shield (blocks a negative spell) ===')
ss, sp = CD.get('Spell_Spirit_Shield.jpg'), CD.get('Spell_Spell_Shield_C.jpg')
check(ss['school'] == 'Enchantment' and 'Dungeon' in ss['effect'] and 'negative Spell' in sp['effect'], 'carddb: Spirit Shield = dungeon hits; Spell Shield = negative spell')
def delve(spells, cards):
    s = load(BASE); A.P(s, 'Keith')['spells'] = [{'img': 'assets/' + x, 'cast': True} for x in spells]
    s['dungeon_list'] = copy.deepcopy(cards); return SE.dungeon_delve(s, 'Keith', lambda h, d: True), s
M = {'type': 'Monster', 'name': 'Orc', 'monster_type': 'Goblinoid'}; G = {'type': 'Treasure', 'subtype': 'Gold', 'gold': 2}
I = {'type': 'Treasure', 'subtype': 'Item', 'name': 'Ring'}; TR = {'type': 'Trap', 'name': "It's a Trap!", 'hits': 2}
o, _ = delve([], [G, M, I, M, G]); check(not o['success'] and o['hits'] == 2 and len(o['drawn']) == 4 and not o['kept'], 'Monster = 1 hit; the 2nd hit defeats you and you keep nothing')
o, _ = delve(['Spell_Spirit_Shield.jpg'], [G, M, I, M, G, M]); check(o['hits'] == 3 and len(o['drawn']) == 6 and not o['success'], 'Spirit Shield: limit 3 (3rd hit defeats)')
o, _ = delve(['Spell_Spell_Shield_C.jpg'], [M, M, G]); check(len(o['drawn']) == 2 and not o['success'], 'Spell Shield does NOT raise the dungeon limit')
o, _ = delve([], [I, TR, G]); check(o['hits'] == 2 and not o['success'], 'Trap = 2 hits')
o, s_ = delve(['Spell_Block_Denizens.jpg'], [{'type': 'Monster', 'name': 'Ogre', 'monster_type': 'Dungeon Denizen'}, M, G]) if 'Dungeon Denizen' in SE.BLOCK else (None, None)
if o: check(o['hits'] == 1 and o['bonus_gold'] == 1, 'Block Denizens: a Denizen gives 1 Gold instead of a hit')
s = load(BASE); A.P(s, 'Keith')['spells'] = [{'img': 'assets/Spell_Spirit_Shield.jpg', 'cast': True}]
check(not A.shield_blocks(s, 'Keith'), 'a cast Spirit Shield does not block a negative spell')
s = load(BASE); s['dungeon_list'] = [M]
o = SE.dungeon_delve(s, 'Keith', lambda h, d: False) if SE.dungeon_treasure_left(s) else None
check(o is None, 'no treasure left -> entering the dungeon is impossible')
s = load(BASE); s['dungeon_list'] = []; check(A.ensure_dungeon(s) == [], 'an exhausted (empty) dungeon is NOT rebuilt as a fresh deck (bug fixed)')
cnt = lambda st, n: len(A.P(st, n).get('treasures', []))
s = load(BASE); A.P(s, 'Keith')['treasures'] = [I, I]; A.P(s, 'Newt')['treasures'] = [I, I]; A.P(s, 'LizWiz')['treasures'] = [I]
g = lambda n: S.score(A.P(s, n), s) - S.score(dict(A.P(s, n), treasures=[]), s) if False else None
base = {n: S.score(dict(A.P(s, n), treasures=[]), dict(s, players=[dict(q, treasures=[]) for q in s['players']])) for n in ('Keith', 'Newt', 'LizWiz')}
it = {n: S.score(A.P(s, n), s) - base[n] for n in base}
check(it == {'Keith': 10, 'Newt': 10, 'LizWiz': 5}, f'Items majority: tied most both 10, next 5 ({it})')

print('\n=== 9. Game end only when a supply is depleted INCLUDING face-up; the round then finishes ===')
s = load(BASE); s['tow_list'] = []; s['tower_deck'] = 0
check(not A.check_end(s), 'empty tower DECK with a face-up tower: game end NOT triggered')
s['reag_list'] = []; check(not A.check_end(s), 'empty reagent deck never triggers the end')
p = f'{TMP}/t9.json'; tier, r_, _ = CD.tower_info(s['tower_face']); A.P(s, 'Keith')['tok'] = [A.norm(r_)] * tier; dump(s, p)
rc, out, _ = turn(p, 'build', 'reagent'); s9 = load(p)
check(s9['meta'].get('game_end_triggered') and s9['meta'].get('game_over') and len(lines(out, 'OPP:')) == 2, 'Keith takes the last tower -> triggered; Newt and LizWiz finish the round; then game over')
check('GAME OVER' in out and 'QC: PASS' in out, 'game-over package passes QC')
F = TP.qc(dict(load(BASE), meta=dict(load(BASE)['meta'], game_end_triggered=True)), 'OPP: x', 'Keith', 'action', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
check(any('without a fully depleted supply' in f for f in F), 'QC FAILS when the end is flagged without a depleted supply')
s = load(BASE); s['wiz_list'] = []; s['wiz_face'] = []
F = TP.qc(s, 'OPP: x', 'Keith', 'action', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
check(any('NOT triggered' in f for f in F), 'QC FAILS when a supply is depleted but the end is not flagged')
check('INCLUDING its face-up cards' in TP.end_line(load(BASE)), 'END line states the rulebook depletion rule every turn')

print('\n=== 10. Dungeon runs card by card; the real deck is never peeked ===')
p = f'{TMP}/t10.json'; s = load(BASE); A.P(s, 'Keith')['mana'] = 30; dump(s, p); before = md5(p)
fam = os.path.basename([f for f in s['fam_face'] if f][0])[:-4]
rc, out, _ = turn(p, 'summon', fam, 'dungeon', '--draws', '2', '--preview')
check(rc == 0 and md5(p) == before and len(lines(out, 'DRAW ')) <= 2 and 'DRAW 3' not in out, 'preview shows at most N draws and saves nothing')
check(all('/assets/enhanced/' in l for l in lines(out, 'DRAW ')), 'each drawn card has its enhanced image')
rc, out2, _ = turn(p, 'summon', fam, 'dungeon')
check(rc != 0 and 'card by card' in out2 and md5(p) == before, 'a human dungeon run without --draws is refused')
names = [l.split(': ', 1)[1].split(' | ')[0] for l in lines(out, 'DRAW ')]
rc, out3, _ = turn(p, 'summon', fam, 'dungeon', '--draws', '2')
check(rc == 0 and all(n.split(' (')[0] in out3 for n in names), 'commit with the same --draws draws exactly the previewed cards')

print('\n=== 11. No proxy / max bidding; bids one step at a time ===')
p = f'{TMP}/t11.json'; dump(load(BASE), p); s = load(p); w = [x for x in s['wiz_face'] if x][0][len('assets/Wizard_'):-4]
rc, out, _ = turn(p, 'recruit', w, '1', '--max', '9'); check(rc != 0 and 'disabled' in out, '--max proxy is refused')
rc, out, _ = turn(p, 'max', '9'); check(rc != 0 and 'disabled' in out, "'max N' is refused")
rc, out, _ = turn(p, 'recruit', w, '0'); check(rc != 0, 'opening bid 0 is refused (min 1)')
rc, out, _ = turn(p, 'recruit', w); check(rc != 0 and 'opening' in out.lower(), 'recruit without an opening bid is refused (ask Keith)')
F = TP.qc(load(BASE), 'OPP: x\nuse a max bid of 20', 'Keith', 'show', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
check(any('proxy' in f for f in F), 'QC FAILS if output offers max/proxy bidding')
# 2-player duel rule: the starter may only bid once
s2 = load(BASE); s2['meta']['seat_order'] = ['Keith', 'Newt']; s2['players'] = [q for q in s2['players'] if q['name'] != 'LizWiz']
a = T.start_auction(s2, 'Keith', w, 1); a['order'] = ['Keith', 'Newt']; a['active'] = ['Keith', 'Newt']
T.AI = None
class _AI:   # Newt always raises by 1
    @staticmethod
    def raise_bid(v, n, c, h): return h + 1
T.AI = _AI; T.view = lambda s, n: None
st_, who = T.auction_run(s2, a); import importlib; importlib.reload(T)
check(st_ == 'done' and who == 'Newt' and [x for x in a['tail'] if x[0] == 'Keith'][-1][1] == 'pass', '2-player duel: starter bid once, the other outbid -> starter cannot answer')

print('\n=== 12. AI bids capped at real marginal value + margin (no overbidding, no peeking) ===')
worst = []; cnt_ = 0
states = [sim_s] + [json.load(open(f)) for f in sorted(glob.glob('/tmp/g6_state_r*_Keith_bid_*_pre.json'))[:12]]
for st in states:
    for me in [q['name'] for q in st['players'] if q['name'] not in st['meta'].get('humans', [])] or ['Newt']:
        for wz in [x for x in st.get('wiz_face', []) if x]:
            bd = AI.bid_breakdown(AI.public_view(st, me), me, wz); cnt_ += 1
            if bd['limit'] > bd['fair_cap']: worst.append((me, wz, bd['limit'], bd['fair_cap']))
            if bd['gain'] <= 1 and bd['deny'] < 3 and bd['limit'] > 20: worst.append(('lowvalue', me, wz, bd['limit']))
check(not worst, f'{cnt_} AI x wizard x position cases: limit <= fair cap (3 mana/VP of real value + 2); +1 VP cards <= 20 mana {worst[:3]}')
st = sim_s; me = 'Newt'; wz = [x for x in st['wiz_face'] if x][0]
l1 = AI.bid_limit(AI.public_view(st, me), me, wz); t2 = copy.deepcopy(st)
for q in t2['players']:
    if q['name'] != me: q['mana'] += 77; q['hand'] = list(reversed(q['hand']))
t2['wiz_list'] = list(reversed(t2['wiz_list'])); l2 = AI.bid_limit(AI.public_view(t2, me), me, wz)
check(l1 == l2, f'bid limit unchanged when hidden info (rivals\' mana/hands, deck order) changes ({l1} == {l2})')

print('\n=== 13. Hidden AI info never leaks; tracks stay 1..12 ===')
s = load(f'{TMP}/t1.json'); nw = A.P(s, 'Newt')
for txt, what in ((f"Newt mana {nw['mana']}", 'mana'), (f"Newt has {nw['mana']} mana", 'mana'), (f"Reagent_{os.path.basename(nw['hand'][0])[8:-4]}", 'hand'), ('dungeon_list: [..]', 'deck')):
    F = TP.qc(s, 'OPP: x\n' + txt, 'Keith', 'show', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
    check(any('LEAK' in f for f in F), f'QC FAILS on leaked {what}: "{txt}"')
rc, out, _ = turn(f'{TMP}/t1.json', 'show'); check('LEAK' not in out, 'real package has no leak')
s = load(BASE); s['tracks']['Horn'] = 13
F = TP.qc(s, 'OPP: x', 'Keith', 'show', None, 0, {'all': [], 'lined': set()}, [], 10**6, 'show', want_render=False)
check(any('outside 1..12' in f for f in F), 'QC FAILS on a track outside 1..12')

print('\n=== 14. Other rule fixes ===')
s = load(BASE); k = A.P(s, 'Keith')
check(all(A.tower_cost(k, 'assets/' + c['key'], 'gold') == c['cost']['gold'] and A.tower_cost(k, 'assets/' + c['key'], 'reagent') == c['cost']['reagent_count'] for c in CD.cards('Tower')), 'tower costs read from carddb (reagents bottom-left, gold bottom-right)')
sp = [x for x in s['spell_face'] if x][0]; m0 = k['mana']; A.research(s, 'Keith', os.path.basename(sp)[:-4])
check(m0 - k['mana'] == CD.get(sp)['cost']['mana'], 'research pays the carddb mana cost')
# AI gather + cast: cost spent before the storage check (fewer put-backs)
s = load(BASE); n = A.P(s, 'Newt'); card = n['hand'][0]; got = CD.reagent_icons(card)[0][:3]
n['tok'] = ['Eye_of_Newt'] * 2 + ['Horn'] * 8; n['spells'] = [{'img': 'assets/Spell_Spell_Shield_A.jpg', 'cast': False}]
over = len(n['tok']) + len(got) - 10
act = {'type': 'gather', 'card': os.path.basename(card)[:-4], 'keep': got if len(CD.reagent_icons(card)[0]) > 3 else None, 'discard': ['Horn'] * over,
       'cast': {'spell': 'Spell_Shield_A', 'cost': ['Eye_of_Newt', 'Eye_of_Newt']}}
from collections import Counter
SIM.apply_action(s, 'Newt', act, [], Counter())
check(len(n['tok']) == 10 + len(got) - over - 2 + (over - max(0, over - 2)) and n['spells'][0]['cast'], f'AI gather+cast pays the cast before the storage check (returned {max(0, over - 2)} not {over})')
dw = [c['key'] for c in CD.cards('Wizard') if c['school'] == 'Druidry'][0]
pts = S.pairing({'wizards': [dw, dw] + [[c['key'] for c in CD.cards('Wizard') if CD.school(c['key']) == 'Alchemy'][0]],
                 'towers': [c['key'] for c in CD.cards('Tower') if c['school'] == 'Druidry'][:2] + [c['key'] for c in CD.cards('Tower') if c['school'] == 'Sorcery'][:4],
                 'spells': [{'img': c['key'], 'cast': True} for c in CD.cards('Spell') if c['school'] == 'Druidry'][:3]})
check(pts == 43, f"rulebook example (Christine: 3 wizards, 6 towers, 2 matched Druidry, 3 Druid spells) = 43 VP ({pts})")

print('\n=== 15. Safety ===')
check(G6_MD5 is None or md5(G6) == G6_MD5, 'game/g6_state.json unchanged by tests')
print(f'\nTypical full turn (Keith action + 2 AI turns + board/mats render + package): {TYPICAL:.2f}s')
print(f'RESULT: {PASS} passed, {FAIL} failed' + (' -> ALL PASS' if not FAIL else ''))
sys.exit(1 if FAIL else 0)
