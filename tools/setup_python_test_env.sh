#!/usr/bin/env bash
# Recreate the original engine's workstation layout so engine/scripts/test_turn_process.py runs UNCHANGED:
#   /workspace/lizard-wizard -> engine/   (render4.py, render_mat.py and deal4.py hardcode this root)
#   /usr/share/fonts/truetype/sand-box/google/{Cinzel Decorative,Alegreya Sans}/  (fonts render4.py loads)
#   engine/assets/  built from art/ by tools/build_engine_assets.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet pillow
python3 "$ROOT/tools/build_engine_assets.py"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
$SUDO mkdir -p /workspace
$SUDO ln -sfn "$ROOT/engine" /workspace/lizard-wizard
FD=/usr/share/fonts/truetype/sand-box/google
$SUDO mkdir -p "$FD/Cinzel Decorative" "$FD/Alegreya Sans"
$SUDO cp "$ROOT/fonts/CinzelDecorative-Bold.ttf" "$FD/Cinzel Decorative/"
$SUDO cp "$ROOT/fonts/AlegreyaSans-Bold.ttf" "$FD/Alegreya Sans/"
echo "python test env ready: /workspace/lizard-wizard -> $ROOT/engine"
