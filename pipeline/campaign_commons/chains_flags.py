"""Flags written back into entities/*.json, ledger.top_outside_spenders[].flags and chains/*.json.

popup                  first observed money (receipt or IE) after POPUP_AFTER, the pre-general report cutoff, so
                       the committee's donors were not public before the election (cm24 has no registration date;
                       first activity is the proxy, D-34).
single_transfer_funded one counterparty supplies >= 90% of the spender's loaded receipts.
dead_end_dark          chain dark_share >= 0.25.
transfer_mismatch      an inbound or outbound transfer where sender Sched B and receiver Sched A disagree > 1% (D-31),
                       except between a candidate's principal committee and its own joint fundraising committee
                       (D-42: JFC designation 'J' plus the same CAND_ID, the principal's CONNECTED_ORG_NM, or the
                       candidate's surname in the JFC name).
shell_cluster          2..SHELL_CLUSTER_MAX neighborhood committees share normalized street + treasurer; larger
                       clusters are compliance firms and are logged, not flagged (D-35). Authorized candidate
                       committees, joint fundraising committees, and committees sharing a connected organization
                       are excluded: sharing an agent inside one campaign or sponsor family is ordinary (D-37).
one_way_valve_violation a super PAC (O/U) -> candidate/party money edge anywhere in the loaded transfers.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

import duckdb

from .chains_graph import SUPER_PAC_TYPES, VALVE_TARGET_TYPES, Graph, Shares, Walk
from .config import Race
from .util import fec_committee_url, fec_receipts_url

Flags = dict[str, list[dict]]

POPUP_AFTER = date(2024, 10, 17)  # pre-general report cutoff
SINGLE_SOURCE_SHARE = 0.9
DARK_DEAD_END = 0.25
SHELL_CLUSTER_MAX = 10


def flag_ids(flags: list[dict]) -> list[str]:
    return sorted({f["id"] for f in flags})


def _flag(fid: str, label: str, detail: str, url: str) -> dict:
    return {"id": fid, "label": label, "detail": detail, "evidence_url": url}


def _norm_street(s: str | None) -> str:
    s = re.sub(r"[^A-Z0-9 ]", "", (s or "").upper())
    s = re.sub(r"\b(SUITE|STE|UNIT|APT|FLOOR|FL|PMB|#)\b.*$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _norm_org(s: str | None) -> str:
    s = re.sub(r"[^A-Z0-9 ]", "", (s or "").upper())
    s = re.sub(r"\b(INC|LLC|CORP|CORPORATION|CO|LTD|PAC)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class CommitteeMeta:
    designation: str | None
    cand_id: str | None
    connected_org: str | None
    name: str


def is_own_jfc_pair(a: str, b: str, meta: dict[str, CommitteeMeta], surnames: dict[str, str]) -> bool:
    """True when one side is a candidate's principal committee and the other is a JFC that campaign takes part in.

    JFC participants are not in the FEC committee master, so participation is inferred from (any of): the JFC carrying
    the same CAND_ID, the principal committee naming the JFC as its CONNECTED_ORG_NM, or the candidate's surname
    appearing as a word in the JFC's name.
    """
    for principal, jfc in ((a, b), (b, a)):
        p, j = meta.get(principal), meta.get(jfc)
        if p is None or j is None or p.designation != "P" or not p.cand_id or j.designation != "J":
            continue
        if j.cand_id == p.cand_id:
            return True
        if _norm_org(p.connected_org) and _norm_org(p.connected_org) == _norm_org(j.name):
            return True
        surname = surnames.get(p.cand_id)
        if surname and re.search(rf"\b{re.escape(surname)}\b", j.name.upper()):
            return True
    return False


def _distinct_sponsors(members: list[tuple[str, str, str | None]]) -> list[tuple[str, str]]:
    """Drop committees whose connected organization another member shares (one sponsor's PAC family)."""
    orgs = [org for _, _, org in members if org]
    shared = {org for org in orgs if orgs.count(org) > 1}
    return [(cid, name) for cid, name, org in members if not org or org not in shared]


def compute_flags(
    con: duckdb.DuckDBPyConnection,
    race: Race,
    graph: Graph,
    walks: dict[str, Walk],
    shares: dict[str, Shares],
    spenders: list[dict],
) -> Flags:
    flags: Flags = defaultdict(list)
    cycle = race.cycle
    first_ie = {
        cid: d
        for cid, d in con.execute(
            "SELECT committee_id, min(coalesce(expenditure_date, dissemination_date))::DATE FROM ies GROUP BY 1"
        ).fetchall()
    }
    first_receipt = {
        cid: d
        for cid, d in con.execute(
            """
            SELECT cid, min(d)::DATE FROM (
              SELECT to_id AS cid, dt AS d FROM transfers
              UNION ALL SELECT CMTE_ID, FIRST_DT FROM individuals
            ) GROUP BY cid
            """
        ).fetchall()
    }

    for s in spenders:
        eid, name = s["entity_id"], s["name"]
        url = fec_committee_url(eid, cycle)
        dates = [d for d in (first_ie.get(eid), first_receipt.get(eid)) if d]
        first_seen = min(dates) if dates else None
        if first_seen and first_seen > POPUP_AFTER:
            flags[eid].append(
                _flag(
                    "popup",
                    "Pop-up committee",
                    f"{name}'s first reported activity in the {cycle} cycle is {first_seen.isoformat()}, after the "
                    f"pre-general report cutoff ({POPUP_AFTER.isoformat()}), so its donors were not on file before "
                    "election day. Registration date is proxied by first observed activity in FEC bulk data.",
                    url,
                )
            )
        edges = graph.inbound.get(eid, [])
        total = graph.total_in(eid)
        if edges and total and edges[0].amount / total >= SINGLE_SOURCE_SHARE:
            top = edges[0]
            flags[eid].append(
                _flag(
                    "single_transfer_funded",
                    "Funded by a single source",
                    f"{top.name} supplied ${top.amount:,.0f} of {name}'s ${total:,.0f} itemized receipts "
                    f"({top.amount / total:.0%}).",
                    fec_receipts_url(eid, cycle),
                )
            )
        if eid in shares and shares[eid][3] >= DARK_DEAD_END:
            flags[eid].append(
                _flag(
                    "dead_end_dark",
                    "Chain ends at undisclosed donors",
                    f"{shares[eid][3]:.0%} of {name}'s receipts stop at organizations whose own funding is not on file "
                    f"(advocacy nonprofits, LLCs, trusts) rather than at named individuals, businesses or unions.",
                    url,
                )
            )

    meta = {
        cid: CommitteeMeta(dsgn, cand, org, name)
        for cid, dsgn, cand, org, name in con.execute(
            "SELECT CMTE_ID, CMTE_DSGN, CAND_ID, CONNECTED_ORG_NM, CMTE_NM FROM committees"
        ).fetchall()
    }
    surnames = {
        cand_id: name.split(",")[0].strip().upper()
        for cand_id, name in con.execute(
            "SELECT CAND_ID, CAND_NAME FROM candidates WHERE CAND_NAME IS NOT NULL"
        ).fetchall()
    }
    mismatches: dict[str, dict[str, float]] = defaultdict(dict)
    own_jfc = 0
    for w in walks.values():
        for node_id, cp, amt in w.mismatch_counterparties:
            if node_id not in graph.committee_type:
                continue
            if is_own_jfc_pair(node_id, cp, meta, surnames):
                own_jfc += 1
                continue
            mismatches[node_id][cp] = amt
    if own_jfc:
        print(f"transfer_mismatch: skipped {own_jfc} principal-committee <-> own-JFC pair(s)")
    for node_id, by_cp in mismatches.items():
        top = sorted(by_cp.items(), key=lambda kv: kv[1], reverse=True)
        listed = ", ".join(f"{graph.committee_name.get(cp, cp)} (${amt:,.0f})" for cp, amt in top[:3])
        more = f" and {len(top) - 3} more" if len(top) > 3 else ""
        flags[node_id].append(
            _flag(
                "transfer_mismatch",
                "Sender and receiver reports disagree",
                f"Transfers into {graph.committee_name.get(node_id, node_id)} from {listed}{more}, as itemized on the "
                f"receiver's Schedule A, differ by more than 1% from what the sender reported on Schedule B.",
                fec_receipts_url(node_id, cycle),
            )
        )

    valve = con.execute(
        f"""
        SELECT t.from_id, t.to_id, sum(t.amt)
        FROM transfers t JOIN committees a ON a.CMTE_ID = t.from_id JOIN committees b ON b.CMTE_ID = t.to_id
        WHERE a.CMTE_TP IN ({",".join(f"'{x}'" for x in sorted(SUPER_PAC_TYPES))})
          AND b.CMTE_TP IN ({",".join(f"'{x}'" for x in sorted(VALVE_TARGET_TYPES))})
        GROUP BY 1, 2
        """
    ).fetchall()
    for from_id, to_id, amt in valve:
        detail = (
            f"FEC bulk data records ${amt:,.0f} moving from {graph.committee_name.get(from_id, from_id)} "
            f"(independent-expenditure-only committee) to {graph.committee_name.get(to_id, to_id)} "
            f"(candidate or party committee). Super PACs may not contribute to candidates or parties; this is either a "
            f"reporting error or a story. Not traversed by the chain walk."
        )
        for eid in (from_id, to_id):
            flags[eid].append(
                _flag(
                    "one_way_valve_violation",
                    "Super PAC to candidate/party money edge",
                    detail,
                    fec_receipts_url(to_id, cycle),
                )
            )
        print(f"one_way_valve_violation: {from_id} -> {to_id} ${amt:,.0f}")

    clusters: dict[tuple[str, str], list[tuple[str, str, str | None]]] = defaultdict(list)
    for cid, street, treasurer, name, connected in con.execute(
        """
        SELECT CMTE_ID, CMTE_ST1, TRES_NM, CMTE_NM, CONNECTED_ORG_NM FROM committees
        WHERE CMTE_ST1 IS NOT NULL AND TRES_NM IS NOT NULL
          AND coalesce(CAND_ID, '') = '' AND coalesce(CMTE_DSGN, '') <> 'J'
        """
    ).fetchall():
        key = (_norm_street(street), re.sub(r"[^A-Z]", "", treasurer.upper()))
        if key[0] and key[1]:
            clusters[key].append((cid, name, _norm_org(connected)))
    for (street, _), found in clusters.items():
        members = _distinct_sponsors(found)
        if len(members) < 2:
            continue
        if len(members) > SHELL_CLUSTER_MAX:
            print(f"shell_cluster skipped ({len(members)} committees, likely a compliance firm): {street}")
            continue
        for cid, name in members:
            others = ", ".join(f"{n} ({c})" for c, n in members if c != cid)
            flags[cid].append(
                _flag(
                    "shell_cluster",
                    "Shares address and treasurer",
                    f"{name} lists the same street address and treasurer as {others}.",
                    fec_committee_url(cid, cycle),
                )
            )
    return dict(flags)
