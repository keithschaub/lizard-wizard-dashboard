#!/usr/bin/env python3
"""Achievement carddb: every tile has icon metadata and titles without duplicated (School) suffixes."""
import json, os, re, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine')
db = json.load(open(os.path.join(ROOT, 'cards', 'carddb.json')))['cards']
bad = []
for k, c in db.items():
    if c.get('deck') != 'Achievement':
        continue
    if not c.get('tile_icon'):
        bad.append(f'{k}: missing tile_icon')
    if c.get('tile_count') in (None, ''):
        bad.append(f'{k}: missing tile_count')
    if not c.get('tile_label'):
        bad.append(f'{k}: missing tile_label')
    disp = c.get('display') or ''
    if re.search(r'\([^)]+\)\s*$', disp):
        bad.append(f'{k}: display still has parenthetical suffix: {disp!r}')
    if c.get('title') != disp:
        bad.append(f'{k}: title/display mismatch')

if bad:
    print('\n'.join(bad))
    sys.exit(1)

# Reagent source art must have transparent safety margin.  A bbox touching the
# source edge means CSS contain/object-position cannot repair a clipped plant.
icons = os.path.join(os.path.dirname(ROOT), 'art', 'icons', 'reagents')
for name in ('Mandrake', 'Eye_of_Newt', 'Nightshade', 'Sulphur', 'Foxglove', 'Toadstool', 'Horn'):
    path = os.path.join(icons, f'{name}.png')
    with Image.open(path) as image:
        bbox = image.convert('RGBA').getchannel('A').getbbox()
        w, h = image.size
    if not bbox or bbox[0] <= 0 or bbox[1] <= 0 or bbox[2] >= w or bbox[3] >= h:
        bad.append(f'{name}: opaque art touches source image border: {bbox} in {w}x{h}')

if bad:
    print('\n'.join(bad))
    sys.exit(1)
n = sum(1 for c in db.values() if c.get('deck') == 'Achievement')
print(f'OK: {n} achievement entries')
