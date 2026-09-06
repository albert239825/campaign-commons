"""Machine-suggested candidate dossier stances from web sources and optional X posts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Callable
from urllib.parse import urlsplit

import requests

from .config import DATA, RACES, ROOT, XAI_API_KEY
from .dossier import issue_ids
from .enrich_common import is_normalized_substring
from .enrich_spenders import (
    _cached_page,
    _default_page_fetcher,
    _default_wayback_fetcher,
    _page_text,
    _url_key,
)
from .util import now_iso, read_json, write_json
from .xai_client import XaiClient, output_text, response_cost_usd

PROMPT_VERSION = "summarize_stance.v1"
X_PROMPT_VERSION = "x_posts.v1"
PROMPT_PATH = ROOT / "pipeline" / "campaign_commons" / "prompts" / "enrich" / f"{PROMPT_VERSION}.md"
X_PROMPT_PATH = ROOT / "pipeline" / "campaign_commons" / "prompts" / "enrich" / f"{X_PROMPT_VERSION}.md"
ISSUES_TAXONOMY = ROOT / "contracts" / "jsonschema" / "issues_taxonomy.json"
REPAIRABLE_ERRORS = {
    "summary is missing or too long",
    "sources is required for stance",
}
SOURCE_EXCERPT_ERROR = "excerpt is missing or too long"
STANCE_DENYLIST = {
    "x.com",
    "twitter.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "tiktok.com",
    "reddit.com",
    "wikipedia.org",
    "opensecrets.org",
    "influencewatch.org",
    "littlesis.org",
    "followthemoney.org",
}
SUMMARY_LIMIT = 800
EXCERPT_LIMIT = 400
FROM_DATE = "2023-01-01"
TO_DATE = "2024-11-05"


def _taxonomy() -> dict[str, dict[str, str]]:
    loaded = read_json(ISSUES_TAXONOMY)
    return {
        str(row["id"]): {
            "label": str(row.get("label", row["id"])),
            "description": str(row.get("description", "")),
        }
        for row in loaded
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }


def _prompt() -> str:
    issues = _taxonomy()
    lines = "\n".join(f"{key} — {value['label']} — {value['description']}" for key, value in issues.items())
    return PROMPT_PATH.read_text().replace("{{issues}}", lines)


def _x_prompt() -> str:
    return X_PROMPT_PATH.read_text()


def _plans(
    race_id: str,
    limit: int | None,
    only: str | None,
    issue: str | None,
    refresh_reviewed: bool,
) -> list[dict[str, object]]:
    taxonomy = _taxonomy()
    race = RACES[race_id]
    accounts_path = DATA / "hand" / race_id / "x_accounts.json"
    accounts = read_json(accounts_path) if accounts_path.exists() else {"rows": []}
    by_candidate = {
        str(row.get("candidate_id")): [str(handle).removeprefix("@") for handle in row.get("handles", [])]
        for row in accounts.get("rows", [])
        if isinstance(row, dict) and isinstance(row.get("handles"), list)
    }
    existing_path = DATA / "hand" / race_id / "x_stances.json"
    existing = read_json(existing_path) if existing_path.exists() else {"rows": []}
    reviewed = {
        (str(row.get("candidate_id")), str(row.get("issue_id")))
        for row in existing.get("rows", [])
        if isinstance(row, dict)
        and isinstance(row.get("provenance"), dict)
        and row["provenance"].get("review_status") in {"accepted", "rejected"}
    }
    plans: list[dict[str, object]] = []
    for candidate in race.candidates:
        if only is not None and candidate.candidate_id != only:
            continue
        for issue_id in issue_ids():
            if issue_id not in taxonomy:
                continue
            if issue is not None and issue_id != issue:
                continue
            key = (candidate.candidate_id, issue_id)
            if not refresh_reviewed and key in reviewed:
                continue
            plans.append(
                {
                    "candidate_id": candidate.candidate_id,
                    "candidate_name": candidate.name,
                    "party": candidate.party,
                    "role": "U.S. Senator for PA" if candidate.incumbent else "2024 Senate candidate",
                    "issue_id": issue_id,
                    "issue_label": taxonomy[issue_id]["label"],
                    "issue_description": taxonomy[issue_id]["description"],
                    "handles": by_candidate.get(candidate.candidate_id, []),
                }
            )
    return plans[:limit] if limit is not None else plans


def _stance_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["found", "summary", "direction_proposed", "confidence", "sources"],
        "properties": {
            "found": {"type": "boolean"},
            "summary": {"type": "string", "maxLength": SUMMARY_LIMIT},
            "direction_proposed": {"type": ["integer", "null"], "minimum": -2, "maximum": 2},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "sources": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["url", "publisher", "published_on", "excerpt"],
                    "properties": {
                        "url": {"type": "string"},
                        "publisher": {"type": "string"},
                        "published_on": {"type": ["string", "null"]},
                        "excerpt": {"type": "string", "maxLength": EXCERPT_LIMIT},
                    },
                },
            },
        },
    }


def _posts_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["posts"],
        "properties": {
            "posts": {
                "type": "array",
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["url", "excerpt", "posted_on"],
                    "properties": {
                        "url": {"type": "string"},
                        "excerpt": {"type": "string", "maxLength": EXCERPT_LIMIT},
                        "posted_on": {"type": ["string", "null"]},
                    },
                },
            }
        },
    }


def _primary_payload(model: str, prompt: str, plan: dict[str, object]) -> dict[str, object]:
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Summarize {plan['candidate_name']} ({plan['party']}, {plan['role']})'s position on "
                    f"{plan['issue_label']} — {plan['issue_description']} during 2023–November 2024."
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
                "name": "candidate_stance",
                "strict": True,
                "schema": _stance_schema(),
            }
        },
    }


def _repair_payload(
    model: str,
    prompt: str,
    plan: dict[str, object],
    previous: dict[str, object],
    error: str,
) -> dict[str, object]:
    payload = _primary_payload(model, prompt, plan)
    payload.pop("tools", None)
    payload["input"] = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": (
                f"Previous JSON output:\n{json.dumps(previous, ensure_ascii=False)}\n\n"
                f"Your previous answer violated the output rules: {error}. Return the corrected JSON. Rules: "
                "`summary` at most 600 characters; every source `excerpt` at most 280 characters and a "
                "verbatim, contiguous excerpt of the cited page; `sources` must contain 1–4 items; keep every "
                "source URL unchanged. Do not invent content."
            ),
        },
    ]
    return payload


def _x_payload(model: str, prompt: str, plan: dict[str, object]) -> dict[str, object]:
    handles = list(plan["handles"])
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Find up to four posts by {plan['candidate_name']} about {plan['issue_label']}. "
                    "Return only posts that are directly about this issue."
                ),
            },
        ],
        "store": False,
        "temperature": 0,
        "seed": 7,
        "tools": [
            {
                "type": "x_search",
                "allowed_x_handles": handles,
                "from_date": FROM_DATE,
                "to_date": TO_DATE,
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "candidate_x_posts",
                "strict": True,
                "schema": _posts_schema(),
            }
        },
    }


def _searched_tool_urls(response: dict[str, object], tool_type: str) -> tuple[list[str], bool]:
    urls: list[str] = []
    exposed = False
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != f"{tool_type}_search_call":
            continue
        action = item.get("action")
        if not isinstance(action, dict):
            continue
        if isinstance(action.get("url"), str):
            urls.append(action["url"])
            exposed = True
        sources = action.get("sources")
        if isinstance(sources, list):
            exposed = True
            for source in sources:
                if isinstance(source, dict) and isinstance(source.get("url"), str):
                    urls.append(source["url"])
    return list(dict.fromkeys(urls)), exposed


def _host_denied(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    return any(host == denied or host.endswith(f".{denied}") for denied in STANCE_DENYLIST)


def _excerpt_matches(excerpt: str, text: str) -> bool:
    fragments = [fragment.strip() for fragment in re.split(r"\.\.\.|…", excerpt) if fragment.strip()]
    return bool(fragments) and all(is_normalized_substring(fragment, text) for fragment in fragments)


def _validate_primary(result: object, searched: list[str]) -> str | None:
    if not isinstance(result, dict):
        return "response JSON is not an object"
    if result.get("found") is False:
        return None
    if result.get("found") is not True:
        return "found is invalid"
    summary = result.get("summary")
    if not isinstance(summary, str) or len(summary) > SUMMARY_LIMIT:
        return "summary is missing or too long"
    sources = result.get("sources")
    if not isinstance(sources, list) or not sources:
        return "sources is required for stance"
    if len(sources) > 4:
        return "sources is too long"
    if result.get("direction_proposed") is not None and (
        not isinstance(result.get("direction_proposed"), int)
        or isinstance(result.get("direction_proposed"), bool)
        or not -2 <= result["direction_proposed"] <= 2
    ):
        return "direction_proposed is invalid"
    if result.get("confidence") not in {"high", "medium", "low"}:
        return "confidence is invalid"
    return None


def _source_error(source: object, searched: list[str]) -> str | None:
    if not isinstance(source, dict):
        return "source is not an object"
    url = source.get("url")
    if not isinstance(url, str) or not any(_url_key(url) == _url_key(searched_url) for searched_url in searched):
        return "source_url was not opened by web_search"
    if _host_denied(url):
        return "source host is not allowed"
    excerpt = source.get("excerpt")
    if not isinstance(excerpt, str) or not excerpt or len(excerpt) > EXCERPT_LIMIT:
        return SOURCE_EXCERPT_ERROR
    if not isinstance(source.get("publisher"), str) or not isinstance(source.get("published_on"), (str, type(None))):
        return "source metadata is invalid"
    return None


def _fetch_source(
    url: str,
    excerpt: str,
    page_fetcher: Callable[[str], tuple[int, str]] | None,
    wayback_fetcher: Callable[[str], str | None] | None,
) -> tuple[bool, str | None, str | None]:
    page_fetcher = page_fetcher or _default_page_fetcher
    wayback_fetcher = wayback_fetcher or _default_wayback_fetcher
    cached = _cached_page(url)
    if cached is None:
        try:
            status, raw = page_fetcher(url)
        except Exception:
            status, raw = 0, ""
        text = _page_text(raw)
        write_json(
            DATA / "raw" / "web" / f"{hashlib.sha256(url.encode()).hexdigest()}.json",
            {"url": url, "status": status, "fetched_at": now_iso(), "text": text},
        )
        cached = {"status": status, "text": text}
    status = cached.get("status")
    text = cached.get("text") if isinstance(cached.get("text"), str) else ""
    if status == 200:
        if _excerpt_matches(excerpt, text):
            return True, None, None
        return False, None, "fetched-page excerpt mismatch"
    try:
        snapshot_url = wayback_fetcher(url)
    except Exception:
        snapshot_url = None
    if not snapshot_url:
        return False, None, None
    archived = _cached_page(snapshot_url)
    if archived is None:
        try:
            archived_status, archived_raw = page_fetcher(snapshot_url)
        except Exception:
            archived_status, archived_raw = 0, ""
        archived_text = _page_text(archived_raw)
        write_json(
            DATA / "raw" / "web" / f"{hashlib.sha256(snapshot_url.encode()).hexdigest()}.json",
            {"url": snapshot_url, "status": archived_status, "fetched_at": now_iso(), "text": archived_text},
        )
        archived = {"status": archived_status, "text": archived_text}
    if archived.get("status") == 200 and isinstance(archived.get("text"), str):
        if _excerpt_matches(excerpt, archived["text"]):
            return True, snapshot_url, None
        return False, None, "fetched-page excerpt mismatch"
    return False, None, None


def _oembed_default(url: str) -> dict[str, object]:
    response = requests.get(
        "https://publish.twitter.com/oembed",
        params={"url": url, "omit_script": "1"},
        headers={"User-Agent": "CampaignCommons/1.0"},
        timeout=30,
    )
    if response.status_code != 200:
        return {}
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def _oembed(
    url: str,
    fetcher: Callable[[str], dict[str, object]] | None,
) -> dict[str, object]:
    path = DATA / "raw" / "x" / "oembed" / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
    if path.exists():
        loaded = read_json(path)
        return loaded if isinstance(loaded, dict) else {}
    try:
        payload = (fetcher or _oembed_default)(url)
    except Exception:
        payload = {}
    write_json(path, payload)
    return payload


def _handle_from_url(url: object) -> str | None:
    if not isinstance(url, str):
        return None
    path = urlsplit(url).path.strip("/")
    return path.split("/")[0].removeprefix("@").lower() if path else None


def _verify_posts(
    result: object,
    handles: list[str],
    searched: list[str],
    searched_exposed: bool,
    oembed_fetcher: Callable[[str], dict[str, object]] | None,
) -> list[dict[str, object]]:
    if not isinstance(result, dict) or not isinstance(result.get("posts"), list):
        return []
    allowed = {handle.lower().removeprefix("@") for handle in handles}
    verified: list[dict[str, object]] = []
    for post in result["posts"][:4]:
        if not isinstance(post, dict) or not isinstance(post.get("url"), str):
            continue
        url = post["url"]
        if searched_exposed and not any(_url_key(url) == _url_key(item) for item in searched):
            continue
        excerpt = post.get("excerpt")
        if not isinstance(excerpt, str) or not excerpt or len(excerpt) > EXCERPT_LIMIT:
            continue
        embed = _oembed(url, oembed_fetcher)
        author = _handle_from_url(embed.get("author_url"))
        html = embed.get("html")
        if author not in allowed or not isinstance(html, str):
            continue
        if not _excerpt_matches(excerpt, _page_text(html)):
            continue
        row: dict[str, object] = {
            "url": url,
            "excerpt": excerpt,
            "posted_on": post.get("posted_on") if isinstance(post.get("posted_on"), (str, type(None))) else None,
        }
        verified.append(row)
    return verified


def _row(
    plan: dict[str, object],
    result: dict[str, object],
    response: dict[str, object],
    retrieved_at: str,
    sources: list[dict[str, object]],
    posts: list[dict[str, object]],
    model: str,
    x_used: bool,
) -> dict[str, object]:
    citations = [
        url
        for source in sources
        for url in [source.get("url"), source.get("wayback_url")]
        if source.get("excerpt_verified") and isinstance(url, str)
    ]
    citations.extend(post["url"] for post in posts if isinstance(post.get("url"), str))
    tools = ["web_search"] + (["x_search"] if x_used else [])
    return {
        "candidate_id": plan["candidate_id"],
        "issue_id": plan["issue_id"],
        "summary": result["summary"],
        "direction_proposed": result["direction_proposed"],
        "confidence": result["confidence"],
        "sources": sources,
        "posts": posts,
        "provenance": {
            "tagged_by": f"xai-{model}-{retrieved_at[:10]}",
            "tagged_at": retrieved_at[:10],
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "tools": tools,
            "tool_filters": (
                {"allowed_x_handles": list(plan["handles"]), "from_date": FROM_DATE, "to_date": TO_DATE}
                if "x_search" in tools
                else {}
            ),
            "response_id": response.get("id"),
            "retrieved_at": retrieved_at,
            "citations": list(dict.fromkeys(citations)),
            "confidence": result["confidence"],
            "review_status": "pending",
            "reviewed_by": None,
            "reviewed_at": None,
            "review_note": None,
        },
    }


def _ledger_entry(
    stage: str,
    plan: dict[str, object],
    model: str,
    response: dict[str, object],
    timestamp: str,
    cost: float,
) -> dict[str, object]:
    usage = response.get("usage", {})
    return {
        "ts": timestamp,
        "stage": stage,
        "candidate_id": plan["candidate_id"],
        "issue_id": plan["issue_id"],
        "model": model,
        "response_id": response.get("id"),
        "input_tokens": usage.get("input_tokens", 0) if isinstance(usage, dict) else 0,
        "output_tokens": usage.get("output_tokens", 0) if isinstance(usage, dict) else 0,
        "est_usd": cost,
    }


def run(
    race_id: str,
    *,
    dry_run: bool = False,
    limit: int | None = None,
    only: str | None = None,
    issue: str | None = None,
    max_calls: int = 100,
    max_usd: float = 5.0,
    model: str = "grok-4.3",
    refresh_reviewed: bool = False,
    no_x: bool = False,
    client: XaiClient | None = None,
    page_fetcher: Callable[[str], tuple[int, str]] | None = None,
    wayback_fetcher: Callable[[str], str | None] | None = None,
    oembed_fetcher: Callable[[str], dict[str, object]] | None = None,
) -> int:
    plans = _plans(race_id, limit, only, issue, refresh_reviewed)
    prompt = _prompt()
    x_prompt = _x_prompt()
    cache_dir = DATA / "raw" / "xai"
    cache_dir.mkdir(parents=True, exist_ok=True)
    ledger_path = cache_dir / "ledger.json"
    ledger = read_json(ledger_path) if ledger_path.exists() else []
    if not isinstance(ledger, list):
        ledger = []
    keyed = [(plan, f"stance-{plan['candidate_id']}-{plan['issue_id']}") for plan in plans]
    to_call = sum(1 for _, key in keyed if not (cache_dir / f"{key}.json").exists())
    historical = [
        float(entry["est_usd"])
        for entry in ledger
        if isinstance(entry, dict)
        and entry.get("stage") == "summarize_stance"
        and isinstance(entry.get("est_usd"), (int, float))
    ]
    mean_cost = sum(historical) / len(historical) if historical else 0.04
    print(
        f"planned {len(plans)} units; cached {len(plans) - to_call}; to-call {to_call}; estimated ${to_call * mean_cost:.6f}"
    )
    if dry_run:
        return 0
    if to_call and not client and not XAI_API_KEY:
        print("ERROR XAI_API_KEY is required for uncached classifications", file=sys.stderr)
        return 2
    client = client or XaiClient(XAI_API_KEY)
    existing_path = DATA / "hand" / race_id / "x_stances.json"
    existing = read_json(existing_path) if existing_path.exists() else {"race_id": race_id, "method": "", "rows": []}
    old_rows = existing.get("rows", []) if isinstance(existing, dict) else []
    rows_by_key: dict[tuple[str, str], dict[str, object]] = {}
    processed: set[tuple[str, str]] = set()
    calls = 0
    spent = 0.0
    exit_code = 0
    for plan, key in keyed:
        budget_hit = False
        cache_path = cache_dir / f"{key}.json"
        if cache_path.exists():
            primary_entry = read_json(cache_path)
        else:
            if calls >= max_calls or spent >= max_usd:
                print(f"budget exhausted: {calls} calls used; remaining units are left unprocessed", file=sys.stderr)
                exit_code = 3
                break
            request = _primary_payload(model, prompt, plan)
            response = client.create_response(request)
            timestamp = now_iso()
            primary_entry = {"request": request, "response": response, "retrieved_at": timestamp}
            write_json(cache_path, primary_entry)
            cost = response_cost_usd(model, response)
            spent += cost
            ledger.append(_ledger_entry("summarize_stance", plan, model, response, timestamp, cost))
            write_json(ledger_path, ledger)
            calls += 1
            if spent > max_usd:
                exit_code, budget_hit = 3, True
        processed.add((str(plan["candidate_id"]), str(plan["issue_id"])))
        response = primary_entry.get("response", {}) if isinstance(primary_entry, dict) else {}
        if not isinstance(response, dict):
            if budget_hit:
                break
            continue
        try:
            result = json.loads(output_text(response))
        except (ValueError, json.JSONDecodeError) as exc:
            print(f"WARN {plan['candidate_id']} {plan['issue_id']}: invalid xAI JSON ({exc})", file=sys.stderr)
            if budget_hit:
                break
            continue
        searched, _ = _searched_tool_urls(response, "web")
        error = _validate_primary(result, searched)
        source_errors = (
            [_source_error(source, searched) for source in result.get("sources", [])]
            if isinstance(result, dict) and isinstance(result.get("sources"), list)
            else []
        )
        repair_reason = error
        if (
            repair_reason is None
            and source_errors
            and all(source_error == SOURCE_EXCERPT_ERROR for source_error in source_errors)
        ):
            repair_reason = SOURCE_EXCERPT_ERROR
        if isinstance(result, dict) and result.get("found") is False:
            if budget_hit:
                break
            continue
        if (
            repair_reason in REPAIRABLE_ERRORS | {SOURCE_EXCERPT_ERROR}
            and isinstance(result, dict)
            and result.get("found") is True
        ):
            repair_path = cache_dir / f"{key}.repair.json"
            if repair_path.exists():
                repair_entry = read_json(repair_path)
            elif calls >= max_calls or spent >= max_usd:
                print(f"budget exhausted: {calls} calls used; remaining units are left unprocessed", file=sys.stderr)
                exit_code, budget_hit, repair_entry = 3, True, None
            else:
                repair_request = _repair_payload(model, prompt, plan, result, repair_reason)
                repair_response = client.create_response(repair_request)
                timestamp = now_iso()
                repair_entry = {"request": repair_request, "response": repair_response, "retrieved_at": timestamp}
                write_json(repair_path, repair_entry)
                cost = response_cost_usd(model, repair_response)
                spent += cost
                ledger.append(_ledger_entry("summarize_stance_repair", plan, model, repair_response, timestamp, cost))
                write_json(ledger_path, ledger)
                calls += 1
                if spent > max_usd:
                    exit_code, budget_hit = 3, True
            if isinstance(repair_entry, dict):
                repair_response = repair_entry.get("response", {})
                try:
                    repaired = json.loads(output_text(repair_response))
                except (ValueError, json.JSONDecodeError) as exc:
                    repaired = None
                    repair_error = f"invalid repaired JSON ({exc})"
                else:
                    repair_error = _validate_primary(repaired, searched)
                    if repair_error is None and (
                        not isinstance(repaired, dict)
                        or repaired.get("found") is not True
                        or [
                            _url_key(source.get("url", ""))
                            for source in repaired.get("sources", [])
                            if isinstance(source, dict)
                        ]
                        != [
                            _url_key(source.get("url", ""))
                            for source in result.get("sources", [])
                            if isinstance(source, dict)
                        ]
                    ):
                        repair_error = "source URLs changed during repair"
                if repair_error is None:
                    result, error = repaired, None
                else:
                    print(
                        f"WARN {plan['candidate_id']} {plan['issue_id']}: dropped stance after repair ({repair_error})",
                        file=sys.stderr,
                    )
                    if budget_hit:
                        break
                    result, error = None, repair_error
        if error:
            print(f"WARN {plan['candidate_id']} {plan['issue_id']}: dropped stance ({error})", file=sys.stderr)
        elif isinstance(result, dict):
            verified_sources: list[dict[str, object]] = []
            for source in result["sources"]:
                source_error = _source_error(source, searched)
                if source_error:
                    print(
                        f"WARN {plan['candidate_id']} {plan['issue_id']}: dropped source ({source_error})",
                        file=sys.stderr,
                    )
                    continue
                verified, wayback_url, fetch_error = _fetch_source(
                    str(source["url"]), str(source["excerpt"]), page_fetcher, wayback_fetcher
                )
                if fetch_error:
                    print(
                        f"WARN {plan['candidate_id']} {plan['issue_id']}: dropped source ({fetch_error})",
                        file=sys.stderr,
                    )
                    continue
                if not verified:
                    print(
                        f"WARN {plan['candidate_id']} {plan['issue_id']}: source fetch failed; retained unverified",
                        file=sys.stderr,
                    )
                source_row = dict(source)
                source_row["excerpt_verified"] = bool(verified)
                if wayback_url:
                    source_row["wayback_url"] = wayback_url
                verified_sources.append(source_row)
            if not any(source.get("excerpt_verified") for source in verified_sources):
                print(
                    f"WARN {plan['candidate_id']} {plan['issue_id']}: dropped stance (no verified source)",
                    file=sys.stderr,
                )
            else:
                posts: list[dict[str, object]] = []
                x_used = False
                if not no_x and plan["handles"] and not budget_hit:
                    x_key = f"{key}.x"
                    x_cache = cache_dir / f"{x_key}.json"
                    if x_cache.exists():
                        x_entry = read_json(x_cache)
                        x_used = True
                    elif calls >= max_calls or spent >= max_usd:
                        exit_code, budget_hit = 3, True
                        x_entry = None
                    else:
                        x_request = _x_payload(model, x_prompt, plan)
                        x_response = client.create_response(x_request)
                        timestamp = now_iso()
                        x_entry = {"request": x_request, "response": x_response, "retrieved_at": timestamp}
                        write_json(x_cache, x_entry)
                        cost = response_cost_usd(model, x_response)
                        spent += cost
                        ledger.append(_ledger_entry("summarize_stance_x", plan, model, x_response, timestamp, cost))
                        write_json(ledger_path, ledger)
                        calls += 1
                        x_used = True
                        if spent > max_usd:
                            exit_code, budget_hit = 3, True
                    if isinstance(x_entry, dict) and isinstance(x_entry.get("response"), dict):
                        x_response = x_entry["response"]
                        x_searched, exposed = _searched_tool_urls(x_response, "x")
                        try:
                            x_result = json.loads(output_text(x_response))
                        except (ValueError, json.JSONDecodeError):
                            x_result = {}
                        posts = _verify_posts(x_result, list(plan["handles"]), x_searched, exposed, oembed_fetcher)
                rows_by_key[(str(plan["candidate_id"]), str(plan["issue_id"]))] = _row(
                    plan,
                    result,
                    response,
                    str(primary_entry["retrieved_at"]),
                    verified_sources,
                    posts,
                    model,
                    x_used,
                )
        if budget_hit:
            break
    kept = [
        row
        for row in old_rows
        if isinstance(row, dict) and (str(row.get("candidate_id")), str(row.get("issue_id"))) not in processed
    ]
    output = {
        "race_id": race_id,
        "method": "machine stance suggestions from web/news sources, with optional verified X posts; pending human review",
        "rows": sorted(
            [*kept, *rows_by_key.values()], key=lambda row: (str(row["candidate_id"]), str(row["issue_id"]))
        ),
    }
    write_json(existing_path, output)
    print(f"classified {len(rows_by_key)} stances; {calls} API calls; estimated ${spent:.6f}")
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only")
    parser.add_argument("--issue")
    parser.add_argument("--max-calls", type=int, default=100)
    parser.add_argument("--max-usd", type=float, default=5.0)
    parser.add_argument("--model", default="grok-4.3")
    parser.add_argument("--refresh-reviewed", action="store_true")
    parser.add_argument("--no-x", action="store_true")
    args = parser.parse_args()
    return run(
        args.race,
        dry_run=args.dry_run,
        limit=args.limit,
        only=args.only,
        issue=args.issue,
        max_calls=args.max_calls,
        max_usd=args.max_usd,
        model=args.model,
        refresh_reviewed=args.refresh_reviewed,
        no_x=args.no_x,
    )


if __name__ == "__main__":
    sys.exit(main())
