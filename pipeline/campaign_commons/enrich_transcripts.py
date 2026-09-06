"""Fetch and cache YouTube captions for video ads.

This stage is intentionally local: YouTube commonly blocks cloud IP ranges.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

from youtube_transcript_api import YouTubeTranscriptApi

from .ads_creatives import youtube_video_id
from .config import DATA, RACES
from .util import now_iso, read_json, write_json

YT_DIR = DATA / "raw" / "yt"
VIDEO_IDS = YT_DIR / "video_ids.json"


def _field(obj: object, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _raw_segments(fetched: object) -> list[dict[str, Any]]:
    raw = fetched.to_raw_data() if hasattr(fetched, "to_raw_data") else fetched
    segments: list[dict[str, Any]] = []
    for segment in raw if isinstance(raw, list) else []:
        start = _field(segment, "start")
        duration = _field(segment, "duration")
        text = _field(segment, "text")
        if isinstance(text, str):
            segments.append({"start": float(start or 0), "duration": float(duration or 0), "text": text})
    return segments


def _choose_transcript(transcripts: list[object]) -> object | None:
    english_manual = [
        t
        for t in transcripts
        if str(_field(t, "language_code", "")).lower().startswith("en") and not _field(t, "is_generated", False)
    ]
    if english_manual:
        return english_manual[0]
    english_generated = [
        t
        for t in transcripts
        if str(_field(t, "language_code", "")).lower().startswith("en") and _field(t, "is_generated", False)
    ]
    if english_generated:
        return english_generated[0]
    return transcripts[0] if transcripts else None


def _is_blocked(exc: BaseException) -> bool:
    return exc.__class__.__name__ in {"RequestBlocked", "IpBlocked"}


def _video_id_cache() -> dict[str, str | None]:
    if not VIDEO_IDS.exists():
        return {}
    loaded = read_json(VIDEO_IDS)
    return (
        {str(k): (str(v) if isinstance(v, str) else None) for k, v in loaded.items()}
        if isinstance(loaded, dict)
        else {}
    )


def _ad_transcript_path(video_id: str) -> Path:
    return YT_DIR / f"{video_id}.json"


def fetch_transcript(video_id: str, ad_id: str, api: Any) -> dict[str, Any]:
    fetched_at = now_iso()
    try:
        listed = list(api.list(video_id))
        transcript = _choose_transcript(listed)
        if transcript is None:
            return {"video_id": video_id, "ad_id": ad_id, "error": "NoTranscriptFound", "fetched_at": fetched_at}
        segments = _raw_segments(transcript.fetch())
        return {
            "video_id": video_id,
            "ad_id": ad_id,
            "kind": "auto_caption"
            if _field(transcript, "is_generated", False)
            else (
                "manual_caption"
                if str(_field(transcript, "language_code", "")).lower().startswith("en")
                else "manual_caption"
            ),
            "language": str(_field(transcript, "language_code", "")),
            "is_generated": bool(_field(transcript, "is_generated", False)),
            "text": " ".join(str(s["text"]) for s in segments),
            "segments": segments,
            "fetched_at": fetched_at,
        }
    except Exception as exc:
        if _is_blocked(exc):
            raise
        return {"video_id": video_id, "ad_id": ad_id, "error": exc.__class__.__name__, "fetched_at": fetched_at}


def run(
    race_id: str,
    *,
    limit: int | None = None,
    only: str | None = None,
    sleep_seconds: float = 0.5,
    api: Any | None = None,
    resolver: Any | None = None,
) -> int:
    race = RACES[race_id]
    ads_path = race.out_dir / "ads.json"
    ads = read_json(ads_path).get("ads", [])
    if not isinstance(ads, list):
        ads = []
    cache = _video_id_cache()
    YT_DIR.mkdir(parents=True, exist_ok=True)
    resolver = resolver or youtube_video_id
    api = api or YouTubeTranscriptApi()
    session = __import__("requests").Session()
    counts = {"resolved": 0, "fetched": 0, "no_transcript": 0, "skipped": 0}
    selected = [
        ad
        for ad in ads
        if isinstance(ad, dict) and ad.get("ad_type") == "video" and (only is None or str(ad.get("ad_id")) == only)
    ]
    if limit is not None:
        selected = selected[:limit]
    for ad in selected:
        ad_id = str(ad["ad_id"])
        if ad_id in cache:
            video_id = cache[ad_id]
        else:
            video_id = resolver(str(ad["advertiser_id"]), ad_id, session)
            cache[ad_id] = video_id
            write_json(VIDEO_IDS, cache)
        if not video_id:
            counts["no_transcript"] += 1
            continue
        counts["resolved"] += 1
        path = _ad_transcript_path(video_id)
        if path.exists():
            counts["skipped"] += 1
            continue
        try:
            result = fetch_transcript(video_id, ad_id, api)
        except Exception as exc:
            if _is_blocked(exc):
                print("YouTube blocks cloud IPs; run enrich-transcripts from a residential IP.", file=sys.stderr)
                return 2
            raise
        write_json(path, result)
        if "error" in result:
            counts["no_transcript"] += 1
        else:
            counts["fetched"] += 1
        if sleep_seconds:
            time.sleep(sleep_seconds)
    text_ads = sum(1 for ad in ads if isinstance(ad, dict) and ad.get("ad_type") != "video")
    print(
        f"resolved {counts['resolved']}, fetched {counts['fetched']}, no-transcript {counts['no_transcript']}, "
        f"skipped {counts['skipped']} (text/image/unknown ads skipped: {text_ads})"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only")
    parser.add_argument("--sleep", type=float, default=0.5)
    args = parser.parse_args()
    return run(args.race, limit=args.limit, only=args.only, sleep_seconds=args.sleep)


if __name__ == "__main__":
    sys.exit(main())
