"""Advertiser-name -> FEC committee matching for the ads stage.

Matching is exact on a normalized name (upper-case, punctuation stripped, whitespace collapsed, trailing corporate
suffixes dropped). Nothing fuzzy: an advertiser either normalizes to a known alias ("auto") or it doesn't ("none").
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_PUNCT = re.compile(r"[^A-Z0-9 ]+")
_SPACES = re.compile(r"\s+")
_TRAILING_SUFFIX = re.compile(r"\b(INC|INCORPORATED|LLC|CORP|CO)$")


def normalize_name(name: str) -> str:
    s = _PUNCT.sub(" ", name.upper().replace("&", " AND "))
    s = _SPACES.sub(" ", s).strip()
    s = _TRAILING_SUFFIX.sub("", s).strip()
    return s


@dataclass(frozen=True)
class SeedCommittee:
    committee_id: str
    aliases: tuple[str, ...]
    candidate_id: str | None = None  # set for candidate principal committees only


# Hand-verified against the FEC committee master (cm24) and present in the Google advertiser table on 2026-09-05.
# "Pennsylvania Values" was in the requested seed list but has neither an FEC committee nor a Google advertiser
# record, so it is omitted.
SEED_COMMITTEES: tuple[SeedCommittee, ...] = (
    SeedCommittee("C00431056", ("Bob Casey for Senate", "Bob Casey for Senate Inc"), candidate_id="S6PA00217"),
    SeedCommittee("C00851980", ("Friends of Dave McCormick",), candidate_id="S2PA00661"),
    SeedCommittee(
        "C00800623", ("Dave McCormick for US Senate", "Dave McCormick for U.S. Senate"), candidate_id="S2PA00661"
    ),
    SeedCommittee("C00571703", ("Senate Leadership Fund",)),
    SeedCommittee("C00849489", ("Keystone Renewal PAC",)),
    SeedCommittee("C00484642", ("Senate Majority PAC", "SMP")),
    SeedCommittee("C00865444", ("WinSenate",)),
    SeedCommittee("C00666388", ("Duty and Country",)),
    SeedCommittee("C00687103", ("Americans for Prosperity Action", "Americans for Prosperity Action Inc")),
    SeedCommittee("C30003529", ("Keystone Prosperity PAC",)),
    SeedCommittee("C00487470", ("Club for Growth Action",)),
    SeedCommittee("C00848440", ("Protect Progress",)),
    SeedCommittee("C00835959", ("Fairshake",)),
    SeedCommittee("C00836221", ("Defend American Jobs",)),
    SeedCommittee("C00027466", ("NRSC", "National Republican Senatorial Committee")),
    SeedCommittee("C00042366", ("DSCC", "Democratic Senatorial Campaign Committee")),
    SeedCommittee("C00486845", ("LCV Victory Fund",)),
    SeedCommittee("C00657866", ("Protect Freedom PAC", "Protect Freedom Political Action Committee")),
)


@dataclass(frozen=True)
class Match:
    committee_id: str | None
    confidence: str  # "auto" | "none"
    candidate_id: str | None


NO_MATCH = Match(None, "none", None)


class AdvertiserMatcher:
    """Exact normalized-name lookup over seed committees plus names lifted from ledger.json."""

    def __init__(self, seeds: tuple[SeedCommittee, ...] = SEED_COMMITTEES) -> None:
        self._by_name: dict[str, Match] = {}
        self._candidate_committees: dict[str, str] = {}
        for seed in seeds:
            for alias in seed.aliases:
                self.add_alias(alias, seed.committee_id, seed.candidate_id)

    def add_alias(self, name: str, committee_id: str, candidate_id: str | None = None, override: bool = True) -> None:
        """Register `name` -> committee. With override=False an existing (hand-verified seed) entry wins."""
        key = normalize_name(name)
        if not key or (not override and key in self._by_name):
            return
        if candidate_id:
            self._candidate_committees[committee_id] = candidate_id
        candidate = candidate_id or self._candidate_committees.get(committee_id)
        self._by_name[key] = Match(committee_id, "auto", candidate)

    def match(self, *names: str | None) -> Match:
        """First exact hit across the given strings (advertiser name, declared name, ...) wins."""
        for name in names:
            if name:
                hit = self._by_name.get(normalize_name(name))
                if hit:
                    return hit
        return NO_MATCH

    def is_candidate_committee(self, committee_id: str | None) -> bool:
        return committee_id is not None and committee_id in self._candidate_committees


def mentions_candidate(name: str, surnames: tuple[str, ...]) -> bool:
    n = normalize_name(name)
    return any(re.search(rf"\b{re.escape(s.upper())}\b", n) for s in surnames)
