"""Stage: FEC bulk download -> DuckDB -> filtered Parquet under data/fec/<race_id>/.

What this does (2024 cycle, PA Senate):
  1. `fec_bulk.ensure_bulk` streams cm/cn/ccl/oth/pas2/indiv zips into data/raw/2024/ (skipped if present),
     extracts, and exposes each as a DuckDB view named by the official header file.
  2. Independent expenditures come from the OpenFEC schedule_e endpoint (`fec_ie.load_schedule_e`) with
     `is_notice=false&most_recent=true`: periodic-report rows only, latest amendment only — the same row set behind
     fec.gov's candidate IE totals (D-36).
  3. Seed set = principal committees (verified against ccl: CMTE_DSGN='P', CAND_ELECTION_YR=cycle) + every committee
     with a Sched E row targeting a race candidate.
  4. Neighborhood = seed + committees that sent money into the frontier, repeated to closure or NEIGHBORHOOD_MAX_HOPS.
     A sender is found on either side of the ledger: the receiver's Sched A (`oth`, receipt TTs, OTHER_ID=sender) or
     the sender's Sched B (`oth`+`pas2`, disbursement TTs, OTHER_ID=receiver). Conduits are never expanded through.
     Capped at NEIGHBORHOOD_CAP committees by dollars sent into the neighborhood.
  5. Transfers = all committee->committee money edges among the neighborhood (Sched A + Sched B), deduped so each
     edge survives once (receiver's row preferred). `transfer_mismatch` when both sides exist and disagree >1%.
  6. Individual contributions = `indiv` rows to neighborhood committees, MEMO_CD != 'X', cycle dates, 15E attributed
     to the individual with OTHER_ID kept as the conduit. Aggregated per (committee, name, zip5, employer,
     occupation, TT, conduit); seed committees keep every donor identity, other neighborhood committees keep ORG
     donors + their 100 largest individuals (D-24) so the committed Parquet stays small.
  7. Financial summaries: `weball` (candidate totals: receipts, disbursements, cash on hand, individual/committee
     contributions) joined onto candidates; `webk` (PAC/party totals) for every neighborhood committee that has one.
  8. Parquet: committees, committee_summaries, candidates, transfers, individual_contributions,
     independent_expenditures + MANIFEST.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import pandas as pd

from .config import (
    KNOWN_CONDUITS,
    RACES,
    TT_COMMITTEE_TO_COMMITTEE_DISB,
    TT_COMMITTEE_TO_COMMITTEE_RECEIPT,
    Race,
)
from .fec_bulk import bulk_files, bulk_url, connect, ensure_bulk, header_url
from .fec_ie import load_schedule_e, schedule_e_source_url
from .util import now_iso

NEIGHBORHOOD_MAX_HOPS = 8
NEIGHBORHOOD_CAP = 2000
# Receipt-side codes that carry a registered-committee sender in OTHER_ID beyond the plain transfer set:
# 15Z in-kind from a registered filer, 17R/17Z refunds from committees, 19 electioneering donation received.
TT_NEIGHBORHOOD_RECEIPT = TT_COMMITTEE_TO_COMMITTEE_RECEIPT | {"15Z", "17R", "17Z", "19"}
TT_NEIGHBORHOOD_DISB = TT_COMMITTEE_TO_COMMITTEE_DISB - {"24I", "24T"}  # conduit pass-through is not a transfer

TRANSFER_MISMATCH_TOLERANCE = 0.01
INDIVIDUALS_PER_COMMITTEE = 100  # donor identities kept for non-seed neighborhood committees


def _sql_set(values: set[str] | list[str]) -> str:
    return ", ".join(f"'{v}'" for v in sorted(values))


def cycle_bounds(cycle: int) -> tuple[str, str]:
    return f"{cycle - 1}-01-01", f"{cycle}-12-31"


def _materialize_committee_edges(con: duckdb.DuckDBPyConnection, cycle: int) -> None:
    """Materialize the committee->committee rows of oth + pas2 once (typed, cycle-filtered, non-memo).

    `oth` is ~17M rows, most of them 15J joint-fundraising memo lines; the committee-edge subset is ~1M rows,
    small enough to scan on every neighborhood hop.
    """
    lo, hi = cycle_bounds(cycle)
    tts = _sql_set(TT_NEIGHBORHOOD_RECEIPT | TT_NEIGHBORHOOD_DISB)
    con.execute(
        f"""
        CREATE TABLE cc AS
        SELECT CMTE_ID, TRANSACTION_TP, ENTITY_TP, NAME, OTHER_ID, CAND_ID, SUB_ID, src,
               try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE AS TRANSACTION_DT,
               try_cast(TRANSACTION_AMT AS DOUBLE) AS TRANSACTION_AMT
        FROM (
            SELECT CMTE_ID, TRANSACTION_TP, ENTITY_TP, NAME, OTHER_ID, NULL AS CAND_ID, SUB_ID, TRANSACTION_DT,
                   TRANSACTION_AMT, MEMO_CD, 'oth' AS src
            FROM oth
            UNION ALL
            SELECT CMTE_ID, TRANSACTION_TP, ENTITY_TP, NAME, OTHER_ID, CAND_ID, SUB_ID, TRANSACTION_DT,
                   TRANSACTION_AMT, MEMO_CD, 'pas2'
            FROM pas2
        )
        WHERE TRANSACTION_TP IN ({tts})
          AND OTHER_ID LIKE 'C%'
          AND coalesce(MEMO_CD, '') <> 'X'
          AND try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE BETWEEN DATE '{lo}' AND DATE '{hi}'
          AND try_cast(TRANSACTION_AMT AS DOUBLE) > 0
        """
    )
    print(f"cc: {con.execute('SELECT count(*) FROM cc').fetchone()[0]} committee->committee rows")


def verify_principal_committees(con: duckdb.DuckDBPyConnection, race: Race) -> None:
    for cand in race.candidates:
        rows = con.execute(
            "SELECT CMTE_ID FROM ccl WHERE CAND_ID = ? AND CAND_ELECTION_YR = ? AND CMTE_DSGN = 'P'",
            [cand.candidate_id, str(race.cycle)],
        ).fetchall()
        pccs = {r[0] for r in rows}
        if cand.principal_committee_id not in pccs:
            raise RuntimeError(
                f"{cand.name}: config says {cand.principal_committee_id} but ccl{race.cycle % 100} lists {sorted(pccs)}"
            )
        print(f"principal committee ok: {cand.name} -> {cand.principal_committee_id}")


def _senders_into(con: duckdb.DuckDBPyConnection, frontier: set[str]) -> pd.DataFrame:
    """Committees that sent money to any committee in `frontier`, with dollars, from either filing side."""
    fr = _sql_set(frontier)
    return con.execute(
        f"""
        WITH edges AS (
            SELECT OTHER_ID AS sender, TRANSACTION_AMT AS amt
            FROM cc WHERE CMTE_ID IN ({fr}) AND TRANSACTION_TP IN ({_sql_set(TT_NEIGHBORHOOD_RECEIPT)})
            UNION ALL
            SELECT CMTE_ID, TRANSACTION_AMT
            FROM cc WHERE OTHER_ID IN ({fr}) AND TRANSACTION_TP IN ({_sql_set(TT_NEIGHBORHOOD_DISB)})
        )
        SELECT sender, sum(amt) AS dollars
        FROM edges JOIN cm ON cm.CMTE_ID = edges.sender
        GROUP BY sender
        """
    ).df()


def build_neighborhood(con: duckdb.DuckDBPyConnection, seed: set[str]) -> tuple[set[str], list[str]]:
    """Expand backward from `seed` through committee->committee money edges. Returns (ids, log lines)."""
    log: list[str] = []
    neighborhood = set(seed)
    dollars: dict[str, float] = dict.fromkeys(seed, float("inf"))
    frontier = set(seed) - set(KNOWN_CONDUITS)
    for hop in range(1, NEIGHBORHOOD_MAX_HOPS + 1):
        senders = _senders_into(con, frontier)
        new = set(senders["sender"]) - neighborhood
        for sender, amt in zip(senders["sender"], senders["dollars"], strict=True):
            if sender not in seed:
                dollars[sender] = dollars.get(sender, 0.0) + float(amt)
        neighborhood |= new
        log.append(f"hop {hop}: +{len(new)} committees (total {len(neighborhood)})")
        frontier = new - set(KNOWN_CONDUITS)
        if not frontier:
            break
    if len(neighborhood) > NEIGHBORHOOD_CAP:
        keep = sorted(neighborhood, key=lambda c: dollars.get(c, 0.0), reverse=True)[:NEIGHBORHOOD_CAP]
        log.append(f"cap hit: kept the {NEIGHBORHOOD_CAP} largest-dollar committees of {len(neighborhood)}")
        neighborhood = set(keep)
    for line in log:
        print(line)
    return neighborhood, log


def committees_frame(con: duckdb.DuckDBPyConnection, ids: set[str]) -> pd.DataFrame:
    return con.execute(
        f"""
        SELECT CMTE_ID, CMTE_NM, TRES_NM, CMTE_ST1, CMTE_ST2, CMTE_CITY, CMTE_ST, CMTE_ZIP, CMTE_DSGN, CMTE_TP,
               CMTE_PTY_AFFILIATION, CMTE_FILING_FREQ, ORG_TP, CONNECTED_ORG_NM, CAND_ID
        FROM cm WHERE CMTE_ID IN ({_sql_set(ids)}) ORDER BY CMTE_ID
        """
    ).df()


def committee_summaries_frame(con: duckdb.DuckDBPyConnection, ids: set[str]) -> pd.DataFrame:
    return con.execute(
        f"""
        SELECT CMTE_ID, try_cast(TTL_RECEIPTS AS DOUBLE) AS TTL_RECEIPTS, try_cast(TTL_DISB AS DOUBLE) AS TTL_DISB,
               try_cast(INDV_CONTRIB AS DOUBLE) AS INDV_CONTRIB,
               try_cast(OTHER_POL_CMTE_CONTRIB AS DOUBLE) AS OTHER_POL_CMTE_CONTRIB,
               try_cast(TRANS_FROM_AFF AS DOUBLE) AS TRANS_FROM_AFF, try_cast(IND_EXP AS DOUBLE) AS IND_EXP,
               try_cast(COH_COP AS DOUBLE) AS COH_COP, CVG_END_DT
        FROM webk WHERE CMTE_ID IN ({_sql_set(ids)}) ORDER BY CMTE_ID
        """
    ).df()


def candidates_frame(con: duckdb.DuckDBPyConnection, race: Race) -> pd.DataFrame:
    return con.execute(
        f"""
        SELECT cn.CAND_ID, cn.CAND_NAME, cn.CAND_PTY_AFFILIATION, CAND_ELECTION_YR, cn.CAND_OFFICE_ST, CAND_OFFICE,
               cn.CAND_ICI, CAND_STATUS, CAND_PCC,
               try_cast(TTL_RECEIPTS AS DOUBLE) AS TTL_RECEIPTS, try_cast(TTL_DISB AS DOUBLE) AS TTL_DISB,
               try_cast(COH_COP AS DOUBLE) AS COH_COP, try_cast(TTL_INDIV_CONTRIB AS DOUBLE) AS TTL_INDIV_CONTRIB,
               try_cast(OTHER_POL_CMTE_CONTRIB AS DOUBLE) AS OTHER_POL_CMTE_CONTRIB,
               try_cast(POL_PTY_CONTRIB AS DOUBLE) AS POL_PTY_CONTRIB, CVG_END_DT
        FROM cn LEFT JOIN weball USING (CAND_ID)
        WHERE cn.CAND_ID IN ({_sql_set([c.candidate_id for c in race.candidates])}) ORDER BY cn.CAND_ID
        """
    ).df()


def transfers_frame(con: duckdb.DuckDBPyConnection, ids: set[str]) -> pd.DataFrame:
    """Committee->committee money edges touching the neighborhood, one row per edge after Sched A/B dedupe."""
    n = _sql_set(ids)
    return con.execute(
        f"""
        WITH a AS (  -- receiver's Sched A
            SELECT OTHER_ID AS from_id, CMTE_ID AS to_id, TRANSACTION_TP AS tt, TRANSACTION_DT AS dt,
                   TRANSACTION_AMT AS amt, SUB_ID AS sub_id, 'A' AS side
            FROM cc WHERE TRANSACTION_TP IN ({_sql_set(TT_NEIGHBORHOOD_RECEIPT)})
        ), b AS (  -- sender's Sched B
            SELECT CMTE_ID, OTHER_ID, TRANSACTION_TP, TRANSACTION_DT, TRANSACTION_AMT, SUB_ID, 'B'
            FROM cc WHERE TRANSACTION_TP IN ({_sql_set(TT_NEIGHBORHOOD_DISB)})
        )
        SELECT * FROM (SELECT * FROM a UNION ALL SELECT * FROM b)
        WHERE from_id IN ({n}) OR to_id IN ({n})
        """
    ).df()


def with_committee_names(con: duckdb.DuckDBPyConnection, transfers: pd.DataFrame) -> pd.DataFrame:
    """Attach cm names for both ends (the far end may be outside the neighborhood)."""
    ids = set(transfers["from_id"]) | set(transfers["to_id"])
    names = con.execute(f"SELECT CMTE_ID, CMTE_NM FROM cm WHERE CMTE_ID IN ({_sql_set(ids)})").df()
    lookup = dict(zip(names["CMTE_ID"], names["CMTE_NM"], strict=True))
    return transfers.assign(from_name=transfers["from_id"].map(lookup), to_name=transfers["to_id"].map(lookup))


def dedupe_transfers(raw: pd.DataFrame) -> pd.DataFrame:
    """Keep one row per money edge occurrence.

    The same transfer shows up on the receiver's Sched A and the sender's Sched B. Match on
    (from_id, to_id, date); prefer the Sched A row. When both sides exist and the amounts disagree by more than
    TRANSFER_MISMATCH_TOLERANCE, keep the Sched A amount and set `mismatch=True` with the B-side amount recorded.
    """
    if raw.empty:
        return raw.assign(mismatch=pd.Series(dtype=bool), amt_other_side=pd.Series(dtype=float))
    key = ["from_id", "to_id", "dt"]
    per_side = (
        raw.groupby(key + ["side"], dropna=False)
        .agg(amt=("amt", "sum"), tt=("tt", "first"), sub_id=("sub_id", "min"), n=("amt", "size"))
        .reset_index()
    )
    a = per_side[per_side["side"] == "A"].drop(columns="side")
    b = per_side[per_side["side"] == "B"].drop(columns="side")
    both = a.merge(b, on=key, how="outer", suffixes=("_a", "_b"), indicator=True)
    has_a = both["amt_a"].notna()
    out = pd.DataFrame(
        {
            "from_id": both["from_id"],
            "to_id": both["to_id"],
            "dt": both["dt"],
            "tt": both["tt_a"].where(has_a, both["tt_b"]),
            "amt": both["amt_a"].where(has_a, both["amt_b"]),
            "sub_id": both["sub_id_a"].where(has_a, both["sub_id_b"]),
            "side": pd.Series("A", index=both.index).where(has_a, "B"),
            "count": both["n_a"].where(has_a, both["n_b"]).astype(int),
            "amt_other_side": both["amt_b"].where(has_a, both["amt_a"]).where(both["_merge"] == "both"),
        }
    )
    rel = (out["amt"] - out["amt_other_side"]).abs() / out["amt"].where(out["amt"] > 0, 1.0)
    out["mismatch"] = (both["_merge"] == "both") & (rel > TRANSFER_MISMATCH_TOLERANCE)
    return out.reset_index(drop=True)


def individuals_frame(con: duckdb.DuckDBPyConnection, ids: set[str], seed: set[str], cycle: int) -> pd.DataFrame:
    """Sched A receipts from non-committee sources (individuals + ORG entities), aggregated per donor identity.

    15E rows are earmarked through a conduit: attributed to the individual, conduit kept in CONDUIT_ID.
    Seed committees (campaigns + outside spenders) keep every donor identity; other neighborhood committees keep
    every ORG donor plus their INDIVIDUALS_PER_COMMITTEE largest individual donors. Conduits' own Sched A is
    skipped: those dollars are the earmarks already counted as 15E at the receiving committee.
    """
    lo, hi = cycle_bounds(cycle)
    return con.execute(
        f"""
        WITH agg AS (
            SELECT CMTE_ID, NAME, CITY, STATE, left(ZIP_CODE, 5) AS ZIP5, EMPLOYER, OCCUPATION, TRANSACTION_TP,
                   ENTITY_TP, CASE WHEN TRANSACTION_TP = '15E' THEN OTHER_ID END AS CONDUIT_ID,
                   sum(try_cast(TRANSACTION_AMT AS DOUBLE)) AS TRANSACTION_AMT,
                   count(*) AS N_TRANSACTIONS,
                   min(try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE) AS FIRST_DT,
                   max(try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE) AS LAST_DT,
                   min(SUB_ID) AS SUB_ID
            FROM indiv
            WHERE CMTE_ID IN ({_sql_set(ids - set(KNOWN_CONDUITS))})
              AND coalesce(MEMO_CD, '') <> 'X'
              AND try_strptime(TRANSACTION_DT, '%m%d%Y')::DATE BETWEEN DATE '{lo}' AND DATE '{hi}'
              AND try_cast(TRANSACTION_AMT AS DOUBLE) > 0
            GROUP BY ALL
        ), ranked AS (
            SELECT *, row_number() OVER (PARTITION BY CMTE_ID ORDER BY TRANSACTION_AMT DESC) AS rn FROM agg
        )
        SELECT * EXCLUDE (rn) FROM ranked
        WHERE CMTE_ID IN ({_sql_set(seed)}) OR ENTITY_TP = 'ORG' OR rn <= {INDIVIDUALS_PER_COMMITTEE}
        """
    ).df()


def run(race_id: str) -> None:
    race = RACES[race_id]
    stamps = ensure_bulk(race.cycle)
    con = connect(race.cycle)
    con.execute("SET enable_progress_bar = false")
    _materialize_committee_edges(con, race.cycle)
    verify_principal_committees(con, race)

    ies = load_schedule_e(race.cycle, {c.candidate_id for c in race.candidates})
    seed = {c.principal_committee_id for c in race.candidates} | set(ies["committee_id"])
    print(f"seed: {len(seed)} committees ({len(seed) - len(race.candidates)} outside spenders)")
    neighborhood, hop_log = build_neighborhood(con, seed)

    committees = committees_frame(con, neighborhood)
    candidates = candidates_frame(con, race)
    transfers = with_committee_names(con, dedupe_transfers(transfers_frame(con, neighborhood)))
    individuals = individuals_frame(con, neighborhood, seed, race.cycle)
    print(
        f"transfers: {len(transfers)} edges ({int(transfers['mismatch'].sum())} mismatches); "
        f"individuals: {len(individuals)} aggregated rows, ${individuals['TRANSACTION_AMT'].sum():,.0f}"
    )

    out = race.fec_dir
    out.mkdir(parents=True, exist_ok=True)
    frames = {
        "committees": committees,
        "committee_summaries": committee_summaries_frame(con, neighborhood),
        "candidates": candidates,
        "transfers": transfers,
        "individual_contributions": individuals,
        "independent_expenditures": ies,
    }
    for name, frame in frames.items():
        frame.to_parquet(out / f"{name}.parquet", index=False, compression="zstd")
    _write_manifest(out, race, frames, stamps, hop_log, seed)


def _write_manifest(
    out: Path,
    race: Race,
    frames: dict[str, pd.DataFrame],
    stamps: dict[str, str],
    hop_log: list[str],
    seed: set[str],
) -> None:
    manifest = {
        "race_id": race.race_id,
        "generated_at": now_iso(),
        "rows": {name: int(len(f)) for name, f in frames.items()},
        "bytes": {name: (out / f"{name}.parquet").stat().st_size for name in frames},
        "seed_committees": sorted(seed),
        "neighborhood": hop_log,
        "sources": {
            **{
                bf.archive: {
                    "url": bulk_url(race.cycle, bf),
                    "header": header_url(bf),
                    "downloaded_at": stamps[bf.archive],
                }
                for bf in bulk_files(race.cycle)
            },
            "schedule_e": {
                "url": schedule_e_source_url({c.candidate_id for c in race.candidates}, race.cycle),
                "candidate_ids": [c.candidate_id for c in race.candidates],
                "downloaded_at": now_iso(),
            },
        },
        "individual_contributions_note": (
            "aggregated per (committee, name, zip5, employer, occupation, transaction type, conduit); "
            "N_TRANSACTIONS and FIRST_DT/LAST_DT keep the count and date range; seed committees keep every donor, "
            f"other neighborhood committees keep ORG donors plus their {INDIVIDUALS_PER_COMMITTEE} largest individuals; "
            "conduits' own Sched A is omitted"
        ),
    }
    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {out / 'MANIFEST.json'}")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
