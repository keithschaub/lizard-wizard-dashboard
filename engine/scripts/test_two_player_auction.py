"""Focused regression tests for the two-player auction rule.

Run from engine/: python3 scripts/test_two_player_auction.py
"""
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
import actions as A
import ai_policy as AI
import turn as T

TMP = '/tmp/lw_two_player_auction'
os.makedirs(TMP, exist_ok=True)


def fresh(name, players):
    path = f'{TMP}/{name}.json'
    for f in glob.glob(path + '*'):
        os.remove(f)
    subprocess.run([
        sys.executable, os.path.join(HERE, 'new_game.py'), '--state', path,
        '--players', ','.join(players), '--humans', 'Keith', '--seed', '2211',
        '--ai-seed', '17',
    ], check=True, capture_output=True)
    # One human pick completes setup for these fixtures.
    subprocess.run([
        sys.executable, os.path.join(HERE, 'turn.py'), 'keith', 'pick',
        'Horn', 'Mandrake', '--state', path, '--no-render',
    ], check=True, capture_output=True)
    return json.load(open(path))


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message)
    if not ok:
        raise AssertionError(message)


def test_duel_opening_bids_the_rivals_ledger_mana():
    """Issue #127: a duel starter bids once and the rival may answer with any mana the public ledger shows, so the
    AI opens at exactly that amount (min 1) or not at all; never on the hidden true total."""
    duel = fresh('duel-opening', ['Keith', 'Newt'])
    duel['players'][1]['mana'] = 60
    duel['players'][0]['mana'] = 99                      # hidden true total; the ledger still says 20
    card = next(x for x in duel['wiz_face'] if x)
    view = AI.public_view(duel, 'Newt')
    rival = AI.duel_rival_mana(view, 'Newt'); limit = AI.bid_limit(view, 'Newt', card)
    check(rival == 20, f'the rival mana comes from the public ledger (20), not the hidden total ({rival})')
    check(AI.opening_bid(view, 'Newt', card) == (20 if limit >= 20 else 0),
          f'duel opener bids exactly the rival ledger mana or does not open (limit {limit})')
    A.log(duel, {'r': duel['meta']['round'], 'act': 'auction', 'won': 'Keith', 'item': 'x', 'price': 20, 'starter': 'Keith'})
    view = AI.public_view(duel, 'Newt')
    check(AI.duel_rival_mana(view, 'Newt') == 0 and AI.opening_bid(view, 'Newt', card) == (1 if AI.bid_limit(view, 'Newt', card) >= 1 else 0),
          'a rival with no mana is opened at 1')
    # The rival topped an opening made at its tracked mana earlier this turn: the ledger undercounts it, so no more
    # openings this turn (a duel auction is only opened when it cannot be lost).
    proven = json.loads(json.dumps(duel))
    A.log(proven, {'r': proven['meta']['round'], 'act': 'turn', 'seat': 'Newt'})
    A.log(proven, {'r': proven['meta']['round'], 'act': 'auction', 'won': 'Keith', 'item': 'y', 'price': 2, 'starter': 'Newt',
                   'bids_tail': [['Newt', 1], ['Keith', 2], ['Newt', 'pass']]})
    pv = AI.public_view(proven, 'Newt')
    check(AI.duel_ledger_proven_low(pv, 'Newt') and AI.opening_bid(pv, 'Newt', card) == 0,
          'after the rival topped an opening at its tracked mana, the AI opens nothing more this turn')
    duel['players'][1]['mana'] = 5
    poor_view = AI.public_view(duel, 'Newt')
    choices, *_ = AI._candidates(poor_view, 'Newt')
    face = {w.split('/')[-1]: w for w in duel['wiz_face'] if w}
    recruits = [a['wizard'] for _, _, _, a, _ in choices if a.get('type') == 'recruit']
    check(all(AI.opening_bid(poor_view, 'Newt', face[w]) >= 1 for w in recruits),
          f'every recruit the AI considers can be opened at a price the rival cannot top ({recruits})')

    three = fresh('three-opening', ['Keith', 'Newt', 'LizWiz'])
    three['players'][1]['mana'] = 50
    card3 = next(x for x in three['wiz_face'] if x)
    view3 = AI.public_view(three, 'Newt')
    check(AI.opening_bid(view3, 'Newt', card3) == 1, '3-player opener remains 1')


def test_ai_starter_gets_one_extra_action_after_human_wins():
    state = fresh('duel-retry', ['Keith', 'Newt'])
    state['next'] = 'Newt'
    state['turn'] = state['meta']['seat_order'].index('Newt')
    A.log(state, {'r': state['meta']['round'], 'act': 'turn', 'seat': 'Newt'})
    state['players'][0]['mana'] = 20
    state['players'][1]['mana'] = 20
    wizard = next(x for x in state['wiz_face'] if x)
    auction = T.start_auction(
        state, 'Newt', wizard, 1,
        # A skipped opener has already incremented ai_turn's general attempt
        # counter, but has not used the separate lost-auction retry.
        resume={'actor': 'Newt', 'attempt': 1, 'bonus': 0},
    )
    T.human_answer(state, auction, 'Keith', '2')
    status, winner = T.auction_run(state, auction)
    check(status == 'done' and winner == 'Keith', 'human wins the AI starter auction')

    before = A.P(state, 'Newt')['mana']
    original_choose = T.AI.choose_action
    original_opening = T.AI.opening_bid
    original_apply = T.SIM.apply_action
    reagent = A.P(state, 'Newt')['tok'][0]
    choices = iter((
        {'type': 'recruit', 'wizard': next(x for x in state['wiz_face'] if x)},
        {'type': 'convert', 'reagent': reagent, 'n': 1},
    ))
    try:
        T.AI.choose_action = lambda view, me: (next(choices), 'test retry action')
        T.AI.opening_bid = lambda *args: 0  # skipped opener; must not consume lost-auction retry
        result = T.after_auction(state, auction, winner, [])
    finally:
        T.AI.choose_action = original_choose
        T.AI.opening_bid = original_opening
        T.SIM.apply_action = original_apply
    check(result == 'human' and state['next'] == 'Keith', 'resumed AI action ends with the human turn')
    check(A.P(state, 'Newt')['mana'] > before, 'skipped opener does not consume the resumed convert action')
    check(any(e.get('act') == 'convert' and e.get('who') == 'Newt' for e in state['meta']['log']),
          'resumed AI action is logged')


def newt_turn(name, mana=40):
    state = fresh(name, ['Keith', 'Newt'])
    state['next'] = 'Newt'
    state['turn'] = state['meta']['seat_order'].index('Newt')
    A.log(state, {'r': state['meta']['round'], 'act': 'turn', 'seat': 'Newt'})
    state['players'][0]['mana'] = mana
    state['players'][1]['mana'] = mana
    return state


def keith_outbids(state, auction):
    """Newt opened `auction`; Keith bids one more, which wins a duel (the starter bids only once)."""
    status, who = T.auction_run(state, auction)
    check(status == 'need' and who == 'Keith', 'the duel auction waits for Keith')
    T.human_answer(state, auction, 'Keith', str(auction['high'] + 1))
    status, winner = T.auction_run(state, auction)
    check(status == 'done' and winner == 'Keith', 'Keith outbids the AI starter')
    return winner


def newt_moves_after(state, n0):
    return [e for e in state['meta']['log'][n0:] if (e.get('who') or e.get('starter')) == 'Newt' and e.get('act') != 'turn']


def test_ai_takes_another_action_after_losing_its_auction():
    """Issue #122: the AI starter is outbid and must keep its turn (rulebook: 'may perform any other action,
    including another Recruitment'). Real AI policy for the follow-up."""
    state = newt_turn('issue-122-one-loss')
    first = T.start_auction(state, 'Newt', next(x for x in state['wiz_face'] if x), 12,
                            resume={'actor': 'Newt', 'attempt': 0, 'bonus': 0})
    winner = keith_outbids(state, first)
    n0 = len(state['meta']['log'])
    result = T.after_auction(state, first, winner, [])
    pending = state['meta'].get('pending')
    acted = newt_moves_after(state, n0)
    check(bool(acted) or (isinstance(pending, dict) and pending.get('starter') == 'Newt'),
          f'Newt acts again after losing its auction ({[e.get("act") for e in acted]}, result {result})')


ISSUE_127 = os.path.join(R, '..', 'tests', 'e2e', 'fixtures', 'issue-127-duel-auctions.json')


def issue127_state(stage, path=ISSUE_127):
    """Keith's issue #127 save (round 18) rewound to a moment of Newt's round-17 turn:
    'start' (before any auction: Keith 51, Newt 34), 'after1' (Keith won Reptilius at 18: Keith 33),
    'after2' (Keith also won Draco at 27: Keith 6, Newt 34, before Newt's summon + dungeon)."""
    s = json.load(open(path)); m = s['meta']; log = m['log']
    newt = [p for p in s['players'] if p['name'] == 'Newt'][0]; keith = [p for p in s['players'] if p['name'] == '13InchesOfFun'][0]
    assert log[75]['act'] == 'summon' and log[76]['act'] == 'dungeon' and log[74]['item'] == 'Draco_Mortemus' and log[73]['item'] == 'Reptilius_Venenum'
    # undo the dungeon (kept 1 Gold + Emeralds go back on top of the deck) and the Troglodytam summon (10 mana)
    newt['gold'] -= 1; newt['treasures'] = [t for t in newt['treasures'] if t.get('name') != 'Emeralds']
    s['dungeon_list'] = [c for c in log[76]['kept']] + s['dungeon_list']; s['dungeon_deck'] = len(s['dungeon_list'])
    trog = [f for f in newt['familiars'] if 'Troglodytam' in f][0]; newt['familiars'].remove(trog); newt['mana'] += 10
    s['fam_list'].insert(0, s['fam_face'][0]); s['fam_face'][0] = trog; s['fam_deck'] = len(s['fam_list'])
    cut = 75
    undo = {'after2': [], 'after1': [74], 'start': [74, 73]}[stage]
    for i in undo:                                    # Keith gives the wizard back; it returns to the face-up offer
        e = log[i]; w = [x for x in reversed(keith['wizards']) if e['item'] in x][0]
        keith['wizards'].remove(w); keith['mana'] += e['price']
        slot = 1 if i == 74 else 0
        s['wiz_list'].insert(0, s['wiz_face'][slot]); s['wiz_face'][slot] = w; s['wiz_deck'] = len(s['wiz_list'])
        cut = i
    m['log'] = log[:cut]; m['round'] = 17; s['next'] = 'Newt'; s['turn'] = m['seat_order'].index('Newt')
    m['pending'] = None; m['web_pending'] = None
    return s


def test_issue_127_recruits_bufonem_for_exactly_6_after_two_losses():
    """Issue #127, round 17: Keith won both of Newt's auctions and has 6 mana left. Newt keeps its turn (no cap on lost
    auctions) and recruits Bufonem Creaturae for exactly 6, which Keith cannot top."""
    state = issue127_state('after2')
    view = AI.public_view(state, 'Newt')
    check(AI.duel_rival_mana(view, 'Newt') == 6, 'the ledger tracks Keith at 6 mana')
    check(AI.opening_bid(view, 'Newt', next(w for w in state['wiz_face'] if 'Bufonem' in w)) == 6, 'Bufonem opens at exactly 6')
    second = {'starter': 'Newt', 'resume': {'actor': 'Newt', 'attempt': 1, 'bonus': 0, 'retried': True}}
    result = T.after_auction(state, second, '13InchesOfFun', [])
    a = state['meta'].get('pending') or {}
    check(result == 'auction' and a.get('starter') == 'Newt' and 'Bufonem' in a.get('card', '') and a.get('high') == 6,
          f"Newt opens Bufonem at exactly 6 after its second lost auction ({result}, {a.get('card')}, {a.get('high')})")
    try:
        T.human_answer(state, a, '13InchesOfFun', '7'); topped = True
    except SystemExit:
        topped = False
    check(not topped, 'Keith cannot top it (7 is more mana than he has)')
    T.human_answer(state, a, '13InchesOfFun', 'pass')
    status, winner = T.auction_run(state, a)
    check(status == 'done' and winner == 'Newt', 'Newt wins Bufonem')
    newt = A.P(state, 'Newt')
    check(newt['mana'] == 28 and any('Bufonem_Creaturae' in w for w in newt['wizards']), f"Newt paid exactly 6 (mana {newt['mana']})")
    result = T.after_auction(state, a, winner, [])
    check(result == 'human' and state['next'] == '13InchesOfFun', 'the won auction ends Newt turn (invariants pass)')
    log = state['meta']['log']; r17 = [e for e in log if e.get('r') == 17 and e.get('act') == 'auction' and e.get('starter') == 'Newt']
    check([e['won'] for e in r17] == ['13InchesOfFun', '13InchesOfFun', 'Newt'], 'round 17: two lost auctions, then the won one, in order')


def test_issue_127_does_not_open_auctions_the_rival_can_top():
    """Start of Newt's round-17 turn (Keith 51, Newt 34): no auction Keith can top. After Keith won Reptilius
    (Keith 33): not Draco at Newt's 26 limit; any auction it opens is at Keith's 33."""
    state = issue127_state('start')
    view = AI.public_view(state, 'Newt')
    check(AI.duel_rival_mana(view, 'Newt') == 51, 'the ledger tracks Keith at 51')
    for w in state['wiz_face']:
        check(AI.opening_bid(view, 'Newt', w) == 0, f'{w.split("/")[-1][7:-4]} is not opened (Keith 51 > Newt 34)')
    act, _ = AI.choose_action(AI.public_view(state, 'Newt'), 'Newt')
    check(act['type'] != 'recruit', f"Newt does something else ({act['type']})")
    state = issue127_state('after1')
    view = AI.public_view(state, 'Newt')
    draco = next(w for w in state['wiz_face'] if 'Draco' in w)
    check(AI.bid_limit(view, 'Newt', draco) < 33 and AI.opening_bid(view, 'Newt', draco) == 0, 'Draco is not opened: Keith (33) could top it')
    act, _ = AI.choose_action(AI.public_view(state, 'Newt'), 'Newt')
    if act['type'] == 'recruit':
        check(AI.opening_bid(view, 'Newt', next(w for w in state['wiz_face'] if act['wizard'] in w)) == 33,
              f"{act['wizard']} opens at Keith's 33, which he cannot top")


def test_human_can_continue_after_repeated_lost_opening_auctions():
    state = fresh('human-repeated-loss', ['Keith', 'Newt'])
    state['next'] = 'Keith'
    state['turn'] = state['meta']['seat_order'].index('Keith')
    A.log(state, {'r': state['meta']['round'], 'act': 'turn', 'seat': 'Keith'})
    first = T.start_auction(state, 'Keith', next(x for x in state['wiz_face'] if x), 1)
    result = T.after_auction(state, first, 'Newt', [])
    check(result == 'human' and state['next'] == 'Keith' and state['meta'].get('again'),
          'first human auction loss preserves the human follow-up action')
    second = T.start_auction(state, 'Keith', next(x for x in state['wiz_face'] if x), 1)
    result = T.after_auction(state, second, 'Newt', [])
    check(result == 'human' and state['next'] == 'Keith',
          'repeated human auction losses still preserve the human turn')


if __name__ == '__main__':
    test_duel_opening_bids_the_rivals_ledger_mana()
    test_ai_starter_gets_one_extra_action_after_human_wins()
    test_ai_takes_another_action_after_losing_its_auction()
    test_issue_127_recruits_bufonem_for_exactly_6_after_two_losses()
    test_issue_127_does_not_open_auctions_the_rival_can_top()
    test_human_can_continue_after_repeated_lost_opening_auctions()
    print('all two-player auction tests passed')
