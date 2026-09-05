"""FEC bulk files: streaming download, unzip, and DuckDB views with the official header rows.

Files (2024 cycle): cm (committee master), cn (candidate master), ccl (candidate-committee linkage),
oth (Sched A "other" = committee-to-committee receipts), pas2 (committee contributions to candidates),
indiv (Sched A individual contributions, ~2GB zipped), weball (candidate financial summaries), webk (PAC/party
financial summaries). Pipe-delimited, no header, stray quotes. Column names come from the official header files,
except weball/webk which have none published; theirs are transcribed from the FEC data descriptions
(https://www.fec.gov/campaign-finance-data/all-candidates-file-description/ and .../pac-and-party-summary-file-description/).
Schedule E is not a bulk file here; see fec_ie.py.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests

from .config import FEC_BULK, RAW
from .util import now_iso

HEADER_BASE = "https://www.fec.gov/files/bulk-downloads/data_dictionaries"


WEBALL_COLUMNS = (
    "CAND_ID", "CAND_NAME", "CAND_ICI", "PTY_CD", "CAND_PTY_AFFILIATION", "TTL_RECEIPTS", "TRANS_FROM_AUTH",
    "TTL_DISB", "TRANS_TO_AUTH", "COH_BOP", "COH_COP", "CAND_CONTRIB", "CAND_LOANS", "OTHER_LOANS",
    "CAND_LOAN_REPAY", "OTHER_LOAN_REPAY", "DEBTS_OWED_BY", "TTL_INDIV_CONTRIB", "CAND_OFFICE_ST",
    "CAND_OFFICE_DISTRICT", "SPEC_ELECTION", "PRIM_ELECTION", "RUN_ELECTION", "GEN_ELECTION",
    "GEN_ELECTION_PRECENT", "OTHER_POL_CMTE_CONTRIB", "POL_PTY_CONTRIB", "CVG_END_DT", "INDIV_REFUNDS",
    "CMTE_REFUNDS",
)  # fmt: skip
WEBK_COLUMNS = (
    "CMTE_ID", "CMTE_NM", "CMTE_TP", "CMTE_DSGN", "CMTE_FILING_FREQ", "TTL_RECEIPTS", "TRANS_FROM_AFF",
    "INDV_CONTRIB", "OTHER_POL_CMTE_CONTRIB", "CAND_CONTRIB", "CAND_LOANS", "TTL_LOANS_RECEIVED", "TTL_DISB",
    "TRANF_TO_AFF", "INDV_REFUNDS", "OTHER_POL_CMTE_REFUNDS", "CAND_LOAN_REPAY", "LOAN_REPAY", "COH_BOP",
    "COH_COP", "DEBTS_OWED_BY", "NONFED_TRANS_RECEIVED", "CONTRIB_TO_OTHER_CMTE", "IND_EXP", "PTY_COORD_EXP",
    "NONFED_SHARE_EXP", "CVG_END_DT",
)  # fmt: skip


@dataclass(frozen=True)
class BulkFile:
    name: str  # view name, e.g. "cm"
    archive: str  # zip stem, e.g. "cm24"
    member: str  # .txt inside the zip
    columns: tuple[str, ...] | None = None  # None -> read the official <name>_header_file.csv


def bulk_files(cycle: int) -> tuple[BulkFile, ...]:
    yy = f"{cycle % 100:02d}"
    return (
        BulkFile("cm", f"cm{yy}", "cm.txt"),
        BulkFile("cn", f"cn{yy}", "cn.txt"),
        BulkFile("ccl", f"ccl{yy}", "ccl.txt"),
        BulkFile("oth", f"oth{yy}", "itoth.txt"),
        BulkFile("pas2", f"pas2{yy}", "itpas2.txt"),
        BulkFile("indiv", f"indiv{yy}", "itcont.txt"),
        BulkFile("weball", f"weball{yy}", f"weball{yy}.txt", WEBALL_COLUMNS),
        BulkFile("webk", f"webk{yy}", f"webk{yy}.txt", WEBK_COLUMNS),
    )


def raw_dir(cycle: int) -> Path:
    return RAW / str(cycle)


def bulk_url(cycle: int, bf: BulkFile) -> str:
    return f"{FEC_BULK}/{cycle}/{bf.archive}.zip"


def header_url(bf: BulkFile) -> str | None:
    return None if bf.columns else f"{HEADER_BASE}/{bf.name}_header_file.csv"


def _download(url: str, dest: Path) -> None:
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    part.rename(dest)
    print(f"downloaded {url} -> {dest}")


def ensure_bulk(cycle: int) -> dict[str, str]:
    """Download + extract every bulk file (idempotent). Returns {archive: download timestamp}."""
    stamps: dict[str, str] = {}
    for bf in bulk_files(cycle):
        zip_path = raw_dir(cycle) / f"{bf.archive}.zip"
        fresh = not zip_path.exists()
        _download(bulk_url(cycle, bf), zip_path)
        header = header_url(bf)
        if header:
            _download(header, raw_dir(cycle) / f"{bf.name}_header_file.csv")
        txt = raw_dir(cycle) / bf.member
        if not txt.exists():
            with zipfile.ZipFile(zip_path) as zf:
                zf.extract(bf.member, raw_dir(cycle))
        stamps[bf.archive] = now_iso() if fresh else _iso_mtime(zip_path)
    return stamps


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")


def _columns(cycle: int, bf: BulkFile) -> list[str]:
    if bf.columns:
        return list(bf.columns)
    header = (raw_dir(cycle) / f"{bf.name}_header_file.csv").read_text().strip()
    return [c.strip() for c in header.split(",")]


def connect(cycle: int) -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB with one view per bulk file, columns named per the FEC header file, all VARCHAR."""
    con = duckdb.connect()
    con.execute("SET memory_limit = '4GB'")
    con.execute("SET preserve_insertion_order = false")
    con.execute(f"SET temp_directory = '{(raw_dir(cycle) / 'duckdb_tmp').as_posix()}'")
    for bf in bulk_files(cycle):
        cols = _columns(cycle, bf)
        col_spec = ", ".join(f"'{c}': 'VARCHAR'" for c in cols)
        path = (raw_dir(cycle) / bf.member).as_posix()
        con.execute(
            f"CREATE VIEW {bf.name} AS SELECT * FROM read_csv('{path}', delim='|', header=false, quote='', "
            f"escape='', ignore_errors=true, columns={{{col_spec}}})"
        )
    return con
