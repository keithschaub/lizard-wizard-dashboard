import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R='/workspace/lizard-wizard/'; A=R+'assets/'; S=2
st=json.load(open(R+'game/start_state.json'))
P=lambda p: p if p.startswith('/') else R+p
import os
def P(p, _P=P):
    # prefer the enhanced-graphics deck (assets/enhanced/<same filename>), fall back to the original photo
    f=_P(p); e=os.path.join(os.path.dirname(f),'enhanced',os.path.basename(f))
    return e if os.path.dirname(f).rstrip('/')==A.rstrip('/') and os.path.exists(e) else f
fd='/usr/share/fonts/truetype/sand-box/google/'
cin=lambda z: ImageFont.truetype(fd+'Cinzel Decorative/CinzelDecorative-Bold.ttf',int(z*S))
sans=lambda z: ImageFont.truetype(fd+'Alegreya Sans/AlegreyaSans-Bold.ttf',int(z*S))
board=Image.open(A+'game_board_start.jpg').convert('RGBA'); W,H=board.size
EX=372
img=Image.new('RGBA',(W,H+EX*S),(10,14,34,255)); img.paste(board,(0,0))
CW,CH=104,145
def rr_mask(w,h,r):
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w-1,h-1],r,fill=255); return m
def put(im,x,y,w,h,shadow=True):
    im=im.convert('RGBA').resize((int(w*S),int(h*S)),Image.LANCZOS); im.putalpha(rr_mask(im.width,im.height,7*S))
    if shadow:
        sh=Image.new('RGBA',im.size,(0,0,0,0)); sh.putalpha(im.getchannel('A').point(lambda a:a*0.75))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4*S)),(int(x*S)+3*S,int(y*S)+4*S))
    img.alpha_composite(im,(int(x*S),int(y*S)))
def card(path,x,y,w=CW,h=CH): put(Image.open(P(path)),x,y,w,h)
def back(label,count,x,y,col=(28,40,96),w=CW,h=CH):
    b=Image.new('RGBA',(w*S,h*S),col+(255,)); d=ImageDraw.Draw(b)
    for i in range(0,(w+h)*S,10*S): d.line([(i,0),(i-h*S,h*S)],fill=tuple(min(255,c+14) for c in col)+(255,),width=S)
    d.rounded_rectangle([5*S,5*S,(w-5)*S,(h-5)*S],5*S,outline=(214,180,90,255),width=2*S)
    d.ellipse([(w/2-26)*S,(h/2-46)*S,(w/2+26)*S,(h/2+6)*S],outline=(214,180,90,255),width=2*S)
    d.text((w/2*S,(h/2-20)*S),'LW',font=cin(18),anchor='mm',fill=(240,215,140))
    d.text((w/2*S,(h/2+24)*S),label,font=cin(10),anchor='mm',fill=(240,225,180))
    d.text((w/2*S,(h/2+42)*S),f'{count} cards',font=sans(11),anchor='mm',fill=(220,225,245))
    put(b,x,y,w,h)
# towers
back('Towers',st['tower_deck'],40,384); card(st['tower_face'],154,384)
back('Wizards',st['wiz_deck'],500,384); card(st['wiz_face'][0],614,384); card(st['wiz_face'][1],728,384)
back('Familiars',st['fam_deck'],24,578); card(st['fam_face'][0],138,578); card(st['fam_face'][1],252,578)
back('Spells',st['spell_deck'],500,778,(60,30,90))
for (x,y),s in zip([(614,620),(728,620),(614,778),(728,778)],st['spell_face']): card(s,x,y)
back('Dungeon',st['dungeon_deck'],40,900,(80,30,24))
# achievements
for k,t in enumerate(st['ach']):
    x,y,w,h=722,50+k*72,112,64
    t2=Image.new('RGBA',(w*S,h*S),(0,0,0,0)); d=ImageDraw.Draw(t2)
    d.rounded_rectangle([0,0,w*S-1,h*S-1],6*S,fill=(232,214,160,255),outline=(150,110,40,255),width=2*S)
    d.text((w/2*S,16*S),'ACHIEVEMENT',font=sans(9),anchor='mm',fill=(110,70,20))
    if t.startswith('x7 '):
        n=t[3:]; d.text((30*S,40*S),'7',font=cin(22),anchor='mm',fill=(60,30,10))
        ic=Image.open(A+'reagent_icons/'+n.replace(' ','_')+'.png'); ic.thumbnail((40*S,36*S),Image.LANCZOS)
        t2.alpha_composite(ic,(int(70*S-ic.width/2),int(40*S-ic.height/2)))
    else:
        num,rest=t.split(' ',1); rest=rest.replace(' cards',' Cards')
        d.text((w/2*S,34*S),num,font=cin(15),anchor='mm',fill=(60,30,10))
        d.text((w/2*S,52*S),rest,font=sans(12),anchor='mm',fill=(60,30,10))
    put(t2,x,y,w,h,False)
    ImageDraw.Draw(img).text(((x+w-14)*S,(y+16)*S),'10',font=sans(9),anchor='mm',fill=(110,70,20))
# player mats
dr=ImageDraw.Draw(img)
def marker(n,d): return Image.open(A+'reagent_markers/'+n+'.png').resize((int(d*S),int(d*S)),Image.LANCZOS)
for i,p in enumerate([st['p1'],st['p2']]):
    x0=16+i*424; y0=1152+12; w=408; h=EX-28
    dr.rounded_rectangle([x0*S,y0*S,(x0+w)*S,(y0+h)*S],12*S,fill=(16,24,58,255),outline=(150,195,255,255),width=2*S)
    dr.text(((x0+18)*S,(y0+26)*S),p['name'],font=cin(22),anchor='lm',fill=(240,245,255))
    if st['start']==p['name']:
        dr.rounded_rectangle([(x0+w-128)*S,(y0+12)*S,(x0+w-14)*S,(y0+40)*S],14*S,fill=(214,180,90,255))
        dr.text(((x0+w-71)*S,(y0+26)*S),'START PLAYER',font=sans(12),anchor='mm',fill=(40,25,5))
    # mana coin
    cx,cy=x0+46,y0+86
    dr.ellipse([(cx-26)*S,(cy-26)*S,(cx+26)*S,(cy+26)*S],fill=(40,110,220,255),outline=(190,225,255,255),width=3*S)
    dr.text((cx*S,cy*S),'20',font=sans(20),anchor='mm',fill='white')
    dr.text(((cx+36)*S,cy*S),'Mana',font=sans(15),anchor='lm',fill=(200,215,245))
    dr.text(((x0+200)*S,(y0+66)*S),'Reagents',font=sans(13),anchor='lm',fill=(200,215,245))
    for j,n in enumerate(p['tok']):
        img.alpha_composite(marker(n,40),(int((x0+200+j*50)*S),int((y0+78)*S)))
    dr.text(((x0+18)*S,(y0+136)*S),'Reagent cards in hand',font=sans(13),anchor='lm',fill=(200,215,245))
    for j,c in enumerate(p['hand']): card(c,x0+18+j*128,y0+150,120,167)
    dr.text(((x0+18)*S,(y0+h-24)*S),'Wizards 0   Towers 0   Spells 0   Familiars 0   Gold 0',font=sans(12),anchor='lm',fill=(160,175,210))
dr.text((W/2,(H/S+EX-8)*S),f'Reagent deck: {st["reag_deck"]} cards   ·   Setup seed {st["seed"]}',font=sans(11),anchor='mm',fill=(140,155,190))
out=img.convert('RGB'); out.save(R+'game/start_position.jpg',quality=90)
out.resize((W//2,out.height//2),Image.LANCZOS).save(R+'game/start_position_preview.jpg',quality=88)
