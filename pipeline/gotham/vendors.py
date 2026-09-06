"""Block 2: Schedule E payees -> Vendor records (`make vendors`).

Reads the IE rows already emitted on `entities/<committee_id>.json` (the deduped Schedule E rows, see `fec_ie.py`) and
`data/hand/<race>/vendor_aliases.json`; writes `vendors.json` (VendorIndex) and `vendors/<vendor_id>.json` (Vendor), and
patches each spender's entity file in place with `vendors[]` plus `vendor_id` / `medium` on every IE row. Grouping never
changes totals: the sum over vendors equals the sum of IE rows equals `ledger.json` `traceability.outside_total`.

Payee normalisation (deterministic, no embeddings, no network):
  1. uppercase -> punctuation to spaces -> collapse whitespace -> strip trailing legal suffixes (INC, LLC, LP, LTD, CO,
     CORP, COMPANY, ...; GROUP is not a suffix) -> token-sort. Identical keys are one vendor.
  2. residual near-duplicates: `difflib.SequenceMatcher` ratio on the token-sorted key >= 0.92, and the two keys must carry
     the same numeric tokens (so "UNITE HERE LOCAL 23" never folds into "LOCAL 25"). Every merge is printed for review.
  3. `vendor_aliases.json` wins over both: each listed raw payee string is moved to the hand vendor (basis "verified").
  vendor_id = "V-" + slug(canonical name); `aliases[]` = every raw payee string that mapped to the vendor.

Medium classification (ordered; first match on the filed `purpose` wins; keywords match at word starts, so "GOTV" is not
"TV" and "EMAIL" is not "MAIL"):
  production   PRODUC-, CREATIVE, DESIGN, VIDEOGRAPH-, PHOTOGRAPH-, FILMING
  digital      DIGITAL, ONLINE, INTERNET, WEB, SOCIAL, STREAMING, EMAIL, YOUTUBE, FACEBOOK, GOOGLE, META, GIF
  radio        RADIO
  tv           TV, TELEVISION, BROADCAST, CABLE, "MEDIA BUY", "MEDIA PLACEMENT"
  mail         MAIL-, POSTAGE, POSTCARD-, PRINT-
  phones       PHONE-, TEXT-, SMS, ROBOCALL-, CALL-, DIAL-, TELECONFERENC-
  consulting   POLL-, RESEARCH, CONSULT-, STRATEG-, LIST, TARGETING, "VOTER FILE"
  other        everything else (canvassing, staff time, events, ...)
A hand alias row's `medium_override` replaces the classified medium for every IE of that vendor. Raw `purpose` is never
changed. The FEC does not record which buy placed which ad; `Vendor.ads` stays empty until a hand-verified link exists.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote_plus

from .config import FEC_WEB, RACES, ROOT, Race
from .util import now_iso, read_json, write_json

HAND = ROOT / "data" / "hand"

LEGAL_SUFFIXES = frozenset(
    {"INC", "INCORPORATED", "LLC", "LP", "LLP", "PLLC", "LTD", "LIMITED", "CO", "CORP", "CORPORATION", "COMPANY"}
)
SIMILARITY_THRESHOLD = 0.92
RULE_TEXT = "case/punctuation/suffix normalisation + token-set ≥0.92 (numeric tokens must match); aliases file"

# (medium, keyword stems). First matching row wins; stems match at a word boundary and may continue ("PRODUC" -> PRODUCTION).
MEDIUM_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("production", ("PRODUC", "CREATIVE", "DESIGN", "VIDEOGRAPH", "PHOTOGRAPH", "FILMING")),
    (
        "digital",
        (
            "DIGITAL",
            "ONLINE",
            "INTERNET",
            "WEB",
            "SOCIAL",
            "STREAMING",
            "EMAIL",
            "YOUTUBE",
            "FACEBOOK",
            "GOOGLE",
            "META",
            "GIF",
        ),
    ),
    ("radio", ("RADIO",)),
    ("tv", ("TV", "TELEVISION", "BROADCAST", "CABLE", "MEDIA BUY", "MEDIA PLACEMENT")),
    ("mail", ("MAIL", "POSTAGE", "POSTCARD", "PRINT")),
    ("phones", ("PHONE", "TEXT", "SMS", "ROBOCALL", "CALL", "DIAL", "TELECONFERENC")),
    ("consulting", ("POLL", "RESEARCH", "CONSULT", "STRATEG", "LIST", "TARGETING", "VOTER FILE")),
)
# Stems that must end at a word boundary (otherwise "META" would match "METADATA" or "LIST" would match "LISTED").
_WHOLE_WORD = frozenset({"TV", "META", "GIF", "SMS", "LIST"})
_MEDIUM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (medium, re.compile("|".join(rf"\b{re.escape(k)}" + (r"\b" if k in _WHOLE_WORD else "") for k in kws)))
    for medium, kws in MEDIUM_RULES
)
MEDIUM_TABLE_NOTE = (
    "; ".join(f"{m}: {', '.join(k.lower() for k in kws)}" for m, kws in MEDIUM_RULES) + "; other: no match"
)
MEDIUM_RULE_TEXT = (
    "Medium is classified from the purpose string the spender filed on Schedule E, by an ordered keyword table (first "
    "match wins, keywords matched at word starts): " + MEDIUM_TABLE_NOTE + ". The FEC does not record which buy placed "
    "which ad."
)
FEC_SCHEDULE_E_DOC = "https://www.fec.gov/campaign-finance-data/independent-expenditures-file-description/"


def normalize_payee(raw: str) -> str:
    """Uppercase, punctuation -> space, collapse whitespace, strip trailing legal suffixes. Keeps token order."""
    s = re.sub(r"\bL\.L\.C\b\.?", "LLC", raw.upper())
    tokens = re.sub(r"[^A-Z0-9]+", " ", s).split()
    while len(tokens) > 1 and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def token_sort_key(normalized: str) -> str:
    return " ".join(sorted(normalized.split()))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def _numeric_tokens(key: str) -> frozenset[str]:
    return frozenset(t for t in key.split() if t.isdigit())


def classify_medium(purpose: str | None) -> str:
    text = (purpose or "").upper()
    for medium, pattern in _MEDIUM_PATTERNS:
        if pattern.search(text):
            return medium
    return "other"


def fec_ie_payee_url(payees: list[str], cycle: int, spender_id: str | None = None) -> str:
    """fec.gov Schedule E browse filtered to one or more payee strings (and optionally one spender).

    The browse UI honours `payee_name` (repeatable, OR-ed) and takes the spender in `q_spender`; `committee_id` is API-only
    and ignored there (browser-verified 2026-09-05: WINSENATE + WATERFRONT STRATEGIES -> 176 rows).
    """
    url = f"{FEC_WEB}/independent-expenditures/?cycle={cycle}&data_type=processed"
    if spender_id:
        url += f"&q_spender={spender_id}"
    return url + "".join(f"&payee_name={quote_plus(p)}" for p in payees[:10])


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


@dataclass
class HandAlias:
    vendor_id: str
    name: str
    aliases: tuple[str, ...]
    medium_override: str | None
    source_url: str | None
    tagged_by: str
    tagged_at: str | None


@dataclass
class VendorGroup:
    vendor_id: str
    name: str
    aliases: list[str]  # raw payee strings, as filed, highest dollars first
    normalization: dict
    medium_override: str | None = None
    rows: list[dict] = field(default_factory=list)


def load_hand_aliases(race_id: str) -> list[HandAlias]:
    path = HAND / race_id / "vendor_aliases.json"
    if not path.exists():
        return []
    rows: list[HandAlias] = []
    for r in read_json(path)["rows"]:
        rows.append(
            HandAlias(
                vendor_id=str(r["vendor_id"]),
                name=str(r["name"]),
                aliases=tuple(str(a) for a in r["aliases"]),
                medium_override=r.get("medium_override"),
                source_url=r.get("source_url"),
                tagged_by=str(r["tagged_by"]),
                tagged_at=r.get("tagged_at"),
            )
        )
    return rows


def cluster_payees(
    payee_totals: dict[str, float], hand: list[HandAlias], cycle: int, log: list[str]
) -> dict[str, VendorGroup]:
    """raw payee -> VendorGroup. Hand aliases first (they win), then exact normalised keys, then fuzzy folds."""
    groups: dict[str, VendorGroup] = {}  # keyed by vendor_id
    by_payee: dict[str, VendorGroup] = {}

    def upper(s: str) -> str:
        return s.strip().upper()

    hand_lookup: dict[str, HandAlias] = {}
    for h in hand:
        for a in h.aliases:
            if upper(a) in hand_lookup:
                raise ValueError(f"vendor_aliases.json lists {a!r} twice")
            hand_lookup[upper(a)] = h

    for h in hand:
        raw_matches = sorted(
            (p for p in payee_totals if upper(p) in {upper(a) for a in h.aliases}),
            key=lambda p: (-payee_totals[p], p),
        )
        if not raw_matches:
            log.append(f"alias-unused  {h.vendor_id}: none of {list(h.aliases)} appear in the data")
            continue
        fec_url = fec_ie_payee_url(raw_matches, cycle)
        sources = [fec_url] if not h.source_url or h.source_url == fec_url else [fec_url, h.source_url]
        groups[h.vendor_id] = VendorGroup(
            vendor_id=h.vendor_id,
            name=h.name,
            aliases=raw_matches,
            normalization={
                "basis": "verified",
                "rule": f"{RULE_TEXT} — hand alias row folds {len(raw_matches)} filed payee string(s) into one vendor",
                "source_urls": sources,
                "checked_by": h.tagged_by,
                "checked_at": h.tagged_at or "",
            },
            medium_override=h.medium_override,
        )
        for p in raw_matches:
            by_payee[p] = groups[h.vendor_id]
            log.append(f"alias  {p!r} -> {h.vendor_id}")

    # exact key clusters for everything the hand file did not claim
    keyed: dict[str, list[str]] = defaultdict(list)
    for p in payee_totals:
        if p not in by_payee:
            keyed[token_sort_key(normalize_payee(p))].append(p)
    key_total = {k: sum(payee_totals[p] for p in ps) for k, ps in keyed.items()}
    ordered_keys = sorted(keyed, key=lambda k: (-key_total[k], k))

    # fuzzy folds: walk keys from largest to smallest; fold into the first accepted key within threshold
    canonical_of: dict[str, str] = {}
    accepted: list[str] = []
    for k in ordered_keys:
        target = None
        for a in accepted:
            if _numeric_tokens(a) != _numeric_tokens(k):
                continue
            r = similarity(a, k)
            if r >= SIMILARITY_THRESHOLD:
                target = a
                log.append(f"merge  {k!r} -> {a!r} (ratio {r:.3f})")
                break
        if target is None:
            accepted.append(k)
            canonical_of[k] = k
        else:
            canonical_of[k] = target

    merged: dict[str, list[str]] = defaultdict(list)
    for k, ps in keyed.items():
        merged[canonical_of[k]].extend(ps)
    for ps in merged.values():
        ps.sort(key=lambda p: (-payee_totals[p], p))
        canonical_raw = ps[0]
        vendor_id = "V-" + slugify(normalize_payee(canonical_raw))
        if vendor_id in groups:
            raise ValueError(f"vendor_id collision: {vendor_id} ({ps} vs {groups[vendor_id].aliases})")
        groups[vendor_id] = VendorGroup(
            vendor_id=vendor_id,
            name=canonical_raw,
            aliases=ps,
            normalization={
                "basis": "inferred",
                "rule": RULE_TEXT,
                "source_urls": [fec_ie_payee_url(ps, cycle)],
                "checked_by": None,
                "checked_at": None,
            },
        )
        for p in ps:
            by_payee[p] = groups[vendor_id]
    return by_payee


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _money(x: float) -> float:
    return round(x, 2)


def _media_mix(rows: list[dict]) -> list[dict]:
    amt: dict[str, float] = defaultdict(float)
    cnt: dict[str, int] = defaultdict(int)
    for r in rows:
        amt[r["medium"]] += r["amount"]
        cnt[r["medium"]] += 1
    return [{"medium": m, "amount": _money(amt[m]), "count": cnt[m]} for m in sorted(amt, key=lambda m: (-amt[m], m))]


def _targets(rows: list[dict]) -> list[dict]:
    amt: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        amt[(r["candidate_id"], r["support_oppose"])] += r["amount"]
    return [
        {"candidate_id": c, "support_oppose": so, "amount": _money(amt[(c, so)])}
        for c, so in sorted(amt, key=lambda k: (-amt[k], k))
    ]


def _spenders(rows: list[dict]) -> list[dict]:
    amt: dict[str, float] = defaultdict(float)
    cnt: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for r in rows:
        cid = r["spender_entity_id"]
        amt[cid] += r["amount"]
        cnt[cid] += 1
        names[cid] = r["spender_name"]
    return [
        {"entity_id": c, "name": names[c], "amount": _money(amt[c]), "count": cnt[c]}
        for c in sorted(amt, key=lambda c: (-amt[c], c))
    ]


def _date_range(rows: list[dict]) -> tuple[str | None, str | None]:
    dates = sorted(r["date"] for r in rows if r.get("date"))
    return (dates[0], dates[-1]) if dates else (None, None)


def _row_sort_key(r: dict) -> tuple:
    return (r["date"] or "", -r["amount"], r["ie_id"])


def vendor_summary(g: VendorGroup) -> dict:
    first, last = _date_range(g.rows)
    return {
        "vendor_id": g.vendor_id,
        "name": g.name,
        "aliases": g.aliases,
        "normalization": g.normalization,
        "total": _money(sum(r["amount"] for r in g.rows)),
        "count": len(g.rows),
        "media_mix": _media_mix(g.rows),
        "spenders": _spenders(g.rows),
        "targets": _targets(g.rows),
        "first_date": first,
        "last_date": last,
        "source_url": g.normalization["source_urls"][0],
    }


def entity_vendor_rows(rows: list[dict], by_payee: dict[str, VendorGroup], cycle: int) -> list[dict]:
    spender = rows[0]["spender_entity_id"]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r.get("vendor_id"):
            grouped[r["vendor_id"]].append(r)
    out = []
    for vid in sorted(grouped, key=lambda v: (-sum(r["amount"] for r in grouped[v]), v)):
        rs = grouped[vid]
        g = by_payee[rs[0]["payee"]]
        first, last = _date_range(rs)
        payees = sorted({r["payee"] for r in rs})
        out.append(
            {
                "vendor_id": vid,
                "name": g.name,
                "amount": _money(sum(r["amount"] for r in rs)),
                "count": len(rs),
                "media_mix": _media_mix(rs),
                "targets": _targets(rs),
                "first_date": first,
                "last_date": last,
                "source_url": fec_ie_payee_url(payees, cycle, spender),
            }
        )
    return out


METHOD = (
    "Every Schedule E independent expenditure names a payee. Payee strings are normalised (case, punctuation, legal "
    "suffixes, token order), near-duplicates are folded with a difflib ratio ≥ 0.92 when their numeric tokens match, and "
    "hand alias rows from data/hand/<race>/vendor_aliases.json override the rule. Medium is classified from the purpose "
    "the spender filed (ordered keyword table in gotham/vendors.py); the FEC does not record which buy placed which ad, so "
    "vendor ↔ ad links are empty until a human verifies one. Totals are the filed amounts, grouped, never re-estimated."
)


def run(race_id: str) -> dict:
    race: Race = RACES[race_id]
    out_dir = race.out_dir
    entities_dir = out_dir / "entities"
    log: list[str] = []

    entity_files: dict[Path, dict] = {}
    rows: list[dict] = []
    for f in sorted(entities_dir.glob("*.json")):
        e = read_json(f)
        ies = e.get("independent_expenditures") or []
        if ies:
            entity_files[f] = e
            rows.extend(ies)
    if not rows:
        raise SystemExit(f"no independent_expenditures under {entities_dir}; run `make ledger` first")

    unresolved = [r for r in rows if not (r.get("payee") or "").strip()]
    resolved = [r for r in rows if (r.get("payee") or "").strip()]
    payee_totals: dict[str, float] = defaultdict(float)
    for r in resolved:
        payee_totals[r["payee"]] += r["amount"]

    hand = load_hand_aliases(race_id)
    by_payee = cluster_payees(dict(payee_totals), hand, race.cycle, log)
    for line in log:
        print(line)

    for r in rows:
        if r in unresolved:
            r["vendor_id"] = None
            r["medium"] = classify_medium(r.get("purpose"))
            continue
        g = by_payee[r["payee"]]
        r["vendor_id"] = g.vendor_id
        r["medium"] = g.medium_override or classify_medium(r.get("purpose"))
        g.rows.append(r)

    groups = sorted(
        {g.vendor_id: g for g in by_payee.values()}.values(),
        key=lambda g: (-sum(r["amount"] for r in g.rows), g.vendor_id),
    )
    generated_at = now_iso()
    summaries = [vendor_summary(g) for g in groups]
    vendor_total = _money(sum(s["total"] for s in summaries))
    ie_total = _money(sum(r["amount"] for r in rows))
    unresolved_total = _money(sum(r["amount"] for r in unresolved))
    ledger_total = _money(read_json(out_dir / "ledger.json")["traceability"]["outside_total"])
    if _money(vendor_total + unresolved_total) != ie_total:
        raise SystemExit(f"vendor total {vendor_total} + unresolved {unresolved_total} != IE total {ie_total}")
    if ie_total != ledger_total:
        raise SystemExit(f"IE total {ie_total} != ledger outside total {ledger_total}")

    by_medium = _media_mix([r for g in groups for r in g.rows])
    n_merges = sum(1 for line in log if line.startswith("merge "))
    n_alias_rows = sum(1 for g in groups if g.normalization["basis"] == "verified")
    n_alias_strings = sum(len(g.aliases) for g in groups if g.normalization["basis"] == "verified")
    notes = [
        MEDIUM_RULE_TEXT,
        f"Generic 'MEDIA BUY' / 'MEDIA PLACEMENT' with no digital, radio or mail keyword is counted as tv; a hand alias "
        f"row's medium_override replaces the classification for that vendor ({sum(1 for g in groups if g.medium_override)} vendors).",
        f"Payee normalisation: {len(payee_totals)} filed payee strings -> {len(groups)} vendors. "
        f"{len(payee_totals) - len(groups)} strings folded: exact key matches after case/punctuation/suffix/token-order "
        f"normalisation, {n_merges} fuzzy fold(s) at difflib ratio ≥ {SIMILARITY_THRESHOLD} with matching numeric tokens, "
        f"and {n_alias_rows} hand alias vendor(s) covering {n_alias_strings} strings (basis verified).",
        f"{len(unresolved)} IE row(s) with no payee (${unresolved_total:,.2f}) carry vendor_id null and are not in any vendor.",
        "Vendor payments are money spender -> vendor; targets are the candidates named on the same Schedule E rows and "
        "receive no money.",
    ]
    index = {
        "race_id": race_id,
        "generated_at": generated_at,
        "data_status": "real",
        "vendors": summaries,
        "total": vendor_total,
        "by_medium": by_medium,
        "medium_basis": {
            "basis": "inferred",
            "rule": MEDIUM_RULE_TEXT,
            "source_urls": [FEC_SCHEDULE_E_DOC],
            "checked_by": None,
            "checked_at": None,
        },
        "notes": notes,
    }

    vendors_dir = out_dir / "vendors"
    vendors_dir.mkdir(parents=True, exist_ok=True)
    keep = {f"{g.vendor_id}.json" for g in groups}
    for stale in vendors_dir.glob("*.json"):
        if stale.name not in keep:
            stale.unlink()
    for g, s in zip(groups, summaries, strict=True):
        write_json(
            vendors_dir / f"{g.vendor_id}.json",
            {
                **s,
                "race_id": race_id,
                "generated_at": generated_at,
                "data_status": "real",
                "expenditures": sorted(g.rows, key=_row_sort_key, reverse=True),
                "ads": [],
                "method": METHOD,
            },
        )
    write_json(out_dir / "vendors.json", index)

    for f, e in entity_files.items():
        e["vendors"] = entity_vendor_rows(e["independent_expenditures"], by_payee, race.cycle)
        write_json(f, e)

    classified = sum(r["amount"] for r in rows if r["medium"] != "other")
    print(
        f"\n{len(rows)} IE rows, {len(payee_totals)} payee strings -> {len(groups)} vendors; {n_merges} fuzzy merges, "
        f"{n_alias_rows} hand alias vendors ({n_alias_strings} strings); {len(unresolved)} unresolved payees; "
        f"medium != other on {classified / ie_total:.1%} of ${ie_total:,.2f}; ledger outside total ${ledger_total:,.2f}"
    )
    return index


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "pa-sen-2024")
