"""Lizard Wizard setup in two ENFORCED phases (rulebook SETUP A-L), any 3-5 players (1-2 also handled).
Phase 1  hands : python3 scripts/deal4.py hands [--seed N] [--players Keith,Newt,LizWiz,Gecko] [--humans Keith]
   A reagent cards dealt (3 each), B tracks at 1, D 20 mana (+0 gold), C AI players pick 2 unique tokens
   from their OWN hand only. No wizard/tower/familiar/spell/dungeon/achievement data exists yet.
Phase 2  board : python3 scripts/deal4.py board --pick Keith=A,B [--seed N]
   Refuses unless every player holds exactly 2 unique tokens; then E-J per player count, phase 'play', round 1.
Utility  repick: python3 scripts/deal4.py repick   (strip board + AI picks from an existing state, keep hands/deck)
Deck convention: *_list = remaining face-down cards only, top=index 0, draw with pop(0); *_deck == len(*_list).
Prints PUBLIC info only (never deck order, never AI hands)."""
import json, random, os, sys, secrets, argparse
R='/workspace/lizard-wizard/'; A=R+'assets/'
STATE=os.environ.get('LW_STATE',R+'game/g4_state.json')
REAGENTS=['Mandrake','Eye_of_Newt','Nightshade','Sulphur','Foxglove','Toadstool','Horn']
BOARD_KEYS=['tower_face','tower_deck','wiz_face','wiz_deck','fam_face','fam_deck','spell_face','spell_deck',
            'dungeon_deck','ach','tow_list','wiz_list','fam_list','spell_list','out_of_play']
RC={c['id']:c for c in json.load(open(R+'cards/reagent_cards.json'))['cards']}
norm=lambda r:r.replace(' ','_')

def ai_pick(hand,rnd):
    """Use ONLY the AI's own hand: prefer reagents the hand gathers least (diversify), then ones the hand's
    Increase Value raises most (better convert price), random tiebreak."""
    g={r:0 for r in REAGENTS}; inc={r:0 for r in REAGENTS}
    for h in hand:
        c=RC[os.path.basename(h)[:-4]]
        for k,v in c['gather_counts'].items(): g[norm(k)]+=v
        for k,v in c['increase_counts'].items(): inc[norm(k)]+=v
    return sorted(sorted(REAGENTS,key=lambda r:(g[r],-inc[r],rnd.random()))[:2])

def do_ai_picks(st,rnd):
    """AI seats pick through ai_policy.starting_pick on their OWN public_view (no seeds, no other hands). Picks are
    simultaneous: everyone's tokens are cleared first and all AI picks are computed before any is placed, so no AI
    sees another's pick. Falls back to the local ai_pick (same rule, own hand only) if ai_policy can't be imported."""
    for p in st['players']: p['tok']=[]
    try:
        sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import ai_policy as _AI
    except Exception as e: _AI=None; print('WARN ai_policy unavailable for picks:',e)
    picks={}
    for p in st['players']:
        if p['name'] in st['meta']['humans']: continue
        picks[p['name']]=_AI.starting_pick(_AI.public_view(st,p['name']),p['name'])[0] if _AI else ai_pick(p['hand'],rnd)
    for p in st['players']:
        if p['name'] in picks: p['tok']=list(picks[p['name']])
    st['meta']['pending']=[f"{n} selects 2 unique starting Reagent Tokens (setup C)" for n in st['meta']['humans']]
    st['meta']['phase']='picks'

def hands(a):
    if os.path.exists(STATE) and not a.force:
        try: _ph=json.load(open(STATE))['meta'].get('phase')
        except Exception: _ph=None
        if _ph=='play': sys.exit(f'REFUSED: {STATE} is a game in play; set LW_STATE to a new file (or --force)')
    seed=a.seed if a.seed is not None else secrets.randbelow(10**6); rnd=random.Random(seed)
    names=a.players.split(','); humans=a.humans.split(',')
    assert 1<=len(names)<=5
    reag=[A+f'Reagent_{i:02d}.jpg' for i in range(1,57)]; rnd.shuffle(reag)
    pl=[{'name':n,'hand':[reag.pop(0) for _ in range(3)],'tok':[],'mana':20,'gold':0,'wizards':[],'towers':[],
         'spells':[],'familiars':[],'achievements':[]} for n in names]
    st=dict(seed=seed,hands_seed=seed,board_seed=None,players=pl,start=names[0],reag_list=reag,reag_deck=len(reag),
            reag_discard=[],tracks={n:1 for n in REAGENTS},turn=0,next=names[0],
            meta={'coaching_log':a.coach,'show_coaching':False,'round':0,'game_over':False,
                  'num_players':len(names),'seat_order':names,'humans':humans,'mode':'free-for-all',
                  'deck_convention':'*_list = remaining face-down cards only, top=index 0, draw via pop(0); *_deck == len(*_list); no pointers'})
    st['meta']['ai_seed']=a.ai_seed if a.ai_seed is not None else secrets.randbelow(10**6)   # AI tiebreak seed (AI-visible by design; NOT the hands seed)
    do_ai_picks(st,rnd); save(st)

def repick(a):
    st=json.load(open(STATE))
    for k in BOARD_KEYS+['wiz_ptr','spell_ptr']: st.pop(k,None)
    st['meta'].setdefault('humans',['Keith']); st['meta'].setdefault('num_players',len(st['players']))
    st['hands_seed']=st.get('hands_seed',st['seed']); st['board_seed']=None; st['meta']['round']=0
    for p in st['players']: p['achievements']=[]
    rnd=random.Random(st['hands_seed']*7919+1)
    do_ai_picks(st,rnd); save(st)

def board(a):
    st=json.load(open(STATE))
    if st['meta'].get('phase')!='picks': sys.exit('REFUSED: state is not in phase "picks"')
    for spec in a.pick or []:
        n,toks=spec.split('='); toks=[norm(t.strip()) for t in toks.split(',')]
        p=next(p for p in st['players'] if p['name']==n)
        if any(t not in REAGENTS for t in toks): sys.exit(f'REFUSED: unknown reagent in {toks}; valid: {REAGENTS}')
        p['tok']=toks
    bad=[p['name'] for p in st['players'] if len(p['tok'])!=2 or len(set(p['tok']))!=2]
    if bad: sys.exit(f'REFUSED: these players do not hold exactly 2 unique tokens: {bad}')
    seed=a.seed if a.seed is not None else secrets.randbelow(10**6); rnd=random.Random(seed)
    n=len(st['players']); d=json.load(open(R+'cards/cards.json'))
    # E wizards: 1-2p keep 2/school, 3p keep 3/school, 4-5p all 4
    per={1:2,2:2,3:3}.get(n,4)
    wiz=[w['image'] for w in d['wizards']['unique_cards'] for _ in range(per)]; rnd.shuffle(wiz)
    # F towers by reagent cost, random within cost
    tcost={1:(2,3),2:(2,3),3:(1,2,3)}.get(n,(1,2,3,4))
    tow=[]
    for c in tcost:
        g=[t['image'] for t in d['towers']['cards'] if t['reagent_cost']==c]; rnd.shuffle(g); tow+=g
    # G familiars by mana cost, random within cost
    fcost={1:(10,15,20),2:(10,15,20),3:(5,10,15,20)}.get(n,(5,10,15,20,25))
    fam=[]
    for c in fcost:
        g=[f['image'] for f in d['familiars']['cards'] if f['cost_mana']==c]; rnd.shuffle(g); fam+=g
    # H spells (65 physical)
    pc=json.load(open(R+'cards/spells_from_pc.json'))['cards']; spells=[]
    for c in pc: spells+=[A+'Spell_'+c['id']+'.jpg']*int(c.get('copies') or 1)
    assert len(spells)==65 and all(os.path.exists(x) for x in spells); rnd.shuffle(spells)
    # J achievements
    ach=[t['text'] for t in d['achievements']['tiles']]; rnd.shuffle(ach); ach=ach[:4]
    st.update(tower_face=tow.pop(0),wiz_face=[wiz.pop(0),wiz.pop(0)],fam_face=[fam.pop(0),fam.pop(0)],
              spell_face=[spells.pop(0) for _ in range(4)],tow_list=tow,wiz_list=wiz,fam_list=fam,spell_list=spells,
              dungeon_deck=51,ach=ach,out_of_play=[],board_seed=seed)   # I: 53 dungeon cards minus 2 Trap! set aside
    st['tower_deck']=len(tow); st['wiz_deck']=len(wiz); st['fam_deck']=len(fam); st['spell_deck']=len(spells)
    st['seed']=seed; st['meta'].update(phase='play',round=1,pending=[]); save(st)

def save(st):
    for l,c in [('tow_list','tower_deck'),('wiz_list','wiz_deck'),('fam_list','fam_deck'),('spell_list','spell_deck'),('reag_list','reag_deck')]:
        if l in st: assert len(st[l])==st[c],(l,c)
    if st['meta'].get('phase')=='picks': assert not any(k in st for k in BOARD_KEYS if k!='out_of_play'), 'board data present in picks phase'
    json.dump(st,open(STATE,'w'),indent=1)
    b=os.path.basename
    print('phase',st['meta']['phase'],'hands_seed',st.get('hands_seed'),'board_seed',st.get('board_seed'),'reagent deck',st['reag_deck'])
    for p in st['players']: print(f"  {p['name']}: tokens {p['tok'] or 'PENDING'}, hand {len(p['hand'])} cards")
    if st['meta']['phase']=='play':
        print('  tower',b(st['tower_face']),st['tower_deck'],'| wizards',[b(x) for x in st['wiz_face']],st['wiz_deck'],
              '| familiars',[b(x) for x in st['fam_face']],st['fam_deck'],'| spells',[b(x) for x in st['spell_face']],st['spell_deck'],'| ach',st['ach'])

ap=argparse.ArgumentParser(); ap.add_argument('phase',choices=['hands','board','repick'])
ap.add_argument('--seed',type=int); ap.add_argument('--pick',action='append')
ap.add_argument('--players',default='Keith,Newt,LizWiz,Gecko'); ap.add_argument('--humans',default='Keith')
ap.add_argument('--coach',default='game/coaching_log_g4.md'); ap.add_argument('--ai-seed',type=int); ap.add_argument('--force',action='store_true')
a=ap.parse_args(); {'hands':hands,'board':board,'repick':repick}[a.phase](a)
