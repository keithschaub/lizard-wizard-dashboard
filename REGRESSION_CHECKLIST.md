# Lizard Wizard regression checklist

Run the relevant Playwright project on both Chromium and `webkit-iphone` where noted; use a real touch gesture starting on the card image.

| Area | Manual check | Automated coverage |
| --- | --- | --- |
| Familiar chooser swipe | Summon, Rise, and Scry familiar views use the shared expand carousel; swipe both directions, verify dots, arrows, and action details update. | `tests/e2e/summon-chooser-swipe.spec.js` |
| Familiar chooser presentation | Summon shows the dynamic gold-bordered mana cost, current/remaining mana, four two-column actions, 16px detail text, and “draw for treasure”; no redundant description panel or instruction copy remains. | `tests/e2e/summon-chooser-swipe.spec.js`, `tests/e2e/familiar-swipe-regression.spec.js` |
| Spell-card swipe | Open Research from the board spell row and swipe between face-up spells; the research action follows the shown card. | `tests/e2e/board-spell-swipe.spec.js` |
| New-game stale board | Start a game with a different human name and confirm Round 1 and the new reagent dock replace the old game without a render exception. | `tests/e2e/new-game-render.spec.js` |
| Restart | Use “Load the paused game g8” and confirm the board, overlays, and shared card carousel still work. | `tests/e2e/familiar-swipe-regression.spec.js` |
| Report Bug upload | Open and close Report Bug, then swipe a card; submit a stubbed multipart report and verify state, metadata, compression, timeout feedback, and success toast. | `tests/e2e/bug-report.spec.js` |
| Report Bug toast/overlay | On iPhone-sized layout, successful submission closes the dialog and leaves the success toast visible above the overlay. | `tests/e2e/bug-report.spec.js` |
| Two-player auction opener | In a two-seat duel the AI starter opens at its limit, the human can outbid, and the AI gets at most one extra action after losing. | Python auction tests in `engine/scripts/test_turn_process.py` |
| Repeated human auction losses | In a two-seat duel, let the human start and lose two wizard auctions; the human receives another action after each loss instead of the turn ending early. | `engine/scripts/test_two_player_auction.py::test_human_can_continue_after_repeated_lost_opening_auctions` |
| Sell banner layout | Sell banners show reagent, count, value, and total without clipping or overlapping controls. | `tests/e2e/banner-log-format.spec.js` |
| Gather banner layout | Gather banners show the gathered reagent details and tracks clearly. | `tests/e2e/banner-log-format.spec.js` |
| Setup button labels | New-game setup action titles and subtitles remain readable and consistent across name, table-size, AI, and reagent steps. | `tests/e2e/game-setup.spec.js` |
| Scribe history | An AI or human Scribe cast logs the selected free spell, resolves its follow-up, and reports an empty deck/no legal option explicitly. | `engine/web/test_lw_web.py` |
| Grand Sorcerer | The setup picker offers the top AI difficulty with “Plays to win from turn one”; existing levels remain unchanged. | `tests/e2e/game-setup.spec.js`, `engine/scripts/test_ai_policy.py` |
| Safari cache busting | A Pages deploy stamps HTML, CSS, module imports, and runtime engine URLs with the build/SHA token; a new tab does not reuse the old module graph. | `tools/test_version_stamp.py` |
| Chronicle reagent icons (#65) | Gather, build, and cast history entries show wrapped named reagent icon chips; gathers combine repeated track increases and distinguish wizard-bonus rings. | `tests/e2e/chronicle-reagent-icons.spec.js`, `engine/web/test_log_format.py` |
| Reagent expanded card (#64) | Expand a reagent from hand, mats, and Chronicle; only the centered card, dots, arrows, and close remain, while spell/familiar info panels stay unchanged. | `tests/e2e/reagent-expand.spec.js` |
| Chronicle school chips and reagent counts | Chronicle card names show school crest pills with tower tier, while reagent lists preserve first order, group duplicates, and reserve aligned count slots. | `tests/e2e/chronicle-reagent-icons.spec.js`, `engine/web/test_log_format.py` |
| Chronicle v4 values and bonus merge | Chronicle merges matching/unmatched bonus reagents into counted chips and renders signed mana/gold as clean number-first CSS-orb chips without changing card art or expanded metadata. | `tests/e2e/chronicle-reagent-icons.spec.js`, `engine/web/test_log_format.py` |
| Chronicle v4 chip finish | Value orbs are crisp and tightly padded, single reagents have no empty count slot, bonus copies merge with normal styling, and auction text is shortened before its school/value chips. | `tests/e2e/chronicle-reagent-icons.spec.js` |
| Chronicle action-line ordering | Build school chips precede “paying”, summon/sell lines use grouped reagent and number-first value chips without duplicate text, and other value-bearing lines contain no word-form mana/gold or parenthesized schools. | `tests/e2e/chronicle-reagent-icons.spec.js`, `engine/web/test_log_format.py` |
| Approved crisp chips on action surfaces | Spell/build/New Research costs, plain AI entries, and structured gather/sell/auction banners use clean number-first mana/gold, grouped reagent counts, and approved school chips without changing familiar swipe/card art. | `tests/e2e/banner-log-format.spec.js`, `tests/e2e/board-spell-swipe.spec.js`, `tests/e2e/summon-chooser-swipe.spec.js` |
| Chronicle gold builds and cast outcomes | Gold-paid builds show the school chip before “paying” and only the negative gold chip; cast/swap outcome prose has inline school chips instead of parenthesized school text. | `tests/e2e/chronicle-reagent-icons.spec.js`, `engine/web/test_log_format.py` |

For every carousel check, also verify X close, scrim close, vertical sheet scrolling, and that tapping an action tile performs the real state change.
