"""Dossier stage: primary records -> data/out/<race>/dossiers/<candidate_id>.json (DossierSchema).

Inputs are hand-curated literals in campaign_commons.dossier_curated (which roll calls, which bills, which archived statements,
and the one-sentence positions). This module fetches the records they point at, verifies them, and assembles the JSON:

- Incumbent (Casey): senate.gov roll-call XML gives the recorded vote, question, measure, result and date for each
  curated (congress, session, roll); congress.gov gives title/introduction/latest action for each curated sponsored
  bill. evidence_basis = "record".
- Challenger (McCormick): a Wayback Machine snapshot of the 2024 campaign issues page; each curated excerpt must appear
  verbatim in the archived page text or the run fails. evidence_basis = "statements".

No LLM calls. Every sentence in `position` and `summary` is hand-written in dossier_curated; the summary is composed
only from the emitted stances. Every evidence item carries a senate.gov / congress.gov / web.archive.org URL.
A network or verification failure raises; the stage never writes unsourced data. Responses are cached under data/raw/.

Issues with no curated evidence are omitted (the UI renders "No record").
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict

from .config import RACES, ROOT, Candidate, Race
from .dossier_curated import (
    CASEY_BILLS,
    CASEY_CONGRESS_URL,
    CASEY_POSITIONS,
    CASEY_ROLL_CALLS,
    MCCORMICK_SNAPSHOT,
    MCCORMICK_STATEMENTS,
    Statement,
)
from .dossier_sources import RollCall, SponsoredBill, fetch_roll_call, fetch_snapshot, fetch_sponsored_bills, normalise
from .util import fec_candidate_url, now_iso, write_json

ASYMMETRY_NOTE = (
    "Incumbents are judged on what they did (roll-call votes, sponsored bills). Challengers can only be judged on "
    "what they say (stated positions). These are not equivalent kinds of evidence; the record type is labeled on "
    "every item."
)
MAX_EXCERPT_WORDS = 40

Evidence = dict[str, str | int | None]
Stance = dict[str, object]


def issue_ids() -> list[str]:
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "dossier.schema.json").read_text())
    enum = schema["definitions"]["dossier"]["properties"]["stances"]["items"]["properties"]["issue_id"]["enum"]
    if not isinstance(enum, list) or not all(isinstance(i, str) for i in enum):
        raise TypeError("issue_id enum missing from dossier.schema.json")
    return list(enum)


def _check_issues(tags: tuple[str, ...], known: list[str], where: str) -> None:
    unknown = [t for t in tags if t not in known]
    if unknown:
        raise ValueError(f"{where}: unknown issue ids {unknown}")


# --- incumbent -------------------------------------------------------------------------------------


def roll_call_evidence(vote: RollCall) -> Evidence:
    return {
        "kind": "roll_call_vote",
        "title": f"{vote.document_name}: {vote.document_title}",
        "description": f"{vote.question}. Result: {vote.result}.",
        "date": vote.date,
        "vote": vote.member_vote,
        "bill_id": vote.bill_id,
        "congress": vote.congress,
        "roll_number": vote.roll,
        "url": vote.page_url,
        "source_label": "senate.gov roll call",
    }


def sponsored_bill_evidence(bill: SponsoredBill) -> Evidence:
    return {
        "kind": "sponsored_bill",
        "title": f"{bill.bill_type}.{bill.number} ({bill.congress}th): {bill.title}",
        "description": f"Introduced {bill.introduced}. Latest action: {bill.latest_action}",
        "date": bill.introduced,
        "vote": None,
        "bill_id": bill.bill_id,
        "congress": bill.congress,
        "roll_number": None,
        "url": bill.url,
        "source_label": "congress.gov",
    }


def record_confidence(evidence: list[Evidence]) -> str:
    votes = sum(1 for e in evidence if e["kind"] == "roll_call_vote")
    if votes >= 3:
        return "high"
    if votes == 1 or len(evidence) >= 2:
        return "medium"
    return "low"


def incumbent_stances(candidate: Candidate, known: list[str]) -> list[Stance]:
    if candidate.bioguide_id is None:
        raise ValueError(f"{candidate.name} has no bioguide id")
    last_name = candidate.name.split()[-1]
    by_issue: dict[str, list[Evidence]] = defaultdict(list)
    for (congress, session, roll), tags in CASEY_ROLL_CALLS.items():
        _check_issues(tags, known, f"roll call {congress}-{session} #{roll}")
        evidence = roll_call_evidence(fetch_roll_call(congress, session, roll, last_name, "PA"))
        for tag in tags:
            by_issue[tag].append(evidence)
    bills = fetch_sponsored_bills(candidate.bioguide_id)
    for bill_id, tags in CASEY_BILLS.items():
        _check_issues(tags, known, f"bill {bill_id}")
        if bill_id not in bills:
            raise ValueError(f"{bill_id} is not in congress.gov sponsored legislation for {candidate.bioguide_id}")
        for tag in tags:
            by_issue[tag].append(sponsored_bill_evidence(bills[bill_id]))
    for issue, items in by_issue.items():
        if sum(1 for e in items if e["kind"] == "sponsored_bill") > 5:
            raise ValueError(f"{issue}: more than 5 sponsored bills curated")
        if issue not in CASEY_POSITIONS:
            raise ValueError(f"{issue}: evidence curated but no position written")
    return [
        {
            "issue_id": issue,
            "position": CASEY_POSITIONS[issue],
            "confidence": record_confidence(items),
            "needs_review": True,
            "evidence": sorted(items, key=lambda e: str(e["date"])),
        }
        for issue in known
        if (items := by_issue.get(issue))
    ]


# --- challenger ------------------------------------------------------------------------------------


def challenger_stances(known: list[str]) -> tuple[list[Stance], str]:
    timestamp, original_url = MCCORMICK_SNAPSHOT
    snapshot = fetch_snapshot(timestamp, original_url)
    stances: list[Stance] = []
    seen: set[str] = set()
    for statement in MCCORMICK_STATEMENTS:
        _check_issues((statement.issue_id,), known, f"statement {statement.heading!r}")
        if statement.issue_id in seen:
            raise ValueError(f"{statement.issue_id}: more than one statement curated")
        seen.add(statement.issue_id)
        stances.append(statement_stance(statement, snapshot.text, snapshot.url, snapshot.date))
    order = {issue: i for i, issue in enumerate(known)}
    return sorted(stances, key=lambda s: order[str(s["issue_id"])]), snapshot.url


def statement_stance(statement: Statement, page_text: str, url: str, date: str) -> Stance:
    excerpt = normalise(statement.excerpt)
    if len(excerpt.split()) > MAX_EXCERPT_WORDS:
        raise ValueError(f"{statement.issue_id}: excerpt longer than {MAX_EXCERPT_WORDS} words")
    if excerpt not in page_text:
        raise ValueError(f"{statement.issue_id}: excerpt not found verbatim in archived page {url}")
    if normalise(statement.heading).lower() not in page_text.lower():
        raise ValueError(f"{statement.issue_id}: heading {statement.heading!r} not found in archived page")
    evidence: Evidence = {
        "kind": "stated_position",
        "title": statement.heading,
        "description": f'"{excerpt}"',
        "date": date,
        "vote": None,
        "bill_id": None,
        "congress": None,
        "roll_number": None,
        "url": url,
        "source_label": "campaign website (archived)",
    }
    return {
        "issue_id": statement.issue_id,
        "position": statement.position,
        "confidence": "medium",
        "needs_review": True,
        "evidence": [evidence],
    }


# --- assembly --------------------------------------------------------------------------------------


def compose_summary(stances: list[Stance], n_issues: int, basis: str) -> str:
    """3-4 sentences built only from the stances: a coverage sentence plus the three positions with most evidence."""
    ranked = sorted(
        ((str(s["position"]), len(e)) for s in stances if isinstance(e := s["evidence"], list)),
        key=lambda pair: -pair[1],
    )
    n_items = sum(n for _, n in ranked)
    what = "roll-call votes and sponsored bills" if basis == "record" else "archived campaign statements"
    lead = f"Record covers {len(stances)} of {n_issues} issues, drawn from {n_items} {what}."
    return " ".join([lead, *[position for position, _ in ranked[:3]]])


def build(race: Race, candidate: Candidate, known: list[str]) -> dict[str, object]:
    if candidate.incumbent:
        stances = incumbent_stances(candidate, known)
        basis = "record"
        congress_url: str | None = CASEY_CONGRESS_URL
        campaign_site: str | None = None
    else:
        stances, campaign_site = challenger_stances(known)
        basis = "statements"
        congress_url = None
    if not stances:
        raise ValueError(f"no stances assembled for {candidate.name}; refusing to write an empty dossier")
    return {
        "candidate_id": candidate.candidate_id,
        "race_id": race.race_id,
        "name": candidate.name,
        "party": candidate.party,
        "incumbent": candidate.incumbent,
        "role": "incumbent" if candidate.incumbent else "challenger",
        "bioguide_id": candidate.bioguide_id,
        "generated_at": now_iso(),
        "data_status": "real",
        "summary": compose_summary(stances, len(known), basis),
        "summary_needs_review": True,
        "evidence_basis": basis,
        "asymmetry_note": ASYMMETRY_NOTE,
        "stances": stances,
        "links": {
            "fec_url": fec_candidate_url(candidate.candidate_id, race.cycle),
            "congress_url": congress_url,
            "campaign_site": campaign_site,
        },
    }


def run(race_id: str) -> None:
    race = RACES[race_id]
    known = issue_ids()
    for candidate in race.candidates:
        dossier = build(race, candidate, known)
        write_json(race.out_dir / "dossiers" / f"{candidate.candidate_id}.json", dossier)


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
