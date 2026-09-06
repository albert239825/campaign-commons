"""Stage: filtered Parquet + ledger -> <race>/chains/<id>.json, traceability + flags into ledger.json / entities,
<race>/stories.json.

Reads data/fec/<race_id>/*.parquet (ingest) and the ledger/entity JSON already written by ledger.py; mutates only
`traceability`, candidates[].traceability_score, top_outside_spenders[].{traceability_score,flags,has_chain} in
ledger.json, `traceability_score` in races.json, and `flags`/`has_chain` in entities/<id>.json.

Algorithm (docs/DECISIONS.md D-05..D-07, D-32..D-36):
  Graph: one DuckDB pass builds every inbound MONEY edge per committee — committee transfers (receiver row kept by
  ingest, refunds 22Z dropped) and Sched A receipts from individuals (ENTITY_TP IND/CAN) and organizations (ORG).
  Sched A rows typed PAC/COM/CCM/PTY are the same dollars as the committee transfers and are dropped (D-32).
  15E earmarks were attributed to the individual by ingest; a conduit appearing as a counterparty is a disclosed
  aggregate of individuals. Independent expenditures are never edges.

  for each outside spender S in ledger.top_outside_spenders (backward BFS, tree):
    node total = sum of its inbound edges as loaded; edges < 1% of that total roll into agg:other@<node>
    (terminus pruned, contributor_count). Material edges:
      individual                                -> terminus individual (disclosed)
      organization not in the committee master  -> classified by name (orgs.py, D-38): union/business -> terminus
                                                   organization (disclosed); LLC/trust/nonprofit/unknown -> terminus
                                                   dark (V0 has no 990 lookup; `inferable` is reserved)
      conduit                                   -> terminus individual (disclosed aggregate)
      committee already in this walk            -> terminus cycle (cycle:<id>@<parent>, refers to the earlier node)
      super PAC (O/U) -> candidate/party edge   -> terminus, one_way_valve_violation on both, never traversed
      committee outside the loaded neighborhood, or loaded with no receipts -> terminus depth_cap (unwalked: an FEC
                                                   committee whose receipts this walk did not read; D-29 capped the
                                                   neighborhood at 2,000 committees)
      otherwise                                 -> expand, up to CHAIN_MAX_DEPTH hops
    Dollars conserve at every expanded node: sum(inbound edges incl. agg) == node.amount_in.
  Shares (disclosed, inferable, unwalked, dark, disclosed_organizations): each root dollar takes the visibility of
  its terminus, mixed proportionally through intermediate nodes. A depth_cap terminus is unwalked (neither disclosed
  nor dark); a pruned bucket is disclosed except for its dark ORG dollars; a cycle node reuses the mix of the node it
  refers to. `disclosed` is further split by what it resolves to: a person (individuals, conduit earmarks) or a named
  business/union giving from its own treasury (disclosed_organizations); the split never changes the total.

Traceability (ledger.traceability, preliminary): every Sched E dollar in the race weighted by its spender's
disclosed_share (score); traced_to_individuals / traced_to_organizations split that disclosed money; unwalked dollars
are reported separately and do not raise the score; Form 5 filers (type I, no receipts) count as dark. Per-candidate
score in candidates[].

Flags (entities + ledger spenders): popup, single_transfer_funded, dead_end_dark, transfer_mismatch, shell_cluster,
one_way_valve_violation — see chains_flags.py. Stories: chains_stories.py.
"""

from __future__ import annotations

import json
import sys
import time

import duckdb

from .chains_flags import Flags, compute_flags, flag_ids
from .chains_graph import Graph, Node, Shares, Walk, build_graph, node_shares, walk
from .chains_stories import stories
from .config import CHAIN_MATERIALITY, CHAIN_MAX_DEPTH, FEC_WEB, OUT, RACES, Race
from .donors import donor_json, donor_key, forward_walk, ie_targets, outbound_index, top_donors
from .util import (
    fec_committee_url,
    fec_contributor_receipts_url,
    fec_pair_receipts_url,
    fec_receipts_url,
    now_iso,
    read_json,
    write_json,
)

NON_COMMITTEE_SPENDER_TYPES = {"I"}  # Form 5 filers: persons/orgs spending directly, no receipts to walk


def connect(race: Race) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for table, file in (
        ("transfers", "transfers"),
        ("individuals", "individual_contributions"),
        ("committees", "committees"),
        ("candidates", "candidates"),
        ("ies", "independent_expenditures"),
    ):
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM '{race.fec_dir / file}.parquet'")
    return con


# --- chain JSON -----------------------------------------------------------------------------------


def _node_source_url(node_id: str, kind: str, name: str, parent: str | None, cycle: int) -> str | None:
    if kind in {"committee", "conduit"}:
        return fec_committee_url(node_id.removeprefix("cycle:").split("@")[0], cycle)
    if kind in {"individual", "organization"} and parent:
        return fec_contributor_receipts_url(parent, name, cycle)
    if kind == "aggregate" and parent:
        return fec_receipts_url(parent, cycle)
    return None


def _edge_source_url(src: Node, dst_id: str, cycle: int) -> str:
    """Receiver's Schedule A narrowed to the sender: by committee id for committees, by name for people/orgs."""
    receiver = dst_id.removeprefix("cycle:").split("@")[0]
    if src.kind in {"committee", "conduit"}:
        return fec_pair_receipts_url(receiver, src.id.removeprefix("cycle:").split("@")[0], cycle)
    if src.kind in {"individual", "organization"}:
        return fec_contributor_receipts_url(receiver, src.name, cycle)
    return fec_receipts_url(receiver, cycle)


def chain_json(race: Race, w: Walk, shares: dict[str, Shares], flags: list[dict]) -> dict:
    parent_of = {e.src: e.dst for e in w.edges}
    d, i, u, k, o = shares[w.root]
    counts: dict[str, int] = {}
    nodes = []
    for n in w.nodes.values():
        if n.terminus_reason:
            counts[n.terminus_reason] = counts.get(n.terminus_reason, 0) + 1
        out = {
            "id": n.id,
            "name": n.name,
            "kind": n.kind,
            "committee_type": n.committee_type,
            "depth": n.depth,
            "visibility": n.visibility,
            "amount_in": n.amount_in,
            "is_terminus": n.terminus_reason is not None,
            "terminus_reason": n.terminus_reason,
            "source_url": _node_source_url(n.id, n.kind, n.name, parent_of.get(n.id), race.cycle),
        }
        if n.contributor_count is not None:
            out["contributor_count"] = n.contributor_count
        if n.organization_class is not None:
            out["organization_class"] = n.organization_class
        nodes.append(out)
    edges = [
        {
            "from": e.src,
            "to": e.dst,
            "amount": e.amount,
            "visibility": e.visibility,
            "depth": w.nodes[e.src].depth,
            "transaction_types": list(e.transaction_types),
            "count": e.count,
            "date_range": [e.first, e.last] if e.first and e.last else None,
            "source_url": _edge_source_url(w.nodes[e.src], e.dst, race.cycle),
        }
        for e in w.edges
    ]
    return {
        "root_entity_id": w.root,
        "root_name": w.nodes[w.root].name,
        "race_id": race.race_id,
        "generated_at": now_iso(),
        "data_status": "real",
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "total_in": w.total_in,
            "disclosed_share": round(d, 4),
            "disclosed_individuals_share": round(d - o, 4),
            "disclosed_organizations_share": round(o, 4),
            "inferable_share": round(i, 4),
            "unwalked_share": round(u, 4),
            "dark_share": round(k, 4),
            "max_depth": w.max_depth,
            "terminus_counts": counts,
        },
        "flags": flags,
        "method": chain_method(w, counts),
    }


def chain_method(w: Walk, counts: dict[str, int]) -> str:
    root = w.nodes[w.root]
    parts = [
        f"Backward walk over money edges only (Schedule A receipts from individuals and organizations, committee-to-"
        f"committee transfers) into {root.name}, {w.max_depth} hop(s) deep; independent expenditures are targeting "
        f"edges and never appear. The walk starts from ${root.amount_in:,.0f} of itemized 2023–2024 receipts as loaded "
        f"from FEC bulk data (unitemized receipts, loans and offsets are not edges), and every expanded committee "
        f"conserves dollars: its inbound edges sum to its receipts. Inbound edges under 1% of a committee's receipts "
        f"are rolled into one 'other contributors' node, which counts as disclosed except for the organization dollars "
        f"inside it. Each dollar takes the visibility of where the walk stopped: named individuals (including earmarks "
        f"through ActBlue/WinRed, attributed to the person) are disclosed to a person. Organizations that are not "
        f"registered committees are classified from their name alone (no IRS lookup): a union or a business giving "
        f"from its own treasury is disclosed to an organization — the named entity is the source, but its own funders "
        f"are not walked; an LLC, trust, advocacy nonprofit (501(c)(4)-style names) or unclassifiable organization is "
        f"dark, because whoever funds it is not on file with the FEC. The disclosed share is reported in total and "
        f"split into the part that resolves to people and the part that stops at a named business or union."
    ]
    if counts.get("depth_cap"):
        parts.append(
            f"{counts['depth_cap']} committee node(s) stop with reason depth_cap: they are FEC-registered committees whose"
            f" own receipts were not loaded into this race's neighborhood (or the hop or node cap was reached). The "
            f"committee files donor lists with the FEC, but this walk did not read them, so its dollars are counted as "
            f"'not walked' — neither disclosed nor dark — and a dark layer behind such a committee would not show here."
        )
    if counts.get("cycle"):
        parts.append(
            f"{counts['cycle']} edge(s) point at a committee already expanded elsewhere in this chain and reuse its "
            f"visibility mix instead of being walked twice."
        )
    if any(n.kind == "conduit" for n in w.nodes.values()):
        parts.append(
            "A conduit (WinRed/ActBlue) appearing as a counterparty is treated as a disclosed aggregate of individual "
            "earmarks that this committee did not itemize by donor."
        )
    parts.append("Visibility shares are preliminary; no 990 lookups were performed, so nothing is marked inferable.")
    return " ".join(parts)


# --- traceability -----------------------------------------------------------------------------------


def traceability(
    con: duckdb.DuckDBPyConnection, race: Race, shares: dict[str, Shares]
) -> tuple[dict, dict[str, float]]:
    rows = con.execute(
        "SELECT committee_id, candidate_id, sum(expenditure_amount) FROM ies GROUP BY committee_id, candidate_id"
    ).fetchall()
    per_cand: dict[str, list[float]] = {c.candidate_id: [0.0, 0.0] for c in race.candidates}  # total, disclosed
    total = traced = orgs_total = unwalked_total = dark_total = 0.0
    unchained = 0.0
    for cid, cand, amt in rows:
        total += amt
        bucket = per_cand.setdefault(cand, [0.0, 0.0])
        bucket[0] += amt
        if cid in shares:
            disclosed, _, unwalked, dark, orgs = shares[cid]
            traced += amt * disclosed
            orgs_total += amt * orgs
            unwalked_total += amt * unwalked
            dark_total += amt * dark
            bucket[1] += amt * disclosed
        else:
            unchained += amt
            dark_total += amt
    scores = {cand: round(v[1] / v[0], 4) if v[0] else 0.0 for cand, v in per_cand.items()}
    method = (
        f"Preliminary. Every independent-expenditure dollar reported against a candidate in this race "
        f"(${total:,.0f} across both candidates, support and oppose) is weighted by the disclosed share of the "
        f"spending committee's own receipts, as computed by the chain walk in chains/<committee>.json: the share of "
        f"its money that traces back, through any number of committee-to-committee transfers, to a named individual "
        f"on an FEC filing (${traced - orgs_total:,.0f}) or to a named business or union giving from its own treasury "
        f"(${orgs_total:,.0f}; the organization is named, its own funders are not walked). The remainder is dark — it "
        f"stopped at an LLC, trust, advocacy nonprofit or unclassifiable organization whose own funding is not on "
        f"file (classified by name; no IRS lookup). ${unchained:,.0f} was spent by Form 5 filers (organizations that "
        f"are not registered committees and report no receipts); those dollars are counted as dark. "
        f"${unwalked_total:,.0f} reached an FEC-registered committee whose receipts lie outside the loaded "
        f"2,000-committee neighborhood (or past the hop cap) and was not walked further; those dollars are counted as "
        f"'not walked' — neither disclosed nor dark — and do not raise the score. Super PAC spending is itself "
        f"disclosed; this score is about the layer behind the spender, not the spender. Nothing is marked inferable in V0."
    )
    result = {
        "score": round(traced / total, 4) if total else 0.0,
        "outside_total": round(total, 2),
        "traced_to_individuals": round(traced - orgs_total, 2),
        "traced_to_organizations": round(orgs_total, 2),
        "inferable": 0.0,
        "unwalked": round(unwalked_total, 2),
        "dark": round(dark_total, 2),
        "method": method,
        "preliminary": True,
    }
    return result, scores


# --- write-back -------------------------------------------------------------------------------------


def _clear(race: Race, sub: str) -> None:
    d = race.out_dir / sub
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.json"):
        f.unlink()


def write_donors(
    con: duckdb.DuckDBPyConnection, race: Race, graph: Graph, walks: dict[str, Walk], spenders: list[dict]
) -> int:
    """donors/<key>.json for the largest sources in any chain: forward walk donor -> committees -> spenders -> IEs."""
    _clear(race, "donors")
    out_index = outbound_index(graph)
    ies = ie_targets(con)
    spender_ids = {s["entity_id"] for s in spenders}
    keys: dict[str, str] = {}
    for donor in top_donors(walks):
        key = donor_key(donor.id)
        if key in keys:
            raise ValueError(f"donor key collision: {donor.id} vs {keys[key]}")
        keys[key] = donor.id
        fw = forward_walk(graph, out_index, ies, race, donor, spender_ids)
        write_json(race.out_dir / "donors" / f"{key}.json", donor_json(race, fw, set(walks)))
    return len(keys)


def write_back(
    race: Race,
    ledger: dict,
    trace: dict,
    cand_scores: dict[str, float],
    shares: dict[str, Shares],
    flags: Flags,
) -> None:
    ledger["traceability"] = trace
    ledger["generated_at"] = now_iso()
    for c in ledger["candidates"]:
        c["traceability_score"] = cand_scores.get(c["candidate_id"])
    for s in ledger["top_outside_spenders"]:
        eid = s["entity_id"]
        s["has_chain"] = eid in shares
        s["traceability_score"] = round(shares[eid][0], 4) if eid in shares else None
        if eid in shares:
            d, i, u, k, o = shares[eid]
            s["visibility_shares"] = {
                "disclosed": round(d, 4),
                "disclosed_individuals": round(d - o, 4),
                "disclosed_organizations": round(o, 4),
                "inferable": round(i, 4),
                "unwalked": round(u, 4),
                "dark": round(k, 4),
            }
        else:
            s.pop("visibility_shares", None)
        s["flags"] = flag_ids(flags.get(eid, []))
    write_json(race.out_dir / "ledger.json", ledger)

    races_path = OUT / "races.json"
    races = read_json(races_path)
    for r in races["races"]:
        if r["race_id"] == race.race_id:
            r["traceability_score"] = trace["score"]
    write_json(races_path, races)

    entities_dir = race.out_dir / "entities"
    touched = set(flags) | set(shares)
    written = 0
    for path in sorted(entities_dir.glob("*.json")):
        eid = path.stem
        entity = read_json(path)
        if eid not in touched and not entity["flags"] and not entity["has_chain"]:
            continue
        entity["flags"] = flags.get(eid, [])
        entity["has_chain"] = eid in shares
        path.write_text(json.dumps(entity, indent=2, ensure_ascii=False) + "\n")
        written += 1
    print(f"entities updated: {written}")


def run(race_id: str) -> None:
    started = time.time()
    race = RACES[race_id]
    con = connect(race)
    graph: Graph = build_graph(con)
    ledger = read_json(race.out_dir / "ledger.json")
    spenders: list[dict] = ledger["top_outside_spenders"]

    _clear(race, "chains")
    walks: dict[str, Walk] = {}
    shares: dict[str, Shares] = {}
    for s in spenders:
        eid = s["entity_id"]
        if s["committee_type"] in NON_COMMITTEE_SPENDER_TYPES or not graph.inbound.get(eid):
            print(f"no chain: {eid} {s['name']} (type {s['committee_type']}, no loaded receipts)")
            continue
        w = walk(graph, eid, CHAIN_MAX_DEPTH, CHAIN_MATERIALITY)
        walks[eid] = w
        shares[eid] = node_shares(w)[eid]

    flags = compute_flags(con, race, graph, walks, shares, spenders)
    for eid, w in walks.items():
        write_json(race.out_dir / "chains" / f"{eid}.json", chain_json(race, w, node_shares(w), flags.get(eid, [])))

    trace, cand_scores = traceability(con, race, shares)
    write_back(race, ledger, trace, cand_scores, shares, flags)
    write_json(race.out_dir / "stories.json", stories(race, ledger, walks, shares, flags))
    donors = write_donors(con, race, graph, walks, spenders)
    print(
        f"chains: {len(walks)}/{len(spenders)} spenders chained; {donors} donor views; race traceability {trace['score']:.3f}; "
        f"{sum(len(v) for v in flags.values())} flags on {len(flags)} entities; {time.time() - started:.1f}s "
        f"(source: {FEC_WEB})"
    )


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
