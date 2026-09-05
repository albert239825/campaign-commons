import duckdb
import pandas as pd

from campaign_commons.ingest import individuals_frame

PCC = "C00431056"
ACTBLUE = "C00401224"


def _row(**overrides: object) -> dict:
    row = {
        "CMTE_ID": PCC,
        "NAME": "DOE, JANE",
        "CITY": "PHILADELPHIA",
        "STATE": "PA",
        "ZIP_CODE": "191031234",
        "EMPLOYER": "SELF",
        "OCCUPATION": "NURSE",
        "TRANSACTION_TP": "15E",
        "ENTITY_TP": "IND",
        "OTHER_ID": ACTBLUE,
        "TRANSACTION_DT": "10012024",
        "TRANSACTION_AMT": "50",
        "MEMO_CD": None,
        "SUB_ID": "4100000000000000001",
    }
    row.update(overrides)
    return row


def test_15e_is_attributed_to_the_individual_with_conduit_recorded() -> None:
    con = duckdb.connect()
    con.register(
        "indiv",
        pd.DataFrame(
            [
                _row(),
                _row(TRANSACTION_AMT="25", TRANSACTION_DT="11012024", SUB_ID="4100000000000000002"),
                # direct contribution, no conduit
                _row(TRANSACTION_TP="15", OTHER_ID=None, SUB_ID="4100000000000000003"),
                # memo line: excluded
                _row(MEMO_CD="X", SUB_ID="4100000000000000004"),
                # ActBlue's own Sched A for the same earmark: skipped, would double count
                _row(CMTE_ID=ACTBLUE, TRANSACTION_TP="15", OTHER_ID=None, SUB_ID="4100000000000000005"),
                # outside the cycle window
                _row(TRANSACTION_DT="12312022", SUB_ID="4100000000000000006"),
            ]
        ),
    )
    out = individuals_frame(con, {PCC, ACTBLUE}, {PCC}, 2024).sort_values("TRANSACTION_TP").reset_index(drop=True)

    assert set(out["CMTE_ID"]) == {PCC}
    assert len(out) == 2
    direct, earmarked = out.iloc[0], out.iloc[1]
    assert direct["TRANSACTION_TP"] == "15" and pd.isna(direct["CONDUIT_ID"]) and direct["TRANSACTION_AMT"] == 50
    assert earmarked["TRANSACTION_TP"] == "15E"
    assert earmarked["NAME"] == "DOE, JANE" and earmarked["CONDUIT_ID"] == ACTBLUE
    assert earmarked["TRANSACTION_AMT"] == 75 and earmarked["N_TRANSACTIONS"] == 2
    assert pd.Timestamp(earmarked["FIRST_DT"]) == pd.Timestamp("2024-10-01")
    assert pd.Timestamp(earmarked["LAST_DT"]) == pd.Timestamp("2024-11-01")
    assert earmarked["ZIP5"] == "19103"
