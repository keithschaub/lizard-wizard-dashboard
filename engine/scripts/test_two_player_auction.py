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


def test_opening_bid_uses_full_limit_only_in_duel():
    duel = fresh('duel-opening', ['Keith', 'Newt'])
    duel['players'][1]['mana'] = 50
    card = next(x for x in duel['wiz_face'] if x)
    view = AI.public_view(duel, 'Newt')
    limit = AI.bid_limit(view, 'Newt', card)
    check(limit > 1, f'duel fixture has a meaningful bid limit ({limit})')
    check(AI.opening_bid(view, 'Newt', card) == limit, f'2-player opener bids limit {limit}, not 1')
    duel['players'][1]['mana'] = 5
    poor_view = AI.public_view(duel, 'Newt')
    choices, *_ = AI._candidates(poor_view, 'Newt')
    check(not any(action.get('type') == 'recruit' for _, _, _, action, _ in choices),
          '2-player AI does not open a wizard it cannot win')

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


def test_second_lost_auction_is_capped():
    state = fresh('duel-cap', ['Keith', 'Newt'])
    state['next'] = 'Newt'
    state['turn'] = state['meta']['seat_order'].index('Newt')
    A.log(state, {'r': state['meta']['round'], 'act': 'turn', 'seat': 'Newt'})
    # These are the initial lost auction and the one permitted retry.
    for i in range(2):
        A.log(state, {'r': state['meta']['round'], 'act': 'auction', 'starter': 'Newt',
                      'item': f'wizard-{i}', 'won': 'Keith'})
    original_choose = T.AI.choose_action
    try:
        T.AI.choose_action = lambda *_: (_ for _ in ()).throw(AssertionError('third auction attempted'))
        result = T.after_auction(
            state,
            {'starter': 'Newt', 'resume': {'actor': 'Newt', 'attempt': 1, 'bonus': 0, 'retried': True}},
            'Keith',
            [],
        )
    finally:
        T.AI.choose_action = original_choose
    check(result == 'human' and state['next'] == 'Keith', 'second lost auction ends the AI turn')

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
    test_opening_bid_uses_full_limit_only_in_duel()
    test_ai_starter_gets_one_extra_action_after_human_wins()
    test_second_lost_auction_is_capped()
    test_human_can_continue_after_repeated_lost_opening_auctions()
    print('all two-player auction tests passed')
