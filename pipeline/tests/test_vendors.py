"""Payee normalisation, medium classification and the grouping-never-changes-totals invariant for `campaign_commons.vendors`."""

import json
from pathlib import Path

import pytest

from campaign_commons.config import PA_SEN_2024
from campaign_commons.vendors import (
    SIMILARITY_THRESHOLD,
    HandAlias,
    classify_medium,
    cluster_payees,
    entity_vendor_rows,
    fec_ie_payee_url,
    normalize_payee,
    similarity,
    slugify,
    token_sort_key,
)

OUT = PA_SEN_2024.out_dir


# ---------------------------------------------------------------------------
# normalisation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Deliver Strategies, LLC", "DELIVER STRATEGIES"),
        ("THE PIVOT GROUP, INC.", "THE PIVOT GROUP"),  # GROUP is not a suffix
        ("WATERFRONT STRATEGIES INC.", "WATERFRONT STRATEGIES"),
        ("SECOND STREET ASSOCIATES L.L.C.", "SECOND STREET ASSOCIATES"),
        ("KENNEDY PRINTING CO., INC.", "KENNEDY PRINTING"),  # two trailing suffixes
        ("STONES' PHONES", "STONES PHONES"),
        ("MIDDLE  SEAT   CONSULTING", "MIDDLE SEAT CONSULTING"),
        ("BUNNEWITH, MARIA", "BUNNEWITH MARIA"),
        ("CO", "CO"),  # never strip the last token
    ],
)
def test_normalize_payee(raw: str, expected: str) -> None:
    assert normalize_payee(raw) == expected


def test_token_sort_key_folds_word_order() -> None:
    assert token_sort_key(normalize_payee("BUNNEWITH, MARIA")) == token_sort_key(normalize_payee("MARIA BUNNEWITH"))


def test_slugify() -> None:
    assert slugify("THE PIVOT GROUP") == "the-pivot-group"
    assert slugify("  U S  POSTMASTER ") == "u-s-postmaster"


def test_similarity_threshold_separates_typos_from_different_names() -> None:
    assert similarity("GENRIS RUMALDO", "GENRRIS RUMALDO") >= SIMILARITY_THRESHOLD
    assert similarity("UPS", "USPS") < SIMILARITY_THRESHOLD
    assert similarity("CAMPAIGNHQ", "CAMPAIGN HEADQUARTERS") < SIMILARITY_THRESHOLD


def _cluster(payees: dict[str, float], hand: list[HandAlias] | None = None) -> tuple[dict, list[str]]:
    log: list[str] = []
    return cluster_payees(payees, hand or [], 2024, log), log


def test_exact_key_merge_keeps_every_raw_string_as_alias_and_names_after_top_dollar() -> None:
    by, log = _cluster({"DELIVER STRATEGIES, LLC": 700.0, "DELIVER STRATEGIES LLC": 200.0, "DELIVER STRATEGIES": 5.0})
    g = by["DELIVER STRATEGIES"]
    assert g.vendor_id == "V-deliver-strategies"
    assert g.name == "DELIVER STRATEGIES, LLC"
    assert g.aliases == ["DELIVER STRATEGIES, LLC", "DELIVER STRATEGIES LLC", "DELIVER STRATEGIES"]
    assert g.normalization["basis"] == "inferred" and "≥0.92" in g.normalization["rule"]
    assert log == []  # exact folds are the rule, not a fuzzy merge


def test_fuzzy_merge_is_logged_and_requires_matching_numbers() -> None:
    by, log = _cluster(
        {
            "GENRRIS RUMALDO": 900.0,
            "RUMALDO, GENRIS": 200.0,
            "UNITE HERE LOCAL 26": 500.0,
            "UNITE HERE LOCAL 34": 400.0,
            "UNITE HERE LOCAL 74": 100.0,
        }
    )
    assert by["RUMALDO, GENRIS"] is by["GENRRIS RUMALDO"]
    assert [line for line in log if line.startswith("merge ")] == [
        "merge  'GENRIS RUMALDO' -> 'GENRRIS RUMALDO' (ratio 0.966)"
    ]
    locals_ = {by[p].vendor_id for p in ("UNITE HERE LOCAL 26", "UNITE HERE LOCAL 34", "UNITE HERE LOCAL 74")}
    assert len(locals_) == 3  # ratio > 0.92 but different numeric tokens: never merged


def test_hand_alias_wins_over_rule_and_is_verified() -> None:
    hand = [
        HandAlias(
            vendor_id="V-meta-platforms",
            name="Meta Platforms",
            aliases=("META", "meta platforms inc.", "FACEBOOK"),
            medium_override="digital",
            source_url="https://about.fb.com/news/2021/10/facebook-company-is-now-meta/",
            tagged_by="devin-block2-vendors",
            tagged_at="2026-09-05",
        )
    ]
    by, log = _cluster({"META": 300.0, "META PLATFORMS INC.": 100.0, "FACEBOOK": 50.0, "META, INC": 20.0}, hand)
    g = by["META"]
    assert g is by["FACEBOOK"] and g is by["META PLATFORMS INC."]
    assert g.name == "Meta Platforms" and g.medium_override == "digital"
    assert g.normalization["basis"] == "verified"
    assert g.normalization["checked_by"] == "devin-block2-vendors" and g.normalization["checked_at"] == "2026-09-05"
    # the fec.gov payee view always comes first (it is the vendor's source_url); the hand row's source follows
    assert g.normalization["source_urls"] == [fec_ie_payee_url(g.aliases, 2024), hand[0].source_url]
    assert g.aliases == ["META", "META PLATFORMS INC.", "FACEBOOK"]
    # an unlisted variant stays with the rule (the file is exact, case-insensitive)
    assert by["META, INC"].vendor_id == "V-meta" and by["META, INC"].normalization["basis"] == "inferred"
    assert sum(1 for line in log if line.startswith("alias ")) == 3


def test_hand_alias_listed_twice_is_an_error() -> None:
    dup = HandAlias("V-x", "X", ("A", "a"), None, None, "t", None)
    with pytest.raises(ValueError):
        _cluster({"A": 1.0}, [dup])


def test_payee_url_encodes_and_scopes_to_spender() -> None:
    url = fec_ie_payee_url(["THE PIVOT GROUP, INC."], 2024, "C00865444")
    assert url.startswith("https://www.fec.gov/data/independent-expenditures/?cycle=2024")
    assert "&q_spender=C00865444" in url and "payee_name=THE+PIVOT+GROUP%2C+INC." in url


# ---------------------------------------------------------------------------
# medium
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("purpose", "medium"),
    [
        ("MEDIA BUY", "tv"),
        ("TV/MEDIA PLACEMENT - FILED ON 10/30/2024", "tv"),
        ("CABLE ADVERTISING", "tv"),
        ("DIGITAL MEDIA BUY", "digital"),  # digital beats the generic media buy
        ("ONLINE ADVERTISING", "digital"),
        ("EMAILS / SMS MESSAGING", "digital"),
        ("MEDIA PRODUCTION", "production"),  # production beats media
        ("MAILER PRODUCTION", "production"),
        ("DIRECT MAIL", "mail"),
        ("MAILER POSTAGE", "mail"),
        ("PRINTING / POSTAGE", "mail"),
        ("PHONE CALLS", "phones"),
        ("TEXT MESSAGING", "phones"),
        ("GOTV TEXTS", "phones"),  # GOTV is not TV
        ("ROBOCALLS", "phones"),
        ("RADIO PLACEMENT", "radio"),
        ("RADIO ADVERTISING & PRODUCTION", "production"),
        ("POLLING", "consulting"),
        ("POLITICAL STRATEGY CONSULTING", "consulting"),
        ("LIST PURCHASE", "consulting"),
        ("LISTED EVENT", "other"),  # LIST is whole-word
        ("VOTER FILE", "consulting"),
        ("CANVASSING", "other"),
        ("BILLBOARD RENTAL", "other"),
        ("", "other"),
        (None, "other"),
    ],
)
def test_classify_medium(purpose: str | None, medium: str) -> None:
    assert classify_medium(purpose) == medium


# ---------------------------------------------------------------------------
# reconciliation on the emitted artifacts (skipped when the stage has not been run)
# ---------------------------------------------------------------------------

vendors_index = OUT / "vendors.json"
needs_data = pytest.mark.skipif(not vendors_index.exists(), reason="run `make vendors` first")


def _load(p: Path) -> dict:
    return json.loads(p.read_text())


def _cents(x: float) -> int:
    return round(x * 100)


@needs_data
def test_vendor_totals_reconcile_to_ie_rows_and_ledger_to_the_cent() -> None:
    index = _load(vendors_index)
    ledger = _load(OUT / "ledger.json")
    rows = [r for f in (OUT / "entities").glob("*.json") for r in _load(f).get("independent_expenditures") or []]
    ie_total = sum(_cents(r["amount"]) for r in rows)
    unresolved = [r for r in rows if not (r.get("payee") or "").strip()]
    assert sum(_cents(v["total"]) for v in index["vendors"]) + sum(_cents(r["amount"]) for r in unresolved) == ie_total
    assert _cents(index["total"]) + sum(_cents(r["amount"]) for r in unresolved) == ie_total
    assert ie_total == _cents(ledger["traceability"]["outside_total"])
    assert sum(_cents(m["amount"]) for m in index["by_medium"]) == _cents(index["total"])
    assert sum(v["count"] for v in index["vendors"]) + len(unresolved) == len(rows)
    # every vendor's own file agrees with its index row
    for v in index["vendors"]:
        detail = _load(OUT / "vendors" / f"{v['vendor_id']}.json")
        assert _cents(detail["total"]) == sum(_cents(r["amount"]) for r in detail["expenditures"]) == _cents(v["total"])
        assert all(r["vendor_id"] == v["vendor_id"] for r in detail["expenditures"])
        # ads are linked only to vendors the ad's sponsor actually paid, never as fact
        spender_ids = {s["entity_id"] for s in detail["spenders"]}
        for ad in detail["ads"]:
            assert ad["sponsor_entity_id"] in spender_ids
            assert ad["basis"]["basis"] in {"verified", "inferred", "adjacent"}


@needs_data
def test_every_ie_row_with_a_payee_has_a_vendor_and_empty_payees_are_reported() -> None:
    index = _load(vendors_index)
    known = {v["vendor_id"] for v in index["vendors"]}
    aliases = {a for v in index["vendors"] for a in v["aliases"]}
    unresolved = 0
    for f in (OUT / "entities").glob("*.json"):
        for r in _load(f).get("independent_expenditures") or []:
            assert "medium" in r
            if (r.get("payee") or "").strip():
                assert r["vendor_id"] in known, r["ie_id"]
                assert r["payee"] in aliases
            else:
                assert r["vendor_id"] is None
                unresolved += 1
    assert any(f"{unresolved} IE row(s) with no payee" in n for n in index["notes"])


@needs_data
def test_per_spender_vendor_rows_reconcile_to_that_entitys_ie_rows() -> None:
    seen = 0
    for f in (OUT / "entities").glob("*.json"):
        e = _load(f)
        rows = e.get("independent_expenditures") or []
        if not rows:
            assert "vendors" not in e
            continue
        seen += 1
        resolved = [r for r in rows if (r.get("payee") or "").strip()]
        assert sum(_cents(v["amount"]) for v in e["vendors"]) == sum(_cents(r["amount"]) for r in resolved)
        assert sum(v["count"] for v in e["vendors"]) == len(resolved)
        assert [v["amount"] for v in e["vendors"]] == sorted((v["amount"] for v in e["vendors"]), reverse=True)
        for v in e["vendors"]:
            assert e["entity_id"] in v["source_url"]
            assert sum(_cents(t["amount"]) for t in v["targets"]) == _cents(v["amount"])
            assert sum(_cents(m["amount"]) for m in v["media_mix"]) == _cents(v["amount"])
    assert seen > 0


@needs_data
def test_index_sorted_by_total_desc_and_ids_are_slugs() -> None:
    index = _load(vendors_index)
    totals = [v["total"] for v in index["vendors"]]
    assert totals == sorted(totals, reverse=True)
    for v in index["vendors"]:
        assert v["vendor_id"] == "V-" + slugify(v["vendor_id"][2:])
        assert v["source_url"].startswith("https://www.fec.gov/data/independent-expenditures/")
        assert v["normalization"]["basis"] in ("inferred", "verified")
        if v["normalization"]["basis"] == "verified":
            assert v["normalization"]["checked_by"] and v["normalization"]["checked_at"]
    assert index["medium_basis"]["basis"] == "inferred"


def test_entity_vendor_rows_group_one_spenders_rows() -> None:
    by, _ = _cluster({"A INC": 10.0, "B": 5.0})
    rows = [
        {"ie_id": "1", "spender_entity_id": "C1", "spender_name": "S", "candidate_id": "K", "support_oppose": "O",
         "amount": 6.0, "date": "2024-10-01", "payee": "A INC", "vendor_id": "V-a", "medium": "tv"},
        {"ie_id": "2", "spender_entity_id": "C1", "spender_name": "S", "candidate_id": "K", "support_oppose": "O",
         "amount": 4.0, "date": "2024-09-01", "payee": "A INC", "vendor_id": "V-a", "medium": "digital"},
        {"ie_id": "3", "spender_entity_id": "C1", "spender_name": "S", "candidate_id": "K", "support_oppose": "S",
         "amount": 5.0, "date": None, "payee": "B", "vendor_id": "V-b", "medium": "other"},
        {"ie_id": "4", "spender_entity_id": "C1", "spender_name": "S", "candidate_id": "K", "support_oppose": "S",
         "amount": 1.0, "date": None, "payee": "", "vendor_id": None, "medium": "other"},
    ]  # fmt: skip
    out = entity_vendor_rows(rows, by, 2024)
    assert [(r["vendor_id"], r["amount"], r["count"]) for r in out] == [("V-a", 10.0, 2), ("V-b", 5.0, 1)]
    assert out[0]["first_date"] == "2024-09-01" and out[0]["last_date"] == "2024-10-01"
    assert out[0]["media_mix"] == [
        {"medium": "tv", "amount": 6.0, "count": 1},
        {"medium": "digital", "amount": 4.0, "count": 1},
    ]
    assert out[1]["first_date"] is None and "q_spender=C1" in out[1]["source_url"]
