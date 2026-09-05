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
