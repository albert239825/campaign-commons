"""Paths, race definitions, and FEC constants shared by every pipeline stage."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DATA = ROOT / "data"
RAW = DATA / "raw"  # gitignored: full FEC bulk downloads
FEC_FILTERED = DATA / "fec"  # committed: filtered Parquet per race
OUT = DATA / "out"  # committed: JSON the web app reads
DUCKDB_PATH = DATA / "gotham.duckdb"  # gitignored

FEC_API_KEY = os.environ.get("FEC_API_KEY", "DEMO_KEY")
CONGRESS_GOV_API_KEY = os.environ.get("CONGRESS_GOV_API_KEY", "DEMO_KEY")

FEC_API = "https://api.open.fec.gov/v1"
FEC_BULK = "https://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com/bulk-downloads"
FEC_WEB = "https://www.fec.gov/data"


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    name: str
    party: str
    incumbent: bool
    principal_committee_id: str
    bioguide_id: str | None = None
    result: str | None = None


@dataclass(frozen=True)
class Race:
    race_id: str
    label: str
    cycle: int
    state: str
    office: str
    election_date: str
    status: str
    candidates: tuple[Candidate, ...] = field(default_factory=tuple)

    @property
    def out_dir(self) -> Path:
        return OUT / self.race_id

    @property
    def fec_dir(self) -> Path:
        return FEC_FILTERED / self.race_id


PA_SEN_2024 = Race(
    race_id="pa-sen-2024",
    label="Pennsylvania · U.S. Senate · 2024",
    cycle=2024,
    state="PA",
    office="S",
    election_date="2024-11-05",
    status="complete",
    candidates=(
        Candidate("S6PA00217", "Bob Casey", "DEM", True, "C00431056", bioguide_id="C001070", result="lost"),
        # NOTE: McCormick has two committees in the master file (C00800623 "DAVE MCCORMICK FOR US SENATE" from
        # 2022, C00851980 "FRIENDS OF DAVE MCCORMICK" for 2024). Ingest stage must confirm which is the 2024
        # principal (cn.txt CAND_PCC) and record the decision in docs/DECISIONS.md.
        Candidate("S2PA00661", "Dave McCormick", "REP", False, "C00851980", result="won"),
    ),
)

TX_SEN_2026 = Race(
    race_id="tx-sen-2026",
    label="Texas · U.S. Senate · 2026",
    cycle=2026,
    state="TX",
    office="S",
    election_date="2026-11-03",
    status="stub",
)

RACES: dict[str, Race] = {r.race_id: r for r in (PA_SEN_2024, TX_SEN_2026)}

# --- FEC transaction-type semantics -----------------------------------------------------------
# https://www.fec.gov/campaign-finance-data/transaction-type-code-descriptions/
# Receipts (Schedule A side)
TT_INDIVIDUAL = {"15", "15E", "15C", "10", "11", "30", "31", "32"}
TT_EARMARKED_THROUGH_CONDUIT = {"15E"}  # attribute to individual; conduit is a pipe
TT_COMMITTEE_TO_COMMITTEE_RECEIPT = {
    "18G",
    "18K",
    "18J",
    "18H",
    "18U",
    "30K",
    "31K",
    "32K",
    "12",
    "16C",
    "16F",
    "16G",
    "16R",
}
# Disbursements (Schedule B side) — dedupe against the receiver's Schedule A
TT_COMMITTEE_TO_COMMITTEE_DISB = {"22Z", "22Y", "24G", "24K", "24Z", "24R", "24U", "24C", "24H", "24F", "24I", "24T"}
# Independent expenditures (targeting edges, NOT money edges)
TT_IE = {"24A", "24E", "24N"}
TT_IE_SUPPORT = {"24E"}
TT_IE_OPPOSE = {"24A"}
# Conduit / earmark pass-through on the conduit's own filings
TT_CONDUIT_PASSTHROUGH = {"24I", "24T"}

KNOWN_CONDUITS = {
    "C00401224": "ActBlue",
    "C00694323": "WinRed",
}

# Committee types whose donors are legally disclosed to the FEC
DISCLOSING_COMMITTEE_TYPES = {"H", "S", "P", "X", "Y", "Z", "N", "Q", "O", "U", "V", "W", "D"}

# Chain traversal parameters (see docs/DECISIONS.md)
CHAIN_MAX_DEPTH = 8
CHAIN_MATERIALITY = 0.01  # prune inbound edges under 1% of receiver's receipts into an aggregate node
