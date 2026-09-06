"""Spending side of a funding chain: root → vendor → ad ⇢ candidate.

Patches every ``chains/<entity>.json`` with ``side: "out"`` nodes and ``money`` / ``placement`` / ``targeting`` edges
built from the root's own IE rows (``entities/<id>.json``), its vendor roll-up when ``campaign_commons.vendors`` has run, and its
Google ads (``ads.json``, with ``vendor_links`` when ``campaign_commons.ads_enrich`` has run). Runs after those stages; safe to
re-run (it strips the previous spending side first) and safe when vendor / ad enrichment is absent.

Evidence: root → vendor money edges and every targeting edge are read off Schedule E (``filed``). Vendor → ad edges
copy the ``basis`` of the ad's ``vendor_links`` entry. Root → ad edges are ``verified`` when a person matched the ad's
advertiser to the committee, else ``inferred`` from the advertiser-name match. Ad dollars are the midpoint of Google's
spend range and say so. No dollars reach a candidate: targeting edges are drawn, never summed into anything.
"""

from __future__ import annotations

import sys
import time
from collections import defaultdict
from pathlib import Path

from .config import RACES, Race
from .util import fec_candidate_url, fec_ie_candidate_url, range_midpoint, read_json, write_json

OUT = "out"
MAX_AD_NODES = 10
IE_TRANSACTION_TYPE = "24E"

METHOD_NOTE = (
    " Spending side (right of the spender): Schedule E payments to vendors are money edges; vendor → ad and spender → ad "
    "edges are placement (no dollars) and carry the evidence basis they were drawn on; edges into a candidate are targeting "
    "(for/against) and never carry money to the candidate. Ad dollars are the midpoint of the Google-reported spend range."
)


def _filed(rule: str, source_urls: list[str]) -> dict:
    return {"basis": "filed", "rule": rule, "source_urls": source_urls, "checked_by": None, "checked_at": None}


def _inferred(rule: str, source_urls: list[str]) -> dict:
    return {"basis": "inferred", "rule": rule, "source_urls": source_urls, "checked_by": None, "checked_at": None}


midpoint = range_midpoint


def _date_range(dates: list[str | None]) -> list[str] | None:
    ds = sorted(d for d in dates if d)
    return [ds[0], ds[-1]] if ds else None


def strip_out_side(chain: dict) -> dict:
    """Remove a previous spending side so the stage is idempotent."""
    out_ids = {n["id"] for n in chain["nodes"] if n.get("side") == "out"}
    chain["nodes"] = [n for n in chain["nodes"] if n.get("side") != "out"]
    chain["edges"] = [e for e in chain["edges"] if e["from"] not in out_ids and e["to"] not in out_ids]
    chain["summary"].pop("out_total", None)
    chain["summary"].pop("max_out_depth", None)
    chain["method"] = chain["method"].replace(METHOD_NOTE, "")
    return chain


def _node(
    node_id: str,
    name: str,
    kind: str,
    depth: int,
    amount: float,
    source_url: str | None,
    href: str | None,
    **extra: object,
) -> dict:
    n: dict = {
        "id": node_id,
        "name": name,
        "kind": kind,
        "committee_type": None,
        "depth": depth,
        "side": OUT,
        "visibility": "disclosed",
        "amount_in": round(amount, 2),
        "is_terminus": kind in ("candidate", "aggregate"),
        "terminus_reason": None,
        "source_url": source_url,
    }
    if href:
        n["href"] = href
    n.update({k: v for k, v in extra.items() if v is not None})
    return n


def _edge(src: str, dst: str, kind: str, amount: float, depth: int, **extra: object) -> dict:
    e: dict = {
        "from": src,
        "to": dst,
        "kind": kind,
        "amount": round(amount, 2),
        "visibility": "disclosed",
        "depth": depth,
        "transaction_types": [IE_TRANSACTION_TYPE] if kind == "money" else [],
        "count": 0,
        "date_range": None,
        "source_url": None,
    }
    e.update(extra)
    return e


def _ad_name(ad: dict) -> str:
    when = " – ".join(d for d in (ad.get("first_shown"), ad.get("last_shown")) if d)
    return f"{ad['ad_type'].title()} ad" + (f" · {when}" if when else f" · {ad['ad_id']}")


def _ad_parent_edge(ad: dict, ad_node_id: str, root: str, vendor_ids: set[str], depth: int) -> tuple[list[dict], bool]:
    """Placement edges into an ad node. Returns (edges, attached_to_vendor)."""
    edges: list[dict] = []
    links = [link for link in ad.get("vendor_links") or [] if f"vendor:{link['vendor_id']}" in vendor_ids]
    strong = [link for link in links if link["basis"]["basis"] in ("verified", "inferred")]
    amount = midpoint(ad["spend_range"])
    for link in links:
        is_parent = link in strong
        edges.append(
            _edge(
                f"vendor:{link['vendor_id']}",
                ad_node_id,
                "placement",
                amount if is_parent else 0,
                depth,
                count=int(link["buys_in_window"]),
                date_range=list(link["window"]),
                source_url=(link["basis"]["source_urls"] or [None])[0],
                basis=link["basis"],
            )
        )
    if strong:
        return edges, True
    verification = ad.get("verification") or {}
    if (
        verification.get("status") == "verified"
        and verification.get("verified_at")
        and verification.get("evidence_urls")
    ):
        basis = {
            "basis": "verified",
            "rule": "A person matched this ad's advertiser to the committee using the ad library and fec.gov records",
            "source_urls": list(verification["evidence_urls"]),
            "checked_by": "hand (pipeline/campaign_commons/data/ad_verifications.json)",
            "checked_at": verification["verified_at"],
        }
    else:
        basis = _inferred(
            "Advertiser name matched to this committee by normalized name; Google's bulk data names the advertiser and carries no "
            "paid-for-by field for US ads",
            [ad["source_url"]],
        )
    edges.append(_edge(root, ad_node_id, "placement", amount, depth, count=1, source_url=ad["source_url"], basis=basis))
    return edges, False


def build_out_side(
    race: Race,
    root: str,
    entity: dict,
    ads: list[dict],
    dossier_ids: set[str],
    max_ad_nodes: int = MAX_AD_NODES,
) -> tuple[list[dict], list[dict], dict]:
    """Spending-side nodes, edges and summary fields for one chain root."""
    ies: list[dict] = entity.get("independent_expenditures") or []
    vendors: list[dict] = entity.get("vendors") or []
    cand_names = {c.candidate_id: c.name for c in race.candidates}
    for ie in ies:
        cand_names.setdefault(ie["candidate_id"], ie["candidate_name"])

    own_ads = sorted((a for a in ads if a.get("matched_entity_id") == root), key=lambda a: -midpoint(a["spend_range"]))
    nodes: list[dict] = []
    edges: list[dict] = []
    d_vendor = 1
    d_ad = 2 if vendors else 1
    d_cand = d_ad + 1 if own_ads else d_ad

    vendor_ids: set[str] = set()
    for v in vendors:
        vid = f"vendor:{v['vendor_id']}"
        vendor_ids.add(vid)
        mix = sorted(v.get("media_mix") or [], key=lambda m: -m["amount"])
        nodes.append(
            _node(
                vid,
                v["name"],
                "vendor",
                d_vendor,
                v["amount"],
                v["source_url"],
                f"/races/{race.race_id}/vendors/{v['vendor_id']}",
                medium=mix[0]["medium"] if mix else None,
                basis=_filed(
                    "Schedule E payee, grouped by normalized vendor name (campaign_commons.vendors)", [v["source_url"]]
                ),
            )
        )
        edges.append(
            _edge(
                root,
                vid,
                "money",
                v["amount"],
                d_vendor,
                count=int(v["count"]),
                date_range=[v["first_date"], v["last_date"]] if v.get("first_date") and v.get("last_date") else None,
                source_url=v["source_url"],
                basis=_filed("Schedule E independent expenditure paid to this payee", [v["source_url"]]),
            )
        )
        for t in v.get("targets") or []:
            edges.append(
                _edge(
                    vid,
                    t["candidate_id"],
                    "targeting",
                    t["amount"],
                    d_cand,
                    support_oppose=t["support_oppose"],
                    source_url=fec_ie_candidate_url(root, t["candidate_id"], race.cycle),
                    basis=_filed(
                        "Schedule E: this payee's buys named the candidate as supported/opposed", [v["source_url"]]
                    ),
                )
            )

    # Candidate targets: dollars aimed at each candidate, from the IE rows (always filed).
    by_target: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for ie in ies:
        by_target[(ie["candidate_id"], ie["support_oppose"])].append(ie)
    cand_total: dict[str, float] = defaultdict(float)
    for (cid, so), rows in sorted(by_target.items()):
        amount = sum(float(r["amount"]) for r in rows)
        cand_total[cid] += amount
        if not vendors:
            edges.append(
                _edge(
                    root,
                    cid,
                    "targeting",
                    amount,
                    d_cand,
                    count=len(rows),
                    date_range=_date_range([r.get("date") for r in rows]),
                    support_oppose=so,
                    source_url=fec_ie_candidate_url(root, cid, race.cycle),
                    basis=_filed(
                        "Schedule E independent expenditures naming this candidate as supported/opposed",
                        [fec_ie_candidate_url(root, cid, race.cycle)],
                    ),
                )
            )

    # Ads: top N by spend midpoint as nodes, the rest folded into one aggregate so the picture stays legible.
    shown, rest = own_ads[:max_ad_nodes], own_ads[max_ad_nodes:]
    ads_href = f"/races/{race.race_id}/ads"
    ad_cands: dict[str, list[dict]] = defaultdict(list)
    for ad in shown:
        amount = midpoint(ad["spend_range"])
        hi = ad["spend_range"].get("max")
        rng = f"${ad['spend_range']['min']:,.0f}–${hi:,.0f}" if hi is not None else f"${ad['spend_range']['min']:,.0f}+"
        nodes.append(
            _node(
                ad["ad_id"],
                _ad_name(ad),
                "ad",
                d_ad,
                amount,
                ad["source_url"],
                f"{ads_href}/{ad['ad_id']}",
                thumbnail_path=ad.get("cached_creative_path"),
                basis=_inferred(f"Google reports spend as a range ({rng}); the midpoint is drawn", [ad["source_url"]]),
            )
        )
        ad_edges, _ = _ad_parent_edge(ad, ad["ad_id"], root, vendor_ids, d_ad)
        edges.extend(ad_edges)
        for cid in ad.get("candidate_ids") or []:
            ad_cands[cid].append(ad)
            edges.append(
                _edge(
                    ad["ad_id"],
                    cid,
                    "targeting",
                    amount,
                    d_cand,
                    count=1,
                    date_range=[ad["first_shown"], ad["last_shown"]]
                    if ad.get("first_shown") and ad.get("last_shown")
                    else None,
                    support_oppose=ad.get("support_oppose") or "S",
                    source_url=ad["source_url"],
                    basis=_inferred(
                        "The advertiser is this candidate's own campaign committee, so the ad is counted as supporting them",
                        [ad["source_url"]],
                    ),
                )
            )
    if rest:
        amount = sum(midpoint(a["spend_range"]) for a in rest)
        agg_id = f"agg:ads@{root}"
        nodes.append(
            _node(
                agg_id,
                f"{len(rest)} more ads",
                "aggregate",
                d_ad,
                amount,
                None,
                ads_href,
                contributor_count=len(rest),
                terminus_reason="pruned",
                basis=_inferred(
                    "Sum of Google spend-range midpoints for the ads not drawn individually",
                    [a["source_url"] for a in rest[:5]],
                ),
            )
        )
        edges.append(
            _edge(
                root,
                agg_id,
                "placement",
                amount,
                d_ad,
                count=len(rest),
                basis=_inferred(
                    "Advertiser name matched to this committee by normalized name", [a["source_url"] for a in rest[:5]]
                ),
            )
        )

    for cid in sorted(set(cand_total) | set(ad_cands)):
        ie_amount = cand_total.get(cid, 0.0)
        ad_amount = sum(midpoint(a["spend_range"]) for a in ad_cands.get(cid, []))
        ie_url = fec_ie_candidate_url(root, cid, race.cycle)
        basis = (
            _inferred(
                "Schedule E dollars aimed at this candidate plus the drawn ads' spend-range midpoints; nothing here reached the candidate",
                [ie_url],
            )
            if ad_amount
            else _filed(
                "Schedule E dollars naming this candidate as supported or opposed; nothing here reached the candidate",
                [ie_url],
            )
        )
        nodes.append(
            _node(
                cid,
                cand_names.get(cid, cid),
                "candidate",
                d_cand,
                ie_amount + ad_amount,
                fec_candidate_url(cid, race.cycle),
                f"/races/{race.race_id}/candidates/{cid}" if cid in dossier_ids else f"/races/{race.race_id}",
                basis=basis,
            )
        )

    out_total = sum(float(ie["amount"]) for ie in ies)
    summary = {"out_total": round(out_total, 2), "max_out_depth": max([n["depth"] for n in nodes], default=0)}
    return nodes, edges, summary


def patch_chain(race: Race, chain: dict, entity: dict, ads: list[dict], dossier_ids: set[str]) -> dict:
    chain = strip_out_side(chain)
    nodes, edges, summary = build_out_side(race, chain["root_entity_id"], entity, ads, dossier_ids)
    if not nodes:
        return chain
    chain["nodes"].extend(nodes)
    chain["edges"].extend(edges)
    chain["summary"].update(summary)
    chain["method"] = chain["method"] + METHOD_NOTE
    return chain


def run(race_id: str) -> None:
    started = time.time()
    race = RACES[race_id]
    chains_dir: Path = race.out_dir / "chains"
    ads_path = race.out_dir / "ads.json"
    ads: list[dict] = read_json(ads_path)["ads"] if ads_path.exists() else []
    dossier_ids = {p.stem for p in (race.out_dir / "dossiers").glob("*.json")}
    patched = with_vendors = ad_nodes = 0
    for path in sorted(chains_dir.glob("*.json")):
        chain = read_json(path)
        entity_path = race.out_dir / "entities" / f"{chain['root_entity_id']}.json"
        if not entity_path.exists():
            continue
        entity = read_json(entity_path)
        chain = patch_chain(race, chain, entity, ads, dossier_ids)
        write_json(path, chain)
        patched += 1
        with_vendors += bool(entity.get("vendors"))
        ad_nodes += sum(1 for n in chain["nodes"] if n.get("side") == OUT and n["kind"] == "ad")
    print(
        f"chains-out: {patched} chains patched ({with_vendors} with vendor nodes, {ad_nodes} ad nodes, "
        f"{len(ads)} ads read); {time.time() - started:.1f}s"
    )


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
