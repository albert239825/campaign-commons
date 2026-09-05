"""Classify Schedule A `ENTITY_TP='ORG'` contributors by what their name says about their own funding.

FEC filings name the organization but say nothing about what it is. Without an IRS lookup the class has to come from
the name (D-38), and the classifier is deliberately conservative: only unions and businesses are called disclosed.

  union      membership dues fund the treasury; the giver is the source                -> disclosed
  business   a company giving from its own revenue; the giver is the source             -> disclosed
  llc        LLCs / LPs / trusts: the owner behind the name is not on file anywhere      -> dark
  nonprofit  advocacy-style names (Action, Fund, Alliance, Forward, ...), 501(c)(4)-like -> dark
  unknown    no signal either way                                                        -> dark

Corporate suffixes lose to advocacy words: "LEAGUE OF CONSERVATION VOTERS, INC." and "EVERYTOWN FOR GUN SAFETY
ACTION FUND INC" are 501(c)(4)s that happen to be incorporated, so "INC" alone never makes a business.
"""

from __future__ import annotations

import re

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
    r"\b(ACTION|FUND|ALLIANCE|COALITION|COMMITTEE|PROJECT|NETWORK|VOTERS?|VOTE|LEAGUE|INSTITUTE|ASSOCIATION|SOCIETY|"
    r"FOUNDATION|CENTER|POLICIES|POLICY|FORWARD|FUTURE|VICTORY|MAJORITY|PROSPERITY|FREEDOM|LIBERTY|PATRIOTS?|"
    r"AMERICANS?|AMERICA|CITIZENS|VALUES|FAMILIES|PRIORITIES|SECURING|GREATNESS|RESTORATION|ADVOCACY|ADVOCATES?|"
    r"CONSERVATION|CLIMATE|ENVIRONMENTAL|DEFENSE|IMPACT|EVIDENCE|TURNOUT|ENGAGEMENT|527|PAC|ISSUES|CHAMBER)\b"
)


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9&' .-]", " ", name.upper())).strip()


def classify_organization(name: str) -> str:
    n = _norm(name)
    if _UNION.search(n):
        return "union"
    if _NONPROFIT.search(n):
        return "nonprofit"
    if _LLC.search(n):
        return "llc"
    if _BUSINESS.search(n):
        return "business"
    return "unknown"


def organization_visibility(org_class: str) -> str:
    return "disclosed" if org_class in DISCLOSED_CLASSES else "dark"
