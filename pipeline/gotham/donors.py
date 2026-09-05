"""donors/<donor_key>.json: forward view for the largest individual/organization sources found in any chain.

The chain walk goes backward (spender <- committee <- donor). This module inverts the same `Graph.inbound` edge
table and walks forward from a donor: donor -> committees it gave to -> outside spenders in this race those
committees transferred to -> independent expenditures (targeting edges, never money into a candidate).

Dollars are not conserved past the first hop: once a donor's money is pooled in a committee it is fungible, so the
view never allocates a donor's dollars to a spender. Every reached spender behind an intermediate committee carries
`ALLOCATION_NOTE` instead (D-47).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import duckdb

from .chains_graph import Edge, Graph, Walk
from .config import Race
from .util import (
    fec_candidate_url,
    fec_committee_url,
    fec_contributor_receipts_url,
    fec_contributor_search_url,
    fec_ie_candidate_url,
    fec_pair_receipts_url,
    now_iso,
)

TOP_DONORS = 50
MAX_NODES = 200
SOURCE_KINDS = ("individual", "organization")
ALLOCATION_NOTE = (
    "share of donor's dollars reaching this spender is not determinable; showing the committees in between"
)


def donor_key(donor_id: str) -> str:
    """Filesystem/URL-safe file stem for a synthetic donor id (`ind:NAME|ZIP`, `org:NAME`). Mirrored in web/lib."""
    return re.sub(r"[^A-Za-z0-9_-]", "-", donor_id)


@dataclass(frozen=True)
class Donor:
    id: str
    name: str
    kind: str  # individual | organization
    total: float  # summed amount_in across every chain the donor appears in


def top_donors(walks: dict[str, Walk], n: int = TOP_DONORS) -> list[Donor]:
    totals: dict[str, float] = {}
    names: dict[str, tuple[str, str]] = {}
    for w in walks.values():
        for node in w.nodes.values():
            if node.kind not in SOURCE_KINDS:
                continue
            did = node.id.split("@")[0]
            totals[did] = totals.get(did, 0.0) + node.amount_in
            names.setdefault(did, (node.name, node.kind))
    ranked = sorted(totals, key=lambda d: (-totals[d], d))[:n]
    return [Donor(d, names[d][0], names[d][1], round(totals[d], 2)) for d in ranked]


def outbound_index(graph: Graph) -> dict[str, list[tuple[str, Edge]]]:
    """counterparty -> [(receiver, edge)], largest edge first. The inverse of `Graph.inbound`."""
    out: dict[str, list[tuple[str, Edge]]] = {}
    for receiver, edges in graph.inbound.items():
        for e in edges:
            out.setdefault(e.counterparty, []).append((receiver, e))
    for lst in out.values():
        lst.sort(key=lambda t: t[1].amount, reverse=True)
    return out


@dataclass(frozen=True)
class IETarget:
    candidate_id: str
    support_oppose: str
    amount: float


def ie_targets(con: duckdb.DuckDBPyConnection) -> dict[str, list[IETarget]]:
    """spender -> independent expenditures in this race, grouped by candidate and stance (the `ies` relation)."""
    rows = con.execute(
        "SELECT committee_id, candidate_id, support_oppose_indicator, sum(expenditure_amount) FROM ies "
        "GROUP BY committee_id, candidate_id, support_oppose_indicator ORDER BY 1, 4 DESC"
    ).fetchall()
    out: dict[str, list[IETarget]] = {}
    for cid, cand, so, amt in rows:
        out.setdefault(cid, []).append(IETarget(cand, so, round(amt, 2)))
    return out


@dataclass
class FNode:
    id: str
    name: str
    kind: str  # individual | organization | committee | candidate
    committee_type: str | None
    depth: int
    amount: float  # money received from the parent (depth 1-2) or IE dollars aimed at the candidate (depth 3)
    is_spender: bool
    source_url: str


@dataclass(frozen=True)
class FEdge:
    src: str
    dst: str
    kind: str  # money | targeting
    amount: float
    support_oppose: str | None
    source_url: str


@dataclass
class ForwardWalk:
    donor: Donor
    nodes: dict[str, FNode] = field(default_factory=dict)
    edges: list[FEdge] = field(default_factory=list)
    truncated: bool = False

    @property
    def via_intermediary(self) -> bool:
        return any(n.depth == 2 for n in self.nodes.values())


def forward_walk(
    graph: Graph,
    out_index: dict[str, list[tuple[str, Edge]]],
    ies: dict[str, list[IETarget]],
    race: Race,
    donor: Donor,
    spenders: set[str],
    max_nodes: int = MAX_NODES,
) -> ForwardWalk:
    """donor -> committees -> race spenders -> IE targets. Committees are added largest-gift-first until the cap."""
    fw = ForwardWalk(donor)
    fw.nodes[donor.id] = FNode(
        donor.id,
        donor.name,
        donor.kind,
        None,
        0,
        donor.total,
        False,
        fec_contributor_search_url(donor.name, race.cycle),
    )
    candidates = {c.candidate_id: c for c in race.candidates}

    def committee(cid: str, depth: int, amount: float) -> FNode:
        node = FNode(
            cid,
            graph.committee_name.get(cid, cid),
            "committee",
            graph.committee_type.get(cid),
            depth,
            amount,
            cid in spenders,
            fec_committee_url(cid, race.cycle),
        )
        fw.nodes[cid] = node
        return node

    def room(reserve: int = 0) -> bool:
        """`reserve` seats are held back for the race's candidates so a capped view still ends at its IE targets."""
        if len(fw.nodes) + reserve >= max_nodes:
            fw.truncated = True
            return False
        return True

    for receiver, e in out_index.get(donor.id, []):
        if not room(reserve=len(candidates)):
            break
        if receiver in fw.nodes:
            continue
        committee(receiver, 1, e.amount)
        fw.edges.append(
            FEdge(
                donor.id,
                receiver,
                "money",
                e.amount,
                None,
                fec_contributor_receipts_url(receiver, donor.name, race.cycle),
            )
        )
    for cid in [n.id for n in fw.nodes.values() if n.depth == 1]:
        for receiver, e in out_index.get(cid, []):
            if receiver not in spenders or receiver == cid or receiver == donor.id:
                continue
            if receiver not in fw.nodes:
                if not room(reserve=len(candidates)):
                    break
                committee(receiver, 2, e.amount)
            fw.edges.append(
                FEdge(cid, receiver, "money", e.amount, None, fec_pair_receipts_url(receiver, cid, race.cycle))
            )
    for s in [n for n in fw.nodes.values() if n.is_spender]:
        for t in ies.get(s.id, []):
            if t.candidate_id not in fw.nodes:
                if not room():
                    break
                c = candidates.get(t.candidate_id)
                fw.nodes[t.candidate_id] = FNode(
                    t.candidate_id,
                    c.name if c else t.candidate_id,
                    "candidate",
                    None,
                    3,
                    0.0,
                    False,
                    fec_candidate_url(t.candidate_id, race.cycle),
                )
            fw.nodes[t.candidate_id].amount = round(fw.nodes[t.candidate_id].amount + t.amount, 2)
            fw.edges.append(
                FEdge(
                    s.id,
                    t.candidate_id,
                    "targeting",
                    t.amount,
                    t.support_oppose,
                    fec_ie_candidate_url(s.id, t.candidate_id, race.cycle),
                )
            )
    return fw


def donor_json(race: Race, fw: ForwardWalk, chained: set[str]) -> dict:
    d = fw.donor
    nodes = [
        {
            "id": n.id,
            "name": n.name,
            "kind": n.kind,
            "committee_type": n.committee_type,
            "depth": n.depth,
            "amount": n.amount,
            "is_spender": n.is_spender,
            "has_chain": n.id in chained,
            "source_url": n.source_url,
        }
        for n in fw.nodes.values()
    ]
    edges = [
        {
            "from": e.src,
            "to": e.dst,
            "kind": e.kind,
            "amount": e.amount,
            "support_oppose": e.support_oppose,
            "source_url": e.source_url,
        }
        for e in fw.edges
    ]
    committees = sum(1 for n in fw.nodes.values() if n.depth == 1)
    spenders = sum(1 for n in fw.nodes.values() if n.is_spender)
    total_given = round(sum(e.amount for e in fw.edges if e.src == d.id), 2)
    return {
        "donor_id": d.id,
        "donor_key": donor_key(d.id),
        "name": d.name,
        "kind": d.kind,
        "race_id": race.race_id,
        "generated_at": now_iso(),
        "data_status": "real",
        "total_given": total_given,
        "total_in_chains": d.total,
        "nodes": nodes,
        "edges": edges,
        "allocation_note": ALLOCATION_NOTE if fw.via_intermediary else None,
        "truncated": fw.truncated,
        "method": (
            f"Forward walk over the same money edges as the chain walk (Schedule A receipts and committee-to-committee "
            f"transfers from FEC bulk data, refunds excluded), starting from {d.name}: the {committees} committee(s) "
            f"it gave to in the {race.cycle} cycle, then the outside spenders in this race that received transfers "
            f"from those committees ({spenders} spender(s) reached), then each spender's independent expenditures "
            f"for or against a candidate. Independent expenditures are targeting edges: they move no money to the "
            f"candidate and are drawn separately. Amounts on money edges are the reported totals between the two "
            f"parties, not a share of this donor's dollars — once pooled, a donor's money is fungible, so no allocation "
            f"is made past the first hop. `total_given` is the sum of the first-hop edges shown (itemized receipts reported "
            f"under this name); `total_in_chains`, used only to rank donors, sums this donor's edges across every spender "
            f"chain in the race, so the same gift counts once per chain it appears in."
            + (f" The tree stops at {MAX_NODES} nodes; smaller committees were left out." if fw.truncated else "")
        ),
    }
