#!/usr/bin/env python3
"""
Test that the invariant check would catch the round-27 bug.

This loads the buggy save and simulates advancing through round 27
to verify the invariant check fires.
"""

import json
import os
import sys

# Add engine/scripts to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
import turn as T

def test_invariant_catches_bug():
    """Verify the invariant check catches the round-27 four-auctions bug."""
    save_path = '/home/ubuntu/.cursor/projects/agent-repos-lizard-wizard-dashboard/uploads/lizard-wizard-R28-20261107-0207_5a1e.json'
    if not os.path.exists(save_path):
        save_path = os.path.join(os.path.dirname(__file__), '..', '..', 'uploads',
                                  'lizard-wizard-R28-20261107-0207_5a1e.json')
    
    with open(save_path) as f:
        state = json.load(f)
    
    # Find Newt's turn in round 27
    log = state['meta']['log']
    newt_turn_idx = None
    for i, e in enumerate(log):
        if e.get('act') == 'turn' and e.get('seat') == 'Newt' and e.get('r') == 27:
            newt_turn_idx = i
            break
    
    assert newt_turn_idx is not None, "Couldn't find Newt's R27 turn"
    
    # Simulate the state at the END of Newt's turn (after 4 auctions)
    # Find the next turn marker
    next_turn_idx = None
    for i in range(newt_turn_idx + 1, len(log)):
        if log[i].get('act') == 'turn':
            next_turn_idx = i
            break
    
    # Count auctions between these markers
    auctions = [e for e in log[newt_turn_idx+1:next_turn_idx] 
                if e.get('act') == 'auction' and e.get('starter') == 'Newt']
    
    print(f"Found {len(auctions)} auctions started by Newt in R27 turn")
    
    # Now call the invariant check
    state['next'] = 'Newt'
    state['meta']['round'] = 27
    
    try:
        T.check_turn_invariants(state, 'Newt')
        print("✗ FAIL: Invariant check did NOT catch the bug!")
        return False
    except AssertionError as e:
        print(f"✓ PASS: Invariant check caught the bug: {e}")
        return True

if __name__ == '__main__':
    print("=" * 70)
    print("TEST: Invariant Check Catches Round-27 Bug")
    print("=" * 70)
    print()
    
    try:
        success = test_invariant_catches_bug()
        print()
        print("=" * 70)
        if success:
            print("RESULT: Invariant check working correctly")
        else:
            print("RESULT: FAILED - Invariant did not catch the bug")
            sys.exit(1)
        print("=" * 70)
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
