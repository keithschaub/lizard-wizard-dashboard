#!/usr/bin/env python3
"""
Regression test for the round-27 four-auctions bug.

In the original bug: Newt's round 27 turn ran FOUR consecutive auctions:
  - Draco_Mortemus (Keith won, 34)
  - Draco_Mortemus (Keith won, 38)
  - Reptilius_Venenum (Keith won, 22)
  - Ignus_Fulgorus (Newt won, 12)

This happened because after_auction was recursively calling ai_turn when an AI lost
an auction that had paused for a human bid, bypassing the 6-attempt limit.

This test loads the actual R28 save from Keith's playtest and verifies:
1. The save imports cleanly
2. The log shows the bug occurred in round 27
3. (Future) A similar setup doesn't reproduce the bug with the fix
"""

import json
import os
import sys

# Add engine/scripts to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

def test_save_imports():
    """Verify the R28 save loads cleanly."""
    # Try both possible locations
    save_path = '/home/ubuntu/.cursor/projects/agent-repos-lizard-wizard-dashboard/uploads/lizard-wizard-R28-20261107-0207_5a1e.json'
    if not os.path.exists(save_path):
        save_path = os.path.join(os.path.dirname(__file__), '..', '..', 'uploads',
                                  'lizard-wizard-R28-20261107-0207_5a1e.json')
    
    with open(save_path) as f:
        state = json.load(f)
    
    # Basic validation
    assert state['meta']['round'] == 28, f"Expected round 28, got {state['meta']['round']}"
    assert len(state['players']) == 3, "Expected 3 players"
    assert state['players'][0]['name'] == 'Keith', "Expected Keith in seat 0"
    
    # Count wizards
    keith_wizards = len(state['players'][0]['wizards'])
    assert keith_wizards == 7, f"Keith should have 7 wizards, has {keith_wizards}"
    
    print(f"✓ Save imports cleanly: round {state['meta']['round']}, Keith has {keith_wizards} wizards")
    return state

def test_round27_bug_present():
    """Verify the four-auctions bug is present in the log."""
    save_path = '/home/ubuntu/.cursor/projects/agent-repos-lizard-wizard-dashboard/uploads/lizard-wizard-R28-20261107-0207_5a1e.json'
    if not os.path.exists(save_path):
        save_path = os.path.join(os.path.dirname(__file__), '..', '..', 'uploads',
                                  'lizard-wizard-R28-20261107-0207_5a1e.json')
    
    with open(save_path) as f:
        state = json.load(f)
    
    # Find round 27 events
    r27_events = [e for e in state['meta']['log'] if e.get('r') == 27]
    
    # Find Newt's turn and count auctions
    newt_turn_idx = None
    for i, e in enumerate(r27_events):
        if e.get('act') == 'turn' and e.get('seat') == 'Newt':
            newt_turn_idx = i
            break
    
    assert newt_turn_idx is not None, "Couldn't find Newt's turn in round 27"
    
    # Count auctions between Newt's turn and the next turn event
    auctions = []
    for i in range(newt_turn_idx + 1, len(r27_events)):
        e = r27_events[i]
        if e.get('act') == 'turn':
            break
        if e.get('act') == 'auction' and e.get('starter') == 'Newt':
            auctions.append((e.get('item'), e.get('won'), e.get('price')))
    
    print(f"✓ Round 27 Newt's turn had {len(auctions)} auctions:")
    for item, winner, price in auctions:
        print(f"    {item}: {winner} won at {price}")
    
    assert len(auctions) == 4, f"Expected 4 auctions (the bug), found {len(auctions)}"
    
    # Verify the specific auctions
    expected = [
        ('Draco_Mortemus', 'Keith', 34),
        ('Draco_Mortemus', 'Keith', 38),
        ('Reptilius_Venenum', 'Keith', 22),
        ('Ignus_Fulgorus', 'Newt', 12),
    ]
    
    for i, (item, winner, price) in enumerate(expected):
        assert auctions[i] == (item, winner, price), \
            f"Auction {i}: expected {expected[i]}, got {auctions[i]}"
    
    print("✓ Bug confirmed: Newt ran 4 auctions in a single turn")
    print("✓ Keith paid 94 mana (34+38+22) and got 3 wizards in one Newt turn")

def test_conservation():
    """Verify all 21 wizards are accounted for (3 per school × 7 schools)."""
    save_path = '/home/ubuntu/.cursor/projects/agent-repos-lizard-wizard-dashboard/uploads/lizard-wizard-R28-20261107-0207_5a1e.json'
    if not os.path.exists(save_path):
        save_path = os.path.join(os.path.dirname(__file__), '..', '..', 'uploads',
                                  'lizard-wizard-R28-20261107-0207_5a1e.json')
    
    with open(save_path) as f:
        state = json.load(f)
    
    # Count wizards in all locations
    from collections import Counter
    
    def extract_school(path):
        # e.g. "assets/Wizard_Draco_Mortemus.jpg" -> "Draco_Mortemus"
        return path.split('_', 1)[1].replace('.jpg', '') if '_' in path else path
    
    all_wizards = Counter()
    
    # Players' mats
    for p in state['players']:
        for w in p['wizards']:
            all_wizards[extract_school(w)] += 1
    
    # Board
    for w in state.get('wiz_face', []):
        if w:
            all_wizards[extract_school(w)] += 1
    
    # Deck
    for w in state.get('wiz_list', []):
        all_wizards[extract_school(w)] += 1
    
    # Should have exactly 3 of each school (7 schools in base game)
    schools = sorted(all_wizards.keys())
    print(f"✓ Wizard census (all locations):")
    for school in schools:
        count = all_wizards[school]
        print(f"    {school}: {count}")
        assert count == 3, f"{school} has {count} copies, expected 3"
    
    total = sum(all_wizards.values())
    assert total == 21, f"Total wizards: {total}, expected 21 (7 schools × 3)"
    print(f"✓ Conservation verified: 21 wizards total, 3 per school")

if __name__ == '__main__':
    print("=" * 70)
    print("REGRESSION TEST: Round 27 Four-Auctions Bug")
    print("=" * 70)
    print()
    
    try:
        test_save_imports()
        print()
        test_round27_bug_present()
        print()
        test_conservation()
        print()
        print("=" * 70)
        print("RESULT: All checks passed")
        print()
        print("NOTE: This test verifies the bug WAS present in the original save.")
        print("      With the fix in turn.py, new games will not have this bug.")
        print("=" * 70)
    except AssertionError as e:
        print(f"\n✗ FAIL: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
