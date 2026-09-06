# Build log — what happened, what broke, how we fixed it

Narrative record for the presentation ("what we built, how, what went wrong, what we learned"). Dated entries per work
block, newest at the bottom. Every PR appends one entry (children too): **what changed · challenge · how we solved it ·
numbers before/after · dead ends**. Decisions with reasoning live in [DECISIONS.md](DECISIONS.md) (D-nn); critic findings in
[CRITIQUE.md](CRITIQUE.md) (C-nn); this file is the story that ties them together. All times UTC, 2026-09-05.

## Process in one paragraph

One master session held the architecture and the contracts. Work was cut into stages; each stage was built by parallel child
sessions on branches against **frozen JSON contracts** (Zod + JSON Schema), so a frontend child could build against mock data
while the ingest child was still downloading FEC bulk. Every merge had to pass `make validate` (every emitted file against
its schema), pipeline tests, web lint/typecheck/build, and — for user-facing changes — a recorded browser run. After each
integration a **read-only critic session** attacked the merged result and filed findings by severity; the master fixed P0/P1s
before anything else. Two critic rounds, 44 findings, 36 closed. Nothing in the product was produced by an LLM: dossiers,
ad verifications and stories are hand-written or templated from the record, and every number links to the government page
it came from.

## Timeline

| Time | Block | What landed |
| --- | --- | --- |
| 07:10 | Stage 0 (master) | Monorepo, contracts, 10-issue taxonomy, mock data for all 7 surfaces, pipeline + web skeletons, PLAN/DECISIONS |
| 07:10–09:00 | Stage 1 (5 children) | FEC ingest + ledger · frontend A (race table, ledger, entity) · frontend B (chain SVG, ad gallery, dossier) · ads pipeline (Google bundle) · dossier pipeline (senate.gov / congress.gov / Wayback) |
| 09:30 | Stage 2 (child) | Funding chains to termination, traceability, structural flags, stories |
| 09:30 | Critic round 1 (child) | 28 findings; 5 P0 |
| 09:45–12:35 | P0 fixes (master) | Schedule E → OpenFEC API, org classifier, popup/shell fixes, entity totals split |
| 12:35 | **V0 complete** | Browser-tested, preview up, `docs/SATURDAY.md` handoff |
| 13:00–15:30 | Track A/C (children) | Critic P1s (chain page 5.6MB → 562KB, `unwalked` bucket, labels, pair-filtered links) · design research (`DESIGN.md`) |
| 15:30–16:30 | Track B (child) | V1: stories strip + page, 5 hand-verified ad→committee links, forward donor view |
| 16:30 | Critic round 2 (child) | 16 findings; 2 P0 |
| 16:30–17:30 | Repo move + round-2 fixes (master) | Single "Initial commit" on `DN-Hacks-2026`; PR #1 closes C-29..C-36; outside total $235.7M → $233.4M |
| 17:30–18:30 | Whiteboard → ontology | Race nav, docs wiki (FAQ / QUESTIONS / DECISIONS), `ONTOLOGY.md` (questions × surfaces, ER diagram, sources, V0/V1/V2 scope) |

## Challenges and how we overcame them

### 1. "Everything ORG is dark" — the visibility model was wrong (C-01, D-38)
**Problem.** FEC types a Schedule A donor as `IND` or `ORG`; `ORG` covers Coinbase, a carpenters' union, an LLC and a 501(c)(4)
alike. V0 labelled all of them "dark", which inflated dark share, produced 33 false `dead_end_dark` flags and put a false
sentence on the #3 spender's page. The project's own rule — *dark = the hidden-donor layer, not "not an individual"* — was
what the code violated. Caught by the critic, not by us.
**Fix.** A transparent name classifier (`orgs.py`): union / business → disclosed terminus (the treasury *is* the source);
LLC / trust / advocacy nonprofit / unclassifiable → dark. Advocacy vocabulary beats corporate suffix ("LEAGUE OF CONSERVATION
VOTERS, INC." is a c4). Every node states how it was classed; bare "COINBASE" stays `unknown` → dark, conservative.
Later (C-30) registered committees typed `ORG` by the filer were resolved to their committee record by name before the
heuristic runs. Traceability moved 0.642 → 0.729 as a result — the *higher* number was the honest one.
**Lesson.** The methodology page now says "name heuristic, no IRS lookup" out loud; `inferable` is reserved for a future 990 join.

### 2. Schedule E over-counted by up to 21% per spender (C-02, C-29, D-27 → D-36 → D-48)
**Problem.** The same ad buy appears in FEC data as a 24/48-hour notice, again in the quarterly report, again in an amendment,
and again in any later periodic filing that re-reports it. Our first source was the processed bulk CSV with a local dedupe key
(date + rounded amount + payee); notices carry the *dissemination* date, periodic rows the *expenditure* date, so pairs
slipped through. Keystone Renewal PAC read $41.3M vs fec.gov's $34.1M.
**Fix, in three steps.** (1) Switch source to the OpenFEC API with `is_notice=false&most_recent=true`, which drops notices
and superseded amendments at the source. (2) The critic's round-2 spot-check still found re-reported rows across periodic
filings → one row per `(committee, candidate, support/oppose, tran_id, payee, amount, dissemination date)`, highest file
number wins, and `tran_id` alone is never a key because filers reuse it. (3) Verify against OpenFEC's own `by_candidate`
totals per spender — they now match. $237.5M → $235.7M → **$233.4M**, 98 spenders.
**Dead end.** No `FEC_API_KEY` at first; `DEMO_KEY` is 40 calls/hour, which is why the bulk file was tried first.

### 3. ActBlue and WinRed were "the largest donors in America" (D-07)
**Problem.** A $50 gift through ActBlue is filed up to three times (earmark row, memo row, conduit's own filing). Naive sums
double/triple count and make the conduit the top source everywhere.
**Fix.** Drop `MEMO_CD='X'` rows, attribute `15E` earmarks to the individual, exclude the conduit committee from the graph,
expose `via_conduit_total` per campaign so the pipe is visible but never a source.

### 4. The graph explodes at the party committees (D-05, D-29, D-33)
**Problem.** Walking receipts backward from 98 spenders reaches the DSCC/NRSC and their joint fundraisers, which have
millions of donor rows. The pure "prune below 1%" rule still produced 15,750 nodes under the DSCC alone; the neighborhood
closure reached 6,844 committees.
**Fix.** Cap the neighborhood at the 2,000 committees sending the most dollars in (keeps Parquet at 17MB, committable); per
node keep the 40 largest edges above 1% and fold the rest into an `agg:other` node so **dollars conserve at every node**;
stop a chain at 600 nodes with the remainder as explicit termini. Result: 86/98 spenders chained; the 12 unchained are
Form 5 filers (c4s spending directly) with no receipts to walk — labelled as such, counted as dark.

### 5. "Not walked" is not "dark" (C-06, D-41)
**Problem.** A committee outside the loaded neighborhood, or past the hop cap, was counted as *disclosed*. Counting it dark
would invent a hidden layer; counting it disclosed overstated traceability.
**Fix.** A fourth bucket, `unwalked`, rendered neutral grey with the label "Not walked (FEC committee, receipts outside this
race's neighborhood)". Score = disclosed / all, so it fell (0.729 → 0.721) — the correct direction.

### 6. Chain pages were 5.6MB of server-rendered SVG (C-10, D-40)
**Problem.** The hand-rolled Sankey rendered every node server-side. Fine on localhost, fatal on Vercel and on a projector Wi-Fi.
**Fix.** Ship a compact wire form (node tuples, index edges) to a client component that renders root + direct sources + nodes ≥2%
of root receipts (max 40) and folds the rest; click a node to expand its sources in place. WINSENATE 5.6MB → 562KB, dollars at
visible nodes unchanged. Side effect: this *is* the interactive graph explorer, without a graph database.

### 7. Ads: the documented Google URL was dead and there is no "paid for by" line (D-19, D-21, D-46, D-52)
**Problem.** transparencyreport.google.com's bundle URL now serves a 2.5KB README; the real CSV is 2.8GB on GCS. Google's
declared-name table covers only CA/NZ; US ads carry an advertiser legal name, not a paid-for-by disclaimer. Untargeted national
ads from multi-race PACs flooded the gallery with other races.
**Fix.** DuckDB straight over the CSV (5s, no intermediate artifact); PA relevance from the ad-level geo column; 1,849 → 500 ads;
sponsor matches are name matches marked `auto`, and **five were verified by a human** (advertiser page ↔ FEC committee record ↔
its PA Schedule E rows, two evidence URLs each). Copy says "sponsor verified by hand", never "paid for by".
**Dead end.** Creatives are rendered in iframes by a JS app; only YouTube poster frames are reachable statically (29 cached).

### 8. Dossiers without an LLM (D-09, D-23)
**Problem.** Stances must be evidence-backed and side-by-side comparable; an incumbent has 30+ roll calls, a challenger has a
website. Generating summaries would have been fast and unverifiable.
**Fix.** Curated literals (roll numbers, bill IDs, issue tags, archived quotes) + a fetch/verify step that raises on any miss:
senate.gov roll-call XML, congress.gov API, Wayback snapshot of the challenger's issues page. Casey 33 votes + 26 bills across
10/10 issues; McCormick 10 stated positions; the asymmetry is printed, every line links, every stance is `needs_review`.

### 9. False structural flags (C-03, C-04, C-09, D-37, D-42)
**Problem.** `popup` fired on every new PAC (first IE within 60 days of first receipt — true of all of them) and printed
"within −3 days"; `shell_cluster` flagged compliance firms hosting 38 clients at one address and a sponsor's own PAC family;
`transfer_mismatch` flagged a campaign against its own joint fundraiser.
**Fix.** Popup = first activity after the pre-general cutoff only; shell cluster = 2..10 committees sharing normalised street +
treasurer, excluding candidate committees, JFCs and shared connected orgs; JFC participation inferred from candidate ID /
connected-org name / surname. 179 → 178 flags on 164 entities, all of them defensible on stage.

### 10. Pooled dollars and the forward view (D-47, D-50)
**Problem.** "Where did Jane's money go?" is the question everyone asks and the one FEC data cannot answer past the first
hop — once pooled, dollars are fungible.
**Fix.** Walk forward on the same edge tables (donor → committees → spenders → IE targets) and show the path, with an
`allocation_note` whenever any number past the donor's own gifts appears: "share of donor's dollars reaching this spender is
not determinable". Money edges and targeting edges stay different kinds; no money edge ever ends at a candidate.

### 11. Evidence links that land on a different number (C-05, C-08, D-43)
**Problem.** `source_url` opened fec.gov on the six-year candidate view ($64.9M, not the $58.1M on our page); chain edges linked
a committee's whole ledger, not the rows behind the number.
**Fix.** Pin every link to `cycle=2024&election_full=false`; pair-filter receipts links with `contributor_name=<sender ID>`
(fec.gov's browse UI ignores `contributor_committee_id`; found by trying it in a browser). Verified: WINSENATE ← SMP lands on
exactly 38 rows.

### 12. Keeping the hackathon history clean without lying
**Problem.** Pre-hackathon prototype work existed on another repo with 60+ commits.
**Decision.** Copy the tree to `DN-Hacks-2026` as a single "Initial commit" — no history rewriting, no backdating, no fake
authorship. Disclose pre-built work if asked rather than hide it.

## Research and dead ends worth mentioning

- **Graph database?** Considered twice. The chain walk is a graph traversal in pandas over ~360k transfer edges; all 86 chains
  finish in ~6s and the product is static. Trigger to revisit: ad-hoc runtime traversal, national scope, or cross-race entity
  resolution (V2). Migration path is DuckDB recursive CTE → Kùzu/Neo4j; edges are already typed with visibility.
- **FEC bulk header files** for `weball24`/`webk24` return `NoSuchKey`; column lists were hand-transcribed from the FEC docs.
- **`pandas.iterrows()` `.name`** is the row index, not the column — surfaced as committee IDs where names should be.
- **`make test` regenerated mock data over real artifacts.** Fixed the Makefile the first time it bit us.
- **Design research**: the visibility green/amber/red fail WCAG AA as text (3.4 / 2.2 / 3.9 : 1) and vanish on a projector;
  campaign vs outside money had no colour identity while visibility had three. Recommendations in `DESIGN.md`, not yet applied.
- **FCC political files** (TV buys) exist per station as PDFs with no structured fields; ProPublica crowdsourced them in 2012.
  Feasible as a hand-extracted subset (6–8 PA stations, top 5 spenders), not as a pipeline this weekend.
- **Meta Ad Library API** is the only platform exposing the literal paid-for-by line; requires developer identity verification.

## Numbers over time (PA Senate 2024)

| | Stage 2 (09:30) | After P0s (12:35) | After P1s (15:30) | After round 2 (17:30) |
| --- | --- | --- | --- | --- |
| Outside spending | $237.5M (bulk) | $235.7M (API) | $235.7M | **$233.4M** (matches FEC by-candidate) |
| Traceability, race | 0.642 | 0.729 | 0.721 (+`unwalked`) | 0.727 |
| Casey / McCormick | — | 0.751 / 0.703 | 0.749 / 0.689 | 0.755 / 0.693 |
| Chains | 86/98 | 86/98 | 86/98 | 86/98 |
| Flags | 179 | — | — | 178 on 164 entities |
| Largest chain page | 5.6MB | 5.6MB | 562KB | 562KB |
| Static pages | 2,021 | 2,096 | — | 2,147 |
| Contract-validated files | 2,074 | 2,092 | — | 2,142 |
| Pipeline tests | 28 | 43 | — | 67 |

## 2026-09-05 ~19:00 — Block 2 kickoff: contracts first, again (master)

**What changed.** The whiteboard session turned into an ontology (ONTOLOGY.md §0: V0/V1/V2 tables) and a Block 2 plan
(plans/2026-09-05-block2.md). Before any child starts, the shared data model is frozen: `Basis` (evidence basis on every non-filed
relationship), `Vendor`/`VendorIndex`, `IssueSpending` (two layers), `SearchIndex`, IE/Entity/Ad/Chain extensions
(`vendor_id`, `medium`, `issue_focus`, `sponsor_visibility_shares`, `vendor_links`, out-side chain nodes `vendor|ad|candidate`
with `placement|targeting` edges). Five hand-maintained input files under `data/hand/pa-sen-2024/` with their own schemas; both
validators cover both roots. Contracts: 17 JSON Schemas (was 8); 2,142 V0 files still validate with zero changes.

**Challenge.** Two "how honest can we be" problems surfaced in the discussion. (1) Nothing filed links an FEC payment to an
ad-library creative — FEC sees {sponsor, vendor, $, purpose}, Google sees {sponsor, creative, spend range}, and the join is
the vendor's private invoice. (2) "What is this money *for*" has two different answers: what the ad was about (attributable
to dollars) and what the org says it exists for (not attributable — SLF's $52M isn't "about" anything). An earlier draft
conflated them.

**How we solved it.** A single `Basis` type with four values, styled differently in the graph and rendered as a sentence on
every card: `filed` (solid), `verified` (solid + check, needs a source naming both sides), `inferred` (dashed, explicit rule
— e.g. "only digital vendor paid in the ad's run window"), `adjacent` (dotted, "ran while the sponsor paid X and Y; FEC does
not record which buy placed which ad"). Issues became two separate arrays in `issues.json` that the UI must never sum
(`by_ad_issue`, `by_spender_focus`), with `coverage` so the cards can say how much of the money is tagged. D-55, D-56.

**Dead end.** `z.lazy` for the Ad↔AdVendorLink reference — unnecessary once the schemas were ordered; removed.

**Next.** Four children in parallel (vendors · media wall · issue focus · search), then the chain extension and the
Vertex-style node panel on master, then critic round 3.

## 2026-09-05 ~19:30 — Block 2 child 3: issue focus (two layers, never summed)

**What changed.** `data/hand/pa-sen-2024/issue_focus.json` — 34 sourced rows (23 of the 98 outside spenders incl. the whole top
20, plus 11 organisation funders that appear as chain termini: Majority Forward, LCV Inc., Everytown Action Fund, Future Forward
USA Action, Carpenters, EDF Action, IUOE, Climate Power, UFCW, One Nation, America Votes), each with the org's own words, a verbatim
quote where one fit, and ≥1 primary URL (org site, Wayback 2024 snapshot, or fec.gov committee page). `pipeline/gotham/issues.py`
(`make issues`, now in `all` between `ads` and `dossier`): patches `Entity.issue_focus` and `IndependentExpenditure.issues` in place
with a `verified` Basis, joins `ad_issues.json × ads.json` on `ad_id` without writing `ads.json`, emits `issues.json`
(`by_ad_issue`, `by_spender_focus` primary-only and all-tags, `coverage`, `notes`). 10 tests on a fixture race (merge, midpoint
sums, candidate split, dollar-weighted traceability/dark share, general_partisan null bucket, coverage arithmetic, reconciliation
to per-spender totals, idempotence, missing hand file → no-op). Web: `getIssues()` (null when absent), two side-by-side cards on
the ledger with the non-summability note between them, `FocusChip` on the entity page (kind · primary issue, description, source
links, `basis.rule` as title and footer).

**Numbers.** Layer A covers 23/98 spenders and $227.3M of $233.4M outside (97.4%). Primary-only buckets: general partisan /
leadership committees that name no issue **$138.8M (59.5%)**, 7 committees, weighted traceability 0.73 / dark 0.26;
candidate-aligned $48.2M (Keystone Renewal, 1); taxes & budget (multi-issue: AFP Action, Club for Growth Action) $21.4M;
energy & climate (LCV Victory Fund, NRDC Action Votes) $7.1M, dark 0.78; healthcare (multi-issue) $5.5M; guns $2.8M (3 committees
on both sides); labor $2.3M (4); healthcare single-issue $0.7M; business/trade $0.45M. Layer B: **0 of 500 ads and 0 IEs tagged**
— `by_ad_issue` is empty and the card says so. Static pages unchanged at 2,147; contract-validated files 2,143 + 5 hand files;
pipeline tests 67 → 77.

**Challenge.** The IE half of Layer B needs the "purpose" line of each 24/48-hour notice. The local FEC rows carry only generic
purposes (`MEDIA BUY`, `TV ADVERTISING`, `DIGITAL ADVERTISING`, `PRODUCTION`) for all of the ~60 largest IEs, and every
docquery.fec.gov filing image returned HTTP 403 from this box (webfetch and curl). Under rule 8 (tags only from the source) and
the assignment ("never tag from the spender's name or from Layer A") the honest result is zero IE rows; `ie_issues.json.method`
records what was tried. `ad_issues.json` belongs to child 2 and was empty at build time; the join code is exercised by tests.

**How solved / decided.** D-66..D-69: two layers never summed; midpoint of the Google range, never added to FEC dollars;
multi-tag records count in full under every tag (primary-only partitions, all-tags overlaps); `general_partisan` = names an
electoral/ideological goal and no policy area (SLF, WinSenate, DSCC, NRSC-aligned Sentinel, American Crossroads, One Nation,
America Votes, Somos). Descriptions that fit no frozen id (Future Forward USA Action "rebuild the middle class", American
Principles Project "the family") take the closest id and say "loose fit" in the description rather than inventing a taxonomy
entry. Copy discipline: every Layer A sentence is "spenders who describe themselves as … account for $Y", never "spent on".

**Dead ends.** OpenFEC with `DEMO_KEY` rate-limited within minutes — used the local parquet committee table and fec.gov pages
instead. WinSenate's own 2024 site is gone and no Wayback capture rendered; its row cites the FEC committee page and the Senate
Majority PAC parent. Defend Our Constitution PAC, Persephone LLC, Geosor Corp., Fund for Policy Reform, Evidence for Impact have
no self-description anywhere primary — omitted and counted in coverage. Planned Parenthood Votes' About page returned 500.

**Next.** Once docquery is reachable (or from a different network), read the top ~50 notices into `ie_issues.json`; Layer B fills
in with no code change. Child 2's `ad_issues.json` rows will populate `by_ad_issue` on the next `make issues`.

## 2026-09-05 ~19:40 — Block 2 child 4: static search ("type a name → jump to its page")

**What changed.** `pipeline/gotham/search.py` (`make search`, no race arg) walks every race under `data/out` and writes one
`data/out/search.json` (`SearchIndex`): 2,053 rows — 1 race, 2 candidates, 2,000 committees, 23 organizations, 27 donors,
0 vendors (`vendors.json` not there yet; indexed when it is, one-line note when it is not). `search` is the last stage before
`validate` in `make all`. Web: `getSearchIndex()` in `lib/data.ts`, a `force-static` route handler at `app/search.json/route.ts`
so `next build` emits the index as a static asset, and a header `SearchBox` (client component, `components/search/`) with a
plain-TypeScript matcher in `components/search/match.ts`. No new dependency; contracts untouched.

**Challenge.** Two thousand FEC names people type in a dozen ways ("Senate Leadership Fund", "SLF", "C00571703", "sen lead"),
delivered without a backend and without shipping a fuzzy-search library. And the header `<nav>` was the only place we could put
the box.

**How we solved it.** One index, one fetch on first focus (cached in module state), `⌘K`/`Ctrl+K` to focus. Matcher: normalise
(lowercase, collapse whitespace), then a row matches if the query is a substring of its label or any alias, OR every query token is
a prefix of some label/alias token. Rank by match quality (exact > prefix > substring > token-prefix), then `weight`, then label;
top 8, grouped by kind in the order their best hit ranked. `weight` is the row's dollars (race: campaign + outside; committee:
receipts + IEs, or the largest available total; organization/donor: itemized total given), rounded to whole dollars — it is a
tiebreak, never rendered. Candidate rows link to the dossier when `dossiers/<id>.json` exists, else the race page. Candidate
aliases carry the last name and "Sen. X" for incumbents; committee aliases carry `Entity.aliases` plus the FEC id so the id
itself is searchable. Manual check in the built site: "Senate Leadership Fund", "sen lead", "C00571703", "Casey", "Adelson"
all resolve and Enter navigates.

**Numbers.** Index 446 KB compact JSON (70 KB gzipped; indented it was 452 KB), 2,053 rows; static pages 2,147 → 2,148
(`/search.json`); pipeline tests 67 → 78; contract-validated files 2,142 → 2,143. Target was ≤400 KB: the labels + hrefs +
aliases for 2,000 committees are the floor, so we took the ~11% overshoot rather than dropping aliases (which is what makes
"SLF" work).

**Dead ends.** `KIND_ORDER` for a fixed group ordering — worse than "group by kind in rank order" because the best hit should
always be first. Copying `search.json` into `public/` — needs a copy step and drifts from `data/out`; the route handler reads the
same file the pages read.

## 2026-09-05 ~20:00 — Block 2 child 1: vendors ("Where the money went")

**What changed.** `pipeline/gotham/vendors.py` (`make vendors`, in `all:` before `chains`) turns the 2,235 deduped Schedule E
rows into 310 `Vendor` records: `data/out/pa-sen-2024/vendors.json` (index, `by_medium`, `medium_basis`, notes) and
`vendors/<V-slug>.json` (every buy, spenders, targets, `ads: []`), and patches all 98 spender entities in place with
`vendors[]` plus `vendor_id`/`medium` on each IE row (nothing else in those files changes — asserted). Hand file
`data/hand/pa-sen-2024/vendor_aliases.json`: 13 rows / 25 strings. Web: `components/entity/where-money-went.tsx` on the entity
page, `/races/[raceId]/vendors` and `/races/[raceId]/vendors/[vendorId]` (311 new static pages), `components/vendors/`
(medium chips/bar, basis note, targets line), `getVendors/getVendor/listVendorIds/countVendors`, `routes.vendors/vendor`, a
"Vendors" tab in `RaceNav` (optional count). Tests: `tests/test_vendors.py`, 48 cases (normalisation table, threshold,
alias precedence, medium table, and the artifact invariants). D-57…D-60.

**Challenge.** (1) The plan estimated ~150 payee strings; there are 337, and the obvious near-duplicates are *not* typos but
different unions (`UNITE HERE LOCAL 23/25/26/34/74/878/…`, ratio 0.93–0.97 to each other) — a plain ≥0.92 fold would have
merged six locals into one vendor. (2) A hand alias row has no date, but a `verified` Basis must carry `checked_at`.
(3) fec.gov's IE browse ignores `committee_id` and returns nothing with `is_notice=false`.

**How we solved it.** (1) Fuzzy folds additionally require identical numeric-token sets; the run log prints every fold
(exactly one fires: `GENRIS RUMALDO → GENRRIS RUMALDO`, 0.966). Semantic folds the rule cannot see (META/FACEBOOK/META
PLATFORMS, GOOGLE/GOOGLEADS, USPS/U.S. POSTMASTER/UNITED STATES POSTAL SERVICE, CAMPAIGNHQ/CAMPAIGN HEADQUARTERS, KOREA
TIMES/KOREAN PHILA TIMES, IHEARTMEDIA/WRNB-FM IHEART RADIO, MIDDLE SEAT) are hand rows with sources. (2) Optional
`tagged_at` on the hand row (D-60). (3) `q_spender=<id>&payee_name=<raw>` on `data_type=processed`, verified in a browser
(WINSENATE × WATERFRONT STRATEGIES → 176 rows).

**Numbers.** 337 payee strings → 310 vendors (27 folded: exact-key, 1 fuzzy, 25 by hand). Σ vendor totals = Σ IE rows =
ledger outside total = **$233,396,761.46** to the cent; per spender Σ `vendors[].amount` = Σ that entity's IE rows (98/98).
0 rows with an empty payee. Medium ≠ other on **93.9%** of dollars (tv $149.2M · digital $41.2M · other $14.2M · production
$12.9M · mail $9.5M · radio $3.4M · phones $2.9M · consulting $63K). Contract-validated files 2,142 → 2,453 (+310 vendors,
+1 index); hand files 5/5. Pipeline tests 67 → 115. Static pages 2,147 → 2,458.

**Dead ends.** Treating the alias row's `source_url` as the vendor's `source_url` (Meta's page pointed at about.fb.com, not a
filing) — now the fec.gov payee view is always first and the row's source is appended to `normalization.source_urls`.
`is_notice=false` in the fec.gov URL (zero results). Stripping `GROUP` (the brief says no; `MAIN STREET MEDIA GROUP` stays
distinct from any "MAIN STREET MEDIA").

**Gaps.** `Vendor.ads[]` is empty until the media-wall child links creatives; `other` still holds $14.2M, ~$12M of it
`CANVASSING` / field payroll (door-knocking is not a medium in the enum) plus bare `ADVERTISING`/`BILLBOARD` — left
unclassified on purpose rather than guessed.

## 2026-09-05 ~21:00 — Block 2 media wall: dark share as a number, hand-tagged issues, vendor links with a basis (media-wall child)

**What changed.** New stage `gotham.ads_enrich` (`make ads-enrich`, in `all` after `ads`) patches `data/out/pa-sen-2024/ads.json`
in place: `sponsor_visibility_shares` copied from the sponsor's chain summary (366 of 500 ads), `issues` from the hand file
`data/hand/pa-sen-2024/ad_issues.json` (42 of 500 ads, basis `verified` "Tagged by a person from the creative"), `vendor_links[]`
from the sponsor's `vendors[]` + IE rows under a 7-day-lead inclusive window (D-63, D-64), reverse `vendors/<id>.json.ads[]`, and
three `Enrichment (…)` notes with the counts. 79 pipeline tests (was 67); 12 new ones cover the share join, both window
boundaries, single-digital inference vs two digital vendors, verified override + ordering, no-op without `vendors[]`, reverse
dedupe, idempotence, and that `amount_in_window`/`buys_in_window` reconcile to the fixture's IE rows. Web: ad cards show
"N% of this sponsor's traced money is dark" (linked to the chain page), issue chips titled with `issues.basis.rule`, and a
"Vendors in this window" block that prints each `basis.rule` verbatim with an `adjacent` / `inferred` / `verified ✓` label and
source links; the gallery sorts by dark share, filters by issue and by vendor-link basis, accepts `?sponsor=<committee_id>`, and
says "42 of 500 ads tagged by a person". Entity pages get an ads strip (count, spend-range sum, thumbnails → `#<ad_id>`, "Google
shows the advertiser, not the paid-for-by line"); donor pages list committees in the forward walk that ran ads ("{committee},
which received $x from this donor, ran N ads →"; past the first hop the copy says the amount is a pooled total).

**Challenge.** (1) Child 1's `vendors[]`/IE `vendor_id` rows do not exist yet, so the vendor-link step had nothing real to
run on. (2) Hand-tagging 40+ creatives without an LLM: Google's ad page renders the creative inside a `googlesyndication`
frame that the browser's ad blocker refused, and the video ads have no visible text.

**How we solved it.** (1) A fixture under `pipeline/tests/fixtures/block2_sponsor_vendors.json` shaped exactly like
`EntityVendorRow` + `IndependentExpenditure` (one digital, one TV, one streaming vendor, dated around a fixed ad window) drives
the tests; on real data the stage detects that no sponsor carries `vendors[]`, writes empty `vendor_links` and a note saying
so. (2) Pulled the YouTube embed id out of the frame URL and read YouTube's auto-captions with `yt-dlp` (one ad, a text-message
style video hosted on googlevideo, was read from ffmpeg frame tiles instead); text ads were read off the page. 60 top ads by
`spend_range.min` reviewed, 42 tagged (abortion 13, tax_budget 13, labor_trade 10, immigration 6, healthcare 3,
energy_climate 2, guns 1; sponsors: WinSenate 20, SLF 11, DSCC 3, LCV 2, Casey 2, McCormick 1, NRDC Action Votes 1, NRA-PVF 1,
Future Pennsylvania PAC 1). 18 read but left untagged because the creative names no issue in the frozen taxonomy: 11 fundraising
/ biography / residency / values spots, 5 SLF "Bring Back" trans-athlete spots, WinSenate "Addicted" (fentanyl / China
investments), Casey "Fleeced" (price gouging / FTC). 0 unavailable after retrying the 429s. Every `note` quotes the line in the
creative that supports the tag.

**Numbers.** ads with sponsor shares 0 → 366 / 500; tagged 0 → 42; vendor links 0 → 0 (expected: `gotham.vendors` has not
run; the stage says so in `notes`); pipeline tests 67 → 79; static pages 2,147 → 2,147; validated files 2,142 + 5 hand.

**Dead ends.** `useSearchParams` for `?sponsor=` forced a Suspense fallback into the static `ads.html` (the whole gallery
became client-only); reading `window.location.search` in an effect keeps the 500 cards in the prerendered HTML. `yt-dlp --print`
silently implies `--simulate` and skips writing subtitle files — needs `--no-simulate`. `patch_vendor_ads` first implemented
as delete-then-append, which reordered `ads[]` on the second run and broke idempotence; replaced in place instead.

## 2026-09-05 ~23:00 — Block 2: the chain now has a spending side (master)

**What changed.** `chains_out.py` patches every `chains/<id>.json` with out-side nodes and edges: root → vendor (`money`, Schedule
E as filed), vendor → ad (`placement`, Basis verified/inferred/adjacent), root → ad (`placement`, Basis = how the sponsor was
matched), root/ad → candidate (`targeting`, support/oppose). Idempotent; no-ops on vendor nodes until `vendors.json` exists. The
web graph was rebuilt around it: side-aware layout (funding left, spending right), evidence-styled spines, a Vertex-style node
panel, and hide/expand/fold controls. 105 targeting and 140 placement edges across 86 chains (135 inferred, 5 verified) —
numbers from before the vendors stage landed; superseded by the integration entry below. AMERICA PAC, WINSENATE and 24 other
spenders now draw their ads and targets.

**Challenge.** Two things fought each other: a Sankey wants every edge to be a dollar ribbon, and the new edges are not dollars
(an ad's spend is Google's range midpoint; a targeting edge is money aimed *at* someone, none of which reaches them). Drawing
them as ribbons would have said "money flows to the candidate" — exactly the claim the product must not make. Also, the
first-click panel had to say *why* every link exists, per node kind, without a backend.

**How we solved it.** `ChainEdge.kind` decides the geometry: `money` → ribbon, `placement`/`targeting` → thin spine with an
arrowhead and a Basis dash pattern. Each `ViewNode`/`ViewEdge` carries a compact `[basis, rule, source_urls]` tuple so the panel
renders the sentence and links client-side from the same wire the SVG uses. Copy in the panel and the edge table is explicit:
"est. ad spend, range midpoint; no dollars move on this edge", "IE dollars aimed at the candidate; none reach them". The
assumptions paragraph under the graph states the midpoint, the adjacent/inferred/verified rules and "FEC does not record which
buy placed which ad". D-61.

**Numbers.** Largest chain page 562KB → 764KB (the ad nodes and Basis tuples); pipeline tests 67 → 78; contracts 17 schemas,
2,142 + 5 files validate; web build 2,147 pages.

**Next.** Merge the four children (vendors · media wall · issue focus · search) into this branch so vendor nodes appear between the
spender and its ads; critic round 3.

## 2026-09-06 ~00:30 — Block 2 integration: four children + the spending side in one pipeline (master)

**What changed.** PRs #6 (search), #7 (vendors), #10 (media wall), #9 (issue focus) merged into the chain branch (PR #8), in that
order, and every stage re-run against the others' real output. Stage order is now `ingest ledger chains vendors ads ads-enrich
issues dossier chains-out search validate` (`chains` before `vendors` since D-70: vendors reconciles against
`ledger.traceability.outside_total`, which `chains` writes): `ads-enrich` needs `vendors[]` on the sponsor to draw vendor↔ad
links, `chains-out` needs those links to hang ads off vendor nodes, `search` indexes whatever exists last.

**Challenge.** Each child branched from the contracts branch and appended its own `D-57..`, its own `LOG.md` entry, its own
`Makefile all:` line and its own imports on the shared entity/ledger pages — four-way conflicts on four files, plus 23 generated
`entities/*.json` where vendors (`vendors[]`, `vendor_id`) and issues (`issue_focus`) both patched the same files.

**How solved.** Docs: keep master's numbering, renumber each child on merge (media wall → D-63..65, issues → D-66..69; LOG entries
placed by their timestamps; cross-references in the entries and `search.py` fixed). Code: union of imports, both sections kept
on the entity page ("Where the money went" + "Ads this committee ran"). Generated JSON: take the vendors side, then re-run
`make issues` so the issue patch is applied on top rather than hand-merging JSON. The vendors test asserted `Vendor.ads == []`
(true before the media wall existed); it now checks every linked ad's sponsor is one of that vendor's spenders and its basis is
verified/inferred/adjacent — the invariant that matters.

**Numbers.** With vendors present the media wall produced 1,090 vendor↔ad links (115 inferred, 975 adjacent; 26 sponsors with
vendor rows, 2 without). In the chain graph: 314 vendor nodes, 132 ad nodes; vendor→ad 42 inferred + 295 adjacent, sponsor→ad
96 inferred + 2 verified, 347 targeting edges, across 86 chains. Issues: 23/98 spenders focus-tagged covering $227.3M of
$233.4M, 42/500 ads tagged, 0 IE notices (see the issue-focus entry). Search 2,363 items (310 vendors), 514 KB. Largest chain
JSON 644 KB; chain page HTML 692 KB; ads page 4.0 MB (the thumbnails' data, not a regression to leave — Q for the design pass).
Pipeline tests 137 → 159; web build 2,455 static pages.

**Next.** Critic round 3 on the integrated branch; FCC political files as the TV leg of vendor→ad; fill `ie_issues.json` once
docquery is reachable.

## 2026-09-06 ~01:00 — Rename: Citizen Gotham → Campaign Commons (master)

**What changed.** Albert renamed the project: the data of campaigns brought to the masses, into the "commons". Mechanical
refactor on its own branch (stacked on PR #8): `@citizen-gotham/contracts` → `@campaign-commons/contracts` (49 import sites,
`next.config.ts` `transpilePackages`, lockfiles), `pipeline/gotham` → `pipeline/campaign_commons` (Makefile `-m` targets,
tests, docs references), pyproject `campaign-commons-pipeline`, README/site title. Every stage re-run so the `method` / `rule`
strings in generated JSON (`campaign_commons.vendors`, `campaign_commons.ads_enrich`, …) name the real modules. D-70.

**Not renamed.** The GitHub repo (Albert's; old URLs redirect), and history: earlier LOG entries, CRITIQUE rounds 1–2, and the
design mockups keep "Citizen Gotham" as written at the time.

**Gotcha for existing checkouts.** `.gitignore` hides `pipeline/gotham/__pycache__`, which survives the branch switch and makes
`pip install -e .` fail with "Multiple top-level packages discovered in a flat-layout". `pyproject.toml` now pins
`[tool.setuptools] packages = ["campaign_commons"]`; `rm -rf pipeline/gotham` also clears it.

## 2026-09-06 ~02:30 — Critic round 3: the vendor page shows its receipts, the graph stops drawing Google ranges as dollars (master)

**What changed.** Round 3 of the read-only critic (`docs/CRITIQUE.md` § Round 3, 15 findings, 0 P0 / 3 P1 / 12 P2) reviewed the
integrated Block 2 stack. Fixes, in one stacked PR on top of the rename:

- *C-45 (P1)* The vendor page never rendered `Vendor.ads[]` even though 74 vendor files carried links, and its `method` footer
  said links "are empty until a human verifies one". New `VendorAds` card: thumbnails, sponsor, dates, basis label + meaning +
  rule + source links, grouped by basis, with a "see in the ads wall" link that opens the gallery filtered by `?vendor=<id>`.
  The card says in words that the FEC does not record which buy placed which ad.
- *C-46 (P1)* `layout.ts` sized ad nodes and `agg:ads` on the same dollar scale as Schedule E payments — a $550k Google
  midpoint drawn as tall as a $550k filed payment, under copy that says the two are never added. Out-side `ad`/`aggregate`
  nodes are now fixed-height; the `$` range stays in the panel text only.
- *C-47 (P1)* `ads_enrich` popped `issues` then re-assigned it, so the key moved after `vendor_links` on the second run: 1,226
  reordered lines, zero semantic diffs, dirty `git status` after one re-run. Enrichment keys are now rebuilt in a fixed order and
  the test compares `json.dumps` with key order intact.
- *C-48* `generated_at` churned on `issues.json`, `search.json` and all 311 vendor files with no content change. `util.write_json`
  (and search's compact writer) now keep the previous stamp when everything else is byte-equal; a changed file still gets a fresh
  one. Tests cover unchanged / changed / corrupt-previous / non-dict.
- *C-49* `make vendors` wrote `"ads": []` unconditionally, wiping the reverse links until `ads-enrich` re-ran. It now preserves
  the existing file's `ads[]`; `ads_enrich` remains the only writer of that field and now also prunes rows whose ad no longer
  links to the vendor.
- *C-50* Two midpoint conventions and a latent `float(None)` on Google's open top bucket (`max: null`). One `range_midpoint` in
  `util.py` (open top → floor); `issues.py` counts `open_ended` in coverage and says so in its basis rule.
- *C-51* Adjacent links paired a Google creative with *any* same-window buy, so an NRA ad card listed a mail vendor, a phone
  vendor and "other" as if they were its vendors. Adjacent is now offered only for `digital`/`production`/`other` media
  (`ADJACENT_MEDIA`); verified and inferred links are never dropped; the rule text says what was excluded.
- *C-52* No `field` medium: OTG STRATEGIES ($8.6M, "CANVASSING" ×24), Second Street, The Outreach Team and 79% of CampaignHQ
  sat in `other`, the 4th-largest medium in the race. `field` (CANVASS / DOOR / FIELD / GOTV) added to the contract, the
  classifier, `MEDIUM_LABELS` and the chain node-panel.
- *C-53* Vendor page per-medium chips always read "100%" (`MediumMix mix={[m]}`); now `pct(m.amount / v.total)`.
- *C-54* Three spellings of the same evidence basis (ads wall, chain, raw enum on issue cards and focus chips). One vocabulary
  in `web/src/lib/evidence.ts` (`BASIS_LABELS`, `BASIS_MEANING`, `BASIS_TONE`, `BASIS_DASH`); chain `basis.ts` re-exports it.
- *C-55* Docs drift: README `make` example, LOG stage order, CONTRACTS `ads[]` writer, superseded edge counts — corrected.
- *C-56* `[tool.setuptools] packages` pinned (see the rename entry's gotcha).
- *C-57* "Google shows the advertiser, not the paid-for-by line" was false at the source (the Transparency Center renders
  "Paid for by …" inside the creative). Reworded everywhere to what is true: Google's *bulk data* carries no paid-for-by field
  for US ads; the match is on advertiser name.
- Delete list: the always-empty "verified vendor link" gallery filter is hidden until a row exists (basis options with zero ads
  are not rendered).

**Challenge.** Proving idempotence. After the fixes a re-run still showed `generated_at` changes on 75 vendor files and
`search.json` — a real content change (`other` → `field` in the vendor sublabels and `media_mix`), not the bug. The check that
settled it: stage all output, run `vendors ads-enrich issues chains-out search` again, `git diff --stat data/out` empty. That
is now the acceptance test for every pipeline PR. Second gotcha: Next's persistent webpack cache served a stale copy of
`contracts/src/schemas.ts` (symlinked package, `resolve.symlinks = false`) and failed the build on `medium: "field"` until
`.next/cache` was removed — Vercel clones fresh, so it does not see this.

**Numbers.** Vendor↔ad links 1,090 → 612 (115 inferred unchanged, adjacent 975 → 497); ads with any link 280; vendor files
carrying `ads[]` 74 → 38 (the rest only had TV/mail/phone adjacency). Medium `other` $14.2M → $0.3M; `field` $13.9M. Pipeline
tests 159 → 167; 2,459 static pages; ads page HTML 4.0 MB → 3.3 MB (fewer serialised links; C-58 proper is still open). Second
run of every Block 2 stage: 0 files changed.

**Left open (P2).** C-58 wire size (server-render the ad cards, template the `rule` prose); C-59 duplicate `_date_range` and
`visibility: "disclosed"` on out-side nodes (midpoint half is done).

## 2026-09-06 ~03:30 — Per-ad pages: the chain walked backward from one creative (master)

**What changed.** Albert's read of the Block 2 UI: "a little cluttered visually", and "each ad should have its own page so we
can see the chain / graph going backward". New static route `/races/<race>/ads/<ad_id>` (500 pages in PA; 2,959 total, was
2,459): creative large, Google ranges with the midpoint labelled, sponsor match and dark share (worded as the sponsor's funding,
not the ad's), issue tags with their tagger, the full vendor-link list (medium, basis, rule, sources), and a `ChainDiagram` fed
by `adFocusWire` — the sponsor's funding side plus only what touches this ad on the spending side. The wall card lost its vendor
rule/source block (one line "Vendors in window: X (inferred), Y (adjacent)") and links to the page from the creative, the title
and the footer; every other ad link in the app (entity thumbnails, chain "seen ads" strip, vendor page reverse links, chain ad
nodes) now lands on the page instead of a `#anchor` in the 500-card wall. Assumptions text repeated on the page: vendor dollars
filed, ad dollars a Google midpoint never added to them, link semantics per basis, donor dollars pooled, nothing reaches the
candidate. D-72.

**Challenge.** The chain files only carry the top 10 ads per sponsor as nodes (D-61 keeps the picture legible), so 368 of 500 ads
had no graph to show. Options: emit every ad as a node and fold client-side (bigger files, and the spender page gets busier),
or build the ad's out-side in the web layer from `Ad.vendor_links`, which already carries every basis, window and amount. Took
the second; `ad-view.ts` mirrors `chains_out._ad_parent_edge` (strong link → hangs off the vendor with the midpoint; adjacent
only → dotted zero-amount edge from the vendor plus a placement edge from the sponsor with the match basis). Two
implementations of one rule is a maintenance risk, noted in D-72 for the next critic round.

**Numbers.** Ads wall HTML 3.0 MB → 2.8 MB (the card is still dense; C-58 server-rendered compact cards stays open). Ad page
~24 KB HTML + the sponsor's chain wire.

## 2026-09-06 ~05:00 — D-74: adjacent vendor→ad links dropped; date overlap becomes a sentence (master)

**What changed.** Albert, reviewing the three link kinds: "it's more confusing now to have the implied links." The `adjacent`
basis (any digital/production/other buy overlapping the ad's run dates, drawn as a dotted edge) asserted nothing beyond
co-occurrence, but drawn as an edge it read as a relationship. Removed it end to end: `adjacent` is gone from `Basis`,
`AdVendorLink.basis` and the JSON schemas; `ads_enrich.vendor_links` emits only `verified` (hand file) and `inferred` (exactly
one digital vendor in the window, D-64); `chains_out._ad_parent_edge` and the ad page's `ad-view.ts` both filter to those two so
a stale record can never become an edge. The date fact is kept as **context**: `Ad.same_window_buys[]` — vendor, medium, dollars
and buy count inside the window, source URL, deliberately no `basis` — rendered as one sentence on the ad page ("While this ad
ran, WINSENATE reported digital buys to Gambit ($…) and Waterfront ($…). FEC records do not identify which vendor placed this
ad, so these are not drawn as links.") and, in reverse, on the vendor page ("N ads by X ran during this vendor's buys; not linked").
Legends read `solid = filed or verified · dashed = inferred`; the wall filter lost "adjacent"; every assumptions block says
the same-window vendors are listed as prose, not edges. D-74; Q-12 closed.

**Challenge.** Regenerated artifacts still carried `adjacent` until `make`-order was respected (ads-enrich → chains-out → search);
the contract test on vendor detail files caught the stale values first, which is what it is for. Second run byte-identical.

**Numbers.** Vendor→ad links 612 → 115 (497 adjacent removed, 115 inferred kept, 0 verified in PA yet); 280 of 500 ads carry
same-window context (611 rows); 169 pipeline tests, 2,455 out + 5 hand files validate.

**Review fixes (same PR).** Three findings from review, all real: (1) a vendor's in-window buys were grouped as one lump under
its *dominant* medium, so a TV-dominant firm with digital buys was dropped from context, and a phones-dominant firm was
inferred as the "only digital vendor" with a rule reading "$20,138 in phones buys" (California Nurses Association) — now
context and links count only the vendor's placeable buys (digital/production/other) and the medium is the dominant one among
those; (2) `vendor_links` iterated only vendors with an in-window buy, so a hand-verified pair with no dated payment would
silently vanish — verified links are now emitted regardless (rule says "no payment … is dated in that window"; `window`
nullable when the ad has no dates), which the PA data does not yet exercise (0 verified rows) but the contract must hold;
(3) the pipeline window has a 7-day lead (`WINDOW_LEAD_DAYS`) while every sentence said "while this ad ran" — kept the lead
(placement is paid before air) and changed the copy everywhere to "in the week before and while this ad ran". Context rows
611 → 728 across 280 → 284 ads (mixed-media vendors' digital portions now shown); links unchanged at 115 inferred, one rule
text corrected. 171 pipeline tests.

## 2026-09-06 ~00:30 — Design PR 1: one race shell, one nav, one header (design/race-shell)

**What changed.** First of Patrick's five design PRs (plan in the session attachment). `RaceShell` wraps every race-scoped
page — overview, ads wall, ad, vendors, vendor, stories, both dossiers, entity, chain, donor; the Money Trails pages (PR #16)
are left alone, they are being redesigned separately — and owns breadcrumbs, the data-status banner
and `RaceNav`; the pages pass their `DetailHeader` (or the overview banner) as `header` and keep only their content. `RaceNav`
no longer takes `counts`/`active` props: `getRaceSections(raceId)` (memoised, one read per race per build) decides which tabs
exist and their counts, dossier tabs come from `race.candidates`, a Money Trails tab appears once `trails.json` exists, and "Ledger"
became "Overview". Active state is `aria-current="page"` on the section, `aria-current="true"` on the parent when the page is a
record inside it. Tokens: `@theme` now defines paper/surface/ink/ink-soft/muted/rule/rule-strong, the visibility colours and
their text variants, and `--font-sans`; the landing, dashboard and detail pages stop restating the header, footer, font and
focus ring under `body:has(...)`. The 390px bug: the header row was `nowrap`, so the search box (fixed 14rem) was pushed past
the viewport on every page and the whole document scrolled sideways. It now wraps to a second row below 680px; the race tabs
scroll sideways in one row instead of stacking. `EntityHeader` split into the banner (`EntityHeader`) and the registration
facts (`EntityProfile`) so the tabs sit under the banner on entity pages too. D-75.

**Challenge.** Which tabs a race has is not a property of the page but of the data: PA has vendors and trails, a stub race has
neither, and a "Vendors 0" tab would say the stage ran and found nothing. `vendors: number | null` keeps "absent" distinct from
"zero" — the same missing ≠ none rule the pipeline follows. The overview page's banner + nav needed to stay one grid child so
the dashboard's 88px row gap did not open between them; `RaceShell` has a `dashboard` variant for exactly that.

**Numbers.** 2,960 pages build (no routes added or removed). `scrollWidth` at 390px: 417 → 375 (= viewport) on all 11
sampled race pages. `body:has(...)` rules 38 → 7 (landing hero only); palette hexes 75 → 21 (the rest are in `@theme` or page-local tints).

## 2026-09-06 ~02:00 — Design PR 2: the Vendors index reads top-down (design/2-vendors)

**What changed.** Second of Patrick's five design PRs. `/races/[raceId]/vendors` drops its eight-column table for an editorial
page inside the PR 1 shell: header (eyebrow, "Vendors", one sentence, one assumption line), a four-figure summary strip
(vendors · reported payments · vendors linked to ads · ads with same-window context), an assumptions callout, then a
`SectionNav`-ed column — Largest reported payments (top 10), Vendors linked to ads, Paid during ad windows (a collapsed
`<details>`), By medium (the bar and per-medium figures kept, `MediumBasisNote` kept), All vendors. Every list is a
`VendorRow` (`components/vendors/vendor-row.tsx`): name → medium · payments · dates · linked ads · ad windows · alias basis,
targets line; on the right the reported total, sponsors (linked, first two), one evidence chip and the FEC link — so nothing
the table showed is gone, it is just no longer eight columns wide. The evidence chip comes from the ads, not the vendor file:
`lib/vendors.ts::vendorAdContext` folds `Ad.vendor_links` into per-vendor verified/inferred counts and `Ad.same_window_buys`
into a per-vendor count of ad windows (context, D-74). `VendorIndex` (client) filters the full list by name/alias, medium,
sponsor, ad-link evidence (`any · has verified · has inferred · no linked ads`) and minimum reported, mirrors the state to
`?q=&medium=&sponsor=&evidence=&min=` with `replaceState` (read after mount; the page is still static), pages 25 rows until
"Show all" or a filter, and hides the controls behind a "Filters" button below 680px. D-77.

**Challenge.** The one number that looked wrong was right. A first cut excluded a linked vendor from an ad's same-window
context, on the theory that a link supersedes context — and got 256 ads, not the 284 the pipeline logs. The contract says
`same_window_buys` lists every placeable-medium vendor paid in the window, *linked or not*; the pipeline and the ad pages count
it that way, so the index does too, and the section copy says "whether or not the pair also met the bar for a link". The other
trap was the sponsor `<select>`: 98 committee names, one of them 90 characters, and a `<select>` sizes to its longest option,
so `?sponsor=…` scrolled the page sideways at every width until the control got `width: 100%; min-width: 0`.

**Numbers.** 2,960 pages build (no routes added or removed); vendors route 3.87 kB first-load JS on top of the shared 129 kB.
Index: 310 vendors, $233M, 9 linked (0 verified, 9 inferred, 115 ads), 42 vendors paid during the windows of 284 of 500 ads.
`scrollWidth` at 390px stays 375 with and without `?medium=digital&evidence=inferred`. `npm test`: no script on this branch.
