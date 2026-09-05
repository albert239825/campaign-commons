"""Stage: filtered Parquet -> races.json, <race>/ledger.json, <race>/entities/*.json.

What this does (reads data/fec/<race_id>/*.parquet written by ingest.py):
  - Candidate campaign totals (receipts, disbursements, cash on hand, from_individuals, from_committees) come from
    the FEC candidate summary file (weball), which includes unitemized receipts; via_conduit_total is the itemized
    15E dollars to the principal committee (earmarked through ActBlue/WinRed, attributed to the individual).
  - Outside support/oppose per candidate: deduped Sched E rows (S support, O oppose) — targeting edges, no money
    moves to the candidate.
  - top_outside_spenders: every committee with Sched E in the race, sorted by total desc.
  - entities/<id>.json for every neighborhood committee. Totals come from the PAC/party summary (webk) when the
    committee has one, else the candidate summary (weball) for authorized committees, else itemized sums.
    Itemized Sched A dollars from non-individual entity types are split by orgs.py: from_organizations = named
    businesses and unions giving from their own treasuries (disclosed); from_undisclosed = LLCs, trusts, advocacy
    nonprofits and unclassifiable organizations (dark). Rows that name a registered committee (a PAC's transfer
    the receiver filed on Schedule A as ORG/PAC) are committee money: dropped when the sender's own filing is
    already in transfers, otherwise shown as a committee inflow (C-30). A summary row with no breakdown (Form 5 filers) falls back to itemized
    sums for the split. inflows/outflows aggregated per counterparty, top 25 by amount; transfers
    were deduped across Sched A/B in ingest (`transfer_mismatch` flag when both sides disagree by >1%).
  - traceability: null; traceability_score: null; has_chain: false — chains.py fills them in.
  - The TX 2026 stub race is carried over from the existing races.json unchanged (still "mock").
Every object carries a source_url to fec.gov (or docquery.fec.gov for a specific filing image).
"""

from __future__ import annotations

import sys
from collections.abc import Iterable
from pathlib import Path

import pandas as pd

from .config import FEC_WEB, KNOWN_CONDUITS, OUT, RACES, Candidate, Race
from .orgs import classify_organization, committee_name_index, match_committee, organization_visibility
from .util import (
    fec_candidate_url,
    fec_committee_url,
    fec_contributor_receipts_url,
    fec_disbursements_url,
    fec_ie_url,
    fec_pair_receipts_url,
    individual_id,
    now_iso,
    organization_id,
    read_json,
    write_json,
)

TOP_N_FLOWS = 25
COMMITTEE_TYPES = set("HSPXYZNQOUVWDEIC")
COMMITTEE_TYPE_LABELS = {
    "H": "House campaign",
    "S": "Senate campaign",
    "P": "Presidential campaign",
    "X": "Party committee (non-qualified)",
    "Y": "Party committee",
    "Z": "National party non-federal account",
    "N": "PAC (non-qualified)",
    "Q": "PAC",
    "O": "Super PAC",
    "U": "Single-candidate independent expenditure committee",
    "V": "Hybrid PAC (non-qualified)",
    "W": "Hybrid PAC",
    "D": "Delegate committee",
    "E": "Electioneering communication",
    "I": "Independent expenditor (not a committee)",
    "C": "Communication cost",
}
UNLIMITED_RECEIVER_TYPES = {"O", "U"}  # independent-expenditure-only committees may accept unlimited sums
INDIVIDUAL_ENTITY_TYPES = {"IND", "CAN"}
COMMITTEE_ENTITY_TYPES = {"PAC", "COM", "PTY", "CCM"}


def _num(value: float | int | None) -> float:
    return 0.0 if value is None or pd.isna(value) else round(float(value), 2)


def _str(value: object) -> str | None:
    return None if value is None or (isinstance(value, float) and pd.isna(value)) else str(value)


def _date(value: object) -> str | None:
    return None if value is None or pd.isna(value) else pd.Timestamp(value).strftime("%Y-%m-%d")


class Tables:
    def __init__(self, race: Race) -> None:
        d = race.fec_dir
        self.committees = pd.read_parquet(d / "committees.parquet").set_index("CMTE_ID", drop=False)
        self.summaries = pd.read_parquet(d / "committee_summaries.parquet").set_index("CMTE_ID")
        self.candidates = pd.read_parquet(d / "candidates.parquet").set_index("CAND_ID")
        self.transfers = pd.read_parquet(d / "transfers.parquet")
        self.individuals = pd.read_parquet(d / "individual_contributions.parquet")
        self.ies = pd.read_parquet(d / "independent_expenditures.parquet")
        self._ind_by_cmte = dict(tuple(self.individuals.groupby("CMTE_ID")))
        self._in_by_cmte = dict(tuple(self.transfers.groupby("to_id")))
        self._out_by_cmte = dict(tuple(self.transfers.groupby("from_id")))
        self._ies_by_cmte = dict(tuple(self.ies.groupby("committee_id")))
        self._by_name = committee_name_index(zip(self.committees["CMTE_ID"], self.committees["CMTE_NM"], strict=True))

    def sched_a(self, cid: str) -> pd.DataFrame:
        return self._ind_by_cmte.get(cid, self.individuals.iloc[0:0])

    def sched_a_split(self, cid: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """`cid`'s Schedule A as (individuals, organizations, committees). A committee row is a non-individual row
        that names a registered committee, or is typed PAC/COM/PTY/CCM by the filer; it carries `FROM_ID` (the
        master id when the name resolves, else a name id) and `covered` = the sender's own filing is already in
        transfers, making the row the receiver-side copy of that money (C-30)."""
        sched_a = self.sched_a(cid)
        is_person = sched_a["ENTITY_TP"].isin(INDIVIDUAL_ENTITY_TYPES)
        others = sched_a[~is_person]
        matched = others["NAME"].map(lambda n: match_committee(str(n), self._by_name))
        is_committee = (matched.notna() & (matched != cid)) | (
            matched.isna() & others["ENTITY_TP"].isin(COMMITTEE_ENTITY_TYPES)
        )
        from_id = matched.where(matched.notna(), others["NAME"].map(lambda n: organization_id(str(n))))
        senders = set(self.transfers_in(cid)["from_id"])
        committees = others[is_committee].assign(FROM_ID=from_id[is_committee])
        committees = committees.assign(covered=committees["FROM_ID"].isin(senders))
        return sched_a[is_person], others[~is_committee], committees

    def transfers_in(self, cid: str) -> pd.DataFrame:
        return self._in_by_cmte.get(cid, self.transfers.iloc[0:0])

    def transfers_out(self, cid: str) -> pd.DataFrame:
        return self._out_by_cmte.get(cid, self.transfers.iloc[0:0])

    def ies_by(self, cid: str) -> pd.DataFrame:
        return self._ies_by_cmte.get(cid, self.ies.iloc[0:0])

    def committee_type(self, cid: str) -> str | None:
        if cid not in self.committees.index:
            return None
        tp = _str(self.committees.at[cid, "CMTE_TP"])
        return tp if tp in COMMITTEE_TYPES else None

    def committee_name(self, cid: str) -> str:
        if cid in self.committees.index:
            return str(self.committees.at[cid, "CMTE_NM"])
        return cid


# --- outside spending --------------------------------------------------------------------------


def outside_by_candidate(ies: pd.DataFrame, cand: Candidate, cycle: int) -> dict:
    mine = ies[ies["candidate_id"] == cand.candidate_id]
    support = _num(mine.loc[mine["support_oppose_indicator"] == "S", "expenditure_amount"].sum())
    oppose = _num(mine.loc[mine["support_oppose_indicator"] == "O", "expenditure_amount"].sum())
    return {
        "support": support,
        "oppose": oppose,
        "total": round(support + oppose, 2),
        "source_url": f"{FEC_WEB}/independent-expenditures/?candidate_id={cand.candidate_id}&cycle={cycle}",
    }


def top_outside_spenders(t: Tables, race: Race) -> list[dict]:
    spenders = []
    by_spender = t.ies.groupby("committee_id")
    for cid, rows in by_spender:
        by_cand = rows.groupby(["candidate_id", "support_oppose_indicator"])["expenditure_amount"].sum().reset_index()
        tp = t.committee_type(str(cid))
        spenders.append(
            {
                "entity_id": str(cid),
                "name": t.committee_name(str(cid)),
                "committee_type": tp,
                "committee_type_label": COMMITTEE_TYPE_LABELS.get(tp or "", "Committee"),
                "total": _num(rows["expenditure_amount"].sum()),
                "by_candidate": [
                    {
                        "candidate_id": str(r.candidate_id),
                        "support_oppose": str(r.support_oppose_indicator),
                        "amount": _num(r.expenditure_amount),
                    }
                    for r in by_cand.sort_values("expenditure_amount", ascending=False).itertuples()
                ],
                "traceability_score": None,
                "flags": [],
                "has_chain": False,
                "source_url": fec_committee_url(str(cid), race.cycle),
            }
        )
    return sorted(spenders, key=lambda s: s["total"], reverse=True)


# --- candidates --------------------------------------------------------------------------------


def candidate_ledger(t: Tables, cand: Candidate, race: Race) -> dict:
    summary = t.candidates.loc[cand.candidate_id]
    pcc = cand.principal_committee_id
    sched_a = t.sched_a(pcc)
    via_conduit = sched_a[sched_a["CONDUIT_ID"].notna()]
    return {
        **race_candidate(cand),
        "campaign": {
            "receipts": _num(summary["TTL_RECEIPTS"]),
            "disbursements": _num(summary["TTL_DISB"]),
            "from_individuals": _num(summary["TTL_INDIV_CONTRIB"]),
            "from_committees": _num(summary["OTHER_POL_CMTE_CONTRIB"]) + _num(summary["POL_PTY_CONTRIB"]),
            "via_conduit_total": _num(via_conduit["TRANSACTION_AMT"].sum()),
            "cash_on_hand": _num(summary["COH_COP"]),
            "source_url": fec_candidate_url(cand.candidate_id, race.cycle),
        },
        "outside": outside_by_candidate(t.ies, cand, race.cycle),
        "traceability_score": None,
    }


def race_candidate(cand: Candidate) -> dict:
    return {
        "candidate_id": cand.candidate_id,
        "name": cand.name,
        "party": cand.party,
        "incumbent": cand.incumbent,
        "principal_committee_id": cand.principal_committee_id,
        "result": cand.result,
    }


# --- entities ----------------------------------------------------------------------------------


def _transfer(
    transfer_id: str,
    from_id: str,
    from_name: str,
    to_id: str,
    to_name: str,
    amount: float,
    date: str | None,
    visibility: str,
    tt: str | None,
    limit: str | None,
    source_url: str,
    count: int,
    first_date: str | None,
) -> dict:
    return {
        "transfer_id": transfer_id,
        "from_entity_id": from_id,
        "from_name": from_name,
        "to_entity_id": to_id,
        "to_name": to_name,
        "amount": _num(amount),
        "date": date,
        "first_date": first_date,
        "count": count,
        "visibility": visibility,
        "transaction_type": tt,
        "limit": limit,
        "source_url": source_url,
    }


def _top_counterparties(
    frame: pd.DataFrame, keys: list[str], amt: str, dt: str, tt: str, name: str, first_dt: str = "", n: str = ""
) -> pd.DataFrame:
    """Aggregate a flow frame per counterparty and keep the TOP_N_FLOWS largest by dollars, with the transaction
    count and date range (`first_dt`/`n` name pre-aggregated columns; by default each row is one transaction)."""
    if frame.empty:
        return pd.DataFrame(columns=[*keys, "amount", "first_dt", "last_dt", "n", "tt", "name"])
    frame = frame.assign(_first=frame[first_dt] if first_dt else frame[dt], _n=frame[n] if n else 1)
    agg = frame.groupby(keys, dropna=False).agg(
        amount=(amt, "sum"), first_dt=("_first", "min"), last_dt=(dt, "max"), n=("_n", "sum")
    )
    top = agg.sort_values("amount", ascending=False).head(TOP_N_FLOWS).reset_index()
    sub = frame.merge(top[keys], on=keys)
    if name in keys:
        top["name"] = top[name]
    else:
        top = top.merge(sub.drop_duplicates(keys)[[*keys, name]].rename(columns={name: "name"}), on=keys, how="left")
    modal_tt = sub.groupby([*keys, tt], dropna=False).size().reset_index(name="n")
    modal_tt = modal_tt.sort_values("n", ascending=False).drop_duplicates(keys).rename(columns={tt: "tt"})
    return top.merge(modal_tt[[*keys, "tt"]], on=keys, how="left")


def entity_inflows(t: Tables, cid: str, name: str, cycle: int) -> list[dict]:
    """Top counterparties paying into `cid`: committees (transfers), individuals and organizations (Sched A)."""
    limit = "unlimited" if t.committee_type(cid) in UNLIMITED_RECEIVER_TYPES else None
    rows: list[dict] = []
    cmtes = _top_counterparties(t.transfers_in(cid), ["from_id"], "amt", "dt", "tt", "from_name")
    for r in cmtes.itertuples():
        from_id = str(r.from_id)
        rows.append(
            _transfer(
                f"{cid}-in-{from_id}",
                from_id,
                _str(r.name) or from_id,
                cid,
                name,
                r.amount,
                _date(r.last_dt),
                "disclosed",
                _str(r.tt),
                limit,
                fec_pair_receipts_url(cid, from_id, cycle),
                int(r.n),
                _date(r.first_dt),
            )
        )
    person_rows, org_rows, misfiled = t.sched_a_split(cid)
    people = _top_counterparties(
        person_rows,
        ["NAME", "ZIP5"],
        "TRANSACTION_AMT",
        "LAST_DT",
        "TRANSACTION_TP",
        "NAME",
        "FIRST_DT",
        "N_TRANSACTIONS",
    )
    for r in people.itertuples():
        donor_id = individual_id(str(r.NAME), _str(r.ZIP5))
        rows.append(
            _transfer(
                f"{cid}-in-{donor_id}",
                donor_id,
                str(r.NAME),
                cid,
                name,
                r.amount,
                _date(r.last_dt),
                "disclosed",
                _str(r.tt),
                limit,
                fec_contributor_receipts_url(cid, str(r.NAME), cycle),
                int(r.n),
                _date(r.first_dt),
            )
        )
    uncovered = misfiled[~misfiled["covered"]]
    for r in _top_counterparties(
        uncovered, ["FROM_ID"], "TRANSACTION_AMT", "LAST_DT", "TRANSACTION_TP", "NAME", "FIRST_DT", "N_TRANSACTIONS"
    ).itertuples():
        from_id = str(r.FROM_ID)
        rows.append(
            _transfer(
                f"{cid}-in-{from_id}",
                from_id,
                str(r.name),
                cid,
                name,
                r.amount,
                _date(r.last_dt),
                "disclosed",
                _str(r.tt),
                limit,
                fec_contributor_receipts_url(cid, str(r.name), cycle),
                int(r.n),
                _date(r.first_dt),
            )
        )
    orgs = _top_counterparties(
        org_rows, ["NAME"], "TRANSACTION_AMT", "LAST_DT", "TRANSACTION_TP", "NAME", "FIRST_DT", "N_TRANSACTIONS"
    )
    for r in orgs.itertuples():
        rows.append(
            _transfer(
                f"{cid}-in-{organization_id(str(r.NAME))}",
                organization_id(str(r.NAME)),
                str(r.NAME),
                cid,
                name,
                r.amount,
                _date(r.last_dt),
                organization_visibility(classify_organization(str(r.NAME))),
                _str(r.tt),
                limit,
                fec_contributor_receipts_url(cid, str(r.NAME), cycle),
                int(r.n),
                _date(r.first_dt),
            )
        )
    return sorted(rows, key=lambda r: r["amount"], reverse=True)[:TOP_N_FLOWS]


def entity_outflows(t: Tables, cid: str, name: str, cycle: int) -> list[dict]:
    disb_url = fec_disbursements_url(cid, cycle)
    rows = []
    for r in _top_counterparties(t.transfers_out(cid), ["to_id"], "amt", "dt", "tt", "to_name").itertuples():
        to_id = str(r.to_id)
        limit = "unlimited" if t.committee_type(to_id) in UNLIMITED_RECEIVER_TYPES else None
        rows.append(
            _transfer(
                f"{cid}-out-{to_id}",
                cid,
                name,
                to_id,
                _str(r.name) or to_id,
                r.amount,
                _date(r.last_dt),
                "disclosed",
                _str(r.tt),
                limit,
                disb_url,
                int(r.n),
                _date(r.first_dt),
            )
        )
    return rows


def entity_ies(t: Tables, cid: str, name: str, race: Race) -> list[dict]:
    names = {c.candidate_id: c.name for c in race.candidates}
    mine = t.ies_by(cid).sort_values("expenditure_amount", ascending=False)
    return [
        {
            "ie_id": f"{cid}-ie-{r.file_num}-{r.tran_id}",
            "spender_entity_id": cid,
            "spender_name": name,
            "candidate_id": str(r.candidate_id),
            "candidate_name": names[str(r.candidate_id)],
            "support_oppose": str(r.support_oppose_indicator),
            "amount": _num(r.expenditure_amount),
            "date": _date(r.expenditure_date if not pd.isna(r.expenditure_date) else r.dissemination_date),
            "purpose": _str(r.purpose),
            "payee": _str(r.payee_name),
            "source_url": str(r.pdf_url) if _str(r.image_num) else fec_ie_url(cid, race.cycle),
        }
        for r in mine.itertuples()
    ]


def entity_totals(t: Tables, cid: str, ies: list[dict]) -> dict:
    """Summary-file totals when the FEC publishes them for this committee, else itemized sums."""
    sched_a = t.sched_a(cid)
    _, orgs, misfiled = t.sched_a_split(cid)
    misfiled_covered = _num(misfiled.loc[misfiled["covered"], "TRANSACTION_AMT"].sum())
    misfiled_uncovered = _num(misfiled.loc[~misfiled["covered"], "TRANSACTION_AMT"].sum())
    org_dark = orgs["NAME"].map(lambda n: organization_visibility(classify_organization(str(n))) == "dark").astype(bool)
    from_undisclosed = _num(orgs.loc[org_dark, "TRANSACTION_AMT"].sum())
    from_orgs = _num(orgs.loc[~org_dark, "TRANSACTION_AMT"].sum())
    ie_total = round(sum(ie["amount"] for ie in ies), 2)
    cand_id = _str(t.committees.at[cid, "CAND_ID"])
    if cid in t.summaries.index:
        s = t.summaries.loc[cid]
        receipts, disb = _num(s["TTL_RECEIPTS"]), _num(s["TTL_DISB"])
        from_ind = _num(s["INDV_CONTRIB"])
        from_cmte = _num(s["OTHER_POL_CMTE_CONTRIB"]) + _num(s["TRANS_FROM_AFF"])
        ie_total = max(ie_total, _num(s["IND_EXP"]))
    elif cand_id in t.candidates.index:
        s = t.candidates.loc[cand_id]
        receipts, disb = _num(s["TTL_RECEIPTS"]), _num(s["TTL_DISB"])
        from_ind = _num(s["TTL_INDIV_CONTRIB"])
        from_cmte = _num(s["OTHER_POL_CMTE_CONTRIB"]) + _num(s["POL_PTY_CONTRIB"])
    else:
        from_cmte = _num(t.transfers_in(cid)["amt"].sum() + misfiled_uncovered)
        from_ind = _num(sched_a["TRANSACTION_AMT"].sum() - misfiled_covered - misfiled_uncovered)
        receipts = round(from_ind + from_cmte, 2)
        disb = _num(t.transfers_out(cid)["amt"].sum())
    if from_ind == 0 and from_cmte == 0:
        from_ind = _num(sched_a["TRANSACTION_AMT"].sum() - misfiled_covered - misfiled_uncovered)
        from_cmte = _num(t.transfers_in(cid)["amt"].sum() + misfiled_uncovered)
    return {
        "receipts": receipts,
        "disbursements": disb,
        "independent_expenditures": ie_total,
        "from_individuals": round(max(from_ind - from_undisclosed - from_orgs, 0.0), 2),
        "from_committees": round(from_cmte, 2),
        "from_organizations": from_orgs,
        "from_undisclosed": from_undisclosed,
    }


def entity(t: Tables, cid: str, race: Race) -> dict:
    row = t.committees.loc[cid]
    name = str(row["CMTE_NM"])
    tp = t.committee_type(cid)
    ies = entity_ies(t, cid, name, race)
    return {
        "entity_id": cid,
        "race_id": race.race_id,
        "kind": "conduit" if cid in KNOWN_CONDUITS else "committee",
        "name": name,
        "aliases": [],
        "committee_type": tp,
        "committee_type_label": COMMITTEE_TYPE_LABELS.get(tp or ""),
        "designation": _str(row["CMTE_DSGN"]),
        "registration_date": None,
        "treasurer": _str(row["TRES_NM"]),
        "address": {
            "street": _str(row["CMTE_ST1"]),
            "city": _str(row["CMTE_CITY"]),
            "state": _str(row["CMTE_ST"]),
            "zip": _str(row["CMTE_ZIP"]),
        },
        "visibility": "disclosed",
        "is_conduit": cid in KNOWN_CONDUITS,
        "totals": entity_totals(t, cid, ies),
        "inflows": entity_inflows(t, cid, name, race.cycle),
        "outflows": entity_outflows(t, cid, name, race.cycle),
        "independent_expenditures": ies,
        "flags": [],
        "has_chain": False,
        "source_url": fec_committee_url(cid, race.cycle),
        "data_status": "real",
    }


# --- races.json ---------------------------------------------------------------------------------


def race_summary(race: Race, campaign_receipts: float, outside: float) -> dict:
    total = campaign_receipts + outside
    return {
        "race_id": race.race_id,
        "label": race.label,
        "cycle": race.cycle,
        "state": race.state,
        "office": race.office,
        "election_date": race.election_date,
        "status": race.status,
        "candidates": [race_candidate(c) for c in race.candidates],
        "totals": {
            "campaign_receipts": round(campaign_receipts, 2),
            "outside_spending": round(outside, 2),
            "outside_share": round(outside / total, 4) if total else 0,
        },
        "traceability_score": None,
        "data_status": "real",
    }


def write_races_index(summary: dict) -> None:
    """Replace this race's entry in races.json; every other race (e.g. the TX 2026 stub) is carried over as-is."""
    path = OUT / "races.json"
    others: Iterable[dict] = ()
    if path.exists():
        others = [r for r in read_json(path)["races"] if r["race_id"] != summary["race_id"]]
    races = sorted([summary, *others], key=lambda r: (r["cycle"], r["race_id"]))
    write_json(path, {"generated_at": now_iso(), "races": races})


def _clear_dir(path: Path) -> None:
    if path.exists():
        for f in path.glob("*.json"):
            f.unlink()


def run(race_id: str) -> None:
    race = RACES[race_id]
    t = Tables(race)
    candidates = [candidate_ledger(t, c, race) for c in race.candidates]
    spenders = top_outside_spenders(t, race)
    outside_total = _num(t.ies["expenditure_amount"].sum())
    campaign_total = sum(c["campaign"]["receipts"] for c in candidates)

    ledger = {
        "race_id": race.race_id,
        "generated_at": now_iso(),
        "data_status": "real",
        "candidates": candidates,
        "top_outside_spenders": spenders,
        "traceability": None,
        "notes": [
            "Campaign totals are the FEC candidate summary (all authorized committees, itemized and unitemized); "
            "top contributors and conduit totals are itemized Schedule A receipts to the principal committee.",
            "Earmarked contributions (15E) are attributed to the individual, not the conduit (ActBlue/WinRed).",
            "Outside spending = independent expenditures (Schedule E) supporting or opposing a candidate in this race, "
            "with 24/48-hour notices collapsed onto the periodic-report row for the same spend.",
            "Independent expenditures are legally independent of the campaign and move no money to the candidate. "
            "Support/oppose is the spender's own declaration.",
        ],
    }
    write_json(race.out_dir / "ledger.json", ledger)
    write_races_index(race_summary(race, campaign_total, outside_total))

    entities_dir = race.out_dir / "entities"
    _clear_dir(entities_dir)
    for cid in t.committees.index:
        write_json(entities_dir / f"{cid}.json", entity(t, str(cid), race))
    print(
        f"ledger: {len(spenders)} outside spenders, ${outside_total:,.0f} outside; "
        f"campaign ${campaign_total:,.0f}; {len(t.committees)} entity pages"
    )


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
