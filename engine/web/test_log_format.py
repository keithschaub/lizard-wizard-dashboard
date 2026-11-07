"""Every engine log action must produce human-readable banner text."""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
import lw_web


ACTS = (
    'turn setup_picks game_over game_end_triggered gather convert convert1 transform build research cast '
    'auction auction_nobid flame_bolt flame_bolt_blocked charm charm_blocked disintegrate disintegrate_blocked '
    'earthquake earthquake_blocked mana_drain mana_drain_blocked shield_used summon achievement scry_dungeon '
    'scry_wizards scry_towers scry_familiars scry_spells new_research reshuffle_reagents swapo swapo_blocked '
    'creation dungeon wand_tax transmute time_shift energy_pulse invisibility_potion invisibility_potion_blocked '
    'trigger trap_spell obscure obscure_blocked obscure_dungeon demonic_possession demonic_possession_blocked '
    'evolve rise crystal_ball_refill web_note'
).split()


def test_all_log_actions_are_humanized():
    fields = {
        'card': 'Tower_T1_Ivory_Spire.jpg', 'tower': 'Tower_T1_Ivory_Spire.jpg',
        'spell': 'Spell_Trap.jpg', 'familiar': 'Familiar_10_Imp.jpg',
        'wizard': 'Wizard_Draco_Mortemus.jpg', 'took': 'Familiar_10_Imp.jpg',
        'gave': 'Wizard_Draco_Mortemus.jpg', 'got': 'Wizard_Lacerta_Arborus.jpg',
        'target': 'LizWiz', 'deck': 'familiars', 'use': 'score', 'school': 'Alchemy',
        'tile': '7 Familiars',
        'r': 10, 'n': 1, 'gold': 1, 'gain': 1, 'value': 1, 'track_after': 1,
        'cost': 5, 'price': 1, 'item': 'Draco_Mortemus', 'starter': 'Newt',
        'paid': 'gold', 'cast_paid': [], 'got': ['Horn'], 'bonus': [], 'inc': [],
        'reagent': 'Horn',
        'reagents': ['Horn', 'Horn'], 'removed': [], 'drawn': [], 'kept': [],
        'success': True, 'hits': 0, 'destroyed': 0, 'steps': [], 'bids_tail': [],
        'supplies': {}, 'text': 'Newt did something',
        'who': 'Newt', 'seat': 'Newt', 'won': 'Newt', 'act': 'event',
    }
    for act in ACTS:
        entry = dict(fields, act=act)
        text = lw_web.log_text(entry)
        assert isinstance(text, str) and text.strip(), act
        assert '{' not in text and '"act"' not in text, (act, text)


def test_log_text_does_not_expose_numbered_card_ids():
    gather = {
        'act': 'gather', 'who': 'Newt', 'card': 'Reagent_23.jpg',
        'got': ['Sulphur', 'Mandrake', 'Horn'], 'bonus': ['Sulphur'],
        'inc': ['Eye_of_Newt', 'Foxglove', 'Horn', 'Mandrake'],
    }
    text = lw_web.log_text(gather)
    assert text == 'Newt gathered Sulphur, Mandrake, Horn + wizard bonus Sulphur; tracks up: Eye of Newt, Foxglove, Horn, Mandrake'
    for kind in ('Reagent', 'Tower', 'Wizard', 'Familiar', 'Spell'):
        assert re.search(rf'\b{kind} \d+\b', lw_web.log_text({
            'act': 'web_note', 'text': f'{kind} 12 appeared',
        })) is None


def test_gather_banner_data_preserves_reagents_bonus_and_tracks():
    entry = {
        'act': 'gather',
        'got': ['Sulphur', 'Mandrake', 'Horn'],
        'bonus': ['Sulphur'],
        'inc': ['Eye_of_Newt', 'Foxglove', 'Horn', 'Mandrake'],
    }
    assert lw_web.gather_banner_data(entry) == {
        'reagents': ['Sulphur', 'Mandrake', 'Horn'],
        'bonus': ['Sulphur'],
        'tracks': ['Eye_of_Newt', 'Foxglove', 'Horn', 'Mandrake'],
    }


if __name__ == '__main__':
    test_all_log_actions_are_humanized()
    print(f'OK: {len(ACTS)} log actions humanized')
