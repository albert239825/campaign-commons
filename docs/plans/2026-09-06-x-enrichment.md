# Block 3 child F — LLM enrichment (web/news first, X supplement, ad transcripts): design

_2026-09-06 · owner: child F · status: **agreed (rev 4); Phase 2 building, ads stage first** · Albert's decisions: drop
D-09 entirely (runtime LLM calls are coming); web/news search is the primary source, X posts only a supplement for
candidates; spenders from their website only (no X); ads tagged from their transcripts, with Albert running the caption
fetch locally (`make enrich-transcripts`); store and cite every source._

Provider for everything: xAI `POST /v1/responses` (`XAI_API_KEY` credits) with server-side `web_search` and `x_search`,
JSON-schema output, `response.citations` as the source URLs. No X API. Standing rules unchanged: every visible claim carries
a `source_url`; no causal language; money vs targeting stay distinct; contracts additive-only; the record layer is never
overwritten by machine output; machine output never produces a number.

## 0. The plan in one screen

| # | Consumer | Sources (in order) | Output | Cost | Order |
| --- | --- | --- | --- | --- | --- |
| 1 | **Ad issue tags** — 458 untagged of 500 | The ad itself: YouTube auto-captions of the video (pipeline already resolves `video_id` for VIDEO ads, D-22) → Grok classifies into `ISSUES`; TEXT ads from their text. No search at all. | `x_ad_issues.json` → `ads.json[].machine_issues` | ~500 × 2k tokens ≈ **$2**; no tool calls | **First** — biggest gap, cheapest, most certain (it reads the creative, not talk about it) |
| 2 | **Dossier stances** — both candidates, 10 issues | `web_search` (news, campaign site, senate.gov, votesmart.org, ballotpedia) → summary with citations; then `x_search` on the candidate's verified handles as a supplement ("in their own words") | `x_stances.json` → `dossiers/<id>.enrichment` | 20 units × ~6 calls ≈ 120 calls ≈ **$1** + tokens | Second |
| 3 | **Spender self-description** — 75 untagged of 98 | `web_search` on the committee's own site (`allowed_domains`), else open web (OpenSecrets, press). **No X.** | `x_issue_focus.json` → `entities/<id>.x_enrichment` | 75 × ~3 calls ≈ **$1** + tokens | Third (only 2.6% of dollars) |
| — | IE notices | nothing to join on (no topic in the notice; date ≠ relationship, D-74) | — | — | Drop |

Whole batch ≈ **$5–10**; re-runs free from cache.

## 1. Ads from transcripts (new — answers "can we get the transcripts?")

**Yes, with one constraint.** `ads_creatives.py` already turns a creative id into a YouTube `video_id` (checked today:
`CR05367732770854404097 → 8tImprYNVDU`). YouTube serves auto-generated captions for most videos without any key
(`youtube-transcript-api` / `yt-dlp --write-auto-sub`). **But YouTube blocks datacenter IPs** — tested from this VM:
`RequestBlocked`. **Decision: Albert runs `make enrich-transcripts` locally** (residential IP; ~460 short requests, no
key) which fills `data/raw/yt/`; the Grok classification and everything else run from that cache anywhere. Fallbacks, in order: (a) no captions → `yt-dlp` audio +
local Whisper (30-s ads, seconds each); (b) still nothing → `cached_creative_path` poster frame to Grok with image
understanding (weak; low confidence); (c) TEXT/IMAGE ads: the transparency lookup RPC / preview JS contains the rendered
text for TEXT ads — to confirm in the smoke test.

Row shape mirrors `ad_issues.json` + provenance: `{ad_id, issue_ids (≤2), quote (≤280 chars of transcript), transcript_kind:
"auto_caption"|"whisper"|"ad_text"|"poster", source_urls: [creative_url, youtube_url], ...MachineProvenance}`. Transcripts are
cached in `data/raw/yt/<video_id>.json` (gitignored); only the quote is committed. Human `ad_issues.json` always wins;
`ads.json` gets an optional `machine_issues` block, UI label "Machine-tagged from the ad's transcript (<model>, <date>)".
Coverage estimate: 485 video ads; expect 70–85% to have auto-captions (political ads are speech-heavy) — the smoke test
on the 26 cached ads tells us.

## 2. Dossier stances — web/news first, X as supplement

- **Call 1 (primary)** per candidate × issue: `web_search`, no domain restriction but the prompt names preferred sources
  (news outlets, congress.gov/senate.gov, votesmart.org, ballotpedia.org, the campaign site) and forbids opinion/social
  sources; the 2023–24 window goes in the prompt (`web_search` has no documented date filter). Output: `summary` (≤3 sentences, each tied to a citation), `sources[]` {url, publisher,
  published_on as reported, excerpt ≤280}, `confidence`, `direction_proposed`.
- **Call 2 (supplement)**: `x_search` with `allowed_x_handles` = verified handles (`x_accounts.json`, confirmed from campaign
  site / senate.gov — `@SenBobCasey`, `@Bob_Casey`, `@DaveMcCormickPA` pending confirmation), same window. Output:
  `posts[]` {url, excerpt, posted_on} — shown as "in their own words", never as the summary's basis.
- **Verification**: every URL must be in `response.citations`; X posts are checked via X's public oEmbed
  (`publish.x.com/oembed`, no key, confirmed working) for excerpt text and canonical author → `excerpt_verified`. Web
  excerpts: fetch the page, substring check where the page is static; else `excerpt_verified: false` and human review.
- **Renders** under each issue's record evidence as a labelled block: "Machine-summarised from news/web (<model>, <date>);
  not part of the record" + source list + "On X" strip. `Stance.evidence`, `EvidenceKind`, `direction`, dossier `summary`
  stay record-only (D-23, D-76). The future runtime Enrich button makes the same two calls with the user's prompt appended.

## 3. Spender self-description

`web_search` with `filters.allowed_domains = [committee website]` when FEC lists one (About page — how the human rows were
made); otherwise open web, row written only if the found page names the committee/FEC id. **No `x_search` for spenders**
(Albert). Output mirrors `HandIssueFocusRow` (kind, ≤3 issues, description, quote, source_urls) +
provenance → `entities/<id>.x_enrichment.issue_focus`; human `issue_focus` untouched; `by_spender_focus` counts human rows
only unless Albert wants accepted rows in (Q5).

## 4. Common machinery

```ts
MachineProvenance = { tagged_by: "xai-<model>-<date>", tagged_at, model, prompt_version, tools: ("web_search"|"x_search")[],
  tool_filters, response_id, retrieved_at, citations: url[], confidence, review_status: "pending"|"accepted"|"rejected",
  reviewed_by, reviewed_at, review_note }
```

- Stage `campaign_commons/enrich.py` (`make enrich {ads,stances,spenders,all}`; not in `make all`): plan → call (cached in
  `data/raw/xai/<sha256(model+prompt_version+unit+filters)>.json`, xAI keeps responses only 30 days) → verify (oEmbed /
  page fetch, cached) → write hand-style rows → `ads_enrich.py` / `dossier.py` / `issues.py` patch the optional blocks.
  `--dry-run --limit --only --max-calls --max-usd --model --refresh-reviewed`; `seed`, `temperature 0`, `max_turns` cap;
  backoff on 429/5xx; byte-identical re-runs from cache; fixtures replayed in tests, CI never touches the network.
- Prompts versioned in `pipeline/campaign_commons/prompts/enrich/*.v1.md`. Off-taxonomy ids, URLs not in `citations`, X
  URLs off the allowed handles → row dropped and logged, never repaired.
- Review: rows start `pending`; `make enrich-review` prints proposal vs human row, excerpts with verification flags, links,
  and a `data/out` diff; a person flips `review_status` in the hand file; `make validate` rejects `accepted` without
  `reviewed_by`. Pending rows render only inside their labelled block, never in aggregates or headlines.
- Committed files hold URLs + ≤280-char excerpts, never full posts/transcripts (repo is public — Q2).

## 5. Decisions

- **Remove D-09** ("no LLM anywhere") — superseded, per Albert: LLM calls are allowed both in the pipeline and at runtime.
  Replace with **D-79**: LLM-derived data lives in a separately stored, labelled layer (`x_*.json` hand files; optional
  `machine_issues` / `enrichment` / `x_enrichment` output blocks) with provenance (`tagged_by`, model, prompt version,
  tools + filters, `response_id`, `retrieved_at`, full `citations`, confidence, `review_status`); it never overwrites
  record-based fields, never substitutes for a `source_url`, never produces a number; cited URLs must be in `citations`;
  pending rows are `inferred`, accepted rows `verified` with the reviewer's handle. Answers Q-13.
- D-02/D-13 (static, no runtime fetch) will need their own amendment when the runtime Enrich button is built — not in
  this child.

## 6. Questions

| # | Question | Default |
| --- | --- | --- |
| Q1 | ~~Ads first? Who runs the caption fetch?~~ **Answered: ads first; Albert runs `make enrich-transcripts` locally.** | — |
| Q2 | Repo public → commit excerpts/URLs only? | yes |
| Q3 | Budget cap for the batch? | $15 |
| Q4 | Model: `grok-4.3` if it accepts structured output + tools (1-call smoke test), else `grok-4.6`? | 4.3 → 4.6 |
| Q5 | Should accepted machine focus rows join `by_spender_focus`? | no |
| Q6 | Confirm candidate handles; count Casey's Senate account or campaign only? | both, labelled |
| Q7 | Keep `direction_proposed` (stored, never live)? | yes |
| Q8 | VoteSmart: licence-only API, pages render a loading shell — leave to `web_search` citations? | yes |

## Appendix — verified facts (2026-09-06)

- xAI tools: `x_search` filters `allowed_x_handles`/`excluded_x_handles` (max 20, not both), `from_date`/`to_date` ISO
  inclusive, image/video understanding (https://docs.x.ai/developers/tools/x-search); `web_search` `filters.allowed_domains`
  / `excluded_domains` (max 5, not both), no date filter documented (https://docs.x.ai/developers/tools/web-search).
- Citations: `response.citations` "comprehensive list of URLs … always returned"; `url_citation` annotations carry url +
  offsets only; "server-side tool call outputs are not returned" (https://docs.x.ai/developers/tools/citations,
  /tool-usage-details). Max results per call: not documented.
- Pricing: $5 / 1k successful tool calls (web or X); `grok-4.3` $1.25/$2.50 per 1M, `grok-4.6` $2/$6
  (https://docs.x.ai/developers/pricing). Structured output + server-side tools supported for "supported Grok 4 family
  models" (…/structured-outputs). `seed` best-effort; responses retained 30 days; `GET /v1/responses/{id}`.
- oEmbed: `GET https://publish.x.com/oembed?url=<permalink>` → 200 JSON with canonical `url`, `author_name`, `html` (post
  text); 404 for missing posts. Tested from this VM.
- YouTube captions: `youtube-transcript-api` → `RequestBlocked` from this VM (cloud IP); the library documents residential
  IP / proxy as the workaround. `video_id` resolution via the transparency-site RPC works (`ads_creatives.py`).
- VoteSmart: API needs a licensee key; PCT pages for Casey (`BS031306`) / McCormick (`WNY93024`) render a loading shell.
- Redistribution of X content obtained via xAI: not addressed in xAI docs (UNKNOWN).
