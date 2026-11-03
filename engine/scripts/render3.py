import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R='/workspace/lizard-wizard/'; A=R+'assets/'; S=2
st=json.load(open(R+'game/g3_state.json'))
def P(p):
    import os
    if not p: return p
    p2=p if p.startswith('/') else R+p
    bn=os.path.basename(p2)
    enh=A+'enhanced/'+bn
    return enh if os.path.exists(enh) else p2
fd='/usr/share/fonts/truetype/sand-box/google/'
cin=lambda z: ImageFont.truetype(fd+'Cinzel Decorative/CinzelDecorative-Bold.ttf',int(z*S))
sans=lambda z: ImageFont.truetype(fd+'Alegreya Sans/AlegreyaSans-Bold.ttf',int(z*S))
board=Image.open(A+'game_board_start.jpg').convert('RGBA'); W,H=board.size
EX=580
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
    d.text((w/2*S,(h/2+42)*S),f'{count} cards' if count!='' else '',font=sans(11),anchor='mm',fill=(220,225,245))
    put(b,x,y,w,h)
# towers
back('Towers',st['tower_deck'],40,384)
if st.get('tower_face'): card(st['tower_face'],154,384)
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
ORDER=['Mandrake','Eye_of_Newt','Nightshade','Sulphur','Foxglove','Toadstool','Horn']
tr=st.get('tracks') or {n:1 for n in ORDER}
for _n in list(tr):
    if not 1<=tr[_n]<=12: print('WARNING track out of range, clamped:',_n,tr[_n]); tr[_n]=max(1,min(12,tr[_n]))
_dr=ImageDraw.Draw(img)
for i,n in enumerate(ORDER):
    x=24+i*96
    _dr.ellipse([(x+26-12)*S,(324-12)*S,(x+26+12)*S,(324+12)*S],fill=(8,14,40,255))
for i,n in enumerate(ORDER):
    v=max(1,min(12,int(tr.get(n,1)))); x=24+i*96; cy=324-(v-1)*20.2
    m=marker(n,19); img.alpha_composite(m,(int((x+26-9.5)*S),int((cy-9.5)*S)))

import json as _json, itertools as _it, os as _os
_SCH={}
def _w(o):
    if isinstance(o,dict):
        if o.get('school') and o.get('image'): _SCH[_os.path.basename(o['image'])]=o['school']
        if o.get('school') and o.get('name') and not o.get('image'): _SCH.setdefault('Spell_'+o['name'].replace(' ','_')+'.jpg',o['school'])
        if o.get('name') and not o.get('image') and not o.get('school') and isinstance(o.get('preproduction_appendix'),dict) and o['preproduction_appendix'].get('school'): _SCH.setdefault('Spell_'+o['name'].replace(' ','_')+'.jpg',o['preproduction_appendix']['school'])
        for v in o.values(): _w(v)
    elif isinstance(o,list):
        for v in o: _w(v)
_w(_json.load(open(R+'cards/cards.json')))
def score(p):
    W=[_SCH.get(_os.path.basename(c)) for c in p.get('wizards',[])]
    T=[_SCH.get(_os.path.basename(c)) for c in p.get('towers',[])]
    SP=[_SCH.get(_os.path.basename(x['img'])) for x in p.get('spells',[]) if x.get('cast')]
    best=0
    a,b=(W,T) if len(W)<=len(T) else (T,W)
    for perm in _it.permutations(range(len(b)),len(a)):
        pts=0; matched=set()
        for i,j in enumerate(perm):
            if a[i] and a[i]==b[j]: pts+=10; matched.add(a[i])
            else: pts+=5
        pts+=len(b)-len(a)
        pts+=5*sum(1 for sc in SP if sc in matched)
        best=max(best,pts)
    best+=10*len(p.get('achievements',[]))
    if any(x.get('cast') and 'Spell_Undying' in x['img'] for x in p.get('spells',[])): best+=3*(W.count('Necromancy')+sum(1 for f in p.get('familiars',[]) if _SCH.get(_os.path.basename(f))=='Necromancy'))
    return best
for i,p in enumerate(st['players']):
    x0=12+i*284; y0=1152+12; w=272; h=EX-28
    dr.rounded_rectangle([x0*S,y0*S,(x0+w)*S,(y0+h)*S],12*S,fill=(16,24,58,255),outline=(150,195,255,255),width=2*S)
    dr.text(((x0+14)*S,(y0+24)*S),p['name'],font=cin(19),anchor='lm',fill=(240,245,255))
    sc=score(p)
    dr.rounded_rectangle([(x0+w-84)*S,(y0+11)*S,(x0+w-12)*S,(y0+37)*S],13*S,fill=(214,180,90,255))
    dr.text(((x0+w-48)*S,(y0+24)*S),f"{sc} VP",font=sans(15),anchor='mm',fill=(30,22,8))
    dr.text(((x0+w-92)*S,(y0+24)*S),['1st','2nd','3rd'][i],font=sans(12),anchor='rm',fill=(214,180,90))
    cx,cy=x0+38,y0+72
    dr.ellipse([(cx-22)*S,(cy-22)*S,(cx+22)*S,(cy+22)*S],fill=(40,110,220,255),outline=(190,225,255,255),width=3*S)
    dr.text((cx*S,cy*S),(str(p.get('mana',20)) if (p['name']=='Keith' or st['meta'].get('game_over')) else '?'),font=sans(18),anchor='mm',fill='white')
    dr.text(((cx+30)*S,(cy-6)*S),'Mana',font=sans(13),anchor='lm',fill=(200,215,245))
    _ORD=['Toadstool','Horn','Foxglove','Eye_of_Newt','Mandrake','Sulphur','Nightshade']
    _cnt=[(n,p['tok'].count(n)) for n in _ORD if p['tok'].count(n)]+[(n,p['tok'].count(n)) for n in sorted(set(p['tok'])) if n not in _ORD]
    for j,(n,k) in enumerate(_cnt):
        tx=x0+122+(j%4)*37; ty=y0+57+(j//4)*26
        img.alpha_composite(marker(n,23),(int(tx*S),int(ty*S)))
        dr.text(((tx+25)*S,(ty+12)*S),f"×{k}",font=sans(12),anchor='lm',fill=(240,245,255))
    import json as _j
    if '_CARDS' not in globals():
        _m={}
        def _walk(o):
            if isinstance(o,dict):
                if o.get('image') and o.get('gather_bonus_reagent'): _m[o['image']]=o
                for v in o.values(): _walk(v)
            elif isinstance(o,list):
                for v in o: _walk(v)
        _walk(_j.load(open(R+'cards/cards.json'))); globals()['_CARDS']=_m
    cap=10+len(p.get('towers',[]))+10*sum(1 for _x in p.get('spells',[]) if _x.get('cast') and 'Root_Cellar' in _x['img']); used=len(p['tok'])
    bon=[_CARDS.get(w,{}).get('gather_bonus_reagent') for w in p.get('wizards',[])]; bon=[b.replace(' ','_') for b in bon if b]
    full=used>=cap
    dr.text(((x0+130)*S,(y0+48)*S),f"Reagents {used}/{cap}",font=sans(12),anchor='lm',fill=(255,120,110) if full else (150,230,170))
    gx=x0+14
    dr.text((gx*S,(y0+122)*S),f"Gather +{len(bon)}",font=sans(13),anchor='lm',fill=(240,210,120))
    for k,b in enumerate(bon[:8]):
        img.alpha_composite(marker(b,16),(int((gx+62+k*18)*S),int((y0+114)*S)))
    if p.get('achievements'): dr.text(((x0+14)*S,(y0+142)*S),'Achievements: '+', '.join(p['achievements']),font=sans(12),anchor='lm',fill=(214,180,90))
    if p['name']=='Keith':
        dr.text(((x0+14)*S,(y0+164)*S),'Reagent cards in hand',font=sans(12),anchor='lm',fill=(200,215,245))
        for j,c in enumerate(p['hand']): card(c,x0+14+j*84,y0+176,78,109)
    else:
        dr.text(((x0+14)*S,(y0+161)*S),f"Reagent cards ({len(p['hand'])})",font=sans(13),anchor='lm',fill=(200,215,245))
    _RM={'Conjuring':'Horn','Sorcery':'Foxglove','Alchemy':'Eye_of_Newt','Enchantment':'Mandrake','Druidry':'Toadstool','Thaumaturgy':'Sulphur','Necromancy':'Nightshade'}
    gold='?' if p['name']!='Keith' else p.get('gold',0)
    dr.text(((x0+68)*S,(y0+90)*S),f"Gold {gold}",font=sans(13),anchor='lm',fill=(230,190,90))
    _Wl=p.get('wizards',[]); _Tl=p.get('towers',[])
    _ws=[_SCH.get(_os.path.basename(c)) for c in _Wl]; _ts=[_SCH.get(_os.path.basename(c)) for c in _Tl]
    _bp=[];_bk=(-1,-1)
    for _perm in _it.permutations(range(len(_Tl)),min(len(_Wl),len(_Tl))) if len(_Wl)<=len(_Tl) else [None]:
        _pairs=list(enumerate(_perm)); _m=sum(1 for a,b in _pairs if _ws[a] and _ws[a]==_ts[b])
        if _m>_bk[0]: _bk=(_m,0); _bp=_pairs
    if len(_Wl)>len(_Tl):
        _bk=(-1,0)
        for _perm in _it.permutations(range(len(_Wl)),len(_Tl)):
            _pairs=[(a,b) for b,a in enumerate(_perm)]; _m=sum(1 for a,b in _pairs if _ws[a] and _ws[a]==_ts[b])
            if _m>_bk[0]: _bk=(_m,0); _bp=_pairs
    _mt=[(a,b) for a,b in _bp if _ws[a] and _ws[a]==_ts[b]]; _mm=[(a,b) for a,b in _bp if (a,b) not in _mt]
    _ord=_mt+_mm
    _wo=[a for a,b in _ord]+[a for a in range(len(_Wl)) if a not in [x for x,_ in _ord]]
    _to=[b for a,b in _ord]+[b for b in range(len(_Tl)) if b not in [y for _,y in _ord]]
    _HL=set([('w',a) for a,b in _mt]+[('t',b) for a,b in _mt])
    _schi={}
    def _sicon(sc,d):
        k=(sc,d)
        if k not in _schi: _schi[k]=Image.open(A+'school_icons/'+sc+'.png').convert('RGBA').resize((int(d*S),int(d*S)),Image.LANCZOS)
        return _schi[k]
    def _strip(c,xx,yy,cw,chh,hl):
        sc=_SCH.get(_os.path.basename(c))
        if not sc or sc not in _RM: return
        sh=min(22,int(cw*0.5))
        dr.rectangle([xx*S,(yy+chh-sh)*S,(xx+cw)*S,(yy+chh)*S],fill=(8,12,30,235))
        d=sh-3
        img.alpha_composite(marker(_RM[sc],d-2),(int((xx+3)*S),int((yy+chh-sh+2.5)*S)))
        img.alpha_composite(_sicon(sc,d),(int((xx+cw-d-2)*S),int((yy+chh-sh+1.5)*S)))
        if hl: dr.ellipse([(xx+1)*S,(yy+chh-sh+0.5)*S,(xx+d+3)*S,(yy+chh-sh+d+2.5)*S],outline=(120,240,160,255),width=2*S)
    G=(120,240,160,255)
    cols=[(_Wl[a],_Tl[b2],True) for a,b2 in _mt]+[(_Wl[a],_Tl[b2],False) for a,b2 in _mm]
    usedw=[a for a,_ in _ord]; usedt=[b2 for _,b2 in _ord]
    cols+=[(_Wl[a],None,False) for a in range(len(_Wl)) if a not in usedw]+[(None,_Tl[b2],False) for b2 in range(len(_Tl)) if b2 not in usedt]
    ly=y0+(300 if p['name']=='Keith' else 182)
    dr.text(((x0+14)*S,ly*S),f"Wizards & Towers ({len(_Wl)}/{len(_Tl)})",font=sans(12),anchor='lm',fill=(200,215,245))
    if _mt: dr.text(((x0+w-12)*S,ly*S),f"{len(_mt)} matched",font=sans(11),anchor='rm',fill=G)
    n=len(cols)
    if not n: dr.text(((x0+14)*S,(ly+60)*S),'none yet',font=sans(11),anchor='lm',fill=(120,135,170))
    else:
        cw=min(44,int((244-(n-1)*5)/n)); gap=5 if n>1 else 0
        if n>1: gap=min(10,(244-n*cw)/(n-1))
        chh=int(cw*1.4)
        vis=int(chh*0.68)
        for j,(wc,tc,m) in enumerate(cols):
            xx=x0+14+j*(cw+gap); top=ly+12
            pts='+10' if m else ('+5' if wc and tc else '+1')
            bot=top+14+vis+chh
            if m: dr.rounded_rectangle([(xx-3)*S,(top-2)*S,(xx+cw+3)*S,(bot+3)*S],5*S,fill=(30,70,50,255),outline=G,width=3*S)
            elif wc and tc: dr.rounded_rectangle([(xx-3)*S,(top-2)*S,(xx+cw+3)*S,(bot+3)*S],5*S,outline=(110,125,160,255),width=S)
            dr.text(((xx+cw/2)*S,(top+6)*S),pts,font=sans(11),anchor='mm',fill=G if m else (170,180,205))
            ty=top+14+vis
            if wc:
                card(wc,xx,top+14,cw,chh)
                if not m: _strip(wc,xx,top+14+vis-int(min(22,cw*0.5)),cw,int(min(22,cw*0.5)),False)
            if tc:
                card(tc,xx,ty,cw,chh); _strip(tc,xx,ty,cw,chh,False)
            else: dr.rounded_rectangle([xx*S,ty*S,(xx+cw)*S,(ty+chh)*S],4*S,fill=(16,24,58,255),outline=(70,85,120,255),width=S)
    colbot=ly+12+14+(int(min(44,int((244-(max(n,1)-1)*5)/max(n,1)))*1.4)*1.68 if n else 60)
    msch={_ws[a2] for a2,_ in _mt}
    items=[('c' if sp.get('cast') else 'b',sp['img']) for sp in p.get('spells',[])]+[('c',c) for c in p.get('familiars',[])]
    sy=int(colbot)+18
    dr.text(((x0+14)*S,sy*S),f"Spells & Familiars ({len(items)})",font=sans(12),anchor='lm',fill=(200,215,245))
    if not items: dr.text(((x0+14)*S,(sy+30)*S),'none yet',font=sans(11),anchor='lm',fill=(120,135,170))
    sw=44; shh=min(62,int(y0+544-sy-10)); sw=int(shh/1.4)
    step=sw+5 if len(items)*(sw+5)<=249 else int((244-sw)/max(1,len(items)-1))
    for j,(t,c) in enumerate(items):
        xx,yy=x0+14+j*step,sy+10
        sc=_SCH.get(_os.path.basename(c)); hl=t=='c' and sc in msch
        if hl: dr.rounded_rectangle([(xx-2)*S,(yy-2)*S,(xx+sw+2)*S,(yy+shh+2)*S],4*S,outline=G,width=3*S)
        if t=='c': card(c,xx,yy,sw,shh); _strip(c,xx,yy,sw,shh,hl)
        else: back('Spell','',xx,yy,(60,30,90),sw,shh)
dr.text((W/2,(H/S+EX-8)*S),f'Reagent deck: {st["reag_deck"]} cards   ·   Setup seed {st["seed"]}',font=sans(11),anchor='mm',fill=(140,155,190))
print('SCORES',[(p['name'],score(p),p.get('mana')) for p in st['players']])
out=img.convert('RGB'); out.save(R+'game/g3_position.jpg',quality=90)
out.resize((W//2,out.height//2),Image.LANCZOS).save(R+'game/g3_position_preview.jpg',quality=88)
