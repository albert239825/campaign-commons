import json
from pathlib import Path

import pytest

import campaign_commons.ads_creatives as ads_creatives
import campaign_commons.enrich_video_titles as enrich_video_titles
from campaign_commons.ads_creatives import LookupRateLimited


def _ad(ad_id: str, ad_type: str = "video") -> dict[str, object]:
    return {"ad_id": ad_id, "ad_type": ad_type, "advertiser_id": "AR1", "advertiser_name": "Sponsor", "video": None}


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    out = tmp_path / "out" / "race"
    out.mkdir(parents=True)
    ads_path = out / "ads.json"
    ads_path.write_text(json.dumps({"generated_at": "fixed", "ads": [_ad("A1"), _ad("A2"), _ad("T1", "text")]}))
    yt = tmp_path / "yt"
    monkeypatch.setattr(enrich_video_titles, "RACES", {"race": type("Race", (), {"out_dir": out})()})
    monkeypatch.setattr(enrich_video_titles, "YT_DIR", yt)
    monkeypatch.setattr(enrich_video_titles, "VIDEO_IDS", yt / "video_ids.json")
    monkeypatch.setattr(enrich_video_titles, "OEMBED_DIR", yt / "oembed")
    return ads_path, yt


def test_cache_hit_patches_title_and_source_url(setup: tuple[Path, Path]) -> None:
    ads_path, yt = setup
    (yt / "video_ids.json").parent.mkdir(parents=True)
    (yt / "video_ids.json").write_text(json.dumps({"A1": "video-one"}))
    (yt / "oembed").mkdir()
    (yt / "oembed" / "video-one.json").write_text(
        json.dumps(
            {
                "video_id": "video-one",
                "ad_id": "A1",
                "title": "A Title",
                "author_name": "A Channel",
                "fetched_at": "now",
            }
        )
    )

    assert (
        enrich_video_titles.run(
            "race", limit=1, sleep_seconds=0, resolver=lambda *_: pytest.fail("resolver should not run")
        )
        == 0
    )
    ad = json.loads(ads_path.read_text())["ads"][0]
    assert ad["video"] == {
        "video_id": "video-one",
        "title": "A Title",
        "channel": "A Channel",
        "source_url": "https://www.youtube.com/watch?v=video-one",
        "fetched_at": "now",
    }


def test_404_caches_error_and_leaves_video_none(setup: tuple[Path, Path]) -> None:
    ads_path, yt = setup
    calls: list[str] = []

    def fetcher(video_id: str, ad_id: str, session: object) -> dict[str, object]:
        calls.append(video_id)
        return {"video_id": video_id, "ad_id": ad_id, "error": "404", "fetched_at": "now"}

    enrich_video_titles.run(
        "race",
        only="A2",
        sleep_seconds=0,
        resolver=lambda advertiser, ad_id, session: "missing-video",
        fetcher=fetcher,
    )
    assert calls == ["missing-video"]
    assert json.loads(ads_path.read_text())["ads"][0]["video"] is None
    assert json.loads((yt / "oembed" / "missing-video.json").read_text())["error"] == "404"


def test_text_ad_is_not_fetched(setup: tuple[Path, Path]) -> None:
    ads_path, _ = setup
    calls: list[str] = []
    enrich_video_titles.run(
        "race",
        only="T1",
        sleep_seconds=0,
        resolver=lambda advertiser, ad_id, session: calls.append(ad_id) or "video",
        fetcher=lambda *_: pytest.fail("text ads should not fetch"),
    )
    assert calls == []
    assert json.loads(ads_path.read_text())["ads"][2]["video"] is None


def test_rerun_uses_oembed_cache(setup: tuple[Path, Path]) -> None:
    ads_path, yt = setup
    fetch_calls: list[str] = []

    def fetcher(video_id: str, ad_id: str, session: object) -> dict[str, object]:
        fetch_calls.append(video_id)
        return {"video_id": video_id, "ad_id": ad_id, "title": "Cached", "author_name": "", "fetched_at": "now"}

    def resolver(advertiser: str, ad_id: str, session: object) -> str:
        return f"video-{ad_id}"

    enrich_video_titles.run("race", sleep_seconds=0, resolver=resolver, fetcher=fetcher)
    enrich_video_titles.run(
        "race",
        sleep_seconds=0,
        resolver=lambda *_: pytest.fail("resolver should use video-id cache"),
        fetcher=lambda *_: pytest.fail("fetcher should use oEmbed cache"),
    )
    assert fetch_calls == ["video-A1", "video-A2"]
    assert all(
        ad["video"] is None or ad["video"]["title"] == "Cached" for ad in json.loads(ads_path.read_text())["ads"]
    )


def test_rate_limit_retries_then_patches_title(setup: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    ads_path, yt = setup
    sleeps: list[float] = []
    attempts = 0

    def resolver(advertiser: str, ad_id: str, session: object) -> str:
        nonlocal attempts
        attempts += 1
        if attempts <= 3:
            raise LookupRateLimited
        return "video-retried"

    monkeypatch.setattr(ads_creatives.time, "sleep", sleeps.append)
    result = enrich_video_titles.run(
        "race",
        limit=1,
        sleep_seconds=0,
        resolver=resolver,
        fetcher=lambda video_id, ad_id, session: {
            "video_id": video_id,
            "ad_id": ad_id,
            "title": "Retried title",
            "author_name": "",
            "fetched_at": "now",
        },
    )
    assert result == 0
    assert sleeps == [10, 30, 90]
    assert json.loads((yt / "video_ids.json").read_text())["A1"] == "video-retried"
    assert json.loads(ads_path.read_text())["ads"][0]["video"]["title"] == "Retried title"


def test_rate_limit_stops_without_poisoning_cache(setup: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    ads_path, yt = setup
    sleeps: list[float] = []

    def resolver(advertiser: str, ad_id: str, session: object) -> str:
        raise LookupRateLimited

    monkeypatch.setattr(ads_creatives.time, "sleep", sleeps.append)
    result = enrich_video_titles.run(
        "race",
        limit=1,
        sleep_seconds=0,
        resolver=resolver,
        fetcher=lambda *_: pytest.fail("oEmbed should not run"),
    )
    assert result == 2
    assert sleeps == [10, 30, 90]
    assert not (yt / "video_ids.json").exists()
    assert json.loads(ads_path.read_text())["ads"][0]["video"] is None
