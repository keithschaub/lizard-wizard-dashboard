"""Build cards/carddb.json: ONE lookup for every card the game uses, keyed by asset filename (basename).
Sources (priority): spells_from_pc.json (Keith's photo transcription) > cards.json appendix; reagent_cards.json;
cards.json wizards/towers/familiars/achievements; other_cards_from_pc.json (wizards); dungeon_cards.json.
Run: python3 scripts/build_carddb.py   (rewrites cards/carddb.json and prints the validator report)"""
import json, os, re, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
C = lambda f: json.load(open(os.path.join(R, 'cards', f)))
norm = lambda r: r.replace(' ', '_') if isinstance(r, str) else r
SUFFIX = {'S': 'Sorcery', 'D': 'Druidry', 'A': 'Alchemy', 'C': 'Conjuring', 'E': 'Enchantment', 'T': 'Thaumaturgy', 'N': 'Necromancy'}
# Targeted negative spells (actions.NEGATIVE_SPELLS, from the real card texts). Spell Shield blocks these.
NEGATIVE = ('Charm', 'Flame_Bolt', 'Disintegrate', 'Mana_Drain', 'Swapo', 'Demonic_Possession', 'Earthquake',
            'Invisibility_Potion', 'Obscure')
ATTACK = ('Flame_Bolt', 'Disintegrate', 'Earthquake', 'Charm', 'Mana_Drain')

def build():
    cj = C('cards.json'); pc = C('spells_from_pc.json'); rc = C('reagent_cards.json')
    oc = C('other_cards_from_pc.json'); dc = C('dungeon_cards.json')
    SR = {k: norm(v) for k, v in cj['school_reagent_map'].items()}
    db, conflicts, notes = {}, [], []
    # ---------------- spells
    app = {}
    for c in cj['spells']['cards']:
        app.setdefault(c['name'].replace('!', '').replace('-', '_').replace(' ', '_'), []).append(c)
    for c in pc['cards']:
        key = 'Spell_' + c['id'] + '.jpg'; base = c['id']; sfx = None
        m = re.match(r'(.+)_([SDACETN])$', c['id'])
        if m and m.group(1) in ('Flame_Bolt', 'Disintegrate', 'Spell_Shield'): base, sfx = m.group(1), m.group(2)
        sch = c['school']
        if sfx and SUFFIX[sfx] != sch: conflicts.append(f"{key}: suffix _{sfx} means {SUFFIX[sfx]} but photo transcription says {sch}")
        cost = c['cast_cost_reagents']; variable = any(v == 'X' for v in cost.values())
        dur = '1x' if '1x' in c['duration'] else 'ongoing'
        e = dict(key=key, deck='Spell', name=c['name'], display=f"{c['name']} ({sch})", school=sch,
                 school_reagent=SR.get(sch), variant=sfx, base=base,
                 cost=dict(mana=c['mana_cost'], reagents={norm(k): v for k, v in cost.items()}, variable=variable),
                 duration=dur, effect=c['effect'], negative=base in NEGATIVE, attack=base in ATTACK,
                 gotcha_star=bool(c.get('gotcha_star')), vp_box=c.get('vp_box'),
                 transcription_status=c.get('transcription_status'), source='spells_from_pc.json (Keith photos)')
        # compare with the cards.json pre-production appendix (informational; photo wins)
        for a in app.get(base, []) or app.get(c['name'].replace(' ', '_'), []):
            pa = a.get('preproduction_appendix') or {}
            asch = (a.get('school') or pa.get('school') or '')
            asch = asch.split(' (')[0] if asch else asch
            if asch and asch in SUFFIX.values() and not sfx and asch != sch:
                notes.append(f"{key}: cards.json says {a.get('school') or pa.get('school')!r}, photo says {sch} (photo used)")
            ar = a.get('reagents') if isinstance(a.get('reagents'), list) else pa.get('reagents')
            if isinstance(ar, list) and not sfx:
                from collections import Counter as _C
                if dict(_C(norm(x) for x in ar)) != {norm(k): v for k, v in cost.items()}:
                    notes.append(f"{key}: cards.json reagents {dict(_C(ar))} vs photo {cost} (photo used)")
        db[key] = e
    # ---------------- wizards
    owiz = {os.path.basename(o['asset_image']): o for o in oc['cards'] if o.get('asset_image')}
    for w in cj['wizards']['unique_cards']:
        key = os.path.basename(w['image']); o = owiz.get(key)
        if o and (o['school'] != w['school'] or norm(o['gather_bonus_reagent_top_left']) != norm(w['gather_bonus_reagent'])):
            conflicts.append(f"{key}: cards.json {w['school']}/{w['gather_bonus_reagent']} vs other_cards_from_pc {o['school']}/{o['gather_bonus_reagent_top_left']}")
        db[key] = dict(key=key, deck='Wizard', name=w['name'], display=f"{w['name']} ({w['school']})", school=w['school'],
                       school_reagent=SR.get(w['school']), gather_bonus=norm(w['gather_bonus_reagent']), cost=dict(auction=True),
                       effect=f"+1 {w['gather_bonus_reagent']} whenever you Gather", source='cards.json wizards' + (' + other_cards_from_pc.json' if o else ''))
    # ---------------- towers
    for t in cj['towers']['cards']:
        key = os.path.basename(t['image'])
        if norm(t['reagent']) != SR[t['school']]: conflicts.append(f"{key}: tower reagent {t['reagent']} != school reagent {SR[t['school']]}")
        if int(key[7]) != t['tier']: conflicts.append(f"{key}: filename tier {key[7]} != tier {t['tier']}")
        db[key] = dict(key=key, deck='Tower', name=t['name'], display=f"{t['name']} T{t['tier']} ({t['school']})", school=t['school'],
                       school_reagent=SR[t['school']], tier=t['tier'],
                       cost=dict(tier=t['tier'], reagent=norm(t['reagent']), reagent_count=t['reagent_cost'], gold=t['gold_cost']),
                       effect=None, source='cards.json towers' + (' (photo confirmed)' if t.get('photo_confirmed') else ''))
    # ---------------- familiars
    for f in cj['familiars']['cards']:
        key = os.path.basename(f['image'])
        db[key] = dict(key=key, deck='Familiar', name=f['name'], display=f"{f['name']} {f['cost_mana']} ({f['school']})", school=f['school'],
                       school_reagent=SR[f['school']], cost=dict(mana=f['cost_mana']), collect=f['collect'], reagent=norm(f['reagent']),
                       effect=f['text'], source='cards.json familiars' + (' (photo confirmed)' if f.get('photo_confirmed') else ''))
    # ---------------- reagent gathering cards
    for c in rc['cards']:
        key = c['id'] + '.jpg'
        db[key] = dict(key=key, deck='Reagent', name=c['id'].replace('_', ' '), display=c['id'].replace('_', ' '), school=None,
                       gather_icons=[norm(x) for x in c['gather_icons_in_print_order']],
                       increase_icons=[norm(x) for x in c['increase_icons_in_print_order']],
                       source='reagent_cards.json (Keith scans)')
    # ---------------- dungeon
    for d in dc['cards']:
        key = d['file']; k = d['kind']
        nm = d['title'] if k in ('monster', 'trap') else (d.get('item') or d['bottom_text'])
        db[key] = dict(key=key, deck='Dungeon', name=nm, display=nm + (f" ({d['monster_type']})" if k == 'monster' else ''), school=None,
                       kind=k, gold=d.get('gold'), item=d.get('item'), monster_type=d.get('monster_type'), hits=d.get('hits'),
                       effect=d['bottom_text'], source='dungeon_cards.json (Keith photos)')
    # ---------------- achievements (no image; keyed 'Achievement:<text>' as stored in state['ach'])
    for t in cj['achievements']['tiles']:
        txt = t['text']; sch = next((s for s in SR if s.lower() in txt.lower()), None)
        if not sch and txt.startswith('x7 '): sch = next((s for s, r in SR.items() if r == norm(txt[3:])), None)
        key = 'Achievement:' + txt
        db[key] = dict(key=key, deck='Achievement', name=txt, display=txt + (f" ({sch})" if sch else ''), school=sch,
                       school_reagent=SR.get(sch), vp=10, effect='Claim on your turn when met: 10 VP', source='cards.json achievements',
                       # Real tiles (UG rulebook appendix p.19, checked Nov 2 2026): '5 Wizards', '7 Towers', '7 Familiars', '7 Spells'
                       # print no school icon at all; '10 Gold' / '100 Mana' show a Gold / Mana icon, not a school.
                       schoolless=sch is None, tile_icon=('Gold' if 'Gold' in txt else 'Mana' if 'Mana' in txt else None) if sch is None else None)
    # ---------------- legacy / alias images (not dealt by deal4.py; resolve by name for safety)
    aliases = {}
    for f in sorted(os.listdir(os.path.join(R, 'assets'))):
        if not f.endswith('.jpg') or f in db: continue
        m = re.match(r'(Tower|Familiar)_([A-Za-z_]+)\.jpg$', f)
        if m:
            tgt = sorted(k for k, v in db.items() if v['deck'] == m.group(1) and k.endswith('_' + m.group(2) + '.jpg'))
            if tgt: aliases[f] = tgt[0]
    return dict(version=1, built_from=['spells_from_pc.json', 'cards.json', 'reagent_cards.json', 'other_cards_from_pc.json', 'dungeon_cards.json'],
                school_reagent_map=SR, reagent_school={v: k for k, v in SR.items()}, cards=db, aliases=aliases,
                conflicts=conflicts, appendix_differences=notes)

if __name__ == '__main__':
    out = build(); path = os.path.join(R, 'cards', 'carddb.json')
    json.dump(out, open(path + '.tmp', 'w'), indent=1, sort_keys=True); os.replace(path + '.tmp', path)
    print('wrote', path, len(out['cards']), 'cards,', len(out['aliases']), 'aliases')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import carddb; carddb.reload(); rep = carddb.validate(); print(json.dumps(rep, indent=1))
