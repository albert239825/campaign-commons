"""Classify Schedule A `ENTITY_TP='ORG'` contributors by what their name says about their own funding.

FEC filings name the organization but say nothing about what it is. Without an IRS lookup the class has to come from
the name (D-38), and the classifier is deliberately conservative: only unions and businesses are called disclosed.

  union      membership dues fund the treasury; the giver is the source                -> disclosed
  business   a company giving from its own revenue; the giver is the source             -> disclosed
  llc        LLCs / LPs / trusts: the owner behind the name is not on file anywhere      -> dark
  nonprofit  advocacy-style names (Action, Fund, Alliance, Forward, ...), 501(c)(4)-like -> dark
  unknown    no signal either way                                                        -> dark

Corporate suffixes lose to advocacy words: "LEAGUE OF CONSERVATION VOTERS, INC." and "EVERYTOWN FOR GUN SAFETY
ACTION FUND INC" are 501(c)(4)s that happen to be incorporated, so "INC" alone never makes a business. Generic
tokens that also appear in company and committee names (PAC, COMMITTEE, FUND, ACTION, AMERICA...) only decide the
class when nothing else does (C-31).

Before any of this, a name that is exactly a registered committee's name is a committee, not an organization: filers
sometimes report a PAC's transfer on Schedule A as `ENTITY_TP='ORG'`, and calling that dark would contradict the
sender's own public filing (C-30). `committee_name_index` / `match_committee` do that lookup.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable

from .config import DATA

ORGANIZATION_CLASSES = ("union", "business", "llc", "nonprofit", "unknown")
DISCLOSED_CLASSES = {"union", "business"}

_UNION = re.compile(
    r"\b(UNION|BROTHERHOOD|WORKERS|LABORERS|CARPENTERS|TEAMSTERS|AFL[- ]?CIO|AFSCME|SEIU|IBEW|UAW|UFCW|"
    r"UNITE HERE|AFT|NEA|IUOE|OPERATING ENGINEERS|PIPEFITTERS|PLUMBERS|IRONWORKERS|STEELWORKERS|MACHINISTS|"
    r"LETTER CARRIERS|FIREFIGHTERS|SOLIDARITY|LOCAL \d+)\b"
)
_LLC = re.compile(r"\b(LLC|L\.L\.C\.|LP|L\.P\.|LLP|TRUST|HOLDINGS)\b")
_BUSINESS = re.compile(
    r"\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|PLC|BANK|CASINO|INDUSTRIES|ENTERPRISES|PARTNERS|"
    r"CAPITAL|LABS|SERVICES|GROUP|TECHNOLOGIES|PETROLEUM|ENERGY|RESOURCES|PHARMACEUTICALS|VENTURES|MARKETING|"
    r"MANAGEMENT|TRIBE|NATION OF|RANCHERIA|CRYPTO|EXCHANGE)\b"
)
_NONPROFIT = re.compile(
    r"\b(ALLIANCE|COALITION|PROJECT|NETWORK|VOTERS?|VOTE|LEAGUE|INSTITUTE|ASSOCIATION|SOCIETY|"
    r"FOUNDATION|CENTER|POLICIES|POLICY|FORWARD|FUTURE|MAJORITY|PROSPERITY|FREEDOM|LIBERTY|PATRIOTS?|"
    r"CITIZENS|VALUES|FAMILIES|PRIORITIES|SECURING|GREATNESS|ADVOCACY|ADVOCATES?|"
    r"CONSERVATION|CLIMATE|ENVIRONMENTAL|DEFENSE|IMPACT|EVIDENCE|TURNOUT|ENGAGEMENT|ISSUES|501\(C\)|ACTION FUND)\b"
)
_NONPROFIT_WEAK = re.compile(r"\b(ACTION|FUND|COMMITTEE|VICTORY|AMERICANS?|AMERICA|RESTORATION|527|PAC|CHAMBER)\b")


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9&' .-]", " ", name.upper())).strip()


def load_org_overrides(race_id: str) -> dict[str, str]:
    """Load model classifications first, then let hand-verified rows override them."""
    overrides: dict[str, str] = {}
    for path in (
        DATA / "hand" / race_id / "org_classes_model.json",
        DATA / "hand" / race_id / "org_classes.json",
    ):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for row in payload.get("classes", []) if isinstance(payload, dict) else []:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            org_class = row.get("org_class")
            if isinstance(name, str) and org_class in ORGANIZATION_CLASSES:
                overrides[_norm(name)] = org_class
    return overrides


def classify_organization(name: str, overrides: dict[str, str] | None = None) -> str:
    n = _norm(name)
    if overrides and n in overrides:
        return overrides[n]
    if _UNION.search(n):
        return "union"
    if _NONPROFIT.search(n):
        return "nonprofit"
    if _LLC.search(n):
        return "llc"
    if _BUSINESS.search(n):
        return "business"
    if _NONPROFIT_WEAK.search(n):
        return "nonprofit"
    return "unknown"


def committee_name_index(committees: Iterable[tuple[str, str]]) -> dict[str, str]:
    """normalized committee name -> committee id, for names that belong to exactly one committee."""
    seen: dict[str, str | None] = {}
    for cid, name in committees:
        key = _norm(name or "")
        if not key:
            continue
        seen[key] = None if key in seen and seen[key] != cid else cid
    return {k: v for k, v in seen.items() if v is not None}


def match_committee(name: str, index: dict[str, str]) -> str | None:
    return index.get(_norm(name))


def organization_visibility(org_class: str) -> str:
    return "disclosed" if org_class in DISCLOSED_CLASSES else "dark"
