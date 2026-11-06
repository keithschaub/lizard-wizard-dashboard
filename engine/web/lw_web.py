"""Browser glue for the Lizard Wizard engine (runs in Pyodide; also importable by CPython for tests).

Every rule is applied by the ORIGINAL engine modules in engine/scripts (actions, spell_effects, turn, turn_package,
ai_policy, ai_sim, scoring, carddb); nothing here re-implements a rule. This module only:
  * keeps the full game state (in the worker; the UI never receives it),
  * builds the human seat's PUBLIC view (ai_policy.public_view: no opponent hands, mana or deck order; Gold is public
    under the house rule meta.show_gold),
  * lists the legal targets from turn_package.grouped_options (every affordable action),
  * splits human actions into the tap-by-tap steps the UI needs (gather keep -> cast -> put-back, dungeon card by
    card, New Research reveal, spell targets) and commits each one through the engine,
  * advances AI seats one turn at a time (turn.ai_turn + turn.advance) so the UI can animate them.

Every committing call runs on a deep copy and only replaces the live state on success, so a refused action never
leaves a half-applied state behind.
"""
import copy, json, os, sys, random, itertools
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(ENGINE, 'scripts'))

import actions as A, scoring as S, carddb as CD, spell_effects as SE, turn_package as TP
import ai_policy as AI, ai_sim as SIM
import turn as T

T.NO_AI = True                      # AI seats are stepped one turn at a time by ai_step()
REAGENTS = list(T.REAGENTS)
SCHOOLS = list(CD.SCHOOLS)
b = os.path.basename

G = {'s': None, 'me': 'Keith'}


class Refused(Exception):
    pass


# ------------------------------------------------------------------ helpers
def key(path):
    """UI card key: asset basename without extension ('Spell_Charm')."""
    if not path: return None
    return b(str(path))[:-4] if str(path).endswith('.jpg') else b(str(path))


def jpg(k): return k if k.endswith('.jpg') else k + '.jpg'


def spell_key_of(x):
    """Spell key from any engine spelling ('Spell_Charm.jpg', 'Spell_Charm', 'Spell_Shield_A' as the AI writes it)."""
    k = key(x) if str(x).endswith('.jpg') else b(str(x))
    for c in (k, 'Spell_' + k, 'Spell_' + k.replace('Spell_', '', 1)):
        if CD.get(jpg(c)): return c
    return k


def me(): return G['me']


def st(): return G['s']


def P(s, n): return A.P(s, n)


def humans(s): return T.humans(s)


def pend(s):
    return s['meta'].get('web_pending')


def auction(s):
    p = s['meta'].get('pending')
    return p if isinstance(p, dict) and p.get('type') == 'auction' else None


def spell_cost(k): return [A.norm(r) for r in (CD.cast_cost(jpg(k)) or [])]


def is_variable(k): return CD.cast_cost(jpg(k)) is None


def can_pay(tok, cost): return not (Counter(cost) - Counter(tok))


def _commit(fn, *a, **kw):
    """Run fn(t, ...) on a deep copy of the live state; swap it in only if fn returns without raising."""
    s = st()
    if s is None: raise Refused('no game loaded')
    t = copy.deepcopy(s)
    out = fn(t, *a, **kw)
    G['s'] = t
    return out


# ------------------------------------------------------------------ load / save
def load(text, viewer='Keith'):
    s = json.loads(text) if isinstance(text, str) else text
    for k in ('players', 'meta', 'tracks'):
        if k not in s: raise Refused(f'not a Lizard Wizard save: missing {k}')
    if viewer not in [q['name'] for q in s['players']]: raise Refused(f'{viewer} is not a seat in this game')
    s['meta'].setdefault('web_pending', None)
    G['s'] = s; G['me'] = viewer
    return view()


def dump():
    return json.dumps(st())


# ------------------------------------------------------------------ public view for the UI
CARD_FIELDS = ('key', 'deck', 'name', 'display', 'school', 'effect', 'duration', 'cost', 'gather_icons', 'increase_icons',
               'gather_bonus', 'collect', 'reagent', 'tier', 'monster_type', 'kind', 'gold', 'hits', 'item', 'negative',
               'vp', 'tile_icon', 'school_reagent')


def card_db():
    """Card metadata for the UI, straight from carddb (the only source of card text)."""
    out = {}
    for k, c in CD._load()['cards'].items():
        kk = k[:-4] if k.endswith('.jpg') else k
        out[kk] = {f: c.get(f) for f in CARD_FIELDS if c.get(f) is not None}
        out[kk]['key'] = kk
    return out


def dungeon_key(c):
    """Art key for a dungeon card dict (same mapping as turn_package.dungeon_img)."""
    return b(TP.dungeon_img(c))[:-4]


def _public_vp(q, s, viewer):
    if q['name'] == viewer or s['meta'].get('game_over'): return S.score(q, s)
    return S.score(dict(q, mana=0), s)          # Hoard Mana would reveal secret mana: public VP leaves it out


def player_view(s, q, viewer):
    mine = q['name'] == viewer
    over = bool(s['meta'].get('game_over'))
    gold_public = mine or over or s['meta'].get('show_gold')
    spells = []
    for x in q.get('spells', []):
        if x.get('cast') or mine or over: spells.append({'key': key(x['img']), 'cast': bool(x.get('cast'))})
        else: spells.append({'key': None, 'cast': False})            # researched, face down
    prof = (s['meta'].get('ai_profiles') or {}).get(q['name'])
    lvl = (s['meta'].get('ai_levels') or {}).get(q['name'])
    return dict(
        name=q['name'], human=q['name'] in humans(s), you=mine, profile=prof, level=lvl,
        mana=q['mana'] if (mine or over) else None,
        gold=q.get('gold', 0) if gold_public else None,
        tok=list(q['tok']), cap=A.capacity(q),
        hand=[key(h) for h in q['hand']] if mine else None, hand_count=len(q['hand']),
        wizards=[key(w) for w in q.get('wizards', [])], towers=[key(t) for t in q.get('towers', [])],
        spells=spells, familiars=[key(f) for f in q.get('familiars', [])],
        treasures=[{'name': c.get('name'), 'key': dungeon_key(c)} for c in q.get('treasures', [])],
        achievements=list(q.get('achievements', [])), undead_kept=q.get('undead_kept', 0),
        bonus=[A.norm(CD.wizard_bonus(w)) for w in q.get('wizards', []) if CD.wizard_bonus(w)],
        vp=_public_vp(q, s, viewer))


def auction_view(s):
    a = auction(s)
    if not a: return None
    return dict(card=key(a['card']), starter=a['starter'], order=list(a['order']), high=a['high'], who=a['who'],
                tail=[list(x) for x in a['tail']], active=list(a['active']), waiting=T.auction_waiting_on(s, a))


def log_text(e):
    a = e.get('act'); w = e.get('who')
    try:
        if a == 'scry_dungeon' and 'seen' not in e:
            return f"{w} cast Scry Dungeon and kept {', '.join(c.get('name') or str(c.get('gold')) + ' Gold' for c in e.get('kept', [])) or 'nothing'}"
        if a and a.startswith('scry_') and a != 'scry_dungeon':
            deck = a[5:]
            return f"{w} scried the {deck.title()} deck" + (f" and took {CD.display(e['took'])}" if e.get('took') else '')
        if a == 'wand_tax': return f"{w} cast Wand Tax on {e['school']}: +{e['gold']} Gold"
        if a == 'transmute': return f"{w} transmuted {len(e['reagents'])} reagents into {e['gold']} Gold"
        if a == 'time_shift': return f"{w} removed the top {e['n']} cards of the {e['deck']} deck (Time Shift)"
        if a == 'energy_pulse': return f"{w} cast Energy Pulse: {e['destroyed']} Spell Shield(s) destroyed"
        if a == 'invisibility_potion': return f"{w} cast Invisibility Potion on {e['target']}: stole {e['gold']} Gold"
        if a == 'invisibility_potion_blocked': return f"{w}'s Invisibility Potion on {e['target']} was blocked by a Spell Shield"
        if a == 'web_note': return e.get('text', '')
        if a == 'summon' and e.get('use') == 'gather':
            return f"{w} summoned {CD.display(e['familiar'])} for {e['cost']} mana: gathered {', '.join(T.nice(r) for r in e.get('got', []))}" + \
                   (f", cast {', '.join(CD.display(jpg(spell_key_of(x))) for x in e.get('cast', []))}" if e.get('cast') else '')
        return T.describe(e)
    except Exception:
        return T.describe(e) if a else json.dumps(e)


def log_cards(e):
    a = e.get('act'); out = []
    for f in ('spell', 'took', 'tower', 'familiar', 'card', 'wizard', 'gave', 'got'):
        v = e.get(f)
        if isinstance(v, str) and v.endswith('.jpg') and v.startswith(('Spell_', 'Tower_', 'Familiar_', 'Wizard_')): out.append(key(v))
    if a == 'auction': out.append('Wizard_' + e['item'])
    if a in ('gather',): out.append(e['card'])
    if a in ('dungeon',):
        out += [dungeon_key(c) for c in e.get('drawn', [])]
    if a == 'scry_dungeon':
        out += [dungeon_key(c) for c in e.get('kept', [])]
    if a == 'summon' and e.get('cast'):
        out += [spell_key_of(x) for x in e['cast']]
    if a == 'auction_nobid': out.append('Wizard_' + e['item'])
    return out


def public_log(s, viewer):
    pv = AI.public_view(s, viewer)
    out = []
    for i, e in enumerate(pv['meta'].get('log', [])):
        a = e.get('act')
        item = dict(i=i, r=e.get('r'), who=e.get('who') or e.get('won') or e.get('seat'), act=a)
        if a == 'turn': item['text'] = f"Round {e.get('r')}: {e.get('seat')}'s turn"
        elif a == 'setup_picks': item['text'] = 'Starting reagents: ' + '; '.join(f"{n} {', '.join(T.nice(r) for r in v)}" for n, v in e['picks'].items())
        else: item['text'] = log_text(e)
        item['cards'] = log_cards(e)
        if a == 'research' and e.get('cast') or a == 'cast':
            item['cast'] = key(e['spell'])
        if a == 'auction': item['bids'] = e.get('bids_tail'); item['price'] = e.get('price')
        if a == 'dungeon':
            item['drawn'] = [dungeon_key(c) for c in e.get('drawn', [])]
            item['hits'] = e.get('hits'); item['success'] = e.get('success')
        if a == 'gather':
            item['got'] = list(e.get('got', [])) + list(e.get('bonus', [])); item['inc'] = list(e.get('inc', []))
        out.append(item)
    return out


def board_view(s):
    dl = s.get('dungeon_list')
    return dict(
        tower_face=key(s.get('tower_face')), tower_deck=len(s.get('tow_list', [])),
        wiz_face=[key(w) for w in s.get('wiz_face', [])], wiz_deck=len(s.get('wiz_list', [])),
        fam_face=[key(f) for f in s.get('fam_face', [])], fam_deck=len(s.get('fam_list', [])),
        spell_face=[key(x) for x in s.get('spell_face', [])], spell_deck=len(s.get('spell_list', [])),
        dungeon_deck=len(dl) if dl is not None else s.get('dungeon_deck', 0), dungeon_treasure=TP.treasure_left(s),
        reag_deck=len(s.get('reag_list', [])), reag_discard=key(s['reag_discard'][-1]) if s.get('reag_discard') else None,
        ach=list(s.get('ach', [])), tracks=dict(s['tracks']), out_of_play=len(s.get('out_of_play', [])))


def view():
    s = st(); v = me()
    ntype, nwho = T.who_needed(s)
    wp = pend(s)
    out = dict(
        viewer=v, round=s['meta'].get('round'), next=s.get('next'), seat_order=list(s['meta']['seat_order']),
        start=s['meta']['seat_order'][0], humans=humans(s), game_over=bool(s['meta'].get('game_over')),
        end_triggered=bool(s['meta'].get('game_end_triggered')), again=bool(s['meta'].get('again')),
        bonus=bool(s['meta'].get('web_bonus')), waiting=ntype, waiting_on=nwho,
        board=board_view(s), players=[player_view(s, q, v) for q in s['players']],
        auction=auction_view(s), pending=pending_view(s) if wp else None,
        legal=legal(s, v) if (ntype == 'action' and nwho == v and not wp) else None,
        log_len=len(s['meta'].get('log', [])))
    if out['game_over']:
        out['final'] = {q['name']: S.score(q, s) for q in s['players']}
    return out


def full_log():
    return public_log(st(), me())


# ------------------------------------------------------------------ legal targets (from turn_package.grouped_options)
def _keeps(icons, p):
    if len(icons) <= 3 or SE.has_cast(p, 'Maximum_Gather'): return [list(icons)]
    return [list(k) for k in sorted({tuple(sorted(k)) for k in itertools.combinations(icons, 3)})]


def legal(s, n):
    p = P(s, n)
    O, U = TP.grouped_options(s, n)
    L = dict(gather={}, convert={}, convert1=False, energize=SE.has_cast(p, 'Energize'), build=None, recruit=[],
             research={}, summon={}, divination=False, unavailable=list(U))
    miracle = SE.has_cast(p, 'Miracle')
    for c in p['hand']:
        cid = key(c); g, inc = CD.reagent_icons(c); g = [A.norm(x) for x in g]; inc = [A.norm(x) for x in inc]
        L['gather'][cid] = dict(offers=g, raises=inc, keep=len(_keeps(g, p)[0]), keeps=_keeps(g, p),
                                bonus=[A.norm(CD.wizard_bonus(w)) for w in p.get('wizards', []) if CD.wizard_bonus(w)],
                                bloom=SE.has_cast(p, 'Bloom'), maxgather=SE.has_cast(p, 'Maximum_Gather'),
                                miracle=miracle, reversed_keep=len(_keeps(inc, p)[0]) if miracle else None)
    tf = s.get('tower_face')
    for o in O:
        k = o['key']
        if k[0] == 'gather': L['gather'][k[1] if k[1].startswith('Reagent_') else 'Reagent_' + k[1]]['listed'] = True
        elif k[0] == 'convert': L['convert'][k[1]] = dict(n=p['tok'].count(k[1]), value=s['tracks'][k[1]])
        elif k[0] == 'convert1': L['convert1'] = True
        elif k[0] == 'build':
            L['build'] = L['build'] or dict(tower=key(tf), reagent=None, gold=None)
            _t, r, _sc = CD.tower_info(tf)
            if k[1] == 'reagent': L['build']['reagent'] = dict(n=A.tower_cost(p, tf, 'reagent'), reagent=A.norm(r))
            else: L['build']['gold'] = dict(n=A.tower_cost(p, tf, 'gold'))
        elif k[0] == 'recruit': L['recruit'].append(key(k[1]))
        elif k[0] in ('research', 'research_cast'):
            sk = key(k[1]); d = L['research'].setdefault(sk, dict(mana=CD.get(k[1])['cost']['mana'], castable=False, x=False))
            if k[0] == 'research_cast': d['castable'] = True
        elif k[0] == 'summon':
            fk = key(k[1]); c = CD.get(k[1])
            d = L['summon'].setdefault(fk, dict(cost=SE.familiar_cost(p, k[1]), uses=[], collect=c['collect'], reagent=A.norm(c['reagent']),
                                                score_gold=1 + SE.school_count(p, c['school'])))
            d['uses'].append(k[2])
    # Invisibility Potion has a variable cost (X Eye of Newt): castable with at least one Eye
    for sk, d in L['research'].items():
        if 'Invisibility_Potion' in sk and p['tok'].count('Eye_of_Newt') >= 1 and len(s['players']) > 1: d['castable'] = True; d['x'] = True
    if SE.has_cast(p, 'Divination') and TP.treasure_left(s): L['divination'] = True   # "Enter the Dungeon as an action without a Familiar"
    missing = TP.required_keys(s, n) - TP.emitted_keys(O)
    if missing: L['qc_missing'] = sorted(map(str, missing))
    return L


# ------------------------------------------------------------------ gather (keep -> cast -> put-back -> commit)
def _reagent_entry(cid):
    R, _ = A._cards(); return R[cid]


class _Reversed:
    """Miracle: 'Reverse the Reagents on the Gather and Increase Value sides of your Gather Reagent Card' for ONE gather.
    actions.gather reads the card from its carddb cache; swap the two sides there for the duration of the call."""
    def __init__(self, cid, on): self.cid, self.on = cid, on
    def __enter__(self):
        if self.on:
            e = _reagent_entry(self.cid); self.saved = (e['gather_icons_in_print_order'], e['increase_icons_in_print_order'])
            e['gather_icons_in_print_order'], e['increase_icons_in_print_order'] = self.saved[1], self.saved[0]
    def __exit__(self, *x):
        if self.on:
            e = _reagent_entry(self.cid); e['gather_icons_in_print_order'], e['increase_icons_in_print_order'] = self.saved


def _gather_got(s, n, cid, keep, bloom, miracle):
    p = P(s, n); g, inc = CD.reagent_icons(jpg(cid))
    side = [A.norm(x) for x in (inc if miracle else g)]
    if len(side) > 3 and SE.has_cast(p, 'Maximum_Gather'): got = side
    elif len(side) > 3:
        keep = [A.norm(x) for x in (keep or [])]
        if len(keep) != 3 or (Counter(keep) - Counter(side)): raise Refused(f'keep exactly 3 of {side}')
        got = keep
    else: got = side
    bonus = [A.norm(CD.wizard_bonus(w)) for w in p.get('wizards', []) if CD.wizard_bonus(w)]
    if SE.has_cast(p, 'Bloom'): bonus.append(A.norm(bloom or got[0]))
    return list(got), bonus


def _castable(p, holdings):
    out = []
    for x in p.get('spells', []):
        if x.get('cast'): continue
        k = key(x['img'])
        if is_variable(k):
            if 'Invisibility_Potion' in k and holdings.count('Eye_of_Newt') >= 1: out.append(dict(key=k, cost=[], x=holdings.count('Eye_of_Newt')))
            continue
        c = spell_cost(k)
        if can_pay(holdings, c): out.append(dict(key=k, cost=c))
    seen = set(); res = []
    for o in out:
        if o['key'] not in seen: seen.add(o['key']); res.append(o)
    return res


def gather_preview(card, keep=None, bloom=None, miracle=False, cast=None, x=None):
    """What the UI needs after the keep taps: the reagents gained, the spells castable with them, and the put-back
    count (cast cost is spent BEFORE the storage check, rulebook p.11)."""
    s = st(); n = me(); p = P(s, n)
    got, bonus = _gather_got(s, n, card, keep, bloom, miracle)
    holdings = p['tok'] + got + bonus
    castable = _castable(p, holdings)
    spend = []
    if cast:
        c = [o for o in castable if o['key'] == cast]
        if not c: raise Refused(f'{cast} is not castable with this gather')
        spend = ['Eye_of_Newt'] * int(x or 1) if c[0].get('x') is not None else c[0]['cost']
    pool = list((Counter(holdings) - Counter(spend)).elements())
    over = max(0, len(holdings) - len(spend) - A.capacity(p))
    return dict(got=got, bonus=bonus, castable=castable, over=over, pool=sorted(pool, key=REAGENTS.index), cap=A.capacity(p))


def act_gather(card, keep=None, bloom=None, miracle=False, cast=None, x=None, target=None, discard=None):
    def run(s):
        n = me(); _start_action(s, n); p = P(s, n)
        cid = card if str(card).startswith('Reagent_') else 'Reagent_%02d' % int(card)
        if miracle and not SE.has_cast(p, 'Miracle'): raise Refused('Miracle is not cast')
        got, bonus = _gather_got(s, n, cid, keep, bloom, miracle)
        spend = []; inv = False
        if cast:
            own = [y for y in p.get('spells', []) if key(y['img']) == cast and not y.get('cast')]
            if not own: raise Refused('you do not own that uncast spell')
            inv = 'Invisibility_Potion' in cast
            spend = ['Eye_of_Newt'] * int(x or 0) if inv else spell_cost(cast)
            if inv and (not x or int(x) < 1 or not target): raise Refused('Invisibility Potion needs X >= 1 and a target')
        with _Reversed(cid, miracle):
            A.gather(s, n, cid, keep=got, discard=discard, bloom=bonus[-1] if SE.has_cast(p, 'Bloom') else None, spend=spend)
        T.auto_claim(s, n)            # 'on your turn, if you meet': claim an x7 tile before the cast spends tokens
        queue = []
        if cast:
            if inv: SE.invisibility_potion(s, n, target, int(x))
            else:
                A.cast_spell(s, n, cast, spend); queue.append(cast)
        return _after_action(s, n, queue)
    return _commit(run)


# ------------------------------------------------------------------ convert / build / recruit / bids (turn.keith_action)
def _keith(s, argv):
    if pend(s): raise Refused('finish the current step first')
    ev = []
    try: status, desc = T.keith_action(s, me(), [str(a) for a in argv], ev)
    except SystemExit as e: raise Refused(str(e.code).replace('ERROR: ', ''))
    return status


def act_convert(reagent, n, energize=False):
    def run(s):
        if energize:
            nm = me(); _start_action(s, nm)
            if not SE.has_cast(P(s, nm), 'Energize'): raise Refused('Energize is not cast')
            SE.energized_convert(s, nm, A.norm(reagent), int(n)); return _after_action(s, nm, [])
        return _keith(s, ['convert', A.norm(reagent), int(n)])
    return _commit(run)


def act_convert1(reagents):
    return _commit(lambda s: _keith(s, ['convert1', ','.join(A.norm(r) for r in reagents)]))


def act_build(pay):
    return _commit(lambda s: _keith(s, ['build', 'gold' if pay == 'gold' else 'reagent']))


def act_recruit(wizard, opening):
    return _commit(lambda s: _keith(s, ['recruit', wizard, int(opening)]))


def act_bid(n):
    return _commit(lambda s: _keith(s, ['bid', int(n)]))


def act_pass():
    return _commit(lambda s: _keith(s, ['pass']))


# ------------------------------------------------------------------ research
def act_research(spell, cast=False, x=None, target=None):
    def run(s):
        n = me(); _start_action(s, n); p = P(s, n)
        face = [y for y in s['spell_face'] if y and key(y) == spell]
        if not face: raise Refused(f'{spell} is not on offer')
        mana = CD.get(face[0])['cost']['mana']
        if p['mana'] < mana: raise Refused(f'research needs {mana} mana')
        queue = []
        if cast and 'Invisibility_Potion' in spell:
            if not x or int(x) < 1 or not target: raise Refused('Invisibility Potion needs X >= 1 and a target')
            A.research(s, n, spell)
            SE.invisibility_potion(s, n, target, int(x))
        elif cast:
            c = spell_cost(spell)
            if not can_pay(p['tok'], c): raise Refused('missing reagents to cast it')
            A.research(s, n, spell, cast_cost=c); queue.append(spell)
        else: A.research(s, n, spell)
        return _after_action(s, n, queue)
    return _commit(run)


# ------------------------------------------------------------------ summon (score / gather / dungeon / new research)
def summon_gather_preview(familiar, casts=()):
    s = st(); p = P(s, me()); c = CD.get(jpg(familiar))
    holdings = p['tok'] + [A.norm(c['reagent'])] * int(c['collect'])
    for k in casts:
        cc = spell_cost(k)
        if not can_pay(holdings, cc): raise Refused(f'cannot pay {k}')
        holdings = list((Counter(holdings) - Counter(cc)).elements())
    castable = [o for o in _castable(p, holdings) if o['key'] not in casts and o.get('x') is None]
    over = max(0, len(holdings) - A.capacity(p))
    return dict(got=[A.norm(c['reagent'])] * int(c['collect']), castable=castable, over=over,
                pool=sorted(holdings, key=REAGENTS.index), cap=A.capacity(p))


def act_summon(familiar, use, casts=(), discard=None):
    def run(s):
        n = me(); _start_action(s, n); p = P(s, n)
        fam = [f for f in s['fam_face'] if f and key(f) == familiar]
        if not fam: raise Refused(f'{familiar} is not on offer')
        fam = fam[0]; cost = SE.familiar_cost(p, fam)
        if p['mana'] < cost: raise Refused(f'needs {cost} mana')
        if use == 'score':
            A.summon_familiar(s, n, fam, 'score'); return _after_action(s, n, [])
        if use == 'gather':
            cl = [(k, spell_cost(k)) for k in casts]
            for k, _c in cl:
                if is_variable(k): raise Refused('variable-cost spells are cast through Research or Gather')
            A.summon_familiar(s, n, fam, 'gather', cast=cl, discard=discard, after_collect=lambda: T.auto_claim(s, n))
            return _after_action(s, n, list(casts))
        if use == 'dungeon':
            if not TP.treasure_left(s): raise Refused('no treasure left in the Dungeon')
            s['meta']['web_pending'] = dict(type='dungeon', via=key(fam), draws=0); return 'pending'
        if use == 'research':
            t = copy.deepcopy(s)
            A.summon_familiar(t, n, fam, 'research', choose=lambda x: key([z for z in x['spell_face'] if z][0]))
            four = [key(z) for z in (list(s['spell_list']) + [z for z in s['spell_face'] if z])[:4]]
            s['meta']['web_pending'] = dict(type='new_research', familiar=key(fam), four=four); return 'pending'
        raise Refused(f'unknown familiar use {use}')
    return _commit(run)


def act_divination():
    def run(s):
        n = me(); _start_action(s, n)
        if not SE.has_cast(P(s, n), 'Divination'): raise Refused('Divination is not cast')
        if not TP.treasure_left(s): raise Refused('no treasure left in the Dungeon')
        s['meta']['web_pending'] = dict(type='dungeon', via='divination', draws=0); return 'pending'
    return _commit(run)


def choose_new_research(spell):
    def run(s):
        wp = pend(s); n = me()
        if not wp or wp['type'] != 'new_research': raise Refused('no New Research waiting')
        if spell not in wp['four']: raise Refused('pick one of the four new spells')
        fam = [f for f in s['fam_face'] if f and key(f) == wp['familiar']][0]
        s['meta']['web_pending'] = None
        A.summon_familiar(s, n, fam, 'research', choose=lambda x: spell)
        return _after_action(s, n, [])
    return _commit(run)


# ------------------------------------------------------------------ dungeon, card by card
def _dungeon_run(s, wp, draws):
    """Enter the dungeon with the engine, drawing at most `draws` cards (the player stops after the last one)."""
    n = me(); cont = lambda h, d: len(d) < draws
    if wp['via'] == 'divination':
        A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': 'web_note', 'text': f'{n} entered the Dungeon with Divination (Sorcery)'})
        return SE.dungeon_delve(s, n, cont)
    fam = [f for f in s['fam_face'] if f and key(f) == wp['via']][0]
    return A.summon_familiar(s, n, fam, 'dungeon', cont=cont)


def _dungeon_peek(s, wp):
    """Run the expedition on a COPY with the cards flipped so far (nothing else is revealed)."""
    if wp['draws'] == 0: return None
    t = copy.deepcopy(s); t['meta']['web_pending'] = None
    return _dungeon_run(t, wp, wp['draws'])


def dungeon_limit(s):
    return 2 + (1 if SE.has_cast(P(s, me()), 'Spirit_Shield') else 0)


def dungeon_flip():
    def run(s):
        wp = pend(s)
        if not wp or wp['type'] != 'dungeon': raise Refused('not in the Dungeon')
        if wp.get('done'): raise Refused('the expedition is over')
        wp['draws'] += 1
        o = _dungeon_peek(s, wp)
        if not o['success'] or len(o['drawn']) < wp['draws']:
            wp['done'] = True; wp['draws'] = len(o['drawn'])
        return 'flipped'
    return _commit(run)


def dungeon_stop():
    def run(s):
        wp = pend(s); n = me()
        if not wp or wp['type'] != 'dungeon': raise Refused('not in the Dungeon')
        if wp['draws'] < 1: raise Refused('flip at least one card first')
        s['meta']['web_pending'] = None
        _dungeon_run(s, wp, wp['draws'])
        return _after_action(s, n, [])
    return _commit(run)


def dungeon_cancel():
    def run(s):
        wp = pend(s)
        if not wp or wp['type'] != 'dungeon' or wp['draws'] != 0: raise Refused('the expedition has started')
        s['meta']['web_pending'] = None; return 'cancelled'
    return _commit(run)


# ------------------------------------------------------------------ spell effects (after the cast is paid)
TARGETED = ('Spell_Flame_Bolt', 'Spell_Disintegrate', 'Spell_Earthquake', 'Spell_Charm', 'Spell_Mana_Drain', 'Spell_Swapo')
SCRY = {'Spell_Scry_Wizard': 'wizards', 'Spell_Scry_Tower': 'towers', 'Spell_Scry_Familiar': 'familiars', 'Spell_Scribe': 'spells'}
DECKS = {'wizards': 'wiz_list', 'towers': 'tow_list', 'familiars': 'fam_list', 'spells': 'spell_list'}
NOT_AUTOMATED = ('Spell_Demonic_Possession', 'Spell_Trap', 'Spell_Obscure')


def _effect_kind(k):
    for t in TARGETED:
        if k.startswith(t): return t[6:].lower()
    if k in SCRY: return 'scry'
    return {'Spell_Creation': 'creation', 'Spell_Wand_Tax': 'wand_tax', 'Spell_Time_Shift': 'time_shift',
            'Spell_Transmute': 'transmute', 'Spell_Scry_Dungeon': 'auto', 'Spell_Energy_Pulse': 'auto',
            'Spell_Haste': 'haste', 'Spell_Evolve': 'evolve', 'Spell_Rise': 'rise'}.get(k)


def effect_options(s, k):
    n = me(); p = P(s, n); kind = _effect_kind(k); opp = [q for q in s['players'] if q['name'] != n]
    if kind in ('flame_bolt', 'disintegrate'):
        return [dict(player=q['name'], kind=kd, card=key(c['img'] if isinstance(c, dict) else c))
                for q in opp for kd in ('wizards', 'towers', 'spells', 'familiars') for c in q.get(kd, [])
                if not (kd == 'spells' and not c.get('cast'))]
    if kind == 'earthquake': return [dict(player=q['name'], kind='towers', card=key(c)) for q in opp for c in q.get('towers', [])]
    if kind == 'charm': return [dict(player=q['name'], kind='wizards', card=key(c)) for q in opp for c in q.get('wizards', [])]
    if kind == 'mana_drain': return [dict(player=q['name']) for q in opp]
    if kind == 'swapo':
        return [dict(player=q['name'], kind=kd, card=key(c), mine=key(m)) for q in opp for kd in ('wizards', 'towers')
                for c in q.get(kd, []) for m in p.get(kd, [])]
    if kind == 'creation':
        return [dict(kind='wizards', card=key(w)) for w in s.get('wiz_face', []) if w] + \
               ([dict(kind='towers', card=key(s['tower_face']))] if s.get('tower_face') else [])
    if kind == 'wand_tax': return [dict(school=sc, gold=2 * SE.school_count(p, sc)) for sc in SCHOOLS]
    if kind == 'time_shift': return [dict(deck=d, n=min(5, len(s[l]))) for d, l in DECKS.items() if s.get(l)]
    if kind == 'transmute': return [dict(tok=list(p['tok']))] if len(p['tok']) >= 2 else []
    if kind == 'scry':
        deck = SCRY[k]; return [dict(deck=deck, card=key(c)) for c in s[DECKS[deck]][:5]]
    if kind == 'evolve':
        return [dict(familiar=key(f), school=CD.school(f)) for f in p.get('familiars', [])]
    if kind == 'rise':
        return [dict(familiar=key(f), school=CD.school(f)) for f in p.get('familiars', [])]
    return []


def _effect_auto(s, n, k):
    """Effects with no choice; returns True when handled."""
    kind = _effect_kind(k)
    if kind == 'auto':
        if k == 'Spell_Scry_Dungeon': A.scry_dungeon(s, n)
        else: SE.energy_pulse(s, n)
        return True
    if kind == 'haste':
        s['meta']['web_bonus'] = True; return True
    if kind is None:
        c = CD.get(jpg(k))
        if c and c.get('duration') == '1x' and not k.startswith('Spell_Spell_Shield'):
            A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': 'web_note',
                      'text': f"{n} cast {CD.display(jpg(k))}: its effect (\"{c['effect']}\") is not automated by the engine"})
        return True
    return False


def _run_queue(s, n, queue):
    """Resolve casts in order; stop at the first one that needs the player's choice (stored as web_pending)."""
    while queue:
        k = queue[0]
        if _effect_auto(s, n, k): queue.pop(0); continue
        opts = effect_options(s, k)
        if not opts:
            A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': 'web_note', 'text': f"{n} cast {CD.display(jpg(k))}: no legal target, no effect"})
            queue.pop(0); continue
        s['meta']['web_pending'] = dict(type='effect', spell=k, kind=_effect_kind(k), queue=list(queue[1:]))
        return False
    return True


def _start_action(s, n):
    if s['meta'].get('game_over'): raise Refused('the game is over')
    if auction(s): raise Refused('an auction is waiting for a bid')
    if pend(s): raise Refused('finish the current step first')
    if s['next'] != n: raise Refused(f"it is {s['next']}'s turn")
    s['meta'].pop('again', None)


def _finish(s, n):
    A.check_end(s)
    if s['meta'].pop('web_bonus', None) and not s['meta'].get('game_over'):
        A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': 'web_note', 'text': f'{n} takes a bonus action (Haste)'})
        s['meta']['again'] = True
        return 'bonus'
    T.advance(s, [])
    return 'done'


def _after_action(s, n, queue):
    if not _run_queue(s, n, list(queue)): return 'pending'
    return _finish(s, n)


def resolve_effect(choice):
    def run(s):
        wp = pend(s); n = me()
        if not wp or wp['type'] != 'effect': raise Refused('no spell effect waiting')
        k = wp['spell']; kind = wp['kind']; ch = choice or {}
        opts = effect_options(s, k)
        if kind == 'transmute':
            rs = [A.norm(r) for r in ch.get('reagents', [])]
            if len(rs) < 2 or len(rs) % 2 or (Counter(rs) - Counter(P(s, n)['tok'])): raise Refused('choose an even number of your tokens')
            SE.transmute(s, n, rs)
        elif kind == 'scry':
            if ch.get('card') not in [o['card'] for o in opts]: raise Refused('pick one of the revealed cards')
            SE.scry_deck(s, n, SCRY[k], lambda top: [c for c in top if key(c) == ch['card']][0], cast_free=(SCRY[k] == 'spells'))
        else:
            ident = ('player', 'kind', 'card', 'mine', 'school', 'deck')
            match = [o for o in opts if all(o[f] == ch.get(f) for f in ident if f in o)]
            if not match: raise Refused('not a legal choice for this spell')
            o = match[0]
            if kind in ('flame_bolt', 'disintegrate'):
                t = P(s, o['player']); card = [c for c in t[o['kind']] if key(c['img'] if isinstance(c, dict) else c) == o['card']][0]
                if o['kind'] == 'spells':
                    if A.shield_blocks(s, o['player']):
                        A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': kind + '_blocked', 'target': o['player']})
                    else:
                        t['spells'].remove(card); s.setdefault('out_of_play', []).append(card['img'])
                        A.log(s, {'r': s['meta'].get('round'), 'who': n, 'act': kind, 'target': o['player'], 'card': b(card['img']), 'kind': 'spells'})
                else: (A.flame_bolt if kind == 'flame_bolt' else A.disintegrate)(s, n, o['player'], card, o['kind'])
            elif kind == 'earthquake': A.earthquake(s, n, o['player'], [c for c in P(s, o['player'])['towers'] if key(c) == o['card']][0])
            elif kind == 'charm': A.charm(s, n, o['player'], [c for c in P(s, o['player'])['wizards'] if key(c) == o['card']][0])
            elif kind == 'mana_drain': A.mana_drain(s, n, o['player'])
            elif kind == 'swapo':
                th = [c for c in P(s, o['player'])[o['kind']] if key(c) == o['card']][0]
                mn = [c for c in P(s, n)[o['kind']] if key(c) == o['mine']][0]
                SE.swapo(s, n, o['player'], mn, th, o['kind'])
            elif kind == 'creation': A.creation(s, n, o['card'], o['kind'])
            elif kind == 'wand_tax': SE.wand_tax(s, n, o['school'])
            elif kind == 'time_shift': SE.time_shift(s, n, o['deck'])
            elif kind == 'evolve':
                fam = [f for f in P(s, n).get('familiars', []) if key(f) == ch.get('familiar')]
                if not fam: raise Refused('pick one of your familiars')
                SE.evolve(s, n, fam[0])
            elif kind == 'rise':
                fam = [f for f in P(s, n).get('familiars', []) if key(f) == ch.get('familiar')]
                if not fam: raise Refused('pick one of your familiars')
                SE.rise_score(s, n, fam[0])
        s['meta']['web_pending'] = None
        return _after_action(s, n, wp.get('queue', []))
    return _commit(run)


def pending_view(s):
    wp = pend(s)
    if not wp: return None
    out = dict(type=wp['type'])
    if wp['type'] == 'dungeon':
        o = _dungeon_peek(s, wp)
        out.update(via=wp['via'], draws=wp['draws'], limit=dungeon_limit(s), done=bool(wp.get('done')), deck=len(s.get('dungeon_list') or []),
                   drawn=[dungeon_key(c) for c in (o['drawn'] if o else [])], drawn_cards=(o['drawn'] if o else []),
                   hits=o['hits'] if o else 0, success=o['success'] if o else True,
                   kept=[dungeon_key(c) for c in (o['kept'] if o else [])], bonus_gold=o['bonus_gold'] if o else 0)
    elif wp['type'] == 'new_research':
        out.update(familiar=wp['familiar'], four=list(wp['four']))
    elif wp['type'] == 'effect':
        out.update(spell=wp['spell'], kind=wp['kind'], options=effect_options(s, wp['spell']))
    return out


# ------------------------------------------------------------------ AI seats, one turn at a time
def ai_step():
    """Play the next AI seat's whole turn (turn.ai_turn, then turn.advance). Returns the new public log entries."""
    s = st()
    if s['meta'].get('game_over'): return dict(status='over', entries=[])
    if auction(s): return dict(status='auction', entries=[])
    n = s['next']
    if n in humans(s): return dict(status='human', entries=[])
    n0 = len(s['meta'].get('log', []))
    def run(t):
        ev = []
        r = T.ai_turn(t, n, 0, ev)
        if r != 'paused': T.advance(t, ev)
        return r
    r = _commit(run)
    entries = public_log(st(), me())[n0:]
    return dict(status='paused' if r == 'paused' else 'done', who=n, entries=entries)


# ------------------------------------------------------------------ new game (rulebook setup through scripts/deal4.py)
WORKSTATION = '/workspace/lizard-wizard/'          # deal4.py's hardcoded engine root (the worker mounts the engine here)
NEW_GAME = dict(players=['Keith', 'Newt', 'LizWiz'], humans=['Keith'], profiles={'Newt': 'spellslinger', 'LizWiz': 'delver'})
NEW_STATE = '/tmp/lw_web_new_game.json'


def _deal4(argv):
    """Run the engine's setup script scripts/deal4.py exactly as the CLI does (it reads LW_STATE and sys.argv)."""
    import runpy, io, contextlib
    if not os.path.isdir(WORKSTATION + 'cards'): raise Refused(f'new games need the engine at {WORKSTATION}')
    os.makedirs(WORKSTATION + 'assets', exist_ok=True)
    for c in json.load(open(WORKSTATION + 'cards/spells_from_pc.json'))['cards']:   # deal4 only checks these exist
        f = WORKSTATION + 'assets/Spell_' + c['id'] + '.jpg'
        if not os.path.exists(f): open(f, 'wb').close()
    old_argv, old_env = sys.argv, os.environ.get('LW_STATE')
    sys.argv = ['deal4.py'] + [str(a) for a in argv]; os.environ['LW_STATE'] = NEW_STATE
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(os.path.join(ENGINE, 'scripts', 'deal4.py'), run_name='__main__')
    except SystemExit as e:
        if e.code not in (None, 0): raise Refused(str(e.code))
    finally:
        sys.argv = old_argv
        if old_env is None: os.environ.pop('LW_STATE', None)
        else: os.environ['LW_STATE'] = old_env


def new_game_preview(seed=None, ai_seed=None):
    """Setup A-D (deal4 hands): deal 3 reagent cards each, AI seats pick their 2 tokens in secret. Nothing replaces the
    current game until new_game_start. Returns only the human's own hand."""
    rng = random.SystemRandom()
    seed = int(seed) if seed is not None else rng.randrange(10 ** 6)
    ai_seed = int(ai_seed) if ai_seed is not None else rng.randrange(10 ** 6)
    if os.path.exists(NEW_STATE): os.remove(NEW_STATE)
    _deal4(['hands', '--seed', seed, '--ai-seed', ai_seed, '--players', ','.join(NEW_GAME['players']), '--humans', ','.join(NEW_GAME['humans']),
            '--coach', 'game/coaching_log_web.md', '--force'])
    s = json.load(open(NEW_STATE)); m = s['meta']
    ais = [n for n in NEW_GAME['players'] if n not in NEW_GAME['humans']]
    # the same meta scripts/new_game.py writes, plus g8's house rule of public Gold
    m['humans'] = list(NEW_GAME['humans']); m['ai_levels'] = {n: 'normal' for n in ais}
    m['ai_profiles'] = {n: NEW_GAME['profiles'].get(n, 'balanced') for n in ais}
    m['ai_seed'] = ai_seed; m['ai_random'] = True; m['private_mats'] = True; m['show_gold'] = True
    m['mode'] = 'free-for-all (each AI plays only for itself; humans play for themselves)'
    G['setup'] = s
    p = P(s, me())
    return dict(hand=[key(c) for c in p['hand']], reagents=list(REAGENTS), players=list(NEW_GAME['players']))


def new_game_start(picks, seed=None):
    """Setup C for the human (2 different starting reagents), then deal4 board (E-J) and the dungeon, as turn.py does."""
    s = G.get('setup')
    if not s: raise Refused('start a new game first')
    picks = [A.norm(r) for r in picks]
    if len(picks) != 2 or len(set(picks)) != 2 or any(r not in REAGENTS for r in picks): raise Refused('pick 2 different reagents')
    json.dump(s, open(NEW_STATE, 'w'))
    board_seed = int(seed) if seed is not None else random.SystemRandom().randrange(10 ** 6)
    _deal4(['board', '--pick', f"{me()}={picks[0]},{picks[1]}", '--seed', board_seed])
    s = json.load(open(NEW_STATE))
    A.ensure_dungeon(s); s['next'] = s['meta']['seat_order'][0]; s['turn'] = 0
    A.log(s, {'r': 1, 'act': 'turn', 'seat': s['next']})
    A.log(s, {'r': 0, 'act': 'setup_picks', 'picks': {q['name']: list(q['tok']) for q in s['players']}})
    s['meta']['web_pending'] = None
    G['s'] = s; G.pop('setup', None)
    return 'started'


# ------------------------------------------------------------------ JSON entry point for the worker
API = dict(load=load, view=lambda: view(), dump=lambda: dump(), card_db=lambda: card_db(), full_log=lambda: full_log(),
           gather_preview=gather_preview, act_gather=act_gather, act_convert=act_convert, act_convert1=act_convert1,
           act_build=act_build, act_recruit=act_recruit, act_bid=act_bid, act_pass=act_pass, act_research=act_research,
           summon_gather_preview=summon_gather_preview, act_summon=act_summon, act_divination=act_divination,
           choose_new_research=choose_new_research, dungeon_flip=dungeon_flip, dungeon_stop=dungeon_stop,
           dungeon_cancel=dungeon_cancel, resolve_effect=resolve_effect, ai_step=ai_step,
           new_game_preview=new_game_preview, new_game_start=new_game_start)
MUTATING = {k for k in API if k.startswith(('act_', 'choose_', 'dungeon_', 'resolve_'))} | {'new_game_start'}


def call(fn, args_json='{}'):
    """Single entry point: returns JSON {ok, result|error, view?, entries?}. Mutating calls also return the fresh view and the
    public log entries they added."""
    args = json.loads(args_json or '{}')
    try:
        if fn not in API: raise Refused(f'unknown call {fn}')
        n0 = len(st()['meta'].get('log', [])) if fn in MUTATING and G.get('s') else None
        res = API[fn](**args)
        out = dict(ok=True, result=res)
        if fn in MUTATING:
            out['view'] = view()
            # moves the engine made inside this call (e.g. AI turns after an auction), so the UI can announce them
            out['entries'] = public_log(st(), me())[n0:] if n0 is not None and fn != 'new_game_start' else []
    except Refused as e:
        out = dict(ok=False, error=str(e))
    except (ValueError, AssertionError, KeyError, IndexError, TypeError) as e:
        out = dict(ok=False, error=f'{type(e).__name__}: {e}')
    return json.dumps(out)
