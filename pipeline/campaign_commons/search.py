"""search.json: one static, client-side index over every page the web app renders (Block 2).

No race argument: every race that has a directory under data/out is indexed into a single file. Items are built only
from artifacts already in data/out (races.json, ledger.json, entities/, donors/, dossiers/, vendors.json), so the index
never knows more than the pages do. Hrefs mirror `routes.*` in web/src/lib/format.ts; `weight` is dollars (see D-62).

Kept small on purpose (compact JSON, no descriptions, aliases capped at MAX_ALIASES): the browser fetches the whole file
once on first focus of the search box.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TypedDict

from .config import OUT
from .util import now_iso, read_json

MAX_ALIASES = 8
PARTY_LABELS = {
    "DEM": "Democrat",
    "REP": "Republican",
    "LIB": "Libertarian",
    "GRE": "Green",
    "IND": "Independent",
    "CON": "Constitution",
    "OTH": "Other",
}
OFFICE_TITLES = {"S": "Sen.", "H": "Rep."}


class SearchItem(TypedDict):
    id: str
    kind: str
    race_id: str | None
    label: str
    sublabel: str | None
    aliases: list[str]
    href: str
    weight: int  # whole dollars: a ranking tiebreak, not a figure anyone reads


# --- routes: keep in lock-step with web/src/lib/format.ts `routes` ---------------------------------------------------


def race_href(race_id: str) -> str:
    return f"/races/{race_id}"


def entity_href(race_id: str, entity_id: str) -> str:
    return f"/races/{race_id}/entities/{entity_id}"


def candidate_href(race_id: str, candidate_id: str) -> str:
    return f"/races/{race_id}/candidates/{candidate_id}"


def donor_href(race_id: str, donor_key: str) -> str:
    return f"/races/{race_id}/donors/{donor_key}"


def vendor_href(race_id: str, vendor_id: str) -> str:
    return f"/races/{race_id}/vendors/{vendor_id}"


# --- helpers ---------------------------------------------------------------------------------------------------------


def money_short(n: float) -> str:
    """Mirrors web `money()` compact form so sublabels read like the pages."""
    if abs(n) >= 1_000_000:
        return f"${n / 1_000_000:.0f}M" if n >= 10_000_000 else f"${n / 1_000_000:.1f}M"
    if abs(n) >= 1_000:
        return f"${n / 1_000:.0f}K"
    return f"${n:,.0f}"


def natural_order(filed_name: str) -> str:
    """FEC files people as "LAST, FIRST M"; users type "First Last". Names without a comma are returned unchanged."""
    if "," not in filed_name:
        return filed_name
    last, rest = filed_name.split(",", 1)
    return f"{rest.strip()} {last.strip()}".strip()


def cap_aliases(label: str, candidates: list[str]) -> list[str]:
    """Distinct, non-empty aliases that differ from the label (case-insensitive), first MAX_ALIASES."""
    seen = {label.strip().lower()}
    out: list[str] = []
    for a in candidates:
        key = a.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(a.strip())
        if len(out) == MAX_ALIASES:
            break
    return out


def _json_files(directory: Path) -> list[Path]:
    return sorted(directory.glob("*.json")) if directory.is_dir() else []


# --- per-kind builders -----------------------------------------------------------------------------------------------


def race_items(race: dict, ledger: dict | None, dossiers: set[str]) -> list[SearchItem]:
    """The race itself plus its candidates; a candidate links to its dossier only when that page exists."""
    race_id = race["race_id"]
    totals = race["totals"]
    weight = float(totals["campaign_receipts"]) + float(totals["outside_spending"])
    items: list[SearchItem] = [
        SearchItem(
            id=race_id,
            kind="race",
            race_id=race_id,
            label=race["label"],
            sublabel=f"Race · {money_short(totals['outside_spending'])} outside spending",
            aliases=cap_aliases(race["label"], [f"{race['state']} Senate {race['cycle']}", race_id]),
            href=race_href(race_id),
            weight=round(weight),
        )
    ]
    ledger_by_candidate = {c["candidate_id"]: c for c in (ledger or {}).get("candidates", [])}
    for c in race["candidates"]:
        cid = c["candidate_id"]
        led = ledger_by_candidate.get(cid)
        cand_weight = float(led["campaign"]["receipts"]) + float(led["outside"]["total"]) if led else 0.0
        last = c["name"].split()[-1]
        title = OFFICE_TITLES.get(race["office"]) if c["incumbent"] else None
        aliases = [last, cid, c["principal_committee_id"]]
        if title:
            aliases.insert(1, f"{title} {last}")
        items.append(
            SearchItem(
                id=cid,
                kind="candidate",
                race_id=race_id,
                label=c["name"],
                sublabel=f"{PARTY_LABELS.get(c['party'], c['party'])} · {'incumbent' if c['incumbent'] else 'challenger'}",
                aliases=cap_aliases(c["name"], aliases),
                href=candidate_href(race_id, cid) if cid in dossiers else race_href(race_id),
                weight=round(cand_weight),
            )
        )
    return items


def entity_weight(entity: dict) -> float:
    totals = entity["totals"]
    receipts = float(totals.get("receipts", 0.0))
    ies = float(totals.get("independent_expenditures", 0.0))
    if receipts and ies:
        return receipts + ies
    return max(receipts, ies, float(totals.get("disbursements", 0.0)))


def entity_item(entity: dict) -> SearchItem | None:
    """Committees (and conduits, which are FEC committees) -> `committee`; org entities -> `organization`; else skipped."""
    kind = entity["kind"]
    if kind in ("committee", "conduit"):
        search_kind = "committee"
    elif kind == "organization":
        search_kind = "organization"
    else:
        return None
    race_id = entity["race_id"]
    entity_id = entity["entity_id"]
    parts = [entity.get("committee_type_label") or ("Organization" if search_kind == "organization" else "Committee")]
    if entity.get("has_chain"):
        parts.append("chain")
    return SearchItem(
        id=entity_id,
        kind=search_kind,
        race_id=race_id,
        label=entity["name"],
        sublabel=" · ".join(parts),
        aliases=cap_aliases(entity["name"], [*entity.get("aliases", []), entity_id]),
        href=entity_href(race_id, entity_id),
        weight=round(entity_weight(entity)),
    )


def donor_item(view: dict) -> SearchItem:
    """Donor views cover individuals and organizations; organizations surface under `organization` so the group reads right."""
    race_id = view["race_id"]
    is_org = view["kind"] == "organization"
    given = float(view["total_given"])
    zip5 = view["donor_id"].rsplit("|", 1)[1][:5] if "|" in view["donor_id"] else None
    head = "Organization donor" if is_org else "Individual donor"
    where = f" · ZIP {zip5}" if zip5 else ""
    return SearchItem(
        id=view["donor_id"],
        kind="organization" if is_org else "donor",
        race_id=race_id,
        label=view["name"],
        sublabel=f"{head}{where} · {money_short(given)} itemized",
        aliases=cap_aliases(view["name"], [natural_order(view["name"])]),
        href=donor_href(race_id, view["donor_key"]),
        weight=round(given),
    )


def vendor_item(race_id: str, vendor: dict) -> SearchItem:
    total = float(vendor["total"])
    mix = sorted(vendor.get("media_mix", []), key=lambda m: -float(m["amount"]))
    top = f"{mix[0]['medium']} · " if mix else ""
    return SearchItem(
        id=vendor["vendor_id"],
        kind="vendor",
        race_id=race_id,
        label=vendor["name"],
        sublabel=f"Vendor · {top}{money_short(total)} paid",
        aliases=cap_aliases(vendor["name"], list(vendor.get("aliases", []))),
        href=vendor_href(race_id, vendor["vendor_id"]),
        weight=round(total),
    )


# --- assembly --------------------------------------------------------------------------------------------------------


def _optional(path: Path) -> dict | None:
    return read_json(path) if path.exists() else None


def build_items(out: Path = OUT) -> list[SearchItem]:
    races_index = _optional(out / "races.json")
    if races_index is None:
        print(f"skip: {out / 'races.json'} missing; nothing to index")
        return []
    items: list[SearchItem] = []
    for race in races_index["races"]:
        race_id = race["race_id"]
        race_dir = out / race_id
        if not race_dir.is_dir():
            print(f"skip {race_id}: no data directory (stub race, no pages)")
            continue
        dossiers = {p.stem for p in _json_files(race_dir / "dossiers")}
        items.extend(race_items(race, _optional(race_dir / "ledger.json"), dossiers))
        for path in _json_files(race_dir / "entities"):
            item = entity_item(read_json(path))
            if item is not None:
                items.append(item)
        for path in _json_files(race_dir / "donors"):
            items.append(donor_item(read_json(path)))
        vendors = _optional(race_dir / "vendors.json")
        if vendors is None:
            print(
                f"note {race_id}: vendors.json not present; no vendor items (run `make vendors` first to include them)"
            )
        else:
            items.extend(vendor_item(race_id, v) for v in vendors["vendors"])
    return dedupe_and_rank(items)


def dedupe_and_rank(items: list[SearchItem]) -> list[SearchItem]:
    """One row per (kind, id) — first wins — then heaviest first; ties break on label so output is deterministic."""
    seen: set[tuple[str, str]] = set()
    unique: list[SearchItem] = []
    for it in items:
        key = (it["kind"], it["id"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)
    unique.sort(key=lambda it: (-it["weight"], it["label"].lower(), it["kind"]))
    return unique


def build_index(out: Path = OUT) -> dict:
    return {"generated_at": now_iso(), "data_status": "real", "items": build_items(out)}


def write_index(index: dict, path: Path) -> int:
    """Compact JSON (no indent): the file is fetched by the browser, not read by people."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(index, separators=(",", ":"), ensure_ascii=False) + "\n"
    path.write_text(text)
    size = len(text.encode("utf-8"))
    print(f"wrote {path} ({size / 1024:.0f} KB)")
    return size


def main(out: Path = OUT) -> int:
    index = build_index(out)
    counts: dict[str, int] = {}
    for it in index["items"]:
        counts[it["kind"]] = counts.get(it["kind"], 0) + 1
    write_index(index, out / "search.json")
    print(f"{len(index['items'])} items: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
