"""Stage: hand issue files -> <race>/issues.json; patches entities/<id>.json in place (Block 2, issue focus).

Two layers that are never summed:

  Layer A — spender self-described focus (`Entity.issue_focus`): what the organisation says it exists for, in its own
    words, from `data/hand/<race>/issue_focus.json`. This is about the *spender*; the dollars it "accounts for" are
    its IE total in this race, never dollars "spent on" the focus.
  Layer B — record content (`IndependentExpenditure.issues`, tagged ads): what a specific filed notice or ad was about,
    from `ie_issues.json` and `ad_issues.json`. Attributable to that record's dollars.

Reads `ad_issues.json` directly (joined to `ads.json` on `ad_id`) so it does not depend on `ads_enrich`; never writes
`ads.json`. Every hand file is optional: a missing file or an empty `rows` is a no-op for that layer.

Multi-tag records count their full amount under every tag (dollars are not split), so issue rows overlap. Google reports
ad spend as a range; `spend_min` / `spend_max` / `spend_midpoint` are summed separately and the midpoint is never added
to FEC IE dollars.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .config import DATA, RACES
from .util import now_iso, range_midpoint, read_json, write_json

HAND = DATA / "hand"

TAGGER_FALLBACK = "devin-block2-issues"

ISSUE_KINDS = ("single_issue", "multi_issue")

FOCUS_RULE = (
    "Self-described focus from the organisation's own material; says what the org is for, not what its dollars bought"
)
IE_TAG_RULE = "Tagged by a person from the filed notice"
AD_ISSUE_RULE = (
    "Issue tags are human: a person read each 24/48-hour notice (IE rows) or watched/read each creative (ads). Google "
    "reports ad spend as a range; spend_min/spend_max are the summed bounds and spend_midpoint their midpoint, kept "
    "separate from FEC IE dollars. A record tagged with several issues counts its full amount under each. Coverage is "
    "in `coverage`."
)

NOTES = [
    "Two layers, never summed: by_ad_issue is what tagged ads and filed notices were about (attributable to those "
    "records' dollars); by_spender_focus is what the spender says it exists for (about the spender, not the dollars). "
    "They are not comparable and must not be added.",
    "Google reports ad spend as a range. spend_min and spend_max are the summed bounds; spend_midpoint is the summed "
    "midpoint and is shown as an estimate. Midpoints are never added to FEC independent-expenditure dollars.",
    "A record tagged with more than one issue counts its full amount under every tag; dollars are not split. Issue rows "
    "therefore overlap and do not sum to a total. An ad aimed at several candidates counts its full midpoint under each.",
    "by_spender_focus primary_only=true counts each spender once (its first issue, or its kind when the kind names no "
    "issue), so those buckets partition the tagged dollars; primary_only=false counts a spender under every issue it "
    "names and overlaps.",
    "General partisan / leadership committees say they exist to win seats or a majority, not for an issue; they carry "
    "issue_id null. Spenders with no sourced self-description are untagged and counted in coverage, not guessed.",
]


@dataclass(frozen=True)
class RowRefs:
    """Where the stage reads from and writes to; overridable for fixtures."""

    out_dir: Path
    hand_dir: Path


@dataclass
class TaggedRecord:
    kind: str  # "ad" | "ie"
    issue_ids: list[str]
    candidate_ids: list[str]
    support_oppose: str
    source_url: str
    tagged_by: str
    tagged_at: str
    spend_min: float = 0.0
    spend_max: float | None = 0.0  # None: Google's open top bucket
    ie_amount: float = 0.0

    @property
    def spend_midpoint(self) -> float:
        return range_midpoint({"min": self.spend_min, "max": self.spend_max})


@dataclass
class IssueAcc:
    ad_count: int = 0
    spend_min: float = 0.0
    spend_max: float = 0.0
    spend_midpoint: float = 0.0
    open_ended: int = 0  # ads whose Google spend bucket has no upper bound; spend_max counts their floor
    ie_amount: float = 0.0
    ie_count: int = 0
    by_candidate: dict[tuple[str, str], list[float]] = field(default_factory=dict)
    source_urls: list[str] = field(default_factory=list)
    taggers: set[str] = field(default_factory=set)
    checked_at: str = ""

    def add(self, rec: TaggedRecord) -> None:
        if rec.kind == "ie":
            self.ie_count += 1
            self.ie_amount += rec.ie_amount
        else:
            self.ad_count += 1
            self.spend_min += rec.spend_min
            if rec.spend_max is None:
                self.open_ended += 1
                self.spend_max += rec.spend_min
            else:
                self.spend_max += rec.spend_max
            self.spend_midpoint += rec.spend_midpoint
        for cand in rec.candidate_ids:
            cell = self.by_candidate.setdefault((cand, rec.support_oppose), [0.0, 0.0])
            cell[0] += rec.spend_midpoint
            cell[1] += rec.ie_amount
        if rec.source_url not in self.source_urls:
            self.source_urls.append(rec.source_url)
        self.taggers.add(rec.tagged_by)
        self.checked_at = max(self.checked_at, rec.tagged_at)


def _hand_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = read_json(path).get("rows", [])
    return [r for r in rows if isinstance(r, dict)]


def _round(x: float) -> float:
    return round(x, 2)


def _weighted(pairs: list[tuple[float, float]]) -> float | None:
    """Dollar-weighted mean of `value` over (weight, value) pairs; None when there are none."""
    total = sum(w for w, _ in pairs)
    if not pairs or total <= 0:
        return None
    return round(sum(w * v for w, v in pairs) / total, 4)


# ---------------------------------------------------------------------------
# Layer A: issue_focus.json -> entities/<id>.json
# ---------------------------------------------------------------------------


def focus_payload(row: dict) -> dict:
    return {
        "kind": row["kind"],
        "issue_ids": list(row["issue_ids"]),
        "description": row["description"],
        "basis": {
            "basis": "verified",
            "rule": FOCUS_RULE,
            "source_urls": list(row["source_urls"]),
            "checked_by": row["tagged_by"],
            "checked_at": row["tagged_at"],
        },
    }


def patch_focus(refs: RowRefs, rows: list[dict]) -> int:
    """Write `issue_focus` onto each matching entity file; returns the number of files that changed."""
    changed = 0
    for row in rows:
        path = refs.out_dir / "entities" / f"{row['entity_id']}.json"
        if not path.exists():
            continue
        entity = read_json(path)
        payload = focus_payload(row)
        if entity.get("issue_focus") != payload:
            entity["issue_focus"] = payload
            write_json(path, entity)
            changed += 1
    return changed


def machine_focus_payload(row: dict, *, rule: str = "x_issue_focus", subject: str = "committee") -> dict:
    provenance = row["provenance"]
    status = provenance["review_status"]
    accepted = status == "accepted"
    return {
        "kind": row["kind"],
        "issue_ids": list(row["issue_ids"]),
        "description": row["description"],
        "basis": {
            "basis": "verified" if accepted else "inferred",
            "rule": rule,
            "source_urls": list(row["source_urls"]),
            "checked_by": provenance["reviewed_by"] if accepted else None,
            "checked_at": provenance["reviewed_at"] if accepted else None,
        },
        "label": (
            f"Machine-tagged from the {subject}'s own website "
            f"({provenance['model']}, {provenance['tagged_at']}); not part of the record"
        ),
        "quote": row["quote"],
        "provenance": provenance,
    }


def patch_machine_focus(refs: RowRefs, rows: list[dict]) -> int:
    """Replace machine issue-focus blocks while leaving human focus untouched."""
    by_id = {str(row["entity_id"]): row for row in rows}
    changed = 0
    entities_dir = refs.out_dir / "entities"
    if not entities_dir.exists():
        return 0
    for path in sorted(entities_dir.glob("*.json")):
        entity = read_json(path)
        dirty = False
        enrichment = entity.get("x_enrichment")
        if isinstance(enrichment, dict) and "issue_focus" in enrichment:
            del enrichment["issue_focus"]
            dirty = True
            if not enrichment:
                entity.pop("x_enrichment", None)
        row = by_id.get(str(entity.get("entity_id")))
        if row is not None and row.get("provenance", {}).get("review_status") != "rejected":
            entity.setdefault("x_enrichment", {})["issue_focus"] = machine_focus_payload(row)
            dirty = True
        if dirty:
            write_json(path, entity)
            changed += 1
    return changed


def patch_machine_funder(refs: RowRefs, rows: list[dict]) -> tuple[int, int]:
    """Replace machine funder blocks on donor views; returns changed files and unmatched rows."""
    by_id = {str(row["entity_id"]): row for row in rows}
    changed = 0
    matched: set[str] = set()
    donors_dir = refs.out_dir / "donors"
    if not donors_dir.exists():
        return 0, len(by_id)
    for path in sorted(donors_dir.glob("*.json")):
        donor = read_json(path)
        dirty = False
        enrichment = donor.get("x_enrichment")
        if isinstance(enrichment, dict) and "issue_focus" in enrichment:
            del enrichment["issue_focus"]
            dirty = True
            if not enrichment:
                donor.pop("x_enrichment", None)
        donor_id = str(donor.get("donor_id"))
        row = by_id.get(donor_id)
        if row is not None:
            matched.add(donor_id)
            if row.get("provenance", {}).get("review_status") != "rejected":
                donor.setdefault("x_enrichment", {})["issue_focus"] = machine_focus_payload(
                    row, rule="x_funder_focus", subject="organization"
                )
                dirty = True
        if dirty:
            write_json(path, donor)
            changed += 1
    return changed, len(set(by_id) - matched)


# ---------------------------------------------------------------------------
# Layer B: ie_issues.json -> entities/<spender>.json IE rows; ad_issues.json x ads.json
# ---------------------------------------------------------------------------


def ie_tag_payload(row: dict, ie: dict) -> dict:
    return {
        "issue_ids": list(row["issue_ids"]),
        "basis": {
            "basis": "verified",
            "rule": IE_TAG_RULE,
            "source_urls": [ie["source_url"]],
            "checked_by": row["tagged_by"],
            "checked_at": row["tagged_at"],
        },
    }


def spender_of(ie_id: str) -> str:
    """IE ids are `<spender_entity_id>-ie-<file>-<tran>`."""
    return ie_id.split("-ie-", 1)[0]


def patch_ies(refs: RowRefs, rows: list[dict]) -> tuple[list[TaggedRecord], int]:
    """Write `issues` onto each matching IE row; returns the tagged records (for aggregation) and files changed."""
    by_id = {row["ie_id"]: row for row in rows}
    by_spender: dict[str, list[str]] = defaultdict(list)
    for ie_id in by_id:
        by_spender[spender_of(ie_id)].append(ie_id)
    tagged: list[TaggedRecord] = []
    changed = 0
    for spender_id, ie_ids in by_spender.items():
        path = refs.out_dir / "entities" / f"{spender_id}.json"
        if not path.exists():
            continue
        entity = read_json(path)
        wanted = set(ie_ids)
        dirty = False
        for ie in entity.get("independent_expenditures", []):
            if ie["ie_id"] not in wanted:
                continue
            row = by_id[ie["ie_id"]]
            payload = ie_tag_payload(row, ie)
            if ie.get("issues") != payload:
                ie["issues"] = payload
                dirty = True
            tagged.append(
                TaggedRecord(
                    kind="ie",
                    issue_ids=list(row["issue_ids"]),
                    candidate_ids=[ie["candidate_id"]],
                    support_oppose=ie["support_oppose"],
                    source_url=ie["source_url"],
                    tagged_by=row["tagged_by"],
                    tagged_at=row["tagged_at"],
                    ie_amount=float(ie["amount"]),
                )
            )
        if dirty:
            write_json(path, entity)
            changed += 1
    return tagged, changed


def tagged_ads(refs: RowRefs, rows: list[dict]) -> tuple[list[TaggedRecord], int]:
    """Join hand ad rows to ads.json on ad_id (read-only). Returns tagged records and the total ad count."""
    ads_path = refs.out_dir / "ads.json"
    if not ads_path.exists():
        return [], 0
    ads = {ad["ad_id"]: ad for ad in read_json(ads_path).get("ads", [])}
    tagged: list[TaggedRecord] = []
    for row in rows:
        ad = ads.get(row["ad_id"])
        if ad is None:
            continue
        spend = ad["spend_range"]
        tagged.append(
            TaggedRecord(
                kind="ad",
                issue_ids=list(row["issue_ids"]),
                candidate_ids=list(ad["candidate_ids"]),
                support_oppose=ad["support_oppose"],
                source_url=ad["source_url"],
                tagged_by=row["tagged_by"],
                tagged_at=row["tagged_at"],
                spend_min=float(spend["min"]),
                spend_max=None if spend["max"] is None else float(spend["max"]),
            )
        )
    return tagged, len(ads)


def by_ad_issue(records: list[TaggedRecord]) -> list[dict]:
    accs: dict[str, IssueAcc] = defaultdict(IssueAcc)
    for rec in records:
        for issue_id in rec.issue_ids:
            accs[issue_id].add(rec)
    out = []
    for issue_id, acc in accs.items():
        out.append(
            {
                "issue_id": issue_id,
                "ad_count": acc.ad_count,
                "spend_min": _round(acc.spend_min),
                "spend_max": _round(acc.spend_max),
                "spend_midpoint": _round(acc.spend_midpoint),
                "ie_amount": _round(acc.ie_amount),
                "ie_count": acc.ie_count,
                "by_candidate": [
                    {
                        "candidate_id": cand,
                        "support_oppose": so,
                        "spend_midpoint": _round(mid),
                        "ie_amount": _round(ie),
                    }
                    for (cand, so), (mid, ie) in sorted(acc.by_candidate.items())
                ],
                "basis": {
                    "basis": "verified",
                    "rule": AD_ISSUE_RULE
                    + (
                        f" {acc.open_ended} ad(s) sit in Google's open-ended top spend bucket; their floor stands in for"
                        f" max and midpoint."
                        if acc.open_ended
                        else ""
                    ),
                    "source_urls": acc.source_urls,
                    "checked_by": ", ".join(sorted(acc.taggers)) or TAGGER_FALLBACK,
                    "checked_at": acc.checked_at,
                },
            }
        )
    out.sort(key=lambda r: (-r["ie_amount"], -r["spend_midpoint"], r["issue_id"]))
    return out


# ---------------------------------------------------------------------------
# Layer A aggregate: by_spender_focus
# ---------------------------------------------------------------------------


@dataclass
class FocusAcc:
    amount: float = 0.0
    spender_ids: list[str] = field(default_factory=list)
    trace: list[tuple[float, float]] = field(default_factory=list)
    dark: list[tuple[float, float]] = field(default_factory=list)


def _chain_shares(refs: RowRefs, entity_id: str) -> tuple[float, float] | None:
    path = refs.out_dir / "chains" / f"{entity_id}.json"
    if not path.exists():
        return None
    summary = read_json(path).get("summary", {})
    return float(summary["disclosed_share"]), float(summary["dark_share"])


def focus_buckets(row: dict) -> list[tuple[str, str | None, bool]]:
    """(kind, issue_id, primary_only) buckets one focus row belongs to.

    Issue kinds: primary -> first issue; all -> every issue. Non-issue kinds: the kind itself (issue_id null) in both
    variants, plus every named issue in the all-tags variant only, so primary_only=true partitions the dollars.
    """
    kind, ids = row["kind"], list(row["issue_ids"])
    if kind in ISSUE_KINDS:
        return [(kind, ids[0], True)] + [(kind, i, False) for i in ids]
    return [(kind, None, True), (kind, None, False)] + [(kind, i, False) for i in ids]


def by_spender_focus(refs: RowRefs, rows: list[dict], spenders: dict[str, float]) -> list[dict]:
    accs: dict[tuple[str, str | None, bool], FocusAcc] = defaultdict(FocusAcc)
    for row in rows:
        entity_id = row["entity_id"]
        if entity_id not in spenders:
            continue
        amount = spenders[entity_id]
        shares = _chain_shares(refs, entity_id)
        for key in focus_buckets(row):
            acc = accs[key]
            acc.amount += amount
            acc.spender_ids.append(entity_id)
            if shares is not None:
                acc.trace.append((amount, shares[0]))
                acc.dark.append((amount, shares[1]))
    out = []
    for (kind, issue_id, primary_only), acc in accs.items():
        out.append(
            {
                "kind": kind,
                "issue_id": issue_id,
                "primary_only": primary_only,
                "amount": _round(acc.amount),
                "spender_ids": sorted(acc.spender_ids, key=lambda s: -spenders[s]),
                "traceability_score": _weighted(acc.trace),
                "dark_share": _weighted(acc.dark),
            }
        )
    out.sort(key=lambda r: (not r["primary_only"], -r["amount"], r["kind"], r["issue_id"] or ""))
    return out


# ---------------------------------------------------------------------------
# Stage
# ---------------------------------------------------------------------------


def build(race_id: str, refs: RowRefs) -> dict:
    ledger = read_json(refs.out_dir / "ledger.json")
    spenders = {s["entity_id"]: float(s["total"]) for s in ledger["top_outside_spenders"]}
    dollars_total = float(ledger["traceability"]["outside_total"])

    focus_rows = _hand_rows(refs.hand_dir / "issue_focus.json")
    x_focus_rows = _hand_rows(refs.hand_dir / "x_issue_focus.json")
    x_funder_rows = _hand_rows(refs.hand_dir / "x_funder_focus.json")
    ie_rows = _hand_rows(refs.hand_dir / "ie_issues.json")
    ad_rows = _hand_rows(refs.hand_dir / "ad_issues.json")

    focus_changed = patch_focus(refs, focus_rows)
    x_focus_changed = patch_machine_focus(refs, x_focus_rows)
    x_funder_changed, x_funder_unmatched = patch_machine_funder(refs, x_funder_rows)
    ie_records, ie_changed = patch_ies(refs, ie_rows)
    ad_records, ads_total = tagged_ads(refs, ad_rows)
    print(f"issue_focus: {len(focus_rows)} rows, {focus_changed} entity files changed")
    print(f"x_issue_focus: {len(x_focus_rows)} rows, {x_focus_changed} entity files changed")
    print(
        f"x_funder_focus: {len(x_funder_rows)} rows, {x_funder_changed} donor files changed; "
        f"{x_funder_unmatched} rows without donor files"
    )
    print(f"ie_issues: {len(ie_rows)} rows, {len(ie_records)} matched, {ie_changed} entity files changed")
    print(f"ad_issues: {len(ad_rows)} rows, {len(ad_records)} matched of {ads_total} ads")

    tagged_spenders = sorted({r["entity_id"] for r in focus_rows if r["entity_id"] in spenders})
    coverage = {
        "spenders_tagged": len(tagged_spenders),
        "spenders_total": len(spenders),
        "dollars_tagged": _round(sum(spenders[s] for s in tagged_spenders)),
        "dollars_total": _round(dollars_total),
        "ads_tagged": len(ad_records),
        "ads_total": ads_total,
        "ies_tagged": len(ie_records),
        "ie_dollars_tagged": _round(sum(r.ie_amount for r in ie_records)),
    }
    complete = coverage["spenders_tagged"] == coverage["spenders_total"] and bool(ie_records) and bool(ad_records)
    return {
        "race_id": race_id,
        "generated_at": now_iso(),
        "data_status": ledger["data_status"] if complete else "partial",
        "by_ad_issue": by_ad_issue(ad_records + ie_records),
        "by_spender_focus": by_spender_focus(refs, focus_rows, spenders),
        "coverage": coverage,
        "notes": NOTES,
    }


def run(race_id: str, refs: RowRefs | None = None) -> dict:
    race = RACES[race_id]
    refs = refs or RowRefs(out_dir=race.out_dir, hand_dir=HAND / race_id)
    issues = build(race_id, refs)
    write_json(refs.out_dir / "issues.json", issues)
    cov = issues["coverage"]
    print(
        f"coverage: {cov['spenders_tagged']}/{cov['spenders_total']} spenders, "
        f"${cov['dollars_tagged']:,.0f}/${cov['dollars_total']:,.0f}, "
        f"{cov['ads_tagged']}/{cov['ads_total']} ads, {cov['ies_tagged']} IEs"
    )
    return issues


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
