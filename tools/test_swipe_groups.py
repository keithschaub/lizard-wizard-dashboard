#!/usr/bin/env python3
"""Smoke checks that swipeable expand flows exist and use per-card action callbacks."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = (ROOT / "app" / "js" / "ui.js").read_text(encoding="utf-8")
MAIN = (ROOT / "app" / "js" / "main.js").read_text(encoding="utf-8")


def main() -> None:
    for name in ("researchFlow", "buildFlow"):
        assert f"export function {name}" in UI, f"missing {name}"
        assert "actions: (k)" in UI.split(f"export function {name}", 1)[1][:1200], (
            f"{name} should pass actions as (k) => for swipe refresh"
        )
    assert "export function summonFlow" in UI, "missing summonFlow"
    summon = UI.split("export function summonFlow", 1)[1][:2200]
    assert "expandCard" in summon and "actionLayout: 'tiles'" in summon, (
        "summonFlow should use the shared expandCard carousel"
    )
    assert "familiarActionChooser" not in UI, "custom familiar carousel should be removed"
    assert "UI.gatherFlow(this, k)" in MAIN, "legal hand tap should open gatherFlow directly"
    assert "replaceChildren(actionsContainer" in UI, "expand actions should use replaceChildren"
    print("swipe group UI OK")


if __name__ == "__main__":
    main()
