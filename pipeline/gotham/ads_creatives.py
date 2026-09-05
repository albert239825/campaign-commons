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
from pathlib import Path

import requests

LOOKUP_RPC = "https://adstransparency.google.com/anji/_/rpc/LookupService/GetCreativeById?authuser="
YT_THUMB = "https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
_PREVIEW_URL = re.compile(r"https://displayads-formats\.googleusercontent\.com/ads/preview/content\.js\?[^\"\\\s]+")
_VIDEO_ID = re.compile(r"video_id\\x27:\s*\\x27([A-Za-z0-9_-]{11})\\x27")
_HEADERS = {"Origin": "https://adstransparency.google.com", "Referer": "https://adstransparency.google.com/"}


def youtube_video_id(advertiser_id: str, ad_id: str, session: requests.Session) -> str | None:
    payload = {"f.req": json.dumps({"1": advertiser_id, "2": ad_id, "5": {"1": 1, "2": 0, "3": 2}})}
    r = session.post(LOOKUP_RPC, data=payload, headers=_HEADERS, timeout=30)
    if r.status_code != 200:
        return None
    preview = _PREVIEW_URL.search(r.text.replace("\\u003d", "=").replace("\\u0026", "&"))
    if not preview:
        return None
    js = session.get(preview.group(0), timeout=30)
    if js.status_code != 200:
        return None
    m = _VIDEO_ID.search(js.text)
    return m.group(1) if m else None


def cache_video_thumbnail(
    advertiser_id: str, ad_id: str, dest_dir: Path, session: requests.Session, budget_bytes: int
) -> tuple[Path, int] | None:
    """Write <dest_dir>/<ad_id>.jpg; returns (path, bytes) or None. Never exceeds budget_bytes."""
    dest = dest_dir / f"{ad_id}.jpg"
    if dest.exists():
        return dest, dest.stat().st_size
    vid = youtube_video_id(advertiser_id, ad_id, session)
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
