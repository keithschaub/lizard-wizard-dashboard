"""AI-vs-AI driver for Lizard Wizard. The DRIVER holds the full state and applies the rules via actions.py /
spell_effects.py; every decision is made by ai_policy on public_view(state, player) only (plus, for Scry spells,
the 5 cards only the caster is allowed to see)."""
import json, os, sys, subprocess, copy
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import actions as A, ai_policy as AI, scoring as S, spell_effects as SE
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P = A.P

def seat_from(s, starter):
    order = s['meta']['seat_order']; i = order.index(starter); return order[i:] + order[:i]

def run_auction(s, starter, wiz):
    """Clockwise English auction from the starter. No minimum bid; passed players can't re-enter; bids <= mana."""
    views = {n: AI.public_view(s, n) for n in s['meta']['seat_order']}
    order = seat_from(s, starter); high, who, tail = 0, None, []
    ob = AI.opening_bid(views[starter], starter, wiz)
    if ob: high, who = ob, starter; tail.append([starter, ob])
    else: tail.append([starter, 'pass'])
    active = [n for n in order if n != starter or ob]; i = 1
    two = len(order) == 2                # rulebook 2-player duel: the starter may only bid ONCE
    while who is not None and active != [who]:
        n = order[i % len(order)]; i += 1
        if n not in active or n == who: continue
        if two and n == starter: active.remove(n); tail.append([n, 'pass']); continue
        nb = AI.raise_bid(views[n], n, wiz, high)
        if nb is None or nb > P(s, n)['mana']: active.remove(n); tail.append([n, 'pass'])
        else: high, who = nb, n; tail.append([n, nb])
    if who is None: return None
    A.recruit(s, who, wiz, high, starter=starter, bids=tail)
    return who

def resolve_effect(s, me, key, prm=None):
    """Resolve a just-cast spell's effect; targets re-chosen from MY public view at resolve time."""
    k = os.path.basename(key if key.endswith('.jpg') else ('Spell_' + key.replace('Spell_', '') + '.jpg'))
    v = AI.public_view(s, me); AI._reset(); val, p2 = AI.effect_value(v, me, 'assets/' + k)
    prm = p2 or prm or {}
    if k.startswith(('Spell_Flame_Bolt', 'Spell_Disintegrate', 'Spell_Earthquake', 'Spell_Charm')):
        if not prm.get('target'): return
        t = prm['target']
        if prm.get('blocked'):
            A.shield_blocks(s, t); A.log(s, {'r': s['meta']['round'], 'who': me, 'act': k[6:-4].lower() + '_blocked', 'target': t}); return
        if k.startswith('Spell_Flame_Bolt'): A.flame_bolt(s, me, t, prm['card'], prm['kind'])
        elif k.startswith('Spell_Disintegrate'): A.disintegrate(s, me, t, prm['card'], prm['kind'])
        elif k.startswith('Spell_Earthquake'): A.earthquake(s, me, t, prm['card'])
        else: A.charm(s, me, t, prm['card'])
    elif k.startswith('Spell_Mana_Drain') and prm.get('target'): A.mana_drain(s, me, prm['target'])
    elif k == 'Spell_Creation.jpg' and prm.get('card'): A.creation(s, me, prm['card'], prm['kind'])
    elif k == 'Spell_Wand_Tax.jpg': SE.wand_tax(s, me, prm.get('school', 'Alchemy'))
    elif k == 'Spell_Transmute.jpg' and prm.get('reagents'): SE.transmute(s, me, [r for r in prm['reagents'] if r in P(s, me)['tok']][:len(prm['reagents'])])
    elif k in ('Spell_Scry_Wizard.jpg', 'Spell_Scry_Tower.jpg', 'Spell_Scry_Familiar.jpg', 'Spell_Scribe.jpg'):
        deck = {'Spell_Scry_Wizard.jpg': 'wizards', 'Spell_Scry_Tower.jpg': 'towers', 'Spell_Scry_Familiar.jpg': 'familiars', 'Spell_Scribe.jpg': 'spells'}[k]
        pick = SE.scry_deck(s, me, deck, lambda top: AI.pick_scry(AI.public_view(s, me), me, top, deck), cast_free=(deck == 'spells'))
        if deck == 'spells' and pick:
            pk = os.path.basename(pick)
            if pk.endswith('.jpg'):
                pk = pk[:-4]
            img = pick if str(pick).startswith('assets/') else 'assets/' + (pk if pk.endswith('.jpg') else pk + '.jpg')
            _, prm2 = AI.effect_value(AI.public_view(s, me), me, img)
            resolve_effect(s, me, pk, prm2)
    elif k == 'Spell_Scry_Dungeon.jpg': A.scry_dungeon(s, me)
    elif k == 'Spell_Time_Shift.jpg' and prm.get('deck'): SE.time_shift(s, me, prm['deck'])
    elif k == 'Spell_Energy_Pulse.jpg': SE.energy_pulse(s, me)
    elif k == 'Spell_Swapo.jpg' and prm.get('target'): SE.swapo(s, me, prm['target'], prm['mine'], prm['theirs'], prm['kind'])
    return prm

ATTACKS = ('Flame_Bolt', 'Disintegrate', 'Earthquake', 'Charm', 'Mana_Drain', 'Swapo', 'Invisibility_Potion')
def is_attack(spell): return any(a in str(spell) for a in ATTACKS)

def claim_all(s, me):
    for t in AI.claimable(AI.public_view(s, me), me): A.claim_achievement(s, me, t)

def delve_cont(s, me):
    return lambda hits, drawn: AI.dungeon_continue(AI.public_view(s, me), me, hits, drawn)

def apply_action(s, me, act, trace, mix):
    t = act['type']; cat = act.get('category', t)
    if t == 'gather':
        # Rulebook p.11 (fix Nov 2): the ONE spell cast with a gather is paid BEFORE the storage check, so pass its cost as
        # spend= (gather then only returns the put-backs still needed); fall back to a plain gather if it can't be paid.
        sp = [A.norm(r) for r in act['cast']['cost']] if act.get('cast') else None
        try: A.gather(s, me, act['card'], keep=act.get('keep'), discard=act.get('discard'), bloom=act.get('bloom'), spend=sp)
        except ValueError as e:
            if not sp: raise
            A.gather(s, me, act['card'], keep=act.get('keep'), discard=act.get('discard'), bloom=act.get('bloom'))
        mix['gather'] += 1
        claim_all(s, me)                     # 'On your turn, if you meet' an x7 tile: claim before the cast spends the tokens
        if act.get('cast'):
            c = act['cast']
            if AI.can_pay(P(s, me)['tok'], c['cost']):
                A.cast_spell(s, me, c['spell'], c['cost']); mix['cast'] += 1; resolve_effect(s, me, c['spell'], c)
                if is_attack(c['spell']): mix['attack'] += 1
                if 'Haste' in c['spell']: return 'bonus'
    elif t == 'convert':
        (SE.energized_convert if act.get('energize') else A.convert)(s, me, act['reagent'], act['n']); mix['convert'] += 1
    elif t == 'convert2':
        pairs = act['pairs']
        A.convert_adept(s, me, pairs, energize_first=act.get('energize', False)); mix['convert'] += 1
    elif t == 'research':
        if act.get('cast') and 'Invisibility' in act['spell']:
            A.research(s, me, act['spell'])
            SE.invisibility_potion(s, me, act['target'], act['x']); mix['research'] += 1; mix['cast'] += 1; mix['attack'] += 1
        else:
            A.research(s, me, act['spell'], cast_cost=act.get('cast')); mix['research'] += 1
            if act.get('cast'):
                mix['cast'] += 1; resolve_effect(s, me, act['spell'], act)
                if cat == 'attack' or is_attack(act['spell']): mix['attack'] += 1
                if 'Scry_Dungeon' in act['spell']: mix['dungeon'] += 1
                if 'Haste' in act['spell']: return 'bonus'
    elif t == 'build': A.build_tower(s, me, pay=act['pay']); mix['build'] += 1
    elif t == 'summon':
        mix['familiar'] += 1; use = act['use']
        if use == 'score': A.summon_familiar(s, me, act['familiar'], 'score')
        elif use == 'dungeon': A.summon_familiar(s, me, act['familiar'], 'dungeon', cont=delve_cont(s, me)); mix['dungeon'] += 1
        elif use == 'research':
            A.summon_familiar(s, me, act['familiar'], 'research', choose=lambda st: AI.pick_new_research(AI.public_view(st, me), me)); mix['research'] += 1
        else:
            casts = [(c['spell'], c['cost']) for c in act.get('cast', [])]
            A.summon_familiar(s, me, act['familiar'], 'gather', cast=casts, discard=act.get('discard'), after_collect=lambda: claim_all(s, me))
            for c in act.get('cast', []):
                mix['cast'] += 1; resolve_effect(s, me, c['spell'], c)
                if is_attack(c['spell']): mix['attack'] += 1
    elif t == 'dungeon': SE.dungeon_delve(s, me, delve_cont(s, me)); mix['dungeon'] += 1
    return None

def take_turn(s, me, trace, mix):
    claim_all(s, me); bonus = 0
    for attempt in range(6):
        act, why = AI.choose_action(AI.public_view(s, me), me)
        trace.append((s['meta']['round'], me, why))
        if act['type'] == 'recruit':
            mix['recruit_open'] += 1
            won = run_auction(s, me, act['wizard'])
            trace.append((s['meta']['round'], me, f"  auction {act['wizard'][7:-4]} -> {won} @ {s['meta']['log'][-1].get('price') if won else '-'}"))
            A.check_end(s)
            if won == me: mix['recruit'] += 1; break
            continue
        try: res = apply_action(s, me, act, trace, mix)
        except (AssertionError, ValueError) as e:
            trace.append((s['meta']['round'], me, f"  ILLEGAL {act['type']}: {e}")); mix['illegal'] += 1; break
        A.check_end(s)
        if res == 'bonus' and bonus == 0: bonus = 1; trace.append((s['meta']['round'], me, '  Haste: bonus action')); continue
        break
    claim_all(s, me); A.check_end(s)

def new_game(seed, path=None):
    path = path or f'/tmp/aisim_{seed}_{os.getpid()}.json'
    env = dict(os.environ, LW_STATE=path); py = sys.executable; d = os.path.join(R, 'scripts', 'deal4.py')
    subprocess.run([py, d, 'hands', '--seed', str(seed), '--humans', 'nobody'], env=env, check=True, capture_output=True)
    subprocess.run([py, d, 'board', '--seed', str(seed + 1)], env=env, check=True, capture_output=True)
    s = json.load(open(path)); s['meta']['humans'] = []
    return s

def play(seed=4242, profiles=None, max_rounds=60, ai_seed=None, levels=None):
    s = new_game(seed)
    s['meta']['ai_profiles'] = profiles or {'Keith': 'balanced', 'Newt': 'spellslinger', 'LizWiz': 'delver', 'Gecko': 'tycoon'}
    s['meta']['ai_seed'] = seed if ai_seed is None else ai_seed; s['meta']['ai_random'] = True
    s['meta']['ai_levels'] = dict(levels or {})      # per seat: easy | normal | hard (default normal)
    trace = []; mix = {n: Counter() for n in s['meta']['seat_order']}
    while s['meta']['round'] <= max_rounds:
        for n in s['meta']['seat_order']: take_turn(s, n, trace, mix[n])
        if s['meta'].get('game_end_triggered'): break
        s['meta']['round'] += 1
    final = {p['name']: (S.score(p, s), p['mana']) for p in s['players']}
    return s, trace, final, mix

if __name__ == '__main__':
    s, tr, fin, mix = play(int(sys.argv[1]) if len(sys.argv) > 1 else 4242)
    for t in tr: print(t)
    print(fin); print({n: dict(m) for n, m in mix.items()})
