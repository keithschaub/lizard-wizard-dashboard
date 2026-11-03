#!/usr/bin/env python3
"""Enhanced-graphics card rebuilder for Lizard Wizard.

Pipeline per card:
  1. Load photo / scan (assets/<file>).
  2. ART  (wizard, tower, familiar): inpaint the old printed text (light text on dark),
     remove glare/haze (dark-channel dehaze + glare-veil subtraction), CLAHE contrast,
     Real-ESRGAN (general-x4v3, ONNX) upscale, unsharp.
     Spell + reagent cards have no illustration -> rebuilt on reusable blank textures.
  3. FRAME + TEXT: everything printed is redrawn as crisp PIL vector-style layout from the
     JSON card data (never AI text). Icons = assets/reagent_icons + enhanced/_icons school medallions.

Usage:
  python3 scripts/enhance_cards.py --pilot                 # the 5 pilot cards + comparison sheet
  python3 scripts/enhance_cards.py --type wizard           # batch a type (wizard|tower|familiar|spell|reagent|all)
  python3 scripts/enhance_cards.py --files Spell_Evolve.jpg Tower_T2_Ivory_Spire.jpg
  --scale 2.4  (photo types)   spells use 3.0 (scans are only 386x585)
  --no-sr      skip the ESRGAN upscale (Lanczos only, much faster)
"""
import argparse, json, math, os, re, sys, glob
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = '/workspace/lizard-wizard'
A = f'{ROOT}/assets'
OUT = f'{A}/enhanced'
FD = '/usr/share/fonts/truetype/sand-box/google'
MODEL = f'{ROOT}/models/realesr-general-x4v3.onnx'

SCHOOLS = ['Conjuring', 'Sorcery', 'Alchemy', 'Enchantment', 'Druidry', 'Thaumaturgy', 'Necromancy']
GOLD = (214, 178, 96); GOLD_D = (150, 112, 48); CREAM = (246, 238, 220); INK = (14, 12, 11)

# ---------------------------------------------------------------- fonts
_fc = {}
def font(name, size, var=None):
    key = (name, int(size), var)
    if key not in _fc:
        paths = {
            'sans_b': 'Alegreya Sans/AlegreyaSans-Bold.ttf', 'sans_m': 'Alegreya Sans/AlegreyaSans-Medium.ttf',
            'sans_xb': 'Alegreya Sans/AlegreyaSans-ExtraBold.ttf', 'sans_blk': 'Alegreya Sans/AlegreyaSans-Black.ttf',
            'sc_b': 'Alegreya Sans SC/AlegreyaSansSC-Bold.ttf', 'sc_xb': 'Alegreya Sans SC/AlegreyaSansSC-ExtraBold.ttf',
            'serif': 'Alegreya/Alegreya-VariableFont_wght.ttf', 'serif_i': 'Alegreya/Alegreya-Italic-VariableFont_wght.ttf',
            'deco': 'Cinzel Decorative/CinzelDecorative-Bold.ttf', 'deco_blk': 'Cinzel Decorative/CinzelDecorative-Black.ttf',
            'cinzel': 'Cinzel/Cinzel-VariableFont_wght.ttf',
        }
        f = ImageFont.truetype(f'{FD}/{paths[name]}', int(size))
        if var:
            f.set_variation_by_axes([int(var)])   # variable-weight fonts: 400..900
        _fc[key] = f
    return _fc[key]

# ---------------------------------------------------------------- data
def load_data():
    cards = json.load(open(f'{ROOT}/cards/cards.json'))
    spells = json.load(open(f'{ROOT}/cards/spells_from_pc.json'))['cards']
    reag = json.load(open(f'{ROOT}/cards/reagent_cards.json'))['cards']
    D = {}
    for w in cards['wizards']['unique_cards']:
        D[os.path.basename(w['image'])] = ('wizard', w)
    for t in cards['towers']['cards']:
        D[os.path.basename(t['image'])] = ('tower', t)
    for f in cards['familiars']['cards']:
        D[os.path.basename(f['image'])] = ('familiar', f)
    for s in spells:
        D[os.path.basename(s['asset_image'])] = ('spell', s)
    for r in reag:
        D[os.path.basename(r['asset_image'])] = ('reagent', r)
    if os.path.exists(f'{ROOT}/cards/dungeon_cards.json'):
        for c in json.load(open(f'{ROOT}/cards/dungeon_cards.json'))['cards']:
            c.setdefault('name', c['title'] if c['kind'] == 'monster' else c['bottom_text'])
            D[c['file']] = ('dungeon', c)
    return D

# ---------------------------------------------------------------- icon assets
_icons = {}
def reagent_icon(name, h):
    key = ('r', name, h)
    if key not in _icons:
        im = Image.open(f"{A}/reagent_icons/{name.replace(' ', '_')}.png").convert('RGBA')
        im = im.crop(im.split()[-1].getbbox())
        s = h / max(im.size)
        _icons[key] = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    return _icons[key]

def school_icon(school, d):
    """AI-painted medallion (no text) with white bg removed by a circular mask."""
    key = ('s', school, d)
    if key in _icons: return _icons[key]
    cache = f'{OUT}/_icons/school_{school}.png'
    if not os.path.exists(cache):
        raw = np.asarray(Image.open(f'{OUT}/_icons/school_{school}_raw.jpg').convert('RGB')).astype(int)
        nonwhite = (raw.min(2) < 225)
        ys, xs = np.where(nonwhite)
        x0, x1, y0, y1 = np.percentile(xs, .2), np.percentile(xs, 99.8), np.percentile(ys, .2), np.percentile(ys, 99.8)
        cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0) / 2 - 2
        S = 4; H, W = raw.shape[:2]
        m = Image.new('L', (W * S, H * S), 0)
        ImageDraw.Draw(m).ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=255)
        m = m.resize((W, H), Image.LANCZOS)
        im = Image.fromarray(raw.astype(np.uint8)).convert('RGBA'); im.putalpha(m)
        im = im.crop((int(cx - r - 2), int(cy - r - 2), int(cx + r + 3), int(cy + r + 3)))
        im.save(cache)
    im = Image.open(cache).convert('RGBA')
    _icons[key] = im.resize((d, d), Image.LANCZOS)
    return _icons[key]

# ---------------------------------------------------------------- drawing helpers
def ss_layer(size, S=3):
    """supersampled RGBA layer for smooth vector shapes"""
    return Image.new('RGBA', (size[0] * S, size[1] * S), (0, 0, 0, 0)), S

def shadow_text(img, xy, text, f, fill=CREAM, anchor='mm', shadow=(0, 0, 0, 230), blur=None, stroke=0, stroke_fill=None, spacing=0):
    blur = blur if blur is not None else max(2, f.size // 9)
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
    d.text(xy, text, font=f, fill=shadow, anchor=anchor, stroke_width=max(stroke, f.size // 14), stroke_fill=shadow)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(sh)
    ImageDraw.Draw(img).text(xy, text, font=f, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill or fill)

def fit_font(name, text, max_w, start, var=None, min_size=10):
    s = start
    while s > min_size:
        f = font(name, s, var)
        if f.getlength(text) <= max_w: return f
        s -= 1
    return font(name, min_size, var)

def wrap(text, f, max_w):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if f.getlength(t) <= max_w or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def sparkle(d, cx, cy, r, fill):
    k = r * 0.28
    d.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)], fill=fill)

def diamond(d, cx, cy, rx, ry, fill):
    d.polygon([(cx, cy - ry), (cx + rx, cy), (cx, cy + ry), (cx - rx, cy)], fill=fill)

def flourish(d, cx, cy, s, sx, sy, col, w):
    """corner flourish: scroll curls + dots. (sx,sy)=+-1 orientation, drawn into corner at (cx,cy)"""
    def P(x, y): return (cx + sx * x * s, cy + sy * y * s)
    for (r, a0, a1, ox, oy) in [(0.55, 180, 450, 0.75, 0.75), (0.32, 0, 300, 1.75, 0.45), (0.32, 0, 300, 0.45, 1.75)]:
        pts = [P(ox + r * math.cos(math.radians(a)), oy + r * math.sin(math.radians(a))) for a in np.linspace(a0, a1, 40)]
        d.line(pts, fill=col, width=w, joint='curve')
    d.line([P(0.2, 2.6), P(0.2, 0.2), P(2.6, 0.2)], fill=col, width=w)
    for (x, y) in [(2.55, 0.85), (0.85, 2.55), (1.25, 1.25)]:
        rr = s * 0.09; X, Y = P(x, y); d.ellipse([X - rr, Y - rr, X + rr, Y + rr], fill=col)

def draw_frame(img, inset_frac=0.045, line_frac=0.0042, border_frac=0.05, fill=(16, 13, 12, 255), corner=True, side_diamonds=True, top_band=None):
    """opaque outer border (covers blurry old frame + any table edge in the crop), crisp gold line, corner flourishes."""
    W, H = img.size
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    b = border_frac * W * S
    d.rectangle([0, 0, W * S, b], fill=fill); d.rectangle([0, H * S - b, W * S, H * S], fill=fill)
    d.rectangle([0, 0, b, H * S], fill=fill); d.rectangle([W * S - b, 0, W * S, H * S], fill=fill)
    if top_band: d.rectangle([0, 0, W * S, top_band * H * S], fill=fill)
    # soft inner shadow
    L = L.resize(img.size, Image.LANCZOS)
    sh = Image.new('L', img.size, 0); sd = ImageDraw.Draw(sh)
    bb = int(border_frac * W)
    sd.rectangle([0, 0, W, H], fill=200); sd.rectangle([bb + 4, (int(top_band * H) if top_band else bb) + 4, W - bb - 4, H - bb - 4], fill=0)
    sh = sh.filter(ImageFilter.GaussianBlur(W * 0.018))
    shade = Image.new('RGBA', img.size, (0, 0, 0, 0)); shade.putalpha(sh)
    img.alpha_composite(shade); img.alpha_composite(L)
    # gold lines
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    i = inset_frac * W * S; lw = max(2, int(line_frac * W * S))
    top = (top_band * H * S) if top_band else i
    d.rectangle([i, top, W * S - i, H * S - i], outline=GOLD + (255,), width=lw)
    if side_diamonds:
        for x in (i + lw / 2, W * S - i - lw / 2):
            diamond(d, x, H * S * 0.47, W * S * 0.011, W * S * 0.022, GOLD + (255,))
    if corner:
        s = W * S * 0.032
        for (cx, cy, sx, sy) in [(i, H * S - i, 1, -1), (W * S - i, H * S - i, -1, -1)]:
            flourish(d, cx + sx * lw, cy + sy * lw, s, sx, sy, GOLD + (255,), lw)
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))

def medallion(img, cx, cy, r, school, sparkles=True):
    W = img.size[0]
    halo = Image.new('RGBA', img.size, (0, 0, 0, 0)); hd = ImageDraw.Draw(halo)
    hd.ellipse([cx - r * 1.22, cy - r * 1.22, cx + r * 1.22, cy + r * 1.22], fill=(12, 10, 9, 255))
    halo = halo.filter(ImageFilter.GaussianBlur(r * 0.12)); img.alpha_composite(halo)
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    d.ellipse([(cx - r * 1.08) * S, (cy - r * 1.08) * S, (cx + r * 1.08) * S, (cy + r * 1.08) * S], outline=GOLD + (255,), width=int(r * 0.05 * S))
    if sparkles:
        for (dx, dy, rr) in [(-1.05, -1.0, .2), (-0.7, -1.32, .13), (1.25, 0.75, .16), (1.0, 1.15, .11)]:
            sparkle(d, (cx + dx * r) * S, (cy + dy * r) * S, rr * r * S, GOLD + (255,))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    ic = school_icon(school, int(r * 2)); img.alpha_composite(ic, (int(cx - r), int(cy - r)))

def reagent_disc(img, cx, cy, r, reagent):
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=(20, 17, 16, 255), outline=GOLD + (255,), width=int(r * 0.07 * S))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    ic = reagent_icon(reagent, int(r * 1.45)); img.alpha_composite(ic, (int(cx - ic.width / 2), int(cy - ic.height / 2)))

def radial_disc(img, cx, cy, r, inner, outer, ring=GOLD, ring_w=0.09):
    S = 3; n = int(r * 2 * S)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    rr = np.sqrt((xx + 0.25) ** 2 + (yy + 0.3) ** 2) / 1.3
    t = np.clip(rr, 0, 1)[..., None]
    col = (np.array(inner) * (1 - t) + np.array(outer) * t).astype(np.uint8)
    disc = Image.fromarray(col).convert('RGBA')
    m = Image.new('L', (n, n), 0); ImageDraw.Draw(m).ellipse([0, 0, n - 1, n - 1], fill=255); disc.putalpha(m)
    rg = Image.new('RGBA', (n, n), (0, 0, 0, 0)); ImageDraw.Draw(rg).ellipse([0, 0, n - 1, n - 1], outline=ring + (255,), width=int(n * ring_w / 2))
    disc.alpha_composite(rg)
    disc = disc.resize((int(r * 2), int(r * 2)), Image.LANCZOS)
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse([cx - r, cy - r + r * .08, cx + r, cy + r + r * .08], fill=(0, 0, 0, 170))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(r * .12)))
    img.alpha_composite(disc, (int(cx - r), int(cy - r)))

def mana_coin(img, cx, cy, r, value):
    radial_disc(img, cx, cy, r, (178, 220, 255), (30, 86, 170), ring=(235, 240, 250))
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    d.ellipse([(cx - r * 1.06) * S, (cy - r * 1.06) * S, (cx + r * 1.06) * S, (cy + r * 1.06) * S], outline=GOLD + (255,), width=int(r * .06 * S))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    f = font('sans_blk', r * (1.3 if len(str(value)) == 1 else 1.08))
    ImageDraw.Draw(img).text((cx, cy + r * 0.04), str(value), font=f, fill=(16, 34, 78), anchor='mm', stroke_width=max(1, int(r * .03)), stroke_fill=(16, 34, 78))

def gold_coin(img, cx, cy, r, value=None):
    radial_disc(img, cx, cy, r, (255, 214, 120), (205, 112, 18), ring=(120, 66, 12), ring_w=0.08)
    if value is not None:
        f = font('sans_blk', r * 1.35)
        ImageDraw.Draw(img).text((cx, cy + r * 0.02), str(value), font=f, fill=(58, 30, 8), anchor='mm')

def vertical_label(img, x, y_top, text, size, fill=CREAM):
    """school name running down the right edge, reading top-to-bottom (as printed)"""
    f = font('sc_b', size)
    tw = int(f.getlength(text) + size * 0.4 * len(text)); th = int(size * 1.4)
    L = Image.new('RGBA', (tw + 20, th + 20), (0, 0, 0, 0))
    xx = 10
    for ch in text:
        ImageDraw.Draw(L).text((xx, 10 + th / 2), ch, font=f, fill=fill + (255,), anchor='lm'); xx += f.getlength(ch) + size * 0.18
    L = L.crop(L.getbbox()).rotate(-90, expand=True, resample=Image.BICUBIC)
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    pad = int(size * .35)
    ImageDraw.Draw(sh).rounded_rectangle([x - L.width / 2 - pad, y_top - pad, x + L.width / 2 + pad, y_top + L.height + pad], radius=pad, fill=(0, 0, 0, 150))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(pad * .8)))
    img.alpha_composite(L, (int(x - L.width / 2), int(y_top)))
    return L.height

# ---------------------------------------------------------------- photo cleanup
def text_mask(rgb, boxes, thr=38, dil=4):
    """mask light printed text/ornament pixels inside boxes (fractions of the image)."""
    H, W = rgb.shape[:2]
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    bg = cv2.medianBlur(g.astype(np.uint8), 31).astype(np.float32)
    m = np.zeros((H, W), np.uint8)
    for (x0, y0, x1, y1) in boxes:
        X0, Y0, X1, Y1 = int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)
        sub = ((g[Y0:Y1, X0:X1] - bg[Y0:Y1, X0:X1]) > thr)
        m[Y0:Y1, X0:X1] = np.maximum(m[Y0:Y1, X0:X1], sub.astype(np.uint8) * 255)
    return cv2.dilate(m, np.ones((dil * 2 + 1, dil * 2 + 1), np.uint8))

def deglare(rgb, strength=1.0, clahe=1.4):
    """Remove phone glare from the art.
    Glare on these linen-finish cards has two parts: (a) a smooth whitish veil, (b) bright specular
    speckle on the linen ridges. (b) is removed with a grey-scale morphological opening blended in
    where the veil is strong; (a) is estimated from the smoothed dark channel and subtracted as an
    additive white veil. Then gentle CLAHE + saturation lift."""
    I = rgb.astype(np.float32) / 255.
    H, W = I.shape[:2]
    dark = cv2.erode(I.min(2), np.ones((15, 15), np.uint8))
    veil = cv2.GaussianBlur(dark, (0, 0), max(H, W) / 40)
    base = np.percentile(veil, 5)              # the card's own darkest level isn't glare
    v = np.clip((veil - base) * strength, 0, 0.6)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(I, cv2.MORPH_OPEN, k)
    opened = cv2.GaussianBlur(opened, (0, 0), 0.8)
    wsp = np.clip(v / 0.25, 0, 1)[..., None] * 0.85
    I = I * (1 - wsp) + opened * wsp
    v = v[..., None]
    J = np.clip((I - v) / (1 - v + 1e-3), 0, 1)
    J8 = (J * 255).astype(np.uint8)
    J8 = cv2.fastNlMeansDenoisingColored(J8, None, 3, 3, 5, 15)
    lab = cv2.cvtColor(J8, cv2.COLOR_RGB2LAB)
    cl = cv2.createCLAHE(clipLimit=clahe, tileGridSize=(6, 6))
    lab[..., 0] = cl.apply(lab[..., 0])
    J = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    hsv = cv2.cvtColor(J, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.12, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)

_sess = None
def sr_upscale(rgb, out_size, use_sr=True):
    if use_sr and os.path.exists(MODEL):
        global _sess
        import onnxruntime as ort
        if _sess is None: _sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
        H, W = rgb.shape[:2]; T = 256; P = 12
        out = np.zeros((H * 4, W * 4, 3), np.float32)
        x = rgb.astype(np.float32) / 255.
        for y0 in range(0, H, T):
            for x0 in range(0, W, T):
                ya, xa = max(0, y0 - P), max(0, x0 - P); yb, xb = min(H, y0 + T + P), min(W, x0 + T + P)
                tile = x[ya:yb, xa:xb].transpose(2, 0, 1)[None]
                o = _sess.run(None, {'input': tile})[0][0].transpose(1, 2, 0)
                oy, ox = (y0 - ya) * 4, (x0 - xa) * 4
                h, w = min(T, H - y0) * 4, min(T, W - x0) * 4
                out[y0 * 4:y0 * 4 + h, x0 * 4:x0 * 4 + w] = o[oy:oy + h, ox:ox + w]
        big = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
        return big.resize(out_size, Image.LANCZOS)
    im = Image.fromarray(rgb).resize(out_size, Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))

def cover_crop(im, size):
    """scale+center-crop PIL image to exactly fill size"""
    tw, th = size; s = max(tw / im.width, th / im.height)
    im = im.resize((max(tw, round(im.width * s)), max(th, round(im.height * s))), Image.LANCZOS)
    x0, y0 = (im.width - tw) // 2, (im.height - th) // 2
    return im.crop((x0, y0, x0 + tw, y0 + th))

# ---------------------------------------------------------------- art source selection
# Every tier of a tower (4) / familiar (5) shares one illustration, so there are only 21 unique
# illustrations (7 wizards, 7 towers, 7 familiars). For each one we take the cleanest photo we have:
#   1. an explicit override below (e.g. the glare-free single-card phone shots on the wood table), else
#   2. the tier crop with the lowest glare score.
ART_OVERRIDE = {
    ('familiar', 'Corvum'): {'file': 'Familiar_Corvum.jpg', 'rectify': 'wood'},
    ('familiar', 'Bufonem'): {'file': 'Familiar_Bufonem.jpg', 'rectify': 'wood'},     # auto-quad needs checking
    ('tower', 'Obsidian Fortress'): {'file': 'Tower_Obsidian_Fortress.jpg', 'rectify': 'wood'},
    # ('tower', 'Vermillion Citadel'): raw shot exists but auto-quad fails at the BR corner; add 'quad': [...] to use it
}

# Illustrations that local processing can't rescue (one photo only, heavy glare on the linen texture):
# an AI repaint of the ILLUSTRATION ONLY (GenerateImage, photo + processed crop as references, no text)
# saved in enhanced/_art/. Text/frame/icons are still drawn by this script. Set USE_REPAINT=False to ignore.
ART_REPAINT = {
    ('wizard', 'Anguis Magicus'): '_art/Wizard_Anguis_Magicus_repaint.jpg',
    ('wizard', 'Bufonem Creaturae'): '_art/Wizard_Bufonem_Creaturae_repaint.jpg',
    ('wizard', 'Lacerta Arborus'): '_art/Wizard_Lacerta_Arborus_repaint.jpg',
    ('wizard', 'Reptilius Venenum'): '_art/Wizard_Reptilius_Venenum_repaint.jpg',
    ('wizard', 'Serpentium Machinus'): '_art/Wizard_Serpentium_Machinus_repaint.jpg',
    ('wizard', 'Draco Mortemus'): '_art/Wizard_Draco_Mortemus_repaint.jpg',
    ('familiar', 'Aranea'): '_art/Familiar_Aranea_repaint.jpg',
    ('familiar', 'Imp'): '_art/Familiar_Imp_repaint.jpg',
    ('familiar', 'Troglodytam'): '_art/Familiar_Troglodytam_repaint.jpg',
    ('dungeon', 'Dagger'): '_art/Dungeon_Dagger_repaint.jpg',
    ('dungeon', 'Diamonds'): '_art/Dungeon_Diamonds_repaint.jpg',
    ('dungeon', 'Idol'): '_art/Dungeon_Idol_repaint.jpg',
    ('dungeon', 'Rubies'): '_art/Dungeon_Rubies_repaint.jpg',
    ('dungeon', 'Bugbear'): '_art/Dungeon_Monster_Bugbear_repaint.jpg',
    ('dungeon', 'Ghoul'): '_art/Dungeon_Monster_Ghoul_repaint.jpg',
    ('dungeon', 'Giant'): '_art/Dungeon_Monster_Giant_repaint.jpg',
    ('dungeon', 'Golem'): '_art/Dungeon_Monster_Golem_repaint.jpg',
    ('dungeon', 'Goblin'): '_art/Dungeon_Monster_Goblin_repaint.jpg',
    ('dungeon', 'Manticore'): '_art/Dungeon_Monster_Manticore_repaint.jpg',
    ('dungeon', 'Ogre'): '_art/Dungeon_Monster_Ogre_repaint.jpg',
    ('dungeon', 'Skeleton'): '_art/Dungeon_Monster_Skeleton_repaint.jpg',
    ('dungeon', 'Troll'): '_art/Dungeon_Monster_Troll_repaint.jpg',
}
USE_REPAINT = True

def repaint_art(rel, out_size, use_sr=True):
    rgb = np.asarray(Image.open(f'{OUT}/{rel}').convert('RGB'))
    tw, th = out_size; ar = tw / th; h, w = rgb.shape[:2]
    if w / h > ar: nw = int(h * ar); rgb = rgb[:, (w - nw) // 2:(w - nw) // 2 + nw]
    else: nh = int(w / ar); rgb = rgb[(h - nh) // 2:(h - nh) // 2 + nh]
    rgb = np.ascontiguousarray(rgb)
    lz = Image.fromarray(rgb).resize(out_size, Image.LANCZOS)
    out = Image.blend(lz, sr_upscale(rgb, out_size, True), 0.6) if (use_sr and os.path.exists(MODEL)) else lz
    return out.convert('RGBA')

def get_art(kind, c, path, out_size, use_sr):
    key = (kind, c['kind']) if kind == 'dungeon' and c['kind'] in ('gold', 'trap') else (kind, c['name'])
    rel = ART_REPAINT.get(key)
    if USE_REPAINT and rel and os.path.exists(f'{OUT}/{rel}'):
        ART_LOG[path] = f'AI repaint of illustration only ({rel})'
        return repaint_art(rel, out_size, use_sr)
    src_rgb, ART_LOG[path] = art_source(kind, c, path, DATA)
    return clean_art(src_rgb, WIPE[kind], WINDOW[kind], out_size, use_sr)

def detect_card_quad(rgb):
    """card on Keith's wood table: mask out the orange wood, fill, take the big convex quad (TL,TR,BR,BL)."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    wood = ((hsv[..., 0] >= 3) & (hsv[..., 0] <= 22) & (hsv[..., 1] > 90) & (hsv[..., 2] > 60)).astype(np.uint8)
    card = cv2.morphologyEx((1 - wood) * 255, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cs, _ = cv2.findContours(card, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fill = np.zeros_like(card); cv2.drawContours(fill, [max(cs, key=cv2.contourArea)], -1, 255, -1)
    k = int(min(card.shape) * 0.06) | 1
    fill = cv2.morphologyEx(fill, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    cs, _ = cv2.findContours(fill, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(max(cs, key=cv2.contourArea)); peri = cv2.arcLength(hull, True)
    for eps in np.linspace(0.01, 0.1, 40):
        ap = cv2.approxPolyDP(hull, eps * peri, True)
        if len(ap) == 4: break
    p = ap.reshape(-1, 2).astype(np.float32)
    sm = p.sum(1); df = np.diff(p, axis=1).ravel()
    return np.array([p[np.argmin(sm)], p[np.argmin(df)], p[np.argmax(sm)], p[np.argmax(df)]], np.float32)

def quad_ok(q):
    for i in range(4):
        a, b, c = q[i - 1], q[i], q[(i + 1) % 4]
        v1, v2 = a - b, c - b
        ang = math.degrees(math.acos(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)))
        if abs(ang - 90) > 6: return False
    w = np.linalg.norm(q[1] - q[0]); h = np.linalg.norm(q[3] - q[0])
    return 0.62 < w / h < 0.74

def warp_quad(rgb, q):
    w = int((np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2)
    h = int((np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2)
    M = cv2.getPerspectiveTransform(np.float32(q), np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    return cv2.warpPerspective(rgb, M, (w, h), flags=cv2.INTER_CUBIC)

_gs = {}
def glare_score(path):
    if path in _gs: return _gs[path]
    _gs[path] = _glare_score(path); return _gs[path]

def _glare_score(path):
    a = np.asarray(Image.open(path).convert('RGB').resize((200, 300))).astype(np.float32) / 255
    mx = a.max(2); sat = (mx - a.min(2)) / (mx + 1e-6)
    return float(((mx > 0.6) & (sat < 0.15)).mean())

def art_source(kind, c, path, D):
    """-> (rgb array of a whole card, description)"""
    ov = ART_OVERRIDE.get((kind, c['name']))
    if ov and os.path.exists(f"{A}/{ov['file']}"):
        rgb = np.asarray(Image.open(f"{A}/{ov['file']}").convert('RGB'))
        q = np.float32(ov['quad']) if 'quad' in ov else detect_card_quad(rgb)
        if 'quad' in ov or quad_ok(q):
            return warp_quad(rgb, q), f"override {ov['file']} (rectified)"
    if kind == 'dungeon' and c['kind'] in ('gold', 'trap'):
        sibs = [f for f, (k, cc) in D.items() if k == 'dungeon' and cc['kind'] == c['kind'] and os.path.exists(f'{A}/{f}')]
        best = min(sibs, key=lambda f: glare_score(f'{A}/{f}'))
        return np.asarray(Image.open(f'{A}/{best}').convert('RGB')), f'least-glare shared-art crop {best}'
    if kind in ('tower', 'familiar'):
        sibs = [f for f, (k, cc) in D.items() if k == kind and cc['name'] == c['name'] and os.path.exists(f'{A}/{f}')]
        best = min(sibs, key=lambda f: glare_score(f'{A}/{f}'))
        return np.asarray(Image.open(f'{A}/{best}').convert('RGB')), f'least-glare tier crop {best}'
    return np.asarray(Image.open(path).convert('RGB')), os.path.basename(path)

def clean_art(rgb, wipe_boxes, window, out_size, use_sr=True, glare=1.0, pre_down=0.5, sr_mix=0.7):
    """inpaint old text -> crop to the illustration window -> downsample 2x (averages away the
    card's linen print texture + glare speckle) -> deglare -> crop to aspect -> Real-ESRGAN x4
    (mixed with Lanczos so it doesn't look plastic) -> light unsharp."""
    H, W = rgb.shape[:2]
    m = text_mask(rgb, wipe_boxes)
    if m.any(): rgb = cv2.inpaint(rgb, m, 6, cv2.INPAINT_TELEA)
    x0, y0, x1, y1 = window
    rgb = np.ascontiguousarray(rgb[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)])
    if pre_down and pre_down < 1:
        rgb = cv2.resize(rgb, None, fx=pre_down, fy=pre_down, interpolation=cv2.INTER_AREA)
    rgb = deglare(rgb, glare)
    tw, th = out_size; ar = tw / th; h, w = rgb.shape[:2]
    if w / h > ar: nw = int(h * ar); rgb = rgb[:, (w - nw) // 2:(w - nw) // 2 + nw]
    else: nh = int(w / ar); rgb = rgb[(h - nh) // 2:(h - nh) // 2 + nh]
    rgb = np.ascontiguousarray(rgb)
    lz = Image.fromarray(rgb).resize(out_size, Image.LANCZOS)
    out = Image.blend(lz, sr_upscale(rgb, out_size, True), sr_mix) if (use_sr and os.path.exists(MODEL)) else lz
    return out.filter(ImageFilter.UnsharpMask(radius=max(1, out_size[0] // 600), percent=60, threshold=3)).convert('RGBA')

def art_canvas(W, H, art, rect):
    img = Image.new('RGBA', (W, H), INK + (255,))
    img.alpha_composite(art, (int(rect[0]), int(rect[1])))
    return img

# ---------------------------------------------------------------- per-type builders
# boxes (x0,y0,x1,y1 as fractions) where the photo has printed text/icons to wipe before redraw
WIPE = {   # old vertical school label (light text on the art) gets inpainted away
    'dungeon': [(0.08, 0.0, 0.92, 0.2), (0.08, 0.76, 0.92, 0.95)],   # old title / bottom text
    'wizard': [(0.80, 0.10, 0.99, 0.42)],
    'tower': [(0.80, 0.08, 0.99, 0.42)],
    'familiar': [(0.80, 0.08, 0.99, 0.42)],
}
# illustration window inside the photo crop (fractions): excludes old name, icons, cost row, panel
WINDOW = {
    'dungeon': (0.07, 0.15, 0.93, 0.79),
    'wizard': (0.06, 0.13, 0.93, 0.87),
    'tower': (0.06, 0.14, 0.90, 0.80),
    'familiar': (0.09, 0.135, 0.90, 0.71),
}
BORDER = 0.05
ART_LOG = {}
DATA = {}

def out_size_for(im, scale):
    return (int(round(im.width * scale)), int(round(im.height * scale)))

def build_wizard(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    b = int(BORDER * W); rect = (b, b, W - b, H - b)
    art = get_art('wizard', c, path, (rect[2] - rect[0], rect[3] - rect[1]), use_sr)
    img = art_canvas(W, H, art, rect)
    # bottom name plate gradient
    g = Image.new('L', (1, 256)); g.putdata([int(255 * max(0, (i - 120) / 136) ** 1.4) for i in range(256)])
    g = g.resize((W, int(H * 0.2))); shade = Image.new('RGBA', (W, int(H * 0.2)), INK + (255,)); shade.putalpha(g)
    img.alpha_composite(shade, (0, H - int(H * 0.2)))
    draw_frame(img)
    d = ImageDraw.Draw(img)
    # name banner line + ornament above name
    y_line = H * 0.875
    L, S = ss_layer(img.size); ld = ImageDraw.Draw(L)
    lw = max(2, int(W * 0.0042 * S))
    ld.line([(W * 0.045 * S, y_line * S), (W * 0.40 * S, y_line * S)], fill=GOLD + (255,), width=lw)
    ld.line([(W * 0.60 * S, y_line * S), (W * 0.955 * S, y_line * S)], fill=GOLD + (255,), width=lw)
    for sx in (-1, 1):
        pts = [((W / 2 + sx * W * (0.10 - 0.1 * t)) * S, (y_line - H * 0.012 * math.sin(t * math.pi)) * S) for t in np.linspace(0, 1, 30)]
        ld.line(pts, fill=GOLD + (255,), width=lw)
        ld.ellipse([(W / 2 + sx * W * 0.115 - W * .006) * S, (y_line - W * .006) * S, (W / 2 + sx * W * 0.115 + W * .006) * S, (y_line + W * .006) * S], fill=GOLD + (255,))
    diamond(ld, W / 2 * S, (y_line - H * 0.006) * S, W * .012 * S, W * .018 * S, GOLD + (255,))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    f = fit_font('sans_b', c['name'], W * 0.72, int(W * 0.085))
    shadow_text(img, (W / 2, H * 0.922), c['name'], f)
    reagent_disc(img, W * 0.105, W * 0.105, W * 0.068, c['gather_bonus_reagent'])
    medallion(img, W * 0.865, W * 0.115, W * 0.075, c['school'])
    vertical_label(img, W * 0.915, W * 0.235, c['school'].upper(), int(W * 0.038))
    return img

def build_tower(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    b = int(BORDER * W); rect = (b, int(0.08 * H), W - b, H - b)
    art = get_art('tower', c, path, (rect[2] - rect[0], rect[3] - rect[1]), use_sr)
    img = art_canvas(W, H, art, rect)
    g = Image.new('L', (1, 256)); g.putdata([int(235 * max(0, (i - 60) / 196) ** 1.3) for i in range(256)])
    g = g.resize((W, int(H * 0.26))); shade = Image.new('RGBA', (W, int(H * 0.26)), INK + (255,)); shade.putalpha(g)
    img.alpha_composite(shade, (0, H - int(H * 0.26)))
    tb = 0.085
    draw_frame(img, top_band=tb)
    f = fit_font('sans_b', c['name'], W * 0.66, int(W * 0.075))
    shadow_text(img, (W * 0.47, H * tb * 0.52), c['name'], f)
    medallion(img, W * 0.86, H * tb * 0.62, W * 0.075, c['school'])
    vertical_label(img, W * 0.915, H * tb + W * 0.11, c['school'].upper(), int(W * 0.038))
    # cost row:  N x [reagent]   or   (N gold)
    cy = H * 0.885; fs = int(W * 0.085)
    f = font('sans_b', fs)
    t1 = f"{c['reagent_cost']}x"
    ic = reagent_icon(c['reagent'], int(W * 0.15))
    w_t1 = f.getlength(t1); w_or = f.getlength('or'); r = W * 0.07
    total = w_t1 + W * 0.02 + ic.width + W * 0.06 + w_or + W * 0.06 + 2 * r
    x = W / 2 - total / 2
    shadow_text(img, (x, cy), t1, f, anchor='lm'); x += w_t1 + W * 0.02
    img.alpha_composite(ic, (int(x), int(cy - ic.height / 2))); x += ic.width + W * 0.06
    shadow_text(img, (x, cy), 'or', f, anchor='lm'); x += w_or + W * 0.06
    gold_coin(img, x + r, cy, r, c['gold_cost'])
    return img

def build_familiar(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    b = int(BORDER * W); rect = (b, int(0.08 * H), W - b, int(0.725 * H))
    art = get_art('familiar', c, path, (rect[2] - rect[0], rect[3] - rect[1]), use_sr)
    img = art_canvas(W, H, art, rect)
    tb = 0.085
    draw_frame(img, top_band=tb, side_diamonds=False)
    # bottom ability panel (opaque, replaces the printed panel)
    py0 = H * 0.72; b = W * 0.045
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    d.rectangle([b * S, py0 * S, (W - b) * S, (H - b) * S], fill=(18, 15, 14, 245))
    lw = max(2, int(W * 0.0042 * S))
    d.line([(b * S, py0 * S), ((W - b) * S, py0 * S)], fill=GOLD + (255,), width=lw)
    xm = W * 0.43; ymid = py0 + (H - b - py0) * 0.5
    d.line([(xm * S, (py0 + H * .02) * S), (xm * S, (H - b - H * .02) * S)], fill=GOLD + (255,), width=lw)
    d.line([((b + W * .04) * S, ymid * S), ((W - b - W * .04) * S, ymid * S)], fill=GOLD + (200,), width=max(1, lw // 2))
    diamond(d, xm * S, ymid * S, W * .012 * S, W * .02 * S, GOLD + (255,))
    for x in (b, W - b): diamond(d, x * S, py0 * S, W * .011 * S, W * .02 * S, GOLD + (255,))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    # shadow over art above the panel
    g = Image.new('L', (1, 64)); g.putdata([int(200 * (i / 63) ** 2) for i in range(64)])
    g = g.resize((W, int(H * 0.05))); sh = Image.new('RGBA', g.size, INK + (255,)); sh.putalpha(g)
    img.alpha_composite(sh, (0, int(py0 - H * 0.05)))
    # parse text: "New Research | Collect N R & Cast Spells || Enter the Dungeon | 1 Gold / X Card"
    rows = [r.split(' | ') for r in c['text'].split(' || ')]
    fl = font('sans_m', int(W * 0.058)); fr = font('sans_m', int(W * 0.056))
    lh = W * 0.066
    for i, (left, right) in enumerate(rows):
        cy = py0 + (H - b - py0) * (0.25 + 0.5 * i)
        ll = wrap(left, fl, xm - b - W * 0.06)
        for j, ln in enumerate(ll):
            shadow_text(img, ((b + xm) / 2, cy + (j - (len(ll) - 1) / 2) * lh), ln, fl)
        # right column with inline icon
        rx0 = xm + W * 0.035; rmax = W - b - W * 0.03 - rx0
        m = re.match(r'Collect (\d+) (.+?) & Cast Spells', right)
        g2 = re.match(r'(\d+) Gold / (.+)', right)
        if m:
            n, reag = m.group(1), m.group(2)
            seg = [('t', f'Collect {n} '), ('t', reag), ('i', reag)]
            line2 = '& Cast Spells'
        elif g2:
            seg = [('t', f'{g2.group(1)} Gold '), ('c', None)]
            line2 = f'/ {g2.group(2)}'
        else:
            seg = [('t', right)]; line2 = ''
        ich = int(W * 0.06); f1 = fr
        while True:  # shrink line 1 until text + icon fit inside the cell with margin
            widths = [f1.getlength(s) if k == 't' else (reagent_icon(s, ich).width + W * .02 if k == 'i' else ich + W * .02) for k, s in seg]
            if sum(widths) <= rmax * 0.92 or f1.size <= fr.size * 0.7: break
            f1 = font('sans_m', f1.size - 2); ich = max(int(W * 0.045), int(ich * 0.97))
        cx = rx0 + rmax / 2; y1 = cy - lh / 2 if line2 else cy
        x = cx - sum(widths) / 2
        for (k, s), wdt in zip(seg, widths):
            if k == 't': shadow_text(img, (x, y1), s, f1, anchor='lm')
            elif k == 'i':
                ic = reagent_icon(s, ich); img.alpha_composite(ic, (int(x + W * .012), int(y1 - ic.height / 2)))
            else: gold_coin(img, x + W * .012 + ich / 2, y1, ich / 2)
            x += wdt
        if line2: shadow_text(img, (cx, cy + lh / 2), line2, fit_font('sans_m', line2, rmax, fr.size))
    f = fit_font('sans_b', c['name'], W * 0.5, int(W * 0.075))
    shadow_text(img, (W * 0.5, H * tb * 0.52), c['name'], f)
    mana_coin(img, W * 0.13, H * tb * 0.62, W * 0.07, c['cost_mana'])
    medallion(img, W * 0.865, H * tb * 0.62, W * 0.075, c['school'])
    vertical_label(img, W * 0.915, H * tb + W * 0.11, c['school'].upper(), int(W * 0.038))
    return img

def _bg_texture(name, size, crop):
    im = Image.open(f'{OUT}/_textures/{name}').convert('RGB')
    w, h = im.size
    x0, y0, x1, y1 = crop(w, h)
    return im.crop((x0, y0, x1, y1)).resize(size, Image.LANCZOS).convert('RGBA')

def ongoing_icon(img, cx, cy, r, col=(196, 30, 30)):
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L); w = int(r * 0.26 * S)
    for a0 in (20, 200):
        d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], a0, a0 + 130, fill=col + (255,), width=w)
        a = math.radians(a0 + 130); tx, ty = cx + r * math.cos(a), cy + r * math.sin(a)
        dx, dy = -math.sin(a), math.cos(a); nx, ny = math.cos(a), math.sin(a); k = r * 0.38
        d.polygon([((tx + dx * k) * S, (ty + dy * k) * S), ((tx + nx * k) * S, (ty + ny * k) * S), ((tx - nx * k) * S, (ty - ny * k) * S)], fill=col + (255,))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))

def spell_reagent_list(c):
    out = []
    for k, v in c['cast_cost_reagents'].items():
        if isinstance(v, int): out += [k] * v
        else: out += [('X', k)]
    return out

def build_spell(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    img = _bg_texture('spell_bg_raw.jpg', (W, H), lambda w, h: (0, int(h * 0.075), w, int(h * 0.075 + w * H / W)))
    draw_frame(img, inset_frac=0.04, border_frac=0.045, fill=(26, 18, 12, 255), side_diamonds=True)
    # title plank
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    d.rounded_rectangle([W * .17 * S, H * .03 * S, W * .80 * S, H * .095 * S], radius=int(W * .03 * S), fill=(30, 22, 16, 235), outline=GOLD_D + (255,), width=int(W * .004 * S))
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    f = fit_font('sans_b', c['name'], W * 0.55, int(W * 0.075))
    shadow_text(img, (W * 0.485, H * 0.063), c['name'], f)
    mana_coin(img, W * 0.115, H * 0.068, W * 0.075, c['mana_cost'])
    sch = c['school']
    if sch in SCHOOLS: medallion(img, W * 0.875, H * 0.068, W * 0.075, sch)
    else:
        radial_disc(img, W * 0.875, H * 0.068, W * 0.075, (255, 240, 200), (200, 170, 110))
        ImageDraw.Draw(img).text((W * 0.875, H * 0.07), '?', font=font('deco_blk', W * 0.1), fill=(40, 28, 12), anchor='mm')
    vertical_label(img, W * 0.935, H * 0.15, c.get('school_side_label', sch).upper(), int(W * 0.036))
    # scroll text
    tx0, tx1 = W * 0.15, W * 0.80; cxm = (tx0 + tx1) / 2
    fl = fit_font('serif_i', c['latin_subtitle'], tx1 - tx0, int(W * 0.062), var=700)
    ImageDraw.Draw(img).text((cxm, H * 0.215), c['latin_subtitle'], font=fl, fill=(140, 28, 24), anchor='mm')
    eff = c['effect']; note = None
    if 'Note:' in eff: eff, note = [s.strip() for s in eff.split('Note:', 1)]
    size = int(W * 0.08)
    while True:
        fe = font('serif', size, 700); lines = wrap(eff, fe, tx1 - tx0)
        if len(lines) * size * 1.2 <= H * (0.25 if note else 0.3) or size < W * 0.04: break
        size -= 1
    y = H * 0.255 + (H * 0.3 - len(lines) * size * 1.2) / 2 + size * 0.6
    if note: y -= H * 0.03
    for ln in lines:
        ImageDraw.Draw(img).text((cxm, y), ln, font=fe, fill=(52, 30, 12), anchor='mm'); y += size * 1.2
    if note:
        fn = font('serif_i', int(W * 0.038), 500)
        for ln in wrap('Note: ' + note, fn, tx1 - tx0 - W * .05):
            ImageDraw.Draw(img).text((cxm, y), ln, font=fn, fill=(70, 44, 22), anchor='mm'); y += W * 0.042
    if c['duration'].startswith('One-Time'):
        ImageDraw.Draw(img).text((cxm, H * 0.625), '1x', font=font('sans_blk', W * 0.15), fill=(186, 26, 26), anchor='mm')
    else:
        ongoing_icon(img, cxm, H * 0.625, W * 0.07)
    # cast cost row
    items = spell_reagent_list(c)
    n = len(items); slot = min(W * 0.2, W * 0.8 / max(1, n)); ih = int(min(W * 0.16, slot * 0.9))
    x = W / 2 - slot * n / 2 + slot / 2; cy = H * 0.855
    for it in items:
        if isinstance(it, tuple):
            shadow_text(img, (x - slot * .05, cy), 'X', font('sans_blk', ih * 0.8), fill=CREAM); x += slot * 0.6
            it = it[1]
        ic = reagent_icon(it, ih)
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse([x - ih * .55, cy - ih * .45, x + ih * .55, cy + ih * .55], fill=(0, 0, 0, 120))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(ih * .15)))
        img.alpha_composite(ic, (int(x - ic.width / 2), int(cy - ic.height / 2))); x += slot
    if c.get('gotcha_star'):
        L, S = ss_layer(img.size); d = ImageDraw.Draw(L); R = W * 0.03
        pts = [(W / 2 + R * (1 if k % 2 == 0 else .45) * math.sin(k * math.pi / 5), H * 0.962 - R * (1 if k % 2 == 0 else .45) * math.cos(k * math.pi / 5)) for k in range(10)]
        d.polygon([(px * S, py * S) for px, py in pts], fill=GOLD + (255,))
        img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    return img

def icon_grid(img, names, box, ih):
    """lay out reagent icons in tidy rows inside box"""
    x0, y0, x1, y1 = box; n = len(names)
    rows = {1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3]}.get(n, [math.ceil(n / 2), n // 2])
    k = 0; rh = (y1 - y0) / len(rows)
    for ri, cnt in enumerate(rows):
        cy = y0 + rh * (ri + 0.5); cw = (x1 - x0) / max(rows)
        sx = (x0 + x1) / 2 - cw * cnt / 2 + cw / 2
        for j in range(cnt):
            ic = reagent_icon(names[k], ih); k += 1
            cx = sx + j * cw
            sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh).ellipse([cx - ic.width * .5, cy - ic.height * .35 + ih * .08, cx + ic.width * .5, cy + ic.height * .5 + ih * .08], fill=(0, 0, 0, 140))
            img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(ih * .12)))
            img.alpha_composite(ic, (int(cx - ic.width / 2), int(cy - ic.height / 2)))

def build_reagent(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    img = _bg_texture('reagent_bg_raw.jpg', (W, H), lambda w, h: (0, 0, w, h))
    # header plates sit on the panels: red panel ~ y .04-.47, blue ~ .54-.97 of the texture
    for (yh, text) in [(0.085, c.get('gather_reagents_header', 'GATHER REAGENTS')), (0.585, c.get('increase_value_header', 'INCREASE VALUE'))]:
        f = fit_font('deco', text.title(), W * 0.7, int(W * 0.07))
        shadow_text(img, (W / 2, H * yh), text.title(), f, fill=(250, 244, 230))
    ih = int(W * 0.23)
    icon_grid(img, c['gather_icons_in_print_order'], (W * 0.1, H * 0.12, W * 0.9, H * 0.45), ih)
    icon_grid(img, c['increase_icons_in_print_order'], (W * 0.1, H * 0.62, W * 0.9, H * 0.95), ih)
    return img

# ---------------------------------------------------------------- dungeon cards
def cobweb(d, cx, cy, s, sx, sy, col, w):
    """corner cobweb: radials + sagging arcs, anchored in a corner"""
    rads = [0, 22.5, 45, 67.5, 90]
    for a in rads:
        r = math.radians(a)
        d.line([(cx, cy), (cx + sx * s * math.cos(r), cy + sy * s * math.sin(r))], fill=col, width=w)
    for k in (0.35, 0.62, 0.9):
        pts = []
        for i in range(len(rads) - 1):
            for t in np.linspace(0, 1, 8):
                a = math.radians(rads[i] + (rads[i + 1] - rads[i]) * t)
                rr = s * k * (1 - 0.12 * math.sin(t * math.pi))
                pts.append((cx + sx * rr * math.cos(a), cy + sy * rr * math.sin(a)))
        d.line(pts, fill=col, width=max(1, w * 2 // 3))

def gem_corner(d, cx, cy, s, sx, sy, col, w):
    """faceted diamond outline in the corner"""
    P = lambda x, y: (cx + sx * x * s, cy + sy * y * s)
    top = [P(.2, .45), P(.45, .2), P(.8, .2), P(.95, .45)]
    d.line(top + [P(.55, .95), P(.2, .45)], fill=col, width=w, joint='curve')
    d.line([P(.2, .45), P(.95, .45)], fill=col, width=max(1, w * 2 // 3))
    for x in (.45, .8): d.line([P(x, .2), P(.55, .45), P(.55, .95)] if x == .45 else [P(x, .2), P(.62, .45)], fill=col, width=max(1, w * 2 // 3))
    d.line([P(.62, .45), P(.55, .95)], fill=col, width=max(1, w * 2 // 3))

def crown(d, cx, cy, s, col):
    d.polygon([(cx - s, cy + s * .55), (cx - s, cy - s * .2), (cx - s * .5, cy + s * .15), (cx, cy - s * .55),
               (cx + s * .5, cy + s * .15), (cx + s, cy - s * .2), (cx + s, cy + s * .55)], fill=col)

def padlock(d, cx, cy, s, col, bg, w):
    d.arc([cx - s * .55, cy - s * 1.25, cx + s * .55, cy - s * .15], 180, 360, fill=col, width=w)
    d.line([(cx - s * .55, cy - s * .7), (cx - s * .55, cy - s * .3)], fill=col, width=w)
    d.line([(cx + s * .55, cy - s * .7), (cx + s * .55, cy - s * .3)], fill=col, width=w)
    d.polygon([(cx - s * .9, cy - s * .35), (cx + s * .9, cy - s * .35), (cx + s * .9, cy + s * .55), (cx, cy + s * 1.0), (cx - s * .9, cy + s * .55)], fill=bg, outline=col, width=w)
    d.ellipse([cx - s * .16, cy - s * .1, cx + s * .16, cy + s * .22], fill=col)
    d.line([(cx, cy + s * .15), (cx, cy + s * .5)], fill=col, width=w)

def scroll_orn(d, cx, cy, s, col, w):
    for sx in (-1, 1):
        pts = [(cx + sx * s * t, cy - s * .18 * math.sin(t * math.pi * 2)) for t in np.linspace(0, 1, 40)]
        d.line(pts, fill=col, width=w)
        d.ellipse([cx + sx * s - s * .07, cy - s * .07, cx + sx * s + s * .07, cy + s * .07], fill=col)
    diamond(d, cx, cy, s * .09, s * .14, col)

def build_dungeon(path, c, scale, use_sr):
    src = Image.open(path); W, H = out_size_for(src, scale)
    bg = (22, 17, 14)
    rect = (int(W * 0.05), int(H * 0.115), W - int(W * 0.05), int(H * 0.80))
    art = get_art('dungeon', c, path, (rect[2] - rect[0], rect[3] - rect[1]), use_sr)
    # soft vignette so the art melts into the dark card like the print
    aw, ah = art.size
    m = Image.new('L', (aw, ah), 0); md = ImageDraw.Draw(m)
    md.rounded_rectangle([aw * .04, ah * .05, aw * .96, ah * .95], radius=int(aw * .08), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(aw * .035))
    art.putalpha(ImageChops.multiply(art.split()[-1], m))
    img = Image.new('RGBA', (W, H), bg + (255,))
    # faint stone/grain on the card body
    noise = (np.random.default_rng(7).normal(0, 6, (H // 4, W // 4))).astype(np.int16)
    n = Image.fromarray(np.clip(128 + noise, 0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    img = Image.blend(img, Image.merge('RGBA', (n, n, n, Image.new('L', (W, H), 255))), 0.05)
    img.alpha_composite(art, rect[:2])
    # frame
    L, S = ss_layer(img.size); d = ImageDraw.Draw(L)
    col = GOLD + (255,); lw = max(2, int(W * 0.004 * S)); i = W * 0.045 * S
    d.rectangle([i, i, W * S - i, H * S - i], outline=col, width=lw)
    yt = H * 0.105 * S; yb = H * 0.895 * S
    if c['corner'] == 'cobweb':
        for (cx, cy, sx, sy) in [(i, i, 1, 1), (W * S - i, i, -1, 1), (i, H * S - i, 1, -1), (W * S - i, H * S - i, -1, -1)]:
            cobweb(d, cx, cy, W * 0.085 * S, sx, sy, col, lw)
    else:
        for (cx, cy, sx, sy) in [(i, i, 1, 1), (W * S - i, i, -1, 1), (i, H * S - i, 1, -1), (W * S - i, H * S - i, -1, -1)]:
            gem_corner(d, cx + sx * W * .012 * S, cy + sy * W * .012 * S, W * 0.075 * S, sx, sy, col, lw)
    if c.get('top_emblem') == 'crown':
        crown(d, W / 2 * S, (i + H * .002 * S), W * 0.03 * S, col)
    d.line([(i + W * .14 * S, yb), (W * S / 2 - W * .07 * S, yb)], fill=col, width=lw)
    d.line([(W * S / 2 + W * .07 * S, yb), (W * S - i - W * .14 * S, yb)], fill=col, width=lw)
    if c.get('bottom_emblem') == 'padlock':
        padlock(d, W / 2 * S, yb, W * 0.04 * S, col, bg + (255,), lw)
    else:
        scroll_orn(d, W / 2 * S, yb, W * 0.06 * S, col, lw)
    img.alpha_composite(L.resize(img.size, Image.LANCZOS))
    # title
    tcol = {'monster': (240, 178, 64), 'trap': (222, 58, 40)}.get(c['kind'], (232, 200, 130))
    t = c['title'] if c['kind'] != 'trap' else c['title']
    f = fit_font('deco', t, W * 0.74, int(W * 0.085))
    shadow_text(img, (W / 2, H * 0.072), t, f, fill=tcol)
    # bottom line
    fb = fit_font('sans_b', c['bottom_text'], W * 0.78, int(W * 0.08))
    shadow_text(img, (W / 2, H * 0.84), c['bottom_text'], fb)
    return img

BUILDERS = {'dungeon': build_dungeon, 'wizard': build_wizard, 'tower': build_tower, 'familiar': build_familiar, 'spell': build_spell, 'reagent': build_reagent}
PILOT = ['Wizard_Anguis_Magicus.jpg', 'Tower_T2_Vermillion_Citadel.jpg', 'Familiar_10_Corvum.jpg', 'Spell_Evolve.jpg', 'Reagent_03.jpg']

def build(fn, D, scale=2.4, use_sr=True):
    kind, c = D[fn]
    sc = 3.0 if kind == 'spell' else scale
    img = BUILDERS[kind](f'{A}/{fn}', c, sc, use_sr)
    os.makedirs(OUT, exist_ok=True)
    img.convert('RGB').save(f'{OUT}/{fn}', quality=93)
    return f'{OUT}/{fn}'

def comparison(files, out=f'{OUT}/pilot_before_after.jpg', card_h=820, extra=None):
    """two rows: originals on top (BEFORE), enhanced underneath (AFTER), one column per card.
    Main sheet = originals left, enhanced right (one row per card); a compact 2-row grid
    version is written alongside as *_grid.jpg."""
    def load(p):
        im = Image.open(p).convert('RGB'); return im.resize((int(im.width * card_h / im.height), card_h), Image.LANCZOS)
    cols = [(fn, load(f'{A}/{fn}'), load(f'{OUT}/{fn}'), Image.open(f'{A}/{fn}').size, Image.open(f'{OUT}/{fn}').size) for fn in files]
    pad, lab, head = 36, 64, 120
    cw = max(max(c[1].width, c[2].width) for c in cols)
    Wt = pad + len(cols) * (cw + pad); Ht = head + 2 * (lab + card_h + pad) + 40
    sheet = Image.new('RGB', (Wt, Ht), (18, 22, 40)); d = ImageDraw.Draw(sheet)
    d.text((Wt / 2, 62), 'Lizard Wizard  -  enhanced graphics pilot', font=font('deco', 54), fill=GOLD, anchor='mm')
    for r, (tag, colr) in enumerate([('BEFORE (photo)', (200, 205, 220)), ('AFTER (enhanced)', GOLD)]):
        y = head + r * (lab + card_h + pad)
        for i, (fn, a, b, sa, sb) in enumerate(cols):
            x = pad + i * (cw + pad); im = a if r == 0 else b; sz = sa if r == 0 else sb
            d.text((x + cw / 2, y + 18), f'{tag}', font=font('sans_b', 30), fill=colr, anchor='mm')
            d.text((x + cw / 2, y + 48), f'{fn}  {sz[0]}x{sz[1]}', font=font('sans_m', 22), fill=colr, anchor='mm')
            sheet.paste(im, (int(x + (cw - im.width) / 2), y + lab))
    sheet.save(out.replace('.jpg', '_grid.jpg'), quality=90)
    # left/right version (the main sheet)
    rows = len(cols); Wl = pad * 3 + cw * 2; Hl = head + rows * (lab + card_h + pad)
    lr = Image.new('RGB', (Wl, Hl), (18, 22, 40)); d = ImageDraw.Draw(lr)
    d.text((Wl / 2, 62), 'Enhanced graphics pilot', font=font('deco', 50), fill=GOLD, anchor='mm')
    for i, (fn, a, b, sa, sb) in enumerate(cols):
        y = head + i * (lab + card_h + pad)
        for j, (im, tag, sz, colr) in enumerate([(a, 'BEFORE', sa, (200, 205, 220)), (b, 'AFTER', sb, GOLD)]):
            x = pad + j * (cw + pad)
            d.text((x + cw / 2, y + 30), f'{tag}  {fn}  {sz[0]}x{sz[1]}', font=font('sans_b', 26), fill=colr, anchor='mm')
            lr.paste(im, (int(x + (cw - im.width) / 2), y + lab))
    lr.save(out, quality=88)
    return out

def contact_sheets(kind, files, cols=4, card_h=640, per_sheet=16, title=None, label=None):
    """labeled phone-readable sheets: assets/enhanced/sheet_<kind>[_N].jpg"""
    outs = []
    chunks = [files[i:i + per_sheet] for i in range(0, len(files), per_sheet)]
    for n, chunk in enumerate(chunks, 1):
        ims = []
        for fn in chunk:
            im = Image.open(f'{OUT}/{fn}').convert('RGB')
            ims.append((fn, im.resize((int(im.width * card_h / im.height), card_h), Image.LANCZOS)))
        cw = max(i.width for _, i in ims); pad = 28; lab = 54; head = 110
        rows = math.ceil(len(ims) / cols)
        Wt = pad + cols * (cw + pad); Ht = head + rows * (card_h + lab + pad)
        sh = Image.new('RGB', (Wt, Ht), (18, 22, 40)); d = ImageDraw.Draw(sh)
        t = title or f'{kind.title()} cards'
        if len(chunks) > 1: t += f'  ({n}/{len(chunks)})'
        d.text((Wt / 2, 58), t, font=font('deco', 52), fill=GOLD, anchor='mm')
        for i, (fn, im) in enumerate(ims):
            x = pad + (i % cols) * (cw + pad); y = head + (i // cols) * (card_h + lab + pad)
            sh.paste(im, (int(x + (cw - im.width) / 2), y))
            txt = label(fn) if label else os.path.splitext(fn)[0]
            f = fit_font('sans_b', txt, cw, 30)
            d.text((x + cw / 2, y + card_h + lab / 2), txt, font=f, fill=CREAM, anchor='mm')
        out = f'{OUT}/sheet_{kind}' + (f'_{n}' if len(chunks) > 1 else '') + '.jpg'
        sh.save(out, quality=86); outs.append(out)
    return outs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pilot', action='store_true'); ap.add_argument('--type'); ap.add_argument('--files', nargs='*')
    ap.add_argument('--scale', type=float, default=2.4); ap.add_argument('--no-sr', action='store_true')
    ap.add_argument('--sheets', action='store_true', help='only (re)build per-type contact sheets')
    a = ap.parse_args()
    D = load_data(); DATA.update(D)
    if a.sheets:
        for k in ['wizard', 'tower', 'familiar', 'spell', 'reagent', 'dungeon']:
            fs = sorted((f for f, (kk, _) in D.items() if kk == k and os.path.exists(f'{OUT}/{f}')), key=lambda f: [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', f)])
            for o in contact_sheets(k, fs, per_sheet=16 if k != 'familiar' else 20, cols=4 if k != 'familiar' else 5): print(o)
        return
    if a.pilot: files = PILOT
    elif a.files: files = a.files
    elif a.type:
        files = sorted(f for f, (k, _) in D.items() if a.type == 'all' or k == a.type)
    else: ap.error('choose --pilot, --type or --files')
    for fn in files:
        if fn not in D: print('no data for', fn, file=sys.stderr); continue
        if not os.path.exists(f'{A}/{fn}'): print('no image for', fn, file=sys.stderr); continue
        out = build(fn, D, a.scale, not a.no_sr)
        print('built', out, '| art:', ART_LOG.get(f'{A}/{fn}', 'rebuilt (no photo art)'), flush=True)
    if a.pilot: print('sheet', comparison(PILOT))

if __name__ == '__main__':
    main()
