"""stories.json: ranked demo candidates. Top 3 spenders by amount, top 3 by dark share (>= $1M in race), every popup
and single_transfer_funded spender. Narratives are templated from the chain (adjacency language only); a human
verifies and flips `verified`."""

from __future__ import annotations

from .chains_flags import Flags, flag_ids
from .chains_graph import Shares, Walk
from .config import Race
from .util import now_iso

DARK_STORY_MIN_SPEND = 1_000_000


def _dollars(x: float) -> str:
    return f"${x / 1e6:.1f}M" if x >= 1e6 else f"${x:,.0f}"


def _spend_sentence(spender: dict, race: Race) -> str:
    names = {c.candidate_id: c.name for c in race.candidates}
    parts = [
        f"{_dollars(b['amount'])} {'supporting' if b['support_oppose'] == 'S' else 'opposing'} {names[b['candidate_id']]}"
        for b in spender["by_candidate"]
    ]
    return f"{spender['name']} reported {_dollars(spender['total'])} in independent expenditures in this race ({'; '.join(parts)})."


def _largest_dark(w: Walk) -> str | None:
    darks = sorted(
        (n for n in w.nodes.values() if n.kind == "organization" and n.visibility == "dark"),
        key=lambda n: n.amount_in,
        reverse=True,
    )
    if not darks:
        return None
    n = darks[0]
    return (
        f"The largest dark source is {n.name} ({_dollars(n.amount_in)}), an organization with no FEC donor-disclosure "
        f"filing on record; the chain stops there."
    )


def _narrative(spender: dict, w: Walk, share: Shares, race: Race) -> str:
    root = w.nodes[w.root]
    s = [
        _spend_sentence(spender, race),
        f"{share[0]:.0%} of its {_dollars(root.amount_in)} in itemized receipts trace to named individuals on FEC "
        f"filings (or to a named business or union giving from its own treasury) within {w.max_depth} hop(s); "
        f"{share[3]:.0%} stop at organizations whose own funding is not on file with the FEC.",
    ]
    dark = _largest_dark(w)
    if dark and share[3] >= 0.05:
        s.append(dark)
    return " ".join(s)


def _story(kind: str, title: str, spender: dict, w: Walk, share: Shares, race: Race) -> dict:
    return {
        "story_id": f"{kind}:{spender['entity_id']}",
        "kind": kind,
        "title": title,
        "root_entity_id": spender["entity_id"],
        "candidate_ids": sorted({b["candidate_id"] for b in spender["by_candidate"]}),
        "headline_numbers": {"amount": spender["total"], "dark_share": round(share[3], 4), "hops": w.max_depth},
        "narrative": _narrative(spender, w, share, race),
        "ad_ids": [],
        "verified": False,
    }


def stories(
    race: Race,
    ledger: dict,
    walks: dict[str, Walk],
    shares: dict[str, Shares],
    flags: Flags,
) -> dict:
    chained = [s for s in ledger["top_outside_spenders"] if s["entity_id"] in walks]
    out: list[dict] = []
    seen: set[str] = set()

    def add(kind: str, title: str, s: dict) -> None:
        eid = s["entity_id"]
        if eid not in seen:
            seen.add(eid)
            out.append(_story(kind, title, s, walks[eid], shares[eid], race))

    for s in sorted(chained, key=lambda s: s["total"], reverse=True)[:3]:
        add("biggest_spender", f"Biggest outside spender: {s['name']}", s)
    big = [s for s in chained if s["total"] >= DARK_STORY_MIN_SPEND]
    for s in sorted(big, key=lambda s: shares[s["entity_id"]][3], reverse=True)[:3]:
        add("dark_dead_end", f"Chain hits the dark wall: {s['name']}", s)
    for s in chained:
        ids = flag_ids(flags.get(s["entity_id"], []))
        if "popup" in ids:
            add("popup", f"Pop-up committee: {s['name']}", s)
        if "single_transfer_funded" in ids:
            add("single_transfer", f"One source: {s['name']}", s)
    return {"race_id": race.race_id, "generated_at": now_iso(), "data_status": "real", "stories": out}
