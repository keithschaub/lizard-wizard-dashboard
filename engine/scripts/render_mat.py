"""Reusable Lizard Wizard UI renderer (PIL).

Usage:
    from render_mat import Canvas, render_mat, render_strip, score
    cv = Canvas(2880, 1800)
    render_mat(cv, x, y, w, h, player_state)      # full player mat (fixed template)
    render_strip(cv, x, y, w, h, player_state)    # slim opponent summary strip
    cv.flush().convert('RGB').save('out.jpg')

Drawing is layered like make_board.py: panels (fill + blurred light-blue glow + crisp line)
-> card images / icons (in call order) -> text with soft dark shadow.

Player state dict (all keys optional except name):
  name, avatar (image path), tag (e.g. 'START PLAYER'), mana, gold,
  tokens {reagent: n}, hand [Reagent_XX image paths], hand_limit,
  wizards [wizard names], towers [[tower name, tier]], familiars [[familiar name, mana cost]],
  spells_cast [spell ids], spells_uncast [spell ids], spells_used [one-time spell ids],
  items [Dungeon item names], trophies [monster names], achievements [tile texts],
  items_vp (10 / 5 / 0, depends on other players), current (bool, current turn)
"""
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

R = '/workspace/lizard-wizard/'
A = R + 'assets/'
FD = '/usr/share/fonts/truetype/sand-box/google/'
_fc = {}
def _font(path, z):
    k = (path, int(z))
    if k not in _fc: _fc[k] = ImageFont.truetype(FD + path, int(z))
    return _fc[k]
cin  = lambda z: _font('Cinzel Decorative/CinzelDecorative-Bold.ttf', z)
sans = lambda z: _font('Alegreya Sans/AlegreyaSans-Bold.ttf', z)
sansr = lambda z: _font('Alegreya Sans/AlegreyaSans-Medium.ttf', z)
sansi = lambda z: _font('Alegreya Sans/AlegreyaSans-MediumItalic.ttf', z)

GL = (120, 180, 255, 255); LN = (190, 225, 255, 255)
GOLD = (214, 180, 90); TXT = (235, 242, 255); MUTED = (170, 188, 225)

SCHOOLS = ['Conjuring', 'Sorcery', 'Alchemy', 'Enchantment', 'Druidry', 'Thaumaturgy', 'Necromancy']
REAGENTS = ['Mandrake', 'Eye of Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn']  # board track order

DATA = json.load(open(R + 'cards/cards.json'))
SPELLS = {c['id']: c for c in json.load(open(R + 'cards/spells_from_pc.json'))['cards']}
SCHOOL_REAGENT = DATA['school_reagent_map']
WIZ = {w['name']: w for w in DATA['wizards']['unique_cards']}
TOW = {(t['name'], t['tier']): t for t in DATA['towers']['cards']}
FAM = {(f['name'], f['cost_mana']): f for f in DATA['familiars']['cards']}
PATH = lambda p: p if p.startswith('/') else R + p
rkey = lambda n: n.replace(' ', '_')

_imc = {}
def load(path):
    path = PATH(path)
    if path not in _imc: _imc[path] = Image.open(path).convert('RGBA')
    return _imc[path]

def rr_mask(w, h, r):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255); return m


class Canvas:
    def __init__(self, W, H, bg=(10, 14, 34)):
        self.W, self.H = W, H
        self.base = Image.new('RGBA', (W, H), bg + (255,))
        self.panels = []   # (box, r, fill, glow, line, lw)
        self.ops = []      # callables(img) drawn in order after panels
        self.txt = []      # (x,y,s,font,anchor,col,shadow)

    # ---- layer 1: glow panels
    def panel(self, x, y, w, h, r=12, fill=(8, 14, 40, 170), glow=GL, line=LN, lw=2, gw=6):
        self.panels.append(([x, y, x + w, y + h], r, fill, glow, line, lw, gw))

    # ---- layer 2: images & direct draws
    def image(self, im, x, y, w, h, r=8, shadow=True, alpha=1.0, fit=False):
        def op(img, im=im, x=x, y=y, w=w, h=h):
            src = load(im) if isinstance(im, str) else im
            if fit:
                from PIL import ImageOps
                t = ImageOps.fit(src, (int(w), int(h)), Image.LANCZOS, centering=(0.5, 0.3))
            else:
                t = src.resize((int(w), int(h)), Image.LANCZOS)
            t = t.copy()
            a = rr_mask(t.width, t.height, r) if r else Image.new('L', t.size, 255)
            if src.mode == 'RGBA' and not fit:
                from PIL import ImageChops
                a = ImageChops.multiply(a, t.getchannel('A'))
            if alpha < 1: a = a.point(lambda v: int(v * alpha))
            t.putalpha(a)
            if shadow:
                sh = Image.new('RGBA', t.size, (0, 0, 0, 0)); sh.putalpha(a.point(lambda v: int(v * .75)))
                pad = 12
                big = Image.new('RGBA', (t.width + 2 * pad, t.height + 2 * pad), (0, 0, 0, 0)); big.alpha_composite(sh, (pad, pad))
                img.alpha_composite(big.filter(ImageFilter.GaussianBlur(5)), (int(x) - pad + 3, int(y) - pad + 5))
            img.alpha_composite(t, (int(x), int(y)))
        self.ops.append(op)

    def circle_image(self, im, cx, cy, d, ring=LN, rw=3):
        def op(img):
            src = load(im) if isinstance(im, str) else im
            from PIL import ImageOps
            t = ImageOps.fit(src, (int(d), int(d)), Image.LANCZOS, centering=(0.5, 0.35)).copy()
            m = Image.new('L', t.size, 0); ImageDraw.Draw(m).ellipse([0, 0, d - 1, d - 1], fill=255); t.putalpha(m)
            img.alpha_composite(t, (int(cx - d / 2), int(cy - d / 2)))
            ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse([cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2], outline=ring, width=rw); img.alpha_composite(ov)
        self.ops.append(op)

    def draw(self, fn):  # fn(ImageDraw) drawn on top of images in order
        def op(img):
            ov = Image.new('RGBA', img.size, (0, 0, 0, 0)); fn(ImageDraw.Draw(ov))
            img.alpha_composite(ov)
        self.ops.append(op)

    # ---- layer 3: text
    def text(self, x, y, s, font, anchor='mm', col=TXT, shadow=True):
        self.txt.append((x, y, s, font, anchor, col, shadow))

    def flush(self):
        W, H = self.W, self.H
        fill = Image.new('RGBA', (W, H), (0, 0, 0, 0)); fd = ImageDraw.Draw(fill)
        glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
        line = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(line)
        for b, r, f, g, l, lw, gw in self.panels:
            if f: fd.rounded_rectangle(b, r, fill=f)
            if g: gd.rounded_rectangle(b, r, outline=g, width=gw)
            if l: ld.rounded_rectangle(b, r, outline=l, width=lw)
        out = Image.alpha_composite(self.base, fill)
        out = Image.alpha_composite(out, glow.filter(ImageFilter.GaussianBlur(5)))
        out = Image.alpha_composite(out, line)
        for op in self.ops: op(out)
        tl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); td = ImageDraw.Draw(tl)
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
        for x, y, s, f, a, c, shd in self.txt:
            if shd: sd.text((x, y), s, font=f, anchor=a, fill=(0, 0, 20, 255), stroke_width=3, stroke_fill=(0, 0, 20, 255))
            td.text((x, y), s, font=f, anchor=a, fill=c if len(c) == 4 else c + (255,))
        out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(2)))
        return Image.alpha_composite(out, tl)


# ------------------------------------------------------------------ helpers
def marker_path(n): return A + 'reagent_markers/' + rkey(n) + '.png'
def icon_path(n): return A + 'reagent_icons/' + rkey(n) + '.png'

def coin(cv, cx, cy, d, value, kind='mana', label=None, fs=None):
    col = {'mana': ((40, 110, 220), (190, 225, 255)), 'gold': ((205, 160, 40), (255, 235, 160)),
           'items': ((120, 70, 150), (225, 200, 255))}[kind]
    cv.draw(lambda d_, cx=cx, cy=cy, d=d, col=col: (
        d_.ellipse([cx - d / 2 + 2, cy - d / 2 + 4, cx + d / 2 + 2, cy + d / 2 + 4], fill=(0, 0, 10, 140)),
        d_.ellipse([cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2], fill=col[0] + (255,), outline=col[1] + (255,), width=max(2, d // 18)),
        d_.ellipse([cx - d / 2 + d * .14, cy - d / 2 + d * .14, cx + d / 2 - d * .14, cy + d / 2 - d * .14], outline=col[1] + (110,), width=1)))
    cv.text(cx, cy, str(value), sans(fs or d * .45), col=(255, 255, 255))
    if label: cv.text(cx + d / 2 + 8, cy, label, sans(max(14, d * .3)), 'lm', MUTED)

def badge(cv, cx, cy, n, d=24, col=(16, 24, 58), ring=(214, 180, 90)):
    cv.draw(lambda dr: dr.ellipse([cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2], fill=col + (255,), outline=ring + (255,), width=2))
    cv.text(cx, cy, str(n), sans(d * .68), col=(255, 240, 200), shadow=False)

def token_row(cv, x, y, tokens, d=52, step=70, badge_d=26):
    for i, n in enumerate(REAGENTS):
        c = tokens.get(n, 0)
        cv.image(marker_path(n), x + i * step, y, d, d, r=0, shadow=c > 0, alpha=1.0 if c else 0.32)
        badge(cv, x + i * step + d - 4, y + d - 4, c, badge_d, ring=GOLD if c else (90, 100, 130))

def pill(cv, x, y, w, h, s, fill=(214, 180, 90), col=(40, 25, 5), fs=None):
    cv.draw(lambda dr: dr.rounded_rectangle([x, y, x + w, y + h], h // 2, fill=fill + (255,)))
    cv.text(x + w / 2, y + h / 2, s, sans(fs or h * .55), col=col, shadow=False)

def slot(cv, x, y, w, h, label=None, r=8, fs=14):
    cv.panel(x, y, w, h, r, fill=(8, 14, 40, 90), glow=(120, 180, 255, 70), line=(160, 200, 255, 90), lw=1, gw=4)
    if label: cv.text(x + w / 2, y + h / 2, label, sansr(fs), col=(150, 175, 225, 150), shadow=False)

def ach_tile(cv, x, y, w, h, t):
    """Achievement tile, same look as render_start.py."""
    k = h / 64
    def op(img):
        t2 = Image.new('RGBA', (int(w), int(h)), (0, 0, 0, 0)); d = ImageDraw.Draw(t2)
        d.rounded_rectangle([0, 0, w - 1, h - 1], int(6 * k), fill=(232, 214, 160, 255), outline=(150, 110, 40, 255), width=max(2, int(2 * k)))
        d.text((w / 2, 12 * k), 'ACHIEVEMENT', font=sans(9 * k), anchor='mm', fill=(110, 70, 20))
        d.text((w - 12 * k, 12 * k), '10', font=sans(9 * k), anchor='mm', fill=(110, 70, 20))
        if t.startswith('x7 '):
            n = t[3:]; d.text((w * .28, 38 * k), '7', font=cin(22 * k), anchor='mm', fill=(60, 30, 10))
            ic = load(icon_path(n)).copy(); ic.thumbnail((int(40 * k), int(34 * k)), Image.LANCZOS)
            t2.alpha_composite(ic, (int(w * .62 - ic.width / 2), int(38 * k - ic.height / 2)))
        else:
            num, rest = t.split(' ', 1); rest = rest.replace(' cards', ' Cards')
            d.text((w / 2, 31 * k), num, font=cin(15 * k), anchor='mm', fill=(60, 30, 10))
            d.text((w / 2, 50 * k), rest, font=sans(12 * k), anchor='mm', fill=(60, 30, 10))
        sh = Image.new('RGBA', (t2.width + 20, t2.height + 20), (0, 0, 0, 0)); sh.alpha_composite(Image.new('RGBA', t2.size, (0, 0, 0, 150)), (10, 10))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)), (int(x) - 7, int(y) - 5))
        img.alpha_composite(t2, (int(x), int(y)))
    cv.ops.append(op)


# ------------------------------------------------------------------ rules: tableau + score
def tableau(p):
    cols = {s: [] for s in SCHOOLS}
    for n in p.get('wizards', []):
        w = WIZ[n]; cols[w['school']].append(('wizard', n, w['image']))
    for n, t in p.get('towers', []):
        c = TOW[(n, t)]; cols[c['school']].append(('tower', f'{n} ({t})', c['image']))
    for n, m in p.get('familiars', []):
        c = FAM[(n, m)]; cols[c['school']].append(('familiar', f'{n} ({m})', c['image']))
    return cols

def score(p):
    wz = {s: 0 for s in SCHOOLS}; tw = {s: 0 for s in SCHOOLS}
    for n in p.get('wizards', []): wz[WIZ[n]['school']] += 1
    for n, t in p.get('towers', []): tw[TOW[(n, t)]['school']] += 1
    matched = {s for s in SCHOOLS if min(wz[s], tw[s]) > 0}
    m = sum(min(wz[s], tw[s]) for s in SCHOOLS)
    rw = sum(wz.values()) - m; rt = sum(tw.values()) - m
    mm = min(rw, rt)
    pairs = 10 * m + 5 * mm
    unpaired = (rw - mm) + (rt - mm)
    cast = [SPELLS[i] for i in p.get('spells_cast', [])] + [SPELLS[i] for i in p.get('spells_used', [])]
    matching = 5 * sum(1 for c in cast if c['school'] in matched or (c['school'] == 'Wild' and matched))
    nfam = len(p.get('familiars', [])); nwiz = len(p.get('wizards', []))
    spellvp = 0
    for c in cast:
        i = c['id']
        if i == 'Undying':
            spellvp += 3 * (wz['Necromancy'] + sum(1 for n, mm_ in p.get('familiars', []) if FAM[(n, mm_)]['school'] == 'Necromancy'))
        elif i == 'Control_Undead': spellvp += 3 * len(p.get('trophies', []))
        elif i == 'Order_of_the_Wand': spellvp += 2 * nwiz
        elif i == 'Potent_Servant': spellvp += nfam
        elif i == 'Pulsing_Towers': spellvp += len(p.get('towers', []))
        elif i == 'Master_Alchemist': spellvp += p.get('gold', 0) // 2
        elif i == 'Hoard_Mana': spellvp += p.get('mana', 0) // 7
        elif i == 'Arch_Mage': spellvp += 3 * len(set(p.get('wizards', [])))
    gold = p.get('gold', 0); items = p.get('items_vp', 0); ach = 10 * len(p.get('achievements', []))
    s = dict(pairs=pairs, matching=matching, unpaired=unpaired, spellvp=spellvp, gold=gold, items=items, ach=ach)
    s['total'] = sum(s.values()); s['matched_schools'] = matched
    return s

def storage(p):
    return 10 + len(p.get('towers', [])) + (10 if 'Root_Cellar' in p.get('spells_cast', []) else 0)

def hand_limit(p):
    return p.get('hand_limit') or (5 if 'Crystal_Ball' in p.get('spells_cast', []) else 3)


def cap_slot(cv, x1, y, x2, h, n, cap, what):
    """One faint glowing region for the unused capacity of a fanned row."""
    if n >= cap or x2 - x1 < 30: return
    slot(cv, x1, y, x2 - x1, h, None, 7)
    if what and x2 - x1 > 90:
        cv.text((x1 + x2) / 2, y + h / 2, f'room for {cap - n} more', sansi(15), col=(150, 175, 225, 170), shadow=False)

# ------------------------------------------------------------------ fanned stacks
def fan_v(cv, x, y, w, h, cards, step, label_fs=14):
    """Vertical fan: each card shows its top `step` px strip, last card full."""
    for i, (kind, name, img) in enumerate(cards):
        cy = y + i * step
        cv.image(img, x, cy, w, h, r=7, shadow=True)
        if i < len(cards) - 1:
            cv.draw(lambda dr, cy=cy: dr.rounded_rectangle([x + w * .2, cy + step * .22, x + w * .8, cy + step * .78], 9, fill=(5, 8, 25, 175)))
            cv.text(x + w / 2, cy + step / 2, name, sans(label_fs), col=(240, 232, 205), shadow=False)

def fan_h(cv, x, y, w, h, imgs, step):
    for i, img in enumerate(imgs): cv.image(img, x + i * step, y, w, h, r=7)


# ------------------------------------------------------------------ the full player mat (fixed template)
def render_mat(cv, x0, y0, w, h, p):
    """Fixed template, designed for w~2848 x h~560. Capacity: hand 5, 6 cards per school column,
    6 cast + 6 uncast spells, 8 items, 3 trophies, 4 achievements. Nothing moves during the game."""
    sc = score(p)
    hl = p.get('current')
    cv.panel(x0, y0, w, h, 16, fill=(14, 22, 54, 235), glow=(240, 200, 110, 255) if hl else GL,
             line=(255, 225, 150, 255) if hl else LN, lw=2)
    # ---------------- header strip
    hy = y0 + 18; hc = hy + 38
    if p.get('avatar'): cv.circle_image(p['avatar'], x0 + 56, hc, 72, ring=GOLD + (255,))
    cv.text(x0 + 104, hc - 10, p['name'], cin(34), 'lm')
    if p.get('tag'): pill(cv, x0 + 106, hc + 18, 150, 26, p['tag'], fs=15)
    coin(cv, x0 + 360, hc, 66, p.get('mana', 0), 'mana', 'Mana', fs=30)
    coin(cv, x0 + 520, hc, 66, p.get('gold', 0), 'gold', 'Gold', fs=30)
    coin(cv, x0 + 680, hc, 66, len(p.get('items', [])), 'items', 'Items', fs=30)
    tot = sum(p.get('tokens', {}).values())
    cv.text(x0 + 830, hy - 2, f'Reagent tokens   {tot} / {storage(p)}', sans(17), 'lm', MUTED)
    token_row(cv, x0 + 830, hy + 16, p.get('tokens', {}), d=54, step=72, badge_d=28)
    # score bar
    sx = x0 + 1365; sw = x0 + w - 20 - sx
    cv.panel(sx, hy - 4, sw, 84, 12, fill=(5, 10, 30, 200), glow=None, line=(150, 190, 255, 160), lw=1)
    chips = [('Pairs', sc['pairs']), ('Matching spells', sc['matching']), ('Unpaired', sc['unpaired']),
             ('Spell VP', sc['spellvp']), ('Gold', sc['gold']), ('Items', sc['items']), ('Achievements', sc['ach'])]
    cwid = (sw - 210) / len(chips)
    for i, (lab, v) in enumerate(chips):
        cx = sx + cwid * i + cwid / 2
        cv.text(cx, hy + 22, str(v), cin(30), col=(255, 240, 200))
        cv.text(cx, hy + 58, lab, sansr(16), col=MUTED, shadow=False)
        if i: cv.draw(lambda dr, xx=sx + cwid * i: dr.line([xx, hy + 10, xx, hy + 66], fill=(120, 150, 210, 120), width=1))
    tx = sx + sw - 200
    cv.draw(lambda dr: dr.rounded_rectangle([tx, hy + 4, tx + 190, hy + 72], 10, fill=(214, 180, 90, 255)))
    cv.text(tx + 95, hy + 30, str(sc['total']), cin(36), col=(40, 22, 5), shadow=False)
    cv.text(tx + 95, hy + 60, 'TOTAL VP (live)', sans(15), col=(70, 40, 10), shadow=False)
    by = y0 + 116
    cv.draw(lambda dr: dr.line([x0 + 20, by - 6, x0 + w - 20, by - 6], fill=(120, 160, 230, 110), width=1))
    ly = by + 16; cy0 = by + 36; bot = y0 + h - 16
    # ---------------- hand (5 reserved slots, fanned)
    hx = x0 + 22; cw_, ch_ = 136, 188
    lim = hand_limit(p); hand = p.get('hand', [])
    cv.text(hx, ly, f'Hand   {len(hand)} / {lim}', sans(19), 'lm')
    for i in range(5):
        xx = hx + (i % 3) * (cw_ + 8); yy = cy0 + (i // 3) * (ch_ + 8)
        if i < len(hand): cv.image(hand[i], xx, yy, cw_, ch_, r=9)
        else:
            slot(cv, xx, yy, cw_, ch_, None, 9)
            cv.text(xx + cw_ / 2, yy + ch_ / 2 - 12, f'card {i + 1}', sansr(16), col=(150, 175, 225, 170), shadow=False)
            cv.text(xx + cw_ / 2, yy + ch_ / 2 + 12, 'if hand size 5' if i >= lim else 'open', sansi(14), col=(150, 175, 225, 150), shadow=False)
    cv.text(hx + 2 * (cw_ + 8) + cw_ / 2, cy0 + ch_ + 8 + ch_ / 2 - 12, 'Hand size 5:', sansi(15), col=MUTED, shadow=False)
    cv.text(hx + 2 * (cw_ + 8) + cw_ / 2, cy0 + ch_ + 8 + ch_ / 2 + 10, 'Crystal Ball', sans(16), col=(255, 225, 150), shadow=False)
    # ---------------- seven school columns
    cols = tableau(p)
    colx = x0 + 476; cwc, gap = 166, 12
    ccw, cch, cst = 136, 190, 38
    cv.text(colx, ly, 'Schools  -  wizards, towers, familiars', sans(19), 'lm')
    for i, s in enumerate(SCHOOLS):
        x = colx + i * (cwc + gap); cards = cols[s]
        matched = s in sc['matched_schools']
        cv.panel(x, cy0, cwc, bot - cy0, 10, fill=(8, 14, 40, 110 if cards else 70),
                 glow=(240, 200, 110, 150) if matched else (120, 180, 255, 90 if cards else 50),
                 line=(255, 225, 150, 220) if matched else (160, 200, 255, 140 if cards else 70), lw=1, gw=5)
        cv.image(icon_path(SCHOOL_REAGENT[s]), x + 10, cy0 + 6, 28, 28, r=0, shadow=False)
        cv.text(x + 42, cy0 + 20, s.upper(), sans(14 if len(s) > 9 else 15), 'lm', TXT)
        if cards: badge(cv, x + cwc - 15, cy0 + 20, len(cards), 22)
        top = cy0 + 40
        if cards:
            fan_v(cv, x + (cwc - ccw) / 2, top, ccw, cch, cards, cst, 13)
        else:
            slot(cv, x + (cwc - ccw) / 2, top, ccw, cch, 'empty', 7, 16)
        if matched:
            pill(cv, x + 22, bot - 34, cwc - 44, 24, 'MATCHED PAIR', fs=13)
    # ---------------- spells
    spx = colx + 7 * (cwc + gap) + 14; sw_, sh_, sst = 110, 166, 62
    cast = p.get('spells_cast', []); unc = p.get('spells_uncast', [])
    cv.text(spx, ly, f'Ongoing (cast)  {len(cast)}', sans(19), 'lm')
    cap_slot(cv, spx + (len(cast) - 1) * sst + sw_ + 8 if cast else spx, cy0, spx + 5 * sst + sw_, sh_, len(cast), 6, 'spells')
    fan_h(cv, spx, cy0, sw_, sh_, [A + 'Spell_' + c + '.jpg' for c in cast], sst)
    uy = cy0 + sh_ + 12
    cv.text(spx, uy + 12, f'Uncast (face down)  {len(unc)}', sans(19), 'lm')
    uy += 28
    cap_slot(cv, spx + (len(unc) - 1) * sst + sw_ + 8 if unc else spx, uy, spx + 5 * sst + sw_, sh_ - 16, len(unc), 6, 'spells')
    for i, c in enumerate(unc):
        cv.image(A + 'Spell_' + c + '.jpg', spx + i * sst, uy, sw_, sh_ - 16, r=7, alpha=0.9)
        cv.draw(lambda dr, xx=spx + i * sst: dr.rounded_rectangle([xx, uy, xx + sw_, uy + sh_ - 16], 7, fill=(10, 14, 40, 90)))
    if unc: pill(cv, spx + (len(unc) - 1) * sst + sw_ - 70, uy + sh_ - 44, 62, 22, 'UNCAST', fill=(90, 100, 140), col=(235, 240, 255), fs=12)
    # ---------------- dungeon loot, trophies, achievements
    lx = spx + 5 * sst + sw_ + 34; lw_ = x0 + w - 20 - lx
    cv.panel(lx - 14, cy0 - 30, lw_ + 14, bot - cy0 + 30, 12, fill=(8, 14, 40, 90), glow=None, line=(150, 190, 255, 110), lw=1)
    items = p.get('items', [])
    cv.text(lx, ly, f'Dungeon loot   {len(items)} items', sans(19), 'lm')
    iw, ih, ist = 112, 136, 64
    cap_slot(cv, lx + (len(items) - 1) * ist + iw + 8 if items else lx, cy0, lx + 7 * ist + iw, ih, len(items), 8, 'items')
    fan_h(cv, lx, cy0, iw, ih, [A + 'Dungeon_' + it + '.jpg' for it in items], ist)
    ry = cy0 + ih + 14
    tro = p.get('trophies', [])
    cv.text(lx, ry + 10, 'Undead trophies', sans(17), 'lm')
    cv.text(lx, ry + 30, '+3 VP each (Control Undead)', sansi(14), 'lm', MUTED)
    tw_, th_ = 104, 150
    cap_slot(cv, lx + (len(tro) - 1) * 54 + tw_ + 8 if tro else lx, ry + 44, lx + 2 * 54 + tw_, th_ - 10, len(tro), 3, '')
    fan_h(cv, lx, ry + 44, tw_, th_ - 10, [A + 'Dungeon_Monster_' + t + '.jpg' for t in tro], 54)
    ax = lx + 250
    achs = p.get('achievements', [])
    cv.text(ax, ry + 10, f'Achievements  {len(achs)}', sans(17), 'lm')
    cv.text(ax, ry + 30, '10 VP each', sansi(14), 'lm', MUTED)
    aw, ah = 150, 84
    for i in range(4):
        xx = ax + (i % 2) * (aw + 12); yy = ry + 44 + (i // 2) * (ah + 10)
        if i < len(achs): ach_tile(cv, xx, yy, aw, ah, achs[i])
        else: slot(cv, xx, yy, aw, ah, None, 7)
    return sc


# ------------------------------------------------------------------ slim opponent strip
def render_strip(cv, x, y, w, h, p):
    sc = score(p); hl = p.get('current')
    cv.panel(x, y, w, h, 14, fill=(16, 24, 58, 230) if not hl else (34, 34, 62, 240),
             glow=(250, 205, 110, 255) if hl else GL, line=(255, 228, 150, 255) if hl else LN, lw=3 if hl else 2, gw=10 if hl else 6)
    if p.get('avatar'): cv.circle_image(p['avatar'], x + 50, y + 50, 70, ring=(GOLD if hl else (190, 225, 255)) + (255,))
    cv.text(x + 98, y + 38, p['name'], cin(28), 'lm')
    if hl: pill(cv, x + 100, y + 62, 150, 26, 'CURRENT TURN', fs=15)
    else: cv.text(x + 100, y + 75, p.get('status', ''), sansi(17), 'lm', MUTED)
    cv.text(x + w - 22, y + 40, str(sc['total']), cin(40), 'rm', (255, 236, 190))
    cv.text(x + w - 22, y + 76, 'VP (live)', sans(15), 'rm', MUTED)
    # resources
    ry = y + 128
    coin(cv, x + 40, ry, 44, p.get('mana', 0), 'mana', 'Mana', fs=20)
    coin(cv, x + 160, ry, 44, p.get('gold', 0), 'gold', 'Gold', fs=20)
    coin(cv, x + 280, ry, 44, len(p.get('items', [])), 'items', 'Items', fs=20)
    ns = len(p.get('spells_cast', [])) + len(p.get('spells_used', [])); nu = len(p.get('spells_uncast', []))
    cv.text(x + 390, ry - 12, f'Spells  {ns} cast', sans(16), 'lm', TXT)
    cv.text(x + 390, ry + 10, f'{nu} uncast  -  {len(p.get("achievements", []))} ach.', sansr(15), 'lm', MUTED)
    # school chips
    cv.text(x + 18, y + 172, 'Cards by school', sans(15), 'lm', MUTED)
    cv.text(x + w - 18, y + 172, 'gold = matched wizard + tower', sansi(14), 'rm', MUTED)
    cy = y + 186; cols = tableau(p); chw = (w - 32 - 6 * 6) / 7
    for i, s in enumerate(SCHOOLS):
        cx = x + 16 + i * (chw + 6); n = len(cols[s]); m = s in sc['matched_schools']
        cv.panel(cx, cy, chw, 64, 8, fill=(8, 14, 40, 170 if n else 90), glow=(240, 200, 110, 140) if m else None,
                 line=(255, 225, 150, 230) if m else (150, 190, 255, 150 if n else 60), lw=1, gw=4)
        cv.text(cx + chw / 2, cy + 15, s[:3].upper(), sans(14), col=(200, 215, 245) if n else (110, 125, 160), shadow=False)
        cv.text(cx + chw / 2, cy + 42, str(n), sans(26), col=(255, 205, 100) if m else (TXT if n else (110, 125, 160)))
    # reagent tokens
    ty = y + 278
    cv.text(x + 18, ty - 10, f'Reagent tokens  {sum(p.get("tokens", {}).values())}/{storage(p)}', sans(15), 'lm', MUTED)
    token_row(cv, x + 18, ty + 4, p.get('tokens', {}), d=36, step=(w - 60) / 7, badge_d=21)
    cv.text(x + w - 18, y + h - 18, 'Tap to expand  >', sansi(16), 'rm', (160, 190, 245))
    return sc
