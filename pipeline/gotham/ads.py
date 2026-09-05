"""Stage: Google political ads bundle -> <race>/ads.json (+ cached creatives under web/public/creatives/<race>/).

Source (no auth): https://storage.googleapis.com/political-csv/google-political-ads-transparency-bundle.zip
  (the older transparencyreport.google.com URL now serves a stub README redirecting here). Streamed once to
  data/raw/google-ads/, unzipped, queried with DuckDB straight from CSV (creative-stats is ~2.8GB; one scan ~5s).
  Tables used: google-political-ads-creative-stats.csv (Ad_ID, Ad_URL, Ad_Type, Regions, Advertiser_ID,
  Advertiser_Name, Date_Range_Start/End, Impressions bucket, Spend_Range_Min/Max_USD, Geo_Targeting_Included),
  google-political-ads-advertiser-declared-stats.csv (declared committee names — California/New Zealand only, so
  no PA advertiser has one; used only as a matching hint, not emitted), google-political-ads-updated.csv.
Filter: Regions contains "US" AND served range overlaps 2024-01-01..2024-11-05 AND
  (a) advertiser matches a candidate committee -> keep every ad; or
  (b) advertiser matches another seed/ledger committee, or its name contains a candidate surname ("Casey",
      "McCormick") -> keep only ads whose Geo_Targeting_Included names Pennsylvania (state, PA DMA, "City, PA").
  Region granularity in the bundle is country-level; PA targeting comes from the ad-level geo column.
Matching (gotham/ads_match.py): exact match on a normalized name against a hand-verified seed list of PA-2024 Senate
  advertisers (FEC ids from cm24) plus `top_outside_spenders[].name -> entity_id` from the current ledger.json.
  Exact => match_confidence "auto"; anything else => "none" with matched_entity_id null. Nothing fuzzy, no guesses.
  `candidate_ids`/`support_oppose` are set only for candidate committees (supporting themselves); V0 does not infer
  stance or issues from creatives.
Creatives (gotham/ads_creatives.py): for the top 50 ads by spend upper bound, VIDEO ads get their YouTube poster
  frame (JPEG) cached to web/public/creatives/<race_id>/<ad_id>.jpg via the site's lookup RPC; TEXT/IMAGE ads have no
  static asset reachable without a headless browser and keep cached_creative_path null. Total budget 20MB. Hand-verified
  ads (gotham/ads_verify.py) are always attempted so the chain page can show the creative.
Verification (gotham/ads_verify.py): gotham/data/ad_verifications.json is hand-maintained; each ad gets an additive
  `verification` block, "verified" only for ads listed there (and only if the name match agrees on the committee).
Sort: matched first, then spend upper bound desc (open-ended bucket sorts first), cap 500. Output passes `make validate`.
"""

from __future__ import annotations

import json
import sys

import requests

from .ads_bundle import (
    BUNDLE_URL,
    CreativeRow,
    bundle_updated_at,
    ensure_bundle,
    load_us_creatives,
    parse_bucket,
    targets_pennsylvania,
)
from .ads_creatives import cache_video_thumbnail
from .ads_match import AdvertiserMatcher, Match, mentions_candidate
from .ads_verify import AdVerification, apply_verifications, load_verifications
from .config import RACES, ROOT, Race
from .util import now_iso, write_json

DATE_FROM = "2024-01-01"
MAX_ADS = 500
CREATIVES_TOP_N = 50
CREATIVES_BUDGET_BYTES = 20 * 1024 * 1024
CREATIVES_DIR = ROOT / "web" / "public" / "creatives"


def build_matcher(race: Race) -> AdvertiserMatcher:
    matcher = AdvertiserMatcher()
    ledger_path = race.out_dir / "ledger.json"
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text())
        for spender in ledger.get("top_outside_spenders", []):
            entity_id = spender.get("entity_id", "")
            if entity_id.startswith("C"):
                matcher.add_alias(spender["name"], entity_id, override=False)
    return matcher


def _surnames(race: Race) -> tuple[str, ...]:
    return tuple(c.name.split()[-1] for c in race.candidates)


def select_rows(
    rows: list[CreativeRow], matcher: AdvertiserMatcher, surnames: tuple[str, ...]
) -> list[tuple[CreativeRow, Match]]:
    kept: list[tuple[CreativeRow, Match]] = []
    for row in rows:
        m = matcher.match(row.advertiser_name, row.declared_name)
        if matcher.is_candidate_committee(m.committee_id):
            kept.append((row, m))
        elif (m.committee_id or mentions_candidate(row.advertiser_name, surnames)) and targets_pennsylvania(
            row.geo_included
        ):
            kept.append((row, m))
    return kept


def _sort_key(item: tuple[CreativeRow, Match]) -> tuple[int, float, int]:
    row, m = item
    upper = float("inf") if row.spend_max_usd is None else float(row.spend_max_usd)
    return (0 if m.committee_id else 1, -upper, -(row.spend_min_usd or 0))


def to_ad(row: CreativeRow, m: Match, cached_path: str | None) -> dict[str, object]:
    imp_min, imp_max = parse_bucket(row.impressions)
    ad_type = row.ad_type.lower()
    regions = list(row.regions)
    if targets_pennsylvania(row.geo_included):
        regions.append("US-PA")
    return {
        "ad_id": row.ad_id,
        "platform": "google",
        "advertiser_id": row.advertiser_id,
        "advertiser_name": row.advertiser_name,
        "matched_entity_id": m.committee_id,
        "match_confidence": m.confidence,
        "candidate_ids": [m.candidate_id] if m.candidate_id else [],
        "support_oppose": "S" if m.candidate_id else None,
        "spend_range": {"min": row.spend_min_usd or 0, "max": row.spend_max_usd},
        "impressions_range": {"min": imp_min, "max": imp_max},
        "first_shown": row.date_start,
        "last_shown": row.date_end,
        "ad_type": ad_type if ad_type in ("video", "image", "text") else "unknown",
        "creative_url": row.ad_url,
        "cached_creative_path": cached_path,
        "regions": regions,
        "source_url": row.ad_url,
    }


def cache_creatives(
    selected: list[tuple[CreativeRow, Match]], race_id: str, verifications: dict[str, AdVerification]
) -> dict[str, str]:
    dest_dir = CREATIVES_DIR / race_id
    session = requests.Session()
    budget = CREATIVES_BUDGET_BYTES
    cached: dict[str, str] = {}
    wanted = selected[:CREATIVES_TOP_N] + [(r, m) for r, m in selected[CREATIVES_TOP_N:] if r.ad_id in verifications]
    for row, _ in wanted:
        if row.ad_type.upper() != "VIDEO":
            continue
        try:
            result = cache_video_thumbnail(row.advertiser_id, row.ad_id, dest_dir, session, budget)
        except requests.RequestException as e:
            print(f"creative {row.ad_id}: skipped ({e.__class__.__name__})")
            continue
        if result is None:
            print(f"creative {row.ad_id}: no static thumbnail")
            continue
        path, size = result
        budget -= size
        cached[row.ad_id] = "/" + path.relative_to(ROOT / "web" / "public").as_posix()
    print(f"cached {len(cached)} creatives ({(CREATIVES_BUDGET_BYTES - budget) / 1024:.0f} KB) -> {dest_dir}")
    return cached


def notes(updated: str | None, selected: int, total: int, matched: int, cached: int, verified: int) -> list[str]:
    return [
        f"Source: Google Political Advertising transparency bundle ({BUNDLE_URL}), report data updated "
        f"{updated or 'unknown'}; every ad links to its adstransparency.google.com record.",
        "Selection: US-region creatives served between 2024-01-01 and 2024-11-05. Ads from the two candidate "
        "committees are kept regardless of targeting; ads from other advertisers are kept only when the advertiser "
        "name exactly matches (after normalization) a hand-verified list of committees active in this race or a "
        "committee named in ledger.json, or when the advertiser name contains a candidate surname, and the ad's "
        "declared geo targeting includes Pennsylvania. Exact normalized-name matches carry match_confidence "
        '"auto" and the FEC committee id; everything else is "none" with no committee attached. Stance '
        "(support/oppose) is recorded only for candidate committees, which support themselves; no stance or issue "
        "is inferred from creative content.",
        "Spend and impressions are the bucketed ranges Google publishes; an open-ended upper bound is null. Google's "
        "declared 'paid for by' data covers only California and New Zealand advertisers, so no disclaimer is shown.",
        f"{selected} ads met the selection rule; {total} emitted ({matched} matched to a committee, {total - matched} "
        f"unmatched) after sorting matched-first then by spend upper bound and capping at {MAX_ADS}. {cached} video poster frames cached locally; text and image "
        "creatives have no static asset reachable without a browser.",
        f'Verification: {verified} ads carry verification.status "verified" — a person opened the Google Ads '
        "Transparency ad and advertiser pages (legal name, FEC ID where Google prints one) and confirmed on fec.gov that "
        "the committee with that ID filed independent expenditures in this race; evidence_urls list what was read. Every "
        'other ad is "unverified": its committee link, if any, rests on the exact-name match alone.',
    ]


def run(race_id: str) -> None:
    race = RACES[race_id]
    bundle_dir = ensure_bundle()
    rows = load_us_creatives(bundle_dir, DATE_FROM, race.election_date)
    print(f"{len(rows)} US creatives overlapping {DATE_FROM}..{race.election_date}")
    matcher = build_matcher(race)
    eligible = sorted(select_rows(rows, matcher, _surnames(race)), key=_sort_key)
    selected = eligible[:MAX_ADS]
    verifications = load_verifications()
    cached = cache_creatives(selected, race_id, verifications)
    ads = [to_ad(row, m, cached.get(row.ad_id)) for row, m in selected]
    verified = apply_verifications(ads, verifications)
    matched = sum(1 for a in ads if a["matched_entity_id"])
    out: dict[str, object] = {
        "race_id": race_id,
        "generated_at": now_iso(),
        "data_status": "real",
        "sources": ["google"],
        "ads": ads,
        "notes": notes(bundle_updated_at(bundle_dir), len(eligible), len(ads), matched, len(cached), verified),
    }
    write_json(race.out_dir / "ads.json", out)
    by_adv: dict[str, int] = {}
    for a in ads:
        name = str(a["advertiser_name"])
        by_adv[name] = by_adv.get(name, 0) + 1
    print(f"{len(ads)} ads, {matched} matched; advertisers: {sorted(by_adv.items(), key=lambda kv: -kv[1])[:10]}")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
