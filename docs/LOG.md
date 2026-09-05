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
