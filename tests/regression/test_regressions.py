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



def final_turn(s):
    """Issue #158 save (game over, round 39): reopened at Newt's (master) final turn. 13InchesOfFun's summon emptied
    the familiar deck and triggered the end; Newt then researched and cast Perfect Reagent (+0 VP) and lost 39 to 35."""
    m = s['meta']; m['game_over'] = False; m.pop('final', None)
    m['log'] = [e for e in m['log'] if e.get('act') != 'game_over']
    while not (m['log'][-1].get('act') == 'turn' and m['log'][-1].get('seat') == 'Newt'): m['log'].pop()
    s['next'] = 'Newt'
    return s

def keith_mana(s, by):
    """Lower 13InchesOfFun's mana by `by`, in the state and in his logged converts (the AI reads the public ledger)."""
    P(s, '13InchesOfFun')['mana'] -= by
    for e in reversed(s['meta']['log']):
        if by and e.get('act') == 'convert' and e.get('who') == '13InchesOfFun':
            d = min(by, e['gain']); e['gain'] -= d; by -= d
    return s

def decide(s, who='Newt'):
    v = AI.public_view(s, who); act, why = AI.choose_action(v, who)
    return act, why, {base(wz): AI.opening_bid(AI.public_view(s, who), who, wz) for wz in s['wiz_face']}

IGNUS, SERP = 'Wizard_Ignus_Fulgorus.jpg', 'Wizard_Serpentium_Machinus.jpg'
print('\n=== #158 master last turn: final points only, all-in duel only when losing is safe ===')
s = final_turn(save(158)); k, n = P(s, '13InchesOfFun'), P(s, 'Newt')
check(S.score(k, s) == 39 and S.score(n, s) == 35 and (k['mana'], n['mana']) == (94, 41) and s['meta']['game_end_triggered'],
      'reopened #158: 13InchesOfFun 39 VP and 94 mana, Newt 35 VP and 41 mana, game end triggered')
vt = S.value_table(s, 'assets/' + IGNUS, 'wizards')
check(vt == {'13InchesOfFun': 4, 'Newt': 9}, f'Ignus Fulgorus: +9 for Newt (pairs a tower), only +4 for 13InchesOfFun (no matching tower) {vt}')
act, why, _ = decide(s)
check(act['type'] != 'recruit' and act.get('last_turn') and 'final 35.0 VP' in why,
      f"(a) as is: no duel (13InchesOfFun can top any bid and a loss hands him +4); valued on final points: {act['type']} ({why[:90]})")
check(act['type'] == 'convert', f"(a) every option ends on 35 VP, so the one keeping the most mana wins the tie ({act['type']})")
s = keith_mana(final_turn(save(158)), 64)
act, why, opening = decide(s)
check(act['type'] == 'recruit' and act['wizard'] == IGNUS and opening[IGNUS] == 41,
      f"(b) 13InchesOfFun at 30 mana: Newt duels Ignus Fulgorus with all 41 mana ({act['type']} {act.get('wizard')}, opening {opening.get(IGNUS)})")
r = call('load', text=json.dumps(s)); r = call('ai_step'); a = W.auction(W.st()) or {}
check(r['ok'] and a.get('high') == 41 and a.get('who') == 'Newt', f"(b) the real auction opens at 41 ({a.get('high')} by {a.get('who')})")
r = call('act_pass')
fin = (r.get('view') or {}).get('final') or {}
check(r['ok'] and W.st()['meta'].get('game_over') and fin.get('Newt') == 44 and fin.get('13InchesOfFun') == 39,
      f"(b) 13InchesOfFun cannot top 41: Newt wins Ignus, 35 -> 44, and the game 44 to 39 ({fin})")
s = final_turn(save(158)); P(s, '13InchesOfFun')['towers'] = ['assets/Tower_T1_Ivory_Spire.jpg']
vt = S.value_table(s, 'assets/' + IGNUS, 'wizards')
act, why, _ = decide(s)
check(vt['13InchesOfFun'] == 9 and act['type'] != 'recruit',
      f"(c) Ignus pairs 13InchesOfFun's lone Enchantment tower (+{vt['13InchesOfFun']}) and he can outbid: no duel ({act['type']})")
s = keith_mana(final_turn(save(158)), 64)
s['meta']['log'].append({'r': 39, 'act': 'auction', 'starter': 'Newt', 'cards': [IGNUS], 'won': '13InchesOfFun', 'price': 42, 'bids_tail': [['Newt', 41], ['13InchesOfFun', 42]]})
act, why, _ = decide(s)
check(act['type'] != 'recruit', f"after one lost duel this turn: the best non-duel action ({act['type']})")
# (d) Not the last turn, or not master: the same choices as before last-turn mode existed.
s = final_turn(save(158)); s['meta']['game_end_triggered'] = False
act, why, opening = decide(s)
lim = {base(wz): AI.bid_limit(AI.public_view(s, 'Newt'), 'Newt', wz) for wz in s['wiz_face']}
check(act['type'] == 'build' and act.get('pay') == 'gold' and not act.get('last_turn') and lim == {IGNUS: 33, SERP: 21} and opening == {IGNUS: 0, SERP: 0},
      f"(d) game end not triggered: master unchanged (build with Gold, limits {lim}, no duel)")
for lvl in ('normal', 'hard'):
    s = final_turn(save(158)); s['meta']['ai_levels'] = {'Newt': lvl}
    act, why, opening = decide(s)
    lim = {base(wz): AI.bid_limit(AI.public_view(s, 'Newt'), 'Newt', wz) for wz in s['wiz_face']}
    check(act['type'] == 'research' and act.get('spell') == 'Spell_Spell_Shield_T' and not act.get('last_turn') and lim == {IGNUS: 29, SERP: 20} and opening == {IGNUS: 0, SERP: 0},
          f"(d) {lvl} level on the final turn: unchanged (research and cast Spell Shield, limits {lim}, no duel)")

print(f'\n{PASS} passed, {FAIL} failed, {XFAIL} known live regressions')
sys.exit(1 if FAIL else 0)
