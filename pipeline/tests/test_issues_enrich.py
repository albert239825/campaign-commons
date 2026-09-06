"""Tests for website position enrichment and the Layer C write-back."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from campaign_commons import issues_enrich
from campaign_commons.issues import POSITION_RULE, RowRefs, build


def _write(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def test_quote_verbatim_uses_page_source() -> None:
    pages = [issues_enrich.Page("https://example.org/about", "We support stronger rules.", "2026-01-01T00:00:00+00:00")]
    kept, dropped = issues_enrich.guard_positions(
        "C1", [{"issue_id": "guns", "direction": 2, "quote": "stronger rules"}], pages
    )
    assert dropped == 0
    assert kept[0]["source_url"] == "https://example.org/about"


def test_quote_paraphrase_is_dropped() -> None:
    pages = [issues_enrich.Page("https://example.org/about", "We support stronger rules.", "2026-01-01T00:00:00+00:00")]
    kept, dropped = issues_enrich.guard_positions(
        "C1", [{"issue_id": "guns", "direction": 2, "quote": "strong gun rules"}], pages
    )
    assert kept == []
    assert dropped == 1


def test_quote_whitespace_differences_are_allowed() -> None:
    pages = [
        issues_enrich.Page("https://example.org/about", "We support\nstronger   rules.", "2026-01-01T00:00:00+00:00")
    ]
    kept, dropped = issues_enrich.guard_positions(
        "C1", [{"issue_id": "guns", "direction": 2, "quote": "support stronger rules"}], pages
    )
    assert dropped == 0 and len(kept) == 1


def test_off_list_and_duplicate_positions_are_dropped() -> None:
    pages = [issues_enrich.Page("https://example.org/about", "guns position; another", "2026-01-01T00:00:00+00:00")]
    kept, dropped = issues_enrich.guard_positions(
        "C1",
        [
            {"issue_id": "not-an-issue", "direction": 1, "quote": "guns position"},
            {"issue_id": "guns", "direction": 1, "quote": "guns position"},
            {"issue_id": "guns", "direction": 2, "quote": "guns position"},
        ],
        pages,
    )
    assert len(kept) == 1 and kept[0]["direction"] == 1 and dropped == 2


def test_verified_rows_survive_and_model_rows_are_replaced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, hand = tmp_path / "out", tmp_path / "hand"
    _write(
        out / "ledger.json",
        {"top_outside_spenders": [{"entity_id": "C1", "name": "Committee", "total": 1}]},
    )
    _write(
        hand / "pa-sen-2024" / "issue_positions.json",
        {
            "race_id": "t",
            "method": "old",
            "rows": [
                {
                    "entity_id": "C1",
                    "name": "Committee",
                    "issue_id": "guns",
                    "direction": 2,
                    "quote": "verified quote",
                    "source_url": "https://example.org/about",
                    "status": "verified",
                    "tagged_by": "human",
                    "tagged_at": "2026-01-01",
                },
                {
                    "entity_id": "C1",
                    "name": "Committee",
                    "issue_id": "healthcare",
                    "direction": 1,
                    "quote": "old model quote",
                    "source_url": "https://example.org/about",
                    "status": "model",
                    "tagged_by": "old-model",
                    "tagged_at": "2026-01-01",
                },
            ],
            "pages": [{"entity_id": "C1", "url": "https://example.org/about", "fetched_at": "x", "chars": 10}],
        },
    )
    monkeypatch.setattr(issues_enrich, "RACES", {"pa-sen-2024": SimpleNamespace(out_dir=out)})
    monkeypatch.setattr(issues_enrich, "HAND", hand)
    monkeypatch.setattr(issues_enrich, "discover_urls", lambda *args: {"C1": ["https://example.org/about"]})
    result = issues_enrich.run("pa-sen-2024", only=["C1"])
    assert [row["issue_id"] for row in result["rows"]] == ["guns"]


def test_layer_c_writeback_and_coverage(tmp_path: Path) -> None:
    out, hand = tmp_path / "out", tmp_path / "hand"
    for entity_id in ("C1", "C2"):
        _write(out / "entities" / f"{entity_id}.json", {"entity_id": entity_id, "issue_positions": [{"stale": True}]})
    _write(
        out / "ledger.json",
        {
            "data_status": "real",
            "top_outside_spenders": [{"entity_id": "C1", "total": 10}, {"entity_id": "C2", "total": 5}],
            "traceability": {"outside_total": 15},
        },
    )
    _write(
        hand / "issue_positions.json",
        {
            "race_id": "t",
            "method": "fixture",
            "rows": [
                {
                    "entity_id": "C1",
                    "name": "C1",
                    "issue_id": "guns",
                    "direction": 2,
                    "quote": "quote",
                    "source_url": "https://example.org/about",
                    "status": "model",
                    "tagged_by": "grok-4.5",
                    "tagged_at": "2026-01-01",
                },
                {
                    "entity_id": "C1",
                    "name": "C1",
                    "issue_id": "healthcare",
                    "direction": 1,
                    "quote": "checked",
                    "source_url": "https://example.org/health",
                    "status": "verified",
                    "tagged_by": "human",
                    "tagged_at": "2026-01-02",
                },
            ],
            "pages": [],
        },
    )
    result = build("t", RowRefs(out, hand))
    c1 = json.loads((out / "entities" / "C1.json").read_text())
    c2 = json.loads((out / "entities" / "C2.json").read_text())
    assert c1["issue_positions"][0]["basis"]["basis"] == "inferred"
    assert c1["issue_positions"][1]["basis"]["basis"] == "verified"
    assert c1["issue_positions"][0]["basis"]["rule"] == POSITION_RULE
    assert "issue_positions" not in c2
    assert result["coverage"]["spenders_with_positions"] == 1


def test_python_axes_ids_match_typescript() -> None:
    source = Path(__file__).parents[2] / "contracts" / "src" / "issues.ts"
    text = source.resolve().read_text()
    axis_block = text.split("export const ISSUE_AXES", 1)[1].split("};", 1)[0]
    ids = set(
        line.split(":", 1)[0].strip()
        for line in axis_block.splitlines()
        if ":" in line
        and line.strip().startswith(
            (
                "healthcare",
                "energy_",
                "defense",
                "crypto_",
                "immigration",
                "abortion",
                "guns",
                "tax_",
                "tech_",
                "labor_",
            )
        )
    )
    assert ids == set(issues_enrich.ISSUE_AXES)
