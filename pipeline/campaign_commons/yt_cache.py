"""Shared YouTube video-id cache helpers for enrichment stages."""

from __future__ import annotations

from pathlib import Path

from .util import read_json, write_json


def load_video_id_cache(path: Path) -> dict[str, str | None]:
    if not path.exists():
        return {}
    loaded = read_json(path)
    return (
        {str(k): (str(v) if isinstance(v, str) else None) for k, v in loaded.items()}
        if isinstance(loaded, dict)
        else {}
    )


def save_video_id_cache(path: Path, cache: dict[str, str | None]) -> None:
    write_json(path, cache)
