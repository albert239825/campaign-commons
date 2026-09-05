import pandas as pd

from gotham.fec_ie import IE_COLUMNS, iter_schedule_e, schedule_e_frame
from gotham.ingest import dedupe_transfers


def _api_row(**overrides: object) -> dict:
    row = {
        "committee_id": "C00000001",
        "committee": {"name": "SPENDER PAC "},
        "candidate_id": "S6PA00217",
        "support_oppose_indicator": "O",
        "expenditure_amount": 1000.0,
        "expenditure_date": "2024-10-01",
        "dissemination_date": "2024-10-02",
        "payee_name": "Media LLC",
        "expenditure_description": "TV",
        "is_notice": False,
        "filing_form": "F3X",
        "file_number": 1800000,
        "image_number": "202410019000000001",
        "transaction_id": "SE1",
        "amendment_indicator": "N",
    }
    row.update(overrides)
    return row


def test_schedule_e_frame_normalizes_and_drops_nonpositive() -> None:
    out = schedule_e_frame(
        [
            _api_row(),
            _api_row(expenditure_amount=2500.0, transaction_id="SE2"),
            _api_row(expenditure_amount=-1000.0, transaction_id="SE3"),  # refund / void
            _api_row(expenditure_amount=None, transaction_id="SE4"),
        ]
    )
    assert list(out.columns) == IE_COLUMNS
    assert len(out) == 2 and out["expenditure_amount"].sum() == 3500.0
    first = out.iloc[0]
    assert first["committee_name"] == "SPENDER PAC"
    assert first["expenditure_date"] == pd.Timestamp("2024-10-01")
    assert first["file_num"] == "1800000" and first["purpose"] == "TV"
    assert first["pdf_url"] == "https://docquery.fec.gov/cgi-bin/fecimg/?202410019000000001"


def test_iter_schedule_e_follows_keyset_pagination(monkeypatch) -> None:
    calls: list[dict] = []
    pages = [
        {
            "results": [_api_row(), _api_row(transaction_id="SE2")],
            "pagination": {"last_indexes": {"last_index": "111", "last_expenditure_date": "2024-10-01"}},
        },
        {"results": [_api_row(transaction_id="SE3")], "pagination": {"last_indexes": None}},
    ]

    def fake_get(params: dict) -> dict:
        calls.append(params)
        return pages[len(calls) - 1]

    monkeypatch.setattr("gotham.fec_ie._get", fake_get)
    rows = list(iter_schedule_e(2024, {"S6PA00217", "S2PA00661"}))
    assert [r["transaction_id"] for r in rows] == ["SE1", "SE2", "SE3"]
    assert calls[0]["is_notice"] == "false" and calls[0]["most_recent"] == "true"
    assert calls[0]["candidate_id"] == ["S2PA00661", "S6PA00217"] and "last_index" not in calls[0]
    assert calls[1]["last_index"] == "111" and calls[1]["last_expenditure_date"] == "2024-10-01"


def _edge(side: str, amt: float, from_id: str = "C00000002", to_id: str = "C00000001", dt: str = "2024-09-30") -> dict:
    return {
        "from_id": from_id,
        "to_id": to_id,
        "tt": "18K" if side == "A" else "24K",
        "dt": pd.Timestamp(dt),
        "amt": amt,
        "sub_id": f"{side}{amt:.0f}",
        "side": side,
    }


def test_transfer_dedupe_prefers_receiver_row_and_flags_mismatch() -> None:
    raw = pd.DataFrame(
        [
            _edge("A", 5000.0),
            _edge("B", 5000.0),  # sender's Sched B for the same transfer
            _edge("A", 10000.0, dt="2024-10-15"),
            _edge("B", 9000.0, dt="2024-10-15"),  # >1% disagreement
            _edge("B", 700.0, from_id="C00000003"),  # only the sender reported it
        ]
    )
    out = dedupe_transfers(raw).sort_values(["dt", "from_id"]).reset_index(drop=True)
    assert len(out) == 3
    same = out[(out["dt"] == pd.Timestamp("2024-09-30")) & (out["from_id"] == "C00000002")].iloc[0]
    assert same["side"] == "A" and same["tt"] == "18K" and not same["mismatch"] and same["amt_other_side"] == 5000.0
    off = out[out["dt"] == pd.Timestamp("2024-10-15")].iloc[0]
    assert off["amt"] == 10000.0 and off["amt_other_side"] == 9000.0 and bool(off["mismatch"])
    only_b = out[out["from_id"] == "C00000003"].iloc[0]
    assert only_b["side"] == "B" and only_b["amt"] == 700.0 and not only_b["mismatch"]
    assert pd.isna(only_b["amt_other_side"])
