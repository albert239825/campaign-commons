"""search.json over a synthetic data/out tree: hrefs follow the web routes, (kind, id) unique, vendors optional."""

import json
import re
import shutil
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from gotham.config import ROOT
from gotham.search import (
    MAX_ALIASES,
    build_index,
    build_items,
    cap_aliases,
    natural_order,
    write_index,
)

FIXTURES = Path(__file__).parent / "fixtures"
RACE = "pa-sen-2024"
CASEY, MCCORMICK = "S6PA00217", "S2PA00661"
SLF, ACTBLUE = "C00571703", "C00401224"

ROUTE_PATTERNS = {
    "race": re.compile(r"^/races/[a-z0-9-]+$"),
    "candidate": re.compile(r"^/races/[a-z0-9-]+(/candidates/[A-Z0-9]+)?$"),  # race page when no dossier
    "committee": re.compile(r"^/races/[a-z0-9-]+/entities/[A-Z0-9]+$"),
    "organization": re.compile(r"^/races/[a-z0-9-]+/(entities|donors)/[A-Za-z0-9_-]+$"),
    "donor": re.compile(r"^/races/[a-z0-9-]+/donors/[A-Za-z0-9_-]+$"),
    "vendor": re.compile(r"^/races/[a-z0-9-]+/vendors/vendor:[a-z0-9-]+$"),
}


def races_json(with_stub: bool = True) -> dict:
    races = [
        {
            "race_id": RACE,
            "label": "Pennsylvania · U.S. Senate · 2024",
            "cycle": 2024,
            "state": "PA",
            "office": "S",
            "election_date": "2024-11-05",
            "status": "complete",
            "candidates": [
                {
                    "candidate_id": CASEY,
                    "name": "Bob Casey",
                    "party": "DEM",
                    "incumbent": True,
                    "principal_committee_id": "C00431056",
                },
                {
                    "candidate_id": MCCORMICK,
                    "name": "Dave McCormick",
                    "party": "REP",
                    "incumbent": False,
                    "principal_committee_id": "C00851980",
                },
            ],
            "totals": {"campaign_receipts": 90.0, "outside_spending": 230.0, "outside_share": 0.72},
            "traceability_score": 0.7,
            "data_status": "real",
        }
    ]
    if with_stub:
        races.append(
            {
                "race_id": "tx-sen-2026",
                "label": "Texas · U.S. Senate · 2026",
                "cycle": 2026,
                "state": "TX",
                "office": "S",
                "election_date": "2026-11-03",
                "status": "stub",
                "candidates": [],
                "totals": {"campaign_receipts": 0, "outside_spending": 0, "outside_share": 0},
                "traceability_score": None,
                "data_status": "mock",
            }
        )
    return {"generated_at": "2026-09-05T00:00:00+00:00", "races": races}


def ledger_json() -> dict:
    def cand(cid: str, receipts: float, outside: float) -> dict:
        return {"candidate_id": cid, "campaign": {"receipts": receipts}, "outside": {"total": outside}}

    return {"race_id": RACE, "candidates": [cand(CASEY, 60.0, 130.0), cand(MCCORMICK, 30.0, 100.0)]}


def entity_json(entity_id: str, name: str, kind: str, label: str, receipts: float, ies: float, chain: bool) -> dict:
    return {
        "entity_id": entity_id,
        "race_id": RACE,
        "kind": kind,
        "name": name,
        "aliases": ["SLF"] if entity_id == SLF else [],
        "committee_type_label": label,
        "totals": {"receipts": receipts, "disbursements": 1.0, "independent_expenditures": ies},
        "has_chain": chain,
    }


def donor_json(donor_id: str, name: str, kind: str, given: float) -> dict:
    key = re.sub(r"[^A-Za-z0-9_-]", "-", donor_id)
    return {"donor_id": donor_id, "donor_key": key, "name": name, "kind": kind, "race_id": RACE, "total_given": given}


def write(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


@pytest.fixture
def out(tmp_path: Path) -> Path:
    """A data/out tree: races.json (+ a stub race with no directory), one real race with ledger, entities, donors, dossiers."""
    root = tmp_path / "out"
    write(root / "races.json", races_json())
    write(root / RACE / "ledger.json", ledger_json())
    write(root / RACE / "dossiers" / f"{CASEY}.json", {"candidate_id": CASEY})
    write(
        root / RACE / "entities" / f"{SLF}.json",
        entity_json(SLF, "SENATE LEADERSHIP FUND", "committee", "Super PAC", 298.0, 211.0, True),
    )
    write(
        root / RACE / "entities" / f"{ACTBLUE}.json",
        entity_json(ACTBLUE, "ACTBLUE", "conduit", "Hybrid PAC", 50.0, 0.0, False),
    )
    write(
        root / RACE / "entities" / "C00000001.json",
        entity_json("C00000001", "TINY PAC", "committee", "PAC", 0.0, 0.0, False),
    )
    write(root / RACE / "entities" / "ind:X.json", entity_json("ind:X", "SOMEONE", "individual", "", 5.0, 0.0, False))
    write(
        root / RACE / "donors" / "ind-ADELSON_MIRIAM-89145.json",
        donor_json("ind:ADELSON_MIRIAM|89145", "ADELSON, MIRIAM", "individual", 25.0),
    )
    write(
        root / RACE / "donors" / "org-CWA.json",
        donor_json("org:CWA", "COMMUNICATIONS WORKERS OF AMERICA", "organization", 16.0),
    )
    return root


def by_kind(items: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for it in items:
        out.setdefault(it["kind"], []).append(it)
    return out


def test_items_cover_every_page_kind_and_hrefs_follow_routes(out: Path) -> None:
    items = build_items(out)
    kinds = by_kind(items)
    assert set(kinds) == {"race", "candidate", "committee", "donor", "organization"}
    assert len(kinds["race"]) == 1, "stub race without a data directory has no page and is not indexed"
    assert len(kinds["committee"]) == 3, "committees and the conduit; the individual entity is not a page target"
    assert [d["id"] for d in kinds["donor"]] == ["ind:ADELSON_MIRIAM|89145"]
    assert [o["id"] for o in kinds["organization"]] == ["org:CWA"]
    for it in items:
        assert ROUTE_PATTERNS[it["kind"]].match(it["href"]), (it["kind"], it["href"])
        assert isinstance(it["weight"], int) and it["weight"] >= 0
        assert it["race_id"] == RACE
        assert len(it["aliases"]) <= MAX_ALIASES
        assert it["label"].lower() not in {a.lower() for a in it["aliases"]}


def test_no_duplicate_kind_id_and_sorted_by_weight(out: Path) -> None:
    items = build_items(out)
    keys = [(it["kind"], it["id"]) for it in items]
    assert len(keys) == len(set(keys))
    weights = [it["weight"] for it in items]
    assert weights == sorted(weights, reverse=True)
    assert items[0]["kind"] == "committee" and items[0]["id"] == SLF  # 298 + 211 beats race 90 + 230


def test_candidate_links_to_dossier_only_when_it_exists(out: Path) -> None:
    cands = {c["id"]: c for c in by_kind(build_items(out))["candidate"]}
    assert cands[CASEY]["href"] == f"/races/{RACE}/candidates/{CASEY}"
    assert cands[MCCORMICK]["href"] == f"/races/{RACE}"
    assert cands[CASEY]["aliases"] == ["Casey", "Sen. Casey", CASEY, "C00431056"]
    assert cands[MCCORMICK]["aliases"] == ["McCormick", MCCORMICK, "C00851980"]
    assert cands[CASEY]["sublabel"] == "Democrat · incumbent"
    assert cands[CASEY]["weight"] == 190.0 and cands[MCCORMICK]["weight"] == 130.0


def test_committee_row_carries_fec_id_alias_chain_marker_and_dollar_weight(out: Path) -> None:
    slf = next(c for c in by_kind(build_items(out))["committee"] if c["id"] == SLF)
    assert slf["aliases"] == ["SLF", SLF]
    assert slf["sublabel"] == "Super PAC · chain"
    assert slf["weight"] == 298.0 + 211.0
    tiny = next(c for c in by_kind(build_items(out))["committee"] if c["id"] == "C00000001")
    assert tiny["weight"] == 1.0, "falls back to the largest available total (disbursements)"


def test_donor_rows_get_first_last_alias_and_zip(out: Path) -> None:
    donor = by_kind(build_items(out))["donor"][0]
    assert donor["aliases"] == ["MIRIAM ADELSON"]
    assert donor["sublabel"] == "Individual donor · ZIP 89145 · $25 itemized"
    assert donor["href"] == f"/races/{RACE}/donors/ind-ADELSON_MIRIAM-89145"
    org = by_kind(build_items(out))["organization"][0]
    assert org["aliases"] == [] and org["sublabel"] == "Organization donor · $16 itemized"


def test_vendors_indexed_when_file_exists_and_skipped_cleanly_when_missing(
    out: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    without = build_items(out)
    assert "vendor" not in by_kind(without)
    assert "vendors.json not present" in capsys.readouterr().out

    shutil.copy(FIXTURES / "vendors.json", out / RACE / "vendors.json")
    vendors = by_kind(build_items(out))["vendor"]
    assert [v["id"] for v in vendors] == ["vendor:waterfront-strategies", "vendor:mentzer-media"]
    wf = vendors[0]
    assert wf["href"] == f"/races/{RACE}/vendors/vendor:waterfront-strategies"
    assert wf["aliases"] == ["WATERFRONT STRATEGIES, INC.", "Waterfront Strategies Inc"], (
        "raw spellings, minus the label itself"
    )
    assert wf["sublabel"] == "Vendor · tv · $1.5M paid"
    assert wf["weight"] == 1500000.0
    assert len(without) + 2 == len(build_items(out))


def test_races_json_only_yields_race_and_candidate_items(tmp_path: Path) -> None:
    root = tmp_path / "out"
    write(root / "races.json", races_json(with_stub=False))
    (root / RACE).mkdir()
    items = build_items(root)
    assert [it["kind"] for it in items] == ["race", "candidate", "candidate"]
    assert all(it["href"] == f"/races/{RACE}" for it in items), "no dossiers, so candidates fall back to the race page"
    assert [it["weight"] for it in items] == [320, 0, 0]


def test_missing_races_json_yields_empty_index(tmp_path: Path) -> None:
    assert build_items(tmp_path) == []


def test_written_index_validates_against_contract_and_is_compact(out: Path, tmp_path: Path) -> None:
    shutil.copy(FIXTURES / "vendors.json", out / RACE / "vendors.json")
    index = build_index(out)
    assert index["data_status"] == "real"
    target = tmp_path / "search.json"
    size = write_index(index, target)
    text = target.read_text()
    assert size == len(text.encode("utf-8")) and "\n  " not in text, "no indentation: the browser fetches this file"
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "search.schema.json").read_text())
    assert not list(Draft7Validator(schema).iter_errors(json.loads(text)))


def test_vendor_fixture_validates_against_vendors_contract() -> None:
    schema = json.loads((ROOT / "contracts" / "jsonschema" / "vendors.schema.json").read_text())
    assert not list(Draft7Validator(schema).iter_errors(json.loads((FIXTURES / "vendors.json").read_text())))


def test_alias_helpers() -> None:
    assert natural_order("ADELSON, MIRIAM") == "MIRIAM ADELSON"
    assert natural_order("SMITH, JOHN A.") == "JOHN A. SMITH"
    assert natural_order("COINBASE") == "COINBASE"
    assert cap_aliases("Bob Casey", ["bob casey", " Casey ", "Casey", "", "Sen. Casey"]) == ["Casey", "Sen. Casey"]
    assert len(cap_aliases("x", [str(i) for i in range(20)])) == MAX_ALIASES
