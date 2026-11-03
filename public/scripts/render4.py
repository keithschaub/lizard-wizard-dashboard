import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R='/workspace/lizard-wizard/'; A=R+'assets/'; S=2
import os as _o0
st=json.load(open(_o0.environ.get('G4_STATE',R+'game/g4_state.json')))
OUT=_o0.environ.get('G4_OUT',R+'game/g4_position')
# Per-human private views (Nov 2 2026, 2-human game g5): G4_VIEWER names the human whose hand/mana/gold is shown.
# Unset -> legacy single-human output (Keith; g4_position_phone_board/mats). Set -> OUT_board.jpg (if G4_BOARD!='0')
# and OUT_mats_<viewer>.jpg. Every other player's hand cards, mana and gold are hidden ('?'); tokens stay public.
MULTI=bool(_o0.environ.get('G4_VIEWER')); VIEWER=_o0.environ.get('G4_VIEWER') or 'Keith'
WANT_BOARD=_o0.environ.get('G4_BOARD','1')!='0'
HUMANS=st.get('meta',{}).get('humans',['Keith'])
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
EX=1176; ROWH=580
img=Image.new('RGBA',(W,H+EX*S),(10,14,34,255)); img.paste(board,(0,0))
CW,CH=104,145
def rr_mask(w,h,r):
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w-1,h-1],r,fill=255); return m
_SHADOW={}
def put(im,x,y,w,h,shadow=True,_ready=False):
    if not _ready: im=im.convert('RGBA').resize((int(w*S),int(h*S)),Image.LANCZOS); im.putalpha(rr_mask(im.width,im.height,7*S))
    if shadow:
        if im.size not in _SHADOW:   # shadow depends only on the rounded-rect mask, so cache it per size (speed, Nov 2 2026)
            sh=Image.new('RGBA',im.size,(0,0,0,0)); sh.putalpha(rr_mask(im.width,im.height,7*S).point(lambda a:a*0.75))
            _SHADOW[im.size]=sh.filter(ImageFilter.GaussianBlur(4*S))
        img.alpha_composite(_SHADOW[im.size],(int(x*S)+3*S,int(y*S)+4*S))
    img.alpha_composite(im,(int(x*S),int(y*S)))
# Resized, rounded card images are cached on disk (assets/cache_resized/) keyed by file, size and source mtime,
# so a render no longer decodes the 1158x1755 enhanced JPGs and LANCZOS-resizes them every time.
CACHE_DIR=A+'cache_resized/'; _MEM={}
def card_img(path,w,h):
    import os
    src=P(path); k=(src,int(w*S),int(h*S))
    if k in _MEM: return _MEM[k]
    fn=CACHE_DIR+f"{os.path.basename(src)[:-4]}_{'e' if '/enhanced/' in src else 'o'}_{k[1]}x{k[2]}_{int(os.path.getmtime(src))}.png"
    try: im=Image.open(fn); im.load()
    except Exception:
        im=Image.open(src).convert('RGBA')
        im=im.resize((k[1],k[2]),Image.LANCZOS); im.putalpha(rr_mask(k[1],k[2],7*S))
        os.makedirs(CACHE_DIR,exist_ok=True); _tmp=f'{fn}.{os.getpid()}.tmp.png'; im.save(_tmp,compress_level=1); os.replace(_tmp,fn)   # pid-unique tmp: parallel per-viewer renders share the cache
    _MEM[k]=im; return im
def card(path,x,y,w=CW,h=CH): put(card_img(path,w,h),x,y,w,h,_ready=True)
def slot(lst,i,x,y,w=CW,h=CH):
    # empty face-up slot (deck exhausted): draw a dashed 'EMPTY' placeholder instead of crashing
    if i<len(lst) and lst[i]: return card(lst[i],x,y,w,h)
    d=ImageDraw.Draw(img); d.rounded_rectangle([x*S,y*S,(x+w)*S,(y+h)*S],7*S,outline=(150,150,150,255),width=2*S)
    d.text(((x+w//2-18)*S,(y+h//2-6)*S),'EMPTY',fill=(190,190,190,255),font_size=12*S)
def back(label,count,x,y,col=(28,40,96),w=CW,h=CH):
    k=min(1.0,w/104,h/145)
    b=Image.new('RGBA',(int(w*S),int(h*S)),col+(255,)); d=ImageDraw.Draw(b)
    for i in range(0,int((w+h)*S),max(4,int(10*S*k))): d.line([(i,0),(i-h*S,h*S)],fill=tuple(min(255,c+14) for c in col)+(255,),width=S)
    d.rounded_rectangle([5*S*k,5*S*k,(w-5*k)*S,(h-5*k)*S],int(5*S*k),outline=(214,180,90,255),width=max(1,int(2*S*k)))
    d.ellipse([(w/2-26*k)*S,(h/2-46*k)*S,(w/2+26*k)*S,(h/2+6*k)*S],outline=(214,180,90,255),width=max(1,int(2*S*k)))
    d.text((w/2*S,(h/2-20*k)*S),'LW',font=cin(18*k),anchor='mm',fill=(240,215,140))
    d.text((w/2*S,(h/2+24*k)*S),label,font=cin(10*max(k,0.75)),anchor='mm',fill=(240,225,180))
    d.text((w/2*S,(h/2+42*k)*S),f'{count} cards' if count!='' else '',font=sans(11*k),anchor='mm',fill=(220,225,245))
    put(b,x,y,w,h)
# towers
PICKS=st.get('meta',{}).get('phase')=='picks'
if PICKS:
    assert not any(k in st for k in ('tower_face','tow_list','wiz_face','wiz_list','fam_face','fam_list','spell_face','spell_list','ach')), 'board data present during picks phase'
    back('Reagents',st['reag_deck'],380,420,(70,40,20))
    _d=ImageDraw.Draw(img)
    _d.rounded_rectangle([132*S,738*S,436*S,852*S],14*S,fill=(10,14,34,225),outline=(214,180,90,255),width=2*S)
    _d.text((284*S,766*S),'Board is dealt after everyone',font=cin(13),anchor='mm',fill=(240,215,140))
    _d.text((284*S,790*S),'picks starting reagents',font=cin(13),anchor='mm',fill=(240,215,140))
    _d.text((284*S,824*S),'Waiting on: '+', '.join(x.split(' ')[0] for x in st['meta'].get('pending',[])),font=sans(14),anchor='mm',fill=(220,225,245))
else:
    assert st['tower_deck']==len(st.get('tow_list',[])), 'tower_deck counter mismatch'
    back('Towers',st['tower_deck'],40,384)
    if st.get('tower_face'): card(st['tower_face'],154,384)
    back('Wizards',st['wiz_deck'],500,384); slot(st['wiz_face'],0,614,384); slot(st['wiz_face'],1,728,384)
    back('Familiars',st['fam_deck'],24,578); slot(st['fam_face'],0,138,578); slot(st['fam_face'],1,252,578)
    back('Spells',st['spell_deck'],500,778,(60,30,90))
    for (x,y),s in zip([(614,620),(728,620),(614,778),(728,778)],st['spell_face']): card(s,x,y)
    back('Dungeon',st['dungeon_deck'],40,900,(80,30,24))

_SCHOOLS=['Alchemy','Conjuring','Druidry','Enchantment','Necromancy','Sorcery','Thaumaturgy']
_R2S={'Horn':'Conjuring','Foxglove':'Sorcery','Eye of Newt':'Alchemy','Mandrake':'Enchantment','Toadstool':'Druidry','Sulphur':'Thaumaturgy','Nightshade':'Necromancy'}
def ach_school(t):
    """Deterministic: school named in the achievement text, else the school of the reagent named in it."""
    for sc in _SCHOOLS:
        if sc.lower() in t.lower(): return sc
    for r,sc in _R2S.items():
        if r.lower() in t.lower().replace('_',' '): return sc
    return None
from functools import lru_cache as _lru
@_lru(None)
def school_icon(sc,d): return Image.open(A+'school_icons/'+sc+'.png').convert('RGBA').resize((int(d*S),int(d*S)),Image.LANCZOS)
def group_counts(lst):
    out=[]
    for b in lst:
        for e in out:
            if e[0]==b: e[1]+=1; break
        else: out.append([b,1])
    return out
# achievements
for k,t in enumerate([] if PICKS else st['ach']):
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
        d.text(((w/2+10)*S,34*S),num,font=cin(15),anchor='mm',fill=(60,30,10))
        d.text((w/2*S,52*S),rest,font=sans(12),anchor='mm',fill=(60,30,10))
    _sc=ach_school(t)
    if _sc:
        _si=school_icon(_sc,18 if not t.startswith('x7 ') else 16)
        if t.startswith('x7 '): t2.alpha_composite(_si,(int((w-22)*S),int((h-21)*S)))
        else: t2.alpha_composite(_si,(int((w/2-22)*S),int(25*S)))
    else:
        import carddb as _CDB; _ai=_CDB.get('Achievement:'+t) or {}
        if not _ai.get('schoolless'): print(f"WARN no school icon for achievement '{t}'")   # schoolless tiles (e.g. '7 Familiars') print none
    put(t2,x,y,w,h,False)
    ImageDraw.Draw(img).text(((x+w-14)*S,(y+16)*S),'10',font=sans(9),anchor='mm',fill=(110,70,20))
# player mats
dr=ImageDraw.Draw(img)
@_lru(None)
def marker(n,d): return Image.open(A+'reagent_markers/'+n+'.png').resize((int(d*S),int(d*S)),Image.LANCZOS)
ORDER=['Mandrake','Eye_of_Newt','Nightshade','Sulphur','Foxglove','Toadstool','Horn']

try:
    import sys as _s,os as _o;_s.path.insert(0,_o.path.dirname(_o.path.abspath(__file__)));import actions as _A
    for _b in _A.audit(st): print('RULE VIOLATION convert:',_b)
    _m=_A.audit_tracks(st)
    if _m: print('RULE VIOLATION tracks (expected, actual):',_m)
except Exception as _e: print('audit error',_e)
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
import sys as _sys; _sys.path.insert(0,_os.path.dirname(_os.path.abspath(__file__)))
import scoring as _scoring
import carddb as _CD
_SCH=_scoring.SCH   # schools from cards/carddb.json (single source, Nov 2 2026)
def score(p): return _scoring.score(p,st)
for i,p in enumerate(st['players']):
    x0=12+(i%2)*426; y0=1152+12+(i//2)*ROWH; w=414; h=ROWH-28; IW=w-28
    dr.rounded_rectangle([x0*S,y0*S,(x0+w)*S,(y0+h)*S],12*S,fill=(16,24,58,255),outline=(150,195,255,255),width=2*S)
    dr.text(((x0+14)*S,(y0+24)*S),p['name'],font=cin(19),anchor='lm',fill=(240,245,255))
    if MULTI:
        _tag=('YOU' if p['name']==VIEWER else 'Human' if p['name'] in HUMANS else 'AI '+str((st['meta'].get('ai_levels') or {}).get(p['name'],'normal')).title())
        dr.text(((x0+14+dr.textlength(p['name'],font=cin(19))/S+8)*S,(y0+25)*S),_tag,font=sans(11),anchor='lm',fill=(120,240,160) if _tag=='YOU' else (170,180,205))
    sc=score(p)
    dr.rounded_rectangle([(x0+w-84)*S,(y0+11)*S,(x0+w-12)*S,(y0+37)*S],13*S,fill=(214,180,90,255))
    dr.text(((x0+w-48)*S,(y0+24)*S),f"{sc} VP",font=sans(15),anchor='mm',fill=(30,22,8))
    dr.text(((x0+w-92)*S,(y0+24)*S),['1st','2nd','3rd','4th'][i],font=sans(12),anchor='rm',fill=(214,180,90))
    cx,cy=x0+38,y0+72
    dr.ellipse([(cx-22)*S,(cy-22)*S,(cx+22)*S,(cy+22)*S],fill=(40,110,220,255),outline=(190,225,255,255),width=3*S)
    dr.text((cx*S,cy*S),(str(p.get('mana',20)) if (p['name']==VIEWER or st['meta'].get('game_over')) else '?'),font=sans(18),anchor='mm',fill='white')
    dr.text(((cx+30)*S,(cy-6)*S),'Mana',font=sans(13),anchor='lm',fill=(200,215,245))
    _ORD=['Toadstool','Horn','Foxglove','Eye_of_Newt','Mandrake','Sulphur','Nightshade']
    _cnt=[(n,p['tok'].count(n)) for n in _ORD if p['tok'].count(n)]+[(n,p['tok'].count(n)) for n in sorted(set(p['tok'])) if n not in _ORD]
    if PICKS and p['name']!=VIEWER:   # starting picks are simultaneous: nobody sees anyone else's pick until the board is dealt
        dr.text(((x0+122)*S,(y0+72)*S),('Picked 2 (revealed at deal)' if _cnt else 'Picking 2 starting reagents'),font=sans(12),anchor='lm',fill=(240,210,120)); _cnt=[]
    elif not _cnt and p['name']==VIEWER and not st['meta'].get('game_over'): dr.text(((x0+122)*S,(y0+72)*S),'Pick 2 starting reagents',font=sans(12),anchor='lm',fill=(240,210,120))
    for j,(n,k) in enumerate(_cnt):
        tx=x0+122+(j%4)*37; ty=y0+57+(j//4)*26
        img.alpha_composite(marker(n,23),(int(tx*S),int(ty*S)))
        dr.text(((tx+25)*S,(ty+12)*S),f"×{k}",font=sans(12),anchor='lm',fill=(240,245,255))
    cap=10+len(p.get('towers',[]))+10*sum(1 for _x in p.get('spells',[]) if _x.get('cast') and 'Root_Cellar' in _x['img']); used=len(p['tok'])
    bon=[_CD.wizard_bonus(w) for w in p.get('wizards',[])]; bon=[b.replace(' ','_') for b in bon if b]
    full=used>=cap
    dr.text(((x0+130)*S,(y0+48)*S),f"Reagents {used}/{cap}",font=sans(12),anchor='lm',fill=(255,120,110) if full else (150,230,170))
    gx=x0+14
    # Gather label is recomputed every render from the wizards on the mat: "Gather 3 +N" + one icon per bonus
    if len(bon)!=len(p.get('wizards',[])): print(f"WARN gather bonus mismatch for {p['name']}: {len(bon)} bonuses vs {len(p.get('wizards',[]))} wizards")
    _gl=f"Gather 3 +{len(bon)}" if bon else "Gather 3"
    dr.text((gx*S,(y0+122)*S),_gl,font=sans(13),anchor='lm',fill=(240,210,120))
    _gw=dr.textlength(_gl,font=sans(13))/S
    _gxx=gx+_gw+6
    for b,cnt in group_counts(bon):
        img.alpha_composite(marker(b,16),(int(_gxx*S),int((y0+114)*S))); _gxx+=18
        if cnt>1:
            dr.text((_gxx*S,(y0+122)*S),f"×{cnt}",font=sans(12),anchor='lm',fill=(240,245,255)); _gxx+=dr.textlength(f"×{cnt}",font=sans(12))/S+5
    if p.get('achievements'):
        _ax=x0+14; dr.text((_ax*S,(y0+142)*S),'Achievements:',font=sans(12),anchor='lm',fill=(214,180,90)); _ax+=dr.textlength('Achievements:',font=sans(12))/S+5
        for _a in p['achievements']:
            _sc=ach_school(_a)
            if _sc: img.alpha_composite(school_icon(_sc,14),(int(_ax*S),int((y0+135)*S))); _ax+=16
            dr.text((_ax*S,(y0+142)*S),_a,font=sans(12),anchor='lm',fill=(214,180,90)); _ax+=dr.textlength(_a,font=sans(12))/S+8
    if p['name']==VIEWER:
        dr.text(((x0+14)*S,(y0+164)*S),'Reagent cards in hand',font=sans(12),anchor='lm',fill=(200,215,245))
        for j,c in enumerate(p['hand']): card(c,x0+14+j*84,y0+176,78,109)
    else:
        dr.text(((x0+14)*S,(y0+161)*S),f"Reagent cards ({len(p['hand'])})",font=sans(13),anchor='lm',fill=(200,215,245))
    _RM={'Conjuring':'Horn','Sorcery':'Foxglove','Alchemy':'Eye_of_Newt','Enchantment':'Mandrake','Druidry':'Toadstool','Thaumaturgy':'Sulphur','Necromancy':'Nightshade'}
    gold='?' if (p['name']!=VIEWER and not st['meta'].get('game_over') and not st['meta'].get('show_gold')) else p.get('gold',0)   # house rule meta.show_gold: Gold public
    dr.text(((x0+68)*S,(y0+90)*S),f"Gold {gold}",font=sans(13),anchor='lm',fill=(230,190,90))
    _it_names=[c.get('name','?') for c in p.get('treasures',[])]
    if _it_names: dr.text(((x0+68)*S,(y0+108)*S),f"Items {len(_it_names)}: "+", ".join(_it_names),font=sans(12),anchor='lm',fill=(230,190,90))
    _Wl=p.get('wizards',[]); _Tl=p.get('towers',[])
    _ws=[_SCH.get(_os.path.basename(c)) for c in _Wl]; _ts=[_SCH.get(_os.path.basename(c)) for c in _Tl]
    # Same pairs the old itertools.permutations search picked (first max-match permutation), computed directly.
    if len(_Wl)<=len(_Tl): _bp=list(enumerate(_scoring.best_assignment(_ws,_ts)))
    else: _bp=[(a,b) for b,a in enumerate(_scoring.best_assignment(_ts,_ws))]
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
    ly=y0+(300 if p['name']==VIEWER else 182)
    dr.text(((x0+14)*S,ly*S),f"Wizards & Towers ({len(_Wl)}/{len(_Tl)})",font=sans(12),anchor='lm',fill=(200,215,245))
    if _mt: dr.text(((x0+w-12)*S,ly*S),f"{len(_mt)} matched",font=sans(11),anchor='rm',fill=G)
    n=len(cols)
    if not n: dr.text(((x0+14)*S,(ly+60)*S),'none yet',font=sans(11),anchor='lm',fill=(120,135,170))
    else:
        cw=min(50,int((IW-(n-1)*5)/n)); gap=5 if n>1 else 0
        if n>1: gap=min(10,(IW-n*cw)/(n-1))
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
    colbot=ly+12+14+(int(min(50,int((IW-(max(n,1)-1)*5)/max(n,1)))*1.4)*1.68 if n else 60)
    msch={_ws[a2] for a2,_ in _mt}
    items=[('c' if sp.get('cast') else 'b',sp['img']) for sp in p.get('spells',[])]+[('c',c) for c in p.get('familiars',[])]
    sy=int(colbot)+18
    dr.text(((x0+14)*S,sy*S),f"Spells & Familiars ({len(items)})",font=sans(12),anchor='lm',fill=(200,215,245))
    if not items: dr.text(((x0+14)*S,(sy+30)*S),'none yet',font=sans(11),anchor='lm',fill=(120,135,170))
    sw=44; shh=min(62,int(y0+h-sy-18)); sw=int(shh/1.4)
    step=sw+5 if len(items)*(sw+5)<=IW+5 else int((IW-sw)/max(1,len(items)-1))
    for j,(t,c) in enumerate(items):
        xx,yy=x0+14+j*step,sy+10
        sc=_SCH.get(_os.path.basename(c)); hl=t=='c' and sc in msch
        if hl: dr.rounded_rectangle([(xx-2)*S,(yy-2)*S,(xx+sw+2)*S,(yy+shh+2)*S],4*S,outline=G,width=3*S)
        if t=='c': card(c,xx,yy,sw,shh); _strip(c,xx,yy,sw,shh,hl)
        else: back('Spell','',xx,yy,(60,30,90),sw,shh)
if MULTI and not st['meta'].get('game_over'):   # seeds would let a human re-derive deck order / the other human's hand: hidden until game over
    dr.text((W/2,(H/S+EX-8)*S),(f'Setup: picking starting reagents   ·   Reagent deck: {st["reag_deck"]} cards' if PICKS else f'Round {st["meta"]["round"]}   ·   Reagent deck: {st["reag_deck"]} cards   ·   {VIEWER}\'s private view'),font=sans(11),anchor='mm',fill=(140,155,190))
else: dr.text((W/2,(H/S+EX-8)*S),(f'Setup: picking starting reagents   ·   Reagent deck: {st["reag_deck"]} cards   ·   Hands seed {st.get("hands_seed",st["seed"])}' if PICKS else f'Round {st["meta"]["round"]}   ·   Reagent deck: {st["reag_deck"]} cards   ·   Hands seed {st.get("hands_seed",st["seed"])} · Board seed {st.get("board_seed",st["seed"])}'),font=sans(11),anchor='mm',fill=(140,155,190))
print('SCORES',[(p['name'],score(p),p.get('mana')) for p in st['players']])
out=img.convert('RGB'); _bh=H  # board area height in px
_rd=st.get('meta',{}).get('round',0); _n=1
if MULTI:
    _vl=VIEWER.lower(); _tag=_o0.path.basename(OUT)
    while _o0.path.exists(f'/tmp/qc_{_tag}_r{_rd}_{_n}_board.jpg') or _o0.path.exists(f'/tmp/qc_{_tag}_r{_rd}_{_n}_mats_{_vl}.jpg'): _n+=1
    parts=([('board',(0,0,W,_bh),OUT+'_board.jpg')] if WANT_BOARD else [])+[('mats_'+_vl,(0,_bh,W,out.height),OUT+'_mats_'+_vl+'.jpg')]
    for _part,_box,_fn in parts:
        _c=out.crop(_box); _c.save(_fn,quality=88)
        _t=_c.copy(); _t.thumbnail((640,900),Image.LANCZOS,reducing_gap=2.0); _t.save(f'/tmp/qc_{_tag}_r{_rd}_{_n}_{_part}.jpg',quality=85)
        print('IMAGE',_part,_fn,f'/tmp/qc_{_tag}_r{_rd}_{_n}_{_part}.jpg')
else:
    out.save(OUT+'.jpg',quality=90)
    out.resize((W//2,out.height//2),Image.LANCZOS,reducing_gap=2.0).save(OUT+'_preview.jpg',quality=88)
    # Phone views (Keith, Nov 2 2026): split into two near-screen-shaped images so each fills an iPhone screen when tapped
    out.crop((0,0,W,_bh)).save(OUT+'_phone_board.jpg',quality=88)
    out.crop((0,_bh,W,out.height)).save(OUT+'_phone_mats.jpg',quality=88)
    print('PHONE', OUT+'_phone_board.jpg', OUT+'_phone_mats.jpg')
    # QC thumbnails (unique names, never reused) so no separate resize step is needed before Reading them.
    while _o0.path.exists(f'/tmp/qc_{_rd}_{_n}_board.jpg') or _o0.path.exists(f'/tmp/qc_{_rd}_{_n}_mats.jpg'): _n+=1
    for _part,_box in (('board',(0,0,W,_bh)),('mats',(0,_bh,W,out.height))):
        _t=out.crop(_box); _t.thumbnail((640,900),Image.LANCZOS,reducing_gap=2.0); _t.save(f'/tmp/qc_{_rd}_{_n}_{_part}.jpg',quality=85)
    print('QC', f'/tmp/qc_{_rd}_{_n}_board.jpg', f'/tmp/qc_{_rd}_{_n}_mats.jpg')

# Always print deterministic VP values of face-up wizards/tower for every player (use these in chat/widgets/AI bids).
for _c in st.get('wiz_face',[]):
    print('VALUE wizard',_os.path.basename(_c),_scoring.school(_c),_scoring.value_table(st,_c,'wizards'))
if st.get('tower_face'): print('VALUE tower',_os.path.basename(st['tower_face']),_scoring.school(st['tower_face']),_scoring.value_table(st,st['tower_face'],'towers'))
