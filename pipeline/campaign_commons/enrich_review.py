"""Read-only review report for machine enrichment rows."""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from .config import DATA, RACES
from .util import read_json


def run(race_id: str, status: str = "pending", kind: str = "ads") -> int:
    race = RACES[race_id]
    if kind == "spenders":
        hand_path = DATA / "hand" / race_id / "x_issue_focus.json"
        ads = []
        by_id = {}
    else:
        ads = read_json(race.out_dir / "ads.json").get("ads", [])
        by_id = {str(ad["ad_id"]): ad for ad in ads if isinstance(ad, dict)}
        hand_path = DATA / "hand" / race_id / "x_ad_issues.json"
    hand = read_json(hand_path) if hand_path.exists() else {"rows": []}
    rows = hand.get("rows", []) if isinstance(hand, dict) else []
    statuses: Counter[str] = Counter()
    primary: Counter[str] = Counter()
    kinds: Counter[str] = Counter()
    shown = 0
    for row in sorted((r for r in rows if isinstance(r, dict)), key=lambda item: str(item.get("ad_id"))):
        provenance = row.get("provenance", {})
        row_status = provenance.get("review_status") if isinstance(provenance, dict) else None
        if not isinstance(row_status, str):
            continue
        statuses[row_status] += 1
        issue_ids = row.get("issue_ids", [])
        if issue_ids:
            primary[str(issue_ids[0])] += 1
        if isinstance(row.get("kind"), str):
            kinds[row["kind"]] += 1
        if status and row_status != status:
            continue
        if kind == "spenders":
            print(
                f"{row.get('entity_id')}: name={row.get('name', '')}; kind={row.get('kind', '')}; "
                f"issue_ids={issue_ids}; confidence={provenance.get('confidence')}; quote={row.get('quote')!r}; "
                f"description={row.get('description')!r}; source_url={row.get('source_urls', [''])[0]}; "
                f"review_status={row_status}"
            )
        else:
            ad = by_id.get(str(row.get("ad_id")), {})
            human = ad.get("issues", {}).get("issue_ids", []) if isinstance(ad.get("issues"), dict) else []
            print(
                f"{row.get('ad_id')}: advertiser={ad.get('advertiser_name', '')}; ad_type={ad.get('ad_type', '')}; "
                f"human={human}; machine={issue_ids}; confidence={provenance.get('confidence')}; "
                f"quote={row.get('quote')!r}; rationale={row.get('rationale')!r}; "
                f"creative_url={ad.get('creative_url', '')}; review_status={row_status}"
            )
        shown += 1
    summary = f"shown {shown}; by status {dict(statuses)}; by primary issue {dict(primary)}"
    if kind == "spenders":
        summary += f"; by kind {dict(kinds)}"
    print(summary)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--status", default="pending")
    parser.add_argument("--kind", choices=["ads", "spenders"], default="ads")
    args = parser.parse_args()
    return run(args.race, args.status, args.kind)


if __name__ == "__main__":
    sys.exit(main())
