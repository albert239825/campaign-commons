"""Fetch and cache YouTube captions for video ads.

This stage is intentionally local: YouTube commonly blocks cloud IP ranges.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable
from pathlib import Path

import requests
from youtube_transcript_api import FetchedTranscript, Transcript, YouTubeTranscriptApi
from youtube_transcript_api._errors import IpBlocked, RequestBlocked

from .ads_creatives import LookupFailed, LookupRateLimited, resolve_video_id_with_backoff, youtube_video_id
from .config import DATA, RACES
from .util import now_iso, read_json, write_json
from .yt_cache import load_video_id_cache

YT_DIR = DATA / "raw" / "yt"
VIDEO_IDS = YT_DIR / "video_ids.json"


def _raw_segments(fetched: FetchedTranscript) -> list[dict[str, float | str]]:
    return [
        {"start": float(segment["start"]), "duration": float(segment["duration"]), "text": str(segment["text"])}
        for segment in fetched.to_raw_data()
    ]


def _choose_transcript(transcripts: list[Transcript]) -> Transcript | None:
    english_manual = [t for t in transcripts if t.language_code.lower().startswith("en") and not t.is_generated]
    if english_manual:
        return english_manual[0]
    english_generated = [t for t in transcripts if t.language_code.lower().startswith("en") and t.is_generated]
    if english_generated:
        return english_generated[0]
    return transcripts[0] if transcripts else None


def _is_blocked(exc: BaseException) -> bool:
    return isinstance(exc, (RequestBlocked, IpBlocked))


def _video_id_cache() -> dict[str, str | None]:
    return load_video_id_cache(VIDEO_IDS)


def _ad_transcript_path(video_id: str) -> Path:
    return YT_DIR / f"{video_id}.json"


def fetch_transcript(video_id: str, ad_id: str, api: YouTubeTranscriptApi) -> dict[str, object]:
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
            "kind": "auto_caption" if transcript.is_generated else "manual_caption",
            "language": transcript.language_code,
            "is_generated": transcript.is_generated,
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
    sleep_seconds: float = 1.0,
    api: YouTubeTranscriptApi | None = None,
    resolver: Callable[[str, str, requests.Session], str | None] | None = None,
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
    session = requests.Session()
    counts = {"resolved": 0, "fetched": 0, "no_transcript": 0, "skipped": 0}
    selected = [
        ad
        for ad in ads
        if isinstance(ad, dict) and ad.get("ad_type") == "video" and (only is None or str(ad.get("ad_id")) == only)
    ]
    if limit is not None:
        selected = selected[:limit]
    for processed, ad in enumerate(selected):
        ad_id = str(ad["ad_id"])
        if ad_id in cache:
            video_id = cache[ad_id]
        else:
            try:
                video_id = resolve_video_id_with_backoff(resolver, str(ad["advertiser_id"]), ad_id, session)
            except LookupRateLimited:
                print(
                    f"rate limited by adstransparency.google.com after {processed} ads; re-run later to continue",
                    file=sys.stderr,
                )
                return 2
            except LookupFailed as exc:
                print(f"video ID lookup failed after {processed} ads: {exc}; re-run later to continue", file=sys.stderr)
                return 2
            cache[ad_id] = video_id
            write_json(VIDEO_IDS, cache)
            if sleep_seconds:
                time.sleep(sleep_seconds)
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
    parser.add_argument("--sleep", type=float, default=1.0)
    args = parser.parse_args()
    return run(args.race, limit=args.limit, only=args.only, sleep_seconds=args.sleep)


if __name__ == "__main__":
    sys.exit(main())
