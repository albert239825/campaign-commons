"""Best-effort creative thumbnails for the ad gallery (no headless browser).

adstransparency.google.com is a JS app; the creative itself is rendered in an iframe. The only static asset reachable
with plain HTTP is the YouTube poster frame of VIDEO ads: the site's lookup RPC returns a preview-renderer URL whose
JS embeds the YouTube `video_id`, and i.ytimg.com serves a JPEG for that id. TEXT/IMAGE ads yield nothing static and
are skipped. Every step is unofficial; any failure returns None and the ad keeps `cached_creative_path: null`.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from pathlib import Path

import requests

LOOKUP_RPC = "https://adstransparency.google.com/anji/_/rpc/LookupService/GetCreativeById?authuser="
YT_THUMB = "https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
_PREVIEW_URL = re.compile(r"https://displayads-formats\.googleusercontent\.com/ads/preview/content\.js\?[^\"\\\s]+")
_VIDEO_ID = re.compile(r"video_id\\x27:\s*\\x27([A-Za-z0-9_-]{11})\\x27")
_HEADERS = {"Origin": "https://adstransparency.google.com", "Referer": "https://adstransparency.google.com/"}


class LookupRateLimited(Exception):
    """The Transparency lookup endpoint rejected the request for rate limiting."""


class LookupFailed(Exception):
    """The Transparency lookup endpoint failed without a retryable rate limit."""


def resolve_video_id_with_backoff(
    resolver: Callable[[str, str, requests.Session], str | None],
    advertiser_id: str,
    ad_id: str,
    session: requests.Session,
    *,
    sleep_fn: Callable[[float], None] | None = None,
) -> str | None:
    delays = (0, 10, 30, 90)
    sleep_fn = sleep_fn or time.sleep
    for attempt, delay in enumerate(delays):
        if delay:
            sleep_fn(delay)
        try:
            return resolver(advertiser_id, ad_id, session)
        except LookupRateLimited:
            if attempt == len(delays) - 1:
                raise


def youtube_video_id(advertiser_id: str, ad_id: str, session: requests.Session) -> str | None:
    payload = {"f.req": json.dumps({"1": advertiser_id, "2": ad_id, "5": {"1": 1, "2": 0, "3": 2}})}
    r = session.post(LOOKUP_RPC, data=payload, headers=_HEADERS, timeout=30)
    if r.status_code == 429:
        raise LookupRateLimited
    if r.status_code != 200:
        raise LookupFailed(f"lookup returned HTTP {r.status_code}")
    preview = _PREVIEW_URL.search(r.text.replace("\\u003d", "=").replace("\\u0026", "&"))
    if not preview:
        return None
    js = session.get(preview.group(0), timeout=30)
    if js.status_code == 429:
        raise LookupRateLimited
    if js.status_code != 200:
        raise LookupFailed(f"preview returned HTTP {js.status_code}")
    m = _VIDEO_ID.search(js.text)
    return m.group(1) if m else None


def cache_video_thumbnail(
    advertiser_id: str, ad_id: str, dest_dir: Path, session: requests.Session, budget_bytes: int
) -> tuple[Path, int] | None:
    """Write <dest_dir>/<ad_id>.jpg; returns (path, bytes) or None. Never exceeds budget_bytes."""
    dest = dest_dir / f"{ad_id}.jpg"
    if dest.exists():
        return dest, dest.stat().st_size
    try:
        vid = youtube_video_id(advertiser_id, ad_id, session)
    except (LookupRateLimited, LookupFailed):
        return None
    if not vid:
        return None
    img = session.get(YT_THUMB.format(video_id=vid), timeout=30)
    if img.status_code != 200 or not img.headers.get("content-type", "").startswith("image/"):
        return None
    if len(img.content) > budget_bytes:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(img.content)
    time.sleep(0.5)
    return dest, len(img.content)
