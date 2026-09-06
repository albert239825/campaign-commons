from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import pytest
from jsonschema import Draft7Validator
from youtube_transcript_api._errors import RequestBlocked

import campaign_commons.enrich_ads as enrich_ads
import campaign_commons.enrich_transcripts as enrich_transcripts
from campaign_commons.ads_enrich import enrich
from campaign_commons.xai_client import XaiClient


def _ad(ad_id: str) -> dict[str, object]:
    return {"ad_id": ad_id, "ad_type": "video", "advertiser_id": "AR1", "creative_url": f"https://example.com/{ad_id}"}


def _response(result: dict[str, object], response_id: str = "resp-1") -> dict[str, object]:
    return {
        "id": response_id,
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "output": [{"content": [{"type": "output_text", "text": json.dumps(result)}]}],
    }


class FakeClient:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.calls = 0

    def create_response(self, payload: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        return _response(self.result, f"resp-{self.calls}")


def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, texts: dict[str, str]) -> tuple[Path, Path]:
    out = tmp_path / "out"
    hand = tmp_path / "hand"
    raw = tmp_path / "raw"
    (out / "race").mkdir(parents=True, exist_ok=True)
    shutil.rmtree(hand / "race", ignore_errors=True)
    (hand / "race").mkdir(parents=True, exist_ok=True)
    (raw / "yt").mkdir(parents=True, exist_ok=True)
    shutil.rmtree(raw / "xai", ignore_errors=True)
    ads = [_ad(ad_id) for ad_id in texts]
    (out / "race" / "ads.json").write_text(json.dumps({"ads": ads}))
    for ad_id, text in texts.items():
        (raw / "yt" / f"{ad_id}.json").write_text(
            json.dumps(
                {
                    "ad_id": ad_id,
                    "video_id": f"video-{ad_id}",
                    "kind": "auto_caption",
                    "language": "en",
                    "text": text,
                }
            )
        )
    taxonomy = tmp_path / "issues_taxonomy.json"
    taxonomy.write_text(json.dumps([{"id": "healthcare", "label": "Healthcare", "description": "health policy"}]))
    prompt = tmp_path / "prompt.md"
    prompt.write_text("Issues:\n{{issues}}")
    race = type("Race", (), {"out_dir": out / "race"})()
    monkeypatch.setattr(enrich_ads, "DATA", tmp_path)
    monkeypatch.setattr(enrich_ads, "RACES", {"race": race})
    monkeypatch.setattr(enrich_ads, "ISSUES_TAXONOMY", taxonomy)
    monkeypatch.setattr(enrich_ads, "PROMPT_PATH", prompt)
    monkeypatch.setattr(enrich_ads, "issue_ids", lambda: ["healthcare"])
    monkeypatch.setattr(enrich_ads, "XAI_API_KEY", "test-key")
    return hand / "race", raw


def test_classification_happy_path_and_empty_result(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    hand_dir, _ = _setup(
        monkeypatch, tmp_path, texts={"A1": "We protect healthcare for families.", "A2": "Biography only."}
    )
    client = FakeClient(
        {
            "issue_ids": ["healthcare"],
            "quote": "healthcare",
            "rationale": "The ad discusses healthcare.",
            "confidence": "high",
        }
    )
    assert enrich_ads.run("race", client=client) == 0
    output = json.loads((hand_dir / "x_ad_issues.json").read_text())
    assert [row["ad_id"] for row in output["rows"]] == ["A1"]
    assert output["rows"][0]["provenance"]["review_status"] == "pending"
    schema = json.loads(
        (Path(enrich_ads.ROOT) / "contracts" / "jsonschema" / "hand_x_ad_issues.schema.json").read_text()
    )
    assert list(Draft7Validator(schema).iter_errors(output)) == []

    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A2": "Biography only."})
    client = FakeClient({"issue_ids": [], "quote": None, "rationale": "No listed policy topic.", "confidence": "low"})
    assert enrich_ads.run("race", client=client) == 0
    assert json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"][0]["issue_ids"] == []


@pytest.mark.parametrize(
    "result",
    [
        {"issue_ids": ["outside"], "quote": "healthcare", "rationale": "bad", "confidence": "low"},
        {"issue_ids": ["healthcare"], "quote": "missing", "rationale": "bad", "confidence": "low"},
    ],
)
def test_invalid_classifications_are_dropped(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, result: dict[str, object], capsys: pytest.CaptureFixture[str]
) -> None:
    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A1": "Healthcare matters."})
    assert enrich_ads.run("race", client=FakeClient(result)) == 0
    assert json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"] == []
    assert "WARN A1" in capsys.readouterr().err


def test_cache_hit_is_byte_identical_and_makes_no_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A1": "Healthcare matters."})
    first = FakeClient(
        {
            "issue_ids": ["healthcare"],
            "quote": "Healthcare",
            "rationale": "Healthcare is discussed.",
            "confidence": "high",
        }
    )
    assert enrich_ads.run("race", client=first) == 0
    before = (hand_dir / "x_ad_issues.json").read_bytes()
    second = FakeClient(
        {"issue_ids": ["healthcare"], "quote": "Healthcare", "rationale": "different", "confidence": "low"}
    )
    assert enrich_ads.run("race", client=second) == 0
    assert second.calls == 0
    assert (hand_dir / "x_ad_issues.json").read_bytes() == before


def test_reviewed_rows_preserved_unless_refresh(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A1": "Healthcare matters."})
    existing = {
        "race_id": "race",
        "method": "old",
        "rows": [
            {
                "ad_id": "A1",
                "issue_ids": ["healthcare"],
                "quote": "old",
                "rationale": "old",
                "transcript_kind": "auto_caption",
                "source_urls": ["https://example.com/A1"],
                "provenance": {
                    "tagged_by": "xai-old-2026-01-01",
                    "tagged_at": "2026-01-01",
                    "model": "old",
                    "prompt_version": "classify_ad.v1",
                    "tools": [],
                    "tool_filters": {},
                    "response_id": None,
                    "retrieved_at": "2026-01-01T00:00:00+00:00",
                    "citations": [],
                    "confidence": "high",
                    "review_status": "accepted",
                    "reviewed_by": "human",
                    "reviewed_at": "2026-01-02",
                    "review_note": None,
                },
            }
        ],
    }
    (hand_dir / "x_ad_issues.json").write_text(json.dumps(existing))
    client = FakeClient({"issue_ids": ["healthcare"], "quote": "Healthcare", "rationale": "new", "confidence": "low"})
    assert enrich_ads.run("race", client=client) == 0
    assert json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"] == existing["rows"]
    assert enrich_ads.run("race", client=client, refresh_reviewed=True) == 0
    assert (
        json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"][0]["provenance"]["review_status"] == "pending"
    )


def test_only_preserves_pending_rows_outside_run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A1": "Healthcare matters.", "A2": "Healthcare matters."})
    old_rows = [
        {"ad_id": "A1", "provenance": {"review_status": "pending"}, "quote": "old A1"},
        {"ad_id": "A2", "provenance": {"review_status": "pending"}, "quote": "old A2"},
    ]
    (hand_dir / "x_ad_issues.json").write_text(json.dumps({"race_id": "race", "rows": old_rows}))
    client = FakeClient({"issue_ids": ["healthcare"], "quote": "Healthcare", "rationale": "new", "confidence": "high"})
    assert enrich_ads.run("race", client=client, only="A1") == 0
    rows = json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"]
    assert {row["ad_id"] for row in rows} == {"A1", "A2"}
    assert next(row for row in rows if row["ad_id"] == "A2") == old_rows[1]


def test_max_calls_stops_after_one_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    hand_dir, _ = _setup(monkeypatch, tmp_path, texts={"A1": "Healthcare matters.", "A2": "Healthcare matters."})
    client = FakeClient({"issue_ids": ["healthcare"], "quote": "Healthcare", "rationale": "new", "confidence": "low"})
    assert enrich_ads.run("race", client=client, max_calls=1) == 3
    assert client.calls == 1
    assert [row["ad_id"] for row in json.loads((hand_dir / "x_ad_issues.json").read_text())["rows"]] == ["A1"]


def test_xai_client_retries_429(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def transport(
        method: str, url: str, headers: dict[str, str], json: dict[str, object]
    ) -> tuple[int, dict[str, object]]:
        calls.append(1)
        return (429, {}) if len(calls) == 1 else (200, {"ok": True})

    monkeypatch.setattr("campaign_commons.xai_client.time.sleep", lambda _: None)
    assert XaiClient("key", transport=transport).create_response({}) == {"ok": True}
    assert len(calls) == 2


def test_ads_enrich_keeps_human_and_patches_machine() -> None:
    gallery = {
        "ads": [
            {
                "ad_id": "A1",
                "advertiser_name": "Example",
                "creative_url": "https://example.com/A1",
                "matched_entity_id": None,
                "issues": {"issue_ids": ["healthcare"]},
            },
            {
                "ad_id": "A2",
                "advertiser_name": "Example",
                "creative_url": "https://example.com/A2",
                "matched_entity_id": None,
            },
            {
                "ad_id": "A3",
                "advertiser_name": "Example",
                "creative_url": "https://example.com/A3",
                "matched_entity_id": None,
            },
        ],
        "notes": [],
    }
    provenance = {
        "tagged_by": "xai-grok-4.3-2026-09-06",
        "tagged_at": "2026-09-06",
        "model": "grok-4.3",
        "review_status": "pending",
        "reviewed_by": None,
        "reviewed_at": None,
        "confidence": "high",
    }

    def row(ad_id: str, status: str, p: dict[str, object] = provenance) -> dict[str, object]:
        return {
            "ad_id": ad_id,
            "issue_ids": ["healthcare"],
            "source_urls": ["https://example.com/source"],
            "quote": "health",
            "transcript_kind": "auto_caption",
            "provenance": {**p, "review_status": status},
        }

    accepted = {**provenance, "review_status": "accepted", "reviewed_by": "reviewer", "reviewed_at": "2026-09-07"}
    enrich(
        gallery,
        {},
        {},
        {},
        {
            "rows": [
                {
                    "ad_id": "A1",
                    "issue_ids": ["healthcare"],
                    "note": None,
                    "tagged_by": "human",
                    "tagged_at": "2026-09-06",
                }
            ]
        },
        {"rows": []},
        {"rows": [row("A1", "pending"), row("A2", "rejected"), row("A3", "accepted", accepted)]},
    )
    ads = gallery["ads"]
    assert ads[0]["issues"]["issue_ids"] == ["healthcare"]
    assert ads[0]["machine_issues"]["basis"]["basis"] == "inferred"
    assert "machine_issues" not in ads[1]
    assert ads[2]["machine_issues"]["basis"]["basis"] == "verified"
    assert ads[2]["machine_issues"]["basis"]["checked_by"] == "reviewer"


@dataclass
class _FetchedTranscript:
    segments: list[dict[str, object]]

    def to_raw_data(self) -> list[dict[str, object]]:
        return self.segments


@dataclass
class _Transcript:
    language_code: str = "en"
    is_generated: bool = True

    def fetch(self) -> _FetchedTranscript:
        return _FetchedTranscript([{"start": 0, "duration": 1, "text": "hello"}])


class _Api:
    def list(self, video_id: str) -> list[_Transcript]:
        return [_Transcript()]


def test_transcript_fetch_writes_auto_caption(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    out = tmp_path / "out" / "race"
    out.mkdir(parents=True)
    (out / "ads.json").write_text(json.dumps({"ads": [_ad("A1")]}))
    monkeypatch.setattr(enrich_transcripts, "RACES", {"race": type("Race", (), {"out_dir": out})()})
    monkeypatch.setattr(enrich_transcripts, "YT_DIR", tmp_path / "yt")
    monkeypatch.setattr(enrich_transcripts, "VIDEO_IDS", tmp_path / "yt" / "video_ids.json")
    result = enrich_transcripts.run(
        "race",
        sleep_seconds=0,
        api=_Api(),
        resolver=lambda advertiser, ad_id, session: "video-A1",
    )
    assert result == 0
    assert json.loads((tmp_path / "yt" / "video-A1.json").read_text())["kind"] == "auto_caption"


def test_transcript_request_blocked_exits_two(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class BlockedApi:
        def list(self, video_id: str) -> list[object]:
            raise RequestBlocked(video_id)

    out = tmp_path / "out" / "race"
    out.mkdir(parents=True)
    (out / "ads.json").write_text(json.dumps({"ads": [_ad("A1")]}))
    monkeypatch.setattr(enrich_transcripts, "RACES", {"race": type("Race", (), {"out_dir": out})()})
    monkeypatch.setattr(enrich_transcripts, "YT_DIR", tmp_path / "yt")
    monkeypatch.setattr(enrich_transcripts, "VIDEO_IDS", tmp_path / "yt" / "video_ids.json")
    assert (
        enrich_transcripts.run(
            "race",
            sleep_seconds=0,
            api=BlockedApi(),
            resolver=lambda advertiser, ad_id, session: "video-A1",
        )
        == 2
    )
