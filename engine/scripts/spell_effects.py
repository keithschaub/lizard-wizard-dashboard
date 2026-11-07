"""Spell / dungeon / familiar effects for Lizard Wizard (Nov 2, 2026), used by actions.py and ai_sim.py.
Every effect below was coded from the REAL card image text (assets/Spell_*.jpg, Familiar_*.jpg)."""
import os, random
import actions as A
from scoring import school
norm = lambda r: r.replace(' ', '_')

def has_cast(p, key):
    """True if player p has CAST a spell whose image contains key (e.g. 'Mana_Garden')."""
    return any(key in x['img'] and x.get('cast') for x in p.get('spells', []))

def mana_triggers(s, key, who=None):
    """Ongoing '+5 Mana when any player ...' spells: Mana Leak (recruits), Mana Fountain (builds), Energy Circle (summons)."""
    for q in s['players']:
        if has_cast(q, key):
            q['mana'] += 5; A.log(s, {'r': s['meta'].get('round'), 'who': q['name'], 'act': 'trigger', 'spell': key, 'gain': 5, 'by': who})

def familiar_cost(p, fam_img):
    c = A._fam_cards()[os.path.basename(fam_img)]['cost_mana']
    return max(0, c - 5) if has_cast(p, 'Summon_Helper') else c      # Summon Helper: "Summon Familiar for 5 fewer Mana Cost"

def dungeon_treasure_left(s):
    return any(c['type'] == 'Treasure' for c in A.ensure_dungeon(s))

BLOCK = {'Dungeon Denizen': 'Block_Denizens', 'Giant': 'Block_Giant', 'Goblinoid': 'Block_Goblin', 'Undead': 'Block_Undead'}
def dungeon_delve(s, name, cont=None):
    """Rulebook 'Entering the Dungeon': draw from the top; Monster = 1 hit, Treasure = no hit; stop whenever you like.
    A 2nd hit (3rd with Spirit Shield) = defeated, keep nothing. Trap card 'x2 Hits'. Monsters (and on defeat everything
    drawn) are shuffled back. Kept Gold cards give Gold; Items count for the Items majority.
    Spells: Block Denizens/Giant/Goblin/Undead 'do not hit, and instead give you 1 Gold'; Control Undead 'Ignore hits from
    and take any Undead card ...; +3 VP for each'; Spirit Shield 'Ignore one additional hit per Dungeon Expedition';
    Treasure 'Gain 2 Gold each time you enter the Dungeon'. cont(hits, drawn) -> True to draw another card."""
    p = A.P(s, name); deck = A.ensure_dungeon(s)
    assert dungeon_treasure_left(s), 'no treasure left: entering the dungeon is no longer possible'
    limit = 2 + (1 if has_cast(p, 'Spirit_Shield') else 0); hits = 0; drawn = []; bonus = 0; undead = []
    if has_cast(p, 'Spell_Treasure'): p['gold'] = p.get('gold', 0) + 2; bonus += 2
    while deck:
        c = deck.pop(0); drawn.append(c)
        if c['type'] == 'Monster':
            if c.get('monster_type') == 'Undead' and has_cast(p, 'Control_Undead'): undead.append(c)
            elif has_cast(p, BLOCK.get(c.get('monster_type'), '~')): bonus += 1; p['gold'] = p.get('gold', 0) + 1
            else: hits += 1
        elif c['type'] == 'Trap': hits += 2
        if hits >= limit: break
        if not cont or not cont(hits, list(drawn)): break
    ok = hits < limit
    kept = [c for c in drawn if c['type'] == 'Treasure'] if ok else []
    back = [c for c in drawn if c not in kept and not (ok and c in undead)]
    for c in kept:
        if c.get('subtype') == 'Gold': p['gold'] = p.get('gold', 0) + c['gold']
        else: p.setdefault('treasures', []).append(c)
    if ok and undead: p['undead_kept'] = p.get('undead_kept', 0) + len(undead)
    newdeck = deck + back; random.Random(f"{s.get('board_seed')}-delve-{len(s['meta'].get('log', []))}").shuffle(newdeck)
    s['dungeon_list'] = newdeck; s['dungeon_deck'] = len(newdeck)
    out = {'drawn': drawn, 'hits': hits, 'success': ok, 'kept': kept, 'bonus_gold': bonus, 'undead': len(undead) if ok else 0}
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'dungeon', **out})
    return out

def new_research(s, name, choose):
    """Familiar 'New Research': the 4 face-up spells go to the bottom of the spell deck, 4 new are drawn face up, take one
    free (face down, uncast), refill. choose(state) -> key of one of the new face-up four (public once revealed)."""
    old = [x for x in s['spell_face'] if x]; s['spell_list'] += old
    s['spell_face'] = [s['spell_list'].pop(0) if s['spell_list'] else None for _ in range(4)]
    key = choose(s); sp = [x for x in s['spell_face'] if x and key in x][0]; i = s['spell_face'].index(sp)
    A.P(s, name).setdefault('spells', []).append({'img': sp, 'cast': False})
    s['spell_face'][i] = s['spell_list'].pop(0) if s['spell_list'] else None; s['spell_deck'] = len(s['spell_list'])
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'new_research', 'took': os.path.basename(sp), 'cleared': [os.path.basename(x) for x in old]})
    return os.path.basename(sp)

def _recount(s):
    for k, c in [('wiz_list', 'wiz_deck'), ('tow_list', 'tower_deck'), ('fam_list', 'fam_deck'), ('spell_list', 'spell_deck')]: s[c] = len(s[k])
def scry_deck(s, name, deck, choose, cast_free=False):
    """Scry Wizard/Tower/Familiar 'Look at the top 5 cards in the X Deck, and get one for free'; Scribe 'Take and cast one
    of the top 5 Spell Cards for free'. Only the CASTER sees the 5 (they are passed to choose(list) -> card)."""
    L = {'wizards': 'wiz_list', 'towers': 'tow_list', 'familiars': 'fam_list', 'spells': 'spell_list'}[deck]
    top = s[L][:5]
    if not top: return None
    pick = choose(list(top)); s[L].remove(pick); p = A.P(s, name)
    if deck == 'spells': p.setdefault('spells', []).append({'img': pick, 'cast': bool(cast_free)})
    else: p.setdefault(deck, []).append(pick)
    _recount(s); A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'scry_' + deck, 'took': os.path.basename(pick)})
    return pick
def transmute(s, name, reagents):
    """Transmute (Alchemy 1x): 'Transmute any number of Reagents to Gold at a 2:1 ratio'."""
    p = A.P(s, name)
    for r in reagents: p['tok'].remove(norm(r))
    g = len(reagents) // 2; p['gold'] = p.get('gold', 0) + g
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'transmute', 'reagents': reagents, 'gold': g}); return g
def school_count(p, sch, cast_only=False):
    n = sum(1 for c in p.get('wizards', []) + p.get('towers', []) + p.get('familiars', []) if school(c) == sch)
    return n + sum(1 for x in p.get('spells', []) if school(x['img']) == sch and (x.get('cast') or not cast_only))


def powerful_helper_bonus(p, sch, *, include_summoned_familiar=False):
    """Powerful Helper (ongoing): +1 Gold per Wizard and Familiar of the familiar's school when scoring."""
    if not has_cast(p, 'Powerful_Helper'):
        return 0
    n = sum(1 for c in p.get('wizards', []) if school(c) == sch)
    n += sum(1 for c in p.get('familiars', []) if school(c) == sch)
    if include_summoned_familiar:
        n += 1
    return n


def familiar_score_gold(p, sch, *, include_summoned_familiar=True):
    """Total Gold from Summon to Score (base school holdings + Powerful Helper)."""
    n = school_count(p, sch) + (1 if include_summoned_familiar else 0)
    return n + powerful_helper_bonus(p, sch, include_summoned_familiar=include_summoned_familiar)


def secret_society_wizard(s, target, aimed_wiz):
    """Secret Society: negative spells aimed at a wizard hit a random one instead. Returns (actual, redirected)."""
    p = A.P(s, target)
    if not has_cast(p, 'Secret_Society'):
        return aimed_wiz, False
    wzs = p.get('wizards', [])
    if not wzs:
        return aimed_wiz, False
    seed = f"{s.get('board_seed')}-ss-{target}-{len(s.get('meta', {}).get('log', []))}"
    actual = random.Random(seed).choice(wzs)
    return actual, actual != aimed_wiz
def wand_tax(s, name, sch):
    """Wand Tax (Enchantment 1x): 'Gain 2 Gold/ Card of any School of Magic of your choice'.
    Interpreted as cards YOU own of that school (ruling unconfirmed; BGG has an open 'Target/AoE for Wand Tax?' thread)."""
    p = A.P(s, name); g = 2 * school_count(p, sch); p['gold'] = p.get('gold', 0) + g
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'wand_tax', 'school': sch, 'gold': g}); return g
def time_shift(s, name, deck):
    """Time Shift (Enchantment 1x): 'Remove (out of play) the top 5 cards of any deck'."""
    L = {'wizards': 'wiz_list', 'towers': 'tow_list', 'familiars': 'fam_list', 'spells': 'spell_list'}[deck]
    gone = s[L][:5]
    s[L] = s[L][5:]
    s.setdefault('out_of_play', []).extend(gone)
    _recount(s)
    removed = []
    for path in gone:
        base = os.path.basename(str(path))
        removed.append(base[:-4] if base.endswith('.jpg') else base)
    remaining = len(s[L])
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'time_shift', 'deck': deck, 'n': len(gone),
              'removed': removed, 'remaining': remaining})
    return dict(deck=deck, removed=removed, remaining=remaining, n=len(gone))
def energy_pulse(s, name):
    """Energy Pulse (Sorcery 1x): 'Destroy all Spell Shield spell cards currently owned by all players'."""
    n = 0
    for q in s['players']:
        for x in [x for x in q.get('spells', []) if 'Spell_Spell_Shield' in x['img']]:
            q['spells'].remove(x); s.setdefault('out_of_play', []).append(x['img']); n += 1
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'energy_pulse', 'destroyed': n})
def swapo(s, caster, target, mine, theirs, kind):
    """Swapo (Enchantment 1x): 'Trade one of your Wizard or Tower Cards for the same type owned by another player'."""
    if A.shield_blocks(s, target): A.log(s, {'r': s['meta'].get('round'), 'who': caster, 'act': 'swapo_blocked', 'target': target}); return False
    a = A.P(s, caster); t = A.P(s, target); a[kind].remove(mine); t[kind].remove(theirs); a[kind].append(theirs); t[kind].append(mine)
    A.log(s, {'r': s['meta'].get('round'), 'who': caster, 'act': 'swapo', 'target': target, 'gave': mine.split('/')[-1], 'got': theirs.split('/')[-1]}); return True
def energized_convert(s, name, reagent, count):
    """Energize (Druidry ongoing): 'Increase the mana value of a Reagent by 3 before converting' (track +3, cap 12, then sell)."""
    s['tracks'][reagent] = min(12, s['tracks'][reagent] + 3)
    out = A.convert(s, name, reagent, count); s['meta']['log'][-1]['energized'] = True   # lets audit_tracks replay the +3
    return out

def transform_tokens(s, name, steps):
    """Transform (Alchemy ongoing): before converting, turn any 2 held tokens into 1 token of another type (2:1)."""
    p = A.P(s, name)
    if not has_cast(p, 'Transform'): raise ValueError('Transform is not cast')
    if not steps: return []
    applied = []
    for st in steps:
        fr = [norm(r) for r in st.get('from', [])]
        to = norm(st['to'])
        if len(fr) != 2: raise ValueError('each transform needs exactly 2 tokens')
        pool = list(p['tok'])
        for r in fr:
            if r not in pool: raise ValueError(f'{name} lacks {r} for transform')
            pool.remove(r)
        for r in fr: p['tok'].remove(r)
        p['tok'].append(to)
        applied.append({'from': fr, 'to': to})
    A.log(s, {'r': s['meta'].get('round'), 'who': name, 'act': 'transform', 'steps': applied})
    return applied

def invisibility_potion(s, caster, target, x):
    """Invisibility Potion (Alchemy 1x, card read Nov 2 2026): cost 5 Mana + X Eye of Newt;
    'Steal 1 Gold per Eye of Newt used in casting the Spell (from one player)'. Caller has already researched it;
    this pays the X Eyes, marks it cast, and steals min(X, target's Gold). Spell Shield blocks it (negative spell)."""
    a = A.P(s, caster); x = int(x)
    if a['tok'].count('Eye_of_Newt') < x: raise ValueError(f'{caster} needs {x} Eye_of_Newt')
    for _ in range(x): a['tok'].remove('Eye_of_Newt')
    sp = [z for z in a.get('spells', []) if 'Invisibility_Potion' in z['img'] and not z.get('cast')]
    if not sp: raise ValueError('Invisibility Potion not owned uncast')
    sp[0]['cast'] = True
    if A.shield_blocks(s, target):
        A.log(s, {'r': s['meta'].get('round'), 'who': caster, 'act': 'invisibility_potion_blocked', 'target': target, 'x': x}); return 0
    t = A.P(s, target); g = min(x, t.get('gold', 0)); t['gold'] = t.get('gold', 0) - g; a['gold'] = a.get('gold', 0) + g
    A.log(s, {'r': s['meta'].get('round'), 'who': caster, 'act': 'invisibility_potion', 'target': target, 'x': x, 'gold': g}); return g
