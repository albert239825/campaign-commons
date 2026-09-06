from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

import campaign_commons.dossier_enrich as dossier_enrich
import campaign_commons.enrich_dossiers as enrich_dossiers
import campaign_commons.enrich_spenders as enrich_spenders
from campaign_commons.dossier_enrich import run as materialize


def _web_response(result: dict[str, object], urls: list[str]) -> dict[str, object]:
    return {
        "id": "web-response",
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "output": [
            {
                "type": "web_search_call",
                "action": {
                    "type": "search",
                    "query": "candidate issue",
                    "sources": [{"type": "url", "url": url} for url in urls],
                },
            },
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]},
        ],
    }


def _x_response(result: dict[str, object], urls: list[str]) -> dict[str, object]:
    action: dict[str, object] = {"type": "search"}
    if urls:
        action["sources"] = [{"type": "url", "url": url} for url in urls]
    return {
        "id": "x-response",
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "output": [
            {
                "type": "x_search_call",
                "action": action,
            },
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]},
        ],
    }


class FakeClient:
    def __init__(self, responses: list[dict[str, object]]) -> None:
        self.responses = responses
        self.calls = 0
        self.payloads: list[dict[str, object]] = []

    def create_response(self, payload: dict[str, object]) -> dict[str, object]:
        self.payloads.append(payload)
        response = self.responses[self.calls]
        self.calls += 1
        return response


def _stance_result(urls: list[str]) -> dict[str, object]:
    return {
        "found": True,
        "summary": "The candidate supports this issue according to the cited sources.",
        "direction_proposed": 1,
        "confidence": "medium",
        "sources": [
            {
                "url": url,
                "publisher": "Example News",
                "published_on": "2024-10-01",
                "excerpt": "The candidate supports this issue.",
            }
            for url in urls
        ],
    }


def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    out = tmp_path / "out" / "race"
    hand = tmp_path / "hand" / "race"
    out.mkdir(parents=True)
    hand.mkdir(parents=True)
    taxonomy = tmp_path / "issues_taxonomy.json"
    taxonomy.write_text(json.dumps([{"id": "healthcare", "label": "Health care", "description": "health policy"}]))
    prompt = tmp_path / "prompt.md"
    prompt.write_text("Issues:\n{{issues}}")
    x_prompt = tmp_path / "x_prompt.md"
    x_prompt.write_text("X posts")
    race = type(
        "Race",
        (),
        {
            "out_dir": out,
            "candidates": (
                type(
                    "Candidate",
                    (),
                    {"candidate_id": "S1", "name": "Example Candidate", "party": "DEM", "incumbent": True},
                )(),
            ),
        },
    )()
    (hand / "x_accounts.json").write_text(
        json.dumps(
            {
                "race_id": "race",
                "method": "fixture",
                "rows": [
                    {"candidate_id": "S1", "handles": ["ExampleCandidate"], "source_url": "https://campaign.example/"}
                ],
            }
        )
    )
    monkeypatch.setattr(enrich_dossiers, "DATA", tmp_path)
    monkeypatch.setattr(enrich_dossiers, "RACES", {"race": race})
    monkeypatch.setattr(enrich_dossiers, "ISSUES_TAXONOMY", taxonomy)
    monkeypatch.setattr(enrich_dossiers, "PROMPT_PATH", prompt)
    monkeypatch.setattr(enrich_dossiers, "X_PROMPT_PATH", x_prompt)
    monkeypatch.setattr(enrich_dossiers, "issue_ids", lambda: ["healthcare"])
    monkeypatch.setattr(enrich_dossiers, "XAI_API_KEY", "test-key")
    monkeypatch.setattr(enrich_dossiers, "_default_wayback_fetcher", lambda _: None)
    monkeypatch.setattr(enrich_spenders, "DATA", tmp_path)
    monkeypatch.setattr(dossier_enrich, "DATA", tmp_path)
    monkeypatch.setattr(dossier_enrich, "RACES", {"race": race})
    return out, hand


def _page_fetcher(url: str) -> tuple[int, str]:
    if url == "https://good.example/about":
        return 200, "<p>The candidate supports this issue.</p>"
    if url == "https://mismatch.example/about":
        return 200, "<p>Different text entirely.</p>"
    return 404, ""


def test_happy_path_keeps_failed_source_and_validates_hand_schema(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    urls = ["https://good.example/about", "https://unavailable.example/about"]
    client = FakeClient([_web_response(_stance_result(urls), urls)])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    output = json.loads((hand / "x_stances.json").read_text())
    assert len(output["rows"]) == 1
    assert [source["excerpt_verified"] for source in output["rows"][0]["sources"]] == [True, False]
    schema = json.loads(
        (Path(enrich_dossiers.ROOT) / "contracts" / "jsonschema" / "hand_x_stances.schema.json").read_text()
    )
    assert list(Draft7Validator(schema).iter_errors(output)) == []


def test_source_not_searched_drops_stance(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    result = _stance_result(["https://not-searched.example/about"])
    client = FakeClient([_web_response(result, ["https://other.example/about"])])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    assert json.loads((hand / "x_stances.json").read_text())["rows"] == []


def test_excerpt_mismatch_drops_source_but_keeps_other_verified(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    urls = ["https://mismatch.example/about", "https://good.example/about"]
    client = FakeClient([_web_response(_stance_result(urls), urls)])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    sources = json.loads((hand / "x_stances.json").read_text())["rows"][0]["sources"]
    assert [source["url"] for source in sources] == [urls[1]]
    assert [source["excerpt_verified"] for source in sources] == [True]


def test_ellipsis_excerpt_checks_each_fragment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://ellipsis.example/about"
    result = _stance_result([url])
    result["sources"][0]["excerpt"] = "The candidate supports ... this issue."
    client = FakeClient([_web_response(result, [url])])

    def fetcher(source_url: str) -> tuple[int, str]:
        if source_url == url:
            return 200, "<p>The candidate supports this issue.</p>"
        return 404, ""

    assert enrich_dossiers.run("race", client=client, page_fetcher=fetcher, no_x=True) == 0
    source = json.loads((hand / "x_stances.json").read_text())["rows"][0]["sources"][0]
    assert source["excerpt_verified"] is True


def test_invalid_source_is_dropped_but_valid_source_keeps_stance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    urls = ["https://too-long.example/about", "https://good.example/about"]
    result = _stance_result(urls)
    result["sources"][0]["excerpt"] = "x" * 401
    client = FakeClient([_web_response(result, urls)])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    sources = json.loads((hand / "x_stances.json").read_text())["rows"][0]["sources"]
    assert [source["url"] for source in sources] == [urls[1]]


def test_ballotpedia_is_not_denylisted(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://ballotpedia.org/Example_Candidate"
    client = FakeClient([_web_response(_stance_result([url]), [url])])

    def fetcher(source_url: str) -> tuple[int, str]:
        if source_url == url:
            return 200, "<p>The candidate supports this issue.</p>"
        return 404, ""

    assert enrich_dossiers.run("race", client=client, page_fetcher=fetcher, no_x=True) == 0
    assert len(json.loads((hand / "x_stances.json").read_text())["rows"]) == 1


def test_non_200_page_uses_wayback_and_records_both_urls(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://votesmart.org/candidate/example"
    wayback_url = "https://web.archive.org/web/20241001id/https://votesmart.org/candidate/example"
    client = FakeClient([_web_response(_stance_result([url]), [url])])

    def fetcher(source_url: str) -> tuple[int, str]:
        if source_url == url:
            return 403, ""
        if source_url == wayback_url:
            return 200, "<p>The candidate supports this issue.</p>"
        return 404, ""

    assert (
        enrich_dossiers.run(
            "race",
            client=client,
            page_fetcher=fetcher,
            wayback_fetcher=lambda source_url: wayback_url if source_url == url else None,
            no_x=True,
        )
        == 0
    )
    row = json.loads((hand / "x_stances.json").read_text())["rows"][0]
    assert row["sources"][0]["excerpt_verified"] is True
    assert row["sources"][0]["wayback_url"] == wayback_url
    assert row["provenance"]["citations"] == [url, wayback_url]


def test_no_verified_source_drops_stance(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    urls = ["https://mismatch.example/about"]
    client = FakeClient([_web_response(_stance_result(urls), urls)])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    assert json.loads((hand / "x_stances.json").read_text())["rows"] == []


@pytest.mark.parametrize(
    "oembed",
    [
        {"author_url": "https://x.com/OtherAccount", "html": "<p>The candidate supports this issue.</p>"},
        {"author_url": "https://x.com/ExampleCandidate", "html": "<p>Other words.</p>"},
    ],
)
def test_invalid_oembed_posts_are_dropped(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, oembed: dict[str, object]
) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    web_url = "https://good.example/about"
    post_url = "https://x.com/ExampleCandidate/status/1"
    x_result = {"posts": [{"url": post_url, "excerpt": "The candidate supports this issue.", "posted_on": None}]}
    client = FakeClient(
        [
            _web_response(_stance_result([web_url]), [web_url]),
            _x_response(x_result, [post_url]),
        ]
    )
    assert (
        enrich_dossiers.run(
            "race",
            client=client,
            page_fetcher=_page_fetcher,
            oembed_fetcher=lambda _: oembed,
        )
        == 0
    )
    row = json.loads((hand / "x_stances.json").read_text())["rows"][0]
    assert row["posts"] == []


def test_no_x_skips_supplement_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://good.example/about"
    client = FakeClient([_web_response(_stance_result([url]), [url])])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    assert client.calls == 1
    assert client.payloads[0]["tools"] == [{"type": "web_search"}]
    assert json.loads((hand / "x_stances.json").read_text())["rows"][0]["posts"] == []


def test_x_without_exposed_urls_uses_oembed_check(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    web_url = "https://good.example/about"
    post_url = "https://x.com/ExampleCandidate/status/1"
    x_result = {"posts": [{"url": post_url, "excerpt": "The candidate supports this issue.", "posted_on": None}]}
    client = FakeClient(
        [
            _web_response(_stance_result([web_url]), [web_url]),
            _x_response(x_result, []),
        ]
    )
    oembed = {
        "author_url": "https://x.com/ExampleCandidate",
        "html": "<p>The candidate supports this issue.</p>",
    }
    assert (
        enrich_dossiers.run(
            "race",
            client=client,
            page_fetcher=_page_fetcher,
            oembed_fetcher=lambda _: oembed,
        )
        == 0
    )
    assert json.loads((hand / "x_stances.json").read_text())["rows"][0]["posts"] == [
        {"url": post_url, "excerpt": "The candidate supports this issue.", "posted_on": None}
    ]


def test_repair_is_cached_and_has_no_search_tool(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://good.example/about"
    invalid = _stance_result([url])
    invalid["summary"] = "x" * 801
    repaired = _stance_result([url])
    client = FakeClient([_web_response(invalid, [url]), _web_response(repaired, [])])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    assert client.calls == 2
    repair_payload = client.payloads[1]
    assert "tools" not in repair_payload
    assert json.dumps(invalid) in repair_payload["input"][1]["content"]
    assert (tmp_path / "raw" / "xai" / "stance-S1-healthcare.repair.json").exists()
    assert len(json.loads((hand / "x_stances.json").read_text())["rows"]) == 1


def test_repair_runs_when_every_source_excerpt_is_invalid(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, hand = _setup(monkeypatch, tmp_path)
    url = "https://good.example/about"
    invalid = _stance_result([url])
    invalid["sources"][0]["excerpt"] = "x" * 401
    repaired = _stance_result([url])
    client = FakeClient([_web_response(invalid, [url]), _web_response(repaired, [])])
    assert enrich_dossiers.run("race", client=client, page_fetcher=_page_fetcher, no_x=True) == 0
    assert client.calls == 2
    assert len(json.loads((hand / "x_stances.json").read_text())["rows"]) == 1


def test_dossier_materialization_preserves_record_stances_and_review_basis(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out, hand = _setup(monkeypatch, tmp_path)
    original_stances = [{"issue_id": "healthcare", "position": "Record position", "evidence": []}]
    dossier = {
        "candidate_id": "S1",
        "stances": original_stances,
        "enrichment": {"stances": [{"issue_id": "stale"}]},
    }
    dossier_path = out / "dossiers"
    dossier_path.mkdir()
    (dossier_path / "S1.json").write_text(json.dumps(dossier))
    provenance = {
        "tagged_by": "xai-grok-4.3-2026-09-06",
        "tagged_at": "2026-09-06",
        "model": "grok-4.3",
        "prompt_version": "summarize_stance.v1",
        "tools": ["web_search"],
        "tool_filters": {},
        "response_id": "web-response",
        "retrieved_at": "2026-09-06T00:00:00Z",
        "citations": ["https://good.example/about"],
        "confidence": "medium",
        "review_status": "accepted",
        "reviewed_by": "AB",
        "reviewed_at": "2026-09-07",
        "review_note": None,
    }
    base = {
        "candidate_id": "S1",
        "issue_id": "healthcare",
        "summary": "Machine summary",
        "direction_proposed": 1,
        "confidence": "medium",
        "sources": [
            {
                "url": "https://good.example/about",
                "publisher": "Example",
                "published_on": None,
                "excerpt": "The candidate supports this issue.",
                "excerpt_verified": True,
            }
        ],
        "posts": [],
        "provenance": provenance,
    }
    rejected = copy.deepcopy(base)
    rejected["issue_id"] = "energy_climate"
    rejected["provenance"] = {**provenance, "review_status": "rejected"}
    (hand / "x_stances.json").write_text(json.dumps({"race_id": "race", "method": "fixture", "rows": [base, rejected]}))
    assert materialize("race") == 0
    patched = json.loads((dossier_path / "S1.json").read_text())
    assert patched["stances"] == original_stances
    assert [row["issue_id"] for row in patched["enrichment"]["stances"]] == ["healthcare"]
    assert patched["enrichment"]["stances"][0]["basis"] == "verified"
