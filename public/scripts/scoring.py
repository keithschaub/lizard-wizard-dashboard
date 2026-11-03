"""Lizard Wizard scoring — single source of truth (Nov 2, 2026).
render4.py imports score() from here. Use card_value()/value_table() for EVERY recruit/build/auction
valuation in chat and AI play; never estimate pairing VP by hand."""
import json, os, itertools, copy
import os as _os
_R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
# Schools come from cards/carddb.json (carddb.py; built from Keith's photo transcriptions). No hand-typed tables (Nov 2, 2026).
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carddb as _CD
SCH={k:c['school'] for k,c in _CD._load()['cards'].items() if c.get('school')}
SCH.update({a:SCH[t] for a,t in _CD._load()['aliases'].items() if t in SCH})
def school(path): return SCH.get(os.path.basename(path)) if path else None
_miss=[f for f in os.listdir(os.path.join(_R,'art')) if f.startswith('Spell_') and f.endswith('.webp') and not SCH.get(f.replace('.webp', '.jpg'))] if os.path.exists(os.path.join(_R,'art')) else []
if _miss: print('WARNING scoring: spells with no school:',_miss)

def _pairing_brute(p):
    """Original brute-force permutation search (kept for verification; slow for 10x9)."""
    W=[school(c) for c in p.get('wizards',[])]; T=[school(c) for c in p.get('towers',[])]
    SP=[school(x['img']) for x in p.get('spells',[]) if x.get('cast')]
    best=0
    a,b=(W,T) if len(W)<=len(T) else (T,W)
    for perm in itertools.permutations(range(len(b)),len(a)):
        pts=0; matched=set()
        for i,j in enumerate(perm):
            if a[i] and a[i]==b[j]: pts+=10; matched.add(a[i])
            else: pts+=5
        pts+=len(b)-len(a)
        pts+=5*sum(1 for sc in SP if sc in matched)
        best=max(best,pts)
    return best

def pairing(p):
    """Best wizard/tower assignment. Matched pair 10, mismatched 5, unpaired card 1, +5 per cast spell matching a matched school.
    Exact closed form (Nov 2, 2026; identical to _pairing_brute, verified in test_ai_policy.py): every assignment pairs
    min(|W|,|T|) cards for 5 each, extra cards score 1, each same-school pair adds +5, and matching min(W_s,T_s) of every
    school maximises both the match count and the set of matched schools. Wild (Arch-Mage) spells count if any pair matches.
    Memoized on the sorted school tuples (lru_cache)."""
    W=[school(c) for c in p.get('wizards',[])]; T=[school(c) for c in p.get('towers',[])]
    SP=[school(x['img']) for x in p.get('spells',[]) if x.get('cast')]
    k=lambda L: tuple(sorted(L,key=lambda x:(x is None,x or '')))
    return _pairing_pts(k(W),k(T),k(SP))

from functools import lru_cache as _lru
@_lru(maxsize=65536)
def _pairing_pts(W,T,SP):
    from collections import Counter
    cw,ct=Counter(s for s in W if s),Counter(s for s in T if s)
    m={s:min(cw[s],ct[s]) for s in cw if ct[s]}
    matched={s for s,k in m.items() if k>0}
    lo,hi=sorted((len(W),len(T)))
    pts=5*lo+(hi-lo)+5*sum(m.values())
    pts+=5*sum(1 for sc in SP if sc in matched or (sc=='Wild' and matched))
    return pts

def best_assignment(a,b):
    """Fast exact replacement for `first max-match permutation in itertools.permutations(range(len(b)),len(a))`
    (len(a)<=len(b); a,b = school lists). Returns the SAME tuple the brute-force loop with strict '>' finds:
    greedily give each a[i] the smallest unused b index that still allows the maximum total number of matches."""
    from collections import Counter
    def maxm(ra,rb):
        ca,cb=Counter(x for x in ra if x),Counter(x for x in rb if x); return sum(min(ca[s],cb[s]) for s in ca)
    target=maxm(a,b); used=set(); perm=[]; got=0
    for i in range(len(a)):
        rest_a=a[i+1:]
        for j in range(len(b)):
            if j in used: continue
            m=1 if a[i] and a[i]==b[j] else 0
            if got+m+maxm(rest_a,[b[k] for k in range(len(b)) if k not in used and k!=j])==target:
                perm.append(j); used.add(j); got+=m; break
    return tuple(perm)

def score(p,st):
    best=pairing(p)
    best+=10*len(p.get('achievements',[]))
    if any(x.get('cast') and 'Spell_Undying' in x['img'] for x in p.get('spells',[])):
        W=[school(c) for c in p.get('wizards',[])]
        best+=3*(W.count('Necromancy')+sum(1 for f in p.get('familiars',[]) if school(f)=='Necromancy'))
    # Order of the Wand (Enchantment, ongoing; real card: "Wizard Cards = +2 VP"): +2 VP per Wizard card owned, if cast
    if any(x.get('cast') and 'Spell_Order_of_the_Wand' in x['img'] for x in p.get('spells',[])):
        best+=2*len(p.get('wizards',[]))
    # Further ongoing VP spells, text read from the real card images (Nov 2, 2026):
    cast={_os.path.basename(x['img']) for x in p.get('spells',[]) if x.get('cast')}
    if 'Spell_Control_Undead.jpg' in cast: best+=3*p.get('undead_kept',0)      # "take any Undead card ... +3 VP for each"
    if 'Spell_Pulsing_Towers.jpg' in cast: best+=len(p.get('towers',[]))          # "Tower Cards = +1 VP"
    if 'Spell_Potent_Servant.jpg' in cast: best+=len(p.get('familiars',[]))       # "Familiar Cards = +1VP"
    if 'Spell_Master_Alchemist.jpg' in cast: best+=p.get('gold',0)//2             # "+1 VP/ 2 Gold"
    if 'Spell_Hoard_Mana.jpg' in cast: best+=p.get('mana',0)//7                   # "+1 VP/ 7 Mana at the end of the game"
    if 'Spell_Arch_Mage.jpg' in cast: best+=3*len({_os.path.basename(w) for w in p.get('wizards',[])})  # "+3 VP/ unique Wizard card"
    # Gold = VP equal to value; Items: most 10, second most 5 (ties share)
    best+=p.get('gold',0)
    cnt=sorted({len(q.get('treasures',[])) for q in st['players'] if len(q.get('treasures',[]))>0},reverse=True)
    mine=len(p.get('treasures',[]))
    if mine and cnt and mine==cnt[0]: best+=10
    elif mine and len(cnt)>1 and mine==cnt[1]: best+=5
    return best

def card_value(st,name,card,kind):
    """VP change for player `name` if they gain `card` (kind 'wizards' or 'towers'). Returns (before, after, delta)."""
    p=[q for q in st['players'] if q['name']==name][0]
    before=score(p,st); q=copy.deepcopy(p); q.setdefault(kind,[]).append(card); after=score(q,st)
    return before,after,after-before

def value_table(st,card,kind):
    """{player: delta VP} for every player — use for auctions and AI bid limits."""
    return {q['name']:card_value(st,q['name'],card,kind)[2] for q in st['players']}

if __name__=='__main__':
    import sys
    st=json.load(open(os.path.join(_R,'game','g4_state.json')))
    for c in st['wiz_face']: print(os.path.basename(c),school(c),value_table(st,c,'wizards'))
    if st.get('tower_face'): print(os.path.basename(st['tower_face']),school(st['tower_face']),value_table(st,st['tower_face'],'towers'))

def explain(p):
    """Return (points, pairs list, unpaired list, spell bonus) for the best assignment, for showing the math.
    Uses best_assignment (identical result to the old permutation loop, fast)."""
    import os as _o
    Wc=p.get('wizards',[]); Tc=p.get('towers',[])
    W=[school(c) for c in Wc]; T=[school(c) for c in Tc]
    SP=[school(x['img']) for x in p.get('spells',[]) if x.get('cast')]
    swap=len(W)>len(T); a,b,ac,bc=(T,W,Tc,Wc) if swap else (W,T,Wc,Tc)
    perm=best_assignment(a,b)
    pts=0; matched=set(); pr=[]
    for i,j in enumerate(perm):
        m=a[i] and a[i]==b[j]; pts+=10 if m else 5
        if m: matched.add(a[i])
        pr.append((_o.path.basename(ac[i]),_o.path.basename(bc[j]),10 if m else 5))
    un=[_o.path.basename(bc[j]) for j in range(len(b)) if j not in perm]
    pts+=len(un); sp=5*sum(1 for sc in SP if sc in matched); pts+=sp
    return (pts,pr,un,sp)

def _explain_brute(p):
    """Original permutation version of explain (kept for verification only)."""
    import os as _o
    Wc=p.get('wizards',[]); Tc=p.get('towers',[])
    W=[school(c) for c in Wc]; T=[school(c) for c in Tc]
    SP=[school(x['img']) for x in p.get('spells',[]) if x.get('cast')]
    swap=len(W)>len(T); a,b,ac,bc=(T,W,Tc,Wc) if swap else (W,T,Wc,Tc)
    best=None
    for perm in itertools.permutations(range(len(b)),len(a)):
        pts=0; matched=set(); pr=[]
        for i,j in enumerate(perm):
            m=a[i] and a[i]==b[j]; pts+=10 if m else 5
            if m: matched.add(a[i])
            pr.append((_o.path.basename(ac[i]),_o.path.basename(bc[j]),10 if m else 5))
        un=[_o.path.basename(bc[j]) for j in range(len(b)) if j not in perm]
        pts+=len(un); sp=5*sum(1 for sc in SP if sc in matched); pts+=sp
        if best is None or pts>best[0]: best=(pts,pr,un,sp)
    return best
