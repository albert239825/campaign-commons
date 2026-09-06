"""Read spenders' own websites and record explicitly stated positions on the frozen issue taxonomy.

The stage never infers a position from spending, endorsements, donors, or tone. A model may suggest a position, but
the row is kept only when its quote is an exact (whitespace-normalized) substring of text fetched from the source site.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

from .config import DATA, FEC_API, FEC_API_KEY, RACES, RAW, XAI_API_KEY, XAI_MODEL
from .util import now_iso, read_json, write_json

HAND = DATA / "hand"
USER_AGENT = "campaign-commons-issues-enrich"
LINK_TERMS = re.compile(r"about|issue|priorit|mission|who-we-are|what-we|agenda|values|platform", re.I)
SYSTEM = "You read a political committee's own website text and record only the positions it states itself. You are given a fixed list of issues, each with a plus side and a minus side. For each issue on which the text states a position, output the issue id, a direction (+2 strongly the plus side, +1 leans plus, 0 takes a position that is neither side, -1 leans minus, -2 strongly the minus side) and one quote copied character-for-character from the text that shows it. Rules: use only issue ids from the list; never infer a position from party, candidates supported or opposed, donors or tone — only from an explicit statement about the issue; if the text states no position on an issue, omit it; quotes must be exact substrings of the given text, at most 300 characters, no paraphrase, no ellipsis. Output nothing else."
POSITION_METHOD = "Model-read from the committee's own site; quotes are verified verbatim by the stage; status model until a person reviews"

# Keep this copy alongside the source taxonomy so the request is deterministic and usable without a TypeScript runtime.
ISSUE_AXES = {
    "healthcare": (
        "Larger federal role in health coverage and drug-price regulation",
        "Smaller federal role; market-based coverage",
    ),
    "energy_climate": (
        "Emissions rules and clean-energy policy first",
        "Fossil-fuel production and fewer energy regulations first",
    ),
    "defense": (
        "Higher defense spending and more foreign military aid",
        "Lower defense spending and fewer foreign military commitments",
    ),
    "crypto_fintech": (
        "Tighter regulation of crypto and financial firms",
        "Lighter regulation of crypto and financial firms",
    ),
    "immigration": (
        "Stricter border enforcement and immigration limits",
        "Broader legal pathways and less enforcement",
    ),
    "abortion": ("Protect abortion access in federal law", "Restrict abortion access"),
    "guns": ("Stricter firearms regulation", "Fewer restrictions on firearms"),
    "tax_budget": ("More federal revenue and program spending", "Lower taxes and less federal spending"),
    "tech_ai": ("Stronger regulation of large tech and AI", "Lighter regulation of tech and AI"),
    "labor_trade": ("Stronger union protections and trade enforcement", "Fewer labor rules and freer trade"),
}
ISSUE_LABELS = {
    "healthcare": "Health care",
    "energy_climate": "Energy & climate",
    "defense": "Defense & national security",
    "crypto_fintech": "Crypto & financial regulation",
    "immigration": "Immigration & border",
    "abortion": "Abortion & reproductive rights",
    "guns": "Guns",
    "tax_budget": "Taxes & budget",
    "tech_ai": "Tech, AI & antitrust",
    "labor_trade": "Labor & trade",
}
ISSUE_IDS = tuple(ISSUE_AXES)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _allowed_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "web.archive.org" or (host not in {"fec.gov", "www.fec.gov", "archive.org", "www.archive.org"})


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.skip_depth = 0
        self.link_href: str | None = None
        self.link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "nav", "footer"}:
            self.skip_depth += 1
        if tag == "a" and not self.skip_depth:
            self.link_href = dict(attrs).get("href")
            self.link_text = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self.link_href is not None:
            self.links.append((self.link_href, " ".join(self.link_text)))
            self.link_href = None
            self.link_text = []
        if tag in {"script", "style", "nav", "footer"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        self.parts.append(data)
        if self.link_href is not None:
            self.link_text.append(data)


def page_text(body: str) -> tuple[str, list[tuple[str, str]]]:
    parser = _PageParser()
    try:
        parser.feed(body)
        text = " ".join(parser.parts)
    except Exception:
        text = body
    return normalize(html.unescape(text)), parser.links


@dataclass(frozen=True)
class Page:
    url: str
    text: str
    fetched_at: str


def _cache_path(race_id: str, entity_id: str, url: str) -> Path:
    digest = hashlib.sha1(url.encode()).hexdigest()
    return RAW / "issues_enrich" / race_id / entity_id / f"{digest}.txt"


def _fetch(url: str) -> str:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    response.raise_for_status()
    return response.text


def fetch_pages(
    race_id: str, entity_id: str, urls: list[str], refetch: bool = False, dry_run: bool = False
) -> list[Page]:
    pages: list[Page] = []
    seen: set[str] = set()
    for root in urls:
        if root in seen or not _allowed_url(root):
            continue
        seen.add(root)
        cache = _cache_path(race_id, entity_id, root)
        if cache.exists() and not refetch and not dry_run:
            raw = cache.read_text()
        else:
            try:
                raw = _fetch(root)
            except Exception as exc:
                print(f"{entity_id}: fetch failed {root}: {exc}", file=sys.stderr)
                continue
            if not dry_run:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(raw)
        text, links = page_text(raw)
        if not text:
            continue
        pages.append(Page(root, text, now_iso()))
        host = urlparse(root).netloc.lower()
        candidates = []
        for href, link_text in links:
            if not href or not LINK_TERMS.search(f"{href} {link_text}"):
                continue
            child = urljoin(root, href)
            parsed = urlparse(child)
            if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != host or child in seen:
                continue
            candidates.append(child)
        for child in candidates[:4]:
            seen.add(child)
            child_cache = _cache_path(race_id, entity_id, child)
            if child_cache.exists() and not refetch and not dry_run:
                child_raw = child_cache.read_text()
            else:
                try:
                    child_raw = _fetch(child)
                except Exception as exc:
                    print(f"{entity_id}: fetch failed {child}: {exc}", file=sys.stderr)
                    continue
                if not dry_run:
                    child_cache.parent.mkdir(parents=True, exist_ok=True)
                    child_cache.write_text(child_raw)
            child_text, _ = page_text(child_raw)
            if child_text:
                pages.append(Page(child, child_text, now_iso()))
        break
    total = 0
    capped: list[Page] = []
    for page in pages:
        remaining = 30_000 - total
        if remaining <= 0:
            break
        text = page.text[:remaining]
        capped.append(Page(page.url, text, page.fetched_at))
        total += len(text)
    return capped


def discover_urls(race_id: str, spenders: list[dict], focus_rows: list[dict]) -> dict[str, list[str]]:
    urls: dict[str, list[str]] = {str(s["entity_id"]): [] for s in spenders}
    by_entity: dict[str, dict] = {str(s["entity_id"]): s for s in spenders}
    for row in focus_rows:
        entity_id = str(row.get("entity_id", ""))
        if entity_id not in by_entity:
            continue
        for url in row.get("source_urls", []):
            if isinstance(url, str) and _allowed_url(url) and url not in urls[entity_id]:
                urls[entity_id].append(url)
    committees = [eid for eid in urls if not eid.startswith("org:")]
    for start in range(0, len(committees), 100):
        ids = committees[start : start + 100]
        page = 1
        while True:
            try:
                response = requests.get(
                    f"{FEC_API}/committees/",
                    params={"api_key": FEC_API_KEY, "committee_id": ids, "per_page": 100, "page": page},
                    timeout=20,
                )
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:
                print(f"FEC website discovery failed: {exc}", file=sys.stderr)
                break
            for result in payload.get("results", []):
                entity_id = result.get("committee_id")
                website = result.get("website")
                if entity_id in urls and isinstance(website, str) and website and website not in urls[entity_id]:
                    urls[entity_id].append(website)
            pagination = payload.get("pagination", {})
            if not pagination.get("pages") or page >= pagination["pages"]:
                break
            page += 1
    return urls


def _request_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "positions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "enum": list(ISSUE_IDS)},
                        "direction": {"type": "integer", "minimum": -2, "maximum": 2},
                        "quote": {"type": "string"},
                    },
                    "required": ["issue_id", "direction", "quote"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["positions"],
        "additionalProperties": False,
    }


def model_positions(name: str, entity_id: str, text: str) -> list[dict]:
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY is not set")
    issues = "\n".join(
        f"- {issue_id}: {ISSUE_LABELS[issue_id]}. plus = {plus}; minus = {minus}"
        for issue_id, (plus, minus) in ISSUE_AXES.items()
    )
    user = f"Committee: {name} ({entity_id})\n\nIssues:\n{issues}\n\nText:\n{text}"
    response = requests.post(
        "https://api.x.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {XAI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": XAI_MODEL,
            "temperature": 0,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "issue_positions", "strict": True, "schema": _request_schema()},
            },
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    parsed = json.loads(content) if isinstance(content, str) else content
    positions = parsed.get("positions")
    if not isinstance(positions, list):
        raise ValueError("model response has no positions array")
    return positions


def guard_positions(entity_id: str, positions: list[dict], pages: list[Page]) -> tuple[list[dict], int]:
    normalized_pages = [(page.url, normalize(page.text)) for page in pages]
    kept: list[dict] = []
    dropped = 0
    seen: set[str] = set()
    for position in positions:
        issue_id = position.get("issue_id")
        quote = position.get("quote")
        if issue_id not in ISSUE_AXES or issue_id in seen or not isinstance(quote, str) or not quote.strip():
            dropped += 1
            continue
        normalized_quote = normalize(quote)
        source_url = next((url for url, text in normalized_pages if normalized_quote in text), None)
        if source_url is None:
            dropped += 1
            continue
        direction = position.get("direction")
        if not isinstance(direction, int) or not -2 <= direction <= 2:
            dropped += 1
            continue
        kept.append({"issue_id": issue_id, "direction": direction, "quote": quote, "source_url": source_url})
        seen.add(issue_id)
    return kept, dropped


def _existing(path: Path) -> dict:
    if not path.exists():
        return {"rows": [], "pages": []}
    loaded = read_json(path)
    return loaded if isinstance(loaded, dict) else {"rows": [], "pages": []}


def run(race_id: str, refetch: bool = False, only: list[str] | None = None, dry_run: bool = False) -> dict:
    race = RACES[race_id]
    out_dir = race.out_dir
    ledger = read_json(out_dir / "ledger.json")
    spenders = ledger.get("top_outside_spenders", [])
    focus = _existing(HAND / race_id / "issue_focus.json").get("rows", [])
    urls = discover_urls(race_id, spenders, focus)
    path = HAND / race_id / "issue_positions.json"
    previous = _existing(path)
    previous_rows = previous.get("rows", [])
    by_entity: dict[str, list[dict]] = {}
    for row in previous_rows:
        by_entity.setdefault(str(row.get("entity_id")), []).append(row)
    rows: list[dict] = []
    pages_out: list[dict] = []
    kept_count = dropped_count = 0
    selected = set(only or urls)
    untouched = set(urls) - selected
    for entity_id in untouched:
        rows.extend(by_entity.get(entity_id, []))
    for spender in spenders:
        entity_id = str(spender["entity_id"])
        name = str(spender.get("name", entity_id))
        if entity_id not in selected:
            continue
        old = by_entity.get(entity_id, [])
        verified = [r for r in old if r.get("status") == "verified"]
        if verified and not refetch:
            rows.extend(verified)
            pages_out.extend(page for page in previous.get("pages", []) if page.get("entity_id") == entity_id)
            continue
        pages = fetch_pages(race_id, entity_id, urls.get(entity_id, []), refetch=refetch, dry_run=dry_run)
        pages_out.extend(
            {"entity_id": entity_id, "url": p.url, "fetched_at": p.fetched_at, "chars": len(p.text)} for p in pages
        )
        if not pages:
            rows.extend(verified)
            continue
        try:
            model = model_positions(name, entity_id, "\n\n".join(p.text for p in pages))
            valid, dropped = guard_positions(entity_id, model, pages)
        except Exception as exc:
            print(f"{entity_id}: model failed: {exc}", file=sys.stderr)
            rows.extend(verified)
            continue
        dropped_count += dropped
        tagged_at = date.today().isoformat()
        rows.extend(verified)
        verified_ids = {position["issue_id"] for position in verified}
        rows.extend(
            {
                **position,
                "entity_id": entity_id,
                "name": name,
                "status": "model",
                "tagged_by": XAI_MODEL,
                "tagged_at": tagged_at,
            }
            for position in valid
            if position["issue_id"] not in verified_ids
        )
        kept_count += len(valid) - sum(position["issue_id"] in verified_ids for position in valid)
    rows.sort(key=lambda row: (row["entity_id"], row["issue_id"]))
    pages_out.sort(key=lambda page: (page["entity_id"], page["url"]))
    result = {"race_id": race_id, "method": POSITION_METHOD, "rows": rows, "pages": pages_out}
    print(f"issue_positions: kept {kept_count}, dropped {dropped_count}")
    if not dry_run:
        write_json(path, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("race")
    parser.add_argument("--refetch", action="store_true")
    parser.add_argument("--only", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.race, refetch=args.refetch, only=args.only, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
