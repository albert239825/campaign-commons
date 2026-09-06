"""Classify cached ad transcripts with xAI structured output."""

from __future__ import annotations

import argparse
import hashlib
import json
import string
import sys
from typing import Any

from .config import DATA, RACES, ROOT, XAI_API_KEY
from .dossier import issue_ids
from .util import now_iso, read_json, write_json
from .xai_client import XaiClient, estimate_usd, output_text

PROMPT_VERSION = "classify_ad.v1"
PROMPT_PATH = ROOT / "pipeline" / "campaign_commons" / "prompts" / "enrich" / f"{PROMPT_VERSION}.md"
ISSUES_TAXONOMY = ROOT / "contracts" / "jsonschema" / "issues_taxonomy.json"


def _transcript_files() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    yt_dir = DATA / "raw" / "yt"
    if not yt_dir.exists():
        return out
    for path in sorted(yt_dir.glob("*.json")):
        if path.name == "video_ids.json":
            continue
        try:
            loaded = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(loaded, dict) and isinstance(loaded.get("ad_id"), str):
            out[loaded["ad_id"]] = loaded
    return out


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


def _schema(issue_ids_: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["issue_ids", "quote", "rationale", "confidence"],
        "properties": {
            "issue_ids": {
                "type": "array",
                "maxItems": 2,
                "items": {"type": "string", "enum": issue_ids_},
            },
            "quote": {"type": ["string", "null"], "maxLength": 280},
            "rationale": {"type": "string", "maxLength": 200},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        },
    }


def _payload(model: str, prompt: str, issue_ids_: list[str], transcript: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": f"Transcript ({transcript.get('kind')}, {transcript.get('language')}):\n\n{transcript.get('text')}",
            },
        ],
        "temperature": 0,
        "seed": 7,
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "ad_issue_tags",
                "strict": True,
                "schema": _schema(issue_ids_),
            }
        },
    }


def _normalised(text: str) -> str:
    table = str.maketrans({char: " " for char in string.punctuation})
    return " ".join(text.lower().translate(table).split())


def _validate_result(result: Any, transcript_text: str, known: set[str]) -> str | None:
    if not isinstance(result, dict):
        return "response JSON is not an object"
    issue_values = result.get("issue_ids")
    if not isinstance(issue_values, list) or not all(isinstance(value, str) for value in issue_values):
        return "issue_ids is not a string array"
    if any(value not in known for value in issue_values):
        return "issue_ids contains an off-taxonomy id"
    if len(issue_values) != len(set(issue_values)):
        return "issue_ids contains duplicates"
    quote = result.get("quote")
    if not (quote is None or isinstance(quote, str)):
        return "quote is neither a string nor null"
    if isinstance(quote, str) and len(quote) > 280:
        return "quote is too long"
    if not issue_values and quote is not None:
        return "quote must be null when issue_ids is empty"
    if isinstance(quote, str) and _normalised(quote) not in _normalised(transcript_text):
        return "quote is not a transcript substring"
    rationale = result.get("rationale")
    if not isinstance(rationale, str) or len(rationale) > 200:
        return "rationale is missing or too long"
    if result.get("confidence") not in {"high", "medium", "low"}:
        return "confidence is invalid"
    return None


def _cache_key(model: str, ad_id: str, text: str) -> str:
    text_hash = hashlib.sha256(text.encode()).hexdigest()
    return hashlib.sha256(f"{model}{PROMPT_VERSION}{ad_id}{text_hash}".encode()).hexdigest()


def _parse_response(response: dict[str, Any]) -> dict[str, Any]:
    text = output_text(response)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("xAI output is not an object")
    return parsed


def _machine_row(
    ad: dict[str, Any],
    transcript: dict[str, Any],
    parsed: dict[str, Any],
    model: str,
    retrieved_at: str,
    response: dict[str, Any],
) -> dict[str, Any]:
    video_id = str(transcript["video_id"])
    return {
        "ad_id": str(ad["ad_id"]),
        "issue_ids": list(parsed["issue_ids"]),
        "quote": parsed["quote"],
        "rationale": parsed["rationale"],
        "transcript_kind": transcript["kind"],
        "source_urls": [str(ad["creative_url"]), f"https://www.youtube.com/watch?v={video_id}"],
        "provenance": {
            "tagged_by": f"xai-{model}-{retrieved_at[:10]}",
            "tagged_at": retrieved_at[:10],
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "tools": [],
            "tool_filters": {},
            "response_id": response.get("id"),
            "retrieved_at": retrieved_at,
            "citations": [],
            "confidence": parsed["confidence"],
            "review_status": "pending",
            "reviewed_by": None,
            "reviewed_at": None,
            "review_note": None,
        },
    }


def _units(
    race_id: str, only: str | None, limit: int | None, refresh_reviewed: bool
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    ads = read_json(RACES[race_id].out_dir / "ads.json").get("ads", [])
    transcripts = _transcript_files()
    hand_path = DATA / "hand" / race_id / "x_ad_issues.json"
    existing = read_json(hand_path) if hand_path.exists() else {"rows": []}
    reviewed = {
        str(row.get("ad_id")): row
        for row in existing.get("rows", [])
        if isinstance(row, dict)
        and isinstance(row.get("provenance"), dict)
        and row["provenance"].get("review_status") in {"accepted", "rejected"}
    }
    units: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for ad in sorted((a for a in ads if isinstance(a, dict)), key=lambda item: str(item.get("ad_id"))):
        ad_id = str(ad.get("ad_id"))
        transcript = transcripts.get(ad_id)
        if only is not None and ad_id != only:
            continue
        if transcript is None or not isinstance(transcript.get("text"), str) or not transcript["text"].strip():
            continue
        if not refresh_reviewed and ad_id in reviewed:
            continue
        units.append((ad, transcript))
    return units[:limit] if limit is not None else units


class BudgetExceeded(RuntimeError):
    pass


def run(
    race_id: str,
    *,
    dry_run: bool = False,
    limit: int | None = None,
    only: str | None = None,
    max_calls: int = 600,
    max_usd: float = 5.0,
    model: str = "grok-4.3",
    refresh_reviewed: bool = False,
    client: XaiClient | None = None,
) -> int:
    units = _units(race_id, only, limit, refresh_reviewed)
    prompt = _prompt()
    cache_dir = DATA / "raw" / "xai"
    cache_dir.mkdir(parents=True, exist_ok=True)
    issue_id_list, _ = _taxonomy()
    plans = [(ad, transcript, _cache_key(model, str(ad["ad_id"]), str(transcript["text"]))) for ad, transcript in units]
    to_call = sum(1 for _, _, key in plans if not (cache_dir / f"{key}.json").exists())
    estimated = to_call * estimate_usd(model, {"input_tokens": 1500, "output_tokens": 100})
    print(f"planned {len(plans)} units; cached {len(plans) - to_call}; to-call {to_call}; estimated ${estimated:.6f}")
    if dry_run:
        return 0
    if to_call and not XAI_API_KEY and client is None:
        print("ERROR XAI_API_KEY is required for uncached classifications", file=sys.stderr)
        return 2
    client = client or XaiClient(XAI_API_KEY)
    rows_by_id: dict[str, dict[str, Any]] = {}
    calls = 0
    spent = 0.0
    exit_code = 0
    ledger_path = cache_dir / "ledger.json"
    ledger = read_json(ledger_path) if ledger_path.exists() else []
    if not isinstance(ledger, list):
        ledger = []
    for ad, transcript, key in plans:
        budget_hit = False
        cache_path = cache_dir / f"{key}.json"
        if cache_path.exists():
            entry = read_json(cache_path)
        else:
            if calls >= max_calls:
                print(
                    f"budget exhausted: {calls} calls used, {len(plans) - len(rows_by_id)} units remain",
                    file=sys.stderr,
                )
                exit_code = 3
                break
            payload = _payload(model, prompt, issue_id_list, transcript)
            response = client.create_response(payload)
            retrieved_at = now_iso()
            entry = {"request": payload, "response": response, "retrieved_at": retrieved_at}
            write_json(cache_path, entry)
            usage = response.get("usage", {}) if isinstance(response, dict) else {}
            input_tokens = int(usage.get("input_tokens", 0) or 0) if isinstance(usage, dict) else 0
            output_tokens = int(usage.get("output_tokens", 0) or 0) if isinstance(usage, dict) else 0
            est_usd = estimate_usd(model, {"input_tokens": input_tokens, "output_tokens": output_tokens})
            spent += est_usd
            calls += 1
            ledger.append(
                {
                    "ts": retrieved_at,
                    "stage": "classify_ad",
                    "ad_id": str(ad["ad_id"]),
                    "model": model,
                    "response_id": response.get("id"),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "est_usd": est_usd,
                }
            )
            write_json(ledger_path, ledger)
            if spent > max_usd:
                print(f"budget exhausted: ${spent:.6f} used, ${max(0.0, max_usd - spent):.6f} left", file=sys.stderr)
                exit_code = 3
                budget_hit = True
        response = entry.get("response", {})
        try:
            parsed = _parse_response(response)
        except (ValueError, json.JSONDecodeError) as exc:
            print(f"WARN {ad['ad_id']}: invalid xAI JSON ({exc})", file=sys.stderr)
        else:
            error = _validate_result(parsed, str(transcript["text"]), set(issue_id_list))
            if error:
                print(f"WARN {ad['ad_id']}: dropped classification ({error})", file=sys.stderr)
            else:
                rows_by_id[str(ad["ad_id"])] = _machine_row(
                    ad, transcript, parsed, model, str(entry["retrieved_at"]), response
                )
        if budget_hit:
            break
    hand_path = DATA / "hand" / race_id / "x_ad_issues.json"
    existing = read_json(hand_path) if hand_path.exists() else {"race_id": race_id, "method": "", "rows": []}
    old_rows = existing.get("rows", []) if isinstance(existing, dict) else []
    processed = {str(ad["ad_id"]) for ad, _, _ in plans}
    kept = [row for row in old_rows if isinstance(row, dict) and str(row.get("ad_id")) not in processed]
    output = {
        "race_id": race_id,
        "method": (
            "machine rows, classified by xAI from YouTube auto-captions of the creative, pending human review; "
            "human ad_issues.json always wins"
        ),
        "rows": sorted([*kept, *rows_by_id.values()], key=lambda row: str(row["ad_id"])),
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
    parser.add_argument("--max-calls", type=int, default=600)
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
