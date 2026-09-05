"""Spending side of a chain: vendors, ads (with and without vendor links), candidates; idempotent patching."""

import json
from pathlib import Path

import jsonschema
import pytest

from campaign_commons.chains_out import MAX_AD_NODES, build_out_side, midpoint, patch_chain, strip_out_side
from campaign_commons.config import PA_SEN_2024
from campaign_commons.config import ROOT as REPO_ROOT

RACE = PA_SEN_2024
SPENDER = "C00000001"
CASEY, MCCORMICK = "S6PA00217", "S2PA00661"
IE_URL = "https://www.fec.gov/data/independent-expenditures/?committee_id=C00000001"
AD_URL = "https://adstransparency.google.com/advertiser/AR1/creative/{}?political=&region=US"


def basis(kind: str, rule: str = "test") -> dict:
    checked = kind == "verified"
    return {
        "basis": kind,
        "rule": rule,
        "source_urls": ["https://example.com/evidence"],
        "checked_by": "tester" if checked else None,
        "checked_at": "2026-09-05" if checked else None,
    }


def ie(candidate: str, so: str, amount: float, payee: str, date: str) -> dict:
    return {
        "ie_id": f"{SPENDER}-ie-{payee}-{date}",
        "spender_entity_id": SPENDER,
        "spender_name": "Test Super PAC",
        "candidate_id": candidate,
        "candidate_name": "Bob Casey" if candidate == CASEY else "Dave McCormick",
        "support_oppose": so,
        "amount": amount,
        "date": date,
        "purpose": "MEDIA BUY",
        "payee": payee,
        "source_url": "https://docquery.fec.gov/cgi-bin/fecimg/?1",
    }


def entity(with_vendors: bool) -> dict:
    e = {
        "entity_id": SPENDER,
        "independent_expenditures": [
            ie(CASEY, "O", 600.0, "GAMBIT", "2024-10-01"),
            ie(CASEY, "O", 400.0, "GAMBIT", "2024-10-10"),
            ie(MCCORMICK, "S", 250.0, "WATERFRONT", "2024-10-05"),
        ],
    }
    if with_vendors:
        e["vendors"] = [
            {
                "vendor_id": "gambit-strategies",
                "name": "Gambit Strategies",
                "amount": 1000.0,
                "count": 2,
                "media_mix": [{"medium": "digital", "amount": 1000.0, "count": 2}],
                "targets": [{"candidate_id": CASEY, "support_oppose": "O", "amount": 1000.0}],
                "first_date": "2024-10-01",
                "last_date": "2024-10-10",
                "source_url": IE_URL + "&payee=GAMBIT",
            },
            {
                "vendor_id": "waterfront",
                "name": "Waterfront Strategies",
                "amount": 250.0,
                "count": 1,
                "media_mix": [{"medium": "tv", "amount": 250.0, "count": 1}],
                "targets": [{"candidate_id": MCCORMICK, "support_oppose": "S", "amount": 250.0}],
                "first_date": "2024-10-05",
                "last_date": "2024-10-05",
                "source_url": IE_URL + "&payee=WATERFRONT",
            },
        ]
    return e


def ad(ad_id: str, lo: float, hi: float | None, sponsor: str = SPENDER, **extra: object) -> dict:
    a = {
        "ad_id": ad_id,
        "platform": "google",
        "advertiser_id": "AR1",
        "advertiser_name": "TEST SUPER PAC",
        "matched_entity_id": sponsor,
        "match_confidence": "auto",
        "candidate_ids": [],
        "support_oppose": None,
        "spend_range": {"min": lo, "max": hi},
        "impressions_range": {"min": 1000, "max": 2000},
        "first_shown": "2024-10-02",
        "last_shown": "2024-10-09",
        "ad_type": "video",
        "creative_url": AD_URL.format(ad_id),
        "cached_creative_path": None,
        "regions": ["US"],
        "source_url": AD_URL.format(ad_id),
        "verification": {"status": "unverified", "evidence_urls": [], "verified_at": None},
    }
    a.update(extra)
    return a


def chain_stub() -> dict:
    return {
        "root_entity_id": SPENDER,
        "root_name": "Test Super PAC",
        "race_id": RACE.race_id,
        "generated_at": "2026-09-05T00:00:00+00:00",
        "data_status": "real",
        "nodes": [
            {
                "id": SPENDER,
                "name": "Test Super PAC",
                "kind": "committee",
                "committee_type": "O",
                "depth": 0,
                "visibility": "disclosed",
                "amount_in": 5000.0,
                "is_terminus": False,
                "terminus_reason": None,
                "source_url": "https://www.fec.gov/data/committee/C00000001/?cycle=2024",
            },
            {
                "id": "ind-ALICE",
                "name": "Alice",
                "kind": "individual",
                "committee_type": None,
                "depth": 1,
                "visibility": "disclosed",
                "amount_in": 5000.0,
                "is_terminus": True,
                "terminus_reason": "individual",
                "source_url": None,
            },
        ],
        "edges": [
            {
                "from": "ind-ALICE",
                "to": SPENDER,
                "amount": 5000.0,
                "visibility": "disclosed",
                "depth": 1,
                "transaction_types": ["15"],
                "count": 1,
                "date_range": None,
                "source_url": None,
            }
        ],
        "summary": {
            "total_in": 5000.0,
            "disclosed_share": 1.0,
            "inferable_share": 0.0,
            "dark_share": 0.0,
            "max_depth": 1,
            "terminus_counts": {"individual": 1},
        },
        "flags": [],
        "method": "Backward walk.",
    }


def by_id(nodes: list[dict]) -> dict[str, dict]:
    return {n["id"]: n for n in nodes}


def edges_of(edges: list[dict], kind: str) -> list[dict]:
    return [e for e in edges if e.get("kind") == kind]


def test_midpoint():
    assert midpoint({"min": 100, "max": 200}) == 150
    assert midpoint({"min": 100, "max": None}) == 100


def test_without_vendors_targets_hang_off_root():
    nodes, edges, summary = build_out_side(RACE, SPENDER, entity(False), [], set())
    kinds = {n["kind"] for n in nodes}
    assert kinds == {"candidate"}
    assert by_id(nodes)[CASEY]["amount_in"] == 1000.0
    assert by_id(nodes)[MCCORMICK]["amount_in"] == 250.0
    targeting = edges_of(edges, "targeting")
    assert {(e["from"], e["to"], e["support_oppose"], e["amount"]) for e in targeting} == {
        (SPENDER, CASEY, "O", 1000.0),
        (SPENDER, MCCORMICK, "S", 250.0),
    }
    assert all(e["basis"]["basis"] == "filed" for e in targeting)
    assert summary == {"out_total": 1250.0, "max_out_depth": 1}
    assert all(n["side"] == "out" for n in nodes)


def test_with_vendors_money_then_targeting():
    nodes, edges, summary = build_out_side(RACE, SPENDER, entity(True), [], set())
    n = by_id(nodes)
    assert n["vendor:gambit-strategies"]["medium"] == "digital"
    assert n["vendor:gambit-strategies"]["depth"] == 1 and n[CASEY]["depth"] == 2
    money = edges_of(edges, "money")
    assert sum(e["amount"] for e in money) == summary["out_total"] == 1250.0
    assert all(e["basis"]["basis"] == "filed" and e["transaction_types"] == ["24E"] for e in money)
    targeting = edges_of(edges, "targeting")
    assert {(e["from"], e["to"]) for e in targeting} == {
        ("vendor:gambit-strategies", CASEY),
        ("vendor:waterfront", MCCORMICK),
    }
    assert not any(e["from"] == SPENDER for e in targeting)


def test_ads_attach_to_root_when_no_vendor_links():
    ads = [ad("CR1", 100, 200), ad("CR2", 1000, None, sponsor="C99999999")]
    nodes, edges, _ = build_out_side(RACE, SPENDER, entity(False), ads, set())
    n = by_id(nodes)
    assert "CR1" in n and "CR2" not in n
    assert n["CR1"]["amount_in"] == 150.0 and n["CR1"]["basis"]["basis"] == "inferred"
    placement = edges_of(edges, "placement")
    assert len(placement) == 1 and placement[0]["from"] == SPENDER and placement[0]["basis"]["basis"] == "inferred"


def test_verified_ad_gets_verified_root_edge():
    verified = ad(
        "CR1",
        100,
        200,
        verification={
            "status": "verified",
            "evidence_urls": ["https://example.com/proof"],
            "verified_at": "2026-09-05",
        },
    )
    _, edges, _ = build_out_side(RACE, SPENDER, entity(False), [verified], set())
    (p,) = edges_of(edges, "placement")
    assert p["basis"]["basis"] == "verified" and p["basis"]["checked_at"] == "2026-09-05"


def test_only_verified_or_inferred_links_become_placement_edges():
    """D-74: a stale `adjacent` link in an old ads.json must not become an edge; the inferred one is the parent."""
    links = [
        {
            "vendor_id": "gambit-strategies",
            "vendor_name": "Gambit",
            "medium": "digital",
            "window": ["2024-10-02", "2024-10-09"],
            "amount_in_window": 600.0,
            "buys_in_window": 1,
            "basis": basis("inferred"),
        },
        {
            "vendor_id": "waterfront",
            "vendor_name": "Waterfront",
            "medium": "tv",
            "window": ["2024-10-02", "2024-10-09"],
            "amount_in_window": 250.0,
            "buys_in_window": 1,
            "basis": basis("adjacent"),
        },
    ]
    ads = [ad("CR1", 100, 200, vendor_links=links)]
    nodes, edges, _ = build_out_side(RACE, SPENDER, entity(True), ads, set())
    assert by_id(nodes)["CR1"]["depth"] == 2
    placement = {e["from"]: e for e in edges_of(edges, "placement")}
    assert set(placement) == {"vendor:gambit-strategies"}
    assert (
        placement["vendor:gambit-strategies"]["amount"] == 150.0
        and placement["vendor:gambit-strategies"]["basis"]["basis"] == "inferred"
    )
    assert all(e["basis"]["basis"] != "adjacent" for e in edges if e.get("basis"))


def test_ad_with_no_qualifying_link_hangs_off_the_spender_with_no_vendor_edge():
    links = [
        {
            "vendor_id": "gambit-strategies",
            "vendor_name": "Gambit",
            "medium": "digital",
            "window": ["2024-10-02", "2024-10-09"],
            "amount_in_window": 600.0,
            "buys_in_window": 1,
            "basis": basis("adjacent"),
        },
    ]
    _, edges, _ = build_out_side(RACE, SPENDER, entity(True), [ad("CR1", 100, 200, vendor_links=links)], set())
    froms = sorted(e["from"] for e in edges_of(edges, "placement"))
    assert froms == [SPENDER]


def test_campaign_ad_targets_candidate_and_candidate_basis_says_midpoint():
    ads = [ad("CR1", 100, 200, candidate_ids=[MCCORMICK], support_oppose="S")]
    nodes, edges, _ = build_out_side(RACE, SPENDER, entity(False), ads, {MCCORMICK})
    n = by_id(nodes)
    assert n[MCCORMICK]["amount_in"] == 250.0 + 150.0
    assert n[MCCORMICK]["basis"]["basis"] == "inferred"
    assert n[MCCORMICK]["href"].endswith(f"/candidates/{MCCORMICK}")
    assert n[CASEY]["basis"]["basis"] == "filed" and n[CASEY]["href"] == f"/races/{RACE.race_id}"
    assert any(e["from"] == "CR1" and e["to"] == MCCORMICK and e["kind"] == "targeting" for e in edges)


def test_ads_beyond_cap_fold_into_aggregate():
    ads = [ad(f"CR{i}", 100 * i, 100 * i) for i in range(1, MAX_AD_NODES + 4)]
    nodes, edges, _ = build_out_side(RACE, SPENDER, entity(False), ads, set())
    ad_nodes = [n for n in nodes if n["kind"] == "ad"]
    (agg,) = [n for n in nodes if n["kind"] == "aggregate"]
    assert len(ad_nodes) == MAX_AD_NODES
    assert min(n["amount_in"] for n in ad_nodes) > agg["amount_in"] / 3  # the smallest ads were the ones folded
    assert agg["contributor_count"] == 3 and agg["name"] == "3 more ads"
    assert sum(n["amount_in"] for n in ad_nodes) + agg["amount_in"] == sum(midpoint(a["spend_range"]) for a in ads)


def test_patch_is_idempotent_and_validates():
    ads = [ad("CR1", 100, 200)]
    once = patch_chain(RACE, chain_stub(), entity(True), ads, set())
    twice = patch_chain(RACE, json.loads(json.dumps(once)), entity(True), ads, set())
    assert once == twice
    assert once["summary"]["out_total"] == 1250.0 and once["method"].count("Spending side") == 1
    assert len([n for n in once["nodes"] if n.get("side") != "out"]) == 2
    schema_path = Path(REPO_ROOT) / "contracts" / "jsonschema" / "chain.schema.json"
    if not schema_path.exists():
        pytest.skip("generated JSON Schema not present")
    jsonschema.validate(once, json.loads(schema_path.read_text()))


def test_strip_removes_everything_out_side():
    patched = patch_chain(RACE, chain_stub(), entity(True), [ad("CR1", 100, 200)], set())
    stripped = strip_out_side(patched)
    assert stripped["nodes"] == chain_stub()["nodes"] and stripped["edges"] == chain_stub()["edges"]
    assert "out_total" not in stripped["summary"] and stripped["method"] == "Backward walk."
