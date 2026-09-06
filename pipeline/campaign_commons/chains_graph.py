"""Money graph for the chain walk: inbound edges per committee, loaded once with DuckDB, walked in Python.

`build_graph(con)` expects three relations registered on the connection: `transfers`, `individuals`, `committees`
(the ingest Parquet schemas). Tests register synthetic DataFrames under the same names.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import duckdb

from .config import KNOWN_CONDUITS
from .orgs import classify_organization, committee_name_index, match_committee, organization_visibility
from .util import individual_id, organization_id

# Sched A codes on the individuals side that are receipts (not refunds / conduit pass-through)
RECEIPT_TT_PREFIXES = ("1", "3")
REFUND_TRANSFER_TTS = ("22Z",)
INDIVIDUAL_ENTITY_TYPES = ("IND", "CAN")
ORG_ENTITY_TYPES = ("ORG",)
MAX_CHILDREN = 40  # material edges kept per node; the rest join the pruned aggregate (D-33)
MAX_NODES = 600  # once a chain has this many nodes, remaining committees stop as depth_cap (D-33)
SUPER_PAC_TYPES = {"O", "U"}
VALVE_TARGET_TYPES = {"H", "S", "P", "X", "Y", "Z"}


@dataclass(frozen=True)
class Edge:
    """A money edge from `counterparty` into the node that owns this edge."""

    counterparty: str
    name: str
    kind: str  # committee | individual | organization | conduit
    amount: float
    count: int
    transaction_types: tuple[str, ...]
    first: str | None
    last: str | None
    mismatch: bool = False
    organization_class: str | None = None  # kind == organization only (orgs.py)

    @property
    def dark(self) -> bool:
        return self.kind == "organization" and organization_visibility(self.organization_class or "unknown") == "dark"


@dataclass
class Graph:
    inbound: dict[str, list[Edge]] = field(default_factory=dict)
    committee_type: dict[str, str | None] = field(default_factory=dict)  # only committees in the master
    committee_name: dict[str, str] = field(default_factory=dict)

    def is_loaded(self, cid: str) -> bool:
        return cid in self.committee_type

    def total_in(self, node: str) -> float:
        return round(sum(e.amount for e in self.inbound.get(node, ())), 2)


def _date(value: object) -> str | None:
    return None if value is None else str(value)[:10]


def build_graph(con: duckdb.DuckDBPyConnection, overrides: dict[str, str] | None = None) -> Graph:
    g = Graph()
    for cid, tp, name in con.execute("SELECT CMTE_ID, CMTE_TP, CMTE_NM FROM committees").fetchall():
        g.committee_type[cid] = tp
        g.committee_name[cid] = name
    rows = con.execute(
        f"""
        SELECT to_id, from_id, any_value(from_name), sum(amt), sum(count), list(DISTINCT tt ORDER BY tt),
               min(dt), max(dt), bool_or(coalesce(mismatch, false))
        FROM transfers
        WHERE tt NOT IN ({",".join(f"'{t}'" for t in REFUND_TRANSFER_TTS)})
        GROUP BY to_id, from_id
        """
    ).fetchall()
    for to_id, from_id, name, amt, n, tts, first, last, mismatch in rows:
        kind = "conduit" if from_id in KNOWN_CONDUITS else "committee"
        display = KNOWN_CONDUITS.get(from_id) or g.committee_name.get(from_id) or name or from_id
        g.inbound.setdefault(to_id, []).append(
            Edge(from_id, display, kind, round(amt, 2), int(n), tuple(tts), _date(first), _date(last), bool(mismatch))
        )
    prefixes = " OR ".join(f"TRANSACTION_TP LIKE '{p}%'" for p in RECEIPT_TT_PREFIXES)
    entity_types = ",".join(f"'{t}'" for t in INDIVIDUAL_ENTITY_TYPES + ORG_ENTITY_TYPES)
    rows = con.execute(
        f"""
        SELECT CMTE_ID, NAME, ZIP5, ENTITY_TP IN ({",".join(f"'{t}'" for t in ORG_ENTITY_TYPES)}) AS is_org,
               sum(TRANSACTION_AMT), sum(N_TRANSACTIONS), list(DISTINCT TRANSACTION_TP ORDER BY TRANSACTION_TP),
               min(FIRST_DT), max(LAST_DT)
        FROM individuals
        WHERE ENTITY_TP IN ({entity_types}) AND ({prefixes})
        GROUP BY CMTE_ID, NAME, ZIP5, is_org
        """
    ).fetchall()
    by_name = committee_name_index(g.committee_name.items())
    for cmte, name, zip5, is_org, amt, n, tts, first, last in rows:
        if is_org and (cid := match_committee(name, by_name)) and cid != cmte:
            # A committee reported on Schedule A as ORG. The sender's own filing is already a transfer edge for
            # this pair in most cases, and this is the receiver-side copy of the same money; otherwise it is the
            # only record of the transfer and joins the graph as a committee edge.
            if any(e.counterparty == cid for e in g.inbound.get(cmte, ())):
                continue
            edge = Edge(
                cid, g.committee_name[cid], "committee", round(amt, 2), int(n), tuple(tts), _date(first), _date(last)
            )
        elif is_org:
            edge = Edge(
                organization_id(name),
                name,
                "organization",
                round(amt, 2),
                int(n),
                tuple(tts),
                _date(first),
                _date(last),
                organization_class=classify_organization(name, overrides),
            )
        else:
            edge = Edge(
                individual_id(name, zip5),
                name,
                "individual",
                round(amt, 2),
                int(n),
                tuple(tts),
                _date(first),
                _date(last),
            )
        g.inbound.setdefault(cmte, []).append(edge)
    for edges in g.inbound.values():
        edges.sort(key=lambda e: e.amount, reverse=True)
    return g


# --- walk ---------------------------------------------------------------------------------------


@dataclass
class Node:
    id: str
    name: str
    kind: str
    committee_type: str | None
    depth: int
    visibility: str
    amount_in: float
    terminus_reason: str | None  # None => expanded (has inbound edges in the walk)
    contributor_count: int | None = None
    refers_to: str | None = None  # cycle nodes: the already-visited committee they stand for
    dark_amount: float = 0.0  # pruned aggregates: dark dollars inside the bucket
    organization_class: str | None = None


@dataclass
class WalkEdge:
    src: str
    dst: str
    amount: float
    visibility: str
    transaction_types: tuple[str, ...]
    count: int
    first: str | None
    last: str | None


@dataclass
class Walk:
    root: str
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[WalkEdge] = field(default_factory=list)
    valve_violations: list[tuple[str, str, float]] = field(default_factory=list)  # (super_pac, receiver, amount)
    mismatch_counterparties: list[tuple[str, str, float]] = field(default_factory=list)  # (node, counterparty, amount)

    @property
    def total_in(self) -> float:
        return self.nodes[self.root].amount_in

    @property
    def max_depth(self) -> int:
        return max(n.depth for n in self.nodes.values())


def _is_valve_violation(graph: Graph, edge: Edge, receiver: str) -> bool:
    return (
        edge.kind == "committee"
        and graph.committee_type.get(edge.counterparty) in SUPER_PAC_TYPES
        and graph.committee_type.get(receiver) in VALVE_TARGET_TYPES
    )


def walk(
    graph: Graph,
    root: str,
    max_depth: int,
    materiality: float,
    max_children: int = MAX_CHILDREN,
    max_nodes: int = MAX_NODES,
) -> Walk:
    """Backward BFS over money edges from `root`. Produces a tree: a counterparty already in the walk becomes a
    `cycle:` terminus that refers to the earlier node instead of being expanded again."""
    w = Walk(root)
    w.nodes[root] = Node(
        root,
        graph.committee_name.get(root, root),
        "committee",
        graph.committee_type.get(root),
        0,
        "disclosed",
        graph.total_in(root),
        None if graph.inbound.get(root) else "depth_cap",
    )
    visited = {root}
    via: dict[str, float] = {}  # expandable child -> amount of the edge that reached it
    queue: deque[str] = deque([root])
    while queue:
        node_id = queue.popleft()
        node = w.nodes[node_id]
        if node_id != root and len(w.nodes) >= max_nodes:
            node.terminus_reason = "depth_cap"
            node.amount_in = via[node_id]
            continue
        edges = graph.inbound.get(node_id, [])
        total = node.amount_in
        pruned: list[Edge] = []
        for i, e in enumerate(edges):
            if e.amount < materiality * total or i >= max_children:
                pruned.append(e)
                continue
            if e.mismatch:
                w.mismatch_counterparties.append((node_id, e.counterparty, e.amount))
            child = _classify(graph, w, visited, node, e)
            w.nodes[child.id] = child
            w.edges.append(
                WalkEdge(child.id, node_id, e.amount, child.visibility, e.transaction_types, e.count, e.first, e.last)
            )
            if child.terminus_reason is None:
                visited.add(child.id)
                if node.depth + 1 < max_depth:
                    via[child.id] = e.amount
                    queue.append(child.id)
                else:
                    child.terminus_reason = "depth_cap"
                    child.amount_in = e.amount
        if pruned:
            agg = _aggregate(node, pruned)
            w.nodes[agg.id] = agg
            tts = tuple(sorted({t for e in pruned for t in e.transaction_types}))
            firsts = [e.first for e in pruned if e.first]
            lasts = [e.last for e in pruned if e.last]
            w.edges.append(
                WalkEdge(
                    agg.id,
                    node_id,
                    agg.amount_in,
                    agg.visibility,
                    tts,
                    sum(e.count for e in pruned),
                    min(firsts) if firsts else None,
                    max(lasts) if lasts else None,
                )
            )
    return w


def _unique(w: Walk, wanted: str, parent: str) -> str:
    return wanted if wanted not in w.nodes else f"{wanted}@{parent}"


def _classify(graph: Graph, w: Walk, visited: set[str], parent: Node, e: Edge) -> Node:
    depth = parent.depth + 1
    if e.kind == "individual":
        return Node(
            _unique(w, e.counterparty, parent.id),
            e.name,
            "individual",
            None,
            depth,
            "disclosed",
            e.amount,
            "individual",
        )
    if e.kind == "organization":
        visibility = organization_visibility(e.organization_class or "unknown")
        return Node(
            _unique(w, e.counterparty, parent.id),
            e.name,
            "organization",
            None,
            depth,
            visibility,
            e.amount,
            "dark" if visibility == "dark" else "organization",
            organization_class=e.organization_class,
        )
    if e.kind == "conduit":
        return Node(
            _unique(w, e.counterparty, parent.id), e.name, "conduit", None, depth, "disclosed", e.amount, "individual"
        )
    tp = graph.committee_type.get(e.counterparty)
    if e.counterparty in visited:
        return Node(
            f"cycle:{e.counterparty}@{parent.id}",
            e.name,
            "committee",
            tp,
            depth,
            "disclosed",
            e.amount,
            "cycle",
            refers_to=e.counterparty,
        )
    if _is_valve_violation(graph, e, parent.id):
        w.valve_violations.append((e.counterparty, parent.id, e.amount))
        return Node(
            _unique(w, e.counterparty, parent.id), e.name, "committee", tp, depth, "disclosed", e.amount, "depth_cap"
        )
    if not graph.is_loaded(e.counterparty) or not graph.inbound.get(e.counterparty):
        return Node(
            _unique(w, e.counterparty, parent.id), e.name, "committee", tp, depth, "disclosed", e.amount, "depth_cap"
        )
    return Node(e.counterparty, e.name, "committee", tp, depth, "disclosed", graph.total_in(e.counterparty), None)


def _aggregate(parent: Node, pruned: list[Edge]) -> Node:
    amount = round(sum(e.amount for e in pruned), 2)
    dark = round(sum(e.amount for e in pruned if e.dark), 2)
    return Node(
        f"agg:other@{parent.id}",
        f"Other contributors to {parent.name} (each <1% of receipts, or beyond the {MAX_CHILDREN} largest)",
        "aggregate",
        None,
        parent.depth + 1,
        "dark" if dark > amount / 2 else "disclosed",
        amount,
        "pruned",
        contributor_count=len(pruned),
        dark_amount=dark,
    )


# --- visibility shares ----------------------------------------------------------------------------


Shares = tuple[float, float, float, float]  # disclosed, inferable, unwalked, dark
DISCLOSED: Shares = (1.0, 0.0, 0.0, 0.0)
UNWALKED: Shares = (0.0, 0.0, 1.0, 0.0)
DARK: Shares = (0.0, 0.0, 0.0, 1.0)


def node_shares(w: Walk) -> dict[str, Shares]:
    """Visibility mix of every node's dollars, propagated proportionally from termini toward the root.

    A depth_cap terminus is an FEC committee the walk did not read (outside the loaded neighborhood, hop or node
    cap): its dollars are neither disclosed nor dark here, they are unwalked.
    """
    children: dict[str, list[WalkEdge]] = {}
    for e in w.edges:
        children.setdefault(e.dst, []).append(e)
    memo: dict[str, Shares] = {}
    in_progress: set[str] = set()

    def shares(node_id: str) -> Shares:
        if node_id in memo:
            return memo[node_id]
        n = w.nodes[node_id]
        if n.terminus_reason == "pruned":
            result = _mix([(n.amount_in - n.dark_amount, DISCLOSED), (n.dark_amount, DARK)])
        elif n.terminus_reason == "cycle" and n.refers_to is not None:
            # a committee already expanded elsewhere: reuse its mix, unless we are inside its own subtree
            result = DISCLOSED if n.refers_to in in_progress or n.refers_to not in w.nodes else shares(n.refers_to)
        elif n.terminus_reason == "depth_cap":
            result = UNWALKED
        elif n.terminus_reason is not None or not children.get(node_id):
            result = DARK if n.visibility == "dark" else DISCLOSED
        else:
            in_progress.add(node_id)
            result = _mix([(e.amount, shares(e.src)) for e in children[node_id]])
            in_progress.discard(node_id)
        memo[node_id] = result
        return result

    # cycle nodes that refer to ancestors must see the ancestor "in progress"; resolve the root first
    shares(w.root)
    for node_id in w.nodes:
        shares(node_id)
    return memo


def _mix(parts: list[tuple[float, Shares]]) -> Shares:
    total = sum(a for a, _ in parts)
    if total <= 0:
        return DISCLOSED
    d = sum(a * s[0] for a, s in parts) / total
    i = sum(a * s[1] for a, s in parts) / total
    u = sum(a * s[2] for a, s in parts) / total
    k = sum(a * s[3] for a, s in parts) / total
    return (d, i, u, k)
