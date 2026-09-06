"""campaign_commons.issues: hand issue files -> entity patches + issues.json, on a small fixture race."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from campaign_commons.issues import FOCUS_RULE, IE_TAG_RULE, RowRefs, build

TAG = {"tagged_by": "tester", "tagged_at": "2026-09-05"}
SRC = "https://example.org/about"
IE_URL = "https://docquery.fec.gov/cgi-bin/fecimg/?1"
AD_URL = "https://adstransparency.google.com/advertiser/AR1/creative/CR1"


def _write(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def _entity(entity_id: str, ies: list[dict]) -> dict:
    return {
        "entity_id": entity_id,
        "name": entity_id,
        "totals": {"independent_expenditures": sum(ie["amount"] for ie in ies)},
        "independent_expenditures": ies,
        "flags": [],
    }


def _ie(spender: str, n: int, amount: float, candidate: str, so: str) -> dict:
    return {
        "ie_id": f"{spender}-ie-1-{n}",
        "spender_entity_id": spender,
        "candidate_id": candidate,
        "support_oppose": so,
        "amount": amount,
        "source_url": IE_URL,
    }


@pytest.fixture
def race(tmp_path: Path) -> RowRefs:
    out, hand = tmp_path / "out", tmp_path / "hand"
    spenders = [
        ("C1", 600.0, [_ie("C1", 1, 400.0, "CAND_A", "O"), _ie("C1", 2, 200.0, "CAND_B", "S")]),
        ("C2", 300.0, [_ie("C2", 1, 300.0, "CAND_A", "O")]),
        ("C3", 100.0, [_ie("C3", 1, 100.0, "CAND_B", "S")]),
        ("C4", 50.0, [_ie("C4", 1, 50.0, "CAND_A", "S")]),
    ]
    for entity_id, _, ies in spenders:
        _write(out / "entities" / f"{entity_id}.json", _entity(entity_id, ies))
    _write(
        out / "ledger.json",
        {
            "data_status": "real",
            "top_outside_spenders": [{"entity_id": e, "total": t} for e, t, _ in spenders],
            "traceability": {"outside_total": 1050.0},
        },
    )
    _write(out / "chains" / "C1.json", {"summary": {"disclosed_share": 0.5, "dark_share": 0.5}})
    _write(out / "chains" / "C2.json", {"summary": {"disclosed_share": 1.0, "dark_share": 0.0}})
    # C3 and C4 have no chain
    _write(
        out / "ads.json",
        {
            "ads": [
                {
                    "ad_id": "AD1",
                    "candidate_ids": ["CAND_A"],
                    "support_oppose": "O",
                    "spend_range": {"min": 100, "max": 200},
                    "source_url": AD_URL,
                },
                {
                    "ad_id": "AD2",
                    "candidate_ids": ["CAND_A", "CAND_B"],
                    "support_oppose": "S",
                    "spend_range": {"min": 1000, "max": 3000},
                    "source_url": AD_URL + "2",
                },
                {
                    "ad_id": "AD3",
                    "candidate_ids": [],
                    "support_oppose": "S",
                    "spend_range": {"min": 0, "max": 100},
                    "source_url": AD_URL + "3",
                },
            ]
        },
    )
    return RowRefs(out_dir=out, hand_dir=hand)


def _focus(entity_id: str, kind: str, issue_ids: list[str]) -> dict:
    return {
        "entity_id": entity_id,
        "name": entity_id,
        "kind": kind,
        "issue_ids": issue_ids,
        "description": "own words",
        "source_urls": [SRC],
        "quote": None,
        **TAG,
    }


def _hand(refs: RowRefs, focus: list[dict], ies: list[dict], ads: list[dict]) -> None:
    for name, rows in (("issue_focus", focus), ("ie_issues", ies), ("ad_issues", ads)):
        _write(refs.hand_dir / f"{name}.json", {"race_id": "t", "method": "fixture", "rows": rows})


FOCUS = [
    _focus("C1", "general_partisan", []),
    _focus("C2", "multi_issue", ["healthcare", "tax_budget"]),
    _focus("C3", "labor", ["labor_trade"]),
    _focus("org:NOT_A_SPENDER", "single_issue", ["guns"]),
]
IES = [
    {
        "ie_id": "C1-ie-1-1",
        "issue_ids": ["healthcare", "tax_budget"],
        "ad_title": "Bad Deal",
        "source_url": IE_URL,
        "note": None,
        **TAG,
    },
    {"ie_id": "C2-ie-1-1", "issue_ids": ["healthcare"], "ad_title": None, "source_url": IE_URL, "note": None, **TAG},
    {"ie_id": "C9-ie-1-1", "issue_ids": ["guns"], "ad_title": None, "source_url": IE_URL, "note": None, **TAG},
]
ADS = [
    {"ad_id": "AD1", "issue_ids": ["healthcare"], "note": None, **TAG},
    {"ad_id": "AD2", "issue_ids": ["healthcare", "guns"], "note": None, **TAG},
    {"ad_id": "MISSING", "issue_ids": ["guns"], "note": None, **TAG},
]


def _read(path: Path) -> dict:
    return json.loads(path.read_text())


def _row(issues: dict, issue_id: str) -> dict:
    return next(r for r in issues["by_ad_issue"] if r["issue_id"] == issue_id)


def _bucket(issues: dict, kind: str, issue_id: str | None, primary_only: bool) -> dict:
    return next(
        b
        for b in issues["by_spender_focus"]
        if b["kind"] == kind and b["issue_id"] == issue_id and b["primary_only"] is primary_only
    )


def test_focus_merge_patches_only_issue_focus(race: RowRefs) -> None:
    _hand(race, FOCUS, [], [])
    before = _read(race.out_dir / "entities" / "C2.json")
    build("t", race)
    after = _read(race.out_dir / "entities" / "C2.json")
    focus = after.pop("issue_focus")
    assert after == before
    assert focus["kind"] == "multi_issue" and focus["issue_ids"] == ["healthcare", "tax_budget"]
    assert focus["basis"] == {
        "basis": "verified",
        "rule": FOCUS_RULE,
        "source_urls": [SRC],
        "checked_by": "tester",
        "checked_at": "2026-09-05",
    }
    assert "issue_focus" not in _read(race.out_dir / "entities" / "C4.json")
    assert not (race.out_dir / "entities" / "org:NOT_A_SPENDER.json").exists()


def test_ie_tag_merge(race: RowRefs) -> None:
    _hand(race, [], IES, [])
    build("t", race)
    c1 = _read(race.out_dir / "entities" / "C1.json")["independent_expenditures"]
    tagged, untagged = c1
    assert tagged["issues"] == {
        "issue_ids": ["healthcare", "tax_budget"],
        "basis": {
            "basis": "verified",
            "rule": IE_TAG_RULE,
            "source_urls": [IE_URL],
            "checked_by": "tester",
            "checked_at": "2026-09-05",
        },
    }
    assert "issues" not in untagged


def test_by_ad_issue_sums_midpoint_and_ie_dollars_separately(race: RowRefs) -> None:
    _hand(race, [], IES, ADS)
    issues = build("t", race)
    health = _row(issues, "healthcare")
    # AD1 100..200 (mid 150) + AD2 1000..3000 (mid 2000); MISSING is dropped
    assert (health["ad_count"], health["spend_min"], health["spend_max"], health["spend_midpoint"]) == (
        2,
        1100,
        3200,
        2150,
    )
    # C1 IE 400 (two tags) + C2 IE 300; C9 has no entity file
    assert (health["ie_count"], health["ie_amount"]) == (2, 700)
    # multi-tag: full amount under each tag, never split
    tax = _row(issues, "tax_budget")
    assert (tax["ie_count"], tax["ie_amount"], tax["ad_count"]) == (1, 400, 0)
    guns = _row(issues, "guns")
    assert (guns["ad_count"], guns["spend_midpoint"], guns["ie_count"]) == (1, 2000, 0)
    assert health["basis"]["basis"] == "verified"
    assert set(health["basis"]["source_urls"]) == {AD_URL, AD_URL + "2", IE_URL}
    assert "midpoint" in health["basis"]["rule"]


def test_by_candidate_split(race: RowRefs) -> None:
    _hand(race, [], IES, ADS)
    health = _row(build("t", race), "healthcare")
    cells = {
        (c["candidate_id"], c["support_oppose"]): (c["spend_midpoint"], c["ie_amount"]) for c in health["by_candidate"]
    }
    assert cells == {
        ("CAND_A", "O"): (150.0, 700.0),  # AD1 mid + C1/C2 IEs against A
        ("CAND_A", "S"): (2000.0, 0.0),  # AD2 counted under each candidate it names
        ("CAND_B", "S"): (2000.0, 0.0),
    }
    assert sum(v[1] for v in cells.values()) == health["ie_amount"]


def test_spender_focus_weighting_and_null_issue(race: RowRefs) -> None:
    _hand(race, FOCUS, [], [])
    issues = build("t", race)
    gp = _bucket(issues, "general_partisan", None, True)
    assert gp["amount"] == 600 and gp["spender_ids"] == ["C1"]
    assert (gp["traceability_score"], gp["dark_share"]) == (0.5, 0.5)
    # multi_issue: primary bucket = first issue only; all-tags buckets = every issue
    assert _bucket(issues, "multi_issue", "healthcare", True)["amount"] == 300
    assert _bucket(issues, "multi_issue", "tax_budget", False)["amount"] == 300
    with pytest.raises(StopIteration):
        _bucket(issues, "multi_issue", "tax_budget", True)
    # labor names an issue but is a non-issue kind: the kind bucket is primary; the issue bucket only in all-tags
    assert _bucket(issues, "labor", None, True)["amount"] == 100
    assert _bucket(issues, "labor", "labor_trade", False)["amount"] == 100
    with pytest.raises(StopIteration):
        _bucket(issues, "labor", "labor_trade", True)
    # no chain among the bucket's spenders -> null, not 0
    assert _bucket(issues, "labor", None, True)["traceability_score"] is None
    for b in issues["by_spender_focus"]:
        assert b["kind"] not in ("single_issue", "multi_issue") or b["issue_id"] is not None
        assert "org:NOT_A_SPENDER" not in b["spender_ids"]


def test_dollar_weighted_shares(race: RowRefs) -> None:
    _hand(race, [_focus("C1", "general_partisan", []), _focus("C2", "general_partisan", [])], [], [])
    gp = _bucket(build("t", race), "general_partisan", None, True)
    # (600*0.5 + 300*1.0) / 900
    assert gp["traceability_score"] == round(600 / 900, 4)
    assert gp["dark_share"] == round(300 / 900, 4)


def test_coverage_and_reconciliation(race: RowRefs) -> None:
    _hand(race, FOCUS, IES, ADS)
    issues = build("t", race)
    assert issues["coverage"] == {
        "spenders_tagged": 3,
        "spenders_total": 4,
        "dollars_tagged": 1000.0,
        "dollars_total": 1050.0,
        "ads_tagged": 2,
        "ads_total": 3,
        "ies_tagged": 2,
        "ie_dollars_tagged": 700.0,
        "spenders_with_positions": 0,
    }
    ledger = _read(race.out_dir / "ledger.json")
    totals = {s["entity_id"]: s["total"] for s in ledger["top_outside_spenders"]}
    # primary_only buckets partition the tagged dollars exactly; each spender appears once
    primary = [b for b in issues["by_spender_focus"] if b["primary_only"]]
    assert sum(b["amount"] for b in primary) == issues["coverage"]["dollars_tagged"]
    seen = [s for b in primary for s in b["spender_ids"]]
    assert sorted(seen) == sorted(set(seen))
    for b in issues["by_spender_focus"]:
        assert b["amount"] == sum(totals[s] for s in b["spender_ids"])
    assert issues["coverage"]["dollars_tagged"] <= ledger["traceability"]["outside_total"]
    assert issues["data_status"] == "partial"
    assert any("never summed" in n for n in issues["notes"])


def test_idempotent(race: RowRefs) -> None:
    _hand(race, FOCUS, IES, ADS)
    first = build("t", race)
    snapshot = {p.name: p.read_text() for p in (race.out_dir / "entities").glob("*.json")}
    second = build("t", race)
    assert {p.name: p.read_text() for p in (race.out_dir / "entities").glob("*.json")} == snapshot
    first.pop("generated_at"), second.pop("generated_at")
    assert first == second


def test_missing_hand_files_are_a_noop(race: RowRefs) -> None:
    before = {p.name: p.read_text() for p in (race.out_dir / "entities").glob("*.json")}
    issues = build("t", race)
    assert {p.name: p.read_text() for p in (race.out_dir / "entities").glob("*.json")} == before
    assert issues["by_ad_issue"] == [] and issues["by_spender_focus"] == []
    assert issues["coverage"]["spenders_tagged"] == 0 and issues["coverage"]["ads_total"] == 3
    assert issues["data_status"] == "partial"


def test_missing_ads_json_is_a_noop_for_ads(race: RowRefs) -> None:
    (race.out_dir / "ads.json").unlink()
    _hand(race, [], [], ADS)
    issues = build("t", race)
    assert issues["coverage"]["ads_tagged"] == 0 and issues["coverage"]["ads_total"] == 0


def test_open_ended_spend_bucket_uses_floor_and_is_disclosed_in_rule(race: RowRefs) -> None:
    ads_path = race.out_dir / "ads.json"
    gallery = _read(ads_path)
    gallery["ads"][0]["spend_range"] = {"min": 100, "max": None}  # AD1: Google's top bucket has no ceiling
    _write(ads_path, gallery)
    _hand(race, [], IES, ADS)
    issues = build("t", race)
    health = _row(issues, "healthcare")
    # AD1 floor 100 stands in for max and midpoint; AD2 1000..3000 (mid 2000)
    assert (health["spend_min"], health["spend_max"], health["spend_midpoint"]) == (1100, 3100, 2100)
    assert "1 ad(s) sit in Google's open-ended top spend bucket" in health["basis"]["rule"]
    guns = _row(issues, "guns")
    assert "open-ended" not in guns["basis"]["rule"]
