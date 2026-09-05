"""Forward donor walk on the synthetic chain graph: bob -> Mid PAC -> Root PAC (spender) -> IE targets."""

import pytest
from test_chains_graph import CAND, PAC, ROOT, SUPER, graph, walk

from gotham.config import PA_SEN_2024
from gotham.donors import (
    ALLOCATION_NOTE,
    IETarget,
    donor_json,
    donor_key,
    forward_walk,
    outbound_index,
    top_donors,
)

RACE = PA_SEN_2024
CASEY, MCCORMICK = (c.candidate_id for c in RACE.candidates)


def ies() -> dict[str, list[IETarget]]:
    return {ROOT: [IETarget(CASEY, "O", 70.0), IETarget(MCCORMICK, "S", 30.0)], SUPER: [IETarget(CASEY, "O", 5.0)]}


def test_top_donors_sum_across_chains_and_strip_suffixes() -> None:
    g = graph()
    walks = {ROOT: walk(g, ROOT, 8, 0.01), CAND: walk(g, CAND, 8, 0.01)}
    donors = top_donors(walks, n=3)
    assert [d.id for d in donors] == ["ind:bob", "org:dark-llc", "org:c4"]  # 200 = 200 tie breaks on id
    assert donors[0].kind == "individual" and donors[1].kind == "organization"
    assert all("@" not in d.id for d in donors)


def test_forward_walk_reaches_spender_through_intermediary_and_targets_candidates() -> None:
    g = graph()
    donor = top_donors({ROOT: walk(g, ROOT, 8, 0.01)})
    bob = next(d for d in donor if d.id == "ind:bob")
    fw = forward_walk(g, outbound_index(g), ies(), RACE, bob, spenders={ROOT, SUPER})
    depths = {n.id: n.depth for n in fw.nodes.values()}
    assert depths == {"ind:bob": 0, PAC: 1, ROOT: 2, CASEY: 3, MCCORMICK: 3}
    money = [(e.src, e.dst, e.amount) for e in fw.edges if e.kind == "money"]
    assert money == [("ind:bob", PAC, 200.0), (PAC, ROOT, 600.0)]
    targeting = {(e.src, e.dst, e.support_oppose, e.amount) for e in fw.edges if e.kind == "targeting"}
    assert targeting == {(ROOT, CASEY, "O", 70.0), (ROOT, MCCORMICK, "S", 30.0)}
    assert fw.via_intermediary and not fw.truncated
    doc = donor_json(RACE, fw, chained={ROOT})
    assert doc["allocation_note"] == ALLOCATION_NOTE
    assert doc["total_given"] == 200.0
    assert next(n for n in doc["nodes"] if n["id"] == ROOT)["has_chain"] is True
    assert all(n["source_url"].startswith("https://www.fec.gov/") for n in doc["nodes"])
    assert all(e["source_url"].startswith("https://www.fec.gov/") for e in doc["edges"])


def test_never_a_money_edge_into_a_candidate() -> None:
    """carol gave to a candidate committee directly; a super PAC's IE against a candidate stays a targeting edge."""
    g = graph()
    carol = next(d for d in top_donors({CAND: walk(g, CAND, 8, 0.01)}) if d.id == "ind:carol")
    fw = forward_walk(g, outbound_index(g), ies(), RACE, carol, spenders={SUPER})
    assert {n.id for n in fw.nodes.values()} == {"ind:carol", CAND}
    assert all(fw.nodes[e.dst].kind == "committee" for e in fw.edges if e.kind == "money")
    assert all(fw.nodes[e.dst].kind == "candidate" for e in fw.edges if e.kind == "targeting")
    assert not fw.via_intermediary
    assert donor_json(RACE, fw, chained=set())["allocation_note"] is None


def test_direct_gift_to_spender_needs_no_allocation_note() -> None:
    g = graph()
    alice = next(d for d in top_donors({ROOT: walk(g, ROOT, 8, 0.01)}) if d.id == "ind:alice")
    fw = forward_walk(g, outbound_index(g), ies(), RACE, alice, spenders={ROOT})
    assert fw.nodes[ROOT].depth == 1 and fw.nodes[ROOT].is_spender
    assert {n.kind for n in fw.nodes.values()} == {"individual", "committee", "candidate"}
    assert not fw.via_intermediary


def test_node_cap_truncates_largest_first() -> None:
    g = graph()
    bob = next(d for d in top_donors({ROOT: walk(g, ROOT, 8, 0.01)}) if d.id == "ind:bob")
    fw = forward_walk(g, outbound_index(g), ies(), RACE, bob, spenders={ROOT}, max_nodes=4)
    assert fw.truncated and set(fw.nodes) == {"ind:bob", PAC}


def test_node_cap_keeps_seats_for_ie_targets() -> None:
    """Committees stop filling the tree before the cap so a truncated view still ends at the candidates."""
    g = graph()
    bob = next(d for d in top_donors({ROOT: walk(g, ROOT, 8, 0.01)}) if d.id == "ind:bob")
    fw = forward_walk(g, outbound_index(g), ies(), RACE, bob, spenders={ROOT}, max_nodes=5)
    assert set(fw.nodes) == {"ind:bob", PAC, ROOT, CASEY, MCCORMICK} and not fw.truncated


@pytest.mark.parametrize(
    ("donor_id", "key"),
    [("ind:SMITH_JOHN|19103", "ind-SMITH_JOHN-19103"), ("org:ACME, INC.", "org-ACME--INC-")],
)
def test_donor_key_is_filesystem_safe(donor_id: str, key: str) -> None:
    assert donor_key(donor_id) == key
