#!/usr/bin/env bash
# Assemble the static site (what GitHub Pages serves) into $1 (default _site). Run `npm run vendor` first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-_site}"
[ -f "$ROOT/vendor/pyodide/pyodide.mjs" ] || { echo "vendor/pyodide missing: run npm run vendor" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT/engine/assets"
cp "$ROOT/index.html" "$ROOT/robots.txt" "$OUT/"
touch "$OUT/.nojekyll"
cp -r "$ROOT/app" "$ROOT/art" "$ROOT/fonts" "$OUT/"
mkdir -p "$OUT/vendor" && cp -r "$ROOT/vendor/pyodide" "$OUT/vendor/"
cp -r "$ROOT/engine/scripts" "$ROOT/engine/cards" "$ROOT/engine/game" "$ROOT/engine/web" "$OUT/engine/"
cp "$ROOT/engine/assets/dungeon_from_photos.json" "$OUT/engine/assets/"
find "$OUT" -name '__pycache__' -prune -exec rm -rf {} +
rm -f "$OUT/engine/web/test_lw_web.py"
echo "site assembled in $OUT ($(du -sh "$OUT" | cut -f1))"
