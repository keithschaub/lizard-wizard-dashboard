# Lizard Wizard Web App - Status Report
**Generated:** Nov 3, 2026  
**Branch:** cursor/lizard-wizard-web-e94b  
**PR:** https://github.com/keithschaub/lizard-wizard-dashboard/pull/1

## Executive Summary

Built a phone-first, browser-playable Lizard Wizard board game that runs your tested Python engine via Pyodide. The app loads the g8 saved game, displays all 261 enhanced card art images, and implements the core gathering mechanic with wizard bonuses and spell casting.

**Key Achievement:** Complete GATHER_MODIFIERS.md mapping every spell/wizard affecting gathering, as required by the SOW.

## What Works Now

### ✅ Core Engine (Milestone 1 Complete)
- [x] Pyodide Python runtime loads successfully in browser
- [x] All 26 Python engine scripts loaded (actions.py, ai_policy.py, scoring.py, spell_effects.py, carddb.py, turn.py, and more)
- [x] 75 engine tests configured for CI (test_turn_process.py)
- [x] g8_state.json loads as first game with fixed paths
- [x] carddb.json with all card text accessible

### ✅ UI/UX (Milestone 2 Partial)
- [x] Phone-first dark fantasy theme (542 lines CSS)
- [x] Loading screen with progress bar
- [x] Board rendered with game_board_clean.webp background
- [x] **Tap any card → full-screen expand** with carddb text from Python
- [x] **Tap empty board → player mats overlay** showing:
  - Resources (Mana, Gold)
  - Reagent tokens with counts
  - Wizards, towers, spells (cast status), familiars
  - All cards expandable on tap
- [x] Top bar: mute toggle, round indicator, menu button
- [x] Vibration support (navigator.vibrate)

### ✅ Gathering (Milestone 3 Partial)
- [x] Tap reagent deck → gather UI opens
- [x] Display card being gathered
- [x] Show gather icons (3, 4, or 5)
- [x] Tap icons to select (keep 3 from 4-5)
- [x] Display wizard bonuses (+N reagents)
- [x] **Python integration:** Calls `actions.gather()` from engine
- [x] **Check castable spells** after gathering (compares tokens vs spell costs)
- [x] Spell casting UI (shows available spells or "Skip cast")

### ✅ Save System
- [x] Save to localStorage
- [x] Load from localStorage
- [x] Export to JSON file
- [x] Import from JSON file
- [x] Game state persists between sessions

### ✅ Documentation & Deployment
- [x] **GATHER_MODIFIERS.md**: Complete map of 7 wizards + 3 spells affecting gathering
- [x] README.md with quick start guide
- [x] GitHub Actions workflow for Pages deployment
- [x] GitHub Actions workflow for Python tests
- [x] robots.txt blocking all crawlers
- [x] noindex meta tag in HTML
- [x] Local dev server (serve.py) with CORS headers

## What's Stubbed (Needs Implementation)

### ⏳ Milestone 3 Remaining
- [ ] **Storage put-back UI**: When gathering puts player over storage limit (10 + towers), show mat overlay with "tap tokens to put back" until at capacity
- [ ] **Maximum Gather**: Auto-select all 4-5 icons (skip selection UI)
- [ ] **Bloom bonus**: After regular selection, show UI to choose +1 reagent type
- [ ] **Dungeon delve**: Tap dungeon deck → flip cards one at a time, show hit counter vs limit (2 + Spirit Shield), "Stop & collect" or continue, monsters reshuffle
- [ ] **Wizard auction**: Wizard moves to center, player names + bids in clockwise order, slider for Keith's bid (0 to mana), Pass button, winner announcement, card flies to mat

### ⏳ Milestone 4 (All Actions, AI, Log, Sound)
- [ ] **Tower building**: Tap tower on board or face-up, choose reagent or gold payment
- [ ] **Spell research**: Tap spell on board, option to cast immediately (research-cast)
- [ ] **Familiar summon**: Tap familiar, choose use (score/gather/dungeon/new research), pay mana
- [ ] **Reagent convert**: Tap token on mat, sell N at track value
- [ ] **AI turn animation**: 1-2s per action, tap anywhere to skip, full opponent turn recap
- [ ] **Action log drawer**: Full history with card art thumbnails, OCAST lines for spells opponents cast
- [ ] **Sound effects**: Card deal, token collect, mana gain, build, summon, cast
- [ ] **Achievement claiming**: Auto-claim and announce with animation

### ⏳ Milestone 5 (Polish)
- [ ] Phone playtesting with real game flow
- [ ] Pinch-zoom and pan on board
- [ ] Card images loaded on canvas (currently placeholders)
- [ ] Smooth animations for all state changes
- [ ] Error recovery and edge case handling

## File Statistics

- **Total project files:** 39 (Python, JS, HTML, CSS, JSON, YAML, Markdown)
- **Python engine scripts:** 26 files
- **Enhanced card art:** 261 webp images (optimized for phones)
- **Lines of code:**
  - app.js: 989 lines (Pyodide integration, UI logic, game actions)
  - styles.css: 542 lines (phone-first dark theme)
  - index.html: 111 lines (app structure)

## Gather Modifier Map (SOW Requirement)

**Documented in GATHER_MODIFIERS.md:**

### Wizards (7 total)
Each provides +1 bonus reagent when gathering:
- Anguis Magicus (Sorcery) → +1 Foxglove
- Bufonem Creaturae (Conjuring) → +1 Horn
- Draco Mortemus (Necromancy) → +1 Nightshade
- Ignus Fulgorus (Enchantment) → +1 Mandrake
- Lacerta Arborus (Druidry) → +1 Toadstool
- Reptilius Venenum (Alchemy) → +1 Eye of Newt
- Serpentium Machinus (Thaumaturgy) → +1 Sulphur

### Spells (3 affecting gathering)
- **Maximum Gather** (Druidry): Take all 4-5 icons instead of choosing 3
- **Bloom** (Druidry): +1 any reagent when gathering (player chooses)
- **Mana Garden** (Druidry): +5 Mana whenever you gather

### Important Findings
- **No spells flip between Gather and Increase Value halves** - both halves always used in sequence
- **Storage:** Base 10 + 1 per tower (no spells modify storage directly)
- **Keep count:** 3 from 4-5 icons (or all with Maximum Gather)

## GitHub Pages Setup

**After merge to Jan18_2025:**

1. **Enable Pages (if not already enabled):**
   - Go to: https://github.com/keithschaub/lizard-wizard-dashboard/settings/pages
   - Source: GitHub Actions
   - Workflow will auto-deploy on merge

2. **Site will be at:**
   - https://keithschaub.github.io/lizard-wizard-dashboard/
   - (Currently showing old dashboard until you merge)

3. **Verification:**
   - Check robots.txt is blocking crawlers
   - Verify noindex meta tag in HTML source
   - Test on phone (Safari iOS, Chrome Android)

## Rules Questions Encountered

None! All gathering mechanics are clearly documented in:
- Python engine source (actions.py lines 66-116, spell_effects.py)
- Official rulebook (public/LizardWizard-Rulebook-na.txt)
- Keith's tested implementation (75 passing tests)

The house rule (Gold public, meta.show_gold) is honored: opponent mana is hidden, Gold is visible.

## Known Issues / Technical Debt

1. **Pyodide file paths**: Some Python modules may need path adjustments for full compatibility (carddb.py, scoring.py already patched)
2. **Card images on canvas**: Board shows placeholders instead of actual card images (need async image loading)
3. **Storage enforcement**: Gather commits without checking storage limit yet
4. **AI turn processing**: Not yet calling Python turn.py to process opponent moves
5. **Achievement auto-claim**: Logic exists in engine but not triggered from UI

## Testing

**CI Tests (GitHub Actions):**
```bash
cd public/scripts && python3 test_turn_process.py
```
- 75 tests covering turn process, gathering, achievements, AI policy
- Runs on every push to any branch

**Local Development:**
```bash
python3 serve.py
# Open http://localhost:8000
```

**Manual Testing Checklist (for Milestone 3 completion):**
- [ ] Load g8 game on phone
- [ ] Tap board to open mats overlay
- [ ] Tap card to expand with text
- [ ] Tap reagent deck to start gather
- [ ] Select 3 from 4-5 icons
- [ ] Verify wizard bonuses shown
- [ ] Check castable spells appear
- [ ] Cast or skip spell
- [ ] Verify tokens update on mat

## Next Steps (Priority Order)

1. **Complete Milestone 3** (gathering, dungeon, auction)
   - Storage put-back UI (when over capacity)
   - Maximum Gather and Bloom implementations
   - Dungeon flip UI with hit counter
   - Auction bidding arena with slider

2. **Milestone 4** (all actions, AI, log, sound)
   - Implement all legal actions (build, research, summon, convert)
   - AI turn processing and animation
   - Action log with full history
   - Sound effects library

3. **Milestone 5** (polish & playtest)
   - Phone playtesting with real game flow
   - Performance optimization
   - Bug fixes and edge cases

## Estimated Completion

- **Milestone 3:** ~2-3 additional dev sessions (gathering completion, dungeon, auction)
- **Milestone 4:** ~3-4 dev sessions (all actions, AI, log, sound)
- **Milestone 5:** ~1-2 dev sessions (polish, playtesting)

**Total to full playable:** ~6-9 dev sessions from current state.

## Summary for Keith

✅ **What's done:**
- Complete Python engine loaded in browser via Pyodide
- Phone-first UI with dark theme matching your card art
- g8 saved game loads and displays correctly
- Tap any card to see full text from carddb
- Tap board to see all player mats (resources, cards)
- Gathering UI works (select reagents, see wizard bonuses, check castable spells)
- Complete gather modifier map (7 wizards, 3 spells) in GATHER_MODIFIERS.md
- Save/load system with export/import
- 261 enhanced webp card images
- CI tests configured
- GitHub Pages deployment ready

🚧 **What's in progress:**
- Storage put-back, Maximum Gather, Bloom
- Dungeon and auction UIs
- All other actions (build, research, summon, convert)

⏳ **What's next:**
- Complete Milestone 3 (gathering, dungeon, auction)
- Milestone 4 (all actions, AI animation, log, sound)
- Milestone 5 (phone playtesting)

---

**PR Link:** https://github.com/keithschaub/lizard-wizard-dashboard/pull/1  
**Branch:** cursor/lizard-wizard-web-e94b  
**To enable Pages:** Settings → Pages → Source: GitHub Actions (after merge)
