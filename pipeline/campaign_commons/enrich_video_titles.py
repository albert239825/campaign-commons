"""Fetch and cache YouTube titles for video ads via the public oEmbed endpoint."""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable
from pathlib import Path

import requests

from .ads_creatives import youtube_video_id
from .config import DATA, RACES
from .util import now_iso, read_json, write_json
from .yt_cache import load_video_id_cache, save_video_id_cache

YT_DIR = DATA / "raw" / "yt"
VIDEO_IDS = YT_DIR / "video_ids.json"
OEMBED_DIR = YT_DIR / "oembed"
OEMBED_URL = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"


def _oembed_path(video_id: str) -> Path:
    return OEMBED_DIR / f"{video_id}.json"


def fetch_oembed(video_id: str, ad_id: str, session: requests.Session) -> dict[str, object]:
    fetched_at = now_iso()
    try:
        response = session.get(OEMBED_URL.format(video_id=video_id), timeout=30)
    except Exception as exc:
        return {"video_id": video_id, "ad_id": ad_id, "error": exc.__class__.__name__, "fetched_at": fetched_at}
    if response.status_code != 200:
        return {"video_id": video_id, "ad_id": ad_id, "error": str(response.status_code), "fetched_at": fetched_at}
    try:
        payload = response.json()
    except Exception as exc:
        return {"video_id": video_id, "ad_id": ad_id, "error": exc.__class__.__name__, "fetched_at": fetched_at}
    return {
        "video_id": video_id,
        "ad_id": ad_id,
        "title": str(payload.get("title", "")),
        "author_name": str(payload.get("author_name", "")),
        "fetched_at": fetched_at,
    }


def run(
    race_id: str,
    *,
    limit: int | None = None,
    only: str | None = None,
    sleep_seconds: float = 0.5,
    resolver: Callable[[str, str, requests.Session], str | None] | None = None,
    fetcher: Callable[[str, str, requests.Session], dict[str, object]] | None = None,
) -> int:
    race = RACES[race_id]
    ads_path = race.out_dir / "ads.json"
    gallery = read_json(ads_path)
    ads = gallery.get("ads", []) if isinstance(gallery, dict) else []
    if not isinstance(ads, list):
        ads = []
    cache = load_video_id_cache(VIDEO_IDS)
    YT_DIR.mkdir(parents=True, exist_ok=True)
    OEMBED_DIR.mkdir(parents=True, exist_ok=True)
    resolver = resolver or youtube_video_id
    fetcher = fetcher or fetch_oembed
    session = requests.Session()
    counts = {"resolved": 0, "titled": 0, "no_video_id": 0, "oembed_miss": 0, "skipped": 0}
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
            save_video_id_cache(VIDEO_IDS, cache)
        if not video_id:
            ad["video"] = None
            counts["no_video_id"] += 1
            continue
        counts["resolved"] += 1
        path = _oembed_path(video_id)
        if path.exists():
            result = read_json(path)
            counts["skipped"] += 1
        else:
            result = fetcher(video_id, ad_id, session)
            write_json(path, result)
            if sleep_seconds:
                time.sleep(sleep_seconds)
        if isinstance(result, dict) and isinstance(result.get("title"), str) and result["title"]:
            ad["video"] = {
                "video_id": video_id,
                "title": result["title"],
                "channel": result.get("author_name") or None,
                "source_url": f"https://www.youtube.com/watch?v={video_id}",
                "fetched_at": result.get("fetched_at", now_iso()),
            }
            counts["titled"] += 1
        else:
            ad["video"] = None
            counts["oembed_miss"] += 1
    for ad in ads:
        if isinstance(ad, dict) and ad.get("ad_type") != "video":
            ad["video"] = None
    write_json(ads_path, gallery)
    print(
        f"resolved {counts['resolved']}, titled {counts['titled']}, no-video-id {counts['no_video_id']}, "
        f"oembed-miss {counts['oembed_miss']}, skipped {counts['skipped']}"
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
