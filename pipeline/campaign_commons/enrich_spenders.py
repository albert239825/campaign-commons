"""Classify committee self-descriptions from their own websites."""

from __future__ import annotations

import argparse
import hashlib
import html.parser
import json
import sys
import time
from collections.abc import Callable
from urllib.parse import urlsplit

import requests

from .config import DATA, FEC_API, FEC_API_KEY, RACES, ROOT, XAI_API_KEY
from .dossier import issue_ids
from .enrich_common import is_normalized_substring
from .util import now_iso, read_json, write_json
from .xai_client import XaiClient, output_text, response_cost_usd

PROMPT_VERSION = "classify_spender.v1"
PROMPT_PATH = ROOT / "pipeline" / "campaign_commons" / "prompts" / "enrich" / f"{PROMPT_VERSION}.md"
ISSUES_TAXONOMY = ROOT / "contracts" / "jsonschema" / "issues_taxonomy.json"
FOCUS_KINDS = (
    "single_issue",
    "multi_issue",
    "general_partisan",
    "candidate_aligned",
    "business_trade",
    "labor",
)
REPAIRABLE_ERRORS = {
    "description is missing or too long",
    "quote is missing or too long",
    "issue_ids is required for issue focus",
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


def _domain(website: object) -> str | None:
    if not isinstance(website, str) or not website.strip():
        return None
    value = website.strip().lower()
    parsed = urlsplit(value if "://" in value else f"//{value}")
    host = parsed.hostname
    if not host:
        return None
    return host.removeprefix("www.")


def _committee_batch_fetch(entity_ids: list[str]) -> list[dict]:
    # /committees/ (list) omits `website`; only the per-committee detail endpoint carries it.
    return [_committee_detail_fetch(entity_id) for entity_id in entity_ids]


def _committee_detail_fetch(entity_id: str) -> dict:
    params: dict[str, object] = {"api_key": FEC_API_KEY}
    delays = (2, 4, 8, 16)
    last_error = ""
    for attempt, delay in enumerate(delays):
        try:
            response = requests.get(f"{FEC_API}/committee/{entity_id}/", params=params, timeout=30)
            status = response.status_code
            if status == 429 or status >= 500:
                last_error = f"HTTP {status}"
                if attempt < len(delays) - 1:
                    time.sleep(delay)
                    continue
                raise RuntimeError(
                    f"FEC committee lookup failed after {len(delays)} attempts ({last_error}). "
                    "Set FEC_API_KEY in .env; free keys are available at "
                    "https://api.open.fec.gov/developers/."
                )
            if status >= 400:
                raise RuntimeError(f"FEC committee lookup failed with HTTP {status}. Set FEC_API_KEY in .env.")
            payload = response.json()
            results = payload.get("results", []) if isinstance(payload, dict) else []
            return results[0] if results and isinstance(results[0], dict) else {}
        except requests.RequestException as exc:
            last_error = str(exc)
            if attempt < len(delays) - 1:
                time.sleep(delay)
                continue
            raise RuntimeError(
                f"FEC committee lookup failed after {len(delays)} attempts ({last_error}). "
                "Set FEC_API_KEY in .env; free keys are available at "
                "https://api.open.fec.gov/developers/."
            ) from exc
    raise RuntimeError(f"FEC committee lookup failed ({last_error}). Set FEC_API_KEY in .env.")


def _committee_details(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        return {}
    results = payload.get("results")
    if isinstance(results, list) and results and isinstance(results[0], dict):
        return results[0]
    return payload


def _committee_cache(
    entity_ids: list[str], fetcher: Callable[[list[str]], list[dict]] | None
) -> dict[str, dict[str, object]]:
    cached: dict[str, dict[str, object]] = {}
    uncached: list[str] = []
    for entity_id in entity_ids:
        path = DATA / "raw" / "fec" / "committee" / f"{entity_id}.json"
        if path.exists():
            cached[entity_id] = _committee_details(read_json(path))
        else:
            uncached.append(entity_id)
    chunk_size = 100 if fetcher else 1  # default fetcher is per-committee; persist each before the next call
    for offset in range(0, len(uncached), chunk_size):
        chunk = uncached[offset : offset + chunk_size]
        results = (fetcher or _committee_batch_fetch)(chunk)
        by_id = {
            str(result.get("committee_id")): result for result in results if isinstance(result.get("committee_id"), str)
        }
        for entity_id in chunk:
            result = by_id.get(entity_id, {})
            write_json(DATA / "raw" / "fec" / "committee" / f"{entity_id}.json", result)
            cached[entity_id] = result
    return cached


def _existing_rows(race_id: str) -> list[dict]:
    path = DATA / "hand" / race_id / "x_issue_focus.json"
    if not path.exists():
        return []
    loaded = read_json(path)
    rows = loaded.get("rows", []) if isinstance(loaded, dict) else []
    return [row for row in rows if isinstance(row, dict)]


def _plans(
    race_id: str,
    only: str | None,
    limit: int | None,
    refresh_reviewed: bool,
    fec_fetcher: Callable[[list[str]], list[dict]] | None,
) -> list[dict[str, object]]:
    ledger = read_json(RACES[race_id].out_dir / "ledger.json")
    spenders = ledger.get("top_outside_spenders", []) if isinstance(ledger, dict) else []
    focus_path = DATA / "hand" / race_id / "issue_focus.json"
    focus = read_json(focus_path) if focus_path.exists() else {"rows": []}
    focused = {
        str(row.get("entity_id"))
        for row in focus.get("rows", [])
        if isinstance(row, dict) and row.get("entity_id") is not None
    }
    reviewed = {
        str(row.get("entity_id")): row
        for row in _existing_rows(race_id)
        if isinstance(row.get("provenance"), dict)
        and row["provenance"].get("review_status") in {"accepted", "rejected"}
    }
    candidates = []
    for spender in spenders:
        if not isinstance(spender, dict):
            continue
        entity_id = str(spender.get("entity_id"))
        if not entity_id.startswith("C") or entity_id in focused:
            continue
        if only is not None and entity_id != only:
            continue
        if not refresh_reviewed and entity_id in reviewed:
            continue
        candidates.append(
            {
                "entity_id": entity_id,
                "name": str(spender.get("name", entity_id)),
            }
        )
    candidates = candidates[:limit] if limit is not None else candidates
    committees = _committee_cache([str(candidate["entity_id"]) for candidate in candidates], fec_fetcher)
    plans = []
    for candidate in candidates:
        entity_id = str(candidate["entity_id"])
        committee = committees.get(entity_id, {})
        website = committee.get("website")
        plans.append(
            {
                "entity_id": entity_id,
                "name": candidate["name"],
                "website": website if isinstance(website, str) else None,
                "affiliated": committee.get("affiliated_committee_name")
                if isinstance(committee.get("affiliated_committee_name"), str)
                else None,
                "domain": _domain(website),
            }
        )
    return plans


def _schema(issue_ids_: list[str]) -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["found", "kind", "issue_ids", "description", "quote", "source_url", "confidence"],
        "properties": {
            "found": {"type": "boolean"},
            "kind": {"type": "string", "enum": list(FOCUS_KINDS)},
            "issue_ids": {
                "type": "array",
                "maxItems": 3,
                "items": {"type": "string", "enum": issue_ids_},
            },
            "description": {"type": "string", "maxLength": 400},
            "quote": {"type": ["string", "null"], "maxLength": 400},
            "source_url": {"type": ["string", "null"]},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
    }


def _payload(model: str, prompt: str, issue_ids_: list[str], plan: dict[str, object]) -> dict[str, object]:
    website = plan["website"] or "none"
    affiliated = plan["affiliated"] or "none"
    tools: list[dict[str, object]] = [{"type": "web_search"}]
    if plan["domain"]:
        tools = [{"type": "web_search", "filters": {"allowed_domains": [plan["domain"]]}}]
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Committee: {plan['name']} (FEC id {plan['entity_id']}). "
                    f"FEC-listed website: {website}. Connected organization: {affiliated}."
                ),
            },
        ],
        "store": False,
        "temperature": 0,
        "seed": 7,
        "tools": tools,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "spender_issue_focus",
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
                "`description` at most 300 characters, in your own close paraphrase of the committee's "
                "self-description; `quote` at most 400 characters and a verbatim, contiguous excerpt of the "
                "page you already cited (shorten it, do not change words); if `kind` is single_issue or "
                "multi_issue, `issue_ids` must contain 1–3 ids from the list — otherwise change `kind` to the "
                "best other kind; keep `source_url` unchanged. Do not invent content."
            ),
        },
    ]
    return payload


def _searched_urls(response: dict[str, object]) -> list[str]:
    urls: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "web_search_call":
            continue
        action = item.get("action")
        if not isinstance(action, dict):
            continue
        if action.get("type") == "open_page" and isinstance(action.get("url"), str):
            urls.append(action["url"])
        sources = action.get("sources")
        if isinstance(sources, list):
            for source in sources:
                if isinstance(source, dict) and isinstance(source.get("url"), str):
                    urls.append(source["url"])
    return list(dict.fromkeys(urls))


def _url_key(url: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if parsed.port is not None:
        host = f"{host}:{parsed.port}"
    path = parsed.path.rstrip("/")
    return f"{host}{path}{'?' + parsed.query if parsed.query else ''}"


def _host_allowed(url: str, domain: str | None) -> bool:
    if not domain:
        return True
    host = urlsplit(url).hostname
    return bool(host and (host == domain or host.endswith(f".{domain}")))


def _validate_result(
    result: object,
    searched_urls: list[str],
    domain: str | None,
    known: set[str],
) -> str | None:
    if not isinstance(result, dict):
        return "response JSON is not an object"
    if result.get("found") is False:
        return None
    if result.get("found") is not True:
        return "found is invalid"
    kind = result.get("kind")
    if kind not in FOCUS_KINDS:
        return "kind is invalid"
    issue_values = result.get("issue_ids")
    if not isinstance(issue_values, list) or not all(isinstance(value, str) for value in issue_values):
        return "issue_ids is not a string array"
    if any(value not in known for value in issue_values):
        return "issue_ids contains an off-taxonomy id"
    if len(issue_values) != len(set(issue_values)):
        return "issue_ids contains duplicates"
    if kind in {"single_issue", "multi_issue"} and not issue_values:
        return "issue_ids is required for issue focus"
    description = result.get("description")
    if not isinstance(description, str) or len(description) > 400:
        return "description is missing or too long"
    quote = result.get("quote")
    if not isinstance(quote, str) or not quote or len(quote) > 400:
        return "quote is missing or too long"
    source_url = result.get("source_url")
    if not isinstance(source_url, str) or not any(
        _url_key(source_url) == _url_key(searched_url) for searched_url in searched_urls
    ):
        return "source_url was not opened by web_search"
    if not _host_allowed(source_url, domain):
        return "source_url is outside the FEC-listed domain"
    if result.get("confidence") not in {"high", "medium", "low"}:
        return "confidence is invalid"
    return None


class _TextParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def _page_text(raw: str) -> str:
    parser = _TextParser()
    parser.feed(raw)
    return " ".join(" ".join(parser.parts).split())


def _default_page_fetcher(url: str) -> tuple[int, str]:
    response = requests.get(url, headers={"User-Agent": "CampaignCommons/1.0"}, timeout=30)
    return response.status_code, response.text


def _default_wayback_fetcher(url: str) -> str | None:
    response = requests.get(
        "https://archive.org/wayback/available",
        params={"url": url},
        headers={"User-Agent": "CampaignCommons/1.0"},
        timeout=30,
    )
    if response.status_code != 200:
        return None
    closest = response.json().get("archived_snapshots", {}).get("closest", {})
    return closest.get("url") if isinstance(closest, dict) else None


def _cached_page(url: str) -> dict[str, object] | None:
    path = DATA / "raw" / "web" / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
    if not path.exists():
        return None
    loaded = read_json(path)
    return loaded if isinstance(loaded, dict) and loaded.get("status") == 200 else None


def _fetch_verified_page(
    source_url: str,
    quote: str,
    page_fetcher: Callable[[str], tuple[int, str]] | None,
    wayback_fetcher: Callable[[str], str | None] | None,
) -> tuple[bool, str | None]:
    page_fetcher = page_fetcher or _default_page_fetcher
    wayback_fetcher = wayback_fetcher or _default_wayback_fetcher
    direct = _cached_page(source_url)
    if direct is None:
        try:
            status, raw = page_fetcher(source_url)
        except Exception:
            status, raw = 0, ""
        text = _page_text(raw)
        write_json(
            DATA / "raw" / "web" / f"{hashlib.sha256(source_url.encode()).hexdigest()}.json",
            {"url": source_url, "status": status, "fetched_at": now_iso(), "text": text},
        )
        direct = {"status": status, "text": text}
    if (
        direct.get("status") == 200
        and isinstance(direct.get("text"), str)
        and is_normalized_substring(quote, direct["text"])
    ):
        return True, None
    try:
        snapshot_url = wayback_fetcher(source_url)
    except Exception:
        snapshot_url = None
    if not snapshot_url:
        return False, None
    archived = _cached_page(snapshot_url)
    if archived is None:
        try:
            status, raw = page_fetcher(snapshot_url)
        except Exception:
            status, raw = 0, ""
        text = _page_text(raw)
        write_json(
            DATA / "raw" / "web" / f"{hashlib.sha256(snapshot_url.encode()).hexdigest()}.json",
            {"url": snapshot_url, "status": status, "fetched_at": now_iso(), "text": text},
        )
        archived = {"status": status, "text": text}
    if (
        archived.get("status") == 200
        and isinstance(archived.get("text"), str)
        and is_normalized_substring(quote, archived["text"])
    ):
        return True, snapshot_url
    return False, None


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
    source_urls.append(f"https://www.fec.gov/data/committee/{plan['entity_id']}/")
    domain = plan["domain"]
    return {
        "entity_id": plan["entity_id"],
        "name": plan["name"],
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
            "tool_filters": {"allowed_domains": [domain]} if domain else {},
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


def run(
    race_id: str,
    *,
    dry_run: bool = False,
    limit: int | None = None,
    only: str | None = None,
    max_calls: int = 200,
    max_usd: float = 5.0,
    model: str = "grok-4.3",
    refresh_reviewed: bool = False,
    client: XaiClient | None = None,
    fec_fetcher: Callable[[list[str]], list[dict]] | None = None,
    page_fetcher: Callable[[str], tuple[int, str]] | None = None,
    wayback_fetcher: Callable[[str], str | None] | None = None,
) -> int:
    plans = _plans(race_id, only, limit, refresh_reviewed, fec_fetcher)
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
            hashlib.sha256(f"{model}{PROMPT_VERSION}{plan['entity_id']}{plan['domain'] or ''}".encode()).hexdigest(),
        )
        for plan in plans
    ]
    to_call = sum(1 for _, key in keyed if not (cache_dir / f"{key}.json").exists())
    historical_costs = [
        float(entry["est_usd"])
        for entry in ledger
        if isinstance(entry, dict)
        and entry.get("stage") == "classify_spender"
        and isinstance(entry.get("est_usd"), (int, float))
    ]
    mean_cost = sum(historical_costs) / len(historical_costs) if historical_costs else 0.04
    estimated = to_call * mean_cost
    print(f"planned {len(plans)} units; cached {len(plans) - to_call}; to-call {to_call}; estimated ${estimated:.6f}")
    if dry_run:
        return 0
    if to_call and not client:
        if not XAI_API_KEY:
            print("ERROR XAI_API_KEY is required for uncached classifications", file=sys.stderr)
            return 2
    client = client or XaiClient(XAI_API_KEY)
    rows_by_id: dict[str, dict[str, object]] = {}
    processed: set[str] = set()
    calls = 0
    spent = 0.0
    exit_code = 0
    for plan, key in keyed:
        budget_hit = False
        cache_path = cache_dir / f"{key}.json"
        if cache_path.exists():
            entry = read_json(cache_path)
        else:
            if calls >= max_calls:
                print(f"budget exhausted: {calls} calls used; remaining units are left unprocessed", file=sys.stderr)
                exit_code = 3
                break
            payload = _payload(model, prompt, known_ids, plan)
            response = client.create_response(payload)
            retrieved_at = now_iso()
            entry = {"request": payload, "response": response, "retrieved_at": retrieved_at}
            write_json(cache_path, entry)
            cost = response_cost_usd(model, response)
            spent += cost
            usage = response.get("usage", {}) if isinstance(response, dict) else {}
            ledger.append(
                {
                    "ts": retrieved_at,
                    "stage": "classify_spender",
                    "ad_id": None,
                    "entity_id": plan["entity_id"],
                    "model": model,
                    "response_id": response.get("id"),
                    "input_tokens": usage.get("input_tokens", 0) if isinstance(usage, dict) else 0,
                    "output_tokens": usage.get("output_tokens", 0) if isinstance(usage, dict) else 0,
                    "est_usd": cost,
                }
            )
            write_json(ledger_path, ledger)
            calls += 1
            if spent > max_usd:
                print(f"budget exhausted: ${spent:.6f} used, ${max(0.0, max_usd - spent):.6f} left", file=sys.stderr)
                exit_code = 3
                budget_hit = True
        processed.add(str(plan["entity_id"]))
        response = entry.get("response", {})
        if not isinstance(response, dict):
            if budget_hit:
                break
            continue
        try:
            result = json.loads(output_text(response))
        except (ValueError, json.JSONDecodeError) as exc:
            print(f"WARN {plan['entity_id']}: invalid xAI JSON ({exc})", file=sys.stderr)
            if budget_hit:
                break
            continue
        searched = _searched_urls(response)
        error = _validate_result(result, searched, plan["domain"], set(known_ids))
        if isinstance(result, dict) and result.get("found") is False:
            if budget_hit:
                break
            continue
        repair_failed = False
        if (
            error in REPAIRABLE_ERRORS
            and isinstance(result, dict)
            and result.get("found") is True
            and isinstance(result.get("source_url"), str)
            and any(_url_key(result["source_url"]) == _url_key(searched_url) for searched_url in searched)
            and _host_allowed(result["source_url"], plan["domain"])
        ):
            repair_path = cache_dir / f"{key}.repair.json"
            if repair_path.exists():
                repair_entry = read_json(repair_path)
            elif calls >= max_calls:
                print(f"budget exhausted: {calls} calls used; remaining units are left unprocessed", file=sys.stderr)
                exit_code = 3
                budget_hit = True
                repair_entry = None
            else:
                repair_request = _repair_payload(model, prompt, known_ids, plan, result, error)
                repair_response = client.create_response(repair_request)
                repair_retrieved_at = now_iso()
                repair_entry = {
                    "request": repair_request,
                    "response": repair_response,
                    "retrieved_at": repair_retrieved_at,
                }
                write_json(repair_path, repair_entry)
                repair_cost = response_cost_usd(model, repair_response)
                spent += repair_cost
                repair_usage = repair_response.get("usage", {}) if isinstance(repair_response, dict) else {}
                ledger.append(
                    {
                        "ts": repair_retrieved_at,
                        "stage": "classify_spender_repair",
                        "ad_id": None,
                        "entity_id": plan["entity_id"],
                        "model": model,
                        "response_id": repair_response.get("id"),
                        "input_tokens": repair_usage.get("input_tokens", 0) if isinstance(repair_usage, dict) else 0,
                        "output_tokens": repair_usage.get("output_tokens", 0) if isinstance(repair_usage, dict) else 0,
                        "est_usd": repair_cost,
                    }
                )
                write_json(ledger_path, ledger)
                calls += 1
                if spent > max_usd:
                    print(
                        f"budget exhausted: ${spent:.6f} used, ${max(0.0, max_usd - spent):.6f} left",
                        file=sys.stderr,
                    )
                    exit_code = 3
                    budget_hit = True
            if isinstance(repair_entry, dict):
                repair_response = repair_entry.get("response", {})
                try:
                    repaired_result = json.loads(output_text(repair_response))
                except (ValueError, json.JSONDecodeError) as exc:
                    repaired_result = None
                    repair_error = f"invalid repaired JSON ({exc})"
                else:
                    repair_error = _validate_result(repaired_result, searched, plan["domain"], set(known_ids))
                    if repair_error is None and (
                        not isinstance(repaired_result, dict)
                        or repaired_result.get("found") is not True
                        or not isinstance(repaired_result.get("source_url"), str)
                        or _url_key(repaired_result["source_url"]) != _url_key(result["source_url"])
                    ):
                        repair_error = "source_url changed during repair"
                if repair_error is None:
                    result = repaired_result
                    error = None
                else:
                    print(
                        f"WARN {plan['entity_id']}: dropped classification after repair ({repair_error})",
                        file=sys.stderr,
                    )
                    repair_failed = True
                    if budget_hit:
                        break
        if not repair_failed:
            if error:
                print(f"WARN {plan['entity_id']}: dropped classification ({error})", file=sys.stderr)
            else:
                source_url = str(result["source_url"])
                verified, wayback_url = _fetch_verified_page(
                    source_url, str(result["quote"]), page_fetcher, wayback_fetcher
                )
                if not verified:
                    print(
                        f"WARN {plan['entity_id']}: dropped classification (quote not verified on page)",
                        file=sys.stderr,
                    )
                else:
                    citations = list(dict.fromkeys([*searched, source_url]))
                    rows_by_id[str(plan["entity_id"])] = _row(
                        plan, result, response, str(entry["retrieved_at"]), source_url, wayback_url, citations, model
                    )
        if budget_hit:
            break
    hand_path = DATA / "hand" / race_id / "x_issue_focus.json"
    existing = read_json(hand_path) if hand_path.exists() else {"race_id": race_id, "method": "", "rows": []}
    old_rows = existing.get("rows", []) if isinstance(existing, dict) else []
    kept = [row for row in old_rows if isinstance(row, dict) and str(row.get("entity_id")) not in processed]
    output = {
        "race_id": race_id,
        "method": (
            "machine rows, classified by xAI from the committee's own website via web_search, pending human review; "
            "human issue_focus.json always wins"
        ),
        "rows": sorted([*kept, *rows_by_id.values()], key=lambda row: str(row["entity_id"])),
    }
    write_json(hand_path, output)
    print(f"classified {len(rows_by_id)} rows; {calls} API calls; estimated ${spent:.6f}")
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only")
    parser.add_argument("--max-calls", type=int, default=200)
    parser.add_argument("--max-usd", type=float, default=5.0)
    parser.add_argument("--model", default="grok-4.3")
    parser.add_argument("--refresh-reviewed", action="store_true")
    args = parser.parse_args()
    return run(
        args.race,
        dry_run=args.dry_run,
        limit=args.limit,
        only=args.only,
        max_calls=args.max_calls,
        max_usd=args.max_usd,
        model=args.model,
        refresh_reviewed=args.refresh_reviewed,
    )


if __name__ == "__main__":
    sys.exit(main())
