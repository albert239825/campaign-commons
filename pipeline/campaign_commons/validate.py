"""Validate data/out/**/*.json against contracts/jsonschema/*.schema.json (no Node required).

python -m campaign_commons.validate            # all of data/out, then data/hand
python -m campaign_commons.validate <dir>      # one root; a root named `hand` uses the hand-file schemas
python -m campaign_commons.validate <dir> --hand   # one root, forced to the hand-file schemas (fixtures, temp copies)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator

from .config import OUT, ROOT

SCHEMA_DIR = ROOT / "contracts" / "jsonschema"
HAND = ROOT / "data" / "hand"

HAND_SCHEMAS = {
    "issue_focus.json": "hand_issue_focus",
    "ad_issues.json": "hand_ad_issues",
    "x_ad_issues.json": "hand_x_ad_issues",
    "ie_issues.json": "hand_ie_issues",
    "vendor_aliases.json": "hand_vendor_aliases",
    "vendor_ad_links.json": "hand_vendor_ad_links",
}


def _schema_name(rel: Path, hand: bool = False) -> str | None:
    parts = rel.parts
    if hand:
        return HAND_SCHEMAS.get(parts[1]) if len(parts) == 2 else None
    if len(parts) == 1:
        return {"races.json": "races", "search.json": "search"}.get(parts[0])
    if len(parts) == 2:
        return {
            "ledger.json": "ledger",
            "ads.json": "ads",
            "stories.json": "stories",
            "vendors.json": "vendors",
            "issues.json": "issues",
        }.get(parts[1])
    if len(parts) == 3:
        return {
            "entities": "entity",
            "chains": "chain",
            "dossiers": "dossier",
            "donors": "donor",
            "vendors": "vendor",
        }.get(parts[1])
    return None


def validate_dir(root: Path = OUT, hand: bool | None = None) -> int:
    root = root.resolve()
    if hand is None:
        hand = root.name == "hand"
    validators: dict[str, Draft7Validator] = {}
    ok = failed = skipped = 0
    for file in sorted(root.rglob("*.json")):
        rel = file.relative_to(root)
        name = _schema_name(rel, hand)
        if name is None:
            skipped += 1
            print(f"SKIP  {rel}")
            continue
        if name not in validators:
            schema = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())
            validators[name] = Draft7Validator(schema)
        errors = sorted(validators[name].iter_errors(json.loads(file.read_text())), key=lambda e: list(e.path))
        if errors:
            failed += 1
            print(f"FAIL  {rel}")
            for e in errors[:20]:
                print(f"      {'.'.join(str(p) for p in e.path) or '<root>'}: {e.message}")
        else:
            ok += 1
    print(f"\n{ok} ok, {failed} failed, {skipped} skipped (root: {root})")
    return 1 if failed else 0


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--hand"]
    if args:
        return validate_dir(Path(args[0]), hand=True if "--hand" in sys.argv else None)
    rc = validate_dir(OUT)
    if HAND.exists():
        rc |= validate_dir(HAND)
    return rc


if __name__ == "__main__":
    sys.exit(main())
