"""
Generate MOCK data/out/ for PA Senate 2024 so the frontend can be built before the
real pipeline lands. Every file is stamped data_status="mock". Committee IDs are real
FEC IDs; dollar amounts are plausible round numbers, NOT real figures.

    python pipeline/scripts/make_mock_data.py [--out DIR]

Default --out is data/out. Once real stages have landed, only run this with --out pointing
elsewhere (the test suite does) or you will clobber real artifacts.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
RACE = "pa-sen-2024"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")

FEC = "https://www.fec.gov/data"


def committee_url(cid: str) -> str:
    return f"{FEC}/committee/{cid}/?cycle=2024"


def candidate_url(cand: str) -> str:
    return f"{FEC}/candidate/{cand}/?cycle=2024"


CASEY = dict(
    candidate_id="S6PA00217",
    name="Bob Casey",
    party="DEM",
    incumbent=True,
    principal_committee_id="C00431056",
    result="lost",
)
MCCORMICK = dict(
    candidate_id="S2PA00661",
    name="Dave McCormick",
    party="REP",
    incumbent=False,
    principal_committee_id="C00851980",
    result="won",
)

# (entity_id, name, committee_type, total, [(candidate_id, S/O, amount)], flags)
SPENDERS = [
    (
        "C00571703",
        "Senate Leadership Fund",
        "O",
        62_000_000,
        [(CASEY["candidate_id"], "O", 55_000_000), (MCCORMICK["candidate_id"], "S", 7_000_000)],
        [],
    ),
    (
        "C00484642",
        "Senate Majority PAC",
        "O",
        48_000_000,
        [(MCCORMICK["candidate_id"], "O", 46_000_000), (CASEY["candidate_id"], "S", 2_000_000)],
        [],
    ),
    (
        "C00849489",
        "Keystone Renewal PAC",
        "O",
        40_000_000,
        [(CASEY["candidate_id"], "O", 30_000_000), (MCCORMICK["candidate_id"], "S", 10_000_000)],
        ["single_transfer_funded"],
    ),
    ("C00865444", "WinSenate", "O", 18_000_000, [(MCCORMICK["candidate_id"], "O", 18_000_000)], ["popup"]),
    (
        "C00487363",
        "American Crossroads",
        "O",
        12_000_000,
        [(CASEY["candidate_id"], "O", 12_000_000)],
        ["dead_end_dark"],
    ),
    (
        "C00687103",
        "Americans for Prosperity Action",
        "O",
        9_000_000,
        [(MCCORMICK["candidate_id"], "S", 9_000_000)],
        ["dead_end_dark"],
    ),
    ("C00744920", "CFFE PAC", "O", 6_500_000, [(CASEY["candidate_id"], "O", 6_500_000)], ["dead_end_dark"]),
    (
        "C00486845",
        "LCV Victory Fund",
        "O",
        4_200_000,
        [(CASEY["candidate_id"], "S", 3_000_000), (MCCORMICK["candidate_id"], "O", 1_200_000)],
        [],
    ),
    ("C00609388", "BlackPAC", "O", 2_100_000, [(CASEY["candidate_id"], "S", 2_100_000)], []),
    ("C00075820", "NRSC", "Y", 8_000_000, [(CASEY["candidate_id"], "O", 8_000_000)], []),
    ("C00042366", "DSCC", "Y", 7_500_000, [(MCCORMICK["candidate_id"], "O", 7_500_000)], []),
]

TYPE_LABEL = {"O": "Super PAC", "Y": "Party committee", "S": "Senate campaign", "Q": "PAC", "W": "Hybrid PAC"}


def write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")
    print(f"wrote {path}")


def outside_for(cid: str):
    s = sum(a for _, _, _, _, bc, _ in SPENDERS for c, so, a in bc if c == cid and so == "S")
    o = sum(a for _, _, _, _, bc, _ in SPENDERS for c, so, a in bc if c == cid and so == "O")
    return s, o


def main() -> None:
    global OUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=OUT)
    OUT = parser.parse_args().out
    # ---------------- races.json ----------------
    campaign_total = 65_000_000 + 32_000_000
    outside_total = sum(t for _, _, _, t, _, _ in SPENDERS)
    races = {
        "generated_at": NOW,
        "races": [
            {
                "race_id": RACE,
                "label": "Pennsylvania · U.S. Senate · 2024",
                "cycle": 2024,
                "state": "PA",
                "office": "S",
                "election_date": "2024-11-05",
                "status": "complete",
                "candidates": [CASEY, MCCORMICK],
                "totals": {
                    "campaign_receipts": campaign_total,
                    "outside_spending": outside_total,
                    "outside_share": round(outside_total / (campaign_total + outside_total), 4),
                },
                "traceability_score": 0.41,
                "data_status": "mock",
            },
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
            },
        ],
    }
    write(OUT / "races.json", races)

    # ---------------- ledger.json ----------------
    def cand_ledger(c, receipts, from_ind, from_cmte, conduit, disb, coh, score):
        s, o = outside_for(c["candidate_id"])
        return {
            **c,
            "campaign": {
                "receipts": receipts,
                "disbursements": disb,
                "from_individuals": from_ind,
                "from_committees": from_cmte,
                "via_conduit_total": conduit,
                "cash_on_hand": coh,
                "source_url": candidate_url(c["candidate_id"]),
            },
            "outside": {
                "support": s,
                "oppose": o,
                "total": s + o,
                "source_url": f"{FEC}/independent-expenditures/?candidate_id={c['candidate_id']}&cycle=2024",
            },
            "traceability_score": score,
        }

    spenders = []
    for eid, name, ctype, total, by, flags in SPENDERS:
        spenders.append(
            {
                "entity_id": eid,
                "name": name,
                "committee_type": ctype,
                "committee_type_label": TYPE_LABEL[ctype],
                "total": total,
                "by_candidate": [{"candidate_id": c, "support_oppose": so, "amount": a} for c, so, a in by],
                "traceability_score": 0.2 if "dead_end_dark" in flags else 0.7,
                "visibility_shares": (
                    {
                        "disclosed": 0.2,
                        "disclosed_individuals": 0.15,
                        "disclosed_organizations": 0.05,
                        "inferable": 0.0,
                        "unwalked": 0.4,
                        "dark": 0.4,
                    }
                    if "dead_end_dark" in flags
                    else {
                        "disclosed": 0.7,
                        "disclosed_individuals": 0.6,
                        "disclosed_organizations": 0.1,
                        "inferable": 0.0,
                        "unwalked": 0.3,
                        "dark": 0.0,
                    }
                ),
                "flags": flags,
                "has_chain": True,
                "source_url": committee_url(eid),
            }
        )
    ledger = {
        "race_id": RACE,
        "generated_at": NOW,
        "data_status": "mock",
        "candidates": [
            cand_ledger(CASEY, 65_000_000, 58_000_000, 6_000_000, 31_000_000, 63_000_000, 2_000_000, 0.38),
            cand_ledger(MCCORMICK, 32_000_000, 26_000_000, 3_500_000, 9_000_000, 31_000_000, 1_000_000, 0.45),
        ],
        "top_outside_spenders": spenders,
        "traceability": {
            "score": 0.41,
            "outside_total": outside_total,
            "traced_to_individuals": round(outside_total * 0.35),
            "traced_to_organizations": round(outside_total * 0.06),
            "inferable": round(outside_total * 0.12),
            "unwalked": round(outside_total * 0.10),
            "dark": round(outside_total * 0.37),
            "method": (
                "PRELIMINARY. For each committee that reported independent expenditures in this race, "
                "we walk its 2024-cycle receipts backward through committee-to-committee transfers until "
                "each dollar reaches a named individual (disclosed), an organization whose funding can be "
                "reconstructed from IRS filings (inferable), or an organization with no disclosure "
                "obligation (dark). The score is the disclosed share of all outside dollars, weighted by "
                "each committee's spending in this race."
            ),
            "preliminary": True,
        },
        "notes": [
            "MOCK DATA. Committee IDs are real; dollar figures are placeholders.",
            "Campaign receipts exclude memo entries; earmarked contributions are attributed to the individual, not the conduit.",
            "Outside spending = independent expenditures (Schedule E) supporting or opposing a candidate in this race.",
            "Independent expenditures are legally independent of the campaign. Support/oppose is the spender's own declaration.",
        ],
    }
    write(OUT / RACE / "ledger.json", ledger)

    # ---------------- entities ----------------
    def entity(eid, name, ctype, total, by, flags):
        flag_objs = []
        if "popup" in flags:
            flag_objs.append(
                {
                    "id": "popup",
                    "label": "Pop-up committee",
                    "detail": "Registered 2024-09-12, 54 days before the election; first filing after the pre-general deadline.",
                    "evidence_url": committee_url(eid),
                }
            )
        if "single_transfer_funded" in flags:
            flag_objs.append(
                {
                    "id": "single_transfer_funded",
                    "label": "Funded by a single transfer",
                    "detail": "94% of 2024 receipts came from one committee.",
                    "evidence_url": committee_url(eid),
                }
            )
        if "dead_end_dark" in flags:
            flag_objs.append(
                {
                    "id": "dead_end_dark",
                    "label": "Chain dead-ends in undisclosed source",
                    "detail": "A majority of receipts trace to a 501(c)(4) that does not disclose donors.",
                    "evidence_url": committee_url(eid),
                }
            )
        dark = round(total * (0.6 if "dead_end_dark" in flags else 0.1))
        from_cmte = round(total * 0.2)
        from_ind = total - dark - from_cmte
        return {
            "entity_id": eid,
            "race_id": RACE,
            "kind": "committee",
            "name": name,
            "aliases": [name.upper()],
            "committee_type": ctype,
            "committee_type_label": TYPE_LABEL[ctype],
            "designation": "U" if ctype == "O" else "B",
            "registration_date": "2024-09-12" if "popup" in flags else "2015-03-01",
            "treasurer": "MOCK, TREASURER",
            "address": {"street": "123 MOCK ST", "city": "WASHINGTON", "state": "DC", "zip": "20001"},
            "visibility": "dark" if "dead_end_dark" in flags else "disclosed",
            "is_conduit": False,
            "totals": {
                "receipts": total,
                "disbursements": total,
                "independent_expenditures": total,
                "from_individuals": from_ind,
                "from_committees": from_cmte,
                "from_undisclosed": dark,
            },
            "inflows": [
                {
                    "transfer_id": f"{eid}-in-1",
                    "from_entity_id": "org:mock-c4",
                    "from_name": "Mock Policy Action (501(c)(4))",
                    "to_entity_id": eid,
                    "to_name": name,
                    "amount": dark,
                    "date": "2024-08-15",
                    "visibility": "dark",
                    "transaction_type": "15",
                    "limit": "unlimited",
                    "source_url": f"{FEC}/receipts/?committee_id={eid}&two_year_transaction_period=2024",
                },
                {
                    "transfer_id": f"{eid}-in-2",
                    "from_entity_id": "ind:mock-donor-1",
                    "from_name": "MOCK DONOR, JOHN",
                    "to_entity_id": eid,
                    "to_name": name,
                    "amount": from_ind,
                    "date": "2024-06-01",
                    "visibility": "disclosed",
                    "transaction_type": "15",
                    "limit": "unlimited",
                    "source_url": f"{FEC}/receipts/?committee_id={eid}&two_year_transaction_period=2024",
                },
            ],
            "outflows": [],
            "independent_expenditures": [
                {
                    "ie_id": f"{eid}-ie-{i}",
                    "spender_entity_id": eid,
                    "spender_name": name,
                    "candidate_id": c,
                    "candidate_name": CASEY["name"] if c == CASEY["candidate_id"] else MCCORMICK["name"],
                    "support_oppose": so,
                    "amount": a,
                    "date": "2024-10-01",
                    "purpose": "TV media buy",
                    "payee": "MOCK MEDIA LLC",
                    "source_url": f"{FEC}/independent-expenditures/?committee_id={eid}&cycle=2024",
                }
                for i, (c, so, a) in enumerate(by)
            ],
            "flags": flag_objs,
            "has_chain": True,
            "source_url": committee_url(eid),
            "data_status": "mock",
        }

    for eid, name, ctype, total, by, flags in SPENDERS:
        write(OUT / RACE / "entities" / f"{eid}.json", entity(eid, name, ctype, total, by, flags))

    for c in (CASEY, MCCORMICK):
        e = entity(
            c["principal_committee_id"],
            f"{c['name']} for Senate",
            "S",
            65_000_000 if c is CASEY else 32_000_000,
            [],
            [],
        )
        e["independent_expenditures"] = []
        e["totals"]["independent_expenditures"] = 0
        e["has_chain"] = False
        e["inflows"][0] = {
            **e["inflows"][0],
            "from_entity_id": "C00003418",
            "from_name": "Example Industry PAC",
            "visibility": "disclosed",
            "transaction_type": "15",
            "limit": 5000,
        }
        e["inflows"][1] = {**e["inflows"][1], "transaction_type": "15E", "limit": 3300}
        write(OUT / RACE / "entities" / f"{c['principal_committee_id']}.json", e)

    # ---------------- chains ----------------
    for eid, name, ctype, total, by, flags in SPENDERS:
        dark = "dead_end_dark" in flags
        nodes = [
            {
                "id": eid,
                "name": name,
                "kind": "committee",
                "committee_type": ctype,
                "depth": 0,
                "visibility": "disclosed",
                "amount_in": total,
                "is_terminus": False,
                "terminus_reason": None,
                "source_url": committee_url(eid),
            },
            {
                "id": "C00000935",
                "name": "Mock Joint Fundraising Committee",
                "kind": "committee",
                "committee_type": "Q",
                "depth": 1,
                "visibility": "disclosed",
                "amount_in": round(total * 0.3),
                "is_terminus": False,
                "terminus_reason": None,
                "source_url": committee_url("C00000935"),
            },
            {
                "id": "ind:mock-donor-1",
                "name": "MOCK DONOR, JOHN",
                "kind": "individual",
                "committee_type": None,
                "depth": 1,
                "visibility": "disclosed",
                "amount_in": round(total * 0.25),
                "is_terminus": True,
                "terminus_reason": "individual",
                "source_url": None,
            },
            {
                "id": "ind:mock-donor-2",
                "name": "MOCK DONOR, ALICE",
                "kind": "individual",
                "committee_type": None,
                "depth": 2,
                "visibility": "disclosed",
                "amount_in": round(total * 0.3),
                "is_terminus": True,
                "terminus_reason": "individual",
                "source_url": None,
            },
            {
                "id": "agg:other",
                "name": "Other contributors (<1% each)",
                "kind": "aggregate",
                "committee_type": None,
                "depth": 1,
                "visibility": "disclosed",
                "amount_in": round(total * (0.05 if dark else 0.45)),
                "is_terminus": True,
                "terminus_reason": "pruned",
                "source_url": None,
            },
        ]
        edges = [
            {
                "from": "C00000935",
                "to": eid,
                "amount": round(total * 0.3),
                "visibility": "disclosed",
                "depth": 1,
                "transaction_types": ["18G"],
                "count": 4,
                "date_range": ["2024-03-01", "2024-10-15"],
                "source_url": f"{FEC}/receipts/?committee_id={eid}&two_year_transaction_period=2024",
            },
            {
                "from": "ind:mock-donor-1",
                "to": eid,
                "amount": round(total * 0.25),
                "visibility": "disclosed",
                "depth": 1,
                "transaction_types": ["15"],
                "count": 2,
                "date_range": ["2024-05-01", "2024-09-01"],
                "source_url": f"{FEC}/receipts/?committee_id={eid}&two_year_transaction_period=2024",
            },
            {
                "from": "ind:mock-donor-2",
                "to": "C00000935",
                "amount": round(total * 0.3),
                "visibility": "disclosed",
                "depth": 2,
                "transaction_types": ["15"],
                "count": 1,
                "date_range": ["2024-02-10", "2024-02-10"],
                "source_url": f"{FEC}/receipts/?committee_id=C00000935&two_year_transaction_period=2024",
            },
            {
                "from": "agg:other",
                "to": eid,
                "amount": round(total * (0.05 if dark else 0.45)),
                "visibility": "disclosed",
                "depth": 1,
                "transaction_types": ["15"],
                "count": 1200,
                "date_range": None,
                "source_url": None,
            },
        ]
        if dark:
            nodes.append(
                {
                    "id": "org:mock-c4",
                    "name": "Mock Policy Action (501(c)(4))",
                    "kind": "organization",
                    "committee_type": None,
                    "depth": 1,
                    "visibility": "dark",
                    "amount_in": round(total * 0.4),
                    "is_terminus": True,
                    "terminus_reason": "dark",
                    "source_url": None,
                }
            )
            edges.append(
                {
                    "from": "org:mock-c4",
                    "to": eid,
                    "amount": round(total * 0.4),
                    "visibility": "dark",
                    "depth": 1,
                    "transaction_types": ["15"],
                    "count": 3,
                    "date_range": ["2024-07-01", "2024-10-01"],
                    "source_url": f"{FEC}/receipts/?committee_id={eid}&two_year_transaction_period=2024",
                }
            )
        dark_share = 0.4 if dark else 0.0
        chain = {
            "root_entity_id": eid,
            "root_name": name,
            "race_id": RACE,
            "generated_at": NOW,
            "data_status": "mock",
            "nodes": nodes,
            "edges": edges,
            "summary": {
                "total_in": total,
                "disclosed_share": round(1 - dark_share - 0.1, 2),
                "disclosed_individuals_share": round(1 - dark_share - 0.2, 2),
                "disclosed_organizations_share": 0.1,
                "inferable_share": 0.0,
                "unwalked_share": 0.1,
                "dark_share": dark_share,
                "max_depth": 2,
                "terminus_counts": {"individual": 2, "pruned": 1, **({"dark": 1} if dark else {})},
            },
            "flags": [f for f in entity(eid, name, ctype, total, by, flags)["flags"]],
            "method": "Backward walk over 2024-cycle receipts; edges under 1% of the receiver's receipts are aggregated into 'Other'; stops at individuals, non-committee organizations, cycles, or 8 hops.",
        }
        write(OUT / RACE / "chains" / f"{eid}.json", chain)

    # ---------------- ads.json ----------------
    ads = {
        "race_id": RACE,
        "generated_at": NOW,
        "data_status": "mock",
        "sources": ["google"],
        "ads": [
            {
                "ad_id": "CR-MOCK-0001",
                "platform": "google",
                "advertiser_id": "AR-MOCK-SLF",
                "advertiser_name": "SENATE LEADERSHIP FUND",
                "matched_entity_id": "C00571703",
                "match_confidence": "verified",
                "candidate_ids": [CASEY["candidate_id"]],
                "support_oppose": "O",
                "spend_range": {"min": 100000, "max": None},
                "impressions_range": {"min": 10000000, "max": None},
                "first_shown": "2024-09-15",
                "last_shown": "2024-11-04",
                "ad_type": "video",
                "creative_url": "https://adstransparency.google.com/advertiser/AR-MOCK-SLF/creative/CR-MOCK-0001",
                "cached_creative_path": None,
                "regions": ["Pennsylvania"],
                "source_url": "https://adstransparency.google.com/political?region=US",
            },
            {
                "ad_id": "CR-MOCK-0002",
                "platform": "google",
                "advertiser_id": "AR-MOCK-KRP",
                "advertiser_name": "KEYSTONE RENEWAL PAC",
                "matched_entity_id": "C00849489",
                "match_confidence": "auto",
                "candidate_ids": [MCCORMICK["candidate_id"]],
                "support_oppose": "S",
                "spend_range": {"min": 50000, "max": 100000},
                "impressions_range": {"min": 1000000, "max": 10000000},
                "first_shown": "2024-10-01",
                "last_shown": "2024-11-04",
                "ad_type": "video",
                "creative_url": "https://adstransparency.google.com/advertiser/AR-MOCK-KRP/creative/CR-MOCK-0002",
                "cached_creative_path": None,
                "regions": ["Pennsylvania"],
                "source_url": "https://adstransparency.google.com/political?region=US",
            },
            {
                "ad_id": "CR-MOCK-0003",
                "platform": "google",
                "advertiser_id": "AR-MOCK-UNK",
                "advertiser_name": "PENNSYLVANIANS FOR SOMETHING",
                "matched_entity_id": None,
                "match_confidence": "none",
                "candidate_ids": [],
                "support_oppose": None,
                "spend_range": {"min": 1000, "max": 50000},
                "impressions_range": {"min": 100000, "max": 1000000},
                "first_shown": "2024-10-20",
                "last_shown": "2024-11-01",
                "ad_type": "image",
                "creative_url": "https://adstransparency.google.com/advertiser/AR-MOCK-UNK/creative/CR-MOCK-0003",
                "cached_creative_path": None,
                "regions": ["Pennsylvania"],
                "source_url": "https://adstransparency.google.com/political?region=US",
            },
        ],
        "notes": [
            "MOCK DATA.",
            "Spend and impressions are the ranges published by the platform, not exact figures.",
            "Advertiser → FEC committee matches marked 'verified' were checked by a human; 'auto' are string matches.",
        ],
    }
    write(OUT / RACE / "ads.json", ads)

    # ---------------- dossiers ----------------
    asym = (
        "Incumbents are judged on what they did (roll-call votes, sponsored bills). Challengers can only be judged on "
        "what they say (stated positions). These are not equivalent kinds of evidence; the record type is labeled on every item."
    )
    casey = {
        **{k: CASEY[k] for k in ("candidate_id", "name", "party", "incumbent")},
        "race_id": RACE,
        "role": "incumbent",
        "bioguide_id": "C001070",
        "generated_at": NOW,
        "data_status": "mock",
        "summary": "MOCK. Voting record on two example issues shown below; all other issues have no record loaded yet.",
        "summary_needs_review": True,
        "evidence_basis": "record",
        "asymmetry_note": asym,
        "stances": [
            {
                "issue_id": "healthcare",
                "position": "Voted for the Inflation Reduction Act, which included Medicare drug-price negotiation provisions.",
                "direction": 2,
                "confidence": "high",
                "needs_review": True,
                "evidence": [
                    {
                        "kind": "roll_call_vote",
                        "title": "H.R. 5376 — Inflation Reduction Act of 2022 (passage)",
                        "description": "Senate roll call 325, 117th Congress.",
                        "date": "2022-08-07",
                        "vote": "Yea",
                        "bill_id": "H.R.5376-117",
                        "congress": 117,
                        "roll_number": 325,
                        "url": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1172/vote_117_2_00325.htm",
                        "source_label": "senate.gov roll call",
                    }
                ],
            },
            {
                "issue_id": "crypto_fintech",
                "position": "Voted against the resolution to overturn SEC Staff Accounting Bulletin 121 on crypto custody.",
                "direction": 1,
                "confidence": "medium",
                "needs_review": True,
                "evidence": [
                    {
                        "kind": "roll_call_vote",
                        "title": "H.J.Res. 109 — Disapproving SEC SAB 121",
                        "description": "Senate roll call 174, 118th Congress.",
                        "date": "2024-05-16",
                        "vote": "Nay",
                        "bill_id": "H.J.Res.109-118",
                        "congress": 118,
                        "roll_number": 174,
                        "url": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1182/vote_118_2_00174.htm",
                        "source_label": "senate.gov roll call",
                    }
                ],
            },
        ],
        "links": {
            "fec_url": candidate_url(CASEY["candidate_id"]),
            "congress_url": "https://www.congress.gov/member/robert-casey/C001070",
            "campaign_site": None,
        },
    }
    mccormick = {
        **{k: MCCORMICK[k] for k in ("candidate_id", "name", "party", "incumbent")},
        "race_id": RACE,
        "role": "challenger",
        "bioguide_id": None,
        "generated_at": NOW,
        "data_status": "mock",
        "summary": "MOCK. Challenger: no federal voting record. Positions below are stated positions from the 2024 campaign website.",
        "summary_needs_review": True,
        "evidence_basis": "statements",
        "asymmetry_note": asym,
        "stances": [
            {
                "issue_id": "energy_climate",
                "position": "Campaign website stated support for expanding Pennsylvania natural-gas production and pipeline permitting.",
                "direction": -2,
                "confidence": "medium",
                "needs_review": True,
                "evidence": [
                    {
                        "kind": "stated_position",
                        "title": "Campaign issues page — Energy",
                        "description": None,
                        "date": "2024-10-01",
                        "vote": None,
                        "bill_id": None,
                        "congress": None,
                        "roll_number": None,
                        "url": "https://web.archive.org/web/2024/https://www.davemccormickpa.com/issues",
                        "source_label": "campaign website (archived)",
                    }
                ],
            }
        ],
        "links": {
            "fec_url": candidate_url(MCCORMICK["candidate_id"]),
            "congress_url": None,
            "campaign_site": "https://www.davemccormickpa.com/",
        },
    }
    write(OUT / RACE / "dossiers" / f"{CASEY['candidate_id']}.json", casey)
    write(OUT / RACE / "dossiers" / f"{MCCORMICK['candidate_id']}.json", mccormick)

    # ---------------- stories.json ----------------
    stories = {
        "race_id": RACE,
        "generated_at": NOW,
        "data_status": "mock",
        "stories": [
            {
                "story_id": "biggest-spender-slf",
                "kind": "biggest_spender",
                "title": "The largest outside spender in the race",
                "root_entity_id": "C00571703",
                "candidate_ids": [CASEY["candidate_id"]],
                "headline_numbers": {"amount": 62_000_000, "dark_share": 0.0, "hops": 2},
                "narrative": "Senate Leadership Fund reported $62M in independent expenditures in this race, mostly opposing Casey. Its 2024 receipts resolve mostly to named individuals within two hops.",
                "ad_ids": ["CR-MOCK-0001"],
                "verified": False,
            },
            {
                "story_id": "dark-dead-end-crossroads",
                "kind": "dark_dead_end",
                "title": "A chain that hits the dark wall",
                "root_entity_id": "C00487363",
                "candidate_ids": [CASEY["candidate_id"]],
                "headline_numbers": {"amount": 12_000_000, "dark_share": 0.4, "hops": 1},
                "narrative": "40% of American Crossroads' 2024 receipts came from a 501(c)(4) that is not required to disclose its donors. The chain ends there.",
                "ad_ids": [],
                "verified": False,
            },
            {
                "story_id": "popup-winsenate",
                "kind": "popup",
                "title": "A committee that appeared after the last disclosure deadline",
                "root_entity_id": "C00865444",
                "candidate_ids": [MCCORMICK["candidate_id"]],
                "headline_numbers": {"amount": 18_000_000, "dark_share": None, "hops": None},
                "narrative": "WinSenate registered 54 days before the election; its donors were not public until after voters had cast ballots.",
                "ad_ids": [],
                "verified": False,
            },
        ],
    }
    write(OUT / RACE / "stories.json", stories)


if __name__ == "__main__":
    main()
