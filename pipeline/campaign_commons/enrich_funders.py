"""Classify upstream organization self-descriptions from the open web."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .config import DATA, RACES, ROOT, XAI_API_KEY
from .dossier import issue_ids
from .enrich_common import _normalize, is_normalized_substring
from .enrich_spenders import (
    REPAIRABLE_ERRORS,
    _cached_page,
    _fetch_verified_page,
    _schema,
    _searched_urls,
    _url_key,
    _validate_result,
)
from .util import now_iso, read_json, write_json
from .xai_client import RetryableResponse, XaiClient, output_text, response_cost_usd

PROMPT_VERSION = "classify_funder.v1"
CALL_ATTEMPTS = 3
PROMPT_PATH = ROOT / "pipeline" / "campaign_commons" / "prompts" / "enrich" / f"{PROMPT_VERSION}.md"
ISSUES_TAXONOMY = ROOT / "contracts" / "jsonschema" / "issues_taxonomy.json"
CORPORATE_SUFFIXES = {"inc", "llc", "pac", "exchange"}
DENYLIST = {
    "wikipedia.org",
    "opensecrets.org",
    "influencewatch.org",
    "ballotpedia.org",
    "propublica.org",
    "fec.gov",
    "irs.gov",
    "followthemoney.org",
    "littlesis.org",
    "linkedin.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "instagram.com",
    "crunchbase.com",
    "zoominfo.com",
    "bloomberg.com",
}


def _taxonomy() -> tuple[list[str], str]:
    known = issue_ids()
    loaded = read_json(ISSUES_TAXONOMY)
    by_id = {str(row["id"]): row for row in loaded if isinstance(row, dict) and isinstance(row.get("id"), str)}
    lines = [
        f"{issue_id} — {by_id[issue_id]['label']} — {by_id[issue_id]['description']}"
        for issue_id in known
        if issue_id in by_id
    ]
    return known, "\n".join(lines)


def _prompt() -> str:
    return PROMPT_PATH.read_text().replace("{{issues}}", _taxonomy()[1])


def _match_name(name: str) -> str:
    words = _normalize(name).split()
    while words and words[-1] in CORPORATE_SUFFIXES:
        words.pop()
    return " ".join(words)


def _display_name(name: str) -> str:
    return name.strip().title()


def _plans(
    race_id: str,
    top: int,
    limit: int | None,
    only: str | None,
    refresh_reviewed: bool,
    min_total: float | None = None,
) -> list[dict[str, object]]:
    totals: dict[str, float] = {}
    names: dict[str, str] = {}
    for path in sorted((RACES[race_id].out_dir / "entities").glob("*.json")):
        entity = read_json(path)
        for inflow in entity.get("inflows", []) if isinstance(entity, dict) else []:
            if not isinstance(inflow, dict):
                continue
            entity_id = str(inflow.get("from_entity_id", ""))
            if not entity_id.startswith("org:"):
                continue
            totals[entity_id] = totals.get(entity_id, 0.0) + float(inflow.get("amount", 0.0))
            names.setdefault(entity_id, str(inflow.get("from_name", entity_id)))

    focus_path = DATA / "hand" / race_id / "issue_focus.json"
    focus = read_json(focus_path) if focus_path.exists() else {"rows": []}
    focused = {
        str(row.get("entity_id"))
        for row in focus.get("rows", [])
        if isinstance(row, dict) and str(row.get("entity_id", "")).startswith("org:")
    }
    existing_path = DATA / "hand" / race_id / "x_funder_focus.json"
    existing = read_json(existing_path) if existing_path.exists() else {"rows": []}
    reviewed = {
        str(row.get("entity_id"))
        for row in existing.get("rows", [])
        if isinstance(row, dict)
        and isinstance(row.get("provenance"), dict)
        and row["provenance"].get("review_status") in {"accepted", "rejected"}
    }
    ranked = sorted(totals, key=lambda entity_id: (-totals[entity_id], entity_id))
    if only is not None:
        ranked = [entity_id for entity_id in ranked if entity_id == only]
    elif min_total is not None:
        ranked = [entity_id for entity_id in ranked if totals[entity_id] >= min_total]
    else:
        ranked = ranked[:top]
    candidates = []
    for entity_id in ranked:
        if entity_id in focused or (not refresh_reviewed and entity_id in reviewed):
            continue
        name = names[entity_id]
        candidates.append(
            {
                "entity_id": entity_id,
                "name": name,
                "display_name": _display_name(name),
                "match_name": _match_name(name),
                "total": round(totals[entity_id], 2),
            }
        )
    return candidates[:limit] if limit is not None else candidates


def _payload(model: str, prompt: str, issue_ids_: list[str], plan: dict[str, object]) -> dict[str, object]:
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Organization: {plan['display_name']} (synthetic id {plan['entity_id']}). "
                    "Find and describe the organization's own website."
                ),
            },
        ],
        "store": False,
        "temperature": 0,
        "seed": 7,
        "tools": [{"type": "web_search"}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "funder_issue_focus",
                "strict": True,
                "schema": _schema(issue_ids_),
            }
        },
    }


def _repair_payload(
    model: str,
    prompt: str,
    issue_ids_: list[str],
    plan: dict[str, object],
    previous: dict[str, object],
    error: str,
) -> dict[str, object]:
    payload = _payload(model, prompt, issue_ids_, plan)
    payload.pop("tools", None)
    payload["input"] = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Previous JSON output:\n{json.dumps(previous, ensure_ascii=False)}\n\n"
                f"Your previous answer violated the output rules: {error}. Return the corrected JSON. Rules: "
                "`description` at most 300 characters, in your own close paraphrase of the organization's "
                "self-description; `quote` at most 400 characters and a verbatim, contiguous excerpt of the "
                "page you already cited (shorten it, do not change words); if `kind` is single_issue or "
                "multi_issue, `issue_ids` must contain 1–3 ids from the list — otherwise change `kind` to the "
                "best other kind; keep `source_url` unchanged. Do not invent content."
            ),
        },
    ]
    return payload


def _host_denied(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    return "news" in host or any(host == denied or host.endswith(f".{denied}") for denied in DENYLIST)


def _validate_funder(result: object, searched: list[str], known: set[str]) -> str | None:
    error = _validate_result(result, searched, None, known)
    if error:
        return error
    if isinstance(result, dict) and isinstance(result.get("source_url"), str) and _host_denied(result["source_url"]):
        return "source_url is not the organization's own site"
    return None


def _page_names_org(url: str, match_name: str) -> bool:
    page = _cached_page(url)
    return bool(page and isinstance(page.get("text"), str) and is_normalized_substring(match_name, page["text"]))


def _row(
    plan: dict[str, object],
    result: dict[str, object],
    response: dict[str, object],
    retrieved_at: str,
    source_url: str,
    wayback_url: str | None,
    citations: list[str],
    model: str,
) -> dict[str, object]:
    source_urls = [source_url]
    if wayback_url:
        source_urls.append(wayback_url)
    return {
        "entity_id": plan["entity_id"],
        "name": plan["display_name"],
        "kind": result["kind"],
        "issue_ids": list(result["issue_ids"]),
        "description": result["description"],
        "quote": result["quote"],
        "source_urls": source_urls,
        "provenance": {
            "tagged_by": f"xai-{model}-{retrieved_at[:10]}",
            "tagged_at": retrieved_at[:10],
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "tools": ["web_search"],
            "tool_filters": {},
            "response_id": response.get("id"),
            "retrieved_at": retrieved_at,
            "citations": citations,
            "confidence": result["confidence"],
            "review_status": "pending",
            "reviewed_by": None,
            "reviewed_at": None,
            "review_note": None,
        },
    }


class _Budget:
    """Call/USD caps shared by the worker threads; also serialises cache and ledger writes."""

    def __init__(self, max_calls: int, max_usd: float, ledger: list[object]) -> None:
        self.max_calls = max_calls
        self.max_usd = max_usd
        self.ledger = ledger
        self.lock = threading.Lock()
        self.calls = 0
        self.spent = 0.0
        self.exhausted = False

    def reserve(self) -> bool:
        with self.lock:
            if self.exhausted:
                return False
            if self.calls >= self.max_calls:
                self.exhausted = True
                print(
                    f"budget exhausted: {self.calls} calls used; remaining units are left unprocessed", file=sys.stderr
                )
                return False
            self.calls += 1
            return True

    def record(
        self,
        stage: str,
        plan: dict[str, object],
        model: str,
        cache_path: Path,
        payload: dict[str, object],
        response: dict[str, object],
    ) -> dict[str, object]:
        retrieved_at = now_iso()
        entry = {"request": payload, "response": response, "retrieved_at": retrieved_at}
        cost = response_cost_usd(model, response)
        usage = response.get("usage", {}) if isinstance(response, dict) else {}
        with self.lock:
            write_json(cache_path, entry)
            self.spent += cost
            self.ledger.append(
                {
                    "ts": retrieved_at,
                    "stage": stage,
                    "entity_id": plan["entity_id"],
                    "model": model,
                    "response_id": response.get("id"),
                    "input_tokens": usage.get("input_tokens", 0) if isinstance(usage, dict) else 0,
                    "output_tokens": usage.get("output_tokens", 0) if isinstance(usage, dict) else 0,
                    "est_usd": cost,
                }
            )
            if self.spent > self.max_usd and not self.exhausted:
                self.exhausted = True
                print(
                    f"budget exhausted: ${self.spent:.6f} used, ${max(0.0, self.max_usd - self.spent):.6f} left",
                    file=sys.stderr,
                )
        return entry


@dataclass
class _Context:
    client: XaiClient
    model: str
    prompt: str
    known_ids: list[str]
    cache_dir: Path
    budget: _Budget
    page_fetcher: Callable[[str], tuple[int, str]] | None
    wayback_fetcher: Callable[[str], str | None] | None
    sleep: Callable[[float], None] = field(default=time.sleep)


class _Unprocessed(Exception):
    """The unit was skipped because the call budget was exhausted before its first call."""


class _CallFailed(Exception):
    """The xAI call failed after every retry."""


def _call(ctx: _Context, payload: dict[str, object], entity_id: str) -> dict[str, object]:
    last_error: Exception | None = None
    for attempt in range(CALL_ATTEMPTS):
        try:
            return ctx.client.create_response(payload)
        except (RetryableResponse, ConnectionError, TimeoutError) as exc:
            last_error = exc
            if attempt < CALL_ATTEMPTS - 1:
                ctx.sleep(float(2**attempt))
        except Exception as exc:
            raise _CallFailed(f"{entity_id}: {exc}") from exc
    raise _CallFailed(f"{entity_id}: {last_error}") from last_error


def _classify(plan: dict[str, object], key: str, ctx: _Context) -> dict[str, object] | None:
    """Classify one funder; returns a row, or None when nothing verifiable came back."""
    entity_id = str(plan["entity_id"])
    cache_path = ctx.cache_dir / f"{key}.json"
    if cache_path.exists():
        entry = read_json(cache_path)
    else:
        if not ctx.budget.reserve():
            raise _Unprocessed(entity_id)
        payload = _payload(ctx.model, ctx.prompt, ctx.known_ids, plan)
        response = _call(ctx, payload, entity_id)
        entry = ctx.budget.record("classify_funder", plan, ctx.model, cache_path, payload, response)
    response = entry.get("response", {})
    if not isinstance(response, dict):
        return None
    try:
        result = json.loads(output_text(response))
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"WARN {entity_id}: invalid xAI JSON ({exc})", file=sys.stderr)
        return None
    searched = _searched_urls(response)
    known = set(ctx.known_ids)
    error = _validate_funder(result, searched, known)
    if isinstance(result, dict) and result.get("found") is False:
        return None
    if (
        error in REPAIRABLE_ERRORS
        and isinstance(result, dict)
        and result.get("found") is True
        and isinstance(result.get("source_url"), str)
        and any(_url_key(result["source_url"]) == _url_key(searched_url) for searched_url in searched)
        and not _host_denied(result["source_url"])
    ):
        repair_path = ctx.cache_dir / f"{key}.repair.json"
        if repair_path.exists():
            repair_entry = read_json(repair_path)
        elif not ctx.budget.reserve():
            repair_entry = None
        else:
            repair_request = _repair_payload(ctx.model, ctx.prompt, ctx.known_ids, plan, result, error)
            repair_response = _call(ctx, repair_request, entity_id)
            repair_entry = ctx.budget.record(
                "classify_funder_repair", plan, ctx.model, repair_path, repair_request, repair_response
            )
        if isinstance(repair_entry, dict):
            repair_response = repair_entry.get("response", {})
            try:
                repaired_result = json.loads(output_text(repair_response))
            except (ValueError, json.JSONDecodeError) as exc:
                repaired_result = None
                repair_error = f"invalid repaired JSON ({exc})"
            else:
                repair_error = _validate_funder(repaired_result, searched, known)
                if repair_error is None and (
                    not isinstance(repaired_result, dict)
                    or repaired_result.get("found") is not True
                    or not isinstance(repaired_result.get("source_url"), str)
                    or _url_key(repaired_result["source_url"]) != _url_key(result["source_url"])
                ):
                    repair_error = "source_url changed during repair"
            if repair_error is not None:
                print(f"WARN {entity_id}: dropped classification after repair ({repair_error})", file=sys.stderr)
                return None
            result = repaired_result
            error = None
    if error:
        print(f"WARN {entity_id}: dropped classification ({error})", file=sys.stderr)
        return None
    source_url = str(result["source_url"])
    verified, wayback_url = _fetch_verified_page(
        source_url, str(result["quote"]), ctx.page_fetcher, ctx.wayback_fetcher
    )
    checked_url = wayback_url or source_url
    if not verified:
        print(f"WARN {entity_id}: dropped classification (quote not verified on page)", file=sys.stderr)
        return None
    if not _page_names_org(checked_url, str(plan["match_name"])):
        print(f"WARN {entity_id}: dropped classification (page does not name the organization)", file=sys.stderr)
        return None
    citations = list(dict.fromkeys([*searched, source_url]))
    return _row(plan, result, response, str(entry["retrieved_at"]), source_url, wayback_url, citations, ctx.model)


def run(
    race_id: str,
    *,
    dry_run: bool = False,
    top: int = 40,
    min_total: float | None = None,
    limit: int | None = None,
    only: str | None = None,
    max_calls: int = 200,
    max_usd: float = 5.0,
    model: str = "grok-4.3",
    refresh_reviewed: bool = False,
    concurrency: int = 8,
    client: XaiClient | None = None,
    page_fetcher: Callable[[str], tuple[int, str]] | None = None,
    wayback_fetcher: Callable[[str], str | None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    plans = _plans(race_id, top, limit, only, refresh_reviewed, min_total)
    prompt = _prompt()
    cache_dir = DATA / "raw" / "xai"
    cache_dir.mkdir(parents=True, exist_ok=True)
    known_ids, _ = _taxonomy()
    ledger_path = cache_dir / "ledger.json"
    ledger = read_json(ledger_path) if ledger_path.exists() else []
    if not isinstance(ledger, list):
        ledger = []
    keyed = [
        (
            plan,
            f"funder-{hashlib.sha256((model + PROMPT_VERSION + str(plan['entity_id'])).encode()).hexdigest()}",
        )
        for plan in plans
    ]
    to_call = sum(1 for _, key in keyed if not (cache_dir / f"{key}.json").exists())
    historical_costs = [
        float(entry["est_usd"])
        for entry in ledger
        if isinstance(entry, dict)
        and entry.get("stage") == "classify_funder"
        and isinstance(entry.get("est_usd"), (int, float))
    ]
    mean_cost = sum(historical_costs) / len(historical_costs) if historical_costs else 0.04
    estimated = to_call * mean_cost
    print(f"planned {len(plans)} units; cached {len(plans) - to_call}; to-call {to_call}; estimated ${estimated:.6f}")
    if dry_run:
        return 0
    if to_call and not client and not XAI_API_KEY:
        print("ERROR XAI_API_KEY is required for uncached classifications", file=sys.stderr)
        return 2
    budget = _Budget(max_calls, max_usd, ledger)
    ctx = _Context(
        client=client or XaiClient(XAI_API_KEY),
        model=model,
        prompt=prompt,
        known_ids=known_ids,
        cache_dir=cache_dir,
        budget=budget,
        page_fetcher=page_fetcher,
        wayback_fetcher=wayback_fetcher,
        sleep=sleep,
    )
    rows_by_id: dict[str, dict[str, object]] = {}
    processed: set[str] = set()
    failed: list[str] = []
    stopped = False

    def collect(plan: dict[str, object], outcome: Callable[[], dict[str, object] | None]) -> None:
        entity_id = str(plan["entity_id"])
        try:
            row = outcome()
        except _Unprocessed:
            return
        except _CallFailed as exc:
            print(f"FAIL {exc}", file=sys.stderr)
            failed.append(entity_id)
            processed.add(entity_id)
            return
        processed.add(entity_id)
        if row is not None:
            rows_by_id[entity_id] = row

    pending: dict[Future[dict[str, object] | None], dict[str, object]] = {}

    def drain() -> None:
        done, _ = wait(list(pending), return_when=FIRST_COMPLETED)
        for future in done:
            collect(pending.pop(future), future.result)

    try:
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            for plan, key in keyed:
                if (cache_dir / f"{key}.json").exists():
                    collect(plan, lambda plan=plan, key=key: _classify(plan, key, ctx))
                    continue
                while len(pending) >= max(1, concurrency):
                    drain()
                if budget.exhausted:
                    stopped = True
                    break
                pending[pool.submit(_classify, plan, key, ctx)] = plan
            while pending:
                drain()
    finally:
        write_json(ledger_path, ledger)
    hand_path = DATA / "hand" / race_id / "x_funder_focus.json"
    existing = read_json(hand_path) if hand_path.exists() else {"race_id": race_id, "method": "", "rows": []}
    old_rows = existing.get("rows", []) if isinstance(existing, dict) else []
    kept = [row for row in old_rows if isinstance(row, dict) and str(row.get("entity_id")) not in processed]
    output = {
        "race_id": race_id,
        "method": (
            "machine rows, classified by xAI from the organization's own website via open web_search, pending human review"
        ),
        "rows": sorted([*kept, *rows_by_id.values()], key=lambda row: str(row["entity_id"])),
    }
    write_json(hand_path, output)
    print(
        f"classified {len(rows_by_id)} rows; processed {len(processed)} of {len(plans)} units; "
        f"failed {len(failed)}; {budget.calls} API calls; estimated ${budget.spent:.6f}"
    )
    return 3 if budget.exhausted or stopped else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--top", type=int, default=40)
    parser.add_argument("--min-total", type=float, help="select every org funder with total upstream USD >= this")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only")
    parser.add_argument("--max-calls", type=int, default=200)
    parser.add_argument("--max-usd", type=float, default=5.0)
    parser.add_argument("--model", default="grok-4.3")
    parser.add_argument("--refresh-reviewed", action="store_true")
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()
    return run(
        args.race,
        dry_run=args.dry_run,
        top=args.top,
        min_total=args.min_total,
        limit=args.limit,
        only=args.only,
        max_calls=args.max_calls,
        max_usd=args.max_usd,
        model=args.model,
        refresh_reviewed=args.refresh_reviewed,
        concurrency=args.concurrency,
    )


if __name__ == "__main__":
    sys.exit(main())
