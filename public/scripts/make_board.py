from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=2
bg=Image.open('/workspace/lizard-wizard/assets/board_bg.jpg').convert('RGB').resize((864*S,1152*S),Image.LANCZOS)
W,H=bg.size
fd='/usr/share/fonts/truetype/sand-box/google/'
cin=lambda sz: ImageFont.truetype(fd+'Cinzel Decorative/CinzelDecorative-Bold.ttf',sz*S)
sans=lambda sz: ImageFont.truetype(fd+'Alegreya Sans/AlegreyaSans-Bold.ttf',sz*S)
# darken top for tracks
ov=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov)
for y in range(0,350*S):
    a=int(120*(1-y/(350*S))**0.8); d.line([(0,y),(W,y)],fill=(5,8,30,a))
bg=Image.alpha_composite(bg.convert('RGBA'),ov)
fill=Image.new('RGBA',(W,H),(0,0,0,0)); fdr=ImageDraw.Draw(fill)
glow=Image.new('RGBA',(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow)
line=Image.new('RGBA',(W,H),(0,0,0,0)); ld=ImageDraw.Draw(line)
txt=[]
GL=(120,180,255,255); LN=(190,225,255,255)
def box(x,y,w,h,r=8,f=(8,14,40,140),lw=2):
    b=[x*S,y*S,(x+w)*S,(y+h)*S]
    fdr.rounded_rectangle(b,r*S,fill=f)
    gd.rounded_rectangle(b,r*S,outline=GL,width=6*S)
    ld.rounded_rectangle(b,r*S,outline=LN,width=lw*S)
def text(x,y,s,font,anchor='mm',col=(235,242,255)):
    txt.append((x*S,y*S,s,font,anchor,col))
reag=[('Mandrake',(110,190,80)),('Eye of Newt',(230,200,60)),('Nightshade',(150,110,210)),('Sulphur',(245,220,40)),('Foxglove',(225,90,170)),('Toadstool',(220,60,50)),('Horn',(205,170,120))]
icons=[]
for i,(n,c) in enumerate(reag):
    x=24+i*96; box(x,18,84,322,10,(8,14,40,150))
    icons.append((n.replace(' ','_'),x+42,44))
    text(x+42,76,n.upper(),sans(10 if len(n)>9 else 12))
    for v in range(1,13):
        cy=324-(v-1)*20.2
        ld.rounded_rectangle([(x+10)*S,(cy-8.5)*S,(x+74)*S,(cy+8.5)*S],8*S,outline=(160,200,255,200),width=S)
        text(x+62,cy,str(v),sans(12))
box(708,18,140,322,10,(8,14,40,150)); text(778,33,'ACHIEVEMENTS',sans(12))
for k in range(4): box(722,50+k*72,112,64,6,(5,10,30,170),1)
CW,CH=104,145
def slot(x,y,lab): box(x,y,CW,CH,8); text(x+CW/2,y+CH-12,lab,sans(10),col=(200,220,255))
def head(x,y,s): text(x,y,s,cin(17))
head(147,368,'Build Tower'); slot(40,384,'TOWER DECK'); slot(154,384,'TOWER')
head(666,368,'Recruit Wizards'); slot(500,384,'WIZARD DECK'); slot(614,384,'WIZARD'); slot(728,384,'WIZARD')
head(194,562,'Summon Familiar'); slot(24,578,'FAMILIAR DECK'); slot(138,578,'FAMILIAR'); slot(252,578,'FAMILIAR')
head(724,604,'Research Spells'); slot(614,620,'SPELL'); slot(728,620,'SPELL'); slot(500,778,'SPELL DECK'); slot(614,778,'SPELL'); slot(728,778,'SPELL')
head(92,884,'Dungeon'); slot(40,900,'DUNGEON DECK')
fdr.rounded_rectangle([170*S,1088*S,848*S,1140*S],10*S,fill=(5,8,25,170))
text(509,1102,'THREE WAYS TO CAST A SPELL',sans(13),col=(255,225,150))
text(509,1124,'1. When you gather reagents     2. When you research a new spell     3. When you summon a familiar',sans(12))
glow=glow.filter(ImageFilter.GaussianBlur(5*S))
out=Image.alpha_composite(Image.alpha_composite(Image.alpha_composite(bg,fill),glow),line)
tl=Image.new('RGBA',(W,H),(0,0,0,0)); tdr=ImageDraw.Draw(tl)
sh=Image.new('RGBA',(W,H),(0,0,0,0)); sdr=ImageDraw.Draw(sh)
for x,y,s,f,a,c in txt:
    sdr.text((x,y),s,font=f,anchor=a,fill=(0,0,20,255),stroke_width=3*S,stroke_fill=(0,0,20,255)); tdr.text((x,y),s,font=f,anchor=a,fill=c+(255,))
import os,sys
OUT=sys.argv[2] if len(sys.argv)>2 else '/workspace/lizard-wizard/assets/game_board_clean'
os.makedirs('/workspace/lizard-wizard/assets/reagent_markers',exist_ok=True)
def marker(n,d):
    m=Image.new('RGBA',(d,d),(0,0,0,0)); md=ImageDraw.Draw(m)
    md.ellipse([0,0,d-1,d-1],fill=(225,235,255,255))
    md.ellipse([d*0.06,d*0.06,d*0.94,d*0.94],fill=(18,28,70,255))
    ic=Image.open('/workspace/lizard-wizard/assets/reagent_icons/'+n+'.png'); ic.thumbnail((int(d*0.78),int(d*0.78)),Image.LANCZOS)
    m.alpha_composite(ic,((d-ic.width)//2,(d-ic.height)//2)); return m
for n,_,_ in icons:
    marker(n,256).save('/workspace/lizard-wizard/assets/reagent_markers/'+n+'.png')
POS=dict(zip([i[0] for i in icons],[int(a) for a in (sys.argv[1].split(',') if len(sys.argv)>1 else ['0']*7)]))
for (n,cx,cy),xi in zip(icons,range(7)):
    v=POS[n]
    if v<1: continue
    x=24+xi*96; my=324-(v-1)*20.2; d=19
    m=marker(n,256).resize((d*S,d*S),Image.LANCZOS)
    shd=Image.new('RGBA',m.size,(0,0,0,0)); shd.putalpha(m.getchannel('A').point(lambda a:a*0.7))
    out.alpha_composite(shd.filter(ImageFilter.GaussianBlur(2*S)),(int((x+26-d/2)*S)+S,int((my-d/2)*S)+2*S))
    out.alpha_composite(m,(int((x+26-d/2)*S),int((my-d/2)*S)))
for n,cx,cy in icons:
    ic=Image.open('/workspace/lizard-wizard/assets/reagent_icons/'+n+'.png'); ic.thumbnail((50*S,42*S),Image.LANCZOS)
    shd=Image.new('RGBA',ic.size,(0,0,0,0)); shd.putalpha(ic.getchannel('A').point(lambda a:a*0.6))
    out.alpha_composite(shd.filter(ImageFilter.GaussianBlur(3*S)),(int(cx*S-ic.width/2)+2*S,int(cy*S-ic.height/2)+3*S))
    out.alpha_composite(ic,(int(cx*S-ic.width/2),int(cy*S-ic.height/2)))
out=Image.alpha_composite(Image.alpha_composite(out,sh.filter(ImageFilter.GaussianBlur(2*S))),tl)
out.convert('RGB').save(OUT+'.jpg',quality=92)
out.convert('RGB').resize((864,1152),Image.LANCZOS).save(OUT+'_preview.jpg',quality=88)
