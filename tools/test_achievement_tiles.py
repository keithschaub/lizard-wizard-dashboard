#!/usr/bin/env python3
"""Achievement carddb: every tile has icon metadata and titles without duplicated (School) suffixes."""
import json, os, re, sys

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
n = sum(1 for c in db.values() if c.get('deck') == 'Achievement')
print(f'OK: {n} achievement entries')
