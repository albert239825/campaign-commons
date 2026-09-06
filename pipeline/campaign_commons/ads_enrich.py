"""Stage: patch <race>/ads.json in place with everything Block 2 adds to an ad (runs after campaign_commons.ads and campaign_commons.vendors).

This module owns every field written to ads.json after the ads stage: `sponsor_visibility_shares`, `issues`,
`same_window_buys[]`, `vendor_links[]`, and the enrichment notes. It never re-downloads the Google bundle; it reads what is already in data/out
and data/hand and rewrites ads.json. Re-running yields the same file (fields are recomputed from scratch, enrichment
notes are replaced, `generated_at` is untouched).

1. sponsor_visibility_shares <- chains/<matched_entity_id>.json summary shares; null when unmatched or no chain.
2. issues <- data/hand/<race>/ad_issues.json (a person tagged the creative); absent when untagged.
3. same_window_buys[] <- the sponsor's `vendors[]` rows (entities/<sponsor>.json, written by campaign_commons.vendors) whose IE rows
   are dated inside the ad's window [first_shown - 7 days, last_shown], counting only the buys for media that could place or
   produce a Google creative (a vendor's TV dollars in the window are neither shown nor summed). Context only: the FEC does
   not say which buy placed which ad, so this is never a link or an edge.
4. vendor_links[] <- vendors joined to the ad by a rule or a person: `inferred` when exactly one vendor with digital buys sits
   in the window (Google ads are digital placements); `verified` only from data/hand/<race>/vendor_ad_links.json, kept even
   when no payment is dated in the window (the source, not a filing, is the evidence; `window` is null when the ad has no dates).
   Date overlap alone (the former `adjacent` basis) is not a link (D-74). Reverse side: vendors/<vendor_id>.json.ads[] gets
   {ad_id, sponsor_entity_id, basis}. Without `vendors[]` on the sponsor (campaign_commons.vendors not run yet) steps 3-4 are
   no-ops and say so in the notes.
"""

from __future__ import annotations

import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .config import RACES, ROOT
from .util import read_json, write_json

WINDOW_LEAD_DAYS = 7
NOTE_PREFIX = "Enrichment (campaign_commons.ads_enrich): "
TAGGING_RULE = "Tagged by a person from the creative"
WINDOW_RULE = (
    f"A vendor is 'in the window' of an ad when any of the sponsor's independent-expenditure rows paid to that vendor is dated from "
    f"{WINDOW_LEAD_DAYS} days before the ad was first shown through the day it was last shown."
)

JsonDict = dict[str, object]


@dataclass(frozen=True)
class Buy:
    vendor_id: str
    day: date
    amount: float
    medium: str | None


@dataclass
class EnrichCounts:
    ads: int = 0
    with_shares: int = 0
    tagged: int = 0
    machine_tagged: int = 0
    links_by_basis: Counter[str] = field(default_factory=Counter)
    same_window_buys: int = 0
    ads_with_same_window_buys: int = 0
    sponsors_with_vendors: int = 0
    sponsors_without_vendors: int = 0
    vendor_files_patched: int = 0
    untagged_rows: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# helpers


def _iso(s: object) -> date | None:
    return date.fromisoformat(str(s)[:10]) if isinstance(s, str) and s else None


def _human(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


def _rows(hand: JsonDict) -> list[JsonDict]:
    rows = hand.get("rows", [])
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def load_hand(path: Path) -> JsonDict:
    if not path.exists():
        return {"rows": []}
    loaded = read_json(path)
    return loaded if isinstance(loaded, dict) else {"rows": []}


def sponsor_shares(chain: JsonDict | None) -> JsonDict | None:
    if chain is None:
        return None
    summary = chain.get("summary")
    if not isinstance(summary, dict):
        return None
    shares = {
        "disclosed": summary["disclosed_share"],
        "inferable": summary["inferable_share"],
        "unwalked": summary.get("unwalked_share", 0.0),
        "dark": summary["dark_share"],
    }
    if "disclosed_organizations_share" in summary:
        shares["disclosed_individuals"] = summary["disclosed_individuals_share"]
        shares["disclosed_organizations"] = summary["disclosed_organizations_share"]
    return shares


def issue_tags(row: JsonDict, creative_url: str) -> JsonDict:
    return {
        "issue_ids": list(row["issue_ids"]),
        "basis": {
            "basis": "verified",
            "rule": TAGGING_RULE,
            "source_urls": [creative_url],
            "checked_by": row["tagged_by"],
            "checked_at": row["tagged_at"],
        },
    }


def machine_issue_tags(row: JsonDict) -> JsonDict | None:
    if row is None:
        return None
    issue_ids = row.get("issue_ids")
    provenance = row.get("provenance")
    if not isinstance(issue_ids, list) or not issue_ids or not isinstance(provenance, dict):
        return None
    status = provenance.get("review_status")
    if status == "rejected":
        return None
    model = str(provenance.get("model", "unknown"))
    tagged_at = str(provenance.get("tagged_at", ""))
    reviewed_by = provenance.get("reviewed_by")
    reviewed_at = provenance.get("reviewed_at")
    accepted = status == "accepted"
    basis = {
        "basis": "verified" if accepted else "inferred",
        "rule": (
            f"Classified by {model} from the ad's transcript ({tagged_at}); accepted by {reviewed_by} {reviewed_at}"
            if accepted
            else f"Classified by {model} from the ad's transcript ({tagged_at}); pending human review"
        ),
        "source_urls": list(row.get("source_urls", [])),
        "checked_by": reviewed_by if accepted else None,
        "checked_at": reviewed_at if accepted else None,
    }
    return {
        "issue_ids": list(issue_ids),
        "basis": basis,
        "label": f"Machine-tagged from the ad's transcript ({model}, {tagged_at}); not part of the record",
        "quote": row.get("quote"),
        "transcript_kind": row.get("transcript_kind"),
        "provenance": provenance,
    }


def in_window(day: date, first: date, last: date) -> bool:
    return first - timedelta(days=WINDOW_LEAD_DAYS) <= day <= last


def sponsor_buys(entity: JsonDict) -> list[Buy]:
    """The sponsor's IE rows that campaign_commons.vendors resolved to a vendor. Empty when the vendors stage has not run."""
    ies = entity.get("independent_expenditures", [])
    out: list[Buy] = []
    for ie in ies if isinstance(ies, list) else []:
        if not isinstance(ie, dict):
            continue
        vendor_id, day = ie.get("vendor_id"), _iso(ie.get("date"))
        if not isinstance(vendor_id, str) or day is None:
            continue
        medium = ie.get("medium")
        out.append(Buy(vendor_id, day, float(ie["amount"]), medium if isinstance(medium, str) else None))
    return out


def _vendor_rows(entity: JsonDict) -> dict[str, JsonDict]:
    vendors = entity.get("vendors")
    if not isinstance(vendors, list):
        return {}
    return {str(v["vendor_id"]): v for v in vendors if isinstance(v, dict)}


def _dominant_medium(buys: list[Buy], vendor: JsonDict) -> str:
    by_medium: Counter[str] = Counter()
    for b in buys:
        if b.medium:
            by_medium[b.medium] += b.amount
    if by_medium:
        return by_medium.most_common(1)[0][0]
    mix = vendor.get("media_mix", [])
    if isinstance(mix, list) and mix:
        top = max((m for m in mix if isinstance(m, dict)), key=lambda m: float(m["amount"]))
        return str(top["medium"])
    return "other"


# Media that can have placed or produced a Google creative. A same-window TV, mail or phone buy cannot have, so it is not
# listed next to the ad at all; `other` is kept because it means "purpose string unclassified", not "not digital".
PLACEABLE_MEDIA = frozenset({"digital", "production", "other"})


def _placeable(buys: list[Buy]) -> list[Buy]:
    """Buy by buy, not by the vendor's dominant medium: a firm's TV dollars in the window neither hide nor inflate its digital ones."""
    return [b for b in buys if b.medium is None or b.medium in PLACEABLE_MEDIA]


def _buys_in_window(ad: JsonDict, entity: JsonDict) -> tuple[dict[str, list[Buy]], date | None, date | None] | None:
    """Sponsor buys per vendor dated in [first_shown - WINDOW_LEAD_DAYS, last_shown]; empty when the ad has no dates."""
    vendors = _vendor_rows(entity)
    if not vendors:
        return None
    first, last = _iso(ad.get("first_shown")), _iso(ad.get("last_shown"))
    in_win: dict[str, list[Buy]] = {}
    if first is not None and last is not None:
        for b in sponsor_buys(entity):
            if b.vendor_id in vendors and in_window(b.day, first, last):
                in_win.setdefault(b.vendor_id, []).append(b)
    return in_win, first, last


def same_window_buys(ad: JsonDict, entity: JsonDict) -> list[JsonDict]:
    """Every vendor the sponsor paid for placeable media inside the ad's window, by those dollars. Context for the reader
    ("in the week before and while this ad ran, the sponsor reported digital buys to A and B"); carries no basis because it
    asserts no relationship. Amount, count and medium come from the placeable buys only."""
    found = _buys_in_window(ad, entity)
    if found is None:
        return []
    in_win, _, _ = found
    vendors = _vendor_rows(entity)
    rows: list[JsonDict] = []
    for vendor_id, all_buys in in_win.items():
        buys = _placeable(all_buys)
        if not buys:
            continue
        vendor = vendors[vendor_id]
        medium = _dominant_medium(buys, vendor)
        if medium not in PLACEABLE_MEDIA:
            continue
        rows.append(
            {
                "vendor_id": vendor_id,
                "vendor_name": str(vendor["name"]),
                "medium": medium,
                "amount_in_window": round(sum(b.amount for b in buys), 2),
                "buys_in_window": len(buys),
                "source_url": str(vendor["source_url"]),
            }
        )
    return sorted(rows, key=lambda r: (-float(str(r["amount_in_window"])), str(r["vendor_id"])))


def vendor_links(ad: JsonDict, entity: JsonDict, hand_links: dict[tuple[str, str], JsonDict]) -> list[JsonDict]:
    """One link per vendor joined to the ad by a person (verified) or by the only-digital-vendor rule (inferred), verified
    first, then by dollars in the window. A vendor that merely overlaps the ad in time gets no link (D-74)."""
    found = _buys_in_window(ad, entity)
    if found is None:
        return []
    in_win, first, last = found
    vendors = _vendor_rows(entity)
    sponsor = str(entity.get("name") or ad["advertiser_name"])
    ad_id = str(ad["ad_id"])
    digital_vendors = {vid for vid, buys in in_win.items() if any(b.medium == "digital" for b in buys)}
    window = [first.isoformat(), last.isoformat()] if first is not None and last is not None else None
    window_text = (
        f"Ran {_human(first)} – {_human(last)}" if first is not None and last is not None else "Run dates not reported"
    )
    # A verified pair rests on its source, not on a dated payment: it is kept even when no buy falls in the window.
    hand_vendors = {vid for (aid, vid) in hand_links if aid == ad_id and vid in vendors}
    links: list[JsonDict] = []
    for vendor_id in set(in_win) | hand_vendors:
        vendor = vendors[vendor_id]
        vendor_name = str(vendor["name"])
        buys = _placeable(in_win.get(vendor_id, []))
        amount = round(sum(b.amount for b in buys), 2)
        medium = _dominant_medium(buys, vendor)
        source_urls = [str(vendor["source_url"])]
        hand = hand_links.get((ad_id, vendor_id))
        basis: JsonDict
        if hand is not None:
            role = str(hand["role"]).replace("_", " ")
            quote = hand.get("quote")
            paid = (
                f"{sponsor} reported ${amount:,.0f} in {medium} buys to {vendor_name} in that window"
                if buys
                else f"no {sponsor} payment to {vendor_name} for placeable media is dated in that window"
            )
            basis = {
                "basis": "verified",
                "rule": f"{vendor_name} {role} this ad for {sponsor} — a source names both sides"
                + (f': "{quote}"' if isinstance(quote, str) and quote else "")
                + f". {window_text}; {paid}.",
                "source_urls": list(hand["source_urls"]),
                "checked_by": hand["tagged_by"],
                "checked_at": hand["tagged_at"],
            }
        elif digital_vendors == {vendor_id}:
            basis = {
                "basis": "inferred",
                "rule": f"Only digital vendor {sponsor} paid during this ad's run window ({window_text.lower()}, counting "
                f"buys dated up to {WINDOW_LEAD_DAYS} days before first shown) — inferred, not filed. {sponsor} reported "
                f"${amount:,.0f} in {medium} buys to {vendor_name}; Google ads are digital placements.",
                "source_urls": source_urls,
                "checked_by": None,
                "checked_at": None,
            }
        else:
            continue
        links.append(
            {
                "vendor_id": vendor_id,
                "vendor_name": vendor_name,
                "medium": medium,
                "window": window,
                "amount_in_window": amount,
                "buys_in_window": len(buys),
                "basis": basis,
            }
        )
    return sorted(links, key=_link_order)


_BASIS_ORDER = {"verified": 0, "inferred": 1}


def _link_order(link: JsonDict) -> tuple[int, float, str]:
    basis = link["basis"]
    assert isinstance(basis, dict)
    return _BASIS_ORDER[str(basis["basis"])], -float(str(link["amount_in_window"])), str(link["vendor_id"])


def patch_vendor_ads(vendor: JsonDict, ad_id: str, sponsor_entity_id: str, basis: JsonDict) -> bool:
    """Replace this ad's entry in vendor.ads[] (dedupe on ad_id); returns True when the file content changed."""
    existing = vendor.get("ads")
    ads: list[JsonDict] = [a for a in existing if isinstance(a, dict)] if isinstance(existing, list) else []
    entry: JsonDict = {"ad_id": ad_id, "sponsor_entity_id": sponsor_entity_id, "basis": basis}
    new = [entry if a.get("ad_id") == ad_id else a for a in ads]
    if not any(a.get("ad_id") == ad_id for a in ads):
        new.append(entry)
    if new == ads:
        return False
    vendor["ads"] = new
    return True


def prune_vendor_ads(vendor: JsonDict, linked_ad_ids: set[str]) -> bool:
    """Drop vendor.ads[] rows for ads that no longer link to this vendor; returns True when the file content changed."""
    existing = vendor.get("ads")
    if not isinstance(existing, list):
        return False
    kept = [a for a in existing if isinstance(a, dict) and a.get("ad_id") in linked_ad_ids]
    if len(kept) == len(existing):
        return False
    vendor["ads"] = kept
    return True


# ---------------------------------------------------------------------------
# orchestration


def _strip_enrich_notes(notes: object) -> list[str]:
    return [n for n in notes if isinstance(n, str) and not n.startswith(NOTE_PREFIX)] if isinstance(notes, list) else []


def enrich_notes(c: EnrichCounts, tagger_count: int) -> list[str]:
    links_total = sum(c.links_by_basis.values())
    by_basis = ", ".join(f"{c.links_by_basis[b]} {b}" for b in ("verified", "inferred"))
    vendor_note = (
        f"{c.sponsors_with_vendors} sponsor committees carry vendor rows (campaign_commons.vendors); {c.sponsors_without_vendors} do not, "
        "so their ads have no vendor links yet."
        if c.sponsors_with_vendors
        else "No sponsor committee carries vendor rows yet (campaign_commons.vendors has not run), so no ad has vendor links."
    )
    return [
        NOTE_PREFIX
        + f"{c.with_shares} of {c.ads} ads carry sponsor_visibility_shares, copied from the sponsor committee's "
        "chain summary; the dark share is the fraction of the sponsor's traced receipts that stopped at an organization with "
        "no donor-disclosure obligation. It describes the sponsor's funding, not this ad.",
        NOTE_PREFIX
        + f"{c.tagged} of {c.ads} ads carry issue tags; each was tagged by a person who read or watched the creative "
        f"at its ad-library URL ({tagger_count} hand-tagged rows in data/hand). Untagged ads are not 'about nothing'; nobody "
        "has tagged them.",
        NOTE_PREFIX
        + f"{c.machine_tagged} of {c.ads} ads carry optional machine transcript issue tags; these are labelled inferred "
        "until a human accepts them and never replace human issue tags.",
        NOTE_PREFIX
        + WINDOW_RULE
        + f" {c.ads_with_same_window_buys} of {c.ads} ads list same_window_buys ({c.same_window_buys} vendor rows): digital, "
        "production or unclassified buys in the window (a TV, mail or phone buy cannot have placed a Google ad). These are "
        "context, not links; the FEC does not record which buy placed which ad, so date overlap alone is never drawn as a "
        f"vendor-to-ad relationship (D-74). {links_total} vendor links ({by_basis}): 'inferred' means the sponsor paid exactly "
        "one digital vendor in the window; 'verified' means a person found a source naming both the sponsor and the vendor "
        "for this creative. " + vendor_note,
    ]


def enrich(
    gallery: JsonDict,
    chains: dict[str, JsonDict],
    entities: dict[str, JsonDict],
    vendors: dict[str, JsonDict],
    ad_issues: JsonDict,
    vendor_ad_links: JsonDict,
    x_ad_issues: JsonDict | None = None,
) -> tuple[EnrichCounts, set[str]]:
    """Mutate gallery (and vendors) in place; returns counts and the ids of vendor files that changed."""
    ads = gallery["ads"]
    assert isinstance(ads, list)
    issue_rows = {str(r["ad_id"]): r for r in _rows(ad_issues)}
    machine_rows = {str(r["ad_id"]): r for r in _rows(x_ad_issues or {})}
    hand_links = {(str(r["ad_id"]), str(r["vendor_id"])): r for r in _rows(vendor_ad_links)}
    counts = EnrichCounts(ads=len(ads))
    seen_sponsors: dict[str, bool] = {}
    changed_vendors: set[str] = set()
    linked: dict[str, set[str]] = {vendor_id: set() for vendor_id in vendors}
    ad_ids = {str(a["ad_id"]) for a in ads}
    counts.untagged_rows = sorted(set(issue_rows) - ad_ids)
    for ad in ads:
        sponsor_id = ad.get("matched_entity_id")
        entity = entities.get(sponsor_id) if isinstance(sponsor_id, str) else None
        ad["sponsor_visibility_shares"] = (
            sponsor_shares(chains.get(sponsor_id)) if isinstance(sponsor_id, str) else None
        )
        if ad["sponsor_visibility_shares"] is not None:
            counts.with_shares += 1
        row = issue_rows.get(str(ad["ad_id"]))
        ad.pop("issues", None)
        ad.pop("machine_issues", None)
        ad.pop("vendor_links", None)
        ad.pop("same_window_buys", None)
        if row is not None:
            ad["issues"] = issue_tags(row, str(ad["creative_url"]))
            counts.tagged += 1
        machine = machine_issue_tags(machine_rows.get(str(ad["ad_id"])))
        if machine is not None:
            ad["machine_issues"] = machine
            counts.machine_tagged += 1
        buys = same_window_buys(ad, entity) if entity is not None else []
        ad["same_window_buys"] = buys
        if buys:
            counts.ads_with_same_window_buys += 1
            counts.same_window_buys += len(buys)
        links = vendor_links(ad, entity, hand_links) if entity is not None else []
        ad["vendor_links"] = links
        if isinstance(sponsor_id, str) and entity is not None:
            seen_sponsors[sponsor_id] = bool(_vendor_rows(entity))
        for link in links:
            basis = link["basis"]
            assert isinstance(basis, dict)
            counts.links_by_basis[str(basis["basis"])] += 1
            vendor_id = str(link["vendor_id"])
            vendor = vendors.get(vendor_id)
            if vendor is not None:
                linked[vendor_id].add(str(ad["ad_id"]))
                if patch_vendor_ads(vendor, str(ad["ad_id"]), str(sponsor_id), basis):
                    changed_vendors.add(vendor_id)
    for vendor_id, vendor in vendors.items():
        if prune_vendor_ads(vendor, linked[vendor_id]):
            changed_vendors.add(vendor_id)
    counts.sponsors_with_vendors = sum(1 for has in seen_sponsors.values() if has)
    counts.sponsors_without_vendors = sum(1 for has in seen_sponsors.values() if not has)
    counts.vendor_files_patched = len(changed_vendors)
    gallery["notes"] = _strip_enrich_notes(gallery.get("notes")) + enrich_notes(counts, len(issue_rows))
    return counts, changed_vendors


def _load_dir(dir_path: Path, ids: set[str]) -> dict[str, JsonDict]:
    out: dict[str, JsonDict] = {}
    for entity_id in ids:
        p = dir_path / f"{entity_id}.json"
        if p.exists():
            loaded = read_json(p)
            if isinstance(loaded, dict):
                out[entity_id] = loaded
    return out


def run(race_id: str) -> None:
    race = RACES[race_id]
    ads_path = race.out_dir / "ads.json"
    gallery = read_json(ads_path)
    sponsor_ids = {str(a["matched_entity_id"]) for a in gallery["ads"] if a.get("matched_entity_id")}
    chains = _load_dir(race.out_dir / "chains", sponsor_ids)
    entities = _load_dir(race.out_dir / "entities", sponsor_ids)
    vendors_dir = race.out_dir / "vendors"
    vendors = {p.stem: read_json(p) for p in sorted(vendors_dir.glob("*.json"))} if vendors_dir.exists() else {}
    hand_dir = ROOT / "data" / "hand" / race_id
    counts, changed = enrich(
        gallery,
        chains,
        entities,
        vendors,
        load_hand(hand_dir / "ad_issues.json"),
        load_hand(hand_dir / "vendor_ad_links.json"),
        load_hand(hand_dir / "x_ad_issues.json"),
    )
    write_json(ads_path, gallery)
    for vendor_id in sorted(changed):
        write_json(vendors_dir / f"{vendor_id}.json", vendors[vendor_id])
    for ad_id in counts.untagged_rows:
        print(f"WARN ad_issues.json row {ad_id} matches no ad in ads.json")
    print(
        f"{counts.ads} ads: {counts.with_shares} with sponsor shares, {counts.tagged} tagged, "
        f"{counts.machine_tagged} with machine issue tags, "
        f"{counts.ads_with_same_window_buys} with same-window buys ({counts.same_window_buys} rows), "
        f"links {dict(counts.links_by_basis)} ({counts.sponsors_with_vendors} sponsors with vendor rows, "
        f"{counts.sponsors_without_vendors} without), {counts.vendor_files_patched} vendor files patched"
    )


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
