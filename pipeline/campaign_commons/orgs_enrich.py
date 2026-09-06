"""Read unknown Schedule A organizations with Grok's live web search and keep only quoted, fetched evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import requests

from .config import DATA, RACES, RAW, XAI_API_KEY, XAI_ORGS_MODEL
from .issues_enrich import Page, fetch_pages, normalize
from .ledger import Tables
from .orgs import _norm, classify_organization, load_org_overrides
from .util import now_iso, read_json, write_json

SYSTEM = (
    "You classify an organization that appears as a contributor in a US Federal Election Commission filing, by what "
    "kind of entity it is and therefore whether the people behind its money are publicly known. Classes: union (labor "
    "union; dues-funded), business (an operating company, bank, corporation or trade business giving from its own "
    "revenue), llc (LLC, LP, LLP, trust or holding vehicle whose owners are not on file), nonprofit (501(c)(4)/(c)(6)/527 "
    "advocacy or social-welfare group, association, or any group that does not disclose donors), unknown (you cannot "
    "establish which). Use web search. Return the class, one URL of a page that establishes it (the organization's own "
    "site, SEC/state registry, IRS listing or a reputable news/reference page), and a verbatim quote of at most 200 "
    "characters copied exactly from that page that shows what the organization is. If you cannot find such a page, "
    "return unknown with empty url and quote. Never guess from the name alone."
)
ALLOWED_CLASSES = {"union", "business", "llc", "nonprofit"}
SCHEMA = {
    "type": "object",
    "properties": {
        "org_class": {"type": "string", "enum": ["union", "business", "llc", "nonprofit", "unknown"]},
        "source_url": {"type": "string"},
        "quote": {"type": "string"},
    },
    "required": ["org_class", "source_url", "quote"],
    "additionalProperties": False,
}


def _cache_path(race_id: str, name: str, amount: float, committee_id: str, cycle: int) -> Path:
    key = f"{name}|{amount:.2f}|{committee_id}|{cycle}"
    digest = hashlib.sha1(key.encode()).hexdigest()
    return RAW / "orgs_enrich" / race_id / f"{digest}.json"


def _content(payload: dict[str, Any]) -> str | dict[str, Any]:
    for item in payload.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                return content.get("text", "")
    return ""


def _parse_classification(payload: dict[str, Any]) -> dict[str, str]:
    content = _content(payload)
    parsed = json.loads(content) if isinstance(content, str) else content
    if not isinstance(parsed, dict):
        raise ValueError("model response did not contain an object")
    return {
        "org_class": str(parsed.get("org_class", "unknown")),
        "source_url": str(parsed.get("source_url", "")),
        "quote": str(parsed.get("quote", "")),
    }


def model_classification(
    race_id: str,
    name: str,
    amount: float,
    recipient_name: str,
    committee_id: str,
    cycle: int,
    refetch: bool = False,
) -> dict[str, str]:
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY is not set")
    cache = _cache_path(race_id, name, amount, committee_id, cycle)
    if cache.exists() and not refetch:
        return _parse_classification(read_json(cache))
    user = (
        f"Organization name as filed: {name}\n"
        f"Context: it is recorded as giving ${amount:,.0f} to {recipient_name} ({committee_id}) in the {cycle} cycle."
    )
    response = requests.post(
        "https://api.x.ai/v1/responses",
        headers={"Authorization": f"Bearer {XAI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": XAI_ORGS_MODEL,
            "input": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            "tools": [{"type": "web_search"}],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "organization_classification",
                    "schema": SCHEMA,
                    "strict": True,
                }
            },
            "temperature": 0,
            "reasoning": {"effort": "low"},
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(payload, ensure_ascii=False) + "\n")
    return _parse_classification(payload)


def guard_classification(row: dict[str, Any], pages: list[Page]) -> dict[str, Any] | None:
    org_class = row.get("org_class")
    quote = row.get("quote")
    source_url = row.get("source_url")
    if org_class not in ALLOWED_CLASSES or not isinstance(source_url, str) or not source_url:
        return None
    if not isinstance(quote, str) or not quote.strip() or len(quote) > 200:
        return None
    normalized_quote = normalize(quote)
    for page in pages:
        if normalize(page.text).find(normalized_quote) >= 0:
            return {**row, "source_url": page.url, "quote": quote}
    return None


def collect_unknown(tables: Tables, min_amount: float) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for cid in tables.committees.index:
        _, orgs, _ = tables.sched_a_split(str(cid))
        for row in orgs.itertuples():
            name = str(row.NAME)
            if classify_organization(name) != "unknown":
                continue
            amount = float(row.TRANSACTION_AMT)
            if amount <= 0:
                continue
            key = " ".join(name.upper().split())
            current = by_name.setdefault(
                key,
                {
                    "name": name,
                    "amount": 0.0,
                    "recipient_name": str(tables.committees.loc[cid, "CMTE_NM"]),
                    "committee_id": str(cid),
                },
            )
            current["amount"] += amount
            if amount > current.get("_largest", 0.0):
                current["_largest"] = amount
                current["recipient_name"] = str(tables.committees.loc[cid, "CMTE_NM"])
                current["committee_id"] = str(cid)
    return [
        {k: v for k, v in row.items() if k != "_largest"}
        for row in sorted(by_name.values(), key=lambda item: item["amount"], reverse=True)
        if row["amount"] >= min_amount
    ]


def run(race_id: str, limit: int | None = None, min_amount: float = 10_000, refetch: bool = False) -> dict[str, Any]:
    race = RACES[race_id]
    tables = Tables(race)
    candidates = collect_unknown(tables, min_amount)
    if limit is not None:
        candidates = candidates[:limit]
    overrides = load_org_overrides(race_id)
    classes: list[dict[str, Any]] = []
    dropped = 0
    for candidate in candidates:
        if _norm(candidate["name"]) in overrides:
            continue
        try:
            model = model_classification(
                race_id,
                candidate["name"],
                candidate["amount"],
                candidate["recipient_name"],
                candidate["committee_id"],
                race.cycle,
                refetch=refetch,
            )
            pages = fetch_pages(race_id, f"org:{candidate['name']}", [model.get("source_url", "")])
            kept = guard_classification(model, pages)
        except Exception as exc:
            print(f"{candidate['name']}: enrichment failed: {exc}", file=sys.stderr)
            kept = None
        if kept is None:
            dropped += 1
            continue
        classes.append(
            {
                "name": candidate["name"],
                "org_class": kept["org_class"],
                "basis": "inferred",
                "source_url": kept["source_url"],
                "quote": kept["quote"],
                "tagged_by": XAI_ORGS_MODEL,
                "amount": round(candidate["amount"], 2),
            }
        )
    result = {
        "race_id": race_id,
        "generated_at": now_iso(),
        "classes": sorted(classes, key=lambda row: str(row["name"]).upper()),
    }
    write_json(DATA / "hand" / race_id / "org_classes_model.json", result)
    moved = sum(float(row["amount"]) for row in classes)
    print(
        f"org_classes: unknown {len(candidates)}, classified {len(classes)}, dropped-unverified {dropped}, "
        f"dollars moved out of dark ${moved:,.2f}"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--min-amount", type=float, default=10_000)
    parser.add_argument("--refetch", action="store_true")
    args = parser.parse_args()
    run(args.race, limit=args.limit, min_amount=args.min_amount, refetch=args.refetch)


if __name__ == "__main__":
    main()
