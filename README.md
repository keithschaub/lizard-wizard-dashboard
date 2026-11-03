# 🦎 Lizard Wizard Web App

Phone-first, browser-playable board game running the Python engine via Pyodide. Resumes the paused g8 game with AI opponents.

## Quick Start

**Live Demo:** https://keithschaub.github.io/lizard-wizard-dashboard/ (after merge to Jan18_2025)

**Local Development:**
```bash
# Serve locally (needs http server for Pyodide)
python3 -m http.server 8000
# Open http://localhost:8000
```

## Features

- ✅ **Python Engine in Browser**: Full rules via Pyodide (no JS port)
- ✅ **AI Opponents**: Newt (spellslinger), LizWiz (delver), AI Normal
- ✅ **Phone-First UI**: Touch-optimized dark fantasy theme
- ✅ **Card Database**: Tap any card for full text from carddb.json
- ✅ **Player Mats**: Overlay showing all resources (tap empty board)
- ✅ **Save System**: localStorage + export/import to file
- ✅ **Enhanced Art**: 296 webp card images, optimized for phones
- 🚧 **Gathering UI**: Tap reagents, cast spells, storage management (in progress)
- ⏳ **Dungeon Delve**: Flip cards, hit counter (planned)
- ⏳ **Wizard Auction**: Bidding arena (planned)
- ⏳ **Sound & Haptics**: Effects + vibration (planned)

## Game Rules

See `public/LizardWizard-Rulebook-na.txt` for official rules.

**House Rules:**
- Gold is public (all players visible)
- AI opponent hands and mana are hidden
- Achievements auto-claimed when met

## Technical Stack

- **Frontend**: Vanilla JS, HTML5 Canvas, CSS3
- **Python Engine**: Pyodide 0.24.1
- **CI/CD**: GitHub Actions (tests + Pages deployment)
- **Art**: 296 enhanced webp images (art/)
- **Data**: carddb.json (all card text)

## Project Structure

```
lizard-wizard-web/
├── index.html           # Main app entry
├── app.js              # Pyodide integration + UI logic
├── styles.css          # Phone-first dark theme
├── public/
│   ├── scripts/        # Python engine (30+ files)
│   │   ├── actions.py
│   │   ├── ai_policy.py
│   │   ├── scoring.py
│   │   ├── spell_effects.py
│   │   ├── carddb.py
│   │   ├── turn.py
│   │   └── test_turn_process.py (75 tests)
│   ├── cards/          # Card data JSON files
│   │   └── carddb.json
│   ├── art/            # 296 webp images + backgrounds
│   └── g8_state.json   # Saved game to resume
├── GATHER_MODIFIERS.md # Complete gathering mechanics map
└── .github/workflows/  # CI/CD pipelines
```

## Gathering Mechanics

All spells and wizards affecting gathering are documented in `GATHER_MODIFIERS.md`.

**Key Modifiers:**
- **7 Wizards**: Each +1 bonus reagent when gathering
- **Maximum Gather** (Druidry): Take all 4-5 icons (not just 3)
- **Bloom** (Druidry): +1 any reagent (choose which)
- **Mana Garden** (Druidry): +5 Mana when gathering
- **Storage**: Base 10 + 1 per tower

## Development

**Run Tests:**
```bash
cd public/scripts
python3 test_turn_process.py
```

**CI/CD:**
- Tests run on every push (`.github/workflows/tests.yml`)
- Pages deploy on merge to Jan18_2025 (`.github/workflows/pages.yml`)

**Next Milestones:**
1. ✅ Milestone 1: Engine loaded, tests passing, g8 loaded, gather map
2. 🚧 Milestone 2: Board, tap-to-expand, overlay (in progress)
3. ⏳ Milestone 3: Gathering UI, dungeon, bidding
4. ⏳ Milestone 4: Other actions, AI animation, log, sound/haptics
5. ⏳ Milestone 5: Phone playtesting

## Deployment

**GitHub Pages Setup:**
1. Go to Settings → Pages
2. Source: GitHub Actions
3. Workflow: `.github/workflows/pages.yml`
4. URL: `https://keithschaub.github.io/lizard-wizard-dashboard/`

**SEO Blocking:**
- `robots.txt`: Disallow all crawlers
- `index.html`: noindex meta tag

## License

Private project - not for redistribution.

## Credits

- Game Design: Lizard Wizard board game
- Python Engine: Keith's tested implementation
- Enhanced Art: 296 webp images (art/)
- Web App: Built Nov 2026
