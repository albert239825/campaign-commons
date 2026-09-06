# Block 3 child F — Grok (xAI) enrichment with X search: design

_2026-09-06 · owner: child F · status: **design for review, nothing built**. Rev 2: Albert has **xAI API credits only, no X
API access** — the design is Grok-only, using xAI's server-side `x_search` / `web_search` tools._

Why: issue tagging is thin and hand-made. `issue_focus.json` covers 23 of 98 outside spenders (34 rows; 11 are `org:` chain
funders), `ad_issues.json` 42 of 500 ads, `ie_issues.json` is empty, and McCormick's dossier has exactly one archived
campaign-site excerpt per issue. Albert wants an overnight batch and, later, an "Enrich" button on the dossier page. This
document says what Grok-with-X-search can and cannot add per consumer, what it costs, what shape the data takes, and how
it stays separate from the record. The runtime button is out of scope; every shape below is reusable by it (it is the same
API call).

Standing rules unchanged: every visible claim carries a `source_url`; no causal language; money vs targeting stay distinct;
contracts additive-only; web stays static. **D-09 ("no LLM anywhere") is relaxed by D-78 (proposed below; D-77 is taken by
the Money Trails PR), not dropped**: machine output is a separately stored, clearly labelled layer with full provenance,
never merged into record-based fields, never a substitute for a `source_url`, and never a number.

## 0. Findings in one screen

**How it works.** One `POST https://api.x.ai/v1/responses` call per (candidate × issue) or per spender, with
`tools: [{type: "x_search", allowed_x_handles: [...], from_date, to_date}]` (+ `web_search` restricted to the org's own
domain for spenders) and a JSON-schema `text.format`. Grok searches X itself and returns a structured answer plus
`citations` (URLs, e.g. `https://x.com/<handle>/status/<id>`). We never see raw posts; we see the model's answer and the
URLs it used. Cost is **$5 per 1,000 successful tool calls** plus tokens (`grok-4.3`: $1.25 in / $2.50 out per 1M).

| Consumer | What Grok + `x_search` gives us | Value | Cost (est.) | Verdict |
| --- | --- | --- | --- | --- |
| **(c) Dossier stances** — both candidates | Per issue: a summary of the candidate's *own posts* (first-party stated positions, same class as the archived campaign page) with permalinks. Fixes McCormick's 1-excerpt-per-issue thinness. `allowed_x_handles` pins the search to the verified accounts. | **High** | 2 × 10 issues × ~5 tool calls ≈ 100 calls ≈ **$0.50** + tokens ≈ $1 | **Do first** |
| **(b) Spender self-description** — 75 untagged of 98 | `web_search` on the committee's own site (About page — exactly how the human rows were made) + `x_search` on its handle → kind, ≤3 issues, description, quote, source URLs. | **Medium**: fills 75 cards, but those spenders are **$6.1M of $233M (2.6%)** of outside dollars | 75 × ~5 calls ≈ 375 calls ≈ **$2** + tokens ≈ $2 | **Do second** |
| **(a) Ad issue tags** — 458 untagged of 500 | Still almost nothing: 485/500 are video; neither tool sees the creative. Posts *about* an ad are not proof of its content or who placed it. | Low | — | **Not via X search.** Creative captions → Grok (§7), separate child |
| **(d) IE notices** — `ie_issues` | Nothing: notices carry no topic; joining by date is not a relationship (D-74) | None | — | **Drop** |

Whole batch (c)+(b) ≈ **$5–10 of xAI credits**, one evening, re-runs free from cache.

**What changes versus a raw-X-API design.** We trade determinism for cost and simplicity: the tool is a black box (no
pagination, no result cap documented, "server-side tool call outputs are not returned"), so (1) every quote the model gives
is *model-reported* until we verify it against the permalink, (2) we must store the model's raw response ourselves (xAI
keeps it 30 days), and (3) the run is not reproducible — the same query tomorrow may cite different posts. Mitigations in
§2 and §4: pin handles + dates, `seed`, cache every response, verify excerpts and authorship via the post's public oEmbed endpoint
(checked today: works, no auth; see §2 and Q3), and require `citations ⊇ every URL in the structured output`.

What X posts are **not**: a super PAC's posts are its *self-description* (Layer A, never "what the dollars bought"); posts
about an ad are not proof of who placed or paid for it; engagement counts are not shown; and a model's reading of a post is
an *inference* until a person accepts it.

## 1. Purpose → data needs, per consumer

### (c) Dossiers — stance statements from the candidate's own account

- **Fields.** Per candidate × issue: a 1–2 sentence `summary`, `confidence`, and 3–8 `posts[]` (permalink, author handle,
  `posted_on` as reported, ≤280-char `excerpt`, `excerpt_verified` bool). Optional model-proposed `direction_proposed`
  (-2..+2 against `ISSUE_AXES`) stored but **never used by personalization until a human accepts it** (D-76 stays).
- **Renders as** a boxed "From the candidate's X account" block under each issue's record evidence: summary, label
  "Machine-summarised from N posts, <model>, <date> — not part of the record", and a slideshow of the posts (X embeds or
  cards linking to the permalink). This is the block the future Enrich button fills live with the same call.
- **Query.** One call per issue: prompt = issue definition from `ISSUES`/`ISSUE_AXES` + "what has this account said";
  `allowed_x_handles` = the candidate's verified handles; `from_date 2023-01-01`, `to_date 2024-11-05`; `seed` fixed.
- **Accounts.** Casey: `@SenBobCasey` (official) and `@Bob_Casey` (campaign); McCormick: `@DaveMcCormickPA`. **Not verified
  yet** — hand file `x_accounts.json` records each handle with the URL where it was confirmed (campaign site footer,
  senate.gov), so we never summarise the wrong person.
- **Limits.** Deleted posts vanish; retweets/replies are whatever the tool returns (we tell the model to use original posts
  and label quotes); the summary is *what was said on X*, not a position on record.

### (b) Spender cards / Policies tab — `issue_focus` for the untagged spenders + entity metadata

- **Fields.** Per spender: `profile` {website, X handle, X profile url, bio as reported} and a proposed focus row {kind,
  issue_ids (≤3), description in the org's words, quote, source_urls = About-page URL + post permalinks, confidence}.
- **Renders as** the S8 one-line agenda summary on the spender card and the Policies-tab funder list, labelled
  "Self-described (machine-tagged <date>); not from FEC records"; website/handle on the entity page.
- **Query.** Input = committee name, FEC id, FEC-reported website/connected org (from `entities/<id>.json` where present).
  Call 1: `web_search` with `filters.allowed_domains = [<committee website>]` (max 5) → About-page self-description; if no
  website is on file, an unrestricted `web_search` may *find* it but the row is written only if the found page names the
  committee/FEC id. Call 2 (optional): `x_search` with `allowed_x_handles = [<handle>]` once a handle is confirmed from the
  website. A model may propose a handle; it is never used as `allowed_x_handles` without that confirmation.
- **Honest ceiling.** 2.6% of dollars. A completeness win for the card grid, not a change in what the Policies tab says
  about the money.

### (a) Ads and (d) IEs — see the table. Not part of this batch.

## 2. Sources & API (verified against live docs.x.ai 2026-09-06; quotes in the appendix)

**Endpoint.** `POST https://api.x.ai/v1/responses`, `Authorization: Bearer $XAI_API_KEY`. Chat Completions is documented as
deprecated. OpenAI-compatible: the `openai` Python client with `base_url=https://api.x.ai/v1` works; `xai-sdk` (gRPC) is the
alternative. Plain `requests` is enough for the batch.

**Tools.**

| Tool | Documented filters | Cost | Notes |
| --- | --- | --- | --- |
| `x_search` | `allowed_x_handles` **or** `excluded_x_handles` (max 20, not both); `from_date`/`to_date` ISO `YYYY-MM-DD`, inclusive; `enable_image_understanding`, `enable_video_understanding` | $5 / 1k successful calls | modes: keyword, semantic, user, thread fetch. **Max results per call: UNKNOWN.** |
| `web_search` | `filters.allowed_domains` **or** `excluded_domains` (max 5, not both); `enable_image_understanding` | $5 / 1k successful calls | **date filters on the dedicated tool: UNKNOWN** |

Billing counts *tool invocations*, not requests: "the agent autonomously decides how many tools to call". Cap with
`max_turns` per request and our own `--max-usd`. Failed tool attempts are not billed.

**Citations.** `response.citations` = "comprehensive list of URLs for all sources the agent encountered", always returned.
With inline citations on, each `output_text` block carries `annotations[]` of `{type: "url_citation", url, start_index,
end_index, title}`; the doc's own X example is `https://x.com/xai/status/1234567890`. **Citations carry URLs only** — no
post text, author, or timestamp field is documented. Tool invocations appear as `x_search_call` / `web_search_call` items
(with `action`), but "server-side tool call outputs are not returned in the API response".

**Structured output + tools in one call** is explicitly supported ("only available for supported Grok 4 family models"):
`text.format = {type: "json_schema", name, schema, strict: true}`. Whether `grok-4.3` counts as "Grok 4 family" for this
combination is **UNKNOWN** until a 1-call smoke test.

**Determinism & retention.** `seed` is "best effort … not guaranteed"; `temperature` 0–2; `store` (default on, 30-day
retention, `GET /v1/responses/{id}`); `previous_response_id`. We keep our own copy of every response.

**Models.** `grok-4.3` $1.25/$2.50 per 1M (<200k prompt), Tier 0 37 RPS / 10M TPM; `grok-4.6` $2/$6, 150 RPS / 50M TPM.
Default `grok-4.3`; fall back to `grok-4.6` if structured-output-with-tools is refused.

**Rights.** xAI docs say nothing about redistributing X content returned by `x_search` (**UNKNOWN**); X's own rules
favour distributing ids/links over bulk text. Committed files therefore hold permalinks + ≤280-char excerpts, never full
posts; the UI embeds or links posts.

**What the model does / does not do.**

| Does | Does not |
| --- | --- |
| search X (and the org's own site) and return ≤3 `ISSUES` ids + kind, quoting the words it relied on, each with a URL | produce any dollar figure, count, share or date used as data (all come from records) |
| summarise a candidate's posts on one issue in ≤2 sentences, each claim tied to a cited permalink | cite a URL that is not in `response.citations` (row dropped) |
| propose `confidence` and `direction_proposed` | set the live `direction` used by personalization |
| answer "no relevant posts found" | fill a `source_url` from memory — every URL comes from a tool result |

Prompts are versioned files under `pipeline/campaign_commons/prompts/x_enrich/` (`classify_focus.v1.md`,
`summarise_stance.v1.md`); `prompt_version` is written on every row. Outputs are JSON-schema constrained; ids not in
`ISSUES`, URLs not in `citations`, or URLs not on the allowed handle/domain fail validation and the row is dropped
(logged), never repaired.

**Excerpt + author verification (Q3).** Because we never see the post, the excerpt is the model's transcription and the
handle in the URL is the model's claim. Before writing a row the pipeline fetches the post's public oEmbed JSON
(`GET https://publish.x.com/oembed?url=<permalink>&omit_script=1`, no auth — **checked 2026-09-06: returns 200 with
`url` (canonical, resolves the true author), `author_name`, `author_url`, `html` containing the post text; 404 for a
missing post**), stores it in `data/raw/x/oembed/<post_id>.json`, and sets `excerpt_verified: true` only if the excerpt is a
substring of the text in `html` **and** the canonical `url` handle is in `allowed_x_handles`. Rows whose author check fails
are dropped (the docs' own example id `1234567890` resolves to an unrelated account — exactly the failure this catches).
Unverified excerpts are kept but rendered as "as summarised by the model" without quote marks. oEmbed is X's public embed
endpoint; it is not the X API and needs no key, but it is a network call per cited post (cached), ~100–500 per run.

## 3. Data shape (additive)

### 3.1 Hand-style input files (`data/hand/<race>/`)

Machine rows live in **separate files** from human rows, same envelope `{race_id, method, rows[]}`, validated by
`make validate`. Humans edit them only to change `review_status`.

```ts
const MachineProvenance = z.object({
  tagged_by: z.string(),            // "xai-grok-4.3-2026-09-07" (provider-model-date)
  tagged_at: z.string(),            // ISO date
  model: z.string(),                // "grok-4.3"
  prompt_version: z.string(),       // "summarise_stance.v1"
  tools: z.array(z.enum(["x_search", "web_search"])),
  tool_filters: z.record(z.unknown()),   // the allowed_x_handles / allowed_domains / dates actually sent
  response_id: z.string(),          // xAI response id (retrievable ≤30 days); full copy in data/raw/xai/
  retrieved_at: z.string(),
  citations: z.array(z.string().url()), // response.citations, complete
  confidence: z.enum(["high", "medium", "low"]),
  review_status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable(),
});

const XPostRef = z.object({
  url: z.string().url(),            // https://x.com/<handle>/status/<id>, must be in provenance.citations
  post_id: z.string(),              // parsed from url
  author_handle: z.string(),        // parsed from url; must be in tool_filters.allowed_x_handles
  posted_on: z.string().nullable(), // as reported by the model, ISO date
  excerpt: z.string().max(280),
  excerpt_verified: z.boolean(),    // substring of oEmbed text AND canonical author in allowed handles
});

// x_accounts.json — human: whose account is whose (never guessed)
{ owner_kind: "candidate"|"entity", owner_id, handle, website: nullable, confirmed_from_url, tagged_by, tagged_at }

// x_issue_focus.json — one row per spender; mirrors HandIssueFocusRow + provenance
{ entity_id, name, kind, issue_ids, description, quote, source_urls, profile: {handle, url, website, bio}, posts: XPostRef[], ...MachineProvenance }

// x_stances.json — one row per candidate × issue
{ candidate_id, issue_id, summary, direction_proposed: Direction.nullable(), posts: XPostRef[] (0..8), ...MachineProvenance }

// x_ad_issues.json — reserved for §7, not written by this batch
```

### 3.2 Output files (`data/out/<race>/`) — new optional blocks, never inside record fields

```ts
// entities/<id>.json
x_enrichment?: {
  profile: { handle, url, website, bio, retrieved_at },
  issue_focus?: IssueFocus & { review_status, provenance },   // basis.basis = "inferred" while pending,
                                                              // "verified" (checked_by = reviewer) once accepted
}
// Entity.issue_focus (human, Layer A) is untouched. If both exist the UI shows the human one and offers the machine one as
// "also self-described". by_spender_focus in issues.json keeps counting HUMAN rows only (Q5).

// dossiers/<id>.json
enrichment?: {
  provider: "xai",
  label: "Machine-summarised from the candidate's X posts on <date>; not part of the record",
  stances: [{ issue_id, summary, confidence, direction_proposed, needs_review: true, review_status, posts: XPostRef[], provenance }],
}
// Stance.evidence[] and EvidenceKind are NOT extended: an X post is not a record. The dossier `summary` and
// `evidence_basis` are computed from record stances only, as today.
```

`Basis` needs no new enum value: pending machine rows are `inferred` with `rule` = "Summarised by <model> from the
account's X posts via xAI x_search (<date>); pending human review" and `checked_by: null`; acceptance turns them
`verified` with the reviewer's handle. Rejected rows are not emitted. **Machine rows never overwrite human rows**.

## 4. Pipeline design (`campaign_commons/x_enrich.py`, `make x-enrich`) — to build after sign-off

```
plan    ──▶ list of (unit, prompt_version, tool filters)          (--dry-run prints it with est. calls/$; no network)
call    ──▶ data/raw/xai/<sha256(model+prompt_version+unit+filters)>.json   (full response incl. citations, output items,
                                                                             server_side_tool_usage; never re-called)
verify  ──▶ data/raw/x/oembed/<post_id>.json                        (excerpt check; cached)
write   ──▶ data/hand/<race>/{x_issue_focus,x_stances}.json          (review_status pending; accepted/rejected rows kept)
patch   ──▶ issues.py / dossier.py read the machine files and write x_enrichment / enrichment blocks
```

- CLI: `python -m campaign_commons.x_enrich <race> {spenders,stances,all} [--dry-run] [--limit N] [--only ID]
  [--max-calls N] [--max-usd X] [--model M] [--refresh-reviewed]`.
- Budget: `server_side_tool_usage` and `usage` from each response go into `data/raw/xai/ledger.json`; the run stops at
  `--max-calls`/`--max-usd` and exits non-zero saying what is left. Defaults: 1,000 tool calls / $15. `max_turns` per
  request caps runaway searching.
- Backoff: exponential on 429/5xx (1, 2, 4… ≤ 5 tries); `seed` and `temperature: 0` sent on every call; resume from cache.
- Idempotent: rows keyed (`entity_id` / `candidate_id+issue_id`); re-running with the same cache is byte-identical. A
  previously `accepted`/`rejected` row is never regenerated unless `--refresh-reviewed`.
- Secrets: `.env.example` gets `XAI_API_KEY=`; missing key = stage refuses to call (cache-only mode still works). Never
  logged. No X API key needed.
- Tests: a fake transport replays recorded fixtures (`tests/fixtures/xai/*.json`, hand-redacted) — CI never touches the
  network; tests cover budget stop, backoff, rejection of an off-taxonomy id, rejection of a URL absent from `citations` or
  off the allowed handle, `excerpt_verified` both ways, "no relevant posts", human-row precedence, byte-identical re-runs.
- Makefile: `x-enrich` is **not** in `all` (needs a key and credits); `issues`/`dossier` consume the machine files if present.

## 5. Review loop

1. Batch writes rows with `review_status: "pending"`; `make x-review` prints, per row, the proposal beside the human row
   (if any), the quotes with their `excerpt_verified` flag, the permalinks, and a `diff` of what would change in `data/out`.
2. A person sets `accepted` / `rejected` (+ `reviewed_by`, `review_note`) in the hand file — same workflow as every other
   hand file (D-56). Unverified excerpts must be checked by eye before `accepted`.
3. `make validate` fails on `accepted` without `reviewed_by`.
4. UI copy for pending rows: **"Machine-tagged from X posts on <date>; not part of the record."** Accepted: **"Self-described
   on X; checked by <reviewer> <date>."** Dossier block header: **"From the candidate's X account (machine-summarised,
   <model>, <date>) — statements, not votes."** Permalinks always visible.
5. Nothing pending ships as a headline: pending rows render only inside their labelled block, never in aggregates.

## 6. Questions for Albert (answers unblock Phase 2)

| # | Question | Default if unanswered |
| --- | --- | --- |
| Q1 | Budget cap for the batch in xAI credits? Estimate is $5–10; default cap $15. | $15 |
| Q2 | Is the repo public? If yes, committed files hold permalinks + ≤280-char excerpts only. | assume public |
| Q3 | OK to verify excerpts/authors via X's public oEmbed endpoint (one unauthenticated GET per cited post, cached; verified working today)? | yes |
| Q4 | Model: `grok-4.3` (cheapest) if it accepts structured output + tools, else `grok-4.6`? Decided by a 1-call smoke test. | 4.3 → 4.6 |
| Q5 | Order: dossier stances (c) first, then spender self-description (b)? Ads via captions (§7) as a separate child? | c → b; §7 separate |
| Q6 | Confirm handles (`@SenBobCasey`, `@Bob_Casey`, `@DaveMcCormickPA`) and whether Casey's Senate account counts, or only the campaign account. | both Casey accounts, labelled |
| Q7 | Should **accepted** machine focus rows join `issues.json.by_spender_focus` as a separately labelled layer, or stay off aggregates? | stay off |
| Q8 | Store `direction_proposed` at all, given D-76 keeps `direction` human-coded? | yes, stored, never live |
| Q9 | VoteSmart: API is licence-only and the PCT pages rendered a loading shell — skip for now? | skip |

## 7. Not this batch: ad tagging from the creative itself

458 of 500 ads are untagged and 485 are video. The right input is the creative: the Google creative page embeds a YouTube
video; captions (where available) plus on-screen text for text ads can be fetched, cached and classified by the same model
(no tools) with a `classify_ad.v1` prompt into `x_ad_issues.json`-style rows (`ad_id, issue_ids, quote,
source_urls=[creative_url, caption url], provenance`). Same review loop, same label, same rule that the human
`ad_issues.json` wins. Cost ≈ 458 × ~2k tokens ≈ $2. Separate child so it does not block (c)/(b).

## 8. Proposed decision row

**D-78** — LLM-derived data (xAI Grok with server-side X/web search) is permitted only as a separately stored, labelled
layer: `x_*.json` hand files and `x_enrichment` / `enrichment` output blocks carrying `tagged_by: "xai-<model>-<date>"`,
model, prompt version, tools and filters sent, xAI `response_id`, `retrieved_at`, the complete `citations` list, the
permalinks used, confidence and `review_status`. It is never merged into record-based fields (`issue_focus`,
`Stance.evidence`, any dollar figure), never a substitute for a `source_url`, and never produces a number. Cited URLs must
appear in the response's `citations`; excerpts are marked verified only when checked against the post. Pending rows are
`inferred`; a human's acceptance makes them `verified` with the reviewer's handle. Amends D-09; Q-13 answered "LLM first
pass with human confirmation, kept in its own layer".

## Appendix — verified facts (retrieved 2026-09-06, docs.x.ai; full memo with quotes kept by child F)

- x_search: https://docs.x.ai/developers/tools/x-search — "Only consider posts from specific X handles (max 20)";
  "`allowed_x_handles` cannot be set together with `excluded_x_handles`"; dates "in ISO8601 format, e.g., 'YYYY-MM-DD'",
  "including both dates". Max results per call: not documented. Note: the generic REST reference still says "only
  functions and web search are supported as tools" — the dedicated page shows `"type": "x_search"`; smoke-test.
- web_search: https://docs.x.ai/developers/tools/web-search — "Only search within specific domains (max 5)"; allowed and
  excluded cannot be combined. Date filters: not documented on the tool.
- Citations: https://docs.x.ai/developers/tools/citations — "The `citations` attribute on the `response` object provides a
  comprehensive list of URLs … always returned by default"; annotation `{type: "url_citation", url, start_index, end_index,
  title}`, example `https://x.com/xai/status/1234567890`. No text/author/timestamp fields documented.
- Tool usage: https://docs.x.ai/developers/tools/tool-usage-details — "Only the tool call invocations are shown —
  server-side tool call outputs are not returned in the API response"; failed attempts not billed;
  `response.server_side_tool_usage` counts successes.
- Pricing: https://docs.x.ai/developers/pricing — web_search $5 / 1k calls; x_search $5 / 1k calls; grok-4.3 $1.25 / $2.50
  per 1M (<200k), grok-4.6 $2 / $6; "costs scale with query complexity".
- Structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs — "You can combine structured
  outputs with tool calling"; "Server-side tools like web search, X search, and code execution"; "only available for
  supported Grok 4 family models".
- Responses params: https://docs.x.ai/developers/rest-api-reference/inference/chat — `seed` "best effort … Determinism is not
  guaranteed"; `store`; `previous_response_id`. Retention: "stored for 30 days" (generate-text guide);
  `GET /v1/responses/{id}`.
- Rate limits: https://docs.x.ai/developers/rate-limits — per-model RPS/TPM only; grok-4.3 Tier 0 37 RPS / 10M TPM. No
  separate tool quota documented.
- SDK: `pip install xai-sdk` (gRPC) or OpenAI client with `base_url="https://api.x.ai/v1"`.
- Redistribution of X content obtained via x_search: not addressed in xAI docs (UNKNOWN); xAI retains API traffic 30 days,
  "never trains on your API inputs or outputs without your explicit permission".
- Earlier X-API-direct findings (pay-per-use $0.005/post read etc.) are superseded — no X API access is assumed.
- VoteSmart: API requires a licensee key (https://votesmart.org/share/api); PCT pages for Casey (`BS031306`) and McCormick
  (`WNY93024`) rendered a loading shell — unverified.
