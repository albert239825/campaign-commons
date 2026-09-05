# Technical plan — Citizen Gotham V0

Product scope: see the PRD (Albert). This is the how.

## Architecture

```
FEC bulk (S3, no auth)  ─┐
OpenFEC API (Sched E)   ─┤   pipeline/  (Python, DuckDB)          data/out/*.json         web/  (Next.js 15)
congress.gov API        ─┼─▶ ingest → ledger → chains ─────────▶  validated against  ───▶  server components read
senate.gov roll-call XML─┤   ads · dossier                        contracts/ (Zod)        JSON at build; no backend
Google political ads    ─┘
```

Runtime = lookups + rendering. Everything else is offline and reproducible (`make all`).

## Pipeline stages (`pipeline/gotham/`)

| Stage | Input | Output | Owner |
| --- | --- | --- | --- |
| `ingest` | cm/cn/ccl/oth/pas2/indiv 2024 bulk + Sched E via API | `data/fec/pa-sen-2024/*.parquet` (committees, candidates, transfers, individual_contributions, independent_expenditures) | Child: FEC ingest |
| `ledger` | parquet | `races.json`, `ledger.json`, `entities/*.json` | Child: FEC ingest |
| `chains` | parquet + ledger | `chains/*.json`, traceability + flags written back into ledger/entities, `stories.json` | Child: chains (Stage 2) |
| `ads` | Google transparency bundle | `ads.json`, `web/public/creatives/<race>/` | Child: ads |
| `dossier` | congress.gov + senate.gov + Wayback | `dossiers/*.json` | Child: dossier |

### Ingest details
- Bulk URLs: `https://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com/bulk-downloads/2024/{cm24,cn24,ccl24,oth24,pas224,indiv24}.zip`. Header CSVs at `https://www.fec.gov/files/bulk-downloads/data_dictionaries/{cm,cn,ccl,oth,pas2,indiv}_header_file.csv`.
- Sched E: `GET /v1/schedules/schedule_e/?candidate_id=…&cycle=2024&per_page=100` (paginate with `last_index` + `last_expenditure_date`). Dedupe on `(committee_id, candidate_id, expenditure_date, expenditure_amount, payee_name)` — 24/48-hour reports overlap periodic reports. Prefer `is_notice=false` rows where both exist.
- Seed set: principal committees of race candidates (`cn.CAND_PCC`) + every committee with a Sched E targeting them.
- Neighborhood: committees that transferred into seed (`oth`, `TRANSACTION_TP` in `TT_COMMITTEE_TO_COMMITTEE_RECEIPT`), repeat to closure, cap 8 hops. Expect a few hundred committees.
- Individuals: `indiv` rows where `CMTE_ID` in neighborhood, `MEMO_CD != 'X'`. Keep `TRANSACTION_TP`, `OTHER_ID` (conduit).
- Dedupe transfers: same edge appears as receiver Sched A (`18G/18K/…`) and sender Sched B (`24G/24K/…`). Keep receiver's row; emit `transfer_mismatch` flag when amounts disagree >1%.
- Everything is 2024-cycle rows only (`TRANSACTION_PGI`/dates 2023-01-01..2024-12-31).

### Chains details
See `gotham/chains.py` docstring and DECISIONS D-05..D-07. Non-committee payers: `ENTITY_TP` in `{ORG, COM?}` with no committee master match → `org:` node, visibility `dark` (V0 doesn't do 990 lookups; `inferable` is reserved).

### Dossier details
Casey (bioguide `C001070`): sponsored/cosponsored bills 117th–118th via `https://api.congress.gov/v3/member/C001070/sponsored-legislation`; roll calls via senate.gov XML. Hand-tag to the 10 issues. Seed votes worth pulling: IRA (117-2 #325), CHIPS (117-2 #271), PACT Act, Respect for Marriage, Fiscal Responsibility Act (118-1 #149), H.J.Res.109 SAB 121 (118-2 #174), border bill cloture (118-2 #33), FISA reauth, Laken Riley Act, TikTok divestiture/foreign aid supplemental (118-2 #151). McCormick: Wayback snapshot of davemccormickpa.com/issues, one `stated_position` per issue present.

## Web (`web/`)

Routes and ownership (each child owns its dirs; shared files are `src/lib/*` and `src/components/ui/*` — add, don't restructure):

| Route | File | Owner |
| --- | --- | --- |
| `/` race table | `src/app/page.tsx` | Frontend A |
| `/races/[raceId]` ledger | `src/app/races/[raceId]/page.tsx` + `src/components/ledger/` | Frontend A |
| `/races/[raceId]/entities/[entityId]` | `…/entities/[entityId]/page.tsx` + `src/components/entity/` | Frontend A |
| `/races/[raceId]/chains/[entityId]` | `…/chains/[entityId]/page.tsx` + `src/components/chain/` | Frontend B |
| `/races/[raceId]/ads` | `…/ads/page.tsx` + `src/components/ads/` | Frontend B |
| `/races/[raceId]/candidates/[candidateId]` | `…/candidates/[candidateId]/page.tsx` + `src/components/dossier/` | Frontend B |
| `/methodology` | `src/app/methodology/page.tsx` | master |

Data access only through `src/lib/data.ts`. All dynamic routes export `generateStaticParams`.

## Sessions

- Stage 0 (master): this scaffold, contracts, mocks, stubs. → `main`.
- Stage 1 (parallel children, branch each): FEC ingest+ledger · Frontend A · Frontend B · Ads · Dossier.
- Stage 2 (after ingest lands): chains + traceability + flags + stories.
- Stage 3 (master): merge, swap mocks, validate, click-through, `SATURDAY.md`.
- Post-V0: critic session reviews architecture; V1 work on branches.

## Cut lines

- Chains don't compute → ship ledger + entities; traceability stays `null`; chain links hidden (`has_chain: false`).
- Ads matching flaky → gallery stays `match_confidence: "none"`.
- Dossier incomplete → issues render "No record loaded".
- Any per-race JSON > 5MB → move that surface behind a route handler reading DuckDB (contracts unchanged).

## Block 2 — V1: vendors, media provenance, issues, search, interactive chain (2026-09-05 evening)

Scope agreed with Albert; ontology in [ONTOLOGY.md §0](ONTOLOGY.md#0-scope-by-version). Quiz is held. Patrick owns the design
system in parallel (see "Coordination" below). DB-less stays: every new artifact is a precomputed join over data already in the
repo plus five hand-maintained JSON files; search is a static index; nothing needs a runtime.

### Principle for this block: every inference is labelled

Nothing joins an FEC payment to an ad-library creative, and nothing on file says what a party PAC is "for". So every
relationship that is not read straight off a record carries a `Basis` (`contracts/src/schemas.ts`):

| `basis` | Graph edge | Card copy pattern | When |
| --- | --- | --- | --- |
| `filed` | solid | "Reported to the FEC on …" | the row exists on a government record |
| `verified` | solid + check | "Produced by X — verified [source]" | a human found a source naming both sides |
| `inferred` | dashed | "Only digital vendor paid in this window: X — inferred" | an explicit rule, stated in `rule` |
| `adjacent` | dotted | "Ran Oct 1–14. In that window the sponsor paid X and Y for digital buys; FEC does not record which buy placed which ad." | co-occurrence only |

The UI must render `basis.rule` wherever it shows the relationship. Vendor→ad uses adjacent everywhere, inferred where the
single-vendor rule holds, verified only from `data/hand/<race>/vendor_ad_links.json`. Issues have two layers that are never
summed: **ad/IE content** (what the money bought — attributable) and **spender self-described focus** (what the org says it is
for — not attributable to dollars).

### Sequence

1. Master (this PR): contracts + JSON Schema, `data/hand/<race>/` convention (empty valid files), validators cover both
   roots, Makefile targets, this plan. Merge to `main`.
2. Four children in parallel, each on `devin/<ts>-block2-<name>` → PR to `main`, ≤1.5h. Each PR: `make validate`, `make
   test`, `make lint`, `cd web && npm run lint && npx tsc --noEmit && npm run build`, a LOG.md entry, a D-nn line.
3. Master: integrate, extend the chain rightward (needs 1 + 2), Vertex-style node panel, critic round 3, preview rebuild.

### Children

| # | Session name | Builds | Reads | Writes (pipeline) | Writes (web) | Must not touch |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Block 2 — vendors | `gotham/vendors.py`: normalise Schedule E `payee_name` (upper, strip punctuation + INC/LLC/LP/CO suffixes, rapidfuzz token-set ≥ 92 on the residue, then `vendor_aliases.json`); classify `medium` from `purpose` keywords (raw purpose kept); emit `vendors.json`, `vendors/<id>.json`; patch each `entities/<id>.json` with `vendors[]` and per-IE `vendor_id`/`medium`. Tests: per-spender IE totals unchanged; `VendorIndex.total == ledger outside total`; every IE with a payee has a `vendor_id`. | `data/fec/<race>/independent_expenditures.parquet`, `entities/*.json`, `data/hand/<race>/vendor_aliases.json` | `vendors.py`, `tests/test_vendors.py`, alias file rows | `components/entity/vendors-table.tsx` ("Where the money went": vendor × medium × for/against, dates, fec.gov link per row) on the entity page; `/races/[raceId]/vendors/[vendorId]` page (all buys, all spenders, ads by `basis`); `lib/data.ts` getters | `ledger.py`, `chains*.py`, `ads*.py`, ad components |
| 2 | Block 2 — media wall | `ads_bundle.py` post-step (or new `ads_enrich.py` called by `make ads` without re-downloading the bundle): `sponsor_visibility_shares` from `chains/<sponsor>.json`; `vendor_links[]` per ad = sponsor's vendor rows (from `entities/<sponsor>.json.vendors` + IE dates) overlapping `[first_shown, last_shown]` → `adjacent`; `inferred` when exactly one vendor of medium `digital` in the window; `verified` from `vendor_ad_links.json`. Also writes each vendor's reverse `ads[]` if `vendors/<id>.json` exists (idempotent; runs after 1 in `make all`, mock vendor rows until 1 lands). Hand-tags the top ~40 ads by spend into `data/hand/<race>/ad_issues.json` (watch/read the creative; 1–3 issues; note). | `ads.json`, `chains/*.json`, `entities/*.json`, hand files | `ads_enrich.py`, `tests/test_ads_enrich.py`, `ad_issues.json` rows | `ad-card.tsx`: dark-share **number** ("34% of sponsor's traced money is dark", from `sponsor_visibility_shares.dark`), issue chips, vendor line with `basis.rule`; gallery sort by dark share, filter by issue; `components/entity/ads-section.tsx` (sponsor → its ads, on the entity page); donor page: "committees this donor gave to ran N ads" link (pooled caveat stays) | `vendors.py`, `ledger.py`, chain components, `globals.css`, `components/ui/*` |
| 3 | Block 2 — issue focus | Research the top 20 outside spenders (≈90% of $233M) + top named org funders in chain termini: own site / Wayback / FEC Form 1 "connected organization" → `issue_focus.json` rows (`kind`, ≤3 `issue_ids` first = primary, `description` in the org's words, `quote`, `source_urls`). Tag the top ~50 IEs by amount from their 24/48-hour notice PDF → `ie_issues.json`. `gotham/issues.py`: merge focus into `entities/<id>.json.issue_focus`, IE tags into entity IE rows, ad tags into `ads.json` (`issue_ids`, `issue_basis`); compute `issues.json` (`by_ad_issue` from ad spend midpoints + tagged IE dollars, `by_spender_focus` dollar-weighted with traceability/dark share, `coverage`). | ledger, entities, chains, ads, hand files | `issues.py`, `tests/test_issues.py`, `issue_focus.json`, `ie_issues.json` | Ledger cards `components/ledger/issue-cards.tsx`: "Outside spending by issue in the ads" (midpoint, coverage note) and "Spenders' self-described focus" (with "$X from party/leadership committees that name no issue"); entity header chip with focus + source link | `vendors.py`, `ads_enrich.py`, ad card, chain components |
| 4 | Block 2 — search | `gotham/search.py` → `data/out/search.json` from races, candidates (+ dossier href), committees (entity pages; aliases from FEC name variants), vendors (if `vendors.json` exists; raw payee aliases), donors (donor files), org termini with entity pages. `weight` = dollars. | all of `data/out` | `search.py`, `tests/test_search.py` | `components/search/search-box.tsx` (client; loads `/search.json` on focus; substring + token prefix match; grouped by kind; keyboard nav; ⌘K) in the site header + race pages; `lib/data.ts` getter; copy `search.json` into `web/public` at build (`next.config` or `prebuild`) | anything under `components/ui/*` beyond adding one header slot |

Shared rules for children: read `docs/{CONTRACTS,ONTOLOGY,FAQ,LOG}.md` first; contracts are frozen — additive optional
fields only, and say so in the PR; adjacency language only (no "bought", "influenced", "funded the ad"); every number gets a
`source_url`; mock rows for another child's artifact live under `tests/fixtures/`, never in `data/out`.

### Master after the children land

- Chain rightward extension (`chains_graph.py`): `side: "out"` nodes — vendors (from entity `vendors[]`), ads (sponsor's
  ads; `amount_in` = spend midpoint with `basis`), candidates (IE targets) — with `money` / `placement` / `targeting` edges and
  `summary.out_total`. Depth on out-edges = depth of `to`.
- Vertex-style interaction (`components/chain/`): click a node → side panel with per-kind content (donor: totals, employer,
  forward-view link · committee: receipts, IEs, visibility shares, flags, fec.gov · vendor: buys by medium, targets · ad:
  thumbnail, run dates, spend range, issue chips, `vendor_links` with basis · candidate: for/against totals, dossier link),
  actions: open full page · expand ancestors · expand children · hide node. Edge click → panel with `basis.rule` and sources.
  Legend: solid = filed/verified, dashed = inferred, dotted = adjacent. Patrick designs the panel; master builds mechanics
  with existing tokens.
- Critic round 3 (read-only child): every place a `basis` other than `filed` reaches the screen must show its rule; issue
  layers never summed; vendor grouping never changes IE totals.

### Coordination with Patrick (design system)

Children add feature components under `components/<feature>/` using existing tokens and `components/ui/*` as-is. Patrick owns
`web/src/app/globals.css`, `tailwind.config.*`, `components/ui/*`, fonts. If he restyles existing pages he branches from
`main` after this block merges, or accepts conflicts on the ledger and entity pages (children 1–3 touch both).

### Data not needed this block (pushed)

Campaign Schedule B media lines (needs `oppexp24` bulk or the OpenFEC key re-added for this repo) → Block 3. Meta Ad Library →
waits on developer verification. FCC political files → by hand, whenever a teammate is free (`tv_buys` in ONTOLOGY V2).
