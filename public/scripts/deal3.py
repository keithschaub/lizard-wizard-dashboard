import json, random, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R='/workspace/lizard-wizard/'; A=R+'assets/'
seed=int(sys.argv[1]) if len(sys.argv)>1 else random.randrange(10**6); rnd=random.Random(seed)
d=json.load(open(R+'cards/cards.json'))
# wizards: 2 per school (remove 2 of 4)
wiz=[w for w in d['wizards']['unique_cards'] for _ in range(3)]; rnd.shuffle(wiz)
tow=[]
for tr in (1,2,3):
    g=[t for t in d['towers']['cards'] if t['tier']==tr]; rnd.shuffle(g); tow+=g
fam=[]
for c in (5,10,15,20):
    g=[f for f in d['familiars']['cards'] if f['cost_mana']==c]; rnd.shuffle(g); fam+=g
pc=json.load(open(R+'cards/spells_from_pc.json'))['cards']
spells=[]
for c in pc: spells+=[A+'Spell_'+c['id']+'.jpg']*int(c.get('copies') or 1)
assert len(spells)==65 and all(os.path.exists(x) for x in spells), len(spells)
rnd.shuffle(spells)
reag=[A+f'Reagent_{i:02d}.jpg' for i in range(1,57)]; rnd.shuffle(reag)
ach=[t['text'] for t in d['achievements']['tiles']]; rnd.shuffle(ach); ach=ach[:4]
names=['Mandrake','Eye_of_Newt','Nightshade','Sulphur','Foxglove','Toadstool','Horn']
toks=rnd.sample(names,7)
pl=[{'name':n,'hand':[reag.pop() for _ in range(3)],'tok':[]} for n in ('LizWiz','Keith','Newt')]
start='LizWiz'
state=dict(seed=seed,tower_face=tow[0]['image'],tower_deck=len(tow)-1,wiz_face=[w['image'] for w in wiz[:2]],wiz_deck=len(wiz)-2,
 fam_face=[f['image'] for f in fam[:2]],fam_deck=len(fam)-2,spell_face=spells[:4],spell_deck=len(spells)-4,dungeon_deck=51,reag_deck=len(reag),ach=ach,players=pl,start=start,tow_list=[t['image'] for t in tow],wiz_list=[w['image'] for w in wiz],fam_list=[f['image'] for f in fam],spell_list=spells,reag_list=reag)
json.dump(state,open(R+'game/g3_state.json','w'),indent=1) if os.path.isdir(R+'game') else (os.makedirs(R+'game'),json.dump(state,open(R+'game/g3_state.json','w'),indent=1))
print(json.dumps(state,indent=1)[:1500])
