"""Focused regression test: a free Scry Familiar is used immediately."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spell_effects as SE


def test_scry_familiar_scores_immediately():
    familiar = 'assets/Familiar_10_Imp.jpg'
    state = {
        'board_seed': 7,
        'players': [{
            'name': 'Newt', 'gold': 0, 'mana': 10, 'tok': [],
            'wizards': [], 'towers': [], 'familiars': [], 'spells': [],
        }],
        'fam_list': [familiar],
        'fam_face': [],
        'wiz_list': [], 'tow_list': [], 'spell_list': [],
        'wiz_deck': 0, 'tower_deck': 0, 'spell_deck': 0,
        'meta': {'round': 1, 'log': []},
    }

    picked = SE.scry_deck(state, 'Newt', 'familiars', lambda top: top[0])
    assert picked == familiar
    assert state['players'][0]['familiars'] == [familiar]
    assert state['players'][0]['gold'] == 0

    SE.immediate_familiar_use(state, 'Newt', picked, 'score')
    assert state['players'][0]['gold'] == 1
    assert state['meta']['log'][-1]['use'] == 'score'
    assert state['meta']['log'][-1]['free'] is True


if __name__ == '__main__':
    test_scry_familiar_scores_immediately()
    print('OK: Scry Familiar immediate use')
