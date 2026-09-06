"""trails.json: precomputed plain-English "Money Trails" answers (D-73).

Three questions, answered from artifacts other stages already wrote (ledger.json, ads.json, chains/*.json,
entities/*.json) — no LLM, no graph database, no new FEC reads:

  candidate_spender     "who is spending against Casey?"    Schedule E spenders for/against the candidate
  candidate_ad_funding  "who paid for the ads about Casey?" sponsors that ran ads, their Schedule E about the
                                                            candidate, and who funds each sponsor
  committee_funding     "who funds WINSENATE?"              the committee's receipts hop by hop, where the walk ended

The web layer (web/src/components/ask, D-75) resolves a typed question to (intent, subject) — a server-side model
picks from the closed set of intents and `subjects[].id`, else keyword and name matching over `subjects[].aliases`
in the browser — then renders the matching answer. Rules the shape enforces:

  * every number is a Figure / edge / range that carries the record it came from;
  * money edges (`TrailMoneyEdge`) and targeting edges (`TrailTargetingEdge`) are different types, so an
    independent expenditure is never drawn as dollars reaching a candidate;
  * ads hang off their *sponsor* (`TrailAdRun`) and funders hang off the sponsor too; there is no field that
    joins a funder to an ad, and the caveats say why (pooled dollars).
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import RACES, Race
from .util import (
    fec_ie_candidate_url,
    fec_receipts_url,
    now_iso,
    read_json,
    write_json,
)

TOP_FUNDERS = 10
TOP_NEXT_HOP = 8
TOP_ULTIMATE = 8
SPONSOR_FUNDERS = 5
NEXT_HOP_PARENTS = 3
GOOGLE_ADVERTISER_URL = "https://adstransparency.google.com/advertiser/{advertiser_id}?political=&region=US"
NAME_SUFFIXES = ("inc", "inc.", "llc", "l.l.c.", "corp", "co", "pac", "committee")

POOLED_NOTE = (
    "Money that reaches a committee is pooled. A funder listed here gave to the sponsor's account as a whole; none of "
    "them can be said to have paid for any particular ad."
)
TARGETING_NOTE = (
    '"Spent against" and "spent for" are independent expenditures (FEC Schedule E): the spender\'s own declaration '
    "about a candidate, paid to the spender's vendors. None of this money reaches the candidate."
)
GOOGLE_RANGE_NOTE = (
    "Ad spend is the bucketed range Google publishes per ad, summed across the sponsor's ads; it is a platform estimate, "
    "not a filed figure, and is never added to FEC dollars."
)
CHAIN_NOTE = (
    '"Reaches named people or organizations" and "stops at groups that do not disclose" are the visibility shares '
    "from this committee's multi-hop chain walk; the walk's full method, caps and dead ends are on its chain page."
)
GOOGLE_TARGET_NOTE = (
    "Google does not record which candidate an outside group's ad is about. Ads are attributed to their sponsor by the "
    "advertiser name, and the sponsor to the candidate by its own Schedule E filings; an individual ad may be about "
    "someone else."
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _money(n: float) -> str:
    if abs(n) >= 1_000_000:
        return f"${n / 1_000_000:.1f}M" if n < 10_000_000 else f"${n / 1_000_000:.0f}M"
    if abs(n) >= 1_000:
        return f"${n / 1_000:.0f}K"
    return f"${n:,.0f}"


def _pct(share: float) -> str:
    return f"{share * 100:.0f}%"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s.lower())).strip()


def name_aliases(name: str, extra: list[str] | None = None) -> list[str]:
    """Lower-cased strings the client parser will accept for a subject: the name, punctuation-free, suffix-stripped."""
    out: list[str] = []

    def add(s: str) -> None:
        s = _norm(s)
        if len(s) >= 3 and s not in out:
            out.append(s)

    add(name)
    head, _, tail = name.partition("(")
    if tail:
        add(head)
        add(tail.split(")")[0])
    head = re.split(r"\b(?:dba|d/b/a)\b", head, flags=re.IGNORECASE)[0]
    tokens = _norm(head).split()
    while tokens and tokens[-1] in NAME_SUFFIXES:
        tokens = tokens[:-1]
        if tokens:
            add(" ".join(tokens))
    for a in extra or []:
        add(a)
    return out


def _kind_from_id(node_id: str) -> str:
    if node_id.startswith("ind:"):
        return "individual"
    if node_id.startswith("org:"):
        return "organization"
    if node_id.startswith("agg:") or node_id.startswith("other:"):
        return "aggregate"
    return "committee"


@dataclass(frozen=True)
class Inputs:
    race: Race
    ledger: dict[str, Any]
    ads: dict[str, Any]
    chains: dict[str, dict[str, Any]]  # entity_id -> chains/<id>.json
    entities: dict[str, dict[str, Any]]  # entity_id -> entities/<id>.json

    @property
    def cycle(self) -> int:
        return self.race.cycle

    def spender(self, entity_id: str) -> dict[str, Any] | None:
        return next((s for s in self.ledger["top_outside_spenders"] if s["entity_id"] == entity_id), None)

    def candidate_name(self, candidate_id: str) -> str:
        return next((c.name for c in self.race.candidates if c.candidate_id == candidate_id), candidate_id)


# ---------------------------------------------------------------------------
# edges
# ---------------------------------------------------------------------------


def targeting_edge(inp: Inputs, spender: dict[str, Any], by_cand: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "targeting",
        "spender_id": spender["entity_id"],
        "spender_name": spender["name"],
        "spender_type_label": spender["committee_type_label"],
        "candidate_id": by_cand["candidate_id"],
        "candidate_name": inp.candidate_name(by_cand["candidate_id"]),
        "support_oppose": by_cand["support_oppose"],
        "amount": by_cand["amount"],
        "has_chain": bool(spender["has_chain"]),
        "source_url": fec_ie_candidate_url(spender["entity_id"], by_cand["candidate_id"], inp.cycle),
    }


def targeting_for_candidate(inp: Inputs, candidate_id: str) -> list[dict[str, Any]]:
    edges = [
        targeting_edge(inp, s, bc)
        for s in inp.ledger["top_outside_spenders"]
        for bc in s["by_candidate"]
        if bc["candidate_id"] == candidate_id and bc["amount"] > 0
    ]
    return sorted(edges, key=lambda e: (-e["amount"], e["spender_id"]))


def targeting_for_spender(inp: Inputs, entity_id: str) -> list[dict[str, Any]]:
    s = inp.spender(entity_id)
    if s is None:
        return []
    edges = [targeting_edge(inp, s, bc) for bc in s["by_candidate"] if bc["amount"] > 0]
    return sorted(edges, key=lambda e: (-e["amount"], e["candidate_id"]))


def _chain_money_edges(chain: dict[str, Any], to_id: str) -> list[dict[str, Any]]:
    """Money edges into one node of a chain file, largest first."""
    nodes = {n["id"]: n for n in chain["nodes"]}
    to = nodes.get(to_id)
    if to is None:
        return []
    out = []
    for e in chain["edges"]:
        if e["to"] != to_id or e["amount"] <= 0:
            continue
        frm = nodes.get(e["from"])
        if frm is None:
            continue
        edge = {
            "kind": "money",
            "from_id": frm["id"],
            "from_name": frm["name"],
            "from_kind": frm["kind"],
            "from_committee_type": frm.get("committee_type"),
            "to_id": to_id,
            "to_name": to["name"],
            "amount": e["amount"],
            "visibility": frm["visibility"],
            "depth": e["depth"],
            "source_url": e.get("source_url") or frm.get("source_url") or chain_receipts_url(chain, to_id),
        }
        if frm.get("contributor_count") is not None:
            edge["contributor_count"] = frm["contributor_count"]
        out.append(edge)
    return sorted(out, key=lambda e: (-e["amount"], e["from_id"]))


def chain_receipts_url(chain: dict[str, Any], committee_id: str) -> str:
    cycle = RACES[chain["race_id"]].cycle if chain["race_id"] in RACES else 2024
    return fec_receipts_url(committee_id, cycle)


def _entity_money_edges(entity: dict[str, Any]) -> list[dict[str, Any]]:
    """Fallback when no chain was walked: the entity page's aggregated inflows (already per counterparty)."""
    out = []
    for t in entity["inflows"]:
        if t["amount"] <= 0:
            continue
        out.append(
            {
                "kind": "money",
                "from_id": t["from_entity_id"],
                "from_name": t["from_name"],
                "from_kind": _kind_from_id(t["from_entity_id"]),
                "from_committee_type": None,
                "to_id": entity["entity_id"],
                "to_name": entity["name"],
                "amount": t["amount"],
                "visibility": t["visibility"],
                "depth": 1,
                "source_url": t["source_url"],
            }
        )
    return sorted(out, key=lambda e: (-e["amount"], e["from_id"]))


def funders_of(inp: Inputs, entity_id: str, limit: int) -> list[dict[str, Any]]:
    chain = inp.chains.get(entity_id)
    if chain is not None:
        return _chain_money_edges(chain, entity_id)[:limit]
    entity = inp.entities.get(entity_id)
    if entity is not None:
        return _entity_money_edges(entity)[:limit]
    return []


def shares_of(inp: Inputs, entity_id: str) -> dict[str, Any] | None:
    chain = inp.chains.get(entity_id)
    if chain is None:
        return None
    s = chain["summary"]
    return {
        "total_in": s["total_in"],
        "disclosed": s["disclosed_share"],
        "inferable": s["inferable_share"],
        "unwalked": s.get("unwalked_share", 0.0),
        "dark": s["dark_share"],
        "max_depth": s["max_depth"],
        "source_url": fec_receipts_url(entity_id, inp.cycle),
    }


def next_hop(chain: dict[str, Any], funders: list[dict[str, Any]], parents: int, limit: int) -> list[dict[str, Any]]:
    """Who funded the largest depth-1 committees (the hop the reader would ask about next)."""
    nodes = {n["id"]: n for n in chain["nodes"]}
    out: list[dict[str, Any]] = []
    for f in funders:
        node = nodes.get(f["from_id"])
        if node is None or node["kind"] != "committee" or node["is_terminus"]:
            continue
        out.extend(_chain_money_edges(chain, f["from_id"]))
        parents -= 1
        if parents == 0:
            break
    return sorted(out, key=lambda e: (-e["amount"], e["from_id"]))[:limit]


def ultimate_sources(chain: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """Named people / organizations (and dark dead ends) the walk stopped at, past the first hop."""
    nodes = {n["id"]: n for n in chain["nodes"]}
    best: dict[str, dict[str, Any]] = {}
    for e in chain["edges"]:
        n = nodes.get(e["from"])
        if n is None or not n["is_terminus"] or n["depth"] < 2 or e["amount"] <= 0:
            continue
        if n["terminus_reason"] not in ("individual", "organization", "dark", "inferable"):
            continue
        to = nodes.get(e["to"])
        if to is None:
            continue
        row = {
            "id": n["id"],
            "name": n["name"],
            "kind": n["kind"],
            "visibility": n["visibility"],
            "gave_to_id": to["id"],
            "gave_to_name": to["name"],
            "amount": e["amount"],
            "depth": n["depth"],
            "source_url": e.get("source_url") or n.get("source_url") or chain_receipts_url(chain, to["id"]),
        }
        if n.get("organization_class") is not None:
            row["organization_class"] = n["organization_class"]
        prev = best.get(n["id"])
        if prev is None or row["amount"] > prev["amount"]:
            best[n["id"]] = row
    return sorted(best.values(), key=lambda r: (-r["amount"], r["id"]))[:limit]


# ---------------------------------------------------------------------------
# ads
# ---------------------------------------------------------------------------


def ad_runs(inp: Inputs) -> dict[str, dict[str, Any]]:
    """One TrailAdRun per sponsor committee that the ads stage tied an advertiser to."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for ad in inp.ads["ads"]:
        if not ad.get("matched_entity_id") or ad["match_confidence"] == "none":
            continue
        groups.setdefault(ad["matched_entity_id"], []).append(ad)
    runs: dict[str, dict[str, Any]] = {}
    for entity_id, ads in groups.items():
        ads.sort(key=lambda a: a["ad_id"])
        first = [a["first_shown"] for a in ads if a["first_shown"]]
        last = [a["last_shown"] for a in ads if a["last_shown"]]
        maxes = [a["spend_range"]["max"] for a in ads]
        verified = any((a.get("verification") or {}).get("status") == "verified" for a in ads)
        runs[entity_id] = {
            "sponsor_id": entity_id,
            "sponsor_name": ads[0]["advertiser_name"],
            "platform": ads[0]["platform"],
            "ad_count": len(ads),
            "spend": {
                "min": sum(a["spend_range"]["min"] for a in ads),
                "max": None if any(m is None for m in maxes) else sum(maxes),
                "source_url": GOOGLE_ADVERTISER_URL.format(advertiser_id=ads[0]["advertiser_id"]),
            },
            "first_shown": min(first) if first else None,
            "last_shown": max(last) if last else None,
            "match_confidence": "verified" if verified else "auto",
            "source_url": GOOGLE_ADVERTISER_URL.format(advertiser_id=ads[0]["advertiser_id"]),
        }
    return runs


def _range_text(r: dict[str, Any]) -> str:
    return f"{_money(r['min'])}+" if r["max"] is None else f"{_money(r['min'])}–{_money(r['max'])}"


# ---------------------------------------------------------------------------
# answers
# ---------------------------------------------------------------------------


def candidate_spender_answer(inp: Inputs, candidate_id: str) -> dict[str, Any]:
    cand = next(c for c in inp.race.candidates if c.candidate_id == candidate_id)
    led = next(c for c in inp.ledger["candidates"] if c["candidate_id"] == candidate_id)
    outside = led["outside"]
    spenders = targeting_for_candidate(inp, candidate_id)
    listed = sum(e["amount"] for e in spenders)
    if spenders:
        top = spenders[0]
        verb = "opposing" if top["support_oppose"] == "O" else "supporting"
        top_txt = (
            f" The largest was {top['spender_name']} ({top['spender_type_label']}), {_money(top['amount'])} {verb}."
        )
    else:
        top_txt = ""
    headline = (
        f"Outside groups reported {_money(outside['total'])} in independent expenditures about {cand.name}: "
        f"{_money(outside['oppose'])} opposing and {_money(outside['support'])} supporting.{top_txt}"
    )
    caveats = [
        TARGETING_NOTE,
        "Totals are the FEC's candidate-level Schedule E summary; the spender rows are the committees in this race's "
        f"ledger and account for {_money(listed)} of that total. 24/48-hour notices are collapsed onto the periodic "
        "report for the same spend.",
        "Support / oppose is the spender's own declaration, not a reading of the ad.",
    ]
    return {
        "intent": "candidate_spender",
        "subject_id": candidate_id,
        "subject_name": cand.name,
        "headline": headline,
        "caveats": caveats,
        "candidate_id": candidate_id,
        "support": {"amount": outside["support"], "source_url": outside["source_url"]},
        "oppose": {"amount": outside["oppose"], "source_url": outside["source_url"]},
        "total": {"amount": outside["total"], "source_url": outside["source_url"]},
        "spenders": spenders,
    }


def committee_funding_answer(inp: Inputs, committee_id: str) -> dict[str, Any] | None:
    entity = inp.entities.get(committee_id)
    chain = inp.chains.get(committee_id)
    spender = inp.spender(committee_id)
    if entity is None and chain is None and spender is None:
        return None
    name = (chain or entity or spender)["root_name" if chain else "name"]
    type_label = (entity or spender or {}).get("committee_type_label")
    committee_source_url = (entity or spender or {}).get("source_url") or fec_receipts_url(committee_id, inp.cycle)

    funders = funders_of(inp, committee_id, TOP_FUNDERS)
    if chain is not None:
        total_in = {"amount": chain["summary"]["total_in"], "source_url": fec_receipts_url(committee_id, inp.cycle)}
        hop2 = next_hop(chain, funders, NEXT_HOP_PARENTS, TOP_NEXT_HOP)
        ultimate = ultimate_sources(chain, TOP_ULTIMATE)
    elif entity is not None:
        total_in = {"amount": entity["totals"]["receipts"], "source_url": entity["source_url"]}
        hop2, ultimate = [], []
    else:
        total_in = {"amount": 0.0, "source_url": committee_source_url}
        hop2, ultimate = [], []
    shares = shares_of(inp, committee_id)
    spent_on = targeting_for_spender(inp, committee_id)

    parts = [f"{name} took in {_money(total_in['amount'])} in itemized receipts"]
    named = [f for f in funders if f["from_kind"] != "aggregate"]
    if named and total_in["amount"] > 0:
        f0 = named[0]
        share = f0["amount"] / total_in["amount"]
        who = f0["from_name"] + (
            f" ({inp.entities.get(f0['from_id'], {}).get('committee_type_label') or 'committee'})"
            if f0["from_kind"] == "committee"
            else ""
        )
        parts.append(f"; {_pct(min(share, 1.0))} of it came from {who}")
    headline = "".join(parts) + "."
    named_hop2 = [h for h in hop2 if h["from_kind"] != "aggregate"]
    if named_hop2:
        h = named_hop2[0]
        headline += f" One hop further back, {h['to_name']} received {_money(h['amount'])} from {h['from_name']}."
    if shares is not None:
        headline += (
            f" Tracing further back, {_pct(shares['disclosed'])} of the money reaches named people or organizations "
            f"and {_pct(shares['dark'])} stops at groups that do not disclose their donors."
        )
    caveats = [
        "Receipts are itemized Schedule A contributions and committee-to-committee transfers as filed with the FEC; "
        "unitemized small-dollar receipts, loans and offsets are not shown.",
        "Each hop is the reported total between those two parties. Once money is pooled in a committee it is fungible, "
        "so a second-hop funder's dollars cannot be traced to any specific spending by the committee asked about.",
    ]
    if shares is not None:
        caveats.append(CHAIN_NOTE)
    else:
        caveats.append(
            "No multi-hop walk exists for this committee; the funders listed are its own reported contributors only."
        )
    if spent_on:
        caveats.append(TARGETING_NOTE)
    return {
        "intent": "committee_funding",
        "subject_id": committee_id,
        "subject_name": name,
        "headline": headline,
        "caveats": caveats,
        "committee_id": committee_id,
        "committee_type_label": type_label,
        "committee_source_url": committee_source_url,
        "total_in": total_in,
        "funders": funders,
        "next_hop": hop2,
        "ultimate": ultimate,
        "shares": shares,
        "spent_on": spent_on,
    }


def candidate_ad_funding_answer(inp: Inputs, candidate_id: str, runs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    cand = next(c for c in inp.race.candidates if c.candidate_id == candidate_id)
    led = next(c for c in inp.ledger["candidates"] if c["candidate_id"] == candidate_id)
    targeting = {e["spender_id"]: e for e in targeting_for_candidate(inp, candidate_id)}

    sponsors: list[dict[str, Any]] = []
    own = runs.get(cand.principal_committee_id)
    if own is not None:
        camp = led["campaign"]
        sponsors.append(
            {
                "sponsor_id": cand.principal_committee_id,
                "sponsor_name": own["sponsor_name"],
                "sponsor_type_label": inp.entities.get(cand.principal_committee_id, {}).get("committee_type_label")
                or "Candidate committee",
                "is_candidate_committee": True,
                "ads": own,
                "targeting": None,
                "funded_by": funders_of(inp, cand.principal_committee_id, SPONSOR_FUNDERS),
                "shares": shares_of(inp, cand.principal_committee_id),
                "campaign_receipts": {
                    "receipts": {"amount": camp["receipts"], "source_url": camp["source_url"]},
                    "from_individuals": {"amount": camp["from_individuals"], "source_url": camp["source_url"]},
                    "from_committees": {"amount": camp["from_committees"], "source_url": camp["source_url"]},
                },
            }
        )
    outside = []
    for sponsor_id, edge in targeting.items():
        run = runs.get(sponsor_id)
        if run is None:
            continue
        outside.append(
            {
                "sponsor_id": sponsor_id,
                "sponsor_name": edge["spender_name"],
                "sponsor_type_label": edge["spender_type_label"],
                "is_candidate_committee": False,
                "ads": run,
                "targeting": edge,
                "funded_by": funders_of(inp, sponsor_id, SPONSOR_FUNDERS),
                "shares": shares_of(inp, sponsor_id),
                "campaign_receipts": None,
            }
        )
    outside.sort(key=lambda s: (-s["targeting"]["amount"], s["sponsor_id"]))
    sponsors.extend(outside)
    without_ads = sum(1 for sid in targeting if sid not in runs)

    if outside:
        top = outside[0]
        verb = "opposing" if top["targeting"]["support_oppose"] == "O" else "supporting"
        f0 = next((f for f in top["funded_by"] if f["from_kind"] != "aggregate"), None)
        funder_txt = f"; its largest funder was {f0['from_name']} ({_money(f0['amount'])})" if f0 else ""
        headline = (
            f"{len(outside)} outside group{'s' if len(outside) != 1 else ''} that reported independent expenditures about "
            f"{cand.name} also ran Google ads in this race. The largest, {top['sponsor_name']}, ran "
            f"{top['ads']['ad_count']} ads (Google: {_range_text(top['ads']['spend'])}) and reported "
            f"{_money(top['targeting']['amount'])} {verb} {cand.name}{funder_txt}."
        )
    elif own is not None:
        headline = (
            f"The only ads in the library tied to {cand.name} were the campaign's own: {own['ad_count']} ads "
            f"(Google: {_range_text(own['spend'])}), paid from {_money(led['campaign']['receipts'])} in campaign receipts."
        )
    else:
        headline = (
            f"No ads in the library are tied to a committee that filed independent expenditures about {cand.name}."
        )
    if own is not None and outside:
        headline += (
            f" {cand.name}'s own committee ran {own['ad_count']} ads (Google: {_range_text(own['spend'])}) "
            f"from {_money(led['campaign']['receipts'])} in campaign receipts."
        )
    caveats = [GOOGLE_TARGET_NOTE, GOOGLE_RANGE_NOTE, TARGETING_NOTE, POOLED_NOTE]
    if without_ads:
        caveats.append(
            f"{without_ads} committee{'s' if without_ads != 1 else ''} that filed independent expenditures about "
            f"{cand.name} ran no ads the Google library ties to them (TV, mail and other media are not in the library)."
        )
    return {
        "intent": "candidate_ad_funding",
        "subject_id": candidate_id,
        "subject_name": cand.name,
        "headline": headline,
        "caveats": caveats,
        "candidate_id": candidate_id,
        "sponsors": sponsors,
        "spenders_without_ads": without_ads,
    }


# ---------------------------------------------------------------------------
# subjects + file
# ---------------------------------------------------------------------------


def subjects(inp: Inputs) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in inp.race.candidates:
        first, _, last = c.name.partition(" ")
        out.append(
            {
                "id": c.candidate_id,
                "kind": "candidate",
                "name": c.name,
                "aliases": name_aliases(c.name, [last, f"{first} {last}"] if last else []),
                "type_label": None,
                "principal_committee_id": c.principal_committee_id,
            }
        )
    seen: set[str] = set()
    committees: list[tuple[str, str, str | None, list[str]]] = []
    for s in inp.ledger["top_outside_spenders"]:
        committees.append((s["entity_id"], s["name"], s["committee_type_label"], []))
        seen.add(s["entity_id"])
    for c in inp.race.candidates:
        e = inp.entities.get(c.principal_committee_id)
        if e is not None and e["entity_id"] not in seen:
            committees.append((e["entity_id"], e["name"], e.get("committee_type_label"), list(e.get("aliases") or [])))
            seen.add(e["entity_id"])
    for cid, name, label, extra in committees:
        e = inp.entities.get(cid)
        extra = list(extra) + list((e or {}).get("aliases") or [])
        out.append(
            {
                "id": cid,
                "kind": "committee",
                "name": name,
                "aliases": name_aliases(name, extra + [cid.lower()]),
                "type_label": label,
                "principal_committee_id": None,
            }
        )
    return out


def examples(inp: Inputs, answers: list[dict[str, Any]]) -> list[str]:
    out = []
    for c in inp.race.candidates:
        out.append(f"Who is spending against {c.name}?")
        out.append(f"Who paid for the ads about {c.name}?")
    top = [a for a in answers if a["intent"] == "committee_funding" and a["funders"]]
    top.sort(key=lambda a: -a["total_in"]["amount"])
    for a in top[:2]:
        out.append(f"Who funds {a['subject_name'].title()}?")
    return out


METHOD = (
    "Answers are precomputed from this race's ledger, ads, chain and entity files by pipeline/gotham/trails.py; no language "
    "model or graph database is involved in building them. "
    "Three questions are supported: who is spending for/against a candidate (Schedule E), who paid for the ads about a "
    "candidate (ad sponsors, their Schedule E about the candidate, and each sponsor's own funders), and who funds a "
    "committee (its receipts hop by hop). Every figure links to the FEC or Google record it was read from. Money edges "
    "and targeting edges are separate; an independent expenditure moves no money to a candidate, and a funder is never "
    "joined to a particular ad because pooled dollars cannot be allocated that way."
)


def build_trails(inp: Inputs, generated_at: str | None = None) -> dict[str, Any]:
    runs = ad_runs(inp)
    answers: list[dict[str, Any]] = []
    for c in inp.race.candidates:
        answers.append(candidate_spender_answer(inp, c.candidate_id))
        answers.append(candidate_ad_funding_answer(inp, c.candidate_id, runs))
    subs = subjects(inp)
    for s in subs:
        if s["kind"] != "committee":
            continue
        a = committee_funding_answer(inp, s["id"])
        if a is not None:
            answers.append(a)
    return {
        "race_id": inp.race.race_id,
        "generated_at": generated_at or now_iso(),
        "data_status": inp.ledger["data_status"],
        "subjects": subs,
        "answers": answers,
        "examples": examples(inp, answers),
        "method": METHOD,
    }


def load_inputs(race: Race, out_dir: Path | None = None) -> Inputs:
    out_dir = out_dir or race.out_dir
    chains = {p.stem: read_json(p) for p in sorted((out_dir / "chains").glob("*.json"))}
    entities = {p.stem: read_json(p) for p in sorted((out_dir / "entities").glob("*.json"))}
    return Inputs(
        race=race,
        ledger=read_json(out_dir / "ledger.json"),
        ads=read_json(out_dir / "ads.json"),
        chains=chains,
        entities=entities,
    )


def run(race_id: str) -> None:
    race = RACES[race_id]
    inp = load_inputs(race)
    trails = build_trails(inp)
    write_json(race.out_dir / "trails.json", trails)
    by_intent = {
        i: sum(1 for a in trails["answers"] if a["intent"] == i)
        for i in ("candidate_spender", "candidate_ad_funding", "committee_funding")
    }
    print(f"trails: {len(trails['subjects'])} subjects, {len(trails['answers'])} answers {by_intent}")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
