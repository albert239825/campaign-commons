from campaign_commons.ads import select_rows, to_ad
from campaign_commons.ads_bundle import CreativeRow, parse_bucket, targets_pennsylvania
from campaign_commons.ads_match import SEED_COMMITTEES, AdvertiserMatcher, mentions_candidate, normalize_name


def _row(name: str, geo: str | None, ad_id: str = "CR1", spend_max: int | None = 1000) -> CreativeRow:
    return CreativeRow(
        ad_id=ad_id,
        ad_url=f"https://adstransparency.google.com/advertiser/AR1/creative/{ad_id}?political=&region=US",
        ad_type="VIDEO",
        regions=("US",),
        advertiser_id="AR1",
        advertiser_name=name,
        declared_name=None,
        date_start="2024-09-01",
        date_end="2024-11-01",
        impressions="1000000-1250000",
        spend_min_usd=500,
        spend_max_usd=spend_max,
        geo_included=geo,
    )


def test_normalize_name_strips_punctuation_case_and_suffix() -> None:
    assert normalize_name("Bob Casey for Senate, Inc.") == "BOB CASEY FOR SENATE"
    assert normalize_name("  senate   leadership  FUND ") == "SENATE LEADERSHIP FUND"
    assert normalize_name("Americans for Prosperity Action, Inc") == normalize_name(
        "AMERICANS FOR PROSPERITY ACTION INC"
    )
    assert normalize_name("LCV Victory Fund & Somos PAC") == "LCV VICTORY FUND AND SOMOS PAC"


def test_seed_ids_are_unique_per_alias() -> None:
    seen: dict[str, str] = {}
    for seed in SEED_COMMITTEES:
        for alias in seed.aliases:
            key = normalize_name(alias)
            assert seen.setdefault(key, seed.committee_id) == seed.committee_id, alias


def test_exact_match_is_auto_and_near_miss_is_none() -> None:
    m = AdvertiserMatcher()
    hit = m.match("SENATE LEADERSHIP FUND")
    assert (hit.committee_id, hit.confidence, hit.candidate_id) == ("C00571703", "auto", None)
    assert m.match("Senate Leadership Fund Inc.").committee_id == "C00571703"
    miss = m.match("Senate Leadership Fund of Montana")
    assert (miss.committee_id, miss.confidence) == (None, "none")
    assert m.match(None, "").confidence == "none"


def test_candidate_committee_carries_candidate_id() -> None:
    m = AdvertiserMatcher()
    casey = m.match("Bob Casey for Senate Inc")
    assert (casey.committee_id, casey.candidate_id) == ("C00431056", "S6PA00217")
    assert m.is_candidate_committee("C00431056")
    assert not m.is_candidate_committee("C00571703")
    assert not m.is_candidate_committee(None)


def test_ledger_alias_does_not_override_verified_seed() -> None:
    m = AdvertiserMatcher()
    m.add_alias("NRSC", "C00000000", override=False)
    assert m.match("NRSC").committee_id == "C00027466"
    m.add_alias("BlackPAC", "C00609388", override=False)
    assert m.match("BLACKPAC").committee_id == "C00609388"


def test_mentions_candidate_is_whole_word() -> None:
    assert mentions_candidate("Friends of Casey Weinstein", ("Casey", "McCormick"))
    assert mentions_candidate("SHEILA CHERFILUS MCCORMICK FOR CONGRESS", ("Casey", "McCormick"))
    assert not mentions_candidate("Caseyville Democrats", ("Casey",))


def test_parse_bucket() -> None:
    assert parse_bucket("6000-7000") == (6000, 7000)
    assert parse_bucket("≥10000000") == (10000000, None)
    assert parse_bucket("≤ 10000") == (0, 10000)
    assert parse_bucket(None) == (0, None)
    assert parse_bucket("garbage") == (0, None)


def test_targets_pennsylvania() -> None:
    assert targets_pennsylvania("Pennsylvania,United States")
    assert targets_pennsylvania("Philadelphia, PA,United States")
    assert targets_pennsylvania("15012,Pennsylvania,United States, 15062,Pennsylvania,United States")
    assert targets_pennsylvania("Wilkes Barre-Scranton, PA,Pennsylvania,United States")
    assert not targets_pennsylvania("Michigan,United States")
    assert not targets_pennsylvania("Paris, France")
    assert not targets_pennsylvania(None)


def test_select_rows_geo_rule() -> None:
    m = AdvertiserMatcher()
    rows = [
        _row("BOB CASEY FOR SENATE INC", None, "CR-cand-untargeted"),
        _row("SENATE LEADERSHIP FUND", "Michigan,United States", "CR-slf-mi"),
        _row("SENATE LEADERSHIP FUND", "Pennsylvania,United States", "CR-slf-pa"),
        _row("Friends of Casey Weinstein", "Pennsylvania,United States", "CR-weinstein"),
        _row("Friends of Casey Weinstein", "Ohio,United States", "CR-weinstein-oh"),
        _row("Some Other PAC", "Pennsylvania,United States", "CR-other"),
    ]
    kept = {row.ad_id: match for row, match in select_rows(rows, m, ("Casey", "McCormick"))}
    assert set(kept) == {"CR-cand-untargeted", "CR-slf-pa", "CR-weinstein"}
    assert kept["CR-weinstein"].confidence == "none"
    assert kept["CR-slf-pa"].committee_id == "C00571703"


def test_to_ad_shape() -> None:
    m = AdvertiserMatcher()
    row = _row("BOB CASEY FOR SENATE INC", "Pennsylvania,United States", spend_max=None)
    ad = to_ad(row, m.match(row.advertiser_name), None)
    assert ad["spend_range"] == {"min": 500, "max": None}
    assert ad["impressions_range"] == {"min": 1000000, "max": 1250000}
    assert ad["candidate_ids"] == ["S6PA00217"] and ad["support_oppose"] == "S"
    assert ad["regions"] == ["US", "US-PA"]
    assert ad["ad_type"] == "video" and ad["source_url"] == row.ad_url
    other = to_ad(_row("Some Other PAC", None), m.match("Some Other PAC"), None)
    assert other["matched_entity_id"] is None and other["support_oppose"] is None and other["candidate_ids"] == []
