"""campaign_commons.util: JSON writing keeps generated_at stable when nothing else changed; range midpoints."""

from __future__ import annotations

import json
from pathlib import Path

from campaign_commons.util import range_midpoint, write_json


def test_write_json_keeps_generated_at_when_content_is_unchanged(tmp_path: Path) -> None:
    p = tmp_path / "x.json"
    write_json(p, {"generated_at": "2026-01-01T00:00:00+00:00", "rows": [1, 2]})
    write_json(p, {"generated_at": "2026-02-02T00:00:00+00:00", "rows": [1, 2]})
    assert json.loads(p.read_text())["generated_at"] == "2026-01-01T00:00:00+00:00"


def test_write_json_updates_generated_at_when_content_changes(tmp_path: Path) -> None:
    p = tmp_path / "x.json"
    write_json(p, {"generated_at": "2026-01-01T00:00:00+00:00", "rows": [1, 2]})
    write_json(p, {"generated_at": "2026-02-02T00:00:00+00:00", "rows": [1, 2, 3]})
    assert json.loads(p.read_text()) == {"generated_at": "2026-02-02T00:00:00+00:00", "rows": [1, 2, 3]}


def test_write_json_tolerates_corrupt_previous_file_and_non_dict_payloads(tmp_path: Path) -> None:
    p = tmp_path / "x.json"
    p.write_text("{not json")
    write_json(p, {"generated_at": "t", "a": 1})
    assert json.loads(p.read_text()) == {"generated_at": "t", "a": 1}
    write_json(p, [1, 2])
    assert json.loads(p.read_text()) == [1, 2]


def test_range_midpoint_open_top_bucket_is_the_floor() -> None:
    assert range_midpoint({"min": 100, "max": 200}) == 150
    assert range_midpoint({"min": 100, "max": None}) == 100
    assert range_midpoint({"min": None, "max": None}) == 0
