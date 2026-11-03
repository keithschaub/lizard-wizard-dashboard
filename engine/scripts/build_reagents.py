import json,glob,collections,os
from PIL import Image,ImageDraw
R='/workspace/lizard-wizard/pc/cards_zip/LizardWizard_Cards/Reagent_Cards'
A={'Ma':'Mandrake','Su':'Sulphur','To':'Toadstool','Ho':'Horn','Ni':'Nightshade','Fo':'Foxglove','Ey':'Eye of Newt'}
T="""Ho,Ni,Fo|Fo,Su,Ho
Ni,Ni,Ma,Fo|To,Ma,Ey,Su
Ni,Su,Ey,Ho|Fo,Fo,Ho,Ni
Ey,Ey,To,Ma|Ey,To,Su
To,Ma,Ni|Ey,Fo,Ho
Ni,Fo,Ey|Su,Ey,Ho
Ni,Ey,Fo|Su,To,Ey
Fo,Ma,To,Ni|Ho,Ho,To,Ma
Ey,Ho,Su,Fo|Ni,Ni,Ho
Su,Ni,Fo|Ho,Ni,To
Fo,Su,To|Ho,Ey,Ma
Fo,Fo,Fo,To,Ni|Su,Ey,Ho,Ni
Ey,Ho,Ey,Ey,Ni|Ma,Ni,Ho,Fo
Ma,To,Ey,Ni|Ho,Ni,Ho,Ey
Ey,Ma,Su|Su,Fo,To
Ey,Su,Ey,Ni|Ho,Ho,Su
Ma,Su,To|Ma,Ni,Ey
To,Fo,Ey|Su,Ma,Ni
Fo,Ey,Su,Ni|Ey,Ho,Ey,Ni
Su,Ey,Ma|Fo,Fo,Ho
Ho,Su,To|Ma,Ma,Ni
To,To,Ma,Ni|Ey,Fo,Ma
Ho,Ho,Ho,Ma,Su|Ey,Fo,Ho,Ma
To,Ho,Ni|To,To,Fo
Ni,Fo,Ma,Ho|To,Ey,Ho,Ni
Fo,Ho,Ni|Ma,Ma,Su
Ma,Ma,Su,Ho|Ni,Su,Ma,To
Su,Su,Su,Fo,Ey|Ho,Ma,Su,Ni
Ho,Ho,Ey,Ni|To,Fo,Su,Ey
Su,Ho,Su,Ey|Ey,Ey,Ni
To,Fo,To,Ho|Ho,Ni,To,Ma
Fo,To,Ho,Ma|Ho,To,Ho,Ma
Fo,Fo,Ma,Ho|Ni,Ni,Fo
Ma,Fo,Ey|Su,Su,Ma
Ma,Ma,Ma,Ni,Fo|To,Fo,Su,Ey
Ni,Ma,Su|Fo,Ma,To
Ma,Ho,Ni|To,Ho,Su
Ni,To,Ho|Su,Su,Fo
Su,Fo,Ma,Ho|Su,Su,Fo
To,Su,Ey,Ni|Ho,Su,Fo
Ni,Ni,To,Ni,Su|Ni,Fo,Ma,Su
To,To,Ma,To,Ey|Ma,Ey,Ma,Ho
Su,Ni,To,Ma|To,Ey,To,Fo
Ni,To,Ho,Ey|To,Su,Ma,Ni
Ma,Ma,To,Fo|Ey,Ey,To
Ma,Su,Ey,Ho|Fo,Fo,Ey
Su,To,Ho|Ni,Ma,Su
Ho,Su,Ho,Fo|Ni,Ni,Ey
Ho,Ey,Ma|Fo,Ey,To
Ni,Ey,Ni,To|To,To,Su
Fo,Ey,Ma|Fo,To,Ni
To,Fo,Ho,Su|Ni,Ho,Ni,Ey
Ey,To,Ho|Ni,Ey,Fo
Su,Ni,Su,To|Ma,Su,To,Ho
Ma,Fo,Ey,To|Fo,To,Ni
Fo,Fo,Ey,Su|Ma,To,Fo,Ey""".split('\n')
MARKET={27,36}
order=list(A.values())
def cnt(l): c=collections.Counter(A[x] for x in l); return {k:c[k] for k in order if c[k]}
fs=sorted(glob.glob(R+'/Cards/*.jpg')); assert len(fs)==56==len(T)
cards=[];sig=collections.defaultdict(list)
for i,(f,t) in enumerate(zip(fs,T)):
    g,v=t.split('|');g=g.split(',');v=v.split(',')
    key=(tuple(sorted(g)),tuple(sorted(v)))
    sig[key].append(i)
    b=os.path.basename(f);scan=b.split('_Card')[0]
    cards.append({'id':'Reagent_%02d'%(i+1),'deck':'Reagent Gathering','source_file':'Reagent_Cards/Cards/'+b,'raw_scan':'Reagent_Cards/Raw_Scans/%s.jpg'%scan,
      'gather_reagents_header':'GATHER REAGENTS',
      'gather_icons_in_print_order':[A[x] for x in g],'gather_counts':cnt(g),'gather_icon_total':len(g),
      'increase_value_header':'INCREASE MARKET VALUE' if i in MARKET else 'INCREASE VALUE',
      'increase_icons_in_print_order':[A[x] for x in v],'increase_counts':cnt(v),'increase_icon_total':len(v),
      'cast_spell_symbol':None,'other_symbols_or_text':'none' if i not in MARKET else "Lower header reads 'INCREASE MARKET VALUE' instead of 'INCREASE VALUE' (wording variant; same function).",
      'transcription_status':'full'})
dups=[[cards[j]['id'] for j in v] for v in sig.values() if len(v)>1]
for v in sig.values():
    for j in v: cards[j]['identical_copies_in_deck']=len(v)
dist=collections.Counter((c['gather_icon_total'],c['increase_icon_total']) for c in cards)
out={'source':'Keith PC: LizardWizard_Cards/Reagent_Cards (Cards = 56 crops from 10 Raw_Scans dated 2025-01-12); icons mapped with Icon_Templates',
 'count':56,'distinct_card_faces':len(sig),
 'rules_summary_from_rulebook':"Play 1 card from hand (hand max 3). Take THREE tokens of your choice from those shown in 'Gather Reagents' (cards showing 4-5 icons force a choice; each icon = one token available of that type). Then for EACH icon in 'Increase Value', raise that reagent's Mana value by 1 on the track (two of the same icon = +2). Discard face up, draw back to hand max. Wizard Card reagent symbols add extra gathered tokens. You may then cast ONE spell if you have the reagents (this is part of every Gather action, not printed on the cards).",
 'cast_spell_symbol_note':'No spell-cast symbol, numbers, or other text appears on any of the 56 cards; all were checked edge to edge. The only things printed on them are the two headers and the reagent icons.',
 'icon_legend':{'Mandrake':'orange carrot-like root','Sulphur':'yellow pile (template file named Sulfur)','Toadstool':'red white-spotted mushroom','Horn':'white/cream curved horn','Nightshade':'dark-blue berries with green leaves','Foxglove':'pink bell flowers on a stem','Eye of Newt':'gold oval slit eye'},
 'layout_distribution_gather_x_increase':{f'{a}x{b}':n for (a,b),n in sorted(dist.items())},
 'duplicate_groups':dups,
 'cards':cards}
json.dump(out,open('/workspace/lizard-wizard/cards/reagent_cards.json','w'),indent=1)
print(len(sig),dups,dict(dist))
tot_g=collections.Counter();tot_v=collections.Counter()
for c in cards: tot_g.update(c['gather_counts']);tot_v.update(c['increase_counts'])
print('gather',dict(tot_g));print('inc',dict(tot_v))
# contact sheet
W,H=300,413;cols=8;rows=7
G=Image.new('RGB',(cols*W,rows*(H+20)),'white');d=ImageDraw.Draw(G)
for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB').resize((W-6,H))
    x,y=(i%cols)*W,(i//cols)*(H+20);G.paste(im,(x+3,y+20));d.text((x+5,y+4),cards[i]['id']+('  [MARKET]' if i in MARKET else ''),fill='black')
G.save('/workspace/lizard-wizard/cards/reagent_contact_sheet.jpg',quality=88)
