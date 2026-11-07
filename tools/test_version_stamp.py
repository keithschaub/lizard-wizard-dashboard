#!/usr/bin/env python3
"""Smoke checks for app/js/version.js (local dev stamp + deploy format)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = ROOT / "app" / "js" / "version.js"

DEPLOY_RE = re.compile(
    r"export const BUILD = '(\d+)';\s*"
    r"export const SHA = '([0-9a-f]{7,40})';\s*"
    r"export const BUILT_AT = '(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)';\s*"
    r"export function versionLabel\(\)",
    re.S,
)
DEV_RE = re.compile(
    r"export const BUILD = 'dev';\s*"
    r"export const SHA = 'dev';\s*"
    r"export const BUILT_AT = 'dev';",
    re.S,
)


def deploy_label(build: str, sha: str, built_at: str) -> str:
    return f"v1.0.{build} · {sha} · {built_at}"


def main() -> None:
    assert VERSION.is_file(), f"missing {VERSION}"
    text = VERSION.read_text(encoding="utf-8")
    assert "export function versionLabel()" in text, "versionLabel export missing"

    if DEV_RE.search(text):
        assert "return 'dev'" in text or 'return "dev"' in text, "dev fallback must return dev"
        print("version.js OK (local dev stamp)")
        return

    m = DEPLOY_RE.search(text)
    assert m, "version.js is neither dev fallback nor deploy stamp"
    build, sha, built_at = m.groups()
    sample = deploy_label(build, sha, built_at)
    assert "v1.0." in sample and " · " in sample
    print(f"version.js OK (deploy stamp) sample: {sample}")


if __name__ == "__main__":
    main()
