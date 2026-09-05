"""Hand-verified ad -> committee links, merged into ads.json by the ads stage.

gotham/data/ad_verifications.json is maintained by a person: for each entry someone opened the Google Ads
Transparency page, read the advertiser's legal name / FEC ID, and confirmed on fec.gov that the committee with that
exact ID filed independent expenditures in this race. The pipeline never writes that file. Merging is additive: every
ad gets a `verification` block; only ads whose (ad_id, entity_id) pair appears in the file and whose name match
points at the same committee become "verified". A verification that names a different committee than the name match
is a contradiction and is rejected loudly rather than silently overriding either side.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

VERIFICATIONS_PATH = Path(__file__).parent / "data" / "ad_verifications.json"


@dataclass(frozen=True)
class AdVerification:
    ad_id: str
    entity_id: str
    verified_at: str
    evidence_urls: tuple[str, ...]
    note: str


def load_verifications(path: Path = VERIFICATIONS_PATH) -> dict[str, AdVerification]:
    raw = json.loads(path.read_text())
    out: dict[str, AdVerification] = {}
    for v in raw["verifications"]:
        if v["verified_by"] != "human":
            raise ValueError(f"{v['ad_id']}: verified_by must be 'human'")
        hosts = {urlparse(u).hostname for u in v["evidence_urls"]}
        if not {"adstransparency.google.com", "www.fec.gov"} <= hosts:
            raise ValueError(f"{v['ad_id']}: need a transparency URL and a fec.gov URL")
        if v["ad_id"] in out:
            raise ValueError(f"{v['ad_id']}: duplicate verification")
        out[v["ad_id"]] = AdVerification(
            ad_id=v["ad_id"],
            entity_id=v["entity_id"],
            verified_at=v["verified_at"],
            evidence_urls=tuple(v["evidence_urls"]),
            note=v["note"],
        )
    return out


def unverified() -> dict[str, object]:
    return {"status": "unverified", "evidence_urls": [], "verified_at": None}


def apply_verifications(ads: list[dict[str, object]], verifications: dict[str, AdVerification]) -> int:
    """Attach `verification` to every ad in place; returns the number marked verified."""
    n = 0
    for ad in ads:
        ad_id = str(ad["ad_id"])
        v = verifications.get(ad_id)
        if v is None:
            ad["verification"] = unverified()
            continue
        if ad["matched_entity_id"] != v.entity_id:
            raise ValueError(f"{ad_id}: verification says {v.entity_id} but name match says {ad['matched_entity_id']}")
        ad["verification"] = {
            "status": "verified",
            "evidence_urls": list(v.evidence_urls),
            "verified_at": v.verified_at,
        }
        n += 1
    return n
