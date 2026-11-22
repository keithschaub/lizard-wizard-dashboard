"""Gameplay regressions from in-game bug reports. Each scenario starts from the reporter's saved game-state.json
(tests/regression/fixtures/issue-<n>.json, copied verbatim from the bug-reports branch) and asserts the correct
behaviour. tests/regression/manifest.json maps every gameplay report to the test that covers it.

A check listed in KNOWN_LIVE marks a regression that is still open on the current head: it is reported as XFAIL and
does not fail the run, but it fails the run as soon as it passes, so the entry is removed together with the fix.

Run: python3 tests/regression/test_regressions.py
"""
import copy, json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, 'engine', 'web'))
import lw_web as W  # noqa: E402

A, AI, S = W.A, W.AI, W.S
# The AI lookahead stops after LA_BUDGET seconds of wall-clock time; evaluate every option so a state always
# leads to the same move on a busy machine.
AI.LA_BUDGET = float('inf')
FIX = os.path.join(REPO, 'tests', 'regression', 'fixtures')

KNOWN_LIVE = {
    '118-lead': 'AI master lookahead outranks the winning last-tower build with research (issue #118)',
}
PASS = FAIL = XFAIL = 0


def check(ok, msg, live=None):
    global PASS, FAIL, XFAIL
    if live:
        if ok: FAIL += 1; print(f'  XPASS {msg}  [{live} now passes: remove it from KNOWN_LIVE]')
        else: XFAIL += 1; print(f'  XFAIL {msg}  [known live regression {live}]')
        return
    PASS += bool(ok); FAIL += (not ok); print(('  PASS ' if ok else '  FAIL ') + msg)


def save(issue): return json.load(open(os.path.join(FIX, f'issue-{issue}.json')))
def call(fn, **kw): return json.loads(W.call(fn, json.dumps(kw)))
def P(s, n): return A.P(s, n)
def base(path): return path.rsplit('/', 1)[-1]


def last_tower_decision(s):
    """Issue #118 save (game over, round 35) rewound to Newt's last chance: Keith's Azure Tower goes back face up with
    his payment refunded, the game is live again and it is Newt's turn. The tower deck is empty, so building the
    face-up tower ends the game."""
    log = s['meta']['log']
    bi = max(i for i, e in enumerate(log) if e.get('act') == 'build' and e.get('who') == '13InchesOfFun')
    k = P(s, '13InchesOfFun'); tw = [t for t in k['towers'] if base(t) == log[bi]['tower']][-1]
    k['towers'].remove(tw); k['tok'] += log[bi]['paid']; s['tower_face'] = tw
    s['meta'].update(game_over=False, game_end_triggered=False, round=35); s['meta'].pop('final', None)
    s['meta']['log'] = log[:bi] + [{'r': 35, 'act': 'turn', 'seat': 'Newt'}]
    s['next'] = 'Newt'
    return s


print('\n=== #118 AI with the lead builds the last tower to win ===')
s = last_tower_decision(save(118))
check(not s.get('tow_list') and s.get('tower_face'), 'rewound #118: tower deck empty, Azure Tower face up')
sc = {p['name']: S.score(p, s) for p in s['players']}
act, why = AI.choose_action(AI.public_view(s, 'Newt'), 'Newt')
check(sc['Newt'] < sc['13InchesOfFun'] and act['type'] != 'build',
      f'as saved Newt trails {sc["Newt"]}-{sc["13InchesOfFun"]} and does not end the game it would lose ({act["type"]})')
lead = copy.deepcopy(s); P(lead, '13InchesOfFun')['towers'] = P(lead, '13InchesOfFun')['towers'][:2]
sc = {p['name']: S.score(p, lead) for p in lead['players']}
act, why = AI.choose_action(AI.public_view(lead, 'Newt'), 'Newt')
check(sc['Newt'] > sc['13InchesOfFun'] + 10, f'lead variant: Newt leads {sc["Newt"]}-{sc["13InchesOfFun"]}')
check(act['type'] == 'build', f'lead variant: Newt builds the last tower and wins (chose {act["type"]}: {why[:120]})',
      live='118-lead')


def rise_pre_cast(s):
    """Issue #133 save (round 27) rewound to Keith's round-26 research of Rise: Rise back on the spell row, its
    5 mana and Mandrake + 2 Nightshade refunded."""
    log = s['meta']['log']
    ri = max(i for i, e in enumerate(log) if e.get('act') == 'research' and e.get('spell') == 'Spell_Rise.jpg')
    k = P(s, '13InchesOfFun')
    rise = [x for x in k['spells'] if base(x['img']) == 'Spell_Rise.jpg'][0]; k['spells'].remove(rise)
    s['spell_list'].insert(0, s['spell_face'][0]); s['spell_face'][0] = rise['img']
    k['mana'] += log[ri]['paid']; k['tok'] += log[ri]['cast_paid']
    s['meta']['log'] = log[:ri]; s['meta']['round'] = log[ri]['r']; s['next'] = '13InchesOfFun'
    return s


print('\n=== #133 Rise re-activates a familiar the caster owns ===')
s = rise_pre_cast(save(133))
check(P(s, '13InchesOfFun')['familiars'] == [], 'rewound #133: Keith owns no familiar')
W.load(json.dumps(s), viewer='13InchesOfFun')
r = call('act_research', spell='Spell_Rise', cast=True)
notes = [e for e in W.st()['meta']['log'][-3:] if e.get('act') == 'web_note']
check(r['ok'] and not r['view'].get('pending') and any('no legal target' in e.get('text', '') for e in notes),
      'with no familiar Rise resolves as no legal target, no effect (as in the report)')
s = rise_pre_cast(save(133))
fam = P(s, 'Newt')['familiars'].pop(1); P(s, '13InchesOfFun')['familiars'].append(fam)
W.load(json.dumps(s), viewer='13InchesOfFun')
r = call('act_research', spell='Spell_Rise', cast=True)
pd = r['view'].get('pending') or {}
opts = pd.get('options', [])
check(r['ok'] and pd.get('kind') == 'rise' and [o.get('familiar') for o in opts] == [base(fam)[:-4]],
      f'with {base(fam)[:-4]} owned Rise asks which familiar to re-activate ({pd.get("kind")})')
r = call('resolve_effect', choice=opts[0] if opts else {})
pd = r['view'].get('pending') or {}
check(r['ok'] and pd.get('type') == 'rise' and base(pd.get('familiar', '')) == base(fam)[:-4],
      f'picking it opens its use choice ({pd.get("type")})')
r = call('rise_use', use='score')
check(r['ok'] and not r['view'].get('pending') and any(e.get('act') == 'rise' for e in W.st()['meta']['log'][-4:]),
      'choosing a use re-activates it and logs the rise')



def root_cellar_gather(s):
    """Issue #156 save (round 17, 13InchesOfFun to act, 10 reagents, Root Cellar cast, no towers): back to his round 16
    move. Root Cellar is uncast again and Reagent 55 is back in hand, so he holds 10 reagents at a limit of 10."""
    k = P(s, '13InchesOfFun')
    next(x for x in k['spells'] if 'Root_Cellar' in x['img'])['cast'] = False
    card = next(x for x in s['reag_discard'] if base(x) == 'Reagent_55.jpg')
    s['reag_discard'].remove(card); s['reag_list'].insert(0, k['hand'][0]); k['hand'][0] = card
    s['reag_deck'] = len(s['reag_list'])
    return s


print('\n=== #156 Root Cellar cast with a gather raises the limit before the storage check ===')
r = call('load', text=json.dumps(root_cellar_gather(save(156))))
k = P(W.st(), '13InchesOfFun')
check(r['ok'] and len(k['tok']) == 10 and A.capacity(k) == 10, f"rewound #156: 10 reagents held, limit {A.capacity(k)}")
keep = ['Foxglove', 'Eye_of_Newt', 'Toadstool']
pv = call('gather_preview', card='Reagent_55', keep=keep)['result']
check(pv['over'] == 6 and pv['cap'] == 10, f"without a cast the gather of 6 must put back 6 ({pv['over']})")
pv = call('gather_preview', card='Reagent_55', keep=keep, cast='Spell_Root_Cellar')['result']
check(pv['over'] == 0 and pv['cap'] == 20, f"casting Root Cellar with it: limit 20, nothing to put back ({pv['over']}, cap {pv['cap']})")
r = call('act_gather', card='Reagent_55', keep=keep, cast='Spell_Root_Cellar')
k = P(W.st(), '13InchesOfFun')
check(r['ok'] and len(k['tok']) == 13 and A.capacity(k) == 20 and any('Root_Cellar' in x['img'] and x['cast'] for x in k['spells']),
      f"the gather and cast commit with no put-back: 13 reagents kept, Root Cellar cast ({r.get('error')})")

# The same holds for a familiar's Gather & Cast: the preview counts the put-back with Root Cellar cast.
s = root_cellar_gather(save(156)); k = P(s, '13InchesOfFun')
cost = W.spell_cost('Spell_Root_Cellar')
fam = next(f for f in s['fam_face'] if f and int(W.CD.get(W.jpg(W.key(f)))['collect']) >= 4)
k['tok'] = cost + ['Horn'] * (10 - len(cost))
call('load', text=json.dumps(s))
pv = call('summon_gather_preview', familiar=W.key(fam), casts=['Spell_Root_Cellar'])['result']
check(pv['over'] == 0 and pv['cap'] == 20, f"familiar gather casting Root Cellar: limit 20, nothing to put back ({pv['over']}, cap {pv['cap']})")

print(f'\n{PASS} passed, {FAIL} failed, {XFAIL} known live regressions')
sys.exit(1 if FAIL else 0)
