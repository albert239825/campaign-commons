from pathlib import Path

import pytest

from gotham import dossier_curated as curated
from gotham.dossier import MAX_EXCERPT_WORDS, compose_summary, issue_ids, record_confidence, statement_stance
from gotham.dossier_sources import normalise, parse_roll_call

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_roll_call_extracts_member_vote_and_measure() -> None:
    vote = parse_roll_call((FIXTURES / "vote_118_2_00169.xml").read_text(), "Casey", "PA")
    assert (vote.congress, vote.session, vote.roll) == (118, 2, 169)
    assert vote.member_vote == "Yea"
    assert vote.date == "2024-05-16"
    assert vote.question.startswith("On the Joint Resolution")
    assert vote.document_name == "H.J.Res. 109"
    assert "Staff Accounting Bulletin" in vote.document_title
    assert vote.result == "Joint Resolution Passed"
    assert vote.bill_id == "H.J.Res.109-118"
    assert vote.page_url.endswith("/vote1182/vote_118_2_00169.htm")


def test_parse_roll_call_amendment_only_vote_uses_amendment_purpose() -> None:
    vote = parse_roll_call((FIXTURES / "vote_117_2_00303.xml").read_text(), "Casey", "PA")
    assert vote.member_vote == "Nay"
    assert vote.document_name.startswith("S.Amdt. ")
    assert vote.document_title
    assert vote.result == "Amendment Rejected"


def test_parse_roll_call_rejects_unknown_member() -> None:
    with pytest.raises(ValueError, match="member"):
        parse_roll_call((FIXTURES / "vote_118_2_00169.xml").read_text(), "Nobody", "PA")


def test_curated_issue_tags_are_in_taxonomy() -> None:
    known = set(issue_ids())
    assert len(known) == 10
    for tags in (*curated.CASEY_ROLL_CALLS.values(), *curated.CASEY_BILLS.values()):
        assert set(tags) <= known
    assert set(curated.CASEY_POSITIONS) <= known
    assert {s.issue_id for s in curated.MCCORMICK_STATEMENTS} <= known


def test_curated_bills_capped_per_issue_and_positions_exist() -> None:
    per_issue: dict[str, int] = {}
    for tags in curated.CASEY_BILLS.values():
        for tag in tags:
            per_issue[tag] = per_issue.get(tag, 0) + 1
    assert max(per_issue.values()) <= 5
    tagged = {t for tags in (*curated.CASEY_ROLL_CALLS.values(), *curated.CASEY_BILLS.values()) for t in tags}
    assert tagged <= set(curated.CASEY_POSITIONS)


def test_statements_are_short_and_unique() -> None:
    issues = [s.issue_id for s in curated.MCCORMICK_STATEMENTS]
    assert len(issues) == len(set(issues))
    for statement in curated.MCCORMICK_STATEMENTS:
        assert len(statement.excerpt.split()) <= MAX_EXCERPT_WORDS


def test_statement_stance_requires_verbatim_excerpt() -> None:
    statement = curated.MCCORMICK_STATEMENTS[0]
    page = normalise(f"{statement.heading}\n\n{statement.excerpt}")
    stance = statement_stance(statement, page, "https://web.archive.org/web/x/y", "2024-11-01")
    assert stance["needs_review"] is True
    assert stance["issue_id"] == statement.issue_id
    with pytest.raises(ValueError, match="verbatim"):
        statement_stance(statement, "unrelated page", "https://web.archive.org/web/x/y", "2024-11-01")


def test_confidence_and_summary_come_only_from_stances() -> None:
    votes = [{"kind": "roll_call_vote"}] * 3
    assert record_confidence(votes) == "high"
    assert record_confidence([{"kind": "sponsored_bill"}]) == "low"
    stances = [
        {"issue_id": "guns", "position": "Voted on A.", "evidence": [{}]},
        {"issue_id": "abortion", "position": "Voted on B.", "evidence": [{}, {}]},
    ]
    summary = compose_summary(stances, 10, "record")
    assert summary.startswith("Record covers 2 of 10 issues, drawn from 3 roll-call votes and sponsored bills.")
    assert summary.endswith("Voted on B. Voted on A.")
