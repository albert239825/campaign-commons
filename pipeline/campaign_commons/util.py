"""Small shared helpers for pipeline stages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from .config import FEC_WEB


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path}")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def fec_committee_url(committee_id: str, cycle: int) -> str:
    return f"{FEC_WEB}/committee/{committee_id}/?cycle={cycle}"


def fec_candidate_url(candidate_id: str, cycle: int) -> str:
    return f"{FEC_WEB}/candidate/{candidate_id}/?cycle={cycle}&election_full=false"


def fec_receipts_url(committee_id: str, cycle: int) -> str:
    return f"{FEC_WEB}/receipts/?committee_id={committee_id}&two_year_transaction_period={cycle}"


def fec_pair_receipts_url(receiver_id: str, sender_id: str, cycle: int) -> str:
    """Receiver's Schedule A filtered to one contributing committee: the rows behind a committee -> committee edge.

    fec.gov's browse UI takes the source committee in `contributor_name` (its "Name or ID" box); it ignores the API-only
    `contributor_committee_id` / `contributor_id` parameters (browser-verified 2026-09-05, D-43).
    """
    return f"{fec_receipts_url(receiver_id, cycle)}&contributor_name={sender_id}"


def fec_contributor_receipts_url(receiver_id: str, contributor_name: str, cycle: int) -> str:
    """Receiver's Schedule A filtered to one individual or organization by reported name."""
    return f"{fec_receipts_url(receiver_id, cycle)}&contributor_name={quote_plus(contributor_name)}"


def fec_disbursements_url(committee_id: str, cycle: int) -> str:
    return f"{FEC_WEB}/disbursements/?committee_id={committee_id}&two_year_transaction_period={cycle}"


def fec_ie_url(committee_id: str, cycle: int) -> str:
    return f"{FEC_WEB}/independent-expenditures/?committee_id={committee_id}&cycle={cycle}"


def fec_ie_candidate_url(committee_id: str, candidate_id: str, cycle: int) -> str:
    """One spender's independent expenditures aimed at one candidate."""
    return f"{fec_ie_url(committee_id, cycle)}&candidate_id={candidate_id}"


def fec_contributor_search_url(contributor_name: str, cycle: int) -> str:
    """Every itemized receipt reported under a contributor's name, across all committees."""
    return (
        f"{FEC_WEB}/receipts/individual-contributions/?contributor_name={quote_plus(contributor_name)}"
        f"&two_year_transaction_period={cycle}"
    )


def fec_filing_url(image_num: str) -> str:
    """Filing image viewer for a Sched line's IMAGE_NUM (the page the row was reported on)."""
    return f"https://docquery.fec.gov/cgi-bin/fecimg/?{image_num}"


def individual_id(name: str, zip5: str | None) -> str:
    """Synthetic id for a natural person. Name + ZIP5 is the standard FEC-data dedupe key; imperfect by design."""
    key = f"{name.strip().upper()}|{(zip5 or '')[:5]}"
    return "ind:" + key.replace(" ", "_").replace(",", "")


def organization_id(name: str) -> str:
    return "org:" + name.strip().upper().replace(" ", "_")
