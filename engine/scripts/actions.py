"""Lizard Wizard rule-enforcing actions. ALL state changes for sales, gathers, builds and recruits go through here.
Usage: python3 scripts/actions.py STATE convert PLAYER REAGENT COUNT
       python3 scripts/actions.py STATE convert1 PLAYER R1,R2,...   (mixed types at 1 mana each, no track change)
"""
import json,sys
def P(s,name): return [p for p in s['players'] if p['name']==name][0]
def log(s,e): s['meta'].setdefault('log',[]).append(e)
def convert(s,name,reagent,count):
    """Rulebook: sell ANY quantity of ONE reagent type at its track value, then the track drops by the number sold (floor 1)."""
    p=P(s,name);T=s['tracks']
    if isinstance(reagent,(list,tuple)) and len(set(reagent))>1: raise ValueError('Convert sells ONE reagent type only (use convert1 for mixed at 1 mana each)')
    count=int(count)
    if count<1 or p['tok'].count(reagent)<count: raise ValueError(f'{name} has {p["tok"].count(reagent)} {reagent}, cannot sell {count}')
    val=T[reagent];gain=val*count
    for _ in range(count): p['tok'].remove(reagent)
    p['mana']+=gain;T[reagent]=max(1,val-count)
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'convert','reagent':reagent,'n':count,'value':val,'gain':gain,'track_after':T[reagent]})
    return gain
def convert1(s,name,reagents):
    p=P(s,name)
    for r in reagents:
        if r not in p['tok']: raise ValueError(f'{name} lacks {r}')
        p['tok'].remove(r)
    p['mana']+=len(reagents);log(s,{'r':s['meta'].get('round'),'who':name,'act':'convert1','reagents':reagents,'gain':len(reagents)})
    return len(reagents)
def audit(s):
    """Check every logged convert obeyed the rules. Returns list of problems."""
    bad=[]
    for e in s['meta'].get('log',[]):
        if e.get('act')=='convert' and e['track_after']!=max(1,e['value']-e['n']): bad.append(e)
    return bad
if __name__=='__main__':
    f,cmd,name=sys.argv[1],sys.argv[2],sys.argv[3];s=json.load(open(f))
    if cmd=='convert': out=convert(s,name,sys.argv[4],sys.argv[5])
    elif cmd=='convert1': out=convert1(s,name,sys.argv[4].split(','))
    else: raise SystemExit('unknown cmd')
    json.dump(s,open(f,'w'),indent=1);print(cmd,name,'+',out,'mana | tracks',s['tracks'])

# ---------------- Gather ----------------
class _BaseKey(dict):
    """dict keyed by asset basename; any path form ('assets/X.jpg', '/abs/X.jpg', 'X.jpg') looks up the same card."""
    def _k(self,k): import os; return os.path.basename(str(k))
    def __getitem__(self,k): return dict.__getitem__(self,self._k(k))
    def __contains__(self,k): return dict.__contains__(self,self._k(k))
    def get(self,k,d=None): return dict.get(self,self._k(k),d)
_CARDS_CACHE=None
def _cards():
    """(reagent cards by id, wizards by image) from cards/carddb.json via carddb.py, loaded once per process (Nov 2, 2026)."""
    global _CARDS_CACHE
    if _CARDS_CACHE is None:
        import carddb as CD
        R={c['key'][:-4]:{'id':c['key'][:-4],'gather_icons_in_print_order':c['gather_icons'],'increase_icons_in_print_order':c['increase_icons']} for c in CD.cards('Reagent')}
        W=_BaseKey({c['key']:{'name':c['name'],'school':c['school'],'gather_bonus_reagent':c['gather_bonus'],'image':'assets/'+c['key']} for c in CD.cards('Wizard')})
        _CARDS_CACHE=(R,W)
    return _CARDS_CACHE
def _root():
    import os;return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
import os as _os_a; sys.path.insert(0,_os_a.path.dirname(_os_a.path.abspath(__file__)))
def spell_cost(spell_key):
    """Cast cost token list for a spell key/path from carddb (None if variable X)."""
    import carddb as CD; k=_os_a.path.basename(str(spell_key))
    return CD.cast_cost(k if k.startswith('Spell_') else 'Spell_'+k)
def norm(r): return r.replace(' ','_')
def capacity(p):
    return 10+len(p.get('towers',[]))+10*sum(1 for x in p.get('spells',[]) if x.get('cast') and 'Root_Cellar' in x.get('img',''))
def gather(s,name,card,keep=None,discard=None,bloom=None,spend=None):
    """Rulebook: take the card's gather reagents (if 4-5 icons, choose 3 via keep), +1 per wizard bonus icon,
    raise every 'Increase Value' icon's track by 1 (cap 12), discard the card, draw a new one (top = pop(0)).
    Storage over capacity raises unless discard lists the tokens to return."""
    R,W=_cards();p=P(s,name);T=s['tracks']
    import os
    card=os.path.basename(str(card)).replace('.jpg','')
    cid=card if card.startswith('Reagent_') else 'Reagent_%02d'%int(card)
    h=[x for x in p['hand'] if cid in x]
    if not h: raise ValueError(f'{name} does not hold {cid}')
    c=R[cid];icons=[norm(x) for x in c['gather_icons_in_print_order']]
    from spell_effects import has_cast as _hc
    if len(icons)>3 and _hc(p,'Maximum_Gather'): keep=list(icons)        # Maximum Gather: "Gather all Reagents shown on the top half"
    if len(icons)>3 and not _hc(p,'Maximum_Gather'):
        if not keep: raise ValueError(f'{cid} has {len(icons)} icons; choose 3 with keep')
        keep=[norm(x) for x in keep];pool=list(icons)
        if len(keep)!=3: raise ValueError('keep exactly 3')
        for k in keep:
            if k not in pool: raise ValueError(f'{k} not on {cid} ({icons})')
            pool.remove(k)
        got=keep
    else: got=icons
    if len(icons)>3 and _hc(p,'Maximum_Gather'): got=list(icons)
    bonus=[norm(W[w]['gather_bonus_reagent']) for w in p.get('wizards',[]) if w in W and W[w].get('gather_bonus_reagent')]
    if len(bonus)!=len(p.get('wizards',[])): raise ValueError('unknown wizard bonus for '+name)
    if _hc(p,'Bloom'): bonus=bonus+[norm(bloom or got[0])]          # Bloom: "+1 any Reagent when Gathering"
    # validate storage BEFORE mutating anything (fix Nov 2: a failed call used to leave tokens/tracks changed)
    # Rulebook p.11: 'Reagents used to cast spells are spent before counting the reagent tokens to check if you
    # have more than your storage limit' -> spend = cast cost of the ONE spell cast with this gather (fix Nov 2)
    spend=[norm(x) for x in (spend or [])]
    if spend:
        from collections import Counter as _C0
        if _C0(spend)-_C0(p['tok']+got+bonus): raise ValueError('cast cost not covered by tokens + this gather')
    over=len(p['tok'])+len(got+bonus)-len(spend)-capacity(p)
    if over>0:
        if not discard or len(discard)<over: raise ValueError(f'{name} over storage by {over}; pass discard')
        from collections import Counter as _C
        if _C(norm(d) for d in discard[:over])-(_C(p['tok']+got+bonus)-_C(spend)): raise ValueError('discard not held (after paying the cast)')
    p['tok']+=got+bonus
    inc=[norm(x) for x in c['increase_icons_in_print_order']]
    for n in inc: T[n]=min(12,T[n]+1)
    if over>0:
        for d in discard[:over]: p['tok'].remove(norm(d))
    p['hand'].remove(h[0]);s['reag_discard'].append(h[0])
    if _hc(p,'Mana_Garden'): p['mana']+=5                         # Mana Garden: "+5 Mana whenever you Gather Reagents"
    while len(p['hand'])<(5 if _hc(p,'Crystal_Ball') else 3):     # Crystal Ball: "Max Hand Size = 5"
        if not s['reag_list']: reshuffle_reagents(s)
        if not s['reag_list']: break
        p['hand'].append(s['reag_list'].pop(0))
    s['reag_deck']=len(s['reag_list'])
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'gather','card':cid,'got':got,'bonus':bonus,'inc':inc})
    return got+bonus,inc
def reshuffle_reagents(s):
    """Reagent deck is NOT a game-end trigger (only Wizard/Tower/Spell/Familiar decks are). When it runs out,
    shuffle the discard pile into a new draw deck. Played cards are archived in reag_played so audit_tracks still works."""
    import random
    s.setdefault('reag_played',[]).extend(s['reag_discard'])
    deck=list(s['reag_discard']); s['reag_discard']=[]
    s['reshuffles']=s.get('reshuffles',0)+1
    random.Random(f"{s.get('hands_seed',s.get('seed'))}-reshuffle-{s['reshuffles']}").shuffle(deck)
    s['reag_list']=deck; s['reag_deck']=len(deck)
    log(s,{'r':s['meta'].get('round'),'act':'reshuffle_reagents','n':len(deck)})
def audit_tracks(s):
    """Recompute every reagent track from scratch and report mismatches {reagent: (expected, actual)}.
    Rebuild applies the rules step by step in log order: start 1; reagent cards discarded before the log began are
    applied first; then each logged gather raises its 'Increase Value' icons by 1 (cap 12) and each logged convert
    (Energize: +3, cap 12, first) lowers the track by n (floor 1). Fixed Nov 2 2026: the old version summed raw and
    ignored the 12 cap / 1 floor between events, raising false RULE VIOLATION alerts."""
    R,_=_cards();import os;from collections import Counter as _C
    exp={n:1 for n in s['tracks']}
    def up(n): exp[n]=min(12,exp[n]+1)
    L=s['meta'].get('log',[])
    logged=_C(e['card'] for e in L if e.get('act')=='gather' and e.get('card'))
    for h in s.get('reag_played',[])+s['reag_discard']:            # pre-log discards (no log entry), applied first
        cid=os.path.basename(h)[:-4]
        if logged[cid]>0: logged[cid]-=1; continue
        for n in R[cid]['increase_icons_in_print_order']: up(norm(n))
    for e in L:
        if e.get('act')=='gather':
            for n in (e.get('inc') if e.get('inc') is not None else [norm(x) for x in R[e['card']]['increase_icons_in_print_order']]): up(norm(n))
        elif e.get('act')=='convert':
            r=e['reagent']
            if e.get('energized'): exp[r]=min(12,exp[r]+3)
            exp[r]=max(1,exp[r]-e['n'])
    return {n:(exp[n],s['tracks'][n]) for n in exp if exp[n]!=s['tracks'][n]}

# ---------------- Build tower ----------------
def tower_cost(p,img,pay='reagent'):
    """Rulebook: pay the Reagents on the bottom LEFT of the Tower card or the Gold on the bottom RIGHT (carddb cost.reagent_count /
    cost.gold; fix Nov 2: no longer assumes both equal the tier). Inexpensive / Perfect Reagent take 1 off."""
    import carddb as CD
    c=CD.get(img)['cost']; n=int(c.get('gold',c['tier'])) if pay=='gold' else int(c.get('reagent_count',c['tier']))
    from spell_effects import has_cast as _hc
    if pay=='gold' and _hc(p,'Inexpensive'): n=max(0,n-1)            # Inexpensive: "Build Towers for 1 fewer Gold"
    if pay!='gold' and _hc(p,'Perfect_Reagent'): n=max(0,n-1)        # Perfect Reagent: "Build Towers for 1 fewer Reagent"
    return n
def build_tower(s,name,pay='reagent'):
    """Rulebook: pay the tower's reagent cost OR its gold cost (tower_cost). Builds the face-up tower and reveals the next (pop(0))."""
    import os;p=P(s,name);img=s['tower_face']
    if not img: raise ValueError('no tower on offer (tower supply depleted)')
    import carddb as CD
    _t,r,_sc=CD.tower_info(img);r=norm(r)
    tier=tower_cost(p,img,pay)
    if pay=='gold':
        if p.get('gold',0)<tier: raise ValueError(f'{name} needs {tier} Gold')
        p['gold']-=tier
    else:
        if p['tok'].count(r)<tier: raise ValueError(f'{name} needs {tier} {r}, has {p["tok"].count(r)}')
        for _ in range(tier): p['tok'].remove(r)
    p.setdefault('towers',[]).append(img);s['tower_face']=s['tow_list'].pop(0) if s['tow_list'] else None;s['tower_deck']=len(s['tow_list'])
    import spell_effects as _SE; _SE.mana_triggers(s,'Mana_Fountain',name)   # Mana Fountain: "+5 Mana when any player builds a Tower"
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'build','tower':os.path.basename(img),'paid':pay if pay=='gold' else [r]*tier,'tier_paid':tier})


# ---- Dungeon deck (added Nov 2, 2026) ----
# Built from Keith's photographed cards: assets/dungeon_from_photos.json (53 cards; the 2 Trap! cards are set aside at setup).
def ensure_dungeon(s):
    # fix Nov 2: an EMPTY dungeon list is a real (exhausted) deck; only a missing key means 'never built'
    # (the old truthiness test rebuilt a fresh 51-card deck, treasures already taken included)
    if s.get('dungeon_list') is not None: return s['dungeon_list']
    import random, json as _j, os as _o
    d=_j.load(open(_o.path.join(_o.path.dirname(__file__),'..','assets','dungeon_from_photos.json')))['cards']
    deck=[{k:v for k,v in c.items() if k!='photo'} for c in d if c['type']!='Trap']
    random.Random(str(s.get('board_seed'))+'dungeon').shuffle(deck)
    s['dungeon_list']=deck; s['dungeon_deck']=len(deck)
    return deck

def scry_dungeon(s,name,n=10):
    """Scry Dungeon (Sorcery, card text): look at the top 10 Dungeon cards and keep all Treasure cards (non-monsters).
    Rulebook: Monster cards drawn are SHUFFLED back into the Dungeon deck (never placed back on top)."""
    p=P(s,name); deck=ensure_dungeon(s)
    top=deck[:n]; rest=deck[n:]
    kept=[c for c in top if c['type']=='Treasure']
    back=[c for c in top if c['type']!='Treasure']
    for c in kept:
        if c.get('subtype')=='Gold': p['gold']=p.get('gold',0)+c['gold']
        else: p.setdefault('treasures',[]).append(c)
    import random as _r
    newdeck=back+rest; _r.Random(f"{s.get('board_seed')}-dshuf-{len(s['meta'].get('log',[]))}").shuffle(newdeck)
    s['dungeon_list']=newdeck; s['dungeon_deck']=len(newdeck)
    log(s,{'r':s['meta']['round'],'who':name,'act':'scry_dungeon','seen':top,'kept':kept,'reshuffled':len(back)})
    return top,kept

def research(s,name,spell_key,cast_cost=None):
    """Research a face-up spell for 5 mana; if cast_cost given, pay those reagents and mark cast."""
    import os as _o
    p=P(s,name); sp=[x for x in s['spell_face'] if x and spell_key in x][0]; i=s['spell_face'].index(sp)
    if cast_cost in (True,'auto'): cast_cost=spell_cost(sp)     # cost straight from carddb (photo transcription)
    if cast_cost: cast_cost=[norm(c) for c in cast_cost]
    import carddb as _CD; mcost=int(((_CD.get(sp) or {}).get('cost') or {}).get('mana',5))   # rulebook: 'the Mana cost shown in the upper left corner'
    assert p['mana']>=mcost, 'not enough mana'
    if cast_cost:
        from collections import Counter as _C
        need=_C(cast_cost); have=_C(p['tok'])
        assert all(have[r]>=c for r,c in need.items()), f'missing reagents {need-have}'
    p['mana']-=mcost
    for r in (cast_cost or []): p['tok'].remove(r)
    p.setdefault('spells',[]).append({'img':sp,'cast':bool(cast_cost)})
    s['spell_face'][i]=s['spell_list'].pop(0) if s['spell_list'] else None; s['spell_deck']=len(s['spell_list'])
    log(s,{'r':s['meta']['round'],'who':name,'act':'research','spell':_o.path.basename(sp),'paid':mcost,'cast':bool(cast_cost),'cast_paid':cast_cost or []})
    return _o.path.basename(s['spell_face'][i] or '')
def recruit(s,name,wiz_img,price,starter=None,bids=None):
    """Resolve a won Wizard auction: pay mana, take the face-up wizard, refill the offer from wiz_list."""
    p=P(s,name); assert price<=p['mana'],'bid exceeds mana'
    slot=[w for w in s['wiz_face'] if w.endswith(wiz_img.split('/')[-1])]; assert slot,'wizard not on offer'
    w=slot[0]; i=s['wiz_face'].index(w)
    # Wizard conservation check before mutation
    _wiz_before = sum(len([x for x in q.get('wizards', [])]) for q in s['players']) + len([x for x in s['wiz_face'] if x]) + len(s.get('wiz_list', []))
    p['mana']-=price; p['wizards'].append(w)
    if s['wiz_list']: s['wiz_face'][i]=s['wiz_list'].pop(0)
    else: s['wiz_face'].pop(i)
    s['wiz_deck']=len(s['wiz_list'])
    # Wizard conservation check after mutation
    _wiz_after = sum(len([x for x in q.get('wizards', [])]) for q in s['players']) + len([x for x in s['wiz_face'] if x]) + len(s.get('wiz_list', []))
    assert _wiz_before == _wiz_after, f'WIZARD CONSERVATION VIOLATED: {_wiz_before} wizards before auction, {_wiz_after} after (won by {name}: {w})'
    import spell_effects as _SE; _SE.mana_triggers(s,'Mana_Leak',name)    # Mana Leak: "+5 Mana when any player recruits a Wizard"
    log(s,{'r':s['meta'].get('round'),'act':'auction','won':name,'item':w.split('/')[-1][7:-4],'price':price,'starter':starter,'bids_tail':bids})
    return w
def cast_spell(s,name,spell_key,cost):
    """Cast an already-researched (uncast) spell, paying its reagents (read cost from the real card image)."""
    from collections import Counter as _C
    import os as _o
    p=P(s,name); sp=[x for x in p.get('spells',[]) if spell_key in x['img'] and not x.get('cast')]
    assert sp, f'{name} has no uncast {spell_key}'
    cost=[norm(c) for c in cost]; need=_C(cost); have=_C(p['tok'])
    assert all(have[r]>=c for r,c in need.items()), f'missing reagents {need-have}'
    for r in cost: p['tok'].remove(r)
    sp[0]['cast']=True
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'cast','spell':_o.path.basename(sp[0]['img']),'cast_paid':cost})
# Negative (targeted) spells, from the real card texts. Wand Tax removed Nov 2, 2026: its card reads
# "Gain 2 Gold/ Card of any School of Magic of your choice" (no target). Earthquake, Invisibility Potion and Obscure added.
NEGATIVE_SPELLS=('Spell_Charm','Spell_Flame_Bolt','Spell_Disintegrate','Spell_Mana_Drain','Spell_Swapo','Spell_Demonic_Possession',
                 'Spell_Earthquake','Spell_Invisibility_Potion','Spell_Obscure')
def shield_blocks(s,target):
    """Spell Shield (real card): 'Protected from one negative Spell effect, then placed out of play.'
    Call BEFORE resolving any negative spell aimed at `target`. Returns True if blocked (shield removed to out_of_play)."""
    p=P(s,target)
    for x in p.get('spells',[]):
        if 'Spell_Spell_Shield' in x['img'] and x.get('cast'):
            p['spells'].remove(x); s.setdefault('out_of_play',[]).append(x['img'])
            log(s,{'r':s['meta'].get('round'),'who':target,'act':'shield_used','spell':x['img'].split('/')[-1]})
            return True
    return False
def flame_bolt(s,caster,target,card,kind):
    """Flame Bolt (real card): 'Destroy any card owned by another player and place it out of play.' Shield checked first."""
    assert caster!=target
    if shield_blocks(s,target):
        log(s,{'r':s['meta'].get('round'),'who':caster,'act':'flame_bolt_blocked','target':target}); return False
    p=P(s,target); p[kind].remove(card); s.setdefault('out_of_play',[]).append(card)
    log(s,{'r':s['meta'].get('round'),'who':caster,'act':'flame_bolt','target':target,'card':card.split('/')[-1],'kind':kind})
    return True
def charm(s,caster,target,wiz):
    """Charm (real card, Enchantment 1x): 'Take a Wizard Card from another player.' Shield checked first."""
    if shield_blocks(s,target):
        log(s,{'r':s['meta'].get('round'),'who':caster,'act':'charm_blocked','target':target}); return False
    P(s,target)['wizards'].remove(wiz); P(s,caster)['wizards'].append(wiz)
    log(s,{'r':s['meta'].get('round'),'who':caster,'act':'charm','target':target,'wizard':wiz.split('/')[-1]}); return True

# ---------------- Added Nov 2, 2026 for the win-seeking AI (ai_policy.py) ----------------
def disintegrate(s,caster,target,card,kind):
    """Disintegrate N/S (real card, 1x): 'Disintegrate any card owned by another player and place it out of play.' Shield checked first."""
    assert caster!=target
    if shield_blocks(s,target):
        log(s,{'r':s['meta'].get('round'),'who':caster,'act':'disintegrate_blocked','target':target}); return False
    P(s,target)[kind].remove(card); s.setdefault('out_of_play',[]).append(card)
    log(s,{'r':s['meta'].get('round'),'who':caster,'act':'disintegrate','target':target,'card':card.split('/')[-1],'kind':kind}); return True
def earthquake(s,caster,target,tower):
    """Earthquake (real card, Druidry 1x): "Destroy (out of play) another player's Tower". Shield checked first."""
    assert caster!=target
    if shield_blocks(s,target):
        log(s,{'r':s['meta'].get('round'),'who':caster,'act':'earthquake_blocked','target':target}); return False
    P(s,target)['towers'].remove(tower); s.setdefault('out_of_play',[]).append(tower)
    log(s,{'r':s['meta'].get('round'),'who':caster,'act':'earthquake','target':target,'card':tower.split('/')[-1],'kind':'towers'}); return True
def mana_drain(s,caster,target):
    """Mana Drain (real card, Conjuring 1x): 'Steal 15 Mana from another player' (all they have if under 15). Shield checked first."""
    assert caster!=target
    if shield_blocks(s,target):
        log(s,{'r':s['meta'].get('round'),'who':caster,'act':'mana_drain_blocked','target':target}); return 0
    t=P(s,target); n=min(15,t['mana']); t['mana']-=n; P(s,caster)['mana']+=n
    log(s,{'r':s['meta'].get('round'),'who':caster,'act':'mana_drain','target':target,'n':n}); return n
def creation(s,name,card,kind):
    """Creation (real card, Conjuring 1x): 'Take any available Card for free' (a face-up wizard or the face-up tower)."""
    p=P(s,name)
    if kind=='wizards':
        w=[x for x in s['wiz_face'] if x and x.endswith(card.split('/')[-1])][0]; i=s['wiz_face'].index(w)
        p['wizards'].append(w)
        if s['wiz_list']: s['wiz_face'][i]=s['wiz_list'].pop(0)
        else: s['wiz_face'].pop(i)
        s['wiz_deck']=len(s['wiz_list'])
    else:
        assert s['tower_face'] and s['tower_face'].endswith(card.split('/')[-1])
        p.setdefault('towers',[]).append(s['tower_face']); s['tower_face']=s['tow_list'].pop(0) if s['tow_list'] else None; s['tower_deck']=len(s['tow_list'])
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'creation','card':card.split('/')[-1],'kind':kind})
_FAM_CACHE=None
def _fam_cards():
    """Familiars by image basename (carddb), same fields as cards.json: name, school, cost_mana, collect, reagent, text."""
    global _FAM_CACHE
    if _FAM_CACHE is None:
        import carddb as CD
        _FAM_CACHE={c['key']:{'name':c['name'],'school':c['school'],'cost_mana':c['cost']['mana'],'collect':c['collect'],
                              'reagent':c['reagent'],'text':c['effect'],'image':'assets/'+c['key']} for c in CD.cards('Familiar')}
    return _FAM_CACHE
def summon_familiar(s,name,fam_img,use,cast=None,discard=None,cont=None,choose=None,after_collect=None):
    """Rulebook 6) Summon Familiar: pay its Mana cost, take it, refill the offer, use it immediately.
    use='score'  : 1 Gold per card you own of the familiar's school (Wizard, Tower, ALL Spells cast or not, Familiars incl. this one).
    use='gather' : collect the card's N reagents, then cast ANY owned uncast spells (cast=[(spell_key,cost_list),...]);
                   rulebook: reagents spent on casting are removed BEFORE the storage check (discard= tokens to return if still over).
    use='dungeon': Enter the Dungeon (spell_effects.dungeon_delve; cont(hits,drawn)->True to draw again).
    use='research': New Research (spell_effects.new_research; choose(state)->spell key among the fresh four).
    Summon Helper: 5 fewer mana. Energy Circle owners: +5 mana."""
    import spell_effects as _SE
    import os
    from scoring import school
    p=P(s,name); F=_fam_cards(); b=os.path.basename(fam_img); f=F[b]
    slot=[x for x in s['fam_face'] if x and os.path.basename(x)==b]; assert slot,'familiar not on offer'
    fcost=_SE.familiar_cost(p,fam_img); assert p['mana']>=fcost,f"{name} needs {fcost} mana"
    i=s['fam_face'].index(slot[0]); p['mana']-=fcost; p.setdefault('familiars',[]).append(slot[0])
    if s['fam_list']: s['fam_face'][i]=s['fam_list'].pop(0)
    else: s['fam_face'].pop(i)
    s['fam_deck']=len(s['fam_list']); out={}
    _SE.mana_triggers(s,'Energy_Circle',name)
    if use in ('dungeon','research'):
        log(s,{'r':s['meta'].get('round'),'who':name,'act':'summon','familiar':b,'cost':fcost,'use':use})
        return _SE.dungeon_delve(s,name,cont) if use=='dungeon' else {'took':_SE.new_research(s,name,choose)}
    if use=='score':
        sc=f['school']; n=sum(1 for c in p.get('wizards',[])+p.get('towers',[])+p.get('familiars',[]) if school(c)==sc)
        n+=sum(1 for x in p.get('spells',[]) if school(x['img'])==sc)
        p['gold']=p.get('gold',0)+n; out={'gold':n}
    elif use=='gather':
        r=norm(f['reagent']); p['tok']+= [r]*int(f['collect']); casted=[]
        if after_collect: after_collect()          # e.g. claim an x7 achievement met now, before casting spends the tokens
        for key,cost in (cast or []):
            cast_spell(s,name,key,cost); casted.append(key)
        over=len(p['tok'])-capacity(p)
        if over>0:
            assert discard and len(discard)>=over, f'{name} over storage by {over}; pass discard'
            for d in discard[:over]: p['tok'].remove(norm(d))
        out={'got':[r]*int(f['collect']),'cast':casted}
    else: raise ValueError('use must be score or gather')
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'summon','familiar':b,'cost':fcost,'use':use,**out})
    return out
def achievement_met(p,text):
    """Achievement tiles (cards.json, 20 tiles). Ruling: uncast spells do not count."""
    from scoring import school
    t=text.split()
    if text.startswith('x7 '): return p['tok'].count(norm(text[3:]))>=7
    n=int(t[0]); what=' '.join(t[1:])
    cast=[x for x in p.get('spells',[]) if x.get('cast')]
    if what=='Wizards': return len(p.get('wizards',[]))>=n
    if what=='Towers': return len(p.get('towers',[]))>=n
    if what=='Spells': return len(cast)>=n
    if what=='Familiars': return len(p.get('familiars',[]))>=n
    if what=='Gold': return p.get('gold',0)>=n
    if what=='Mana': return p.get('mana',0)>=n
    if what.endswith(' cards'):
        sc=what[:-6]
        k=sum(1 for c in p.get('wizards',[])+p.get('towers',[])+p.get('familiars',[]) if school(c)==sc)+sum(1 for x in cast if school(x['img'])==sc)
        return k>=n
    raise ValueError('unknown achievement '+text)
def claim_achievement(s,name,text):
    """Rulebook: on your turn, if you meet an Achievement tile's condition you may claim it (10 VP). Not an action."""
    p=P(s,name); assert text in s.get('ach',[]), 'tile not available'
    assert achievement_met(p,text), f'{name} does not meet {text}'
    s['ach'].remove(text); p.setdefault('achievements',[]).append(text)
    log(s,{'r':s['meta'].get('round'),'who':name,'act':'achievement','tile':text})
def supplies(s):
    """Game-end supplies (deck + face-up). Reagent deck excluded (it reshuffles)."""
    return {'wizard':len(s.get('wiz_list',[]))+len([x for x in s.get('wiz_face',[]) if x]),
            'tower':len(s.get('tow_list',[]))+(1 if s.get('tower_face') else 0),
            'spell':len(s.get('spell_list',[]))+len([x for x in s.get('spell_face',[]) if x]),
            'familiar':len(s.get('fam_list',[]))+len([x for x in s.get('fam_face',[]) if x])}
def check_end(s):
    """Set meta.game_end_triggered when any supply is exhausted (finish the round, then the game ends)."""
    if not s['meta'].get('game_end_triggered') and min(supplies(s).values())==0:
        s['meta']['game_end_triggered']=True; log(s,{'r':s['meta'].get('round'),'act':'game_end_triggered','supplies':supplies(s)})
    return s['meta'].get('game_end_triggered',False)
