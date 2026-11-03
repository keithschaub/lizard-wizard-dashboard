"""4-player screen mockup (laptop landscape 2880x1800). Board + Keith's full mat + 3 opponent strips."""
import sys, json
sys.path.insert(0, '/workspace/lizard-wizard/scripts')
from render_mat import *
from PIL import Image, ImageDraw, ImageFilter

G = R + 'game/'
W, H = 2880, 1800
TOP = 64

# ---------------- late-game board state
board_state = dict(
    tower_face='assets/Tower_T3_Ivory_Spire.jpg', tower_deck=7,
    wiz_face=['assets/Wizard_Bufonem_Creaturae.jpg', 'assets/Wizard_Serpentium_Machinus.jpg'], wiz_deck=4,
    fam_face=['assets/Familiar_20_Vulpes.jpg', 'assets/Familiar_20_Aranea.jpg'], fam_deck=6,
    spell_face=['assets/Spell_Energize.jpg', 'assets/Spell_Scry_Wizard.jpg', 'assets/Spell_Pulsing_Towers.jpg', 'assets/Spell_Wand_Tax.jpg'],
    spell_deck=28, dungeon_deck=33,
    ach=['5 Wizards', None, 'x7 Toadstool', '7 Spells'], ach_claimed={1: 'Keith'},
    prices={'Mandrake': 5, 'Eye of Newt': 3, 'Nightshade': 8, 'Sulphur': 4, 'Foxglove': 7, 'Toadstool': 2, 'Horn': 6})

def deck_back(label, count, w, h, col=(28, 40, 96)):
    k = w / 104
    b = Image.new('RGBA', (int(w), int(h)), col + (255,)); d = ImageDraw.Draw(b)
    for i in range(0, int(w + h), int(10 * k)): d.line([(i, 0), (i - h, h)], fill=tuple(min(255, c + 14) for c in col) + (255,), width=max(1, int(k)))
    d.rounded_rectangle([5 * k, 5 * k, w - 5 * k, h - 5 * k], int(5 * k), outline=(214, 180, 90, 255), width=int(2 * k))
    d.ellipse([w / 2 - 26 * k, h / 2 - 46 * k, w / 2 + 26 * k, h / 2 + 6 * k], outline=(214, 180, 90, 255), width=int(2 * k))
    d.text((w / 2, h / 2 - 20 * k), 'LW', font=cin(18 * k), anchor='mm', fill=(240, 215, 140))
    d.text((w / 2, h / 2 + 24 * k), label, font=cin(10 * k), anchor='mm', fill=(240, 225, 180))
    d.text((w / 2, h / 2 + 42 * k), f'{count} cards', font=sans(11 * k), anchor='mm', fill=(220, 225, 245))
    return b

def render_board(st):
    order = ['Mandrake', 'Eye of Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn']
    import subprocess
    subprocess.run(['python3', R + 'scripts/make_board.py', ','.join(str(st['prices'][n]) for n in order), G + 'board_late'], check=True)
    S = 2; base = Image.open(G + 'board_late.jpg').convert('RGBA')
    bc = Canvas(*base.size); bc.base = base
    CW, CH = 104, 145
    card = lambda p, x, y: bc.image(PATH(p), x * S, y * S, CW * S, CH * S, r=7 * S)
    back = lambda l, n, x, y, col=(28, 40, 96): bc.image(deck_back(l, n, CW * S, CH * S, col), x * S, y * S, CW * S, CH * S, r=7 * S)
    back('Towers', st['tower_deck'], 40, 384); card(st['tower_face'], 154, 384)
    back('Wizards', st['wiz_deck'], 500, 384); card(st['wiz_face'][0], 614, 384); card(st['wiz_face'][1], 728, 384)
    back('Familiars', st['fam_deck'], 24, 578); card(st['fam_face'][0], 138, 578); card(st['fam_face'][1], 252, 578)
    back('Spells', st['spell_deck'], 500, 778, (60, 30, 90))
    for (x, y), s in zip([(614, 620), (728, 620), (614, 778), (728, 778)], st['spell_face']): card(s, x, y)
    back('Dungeon', st['dungeon_deck'], 40, 900, (80, 30, 24))
    for k, t in enumerate(st['ach']):
        x, y, w, h = 722, 50 + k * 72, 112, 64
        if t: ach_tile(bc, x * S, y * S, w * S, h * S, t)
        else:
            bc.text((x + w / 2) * S, (y + 24) * S, 'CLAIMED', sans(12 * S), col=(200, 215, 245))
            bc.text((x + w / 2) * S, (y + 42) * S, 'by ' + st['ach_claimed'][k], sansi(12 * S), col=(170, 190, 230))
    return bc.flush()

# ---------------- players
keith = dict(
    name='Keith', avatar=A + 'Wizard_Draco_Mortemus.jpg', tag='START PLAYER', mana=34, gold=7,
    tokens={'Mandrake': 2, 'Eye of Newt': 0, 'Nightshade': 4, 'Sulphur': 1, 'Foxglove': 0, 'Toadstool': 3, 'Horn': 1},
    hand=[A + 'Reagent_12.jpg', A + 'Reagent_27.jpg', A + 'Reagent_41.jpg'],
    wizards=['Draco Mortemus', 'Draco Mortemus', 'Lacerta Arborus', 'Ignus Fulgorus', 'Anguis Magicus'],
    towers=[['Obsidian Fortress', 3], ['Emerald Stronghold', 2], ['Keep of Elixers', 2]],
    familiars=[['Corvum', 15], ['Nympharum', 10], ['Imp', 20]],
    spells_cast=['Control_Undead', 'Undying', 'Bloom', 'Root_Cellar'], spells_uncast=['Crystal_Ball', 'Mana_Leak'],
    items=['Ring', 'Idol', 'Rubies'], trophies=['Skeleton'], achievements=['5 Necromancy cards'], items_vp=10)
lizwiz = dict(
    name='LizWiz', avatar=A + 'Wizard_Reptilius_Venenum.jpg', mana=22, gold=11, current=True,
    tokens={'Mandrake': 1, 'Eye of Newt': 4, 'Nightshade': 0, 'Sulphur': 3, 'Foxglove': 2, 'Toadstool': 0, 'Horn': 2},
    wizards=['Reptilius Venenum', 'Reptilius Venenum', 'Serpentium Machinus', 'Bufonem Creaturae'],
    towers=[['Keep of Elixers', 3], ['Obelisk of Puzzles', 2], ['Azure Tower', 2], ['Vermillion Citadel', 3]],
    familiars=[['Bufonem', 15], ['Troglodytam', 10]],
    spells_cast=['Master_Alchemist', 'Transform', 'Inexpensive'], spells_uncast=['Swapo'],
    items=['Necklace', 'Emeralds'], achievements=[], items_vp=5)
p3 = dict(
    name='Player 3', avatar=A + 'Wizard_Lacerta_Arborus.jpg', status='Waiting', mana=41, gold=3,
    tokens={'Mandrake': 3, 'Eye of Newt': 1, 'Nightshade': 0, 'Sulphur': 0, 'Foxglove': 1, 'Toadstool': 5, 'Horn': 0},
    wizards=['Lacerta Arborus', 'Ignus Fulgorus'], towers=[['Emerald Stronghold', 3], ['Ivory Spire', 2]],
    familiars=[['Nympharum', 15], ['Aranea', 10], ['Aranea', 15]],
    spells_cast=['Mana_Garden', 'Maximum_Gather', 'Order_of_the_Wand'], spells_uncast=['Earthquake', 'Spirit_Shield'],
    items=['Helm'], achievements=[], items_vp=0)
p4 = dict(
    name='Player 4', avatar=A + 'Wizard_Anguis_Magicus.jpg', status='Waiting', mana=15, gold=9,
    tokens={'Mandrake': 0, 'Eye of Newt': 0, 'Nightshade': 2, 'Sulphur': 1, 'Foxglove': 4, 'Toadstool': 1, 'Horn': 3},
    wizards=['Anguis Magicus', 'Bufonem Creaturae', 'Lacerta Arborus'], towers=[['Azure Tower', 3]],
    familiars=[['Imp', 15], ['Vulpes', 10]],
    spells_cast=['Divination', 'Treasure'], spells_uncast=['Flame_Bolt_S', 'Scry_Tower', 'Mana_Drain'],
    items=['Sword', 'Mask'], trophies=[], achievements=[], items_vp=5)

cv = Canvas(W, H)
bg = Image.open(A + 'board_bg.jpg').convert('RGBA').resize((W, int(W * 1152 / 864)), Image.LANCZOS).crop((0, 300, W, 300 + H))
bg = bg.filter(ImageFilter.GaussianBlur(18))
dark = Image.new('RGBA', (W, H), (6, 10, 30, 215)); cv.base = Image.alpha_composite(bg, dark)

# ---------------- top bar
cv.panel(-10, -10, W + 20, TOP + 10, 0, fill=(6, 10, 30, 235), glow=None, line=(150, 190, 255, 160), lw=1)
cv.text(28, TOP / 2, 'Lizard Wizard', cin(30), 'lm', (240, 230, 200))
pill(cv, 330, 16, 170, 32, 'ROUND 9', fill=(40, 60, 130), col=(235, 240, 255), fs=17)
pill(cv, 512, 16, 250, 32, "LIZWIZ'S TURN", fs=17)
cv.text(790, TOP / 2, 'Last move:', sans(20), 'lm', (255, 225, 150))
cv.text(900, TOP / 2, 'Keith entered the Dungeon with Corvum (15): drew Gold 2, Skeleton (kept with Control Undead, no hit), Rubies, then stopped. +2 Gold, +1 item.', sansr(20), 'lm', TXT)
cv.text(W - 28, TOP / 2, 'Decks: Spells 28  -  Dungeon 33  -  Wizards 4  -  Towers 7  -  Familiars 6', sansr(18), 'rm', MUTED)

# ---------------- regions
MAT_H = 560; GAP = 16
mat_y = H - MAT_H - GAP
area_top = TOP + GAP; area_bot = mat_y - GAP
bh = area_bot - area_top; bw = round(bh * 864 / 1152)
board = render_board(board_state)
cv.image(board, GAP, area_top, bw, bh, r=14)
cv.panel(GAP, area_top, bw, bh, 14, fill=None, glow=GL, line=LN, lw=2)

SW = 560; sx = W - GAP - SW
sh = (bh - 2 * 14) / 3
for i, p in enumerate([lizwiz, p3, p4]):
    render_strip(cv, sx, area_top + i * (sh + 14), SW, sh, p)

# ---------------- middle: actions, card detail, log
mx = GAP + bw + GAP; mw = sx - GAP - mx
ah = 318
cv.panel(mx, area_top, mw, ah, 14, fill=(14, 22, 54, 225))
cv.text(mx + 24, area_top + 32, 'Your Actions', cin(26), 'lm')
cv.text(mx + mw - 24, area_top + 32, 'Waiting for LizWiz ... your buttons unlock on your turn', sansi(19), 'rm', MUTED)
acts = [('1', 'Gather Reagents', 'Play a hand card, take 3 + wizard bonus, cast 1 spell'),
        ('2', 'Convert to Mana', 'Trade one reagent type at its track value'),
        ('3', "Recruit Wizard", "Take a face-up wizard - others may Duel"),
        ('4', 'Research Spell', 'Pay 5 Mana, may cast that spell now'),
        ('5', 'Create a Tower', 'Pay tier x reagent or tier x Gold'),
        ('6', 'Summon Familiar', 'Pay Mana, use it now: score, gather, research or dungeon')]
bwid = (mw - 48 - 2 * 16) / 3; bht = 114
for i, (n, t, sub) in enumerate(acts):
    bx = mx + 24 + (i % 3) * (bwid + 16); by_ = area_top + 66 + (i // 3) * (bht + 14)
    cv.panel(bx, by_, bwid, bht, 12, fill=(24, 36, 84, 200), glow=(120, 180, 255, 120), line=(170, 210, 255, 170), lw=1, gw=4)
    badge(cv, bx + 34, by_ + 38, n, 40)
    cv.text(bx + 66, by_ + 38, t, cin(22), 'lm')
    cv.text(bx + 22, by_ + 84, sub, sansr(17), 'lm', MUTED)

dy = area_top + ah + 16; dh = area_bot - dy
dw = 720
cv.panel(mx, dy, dw, dh, 14, fill=(14, 22, 54, 225))
cv.text(mx + 24, dy + 32, 'Card Detail', cin(26), 'lm')
cv.text(mx + dw - 24, dy + 32, 'tap any card to inspect', sansi(17), 'rm', MUTED)
sp = SPELLS['Control_Undead']
cwid = 360; chh = round(cwid * 585 / 386)
if dy + 64 + chh > dy + dh - 20: chh = dh - 84; cwid = round(chh * 386 / 585)
cv.image(A + 'Spell_Control_Undead.jpg', mx + 24, dy + 64, cwid, chh, r=14)
tx = mx + 24 + cwid + 26; tw = mx + dw - 24 - tx
ty = dy + 76
cv.text(tx, ty, sp['name'], cin(26), 'lm', (255, 236, 190)); ty += 34
cv.text(tx, ty, sp['latin_subtitle'], sansi(18), 'lm', MUTED); ty += 40
for lab, val in [('School', sp['school']), ('Research', f"{sp['mana_cost']} Mana"), ('Duration', sp['duration']), ('Status', 'Cast - in Keith\'s mat')]:
    cv.text(tx, ty, lab, sans(17), 'lm', MUTED); cv.text(tx + 100, ty, val, sans(19), 'lm'); ty += 32
cv.text(tx, ty, 'Cast cost', sans(17), 'lm', MUTED)
for k, (r_, n) in enumerate(sp['cast_cost_reagents'].items()):
    for j in range(n): cv.image(icon_path(r_), tx + 100 + j * 36, ty - 16, 32, 32, r=0, shadow=False)
ty += 44
import textwrap
for ln in textwrap.wrap('Ignore hits from, and take, any Undead card encountered while Dungeon delving: +3 VP for each.', 30):
    cv.text(tx, ty, ln, sansr(19), 'lm'); ty += 26
ty += 14
for ln in ['Keith: 1 Undead trophy = +3 VP', 'Necromancy pair matched = +5 VP', 'Counts toward 5 Necromancy cards']:
    cv.text(tx, ty, '-  ' + ln, sansr(17), 'lm', (255, 225, 150)); ty += 25

lx = mx + dw + 16; lw = mx + mw - lx
cv.panel(lx, dy, lw, dh, 14, fill=(14, 22, 54, 225))
cv.text(lx + 24, dy + 32, 'Game Log', cin(26), 'lm')
log = [('R9', 'LizWiz', 'is choosing an action ...'),
       ('R9', 'Keith', 'Summon Corvum (15 Mana) > Enter the Dungeon: +2 Gold, Skeleton trophy, Rubies'),
       ('R8', 'Player 4', 'Gathered: Foxglove x2, Horn + Sorcery bonus; cast Treasure'),
       ('R8', 'Player 3', 'Converted 5 Toadstool at 7 = 35 Mana (track 7 > 2)'),
       ('R8', 'LizWiz', 'Built Vermillion Citadel tier 3 (2 Gold with Inexpensive)'),
       ('R8', 'Keith', 'Claimed achievement: 5 Necromancy cards (+10 VP)'),
       ('R8', 'Keith', 'Researched Mana Leak (5 Mana), not cast'),
       ('R7', 'Player 4', "Won Wizard's Duel for Lacerta Arborus (bid 9 Mana)"),
       ('R7', 'Player 3', 'Summoned Aranea (15) > Collect 5 Mandrake & cast Order of the Wand'),
       ('R7', 'LizWiz', 'Gathered 3 + 3 bonus, discarded 1 to storage limit 14')]
yy = dy + 74
for i, (r_, who, what) in enumerate(log):
    if yy > dy + dh - 40: break
    col = (255, 225, 150) if who == 'Keith' else TXT
    if i == 0: cv.panel(lx + 14, yy - 22, lw - 28, 44, 8, fill=(240, 200, 110, 40), glow=None, line=(240, 200, 110, 140), lw=1)
    cv.text(lx + 28, yy, r_, sans(16), 'lm', MUTED)
    cv.text(lx + 70, yy, who, sans(19), 'lm', col)
    lines = textwrap.wrap(what, 50)
    for j, ln in enumerate(lines):
        cv.text(lx + 170, yy + j * 24, ln, sansr(18), 'lm', TXT if i else (255, 236, 190)); 
    yy += 24 * len(lines) + 26

# ---------------- Keith's mat
keith_score = render_mat(cv, GAP, mat_y, W - 2 * GAP, MAT_H, keith)

out = cv.flush().convert('RGB')
out.save(G + 'mockup_4p.jpg', quality=90)
out.resize((W // 2, H // 2), Image.LANCZOS).save(G + 'mockup_4p_preview.jpg', quality=88)
json.dump(dict(board=board_state, players=[keith, lizwiz, p3, p4]), open(G + 'mockup_4p_state.json', 'w'), indent=1, default=str)
print('ok', keith_score, {p['name']: score(p)['total'] for p in [lizwiz, p3, p4]}, 'board', bw, bh, 'mid', mw)
