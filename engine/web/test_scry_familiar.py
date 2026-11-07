"""Web-glue regression checks for immediate Scry Familiar use."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lw_web as W


def test_human_scry_queues_immediate_use():
    state = {
        'players': [{
            'name': 'Keith', 'gold': 0, 'mana': 20, 'tok': [],
            'wizards': [], 'towers': [], 'familiars': [], 'spells': [],
        }],
        'next': 'Keith',
        'meta': {'humans': ['Keith'], 'round': 1, 'log': [], 'web_pending': None},
    }
    familiar = 'assets/Familiar_10_Imp.jpg'
    W._queue_familiar_use(state, 'Keith', familiar)
    assert state['meta']['web_pending']['type'] == 'rise'
    assert state['meta']['web_pending']['familiar'] == familiar


def test_ai_free_familiar_scores_immediately():
    familiar = 'assets/Familiar_10_Imp.jpg'
    state = {
        'players': [{
            'name': 'Newt', 'gold': 0, 'mana': 20, 'tok': [],
            'wizards': [], 'towers': [], 'familiars': [familiar], 'spells': [],
        }],
        'meta': {'round': 1, 'log': []},
    }
    W._ai_use_free_familiar(state, 'Newt', familiar)
    assert state['players'][0]['gold'] > 0
    assert state['meta']['log'][-1]['free'] is True
    assert state['meta']['log'][-1]['use'] == 'score'


if __name__ == '__main__':
    test_human_scry_queues_immediate_use()
    test_ai_free_familiar_scores_immediately()
    print('OK: Scry Familiar web glue immediate use')
