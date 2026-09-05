import json
from pathlib import Path

import pytest

from gotham.ads_verify import VERIFICATIONS_PATH, AdVerification, apply_verifications, load_verifications


def _ad(ad_id: str, entity: str | None) -> dict[str, object]:
    return {"ad_id": ad_id, "matched_entity_id": entity, "match_confidence": "auto" if entity else "none"}


def _verification(ad_id: str, entity: str) -> AdVerification:
    return AdVerification(
        ad_id=ad_id,
        entity_id=entity,
        verified_at="2026-09-05T14:05:00Z",
        evidence_urls=("https://adstransparency.google.com/x", "https://www.fec.gov/data/committee/C1/?cycle=2024"),
        note="checked",
    )


def test_apply_marks_listed_ads_verified_and_others_unverified() -> None:
    ads = [_ad("CR1", "C1"), _ad("CR2", "C2"), _ad("CR3", None)]
    n = apply_verifications(ads, {"CR1": _verification("CR1", "C1")})
    assert n == 1
    assert ads[0]["verification"] == {
        "status": "verified",
        "evidence_urls": ["https://adstransparency.google.com/x", "https://www.fec.gov/data/committee/C1/?cycle=2024"],
        "verified_at": "2026-09-05T14:05:00Z",
    }
    for ad in ads[1:]:
        assert ad["verification"] == {"status": "unverified", "evidence_urls": [], "verified_at": None}
    # the name match is untouched either way
    assert ads[1]["matched_entity_id"] == "C2" and ads[1]["match_confidence"] == "auto"


def test_apply_rejects_verification_that_disagrees_with_name_match() -> None:
    with pytest.raises(ValueError, match="CR1"):
        apply_verifications([_ad("CR1", "C9")], {"CR1": _verification("CR1", "C1")})


def test_load_rejects_non_human_or_thin_evidence(tmp_path: Path) -> None:
    good = {
        "ad_id": "CR1",
        "entity_id": "C1",
        "verified_at": "2026-09-05T00:00:00Z",
        "verified_by": "human",
        "evidence_urls": ["https://adstransparency.google.com/x", "https://www.fec.gov/y"],
        "note": "ok",
    }
    p = tmp_path / "v.json"
    p.write_text(json.dumps({"verifications": [good]}))
    assert load_verifications(p)["CR1"].entity_id == "C1"

    p.write_text(json.dumps({"verifications": [{**good, "verified_by": "pipeline"}]}))
    with pytest.raises(ValueError, match="human"):
        load_verifications(p)
    p.write_text(json.dumps({"verifications": [{**good, "evidence_urls": ["https://www.fec.gov/y"]}]}))
    with pytest.raises(ValueError, match="fec.gov"):
        load_verifications(p)
    p.write_text(json.dumps({"verifications": [good, good]}))
    with pytest.raises(ValueError, match="duplicate"):
        load_verifications(p)


def test_checked_in_file_names_one_ad_per_required_committee() -> None:
    vs = load_verifications(VERIFICATIONS_PATH)
    assert sorted(v.entity_id for v in vs.values()) == ["C00042366", "C00571703", "C00687103", "C00849489", "C00865444"]
    for v in vs.values():
        assert any("adstransparency.google.com" in u for u in v.evidence_urls)
        assert any(u.startswith(f"https://www.fec.gov/data/committee/{v.entity_id}/") for u in v.evidence_urls)
