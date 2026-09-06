"""Materialize machine stance suggestions into existing candidate dossiers."""

from __future__ import annotations

import argparse
import sys

from .config import DATA, RACES
from .util import read_json, write_json


def _machine_stance(row: dict[str, object]) -> dict[str, object]:
    provenance = row["provenance"]
    accepted = provenance["review_status"] == "accepted"
    return {
        "issue_id": row["issue_id"],
        "summary": row["summary"],
        "direction_proposed": row["direction_proposed"],
        "confidence": row["confidence"],
        "sources": list(row["sources"]),
        "posts": list(row["posts"]),
        "provenance": provenance,
        "basis": "verified" if accepted else "inferred",
        "label": (
            f"Machine-summarised from news/web ({provenance['model']}, {provenance['tagged_at']}); "
            "not part of the record"
        ),
    }


def run(race_id: str) -> int:
    race = RACES[race_id]
    hand_path = DATA / "hand" / race_id / "x_stances.json"
    hand = read_json(hand_path) if hand_path.exists() else {"rows": []}
    rows = [row for row in hand.get("rows", []) if isinstance(row, dict)] if isinstance(hand, dict) else []
    by_candidate: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if row.get("provenance", {}).get("review_status") == "rejected":
            continue
        by_candidate.setdefault(str(row["candidate_id"]), []).append(_machine_stance(row))
    changed = 0
    dossier_dir = race.out_dir / "dossiers"
    for path in sorted(dossier_dir.glob("*.json")):
        dossier = read_json(path)
        enrichment = dossier.get("enrichment")
        if isinstance(enrichment, dict):
            enrichment.pop("stances", None)
            if not enrichment:
                dossier.pop("enrichment", None)
        candidate_id = str(dossier.get("candidate_id"))
        if by_candidate.get(candidate_id):
            dossier.setdefault("enrichment", {})["stances"] = sorted(
                by_candidate[candidate_id], key=lambda row: str(row["issue_id"])
            )
        write_json(path, dossier)
        changed += 1
    print(f"x_stances: {len(rows)} rows, {changed} dossiers changed")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    sys.exit(run(parser.parse_args().race))
