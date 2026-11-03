"""ONE complete, self-checking TURN PACKAGE for the Lizard Wizard chat game (refactor Nov 2, 2026).

turn.py builds the package after every command (`turn.py keith <action> --brief`, or `turn.py keith show`):
  HEAD    round, whose decision, public scores, Keith's own mana/gold/storage
  YOU     what Keith's command did
  OPP     ONE line per opponent turn since Keith's last decision (never empty: says why if no opponent moved)
  OCAST   card image (assets/enhanced) + carddb text for every opponent research / cast
  ACH     achievements auto-claimed this run (and any still claimable -> QC FAIL)
  END     game-end status by the rulebook depletion rule (deck + face-up)
  BOARD / MATS   rendered image paths (QC'd: exist, fresh, size)
  OPTIONS grouped: every affordable action (all gathers + all choose-3 keeps, gather+cast, convert, build, recruit,
          research, summon x4 uses), then UNAVAILABLE
  WIDGET  top 6 (every hand gather first), allowCustom
  CARD    image + carddb text for every face-up spell and every uncast spell Keith owns
  QC      PASS, or FAIL lines (loud; turn.py exits 3)
  CHECKLIST  what the assistant must send, in order
Pure functions only: nothing here changes the game state."""
import os, re, json, itertools, copy
from collections import Counter
import actions as A, scoring as S, carddb as CD, spell_effects as SE

R = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ENH = os.path.join(R, 'assets', 'enhanced')
b = os.path.basename
def nice(r): return str(r).replace('_', ' ')
def disp(img): return CD.display(img)
def humans(s): return s['meta'].get('humans', ['Keith'])
def ais(s): return [n for n in s['meta']['seat_order'] if n not in humans(s)]

# ------------------------------------------------------------------ images (enhanced art only)
def enhanced(img_or_key):
    """assets/enhanced/<same basename>; returns the path even if missing (QC then fails loudly)."""
    return os.path.join(ENH, b(str(img_or_key)))
def dungeon_img(c):
    """Enhanced image for a dungeon card dict (Monster / Item / Gold / Trap)."""
    t = c.get('type')
    if t == 'Monster': return enhanced('Dungeon_Monster_' + re.sub(r'[^A-Za-z0-9]+', '_', c.get('name', '')).strip('_') + '.jpg')
    if t == 'Trap': return enhanced('Dungeon_Trap_a.jpg')
    if c.get('subtype') == 'Gold' or c.get('gold'): return enhanced(f"Dungeon_Gold{int(c.get('gold') or 1)}_a.jpg")
    return enhanced('Dungeon_' + re.sub(r'[^A-Za-z0-9]+', '_', c.get('name', '')).strip('_') + '.jpg')
def dungeon_name(c):
    if c.get('type') == 'Treasure' and (c.get('subtype') == 'Gold' or c.get('gold')): return f"{c.get('gold', 1)} Gold"
    if c.get('type') == 'Monster': return f"{c.get('name')} (Monster{', ' + c['monster_type'] if c.get('monster_type') else ''}: 1 hit)"
    if c.get('type') == 'Trap': return "It's a Trap! (2 hits)"
    return f"{c.get('name')} (Item)"

def treasure_left(s):
    """Read-only (never builds the deck): True if the dungeon still holds treasure, or was never built."""
    dl = s.get('dungeon_list')
    return True if dl is None else any(c.get('type') == 'Treasure' for c in dl)
def card_text(img):
    """'Name (School) | duration | mana N + reagents | "effect"' straight from carddb (never from memory)."""
    c = CD.get(img)
    if not c: return f"{b(str(img))} | NOT IN carddb"
    cost = c.get('cost') or {}
    rg = ' + '.join(f"{v} {nice(k)}" for k, v in (cost.get('reagents') or {}).items()) or ('X' if cost.get('variable') else '-')
    return f"{c['display']} | {c.get('duration')} | mana {cost.get('mana')} | cast {rg}{' (+X)' if cost.get('variable') else ''} | \"{c.get('effect')}\""

# ------------------------------------------------------------------ turn segmentation (opponent recap)
def segments(s, n0, first_owner, r0=None):
    """Split log[n0:] into turns. A {'act':'turn','seat':X} marker (written by turn.advance) starts X's turn.
    The first segment belongs to `first_owner` (whoever was to act when the command started)."""
    segs = [dict(owner=first_owner, r=r0 if r0 is not None else s['meta'].get('round'), entries=[], marker=False)]
    for e in s['meta'].get('log', [])[n0:]:
        if e.get('act') == 'turn':
            segs.append(dict(owner=e['seat'], r=e.get('r'), entries=[], marker=True)); continue
        segs[-1]['entries'].append(e)
    return segs

QUIET = ('turn', 'setup_picks')
def recap_line(s, seg, describe, notes=()):
    ev = [describe(e) for e in seg['entries'] if e.get('act') not in QUIET]
    ev += [n for n in notes if n.startswith(seg['owner'] + ' ') or f' {seg["owner"]} ' in n]
    pend = s['meta'].get('pending') if isinstance(s['meta'].get('pending'), dict) else None
    if pend and pend.get('starter') == seg['owner'] and seg is not None:
        bids = ', '.join(f"{n} {v}" for n, v in pend.get('tail', []))
        ev.append(f"opened an auction for {disp(pend['card'])} (bids so far: {bids}); waiting on {pend.get('waiting') or 'a bid'}")
    if not ev: ev = ['took no action (no legal action this turn)']
    o = seg['owner']; ev = [x[len(o) + 1:] if x.startswith(o + ' ') else x for x in ev]
    return f"R{seg['r']} {o}: " + '; '.join(ev)

def ocast_lines(s, entries, viewer='Keith'):
    """Every opponent research / cast / New Research in `entries`, with enhanced card + carddb text."""
    out = []
    for e in entries:
        a = e.get('act'); w = e.get('who')
        if not w or w in humans(s): continue
        if a == 'research': key, how = e['spell'], ('researched and cast' if e.get('cast') else 'researched (not cast yet)')
        elif a == 'cast': key, how = e['spell'], 'cast'
        elif a == 'new_research': key, how = e['took'], 'took with New Research (not cast yet)'
        elif a == 'scry_spells': key, how = e.get('took'), 'took and cast with Scribe'
        else: continue
        if not key: continue
        out.append(f"OCAST: {w} {how} {card_text(key)} | IMG {enhanced(key)}")
    return out

def no_opp_reason(s, verb, status, me, ntype):
    pend = s['meta'].get('pending') if isinstance(s['meta'].get('pending'), dict) else None
    if s['meta'].get('game_over'): return 'none: the game is over'
    if verb in ('show', 'options', 'status', 'level'): return 'none ran (show/options command: nothing changed)'
    if verb == 'claim': return 'none: claiming is not an action, it is still your turn'
    if status == 'stopped (--no-ai)': return 'none: --no-ai was used (TEST ONLY)'
    if pend and pend.get('starter') == me: return f"none yet: your auction for {disp(pend['card'])} is waiting on your next bid"
    if s['meta'].get('again'): return 'none yet: you lost the auction you started, so you take another action now'
    if ntype == 'pick': return 'none yet: starting picks'
    return 'none: it came straight back to you'

def recap_since_last_turn(s, me, describe):
    """For `show`: opponent segments after the end of `me`'s previous turn (needs turn markers)."""
    L = s['meta'].get('log', [])
    idx = [i for i, e in enumerate(L) if e.get('act') == 'turn']
    if not idx: return None
    mine = [i for i in idx if L[i]['seat'] == me]
    cur = mine[-1] if mine and s['next'] == me else len(L)
    prev = [i for i in idx if i < cur and L[i]['seat'] != me]
    start = None
    for i in reversed([i for i in idx if i < cur]):
        if L[i]['seat'] == me: break
        start = i
    if start is None: return []
    segs = segments(s, start + 1, L[start]['seat'], L[start].get('r'))
    segs = [g for g in segs if g['owner'] != me]
    return segs

# ------------------------------------------------------------------ options (grouped, every affordable action)
def _bonus(p): return [A.norm(CD.wizard_bonus(w)) for w in p.get('wizards', []) if CD.wizard_bonus(w)]
def proj_pairing(s, p, keep, drop=()):
    """Projected pairing VP if Keith gathers `keep` (+wizard bonus) then spends tokens on towers: the face-up tower if
    affordable, plus one school-unknown tower per remaining same-reagent pair (scoring.pairing)."""
    tok = Counter(p['tok']) + Counter(keep) + Counter(_bonus(p)) - Counter(drop)
    q = {'wizards': list(p.get('wizards', [])), 'towers': list(p.get('towers', [])), 'spells': p.get('spells', [])}
    tf = s.get('tower_face')
    if tf:
        tier, r, _ = CD.tower_info(tf); r = A.norm(r)
        if tok[r] >= int(tier): tok[r] -= int(tier); q['towers'].append(tf)
    q['towers'] += [None] * sum(k // 2 for k in tok.values())
    return S.pairing(q)
def gather_keeps(s, p, card):
    g, inc = CD.reagent_icons(card); g = [A.norm(x) for x in g]
    if len(g) <= 3 or SE.has_cast(p, 'Maximum_Gather'): return g, inc, [tuple(g)]
    return g, inc, sorted({tuple(sorted(k)) for k in itertools.combinations(g, 3)})

def grouped_options(s, me):
    """List of option dicts: group, key, label, cmd, score (widget priority), putback (int), pair (bool)."""
    p = A.P(s, me); tok = Counter(p['tok']); cap = A.capacity(p); bon = _bonus(p); O = []; U = []
    base = proj_pairing(s, p, [])
    def opt(group, key, label, cmd, score, **kw): O.append(dict(group=group, key=key, label=label, cmd=cmd, score=score, **kw))
    # GATHER: every hand card, every distinct keep
    for c in p['hand']:
        cid = b(c)[8:-4]; g, inc, keeps = gather_keeps(s, p, c)
        rows = []
        for k in keeps:
            over = max(0, len(p['tok']) + len(k) + len(bon) - cap)
            d = proj_pairing(s, p, k) - base; new = len(set(k) - set(tok))
            rows.append((d, new, sum(s['tracks'][r] for r in k), k, over))
        best = max(rows, key=lambda x: (x[0], x[1], x[2]))
        for d, new, trk, k, over in rows:
            star = (k == best[3]) and len(keeps) > 1
            lab = (f"Gather {cid}: {', '.join(nice(r) for r in k)}" + (f" (choose 3 of {', '.join(nice(r) for r in g)})" if len(keeps) > 1 else '')
                   + f" · raises {', '.join(nice(r) for r in inc)}" + (f" · +{len(bon)} wizard bonus ({', '.join(nice(r) for r in bon)})" if bon else '')
                   + (f" · builds pairs +{d} proj VP" if d > 0 else '') + f" · +{new} new type{'s' * (new != 1)}"
                   + (f" · OVER STORAGE: put back {over} (ASK Keith which)" if over else f" · storage {len(p['tok']) + len(k) + len(bon)}/{cap}")
                   + (' ★best keep' if star else ''))
            cmd = f"keith gather {cid}" + (' --keep ' + ' '.join(k) if len(keeps) > 1 else '') + (f' --discard <ASK KEITH: {over} tokens>' if over else '')
            wl = f"Gather {cid}: {', '.join(nice(r) for r in k)}" + (f" (pairs +{d})" if d > 0 else '') + (f", put back {over}" if over else '')
            opt('GATHER', ('gather', cid, k), lab, cmd, 1000 + d * 10 + new + (5 if star or len(keeps) == 1 else 0), putback=over, pair=d > 0, wlabel=wl,
                card=cid, primary=(star or len(keeps) == 1), pool=sorted(p['tok'] + list(k) + bon), offers=list(g), raises=list(inc), nkeeps=len(keeps))
    def _offs(rs): return ', '.join(nice(r) + (f' x{n}' if n > 1 else '') for r, n in Counter(rs).items())
    # GATHER + CAST one owned uncast spell (gathered + wizard-bonus reagents count; cost spent before the storage check)
    for x in p.get('spells', []):
        if x.get('cast'): continue
        cc = CD.cast_cost(x['img'])
        if cc is None: continue
        cc = [A.norm(r) for r in cc]
        for c in p['hand']:
            cid = b(c)[8:-4]; g, inc, keeps = gather_keeps(s, p, c)
            ok = [k for k in keeps if not (Counter(cc) - (tok + Counter(k) + Counter(bon)))]
            if not ok: continue
            k = ok[0]; over = max(0, len(p['tok']) + len(k) + len(bon) - len(cc) - cap)
            q = copy.deepcopy(p)
            for y in q['spells']:
                if y['img'] == x['img'] and not y.get('cast'): y['cast'] = True; break
            dvp = S.score(q, s) - S.score(p, s)
            atk = CD.is_negative(x['img'])
            opt('GATHER+CAST', ('gathercast', cid, b(x['img'])),
                f"Gather {cid}: {_offs(g)}" + (f" (keep {', '.join(nice(r) for r in k)})" if len(keeps) > 1 else '') + f" and cast your {disp(x['img'])}: pay {', '.join(nice(r) for r in cc)}"
                + (f" · +{dvp} VP" if dvp else '') + (' · ATTACK: needs --target/--card' if atk else '') + (f" · put back {over} (ASK Keith)" if over else ' · no put-back'),
                f"keith gather {cid}" + (' --keep ' + ' '.join(k) if len(keeps) > 1 else '') + f" --cast {b(x['img'])[6:-4]}" + (' --target P --card C' if atk else '')
                + (f' --discard <ASK KEITH: {over} tokens>' if over else ''), 900 + dvp, putback=over, spell=x['img'], offers=list(g), card=cid,
                pool=sorted((Counter(p['tok']) + Counter(k) + Counter(bon) - Counter(cc)).elements()),
                wlabel=f"Gather {cid}: {_offs(g)}" + (f" (keep {_offs(k)})" if len(keeps) > 1 else '') + f" + cast {disp(x['img'])}" + (f" +{dvp} VP" if dvp else '') + (f", put back {over}" if over else ''))
    # CONVERT
    if tok:
        for r, k in sorted(tok.items(), key=lambda kv: -s['tracks'][kv[0]] * kv[1]):
            v = s['tracks'][r]
            opt('CONVERT', ('convert', r), f"Convert {k} {nice(r)} at {v} each = {k * v} mana (any 1-{k}; track then {max(1, v - k)})", f"keith convert {r} {k}", k * v / 4.0)
        if len(tok) >= 2:
            opt('CONVERT', ('convert1',), f"Convert any mix at 1 mana each (no track change): {', '.join(f'{k} {nice(r)}' for r, k in tok.items())}",
                f"keith convert1 {','.join(p['tok'])}", 0.1)
    else: U.append('Convert (no reagent tokens)')
    # BUILD
    tf = s.get('tower_face')
    if tf:
        tier, r, sc = CD.tower_info(tf); r = A.norm(r); vt = S.value_table(s, tf, 'towers')
        others = ', '.join(f'{n} +{v}' for n, v in vt.items() if n != me)
        nr, ng = A.tower_cost(p, tf, 'reagent'), A.tower_cost(p, tf, 'gold')
        if tok[r] >= nr: opt('BUILD', ('build', 'reagent'), f"Build {disp(tf)} paying {nr} {nice(r)}: +{vt[me]} VP (others {others})", f"keith build {b(tf)[9:-4]} reagent", vt[me] + 2)
        if p.get('gold', 0) >= ng: opt('BUILD', ('build', 'gold'), f"Build {disp(tf)} paying {ng} Gold: +{vt[me]} VP, -{ng} VP of Gold (others {others})", f"keith build {b(tf)[9:-4]} gold", vt[me] - ng + 2)
        if tok[r] < nr and p.get('gold', 0) < ng: U.append(f"Build {disp(tf)} (needs {nr} {nice(r)} or {ng} Gold; you have {tok[r]} {nice(r)}, {p.get('gold', 0)} Gold)")
    else: U.append('Build (tower supply empty)')
    # RECRUIT
    wz = [w for w in s.get('wiz_face', []) if w]
    for w in wz:
        vt = S.value_table(s, w, 'wizards')
        if p['mana'] >= 1:
            opt('RECRUIT', ('recruit', b(w)), f"Recruit {disp(w)} (gather bonus {nice(CD.wizard_bonus(w))}): +{vt[me]} VP for you (others {', '.join(f'{n} +{v}' for n, v in vt.items() if n != me)}); opening bid 1-{p['mana']} (ASK Keith)",
                f"keith recruit {b(w)[7:-4]} <OPENING BID>", vt[me])
        else: U.append(f"Recruit {disp(w)} (no mana)")
    if not wz: U.append('Recruit (wizard supply empty)')
    # RESEARCH (every face-up spell; research-only and research+cast)
    for sp in [x for x in s.get('spell_face', []) if x]:
        c = CD.get(sp); mana = (c.get('cost') or {}).get('mana', 5); cc = CD.cast_cost(sp); need = Counter(A.norm(r) for r in (cc or []))
        if p['mana'] < mana: U.append(f"Research {c['display']} (needs {mana} mana, you have {p['mana']})"); continue
        q = copy.deepcopy(p); q.setdefault('spells', []).append({'img': sp, 'cast': True}); dvp = S.score(q, s) - S.score(p, s)
        atk = CD.is_negative(sp)
        if cc is not None and not (need - tok):
            opt('RESEARCH', ('research_cast', b(sp)), f"Research + cast {c['display']} ({mana} mana + {', '.join(nice(r) for r in cc)})" + (f" · +{dvp} VP" if dvp else '') + (' · ATTACK: needs --target/--card' if atk else ''),
                f"keith research {b(sp)[6:-4]} --cast" + (' --target P --card C' if atk else ''), 3 + dvp)
        short = ', '.join(f"{k} {nice(r)}" for r, k in (need - tok).items()) if cc is not None else 'variable X cost'
        opt('RESEARCH', ('research', b(sp)), f"Research {c['display']} only ({mana} mana, cast later)" + (f" · can't cast now: short {short}" if cc is None or (need - tok) else ''), f"keith research {b(sp)[6:-4]}", 1)
    # SUMMON (all four uses)
    treasure = treasure_left(s)
    for f in [x for x in s.get('fam_face', []) if x]:
        c = CD.get(f); cost = SE.familiar_cost(p, f)
        if p['mana'] < cost: U.append(f"Summon {disp(f)} (needs {cost} mana, you have {p['mana']})"); continue
        sc = c['school']; n = 1 + sum(1 for y in p.get('wizards', []) + p.get('towers', []) + p.get('familiars', []) if S.school(y) == sc) + sum(1 for y in p.get('spells', []) if S.school(y['img']) == sc)
        fk = b(f)[:-4]
        opt('SUMMON', ('summon', b(f), 'score'), f"Summon {disp(f)} ({cost} mana) to SCORE: +{n} Gold", f"keith summon {fk} score", 2 + n - cost / 5.0)
        rr = A.norm(c['reagent']); after = Counter(p['tok']) + Counter([rr] * int(c['collect']))
        cast_ok = [disp(x['img']) for x in p.get('spells', []) if not x.get('cast') and CD.cast_cost(x['img']) is not None and not (Counter(A.norm(r) for r in CD.cast_cost(x['img'])) - after)]
        over = max(0, sum(after.values()) - cap)
        opt('SUMMON', ('summon', b(f), 'gather'), f"Summon {disp(f)} ({cost} mana) to GATHER {c['collect']} {nice(c['reagent'])} and cast any owned spells" + (f" (castable: {', '.join(cast_ok)})" if cast_ok else ' (none castable)') + (f" · may need put-back {over} (ASK Keith)" if over else ''),
            f"keith summon {fk} gather" + (' --cast SPELL ...' if cast_ok else '') + (f' --discard <ASK KEITH: {over} tokens>' if over else ''), 1.5 + 5 * len(cast_ok),
            putback=over, pool=sorted(after.elements()), wlabel=f"Summon {disp(f)}: gather {c['collect']} {nice(c['reagent'])}" + (f", put back {over}" if over else ''))
        if treasure: opt('SUMMON', ('summon', b(f), 'dungeon'), f"Summon {disp(f)} ({cost} mana) and ENTER THE DUNGEON (card by card)", f"keith summon {fk} dungeon --draws 1 --preview", 2)
        else: U.append(f"Summon {disp(f)} to enter the Dungeon (no treasure left)")
        opt('SUMMON', ('summon', b(f), 'research'), f"Summon {disp(f)} ({cost} mana) for NEW RESEARCH (clear the 4 spells, take 1 of 4 new free)", f"keith summon {fk} research", 1)
    return O, U

def required_keys(s, me):
    """Independent enumeration of the actions that MUST appear (used by QC; never by the options builder)."""
    p = A.P(s, me); req = set(); tok = Counter(p['tok'])
    for c in p['hand']: req.add(('gathercard', b(c)[8:-4]))
    for r in tok: req.add(('convert', r))
    tf = s.get('tower_face')
    if tf:
        _, r, _ = CD.tower_info(tf)
        if tok[A.norm(r)] >= A.tower_cost(p, tf, 'reagent'): req.add(('build', 'reagent'))
        if p.get('gold', 0) >= A.tower_cost(p, tf, 'gold'): req.add(('build', 'gold'))
    if p['mana'] >= 1:
        for w in s.get('wiz_face', []):
            if w: req.add(('recruit', b(w)))
    for sp in s.get('spell_face', []):
        if sp and p['mana'] >= CD.get(sp)['cost']['mana']: req.add(('research', b(sp)))
    for f in s.get('fam_face', []):
        if f and p['mana'] >= SE.familiar_cost(p, f):
            for u in ('score', 'gather', 'research') + (('dungeon',) if treasure_left(s) else ()): req.add(('summon', b(f), u))
    bon = Counter(_bonus(p))
    for x in p.get('spells', []):
        cc = None if x.get('cast') else CD.cast_cost(x['img'])
        if cc is None: continue
        for c in p['hand']:
            g, _, keeps = gather_keeps(s, p, c)
            if any(not (Counter(A.norm(r) for r in cc) - (tok + Counter(k) + bon)) for k in keeps): req.add(('gathercast', b(c)[8:-4], b(x['img'])))
    return req
def emitted_keys(O):
    out = set()
    for o in O:
        k = o['key']
        if k[0] == 'gather': out.add(('gathercard', k[1]))
        elif k[0] == 'research_cast': out.add(('research', k[1]))
        else: out.add(k)
    return out

def widget(O, n=6):
    """Widget: MANDATORY entries first and never dropped: every hand-card gather, every legal BUILD (collapsed to one
    'Build a tower' menu only if they would not fit), and the research menu. Then the best other action per group."""
    g, seen = [], set()
    for o in sorted([o for o in O if o['group'] == 'GATHER' and o.get('primary')], key=lambda o: -o['score']):
        if o['card'] not in seen: seen.add(o['card']); g.append(o)
    bl = sorted([o for o in O if o['group'] == 'BUILD'], key=lambda o: -o['score'])
    rs = [o for o in O if o['group'] == 'RESEARCH']
    if rs and not any(o.get('key') == ('research_menu',) for o in rs):
        rs = [dict(group='RESEARCH', key=('research_menu',), label='Research a spell', wlabel='Research a spell',
                   cmd='(then show RESEARCH CHOICES)', score=max(o['score'] for o in rs))]
    if len(g) + len(bl) + len(rs) > n and len(bl) > 1:
        bl = [dict(group='BUILD', key=('build_menu',), label='Build a tower', wlabel=f"Build a tower ({len(bl)} options)",
                   cmd='(then show BUILD CHOICES)', score=bl[0]['score'])]
    must = g + bl + rs
    rest = sorted([o for o in O if o['group'] not in ('GATHER', 'BUILD', 'RESEARCH')], key=lambda o: -o['score'])
    first, groups = [], set()
    for o in rest:
        if o['group'] not in groups: groups.add(o['group']); first.append(o)
    rest = first + [o for o in rest if o not in first]
    return (must + rest)[:max(n, len(must))]

def short(x, n=70): return x if len(x) <= n else x[:n - 1] + '…'
def widget_label(o):
    if o.get('wlabel'): return o['wlabel'] if o.get('group', '').startswith('GATHER') else short(o['wlabel'])
    lab = o['label'].split(' · ')[0]
    lab = re.sub(r' \(gather bonus [^)]*\)', '', lab); lab = re.sub(r' \(others [^)]*\)', '', lab)
    lab = re.sub(r'; opening bid .*', '', lab)
    return short(lab)

# ------------------------------------------------------------------ game end
def end_line(s):
    sup = A.supplies(s); trig = s['meta'].get('game_end_triggered')
    det = ', '.join(f"{k} {v}" for k, v in sup.items())
    if s['meta'].get('game_over'): return f"END: GAME OVER (supplies incl. face-up: {det})"
    if trig: return f"END: TRIGGERED, a supply is fully depleted (incl. face-up): {det}. Finish this round (R{s['meta']['round']}), then the game ends."
    return (f"END: not triggered. Supplies incl. face-up cards: {det}. Rulebook: the game ends only when a Wizard, Tower, Spell or "
            f"Familiar supply is fully depleted INCLUDING its face-up cards; then the current round finishes.")

# ------------------------------------------------------------------ QC
def qc(s, text, me, ntype, renders, t_start, opp_segs, card_imgs, n0, verb, want_render=True):
    F = []
    # (1) renders: exist, fresh, size
    if want_render:
        for part in ('board', 'mats'):
            pth = (renders or {}).get(part)
            if not pth: F.append(f"render {part}: missing (no path)"); continue
            if not os.path.exists(pth): F.append(f"render {part}: file missing {pth}"); continue
            if os.path.getmtime(pth) + 1 < t_start: F.append(f"render {part}: STALE (older than this command) {pth}")
            if os.path.getsize(pth) < 30000: F.append(f"render {part}: too small ({os.path.getsize(pth)} bytes) {pth}")
    # (2) card images must be enhanced and exist
    for pth in card_imgs:
        if '/assets/enhanced/' not in pth: F.append(f"non-enhanced card image {pth}")
        elif not os.path.exists(pth): F.append(f"enhanced card image missing {pth}")
    # (3) opponent turns: every AI segment has an OPP line, and turns follow seat order (no skipped seat)
    o = s['meta']['seat_order']
    owners = [g['owner'] for g in opp_segs['all'] if g['owner'] in o]
    for a_, b_ in zip(owners, owners[1:]):
        if o[(o.index(a_) + 1) % len(o)] != b_: F.append(f"turn order broken: {b_} followed {a_} (a seat was skipped)")
    for g in opp_segs['all']:
        if g['owner'] in ais(s) and id(g) not in opp_segs['lined']: F.append(f"opponent turn without a recap line: R{g['r']} {g['owner']}")
    if 'OPP:' not in text: F.append('OPP section empty')
    L = s['meta'].get('log', [])
    for e in L[n0:]:                                   # every AI action in the log must sit inside an AI-owned segment
        w = e.get('who')
        if w in ais(s) and e.get('act') not in ('trigger', 'shield_used', 'achievement') and not any(e in g['entries'] for g in opp_segs['all'] if g['owner'] == w):
            if not (isinstance(s['meta'].get('pending'), dict)): F.append(f"AI action outside its own turn: {e.get('act')} by {w}")
    # (4) tracks in 1..12
    for r, v in s['tracks'].items():
        if not 1 <= v <= 12: F.append(f"track {r} = {v} outside 1..12")
    # (5) achievements: nothing claimable left for the human whose decision it is
    if ntype == 'action':
        left = [t for t in s.get('ach', []) if A.achievement_met(A.P(s, me), t)]
        if left: F.append(f"claimable achievement(s) not auto-claimed for {me}: {left}")
    # (6) game end vs rulebook depletion rule
    sup = A.supplies(s); trig = bool(s['meta'].get('game_end_triggered')); dep = min(sup.values()) == 0
    if dep and not trig and s['meta'].get('phase') not in ('picks', 'setup', 'pick'): F.append(f"a supply is depleted ({sup}) but game end is NOT triggered")
    if trig:
        te = [e for e in L if e.get('act') == 'game_end_triggered']
        if not te or min((te[-1].get('supplies') or {'x': 1}).values()) != 0: F.append('game end triggered without a fully depleted supply (deck + face-up)')
        elif not s['meta'].get('game_over') and s['meta'].get('round') != te[-1].get('r'): F.append('game end triggered in an earlier round but the game kept going')
    if s['meta'].get('game_over') and not trig: F.append('game_over set without a game-end trigger')
    # (7) hidden AI info must not leak
    for q in s['players']:
        n = q['name']
        if n in humans(s): continue
        for h in q.get('hand', []):
            cid = b(h)[8:-4]
            if re.search(rf"Reagent_{cid}\b", text) or re.search(rf"{n}[^\n]{{0,40}}\bhand\b[^\n]{{0,20}}\b{cid}\b", text): F.append(f"LEAK: {n}'s hidden hand card {cid}")
        if re.search(rf"\b{n}(?:'s)? (?:mana|gold)\b\W*\d", text, re.I) or re.search(rf"\b{n}\b\W{{0,3}}(?:has|with)\s+{q['mana']} mana", text):
            F.append(f"LEAK: {n}'s secret mana/gold")
        if re.search(rf"\b{n}\b'?,?\s*\(\d+,\s*{q['mana']}\)", text): F.append(f"LEAK: {n}'s mana in a score tuple")
    for k in ('wiz_list', 'tow_list', 'spell_list', 'fam_list', 'dungeon_list', 'reag_list'):
        if k in text: F.append(f"LEAK: hidden deck {k} in output")
    if re.search(r'\bproxy\b|\bmax bid', text, re.I): F.append('proxy/max bidding mentioned (Keith forbids it)')
    return F

CHECKLIST = """CHECKLIST (do ALL of these, in this order, every turn; send with SendToUser, never as plain reply text):
 1. Send the opponent recap: every OPP line (one per opponent turn), and for every OCAST line show its card image (the IMG path, enhanced art) with its carddb text.
 2. Send the BOARD image, then the MATS image (both paths above; never skip, never reuse an old render).
 3. Send the full grouped OPTIONS list, then the widget with the WIDGET top 6 and allowCustom (every hand gather is in it).\n - Gather: ONE option per hand card showing EVERY reagent it offers. If it says 'keep 3', after Keith picks that card send its GATHER CHOICES (every keep combination) as a widget.\n - Research is ONE option ('Research a spell'). Only after Keith picks it, send the RESEARCH CHOICES: each spell's CARD image + carddb text, then a widget of those spells.
 - Card names always carry their school in parentheses; card text only from the CARD/OCAST lines (carddb), never memory.
 - Put-backs: if an option says ASK Keith / <ASK KEITH>, ask with a multi-select of his current + incoming tokens BEFORE running it. Never pick them yourself.
 - Research or cast: show that spell's CARD image + carddb text BEFORE running the command. Spirit Shield (Enchantment) = dungeon hits; Spell Shield = blocks a negative spell.
 - Dungeon: card by card. Run '--preview --draws N' (no state change), show each drawn card's enhanced image, ask "Keep going?", commit with the same --draws N only when he stops.
 - Bids: ask one step at a time (Pass / Bid high+1 + allowCustom). Never offer max/proxy bidding.
 - Ambiguous reply -> ask. Clear choice -> do it, no re-confirm. Write the coaching rating (--coach-rating "good|mixed|weak: why").
 - If QC says FAIL: fix it first (re-run show); do not send a package that failed QC."""
BID_CHECKLIST = """CHECKLIST (bid step; send with SendToUser):
 1. Send every OPP line (and OCAST card images + carddb text) for opponent turns that already happened.
 2. Send the BOARD image, then the MATS image.
 3. Ask for ONE bid: widget [Pass] [Bid high+1] with allowCustom. No max/proxy bidding. Show the wizard's card (school in parentheses) and its VALUE line."""
