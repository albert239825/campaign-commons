# Block 3 child F — X / xAI enrichment (offline batch): design

_2026-09-06 · owner: child F · status: **design for review, nothing built**. Albert: "let's agree on the plan first for what
data we want to enrich."_

Why: issue tagging is thin and hand-made. `issue_focus.json` covers 23 of 98 outside spenders (34 rows; 11 are `org:` chain
funders), `ad_issues.json` 42 of 500 ads, `ie_issues.json` is empty, and McCormick's dossier has exactly one archived
campaign-site excerpt per issue. Albert wants an overnight batch over the X API plus an xAI model, and later an "Enrich"
button on the dossier page. This document says what X can and cannot add per consumer, what it costs, what shape the data
takes, and how it stays separate from the record. The runtime button is out of scope; every shape below is reusable by it.

Standing rules unchanged: every visible claim carries a `source_url`; no causal language; money vs targeting stay distinct;
contracts additive-only; web stays static. **D-09 ("no LLM anywhere") is relaxed by D-78 (proposed below; D-77 is taken by the Money Trails PR), not dropped**:
machine output is a separately stored, clearly labelled layer with full provenance, never merged into record-based fields,
never a substitute for a `source_url`, and never a number.

## 0. Findings in one screen

| Consumer | What X actually gives us | Value | Effort / cost | Verdict |
| --- | --- | --- | --- | --- |
| **(c) Dossier stances** — both candidates | The candidate's own posts = first-party *stated positions* (same epistemic class as the archived campaign page, `evidence_basis: statements`). Fixes McCormick's 1-excerpt-per-issue thinness; adds dated statements for Casey beside his votes. | **High** | 2 accounts × ~2 yrs of posts ≈ 4–6k post reads ≈ **$20–30**; ~20 xAI summaries ≈ <$1 | **Do first** |
| **(b) Spender profiles** — 75 untagged of 98 | An org's X bio, pinned post and own posts are *self-description* — exactly Layer A (`issue_focus`) semantics. Also yields website + handle. | **Medium**: fills 75 rows, but those 75 spenders are **$6.1M of $233M (2.6%)** of outside dollars; the $227M is already tagged | 75 user reads + ≤100 posts each ≈ 7.6k reads ≈ **$38**; 75 classifications ≈ <$1 | **Do second** (cheap; coverage 23→~70) |
| **(a) Ad issue tags** — 458 untagged of 500 | Almost nothing. 485/500 are video; X has no view of the creative. A sponsor's post *about* an ad ("our new spot 'Simple'") can be matched to an ad only by title + date, and says nothing about who placed it. | **Low via X** | Search per ad is unbounded | **Not via X.** The real path is the creative's own text: YouTube captions / on-screen text → xAI classify. Separate proposal, §7 |
| **(d) IE notices** — `ie_issues` | Nothing. Notices carry no topic and no title (see `ie_issues.json.method`); no X post can be joined to an IE row except by date, which we do not draw as a relationship (D-74) | None | — | **Drop** |

Total for (c)+(b): **≈ $60–70 of X reads, ≈ $2 of xAI**, one overnight run, ~12k X post reads (well under the 3M/month cap).

What X is **not**: a super PAC's posts are its *self-description* (Layer A, never "what the dollars bought"); posts about an
ad are not proof of who placed or paid for it; engagement counts are not evidence of anything and are not shown; and a
model's reading of a post is an *inference* until a person accepts it.

## 1. Purpose → data needs, per consumer

### (c) Dossiers — stance statements from the candidate's own account

- **Fields.** Per candidate × issue: a 1–2 sentence `summary` of what the candidate's posts say about the issue, `confidence`,
  and 3–8 `posts[]` (id, permalink, author handle, `created_at`, text, media preview url). Optional model-proposed `direction`
  (-2..+2 against `ISSUE_AXES`) **stored but not used by personalization until a human accepts it** (D-76 stays: the live
  `direction` is human-coded).
- **Renders as** a boxed "From the candidate's X account" block under each issue's record evidence: the summary, a
  "Machine-summarised from N posts, <model>, <date> — not part of the record" label, and a slideshow of the posts (embedded
  or card-rendered with timestamp linking to the permalink, per X display requirements). This is the same block the future
  Enrich button would fill live.
- **Accounts.** Casey: `@SenBobCasey` (official) and `@Bob_Casey` (campaign); McCormick: `@DaveMcCormickPA`. **Handles are
  not verified yet** — a hand file `x_accounts.json` records each handle with the URL where it was confirmed (campaign site
  footer, senate.gov), so the pipeline never guesses whose words it is quoting.
- **Window.** 2023-01-01 → 2024-11-05 (cycle), so full-archive search is required (recent search = 7 days).
- **Limits.** Deleted posts vanish; the summary is of *what was said on X*, not a position on record; retweets excluded
  (`-is:retweet`); quote-posts kept but labelled.

### (b) Spender cards / Policies tab — `issue_focus` for the untagged spenders + entity metadata

- **Fields.** Per spender: `profile` {handle, profile url, bio text, website from the profile, pinned post id, retrieved_at}
  and a proposed focus row {kind, issue_ids (≤3, first primary), description in the org's words, quote, source_urls =
  profile url + post permalinks, confidence}.
- **Renders as** the S8 one-line agenda summary on the spender card and the Policies-tab funder list, labelled "Self-described
  on X (machine-tagged <date>); not from FEC records", and the website/handle on the entity page.
- **How the account is found.** Not by search. Sources in order: FEC Form 1 / committee page website → the site's X link;
  else `GET /2/users/by/username` on a hand-supplied handle. A model may *propose* a handle from the committee name, but the
  row is written only if the profile's bio or website names the committee/connected org (string match), otherwise it is
  logged as `no_account`. Mis-attributing a PAC's words is worse than a missing row.
- **Honest ceiling.** The 75 untagged spenders are 2.6% of dollars. This is a completeness win for the card grid, not a
  change in what the Policies tab says about the money.

### (a) Ads and (d) IEs — see the table. Not part of this batch.

## 2. Sources & API (verified against live docs 2026-09-06; details and quotes in the appendix)

**X API v2.** Current pricing is **pay-per-use, no subscriptions**: $0.005 per post read, $0.010 per user read, capped at
3M post reads per monthly cycle; full-archive search (`GET /2/tweets/search/all`, back to 2006) is available to pay-per-use
and Enterprise, recent search to everyone. Legacy Free/Basic/Pro tiers are no longer presented as current — **Q1: which
access does Albert's account actually have?** Rate limits (per app, per 15 min): search/all 300 + 1/sec, max 500 results;
search/recent 450, max 100; users/by/username 300; users/:id/tweets 10,000; tweets?ids 3,500. Full-archive **only** accepts
OAuth 2.0 app-only Bearer — matches `X_BEARER_TOKEN`. Query length 1,024 chars (full archive). Time bounds via
`start_time`/`end_time` parameters (not `since:` operators). Fields we request: `tweet.fields=created_at,public_metrics,
entities,referenced_tweets` (+ `note_tweet` for long posts if accepted — unverified in the current field table),
`expansions=author_id,attachments.media_keys`, `media.fields=url,preview_image_url,type`.

Queries:

| Use | Endpoint | Query | Reads |
| --- | --- | --- | --- |
| candidate stances | search/all | `from:<handle> -is:retweet lang:en`, `start_time=2023-01-01`, `end_time=2024-11-06`, page 500 | all posts of the account in window (≈2–3k each); one pass, then classify offline — no per-issue queries |
| spender profile | users/by/username | `user.fields=description,url,entities,pinned_tweet_id,public_metrics,created_at,verified_type` | 1 user read |
| spender posts | users/:id/tweets | `max_results=100`, `exclude=retweets,replies` | ≤100 post reads |
| pinned post | tweets?ids | — | 1 |

**Policy constraints that shape the data.** We may store post text locally for our own analysis, but if the repo is public
the committed hand/out files are "providing X content to third parties": the policy allows distributing **post IDs and user
IDs**, not bulk text. So committed files carry `post_id`, permalink, author, date and a **≤ 280-char excerpt used as the
quote** (the same "verbatim excerpt" convention as `issue_focus.json`), and the UI shows posts via X embeds or links, with
the timestamp linking to the permalink. Full text lives in `data/raw/x/` (gitignored). **Q2: is the repo public?** If not,
we can keep full text.

**xAI.** Recommended endpoint `POST https://api.x.ai/v1/responses` (Chat Completions is documented as deprecated), header
`Authorization: Bearer XAI_API_KEY`, structured output via `response_format: {type: "json_schema", …}`. Current models:
`grok-4.3` (1M ctx, $1.25 in / $2.50 out per 1M tokens) is the cheapest general text model → use it for both classification
and summaries; `grok-4.6` ($2/$6) if quality is short. xAI also sells an `x_search` server-side tool ($5 per 1k calls) that
lets Grok search X itself and returns citation URLs. **Not used for the batch**: it is non-deterministic, unpaginated, and
gives us no durable post objects to cache and re-verify; it *is* the natural engine for the future live Enrich button (one
call → summary + citations), which is why `enrichment.stances[]` below is shaped to hold either provider.

**What the model does / does not do.**

| Does | Does not |
| --- | --- |
| classify a spender's bio + posts into ≤3 `ISSUES` ids + kind, quoting the words it relied on | produce any dollar figure, count, share or date (all come from records) |
| summarise a candidate's posts on one issue in ≤2 sentences, citing post ids from the set it was given | invent or search for posts (it only sees cached posts we fetched) |
| propose `confidence` and a `direction` | set the live `direction` used by personalization (human accepts first) |
| flag "no relevant posts" | fill a `source_url` — every URL comes from the X response |

Prompts are versioned files under `pipeline/campaign_commons/prompts/x_enrich/` (`classify_focus.v1.md`,
`summarise_stance.v1.md`); `prompt_version` is written on every row. Outputs are JSON-schema constrained; ids not in
`ISSUES`, or post ids not in the input set, fail validation and the row is dropped (logged), never repaired.

## 3. Data shape (additive)

### 3.1 Hand-style input files (`data/hand/<race>/`)

Machine rows live in **separate files** from human rows, same envelope `{race_id, method, rows[]}`, validated by
`make validate`. Humans edit them only to change `review_status`.

```ts
const MachineProvenance = z.object({
  tagged_by: z.string(),            // "xapi-grok-4.3-2026-09-07" (provider-model-date)
  tagged_at: z.string(),            // ISO date
  model: z.string(),                // "grok-4.3"
  prompt_version: z.string(),       // "classify_focus.v1"
  retrieved_at: z.string(),         // when the X data was fetched
  confidence: z.enum(["high", "medium", "low"]),
  raw_post_ids: z.array(z.string()),// every post the model saw (cache keys), not just those cited
  review_status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable(),
});

const XPostRef = z.object({
  post_id: z.string(),
  url: z.string().url(),            // https://x.com/<handle>/status/<id>
  author_handle: z.string(),
  created_at: z.string(),
  excerpt: z.string().max(280),     // verbatim; full text stays in data/raw
  media_preview_url: z.string().url().nullable(),
});

// x_accounts.json — human: whose account is whose (never guessed)
{ owner_kind: "candidate"|"entity", owner_id, handle, user_id: nullable, confirmed_from_url, tagged_by, tagged_at }

// x_issue_focus.json — one row per spender; mirrors HandIssueFocusRow + provenance
{ entity_id, name, kind, issue_ids, description, quote, source_urls, profile: {handle, url, bio, website, user_id}, posts: XPostRef[], ...MachineProvenance }

// x_stances.json — one row per candidate × issue
{ candidate_id, issue_id, summary, direction_proposed: Direction.nullable(), posts: XPostRef[] (3..8), ...MachineProvenance }

// x_ad_issues.json — reserved for §7, not written by this batch
```

### 3.2 Output files (`data/out/<race>/`) — new optional blocks, never inside record fields

```ts
// entities/<id>.json
x_enrichment?: {
  profile: { handle, url, bio, website, user_id, retrieved_at },
  issue_focus?: IssueFocus & { review_status, provenance },   // basis.basis = "inferred" while pending,
                                                              // "verified" (checked_by = reviewer) once accepted
}
// Entity.issue_focus (human, Layer A) is untouched. If both exist the UI shows the human one and offers the X one as
// "also self-described on X". by_spender_focus in issues.json keeps counting HUMAN rows only (Q5 asks whether accepted
// X rows should join it as a separately labelled layer).

// dossiers/<id>.json
enrichment?: {
  provider: "x",
  label: "Machine-summarised from the candidate's X posts on <date>; not part of the record",
  stances: [{ issue_id, summary, confidence, direction_proposed, needs_review: true, review_status, posts: XPostRef[], provenance }],
}
// Stance.evidence[] and EvidenceKind are NOT extended: an X post is not a record. The dossier `summary` and
// `evidence_basis` are computed from record stances only, as today.
```

`Basis` needs no new enum value: pending machine rows are `inferred` with `rule` = "Classified by <model> from the org's X
profile and N posts (<date>); pending human review" and `checked_by: null`; acceptance turns them `verified` with the
reviewer's handle. Rejected rows are not emitted. **Machine rows never overwrite human rows**: `issues.py` writes
`issue_focus` from the human file exactly as now and `x_enrichment` from the machine file.

## 4. Pipeline design (`campaign_commons/x_enrich.py`, `make x-enrich`) — to build after sign-off

```
fetch  ──▶ data/raw/x/{users,posts,search}/<key>.json      (gitignored, one file per request, never re-fetched)
classify/summarise ──▶ data/raw/xai/<sha256(prompt_version+input)>.json   (cached; re-run = zero xAI calls)
write  ──▶ data/hand/<race>/{x_issue_focus,x_stances}.json  (review_status pending; existing accepted/rejected rows kept)
patch  ──▶ issues.py / dossier.py read the machine files and write x_enrichment / enrichment blocks
```

- CLI: `python -m campaign_commons.x_enrich <race> {accounts,spenders,stances,all} [--dry-run] [--limit N] [--only ID]
  [--max-calls N] [--max-usd X] [--no-llm]`. `--dry-run` prints the request plan and estimated reads/$ without any network.
- Budget: every call increments a ledger (`data/raw/x/ledger.json`: endpoint, reads, est. $); the run stops at
  `--max-calls`/`--max-usd` and exits non-zero saying what is left. Defaults: 20,000 reads / $120.
- Backoff: honour `x-rate-limit-reset`; exponential backoff on 429/5xx (1, 2, 4… ≤ 5 tries); resume from cache after a crash.
- Idempotent: rows are keyed (`entity_id` / `candidate_id+issue_id`); re-running with the same cache is byte-identical
  (`keep_generated_at` rule). A previously `accepted`/`rejected` row is never regenerated unless `--refresh-reviewed`.
- Secrets: `.env` gets `X_BEARER_TOKEN=` and `XAI_API_KEY=` in `.env.example`; missing key = stage refuses to fetch (cache-only
  mode still works). Never logged.
- Tests: a fake transport replays recorded fixtures (`tests/fixtures/x/*.json`, hand-redacted) — CI never touches the
  network; tests cover pagination, budget stop, rate-limit backoff, schema rejection of an off-taxonomy id, rejection of a
  cited post id not in the input, "no relevant posts", human-row precedence, and byte-identical re-runs.
- Makefile: `x-enrich` is **not** in `all` (needs keys and money); `issues`/`dossier` consume the machine files if present.

## 5. Review loop

1. Batch writes rows with `review_status: "pending"`; `make x-review` prints, per row, the proposal beside the human row
   (if any), the quote(s), and the post permalinks, and a `diff` of what would change in `data/out`.
2. A person sets `accepted` / `rejected` (+ `reviewed_by`, `review_note`) directly in the hand file — same workflow as every
   other hand file (D-56).
3. `make validate` fails on `accepted` without `reviewed_by`.
4. UI copy for pending rows: **"Machine-tagged from X posts on <date>; not part of the record."** For accepted rows:
   **"Self-described on X; checked by <reviewer> <date>."** Dossier block header: **"From the candidate's X account
   (machine-summarised, <model>, <date>) — statements, not votes."** Both keep the permalink list visible.
5. Nothing pending ships as a headline: pending rows render only inside their labelled block, never in aggregates.

## 6. Questions for Albert (answers unblock Phase 2)

| # | Question | Default if unanswered |
| --- | --- | --- |
| Q1 | Which X API access do you have — pay-per-use (current), a legacy Basic/Pro subscription, or Enterprise? Full-archive search is required for 2023–24 posts. | assume pay-per-use, budget cap $120 |
| Q2 | Is the repo public? If yes, committed files hold post ids + ≤280-char excerpts only (X redistribution policy); full text stays in gitignored raw. | assume public |
| Q3 | Model: `grok-4.3` (cheapest current, $1.25/$2.50) for everything, or `grok-4.6` for the stance summaries? | grok-4.3 |
| Q4 | Order of consumers: dossier stances (c) first, then spender profiles (b)? Ads via captions (§7) as a separate child? | c → b; §7 separate |
| Q5 | Should **accepted** X focus rows join `issues.json.by_spender_focus` as a separately labelled layer, or stay off aggregates entirely? | stay off aggregates |
| Q6 | Confirm the three handles (`@SenBobCasey`, `@Bob_Casey`, `@DaveMcCormickPA`) and whether Casey's Senate account counts (official statements) or only the campaign account. | both Casey accounts, labelled |
| Q7 | Do you want `direction_proposed` at all, given D-76 keeps `direction` human-coded? | yes, stored, never live |
| Q8 | VoteSmart: the API is licence-only and the PCT pages for Casey/McCormick rendered a loading shell — link them as `campaign_site`-style links, or skip? | skip for now |

## 7. Not this batch: ad tagging from the creative itself

458 of 500 ads are untagged and 485 are video. The right input is the creative: the Google creative page embeds a YouTube
video; captions (where the uploader or YouTube provides them) plus on-screen text for text ads can be fetched, cached and
classified by the same model with a `classify_ad.v1` prompt into `x_ad_issues.json`-style rows (`ad_id, issue_ids, quote,
source_urls=[creative_url, caption url], provenance`). Same review loop, same "machine-tagged" label, same rule that the human
`ad_issues.json` wins. Cost ≈ 458 × ~2k tokens ≈ $2. This needs no X access and is a separate child so it does not block (c)/(b).

## 8. Proposed decision row

**D-78** — LLM/X-derived data is permitted only as a separately stored, labelled layer: `x_*.json` hand files and
`x_enrichment` / `enrichment` output blocks carrying `tagged_by: "xapi-<model>-<date>"`, model, prompt version,
`retrieved_at`, the post ids/permalinks used, confidence and `review_status`. It is never merged into record-based fields
(`issue_focus`, `Stance.evidence`, any dollar figure), never a substitute for a `source_url`, and never produces a number.
Pending rows are `inferred`; a human's acceptance makes them `verified` with the reviewer's handle. Amends D-09; Q-13
answered "LLM first pass with human confirmation, kept in its own layer".

## Appendix — verified API facts (retrieved 2026-09-06)

- X pricing: "pay-per-usage pricing with no subscriptions"; $0.005/post read, $0.010/user read; "capped at 3 million Post
  reads" per monthly cycle — https://docs.x.com/x-api/getting-started/pricing
- Search availability: recent "Available to all developers"; full archive "back to 2006. Available to pay-per-use and
  Enterprise customers" — https://docs.x.com/x-api/posts/search/introduction
- Rate limits (per 15 min, app): search/recent 450 (max 100); search/all 300 + 1/sec (max 500); users/by/username 300;
  users/:id/tweets 10,000; tweets?ids 3,500 — https://docs.x.com/x-api/fundamentals/rate-limits
- Operators `from:`, exact phrase, `lang:`, `-is:retweet`; `start_time`/`end_time` params; query length 512 recent /
  1,024 full archive (Enterprise 4,096) — https://docs.x.com/x-api/posts/search/integrate/operators ,
  https://docs.x.com/x-api/posts/search/integrate/build-a-query
- Auth: "Full-archive search only supports OAuth 2.0 App-Only authentication" — https://docs.x.com/x-api/posts/search/integrate/overview
- Fields/expansions: `created_at, public_metrics, entities, referenced_tweets`; `author_id`, `attachments.media_keys`;
  `media.fields=url,preview_image_url,type` — https://docs.x.com/x-api/fundamentals/data-dictionary . `note_tweet`
  **unverified** in the current field table.
- Redistribution: "you may only distribute Post IDs, Direct Message IDs, and/or User IDs"; 1.5M post ids / 30 days —
  https://developer.x.com/en/developer-terms/policy ; display: "The post timestamp must be displayed and link to the post's
  permalink" — https://docs.x.com/developer-terms/display-requirements
- xAI models/prices: grok-4.6 $2/$6, grok-4.5 $2/$6, grok-4.3 $1.25/$2.50 (1M ctx) — https://docs.x.ai/developers/models ;
  Responses API recommended, Chat Completions deprecated — https://docs.x.ai/developers/model-capabilities/text/comparison ;
  structured outputs via `response_format` json_schema — https://docs.x.ai/developers/model-capabilities/text/structured-outputs ;
  grok-4.3 Tier 0 37 RPS / 10M TPM — https://docs.x.ai/developers/rate-limits ; `x_search` tool, $5 per 1k calls, citations
  — https://docs.x.ai/developers/tools/x-search , https://docs.x.ai/developers/pricing
- VoteSmart: API key "issued to you as an approved licensee" — https://api.votesmart.org/docs/terms.html ; PCT pages found
  (content unverified, JS shell): Casey `…/political-courage-test/BS031306`, McCormick `…/political-courage-test/WNY93024`.
