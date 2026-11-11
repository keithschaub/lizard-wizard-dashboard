"""Tests for the browser glue (engine/web/lw_web.py). Same style as scripts/test_turn_process.py.
Run: python3 engine/web/test_lw_web.py   (never writes to engine/game; works on in-memory copies of g8)"""
import os, sys, json, copy, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import lw_web as W
A, CD, SE, S, T = W.A, W.CD, W.SE, W.S, W.T
G8 = os.path.join(HERE, '..', 'game', 'g8_state.json')
G8_TEXT = open(G8).read()
PASS = FAIL = 0
def check(ok, msg):
    global PASS, FAIL
    PASS += bool(ok); FAIL += (not ok); print(('  PASS ' if ok else '  FAIL ') + msg)
def g8(): return json.loads(G8_TEXT)
def call(fn, **kw): return json.loads(W.call(fn, json.dumps(kw)))
def P(n): return A.P(W.st(), n)
def ai_until_keith(limit=12):
    ents = []
    for _ in range(limit):
        r = call('ai_step')['result']; ents += r['entries']
        if r['status'] != 'done': break
    return ents
def setup(mut):
    s = g8(); mut(s); W.load(json.dumps(s)); return s
def add_spell(s, who, k, cast=False): A.P(s, who).setdefault('spells', []).append({'img': 'assets/' + k + '.jpg', 'cast': cast})

print('\n=== 1. g8 loads; the view hides AI hands and mana; Gold is public ===')
v = W.load(G8_TEXT)
k, nw, lz = v['players']
check(v['round'] == 2 and v['next'] == 'Keith' and v['legal'] is not None, 'g8: round 2, Keith to act, legal targets listed')
check(k['hand'] == ['Reagent_51', 'Reagent_14', 'Reagent_15'] and k['mana'] == 20, "Keith sees his own hand and mana")
check(nw['hand'] is None and nw['mana'] is None and lz['hand'] is None and lz['mana'] is None, 'opponent hands and mana are not in the view')
check(lz['gold'] == 4 and nw['hand_count'] == 3, 'opponent Gold is public (meta.show_gold), hand size only')
blob = json.dumps(v) + json.dumps(W.full_log())
check(not any(h[len('/workspace/lizard-wizard/assets/'):-4] in blob for q in W.st()['players'] if q['name'] != 'Keith' for h in q['hand']), 'no opponent hand card id anywhere in view or log')
check(all(x not in blob for x in ('reag_list', 'wiz_list', 'dungeon_list', 'hands_seed', 'board_seed')), 'no deck order or seeds in the view')
check(W.card_db()['Spell_Charm']['effect'] == CD.get('Spell_Charm.jpg')['effect'], 'card text comes from carddb')

print('\n=== 2. Legal targets = every affordable action (turn_package.grouped_options) ===')
L = v['legal']
check(set(L['gather']) == {'Reagent_51', 'Reagent_14', 'Reagent_15'} and len(L['gather']['Reagent_14']['keeps']) == 4, 'every hand card is gatherable; the 4-icon card offers all 4 keep-3 combinations')
check(L['build'] and L['build']['reagent'] == {'n': 1, 'reagent': 'Sulphur'} and L['build']['gold'] is None, 'build the T1 tower with 1 Sulphur (no Gold yet)')
check(sorted(L['recruit']) == sorted(v['board']['wiz_face']) and len(L['research']) == 4, 'both wizards recruitable, all 4 spells researchable')
check(all(set(d['uses']) == {'score', 'gather', 'dungeon', 'research'} for d in L['summon'].values()), 'all four familiar uses offered')
check('qc_missing' not in L, 'no affordable action missing (engine required_keys check)')

print('\n=== 3. Gather: keep 3, refused keeps leave the state untouched, AI seats then play ===')
before = W.dump()
r = call('act_gather', card='Reagent_14', keep=['Mandrake', 'Horn', 'Toadstool'])
check(not r['ok'] and W.dump() == before, f"an illegal keep is refused and nothing changes ({r.get('error')})")
r = call('act_gather', card='Reagent_14', keep=['Mandrake', 'Toadstool', 'Nightshade'])
k2 = P('Keith')
check(r['ok'] and r['result'] == 'done' and len(k2['tok']) == 8 and len(k2['hand']) == 3 and 'Reagent_14.jpg' not in ' '.join(k2['hand']), 'gather commits: +3 tokens, card discarded, new card dealt')
check(W.st()['tracks']['Horn'] == 3 and r['view']['next'] == 'Newt', 'Increase Value icons raised the tracks; Newt is next')
ents = ai_until_keith()
check(W.st()['next'] == 'Keith' and {e['who'] for e in ents if e['act'] == 'turn'} >= {'LizWiz', 'Keith'}, f'ai_step plays Newt then LizWiz, back to Keith ({len(ents)} log entries)')
check(all('mana' not in json.dumps(e).lower() or e['act'] in ('research', 'summon', 'convert', 'convert1', 'auction', 'trigger', 'mana_drain', 'turn') for e in ents), 'AI log entries carry only public facts')

print('\n=== 4. Gather + cast: castable with just-gathered reagents, cast paid before storage, put-backs ===')
def m4(s):
    k = A.P(s, 'Keith'); k['tok'] = ['Horn'] * 3 + ['Sulphur'] * 6; k['hand'][0] = '/workspace/lizard-wizard/assets/Reagent_01.jpg'
    s['reag_list'] = [x for x in s['reag_list'] if 'Reagent_01.' not in x]
    add_spell(s, 'Keith', 'Spell_Mana_Drain'); A.P(s, 'Newt')['mana'] = 18
setup(m4)
pv = call('gather_preview', card='Reagent_01')['result']
check([c['key'] for c in pv['castable']] == ['Spell_Mana_Drain'], 'Mana Drain glows: castable only thanks to the gathered Nightshade')
check(pv['over'] == 2, f"without the cast: 12 tokens vs storage 10 -> put back 2 ({pv['over']})")
pv2 = call('gather_preview', card='Reagent_01', cast='Spell_Mana_Drain')['result']
check(pv2['over'] == 0, 'with the cast: cost spent before the storage check -> no put-back')
nm, km = P('Newt')['mana'], P('Keith')['mana']
r = call('act_gather', card='Reagent_01', cast='Spell_Mana_Drain')
check(r['ok'] and r['result'] == 'pending' and r['view']['pending']['kind'] == 'mana_drain', 'after the cast the UI is asked for the target')
r = call('resolve_effect', choice={'player': 'Newt'})
check(r['ok'] and nm == 18 and P('Keith')['mana'] == km + 15 and P('Newt')['mana'] == 3, 'Mana Drain applied by the engine: Keith +15, Newt 18 -> 3')
md = [e for e in r['entries'] if e.get('act') == 'mana_drain'][-1]
check(md.get('feedback') == 'Stole 15 mana from Newt', 'Mana Drain public log includes steal feedback')
check(r['view']['next'] == 'Newt' and any(e['act'] == 'mana_drain' for e in W.st()['meta']['log']), 'turn passes after the effect resolves')
setup(m4)
r = call('act_gather', card='Reagent_01', cast='Spell_Mana_Drain')
A.P(W.st(), 'LizWiz')['mana'] = 0
r = call('resolve_effect', choice={'player': 'LizWiz'})
md0 = [e for e in r['entries'] if e.get('act') == 'mana_drain'][-1]
check(r['ok'] and md0.get('feedback') == 'LizWiz had no mana, nothing to steal', 'Mana Drain on 0 mana exposes nothing-to-steal feedback')
setup(m4)
r = call('act_gather', card='Reagent_01')
check(not r['ok'] and 'over storage' in r['error'], 'over storage without put-backs is refused')
r = call('act_gather', card='Reagent_01', discard=['Sulphur', 'Sulphur'])
check(r['ok'] and P('Keith')['tok'].count('Sulphur') == 4 and len(P('Keith')['tok']) == 10, 'chosen put-backs are returned (exactly 2 Sulphur)')

print('\n=== 5. Flame Bolt vs Spell Shield (negative spell blocked), then unshielded ===')
def m5(s):
    k = A.P(s, 'Keith'); k['tok'] = ['Foxglove', 'Foxglove', 'Sulphur'] * 2
    s['spell_face'][0] = 'assets/Spell_Flame_Bolt_S.jpg'
    n = A.P(s, 'Newt'); n['towers'] = ['assets/Tower_T1_Azure_Tower.jpg']; add_spell(s, 'Newt', 'Spell_Spell_Shield_A', cast=True)
setup(m5)
r = call('act_research', spell='Spell_Flame_Bolt_S', cast=True)
opts = r['view']['pending']['options']
check(r['ok'] and {'player': 'Newt', 'kind': 'towers', 'card': 'Tower_T1_Azure_Tower'} in opts, 'research + cast Flame Bolt: Newt\'s tower is a legal target')
r = call('resolve_effect', choice={'player': 'Newt', 'kind': 'towers', 'card': 'Tower_T1_Azure_Tower'})
n = P('Newt')
check(r['ok'] and n['towers'] == ['assets/Tower_T1_Azure_Tower.jpg'] and not any('Spell_Shield' in x['img'] for x in n['spells']), 'Spell Shield blocks it: tower kept, shield placed out of play')
check(any(e['act'] == 'flame_bolt_blocked' for e in W.st()['meta']['log']) and 'assets/Spell_Spell_Shield_A.jpg' in W.st()['out_of_play'], 'blocked attack logged; shield in out_of_play')
def m5b(s): m5(s); A.P(s, 'Newt')['spells'] = []
setup(m5b)
call('act_research', spell='Spell_Flame_Bolt_S', cast=True)
r = call('resolve_effect', choice={'player': 'Newt', 'kind': 'towers', 'card': 'Tower_T1_Azure_Tower'})
check(r['ok'] and P('Newt')['towers'] == [] and 'assets/Tower_T1_Azure_Tower.jpg' in W.st()['out_of_play'], 'without a shield the tower is destroyed (out of play)')
check(P('Keith')['spells'][-1]['cast'] and P('Keith')['mana'] == 15, 'Flame Bolt marked cast, 5 mana research cost paid')

print('\n=== 6. More spells through the engine: Wand Tax, Scry Tower, Charm, Haste, Creation ===')
def m6(s):
    k = A.P(s, 'Keith'); k['tok'] = ['Eye_of_Newt', 'Mandrake', 'Mandrake', 'Foxglove', 'Sulphur', 'Foxglove', 'Toadstool']
    k['towers'] = ['assets/Tower_T1_Keep_of_Elixers.jpg']; s['tow_list'] = [t for t in s['tow_list'] if 'T1_Keep_of_Elixers' not in t]; s['tower_deck'] = len(s['tow_list'])
    s['spell_face'][:3] = ['assets/Spell_Wand_Tax.jpg', 'assets/Spell_Scry_Tower.jpg', 'assets/Spell_Haste.jpg']
setup(m6)
sc = CD.school('Tower_T1_Keep_of_Elixers.jpg')
r = call('act_research', spell='Spell_Wand_Tax', cast=True)
o = [x for x in r['view']['pending']['options'] if x['school'] == sc][0]
r = call('resolve_effect', choice={'school': sc})
check(r['ok'] and P('Keith')['gold'] == o['gold'] == 2 * SE.school_count(P('Keith'), sc), f'Wand Tax on {sc}: +{o["gold"]} Gold')
setup(m6)
top5 = [W.key(x) for x in W.st()['tow_list'][:5]]; ntow = len(W.st()['tow_list'])
r = call('act_research', spell='Spell_Scry_Tower', cast=True)
shown = [x['card'] for x in r['view']['pending']['options']]
check(shown == top5, 'Scry Tower reveals exactly the top 5 of the Tower deck (to the caster only)')
r = call('resolve_effect', choice={'card': top5[3]})
check(r['ok'] and W.key(P('Keith')['towers'][-1]) == top5[3] and len(W.st()['tow_list']) == ntow - 1, 'the chosen tower is taken for free')
setup(m6)
r = call('act_research', spell='Spell_Haste', cast=True)
check(r['ok'] and r['result'] == 'bonus' and r['view']['next'] == 'Keith' and r['view']['legal'], 'Haste: Keith takes a bonus action')
r = call('act_convert', reagent='Sulphur', n=1)
check(r['ok'] and r['view']['next'] == 'Newt', 'after the bonus action the turn passes')

print('\n=== 6b. Creation: take face-up wizard or tower (UI keys, engine paths) ===')
def m6cr(s):
    k = A.P(s, 'Keith')
    k['tok'] = ['Horn'] * 4 + ['Eye_of_Newt', 'Eye_of_Newt']
    k['mana'] = 25
    face = list(s.get('spell_face') or ['', '', ''])
    face[0] = 'assets/Spell_Creation.jpg'
    s['spell_face'] = face
setup(m6cr)
st = W.st()
wiz_key = W.key(st['wiz_face'][0])
wz0 = len(st['wiz_list'])
r = call('act_research', spell='Spell_Creation', cast=True)
check(r['ok'] and r['view']['pending']['kind'] == 'creation', 'Creation opens the picker')
r = call('resolve_effect', choice={'kind': 'wizards', 'card': wiz_key})
check(r['ok'] and W.key(P('Keith')['wizards'][-1]) == wiz_key and len(W.st()['wiz_list']) == wz0 - 1, 'Creation takes a face-up wizard')
check(any(e.get('act') == 'creation' and e.get('kind') == 'wizards' for e in W.st()['meta']['log']), 'creation wizard logged')
setup(m6cr)
st = W.st()
tow_key = W.key(st['tower_face'])
tlist0 = len(st['tow_list'])
r = call('act_research', spell='Spell_Creation', cast=True)
r = call('resolve_effect', choice={'kind': 'towers', 'card': tow_key})
check(r['ok'] and W.key(P('Keith')['towers'][-1]) == tow_key and len(W.st()['tow_list']) == tlist0 - 1, 'Creation takes the face-up tower')
setup(m6cr)
r = call('act_research', spell='Spell_Creation', cast=True)
before = W.dump()
r = call('resolve_effect', choice={'kind': 'wizards', 'card': 'Wizard_Not_On_Face'})
check(not r['ok'] and W.dump() == before and W.pend(W.st())['kind'] == 'creation', 'failed Creation leaves state and pending unchanged')
def m6ts(s):
    k = A.P(s, 'Keith')
    k['tok'] = ['Foxglove', 'Mandrake', 'Mandrake']
    k['mana'] = 20
    face = list(s.get('spell_face') or [''] * 3)
    face[0] = 'assets/Spell_Time_Shift.jpg'
    s['spell_face'] = face
setup(m6ts)
r = call('act_research', spell='Spell_Time_Shift', cast=True)
check(r['ok'] and r['view']['pending']['kind'] == 'time_shift', 'Time Shift opens deck choice')
top5 = [W.key(x) for x in W.st()['spell_list'][:5]]
nspell = len(W.st()['spell_list'])
r = call('resolve_effect', choice={'deck': 'spells'})
ent = [e for e in W.st()['meta']['log'] if e.get('act') == 'time_shift'][-1]
ts_pub = [e for e in r['entries'] if e.get('act') == 'time_shift'][-1]
check(r['ok'] and ent['removed'] == top5 and ent['remaining'] == nspell - 5, 'Time Shift removes top 5 and logs card keys')
check(ts_pub['cards'] == top5 and ts_pub['remaining'] == nspell - 5 and ts_pub['deck'] == 'spells', 'public log exposes removed cards for UI')
def m6scribe(s):
    k = A.P(s, 'Keith')
    k['tok'] = ['Eye_of_Newt', 'Eye_of_Newt', 'Mandrake', 'Horn']
    k['mana'] = 20
    face = list(s.get('spell_face') or [''] * 4)
    for i, sk in enumerate(face):
        if sk and 'Time_Shift' in sk:
            face[i] = 'assets/Spell_Scribe.jpg'
            break
    else:
        face[0] = 'assets/Spell_Scribe.jpg'
    s['spell_face'] = face
    s['spell_list'].insert(1, 'assets/Spell_Time_Shift.jpg')
    s['spell_deck'] = len(s['spell_list'])
s = setup(m6scribe)
ts_key = W.key(s['spell_list'][1])
r = call('act_research', spell='Spell_Scribe', cast=True)
opts = r['view']['pending']['options']
check(r['ok'] and any(o['card'] == ts_key for o in opts), 'Scribe reveals top spell including Time Shift')
r = call('resolve_effect', choice={'card': ts_key})
check(r['ok'] and r['view'].get('pending', {}).get('kind') == 'time_shift', 'Scribe free-cast Time Shift opens deck picker')
nmid = len(W.st()['spell_list'])
r = call('resolve_effect', choice={'deck': 'spells'})
ent = [e for e in W.st()['meta']['log'] if e.get('act') == 'time_shift'][-1]
check(r['ok'] and ent['n'] == 5 and ent['remaining'] == nmid - 5, 'Scribe then Time Shift removes 5 from spell deck')

def m6ai_scribe(s):
    s['next'] = 'Newt'
    s['meta']['humans'] = ['Keith']
    s['meta']['web_pending'] = None
    p = A.P(s, 'Newt')
    p['mana'] = 20
    p['tok'] = ['Eye_of_Newt'] * 5
    p['spells'] = []
    s['spell_face'][0] = 'assets/Spell_Scribe.jpg'
    s['spell_list'] = ['assets/Spell_Scry_Dungeon.jpg'] + [x for x in s['spell_list'] if x != 'assets/Spell_Scry_Dungeon.jpg']
    s['spell_deck'] = len(s['spell_list'])

setup(m6ai_scribe)
old_choose = W.T.AI.choose_action
W.T.AI.choose_action = lambda view, me: (
    {'type': 'research', 'spell': 'Spell_Scribe', 'cast': ['Eye_of_Newt']},
    'test: force Scribe'
)
try:
    r = call('ai_step')
finally:
    W.T.AI.choose_action = old_choose
scribe = [e for e in W.st()['meta']['log'] if e.get('act') == 'scry_spells'][-1]
picked = scribe['took'].replace('.jpg', '')
newt_spells = A.P(W.st(), 'Newt')['spells']
check(r['ok'] and scribe.get('cast') and scribe.get('free') and picked == 'Spell_Scry_Dungeon',
      'AI Scribe chooses a top-five spell and logs the free cast')
check(any(CD.key(x['img']).replace('.jpg', '') == picked and x.get('cast') for x in newt_spells) and
      any(e.get('act') == 'scry_dungeon' and e.get('who') == 'Newt' for e in W.st()['meta']['log']),
      'AI Scribe marks the chosen spell cast and resolves its effect')
check(any(e.get('act') == 'scry_spells' and e.get('cast') == picked for e in r['result']['entries']),
      'AI Scribe banner exposes the freely cast spell')
W.st()['spell_list'] = []
SE.scry_deck(W.st(), 'Newt', 'spells', lambda top: top[0], cast_free=True)
check(any(e.get('act') == 'scry_spells' and e.get('empty') for e in W.st()['meta']['log']),
      'Scribe with an empty Spell deck logs the unavailable free cast')

def m6c(s):
    k = A.P(s, 'Keith'); k['tok'] = ['Foxglove', 'Foxglove', 'Mandrake', 'Mandrake', 'Mandrake']; add_spell(s, 'Keith', 'Spell_Charm')
    A.P(s, 'Newt')['spells'] = []
setup(m6c)
nw0 = list(P('Newt')['wizards'])
r = call('act_gather', card='Reagent_15', cast='Spell_Charm')
r = call('resolve_effect', choice={'player': 'Newt', 'kind': 'wizards', 'card': W.key(nw0[0])})
check(r['ok'] and P('Newt')['wizards'] == [] and P('Keith')['wizards'] == nw0, 'Charm takes Newt\'s wizard')

print('\n=== 7. Dungeon card by card: only flipped cards are revealed; commit draws exactly them ===')
setup(lambda s: None)
deck = copy.deepcopy(W.st()['dungeon_list'])
r = call('act_summon', familiar='Familiar_5_Imp', use='dungeon')
pv = r['view']['pending']
check(r['ok'] and pv['type'] == 'dungeon' and pv['drawn'] == [] and pv['limit'] == 2 and P('Keith')['mana'] == 20, 'entering shows no card yet; nothing paid until the run ends')
r = call('dungeon_flip'); pv = r['view']['pending']
check(pv['drawn'] == [W.dungeon_key(deck[0])] and 'drawn_cards' in pv, f'flip 1 reveals only the top card ({pv["drawn"]})')
check(json.dumps(deck[1]) not in json.dumps(r['view']) or deck[1] == deck[0], 'the next card is not revealed')
while not pv['done'] and pv['hits'] < 1 and pv['draws'] < 4:
    r = call('dungeon_flip'); pv = r['view']['pending']
drawn = pv['drawn']; ok = pv['success']
r = call('dungeon_stop')
e = [x for x in W.st()['meta']['log'] if x.get('act') == 'dungeon'][-1]
check(r['ok'] and [W.dungeon_key(c) for c in e['drawn']] == drawn and e['success'] == ok, f'commit draws exactly the flipped cards ({len(drawn)}, success={ok})')
check(P('Keith')['mana'] == 15 and (not ok or P('Keith')['gold'] == sum(c.get('gold', 0) for c in e['kept']) + e['bonus_gold']), 'familiar paid; kept Gold added')
setup(lambda s: None)
call('act_summon', familiar='Familiar_5_Imp', use='dungeon'); r = call('dungeon_cancel')
check(r['ok'] and r['view']['pending'] is None and r['view']['legal'], 'leaving before the first flip is allowed (nothing revealed)')
def m7(s): s['dungeon_list'] = [{'deck': 'Dungeon', 'type': 'Monster', 'name': 'Orc', 'monster_type': 'Goblinoid'}] * 2 + [{'deck': 'Dungeon', 'type': 'Treasure', 'subtype': 'Gold', 'gold': 2, 'text': 'Collect 2 Gold'}]
setup(m7)
call('act_summon', familiar='Familiar_5_Imp', use='dungeon'); call('dungeon_flip'); r = call('dungeon_flip')
check(r['view']['pending']['done'] and not r['view']['pending']['success'] and r['view']['pending']['hits'] == 2, 'second hit: defeated, the run is over')
r = call('dungeon_stop'); check(r['ok'] and P('Keith')['gold'] == 0, 'defeat keeps nothing')

print('\n=== 8. New Research reveals four, Keith takes one; summon gather casts several spells ===')
setup(lambda s: None)
four = [W.key(x) for x in W.st()['spell_list'][:4]]
r = call('act_summon', familiar='Familiar_5_Bufonem', use='research')
check(r['ok'] and r['view']['pending']['four'] == four, 'the four new spells are revealed')
r = call('choose_new_research', spell=four[2])
check(r['ok'] and W.key(P('Keith')['spells'][-1]['img']) == four[2] and not P('Keith')['spells'][-1]['cast'], 'chosen spell taken (uncast)')
def m8(s):
    k = A.P(s, 'Keith'); k['tok'] = ['Eye_of_Newt'] * 2
    add_spell(s, 'Keith', 'Spell_Spell_Shield_A'); add_spell(s, 'Keith', 'Spell_Crystal_Ball')
setup(m8)
pv = call('summon_gather_preview', familiar='Familiar_5_Bufonem')['result']
check({c['key'] for c in pv['castable']} == {'Spell_Spell_Shield_A', 'Spell_Crystal_Ball'}, 'summon-gather: both spells castable with the 3 collected Eyes')
pv = call('summon_gather_preview', familiar='Familiar_5_Bufonem', casts=['Spell_Crystal_Ball'])['result']
check([c['key'] for c in pv['castable']] == ['Spell_Spell_Shield_A'], 'after choosing Crystal Ball (3 Eyes), Spell Shield (2 Eyes) is still castable')
r = call('act_summon', familiar='Familiar_5_Bufonem', use='gather', casts=['Spell_Crystal_Ball', 'Spell_Spell_Shield_A'])
check(r['ok'] and all(x['cast'] for x in P('Keith')['spells']) and P('Keith')['tok'] == [], 'familiar gather casts BOTH spells (rulebook: as many as you want), costs paid')
check(len(P('Keith')['hand']) == 5, 'Crystal Ball refills hand to 5 immediately after cast')

print('\n=== 9. Auction: Keith opens, AIs bid, Keith answers one step at a time ===')
setup(lambda s: None)
wz = v['board']['wiz_face'][0]
r = call('act_recruit', wizard=wz, opening=1)
a = r['view']['auction']
check(r['ok'] and (a is None or a['waiting'] == 'Keith'), 'opening bid accepted; auction resolved or waiting on Keith')
steps = 0
while r['view']['auction'] and steps < 30:
    a = r['view']['auction']
    r = call('act_bid', n=a['high'] + 1) if a['high'] + 1 <= 6 else call('act_pass'); steps += 1
au = [x for x in W.st()['meta']['log'] if x.get('act') in ('auction', 'auction_nobid')][-1]
check(au.get('won') in ('Keith', 'Newt', 'LizWiz') and r['view']['auction'] is None, f"auction resolved: {au.get('won')} at {au.get('price')}")
check((au['won'] == 'Keith') == (r['view']['next'] == 'Newt'), 'starter wins -> turn ends; starter loses -> takes another action')
r = call('act_bid', n=3); check(not r['ok'], 'bids are refused when no auction waits')

print('\n=== 10. Gather modifiers: Maximum Gather, Bloom, Miracle, wizard bonus ===')
def m10(s):
    k = A.P(s, 'Keith'); add_spell(s, 'Keith', 'Spell_Maximum_Gather', True); add_spell(s, 'Keith', 'Spell_Bloom', True); add_spell(s, 'Keith', 'Spell_Miracle', True)
    k['wizards'] = ['assets/Wizard_Anguis_Magicus.jpg']; k['tok'] = []
setup(m10)
L = W.view()['legal']['gather']['Reagent_14']
check(L['keep'] == 4 and L['maxgather'] and L['bloom'] and L['miracle'] and L['bonus'] == ['Foxglove'], 'flags: Maximum Gather keeps all 4, Bloom, Miracle, Foxglove wizard bonus')
r = call('act_gather', card='Reagent_14', bloom='Horn')
check(r['ok'] and sorted(P('Keith')['tok']) == sorted(['Mandrake', 'Toadstool', 'Eye_of_Newt', 'Nightshade', 'Foxglove', 'Horn']), 'all 4 gathered + wizard Foxglove + Bloom Horn')
setup(m10)
tr = dict(W.st()['tracks'])
r = call('act_gather', card='Reagent_15', miracle=True, bloom='Horn')
g, inc = CD.reagent_icons('Reagent_15.jpg')
check(r['ok'] and sorted(P('Keith')['tok']) == sorted([A.norm(x) for x in inc] + ['Foxglove', 'Horn']), 'Miracle: gathers the Increase Value side')
check(all(W.st()['tracks'][A.norm(x)] == min(12, tr[A.norm(x)] + 1) for x in set(g)) and CD.reagent_icons('Reagent_15.jpg')[0] == g, 'Miracle raises the Gather side tracks; card data restored')
check(not A.audit_tracks(W.st()), 'track audit still consistent after a Miracle gather')

print('\n=== 11. Convert, build, Invisibility Potion, transactional failures ===')
setup(lambda s: None)
r = call('act_convert', reagent='Toadstool', n=1)
check(r['ok'] and P('Keith')['mana'] == 22 and W.st()['tracks']['Toadstool'] == 1, 'convert 1 Toadstool at 2 -> +2 mana, track 1')
setup(lambda s: None)
r = call('act_build', pay='reagent')
check(r['ok'] and W.key(P('Keith')['towers'][0]) == 'Tower_T1_Obelisk_of_Puzzles' and 'Sulphur' not in P('Keith')['tok'], 'build T1 paying 1 Sulphur')
def m11(s):
    A.P(s, 'Keith')['tok'] = ['Eye_of_Newt'] * 3; s['spell_face'][0] = 'assets/Spell_Invisibility_Potion.jpg'; A.P(s, 'Newt')['gold'] = 5
setup(m11)
check(W.view()['legal']['research']['Spell_Invisibility_Potion']['x'], 'Invisibility Potion offered with a variable X')
r = call('act_research', spell='Spell_Invisibility_Potion', cast=True, x=2, target='Newt')
check(r['ok'] and P('Keith')['gold'] == 2 and P('Newt')['gold'] == 3 and P('Keith')['tok'] == ['Eye_of_Newt'], 'X=2 Eyes: steals 2 Gold from Newt')
setup(lambda s: None); before = W.dump()
for fn, kw in (('act_build', dict(pay='gold')), ('act_research', dict(spell='Spell_Haste', cast=True)), ('act_summon', dict(familiar='Familiar_25_Imp', use='score')),
               ('act_convert', dict(reagent='Horn', n=5)), ('resolve_effect', dict(choice={})), ('dungeon_flip', {})):
    r = call(fn, **kw); check(not r['ok'] and W.dump() == before, f'{fn} refused, state unchanged ({r["error"][:60]})')

print('\n=== 11a. Transform (2:1) before convert in the same action ===')
def m_transform(s):
    for r, (exp, _a) in A.audit_tracks(s).items():
        s['tracks'][r] = exp
    k = A.P(s, 'Keith')
    k['tok'] = ['Horn', 'Horn', 'Sulphur']
    add_spell(s, 'Keith', 'Transform', cast=True)
setup(m_transform)
t_h = W.st()['tracks']['Toadstool']
m0 = P('Keith')['mana']
r = call('act_convert', reagent='Toadstool', n=1, transforms=[{'from': ['Horn', 'Sulphur'], 'to': 'Toadstool'}])
check(r['ok'] and r['result'] in ('done', 'stopped (--no-ai)'), 'transform + convert in one action')
check(P('Keith')['tok'] == ['Horn'], 'transform consumed Horn+Sulphur; unsold Horn remains')
check(P('Keith')['mana'] == m0 + t_h and W.st()['tracks']['Toadstool'] == max(1, t_h - 1), 'convert used track value after transform')
xf = [e for e in W.st()['meta']['log'] if e.get('act') == 'transform'][-1]
check(xf.get('steps') == [{'from': ['Horn', 'Sulphur'], 'to': 'Toadstool'}], 'transform logged before convert for replay')
check(not A.audit_tracks(W.st()) and not A.audit(W.st()), 'tracks and convert audit clean after transform')

print('\n=== 11b. Adept Conversion: two types in one convert action, one log entry, audits clean ===')
def sync_tracks(s):
    """Align tracks with audit_tracks replay so tests stay honest about g8 history."""
    for r, (exp, _a) in A.audit_tracks(s).items():
        s['tracks'][r] = exp
def m_adept(s):
    sync_tracks(s)
    k = A.P(s, 'Keith'); k['tok'] = ['Toadstool'] * 2 + ['Horn'] * 2
    add_spell(s, 'Keith', 'Adept_Conversion', cast=True)
setup(m_adept)
t0, h0 = W.st()['tracks']['Toadstool'], W.st()['tracks']['Horn']
m0 = P('Keith')['mana']
r = call('act_convert', reagent='Toadstool', n=1, reagent2='Horn', n2=1)
check(r['ok'] and r['result'] == 'done', 'adept dual convert commits')
check(P('Keith')['tok'].count('Toadstool') == 1 and P('Keith')['tok'].count('Horn') == 1, 'sold 1 of each type')
check(W.st()['tracks']['Toadstool'] == max(1, t0 - 1) and W.st()['tracks']['Horn'] == max(1, h0 - 1), 'each track dropped by count sold (min 1)')
check(P('Keith')['mana'] == m0 + t0 + h0, 'mana at each track value')
logs = W.st()['meta']['log']
lg = next(e for e in reversed(logs) if e.get('act') == 'convert' and e.get('who') == 'Keith' and e.get('adept'))
check(lg.get('act') == 'convert' and lg.get('adept') and len(lg.get('parts', [])) == 2, 'one convert log with two parts')
check(not A.audit(W.st()) and not A.audit_tracks(W.st()), 'audit_tracks and convert audit clean')
setup(lambda s: m_adept(s) or add_spell(s, 'Keith', 'Energize', cast=True))
t0, h0 = W.st()['tracks']['Toadstool'], W.st()['tracks']['Horn']
v1 = min(12, t0 + 3)
m0 = P('Keith')['mana']
r = call('act_convert', reagent='Toadstool', n=1, reagent2='Horn', n2=1, energize=True)
check(r['ok'], 'adept + Energize on first type')
check(P('Keith')['mana'] == m0 + v1 + h0, 'first type at track+Energize, second at base track')
check(W.st()['tracks']['Toadstool'] == max(1, v1 - 1) and W.st()['tracks']['Horn'] == max(1, h0 - 1), 'Energize only bumped first track')
parts = next(e for e in reversed(W.st()['meta']['log']) if e.get('act') == 'convert' and e.get('who') == 'Keith' and e.get('parts'))['parts']
check(parts[0].get('energized') and not parts[1].get('energized'), 'energized flag only on first part')
check(not A.audit_tracks(W.st()), 'track audit after Energize + Adept')
def m_no_adept(s):
    sync_tracks(s)
    k = A.P(s, 'Keith'); k['tok'] = ['Toadstool', 'Horn']
setup(m_no_adept)
before = W.dump(); r = call('act_convert', reagent='Toadstool', n=1, reagent2='Horn', n2=1)
check(not r['ok'] and W.dump() == before, f'2-type convert refused without Adept ({r.get("error")})')

print('\n=== 12. Random full games from g8 through the glue: no crash, legal list always complete ===')
bad = []; games = 0; rounds = []
for seed in range(4):
    rnd = random.Random(seed); W.load(G8_TEXT); steps = 0
    while steps < 400:
        steps += 1; v = W.view()
        if v['game_over']: break
        if v['pending']:
            pd = v['pending']
            if pd['type'] == 'dungeon':
                r = call('dungeon_flip') if not pd['done'] and (pd['draws'] == 0 or rnd.random() < 0.5) else call('dungeon_stop')
            elif pd['type'] == 'new_research': r = call('choose_new_research', spell=rnd.choice(pd['four']))
            else:
                o = rnd.choice(pd['options'])
                if pd['kind'] == 'transmute': o = {'reagents': o['tok'][:2]}
                r = call('resolve_effect', choice=o)
            if not r['ok']: bad.append(('pending', pd['type'], r['error'])); break
            continue
        if v['auction']:
            a = v['auction']; me_ = v['players'][0]
            r = call('act_bid', n=a['high'] + 1) if a['high'] + 1 <= me_['mana'] and rnd.random() < 0.4 else call('act_pass')
            if not r['ok']: bad.append(('bid', r['error'])); break
            continue
        if v['next'] != 'Keith':
            r = call('ai_step')
            if not r['ok']: bad.append(('ai', r['error'])); break
            continue
        L = v['legal']
        if L.get('qc_missing'): bad.append(('missing', L['qc_missing']))
        me_ = v['players'][0]; opts = []
        for cid, gd in L['gather'].items(): opts.append(('g', cid, rnd.choice(gd['keeps'])))
        for rg in L['convert']: opts.append(('c', rg))
        if L['build']: opts += [('b', p) for p in ('reagent', 'gold') if L['build'][p]]
        for sk, d in L['research'].items(): opts.append(('r', sk, d['castable'] and not d['x']))
        for fk, d in L['summon'].items(): opts += [('s', fk, u) for u in d['uses']]
        for wz in L['recruit']: opts.append(('w', wz))
        o = rnd.choice(opts)
        if o[0] == 'g':
            pv = call('gather_preview', card=o[1], keep=o[2])['result']
            cast = rnd.choice([None] + [c['key'] for c in pv['castable'] if c.get('x') is None])
            pv = call('gather_preview', card=o[1], keep=o[2], cast=cast)['result'] if cast else pv
            r = call('act_gather', card=o[1], keep=o[2], cast=cast, discard=pv['pool'][:pv['over']] if pv['over'] else None)
        elif o[0] == 'c': r = call('act_convert', reagent=o[1], n=L['convert'][o[1]]['n'])
        elif o[0] == 'b': r = call('act_build', pay=o[1])
        elif o[0] == 'r': r = call('act_research', spell=o[1], cast=o[2])
        elif o[0] == 'w': r = call('act_recruit', wizard=o[1], opening=1)
        else:
            if o[2] == 'gather':
                pv = call('summon_gather_preview', familiar=o[1])['result']
                r = call('act_summon', familiar=o[1], use='gather', discard=pv['pool'][:pv['over']] if pv['over'] else None)
            else: r = call('act_summon', familiar=o[1], use=o[2])
        if not r['ok']: bad.append((o, r['error'])); break
    games += 1; rounds.append(W.st()['meta']['round'])
    check(not A.audit_tracks(W.st()) and not A.audit(W.st()), f'game {seed}: tracks/convert audit clean after {steps} steps (round {W.st()["meta"]["round"]}, over={W.st()["meta"].get("game_over")})')
check(not bad, f'{games} random games, every glue call accepted, no legal action missing {bad[:3]}')

print('\n=== 13. Game over keeps the final scores; a new game is dealt by scripts/deal4.py ===')
def m13(s):
    s['tow_list'] = []; s['tower_deck'] = 0          # the face-up T1 tower is the last one
setup(m13)
r = call('act_build', pay='reagent')
check(r['ok'] and r['view']['end_triggered'] and not r['view']['game_over'], 'building the last tower triggers the end; the round still finishes')
ai_until_keith()
v = W.view()
check(v['game_over'] and set(v['final']) == {'Keith', 'Newt', 'LizWiz'} and v['legal'] is None, f"game over after Newt and LizWiz finish the round; final scores {v['final']}")
check(all(p['mana'] is not None for p in v['players']), 'at game over every mat is revealed (mana included)')
before = W.dump()
pv = call('new_game_preview', seed=1234, ai_seed=77)
check(pv['ok'] and len(pv['result']['hand']) == 3 and pv['result']['reagents'] == W.REAGENTS and W.dump() == before, 'new game preview: 3 cards for Keith, all 7 reagents to pick from; current game untouched')
check('Newt' not in json.dumps(pv['result']['hand']) and W.G['setup']['meta']['phase'] == 'picks', 'AI picks stay secret until the board is dealt')
r = call('new_game_start', picks=['Horn', 'Horn'])
check(not r['ok'], 'two identical starting reagents are refused')
r = call('new_game_start', picks=['Horn', 'Mandrake'], seed=99)
v = r['view'] if r['ok'] else {}
k = A.P(W.st(), 'Keith')
check(r['ok'] and v['round'] == 1 and v['next'] == 'Keith' and not v['game_over'] and v['legal'], 'new game: round 1, Keith to act, legal targets listed')
check(sorted(k['tok']) == ['Horn', 'Mandrake'] and k['mana'] == 20 and all(len(A.P(W.st(), n)['tok']) == 2 for n in ('Newt', 'LizWiz')), 'starting reagents placed; 20 mana; AIs hold their 2 picks')
s = W.st()
check(s['tower_face'] and len(s['wiz_face']) == 2 and len([x for x in s['spell_face'] if x]) == 4 and len(s['ach']) == 4 and len(s['dungeon_list']) == 51, 'board dealt by deal4 (tower, 2 wizards, 2 familiars, 4 spells, 4 achievements, 51 dungeon cards)')
check(s['meta']['ai_profiles'] == {'Newt': 'spellslinger', 'LizWiz': 'delver'} and s['meta'].get('show_gold'), 'same seats and AI profiles as g8, Gold public')
call('act_gather', card=k['hand'][0].split('/')[-1][:-4], keep=W.view()['legal']['gather'][W.key(k['hand'][0])]['keeps'][0])
ai_until_keith()
check(W.st()['meta']['round'] == 2 and W.st()['next'] == 'Keith', 'the new game plays: Keith gathers, both AIs take round 1 turns')

print('\n=== 14. Auctions: mana only moves when Keith wins; back-to-back auctions in one call; calls report their log entries ===')
B2B = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'e2e', 'fixtures', 'back-to-back-auctions.json')).read()
W.load(B2B)
a = W.view()['auction']; k0 = A.P(W.st(), 'Keith')['mana']
check(a and a['waiting'] == 'Keith' and a['card'] == 'Wizard_Reptilius_Venenum', 'fixture: LizWiz auctions Reptilius Venenum and waits on Keith')
for _ in range(3):
    r = call('act_bid', n=W.view()['auction']['high'] + 1)
    check(r['ok'] and A.P(W.st(), 'Keith')['mana'] == k0 and r['view']['auction']['high'] > r['view']['auction']['tail'][-2][1] - 1, f"raise to {r['view']['auction']['tail'][-3][1] if len(r['view']['auction']['tail']) > 2 else '?'}: AIs answer, Keith's mana unchanged ({k0})")
r = call('act_pass')
# Rulebook: when the AI starter loses, it receives one more action. This
# action can itself be a recruit and therefore pause for another human bid.
check(r['ok'] and r['view'].get('auction') and r['view']['auction']['starter'] == 'LizWiz',
      'after Keith passes, the AI starter resumes and a second recruit can pause for Keith')
entries = r.get('entries', [])
auctions = [e for e in entries if e.get('act') == 'auction']
check(len(auctions) == 1 and auctions[0].get('who') == 'Newt' and auctions[0].get('price') == 13, f"the call reports the resolved auction in entries (Newt won at 13)")
check(A.P(W.st(), 'Keith')['mana'] == k0, 'losing an auction costs Keith nothing')
r = call('act_pass')
check(r['ok'] and not r['view'].get('auction') and r['view']['next'] != 'LizWiz',
      'after the retry auction resolves, LizWiz\'s turn ends')
def m14(s):
    A.P(s, 'Keith')['mana'] = 89; A.P(s, 'Newt')['mana'] = 120; A.P(s, 'LizWiz')['mana'] = 120
setup(m14)
wiz = W.view()['board']['wiz_face'][0]
r = call('act_recruit', wizard=wiz, opening=1)
while r['ok'] and r['view']['auction']:
    check(A.P(W.st(), 'Keith')['mana'] == 89, 'bidding does not reserve mana') if r['view']['auction']['high'] < 3 else None
    r = call('act_bid', n=r['view']['auction']['high'] + 1)
won = [e for e in W.public_log(W.st(), 'Keith') if e['act'] == 'auction'][-1]
check(won['who'] == 'Keith' and A.P(W.st(), 'Keith')['mana'] == 89 - won['price'] and W.key(A.P(W.st(), 'Keith')['wizards'][-1]) == wiz,
      f"Keith wins at {won['price']}: charged once (89 -> {A.P(W.st(), 'Keith')['mana']}) and takes the wizard")

print('\n=== 15. Wizards are conserved: 3 copies of each in a 3-player deal; a mat only changes by logged events ===')
import collections
def wizard_census(s):
    allw = list(s['wiz_face']) + list(s['wiz_list']) + [w for q in s['players'] for w in q['wizards']] + [c for c in s.get('out_of_play', []) if 'Wizard_' in c]
    return collections.Counter(w.split('/')[-1] for w in allw if w)
def expected_delta(entries, name):
    d = 0
    for e in entries:
        a = e.get('act')
        if a == 'auction' and e.get('won') == name: d += 1
        if a == 'charm' and e.get('who') == name: d += 1
        if a == 'charm' and e.get('target') == name: d -= 1
        if a == 'creation' and e.get('who') == name and e.get('kind') == 'wizards': d += 1
        if a == 'scry_wizards' and e.get('who') == name and e.get('took'): d += 1        # Scry Wizard: take one of the top wizards
        if a == 'flame_bolt' and e.get('target') == name and e.get('kind') == 'wizards': d -= 1
    return d
bad = []; calls = 0; keith_wins = 0
for seed in (2, 5, 11, 23):
    W.new_game_preview(seed=seed, ai_seed=seed); W.new_game_start(['Horn', 'Mandrake'], seed=seed)
    for step in range(260):
        s0 = W.st(); n0 = len(s0['meta']['log']); before = {q['name']: len(q['wizards']) for q in s0['players']}
        v = W.view()
        if v['game_over'] or v['pending']: break
        a = v['auction']
        if a and a['waiting'] == 'Keith':
            r = call('act_bid', n=a['high'] + 1) if a['high'] + 1 <= A.P(s0, 'Keith')['mana'] else call('act_pass')
        elif v['next'] != 'Keith': r = call('ai_step')
        else:
            g = v['legal'].get('gather') or {}
            if not g: break
            c = next(iter(g)); args = {'card': c}
            if g[c].get('keeps'): args['keep'] = g[c]['keeps'][0]
            r = call('act_gather', **args)
            for nd in range(1, 8):
                if r['ok']: break
                r = call('act_gather', **dict(args, discard=A.P(W.st(), 'Keith')['tok'][:nd]))
        if not r['ok']: bad.append(f'seed {seed} step {step}: {r["error"]}'); break
        calls += 1; s1 = W.st(); new = s1['meta']['log'][n0:]
        keith_wins += sum(1 for e in new if e.get('act') == 'auction' and e.get('won') == 'Keith')
        cen = wizard_census(s1)
        if set(cen.values()) != {3} or len(cen) != 7: bad.append(f'seed {seed} step {step}: census {dict(cen)}')
        for q in s1['players']:
            if len(q['wizards']) - before[q['name']] != expected_delta(new, q['name']):
                bad.append(f"seed {seed} step {step}: {q['name']} wizards {before[q['name']]} -> {len(q['wizards'])}, logged events say {expected_delta(new, q['name']):+d}")
        if bad: break
check(not bad, f'{calls} engine calls over 4 new games (Keith bids on every auction he can afford, won {keith_wins}): every wizard school always has exactly 3 copies, and every mat changed only by logged auction wins, Charm, Creation, Scry Wizard or Flame Bolt (swaps keep counts)' + (f': {bad[:3]}' if bad else ''))
check(keith_wins >= 2, f'the simulation covers Keith winning auctions ({keith_wins})')

print('\n=== 16. Duplicate wizards on offer: exactly one recruited, census conserved ===')
def m16(s):
    k = A.P(s, 'Keith')
    k['mana'] = 50
    s['wiz_face'] = ['assets/Wizard_Reptilius_Venenum.jpg', 'assets/Wizard_Anguis_Magicus.jpg', 'assets/Wizard_Reptilius_Venenum.jpg']
    s['wiz_list'] = ['assets/Wizard_Draco_Mortemus.jpg']
setup(m16)
before_census = wizard_census(W.st())
before_keith_wiz = len(P('Keith')['wizards'])
r = call('act_recruit', wizard='Wizard_Reptilius_Venenum', opening=1)
check(r['ok'], 'Keith starts auction for Reptilius Venenum (duplicate on offer)')
r = call('act_bid', n=10)
while not r['ok'] or r.get('result') == 'paused':
    r = call('act_bid', n=20)
after_census = wizard_census(W.st())
after_keith_wiz = len(P('Keith')['wizards'])
check(after_census == before_census, f'wizard census conserved: {dict(before_census)} == {dict(after_census)}')
check(after_keith_wiz == before_keith_wiz + 1, f'Keith gained exactly 1 wizard: {before_keith_wiz} -> {after_keith_wiz}')
wiz_face = [w for w in W.st()['wiz_face'] if w]
check(len([w for w in wiz_face if 'Reptilius_Venenum' in w]) == 1, f'exactly 1 Reptilius Venenum left on offer: {[os.path.basename(w) for w in wiz_face]}')
check(P('Keith')['wizards'].count('assets/Wizard_Reptilius_Venenum.jpg') == 1, 'Keith has exactly 1 Reptilius Venenum')

print('\n=== 17. Audit gaps: Powerful Helper, Secret Society, projected VP ===')
def m17ph(s):
    k = A.P(s, 'Keith')
    k['mana'] = 50
    k.setdefault('spells', []).append({'img': 'assets/Spell_Powerful_Helper.jpg', 'cast': True})
    k.setdefault('wizards', []).append('assets/Wizard_Lacerta_Arborus.jpg')  # Druidry sample
setup(m17ph)
fam_key = W.key([x for x in W.st()['fam_face'] if x][0])
sch = W.CD.school('assets/' + fam_key + '.jpg')
base = SE.school_count(A.P(W.st(), 'Keith'), sch) + 1
helper = SE.powerful_helper_bonus(A.P(W.st(), 'Keith'), sch, include_summoned_familiar=True)
leg = W.view()['legal']['summon'][fam_key]
check(leg['score_gold'] == base + helper and leg.get('powerful_helper') == helper, 'legal summon shows Powerful Helper bonus')
g0 = P('Keith').get('gold', 0)
r = call('act_summon', familiar=fam_key, use='score')
check(r['ok'] and P('Keith').get('gold', 0) - g0 == base + helper, 'summon score pays base + Powerful Helper')
fb = [e for e in r.get('entries', []) if e.get('act') == 'summon' and e.get('feedback')]
check(fb and 'Powerful Helper' in fb[0]['feedback'], 'summon score feedback mentions Powerful Helper')

def m17ss(s):
    s['board_seed'] = 0
    k = A.P(s, 'Keith')
    k['mana'] = 40
    k['tok'] = ['Foxglove', 'Foxglove', 'Sulphur', 'Mandrake']
    face = list(s.get('spell_face') or ['', '', ''])
    face[0] = 'assets/Spell_Flame_Bolt_S.jpg'
    s['spell_face'] = face
    n = A.P(s, 'Newt')
    n.setdefault('spells', []).append({'img': 'assets/Spell_Secret_Society.jpg', 'cast': True})
    w1, w2 = 'assets/Wizard_Draco_Mortemus.jpg', 'assets/Wizard_Bufonem_Creaturae.jpg'
    n['wizards'] = [w1, w2]
setup(m17ss)
_w1, _w2 = 'assets/Wizard_Draco_Mortemus.jpg', 'assets/Wizard_Bufonem_Creaturae.jpg'
aim = W.key(_w1)
r = call('act_research', spell='Spell_Flame_Bolt_S', cast=True)
check(r['ok'] and r['view']['pending']['kind'] in ('flame_bolt', 'disintegrate'), 'Flame Bolt opens target picker')
r = call('resolve_effect', choice={'player': 'Newt', 'kind': 'wizards', 'card': aim})
check(r['ok'], f'resolve Flame Bolt on Newt wizard ({r.get("error")})')
ent = [e for e in W.st()['meta']['log'] if e.get('act') == 'flame_bolt'][-1]
check(ent.get('secret_society') and ent.get('aimed'), 'Secret Society logs redirect metadata')
fb = [e for e in r.get('entries', []) if e.get('feedback')]
check(fb and 'Secret Society' in fb[0]['feedback'], 'Flame Bolt toast mentions Secret Society')
got = W.key(ent['card'] + '.jpg') if not ent['card'].endswith('.jpg') else W.key(ent['card'])
check(got in (W.key(_w1), W.key(_w2)), 'a Newt wizard was destroyed')

def m17vp(s):
    k = A.P(s, 'Keith')
    k['wizards'] = ['assets/Wizard_Draco_Mortemus.jpg', 'assets/Wizard_Bufonem_Creaturae.jpg', 'assets/Wizard_Lacerta_Arborus.jpg']
    k.setdefault('spells', []).append({'img': 'assets/Spell_Arch_Mage.jpg', 'cast': True})
    k['mana'] = 21
    k.setdefault('spells', []).append({'img': 'assets/Spell_Hoard_Mana.jpg', 'cast': True})
    nz = A.P(s, 'Newt')
    nz['mana'] = 14
    nz.setdefault('spells', []).append({'img': 'assets/Spell_Hoard_Mana.jpg', 'cast': True})
setup(m17vp)
me = [p for p in W.view()['players'] if p['you']][0]
check(me['vp'] == S.score(A.P(W.st(), 'Keith'), W.st()), 'Keith HUD VP is full projected score')
exp_keith = S.score(A.P(W.st(), 'Keith'), W.st())
check(me['vp'] == exp_keith and exp_keith >= 9 + 3, 'Arch Mage (+9 unique) and Hoard Mana (+3) in live VP')
newt_pub = [p for p in W.view()['players'] if p['name'] == 'Newt'][0]
exp_newt = S.score(A.P(W.st(), 'Newt'), W.st()) - 14 // 7
check(newt_pub['vp'] == exp_newt, 'opponent VP hides Hoard Mana mana bonus only')

print('\n=== 18. Stub spells: Trap, Obscure, Demonic Possession ===')
def m18trap(s):
    k = A.P(s, 'Keith')
    k['mana'] = 30
    k['tok'] = ['Sulphur', 'Sulphur', 'Mandrake', 'Foxglove']
    s['spell_face'][0] = 'assets/Spell_Trap.jpg'
setup(m18trap)
d0 = len(W.st()['dungeon_list'])
r = call('act_research', spell='Spell_Trap', cast=True)
check(r['ok'] and not r['view'].get('pending'), 'Trap resolves without a picker')
check(len(W.st()['dungeon_list']) == d0 + 1 and any(c.get('type') == 'Trap' for c in W.st()['dungeon_list']), 'Trap card shuffled into dungeon')
fb = [e for e in r.get('entries', []) if e.get('feedback')]
check(fb and 'Trap added' in fb[0]['feedback'], 'Trap toast text')

def m18obs(s):
    k = A.P(s, 'Keith')
    k['mana'] = 30
    k['tok'] = ['Toadstool', 'Toadstool', 'Foxglove']
    k.setdefault('spells', []).append({'img': 'assets/Spell_Divination.jpg', 'cast': True})
    s['spell_face'][0] = 'assets/Spell_Obscure.jpg'
setup(m18obs)
r = call('act_research', spell='Spell_Obscure', cast=True)
r = call('resolve_effect', choice={'player': 'Newt'})
check(r['ok'] and A.P(W.st(), 'Newt').get('obscured'), 'Obscure flags the target')
setup(m18obs)
A.P(W.st(), 'Keith')['obscured'] = True
r = call('act_divination')
check(r['ok'] and not A.P(W.st(), 'Keith').get('obscured') and not r['view'].get('pending'), 'Obscure blocks dungeon: action spent, no delve')
check(any(e.get('act') == 'obscure_dungeon' for e in W.st()['meta']['log'][-3:]), 'Obscure dungeon log')

_IMP = 'assets/Familiar_25_Imp.jpg'
def m18dem(s):
    k = A.P(s, 'Keith')
    k['mana'] = 40
    k['tok'] = ['Nightshade', 'Nightshade', 'Mandrake', 'Foxglove']
    s['spell_face'][0] = 'assets/Spell_Demonic_Possession.jpg'
    A.P(s, 'Newt')['familiars'] = [_IMP]
setup(m18dem)
fk = W.key(_IMP)
r = call('act_research', spell='Spell_Demonic_Possession', cast=True)
r = call('resolve_effect', choice={'player': 'Newt', 'kind': 'familiars', 'card': fk})
check(r['ok'] and r['view']['pending']['type'] == 'rise', 'Possession opens familiar use picker')
check(fk in [W.key(x) for x in P('Keith')['familiars']] and _IMP not in P('Newt')['familiars'], 'Familiar moved to caster')
r = call('rise_use', use='score')
check(r['ok'] and P('Keith').get('gold', 0) > 0, 'Immediate score use pays Gold')

def m18empty(s):
    k = A.P(s, 'Keith'); k['mana'] = 40; k['tok'] = ['Nightshade', 'Nightshade', 'Mandrake']
    s['spell_face'][0] = 'assets/Spell_Demonic_Possession.jpg'
    for q in s['players']:
        if q['name'] != 'Keith': q['familiars'] = []
setup(m18empty)
r = call('act_research', spell='Spell_Demonic_Possession', cast=True)
check(r['ok'] and not r['view'].get('pending'), 'Demonic with no targets finishes cast')
check(any(e.get('feedback') == 'No familiars to take' for e in r.get('entries', [])), 'empty demonic possession feedback')

for use in ('dungeon', 'research'):
    setup(m18dem)
    call('act_research', spell='Spell_Demonic_Possession', cast=True)
    call('resolve_effect', choice={'player': 'Newt', 'kind': 'familiars', 'card': fk})
    r = call('rise_use', use=use)
    check(r['ok'] and r['view']['pending']['type'] == ('dungeon' if use == 'dungeon' else 'new_research'), f'Rise {use} opens its picker')
    if use == 'dungeon':
        r = call('dungeon_flip')
        check(r['ok'], f"Rise dungeon first flip works ({r.get('error')})")
        r = call('dungeon_stop')
        check(r['ok'] and not r['view'].get('pending'), 'Rise dungeon expedition finishes')
        check(any(e.get('act') == 'dungeon' for e in W.st()['meta']['log'][-4:]), 'Rise dungeon delve logged')
    else:
        r = call('choose_new_research', spell=r['view']['pending']['four'][0])
        check(r['ok'] and not r['view'].get('pending'), f"Rise New Research takes a spell ({r.get('error')})")
    log = W.st()['meta']['log']; ri = max(i for i, e in enumerate(log) if e.get('act') == 'rise')
    check(not any(e.get('act') in ('summon',) for e in log[ri:]), f'Rise {use} does not summon a face-up familiar')

def m117(spells):
    def mut(s):
        k = A.P(s, 'Keith'); k['gold'] = 0; k['tok'] = ['Foxglove']
        k['spells'] = [x for x in k.get('spells', []) if 'Perfect_Reagent' not in x['img'] and 'Inexpensive' not in x['img']]
        k['spells'] += [{'img': f'assets/Spell_{x}.jpg', 'cast': True} for x in spells]
        s['tower_face'] = 'assets/Tower_T2_Ivory_Spire.jpg'
    return mut
setup(m117([]))
tc = W.view()['tower_cost']
check(tc == dict(tower='Tower_T2_Ivory_Spire', reagent='Mandrake', n=2, gold=2, perfect_reagent=False, inexpensive=False), f'tower cost view: printed cost with no discount ({tc})')
setup(m117(['Perfect_Reagent', 'Inexpensive']))
tc = W.view()['tower_cost']
check(tc['n'] == 1 and tc['gold'] == 1 and tc['perfect_reagent'] and tc['inexpensive'], f'tower cost view: Perfect Reagent and Inexpensive take 1 off ({tc})')
check(tc['n'] == A.tower_cost(A.P(W.st(), 'Keith'), W.st()['tower_face'], 'reagent'), 'tower cost view matches the engine build cost')

print(f'\nRESULT: {PASS} passed, {FAIL} failed' + (' -> ALL PASS' if not FAIL else ''))
sys.exit(1 if FAIL else 0)
