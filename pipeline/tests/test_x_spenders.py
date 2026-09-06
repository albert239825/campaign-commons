from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

import campaign_commons.enrich_spenders as enrich_spenders
from campaign_commons.issues import RowRefs, build


def _response(result: dict[str, object], *, response_id: str = "resp-1") -> dict[str, object]:
    return {
        "id": response_id,
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "output": [
            {
                "type": "web_search_call",
                "action": {
                    "type": "search",
                    "query": "committee about",
                    "sources": [{"type": "url", "url": "https://example.org/about"}],
                },
            },
            {"type": "web_search_call", "action": {"type": "open_page", "url": "https://example.org/about"}},
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]},
        ],
    }


class FakeClient:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.calls = 0

    def create_response(self, payload: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        return _response(self.result, response_id=f"resp-{self.calls}")


def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    out = tmp_path / "out" / "race"
    hand = tmp_path / "hand" / "race"
    raw = tmp_path / "raw"
    out.mkdir(parents=True)
    hand.mkdir(parents=True)
    (raw / "fec" / "committee").mkdir(parents=True)
    (out / "ledger.json").write_text(
        json.dumps(
            {
                "top_outside_spenders": [
                    {"entity_id": "C1", "name": "Example Committee", "total": 100},
                    {"entity_id": "C2", "name": "Other Committee", "total": 50},
                    {"entity_id": "C3", "name": "Tagged Committee", "total": 25},
                ]
            }
        )
    )
    (hand / "issue_focus.json").write_text(json.dumps({"rows": [{"entity_id": "C3"}]}))
    taxonomy = tmp_path / "issues_taxonomy.json"
    taxonomy.write_text(json.dumps([{"id": "healthcare", "label": "Health care", "description": "health policy"}]))
    prompt = tmp_path / "prompt.md"
    prompt.write_text("Issues:\n{{issues}}")
    race = type("Race", (), {"out_dir": out})()
    monkeypatch.setattr(enrich_spenders, "DATA", tmp_path)
    monkeypatch.setattr(enrich_spenders, "RACES", {"race": race})
    monkeypatch.setattr(enrich_spenders, "ISSUES_TAXONOMY", taxonomy)
    monkeypatch.setattr(enrich_spenders, "PROMPT_PATH", prompt)
    monkeypatch.setattr(enrich_spenders, "issue_ids", lambda: ["healthcare"])
    monkeypatch.setattr(enrich_spenders, "XAI_API_KEY", "test-key")
    return out, hand


def _fec(entity_ids: list[str]) -> list[dict[str, object]]:
    return [
        {
            "committee_id": entity_id,
            "website": "WWW.EXAMPLE.ORG/about",
            "affiliated_committee_name": "Example Connected Organization",
        }
        for entity_id in entity_ids
    ]


def _page(url: str) -> tuple[int, str]:
    if url == "https://example.org/about":
        return 200, (Path(__file__).parent / "fixtures" / "web" / "about_page.html").read_text()
    return 404, ""


def test_spender_happy_path_validates_and_skips_tagged(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    result = {
        "found": True,
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "The committee works to protect healthcare access.",
        "quote": "We work to protect healthcare access.",
        "source_url": "https://example.org/about",
        "confidence": "high",
    }
    assert enrich_spenders.run("race", client=FakeClient(result), fec_fetcher=_fec, page_fetcher=_page, limit=1) == 0
    output = json.loads((hand / "x_issue_focus.json").read_text())
    assert [row["entity_id"] for row in output["rows"]] == ["C1"]
    schema = json.loads(
        (Path(enrich_spenders.ROOT) / "contracts" / "jsonschema" / "hand_x_issue_focus.schema.json").read_text()
    )
    assert list(Draft7Validator(schema).iter_errors(output)) == []


@pytest.mark.parametrize(
    "result",
    [
        {
            "found": True,
            "kind": "single_issue",
            "issue_ids": ["healthcare"],
            "description": "desc",
            "quote": "quote",
            "source_url": "https://not-searched.example/about",
            "confidence": "low",
        },
        {
            "found": True,
            "kind": "single_issue",
            "issue_ids": [],
            "description": "desc",
            "quote": "We work to protect healthcare access.",
            "source_url": "https://example.org/about",
            "confidence": "high",
        },
    ],
)
def test_spender_invalid_results_are_dropped(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, result: dict[str, object], capsys: pytest.CaptureFixture[str]
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    assert enrich_spenders.run("race", client=FakeClient(result), fec_fetcher=_fec, page_fetcher=_page, limit=1) == 0
    assert json.loads((hand / "x_issue_focus.json").read_text())["rows"] == []
    assert "WARN C1" in capsys.readouterr().err


def test_found_false_is_silent_and_cache_hit_makes_no_call(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    found_false = {
        "found": False,
        "kind": "general_partisan",
        "issue_ids": [],
        "description": "",
        "quote": None,
        "source_url": None,
        "confidence": "low",
    }
    first = FakeClient(found_false)
    assert enrich_spenders.run("race", client=first, fec_fetcher=_fec, page_fetcher=_page, limit=1) == 0
    assert json.loads((hand / "x_issue_focus.json").read_text())["rows"] == []
    assert "WARN" not in capsys.readouterr().err
    second = FakeClient(found_false)
    assert enrich_spenders.run("race", client=second, fec_fetcher=_fec, page_fetcher=_page, limit=1) == 0
    assert second.calls == 0


def test_wayback_fallback_adds_snapshot_url(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    result = {
        "found": True,
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "The committee works to protect healthcare access.",
        "quote": "We work to protect healthcare access.",
        "source_url": "https://example.org/about",
        "confidence": "high",
    }

    def fallback_page(url: str) -> tuple[int, str]:
        if url.startswith("https://web.archive.org"):
            return 200, "<p>We work to protect healthcare access.</p>"
        return 503, ""

    assert (
        enrich_spenders.run(
            "race",
            client=FakeClient(result),
            fec_fetcher=_fec,
            page_fetcher=fallback_page,
            wayback_fetcher=lambda _: "https://web.archive.org/web/20260906/https://example.org/about",
            limit=1,
        )
        == 0
    )
    row = json.loads((hand / "x_issue_focus.json").read_text())["rows"][0]
    assert row["source_urls"][1].startswith("https://web.archive.org")


def test_budget_writes_partial_hand_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    result = {
        "found": True,
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "The committee works to protect healthcare access.",
        "quote": "We work to protect healthcare access.",
        "source_url": "https://example.org/about",
        "confidence": "high",
    }
    client = FakeClient(result)
    assert enrich_spenders.run("race", client=client, fec_fetcher=_fec, page_fetcher=_page, max_calls=1) == 3
    rows = json.loads((hand / "x_issue_focus.json").read_text())["rows"]
    assert [row["entity_id"] for row in rows] == ["C1"]


def test_accepted_row_is_preserved(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    accepted = {
        "entity_id": "C1",
        "name": "Example Committee",
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "accepted",
        "quote": "accepted",
        "source_urls": ["https://example.org/about"],
        "provenance": {"review_status": "accepted"},
    }
    (hand / "x_issue_focus.json").write_text(json.dumps({"rows": [accepted]}))
    result = {
        "found": True,
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "The committee works to protect healthcare access.",
        "quote": "We work to protect healthcare access.",
        "source_url": "https://example.org/about",
        "confidence": "high",
    }
    assert enrich_spenders.run("race", client=FakeClient(result), fec_fetcher=_fec, page_fetcher=_page, limit=1) == 0
    rows = json.loads((hand / "x_issue_focus.json").read_text())["rows"]
    assert rows[0] == accepted


def test_issues_patch_machine_focus_states_and_stale_cleanup(tmp_path: Path) -> None:
    out = tmp_path / "out"
    hand = tmp_path / "hand"
    for entity_id in ("C1", "C2", "C3"):
        entity = {
            "entity_id": entity_id,
            "issue_focus": {"kind": "labor", "issue_ids": [], "description": "human", "basis": {}},
            "x_enrichment": {"issue_focus": {"kind": "labor", "issue_ids": [], "description": "stale"}},
            "independent_expenditures": [],
        }
        (out / "entities").mkdir(parents=True, exist_ok=True)
        (out / "entities" / f"{entity_id}.json").write_text(json.dumps(entity))
    (out / "ledger.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "ledger.json").write_text(
        json.dumps({"top_outside_spenders": [], "traceability": {"outside_total": 0}, "data_status": "partial"})
    )
    hand.mkdir(parents=True)
    rows = [
        {
            "entity_id": "C1",
            "kind": "single_issue",
            "issue_ids": ["healthcare"],
            "description": "desc",
            "quote": "quote",
            "source_urls": ["https://example.org/about"],
            "provenance": {
                "model": "grok-4.3",
                "tagged_at": "2026-09-06",
                "review_status": "pending",
                "reviewed_by": None,
                "reviewed_at": None,
            },
        },
        {
            "entity_id": "C2",
            "kind": "labor",
            "issue_ids": [],
            "description": "desc",
            "quote": "quote",
            "source_urls": ["https://example.org/about"],
            "provenance": {
                "model": "grok-4.3",
                "tagged_at": "2026-09-06",
                "review_status": "accepted",
                "reviewed_by": "reviewer",
                "reviewed_at": "2026-09-07",
            },
        },
        {
            "entity_id": "C3",
            "kind": "labor",
            "issue_ids": [],
            "description": "desc",
            "quote": "quote",
            "source_urls": ["https://example.org/about"],
            "provenance": {
                "model": "grok-4.3",
                "tagged_at": "2026-09-06",
                "review_status": "rejected",
                "reviewed_by": "reviewer",
                "reviewed_at": "2026-09-07",
            },
        },
    ]
    (hand / "x_issue_focus.json").write_text(json.dumps({"rows": rows}))
    build("race", RowRefs(out_dir=out, hand_dir=hand))
    c1 = json.loads((out / "entities" / "C1.json").read_text())
    c2 = json.loads((out / "entities" / "C2.json").read_text())
    c3 = json.loads((out / "entities" / "C3.json").read_text())
    assert c1["issue_focus"]["description"] == "human"
    assert c1["x_enrichment"]["issue_focus"]["basis"]["basis"] == "inferred"
    assert c2["x_enrichment"]["issue_focus"]["basis"]["basis"] == "verified"
    assert c2["x_enrichment"]["issue_focus"]["basis"]["checked_by"] == "reviewer"
    assert "x_enrichment" not in c3
