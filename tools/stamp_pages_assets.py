#!/usr/bin/env python3
"""Stamp static Pages asset URLs without changing local/dev source files."""
from pathlib import Path
import re
import sys


def add_version(url: str, version: str) -> str:
    if '?v=' in url:
        return url
    return f'{url}?v={version}'


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: stamp_pages_assets.py SITE_DIR BUILD-SHA')
    root = Path(sys.argv[1])
    version = sys.argv[2]
    index = root / 'index.html'
    text = index.read_text()
    text = re.sub(
        r'((?:href|src)=")(app/(?:css/app\.css|js/main\.js))(")',
        lambda m: f'{m.group(1)}{add_version(m.group(2), version)}{m.group(3)}',
        text,
    )
    index.write_text(text)

    # Stamp both static and dynamic relative module imports. This includes
    # bug-report/setup imports that are loaded only after the initial boot.
    for path in (root / 'app' / 'js').glob('*.js'):
        source = path.read_text()
        source = re.sub(
            r"(['\"])(\./[^'\"]+\.js)\1",
            lambda m: f'{m.group(1)}{add_version(m.group(2), version)}{m.group(1)}',
            source,
        )
        source = source.replace(
            "new URL('./worker.js', import.meta.url)",
            f"new URL('./worker.js?v={version}', import.meta.url)",
        )
        source = source.replace(
            "new URL('engine/' + f, ROOT)",
            f"new URL('engine/' + f + '?v={version}', ROOT)",
        )
        source = source.replace(
            "'engine/game/g8_state.json'",
            f"'engine/game/g8_state.json?v={version}'",
        )
        path.write_text(source)


if __name__ == '__main__':
    main()
