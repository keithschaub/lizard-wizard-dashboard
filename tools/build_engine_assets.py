"""Build engine/assets/ (gitignored) from the committed art so the ORIGINAL engine and its 75-test suite run unchanged.

The original engine expects the layout of Keith's workstation (/workspace/lizard-wizard/assets/...):
  assets/enhanced/<Card>.jpg        enhanced card art (QC + tests check this path)
  assets/<Card>.jpg                 card files deal4.py / carddb.validate() look for
  assets/game_board_start.jpg       board background for render4.py (1728x2304)
  assets/reagent_icons/<R>.png, assets/school_icons/<S>.png, assets/reagent_markers/<R>.png
  assets/dungeon_from_photos.json   dungeon deck list (built here from cards/dungeon_cards.json)
Every image is converted from art/ (the enhanced webp art); nothing else is used.

  python3 tools/build_engine_assets.py            # images + json (needs Pillow)
  python3 tools/build_engine_assets.py --json     # only dungeon_from_photos.json (no Pillow; what the browser needs)
"""
import json, os, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ENGINE = os.path.join(ROOT, 'engine')
ASSETS = os.path.join(ENGINE, 'assets')
ART = os.path.join(ROOT, 'art')


def dungeon_deck():
    """The 53 photographed dungeon cards in the engine's card-dict form (the 2 Trap! cards included; setup sets them aside)."""
    src = json.load(open(os.path.join(ENGINE, 'cards', 'dungeon_cards.json')))
    out = []
    for c in src['cards']:
        k = c['kind']
        if k == 'monster':
            d = {'deck': 'Dungeon', 'type': 'Monster', 'name': c['title'], 'monster_type': c['monster_type']}
        elif k == 'gold':
            d = {'deck': 'Dungeon', 'type': 'Treasure', 'subtype': 'Gold', 'text': c['bottom_text'], 'gold': int(c['gold'])}
        elif k == 'item':
            d = {'deck': 'Dungeon', 'type': 'Treasure', 'subtype': 'Item', 'name': c['item']}
        elif k == 'trap':
            d = {'deck': 'Dungeon', 'type': 'Trap', 'name': c['title'], 'hits': int(c.get('hits', 2))}
        else:
            raise ValueError(f'unknown dungeon card kind {k!r}')
        d['photo'] = c['file']
        out.append(d)
    return {'source': 'built from cards/dungeon_cards.json by tools/build_engine_assets.py', 'count': len(out), 'cards': out}


def write_json():
    os.makedirs(ASSETS, exist_ok=True)
    deck = dungeon_deck()
    assert deck['count'] == 53, deck['count']
    json.dump(deck, open(os.path.join(ASSETS, 'dungeon_from_photos.json'), 'w'), indent=1)


def write_images():
    from PIL import Image, ImageDraw
    enh = os.path.join(ASSETS, 'enhanced'); os.makedirs(enh, exist_ok=True)
    cards = os.path.join(ART, 'cards')
    for f in sorted(os.listdir(cards)):
        if not f.endswith('.webp'): continue
        name = f[:-5] + '.jpg'
        dst_e, dst = os.path.join(enh, name), os.path.join(ASSETS, name)
        if os.path.exists(dst_e) and os.path.exists(dst): continue
        im = Image.open(os.path.join(cards, f)).convert('RGB')
        im.save(dst_e, quality=90); im.save(dst, quality=90)
    board = os.path.join(ASSETS, 'game_board_start.jpg')
    if not os.path.exists(board):
        Image.open(os.path.join(ART, 'board', 'game_board_clean.webp')).convert('RGB').save(board, quality=92)
    for sub, src in (('reagent_icons', 'reagents'), ('school_icons', 'schools')):
        d = os.path.join(ASSETS, sub); os.makedirs(d, exist_ok=True)
        for f in os.listdir(os.path.join(ART, 'icons', src)):
            Image.open(os.path.join(ART, 'icons', src, f)).save(os.path.join(d, f))
    mk = os.path.join(ASSETS, 'reagent_markers'); os.makedirs(mk, exist_ok=True)
    for f in os.listdir(os.path.join(ART, 'icons', 'reagents')):
        dd = 256
        m = Image.new('RGBA', (dd, dd), (0, 0, 0, 0)); md = ImageDraw.Draw(m)
        md.ellipse([0, 0, dd - 1, dd - 1], fill=(225, 235, 255, 255))
        md.ellipse([dd * 0.06, dd * 0.06, dd * 0.94, dd * 0.94], fill=(18, 28, 70, 255))
        ic = Image.open(os.path.join(ART, 'icons', 'reagents', f)).convert('RGBA'); ic.thumbnail((int(dd * 0.78), int(dd * 0.78)))
        m.alpha_composite(ic, ((dd - ic.width) // 2, (dd - ic.height) // 2))
        m.save(os.path.join(mk, f))


if __name__ == '__main__':
    write_json()
    if '--json' not in sys.argv:
        write_images()
    print('engine assets ready in', ASSETS)
