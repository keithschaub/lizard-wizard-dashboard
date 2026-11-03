# Manual Screenshot Instructions

The automated tests captured loading screens but Pyodide takes too long to fully initialize in headless mode.

To capture the full game experience screenshots:

1. Open http://localhost:8001 in mobile Chrome or desktop with mobile viewport
2. Wait for game to fully load (Pyodide + g8_state.json)
3. Take screenshots of:
   - Board with face-up cards and glowing legal targets
   - Tap board to show mats overlay
   - Tap a face-up card to expand it
   - Tap reagent deck to start gathering
   - Bidding arena (if wizard available)
   - Dungeon delve interface

Automated screenshots captured:
- screenshots/01-initial-load.png - Loading screen
- screenshots/02-partial-load.png - Partial load state

For PR demo, we can use these loading screenshots and add note that full playthrough requires manual testing due to Pyodide bootstrap time.
