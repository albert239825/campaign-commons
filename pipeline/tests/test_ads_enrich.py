import copy
import json
from pathlib import Path

from jsonschema import Draft7Validator

from campaign_commons.ads_enrich import (
    NOTE_PREFIX,
    WINDOW_LEAD_DAYS,
    JsonDict,
    enrich,
    in_window,
    patch_vendor_ads,
    sponsor_shares,
    vendor_links,
)
from campaign_commons.config import ROOT

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "block2_sponsor_vendors.json").read_text())
SPONSOR = str(FIXTURE["entity_id"])
CREATIVE = "https://adstransparency.google.com/advertiser/AR1/creative/CR1?political=&region=US"
FEC_URL = "https://www.fec.gov/data/committee/C00000001/?cycle=2024"

TAG_ROW: JsonDict = {
    "ad_id": "CR1",
    "issue_ids": ["healthcare", "tax_budget"],
    "note": "Drug-price line on screen",
    "tagged_by": "tester",
    "tagged_at": "2026-09-05",
}
HAND_LINK: JsonDict = {
    "ad_id": "CR1",
    "vendor_id": "vendor:broadcast-buyers",
    "role": "placed",
    "source_urls": ["https://example-vendor.com/work/example-victory-fund"],
    "quote": "We placed the fall flight for Example Victory Fund.",
    "tagged_by": "tester",
    "tagged_at": "2026-09-05",
}


def _entity(with_vendors: bool = True) -> JsonDict:
    e: JsonDict = {
        "entity_id": SPONSOR,
        "name": FIXTURE["name"],
        "independent_expenditures": copy.deepcopy(FIXTURE["independent_expenditures"]),
    }
    if with_vendors:
        e["vendors"] = copy.deepcopy(FIXTURE["vendors"])
    else:
        for ie in e["independent_expenditures"]:  # type: ignore[union-attr]
            ie.pop("vendor_id")
            ie.pop("medium")
    return e


def _ad(
    ad_id: str = "CR1", sponsor: str | None = SPONSOR, first: str | None = "2024-09-17", last: str | None = "2024-10-01"
) -> JsonDict:
    return {
        "ad_id": ad_id,
        "platform": "google",
        "advertiser_id": "AR1",
        "advertiser_name": "EXAMPLE VICTORY FUND",
        "matched_entity_id": sponsor,
        "match_confidence": "auto" if sponsor else "none",
        "candidate_ids": [],
        "support_oppose": None,
        "spend_range": {"min": 100000, "max": 125000},
        "impressions_range": {"min": 1000000, "max": None},
        "first_shown": first,
        "last_shown": last,
        "ad_type": "video",
        "creative_url": CREATIVE,
        "cached_creative_path": None,
        "regions": ["US"],
        "source_url": CREATIVE,
        "verification": {"status": "unverified", "evidence_urls": [], "verified_at": None},
    }


def _gallery(*ads: JsonDict) -> JsonDict:
    return {
        "race_id": "pa-sen-2024",
        "generated_at": "2026-09-05T00:00:00+00:00",
        "data_status": "real",
        "sources": ["google"],
        "ads": list(ads),
        "notes": ["Base note from campaign_commons.ads."],
    }


CHAIN: JsonDict = {
    "summary": {"disclosed_share": 0.66, "inferable_share": 0.0, "unwalked_share": 0.0, "dark_share": 0.34}
}
EMPTY_HAND: JsonDict = {"race_id": "pa-sen-2024", "method": "", "rows": []}


def _validate_gallery(gallery: JsonDict) -> None:
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "ads.schema.json").read_text())
    errors = list(Draft7Validator(schema).iter_errors(gallery))
    assert not errors, [e.message for e in errors]


def _validate_vendor_ads(vendor: JsonDict) -> None:
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "vendor.schema.json").read_text())
    ads_schema = {**schema["definitions"]["vendor"]["properties"]["ads"], "definitions": schema["definitions"]}
    errors = list(Draft7Validator(ads_schema).iter_errors(vendor["ads"]))
    assert not errors, [e.message for e in errors]


# --- shares -----------------------------------------------------------------------------------------------------------


def test_sponsor_shares_come_from_chain_summary_and_are_null_otherwise() -> None:
    assert sponsor_shares(CHAIN) == {"disclosed": 0.66, "inferable": 0.0, "unwalked": 0.0, "dark": 0.34}
    assert sponsor_shares(None) is None
    gallery = _gallery(_ad("CR1"), _ad("CR2", sponsor="C00000002"), _ad("CR3", sponsor=None))
    counts, _ = enrich(gallery, {SPONSOR: CHAIN}, {SPONSOR: _entity()}, {}, EMPTY_HAND, EMPTY_HAND)
    ads = gallery["ads"]
    assert isinstance(ads, list)
    assert ads[0]["sponsor_visibility_shares"]["dark"] == 0.34
    assert ads[1]["sponsor_visibility_shares"] is None  # matched, no chain
    assert ads[2]["sponsor_visibility_shares"] is None  # unmatched
    assert counts.with_shares == 1
    _validate_gallery(gallery)


# --- issues -----------------------------------------------------------------------------------------------------------


def test_issue_tags_carry_verified_basis_pointing_at_the_creative() -> None:
    gallery = _gallery(_ad("CR1"), _ad("CR2"))
    hand: JsonDict = {**EMPTY_HAND, "rows": [TAG_ROW]}
    counts, _ = enrich(gallery, {}, {SPONSOR: _entity()}, {}, hand, EMPTY_HAND)
    ads = gallery["ads"]
    assert isinstance(ads, list)
    assert ads[0]["issues"] == {
        "issue_ids": ["healthcare", "tax_budget"],
        "basis": {
            "basis": "verified",
            "rule": "Tagged by a person from the creative",
            "source_urls": [CREATIVE],
            "checked_by": "tester",
            "checked_at": "2026-09-05",
        },
    }
    assert "issues" not in ads[1]
    assert counts.tagged == 1
    _validate_gallery(gallery)


# --- window rule ------------------------------------------------------------------------------------------------------


def test_window_includes_lead_days_and_both_boundaries() -> None:
    from datetime import date, timedelta

    first, last = date(2024, 9, 17), date(2024, 10, 1)
    assert in_window(first - timedelta(days=WINDOW_LEAD_DAYS), first, last)
    assert not in_window(first - timedelta(days=WINDOW_LEAD_DAYS + 1), first, last)
    assert in_window(last, first, last)
    assert not in_window(last + timedelta(days=1), first, last)


def test_links_only_vendors_with_buys_in_window_and_reconcile_to_ie_rows() -> None:
    entity = _entity()
    links = vendor_links(_ad(), entity, {})
    by_vendor = {str(link["vendor_id"]): link for link in links}
    # 09-10 (= first - 7d) and 10-01 (= last) pixel buys, 10-01 broadcast buy; 09-01 and 10-20/10-25 fall outside
    assert set(by_vendor) == {"vendor:pixel-placement", "vendor:broadcast-buyers"}
    assert by_vendor["vendor:pixel-placement"]["amount_in_window"] == 110000.0
    assert by_vendor["vendor:pixel-placement"]["buys_in_window"] == 2
    assert by_vendor["vendor:broadcast-buyers"]["amount_in_window"] == 500000.0
    assert by_vendor["vendor:broadcast-buyers"]["medium"] == "tv"
    ies = entity["independent_expenditures"]
    assert isinstance(ies, list)
    in_win = [ie for ie in ies if "2024-09-10" <= ie["date"] <= "2024-10-01"]
    assert sum(float(link["amount_in_window"]) for link in links) == sum(ie["amount"] for ie in in_win)
    assert sum(float(link["amount_in_window"]) for link in links) <= sum(ie["amount"] for ie in ies)
    for link in links:
        assert link["window"] == ["2024-09-17", "2024-10-01"]
        assert str(link["basis"]["rule"]).count("7 days before first shown") == 1


def test_no_links_when_run_dates_are_missing() -> None:
    assert vendor_links(_ad(first=None), _entity(), {}) == []
    assert vendor_links(_ad(last=None), _entity(), {}) == []


# --- basis ------------------------------------------------------------------------------------------------------------


def test_single_digital_vendor_in_window_is_inferred_and_the_tv_vendor_stays_adjacent() -> None:
    links = vendor_links(_ad(), _entity(), {})
    by_vendor = {str(link["vendor_id"]): link["basis"] for link in links}
    pixel, tv = by_vendor["vendor:pixel-placement"], by_vendor["vendor:broadcast-buyers"]
    assert pixel["basis"] == "inferred"
    assert "Only digital vendor EXAMPLE VICTORY FUND paid during this ad's run window" in str(pixel["rule"])
    assert "inferred, not filed" in str(pixel["rule"])
    assert tv["basis"] == "adjacent"
    assert str(tv["rule"]).startswith("Ran Sep 17, 2024 – Oct 1, 2024. In that window")
    assert "the FEC does not record which buy placed which ad" in str(tv["rule"])
    assert "$500,000" in str(tv["rule"])
    assert pixel["checked_by"] is None and tv["checked_by"] is None
    assert pixel["source_urls"] == [FIXTURE["vendors"][0]["source_url"]]


def test_two_digital_vendors_in_window_are_both_adjacent() -> None:
    links = vendor_links(_ad(first="2024-10-18", last="2024-10-25"), _entity(), {})
    assert {str(link["vendor_id"]) for link in links} == {"vendor:pixel-placement", "vendor:stream-ads"}
    assert {str(link["basis"]["basis"]) for link in links} == {"adjacent"}


def test_hand_link_overrides_to_verified_and_sorts_first() -> None:
    links = vendor_links(_ad(), _entity(), {("CR1", "vendor:broadcast-buyers"): HAND_LINK})
    assert [str(link["basis"]["basis"]) for link in links] == ["verified", "inferred"]
    verified = links[0]["basis"]
    assert verified["source_urls"] == HAND_LINK["source_urls"]
    assert verified["checked_by"] == "tester" and verified["checked_at"] == "2026-09-05"
    assert "Broadcast Buyers placed this ad" in str(verified["rule"])
    assert "We placed the fall flight" in str(verified["rule"])
    # a hand link for a different ad does not leak
    assert {
        str(link["basis"]["basis"])
        for link in vendor_links(_ad("CR9"), _entity(), {("CR1", "vendor:broadcast-buyers"): HAND_LINK})
    } == {
        "inferred",
        "adjacent",
    }


# --- no-op without vendors ---------------------------------------------------------------------------------------------


def test_no_vendor_rows_means_no_links_and_a_note_saying_so() -> None:
    gallery = _gallery(_ad())
    counts, changed = enrich(
        gallery, {SPONSOR: CHAIN}, {SPONSOR: _entity(with_vendors=False)}, {}, EMPTY_HAND, EMPTY_HAND
    )
    ads = gallery["ads"]
    assert isinstance(ads, list)
    assert ads[0]["vendor_links"] == []
    assert ads[0]["sponsor_visibility_shares"]["dark"] == 0.34
    assert counts.links_by_basis == {} and counts.sponsors_without_vendors == 1 and not changed
    notes = gallery["notes"]
    assert isinstance(notes, list)
    assert any(n.startswith(NOTE_PREFIX) and "campaign_commons.vendors has not run" in n for n in notes)
    _validate_gallery(gallery)


# --- reverse side + idempotence -----------------------------------------------------------------------------------------


def test_vendor_files_get_reverse_ads_deduped_and_enrich_is_idempotent() -> None:
    vendors: dict[str, JsonDict] = {
        "vendor:pixel-placement": {"vendor_id": "vendor:pixel-placement", "ads": []},
        "vendor:broadcast-buyers": {
            "vendor_id": "vendor:broadcast-buyers",
            "ads": [
                {
                    "ad_id": "CR1",
                    "sponsor_entity_id": SPONSOR,
                    "basis": {
                        "basis": "adjacent",
                        "rule": "stale",
                        "source_urls": [],
                        "checked_by": None,
                        "checked_at": None,
                    },
                }
            ],
        },
    }
    hand_links: JsonDict = {**EMPTY_HAND, "rows": [HAND_LINK]}
    hand_tags: JsonDict = {**EMPTY_HAND, "rows": [TAG_ROW]}
    gallery = _gallery(_ad("CR1"), _ad("CR2", first="2024-10-18", last="2024-10-25"))
    entities = {SPONSOR: _entity()}

    counts, changed = enrich(gallery, {SPONSOR: CHAIN}, entities, vendors, hand_tags, hand_links)
    assert counts.links_by_basis == {"verified": 1, "inferred": 1, "adjacent": 2}
    assert changed == {"vendor:pixel-placement", "vendor:broadcast-buyers"}
    tv_ads = vendors["vendor:broadcast-buyers"]["ads"]
    assert isinstance(tv_ads, list) and len(tv_ads) == 1 and tv_ads[0]["basis"]["basis"] == "verified"
    pixel_ads = vendors["vendor:pixel-placement"]["ads"]
    assert isinstance(pixel_ads, list) and sorted(a["ad_id"] for a in pixel_ads) == ["CR1", "CR2"]
    _validate_gallery(gallery)
    _validate_vendor_ads(vendors["vendor:broadcast-buyers"])

    first_pass = json.dumps(gallery)  # key order included: a rerun must not reorder ads.json on disk
    first_vendors = json.dumps(vendors)
    counts2, changed2 = enrich(gallery, {SPONSOR: CHAIN}, entities, vendors, hand_tags, hand_links)
    assert json.dumps(gallery) == first_pass
    assert json.dumps(vendors) == first_vendors
    assert changed2 == set() and counts2.links_by_basis == counts.links_by_basis
    notes = gallery["notes"]
    assert isinstance(notes, list)
    assert notes[0] == "Base note from campaign_commons.ads." and sum(n.startswith(NOTE_PREFIX) for n in notes) == 3


def test_patch_vendor_ads_replaces_same_ad_and_reports_change() -> None:
    basis: JsonDict = {"basis": "adjacent", "rule": "r", "source_urls": [], "checked_by": None, "checked_at": None}
    vendor: JsonDict = {"ads": []}
    assert patch_vendor_ads(vendor, "CR1", SPONSOR, basis)
    assert not patch_vendor_ads(vendor, "CR1", SPONSOR, basis)
    assert patch_vendor_ads(vendor, "CR1", SPONSOR, {**basis, "basis": "inferred"})
    ads = vendor["ads"]
    assert isinstance(ads, list) and len(ads) == 1 and ads[0]["basis"]["basis"] == "inferred"


def test_stale_tags_are_dropped_when_the_hand_row_goes_away() -> None:
    gallery = _gallery(_ad())
    enrich(gallery, {}, {SPONSOR: _entity()}, {}, {**EMPTY_HAND, "rows": [TAG_ROW]}, EMPTY_HAND)
    ads = gallery["ads"]
    assert isinstance(ads, list) and "issues" in ads[0]
    counts, _ = enrich(
        gallery, {}, {SPONSOR: _entity()}, {}, {**EMPTY_HAND, "rows": [{**TAG_ROW, "ad_id": "CR404"}]}, EMPTY_HAND
    )
    assert "issues" not in ads[0]
    assert counts.untagged_rows == ["CR404"]
