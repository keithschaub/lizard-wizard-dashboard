# Lizard Wizard - Gathering Modifier Map

This document maps every spell and wizard that affects gathering mechanics (keep count, bonus reagents, or the Gather/Increase Value halves) for implementation in the web app.

## 1. Wizards with Gathering Bonuses

Each wizard provides +1 bonus reagent of their school's associated reagent type whenever the player gathers:

| Wizard Name | School | Bonus Reagent |
|------------|---------|---------------|
| Anguis Magicus | Sorcery | +1 Foxglove |
| Bufonem Creaturae | Conjuring | +1 Horn |
| Draco Mortemus | Necromancy | +1 Nightshade |
| Ignus Fulgorus | Enchantment | +1 Mandrake |
| Lacerta Arborus | Druidry | +1 Toadstool |
| Reptilius Venenum | Alchemy | +1 Eye of Newt |
| Serpentium Machinus | Thaumaturgy | +1 Sulphur |

**Implementation:** When gathering, count the player's wizards and add bonus[i] to the tokens gained (after the keep selection).

## 2. Spells Affecting Gathering

### Maximum Gather (Druidry)
- **Effect:** "Gather all Reagents shown on the top half"
- **Normal behavior:** Choose 3 reagents from 4-5 icons
- **With Maximum Gather:** Take ALL icons shown (4 or 5), no choice needed
- **Implementation:** If player has cast Maximum Gather, skip the keep selection UI and gather all icons

### Bloom (Druidry)
- **Effect:** "+1 any Reagent when Gathering"
- **Implementation:** After keep selection, show a UI to choose which reagent type for the bonus token

### Mana Garden (Druidry)
- **Effect:** "+5 Mana whenever you Gather Reagents"
- **Implementation:** When gather action completes, add 5 mana if player has cast Mana Garden

## 3. Storage Mechanics

**Base storage capacity:** 10 + 1 per Tower owned

**Spell modifier:**
- **Root Cellar (Druidry):** "Store +10 Reagents" - adds +10 to storage capacity when cast
- **Calculation:** 10 (base) + towers + (10 * Root Cellar casts)

**Over-storage handling:** When gathering would put the player over storage:
1. First, check if a castable spell can be cast (its cost is deducted BEFORE storage check)
2. If still over, show the mat overlay with "tap tokens to put back" UI
3. Auto-commit when the player is at exactly storage capacity

## 4. Reagent Card Distribution

56 total Reagent cards with gathering icons:

- **21 cards:** 3 gather / 3 increase icons (choose all 3, simplest case)
- **13 cards:** 4 gather / 3 increase icons (choose 3 from 4)
- **15 cards:** 4 gather / 4 increase icons (choose 3 from 4)
- **7 cards:** 5 gather / 4 increase icons (choose 3 from 5)

## 5. Gather vs Increase Value Mechanics

**Two halves of every Reagent card:**
- **Red half (top):** "GATHER REAGENTS" - icons show which tokens to collect
- **Blue half (bottom):** "INCREASE VALUE" - icons show which tracks to raise by +1 (cap 12)

**Normal behavior:** The player uses BOTH halves in sequence:
1. Gather phase: Take 3 (or keep count) tokens from the Gather icons
2. After gathering: Raise tracks shown in Increase Value icons by +1 each (automatic)

### ⚠️ MIRACLE SPELL EXCEPTION

**Miracle (Thaumaturgy):**
- **Effect:** "Reverse the Reagents on the Gather and Increase Value sides of your Gather Reagent Card that you play if you choose to"
- **When cast:** Player chooses whether to reverse the halves
- **If reversed:** Gather icons come from the bottom half, Increase Value icons from the top half
- **Implementation:** Before showing gather UI, check if player has cast Miracle and wants to reverse

## 6. Castable Spells During Gathering

**Rulebook rule:** "You may cast ONE spell if you have the reagents" as part of every Gather action.

**Implementation flow:**
1. Player selects which reagents to keep (if 4-5 icons)
2. Add wizard bonuses
3. Calculate: current tokens + just-gathered tokens
4. Highlight any owned uncast spells whose cost ≤ available tokens
5. Player taps a spell to cast (show full card text) or "Skip cast"
6. If spell cast, deduct its cost from tokens BEFORE storage check
7. If still over storage, show put-back UI
8. Commit: card discards, new card deals, tracks update, tokens stored

## 7. Edge Cases

### Maximum Gather + Bloom
- Player gets all 4-5 icons + Bloom's +1 choice = 5-6 total tokens (before wizards)

### Multiple Wizard Bonuses
- Bonuses stack: 3 wizards = +3 tokens (one per wizard's reagent type)

### Cast Spell + Storage Limit
- Cast cost is paid FIRST, then storage is checked
- Example: 12/13 storage, gather 4, cast spell costing 2 = 14 tokens, then pay 2 = 12/13 (legal)

## 8. UI Highlights for Gathering

**Legal actions glow with gold border:**
- Reagent card in hand (when it's gather phase)
- Each icon that can be selected (up to keep count)
- Castable spells (when holdings include just-gathered reagents)

**Keep counter shows:**
- "Keep 3" (normal)
- "Keep 4" (Maximum Gather with 4-icon card)
- "Keep 5" (Maximum Gather with 5-icon card)

**Never show a 6-option limit** - if there are 5 icons, all 5 must be presented as tappable options (or all selected automatically with Maximum Gather).

---

## 9. Complete Verification Against carddb.json

**Verification Date:** Nov 3, 2026 4:23 PM UTC  
**Method:** Checked every card's effect text in public/cards/carddb.json

### Wizards Verified (7 total)
All 7 wizards checked, each has `gather_bonus` field and effect text "+1 [Reagent] whenever you Gather":

1. **Anguis Magicus** (Sorcery): gather_bonus="Foxglove", effect="+1 Foxglove whenever you Gather"
2. **Bufonem Creaturae** (Conjuring): gather_bonus="Horn", effect="+1 Horn whenever you Gather"
3. **Draco Mortemus** (Necromancy): gather_bonus="Nightshade", effect="+1 Nightshade whenever you Gather"
4. **Ignus Fulgorus** (Enchantment): gather_bonus="Mandrake", effect="+1 Mandrake whenever you Gather"
5. **Lacerta Arborus** (Druidry): gather_bonus="Toadstool", effect="+1 Toadstool whenever you Gather"
6. **Reptilius Venenum** (Alchemy): gather_bonus="Eye_of_Newt", effect="+1 Eye of Newt whenever you Gather"
7. **Serpentium Machinus** (Thaumaturgy): gather_bonus="Sulphur", effect="+1 Sulphur whenever you Gather"

### Spells Affecting Gathering (5 total)

1. **Maximum Gather** (Druidry): "Gather all Reagents shown on the top half of the Gather Reagents Card"
   - Effect: Take all 4-5 icons instead of choosing 3

2. **Bloom** (Druidry): "+1 any Reagent when Gathering"
   - Effect: Player chooses which reagent type for +1 bonus

3. **Mana Garden** (Druidry): "+5 Mana whenever you Gather Reagents"
   - Effect: Automatic +5 mana on every gather action

4. **Miracle** (Thaumaturgy): "Reverse the Reagents on the Gather and Increase Value sides of your Gather Reagent Card that you play if you choose to"
   - Effect: Optional reversal of card halves (gather from bottom, increase from top)

5. **Root Cellar** (Druidry): "Store +10 Reagents"
   - Effect: +10 storage capacity (affects over-storage check)

### Other Reagent-Related Spells (not affecting gathering directly)

- **Adept Conversion** (Druidry): "May convert 2 types of Reagents" (affects conversion, not gathering)
- **Energize** (Druidry): "Increase the mana value of a Reagent by 3 before converting" (affects conversion)
- **Perfect Reagent** (Thaumaturgy): "Build Towers for 1 fewer Reagent" (affects building)
- **Transform** (Alchemy): "Transform any Reagent to another Reagent at 2:1 ratio before Converting to Mana"
- **Transmute** (Alchemy): "Transmute any number of Reagents to Gold at a 2:1 ratio"
- **Scry Dungeon** (Sorcery): "Look at the top 10 cards in the Dungeon deck, and keep all Treasure Cards" (dungeon only)

### Towers
All towers add +1 storage. No towers modify gathering mechanics directly.

### Familiars
No familiars modify keep count or gathering mechanics. Some familiars have a "gather" use option (collect reagents from their card).

### Summary of Keep Count Modifiers
- **Base:** 3 reagents (from 3-5 icons on card)
- **With Maximum Gather cast:** All icons (4-5) taken, no selection needed
- **No other spells or cards change the keep count**

### Summary of Half-Switching Modifiers
- **Base:** Use top half (Gather) for collection, bottom half (Increase Value) for tracks
- **With Miracle cast (if player chooses):** Reversed - bottom for collection, top for tracks
- **No other spells or cards reverse or switch halves**

---

**Generated:** Nov 3, 2026  
**Source:** Python engine analysis + carddb.json verification  
**Status:** Complete and verified for Milestone 1-4 implementation
