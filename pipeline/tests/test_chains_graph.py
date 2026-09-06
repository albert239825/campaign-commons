"""Synthetic graph for the chain walk: 3 hops, a cycle, a conduit, a dark org, a pruned tail, a depth-capped
(unloaded) committee and a super PAC -> candidate valve violation."""

from campaign_commons.chains_graph import Edge, Graph, node_shares, walk

ROOT, PAC, PARTY, OUTSIDE, CAND, SUPER = "C1", "C2", "C3", "C9", "S1", "C7"


def edge(cp: str, kind: str, amount: float, name: str | None = None, mismatch: bool = False) -> Edge:
    return Edge(cp, name or cp, kind, amount, 1, ("15",), "2024-01-01", "2024-06-01", mismatch)


def graph() -> Graph:
    g = Graph()
    g.committee_type.update({ROOT: "O", PAC: "Q", PARTY: "Y", CAND: "S", SUPER: "O"})
    g.committee_name.update({ROOT: "Root PAC", PAC: "Mid PAC", PARTY: "Party", CAND: "Candidate", SUPER: "Super"})
    g.inbound[ROOT] = [
        edge(PAC, "committee", 600.0, mismatch=True),
        edge("org:dark-llc", "organization", 200.0, "Dark LLC"),
        edge("C00401224", "conduit", 100.0, "ActBlue"),
        edge("ind:alice", "individual", 95.0),
        edge("ind:tiny1", "individual", 3.0),
        edge("ind:tiny2", "individual", 2.0),
    ]
    g.inbound[PAC] = [
        edge(PARTY, "committee", 300.0),
        edge("ind:bob", "individual", 200.0),
        edge(OUTSIDE, "committee", 100.0),  # not in committee master: disclosed-but-not-loaded
    ]
    g.inbound[PARTY] = [
        edge(ROOT, "committee", 150.0),  # cycle back to the root
        edge("org:c4", "organization", 150.0, "Some C4"),
    ]
    g.inbound[CAND] = [edge(SUPER, "committee", 50.0), edge("ind:carol", "individual", 50.0)]
    for edges in g.inbound.values():
        edges.sort(key=lambda e: e.amount, reverse=True)
    return g


def test_walk_structure_and_termini() -> None:
    w = walk(graph(), ROOT, 8, 0.01)
    by_reason: dict[str, int] = {}
    for n in w.nodes.values():
        if n.terminus_reason:
            by_reason[n.terminus_reason] = by_reason.get(n.terminus_reason, 0) + 1
    # root, PAC, PARTY expanded; termini: dark llc, conduit, alice, agg(root), bob, OUTSIDE, cycle, c4
    assert len(w.nodes) == 11
    assert by_reason == {"individual": 3, "dark": 2, "pruned": 1, "depth_cap": 1, "cycle": 1}
    assert w.max_depth == 3
    agg = w.nodes[f"agg:other@{ROOT}"]
    assert agg.amount_in == 5.0 and agg.contributor_count == 2
    assert w.nodes[f"cycle:{ROOT}@{PARTY}"].refers_to == ROOT
    assert w.nodes[OUTSIDE].terminus_reason == "depth_cap" and w.nodes[OUTSIDE].amount_in == 100.0
    assert w.mismatch_counterparties == [(ROOT, PAC, 600.0)]


def test_dollars_conserve_at_every_expanded_node() -> None:
    w = walk(graph(), ROOT, 8, 0.01)
    for n in w.nodes.values():
        if n.terminus_reason is None:
            assert abs(sum(e.amount for e in w.edges if e.dst == n.id) - n.amount_in) < 0.01, n.id


def test_visibility_shares_propagate() -> None:
    w = walk(graph(), ROOT, 8, 0.01)
    s = node_shares(w)
    # PARTY: 150 cycle (-> root, in progress => disclosed) + 150 dark => 50% dark
    assert abs(s[PARTY][3] - 0.5) < 1e-9
    # PAC: 300 * 0.5 dark / 600 => 25% dark; OUTSIDE (100, depth_cap) => 1/6 unwalked, not disclosed
    assert abs(s[PAC][3] - 0.25) < 1e-9
    assert abs(s[PAC][2] - 100 / 600) < 1e-9
    # ROOT: (600 * 0.25 + 200) / 1000 => 35% dark; 600 * (1/6) / 1000 => 10% unwalked
    d, i, u, k = s[ROOT]
    assert abs(k - 0.35) < 1e-9 and abs(u - 0.10) < 1e-9 and i == 0.0 and abs(d + i + u + k - 1) < 1e-3
    assert abs(d - 0.55) < 1e-9


def test_depth_cap_dollars_are_unwalked_not_disclosed() -> None:
    w = walk(graph(), ROOT, 1, 0.01)
    d, i, u, k = node_shares(w)[ROOT]
    # PAC (600) hits the hop cap and is not read; dark llc 200; conduit + alice + agg (200) disclosed
    assert abs(u - 0.6) < 1e-9 and abs(k - 0.2) < 1e-9 and abs(d - 0.2) < 1e-9 and i == 0.0


def test_depth_cap_and_node_budget() -> None:
    w = walk(graph(), ROOT, 1, 0.01)
    assert w.nodes[PAC].terminus_reason == "depth_cap" and w.nodes[PAC].amount_in == 600.0
    assert w.max_depth == 1
    w = walk(graph(), ROOT, 8, 0.01, max_nodes=5)
    assert w.nodes[PAC].terminus_reason == "depth_cap" and w.nodes[PAC].amount_in == 600.0
    assert PARTY not in w.nodes


def test_valve_violation_not_traversed() -> None:
    w = walk(graph(), CAND, 8, 0.01)
    assert w.valve_violations == [(SUPER, CAND, 50.0)]
    assert w.nodes[SUPER].terminus_reason == "depth_cap"
    # the super PAC is not traversed, so its dollars are unwalked, not disclosed
    assert node_shares(w)[CAND] == (0.5, 0.0, 0.5, 0.0)


def test_build_graph_resolves_committees_misfiled_as_org() -> None:
    import duckdb
    import pandas as pd

    from campaign_commons.chains_graph import build_graph

    con = duckdb.connect()
    con.register(
        "committees",
        pd.DataFrame(
            {
                "CMTE_ID": ["C1", "C2", "C3"],
                "CMTE_TP": ["O", "O", "V"],
                "CMTE_NM": ["ROOT", "RESTORATION PAC", "MOVEMENT VOTER PAC"],
            }
        ),
    )
    con.register(
        "transfers",
        pd.DataFrame(
            {
                "to_id": ["C1"],
                "from_id": ["C2"],
                "from_name": ["RESTORATION PAC"],
                "amt": [1100.0],
                "count": [2],
                "tt": ["24K"],
                "dt": pd.to_datetime(["2024-03-01"]),
                "mismatch": [False],
            }
        ),
    )
    con.register(
        "individuals",
        pd.DataFrame(
            {
                "CMTE_ID": ["C1", "C1", "C1", "C2"],
                "NAME": ["RESTORATION PAC", "Movement Voter PAC", "SOME C4 ACTION", "RESTORATION PAC"],
                "ZIP5": [None, None, None, None],
                "ENTITY_TP": ["ORG", "ORG", "ORG", "ORG"],
                "TRANSACTION_AMT": [900.0, 300.0, 50.0, 10.0],
                "N_TRANSACTIONS": [1, 1, 1, 1],
                "TRANSACTION_TP": ["10", "10", "10", "10"],
                "FIRST_DT": pd.to_datetime(["2024-03-01"] * 4),
                "LAST_DT": pd.to_datetime(["2024-03-01"] * 4),
            }
        ),
    )
    g = build_graph(con)
    by_cp = {e.counterparty: e for e in g.inbound["C1"]}
    assert by_cp["C2"].amount == 1100.0 and by_cp["C2"].kind == "committee"  # receiver-side ORG copy dropped
    assert by_cp["C3"].kind == "committee" and by_cp["C3"].amount == 300.0 and by_cp["C3"].name == "MOVEMENT VOTER PAC"
    assert [e for e in g.inbound["C1"] if e.kind == "organization"][0].name == "SOME C4 ACTION"
    assert [e.kind for e in g.inbound["C2"]] == ["organization"]  # a committee naming itself stays an organization row
