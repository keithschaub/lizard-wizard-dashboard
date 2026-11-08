"""One-command turn runner for the Lizard Wizard chat game (Nov 2, 2026). ANY human seat (meta.humans) can act:
the first word names the acting human (keith, john, ...). Default game: g6 (game/g6_state.json, 3 players: Keith (human),
Newt + LizWiz (AI Normal)); --game g5 (abandoned 2-human game) and --game g4 (or --state PATH) still work.

  python3 scripts/turn.py john gather 12 --keep Horn Horn Sulphur      (John acts exactly like Keith)
  python3 scripts/turn.py john bid 9 | john pass                       (John answers an auction waiting on him)
  python3 scripts/turn.py keith pick Horn Mandrake                     (setup C: 2 unique starting tokens; board is
                                                                         dealt once every human has picked)

  python3 scripts/turn.py keith gather 44 --keep Eye_of_Newt Toadstool Mandrake --discard Horn Horn
  python3 scripts/turn.py keith "build Azure_Tower reagent"          (or: build gold)
  python3 scripts/turn.py keith convert Horn 3
  python3 scripts/turn.py keith convert1 Horn,Sulphur
  python3 scripts/turn.py keith research Spell_Shield_A --cast       (cast cost comes from carddb)
  python3 scripts/turn.py keith research Flame_Bolt_S --cast --target Newt --card Tower_T3_Ivory_Spire --kind towers
  python3 scripts/turn.py keith recruit Anguis_Magicus 3             (opens an auction at 3)
  python3 scripts/turn.py keith bid 7 | keith pass                   (answer a pending auction; ONE step at a time, no max/proxy)
  python3 scripts/turn.py keith summon Familiar_5_Imp score|gather [--cast Spell_X] [--discard ...]
  python3 scripts/turn.py keith claim "x7 Horn"                      (claim an achievement; not an action)
  python3 scripts/turn.py keith ai        (just run AI seats from state['next'])
  python3 scripts/turn.py keith show --brief   (full TURN PACKAGE for the current position; changes nothing, re-renders)
  python3 scripts/turn.py keith summon Familiar_10_Imp dungeon --draws N --preview --brief   (dungeon card by card: shows the
                                          first N draws on an in-memory copy, saves NOTHING; commit with the same --draws N)
  python3 scripts/turn.py keith options   (print the summary/options only; changes nothing)
  python3 scripts/turn.py keith level Newt hard   (AI difficulty per seat: easy/normal/hard; default normal; not an action)
  python3 scripts/turn.py --level hard keith ai   (or --level Newt=hard,Gecko=easy; saved in meta.ai_levels)
Flags: --game g4|g5|g6 (default g6) or --state PATH (TEST ON COPIES), --out PREFIX, --coach PATH, --no-render, --no-ai, --note TEXT,
  --brief (compact text output instead of JSON), --coach-rating "good|mixed|weak: note" (rated coaching entry, no TODO)

TURN PACKAGE (--brief, refactor Nov 2 2026; see turn_package.py): HEAD, YOU, OPP (one line per opponent turn, never
empty), OCAST (enhanced card + carddb text), ACH, END, BOARD:, MATS:, OPTIONS (grouped, every affordable action),
WIDGET (top 6), CARD lines, QC (exit code 3 on any FAIL) and the CHECKLIST to follow.

It applies Keith's action through actions.py (backup to a unique /tmp file first, coaching-log stub appended), then plays
the AI seats in order (ai_policy.choose_action on public_view only; placeholder AI if ai_policy is missing) until it is
Keith's turn again or an auction needs Keith's bid (stored in meta.pending). Then it renders (render4.py, which also
writes /tmp/qc_* thumbnails) and prints ONE JSON summary: events, scores, Keith's options, image + QC paths.
"""
import json, os, sys, time, shlex, copy, argparse, subprocess, shutil, itertools
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
R = os.path.normpath(os.path.join(HERE, '..')) + '/'
GAMES = {'g4': R + 'game/g4_state.json', 'g5': R + 'game/g5_state.json', 'g6': R + 'game/g6_state.json', 'g7': R + 'game/g7_state.json', 'g8': R + 'game/g8_state.json'}
DEFAULT_GAME = 'g8'
REAL_STATE = GAMES[DEFAULT_GAME]
REAGENTS = ['Mandrake', 'Eye_of_Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn']
import actions as A, scoring as S, carddb as CD, spell_effects as SE, turn_package as TP
try:
    import ai_policy as AI
    for _f in ('choose_action', 'public_view', 'bid_limit', 'opening_bid', 'raise_bid'): assert hasattr(AI, _f), _f
    AI_ENGINE = 'ai_policy'
except Exception as _e:  # pragma: no cover
    AI = None; AI_ENGINE = f'PLACEHOLDER (ai_policy unavailable: {_e})'
try:
    import ai_sim as SIM
except Exception:
    SIM = None
b = os.path.basename
def nice(r): return str(r).replace('_', ' ')
def disp(img): return CD.display(img)
T0 = time.time(); TIMING = {}
def lap(k): TIMING[k] = round(time.time() - T0, 3)

# ------------------------------------------------------------------ helpers
def humans(s): return s['meta'].get('humans', ['Keith'])
def order_from(s, starter):
    o = s['meta']['seat_order']; i = o.index(starter); return o[i:] + o[:i]
def view(s, n): return AI.public_view(s, n)
def save(s, path):
    tmp = path + '.tmp'; json.dump(s, open(tmp, 'w'), indent=1); os.replace(tmp, path)

def check_turn_invariants(s, seat):
    """Engine invariant: verify at most one main action per turn (except bonus actions like Haste).
    
    Main actions are: recruit (auction), build, research, summon, gather, convert, or cast.
    Bonus actions from Haste or similar effects are allowed.
    
    BUG FIX: Added to catch the round-27 four-auctions bug where one AI turn ran 4 recruits."""
    log = s['meta'].get('log', [])
    current_round = s['meta'].get('round')
    
    # Find the last turn marker for this seat in this round
    turn_start_idx = None
    for i in range(len(log) - 1, -1, -1):
        e = log[i]
        if e.get('act') == 'turn' and e.get('seat') == seat and e.get('r') == current_round:
            turn_start_idx = i
            break
    
    if turn_start_idx is None:
        return  # No turn marker found (shouldn't happen, but be safe)
    
    # Count main actions since that turn marker
    main_actions = []
    for i in range(turn_start_idx + 1, len(log)):
        e = log[i]
        if e.get('act') == 'turn':
            break  # Next turn started
        
        # Main actions (excluding auctions where the seat didn't start it)
        act = e.get('act')
        who = e.get('who')
        
        if act == 'auction':
            # Only count auctions where this seat was the starter
            # (other players' auctions in multi-way bidding don't count)
            # We need to look at the auction log to see who started it
            # The auction log has 'who' as winner, so we need starter info
            # Actually, auctions are logged after resolution, so check text or use prior knowledge
            # For now, count all recruit actions by this seat
            pass  # Will count via recruit actions below
        elif act in ('build', 'research', 'summon', 'gather', 'convert') and who == seat:
            main_actions.append((act, who, e.get('r')))
        elif act == 'cast' and who == seat:
            # Cast can be a main action (research + cast) or a bonus (gathered enough)
            # For now, don't count standalone casts as they're usually free after gather
            pass
    
    # Count auctions started by this seat
    auctions_started = []
    for i in range(turn_start_idx + 1, len(log)):
        e = log[i]
        if e.get('act') == 'turn':
            break
        if e.get('act') == 'auction' and e.get('starter') == seat:
            # Count only auctions where this seat was the starter
            auctions_started.append((e.get('item'), e.get('won')))
    
    # Rulebook: starter wins -> turn ends; starter loses -> takes another action.
    # Legal patterns:
    #   - 1 main action (no auctions)
    #   - 1 auction won by starter (turn ends)
    #   - 1 auction lost by starter + 1 more action (could be another auction or build/gather/etc)
    # 
    # ILLEGAL pattern (the round-27 bug):
    #   - Multiple consecutive auctions where the starter keeps losing and starting new ones
    #     This happens when after_auction recursively calls ai_turn, bypassing attempt limits.
    
    # The key insight: if you LOSE an auction, you get ONE more action. Not unlimited.
    # So you can have at most: lost, lost, won (2 lost + 1 won = 3 auctions max)
    # But the round-27 bug had: lost, lost, lost, won (3 lost + 1 won = 4 auctions)
    
    # Simpler rule: total auctions per turn <= 2 (one initial + one retry if lost)
    # OR: count sequences where seat loses then tries again
    
    # Even simpler: Multiple auctions in one turn is ONLY legal if it's:
    #   - 1 lost auction followed by 1 more auction (won or lost)
    # So max 2 auctions per turn.
    
    if len(auctions_started) > 2:
        items = ', '.join(f"{item} (won by {winner})" for item, winner in auctions_started)
        raise AssertionError(
            f"INVARIANT VIOLATION: {seat} started {len(auctions_started)} auctions in round {current_round}: {items}. "
            f"Rule: starter loses -> gets ONE retry, so max 2 auctions per turn. "
            f"This is the round-27 four-auctions bug!"
        )
    
    # If there are 2 auctions, the first must have been lost
    if len(auctions_started) == 2:
        if auctions_started[0][1] == seat:  # First auction won by this seat
            raise AssertionError(
                f"INVARIANT VIOLATION: {seat} won the first auction but then started another in round {current_round}. "
                f"Rule: starter wins -> turn ends. Auctions: {auctions_started}"
            )
    
    # If there's 1 auction (won or lost) and other main actions, that's wrong
    if len(auctions_started) == 1 and main_actions:
        # Unless the auction was lost (then 1 more action is allowed)
        if auctions_started[0][1] == seat:  # Won the auction
            raise AssertionError(
                f"INVARIANT VIOLATION: {seat} won an auction but also did {len(main_actions)} other actions "
                f"in round {current_round}. Rule: starter wins -> turn ends. Main actions: {main_actions}"
            )
        elif len(main_actions) > 1:  # Lost the auction but did 2+ other actions
            raise AssertionError(
                f"INVARIANT VIOLATION: {seat} lost an auction but then did {len(main_actions)} other actions "
                f"in round {current_round}. Rule: starter loses -> ONE more action. Main actions: {main_actions}"
            )

def advance(s, events):
    """Seat after s['next'] acts. End of round: game ends if the end was triggered, else next round."""
    o = s['meta']['seat_order']; i = o.index(s['next'])
    
    # INVARIANT CHECK: verify this turn didn't have multiple main actions
    check_turn_invariants(s, s['next'])
    
    auto_claim(s, s['next'])                       # end of this seat's turn: claim any met achievement
    A.check_end(s)
    if i == len(o) - 1:
        if s['meta'].get('game_end_triggered'):
            s['meta']['game_over'] = True
            A.log(s, {'r': s['meta']['round'], 'act': 'game_over'}); return
        s['meta']['round'] += 1; s['next'] = o[0]
    else: s['next'] = o[i + 1]
    s['turn'] = o.index(s['next'])
    # Reset the human retry counter for the new turn
    s['meta']['human_retry_count'] = 0
    A.log(s, {'r': s['meta']['round'], 'act': 'turn', 'seat': s['next']})   # turn marker: lets the package recap EVERY turn
    if s['next'] in humans(s): auto_claim(s, s['next'])   # start of a human's turn: claim before they act
def auto_claim(s, who):
    """Keith rule (Nov 2, 2026): after every turn, auto-claim every Achievement tile a seat meets (free, +10 VP, never bad)."""
    p = A.P(s, who)
    for t in [x for x in s.get('ach', []) if A.achievement_met(p, x)]:
        A.claim_achievement(s, who, t)

# ------------------------------------------------------------------ auctions (Keith may be asked mid-auction)
def start_auction(s, starter, wiz, opening, resume=None):
    wiz = [w for w in s['wiz_face'] if w and b(w) == CD.key(wiz)]
    if not wiz: raise SystemExit(f'ERROR: that wizard is not on offer; face-up: {[disp(w) for w in s["wiz_face"] if w]}')
    wiz = wiz[0]; order = order_from(s, starter)
    a = dict(type='auction', card=wiz, starter=starter, order=order, high=0, who=None, active=list(order), i=1, tail=[], resume=resume)
    if opening is None: a['active'].remove(starter); a['tail'].append([starter, 'pass'])
    else: a['high'], a['who'] = int(opening), starter; a['tail'].append([starter, int(opening)])
    return a
# Proxy / max bidding REMOVED (Keith, Nov 2 2026: it reveals his ceiling and feels like cheating). Every human bid is asked
# one step at a time.
PROXY_MARKS = []          # kept empty for old callers
AUCTION_RESULTS = []      # dicts for every auction resolved this run
def auction_run(s, a):
    """Advance the auction. Returns ('need', name) when a human must answer, or ('done', winner_or_None).
    2-player duel (rulebook): the starter may only bid once."""
    two = len(a['order']) == 2
    while True:
        live = [n for n in a['active'] if n != a['who']]
        if not live or (a['who'] and a['active'] == [a['who']]): break
        n = a['order'][a['i'] % len(a['order'])]; a['i'] += 1
        if n not in a['active'] or n == a['who']: continue
        if two and n == a['starter'] and any(x[0] == n and isinstance(x[1], int) for x in a['tail']):
            a['active'].remove(n); a['tail'].append([n, 'pass']); continue
        if n in humans(s):
            a['i'] -= 1; a['waiting'] = n; s['meta']['pending'] = a; return 'need', n
        nb = AI.raise_bid(view(s, n), n, a['card'], a['high']) if AI else None
        if nb is None or nb > A.P(s, n)['mana']: a['active'].remove(n); a['tail'].append([n, 'pass'])
        else: a['high'], a['who'] = nb, n; a['tail'].append([n, nb])
    s['meta']['pending'] = None; s['meta'].pop('proxy', None)
    marks = set()
    AUCTION_RESULTS.append(dict(card=disp(a['card']), started_by=a['starter'], winner=a['who'], price=a['high'] if a['who'] else None,
                                bids=[dict(who=n, bid=v, proxy=i in marks) for i, (n, v) in enumerate(a['tail'])]))
    if a['who'] is None:
        A.log(s, {'r': s['meta']['round'], 'act': 'auction_nobid', 'item': b(a['card'])[7:-4], 'starter': a['starter']}); return 'done', None
    A.recruit(s, a['who'], a['card'], a['high'], starter=a['starter'], bids=a['tail']); A.check_end(s)
    return 'done', a['who']
def auction_waiting_on(s, a):
    """The human whose bid the paused auction needs (stored by auction_run; derived for older states)."""
    if a.get('waiting'): return a['waiting']
    o = a['order']; i = a['i']
    for k in range(len(o)):
        n = o[(i + k) % len(o)]
        if n in a['active'] and n != a['who'] and n in humans(s): return n
def human_answer(s, a, who, ans):
    p = A.P(s, who)
    if ans == 'pass': a['active'].remove(who); a['tail'].append([who, 'pass'])
    else:
        nb = int(ans)
        if nb < 1: raise SystemExit('ERROR: a bid must be at least 1 mana')
        if nb <= a['high'] and a['who'] is not None: raise SystemExit(f'ERROR: bid must beat {a["high"]}')
        if nb > p['mana']: raise SystemExit(f'ERROR: you only have {p["mana"]} mana')
        a['high'], a['who'] = nb, who; a['tail'].append([who, nb])
    a['i'] += 1

# ------------------------------------------------------------------ AI seats
def resolve_effect(s, me, key):
    if SIM: return SIM.resolve_effect(s, me, key)
def claim_all(s, me):
    if AI:
        for t in AI.claimable(AI.public_view(s, me), me): A.claim_achievement(s, me, t)
def placeholder_action(s, me):
    """PLACEHOLDER AI (only used when ai_policy.py is missing): gather the first hand card, keep first 3 icons,
    put back the cheapest tokens if over storage."""
    p = A.P(s, me); c = p['hand'][0]; g, _ = CD.reagent_icons(c)
    keep = g[:3] if len(g) > 3 else None; got = (keep or g) + [CD.wizard_bonus(w) for w in p.get('wizards', [])]
    over = len(p['tok']) + len(got) - A.capacity(p)
    disc = sorted(p['tok'] + got, key=lambda r: s['tracks'][r])[:over] if over > 0 else None
    return {'type': 'gather', 'card': c, 'keep': keep, 'discard': disc}, 'PLACEHOLDER AI: gathered its first card'
def _apply_fallback(s, me, act, events):
    """Used only if ai_sim.apply_action is unavailable."""
    t = act['type']
    if t == 'gather':
        A.gather(s, me, act['card'], keep=act.get('keep'), discard=act.get('discard'))
        if act.get('cast'): c = act['cast']; A.cast_spell(s, me, c['spell'], c['cost']); resolve_effect(s, me, c['spell'])
    elif t == 'convert': A.convert(s, me, act['reagent'], act['n'])
    elif t == 'convert2':
        A.convert_adept(s, me, act['pairs'], energize_first=act.get('energize', False))
    elif t == 'research':
        A.research(s, me, act['spell'], cast_cost=act.get('cast'))
        if act.get('cast'): resolve_effect(s, me, act['spell'])
    elif t == 'build': A.build_tower(s, me, pay=act['pay'])
    elif t == 'summon':
        if act['use'] == 'dungeon':
            A.summon_familiar(s, me, act['familiar'], 'dungeon', cont=lambda h, d: AI.dungeon_continue(AI.public_view(s, me), me, h, d))
        elif act['use'] == 'research':
            A.summon_familiar(s, me, act['familiar'], 'research', choose=lambda st: AI.pick_new_research(AI.public_view(st, me), me))
        elif act['use'] != 'gather': A.summon_familiar(s, me, act['familiar'], act['use'])
        else:
            A.summon_familiar(s, me, act['familiar'], 'gather', cast=[(c['spell'], c['cost']) for c in act.get('cast', [])], discard=act.get('discard'))
            for c in act.get('cast', []): resolve_effect(s, me, c['spell'])
    elif t == 'pass': events.append(f'{me} passed (no legal action)')
    else: events.append(f'NOTE: turn.py does not know AI action type {t!r}; {me} did nothing')
    return None
def ai_turn(s, me, attempt=0, events=None, bonus=0, auction_retry=False):
    """Mirrors ai_sim.take_turn (6 attempts, Haste bonus, illegal -> end turn) but pauses auctions for Keith.
    Returns 'paused' (auction needs Keith) or 'done'."""
    if attempt == 0: claim_all(s, me)
    while attempt < 6:
        act, why = AI.choose_action(AI.public_view(s, me), me) if AI else placeholder_action(s, me)
        t = act['type']
        if t == 'recruit':
            ob = AI.opening_bid(view(s, me), me, act['wizard']) if AI else 1
            if not ob: attempt += 1; continue            # starter would open at 0: no auction (same as ai_sim)
            a = start_auction(s, me, act['wizard'], ob,
                              resume={'actor': me, 'attempt': attempt, 'bonus': bonus, 'retried': auction_retry})
            st, who = auction_run(s, a)
            if st == 'need':
                # Auction paused for human: increment attempt NOW before returning, so when we
                # resume via after_auction, the attempt count is correct and we don't loop forever.
                # NOTE: this increment will be stored in the resume dict, but after_auction was
                # incorrectly calling ai_turn recursively. See fix below.
                return 'paused'
            if who == me: break
            attempt += 1; continue
        try:
            if SIM and hasattr(SIM, 'apply_action'): res = SIM.apply_action(s, me, act, [], Counter())
            else: res = _apply_fallback(s, me, act, events)
        except (AssertionError, ValueError) as e:
            events.append(f'NOTE: {me} tried an illegal {t} ({e}); turn ends'); break
        if not AI: events.append(f'{me}: ' + why)
        A.check_end(s)
        if res == 'bonus' and bonus == 0: bonus = 1; attempt += 1; continue
        break
    claim_all(s, me); A.check_end(s); return 'done'
def after_auction(s, a, winner, events):
    """Rulebook: starter wins -> their turn ends; starter loses -> starter takes one more action."""
    st = a['starter']
    if st in humans(s):
        if winner == st: advance(s, events); return run_ais(s, events)
        
        # BUG FIX: Track how many times this human has retried this turn to prevent unlimited auctions
        retry_count = s['meta'].get('human_retry_count', 0)
        if retry_count >= 1:
            # Already retried once this turn - can't retry again!
            events.append(f'{st} lost the auction but has already retried once this turn; turn ends.')
            advance(s, events); return run_ais(s, events)
        
        s['meta']['again'] = True
        s['meta']['human_retry_count'] = retry_count + 1
        events.append(f'{st} lost the auction {st} started, so {st} takes another action.')
        return 'human'
    if winner == st:
        claim_all(s, st); A.check_end(s)
        advance(s, events); return run_ais(s, events)
    # Resume the AI starter after a human wins (or nobody bids). The resume data
    # preserves the attempt budget across the pause. An attempt of 1 means the
    # one permitted retry has already happened, so a second lost auction ends
    # the turn instead of recursively opening unlimited auctions.
    resume = a.get('resume') or {}
    attempt = int(resume.get('attempt', 0))
    if resume.get('retried', False):
        events.append(f'{st} lost the auction but has already retried once this turn; turn ends.')
        claim_all(s, st); A.check_end(s)
        advance(s, events); return run_ais(s, events)
    events.append(f'{st} lost the auction, so {st} takes another action.')
    r = ai_turn(s, st, attempt + 1, events, int(resume.get('bonus', 0)), auction_retry=True)
    if r == 'paused': return 'auction'
    claim_all(s, st); A.check_end(s)
    advance(s, events); return run_ais(s, events)
NO_AI = False
PREVIEW = False
def run_ais(s, events):
    while not s['meta'].get('game_over'):
        if NO_AI: return 'stopped (--no-ai)'
        n = s['next']
        if n in humans(s): return 'human'
        if ai_turn(s, n, 0, events) == 'paused': return 'auction'
        advance(s, events)
    return 'over'

# ------------------------------------------------------------------ setup C picks (humans), then deal the board
def pick_tokens(s, me, argv, path, events):
    """Rulebook SETUP C: each player selects 2 unique Reagent Tokens. Picks are secret until every human has picked;
    then deal4.py board deals E-J (new random board seed, logged) and the dungeon is built (actions.ensure_dungeon)."""
    if s['meta'].get('phase') != 'picks': raise SystemExit('ERROR: starting picks are over')
    if not argv or argv[0].lower() != 'pick': raise SystemExit(f"ERROR: setup: every human picks 2 unique starting reagents first: '{me.lower()} pick R1 R2'")
    toks = [A.norm(CD_norm(x)) for x in argv[1:]]
    if len(toks) != 2 or len(set(toks)) != 2 or any(x not in REAGENTS for x in toks):
        raise SystemExit(f'ERROR: pick exactly 2 DIFFERENT reagents from {REAGENTS}')
    p = A.P(s, me); p['tok'] = toks
    s['meta']['pending'] = [x for x in s['meta'].get('pending', []) if not x.startswith(me + ' ')]
    waiting = [n for n in humans(s) if len(A.P(s, n)['tok']) != 2]
    if waiting: return 'pick', f'picked starting reagents {nice(toks[0])}, {nice(toks[1])}'
    save(s, path)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'deal4.py'), 'board'], env=dict(os.environ, LW_STATE=path), capture_output=True, text=True)
    if r.returncode: raise SystemExit('ERROR: deal4 board failed: ' + (r.stderr or r.stdout)[-400:])
    s.clear(); s.update(json.load(open(path)))
    A.ensure_dungeon(s); s['next'] = s['meta']['seat_order'][0]; s['turn'] = 0
    A.log(s, {'r': 1, 'act': 'turn', 'seat': s['next']})
    A.log(s, {'r': 0, 'act': 'setup_picks', 'picks': {q['name']: list(q['tok']) for q in s['players']}})
    events.append('Everyone has picked; starting reagents revealed: ' + '; '.join(f"{q['name']} {nice(q['tok'][0])}, {nice(q['tok'][1])}" for q in s['players']))
    events.append(f"Board dealt (board seed {s.get('board_seed')}). Round 1: {s['next']} to act.")
    return 'human', f'picked starting reagents {nice(toks[0])}, {nice(toks[1])}'
def CD_norm(x): return {'eye': 'Eye_of_Newt', 'eye_of_newt': 'Eye_of_Newt', 'eyeofnewt': 'Eye_of_Newt'}.get(x.lower().replace(' ', '_'), x[:1].upper() + x[1:].lower() if '_' not in x else x)

# ------------------------------------------------------------------ a human's action (any human seat)
def keith_action(s, me, argv, events):
    ap = argparse.ArgumentParser(prog=f'turn.py {me.lower()}', add_help=False)
    ap.add_argument('verb'); ap.add_argument('args', nargs='*')
    ap.add_argument('--keep', nargs='+'); ap.add_argument('--discard', nargs='+'); ap.add_argument('--cast', nargs='*')
    ap.add_argument('--target'); ap.add_argument('--card'); ap.add_argument('--mine'); ap.add_argument('--kind'); ap.add_argument('--cost')
    ap.add_argument('--max', type=int, dest='maxbid'); ap.add_argument('--draws', type=int, help='dungeon: stop after this many cards (human decides card by card)')
    ap.add_argument('--take', help='New Research: the spell Keith takes from the 4 new face-up spells')
    o = ap.parse_args(argv); v = o.verb.lower(); x = o.args; p = A.P(s, me)
    pend = s['meta'].get('pending')
    if isinstance(pend, dict) and pend.get('type') == 'auction':
        waiting = auction_waiting_on(s, pend)
        if waiting != me: raise SystemExit(f"ERROR: the auction for {disp(pend['card'])} is waiting on {waiting}'s bid, not {me}'s; use '{str(waiting).lower()} bid N' or '{str(waiting).lower()} pass'")
        if v == 'max' or o.maxbid is not None: raise SystemExit('ERROR: max/proxy bidding is disabled (Keith rule): ask for ONE bid at a time (bid N or pass)')
        if v not in ('bid', 'pass'): raise SystemExit(f"ERROR: an auction for {disp(pend['card'])} is waiting on your bid (high {pend['high']}); use 'bid N' or 'pass'")
        if v == 'bid' and (len(x) != 1 or not x[0].isdigit()): raise SystemExit('ERROR: usage: bid N')
        human_answer(s, pend, me, 'pass' if v == 'pass' else x[0]); dsc = f"{'pass' if v == 'pass' else 'bid ' + x[0]} on {disp(pend['card'])}"
        st, who = auction_run(s, pend)
        if st == 'need': return 'auction', dsc
        return after_auction(s, pend, who, events), dsc
    if v == 'max' or o.maxbid is not None: raise SystemExit('ERROR: max/proxy bidding is disabled (Keith rule): ask for ONE bid at a time')
    if v in ('bid', 'pass'): raise SystemExit('ERROR: no auction is waiting on you')
    if v == 'claim':
        A.claim_achievement(s, me, ' '.join(x)); return 'human', f"claim {' '.join(x)}"
    if s['next'] != me: raise SystemExit(f"ERROR: it is {s['next']}'s turn, not {me}'s")
    s['meta'].pop('again', None)
    def cast_effect(img):
        k = CD.key(img); base = (CD.get(k) or {}).get('base', '')
        if k.startswith(('Spell_Flame_Bolt', 'Spell_Disintegrate', 'Spell_Earthquake', 'Spell_Charm', 'Spell_Mana_Drain')):
            if not o.target: raise SystemExit(f'ERROR: {disp(k)} needs --target PLAYER' + ('' if 'Mana_Drain' in k else ' --card CARD'))
        if k.startswith('Spell_Flame_Bolt') or k.startswith('Spell_Disintegrate'):
            kind = o.kind or ('wizards' if 'Wizard_' in o.card else 'towers' if 'Tower_' in o.card else 'spells')
            card = [c for c in A.P(s, o.target)[kind] if CD.key(c) == CD.key(o.card)][0]
            (A.flame_bolt if 'Flame' in k else A.disintegrate)(s, me, o.target, card, kind)
        elif k.startswith('Spell_Earthquake'): A.earthquake(s, me, o.target, [c for c in A.P(s, o.target)['towers'] if CD.key(c) == CD.key(o.card)][0])
        elif k.startswith('Spell_Charm'): A.charm(s, me, o.target, [c for c in A.P(s, o.target)['wizards'] if CD.key(c) == CD.key(o.card)][0])
        elif k.startswith('Spell_Mana_Drain'): A.mana_drain(s, me, o.target)
        elif k.startswith('Spell_Swapo'):
            if not (o.target and o.card and o.mine): raise SystemExit('ERROR: Swapo needs --target PLAYER --card THEIR_CARD --mine MY_CARD')
            kind = o.kind or ('wizards' if 'Wizard_' in o.card else 'towers')
            th = [c for c in A.P(s, o.target)[kind] if CD.key(c) == CD.key(o.card)][0]
            mn = [c for c in A.P(s, me)[kind] if CD.key(c) == CD.key(o.mine)][0]
            SE.swapo(s, me, o.target, mn, th, kind)
        elif k == 'Spell_Scry_Dungeon.jpg': A.scry_dungeon(s, me)
        elif k == 'Spell_Creation.jpg': A.creation(s, me, o.card, o.kind or ('wizards' if 'Wizard_' in o.card else 'towers'))
        elif CD.duration(k) == '1x' and not k.startswith('Spell_Spell_Shield'):
            events.append(f'NOTE: the effect of {disp(k)} ("{CD.get(k)["effect"]}") is not automated; resolve it by hand.')
    def cost_of(img): return o.cost.split(',') if o.cost else A.spell_cost(img)
    if v == 'gather':
        if len(o.cast or []) > 1: raise ValueError('Rulebook: when you gather you may cast only ONE spell')
        _own = [[y['img'] for y in p.get('spells', []) if sp in y['img'] and not y.get('cast')] for sp in (o.cast or [])]
        if any(not z for z in _own): raise ValueError('cast: you do not own that uncast spell')
        if o.discard and any(d.startswith('<') for d in o.discard): raise SystemExit('ERROR: put-backs not chosen yet: ASK Keith which tokens to return')
        try: A.gather(s, me, x[0], keep=o.keep, discard=o.discard, spend=[r for z in _own for r in cost_of(z[0])])
        except ValueError as e:
            if 'over storage' in str(e) or 'discard not held' in str(e):
                g = CD.reagent_icons(x[0])[0]; inc = list(o.keep or g)
                raise SystemExit(f"ERROR: {e}. PUT-BACK NEEDED: ask Keith (multi-select) which tokens to return from his current "
                                 f"{sorted(p['tok'])} + incoming {sorted(inc + [CD.wizard_bonus(w) for w in p.get('wizards', [])])}; never choose for him")
            raise
        desc = f'gather card {x[0]}'
        auto_claim(s, me)                       # 'On your turn, if you meet...': claim an x7 tile before the cast spends tokens
        for sp in (o.cast or []):
            own = [y['img'] for y in p.get('spells', []) if sp in y['img'] and not y.get('cast')][0]
            A.cast_spell(s, me, sp, cost_of(own)); cast_effect(own); desc += f', cast {disp(own)}'
    elif v == 'convert': A.convert(s, me, A.norm(x[0]), int(x[1])); desc = f'convert {x[1]} {nice(x[0])}'
    elif v == 'convert1': A.convert1(s, me, [A.norm(r) for r in x[0].split(',')]); desc = f'convert1 {x[0]}'
    elif v == 'build':
        pay = 'gold' if 'gold' in [y.lower() for y in x] else 'reagent'
        names = [y for y in x if y.lower() not in ('gold', 'reagent')]
        if names and names[0].lower().replace(' ', '_') not in b(s['tower_face'] or '').lower():
            raise SystemExit(f"ERROR: face-up tower is {disp(s['tower_face'])}, not {names[0]}")
        img = s['tower_face']; A.build_tower(s, me, pay=pay); desc = f'build {disp(img)} paying {pay}'
    elif v == 'research':
        img = [y for y in s['spell_face'] if y and x[0] in b(y)]
        if not img: raise SystemExit(f'ERROR: {x[0]} is not face-up; face-up: {[disp(y) for y in s["spell_face"] if y]}')
        img = img[0]; cast = o.cast is not None
        A.research(s, me, b(img)[:-4], cast_cost=cost_of(img) if cast else None)
        desc = f"research {disp(img)}" + (' and cast it' if cast else '')
        if cast: cast_effect(img)
    elif v == 'recruit':
        if len(x) < 2 or not x[1].isdigit(): raise SystemExit('ERROR: usage: recruit WIZARD OPENING_BID (ask Keith for his opening bid)')
        if int(x[1]) < 1: raise SystemExit('ERROR: the opening bid must be at least 1 mana')
        a = start_auction(s, me, x[0], int(x[1]))
        if a['high'] > p['mana']: raise SystemExit(f"ERROR: you only have {p['mana']} mana")
        desc = f"recruit {disp(a['card'])}, opening bid {a['high']}"
        st, who = auction_run(s, a)
        if st == 'need': return 'auction', desc
        return after_auction(s, a, who, events), desc
    elif v == 'summon':
        f = [y for y in s['fam_face'] if y and x[0] in b(y)]
        if not f: raise SystemExit(f"ERROR: {x[0]} is not on offer; face-up familiars: {[disp(y) for y in s['fam_face'] if y]}")
        f = f[0]; use = x[1] if len(x) > 1 else 'score'
        casts = [(sp, cost_of([y['img'] for y in p['spells'] if sp in y['img']][0])) for sp in (o.cast or [])]
        if use == 'dungeon' and not o.draws: raise SystemExit('ERROR: dungeon runs go card by card: use --draws N (preview each draw first with --preview)')
        if o.discard and any(d.startswith('<') for d in o.discard): raise SystemExit('ERROR: put-backs not chosen yet: ASK Keith which tokens to return')
        dc = (lambda h, d, n=o.draws: len(d) < n) if (use == 'dungeon' and o.draws) else None
        ch = None
        if use == 'research':
            if not o.take and not PREVIEW: raise SystemExit('ERROR: New Research: run with --preview first to reveal the 4 new spells (that commits the summon), then --take SPELL')
            ch = (lambda st: o.take) if o.take else (lambda st: b([z for z in st['spell_face'] if z][0])[:-4])
        try: A.summon_familiar(s, me, f, use, cast=casts, discard=o.discard, cont=dc, choose=ch, after_collect=lambda: auto_claim(s, me))
        except AssertionError as e:
            if 'over storage' in str(e): raise SystemExit(f"ERROR: {e}. PUT-BACK NEEDED: ask Keith (multi-select) which tokens to return; never choose for him")
            raise
        desc = f'summon {disp(f)} ({use})' + (f', {o.draws} draw(s) max' if dc else '') + (f', took {o.take}' if o.take else '')
        for sp, _c in casts:
            own = [y['img'] for y in p['spells'] if sp in y['img']][0]; cast_effect(own)
    else: raise SystemExit(f'ERROR: unknown action {v}')
    A.check_end(s); advance(s, events)
    return run_ais(s, events), desc

# ------------------------------------------------------------------ plain-words events
def describe(e, viewer='Keith'):
    a = e.get('act'); w = e.get('who')
    if a == 'gather':
        bon = f" + wizard bonus {', '.join(nice(r) for r in e['bonus'])}" if e.get('bonus') else ''
        return f"{w} gathered with {nice(e['card'])}: {', '.join(nice(r) for r in e['got'])}{bon}; tracks up: {', '.join(nice(r) for r in e['inc'])}"
    if a == 'convert':
        if e.get('parts'):
            bits = []
            for pr in e['parts']:
                suf = ' (Energize +3 before sale)' if pr.get('energized') else ''
                bits.append(f"{pr['n']} {nice(pr['reagent'])} at {pr['value']} each{suf} → track {pr['track_after']}")
            return f"{w} sold (Adept Conversion): " + '; '.join(bits) + f" (+{e['gain']} mana total)"
        return f"{w} sold {e['n']} {nice(e['reagent'])} at {e['value']} each (+{e['gain']} mana); track now {e['track_after']}"
    if a == 'convert1': return f"{w} sold {', '.join(nice(r) for r in e['reagents'])} at 1 mana each"
    if a == 'transform':
        bits = [' + '.join(nice(r) for r in step.get('from', [])) + f" → {nice(step['to'])}" for step in e.get('steps', [])]
        return f"{w} transformed (2:1) before converting: " + '; '.join(bits)
    if a == 'build': return f"{w} built {disp(e['tower'])} paying {'Gold' if e['paid'] == 'gold' else ', '.join(nice(r) for r in e['paid'])}"
    if a == 'research': return f"{w} researched {disp(e['spell'])} for 5 mana" + (f" and cast it ({', '.join(nice(r) for r in e['cast_paid'])})" if e.get('cast') else ' (not cast yet)')
    if a == 'cast': return f"{w} cast {disp(e['spell'])} ({', '.join(nice(r) for r in e['cast_paid'])})"
    if a == 'auction':
        pm = {i for c, i in PROXY_MARKS if b(c)[7:-4] == e.get('item')}
        bids = ', '.join(f"{n} {v}" + (' (proxy)' if i in pm else '') for i, (n, v) in enumerate(e.get('bids_tail') or []))
        return f"{e['won']} recruited {disp('Wizard_' + e['item'] + '.jpg')} for {e['price']} mana (started by {e.get('starter')}; bids: {bids})"
    if a == 'auction_nobid': return f"Nobody bid on {disp('Wizard_' + e['item'] + '.jpg')}"
    if a in ('flame_bolt', 'disintegrate', 'earthquake'): return f"{w} cast {a.replace('_', ' ').title()} on {e['target']}: {disp(e['card'])} is out of play"
    if a == 'charm': return f"{w} charmed {disp(e['wizard'])} away from {e['target']}"
    if a == 'mana_drain': return f"{w} drained {e['n']} mana from {e['target']}"
    if a.endswith('_blocked'):
        sp = CD.get('Spell_' + a[:-8].title() + '.jpg') or CD.get('Spell_' + a[:-8].title().rsplit('_', 1)[0] + '.jpg')
        return f"{w}'s {sp['display'] if sp else a[:-8].replace('_', ' ').title()} on {e['target']} was blocked by a Spell Shield"
    if a == 'trigger': return f"{w} gained {e.get('gain')} mana from {disp('Spell_' + e['spell'] + '.jpg')}"
    if a == 'shield_used': return f"{w}'s {disp(e['spell'])} absorbed the attack and is out of play"
    if a == 'summon': return f"{w} summoned {disp(e['familiar'])} for {e['cost']} mana ({e['use']})" + (f": +{e['gold']} Gold" if 'gold' in e else '')
    if a == 'achievement': return f"{w} claimed achievement '{e['tile']}' (+10 VP)"
    if a == 'scry_dungeon':
        kept = [c.get('name') or f"{c.get('gold')} Gold" for c in e.get('kept', [])]
        return f"{w} scried the Dungeon and kept {', '.join(kept) or 'nothing'}"
    if a == 'swapo': return f"{w} cast Swapo (Enchantment) on {e['target']}: gave {disp(e['gave'])}, took {disp(e['got'])}"
    if a == 'swapo_blocked': return f"{w} cast Swapo (Enchantment) on {e['target']}, but a Spell Shield blocked it"
    if a == 'creation': return f"{w} took {disp(e['card'])} free with Creation (Conjuring)"
    if a == 'dungeon':
        kept = [c.get('name') or f"{c.get('gold')} Gold" for c in e.get('kept', [])]
        return (f"{w} entered the Dungeon: drew {len(e.get('drawn', []))} ({', '.join(TP.dungeon_name(c) for c in e.get('drawn', []))}), {e.get('hits')} hit(s), "
                + (f"kept {', '.join(kept) or 'nothing'}" if e.get('success') else 'defeated, kept nothing'))
    if a == 'new_research': return f"{w} used New Research and took {disp(e['took'])} (uncast)"
    if a == 'reshuffle_reagents': return f"Reagent deck reshuffled from the discard pile ({e['n']} cards)"
    if a == 'game_end_triggered':
        dep = [k for k, v in (e.get('supplies') or {}).items() if v == 0]
        return f"GAME END TRIGGERED: the {'/'.join(dep) or '?'} supply is fully depleted (deck AND face-up cards). This round finishes, then the game ends."
    if a == 'game_over': return 'Game over.'
    return json.dumps(e)

# ------------------------------------------------------------------ Keith's options for the next widget
def matched_schools(p):
    from collections import Counter as C
    cw = C(S.school(w) for w in p.get('wizards', [])); ct = C(S.school(t) for t in p.get('towers', []))
    return {sc for sc in cw if sc and ct[sc]}
def keith_options(s, me='Keith'):
    p = A.P(s, me); tok = Counter(p['tok']); cap = A.capacity(p); av, un = [], []
    bonus = [CD.wizard_bonus(w) for w in p.get('wizards', [])]
    vp0 = S.score(p, s)
    for c in p['hand']:
        g, inc = CD.reagent_icons(c); n = len(g); after = len(p['tok']) + min(3, n) + len(bonus); over = max(0, after - cap)
        av.append(dict(action='gather', card=b(c)[8:-4], cmd=f"gather {b(c)[8:-4]}" + (' --keep R R R' if n > 3 else '') + (f' --discard ({over} tokens)' if over else ''),
                       text=f"Gather card {b(c)[8:-4]}: {', '.join(nice(r) for r in g)}" + (' (choose 3)' if n > 3 else '') +
                       f" · raises {', '.join(nice(r) for r in inc)}" + (f" · +{len(bonus)} wizard bonus" if bonus else '') +
                       (f" · over storage by {over}: put back {over}" if over else f" · storage {after}/{cap}"),
                       gather=g, increase=inc, choose_3=n > 3, over_storage=over))
    if tok:
        for r, k in sorted(tok.items(), key=lambda kv: -s['tracks'][kv[0]] * kv[1]):
            av.append(dict(action='convert', reagent=r, cmd=f'convert {r} {k}', text=f"Convert {k} {nice(r)} at {s['tracks'][r]} each = {k * s['tracks'][r]} mana (track then {max(1, s['tracks'][r] - k)})"))
    else: un.append(dict(action='convert', text='Unavailable: Convert (no reagent tokens)'))
    tf = s.get('tower_face')
    if tf:
        tier, r, sc = CD.tower_info(tf); vt = S.value_table(s, tf, 'towers')
        okr, okg = tok[r] >= tier, p.get('gold', 0) >= tier
        base = f"Build {disp(tf)}: +{vt[me]} VP for you (others {', '.join(f'{n} +{v}' for n, v in vt.items() if n != me)})"
        if okr: av.append(dict(action='build', cmd=f"build {b(tf)[9:-4]} reagent", text=f"{base}, pay {tier} {nice(r)}", vp=vt[me]))
        if okg: av.append(dict(action='build', cmd=f"build {b(tf)[9:-4]} gold", text=f"{base}, pay {tier} Gold (-{tier} VP of Gold)", vp=vt[me] - tier))
        if not okr and not okg: un.append(dict(action='build', text=f"Unavailable: Build {disp(tf)} (needs {tier} {nice(r)} or {tier} Gold; you have {tok[r]} {nice(r)}, {p.get('gold', 0)} Gold)"))
    else: un.append(dict(action='build', text='Unavailable: Build (tower deck empty)'))
    wz = [w for w in s.get('wiz_face', []) if w]
    for w in wz:
        vt = S.value_table(s, w, 'wizards')
        av.append(dict(action='recruit', cmd=f"recruit {b(w)[7:-4]} BID", text=f"Recruit {disp(w)}: +{vt[me]} VP for you (others {', '.join(f'{n} +{v}' for n, v in vt.items() if n != me)}); you have {p['mana']} mana", value_table=vt))
    if not wz: un.append(dict(action='recruit', text='Unavailable: Recruit (no wizards left)'))
    ms = matched_schools(p)
    for sp in [x for x in s.get('spell_face', []) if x]:
        c = CD.get(sp); cc = CD.cast_cost(sp); need = Counter(cc or [])
        castable = cc is not None and all(tok[r] >= k for r, k in need.items())
        q = copy.deepcopy(p); q.setdefault('spells', []).append({'img': sp, 'cast': True}); dvp = S.score(q, s) - vp0
        cost_txt = ' + '.join(f"{k} {nice(r)}" for r, k in c['cost']['reagents'].items())
        txt = f"{c['display']} [{c['duration']}] \"{c['effect']}\" · cast cost {cost_txt}" + (f" · +{dvp} VP when cast" if dvp else '') + (' · ATTACK' if c.get('attack') else '')
        if p['mana'] < 5: un.append(dict(action='research', text=f"Unavailable: Research {c['display']} (needs 5 mana, you have {p['mana']})")); continue
        if castable: av.append(dict(action='research_cast', cmd=f"research {b(sp)[6:-4]} --cast" + (' --target P --card C' if c.get('attack') else ''), text='Research + cast ' + txt, vp=dvp))
        else:
            short = ', '.join(f"{k} {nice(r)}" for r, k in (need - tok).items()) if cc is not None else 'variable X cost'
            av.append(dict(action='research', cmd=f"research {b(sp)[6:-4]}", text=f"Research {txt} (can't cast now: short {short})"))
    for x in p.get('spells', []):
        if x.get('cast'): continue
        cc = CD.cast_cost(x['img'])
        if cc is None: continue
        # gather + cast: the gathered reagents and the wizard bonus count toward the ONE cast (rulebook p.11, fix Nov 2)
        try:
            _R, _W = A._cards(); _bon = [A.norm(_W[w]['gather_bonus_reagent']) for w in p.get('wizards', []) if w in _W and _W[w].get('gather_bonus_reagent')]
        except Exception: _bon = []
        for _hc_ in p.get('hand', []):
            _cid = [z for z in _R if z in _hc_][0] if any(z in _hc_ for z in _R) else None
            if not _cid: continue
            _ic = [A.norm(z) for z in _R[_cid]['gather_icons_in_print_order']]
            _keeps = [tuple(_ic)] if len(_ic) <= 3 else sorted(set(itertools.combinations(sorted(_ic), 3)))
            _ok = [k for k in _keeps if not (Counter(A.norm(r) for r in cc) - (tok + Counter(k) + Counter(_bon)))]
            if not _ok: continue
            _k = _ok[0]; _over = sum(tok.values()) + len(_k) + len(_bon) - len(cc) - A.capacity(p)
            av.append(dict(action='cast_owned', cmd=f"gather {_cid[-2:]}" + (f" --keep {' '.join(_k)}" if len(_ic) > 3 else '') + f" --cast {b(x['img'])[6:-4]}",
                           text=f"Gather card {_cid[-2:]} and cast your {disp(x['img'])} (pay {', '.join(nice(r) for r in cc)})" + (f", put back {_over}" if _over > 0 else ', no put-back')))
    for f in [x for x in s.get('fam_face', []) if x]:
        c = CD.get(f)
        n = 1 + sum(1 for y in p.get('wizards', []) + p.get('towers', []) + p.get('familiars', []) if S.school(y) == c['school']) + sum(1 for y in p.get('spells', []) if S.school(y['img']) == c['school'])
        if p['mana'] >= c['cost']['mana']:
            av.append(dict(action='summon', cmd=f"summon {b(f)[:-4]} score|gather", text=f"Summon {disp(f)} for {c['cost']['mana']} mana: score use +{n} Gold, or gather {c['collect']} {nice(c['reagent'])} and cast spells"))
        else: un.append(dict(action='summon', text=f"Unavailable: Summon {disp(f)} (needs {c['cost']['mana']} mana, you have {p['mana']})"))
    claims = [t for t in s.get('ach', []) if A.achievement_met(p, t)]
    return dict(available=av, unavailable=un, claimable_achievements=claims)

# ------------------------------------------------------------------ brief output
def _cut(x, n=70): return x if len(x) <= n else x[:n - 1] + '…'
def _proj_pairing(s, p, keep, drop=()):
    """Projected pairing VP (scoring.pairing) if Keith gathers `keep` (+ wizard gather bonuses) and then spends his tokens
    on towers: the face-up tower (real school) if affordable, then one school-unknown tower per remaining same-reagent
    pair (assumed tier 2, the typical cost). Matched 10 / mismatched 5 / unpaired 1 via S.pairing."""
    tok = Counter(p['tok']) + Counter(keep) + Counter(x for x in (CD.wizard_bonus(w) for w in p.get('wizards', [])) if x)
    tok = tok - Counter(drop)                                    # tokens put back for storage
    q = {'wizards': list(p.get('wizards', [])), 'towers': list(p.get('towers', [])), 'spells': p.get('spells', [])}
    tf = s.get('tower_face')
    if tf:
        try:
            tier, r, _ = CD.tower_info(tf); tier = int(tier)
            if tok[r] >= tier: tok[r] -= tier; q['towers'].append(tf)
        except Exception: pass
    q['towers'] += [None] * sum(k // 2 for k in tok.values())
    return S.pairing(q)
def _putback(s, p, keep, nb, cap):
    over = max(0, len(p['tok']) + len(keep) + nb - cap)
    return over, sorted(p['tok'] + list(keep), key=lambda r: s['tracks'][r])[:over]
def brief_options(s, me):
    """Up to 6 (label, command) pairs: all gathers first, then best research/summon/build/recruit, then UNAVAIL."""
    p = A.P(s, me); tok = Counter(p['tok']); cap = A.capacity(p); nb = len(p.get('wizards', [])); res = []; gath = []
    base_pair = _proj_pairing(s, p, [])
    for c in p['hand']:
        g, _ = CD.reagent_icons(c); cid = b(c)[8:-4]
        if len(g) > 3:                                           # choose-3 card: best pair-building keep + most-new-types keep
            combos = sorted({tuple(sorted(k)) for k in itertools.combinations(g, 3)})
            trk = lambda k: sum(s['tracks'][r] for r in k)
            pv = lambda k: _proj_pairing(s, p, k, _putback(s, p, k, nb, cap)[1]) - base_pair
            pk = max(combos, key=lambda k: (pv(k), trk(k)))
            nk = max(combos, key=lambda k: (len(set(k) - set(tok)), len(set(k)), trk(k)))
            keeps = [('pair', list(pk))] + ([('new', list(nk))] if sorted(nk) != sorted(pk) else [])
        else: keeps = [(None, list(g))]
        for tag, keep in keeps:
            over, dis = _putback(s, p, keep, nb, cap); d = _proj_pairing(s, p, keep, dis) - base_pair
            cmd = f"keith gather {cid}" + (' --keep ' + ' '.join(keep) if len(g) > 3 else '')
            if over:                                             # never auto-choose put-backs (Keith rule): placeholder only
                cmd += f' --discard <ASK KEITH: {over} tokens>'
            new = len(set(keep) - set(tok))
            note = f"+{new} new type{'s' * (new != 1)}"
            if tag == 'pair': note = f"pairs +{d} proj VP, " + note
            gath.append((tag == 'new', -d,
                         (_cut(f"Gather {cid}: {', '.join(nice(r) for r in keep)} ({note})" + (f", put back {over}" if over else '')), cmd)))
    # gathers first; extra (most-new-types) keeps are dropped weakest-first so at least 2 non-gather slots remain
    extras = sorted([x for x in gath if x[0]], key=lambda x: x[1]); mains = [x for x in gath if not x[0]]
    while len(mains) + len(extras) > 4 and extras: extras.pop()
    keepset = {id(x) for x in mains + extras}; res = [x[2] for x in gath if id(x) in keepset][:6]
    ko = keith_options(s, me); rest = []
    for a in ko['available']:
        act = a['action']
        if act == 'cast_owned': rest.append((100, a['text'].split(' (pay')[0], a['cmd'], a)); continue
        if act == 'research_cast': rest.append((3 + a.get('vp', 0), 'Research+cast ' + a['text'].split(' [')[0].replace('Research + cast ', ''), a['cmd'], a))
        elif act == 'research': rest.append((1, 'Research ' + a['text'].split(' [')[0].replace('Research ', ''), a['cmd'], a))
        elif act == 'summon': rest.append((2, a['text'].split(':')[0], a['cmd'].replace('score|gather', 'score'), a))
        elif act == 'build': rest.append((a.get('vp', 0) + 2, a['text'].split(':')[0] + (' (gold)' if a['cmd'].endswith('gold') else ' (reagent)') + f" +{a.get('vp', 0)} VP", a['cmd'], a))
        elif act == 'recruit': rest.append((a['value_table'][me], a['text'].split(':')[0] + f" +{a['value_table'][me]} VP", a['cmd'].replace('BID', '1'), a))
    rest.sort(key=lambda x: -x[0]); seen = set(); first = []
    for x in rest:                                               # best of each kind first, so research/summon/build/recruit all show
        kind = x[3]['action'].replace('research_cast', 'research')
        if kind not in seen: seen.add(kind); first.append(x)
    rest = first + [x for x in rest if x not in first]
    for _, lab, cmd, a in rest:
        if len(res) >= 6: break
        if a['action'] == 'research' and any(r[1].startswith('keith research') for r in res): continue
        res.append((_cut(lab), 'keith ' + cmd))
    for u in ko['unavailable']:
        if len(res) >= 6: break
        if u['action'] in ('research', 'summon', 'build', 'recruit'):
            res.append((_cut('UNAVAIL: ' + u['text'].replace('Unavailable: ', '')), '-'))
    return res[:6]
_SPELLS = None
def spell_info(name):
    """Authoritative spell text from cards/spells_from_pc.json (Keith's photo transcription)."""
    global _SPELLS
    if _SPELLS is None:
        import json as _j, os as _o
        _SPELLS = {}
        def _w(o):
            if isinstance(o, dict):
                if o.get('name') and o.get('effect') is not None:
                    _SPELLS.setdefault(o['name'].lower(), o)
                    if o.get('id'): _SPELLS['id:' + o['id'].lower()] = o
                for v in o.values(): _w(v)
            elif isinstance(o, list):
                for v in o: _w(v)
        _w(_j.load(open(_o.path.join(_o.path.dirname(__file__), '..', 'cards', 'spells_from_pc.json'))))
    return _SPELLS.get('id:' + name.replace(' ', '_').lower()) or _SPELLS.get(name.replace('_', ' ').lower())
def spell_lines(s, me):
    import os as _o, re as _r
    ko = keith_options(s, me); out = []; seen = set()
    for a in ko['available'] + ko['unavailable']:
        if not a['action'].startswith('research'): continue
        m = _r.search(r'research (\S+)', a.get('cmd', '') or '') or _r.search(r'Research(?: \+ cast)? (.+?) \(', a.get('text', ''))
        if not m: continue
        nm = m.group(1).replace('_', ' ')
        if nm in seen: continue
        seen.add(nm); i = spell_info(nm.replace(' ', '_')) or spell_info(_r.sub(r' [A-Z0-9]$', '', nm))
        if not i: out.append(f"CARD: {nm} | NOT IN carddb"); continue
        cost = ' + '.join(f"{v} {k.replace('_', ' ')}" for k, v in (i.get('cast_cost_reagents') or {}).items())
        _ad = _o.path.join(_o.path.dirname(__file__), '..', 'assets')
        _cands = ['Spell_' + m.group(1) + '.jpg', 'Spell_' + _r.sub(r'[^A-Za-z0-9]+', '_', i['name']).strip('_') + '.jpg']
        _cands += sorted(f for f in _o.listdir(_ad) if f.startswith('Spell_' + _r.sub(r'[^A-Za-z0-9]+', '_', i['name']).strip('_') + '_'))
        img = next((_o.path.join(_ad, c) for c in _cands if _o.path.exists(_o.path.join(_ad, c))), _o.path.join(_ad, _cands[0]))
        out.append(f"CARD: {i['name']} ({i['school']}) | {i.get('duration')} | mana {i.get('mana_cost')} | cast {cost} | \"{i['effect']}\"" + (f" | VP {i['vp_box']}" if i.get('vp_box') else '') + f" | IMG {_enh(_o.path.abspath(img)) if _o.path.exists(img) else 'none'}")
    return out
def _enh(path):
    """Prefer the enhanced-graphics card (assets/enhanced/<same name>) for chat images (Keith, Nov 2, 2026)."""
    import os as _o
    if not path or path == 'none': return path
    e = _o.path.join(_o.path.dirname(path), 'enhanced', _o.path.basename(path))
    return _o.path.abspath(e) if _o.path.exists(e) else path
def opp_cast_lines(events):
    """Keith rule (Nov 2, 2026): every spell an opponent casts is shown with its card image and carddb text."""
    import os as _o, re as _r
    _ad = _o.path.join(_o.path.dirname(__file__), '..', 'assets'); out = []
    for e in events:
        m = _r.match(r'^(\w+) (?:cast|researched) (.+?) \((\w+)\)', e)
        if not m or m.group(1) == 'Keith' or ' cast' not in e: continue
        nm = m.group(2); i = spell_info(nm.replace(' ', '_')) or spell_info(nm)
        base = _r.sub(r'[^A-Za-z0-9]+', '_', nm).strip('_')
        c = ['Spell_' + base + '.jpg'] + sorted(f for f in _o.listdir(_ad) if f.startswith('Spell_' + base + '_'))
        img = next((_o.path.abspath(_o.path.join(_ad, x)) for x in c if _o.path.exists(_o.path.join(_ad, x))), 'none')
        eff = i['effect'] if i else 'NOT IN carddb'
        out.append(f"OCAST: {m.group(1)} cast {nm} ({m.group(3)}) | {i.get('duration') if i else ''} | \"{eff}\" | IMG {_enh(img)}")
    return out
def brief_text(s, out, nwho, ntype, pend):
    k = A.P(s, 'Keith'); sc = out['scores']
    L = [f"R{out['round']} | next: {nwho or out['next']} | scores: " + ', '.join(f"{n} {sc[n]}" for n in s['meta']['seat_order'])
         + f" | Keith mana {k['mana']} gold {k.get('gold', 0)} storage {len(k['tok'])}/{A.capacity(k)} tokens {dict(Counter(k['tok']))}"]
    L += ['E: ' + e for e in out['events']]
    L += opp_cast_lines(out['events'])
    nd = out['need']
    if ntype == 'bid': L.append(f"BID: {nd['card']} | leader {nd['leader'] or 'nobody'} at {nd['high']} | value for {nd['who']} {nd['value_for_you']} | {nd['who']} mana {nd['your_mana']}")
    elif ntype == 'action':
        _ach = [x for x in s.get('ach', []) if A.achievement_met(A.P(s, nwho), x)]
        L += [f"ACH: claimable now (free, not an action): {x} +10 VP || python3 scripts/turn.py {nwho.lower()} claim \"{x}\"" for x in _ach]
        L.append('ACT:'); L += [f"OPT: {lab} || python3 scripts/turn.py {cmd}" if cmd != '-' else f"OPT: {lab} || -" for lab, cmd in brief_options(s, nwho)]
        L += spell_lines(s, nwho)
    elif ntype == 'pick': L.append(f"PICK: {nd['question']} || python3 scripts/turn.py {nwho.lower()} pick R1 R2")
    elif ntype == 'game_over': L.append('GAME OVER')
    im = out.get('images') or {}; qc = out.get('qc') or {}
    if im:
        L.append(f"IMG: {im.get('board')} {im.get('mats') or im.get('mats_Keith') or ' '.join(v for kk, v in im.items() if kk != 'board')}")
        probs = [f"{kk}: no QC thumbnail" for kk, v in qc.items() if not v or not os.path.exists(str(v))] + [f"{kk}: image missing" for kk, v in im.items() if not v or not os.path.exists(str(v))] + list(out.get('render_warnings') or [])
        L.append('QC: ok' if not probs else 'QC: ' + '; '.join(map(str, probs))[:300])
    else: L.append('IMG: none (--no-render)'); L.append('QC: skipped')
    _old = [x for x in L if ' IMG /' in x and '/enhanced/' not in x and x.startswith(('CARD:', 'OCAST:'))]
    if _old: L.append('QC: FAIL card image not from assets/enhanced: ' + '; '.join(x.split(' IMG ')[-1] for x in _old))
    if out.get('coaching_stub'): L.append('COACH: ' + out['coaching_stub'])
    return '\n'.join(L)

# ------------------------------------------------------------------ main
def human_options(s, me): return keith_options(s, me)
def pick_options(s, me):
    """Setup C helper: the 7 reagents (all tracks at 1) plus this human's own 3 hand cards with their icons."""
    p = A.P(s, me); hand = []
    for c in p['hand']:
        g, inc = CD.reagent_icons(c)
        hand.append(dict(card=b(c)[8:-4], gather=g, increase=inc, text=f"Card {b(c)[8:-4]}: gathers {', '.join(nice(r) for r in g)}" + (' (choose 3)' if len(g) > 3 else '') + f" · raises {', '.join(nice(r) for r in inc)}"))
    return dict(pick_from=REAGENTS, rule='Pick 2 DIFFERENT Reagent Tokens (rulebook setup C); kept secret until every human has picked',
                cmd=f'{me.lower()} pick R1 R2', hand=hand)
def player_info(s, n):
    p = A.P(s, n)
    return dict(name=n, mana=p['mana'], gold=p.get('gold', 0), tokens=dict(Counter(p['tok'])),
                storage=f"{len(p['tok'])}/{A.capacity(p)}", hand=[b(h)[8:-4] for h in p['hand']])
def who_needed(s):
    """(type, human) the game is waiting on, or (None, None) when an AI seat / game over."""
    m = s['meta']
    if m.get('game_over'): return 'game_over', None
    if m.get('phase') == 'picks':
        w = [n for n in humans(s) if len(A.P(s, n)['tok']) != 2]
        return ('pick', w[0]) if w else (None, None)
    pend = m.get('pending') if isinstance(m.get('pending'), dict) else None
    if pend: return 'bid', auction_waiting_on(s, pend)
    return ('action', s['next']) if s['next'] in humans(s) else (None, None)
def resolve_state(o):
    if o.state: return os.path.abspath(o.state)
    return os.path.abspath(GAMES[o.game])

def render_all(s, path, o, real, real_tag):
    """Render the shared board + Keith's mats (render4.py). Returns (images {'board','mats'}, qc thumbs, warnings)."""
    hs = humans(s); images, qcs, warn = {}, {}, []
    if len(hs) > 1 or s['meta'].get('private_mats'):
        outp = o.out or (R + 'game/' + real_tag if real else os.path.splitext(path)[0])
        procs = [(h, subprocess.Popen([sys.executable, os.path.join(HERE, 'render4.py')], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                      env=dict(os.environ, G4_STATE=path, G4_OUT=outp, G4_VIEWER=h, G4_BOARD='1' if k == 0 else '0'))) for k, h in enumerate(hs)]
        for h, pr in procs:
            so, se = pr.communicate()
            for l in so.splitlines():
                if l.startswith('IMAGE'):
                    _, part, fn, q = l.split(); images[part] = fn; qcs[part] = q
            warn += [f'[{h}] ' + l for l in so.splitlines() + se.splitlines() if 'WARN' in l or 'VIOLATION' in l or 'Error' in l or 'Traceback' in l]
            if pr.returncode: warn.append(f'[{h}] render4 exit code {pr.returncode}')
    else:
        outp = o.out or (R + 'game/' + real_tag + '_position' if real else os.path.splitext(path)[0] + '_position')
        r = subprocess.run([sys.executable, os.path.join(HERE, 'render4.py')], env=dict(os.environ, G4_STATE=path, G4_OUT=outp), capture_output=True, text=True)
        lines = r.stdout.splitlines()
        ph = next((l.split()[1:] for l in lines if l.startswith('PHONE')), [None, None]); q = next((l.split()[1:] for l in lines if l.startswith('QC')), [None, None])
        images = dict(board=ph[0], mats=ph[1]); qcs = dict(board=q[0], mats=q[1])
        warn = [l for l in lines + r.stderr.splitlines() if 'WARN' in l or 'VIOLATION' in l or 'Error' in l or 'Traceback' in l]
        if r.returncode: warn.append(f'render4 exit code {r.returncode}')
    me = 'Keith' if 'Keith' in hs else hs[0]
    images['mats'] = images.get('mats') or images.get('mats_' + me.lower())
    return images, qcs, warn

def build_package(s, ctx):
    """The ONE turn package text + QC failures (turn_package.py does the pure work)."""
    me = ctx['me']; ntype, nwho = ctx['ntype'], ctx['nwho']; k = A.P(s, me); sc = {q['name']: S.score(q, s) for q in s['players']}
    L = [f"=== TURN PACKAGE R{s['meta']['round']} | waiting on: {ctx['waiting']} ===",
         f"HEAD: R{s['meta']['round']} | scores (public VP): " + ', '.join(f"{n} {sc[n]}" for n in s['meta']['seat_order'])
         + f" | {me} (yours, private): mana {k['mana']} gold {k.get('gold', 0)} storage {len(k['tok'])}/{A.capacity(k)} tokens {dict(Counter(k['tok']))}"]
    segs = ctx['segs']; lined = set(); opp = []
    for g in segs:
        if g['owner'] not in s['meta']['seat_order']:
            if ctx.get('desc'): L.append(f"YOU: {ctx['desc']}")
            continue
        if g['owner'] in humans(s):
            ev = [describe(e) for e in g['entries'] if e.get('act') not in TP.QUIET]
            if ev and g['owner'] == me: L.append(f"YOU: R{g['r']} " + '; '.join(ev))
            elif ev: L.append(f"HUMAN: R{g['r']} {g['owner']}: " + '; '.join(ev))
            continue
        opp.append('OPP: ' + TP.recap_line(s, g, describe, ctx['notes'])); lined.add(id(g))
    if ctx.get('desc') and not any(x.startswith('YOU:') for x in L): L.append(f"YOU: {ctx['desc']}")
    if ctx.get('show_note'): L.append(ctx['show_note'])
    L += opp or [f"OPP: {TP.no_opp_reason(s, ctx['verb'], ctx['status'], me, ntype)}"]
    oc = TP.ocast_lines(s, [e for g in segs for e in g['entries']]); L += oc
    for e in [e for g in segs for e in g['entries']]:
        if e.get('act') == 'achievement': L.append(f"ACH: {e['who']} claimed '{e['tile']}' (+10 VP, auto)")
    if not any(x.startswith('ACH:') for x in L): L.append('ACH: none claimed this turn')
    L.append(TP.end_line(s))
    im = ctx['images']
    L.append(f"BOARD: {im.get('board') if im else 'NOT RENDERED (--no-render: TEST ONLY)'}")
    L.append(f"MATS: {im.get('mats') if im else 'NOT RENDERED (--no-render: TEST ONLY)'}")
    cards = []
    if ntype == 'action' and nwho == me:
        O, U = TP.grouped_options(s, me)
        if s['meta'].get('again'): L.append('NOTE: you lost the auction you started, so you take another action (rulebook)')
        L.append(f"OPTIONS (all {len(O)} affordable actions, grouped):")
        RS = [x for x in O if x['group'] == 'RESEARCH']
        for grp in ('GATHER', 'GATHER+CAST', 'CONVERT', 'BUILD', 'RECRUIT', 'RESEARCH', 'SUMMON'):
            rows = [x for x in O if x['group'] == grp]
            if grp == 'RESEARCH' and rows:
                ncast = sum(1 for x in rows if x['key'][0] == 'research_cast')
                L.append(' [RESEARCH]'); L.append(f"  - Research a spell ({len({x['key'][1] for x in rows})} affordable face-up spells" + (f", {ncast} castable now" if ncast else '') + ") -> show RESEARCH CHOICES only after Keith picks this")
                continue
            if grp == 'GATHER' and rows:
                L.append(' [GATHER] (one per hand card, every reagent shown)')
                for cid in dict.fromkeys(x['card'] for x in rows):
                    cr = [x for x in rows if x['card'] == cid]; b0 = max(cr, key=lambda x: x['score'])
                    if cr[0]['nkeeps'] > 1: L.append(f"  - Gather card {cid}: offers {', '.join(nice(r) for r in cr[0]['offers'])} (keep 3; {len(cr)} combinations) · raises {', '.join(nice(r) for r in cr[0]['raises'])} · best keep {', '.join(nice(r) for r in b0['key'][2])} -> show GATHER CHOICES {cid} after Keith picks it")
                    else: L.append(f"  - {cr[0]['label']} || python3 scripts/turn.py {cr[0]['cmd']}")
                continue
            if rows: L.append(f" [{grp}]"); L += [f"  - {x['label']} || python3 scripts/turn.py {x['cmd']}" for x in rows]
        if U: L.append(' [UNAVAILABLE]'); L += [f"  - {u}" for u in U]
        for x in [x for x in O if x.get('putback')]:
            L.append(f"PUTBACK: {x['wlabel'] if x.get('wlabel') else x['label'][:60]} -> ask Keith to pick {x['putback']} to return (multi-select) from {x.get('pool')}; never choose for him")
        _G = [x for x in O if x['group'] == 'GATHER']; _GW = []
        for cid in dict.fromkeys(x['card'] for x in _G):
            cr = [x for x in _G if x['card'] == cid]; b0 = max(cr, key=lambda x: x['score'])
            if cr[0]['nkeeps'] > 1: _GW.append(dict(b0, wlabel=f"Gather {cid}: {', '.join(nice(r) + (f' x{n}' if n > 1 else '') for r, n in Counter(cr[0]['offers']).items())} (keep 3)", cmd=f'(then show GATHER CHOICES {cid})', key=('gather_menu', cid)))
            else: _GW.append(cr[0])
        W = TP.widget(_GW + [x for x in O if x['group'] not in ('RESEARCH', 'GATHER')] + ([dict(group='RESEARCH', key=('research_menu',), label='Research a spell', wlabel='Research a spell', cmd='(then show RESEARCH CHOICES)', score=max(x['score'] for x in RS))] if RS else []))
        for _x in [x for x in O if x['group'].startswith('GATHER')] + [x for x in W if x.get('group', '').startswith('GATHER')]:
            _miss = [nice(r) for r in set(_x.get('offers') or []) if nice(r) not in _x['label'] or (_x in W and nice(r) not in TP.widget_label(_x))]
            if _miss or not _x.get('offers'):
                print(f"QC FAIL: gather option missing reagent text {_miss or 'offers'}: {TP.widget_label(_x)}"); sys.exit(3)
        _BO = [x for x in O if x['group'] == 'BUILD']
        if _BO and not ([x for x in W if x.get('key') == ('build_menu',)] or all(any(w.get('key') == x.get('key') for w in W) for x in _BO)):
            print(f"QC FAIL: a legal BUILD option is missing from the widget: {[x['label'][:50] for x in _BO]}"); sys.exit(3)
        if RS and not any(w.get('key') == ('research_menu',) for w in W):
            print("QC FAIL: 'Research a spell' missing from the widget"); sys.exit(3)
        L.append(f"WIDGET (top {len(W)}, allowCustom=true):"); L += [f"  {i + 1}. {TP.widget_label(x)} || {x['cmd']}" for i, x in enumerate(W)]
        for cid in dict.fromkeys(x['card'] for x in _G):
            cr = [x for x in _G if x['card'] == cid]
            if cr[0]['nkeeps'] > 1:
                L.append(f"GATHER CHOICES {cid} (send ONLY after Keith picks card {cid}; every keep combination, widget of all):")
                L += [f"  - {x['label']} || python3 scripts/turn.py {x['cmd']}" for x in sorted(cr, key=lambda x: -x['score'])]
        if any(w.get('key') == ('build_menu',) for w in W):
            L.append("BUILD CHOICES (send ONLY after Keith picks 'Build a tower'; widget of every build):")
            L += [f"  - {x['label']} || python3 scripts/turn.py {x['cmd']}" for x in O if x['group'] == 'BUILD']
        if RS:
            L.append("RESEARCH CHOICES (keep hidden; send ONLY after Keith picks 'Research a spell': each spell's CARD image + carddb text, then a widget of these):")
            L += [f"  - {x['label']} || python3 scripts/turn.py {x['cmd']}" for x in RS]
        for sp in dict.fromkeys(b(x) for x in [x for x in s.get('spell_face', []) if x] + [x['img'] for x in k.get('spells', []) if not x.get('cast')]):
            pth = TP.enhanced(sp); cards.append(pth); L.append(f"CARD: {TP.card_text(sp)} | IMG {pth}")
        ctx['O'] = O; ctx['W'] = W
    elif ntype == 'bid':
        pend = s['meta']['pending']; vt = S.value_table(s, pend['card'], 'wizards')
        L.append(f"BID: {disp(pend['card'])} | gather bonus {nice(CD.wizard_bonus(pend['card']))} | leader {pend['who'] or 'nobody'} at {pend['high']} | +{vt[nwho]} VP for you "
                 f"(others {', '.join(f'{n} +{v}' for n, v in vt.items() if n != nwho)}) | your mana {A.P(s, nwho)['mana']} | bids so far: {', '.join(f'{n} {v}' for n, v in pend['tail'])}")
        if A.P(s, nwho)['mana'] >= pend['high'] + 1:
            L.append(f"WIDGET (allowCustom=true): 1. Pass || {nwho.lower()} pass   2. Bid {pend['high'] + 1} || {nwho.lower()} bid {pend['high'] + 1}")
        else: L.append(f"WIDGET (allowCustom=false): 1. Pass || {nwho.lower()} pass   (you have {A.P(s, nwho)['mana']} mana: you cannot beat {pend['high']})")
        pth = TP.enhanced(pend['card']); cards.append(pth); L.append(f"CARD: {disp(pend['card'])} | IMG {pth}")
    elif ntype == 'pick':
        L.append(f"PICK: {nwho} picks 2 DIFFERENT starting reagents from ALL 7 (rulebook SETUP C; not limited to the hand) || python3 scripts/turn.py {nwho.lower()} pick R1 R2")
        _pw = [nice(r) for r in REAGENTS]
        if len(_pw) != 7 or 'Horn' not in _pw:                 # Nov 3 2026: Horn was left off a hand-built pick widget
            print('QC FAIL: starting-pick widget must list all 7 reagents'); sys.exit(3)
        L.append("WIDGET (widgets hold max 6 options, so send 2 multiSelect steps covering all 7, 2 picks total): step 1: " + ' / '.join(_pw[:4]) + " | step 2: " + ' / '.join(_pw[4:]))
    elif ntype == 'game_over':
        L.append('GAME OVER: final scores ' + ', '.join(f"{n} {sc[n]}" for n in s['meta']['seat_order']))
    for x in oc: cards.append(x.split(' | IMG ')[-1])
    if ctx.get('coach'): L.append('COACH: ' + ctx['coach'])
    elif ctx.get('needs_coach'): L.append('COACH: WARN no --coach-rating given; rate this decision (good|mixed|weak) in the coaching log')
    if ctx.get('render_warnings'): L.append('RENDER WARN: ' + '; '.join(ctx['render_warnings'])[:400])
    text = '\n'.join(L)
    F = TP.qc(s, text, me, ntype, im, ctx['t_start'], {'all': segs, 'lined': lined}, cards, ctx['n0'], ctx['verb'], want_render=ctx['render'])
    if ntype == 'action' and nwho == me:                       # options completeness: every affordable action listed
        miss = TP.required_keys(s, me) - TP.emitted_keys(ctx['O'])
        if miss: F.append(f"affordable action(s) missing from OPTIONS: {sorted(miss)}")
        wc = {x['card'] for x in ctx['W'] if x['group'] == 'GATHER'}
        if wc != {b(c)[8:-4] for c in k['hand']}: F.append(f"WIDGET is missing hand gather(s): {sorted({b(c)[8:-4] for c in k['hand']} - wc)}")
    if ctx['verb'] not in ('show', 'options', 'status', 'claim', 'level', 'pick') and ctx['status'] != 'stopped (--no-ai)' and ntype in ('action', 'game_over') \
            and ctx['first_owner'] == me and not s['meta'].get('again') and not s['meta'].get('game_over'):
        need = [n for n in s['meta']['seat_order'] if n not in humans(s)]
        got = [g['owner'] for g in segs if g['owner'] not in humans(s)]
        if sorted(set(got)) != sorted(need) and len(s['meta']['seat_order']) > 1: F.append(f"opponent turn(s) skipped: expected {need}, recapped {got}")
    text += '\n' + ('QC: PASS (renders fresh, enhanced art, every opponent turn recapped, tracks 1-12, achievements claimed, end rule ok, no hidden info)'
                    if not F else '\n'.join('QC: FAIL ' + f for f in F))
    text += '\n' + (TP.BID_CHECKLIST if ntype == 'bid' else TP.CHECKLIST)
    return text, F

def dungeon_preview(s, me, argv):
    """Run the summon+dungeon on an IN-MEMORY copy and print only the first --draws N cards. Saves nothing."""
    t = copy.deepcopy(s); events = []
    status, desc = keith_action(t, me, argv, events)
    d = [e for e in t['meta']['log'] if e.get('act') == 'dungeon' and e.get('who') == me][-1]
    p = A.P(s, me); lim = 2 + (1 if SE.has_cast(p, 'Spirit_Shield') else 0)
    L = [f"DUNGEON PREVIEW (nothing saved; {len(d['drawn'])} card(s) drawn; hit limit {lim}{' with Spirit Shield (Enchantment)' if lim == 3 else ''}):"]
    hits = 0
    for i, c in enumerate(d['drawn'], 1):
        if c['type'] == 'Monster':
            blk = SE.BLOCK.get(c.get('monster_type'), '~')
            if SE.has_cast(p, blk): note = f"blocked by {blk.replace('_', ' ')}: +1 Gold, no hit"
            else: hits += 1; note = '1 hit'
        elif c['type'] == 'Trap': hits += 2; note = '2 hits'
        else: note = 'treasure (kept only if you stop before the limit)'
        L.append(f"DRAW {i}: {TP.dungeon_name(c)} | {note} | hits {hits}/{lim} | IMG {TP.dungeon_img(c)}")
    L.append(f"STATUS: {'DEFEATED: keeps nothing; commit now with the same --draws' if not d['success'] else 'alive'}; "
             f"if he stops now he keeps: {', '.join(TP.dungeon_name(c) for c in d['kept']) or 'nothing'}" + (f" (+{d['bonus_gold']} Gold from blocks/Treasure)" if d.get('bonus_gold') else ''))
    L.append("NEXT: show each DRAW image, then ask 'Keep going?' [Draw another card] [Stop and keep ...]. Draw another -> re-run with --draws N+1 --preview. "
             "Stop/defeated -> commit: same command WITHOUT --preview, with --draws N and --coach-rating.")
    miss = [x.split(' IMG ')[-1] for x in L if ' IMG ' in x and not os.path.exists(x.split(' IMG ')[-1])]
    L.append('QC: PASS' if not miss else 'QC: FAIL missing enhanced image ' + ', '.join(miss))
    print('\n'.join(L))

def research_preview(s, me, argv):
    t = copy.deepcopy(s); keith_action(t, me, argv, [])
    e = [x for x in t['meta']['log'] if x.get('act') == 'new_research'][-1]
    print("NEW RESEARCH PREVIEW (nothing saved). Revealing the new spells COMMITS this summon; Keith now picks one of these 4:")
    four = [b(x) for x in (list(s['spell_list']) + [x for x in s['spell_face'] if x])[:4]]      # exactly what new_research reveals
    for k_ in four: print(f"CARD: {TP.card_text(k_)} | IMG {TP.enhanced(k_)} || commit: python3 scripts/turn.py {me.lower()} {' '.join(argv)} --take {k_[6:-4]} --coach-rating \"...\"")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--state'); ap.add_argument('--game', default=DEFAULT_GAME, choices=sorted(GAMES))
    ap.add_argument('--out'); ap.add_argument('--coach')
    ap.add_argument('--no-render', action='store_true'); ap.add_argument('--no-ai', action='store_true'); ap.add_argument('--note', default='')
    ap.add_argument('--brief', action='store_true'); ap.add_argument('--coach-rating', dest='coach_rating'); ap.add_argument('--preview', action='store_true')
    ap.add_argument('--level', help="AI difficulty: easy|normal|hard for every AI seat, or per seat 'Newt=hard,Gecko=easy' (saved in meta.ai_levels)")
    ap.add_argument('who'); ap.add_argument('action', nargs=argparse.REMAINDER)
    o, extra = ap.parse_known_args()
    for flag in ('--level', '--game', '--state'):
        if flag in extra:
            i = extra.index(flag); setattr(o, flag[2:], extra[i + 1]); del extra[i:i + 2]
    argv = o.action + extra
    for flag in ('--no-render', '--no-ai', '--brief', '--preview'):
        while flag in argv: argv.remove(flag); setattr(o, flag[2:].replace('-', '_'), True)
    for flag in ('--level', '--game', '--state', '--out', '--coach-rating', '--coach', '--note'):
        if flag in argv[1:]:
            i = argv.index(flag); setattr(o, flag[2:].replace('-', '_'), argv[i + 1]); del argv[i:i + 2]
    if o.coach_rating:
        rt, _, nt = o.coach_rating.partition(':'); rt = rt.strip().lower()
        if rt not in ('good', 'mixed', 'weak'): raise SystemExit('ERROR: --coach-rating must start with good|mixed|weak (e.g. "good: cheap tempo")')
        o.coach_rating = (rt, nt.strip())
    if len(argv) == 1 and ' ' in argv[0]: argv = shlex.split(argv[0])
    path = resolve_state(o); real_tag = next((g for g, pth in GAMES.items() if os.path.abspath(pth) == path), None); real = real_tag is not None
    global NO_AI, PREVIEW; NO_AI = o.no_ai; PREVIEW = o.preview
    t_start = time.time()
    s = json.load(open(path)); lap('load'); r0 = s['meta'].get('round')
    me = next((n for n in s['meta']['seat_order'] if n.lower() == o.who.lower()), o.who.capitalize())
    n0 = len(s['meta'].get('log', [])); notes = []; status = 'human'; desc = None; backup = None; coach_line = None
    verb = (argv[0].lower() if argv else 'show')
    first_owner = '(setup)' if s['meta'].get('phase') == 'picks' else s['next']
    LEVELS = ('easy', 'normal', 'hard')
    ais_ = [n for n in s['meta']['seat_order'] if n not in humans(s)]
    if verb not in ('options', 'status', 'show', 'ai', 'level') and me not in humans(s):
        raise SystemExit(f"ERROR: {me} is not a human seat; humans are {humans(s)}")
    if o.preview:
        if verb != 'summon' or len(argv) < 3 or argv[2] not in ('dungeon', 'research'): raise SystemExit('ERROR: --preview is for summon F dungeon --draws N, or summon F research')
        NO_AI = True
        if argv[2] == 'dungeon':
            if '--draws' not in argv: raise SystemExit('ERROR: --preview needs --draws N')
            return dungeon_preview(s, me, argv)
        return research_preview(s, me, argv)
    if o.level:
        lv = s['meta'].setdefault('ai_levels', {})
        for part in o.level.split(','):
            n, _, l = part.rpartition('='); l = l.lower()
            if l not in LEVELS: raise SystemExit(f'ERROR: level must be one of {LEVELS}')
            for q in ([next((a for a in ais_ if a.lower() == n.lower()), n)] if n else ais_):
                if q not in ais_: raise SystemExit(f'ERROR: {q} is not an AI seat ({ais_})')
                lv[q] = l
        if verb in ('options', 'status', 'show'): save(s, path)
    if verb == 'level':
        if len(argv) == 3:
            q, l = next((a for a in ais_ if a.lower() == argv[1].lower()), argv[1]), argv[2].lower()
            if q not in ais_ or l not in LEVELS: raise SystemExit(f'ERROR: usage: level <{"|".join(ais_)}> <{"|".join(LEVELS)}>')
            s['meta'].setdefault('ai_levels', {})[q] = l; save(s, path); desc = f'set {q} to {l}'
        elif len(argv) != 1: raise SystemExit('ERROR: usage: level [Seat easy|normal|hard]')
        verb = 'status'
    if verb not in ('options', 'status', 'show') and not s['meta'].get('game_over'):
        backup = f"/tmp/{os.path.splitext(b(path))[0]}_r{s['meta'].get('round')}_{me}_{verb}_{time.strftime('%H%M%S')}_{os.getpid()}_pre.json"
        shutil.copyfile(path, backup)
        if s['meta'].get('phase') == 'picks': status, desc = pick_tokens(s, me, argv, path, notes)
        elif verb == 'ai': status = run_ais(s, notes); desc = None
        elif verb == 'pick': raise SystemExit('ERROR: starting picks are over')
        else: status, desc = keith_action(s, me, argv, notes)
        lap('actions')
        save(s, path)
        if desc and me == 'Keith' and verb != 'claim':
            coach = o.coach or (R + s['meta'].get('coaching_log', 'game/coaching_log_g4.md') if real else os.path.splitext(path)[0] + '_coaching.md')
            if o.coach_rating: coach_line = f"- R{r0} {me}: {desc} — rating: {o.coach_rating[0]}" + (f" — {o.coach_rating[1]}" if o.coach_rating[1] else '') + (f" — {o.note}" if o.note else '')
            else: coach_line = f"- R{r0} {me}: {desc} — rating: TODO (good/mixed/weak){(' — ' + o.note) if o.note else ''}"
            with open(coach, 'a') as fh: fh.write(coach_line + '\n')
    log = s['meta'].get('log', [])
    events = [describe(e, me) for e in log[n0:] if e.get('act') not in TP.QUIET] + notes
    pend = s['meta'].get('pending') if isinstance(s['meta'].get('pending'), dict) else None
    ntype, nwho = who_needed(s)
    # segments: this run's log; for show/options, the opponent turns since my previous turn
    show_note = None
    if verb in ('show', 'options', 'status'):
        segs = TP.recap_since_last_turn(s, me, describe)
        if segs is None: segs = []; show_note = 'NOTE: this log has no turn markers yet (pre-refactor game), so no recap can be rebuilt for show'
        elif segs: show_note = 'NOTE: show: OPP lines below repeat the opponent turns since your previous turn'
    else: segs = TP.segments(s, n0, first_owner, r0)
    need = None
    if ntype == 'bid':
        vt = S.value_table(s, pend['card'], 'wizards'); mana = A.P(s, nwho)['mana']
        need = dict(type='bid', who=nwho, card=disp(pend['card']), high=pend['high'], leader=pend['who'], your_mana=mana,
                    value_for_you=vt[nwho], value_table=vt, bids_so_far=pend['tail'], started_by=pend['starter'],
                    answer=f"{nwho.lower()} bid N (N > {pend['high']}) or {nwho.lower()} pass",
                    question=f"{nwho}: {disp(pend['card'])}: {pend['who'] or 'nobody'} leads at {pend['high']}. Your bid ({mana} mana)")
    elif ntype == 'action':
        p = A.P(s, nwho)
        need = dict(type='action', who=nwho, again=bool(s['meta'].get('again')),
                    question=f"Round {s['meta']['round']}, {nwho}'s action ({p['mana']} mana, {len(p['tok'])}/{A.capacity(p)} storage)")
    elif ntype == 'pick':
        need = dict(type='pick', who=nwho, question=f"{nwho}: pick 2 different starting Reagent Tokens", answer=f"{nwho.lower()} pick R1 R2")
    waiting = {'bid': f'{nwho} bid', 'action': f"{nwho} action", 'pick': f"{nwho} starting pick", 'game_over': 'game over'}.get(ntype, f"{s['next']} action")
    out = dict(state=path, game=real_tag, round=s['meta']['round'], next=s['next'], humans=humans(s), waiting_on=waiting,
               again=bool(s['meta'].get('again')), ai_engine=AI_ENGINE,
               ai_levels={n: (s['meta'].get('ai_levels') or {}).get(n, 'normal') for n in s['meta']['seat_order'] if n not in humans(s)}, action=desc, events=events, auctions=AUCTION_RESULTS, need=need,
               scores={q['name']: S.score(q, s) for q in s['players']},
               keith=player_info(s, 'Keith') if 'Keith' in humans(s) else None,
               player=player_info(s, nwho) if nwho else None,
               supplies=A.supplies(s) if s['meta'].get('phase') != 'picks' else None,
               end_triggered=bool(s['meta'].get('game_end_triggered')), game_over=bool(s['meta'].get('game_over')),
               options=(human_options(s, nwho) if ntype == 'action' else pick_options(s, nwho) if ntype == 'pick' else None),
               backup=backup, coaching_stub=coach_line)
    lap('summary')
    images, warn = {}, []
    if not o.no_render:
        images, qcs, warn = render_all(s, path, o, real, real_tag); out['images'] = images; out['qc'] = qcs
        if warn: out['render_warnings'] = warn[-12:]
        lap('render')
    out['timing_s'] = TIMING
    if o.brief or verb == 'show':
        ctx = dict(me=me if me in humans(s) else 'Keith', ntype=ntype, nwho=nwho, waiting=waiting, segs=segs, notes=notes, desc=desc, verb=verb, status=status,
                   images=images if not o.no_render else None, render=not o.no_render, t_start=t_start, n0=n0, first_owner=first_owner,
                   coach=coach_line, needs_coach=bool(desc and me == 'Keith' and not o.coach_rating and verb != 'claim'), render_warnings=warn, show_note=show_note)
        text, F = build_package(s, ctx); lap('package')
        print(text + f"\nTIMING: {TIMING}")
        if F: sys.exit(3)
        return
    print(json.dumps(out, indent=1))

if __name__ == '__main__':
    try: main()
    except SystemExit as e:
        if isinstance(e.code, str): print(json.dumps({'error': e.code.replace('ERROR: ', ''), 'state_saved': False})); sys.exit(2)
        raise
    except (ValueError, AssertionError, KeyError, IndexError) as e:
        print(json.dumps({'error': f'{type(e).__name__}: {e}', 'state_saved': False})); sys.exit(2)
