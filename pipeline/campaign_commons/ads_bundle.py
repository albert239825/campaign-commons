"""Download + query Google's political ads transparency bundle (CSV zip, no auth) with DuckDB."""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

import duckdb
import requests

from .config import RAW

# The URL on transparencyreport.google.com now serves a 2.5KB stub whose README points here.
BUNDLE_URL = "https://storage.googleapis.com/political-csv/google-political-ads-transparency-bundle.zip"
BUNDLE_DIR = RAW / "google-ads"
BUNDLE_ZIP = BUNDLE_DIR / "google-political-ads-transparency-bundle.zip"
BUNDLE_EXTRACTED = BUNDLE_DIR / "bundle"
CREATIVE_STATS = "google-political-ads-creative-stats.csv"
ADVERTISER_DECLARED = "google-political-ads-advertiser-declared-stats.csv"
UPDATED = "google-political-ads-updated.csv"

# Geo_Targeting_Included is a huge free-text column (ZIP lists); the sniffer needs help.
_CSV_OPTS = (
    "header=true, all_varchar=true, delim=',', quote='\"', escape='\"', max_line_size=100000000, null_padding=true"
)


def ensure_bundle() -> Path:
    """Stream the zip to data/raw (skipped when present) and extract the CSVs. Returns the extracted dir."""
    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    if not BUNDLE_ZIP.exists():
        print(f"downloading {BUNDLE_URL} -> {BUNDLE_ZIP}")
        with requests.get(BUNDLE_URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            tmp = BUNDLE_ZIP.with_suffix(".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
            tmp.rename(BUNDLE_ZIP)
    if not (BUNDLE_EXTRACTED / CREATIVE_STATS).exists():
        print(f"extracting {BUNDLE_ZIP}")
        with zipfile.ZipFile(BUNDLE_ZIP) as z:
            z.extractall(BUNDLE_EXTRACTED)
    return BUNDLE_EXTRACTED


@dataclass(frozen=True)
class CreativeRow:
    ad_id: str
    ad_url: str
    ad_type: str
    regions: tuple[str, ...]
    advertiser_id: str
    advertiser_name: str
    declared_name: str | None
    date_start: str | None
    date_end: str | None
    impressions: str | None
    spend_min_usd: int | None
    spend_max_usd: int | None
    geo_included: str | None


def _csv(bundle_dir: Path, name: str) -> str:
    return f"read_csv('{(bundle_dir / name).as_posix()}', {_CSV_OPTS})"


def bundle_updated_at(bundle_dir: Path) -> str | None:
    text = (bundle_dir / UPDATED).read_text().strip().splitlines()
    return text[1].strip() if len(text) > 1 else None


def load_us_creatives(bundle_dir: Path, date_from: str, date_to: str) -> list[CreativeRow]:
    """US-region creatives whose served date range overlaps [date_from, date_to]. Left-joins declared names."""
    con = duckdb.connect()
    sql = f"""
        select c.Ad_ID, c.Ad_URL, c.Ad_Type, c.Regions, c.Advertiser_ID, c.Advertiser_Name,
               d.Advertiser_Declared_Name,
               c.Date_Range_Start, c.Date_Range_End, c.Impressions,
               c.Spend_Range_Min_USD, c.Spend_Range_Max_USD, c.Geo_Targeting_Included
        from {_csv(bundle_dir, CREATIVE_STATS)} c
        left join (
            select Advertiser_ID, min(Advertiser_Declared_Name) as Advertiser_Declared_Name
            from {_csv(bundle_dir, ADVERTISER_DECLARED)}
            where Advertiser_Declared_Name is not null and Advertiser_Declared_Name <> ''
            group by 1
        ) d using (Advertiser_ID)
        where list_contains(string_split(c.Regions, ','), 'US')
          and c.Date_Range_End >= ? and c.Date_Range_Start <= ?
    """
    rows = con.execute(sql, [date_from, date_to]).fetchall()
    out: list[CreativeRow] = []
    for r in rows:
        out.append(
            CreativeRow(
                ad_id=r[0],
                ad_url=r[1],
                ad_type=r[2] or "",
                regions=tuple(x.strip() for x in (r[3] or "").split(",") if x.strip()),
                advertiser_id=r[4],
                advertiser_name=r[5] or "",
                declared_name=r[6] or None,
                date_start=r[7] or None,
                date_end=r[8] or None,
                impressions=r[9] or None,
                spend_min_usd=_int(r[10]),
                spend_max_usd=_int(r[11]),
                geo_included=r[12] or None,
            )
        )
    return out


def _int(s: str | None) -> int | None:
    return int(s) if s not in (None, "") else None


_RANGE = re.compile(r"^\s*(≥|>=|≤|<=)?\s*(\d+)\s*(?:-\s*(\d+))?\s*$")


def parse_bucket(text: str | None) -> tuple[int, int | None]:
    """'6000-7000' -> (6000, 7000); '≥10000000' -> (10000000, None); '≤10000' -> (0, 10000); unknown -> (0, None)."""
    if not text:
        return 0, None
    m = _RANGE.match(text.replace(",", ""))
    if not m:
        return 0, None
    op, a, b = m.group(1), int(m.group(2)), m.group(3)
    if op in ("≤", "<="):
        return 0, a
    if op in ("≥", ">="):
        return a, None
    return a, (int(b) if b is not None else a)


_PA_TOKENS = re.compile(r"(^|,\s*)Pennsylvania\s*,|,\s*PA\s*,|,\s*PA$")


def targets_pennsylvania(geo_included: str | None) -> bool:
    """True when Geo_Targeting_Included names Pennsylvania (state, PA DMA, or 'City, PA' entry)."""
    return bool(geo_included) and _PA_TOKENS.search(geo_included) is not None
