"""Independent expenditures (Schedule E) from the OpenFEC API.

`GET /schedules/schedule_e/?candidate_id=…&cycle=…&is_notice=false&most_recent=true` is the exact row set behind
fec.gov's candidate IE totals (`/schedules/schedule_e/by_candidate/`): periodic-report lines (Forms 3X/5) only, with
each amended line replaced by its latest version. 24/48-hour notices (Form 24) are excluded at the source instead of
being reconciled afterwards; every notice is re-reported on the next periodic report, so this loses nothing.

Fetching all rows for two candidates is ~25 requests; the DEMO_KEY tier (40/hour) still works for a single race.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import pandas as pd
import requests

from .config import FEC_API, FEC_API_KEY
from .util import fec_filing_url

IE_COLUMNS = [
    "committee_id",
    "committee_name",
    "candidate_id",
    "support_oppose_indicator",
    "expenditure_amount",
    "expenditure_date",
    "dissemination_date",
    "payee_name",
    "purpose",
    "is_notice",
    "filing_form",
    "file_num",
    "image_num",
    "tran_id",
    "amendment_indicator",
    "pdf_url",
]

PER_PAGE = 100
RETRIES = 5


def schedule_e_source_url(candidate_ids: set[str], cycle: int) -> str:
    cands = "&".join(f"candidate_id={c}" for c in sorted(candidate_ids))
    return f"{FEC_API}/schedules/schedule_e/?{cands}&cycle={cycle}&is_notice=false&most_recent=true"


def _get(params: dict[str, object]) -> dict:
    url = f"{FEC_API}/schedules/schedule_e/"
    for attempt in range(RETRIES):
        resp = requests.get(url, params={**params, "api_key": FEC_API_KEY}, timeout=60)
        if resp.status_code == 429 or resp.status_code >= 500:
            time.sleep(2**attempt)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    raise RuntimeError(f"schedule_e: gave up after {RETRIES} attempts")


def iter_schedule_e(cycle: int, candidate_ids: set[str]) -> Iterator[dict]:
    """Yield periodic-report Sched E rows (latest amendment only) targeting `candidate_ids`, following the
    keyset pagination (`last_index` + `last_expenditure_date`) the endpoint requires past page 1."""
    params: dict[str, object] = {
        "candidate_id": sorted(candidate_ids),
        "cycle": cycle,
        "is_notice": "false",
        "most_recent": "true",
        "per_page": PER_PAGE,
        "sort": "-expenditure_date",
    }
    while True:
        page = _get(params)
        results = page.get("results", [])
        yield from results
        last = page.get("pagination", {}).get("last_indexes") or {}
        if not results or not last.get("last_index"):
            return
        params = {
            **params,
            "last_index": last["last_index"],
            "last_expenditure_date": last.get("last_expenditure_date"),
        }


def schedule_e_frame(rows: list[dict]) -> pd.DataFrame:
    """Normalize API rows into IE_COLUMNS. Non-positive amounts (refunds/voids) are dropped."""
    frame = pd.DataFrame(
        {
            "committee_id": [r["committee_id"] for r in rows],
            "committee_name": [(r.get("committee") or {}).get("name") for r in rows],
            "candidate_id": [r["candidate_id"] for r in rows],
            "support_oppose_indicator": [r["support_oppose_indicator"] for r in rows],
            "expenditure_amount": [r.get("expenditure_amount") for r in rows],
            "expenditure_date": [r.get("expenditure_date") for r in rows],
            "dissemination_date": [r.get("dissemination_date") for r in rows],
            "payee_name": [r.get("payee_name") for r in rows],
            "purpose": [r.get("expenditure_description") for r in rows],
            "is_notice": [bool(r.get("is_notice")) for r in rows],
            "filing_form": [r.get("filing_form") for r in rows],
            "file_num": [None if r.get("file_number") is None else str(r["file_number"]) for r in rows],
            "image_num": [r.get("image_number") for r in rows],
            "tran_id": [r.get("transaction_id") for r in rows],
            "amendment_indicator": [r.get("amendment_indicator") for r in rows],
        },
        columns=IE_COLUMNS[:-1],
    )
    frame["expenditure_amount"] = pd.to_numeric(frame["expenditure_amount"], errors="coerce")
    for col in ("expenditure_date", "dissemination_date"):
        frame[col] = pd.to_datetime(frame[col], errors="coerce")
    frame["committee_name"] = frame["committee_name"].str.strip()
    frame["pdf_url"] = frame["image_num"].map(lambda i: fec_filing_url(i) if i else None)
    frame = frame[frame["expenditure_amount"].fillna(0) > 0]
    return frame.reset_index(drop=True)[IE_COLUMNS]


def load_schedule_e(cycle: int, candidate_ids: set[str]) -> pd.DataFrame:
    rows = list(iter_schedule_e(cycle, candidate_ids))
    frame = schedule_e_frame(rows)
    print(
        f"schedule_e: {len(rows)} api rows -> {len(frame)} positive rows, "
        f"${frame['expenditure_amount'].sum():,.0f} outside spend for {sorted(candidate_ids)}"
    )
    return frame
