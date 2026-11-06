"""Lizard Wizard win-seeking, NON-CHEATING AI policy (Nov 2, 2026).

NO PEEKING. Every decision function takes ONLY a PublicView built by public_view(state, me):
  * all deck lists (reag_list, wiz_list, tow_list, spell_list, fam_list, dungeon_list) become counts (ints);
  * seeds (seed, hands_seed, board_seed) are removed (they would let code re-derive shuffles);
  * other players' hand -> card count; mana/gold -> estimates from the PUBLIC log (20 start + logged converts/triggers
    - auction prices - research/summon costs, +/- mana drain; gold from logged scry/dungeon/summon/transmute/builds);
  * other players' Scry Dungeon 'seen' and Scry deck picks are stripped from the log;
  * reagent tokens stay visible: rulebook p.13 INFORMATION - "Reagents owned by the players must be placed so that all
    players may see them (public information). Each player's Mana and Gold ... are secret". tokens_public=False hides them.
_guard() refuses anything that is not a sealed PublicView for the same player.

All VP numbers come from scoring.py (score / card_value / value_table). Card data comes from cards/carddb.json via
carddb.py (photo transcriptions; spell costs re-checked against all 61 real assets/Spell_*.jpg cost rows on Nov 2, 2026).
Dungeon odds use only the PUBLIC composition: the 53 photographed cards minus the 2 set-aside Traps (plus any Trap!
spells cast), minus treasures publicly kept by players; never the actual order.

Personalities (meta.ai_profiles, reassignable per game; 'random' samples weights from meta.ai_seed):
  balanced, spellslinger, delver, tycoon, random. Weights scale each action category; they fade toward 1.0 when the
  plan stalls or the leader runs away, so every profile stays win-seeking. A seeded softmax over near-equal options
  (meta.ai_seed; the per-decision seed is returned in the action) makes games differ but stay reproducible.
"""
import copy, json, os, math, sys, random
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring as S
try:
    import carddb as CD
except Exception:          # fallback: spells_from_pc.json directly
    CD = None

_R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TOKENS_PUBLIC = True
DECK_KEYS = ('reag_list', 'wiz_list', 'tow_list', 'spell_list', 'fam_list', 'dungeon_list')
SECRET_KEYS = ('seed', 'hands_seed', 'board_seed')
REAGENTS = ['Mandrake', 'Eye_of_Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn']
norm = lambda r: r.replace(' ', '_')
b = os.path.basename

_CARDS = json.load(open(os.path.join(_R, 'cards', 'cards.json')))
WIZ_BONUS = {b(w['image']): norm(w['gather_bonus_reagent']) for w in _CARDS['wizards']['unique_cards']}
WIZ_BY_SCHOOL = {}
for w in _CARDS['wizards']['unique_cards']: WIZ_BY_SCHOOL.setdefault(w['school'], 'assets/' + b(w['image']))
TOWER = {b(t['image']): t for t in _CARDS['towers']['cards']}
TOWER_BY_SCHOOL = {}
for t in _CARDS['towers']['cards']: TOWER_BY_SCHOOL.setdefault(t['school'], 'assets/' + b(t['image']))
FAMILIAR = {b(f['image']): f for f in _CARDS['familiars']['cards']}
_RC = {c['id']: c for c in json.load(open(os.path.join(_R, 'cards', 'reagent_cards.json')))['cards']}
SPELL = {}
for c in json.load(open(os.path.join(_R, 'cards', 'spells_from_pc.json')))['cards']:
    k = 'Spell_' + c['id'] + '.jpg'; cost = c['cast_cost_reagents']; var = any(v == 'X' for v in cost.values())
    lst = [] if var else [norm(r) for r, n in cost.items() for _ in range(int(n))]
    if CD is not None:
        try: lst = CD.cast_cost(k) or []
        except Exception: pass
    SPELL[k] = dict(name=c['name'], school=S.school(k) or c['school'], one_time='1x' in c['duration'], variable=var,
                    cost=lst, effect=c['effect'], copies=int(c.get('copies') or 1))
DUNGEON_CARDS = [x for x in json.load(open(os.path.join(_R, 'assets', 'dungeon_from_photos.json')))['cards']]
NEGATIVE = ('Spell_Flame_Bolt', 'Spell_Disintegrate', 'Spell_Earthquake', 'Spell_Charm', 'Spell_Mana_Drain', 'Spell_Swapo',
            'Spell_Demonic_Possession', 'Spell_Invisibility_Potion', 'Spell_Obscure')
# effects the engine (actions.py / spell_effects.py / ai_sim.py) can resolve automatically; others are valued 0 for effect
ENGINE_EFFECTS = ('Flame_Bolt', 'Disintegrate', 'Earthquake', 'Charm', 'Mana_Drain', 'Creation', 'Spell_Shield', 'Haste',
                  'Wand_Tax', 'Transmute', 'Scry_Wizard', 'Scry_Tower', 'Scry_Familiar', 'Scribe', 'Scry_Dungeon',
                  'Time_Shift', 'Energy_Pulse', 'Invisibility_Potion', 'Swapo')
def sname(img):
    """'Name (School)' for chat text."""
    if CD is not None and CD.get(img): return CD.display(img)
    i = SPELL.get(b(img)); return f"{i['name']} ({i['school']})" if i else b(img)
def cname(img):
    if CD is not None and CD.get(img): return CD.display(img)
    return f"{b(img)[:-4]} ({S.school(img)})"

# ------------------------------------------------------------------ memo (per public call; keyed by object id, pinned)
_MEMO = {}
def _memo(tag, v, *k):
    key = (tag, id(v)) + k
    return _MEMO.get(key, (None, None))
def _put(tag, v, val, *k):
    _MEMO[(tag, id(v)) + k] = (v, val); return val
def _cached(tag):
    def deco(f):
        def g(v, *a):
            o, val = _MEMO.get((tag, id(v)) + a, (None, None))
            if o is v: return val
            return _put(tag, v, f(v, *a), *a)
        g.__name__ = f.__name__; g.__doc__ = f.__doc__; return g
    return deco
def _reset(): _MEMO.clear()
def _vclone(v):
    """Cheap what-if copy of a view: new top-level dict, deep copies of players and tracks only (the parts what-if
    valuations change); meta/log/face-up rows are shared read-only. Keeps PublicView seal + viewer."""
    c = PublicView(v) if isinstance(v, PublicView) else dict(v)
    if isinstance(v, PublicView): c.viewer = v.viewer; c.sealed = v.sealed
    c['players'] = copy.deepcopy(v['players']); c['tracks'] = dict(v['tracks'])
    return c

# ------------------------------------------------------------------ public view + guard
class PublicView(dict):
    """A sealed, deep-copied, public-information-only state for one viewer."""
    __slots__ = ('viewer', 'sealed')
    def __deepcopy__(self, memo):
        c = PublicView(copy.deepcopy(dict(self), memo)); c.viewer = self.viewer; c.sealed = self.sealed; return c

def _ledger(state, name):
    """Mana/Gold estimate for `name` from PUBLIC log events only (logs that start mid-game make this approximate)."""
    mana, gold = 20, 0
    for e in state['meta'].get('log', []):
        a = e.get('act'); who = e.get('who')
        if a in ('convert', 'convert1') and who == name: mana += e.get('gain', 0)
        elif a == 'trigger' and who == name: mana += e.get('gain', 0)
        elif a == 'auction' and e.get('won') == name: mana -= e.get('price', 0)
        elif a == 'research' and who == name: mana -= e.get('paid', e.get('cost', 5))
        elif a == 'summon' and who == name: mana -= e.get('cost', 0); gold += e.get('gold', 0)
        elif a == 'mana_drain':
            if who == name: mana += e.get('n', 0)
            if e.get('target') == name: mana -= e.get('n', 0)
        elif a in ('scry_dungeon', 'dungeon') and who == name:
            gold += sum(c.get('gold', 0) for c in e.get('kept', [])) + e.get('bonus_gold', 0)
        elif a in ('transmute', 'wand_tax') and who == name: gold += e.get('gold', 0)
        elif a == 'invisibility':
            if who == name: gold += e.get('gold', 0)
            if e.get('target') == name: gold -= e.get('gold', 0)
        elif a == 'build' and who == name and e.get('paid') == 'gold':
            gold -= e.get('tier_paid', int(str(e.get('tower', 'Tower_T1'))[7]))
    return max(0, mana), max(0, gold)

def public_view(state, me, tokens_public=TOKENS_PUBLIC):
    # Deep copy everything except the (large, append-only) log; log entries are shared read-only and the ones that
    # carry private info (others' scry results) are replaced by redacted copies below.
    v = {k: copy.deepcopy(x) for k, x in state.items() if k != 'meta'}
    v['meta'] = {k: copy.deepcopy(x) for k, x in state.get('meta', {}).items() if k != 'log'}
    v['meta']['log'] = [dict(e) if str(e.get('act', '')).startswith('scry_') else e for e in state.get('meta', {}).get('log', [])]
    for k in SECRET_KEYS: v.pop(k, None)
    v['meta'].pop('proxy', None)                     # humans' proxy-bid ceilings are secret (turn.py 'max N' / '--max M')
    if isinstance(v['meta'].get('pending'), dict): v['meta']['pending'].pop('proxy', None)
    for k in DECK_KEYS:
        if isinstance(v.get(k), list): v[k] = len(v[k])
    for p in v['players']:
        if p['name'] == me: continue
        p['hand'] = len(p.get('hand', []))
        p['mana'], p['gold'] = _ledger(state, p['name'])
        if not tokens_public: p['tok_count'] = len(p['tok']); p['tok'] = []
        p['_estimated'] = True
    for e in v['meta'].get('log', []):
        if e.get('act') == 'scry_dungeon' and e.get('who') != me: e.pop('seen', None)
        if str(e.get('act', '')).startswith('scry_') and e.get('act') != 'scry_dungeon' and e.get('who') != me: e.pop('took', None)
    pv = PublicView(v); pv.viewer = me; pv.sealed = True
    return pv

# ------------------------------------------------------------------ difficulty levels (all use public_view only)
LEVELS = {
    'easy':   dict(tau=1.6, margin=5.0, shallow=True, bid_mult=0.5, attack_w=0.35, end=False, spend=False, lookahead=0),
    'normal': dict(tau=0.5, margin=1.0, shallow=False, bid_mult=1.0, attack_w=1.0, end=True, spend=True, lookahead=0),
    'hard':   dict(tau=0.12, margin=0.4, shallow=False, bid_mult=1.0, attack_w=1.0, end=True, spend=True, lookahead=3),
    'hard0':  dict(tau=0.12, margin=0.4, shallow=False, bid_mult=1.0, attack_w=1.0, end=True, spend=True, lookahead=0),   # ablation (tests only)
}
_CTX = {'level': 'normal'}
def level_of(v, me): return ((v.get('meta') or {}).get('ai_levels') or {}).get(me, 'normal')
def LV(): return LEVELS.get(_CTX['level'], LEVELS['normal'])

def _guard(view, me):
    if isinstance(view, PublicView) and getattr(view, 'sealed', False) and view.viewer == me: _CTX['level'] = level_of(view, me)
    if not isinstance(view, PublicView) or not getattr(view, 'sealed', False):
        raise PermissionError('AI policy may only read a PublicView from public_view(state, me), never the full state')
    if view.viewer != me: raise PermissionError(f'view belongs to {view.viewer}, not {me}')
    for k in DECK_KEYS:
        if isinstance(view.get(k), list): raise PermissionError(f'hidden deck order {k} present in view')
    for k in SECRET_KEYS:
        if k in view: raise PermissionError(f'secret {k} present in view')
    if 'proxy' in (view.get('meta') or {}): raise PermissionError('secret proxy-bid max present in view')
    for p in view['players']:
        if p['name'] != me and isinstance(p.get('hand'), list): raise PermissionError(f"{p['name']}'s hand visible")

def P(v, n): return [p for p in v['players'] if p['name'] == n][0]
def others(v, me): return [p['name'] for p in v['players'] if p['name'] != me]
def has_cast(p, key): return any(key in x['img'] and x.get('cast') for x in p.get('spells', []))

# ------------------------------------------------------------------ personalities
PROFILES = {
    'balanced':     {},
    'spellslinger': {'research': 1.8, 'cast': 1.9, 'econ': 2.0, 'defense': 1.3, 'attack': 1.2, 'recruit': 0.85, 'dungeon': 0.7, 'familiar': 0.8},
    'delver':       {'familiar': 1.5, 'dungeon': 2.2, 'treasure': 1.8, 'build_gold': 1.6, 'recruit': 0.8, 'research': 0.85, 'econ': 1.1},
    'tycoon':       {'recruit': 1.5, 'deny': 1.8, 'attack': 1.8, 'convert': 1.15, 'build': 1.1, 'dungeon': 0.6, 'econ': 0.8, 'research': 0.85},
}
CATS = ('gather', 'convert', 'recruit', 'build', 'build_gold', 'research', 'cast', 'econ', 'familiar', 'dungeon',
        'treasure', 'attack', 'defense', 'deny')
DEFAULT_PROFILES = {'Newt': 'spellslinger', 'LizWiz': 'delver', 'Gecko': 'tycoon'}
def profile_name(v, me):
    return v['meta'].get('ai_profiles', DEFAULT_PROFILES).get(me, 'balanced')
def profile_weights(v, me):
    """Category weights for my profile, faded toward 1.0 (pure win-seeking) when my plan stalls or the leader runs away."""
    name = profile_name(v, me)
    if name == 'random':
        rng = random.Random(f"{v['meta'].get('ai_seed', 0)}-profile-{me}")
        base = {c: round(rng.uniform(0.7, 1.7), 2) for c in CATS}
    else: base = dict(PROFILES.get(name, {}))
    w = {c: base.get(c, 1.0) for c in CATS}
    fade = 1.0; why = []
    _, top, st = threat_weights(v, me)
    gap = st[me] - st[top]
    if gap < -25: fade *= 0.55; why.append('leader running away')
    elif gap < -12: fade *= 0.85; why.append('falling behind')
    fav = [c for c in CATS if w[c] >= 1.3]
    mine = [e for e in v['meta'].get('log', []) if e.get('who') == me or e.get('won') == me][-6:]
    if fav and len(mine) >= 6 and not any(_act_cat(e) in fav for e in mine): fade *= 0.75; why.append('plan stalled')
    w = {c: 1 + (x - 1) * fade for c, x in w.items()}
    if gap < -25: w['attack'] = max(w['attack'], 1.3); w['deny'] = max(w['deny'], 1.2)
    if LV()['shallow']: w['deny'] = 0.0; w['attack'] = w['attack'] * LV()['attack_w']   # EASY: no denial, rare attacks
    return w, name, why
def _act_cat(e):
    a = e.get('act', '')
    return {'gather': 'gather', 'convert': 'convert', 'convert1': 'convert', 'auction': 'recruit', 'build': 'build',
            'research': 'research', 'cast': 'cast', 'summon': 'familiar', 'dungeon': 'dungeon', 'scry_dungeon': 'dungeon',
            'flame_bolt': 'attack', 'charm': 'attack', 'disintegrate': 'attack', 'earthquake': 'attack', 'mana_drain': 'attack'}.get(a, a)

# ------------------------------------------------------------------ end proximity
DEFAULT_RATE = {'wizard': 0.95, 'tower': 0.6, 'spell': 0.35, 'familiar': 0.15}   # per round, 4 players (g4 observed)
MIN_RATE = {'wizard': 0.5, 'tower': 0.3, 'spell': 0.25, 'familiar': 0.08}
PRIOR_ROUNDS = 6
def supplies(v):
    cnt = lambda x: x if isinstance(x, int) else len(x or [])
    return {'wizard': cnt(v.get('wiz_list')) + len([x for x in v.get('wiz_face', []) if x]),
            'tower': cnt(v.get('tow_list')) + (1 if v.get('tower_face') else 0),
            'spell': cnt(v.get('spell_list')) + len([x for x in v.get('spell_face', []) if x]),
            'familiar': cnt(v.get('fam_list')) + len([x for x in v.get('fam_face', []) if x])}
@_cached('rates')
def depletion_rates(v):
    L = v['meta'].get('log', []); rs = [e['r'] for e in L if isinstance(e.get('r'), int)]
    if not rs: return dict(DEFAULT_RATE)
    span = max(rs) - min(rs) + 1; c = Counter()
    for e in L:
        a = e.get('act')
        if a == 'auction' or (a == 'creation' and e.get('kind') == 'wizards') or a == 'scry_wizards': c['wizard'] += 1
        elif a == 'build' or (a == 'creation' and e.get('kind') == 'towers') or a == 'scry_towers': c['tower'] += 1
        elif a in ('research', 'new_research', 'scry_spells'): c['spell'] += 1
        elif a in ('summon', 'scry_familiars'): c['familiar'] += 1
    return {k: max(MIN_RATE[k], (c[k] + DEFAULT_RATE[k] * PRIOR_ROUNDS) / (span + PRIOR_ROUNDS)) for k in DEFAULT_RATE}
@_cached('rleft')
def rounds_left(v):
    """Estimated full rounds after this one, from public supply counts and observed depletion rates. 0 = final round."""
    if v['meta'].get('game_end_triggered'): return 0.0
    sup, rate = supplies(v), depletion_rates(v)
    est = max(0.0, min(sup[k] / rate[k] for k in sup) - 1.0)
    # Planning horizon cap (Nov 2): a slow table must not talk the AIs into a slow game (self-fulfilling hoarding).
    # Plan as if the game lasts at most ~TARGET_ROUNDS, the length of a normally paced 4-player game.
    return min(est, max(2.0, TARGET_ROUNDS - float(v['meta'].get('round') or 0)))
TARGET_ROUNDS = 32
def my_turns(v):
    """My remaining turns including this one."""
    if v['meta'].get('game_end_triggered'): return 1
    return 1 + int(rounds_left(v) + 0.5)

# ------------------------------------------------------------------ valuation primitives (all VP from scoring.py)
def can_pay(tok, cost):
    have = Counter(tok); return all(have[r] >= k for r, k in Counter(cost).items())
def tower_info(img):
    if CD is not None:
        try: t, r, sc = CD.tower_info(img); return int(t), norm(r), sc
        except Exception: pass
    t = TOWER[b(img)]; return int(t['tier']), norm(t['reagent']), t['school']
def tower_cost(p, img, pay):
    tier, r, _ = tower_info(img)
    if pay == 'gold' and has_cast(p, 'Inexpensive'): tier = max(0, tier - 1)
    if pay != 'gold' and has_cast(p, 'Perfect_Reagent'): tier = max(0, tier - 1)
    return tier, r
def fam_cost(p, img):
    c = FAMILIAR[b(img)]['cost_mana']; return max(0, c - 5) if has_cast(p, 'Summon_Helper') else c

@_cached('cap')
def buy_capacity(v, me):
    """C = VP I can still realistically buy with mana: my remaining buying chances x typical VP per purchase."""
    turns = my_turns(v)
    gains = [S.card_value(v, me, w, 'wizards')[2] for w in v.get('wiz_face', []) if w] + \
            ([S.card_value(v, me, v['tower_face'], 'towers')[2]] if v.get('tower_face') else [])
    pos = [g for g in gains if g > 0]; avg = max(4.0, sum(pos) / len(pos)) if pos else 5.0
    return max(1.0, 1.4 * turns * avg)
def _liquid(v, me, mana, tok):
    """Mana + what my tokens can really be sold for: Convert sells ONE type per action, so the best type counts 90%,
    each further type 0.6x less, and only as many types as I have turns left."""
    per = sorted((v['tracks'][r] * n for r, n in Counter(tok).items()), reverse=True)
    k = max(1, my_turns(v) - 1)
    if has_cast(P(v, me), 'Adept_Conversion'): k *= 2
    return mana + sum(x * 0.9 * (0.6 ** i) for i, x in enumerate(per[:k]))
def wealth(v, me, mana, tok):
    """VP-equivalent of mana+tokens, SATURATING: W = C(1-exp(-X/3C)); unspent mana scores 0, so a pile is worth <= C."""
    if v['meta'].get('game_end_triggered'): return 0.001 * mana
    C = buy_capacity(v, me); X = _liquid(v, me, mana, tok)
    return C * (1 - math.exp(-X / (3 * C)))
@_cached('mpv')
def mana_per_vp(v, me):
    """Marginal mana per VP = 3*exp(X/3C): ~3 early, rising steeply when holding far more than I can spend."""
    if v['meta'].get('game_end_triggered'): return 1000.0
    p = P(v, me); C = buy_capacity(v, me); X = _liquid(v, me, p['mana'], p['tok'])
    return min(1000.0, 3.0 * math.exp(X / (3 * C)))
def mana_for_vp(v, me, total, mana=None):
    """Largest L with wealth(X) - wealth(X-L) <= total VP (exact inverse of the saturating curve)."""
    p = P(v, me); mana = p['mana'] if mana is None else mana
    if total <= 0: return 0
    if v['meta'].get('game_end_triggered'): return mana
    C = buy_capacity(v, me); X = _liquid(v, me, mana, p['tok'])
    inner = total / C + math.exp(-X / (3 * C))
    if inner >= 1: return mana
    return max(0, min(mana, int(X + 3 * C * math.log(inner))))

@_cached('stand')
def standings(v):
    """Public projected strength per player: VP now + half the mana value at that player's own spend rate."""
    return {p['name']: S.score(p, v) + p['mana'] / max(3.0, mana_per_vp(v, p['name'])) * 0.5 for p in v['players']}
@_cached('threat')
def threat_weights(v, me):
    """Weight on each opponent's gains/losses: 1.0 the strongest rival (leader, or closest chaser if I lead),
    0.6 anyone within 12 of that rival, 0.3 the rest."""
    st = standings(v); opp = sorted(others(v, me), key=lambda n: (-st[n], n))
    top = opp[0]; w = {}
    for n in opp: w[n] = 1.0 if n == top else (0.6 if st[top] - st[n] <= 12 else 0.3)
    return w, top, st

def plans(v, me, tok=None, mana=None):
    """Things my tokens could buy soon: (vp_gain, cost_tokens, label). VP from scoring.py."""
    p = P(v, me); tok = p['tok'] if tok is None else tok; mana = p['mana'] if mana is None else mana
    o, val = _MEMO.get(('plans', id(v), me, mana >= 5), (None, None))
    if o is v: return val
    out = []
    if v.get('tower_face'):
        tier, r = tower_cost(p, v['tower_face'], 'reagent'); g = S.card_value(v, me, v['tower_face'], 'towers')[2]
        if g > 0: out.append((g + 0.5, [r] * tier, 'build ' + cname(v['tower_face'])))
    for x in p.get('spells', []):
        if not x.get('cast') and b(x['img']) in SPELL and not SPELL[b(x['img'])]['variable']:
            g = cast_gain(v, me, x['img']); out.append((g, SPELL[b(x['img'])]['cost'], 'cast ' + sname(x['img'])))
    for sp in v.get('spell_face', []):
        if sp and b(sp) in SPELL and not SPELL[b(sp)]['variable'] and mana >= 5:
            g = cast_gain(v, me, sp, owned=False) - 5 / mana_per_vp(v, me)
            if g > 0: out.append((g, SPELL[b(sp)]['cost'], 'research+cast ' + sname(sp)))
    for t in v.get('ach', []):
        if t.startswith('x7 '): out.append((10.0, [norm(t[3:])] * 7, 'achievement ' + t))
    return _put('plans', v, out, me, mana >= 5)

def holdings(v, me, tok, mana=None):
    """VP-equivalent of what I hold: saturating wealth(mana, tokens) + the best plan these tokens fund
    (85% if fully funded now, partial credit by coverage while I still have turns)."""
    mana = P(v, me)['mana'] if mana is None else mana
    base = wealth(v, me, mana, tok); turns = my_turns(v); best = 0.0
    if not v['meta'].get('game_end_triggered'):
        have = Counter(tok)
        for g, cost, _ in plans(v, me, tok, mana):
            need = Counter(cost); got = sum(min(have[r], k) for r, k in need.items()); frac = got / max(1, sum(need.values()))
            val = g * (0.85 if frac >= 1 else (0.5 * frac * frac if turns > 1 else 0))
            best = max(best, val)
    return base + best
token_worth = holdings

def shielded(v, n): return any('Spell_Spell_Shield' in x['img'] and x.get('cast') for x in P(v, n).get('spells', []))

# ------------------------------------------------------------------ dungeon odds from PUBLIC composition
def dungeon_composition(v):
    """Counter of the cards believed to be in the Dungeon deck: 53 photographed minus 2 set-aside Traps, plus Traps added by
    cast Trap! spells, minus every Treasure publicly kept (players' Items; Gold cards logged as kept). Monsters always return."""
    comp = Counter()
    for c in DUNGEON_CARDS:
        if c['type'] == 'Trap': continue
        comp[_dkey(c)] += 1
    comp[('Trap', None)] += sum(1 for p in v['players'] for x in p.get('spells', []) if 'Spell_Trap' in x['img'] and x.get('cast'))
    for p in v['players']:
        for t in p.get('treasures', []): comp[('Item', t.get('name'))] -= 1
    for e in v['meta'].get('log', []):
        if e.get('act') in ('scry_dungeon', 'dungeon'):
            for c in e.get('kept', []):
                if c.get('subtype') == 'Gold': comp[('Gold', c['gold'])] -= 1
    return +comp
def _dkey(c):
    if c['type'] == 'Monster': return ('Monster', c.get('monster_type'))
    if c['type'] == 'Trap': return ('Trap', None)
    return ('Gold', c['gold']) if c.get('subtype') == 'Gold' else ('Item', c.get('name'))
def item_vp(v, me, k=1):
    """VP from k more Items for me (Items majority: most 10, second 5), via scoring.py."""
    o, val = _MEMO.get(('item', id(v), me, k), (None, None))
    if o is v: return val
    return _put('item', v, _item_vp(v, me, k), me, k)
def _item_vp(v, me, k):
    q = copy.deepcopy(P(v, me)); bef = S.score(q, v); q.setdefault('treasures', [])
    vq = _vclone(v); P(vq, me).setdefault('treasures', []).extend([{'type': 'Treasure', 'subtype': 'Item', 'name': '?'}] * k)
    return S.score(P(vq, me), vq) - bef
def dungeon_ev(v, me, hits=0, got_gold=0, got_items=0, depth=7):
    """Expected VP of continuing an expedition optimally from (hits, loot) with draw-again/stop choices
    (with-replacement odds from dungeon_composition). Returns (ev_stop_now, ev_best)."""
    p = P(v, me); comp = dungeon_composition(v); n = sum(comp.values())
    limit = 2 + (1 if has_cast(p, 'Spirit_Shield') else 0)
    blocked = {t for t, k in {'Dungeon Denizen': 'Block_Denizens', 'Giant': 'Block_Giant', 'Goblinoid': 'Block_Goblin', 'Undead': 'Block_Undead'}.items() if has_cast(p, k)}
    ctrl = has_cast(p, 'Control_Undead')
    if not n or not any(k[0] in ('Gold', 'Item') for k in comp): return 0.0, 0.0
    disc = 0.55 if my_turns(v) > 6 else (0.8 if my_turns(v) > 2 else 1.0)    # Items majority is decided at game end
    iv = [0.0] + [item_vp(v, me, k) * disc for k in range(1, 6)]
    outcomes = []
    for (t, sub), c in comp.items():
        pr = c / n
        if t == 'Gold': outcomes.append((pr, 0, sub, 0, 0))
        elif t == 'Item': outcomes.append((pr, 0, 0, 1, 0))
        elif t == 'Trap': outcomes.append((pr, 2, 0, 0, 0))
        elif sub == 'Undead' and ctrl: outcomes.append((pr, 0, 0, 0, 3))
        elif sub in blocked: outcomes.append((pr, 0, 1, 0, 0))
        else: outcomes.append((pr, 1, 0, 0, 0))
    memo = {}
    def val(h, g, it, bonus, d):
        stop = g + iv[min(it, 5)] + bonus
        if d == 0: return stop
        key = (h, g, it, bonus, d)
        if key in memo: return memo[key]
        cont = 0.0
        for pr, dh, dg, di, dv in outcomes:
            nh = h + dh
            cont += pr * (0.0 if nh >= limit else val(nh, g + dg, it + di, bonus + dv, d - 1))
        memo[key] = max(stop, cont); return memo[key]
    entry = 2 if has_cast(p, 'Spell_Treasure') else 0
    return got_gold + iv[min(got_items, 5)] + entry, val(hits, got_gold, got_items, 0, depth) + entry
def dungeon_continue(view, me, hits, drawn):
    """During an expedition: draw again? Uses only the public composition and the cards drawn so far (face up)."""
    _guard(view, me); _reset()
    g = sum(c.get('gold', 0) for c in drawn if c.get('subtype') == 'Gold'); it = sum(1 for c in drawn if c.get('subtype') == 'Item')
    stop, best = dungeon_ev(view, me, hits, g, it)
    return best > stop + 0.25
def scry_dungeon_ev(v, me):
    """Scry Dungeon: 'Look at the top 10 cards ... keep all Treasure Cards' (no risk)."""
    comp = dungeon_composition(v); n = sum(comp.values())
    if not n: return 0.0
    draws = min(10, n); eg = sum(k[1] * c for k, c in comp.items() if k[0] == 'Gold') / n * draws
    ei = sum(c for k, c in comp.items() if k[0] == 'Item') / n * draws
    disc = 0.55 if my_turns(v) > 6 else (0.8 if my_turns(v) > 2 else 1.0)
    return eg + item_vp(v, me, max(0, int(round(ei)))) * disc

# ------------------------------------------------------------------ spell valuation
def _unseen_spells(v):
    pool = Counter({k: i['copies'] for k, i in SPELL.items()})
    for x in v.get('spell_face', []):
        if x: pool[b(x)] -= 1
    for p in v['players']:
        for x in p.get('spells', []): pool[b(x['img'])] -= 1
    for x in v.get('out_of_play', []):
        if 'Spell_' in x: pool[b(x)] -= 1
    return +pool
def future_value(v, me, img):
    """Economy/ongoing value of a spell over my remaining turns (beyond the VP scoring.py already counts), capped at 12."""
    if LV()['shallow']: return 0.0          # EASY: immediate VP only
    return min(12.0, _future_value(v, me, img))
def _future_value(v, me, img):
    k = b(img); T = max(0, my_turns(v) - 1)
    if T == 0: return 0.0
    rate = mana_per_vp(v, me); mv = 1 / rate; g = 0.45 * T
    tokv = sum(v['tracks'].values()) / len(v['tracks']) * mv
    R = depletion_rates(v); p = P(v, me)
    if 'Mana_Garden' in k: return g * 5 * mv
    if 'Bloom' in k: return g * tokv
    if 'Maximum_Gather' in k: return g * 0.8 * tokv
    if 'Crystal_Ball' in k: return 0.05 * T
    if 'Root_Cellar' in k: return (0.15 if len(p['tok']) >= _capacity(p) - 3 else 0.05) * T * tokv * 3
    if 'Mana_Leak' in k: return R['wizard'] * T * 5 * mv
    if 'Mana_Fountain' in k: return R['tower'] * T * 5 * mv
    if 'Energy_Circle' in k: return R['familiar'] * T * 5 * mv
    if 'Energize' in k: return 0.2 * T * 3 * 3 * mv
    if 'Adept_Conversion' in k: return min(6.0, 0.15 * T * 2)
    if 'Transform' in k: return 0.05 * T
    if 'Perfect_Reagent' in k: return 0.25 * T * tokv
    if 'Inexpensive' in k: return 0.12 * T
    if 'Summon_Helper' in k: return 0.15 * T * 5 * mv
    if 'Order_of_the_Wand' in k: return 0.3 * T * 2
    if 'Pulsing_Towers' in k: return 0.25 * T
    if 'Potent_Servant' in k: return 0.1 * T
    if 'Undying' in k: return 0.05 * T * 3
    if 'Arch_Mage' in k: return 0.1 * T * 3
    if 'Hoard_Mana' in k: return 0.0
    entries = 0.08 * T
    if k == 'Spell_Treasure.jpg': return entries * 2
    if 'Block_' in k or 'Control_Undead' in k or 'Spirit_Shield' in k:
        base = dungeon_ev(v, me)[1]
        vq = _vclone(v); P(vq, me)['spells'].append({'img': img, 'cast': True})
        return entries * max(0.0, dungeon_ev(vq, me)[1] - base)
    if 'Divination' in k: return 0.1 * T * dungeon_ev(v, me)[1]
    if 'Secret_Society' in k: return 1.0 if any(b(x).startswith(NEGATIVE) for x in v.get('spell_face', []) if x) else 0.3
    if 'Miracle' in k: return 0.05 * T
    return 0.0

def cast_gain(v, me, img, owned=True):
    """VP gain to me of having `img` cast: scoring.py delta (+5 school matches, ongoing VP spells) + economy future
    value over the remaining turns + modeled one-time effect value."""
    o, val = _MEMO.get(('cg', id(v), me, b(img), owned), (None, None))
    if o is v: return val
    if _INPROGRESS.get(('cg', id(v), me, b(img))): return 0.0     # cycle guard (e.g. Transmute -> holdings -> plans -> Transmute)
    _INPROGRESS[('cg', id(v), me, b(img))] = True
    try: return _cast_gain(v, me, img, owned)
    finally: _INPROGRESS.pop(('cg', id(v), me, b(img)), None)
_INPROGRESS = {}
def _cast_gain(v, me, img, owned):
    q = copy.deepcopy(P(v, me)); before = S.score(q, v)
    spells = [x for x in q.get('spells', []) if not (owned and b(x['img']) == b(img) and not x.get('cast'))]
    spells.append({'img': img, 'cast': True}); q['spells'] = spells
    g = S.score(q, v) - before
    eff, _ = effect_value(v, me, img)
    return _put('cg', v, g + future_value(v, me, img) + eff, me, b(img), owned)

def spell_cat(img):
    k = b(img)
    if k.startswith(NEGATIVE): return 'attack'
    if 'Shield' in k or 'Secret_Society' in k: return 'defense'
    if any(x in k for x in ('Scry_Dungeon', 'Divination', 'Block_', 'Control_Undead', 'Spell_Treasure', 'Spirit_Shield')): return 'dungeon'
    if SPELL.get(k) and not SPELL[k]['one_time']: return 'econ'
    return 'cast'

def effect_value(v, me, img):
    """Best modeled one-time effect of casting `img` now: (VP-equivalent swing, params). Opponents' losses are weighted
    by threat_weights; a cast Spell Shield on the target wastes the attack (only the shield is lost)."""
    k = b(img)
    if not any(e in k for e in ENGINE_EFFECTS): return 0.0, None
    o, val = _MEMO.get(('eff', id(v), me, k), (None, None))
    if o is v: return val
    w, top, _ = threat_weights(v, me); best = (0.0, None); p = P(v, me)
    def loss_if(n, kind, card):
        q = copy.deepcopy(P(v, n)); bef = S.score(q, v); q[kind].remove(card); return bef - S.score(q, v)
    def shield_loss(n):
        q = copy.deepcopy(P(v, n)); bef = S.score(q, v)
        sh = [x for x in q['spells'] if 'Spell_Spell_Shield' in x['img'] and x.get('cast')][0]; q['spells'].remove(sh)
        return bef - S.score(q, v)
    if k.startswith(('Spell_Flame_Bolt', 'Spell_Disintegrate', 'Spell_Earthquake', 'Spell_Charm')):
        kinds = ['towers'] if k.startswith('Spell_Earthquake') else (['wizards'] if k.startswith('Spell_Charm') else ['wizards', 'towers'])
        for n in others(v, me):
            if shielded(v, n):
                val = w[n] * shield_loss(n) + 0.5
                if val > best[0]: best = (val, {'target': n, 'card': None, 'kind': None, 'blocked': True})
                continue
            gap_ = S.score(P(v, n), v) - S.score(p, v)       # knocking a clear leader down is how a trailing player wins
            chase = (1.8 if gap_ >= 20 else 1.5 if gap_ >= 8 else 1.0) if n == top else 1.0
            if LV()['shallow']: chase = 0.5 / max(0.3, w[n])     # EASY: never singles out the leader (flat 0.5 weight)
            for kind in kinds:
                for card in sorted(set(P(v, n).get(kind, []))):
                    val = w[n] * chase * loss_if(n, kind, card)
                    if k.startswith('Spell_Charm'): val += S.card_value(v, me, card, 'wizards')[2]
                    if val > best[0]: best = (val, {'target': n, 'card': card, 'kind': kind, 'blocked': False})
    elif k.startswith('Spell_Mana_Drain'):
        rate = mana_per_vp(v, me)
        for n in others(v, me):
            m = min(15, P(v, n)['mana']); val = 0 if shielded(v, n) else m / rate + w[n] * m / max(3.0, mana_per_vp(v, n))
            if val > best[0]: best = (val, {'target': n})
    elif k == 'Spell_Creation.jpg':
        opts = [(S.card_value(v, me, x, 'wizards')[2], x, 'wizards') for x in v.get('wiz_face', []) if x]
        if v.get('tower_face'): opts.append((S.card_value(v, me, v['tower_face'], 'towers')[2], v['tower_face'], 'towers'))
        for g, x, kind in opts:
            val = g + max([w[n] * S.card_value(v, n, x, kind)[2] for n in others(v, me)] + [0]) * 0.5
            if val > best[0]: best = (val, {'card': x, 'kind': kind})
    elif k.startswith('Spell_Spell_Shield'):
        threat = 0.0
        for n in others(v, me):
            if any(b(x['img']).startswith(NEGATIVE) and not x.get('cast') for x in P(v, n).get('spells', [])): threat += 4.0
        threat += 1.0 * sum(1 for sp in v.get('spell_face', []) if sp and b(sp).startswith(NEGATIVE))
        if not shielded(v, me): best = (min(8.0, threat), None)
    elif k == 'Spell_Haste.jpg':
        best = (min(6.0, buy_capacity(v, me) / max(1.0, 1.4 * my_turns(v))) if my_turns(v) > 1 else 0.0, {'bonus_action': True})
    elif k == 'Spell_Wand_Tax.jpg':
        import spell_effects as SE
        sc = max(sorted({S.school(c) for c in p.get('wizards', []) + p.get('towers', []) if S.school(c)}) or ['Alchemy'],
                 key=lambda s_: SE.school_count(p, s_))
        best = (2.0 * SE.school_count(p, sc), {'school': sc})
    elif k == 'Spell_Transmute.jpg':
        spare = sorted(p['tok'], key=lambda r: v['tracks'][r])[:2 * (len(p['tok']) // 2)]
        best = (len(spare) // 2 - (holdings(v, me, p['tok']) - holdings(v, me, [t for t in p['tok']] and _minus(p['tok'], spare))), {'reagents': spare})
    elif k in ('Spell_Scry_Wizard.jpg', 'Spell_Scry_Tower.jpg'):
        kind = 'wizards' if 'Wizard' in k else 'towers'; BY = WIZ_BY_SCHOOL if kind == 'wizards' else TOWER_BY_SCHOOL
        dk = v.get('wiz_list' if kind == 'wizards' else 'tow_list'); dk = dk if isinstance(dk, int) else len(dk or [])
        if dk: best = (0.8 * max(S.card_value(v, me, img_, kind)[2] for img_ in BY.values()), {'deck': kind})
    elif k == 'Spell_Scry_Familiar.jpg':
        import spell_effects as SE
        dk = v.get('fam_list'); dk = dk if isinstance(dk, int) else len(dk or [])
        if dk: best = (0.6 * max(SE.school_count(p, s_) + 1 for s_ in WIZ_BY_SCHOOL), {'deck': 'familiars'})
    elif k == 'Spell_Scribe.jpg':
        best = (6.0, {'deck': 'spells'})
    elif k == 'Spell_Scry_Dungeon.jpg':
        best = (scry_dungeon_ev(v, me), None)
    elif k == 'Spell_Time_Shift.jpg':
        sup = supplies(v); deck = min(('wizard', 'tower', 'familiar', 'spell'), key=lambda d: (sup[d], d))
        lead = S.score(p, v) - max(S.score(P(v, n), v) for n in others(v, me))
        if lead > 5: best = (min(8.0, 3.0 + lead * 0.15), {'deck': {'wizard': 'wizards', 'tower': 'towers', 'familiar': 'familiars', 'spell': 'spells'}[deck]})
    elif k == 'Spell_Energy_Pulse.jpg':
        val = sum(w[n] * shield_loss(n) for n in others(v, me) if shielded(v, n)) - (shield_loss(me) if shielded(v, me) else 0)
        best = (val, {})
    elif k == 'Spell_Invisibility_Potion.jpg':
        x = p['tok'].count('Eye_of_Newt')
        for n in others(v, me):
            if shielded(v, n): continue
            gl = min(x, P(v, n).get('gold', 0)); val = gl * (1 + w[n]) - x * v['tracks']['Eye_of_Newt'] / mana_per_vp(v, me)
            if val > best[0]: best = (val, {'target': n, 'x': gl})
    elif k == 'Spell_Swapo.jpg':
        for n in others(v, me):
            if shielded(v, n): continue
            for kind in ('wizards', 'towers'):
                for mine in sorted(set(p.get(kind, []))):
                    for th in sorted(set(P(v, n).get(kind, []))):
                        if S.school(mine) == S.school(th): continue
                        a = copy.deepcopy(p); t = copy.deepcopy(P(v, n))
                        bef_a, bef_t = S.score(a, v), S.score(t, v)
                        a[kind].remove(mine); a[kind].append(th); t[kind].remove(th); t[kind].append(mine)
                        val = (S.score(a, v) - bef_a) - w[n] * (S.score(t, v) - bef_t)
                        if val > best[0]: best = (val, {'target': n, 'mine': mine, 'theirs': th, 'kind': kind})
    return _put('eff', v, best, me, k)
def _minus(tok, rem):
    t = list(tok)
    for r in rem: t.remove(r)
    return t

# ------------------------------------------------------------------ wizard valuation and bidding
def _left_of_school(v, sc):
    per = 4 if len(v['players']) >= 4 else (3 if len(v['players']) == 3 else 2)
    seen = sum(1 for p in v['players'] for w in p.get('wizards', []) if S.school(w) == sc)
    seen += sum(1 for w in v.get('wiz_face', []) if w and S.school(w) == sc)
    seen += sum(1 for x in v.get('out_of_play', []) if 'Wizard_' in x and S.school(x) == sc)
    return max(0, per - seen)
def _towers_left_of_school(v, sc):
    per = 4 if len(v['players']) >= 4 else (3 if len(v['players']) == 3 else 2)
    seen = sum(1 for p in v['players'] for t in p.get('towers', []) if S.school(t) == sc)
    seen += (1 if v.get('tower_face') and S.school(v['tower_face']) == sc else 0)
    seen += sum(1 for x in v.get('out_of_play', []) if 'Tower_' in x and S.school(x) == sc)
    return max(0, per - seen)

def wizard_worth(v, me, card):
    """Full marginal worth of a wizard to me, in VP: gain (value_table now), future (face-up tower it would pair with
    that I can afford soon, +5s for uncast spells of its school, pair potential with unseen towers), gather (its bonus
    token over my remaining gathers)."""
    p = P(v, me); sc = S.school(card); turns = my_turns(v); rate = mana_per_vp(v, me)
    gain = S.card_value(v, me, card, 'wizards')[2]
    q = copy.deepcopy(p); q['wizards'].append(card); vq = _vclone(v); P(vq, me)['wizards'].append(card)
    future = 0.0
    tf = v.get('tower_face')
    if tf and turns > 1:
        tier, r = tower_cost(p, tf, 'reagent'); tsc = tower_info(tf)[2]
        if tsc == sc:
            short = max(0, tier - p['tok'].count(r)); pr = 0.8 if short == 0 else (0.5 if short <= 2 and turns > 2 else 0.0)
            future += pr * (S.card_value(vq, me, tf, 'towers')[2] - S.card_value(v, me, tf, 'towers')[2])
    matched_now = S.pairing(q) - S.pairing(p) > 1
    for x in p.get('spells', []):
        if not x.get('cast') and SPELL.get(b(x['img']), {}).get('school') == sc and matched_now and turns > 1:
            future += 5 * (0.8 if can_pay(p['tok'], SPELL[b(x['img'])]['cost']) else 0.4)
    if turns > 3 and len(p.get('wizards', [])) >= len(p.get('towers', [])) and gain <= 1:
        future += 3.0 * min(1.0, _towers_left_of_school(v, sc) / 2) * min(1.0, (turns - 1) / 6)
    bonus = WIZ_BONUS.get(b(card)); gathers = max(0.0, (turns - 1) * 0.45)
    need = sum(1 for g, cost, _ in plans(v, me) if bonus in cost)
    gather = min(4.0, gathers * (v['tracks'].get(bonus, 3) / rate * 0.5 + (0.4 if need else 0.0)))
    return {'gain': gain, 'future': round(future, 2), 'gather': round(gather, 2)}

def reserve_mana(v, me):
    """Mana held back for my own planned research+cast (5 each) while I still have turns to use it."""
    turns = my_turns(v); p = P(v, me)
    if turns <= 1: return 0
    good = [sp for sp in v.get('spell_face', []) if sp and b(sp) in SPELL and not SPELL[b(sp)]['variable']
            and can_pay(p['tok'], SPELL[b(sp)]['cost']) and cast_gain(v, me, sp, owned=False) >= 5]
    return 5 * min(len(good), turns - 1, 2)

def bid_breakdown(v, me, card, kind='wizards'):
    _guard(v, me); _reset()
    return _bid_breakdown(v, me, card, kind)
def rival_limit(v, me, rival, card, kind='wizards'):
    """My PUBLIC-info estimate of what `rival` would pay: the same model run on MY view (their mana = my ledger estimate)."""
    _guard(v, me); _reset()
    return _bid_breakdown(v, rival, card, kind)['limit']
def _bid_breakdown(v, me, card, kind='wizards'):
    o, val = _MEMO.get(('bid', id(v), me, b(card), kind), (None, None))
    if o is v: return val
    p = P(v, me); rate = mana_per_vp(v, me); w, top, st = threat_weights(v, me)
    pw, prof, _ = profile_weights(v, me)
    parts = wizard_worth(v, me, card) if kind == 'wizards' else {'gain': S.card_value(v, me, card, kind)[2], 'future': 0.0, 'gather': 0.0}
    if LV()['shallow']: parts = dict(parts, future=0.0, gather=0.0)
    vt = S.value_table(v, card, kind)
    # (c) replacement: if I pass, the likeliest taker is the rival with the biggest weighted gain who can pay
    # 0.7: the likeliest taker only probably gets it if I pass (someone else may outbid them)
    deny = 0.7 * max([w[n] * vt[n] for n in others(v, me) if P(v, n)['mana'] > 0 and vt[n] > 0] + [0.0])
    scarce = 0.3 * parts['gain'] if kind == 'wizards' and parts['gain'] > 1 and _left_of_school(v, S.school(card)) == 0 else 0.0
    total = (parts['gain'] + parts['future'] + parts['gather'] + scarce) * pw['recruit'] + deny * pw['deny']
    # Leader: buying the last wizard ends the game while I'm ahead -- that is worth paying for (finishing a won game).
    endv = max(0.0, _end_timing(v, me, 'wizard', S.score(p, v) + parts['gain'])[0]) if kind == 'wizards' else 0.0
    total += endv
    usable = max(0, p['mana'] - reserve_mana(v, me))
    if total <= 0: limit = 0
    elif my_turns(v) <= 1 or v['meta'].get('game_end_triggered'): limit = usable   # (b) final turn: spend everything useful
    else: limit = min(usable, mana_for_vp(v, me, total))
    # Early on, a non-critical card may take at most half my usable mana (going broke on round 1 hands every later wizard
    # to the opener for 1). Critical cards (pairs, +4 or more, big denial) are never capped.
    critical = parts['gain'] >= 4 or parts['future'] >= 4.5 or deny >= 4.2
    if not critical and my_turns(v) > 4: limit = min(limit, usable // 2)
    # Hard value cap (fix Nov 2: AIs bid a +1 VP card up to 128 mana on the final turn). Never pay more mana than the VP
    # swing (my gain + denial) is worth at the price of my best ALTERNATIVE use of mana (research+cast a face-up spell,
    # another recruit), bounded to [MIN_ALT_RATE, MAX_ALT_RATE] mana per VP. Applies on the final turn too.
    alt = alt_rate(v, me, card)
    vcap = int(math.ceil(alt * max(0.0, total)))
    limit = min(limit, vcap)
    # Fair-value cap (fix Nov 2, Keith: 'the AIs overbid', e.g. 28-36 mana for +1 VP wizards in g6). The REAL marginal value
    # is my own VP gain now + a discounted share of the speculative parts (future pair potential, gather bonus) + scarcity +
    # end timing, plus a small share of denial; priced at FAIR_RATE mana per VP (what research+cast, towers and familiars
    # cost per VP) plus BID_MARGIN. Public information only (value_table on the public view, rivals' mana = public ledger).
    fair = (parts['gain'] + SPEC_DISCOUNT * parts['future'] + min(parts['gather'], GATHER_CAP) + scarce) * pw['recruit'] \
        + DENY_W * deny * pw['deny'] + endv
    fcap = int(math.ceil(FAIR_RATE * fair)) + BID_MARGIN if fair > 0 else 0
    limit = min(limit, fcap)
    out = dict(parts, end=round(endv, 2), alt_rate=round(alt, 2), value_cap=vcap, fair=round(fair, 2), fair_cap=fcap, deny=round(deny, 2), scarce=round(scarce, 2), total=round(total, 2), rate=round(rate, 2), critical=critical,
               usable=usable, limit=int(min(limit, p['mana'])), flat3=min(p['mana'], 3 * max(0, parts['gain'])), profile=prof)
    return _put('bid', v, out, me, b(card), kind)

MIN_ALT_RATE, MAX_ALT_RATE = 3.0, 6.0
FAIR_RATE, BID_MARGIN, SPEC_DISCOUNT, GATHER_CAP, DENY_W = 3.0, 2, 0.4, 1.5, 0.4
def alt_rate(v, me, card):
    """Mana per VP of my best alternative use of mana this game: research+cast a face-up spell (5 mana + reagents),
    or another face-up wizard at ~3 mana/VP. Clamped to [3, 8]; never the 1000 mana/VP final-turn shadow price."""
    o, val = _MEMO.get(('alt', id(v), me, b(card)), (None, None))
    if o is v: return val
    best = 0.0; p = P(v, me)
    for sp in v.get('spell_face', []) or []:
        if sp and b(sp) in SPELL and not SPELL[b(sp)]['variable'] and can_pay(p['tok'], SPELL[b(sp)]['cost']):
            best = max(best, cast_gain(v, me, sp, owned=False) / 5.0)
    for wz in v.get('wiz_face', []) or []:
        if wz and b(wz) != b(card): best = max(best, S.card_value(v, me, wz, 'wizards')[2] / 3.0)
    r = MAX_ALT_RATE if best <= 0 else min(MAX_ALT_RATE, max(MIN_ALT_RATE, 1.0 / best))
    return _put('alt', v, r, me, b(card))

def bid_limit(view, me, card, kind='wizards'):
    """Max mana I will pay. Never exceeds my mana."""
    lim = bid_breakdown(view, me, card, kind)['limit']
    lim = int(lim * LV()['bid_mult'])                        # EASY: ~half the limit (gives up early)
    return min(P(view, me)['mana'], lim)
def opening_bid(view, me, card, kind='wizards'):
    """No minimum bid in the rulebook: open at 1 (0 = don't open if it's worthless to me)."""
    return 1 if bid_limit(view, me, card, kind) >= 1 else 0
def raise_bid(view, me, card, high, kind='wizards'):
    """(d) Raise by the minimum (+1) while that stays within my limit; otherwise pass (None). Never pass below the limit."""
    lim = bid_limit(view, me, card, kind)
    return high + 1 if high + 1 <= lim else None

# ------------------------------------------------------------------ gather helpers
def needs(v, me):
    p = P(v, me); have = Counter(p['tok']); pr = Counter()
    for g, cost, _ in plans(v, me):
        for r, k in Counter(cost).items():
            short = max(0, k - have[r])
            if short: pr[r] += g * short / max(1, len(cost))
    return pr
def starting_pick(view, me):
    """Rulebook SETUP C: choose 2 unique starting Reagent Tokens. Uses ONLY my own hand (picks are simultaneous, so
    every other player's tokens are ignored even if present): prefer the reagents my hand gathers least (fill gaps),
    then the ones my hand's Increase Value raises most (better convert price), seeded tiebreak (meta.ai_seed)."""
    _guard(view, me)
    g = Counter(); inc = Counter()
    for h in P(view, me)['hand']:
        c = _reagent_card(h)
        for k, n in c['gather_counts'].items(): g[norm(k)] += n
        for k, n in c['increase_counts'].items(): inc[norm(k)] += n
    rng = random.Random(f"{view['meta'].get('ai_seed', 0)}-pick-{me}")
    tb = {r: rng.random() for r in REAGENTS}
    pick = sorted(sorted(REAGENTS, key=lambda r: (g[r], -inc[r], tb[r]))[:2])
    why = f"hand gathers {', '.join(f'{r.replace(chr(95), chr(32))} x{g[r]}' for r in pick)}; fills gaps"
    return pick, why
def _reagent_card(card):
    return _RC[b(card)[:-4] if str(card).endswith('.jpg') or b(card).startswith('Reagent_') else 'Reagent_%02d' % int(card)]
def gather_choice(view, me, card):
    """Which 3 icons to keep from a 4-5 icon card (None if it has <=3)."""
    _guard(view, me); _reset(); return _gather_choice(view, me, card)
def _gather_choice(v, me, card):
    c = _RC[b(card).replace('.jpg', '')] if b(card).startswith('Reagent_') else _reagent_card(card)
    icons = [norm(x) for x in c['gather_icons_in_print_order']]
    if len(icons) <= 3 or has_cast(P(v, me), 'Maximum_Gather'): return None
    pr = needs(v, me); got = Counter()
    pool = list(icons); keep = []
    for _ in range(3):
        r = sorted(pool, key=lambda r: (-(pr[r] / (1 + got[r])), -v['tracks'][r], r))[0]; keep.append(r); pool.remove(r); got[r] += 1
    return keep
def discard_choice(view, me, tokens, over):
    """Which `over` tokens to put back: those least needed by my plans, cheapest on the tracks first."""
    _guard(view, me); _reset(); return _discard_choice(view, me, tokens, over)
def _discard_choice(v, me, tokens, over):
    pr = needs(v, me); plan_need = Counter()
    for g, cost, _ in plans(v, me):
        for r, k in Counter(cost).items(): plan_need[r] = max(plan_need[r], k)
    out = []; pool = list(tokens)
    for _ in range(max(0, over)):
        r = sorted(pool, key=lambda r: (0 if Counter(pool)[r] - plan_need[r] > 0 else 1, pr[r], v['tracks'][r], r))[0]
        out.append(r); pool.remove(r)
    return out
def bloom_choice(v, me):
    pr = needs(v, me)
    return sorted(REAGENTS, key=lambda r: (-pr[r], -v['tracks'][r], r))[0]
def _capacity(p):
    return 10 + len(p.get('towers', [])) + 10 * sum(1 for x in p.get('spells', []) if x.get('cast') and 'Root_Cellar' in x['img'])
def _gather_result(v, me, card):
    p = P(v, me); c = _RC[b(card)[:-4]]
    icons = [norm(x) for x in c['gather_icons_in_print_order']]
    keep = _gather_choice(v, me, card); got = keep if keep else icons
    bonus = [WIZ_BONUS[b(w)] for w in p.get('wizards', []) if b(w) in WIZ_BONUS]
    bl = None
    if has_cast(p, 'Bloom'): bl = bloom_choice(v, me); bonus.append(bl)
    tok = p['tok'] + got + bonus; over = len(tok) - _capacity(p); disc = []
    if over > 0: disc = _discard_choice(v, me, tok, over); [tok.remove(d) for d in disc]
    inc = [norm(x) for x in c['increase_icons_in_print_order']]
    return keep, got + bonus, disc, tok, inc, bl

# ------------------------------------------------------------------ action choice
def _end_timing(v, me, consumes, after_vp_me):
    """Bonus/penalty for draining supplies. Leading: hasten/trigger the end. Trailing: avoid it."""
    if not consumes or v['meta'].get('game_end_triggered') or not LV()['end']: return 0.0, ''
    sup = supplies(v)
    lead = after_vp_me - max(S.score(P(v, n), v) for n in others(v, me))
    if sup[consumes] == 1:
        if lead > 10: return 6.0 + 0.2 * min(lead, 30), 'ends the game while I lead'
        if lead > 0: return 1.0, 'ends the game with a slim lead'
        return -(10.0 + 0.5 * (-lead)), 'would end the game while I trail'
    if lead > 0 and (sup[consumes] == min(sup.values()) or sup[consumes] <= 12):
        # leading: every card off a short supply brings my win closer
        return min(4.0, 0.5 + 10.0 / max(1, sup[consumes]) + 0.05 * min(lead, 30)), 'hastens the end while I lead'
    if lead > 0 and consumes in ('wizard', 'tower'): return 0.4, 'keeps the tempo while I lead'
    if sup[consumes] == min(sup.values()) or sup[consumes] <= 8:
        if sup[consumes] <= 3 and sup[consumes] == min(sup.values()): return -1.0 * (4 - sup[consumes]) / 2, 'speeds the end while I trail'
    return 0.0, ''

def spend_pressure(v, me):
    """Mana beyond what I can usefully spend in my remaining turns is worthless at the end (only a tie-break).
    Returns a VP-per-action bonus for spending on research / recruits / familiars once mana exceeds that."""
    o, val = _MEMO.get(('press', id(v), me), (None, None))
    if o is v: return val
    if not LV()['spend']: return _put('press', v, (0.0, ''), me)      # EASY: happy to sit on mana
    m = P(v, me)['mana']; useful = 8 * min(my_turns(v), 10) + 10    # horizon capped: a slow game must not justify hoarding
    sur = m - useful
    out = (0.0, '') if sur <= 0 else (min(3.0, 0.6 + sur / 30.0), f'spends surplus mana ({m} vs ~{useful} usable)')
    return _put('press', v, out, me)

def refresh_value(v, me):
    """Researching reveals a new face-up spell (refreshes a stale row): ~30% of the expected +5 school bonus of an
    unseen spell for me, from the public composition of unseen spells."""
    o, val = _MEMO.get(('refresh', id(v), me), (None, None))
    if o is v: return val
    pool = _unseen_spells(v); tot = sum(pool.values())
    q = sum(c for k_, c in pool.items() if SPELL[k_]['school'] in _matched(P(v, me))) / tot if tot else 0.0
    return _put('refresh', v, 0.3 * 5 * q + 0.2, me)
def claimable(view, me):
    _guard(view, me)
    import actions as A
    return [t for t in view.get('ach', []) if A.achievement_met(P(view, me), t)]
def _castables(v, me, tok, spells_owned):
    out = []
    for x in spells_owned:
        i = SPELL.get(b(x['img']))
        if x.get('cast') or not i or i['variable'] or not can_pay(tok, i['cost']): continue
        out.append((cast_gain(v, me, x['img']), x['img']))
    return sorted(out, key=lambda t: (-t[0], b(t[1])))
def _cast_params(v, me, img):
    prm = effect_value(v, me, img)[1] or {}
    return {'spell': b(img)[:-4], 'cost': SPELL[b(img)]['cost'], **prm}

def candidates(view, me):
    """All legal actions with (weighted value, raw value, category, action, reason). Public view only."""
    _guard(view, me); _reset(); return _candidates(view, me)
def _candidates(v, me):
    p = P(v, me); w, top, st = threat_weights(v, me); pw, prof, fadewhy = profile_weights(v, me)
    import actions as A
    claims = [t for t in v.get('ach', []) if A.achievement_met(p, t)]
    vp0 = S.score(p, v) + 10 * len(claims)
    tw0 = holdings(v, me, p['tok'])
    last = v['meta'].get('game_end_triggered') or my_turns(v) <= 1
    C = []
    def add(val, cat, act, why, gross=None):
        if gross is not None and gross > 0: wv = val + gross * (pw.get(cat, 1.0) - 1.0)   # weight the benefit, not the net
        else: wv = val * pw.get(cat, 1.0) if val > 0 else val
        C.append((round(wv, 3), round(val, 3), cat, act, why))
    sp_p, sp_why = spend_pressure(v, me)
    # 1) Gather (+ optional ONE cast of an owned spell)
    for h in sorted(p['hand']):
        keep, gained, disc, tok, inc, bl = _gather_result(v, me, h)
        vt = _vclone(v)
        for r in inc: vt['tracks'][r] = min(12, vt['tracks'][r] + 1)
        extra = (5 / mana_per_vp(v, me) if has_cast(p, 'Mana_Garden') else 0)
        base = holdings(vt, me, tok) - tw0 + extra
        act = {'type': 'gather', 'card': b(h)[:-4], 'keep': keep, 'discard': disc, 'bloom': bl}
        why = f"gather {b(h)[:-4]} (+{len(gained)} tokens)"
        if last: base = -0.01
        q = copy.deepcopy(p); q['tok'] = tok; na = [t for t in v.get('ach', []) if t not in claims and A.achievement_met(q, t)]
        if na and not last: base += 8.5; why += f", sets up achievement {na[0]}"
        add(base, 'gather', act, why)
        for cg, cimg in _castables(v, me, tok, p.get('spells', []))[:3]:
            ctok = _minus(tok, SPELL[b(cimg)]['cost'])
            val = (holdings(vt, me, ctok) - tw0 if not last else 0) + cg + extra
            add(val, spell_cat(cimg), dict(act, cast=_cast_params(v, me, cimg)), why + f" and cast {sname(cimg)} (+{cg:.1f})")
    # 2) Convert one type (Adept Conversion: two types; Energize: +3 value first)
    types = sorted(set(p['tok']))
    for r in types:
        n = p['tok'].count(r); en = has_cast(p, 'Energize'); val_r = min(12, v['tracks'][r] + 3) if en else v['tracks'][r]
        gain = val_r * n; tok = [t for t in p['tok'] if t != r]
        vt = _vclone(v); vt['tracks'][r] = max(1, val_r - n)
        add(holdings(vt, me, tok, p['mana'] + gain) - tw0, 'convert', {'type': 'convert', 'reagent': r, 'n': n, 'energize': en},
            f"convert {n} {r} for {gain} mana" + (' (Energize +3)' if en else ''))
    if has_cast(p, 'Adept_Conversion') and len(types) >= 2:
        en_adept = has_cast(p, 'Energize')
        top2 = sorted(types, key=lambda r: (-v['tracks'][r] * p['tok'].count(r), r))[:2]
        r1, r2 = top2; n1, n2 = p['tok'].count(r1), p['tok'].count(r2)
        v1 = min(12, v['tracks'][r1] + 3) if en_adept else v['tracks'][r1]
        gain = v1 * n1 + v['tracks'][r2] * n2
        tok = [t for t in p['tok'] if t not in (r1, r2)]
        vt = _vclone(v); vt['tracks'][r1] = max(1, v1 - n1); vt['tracks'][r2] = max(1, vt['tracks'][r2] - n2)
        add(holdings(vt, me, tok, p['mana'] + gain) - tw0, 'convert', {'type': 'convert2', 'pairs': [(r1, n1), (r2, n2)], 'energize': en_adept},
            f"convert {n1} {r1}" + (" (Energize +3 first)" if en_adept else "") + f" and {n2} {r2} for {gain} mana (Adept Conversion)")
    # 3) Recruit (auction). Starter who loses acts again, so open only when I expect to win.
    for wz in sorted({x for x in v.get('wiz_face', []) if x}):
        bd = _bid_breakdown(v, me, wz)
        if bd['limit'] < 1: continue
        rl = {n: _bid_breakdown(v, n, wz)['limit'] for n in others(v, me)}
        comp = max(list(rl.values()) + [0]); price = min(bd['limit'], comp + 1)
        val = bd['gain'] + bd['future'] + bd['gather'] + bd['deny'] * pw['deny'] - (tw0 - holdings(v, me, p['tok'], p['mana'] - price))
        if comp == bd['limit'] and comp >= 1:
            # Tie at the top: +1 raises reach my limit first about half the time (seat order). Price = my limit.
            val = 0.5 * (bd['gain'] + bd['future'] + bd['gather'] + bd['deny'] * pw['deny']
                         - (tw0 - holdings(v, me, p['tok'], p['mana'] - bd['limit']))) - 0.05
        elif comp + 1 > bd['limit']:
            # I'd be outbid. Opening is then ~neutral: the winner pays about my limit+1 (second price) either way and a lost
            # auction gives my action back. Small negative so it is only picked when nothing else is useful.
            # Deadlock fix (Nov 2): when every AI expects to be outbid nobody opens, wizards never sell and mana piles up.
            # Opening costs no action (a lost auction gives the turn back) and makes the winner pay ~my limit, so it is
            # mildly positive unless the expected winner is my main threat; more so with surplus mana to burn.
            winner = max(rl, key=lambda n: (rl[n], n))
            val = -0.1 if (winner == top and not LV()['spend']) else 0.3 + 0.5 * sp_p - (0.3 if winner == top else 0.0)
        e, ewhy = _end_timing(v, me, 'wizard', vp0 + bd['gain'])
        if val > 0: e += sp_p; ewhy = '; '.join(x for x in (ewhy, sp_why) if x)
        add(val + e, 'recruit', {'type': 'recruit', 'wizard': b(wz), 'open': 1, 'limit': bd['limit']},
            f"recruit {cname(wz)}: +{bd['gain']} VP now, worth {bd['total']} VP total, limit {bd['limit']} mana" + (f"; {ewhy}" if ewhy else ''))
    # 4) Research only / research and cast
    if p['mana'] >= 5:
        for sp in sorted({x for x in v.get('spell_face', []) if x}):
            i = SPELL.get(b(sp))
            if not i: continue
            g = cast_gain(v, me, sp, owned=False); cat = spell_cat(sp)
            e, ewhy = _end_timing(v, me, 'spell', vp0)
            e += sp_p + refresh_value(v, me); ewhy = '; '.join(x for x in (ewhy, sp_why) if x)
            after5 = holdings(v, me, p['tok'], p['mana'] - 5)
            if i['variable'] and b(sp) == 'Spell_Invisibility_Potion.jpg':
                eff = effect_value(v, me, sp)
                if eff[1] and eff[1].get('x'):
                    add(eff[0] - (tw0 - after5) + e, 'attack', {'type': 'research', 'spell': b(sp)[:-4], 'cast': ['Eye_of_Newt'] * eff[1]['x'], **eff[1]},
                        f"research and cast {sname(sp)} stealing {eff[1]['x']} Gold from {eff[1]['target']}")
            elif can_pay(p['tok'], i['cost']):
                tok = _minus(p['tok'], i['cost'])
                add(g - (tw0 - holdings(v, me, tok, p['mana'] - 5)) + e, cat, {'type': 'research', **_cast_params(v, me, sp), 'cast': i['cost']},
                    f"research and cast {sname(sp)}: +{g:.1f} VP-equiv" + (f"; {ewhy}" if ewhy else ''))
            if not last and not i['variable']:
                short = sum((Counter(i['cost']) - Counter(p['tok'])).values())
                pr = 0.55 if short <= 2 and my_turns(v) > 2 else (0.3 if my_turns(v) > 4 else 0.1)
                later = sum(v['tracks'][r] for r in i['cost']) / mana_per_vp(v, me)
                add((g - later) * pr - (tw0 - after5) + e, 'research', {'type': 'research', 'spell': b(sp)[:-4], 'cast': None},
                    f"research {sname(sp)} to cast later (short {short} reagents)" + (f"; {ewhy}" if ewhy else ''))
    # 5) Build the face-up tower (reagents or Gold)
    tf = v.get('tower_face')
    if tf:
        g = S.card_value(v, me, tf, 'towers')[2]; vt_ = S.value_table(v, tf, 'towers')
        tier, r = tower_cost(p, tf, 'reagent'); gt, _ = tower_cost(p, tf, 'gold'); base_tier = tower_info(tf)[0]
        deny = max([w[n] * vt_[n] for n in others(v, me) if P(v, n)['tok'].count(r) >= base_tier or P(v, n)['gold'] >= base_tier] + [0])
        e, ewhy = _end_timing(v, me, 'tower', vp0 + g)
        if p['tok'].count(r) >= tier:
            q = _vclone(v); P(q, me)['towers'].append(tf); q['tower_face'] = None
            val = g + 0.3 + deny * pw['deny'] - (tw0 - holdings(q, me, _minus(p['tok'], [r] * tier)))
            add(val + e, 'build', {'type': 'build', 'pay': 'reagent'}, f"build {cname(tf)} with {tier} {r}: +{g} VP" + (f", denies {deny:.0f}" if deny else '') + (f"; {ewhy}" if ewhy else ''))
        if p.get('gold', 0) >= gt:
            add(g - gt + 0.3 + deny * pw['deny'] + e, 'build_gold', {'type': 'build', 'pay': 'gold'}, f"build {cname(tf)} with {gt} Gold: +{g} VP, -{gt} Gold VP")
    # 6) Summon a familiar: score / gather+cast / dungeon / new research
    dun_ok = sum(c for k_, c in dungeon_composition(v).items() if k_[0] in ('Gold', 'Item')) > 0
    for f in sorted({x for x in v.get('fam_face', []) if x}):
        F = FAMILIAR.get(b(f)); cost = fam_cost(p, f) if F else 99
        if not F or p['mana'] < cost: continue
        import spell_effects as SE
        n = SE.school_count(p, F['school']) + 1
        e, ewhy = _end_timing(v, me, 'familiar', vp0 + n)
        e += 0.8 * sp_p
        after = holdings(v, me, p['tok'], p['mana'] - cost); circ = 5 / mana_per_vp(v, me) if has_cast(p, 'Energy_Circle') else 0
        add(n - (tw0 - after) + e + circ, 'familiar', {'type': 'summon', 'familiar': b(f), 'use': 'score'},
            f"summon {cname(f)} for {cost} mana, score use: +{n} Gold (= {n} VP)" + (f"; {ewhy}" if ewhy else ''))
        if dun_ok:
            ev = dungeon_ev(v, me)[1]
            add(ev - (tw0 - after) + e + circ, 'dungeon', {'type': 'summon', 'familiar': b(f), 'use': 'dungeon'},
                f"summon {cname(f)} for {cost} mana and enter the Dungeon (EV {ev:.1f} VP from public composition)", gross=ev)
        if not last:
            pool = _unseen_spells(v); tot = sum(pool.values())
            if tot >= 4:
                q_ = sum(c for k_, c in pool.items() if SPELL[k_]['school'] in _matched(p)) / tot
                ev = (5 * (1 - (1 - q_) ** 4) + 2) * 0.6 + 5 / mana_per_vp(v, me)
                add(ev - (tw0 - after) + e + circ, 'research', {'type': 'summon', 'familiar': b(f), 'use': 'research'},
                    f"summon {cname(f)} for {cost} mana: New Research (free spell from 4 fresh)")
            tok = p['tok'] + [norm(F['reagent'])] * int(F['collect']); casts = []; ctot = 0.0
            for cg, cimg in _castables(v, me, tok, p.get('spells', [])):
                if cg > 0 and can_pay(tok, SPELL[b(cimg)]['cost']):
                    tok = _minus(tok, SPELL[b(cimg)]['cost']); casts.append(_cast_params(v, me, cimg)); ctot += cg
            over = len(tok) - _capacity(p); disc = _discard_choice(v, me, tok, over) if over > 0 else []
            tok = _minus(tok, disc)
            add(holdings(v, me, tok, p['mana'] - cost) - tw0 + ctot + e + circ, 'cast' if casts else 'familiar',
                {'type': 'summon', 'familiar': b(f), 'use': 'gather', 'cast': casts, 'discard': disc},
                f"summon {cname(f)} for {cost} mana, gather {F['collect']} {F['reagent']}" + (f" and cast {len(casts)} spell(s)" if casts else ''))
    # 7) Divination: enter the Dungeon as an action without a familiar
    if has_cast(p, 'Divination') and dun_ok:
        ev = dungeon_ev(v, me)[1]
        add(ev, 'dungeon', {'type': 'dungeon'}, f"enter the Dungeon via Divination (EV {ev:.1f} VP)", gross=ev)
    if not C: add(0, 'pass', {'type': 'pass'}, 'no legal action')
    return C, claims, prof, fadewhy, top, vp0
def _matched(p):
    from collections import Counter as Cn
    W = Cn(S.school(c) for c in p.get('wizards', [])); T = Cn(S.school(c) for c in p.get('towers', []))
    return {s_ for s_ in W if s_ and T[s_]}

SOFTMAX_MARGIN = 1.0; SOFTMAX_TAU = 0.5
def choose_action(view, me):
    """Return (action dict, one-line reason). Seeded softmax over options within SOFTMAX_MARGIN VP of the best
    (meta.ai_seed + me + round + log length -> reproducible; meta.ai_random=False -> pure argmax)."""
    _guard(view, me); _reset()
    v = view
    lvl = level_of(v, me); L = LEVELS.get(lvl, LEVELS['normal'])
    C, claims, prof, fadewhy, top, vp0 = _candidates(v, me)
    C.sort(key=lambda c: (-c[0], json.dumps(c[3], sort_keys=True, default=str)))
    seed = f"{v['meta'].get('ai_seed', 0)}-{me}-{v['meta'].get('round')}-{len(v['meta'].get('log', []))}"
    la_note = ''
    if L['lookahead'] and len(C) > 1:
        C, la_note = _lookahead(v, me, C, L['lookahead'], seed)
        _CTX['level'] = lvl
    pick = C[0]
    if v['meta'].get('ai_random', True):
        near = [c for c in C if c[0] >= C[0][0] - L['margin']]
        if len(near) > 1:
            rng = random.Random(seed); ws = [math.exp((c[0] - C[0][0]) / L['tau']) for c in near]
            x = rng.random() * sum(ws); acc = 0
            for c, wt in zip(near, ws):
                acc += wt
                if x <= acc: pick = c; break
    wv, val, cat, act, why = pick
    act = dict(act, claim=claims, value=wv, category=cat, profile=prof, level=lvl, rng_seed=seed)
    if la_note: why = f"{why} ({la_note})"
    lead = vp0 - max(S.score(P(v, n), v) for n in others(v, me))
    tag = f"[{lvl} {prof}{' (' + ', '.join(fadewhy) + ')' if fadewhy else ''}; {'lead' if lead > 0 else 'trail'} {lead:+d} vs {top}, ~{rounds_left(v):.1f} rounds left, {mana_per_vp(v, me):.1f} mana/VP]"
    return act, f"{why} {tag}" + (f"; claims {', '.join(claims)}" if claims else '')

def pick_new_research(view, me):
    """After New Research reveals 4 fresh face-up spells (public), take the best for me."""
    _guard(view, me); _reset()
    opts = [x for x in view['spell_face'] if x and b(x) in SPELL]
    return b(max(opts, key=lambda x: (cast_gain(view, me, x, owned=False), b(x))))[:-4]
def pick_scry(view, me, cards, kind):
    """Scry Wizard/Tower/Familiar/Scribe: choose among the 5 cards ONLY the caster sees (passed in, not in the view)."""
    _guard(view, me); _reset()
    if kind == 'spells': return max(cards, key=lambda x: (cast_gain(view, me, x, owned=False), b(x)))
    if kind == 'familiars':
        import spell_effects as SE
        return max(cards, key=lambda x: (SE.school_count(P(view, me), FAMILIAR[b(x)]['school']), -FAMILIAR[b(x)]['cost_mana'], b(x)))
    return max(cards, key=lambda x: (S.card_value(view, me, x, kind)[2], b(x)))


# ------------------------------------------------------------------ HARD: 1-ply lookahead on determinized PUBLIC info
def _all_reagent_paths(): return ['assets/%s.jpg' % k for k in sorted(_RC)]
def determinize(view, me, rng):
    """A full game state SAMPLED from my public view: hidden decks / other hands are drawn at random from the publicly
    known unseen pools (counts in the view), never from the real hidden order. Others' mana/gold = my ledger estimate."""
    s = json.loads(json.dumps(dict(view), default=str))
    mine = P(s, me)
    seen = Counter(b(x) for x in mine['hand'] + s.get('reag_discard', []) + s.get('reag_played', []))
    pool = []
    for x in _all_reagent_paths():
        if seen[b(x)] > 0: seen[b(x)] -= 1
        else: pool.append(x)
    rng.shuffle(pool)
    for p in s['players']:
        p.pop('_estimated', None); p.pop('tok_count', None)
        if p['name'] != me:
            n = p['hand'] if isinstance(p['hand'], int) else len(p['hand']); p['hand'] = pool[:n]; pool = pool[n:]
    s['reag_list'] = pool[:view.get('reag_list', 0) if isinstance(view.get('reag_list'), int) else len(pool)]
    def unseen(allk, owned_key, face):
        c = Counter(allk)
        for x in face: c[b(x)] -= 1
        for p in s['players']:
            for x in p.get(owned_key, []): c[b(x if isinstance(x, str) else x.get('img', ''))] -= 1
        for x in s.get('out_of_play', []): c[b(x)] -= 1
        return [k for k, n in (+c).items() for _ in range(n)]
    cnt = lambda k: view.get(k) if isinstance(view.get(k), int) else 0
    wz = unseen(list(WIZ_BONUS), 'wizards', [x for x in s.get('wiz_face', []) if x]); rng.shuffle(wz)
    s['wiz_list'] = ['assets/' + k for k in wz[:cnt('wiz_list')]]
    tw = unseen(list(TOWER), 'towers', [s['tower_face']] if s.get('tower_face') else []); rng.shuffle(tw)
    tw.sort(key=lambda k: tower_info(k)[0]); s['tow_list'] = ['assets/' + k for k in tw[:cnt('tow_list')]]
    fm = unseen(list(FAMILIAR), 'familiars', [x for x in s.get('fam_face', []) if x]); rng.shuffle(fm)
    fm.sort(key=lambda k: FAMILIAR[k].get('cost', 0)); s['fam_list'] = ['assets/' + k for k in fm[:cnt('fam_list')]]
    sp = [k for k, n in _unseen_spells(view).items() for _ in range(n)]; rng.shuffle(sp)
    s['spell_list'] = ['assets/' + k for k in sp[:cnt('spell_list')]]
    byk = {}
    for c in DUNGEON_CARDS: byk.setdefault(_dkey(c), c)
    dk = [copy.deepcopy(byk[k]) for k, n in dungeon_composition(view).items() if k in byk for _ in range(n)]; rng.shuffle(dk)
    s['dungeon_list'] = dk[:cnt('dungeon_list')] if cnt('dungeon_list') else dk
    s['seed'] = rng.randint(1, 10 ** 9)
    return s

def _margin(s, me):
    """My VP-equivalent standing minus the best opponent's, all from MY public view of the simulated state."""
    v = public_view(s, me); _guard(v, me); _reset()
    H = {p['name']: S.score(p, v) + holdings(v, p['name'], p['tok'], p['mana']) for p in v['players']}
    return H[me] - max(H[n] for n in others(v, me))

def _next_best(s, me):
    """Value of my best option on my NEXT turn in the simulated position (captures set-ups: a gather that enables a
    build, a research that enables a cast). Public view of the simulated state only."""
    v = public_view(s, me); _guard(v, me); _reset()
    C = _candidates(v, me)[0]
    return max([c[1] for c in C] + [0.0])

def _sim_apply(s, who, act):
    import ai_sim as SIM
    if act['type'] == 'recruit':
        SIM.run_auction(s, who, act['wizard']); return
    if act['type'] == 'pass': return
    SIM.apply_action(s, who, act, [], Counter())

LA_WEIGHT = float(os.environ.get('LW_LA_W', 0.5)); LA_SAMPLES = int(os.environ.get('LW_LA_S', 2)); LA_BUDGET = 0.6   # seconds
def _lookahead(v, me, C, k, seed):
    """Re-rank my top-k candidates: apply each on a determinized copy, let every opponent answer once with the NORMAL
    policy (their public view of that copy), and compare my resulting margin. Adds the margin difference to the value."""
    import time as _t
    t0 = _t.time(); top = C[:k]; rng = random.Random(seed + '-la'); res = []
    # Replies from the two players who matter most: the next seat (acts right after me) and my strongest rival.
    _, rival, _ = threat_weights(v, me); order = v['meta']['seat_order']; i = order.index(me)
    nxt = (order[i + 1:] + order[:i])[0]; responders = [n for n in order[i + 1:] + order[:i] if n in (nxt, rival)]
    base_states = [determinize(v, me, rng) for _ in range(LA_SAMPLES)]
    for c in top:
        if res and _t.time() - t0 > LA_BUDGET: res.append(None); continue     # time budget: unevaluated -> neutral
        tot = 0.0; used = 0
        for bs in base_states:
            if used and _t.time() - t0 > LA_BUDGET: break                     # budget: fewer samples for this option
            used += 1
            s = json.loads(json.dumps(bs)); s['meta']['ai_levels'] = {}; s['meta']['ai_random'] = False
            try:
                _sim_apply(s, me, c[3])
                for n in responders:
                    a2, _ = choose_action(public_view(s, n), n); _sim_apply(s, n, a2)
                tot += _margin(s, me) + _next_best(s, me)
            except Exception:
                tot += -50.0
        res.append(tot / max(1, used))
    done = [r for r in res if r is not None]; mean = sum(done) / len(done)
    res = [mean if r is None else r for r in res]
    out = [(round(c[0] + LA_WEIGHT * (r - mean), 3),) + tuple(c[1:]) for c, r in zip(top, res)] + list(C[k:])
    out.sort(key=lambda c: (-c[0], json.dumps(c[3], sort_keys=True, default=str)))
    best = max(range(len(top)), key=lambda j: res[j])
    return out, f"hard lookahead over {len(top)} options x replies by {'+'.join(responders)}: best margin {res[best] - mean:+.1f} for {top[best][2]}"
