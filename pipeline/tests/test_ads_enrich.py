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
    same_window_buys,
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
    # 09-10 (= first - 7d) and 10-01 (= last) pixel buys are in the window; 09-01 and 10-20/10-25 fall outside.
    # The 10-01 broadcast buy is in the window too but a TV buy cannot have placed a Google ad, so it is not listed anywhere.
    assert set(by_vendor) == {"vendor:pixel-placement"}
    assert by_vendor["vendor:pixel-placement"]["amount_in_window"] == 110000.0
    assert by_vendor["vendor:pixel-placement"]["buys_in_window"] == 2
    ies = entity["independent_expenditures"]
    assert isinstance(ies, list)
    in_win = [ie for ie in ies if "2024-09-10" <= ie["date"] <= "2024-10-01" and ie["medium"] == "digital"]
    assert sum(float(link["amount_in_window"]) for link in links) == sum(ie["amount"] for ie in in_win)
    assert sum(float(link["amount_in_window"]) for link in links) <= sum(ie["amount"] for ie in ies)
    for link in links:
        assert link["window"] == ["2024-09-17", "2024-10-01"]
        assert str(link["basis"]["rule"]).count("7 days before first shown") == 1


def test_no_links_when_run_dates_are_missing() -> None:
    assert vendor_links(_ad(first=None), _entity(), {}) == []
    assert vendor_links(_ad(last=None), _entity(), {}) == []


def _with_buy(entity: JsonDict, vendor_id: str, day: str, amount: float, medium: str) -> JsonDict:
    ies = entity["independent_expenditures"]
    assert isinstance(ies, list)
    ies.append(
        {
            **ies[0],
            "ie_id": f"{vendor_id}-{day}",
            "vendor_id": vendor_id,
            "date": day,
            "amount": amount,
            "medium": medium,
        }
    )
    return entity


def test_mixed_media_vendor_counts_only_its_placeable_buys() -> None:
    """A vendor paid for both TV and digital in the window: its TV dollars neither hide its digital buys (when TV dominates)
    nor inflate them (when digital dominates). Context and link amounts come from the placeable buys alone."""
    # pixel: digital $110K in window + a $1M TV buy in window -> still digital, still $110K / 2 buys
    entity = _with_buy(_entity(), "vendor:pixel-placement", "2024-09-20", 1_000_000.0, "tv")
    (pixel,) = same_window_buys(_ad(), entity)
    assert (pixel["medium"], pixel["amount_in_window"], pixel["buys_in_window"]) == ("digital", 110000.0, 2)
    (link,) = vendor_links(_ad(), entity, {})
    assert (link["basis"]["basis"], link["amount_in_window"], link["buys_in_window"]) == ("inferred", 110000.0, 2)
    assert "$110,000 in digital buys" in str(link["basis"]["rule"])
    # broadcast: $500K TV in window + a $5K digital buy -> listed as a $5K digital context row, and a second digital vendor
    # means nobody is inferred any more
    entity = _with_buy(_entity(), "vendor:broadcast-buyers", "2024-09-25", 5000.0, "digital")
    rows = {str(b["vendor_id"]): b for b in same_window_buys(_ad(), entity)}
    assert set(rows) == {"vendor:pixel-placement", "vendor:broadcast-buyers"}
    assert (rows["vendor:broadcast-buyers"]["medium"], rows["vendor:broadcast-buyers"]["amount_in_window"]) == (
        "digital",
        5000.0,
    )
    assert rows["vendor:broadcast-buyers"]["buys_in_window"] == 1
    assert vendor_links(_ad(), entity, {}) == []


def test_verified_link_does_not_need_a_payment_in_the_window() -> None:
    """A person naming both sides is the evidence; a dated buy is not required (and its absence is said out loud)."""
    hand = {
        ("CR1", "vendor:stream-ads"): {**HAND_LINK, "vendor_id": "vendor:stream-ads"}
    }  # stream's only buy is 10-25, outside
    links = {str(link["vendor_id"]): link for link in vendor_links(_ad(), _entity(), hand)}
    assert set(links) == {"vendor:stream-ads", "vendor:pixel-placement"}
    stream = links["vendor:stream-ads"]
    assert stream["basis"]["basis"] == "verified"
    assert (stream["amount_in_window"], stream["buys_in_window"], stream["medium"]) == (0.0, 0, "digital")
    assert stream["window"] == ["2024-09-17", "2024-10-01"]
    assert "no EXAMPLE VICTORY FUND payment to Stream Ads for placeable media is dated in that window" in str(
        stream["basis"]["rule"]
    )
    assert (
        links["vendor:pixel-placement"]["basis"]["basis"] == "inferred"
    )  # still the only digital vendor *paid* in the window
    # no run dates at all: the verified link survives with a null window; nothing can be inferred
    (only,) = vendor_links(_ad(first=None), _entity(), hand)
    assert only["vendor_id"] == "vendor:stream-ads" and only["basis"]["basis"] == "verified" and only["window"] is None
    assert "Run dates not reported" in str(only["basis"]["rule"])
    gallery = _gallery(_ad(first=None, last=None))
    enrich(
        gallery,
        {},
        {SPONSOR: _entity()},
        {},
        EMPTY_HAND,
        {**EMPTY_HAND, "rows": [{**HAND_LINK, "vendor_id": "vendor:stream-ads"}]},
    )
    _validate_gallery(gallery)


# --- basis ------------------------------------------------------------------------------------------------------------


def test_single_digital_vendor_in_window_is_inferred_and_the_tv_vendor_is_not_offered() -> None:
    links = vendor_links(_ad(), _entity(), {})
    by_vendor = {str(link["vendor_id"]): link["basis"] for link in links}
    assert "vendor:broadcast-buyers" not in by_vendor  # same-window TV buy: not a link, not context
    pixel = by_vendor["vendor:pixel-placement"]
    assert pixel["basis"] == "inferred"
    assert "Only digital vendor EXAMPLE VICTORY FUND paid during this ad's run window" in str(pixel["rule"])
    assert "inferred, not filed" in str(pixel["rule"])
    assert pixel["checked_by"] is None
    assert pixel["source_urls"] == [FIXTURE["vendors"][0]["source_url"]]


def test_two_digital_vendors_in_window_get_no_link_only_same_window_context() -> None:
    """D-74: date overlap alone is not a relationship. Two digital vendors in the window -> zero vendor_links, and both
    appear in same_window_buys (context, no basis) so the page can say who was paid without drawing an edge."""
    ad = _ad(first="2024-10-18", last="2024-10-25")
    assert vendor_links(ad, _entity(), {}) == []
    buys = same_window_buys(ad, _entity())
    assert [str(b["vendor_id"]) for b in buys] == [
        "vendor:pixel-placement",
        "vendor:stream-ads",
    ]  # by dollars in window
    for b in buys:
        assert "basis" not in b
        assert set(b) == {"vendor_id", "vendor_name", "medium", "amount_in_window", "buys_in_window", "source_url"}
        assert str(b["source_url"]).startswith("https://")


def test_no_link_ever_carries_the_retired_adjacent_basis() -> None:
    entity = _entity()
    for first, last in (("2024-09-17", "2024-10-01"), ("2024-10-18", "2024-10-25"), ("2024-08-01", "2024-11-05")):
        for link in vendor_links(_ad(first=first, last=last), entity, {}):
            assert str(link["basis"]["basis"]) in {"verified", "inferred"}


def test_same_window_buys_lists_placeable_media_only_and_includes_linked_vendors() -> None:
    buys = same_window_buys(_ad(), _entity())
    # pixel (digital, also the inferred link) is listed; the same-window TV buy is not
    assert [str(b["vendor_id"]) for b in buys] == ["vendor:pixel-placement"]
    assert buys[0]["amount_in_window"] == 110000.0 and buys[0]["buys_in_window"] == 2
    assert same_window_buys(_ad(first=None), _entity()) == []
    assert same_window_buys(_ad(), _entity(with_vendors=False)) == []


def test_hand_link_overrides_to_verified_and_sorts_first() -> None:
    links = vendor_links(_ad(), _entity(), {("CR1", "vendor:broadcast-buyers"): HAND_LINK})
    assert [str(link["basis"]["basis"]) for link in links] == ["verified", "inferred"]
    verified = links[0]["basis"]
    assert verified["source_urls"] == HAND_LINK["source_urls"]
    assert verified["checked_by"] == "tester" and verified["checked_at"] == "2026-09-05"
    assert "Broadcast Buyers placed this ad" in str(verified["rule"])
    assert "We placed the fall flight" in str(verified["rule"])
    # a hand link for a different ad does not leak: CR9 gets only the inferred digital link, the TV vendor is not offered
    assert [
        (str(link["vendor_id"]), str(link["basis"]["basis"]))
        for link in vendor_links(_ad("CR9"), _entity(), {("CR1", "vendor:broadcast-buyers"): HAND_LINK})
    ] == [("vendor:pixel-placement", "inferred")]


# --- no-op without vendors ---------------------------------------------------------------------------------------------


def test_no_vendor_rows_means_no_links_and_a_note_saying_so() -> None:
    gallery = _gallery(_ad())
    counts, changed = enrich(
        gallery, {SPONSOR: CHAIN}, {SPONSOR: _entity(with_vendors=False)}, {}, EMPTY_HAND, EMPTY_HAND
    )
    ads = gallery["ads"]
    assert isinstance(ads, list)
    assert ads[0]["vendor_links"] == [] and ads[0]["same_window_buys"] == []
    assert ads[0]["sponsor_visibility_shares"]["dark"] == 0.34
    assert counts.links_by_basis == {} and counts.sponsors_without_vendors == 1 and not changed
    notes = gallery["notes"]
    assert isinstance(notes, list)
    assert any(n.startswith(NOTE_PREFIX) and "campaign_commons.vendors has not run" in n for n in notes)
    _validate_gallery(gallery)


# --- reverse side + idempotence -----------------------------------------------------------------------------------------


def test_vendor_files_get_reverse_ads_deduped_and_enrich_is_idempotent() -> None:
    stale_basis: JsonDict = {
        "basis": "inferred",
        "rule": "stale",
        "source_urls": [],
        "checked_by": None,
        "checked_at": None,
    }
    vendors: dict[str, JsonDict] = {
        "vendor:pixel-placement": {"vendor_id": "vendor:pixel-placement", "ads": []},
        "vendor:broadcast-buyers": {
            "vendor_id": "vendor:broadcast-buyers",
            "ads": [
                {"ad_id": ad_id, "sponsor_entity_id": SPONSOR, "basis": stale_basis}
                for ad_id in ("CR1", "CR-GONE")  # CR-GONE no longer links here and must be pruned
            ],
        },
    }
    hand_links: JsonDict = {**EMPTY_HAND, "rows": [HAND_LINK]}
    hand_tags: JsonDict = {**EMPTY_HAND, "rows": [TAG_ROW]}
    gallery = _gallery(_ad("CR1"), _ad("CR2", first="2024-10-18", last="2024-10-25"))
    entities = {SPONSOR: _entity()}

    counts, changed = enrich(gallery, {SPONSOR: CHAIN}, entities, vendors, hand_tags, hand_links)
    assert counts.links_by_basis == {"verified": 1, "inferred": 1}  # CR2's two same-window digital vendors: no links
    assert counts.ads_with_same_window_buys == 2 and counts.same_window_buys == 3
    assert changed == {"vendor:pixel-placement", "vendor:broadcast-buyers"}
    tv_ads = vendors["vendor:broadcast-buyers"]["ads"]
    assert isinstance(tv_ads, list) and len(tv_ads) == 1 and tv_ads[0]["basis"]["basis"] == "verified"
    pixel_ads = vendors["vendor:pixel-placement"]["ads"]
    assert isinstance(pixel_ads, list) and sorted(a["ad_id"] for a in pixel_ads) == ["CR1"]  # CR2 overlap is not a link
    gallery_ads = gallery["ads"]
    assert isinstance(gallery_ads, list)
    assert gallery_ads[1]["vendor_links"] == [] and len(gallery_ads[1]["same_window_buys"]) == 2
    assert any("D-74" in n and "never drawn" in n for n in gallery["notes"] if isinstance(n, str))
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
    assert notes[0] == "Base note from campaign_commons.ads." and sum(n.startswith(NOTE_PREFIX) for n in notes) == 4


def test_patch_vendor_ads_replaces_same_ad_and_reports_change() -> None:
    basis: JsonDict = {"basis": "inferred", "rule": "r", "source_urls": [], "checked_by": None, "checked_at": None}
    vendor: JsonDict = {"ads": []}
    assert patch_vendor_ads(vendor, "CR1", SPONSOR, basis)
    assert not patch_vendor_ads(vendor, "CR1", SPONSOR, basis)
    assert patch_vendor_ads(vendor, "CR1", SPONSOR, {**basis, "basis": "verified"})
    ads = vendor["ads"]
    assert isinstance(ads, list) and len(ads) == 1 and ads[0]["basis"]["basis"] == "verified"


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
