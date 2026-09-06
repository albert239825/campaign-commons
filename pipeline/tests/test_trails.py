"""Money Trails (trails.json): three deterministic intents over synthetic ledger/ads/chain/entity artifacts."""

from __future__ import annotations

import json
from typing import Any

import pytest
from jsonschema import Draft7Validator

from campaign_commons.config import PA_SEN_2024, ROOT
from campaign_commons.trails import (
    Inputs,
    ad_runs,
    build_trails,
    candidate_ad_funding_answer,
    candidate_spender_answer,
    committee_funding_answer,
    name_aliases,
    subjects,
)

RACE = PA_SEN_2024
CASEY, MCCORMICK = (c.candidate_id for c in RACE.candidates)
CASEY_PCC, MCCORMICK_PCC = (c.principal_committee_id for c in RACE.candidates)
SUPER = "C00000001"  # super PAC: ads + IEs against Casey; has a chain
PARTY = "C00000002"  # party committee: IEs for Casey, no ads; no chain, entity only
NOISE = "C00000003"  # ran ads in PA but filed nothing about either candidate
MID = "C00000010"  # funds SUPER, funded by Bob + a dark LLC
FEC = "https://www.fec.gov/data/x"
GOOGLE = "https://adstransparency.google.com/advertiser/AR1?political=&region=US"


def _spender(
    entity_id: str, name: str, label: str, by_cand: list[tuple[str, str, float]], has_chain: bool
) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "name": name,
        "committee_type_label": label,
        "total": sum(a for _, _, a in by_cand),
        "by_candidate": [{"candidate_id": c, "support_oppose": so, "amount": a} for c, so, a in by_cand],
        "has_chain": has_chain,
        "source_url": FEC,
    }


def ledger() -> dict[str, Any]:
    return {
        "data_status": "real",
        "candidates": [
            {
                "candidate_id": CASEY,
                "campaign": {
                    "receipts": 58.0,
                    "from_individuals": 43.0,
                    "from_committees": 3.0,
                    "source_url": FEC + "/cand",
                },
                "outside": {"support": 20.0, "oppose": 100.0, "total": 120.0, "source_url": FEC + "/ie"},
            },
            {
                "candidate_id": MCCORMICK,
                "campaign": {
                    "receipts": 36.0,
                    "from_individuals": 21.0,
                    "from_committees": 1.0,
                    "source_url": FEC + "/cand",
                },
                "outside": {"support": 0.0, "oppose": 0.0, "total": 0.0, "source_url": FEC + "/ie"},
            },
        ],
        "top_outside_spenders": [
            _spender(SUPER, "BIG SUPER PAC", "Super PAC", [(CASEY, "O", 90.0), (MCCORMICK, "S", 0.0)], True),
            _spender(PARTY, "PARTY COMMITTEE", "Party committee", [(CASEY, "S", 20.0)], False),
        ],
    }


def _ad(
    ad_id: str, entity: str | None, adv: str, lo: float, hi: float | None, conf: str = "auto", verified: bool = False
) -> dict[str, Any]:
    return {
        "ad_id": ad_id,
        "platform": "google",
        "advertiser_id": "AR1",
        "advertiser_name": adv,
        "matched_entity_id": entity,
        "match_confidence": conf,
        "spend_range": {"min": lo, "max": hi},
        "first_shown": "2024-09-01",
        "last_shown": "2024-10-01",
        "verification": {"status": "verified"} if verified else None,
    }


def ads() -> dict[str, Any]:
    return {
        "ads": [
            _ad("a1", SUPER, "BIG SUPER PAC", 1000, 5000, verified=True),
            _ad("a2", SUPER, "BIG SUPER PAC", 5000, None),
            _ad("a3", CASEY_PCC, "BOB CASEY FOR SENATE", 100, 1000),
            _ad("a4", NOISE, "NOISE INC", 100, 1000),
            _ad("a5", None, "UNMATCHED", 100, 1000, conf="none"),
        ]
    }


def _node(nid: str, name: str, kind: str, depth: int, vis: str, terminus: str | None, **extra: Any) -> dict[str, Any]:
    return {
        "id": nid,
        "name": name,
        "kind": kind,
        "committee_type": extra.pop("committee_type", None),
        "depth": depth,
        "visibility": vis,
        "amount_in": extra.pop("amount_in", 0.0),
        "is_terminus": terminus is not None,
        "terminus_reason": terminus,
        "source_url": None if kind == "aggregate" else FEC + "/" + nid,
        **extra,
    }


def _edge(
    frm: str,
    to: str,
    amount: float,
    depth: int,
    url: str | None = FEC + "/edge",
    kind: str = "money",
    **extra: Any,
) -> dict[str, Any]:
    return {
        "from": frm,
        "to": to,
        "kind": kind,
        "amount": amount,
        "visibility": "disclosed",
        "depth": depth,
        "transaction_types": ["24E" if kind == "money" else ""],
        "count": 1,
        "date_range": None,
        "source_url": url,
        **extra,
    }


def super_chain() -> dict[str, Any]:
    return {
        "race_id": RACE.race_id,
        "root_name": "BIG SUPER PAC",
        "summary": {
            "total_in": 100.0,
            "disclosed_share": 0.6,
            "inferable_share": 0.0,
            "unwalked_share": 0.1,
            "dark_share": 0.3,
            "max_depth": 2,
        },
        "method": "synthetic",
        "nodes": [
            _node(SUPER, "BIG SUPER PAC", "committee", 0, "disclosed", None, committee_type="O", amount_in=100.0),
            _node(MID, "MID PAC", "committee", 1, "disclosed", None, committee_type="O", amount_in=70.0),
            _node(
                "agg:other@" + SUPER, "Other contributors", "aggregate", 1, "disclosed", "pruned", contributor_count=40
            ),
            _node(
                "org:DARK_LLC", "DARK LLC", "organization", 2, "dark", "dark", organization_class="llc", amount_in=30.0
            ),
            _node("ind:bob", "BOB, ROBERT", "individual", 2, "disclosed", "individual", amount_in=40.0),
            _node("ind:alice", "ALICE, ANNE", "individual", 1, "disclosed", "individual", amount_in=10.0),
            _node(
                "vendor:v1",
                "VENDOR ONE",
                "vendor",
                1,
                "disclosed",
                None,
                amount_in=60.0,
                side="out",
                basis={
                    "basis": "filed",
                    "rule": "Schedule E payee",
                    "source_urls": [FEC + "/vendor"],
                    "checked_by": None,
                    "checked_at": None,
                },
            ),
            _node(
                "ad:a1",
                "AD ONE",
                "ad",
                2,
                "disclosed",
                None,
                amount_in=1000.0,
                side="out",
                basis={
                    "basis": "inferred",
                    "rule": "Synthetic test placement",
                    "source_urls": [FEC + "/ad"],
                    "checked_by": None,
                    "checked_at": None,
                },
            ),
            _node(
                CASEY,
                "BOB CASEY",
                "candidate",
                2,
                "disclosed",
                None,
                amount_in=90.0,
                side="out",
                basis={
                    "basis": "filed",
                    "rule": "Schedule E targeting",
                    "source_urls": [FEC + "/candidate"],
                    "checked_by": None,
                    "checked_at": None,
                },
            ),
        ],
        "edges": [
            _edge(MID, SUPER, 70.0, 1),
            _edge("agg:other@" + SUPER, SUPER, 20.0, 1, None),
            _edge("ind:alice", SUPER, 10.0, 1),
            _edge("org:DARK_LLC", MID, 30.0, 2),
            _edge("ind:bob", MID, 40.0, 2),
            _edge(SUPER, "vendor:v1", 60.0, 1),
            _edge(
                "vendor:v1",
                "ad:a1",
                1000.0,
                2,
                kind="placement",
                basis={
                    "basis": "inferred",
                    "rule": "Synthetic test placement",
                    "source_urls": [FEC + "/ad"],
                    "checked_by": None,
                    "checked_at": None,
                },
            ),
            _edge(
                "vendor:v1",
                CASEY,
                90.0,
                2,
                kind="targeting",
                support_oppose="O",
                basis={
                    "basis": "filed",
                    "rule": "Schedule E targeting",
                    "source_urls": [FEC + "/candidate"],
                    "checked_by": None,
                    "checked_at": None,
                },
            ),
        ],
    }


def party_entity() -> dict[str, Any]:
    return {
        "entity_id": PARTY,
        "name": "PARTY COMMITTEE",
        "committee_type_label": "Party committee",
        "source_url": FEC + "/party",
        "aliases": ["THE PARTY"],
        "totals": {"receipts": 500.0},
        "inflows": [
            {
                "from_entity_id": "ind:carol",
                "from_name": "CAROL, C",
                "amount": 300.0,
                "visibility": "disclosed",
                "source_url": FEC + "/carol",
            },
            {
                "from_entity_id": "C00000099",
                "from_name": "STATE PARTY",
                "amount": 200.0,
                "visibility": "disclosed",
                "source_url": FEC + "/state",
            },
        ],
    }


def inputs() -> Inputs:
    return Inputs(
        race=RACE, ledger=ledger(), ads=ads(), chains={SUPER: super_chain()}, entities={PARTY: party_entity()}
    )


def _walk(obj: Any, path: str = "$"):
    if isinstance(obj, dict):
        yield path, obj
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")


# ---------------------------------------------------------------------------


def test_every_number_carries_a_source_url() -> None:
    trails = build_trails(inputs(), generated_at="2026-01-01T00:00:00+00:00")
    numeric_keys = {"amount", "min", "max", "total_in"}
    for path, d in _walk(trails["answers"]):
        if any(isinstance(d.get(k), (int, float)) for k in numeric_keys):
            if ".graph.edges[" in path and d.get("source_url") is None:
                continue
            assert str(d.get("source_url", "")).startswith("http"), f"{path} has a number without a source_url: {d}"


def test_output_validates_against_contract() -> None:
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "trails.schema.json").read_text())
    trails = build_trails(inputs(), generated_at="2026-01-01T00:00:00+00:00")
    errors = sorted(Draft7Validator(schema).iter_errors(trails), key=lambda e: list(e.path))
    assert errors == [], [e.message for e in errors][:5]


def test_candidate_spender_lists_targeting_edges_largest_first_and_never_money() -> None:
    a = candidate_spender_answer(inputs(), CASEY)
    assert a["total"] == {"amount": 120.0, "source_url": FEC + "/ie"}
    assert [(e["spender_id"], e["support_oppose"], e["amount"]) for e in a["spenders"]] == [
        (SUPER, "O", 90.0),
        (PARTY, "S", 20.0),
    ]
    assert {e["kind"] for e in a["spenders"]} == {"targeting"}
    assert all(e["source_url"].endswith(f"candidate_id={CASEY}") for e in a["spenders"])
    assert "$120" in a["headline"] and "BIG SUPER PAC" in a["headline"]
    assert any("None of this money reaches the candidate" in c for c in a["caveats"])


def test_candidate_spender_zero_rows_dropped() -> None:
    a = candidate_spender_answer(inputs(), MCCORMICK)
    assert a["spenders"] == []  # SUPER's $0 row about McCormick is not a spender


def test_ad_funding_attributes_ads_to_sponsors_not_funders() -> None:
    inp = inputs()
    a = candidate_ad_funding_answer(inp, CASEY, ad_runs(inp))
    ids = [s["sponsor_id"] for s in a["sponsors"]]
    assert ids == [CASEY_PCC, SUPER]  # own committee first; NOISE (no Schedule E about Casey) excluded
    assert a["spenders_without_ads"] == 1  # PARTY filed IEs but has no ads
    own, sup = a["sponsors"]
    assert (
        own["is_candidate_committee"]
        and own["targeting"] is None
        and own["campaign_receipts"]["receipts"]["amount"] == 58.0
    )
    assert sup["ads"]["ad_count"] == 2 and sup["ads"]["spend"] == {"min": 6000, "max": None, "source_url": GOOGLE}
    assert sup["ads"]["match_confidence"] == "verified"
    assert sup["targeting"]["kind"] == "targeting" and sup["targeting"]["amount"] == 90.0
    # funders point at the sponsor, never at an ad; ads carry no funder field
    assert all(f["kind"] == "money" and f["to_id"] == SUPER for f in sup["funded_by"])
    assert "funder" not in sup["ads"] and "funded_by" not in sup["ads"]
    assert [f["from_id"] for f in sup["funded_by"]] == [MID, "agg:other@" + SUPER, "ind:alice"]
    assert sup["shares"]["dark"] == 0.3 and sup["shares"]["source_url"].startswith("https://www.fec.gov/data/receipts/")
    assert any("none of them can be said to have paid for any particular ad" in c for c in a["caveats"])
    assert "MID PAC" in a["headline"] and "Other contributors" not in a["headline"]


def test_committee_funding_from_chain_hops_and_termini() -> None:
    a = committee_funding_answer(inputs(), SUPER)
    assert a is not None
    assert a["total_in"]["amount"] == 100.0
    assert [(f["from_id"], f["amount"], f["depth"]) for f in a["funders"]] == [
        (MID, 70.0, 1),
        ("agg:other@" + SUPER, 20.0, 1),
        ("ind:alice", 10.0, 1),
    ]
    assert a["funders"][1]["contributor_count"] == 40
    assert (
        a["funders"][1]["source_url"]
        == f"https://www.fec.gov/data/receipts/?committee_id={SUPER}&two_year_transaction_period=2024"
    )
    assert [(h["from_id"], h["to_id"], h["depth"]) for h in a["next_hop"]] == [
        ("ind:bob", MID, 2),
        ("org:DARK_LLC", MID, 2),
    ]
    assert [(u["id"], u["gave_to_id"], u["amount"]) for u in a["ultimate"]] == [
        ("ind:bob", MID, 40.0),
        ("org:DARK_LLC", MID, 30.0),
    ]
    assert a["ultimate"][1]["organization_class"] == "llc" and a["ultimate"][1]["visibility"] == "dark"
    assert [(e["candidate_id"], e["support_oppose"]) for e in a["spent_on"]] == [(CASEY, "O")]
    assert "70% of it came from MID PAC (committee)" in a["headline"]
    assert "MID PAC received $40 from BOB, ROBERT" in a["headline"]
    assert "60% of the money reaches named people" in a["headline"]


def test_committee_funding_falls_back_to_entity_inflows() -> None:
    a = committee_funding_answer(inputs(), PARTY)
    assert a is not None
    assert a["total_in"] == {"amount": 500.0, "source_url": FEC + "/party"}
    assert [(f["from_id"], f["from_kind"], f["amount"]) for f in a["funders"]] == [
        ("ind:carol", "individual", 300.0),
        ("C00000099", "committee", 200.0),
    ]
    assert a["shares"] is None and a["next_hop"] == [] and a["ultimate"] == []
    assert any("No multi-hop walk" in c for c in a["caveats"])


def test_committee_funding_unknown_is_none() -> None:
    assert committee_funding_answer(inputs(), "C99999999") is None


def test_committee_graph_is_bounded_truncated_and_provenance_preserving() -> None:
    inp = inputs()
    chain = inp.chains[SUPER]
    for i, amount in enumerate((9.0, 8.0, 7.0, 6.0), start=1):
        funder_id = f"C0000001{i}"
        chain["nodes"].append(_node(funder_id, f"FUNDER {i}", "committee", 1, "disclosed", None, amount_in=amount))
        chain["edges"].append(_edge(funder_id, SUPER, amount, 1, url=FEC + f"/funder-{i}"))

    answer = committee_funding_answer(inp, SUPER)
    assert answer is not None
    graph = answer["graph"]
    assert graph["root_id"] == SUPER
    root = next(n for n in graph["nodes"] if n["id"] == SUPER)
    assert root["depth"] == 0 and "side" not in root
    truncation = next(t for t in graph["truncated"] if t["layer"] == "funders_1")
    assert truncation == {"layer": "funders_1", "kept": 5, "hidden": 2}
    assert all(
        e["from"] in {n["id"] for n in graph["nodes"]} and e["to"] in {n["id"] for n in graph["nodes"]}
        for e in graph["edges"]
    )

    for edge in graph["edges"]:
        raw = next(
            candidate
            for candidate in chain["edges"]
            if candidate["from"] == edge["from"]
            and candidate["to"] == edge["to"]
            and candidate.get("kind", "money") == edge.get("kind", "money")
        )
        assert edge.get("source_url") == raw.get("source_url")
        assert edge.get("basis") == raw.get("basis")
    assert not any(
        edge.get("kind", "money") == "money"
        and next(n for n in graph["nodes"] if n["id"] == edge["to"])["kind"] == "ad"
        for edge in graph["edges"]
    )
    funding_ids = {n["id"] for n in graph["nodes"] if n["id"] != SUPER and n.get("side") == "in"}
    assert not any(
        edge["from"] in funding_ids and next(n for n in graph["nodes"] if n["id"] == edge["to"])["kind"] == "ad"
        for edge in graph["edges"]
    )
    assert len([n for n in graph["nodes"] if n.get("side") == "in" and n["depth"] == 1]) <= 5
    assert len([n for n in graph["nodes"] if n.get("side") == "in" and n["depth"] == 2]) <= 5
    assert len([n for n in graph["nodes"] if n.get("side") == "out" and n["kind"] == "vendor"]) <= 5
    assert len([n for n in graph["nodes"] if n.get("side") == "out" and n["kind"] == "ad"]) <= 5


def test_candidate_spender_graph_has_root_synthesized_spender_and_pooled_funders() -> None:
    graph = candidate_spender_answer(inputs(), CASEY)["graph"]
    root = next(n for n in graph["nodes"] if n["id"] == CASEY)
    assert root["depth"] == 0 and root["side"] == "out"
    assert root["amount_in"] == ledger()["candidates"][0]["outside"]["total"]
    spenders = {n["id"]: n for n in graph["nodes"] if n.get("side") == "in" and n["depth"] == 1}
    assert spenders[SUPER]["side"] == "in"
    assert spenders[PARTY]["side"] == "in"  # no chain: synthesized from the ledger/entity
    targeting = [e for e in graph["edges"] if e.get("kind") == "targeting"]
    assert targeting and all(e["support_oppose"] in {"S", "O"} for e in targeting)
    assert {n["id"] for n in graph["nodes"] if n.get("side") == "in" and n["depth"] == 2} >= {
        MID,
        "agg:other@" + SUPER,
        "ind:alice",
    }


def test_candidate_spender_graph_keeps_spender_at_shallowest_depth() -> None:
    inp = inputs()
    inp.chains[PARTY] = {
        "race_id": RACE.race_id,
        "root_name": "PARTY COMMITTEE",
        "summary": {
            "total_in": 20.0,
            "disclosed_share": 1.0,
            "inferable_share": 0.0,
            "dark_share": 0.0,
            "max_depth": 1,
        },
        "method": "synthetic",
        "nodes": [
            _node(PARTY, "PARTY COMMITTEE", "committee", 0, "disclosed", None, committee_type="P", amount_in=20.0),
            _node(SUPER, "BIG SUPER PAC", "committee", 1, "disclosed", None, committee_type="O", amount_in=20.0),
        ],
        "edges": [_edge(SUPER, PARTY, 20.0, 1)],
    }
    graph = candidate_spender_answer(inp, CASEY)["graph"]
    super_node = next(n for n in graph["nodes"] if n["id"] == SUPER)
    assert super_node["depth"] == 1 and super_node["side"] == "in"
    assert any(e["from"] == SUPER and e["to"] == CASEY and e["kind"] == "targeting" for e in graph["edges"])
    assert any(e["from"] == SUPER and e["to"] == PARTY and e["kind"] == "money" for e in graph["edges"])


def test_candidate_ad_funding_graph_keeps_own_committee_and_ad_provenance() -> None:
    graph = candidate_ad_funding_answer(inputs(), CASEY, ad_runs(inputs()))["graph"]
    own = next(n for n in graph["nodes"] if n["id"] == CASEY_PCC)
    assert own["depth"] == 1
    assert not any(e["from"] == CASEY_PCC and e["to"] == CASEY for e in graph["edges"])
    ads_in_graph = [n for n in graph["nodes"] if n["kind"] == "ad"]
    assert ads_in_graph and all(n["basis"]["basis"] in {"verified", "inferred"} for n in ads_in_graph)
    funder_ids = {n["id"] for n in graph["nodes"] if n.get("side") == "in" and n["depth"] == 2}
    assert not any(e["from"] in funder_ids and e["to"] in {n["id"] for n in ads_in_graph} for e in graph["edges"])


def test_committee_without_chain_has_no_graph() -> None:
    answer = committee_funding_answer(inputs(), PARTY)
    assert answer is not None and answer["graph"] is None


def test_subjects_and_aliases() -> None:
    subs = subjects(inputs())
    by_id = {s["id"]: s for s in subs}
    assert by_id[CASEY]["aliases"] == ["bob casey", "casey"]
    assert by_id[PARTY]["aliases"] == ["party committee", "party", "the party", PARTY.lower()]
    assert by_id[CASEY]["principal_committee_id"] == CASEY_PCC
    assert by_id[SUPER]["type_label"] == "Super PAC"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("WINSENATE", ["winsenate"]),
        ("KEYSTONE RENEWAL PAC", ["keystone renewal pac", "keystone renewal"]),
        (
            "AMERICANS FOR PROSPERITY ACTION, INC. (AFP ACTION) DBA CVA ACTION",
            [
                "americans for prosperity action inc afp action dba cva action",
                "americans for prosperity action inc",
                "afp action",
                "americans for prosperity action",
            ],
        ),
        ("BOB CASEY FOR SENATE INC", ["bob casey for senate inc", "bob casey for senate"]),
    ],
)
def test_name_aliases(name: str, expected: list[str]) -> None:
    assert name_aliases(name) == expected


def test_build_is_deterministic() -> None:
    a = build_trails(inputs(), generated_at="2026-01-01T00:00:00+00:00")
    b = build_trails(inputs(), generated_at="2026-01-01T00:00:00+00:00")
    assert a == b
    assert [answer["graph"] for answer in a["answers"]] == [answer["graph"] for answer in b["answers"]]
    assert [x["intent"] for x in a["answers"]][:4] == ["candidate_spender", "candidate_ad_funding"] * 2
    assert a["examples"][0] == "Who is spending against Bob Casey?"
