from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

import campaign_commons.enrich_funders as enrich_funders
import campaign_commons.enrich_spenders as enrich_spenders
from campaign_commons.issues import RowRefs, patch_machine_funder


def _response(result: dict[str, object], *, source_url: str = "https://example.org/about") -> dict[str, object]:
    return {
        "id": "resp-1",
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "output": [
            {
                "type": "web_search_call",
                "action": {
                    "type": "search",
                    "query": "organization about",
                    "sources": [{"type": "url", "url": source_url}],
                },
            },
            {"type": "web_search_call", "action": {"type": "open_page", "url": source_url}},
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]},
        ],
    }


class FakeClient:
    def __init__(self, result: dict[str, object] | list[dict[str, object]]) -> None:
        self.results = result if isinstance(result, list) else [result]
        self.calls = 0
        self.payloads: list[dict[str, object]] = []

    def create_response(self, payload: dict[str, object]) -> dict[str, object]:
        self.payloads.append(payload)
        result = self.results[self.calls]
        self.calls += 1
        return _response(result, source_url=str(result.get("source_url") or "https://example.org/about"))


def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    out = tmp_path / "out" / "race"
    entities = out / "entities"
    hand = tmp_path / "hand" / "race"
    entities.mkdir(parents=True)
    hand.mkdir(parents=True)
    for name, rows in {
        "C1": [
            {
                "from_entity_id": "org:EXAMPLE_ORGANIZATION,_INC.",
                "from_name": "Example Organization, Inc.",
                "amount": 90,
            },
            {"from_entity_id": "org:SECOND_GROUP", "from_name": "Second Group", "amount": 20},
        ],
        "C2": [
            {
                "from_entity_id": "org:EXAMPLE_ORGANIZATION,_INC.",
                "from_name": "Example Organization, Inc.",
                "amount": 10,
            },
        ],
    }.items():
        (entities / f"{name}.json").write_text(json.dumps({"inflows": rows}))
    (hand / "issue_focus.json").write_text(json.dumps({"rows": [{"entity_id": "org:SECOND_GROUP"}]}))
    taxonomy = tmp_path / "issues_taxonomy.json"
    taxonomy.write_text(json.dumps([{"id": "healthcare", "label": "Health care", "description": "health policy"}]))
    prompt = tmp_path / "prompt.md"
    prompt.write_text("Issues:\n{{issues}}")
    race = type("Race", (), {"out_dir": out})()
    monkeypatch.setattr(enrich_funders, "DATA", tmp_path)
    monkeypatch.setattr(enrich_funders, "RACES", {"race": race})
    monkeypatch.setattr(enrich_funders, "ISSUES_TAXONOMY", taxonomy)
    monkeypatch.setattr(enrich_funders, "PROMPT_PATH", prompt)
    monkeypatch.setattr(enrich_funders, "issue_ids", lambda: ["healthcare"])
    monkeypatch.setattr(enrich_funders, "XAI_API_KEY", "test-key")
    monkeypatch.setattr(enrich_spenders, "DATA", tmp_path)
    return out, hand


def _result(source_url: str = "https://example.org/about") -> dict[str, object]:
    return {
        "found": True,
        "kind": "single_issue",
        "issue_ids": ["healthcare"],
        "description": "The organization works to protect healthcare access.",
        "quote": "We work to protect healthcare access.",
        "source_url": source_url,
        "confidence": "high",
    }


def _page(url: str) -> tuple[int, str]:
    if url == "https://example.org/about":
        return (
            200,
            "<html><body>Example Organization works to protect healthcare access. We work to protect healthcare access.</body></html>",
        )
    if url == "https://example.org/missing":
        return 200, "<html><body>We work to protect healthcare access.</body></html>"
    return 404, ""


def test_funder_happy_path_and_top_n_ranking(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out, hand = _setup(monkeypatch, tmp_path)
    client = FakeClient(_result())
    assert enrich_funders.run("race", client=client, page_fetcher=_page, top=1) == 0
    rows = json.loads((hand / "x_funder_focus.json").read_text())["rows"]
    assert [row["entity_id"] for row in rows] == ["org:EXAMPLE_ORGANIZATION,_INC."]
    assert rows[0]["name"] == "Example Organization, Inc."
    assert rows[0]["provenance"]["tool_filters"] == {}
    schema = json.loads(
        (Path(enrich_funders.ROOT) / "contracts" / "jsonschema" / "hand_x_issue_focus.schema.json").read_text()
    )
    assert list(Draft7Validator(schema).iter_errors(json.loads((hand / "x_funder_focus.json").read_text()))) == []
    assert out.exists()


@pytest.mark.parametrize(
    "source_url, expected",
    [
        ("https://news.example.org/story", "source_url is not the organization's own site"),
        ("https://example.org/missing", "page does not name the organization"),
    ],
)
def test_funder_validation_drops_denylisted_or_unnamed_pages(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    source_url: str,
    expected: str,
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    client = FakeClient(_result(source_url))
    assert enrich_funders.run("race", client=client, page_fetcher=_page, top=1) == 0
    assert json.loads((hand / "x_funder_focus.json").read_text())["rows"] == []
    assert expected in capsys.readouterr().err


def test_human_tagged_funder_is_skipped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    (hand / "issue_focus.json").write_text(json.dumps({"rows": [{"entity_id": "org:EXAMPLE_ORGANIZATION,_INC."}]}))
    client = FakeClient(_result())
    assert enrich_funders.run("race", client=client, page_fetcher=_page, only="org:EXAMPLE_ORGANIZATION,_INC.") == 0
    assert json.loads((hand / "x_funder_focus.json").read_text())["rows"] == []
    assert client.calls == 0


def test_funder_materializes_into_donor_views(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    donors = tmp_path / "out" / "race" / "donors"
    donors.mkdir()
    donor = donors / "org-EXAMPLE.json"
    donor.write_text(
        json.dumps(
            {
                "donor_id": "org:EXAMPLE_ORGANIZATION,_INC.",
                "x_enrichment": {"issue_focus": {"stale": True}},
            }
        )
    )
    row = _result()
    hand_row = {
        "entity_id": "org:EXAMPLE_ORGANIZATION,_INC.",
        "name": "Example Organization, Inc.",
        "kind": row["kind"],
        "issue_ids": row["issue_ids"],
        "description": row["description"],
        "quote": row["quote"],
        "source_urls": [row["source_url"]],
        "provenance": {
            "tagged_by": "xai-grok-4.3-2026-09-06",
            "tagged_at": "2026-09-06",
            "model": "grok-4.3",
            "prompt_version": "classify_funder.v1",
            "tools": ["web_search"],
            "tool_filters": {},
            "response_id": "resp-1",
            "retrieved_at": "2026-09-06T00:00:00Z",
            "citations": ["https://example.org/about"],
            "confidence": "high",
            "review_status": "pending",
            "reviewed_by": None,
            "reviewed_at": None,
            "review_note": None,
        },
    }
    changed, unmatched = patch_machine_funder(RowRefs(tmp_path / "out" / "race", hand), [hand_row])
    assert (changed, unmatched) == (1, 0)
    materialized = json.loads(donor.read_text())
    assert materialized["x_enrichment"]["issue_focus"]["basis"]["basis"] == "inferred"
    assert materialized["x_enrichment"]["issue_focus"]["basis"]["rule"] == "x_funder_focus"
    assert "stale" not in json.dumps(materialized)


def test_funder_repair_uses_no_tools_and_preserves_source(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    primary = _result()
    primary["description"] = "x" * 401
    client = FakeClient([primary, _result()])
    assert enrich_funders.run("race", client=client, page_fetcher=_page, top=1) == 0
    assert len(json.loads((hand / "x_funder_focus.json").read_text())["rows"]) == 1
    assert client.calls == 2
    assert "tools" not in client.payloads[1]
    assert json.dumps(primary, ensure_ascii=False) in client.payloads[1]["input"][1]["content"]
    ledger = json.loads((tmp_path / "raw" / "xai" / "ledger.json").read_text())
    assert [entry["stage"] for entry in ledger] == ["classify_funder", "classify_funder_repair"]
