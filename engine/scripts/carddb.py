"""Fast card metadata lookup for Lizard Wizard (Nov 2, 2026).
ONE source for every card: cards/carddb.json (built by build_carddb.py from Keith's transcribed JSON).
Keys are asset basenames exactly as the game state stores them ('Spell_Flame_Bolt_S.jpg', 'Wizard_Anguis_Magicus.jpg',
'Tower_T4_Azure_Tower.jpg', 'Reagent_44.jpg', 'Familiar_5_Imp.jpg', 'Dungeon_Ring.jpg') plus 'Achievement:<text>'.
Any path form works ('assets/X.jpg', '/workspace/.../X.jpg', 'X'). Loaded once per process; rebuilt automatically
if a source JSON is newer than carddb.json.

    import carddb as CD
    CD.school('assets/Wizard_Anguis_Magicus.jpg')   -> 'Necromancy'
    CD.display('Spell_Flame_Bolt_S.jpg')             -> 'Flame Bolt (Sorcery)'
    CD.cast_cost('Spell_Spell_Shield_A.jpg')         -> ['Eye_of_Newt', 'Eye_of_Newt']
    CD.tower_info('Tower_T4_Azure_Tower.jpg')        -> (4, 'Foxglove', 'Sorcery')
    CD.reagent_icons(44)                             -> (gather_list, increase_list)
    python3 scripts/carddb.py [validate|show KEY]
"""
import json, os
_R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PATH = os.path.join(_R, 'cards', 'carddb.json')
_SRC = ['spells_from_pc.json', 'cards.json', 'reagent_cards.json', 'other_cards_from_pc.json', 'dungeon_cards.json']
_DB = None
SCHOOLS = ['Alchemy', 'Conjuring', 'Druidry', 'Enchantment', 'Necromancy', 'Sorcery', 'Thaumaturgy']

def _stale():
    if not os.path.exists(PATH): return True
    t = os.path.getmtime(PATH)
    return any(os.path.getmtime(os.path.join(_R, 'cards', f)) > t for f in _SRC)
def _load():
    global _DB
    if _DB is None:
        if _stale():
            import build_carddb as B
            out = B.build(); json.dump(out, open(PATH + '.tmp', 'w'), indent=1, sort_keys=True); os.replace(PATH + '.tmp', PATH)
        _DB = json.load(open(PATH))
    return _DB
def reload():
    global _DB; _DB = None; return _load()

def key(path):
    if path is None: return None
    if isinstance(path, int): return 'Reagent_%02d.jpg' % path
    s = str(path)
    if s.startswith('Achievement:'): return s
    b = os.path.basename(s)
    if b.isdigit(): return 'Reagent_%02d.jpg' % int(b)
    if not b.endswith('.jpg'): b += '.jpg'
    if not b.startswith(('Spell_', 'Wizard_', 'Tower_', 'Familiar_', 'Reagent_', 'Dungeon_')):
        d = _load()['cards']
        for pre in ('Spell_', 'Wizard_', 'Dungeon_'):
            if pre + b in d: return pre + b
    return _load()['aliases'].get(b, b)
def get(path):
    """Full metadata dict for a card (None if unknown). Achievement text ('x7 Horn') also works."""
    d = _load()['cards']; k = key(path)
    if k in d: return d[k]
    return d.get('Achievement:' + str(path))
def cards(deck=None):
    return [c for c in _load()['cards'].values() if deck is None or c['deck'] == deck]
def school(path):
    c = get(path); return c.get('school') if c else None
def name(path):
    c = get(path); return c['name'] if c else os.path.basename(str(path))
def display(path):
    """'Name (School)' for chat/widget text (towers include the tier, familiars their mana cost)."""
    c = get(path); return c['display'] if c else os.path.basename(str(path))
def school_reagent(school_name): return _load()['school_reagent_map'].get(school_name)
def reagent_school(reagent): return _load()['reagent_school'].get(str(reagent).replace(' ', '_'))
def cost(path):
    c = get(path); return c.get('cost') if c else None
def cast_cost(path):
    """Spell reagent cost as a token list (game form, e.g. 'Eye_of_Newt'); None for variable (X) costs."""
    c = get(path)
    if not c or c['deck'] != 'Spell': raise KeyError(f'not a spell: {path}')
    if c['cost']['variable']: return None
    return [r for r, n in c['cost']['reagents'].items() for _ in range(int(n))]
def duration(path):
    c = get(path); return c.get('duration') if c else None
def is_negative(path):
    c = get(path); return bool(c and c.get('negative'))
def tower_info(path):
    """(tier, reagent token, school) for a tower card."""
    c = get(path); return c['cost']['tier'], c['cost']['reagent'], c['school']
def wizard_bonus(path):
    c = get(path); return c.get('gather_bonus') if c else None
def familiar(path): return get(path)
def reagent_icons(card):
    """(gather icons, increase icons) in print order for a Reagent card given as 44, '44', 'Reagent_44' or a path."""
    c = get(card); return list(c['gather_icons']), list(c['increase_icons'])

def validate():
    """Every card asset used by the game must resolve with a school (if it has one) and a cost (if it has one).
    Also spot-checks values Keith verified from the real cards and compares with the legacy scoring.py school table."""
    db = _load(); C = db['cards']; A = os.path.join(_R, 'assets')
    missing, unresolved, legacy = [], [], []
    for f in sorted(os.listdir(A)):
        if not f.endswith('.jpg') or not f.startswith(('Spell_', 'Wizard_', 'Tower_', 'Familiar_', 'Reagent_', 'Dungeon_')): continue
        if f in db['aliases']: legacy.append(f'{f} -> {db["aliases"][f]} (legacy image, not dealt)'); continue
        c = C.get(f)
        if not c: unresolved.append(f); continue
        dk = c['deck']
        if dk in ('Spell', 'Wizard', 'Tower', 'Familiar') and c.get('school') not in SCHOOLS + ['Wild']: missing.append(f'{f}: school {c.get("school")!r}')
        if dk in ('Spell', 'Tower', 'Familiar') and not c.get('cost'): missing.append(f'{f}: no cost')
        if dk == 'Spell' and (c['cost'].get('mana') is None or not c['cost'].get('reagents')): missing.append(f'{f}: incomplete spell cost')
        if dk == 'Spell' and c.get('duration') not in ('1x', 'ongoing'): missing.append(f'{f}: duration {c.get("duration")!r}')
        if dk == 'Wizard' and not c.get('gather_bonus'): missing.append(f'{f}: no gather bonus')
        if dk == 'Reagent' and (len(c['gather_icons']) < 3 or not c['increase_icons']): missing.append(f'{f}: icons')
    # every card path referenced by any saved game state must resolve
    import glob
    for sf in sorted(glob.glob(os.path.join(_R, 'game', '*.json'))):
        def walk(o):
            if isinstance(o, dict): [walk(v) for v in o.values()]
            elif isinstance(o, list): [walk(v) for v in o]
            elif isinstance(o, str) and o.endswith('.jpg') and os.path.basename(o).startswith(('Spell_', 'Wizard_', 'Tower_', 'Familiar_', 'Reagent_')):
                if not get(o): unresolved.append(f'{os.path.basename(sf)}: {o}')
        walk(json.load(open(sf)))
        for t in json.load(open(sf)).get('ach', []) or []:
            if not get('Achievement:' + t): unresolved.append(f'{os.path.basename(sf)}: achievement {t}')
    checks = [('Spell_Spell_Shield_A.jpg', 'Alchemy', {'Eye_of_Newt': 2}, '1x', None),
              ('Spell_Flame_Bolt_S.jpg', 'Sorcery', {'Foxglove': 2, 'Sulphur': 1}, '1x', None),
              ('Spell_Flame_Bolt_D.jpg', 'Druidry', {'Toadstool': 2, 'Sulphur': 1}, '1x', None),
              ('Spell_Scry_Dungeon.jpg', 'Sorcery', {'Foxglove': 2, 'Nightshade': 1}, '1x', 'top 10'),
              ('Spell_Charm.jpg', 'Enchantment', {'Mandrake': 3, 'Foxglove': 2}, '1x', 'Take a Wizard Card from another player'),
              ('Spell_Order_of_the_Wand.jpg', 'Enchantment', None, None, None)]
    spot = []
    for k, sc, rg, du, txt in checks:
        c = C[k]; ok = c['school'] == sc and (rg is None or c['cost']['reagents'] == rg) and (du is None or c['duration'] == du) \
            and (txt is None or txt.lower() in c['effect'].lower()) and (k != 'Spell_Spell_Shield_A.jpg' or c['cost']['mana'] == 5)
        spot.append(f"{'OK ' if ok else 'FAIL'} {k}: {c['school']}, {c['cost']['mana']} mana + {c['cost']['reagents']}, {c['duration']}, '{c['effect'][:60]}'")
    # legacy scoring.py table (cards.json walk + hand-typed SCH.update, as of Nov 2 16:12) for comparison
    legacy_sch = _legacy_scoring_table()
    sdiff = []
    for k, v in legacy_sch.items():
        c = C.get(k)
        if c and c.get('school') != v: sdiff.append(f'{k}: old scoring.py {v!r} -> carddb {c.get("school")!r}')
    hand = {'Spell_Spell_Shield_E.jpg':'Enchantment','Spell_Energy_Pulse.jpg':'Sorcery','Spell_Secret_Society.jpg':'Enchantment',
            'Spell_Spell_Shield_C.jpg':'Conjuring','Spell_Hoard_Mana.jpg':'Sorcery','Spell_Flame_Bolt_S.jpg':'Sorcery','Spell_Disintegrate_N.jpg':'Necromancy',
            'Spell_Flame_Bolt_D.jpg':'Druidry','Spell_Perfect_Reagent.jpg':'Thaumaturgy','Spell_Order_of_the_Wand.jpg':'Enchantment','Spell_Mana_Leak.jpg':'Conjuring',
            'Spell_Spell_Shield_T.jpg':'Thaumaturgy','Spell_Trap.jpg':'Thaumaturgy','Spell_Disintegrate_S.jpg':'Sorcery','Spell_Spell_Shield_A.jpg':'Alchemy',
            'Spell_Arch_Mage.jpg':'Wild'}
    hand_bad = [f'{k}: hand table {v} vs carddb {C[k]["school"]}' for k, v in hand.items() if C[k]['school'] != v]
    return dict(cards=len(C), unresolved=unresolved, missing_school_or_cost=missing, legacy_images=legacy,
                source_conflicts=db['conflicts'], spot_checks=spot, hand_typed_SCH_mismatches=hand_bad,
                old_scoring_vs_carddb=sdiff, appendix_differences_photo_wins=db['appendix_differences'])

def _legacy_scoring_table():
    T = {}
    def w(o):
        if isinstance(o, dict):
            if o.get('school') and o.get('image'): T[os.path.basename(o['image'])] = o['school']
            if o.get('school') and o.get('name') and not o.get('image'): T.setdefault('Spell_' + o['name'].replace(' ', '_') + '.jpg', o['school'])
            if o.get('name') and not o.get('image') and not o.get('school') and isinstance(o.get('preproduction_appendix'), dict) and o['preproduction_appendix'].get('school'):
                T.setdefault('Spell_' + o['name'].replace(' ', '_') + '.jpg', o['preproduction_appendix']['school'])
            for v in o.values(): w(v)
        elif isinstance(o, list):
            for v in o: w(v)
    w(json.load(open(os.path.join(_R, 'cards', 'cards.json'))))
    T.update({'Spell_Spell_Shield_E.jpg':'Enchantment','Spell_Energy_Pulse.jpg':'Sorcery','Spell_Secret_Society.jpg':'Enchantment',
              'Spell_Spell_Shield_C.jpg':'Conjuring','Spell_Hoard_Mana.jpg':'Sorcery','Spell_Flame_Bolt_S.jpg':'Sorcery','Spell_Disintegrate_N.jpg':'Necromancy',
              'Spell_Flame_Bolt_D.jpg':'Druidry','Spell_Perfect_Reagent.jpg':'Thaumaturgy','Spell_Order_of_the_Wand.jpg':'Enchantment','Spell_Mana_Leak.jpg':'Conjuring',
              'Spell_Spell_Shield_T.jpg':'Thaumaturgy','Spell_Trap.jpg':'Thaumaturgy','Spell_Disintegrate_S.jpg':'Sorcery','Spell_Spell_Shield_A.jpg':'Alchemy',
              'Spell_Arch_Mage.jpg':'Wild'})
    return T

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 2 and sys.argv[1] == 'show': print(json.dumps(get(sys.argv[2]), indent=1))
    else: print(json.dumps(validate(), indent=1))
