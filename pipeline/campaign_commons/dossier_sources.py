"""Fetch + cache the primary records the dossier stage reads: senate.gov roll-call XML, congress.gov sponsored
legislation, and Wayback Machine snapshots. Every fetch is cached under data/raw/ (gitignored) so reruns are offline.
Network failures raise; nothing here invents data."""

from __future__ import annotations

import html
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests

from .config import CONGRESS_GOV_API_KEY, RAW

SENATE_VOTES = "https://www.senate.gov/legislative/LIS/roll_call_votes"
CONGRESS_API = "https://api.congress.gov/v3"
WAYBACK = "https://web.archive.org/web"
TIMEOUT = 120


def _cached(path: Path, url: str) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8")
    resp = requests.get(url, timeout=TIMEOUT)
    resp.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(resp.text, encoding="utf-8")
    return resp.text


# --- senate.gov roll calls -------------------------------------------------------------------------


@dataclass(frozen=True)
class RollCall:
    congress: int
    session: int
    roll: int
    date: str  # YYYY-MM-DD
    question: str
    document_name: str  # "H.J.Res. 109", or "S.Amdt. 5387 to H.R. 5376" for amendment votes
    document_title: str  # measure title, or the amendment's statement of purpose
    result: str
    member_vote: str  # Yea | Nay | Not Voting | Present

    @property
    def page_url(self) -> str:
        return (
            f"{SENATE_VOTES}/vote{self.congress}{self.session}/vote_{self.congress}_{self.session}_{self.roll:05d}.htm"
        )

    @property
    def bill_id(self) -> str | None:
        if " to " in self.document_name:
            return None
        return f"{self.document_name.replace(' ', '')}-{self.congress}"


_VOTE_DATE = re.compile(r"^([A-Z][a-z]+ \d{1,2}, \d{4})")  # "May 16, 2024, 11:31 AM"


def _text(root: ET.Element, tag: str) -> str:
    return " ".join((root.findtext(tag) or "").split())


def parse_roll_call(xml_text: str, last_name: str, state: str) -> RollCall:
    root = ET.fromstring(xml_text)
    members = [m for m in root.iter("member") if _text(m, "last_name") == last_name and _text(m, "state") == state]
    if len(members) != 1:
        raise ValueError(f"expected exactly one member {last_name} ({state}) in roll call XML, found {len(members)}")
    document = root.find("document")
    amendment = root.find("amendment")
    if document is None or amendment is None:
        raise ValueError("roll call XML has no <document>/<amendment>")
    if _text(document, "document_name"):
        name, title = _text(document, "document_name"), _text(document, "document_title")
    else:
        name = f"S.Amdt. {_text(amendment, 'amendment_number')} to {_text(amendment, 'amendment_to_document_number')}"
        title = _text(amendment, "amendment_purpose")
    match = _VOTE_DATE.match(_text(root, "vote_date"))
    if match is None:
        raise ValueError(f"unparseable vote_date {_text(root, 'vote_date')!r}")
    date = datetime.strptime(match.group(1), "%B %d, %Y").date().isoformat()
    return RollCall(
        congress=int(_text(root, "congress")),
        session=int(_text(root, "session")),
        roll=int(_text(root, "vote_number")),
        date=date,
        question=_text(root, "vote_question_text"),
        document_name=name,
        document_title=title,
        result=_text(root, "vote_result"),
        member_vote=_text(members[0], "vote_cast"),
    )


def fetch_roll_call(congress: int, session: int, roll: int, last_name: str, state: str) -> RollCall:
    name = f"vote_{congress}_{session}_{roll:05d}.xml"
    xml_text = _cached(RAW / "senate" / name, f"{SENATE_VOTES}/vote{congress}{session}/{name}")
    vote = parse_roll_call(xml_text, last_name, state)
    if (vote.congress, vote.session, vote.roll) != (congress, session, roll):
        raise ValueError(f"{name}: XML identifies itself as {vote.congress}-{vote.session} #{vote.roll}")
    return vote


# --- congress.gov sponsored legislation -------------------------------------------------------------


@dataclass(frozen=True)
class SponsoredBill:
    congress: int
    bill_type: str  # "S"
    number: int
    title: str
    introduced: str
    latest_action: str
    policy_area: str | None

    @property
    def bill_id(self) -> str:
        return f"{self.bill_type}.{self.number}-{self.congress}"

    @property
    def url(self) -> str:
        chamber = {"S": "senate-bill", "SJRES": "senate-joint-resolution", "SRES": "senate-resolution"}[self.bill_type]
        return f"https://www.congress.gov/bill/{self.congress}th-congress/{chamber}/{self.number}"


def _str(obj: object, key: str) -> str:
    if not isinstance(obj, dict):
        raise TypeError(f"expected object for {key}")
    value = obj.get(key)
    if not isinstance(value, str):
        raise TypeError(f"expected string {key}, got {type(value).__name__}")
    return value


def fetch_sponsored_bills(bioguide_id: str) -> dict[str, SponsoredBill]:
    """All bills the member sponsored (every congress), keyed by bill_id. Paginates with limit=250, cached per page."""
    out: dict[str, SponsoredBill] = {}
    offset = 0
    while True:
        cache = RAW / "congress" / f"sponsored_{bioguide_id}_{offset}.json"
        url = (
            f"{CONGRESS_API}/member/{bioguide_id}/sponsored-legislation"
            f"?api_key={CONGRESS_GOV_API_KEY}&limit=250&offset={offset}&format=json"
        )
        page = json.loads(_cached(cache, url))
        if not isinstance(page, dict) or "sponsoredLegislation" not in page:
            raise ValueError(f"unexpected congress.gov response for {bioguide_id} offset={offset}")
        rows = page["sponsoredLegislation"]
        if not isinstance(rows, list):
            raise TypeError("sponsoredLegislation is not a list")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("type"), str):
                continue  # amendments have no bill type
            policy = row.get("policyArea")
            latest = row.get("latestAction")
            bill = SponsoredBill(
                congress=int(str(row["congress"])),
                bill_type=_str(row, "type"),
                number=int(_str(row, "number")),
                title=_str(row, "title"),
                introduced=_str(row, "introducedDate"),
                latest_action=_str(latest, "text") if isinstance(latest, dict) else "",
                policy_area=_str(policy, "name") if isinstance(policy, dict) and "name" in policy else None,
            )
            out[bill.bill_id] = bill
        pagination = page.get("pagination")
        if not isinstance(pagination, dict) or "next" not in pagination:
            return out
        offset += 250


# --- Wayback Machine --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Snapshot:
    timestamp: str  # 14-digit Wayback timestamp
    original_url: str
    text: str  # visible text, whitespace-normalised

    @property
    def url(self) -> str:
        return f"{WAYBACK}/{self.timestamp}/{self.original_url}"

    @property
    def date(self) -> str:
        return f"{self.timestamp[:4]}-{self.timestamp[4:6]}-{self.timestamp[6:8]}"


_TAG_STRIP = re.compile(r"<script.*?</script>|<style.*?</style>", re.S)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(page: str) -> str:
    page = _TAG_STRIP.sub(" ", page)
    page = re.sub(r"<(br|p|li|div|h[1-6])\b[^>]*>", "\n", page, flags=re.I)
    return normalise(html.unescape(_TAG.sub(" ", page)))


def normalise(text: str) -> str:
    """Collapse whitespace and fold curly quotes/dashes so hand-copied excerpts match the page."""
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", "-").replace("\u2013", "-").replace("\u00a0", " ")
    return " ".join(text.split())


def fetch_snapshot(timestamp: str, original_url: str) -> Snapshot:
    safe = re.sub(r"[^A-Za-z0-9]+", "_", original_url).strip("_")
    cache = RAW / "wayback" / f"{timestamp}_{safe}.html"
    page = _cached(cache, f"{WAYBACK}/{timestamp}id_/{original_url}")
    return Snapshot(timestamp=timestamp, original_url=original_url, text=html_to_text(page))
