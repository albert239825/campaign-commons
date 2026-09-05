"""Validate data/out/**/*.json against contracts/jsonschema/*.schema.json (no Node required).

python -m gotham.validate            # all of data/out
python -m gotham.validate <dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator

from .config import OUT, ROOT

SCHEMA_DIR = ROOT / "contracts" / "jsonschema"


def _schema_name(rel: Path) -> str | None:
    parts = rel.parts
    if len(parts) == 1 and parts[0] == "races.json":
        return "races"
    if len(parts) == 2:
        return {"ledger.json": "ledger", "ads.json": "ads", "stories.json": "stories"}.get(parts[1])
    if len(parts) == 3:
        return {"entities": "entity", "chains": "chain", "dossiers": "dossier", "donors": "donor"}.get(parts[1])
    return None


def validate_dir(root: Path = OUT) -> int:
    validators: dict[str, Draft7Validator] = {}
    ok = failed = skipped = 0
    for file in sorted(root.rglob("*.json")):
        rel = file.relative_to(root)
        name = _schema_name(rel)
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


if __name__ == "__main__":
    sys.exit(validate_dir(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT))
