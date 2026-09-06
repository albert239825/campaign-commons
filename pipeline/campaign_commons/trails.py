"""Precompute Money Trails answers and bounded graph selections (D-73, D-78).

All three intents read existing ledger, ads, entity and chain artifacts: no LLM, graph database or new FEC reads.
Each answer preserves separate money/targeting semantics and carries a provenance-preserving chain selection.
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

TOP_PER_LAYER = 5
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
# per-answer graph selections
# ---------------------------------------------------------------------------


def _chain_kind(edge: dict[str, Any]) -> str:
    return edge.get("kind", "money")


def _copy_chain_node(node: dict[str, Any], depth: int, side: str) -> dict[str, Any]:
    copied = dict(node)
    copied["depth"] = depth
    copied["side"] = side
    return copied


def _copy_chain_edge(edge: dict[str, Any], depth: int) -> dict[str, Any]:
    copied = dict(edge)
    copied["depth"] = depth
    return copied


def _filed_basis(rule: str, source_url: str) -> dict[str, Any]:
    return {
        "basis": "filed",
        "rule": rule,
        "source_urls": [source_url],
        "checked_by": None,
        "checked_at": None,
    }


def _raw_edges(chain: dict[str, Any], *, to_id: str | None = None, from_id: str | None = None) -> list[dict[str, Any]]:
    return [
        e
        for e in chain["edges"]
        if (to_id is None or e["to"] == to_id) and (from_id is None or e["from"] == from_id) and e["amount"] > 0
    ]


def _ranked_ids(groups: dict[str, tuple[float, list[dict[str, Any]]]], limit: int) -> tuple[list[str], list[str]]:
    ranked = sorted(groups, key=lambda node_id: (-groups[node_id][0], node_id))
    return ranked[:limit], ranked[limit:]


def _append_truncation(truncated: list[dict[str, Any]], layer: str, kept: list[str], candidates: list[str]) -> None:
    if len(candidates) > TOP_PER_LAYER:
        truncated.append({"layer": layer, "kept": len(kept), "hidden": len(candidates) - len(kept)})


def _finish_graph(
    root_id: str,
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    truncated: list[dict[str, Any]],
) -> dict[str, Any]:
    kept_ids = set(nodes)
    edges = [e for e in edges if e["from"] in kept_ids and e["to"] in kept_ids]
    edges.sort(key=lambda e: (-e["amount"], e["from"], e["to"], _chain_kind(e)))
    return {
        "root_id": root_id,
        "nodes": sorted(nodes.values(), key=lambda n: (-n.get("amount_in", 0), n["id"])),
        "edges": edges,
        "truncated": truncated,
    }


def _committee_graph(inp: Inputs, committee_id: str) -> dict[str, Any] | None:
    chain = inp.chains.get(committee_id)
    if chain is None:
        return None
    raw_nodes = {n["id"]: n for n in chain["nodes"]}
    root = raw_nodes.get(committee_id)
    if root is None:
        return None
    nodes = {committee_id: _copy_chain_node(root, 0, "out")}
    edges: list[dict[str, Any]] = []
    truncated: list[dict[str, Any]] = []

    f1_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    for edge in _raw_edges(chain, to_id=committee_id):
        if _chain_kind(edge) != "money" or edge["from"] not in raw_nodes:
            continue
        amount, grouped = f1_groups.get(edge["from"], (0.0, []))
        f1_groups[edge["from"]] = (amount + edge["amount"], grouped + [edge])
    f1, _ = _ranked_ids(f1_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "funders_1", f1, list(f1_groups))
    for node_id in f1:
        nodes[node_id] = _copy_chain_node(raw_nodes[node_id], 1, "in")
        edges.extend(_copy_chain_edge(e, 1) for e in f1_groups[node_id][1])

    f2_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    for parent_id in f1:
        parent = raw_nodes[parent_id]
        if parent["kind"] != "committee" or parent["is_terminus"]:
            continue
        for edge in _raw_edges(chain, to_id=parent_id):
            if _chain_kind(edge) != "money" or edge["from"] not in raw_nodes:
                continue
            amount, grouped = f2_groups.get(edge["from"], (0.0, []))
            f2_groups[edge["from"]] = (amount + edge["amount"], grouped + [edge])
    f2, _ = _ranked_ids(f2_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "funders_2", f2, list(f2_groups))
    for node_id in f2:
        nodes[node_id] = _copy_chain_node(raw_nodes[node_id], 2, "in")
        edges.extend(_copy_chain_edge(e, 2) for e in f2_groups[node_id][1])

    vendor_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    for edge in _raw_edges(chain, from_id=committee_id):
        if _chain_kind(edge) != "money" or raw_nodes.get(edge["to"], {}).get("kind") != "vendor":
            continue
        amount, grouped = vendor_groups.get(edge["to"], (0.0, []))
        vendor_groups[edge["to"]] = (amount + edge["amount"], grouped + [edge])
    vendors, _ = _ranked_ids(vendor_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "vendors", vendors, list(vendor_groups))
    for node_id in vendors:
        nodes[node_id] = _copy_chain_node(raw_nodes[node_id], 1, "out")
        edges.extend(_copy_chain_edge(e, 1) for e in vendor_groups[node_id][1])

    placement_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    placement_sources = {committee_id, *vendors}
    for edge in chain["edges"]:
        if _chain_kind(edge) != "placement" or edge["from"] not in placement_sources:
            continue
        if edge.get("basis", {}).get("basis") not in {"verified", "inferred"}:
            continue
        ad = raw_nodes.get(edge["to"])
        if ad is None or ad["kind"] != "ad":
            continue
        amount, grouped = placement_groups.get(ad["id"], (0.0, []))
        placement_groups[ad["id"]] = (max(amount, ad["amount_in"]), grouped + [edge])
    ads, _ = _ranked_ids(placement_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "ads", ads, list(placement_groups))
    for node_id in ads:
        nodes[node_id] = _copy_chain_node(raw_nodes[node_id], 2, "out")
        edges.extend(_copy_chain_edge(e, 2) for e in placement_groups[node_id][1])

    candidate_depth: dict[str, int] = {}
    candidate_edges: dict[str, list[dict[str, Any]]] = {}
    for edge in chain["edges"]:
        if _chain_kind(edge) != "targeting" or edge["from"] not in placement_sources:
            continue
        candidate = raw_nodes.get(edge["to"])
        if candidate is None or candidate["kind"] != "candidate":
            continue
        depth = 1 if edge["from"] == committee_id else 2
        candidate_depth[candidate["id"]] = min(candidate_depth.get(candidate["id"], depth), depth)
        candidate_edges.setdefault(candidate["id"], []).append(edge)
    for node_id, depth in candidate_depth.items():
        nodes[node_id] = _copy_chain_node(raw_nodes[node_id], depth, "out")
        edges.extend(_copy_chain_edge(e, depth) for e in candidate_edges[node_id])

    return _finish_graph(committee_id, nodes, edges, truncated)


def _candidate_root(inp: Inputs, candidate_id: str) -> dict[str, Any]:
    for chain_id in sorted(inp.chains):
        node = next(
            (n for n in inp.chains[chain_id]["nodes"] if n["id"] == candidate_id and n["kind"] == "candidate"),
            None,
        )
        if node is not None:
            return _copy_chain_node(node, 0, "out")
    candidate = next(c for c in inp.race.candidates if c.candidate_id == candidate_id)
    outside = next(c for c in inp.ledger["candidates"] if c["candidate_id"] == candidate_id)["outside"]
    return {
        "id": candidate_id,
        "name": candidate.name,
        "kind": "candidate",
        "committee_type": None,
        "depth": 0,
        "side": "out",
        "visibility": "disclosed",
        "amount_in": outside["total"],
        "is_terminus": True,
        "terminus_reason": None,
        "source_url": outside["source_url"],
        "basis": _filed_basis(
            "Independent expenditures reported on FEC Schedule E about this candidate.", outside["source_url"]
        ),
        "href": f"/races/{inp.race.race_id}/candidates/{candidate_id}",
    }


def _synth_spender_node(inp: Inputs, spender_id: str, amount: float, source_url: str) -> dict[str, Any]:
    spender = inp.spender(spender_id) or {}
    entity = inp.entities.get(spender_id) or {}
    return {
        "id": spender_id,
        "name": entity.get("name") or spender.get("name") or spender_id,
        "kind": "committee",
        "committee_type": entity.get("committee_type"),
        "depth": 1,
        "side": "in",
        "visibility": entity.get("visibility", "disclosed"),
        "amount_in": amount,
        "is_terminus": False,
        "terminus_reason": None,
        "source_url": entity.get("source_url") or spender.get("source_url") or source_url,
    }


def _targeting_chain_edge(
    inp: Inputs, targeting: dict[str, Any], chain: dict[str, Any] | None, spender_id: str, depth: int
) -> dict[str, Any]:
    if chain is not None:
        for edge in chain["edges"]:
            if (
                _chain_kind(edge) == "targeting"
                and edge["from"] == spender_id
                and edge["to"] == targeting["candidate_id"]
            ):
                return _copy_chain_edge(edge, depth)
    source_url = targeting["source_url"]
    spender = inp.spender(spender_id) or {}
    by_candidate = next(
        (row for row in spender.get("by_candidate", []) if row["candidate_id"] == targeting["candidate_id"]),
        {},
    )
    return {
        "from": spender_id,
        "to": targeting["candidate_id"],
        "kind": "targeting",
        "amount": targeting["amount"],
        "visibility": "disclosed",
        "depth": depth,
        "transaction_types": ["24E"],
        "count": by_candidate.get("count", 1),
        "date_range": None,
        "source_url": source_url,
        "support_oppose": targeting["support_oppose"],
        "basis": _filed_basis(
            "Schedule E independent expenditures by this committee about the candidate, summed.", source_url
        ),
    }


def _candidate_spender_graph(inp: Inputs, candidate_id: str) -> dict[str, Any]:
    root = _candidate_root(inp, candidate_id)
    nodes = {candidate_id: root}
    edges: list[dict[str, Any]] = []
    truncated: list[dict[str, Any]] = []
    targeting = targeting_for_candidate(inp, candidate_id)
    groups = {e["spender_id"]: (e["amount"], [e]) for e in targeting}
    spenders, _ = _ranked_ids(groups, TOP_PER_LAYER)
    _append_truncation(truncated, "spenders", spenders, list(groups))
    for spender_id in spenders:
        target = groups[spender_id][1][0]
        chain = inp.chains.get(spender_id)
        chain_root = next((n for n in chain["nodes"] if n["id"] == spender_id), None) if chain else None
        nodes[spender_id] = (
            _copy_chain_node(chain_root, 1, "in")
            if chain_root is not None
            else _synth_spender_node(inp, spender_id, target["amount"], target["source_url"])
        )
        edges.append(_targeting_chain_edge(inp, target, chain, spender_id, 1))

    funder_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    for spender_id in spenders:
        chain = inp.chains.get(spender_id)
        if chain is None:
            continue
        for edge in _raw_edges(chain, to_id=spender_id):
            if _chain_kind(edge) != "money":
                continue
            amount, grouped = funder_groups.get(edge["from"], (0.0, []))
            funder_groups[edge["from"]] = (amount + edge["amount"], grouped + [edge])
    funders, _ = _ranked_ids(funder_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "funders_1", funders, list(funder_groups))
    for node_id in funders:
        chain = next(
            (
                inp.chains[sid]
                for sid in spenders
                if sid in inp.chains and node_id in {n["id"] for n in inp.chains[sid]["nodes"]}
            ),
            None,
        )
        raw = next(n for n in chain["nodes"] if n["id"] == node_id)
        nodes[node_id] = _copy_chain_node(raw, 2, "in")
        edges.extend(_copy_chain_edge(e, 2) for e in funder_groups[node_id][1])
    return _finish_graph(candidate_id, nodes, edges, truncated)


def _sponsor_node(inp: Inputs, sponsor: dict[str, Any], depth: int) -> dict[str, Any]:
    sponsor_id = sponsor["sponsor_id"]
    chain = inp.chains.get(sponsor_id)
    if chain is not None:
        raw = next((n for n in chain["nodes"] if n["id"] == sponsor_id), None)
        if raw is not None:
            return _copy_chain_node(raw, depth, "in")
    target = sponsor.get("targeting")
    amount = target["amount"] if target is not None else sponsor["campaign_receipts"]["receipts"]["amount"]
    source_url = target["source_url"] if target is not None else sponsor["campaign_receipts"]["receipts"]["source_url"]
    return _synth_spender_node(inp, sponsor_id, amount, source_url) | {"depth": depth}


def _candidate_ad_funding_graph(inp: Inputs, candidate_id: str, sponsors: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = {candidate_id: _candidate_root(inp, candidate_id)}
    edges: list[dict[str, Any]] = []
    truncated: list[dict[str, Any]] = []
    sponsor_groups = {}
    for sponsor in sponsors:
        targeting = sponsor.get("targeting") or {}
        amount = targeting.get("amount")
        if amount is None:
            amount = sponsor["campaign_receipts"]["receipts"]["amount"]
        sponsor_groups[sponsor["sponsor_id"]] = (amount, [sponsor])
    own_ids = [sponsor["sponsor_id"] for sponsor in sponsors if sponsor["is_candidate_committee"]]
    outside_ids = sorted(
        (sponsor["sponsor_id"] for sponsor in sponsors if not sponsor["is_candidate_committee"]),
        key=lambda sponsor_id: (-sponsor_groups[sponsor_id][0], sponsor_id),
    )
    ordered_sponsors = own_ids + outside_ids
    sponsor_ids = ordered_sponsors[:TOP_PER_LAYER]
    _append_truncation(truncated, "sponsors", sponsor_ids, list(sponsor_groups))
    kept_sponsors = [sponsor_groups[sid][1][0] for sid in sponsor_ids]
    for sponsor in kept_sponsors:
        sid = sponsor["sponsor_id"]
        nodes[sid] = _sponsor_node(inp, sponsor, 1)
        if sponsor.get("targeting") is not None:
            edges.append(_targeting_chain_edge(inp, sponsor["targeting"], inp.chains.get(sid), sid, 1))

    vendor_groups: dict[str, tuple[float, list[tuple[str, dict[str, Any]]]]] = {}
    placement_records: list[tuple[dict[str, Any], dict[str, Any], int]] = []
    for sponsor in kept_sponsors:
        sid = sponsor["sponsor_id"]
        chain = inp.chains.get(sid)
        if chain is None:
            continue
        raw_nodes = {n["id"]: n for n in chain["nodes"]}
        for edge in chain["edges"]:
            if _chain_kind(edge) != "placement" or edge.get("basis", {}).get("basis") not in {"verified", "inferred"}:
                continue
            ad = raw_nodes.get(edge["to"])
            if ad is None or ad["kind"] != "ad":
                continue
            if edge["from"] == sid:
                placement_records.append((ad, edge, 2))
                continue
            vendor = raw_nodes.get(edge["from"])
            if vendor is None or vendor["kind"] != "vendor":
                continue
            for money in _raw_edges(chain, from_id=sid, to_id=vendor["id"]):
                amount, grouped = vendor_groups.get(vendor["id"], (0.0, []))
                vendor_groups[vendor["id"]] = (amount + money["amount"], grouped + [(sid, money)])
            placement_records.append((ad, edge, 3))
    vendors, _ = _ranked_ids(
        {vid: (amount, records) for vid, (amount, records) in vendor_groups.items()}, TOP_PER_LAYER
    )
    _append_truncation(truncated, "vendors", vendors, list(vendor_groups))
    kept_vendors = set(vendors)
    for vendor_id in vendors:
        sid, _ = vendor_groups[vendor_id][1][0]
        chain = inp.chains[sid]
        raw = next(n for n in chain["nodes"] if n["id"] == vendor_id)
        nodes[vendor_id] = _copy_chain_node(raw, 2, "out")
        edges.extend(_copy_chain_edge(e, 2) for _, e in vendor_groups[vendor_id][1])

    ad_groups: dict[str, tuple[float, list[tuple[dict[str, Any], dict[str, Any], int]]]] = {}
    for record in placement_records:
        ad, edge, depth = record
        if depth == 3 and edge["from"] not in kept_vendors:
            continue
        amount, grouped = ad_groups.get(ad["id"], (0.0, []))
        ad_groups[ad["id"]] = (max(amount, ad["amount_in"]), grouped + [record])
    ads, _ = _ranked_ids(ad_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "ads", ads, list(ad_groups))
    for ad_id in ads:
        records = ad_groups[ad_id][1]
        ad, _, depth = records[0]
        nodes[ad_id] = _copy_chain_node(ad, depth, "out")
        for _, edge, edge_depth in records:
            if edge_depth == 2 or edge["from"] in kept_vendors:
                edges.append(_copy_chain_edge(edge, edge_depth))

    funder_groups: dict[str, tuple[float, list[dict[str, Any]]]] = {}
    for sponsor in kept_sponsors:
        chain = inp.chains.get(sponsor["sponsor_id"])
        if chain is None:
            continue
        for edge in _raw_edges(chain, to_id=sponsor["sponsor_id"]):
            if _chain_kind(edge) != "money":
                continue
            amount, grouped = funder_groups.get(edge["from"], (0.0, []))
            funder_groups[edge["from"]] = (amount + edge["amount"], grouped + [edge])
    funders, _ = _ranked_ids(funder_groups, TOP_PER_LAYER)
    _append_truncation(truncated, "funders_1", funders, list(funder_groups))
    for node_id in funders:
        owner_chain = next(
            inp.chains[sponsor["sponsor_id"]]
            for sponsor in kept_sponsors
            if sponsor["sponsor_id"] in inp.chains
            and node_id in {n["id"] for n in inp.chains[sponsor["sponsor_id"]]["nodes"]}
        )
        raw = next(n for n in owner_chain["nodes"] if n["id"] == node_id)
        nodes[node_id] = _copy_chain_node(raw, 2, "in")
        edges.extend(_copy_chain_edge(e, 2) for e in funder_groups[node_id][1])
    return _finish_graph(candidate_id, nodes, edges, truncated)


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
        "graph": _candidate_spender_graph(inp, candidate_id),
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
        "graph": _committee_graph(inp, committee_id),
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
        "graph": _candidate_ad_funding_graph(inp, candidate_id, sponsors),
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
    "Answers are precomputed from this race's ledger, ads, chain and entity files by pipeline/campaign_commons/trails.py; no language "
    "model or graph database is involved in building them. "
    "Three questions are supported: who is spending for/against a candidate (Schedule E), who paid for the ads about a "
    "candidate (ad sponsors, their Schedule E about the candidate, and each sponsor's own funders), and who funds a "
    "committee (its receipts hop by hop). Every figure links to the FEC or Google record it was read from. Money edges "
    "and targeting edges are separate; an independent expenditure moves no money to a candidate, and a funder is never "
    "joined to a particular ad because pooled dollars cannot be allocated that way. Each answer also carries a bounded "
    "graph selection copied from the audited chain files, retaining node and edge provenance."
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
