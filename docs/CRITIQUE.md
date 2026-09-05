# CRITIQUE — Citizen Gotham, adversarial review of `main` @ c28633e (2026-09-05, post `child/chains` merge)

Read-only review. Nothing fixed. All commands green: `contracts` typecheck+validate (2074 ok), `pipeline` lint/test (28)/validate,
`web` lint/typecheck/build (2,021 pages, 50 s). Every route class clicked on `npm run dev`; all 200 except the ones noted below.
`FEC_API_KEY`/`CONGRESS_GOV_API_KEY` were **not** present in this environment; spot-checks used fec.gov pages in a browser.

## Verdict

Demo it — but only the ledger, entity pages, ads and dossiers, and only after fixing C-01..C-04. The single biggest risk is the
**visibility model**: every Schedule A donor typed `ORG` is labelled `dark` / "undisclosed" / "no donor-disclosure obligation".
Coinbase Inc., Koch Industries, Ripple Labs, United Brotherhood of Carpenters and the RSLC are all "dark" today. That inflates
`dark_share`, drives 33 `dead_end_dark` flags and the 64.2% headline traceability number, and puts a demonstrably false sentence
("32% of SENATE LEADERSHIP FUND's receipts trace to organizations with no donor-disclosure obligation") on the #3 spender's page.
The project's own README rule — "Disclosed ≠ traceable; dark = the hidden-donor layer" — is what the code violates. Second risk:
IE dedupe misses notices whose dissemination date ≠ expenditure date, so Keystone Renewal PAC (#2 spender) is over-counted by
$7.2M (+21%) versus fec.gov. A judge who clicks any `source_url` on the ledger lands on the six-year candidate view and sees a
different number than the page they came from.

## Spot-check vs fec.gov (by hand, 2026-09-05)

| Number | Ledger | fec.gov | Δ |
| --- | --- | --- | --- |
| Casey total receipts 2023–24 (`/data/candidate/S6PA00217/?cycle=2024&election_full=false`) | 58,147,345.34 | 58,147,345.34 | 0 |
| Casey individual / committee contributions | 43,598,592.23 / 2,964,955.31 | 43,598,592.23 / 2,903,155.31+61,800 | 0 |
| McCormick total receipts (`/data/elections/senate/PA/2024/`) | 35,970,836.83 | 35,970,836.83 | 0 |
| SLF oppose Casey (elections page IE table) | 52,791,239.86 | 52,799,239.86 | −8,000 |
| WinSenate oppose McCormick | 59,648,024.66 | 60,248,024.34 | −600,000 (−1.0%) |
| Keystone Renewal PAC oppose Casey | 41,333,144.35 | 34,126,789.22 | **+7,206,355 (+21%)** |
| Keystone Renewal PAC support McCormick | 13,061,838.14 | 12,168,528.64 | +893,309 (+7%) |
| American Crossroads oppose Casey | 8,768,147 | 8,795,912.55 | −27,766 |

Casey `campaign.source_url` = `.../candidate/S6PA00217/?cycle=2024` opens on "All years 2019–2024" = **$64,886,501.07**, not $58.1M.

## Findings

| ID | Severity | Area | File:line | Finding | Suggested fix (≤2 lines) |
| --- | --- | --- | --- | --- | --- |
| C-01 | P0 blocker | Money model / provenance | `pipeline/gotham/chains_graph.py:267-270`, `pipeline/gotham/ledger.py:347`, `pipeline/gotham/ledger.py:12` | `ENTITY_TP='ORG'` ⇒ `visibility: "dark"`. FEC `ORG` covers corporations, unions, LLCs, 527s and c4s alike. Top "dark" sources in `data/out`: FUTURE FORWARD USA ACTION (c4, ok), COINBASE $68.5M, KOCH INDUSTRIES $40M, RIPPLE LABS $45M, UNITED BROTHERHOOD OF CARPENTERS $32.8M, REPUBLICAN STATE LEADERSHIP COMMITTEE $19.3M (527, IRS-disclosed). All labelled "no donor-disclosure obligation". Directly contradicts README:43 "dark = the hidden-donor layer (c4s, LLCs)". | Introduce an `org_kind` step: corporation/union (name suffix INC/CORP/LLC?/UNION/BROTHERHOOD/ASSOCIATION or a curated list) ⇒ `disclosed`; only unknown/c4-like ⇒ `dark`; or rename to `unregistered_org` and never say "undisclosed". |
| C-02 | P0 blocker | Money model | `pipeline/gotham/fec_ie.py:64-77` | Dedupe key uses expenditure date for periodic rows but **dissemination date** for notices; when they differ (normal — a 24-hr notice is filed ≤1 day after dissemination, the F3X row carries the disbursement date) both rows survive. Amended rows with a changed amount also both survive (amount is in the key). Result: Keystone Renewal PAC +$7.2M / +21% vs fec.gov; WinSenate −$600k. `test_dedupe.py:34-35` only tests the same-day case. | Key on `(committee, candidate, payee, amount)` with a ±3-day date window, and on `tran_id`/`image_num` lineage for amendments; add a test with notice date ≠ expenditure date. |
| C-03 | P0 blocker | Demo data / flags | `pipeline/gotham/chains_flags.py:84-87` | `popup` fires when first IE ≤ 60 days after first receipt — true of every new PAC — and when IE precedes receipt the detail prints a **negative** number. Live output on the #2 spender: "KEYSTONE RENEWAL PAC's first reported activity … came within **-3 days** of its first receipt." 13 spenders flagged. | Require `late` only (first activity after `POPUP_AFTER`), or require `0 <= ie0-r0 <= 60` **and** total receipts below a threshold; clamp negative. |
| C-04 | P0 blocker | Demo data / flags | `pipeline/gotham/chains_flags.py:173-195`, `contracts/src/display.ts:41` | `shell_cluster` = same street + treasurer, 2..10 committees. Fires on 401 entities incl. **FRIENDS OF DAVE MCCORMICK** ("same address and treasurer as PENNSYLVANIA HONOR, TEAM MCCORMICK" — his own JFCs) and WINSENATE↔SMP (affiliated). Flag id literally says "shell". Rendered on the candidate's own campaign page. | Exclude committees sharing `CAND_ID`, JFC designation `J`, and affiliated/connected-org links; or rename id/label to `shared_agent` everywhere. |
| C-05 | P1 should-fix | Provenance | `pipeline/gotham/util.py:31-32`, `pipeline/gotham/ledger.py` (campaign `source_url`) | `fec_candidate_url` omits `election_full=false`; fec.gov defaults Senate candidates to the 6-year view ($64.9M vs $58.1M shown). Every headline campaign number "links to a record" that shows a different number. | `?cycle=2024&election_full=false`. |
| C-06 | P1 should-fix | Money model / traceability | `pipeline/gotham/chains_graph.py:288-296`, `pipeline/gotham/chains.py:193` | `depth_cap` termini (unloaded committee, 8-hop or 600-node cap, valve-violation edge) count as **disclosed**, i.e. "traced to a named individual" (home copy `web/src/app/page.tsx:17,60`). A committee whose donors were never looked at is not traced. Conversely non-Form-5 spenders with no loaded receipts are counted 100% dark (`unchained`) while `method` says only Form 5 filers are. | Add a fourth bucket `unresolved` (or fold into `inferable`) for depth_cap dollars; make `traceability.method` match the code. → fixed in ae2fd84 (fourth bucket `unwalked`, neutral grey; traceability stays disclosed/total so race 0.729→0.721) |
| C-07 | P1 should-fix | Money model / conflation | `web/src/components/ledger/spenders-table.tsx:15-18` | Spender row colour derived from `traceability_score` ≥0.5⇒disclosed, ≥0.2⇒inferable, else dark. A super PAC is always disclosed; this paints e.g. NRDC ACTION VOTES (score 0.0) as a dark entity. `inferable` is never emitted by the pipeline (D-34) yet is invented here. | Colour by `dark_share` of the *chain* with an explicit "behind the spender" legend, or drop the colour and show the % only. → fixed in 08e4fd3 (per-row stacked share bar from `visibility_shares`; `spenderVisibility()` deleted) |
| C-08 | P1 should-fix | Provenance | `pipeline/gotham/chains.py:113`, `:74`, `pipeline/gotham/ledger.py:180-191`, entity inflows | Chain edges, ledger contributors and entity inflows all carry `fec_receipts_url(receiver)` — a **search page for the whole committee**, not the record. Individual nodes get `&contributor_name=`, but committee→committee edges do not even filter by contributor. "Every figure links to its government record" (layout footer) is true only for Schedule E rows. | Append `&contributor_name=`/`&contributor_id=` (committee) to edge and inflow URLs; for aggregates keep the committee page. → fixed in f37d85f (edges + entity inflows pair-filtered; fec.gov UI honours `contributor_name=<CMTE_ID>`, not `contributor_committee_id` — D-43) |
| C-09 | P1 should-fix | Demo data | `data/out/pa-sen-2024/entities/C00431056.json` `flags`, `pipeline/gotham/chains_flags.py:127-144` | Casey's campaign page shows `transfer_mismatch` "Sender and receiver reports disagree" for its own JFC (Casey Keystone Victory Fund, $6.4M). JFC Sched B allocations vs recipient Sched A routinely differ; this reads as an accusation on the candidate page. | Skip mismatches where sender designation is `J` (JFC) or both share `CAND_ID`; else lower to a note. → fixed in 78069cf (principal ↔ own-JFC pairs skipped, D-42; 17→16 flagged entities) |
| C-10 | P1 should-fix | Web perf | `web/src/components/chain/chain-diagram.tsx`, `data/out/pa-sen-2024/chains/*.json` | Chains hold up to 639 nodes; chain pages render a full SVG server-side → **5.4–6.6 MB HTML** per page (WinSenate, CFFE PAC), 5 s TTFB on dev. 68 such pages. | Diagram only the top N=40 material edges per node (already `MAX_CHILDREN`) and collapse depth ≥3 into aggregates; table stays complete. → fixed in b051031 (client-side pruned diagram, top-100 edge table; WINSENATE HTML 540 KB) |
| C-11 | P1 should-fix | Contracts / UI | `web/src/app/races/[raceId]/ads/page.tsx:14`, `web/src/components/ads/ad-card.tsx` | Ad "Funding chain →" links exist iff a chain *file* exists (`listChainIds`), independent of `has_chain`; and ad `matched_entity_id` C30003529 (Keystone Prosperity PAC, Form 5) links to `/entities/C30003529` → **404** (5 ads). | Only link when `entities/<id>.json` exists (`hasEntity`) and `has_chain` is true. |
| C-12 | P1 should-fix | Money model | `pipeline/gotham/ledger.py:427` vs candidate summary path | Same committee, two "from individuals" numbers: ledger (summary) 43,598,592.23 vs entity page (itemized − ORG) 43,527,392.23. Judge opens Casey's entity from the ledger and sees a different number under the same label. | Label entity totals "itemized" or derive both from one source; add a `basis` field. → fixed in 67ddc6c (distinct labels + note on candidate entity pages) |
| C-13 | P1 should-fix | Contracts | `contracts/src/schemas.ts:165` `top_contributors`, `:353` `currency`, `:360` `issue_ids`, `:435-456` `Story*`, `web/src/lib/data.ts:54` `getStories` | Never read by the UI: `top_contributors` (emitted, all JFC transfers — the label is wrong too), `spend_range.currency`, `ad.issue_ids` (always `[]`), the whole `stories.json` (18 stories, `verified:false`). | Either render or drop; see Delete list. → fixed in 36ded3b for the four fields (D-44); `Story*`/`stories.json`/`getStories` deliberately left — out of the P1 assignment scope |
| C-14 | P1 should-fix | Docs drift | `docs/SATURDAY.md:20,23`, `pipeline/gotham/chains.py:8` (D-36), `pipeline/gotham/ads.py:102` vs `:156` | SATURDAY still says Chains/Stories **mock** (they are `real` since c28633e). `chains.py` cites D-32..D-36; DECISIONS stops at D-35. `ads.py` writes `paid_for_by: row.declared_name` while its own `notes` say "paid_for_by is null here" (null in data today only because Google publishes none for PA). | Update SATURDAY table; fix D-range; set `paid_for_by` to `None` or fix the note. |
| C-15 | P1 should-fix | Money model | `pipeline/gotham/chains_graph.py:60-118` | Graph has no time ordering: receipts dated after the last IE (e.g. ONE NATION → SLF 2024-12-19, post-election) count toward the visibility mix of money spent in October. | Filter edges with `last <= max(IE date)` per root, or state it in `method`. |
| C-16 | P2 nice | Entity resolution | `pipeline/gotham/util.py` `organization_id`/`individual_id` | Org ids are raw names: "RIPPLE LABS INC" vs "RIPPLE LABS INC." and "KOCH INDUSTRIES INC" vs "INC." are separate dark nodes; individuals key on `name|zip5` so "GRIFFIN, KENNETH C." splits from "GRIFFIN, KENNETH". | Normalize with the `ads_match.normalize` rules (strip punctuation/suffixes) before hashing. |
| C-17 | P2 nice | Copy | `pipeline/gotham/chains_flags.py:159-160` | Flag detail: "this is either a reporting error or a story." Editorial, not adjacency language. | "Not traversed; treat as a reporting anomaly until verified." |
| C-18 | P2 nice | Contracts | `contracts/src/schemas.ts:187-196` `TraceabilitySchema.inferable`, `ChainSchema.summary.inferable_share`, `TerminusReasonSchema.inferable` | Pipeline never emits `inferable` (D-34) but UI has a legend colour and the spenders table invents it (C-07). Speculative abstraction. | Keep the enum, drop the UI colour path until a 990 lookup exists. |
| C-19 | P2 nice | Architecture | `pipeline/gotham/chains.py:289,293` | `node_shares(w)` computed twice per walk (600-node memo each). `write_back` uses `path.write_text(json.dumps(...))` (`:266`) instead of `write_json`. | Compute once, reuse; use `write_json`. |
| C-20 | P2 nice | Architecture / config | `ingest.py:47-54`, `ads.py:48-50`, `chains_graph.py:22-25`, `chains_flags.py:28-33` | Tunables (`NEIGHBORHOOD_CAP`, `MAX_ADS`, `MAX_NODES`, `POPUP_AFTER`, `DARK_DEAD_END`, `SHELL_CLUSTER_MAX`) live as module constants across five files; `config.py` holds only some. | Move to `config.py`, one section per stage. |
| C-21 | P2 nice | Architecture | `pipeline/gotham/util.py:17,23` | `write_json(obj: Any)`, `read_json -> Any`; `chains.py` passes `flags: list[dict]`, `ledger: dict` untyped through 4 functions. | `TypedDict`s for ledger/entity or `dict[str, object]`. |
| C-22 | P2 nice | Provenance | `web/src/components/entity/entity-header.tsx:82`, `web/src/app/races/[raceId]/ads/page.tsx:18-21`, `web/src/components/ledger/candidate-panel.tsx:22` | Derived numbers rendered with no source: entity IE total (sum), ads page spend min/max (sum of buckets), candidate "other" (= receipts − ind − cmte; for Casey $11.6M, mostly JFC transfers). | Link IE total to `/independent-expenditures/?committee_id=`; label "other" as "transfers, loans, other". |
| C-23 | P2 nice | Contracts | `contracts/src/schemas.ts:304` | `contributor_count` optional and undocumented in `docs/CONTRACTS.md`; `ChainNode.amount_in` means "total receipts" for expanded nodes but "edge amount" for termini (D-32) — the diagram labels both the same way. | Document; or add `edge_amount` on the node. |
| C-24 | P2 nice | Demo data | `pipeline/gotham/config.py:69-72` | fec.gov elections page lists McCormick's filer as C00800623 ("View all" reports); config picks C00851980. Campaign totals are candidate-level so numbers match, but the entity page and ads match against C00851980 only. | Confirm with `ccl24`; if both are authorized, list both under the candidate. |
| C-25 | P2 nice | Demo data | `pipeline/gotham/ads.py`, `data/out/pa-sen-2024/ads.json` notes | 1,292 ads met the rule, 500 emitted, **0 unmatched** — the cap drops every "none" advertiser, so the "no committee attached" state described in `notes` never appears. Casey 119 vs McCormick 48 ads. | Reserve a slice (e.g. 50) for unmatched, or raise the cap. |
| C-26 | P2 nice | Demo data | `pipeline/gotham/dossier_curated.py` `MCCORMICK_SNAPSHOT` | Single Wayback capture 2024-11-01 hard-coded; excerpts verified against it but no `retrieved_at`/snapshot id surfaced in the UI. | Emit snapshot timestamp into `Evidence.source` label. |
| C-27 | P2 nice | Web | `web/src/app/races/[raceId]/entities/[entityId]/page.tsx` | `/entities/C00401224` (ActBlue) 404s while methodology names ActBlue as a pipe; only WinRed has an entity file. Ledger `via_conduit_total` has nowhere to click. | Emit conduit entities for both known conduits. |
| C-28 | P2 nice | Stories | `pipeline/gotham/chains_stories.py:77-87` | `seen` dedup means a spender that is both top-3 and darkest is dropped from `dark_dead_end`, so the "dark" list silently shifts to lower-ranked committees. `_largest_dark` sentence ("not an FEC-registered committee, so its own donors do not appear") is false for corporations (C-01). | Allow one entity per kind; guard sentence on C-01 fix. |

## Delete list

- `StorySchema`/`StoriesSchema`, `stories.json`, `chains_stories.py`, `getStories` — not rendered in V0, 18 unverified narratives that repeat C-01's false claim. Keep `verified` idea in DECISIONS; regenerate later.
- ~~`CandidateLedgerSchema.top_contributors`~~ — removed in 36ded3b.
- ~~`AdSchema.spend_range.currency`, `AdSchema.issue_ids`, `AdSchema.paid_for_by`~~ — removed in 36ded3b.
- ~~`spenderVisibility()` in `spenders-table.tsx`~~ — removed in 08e4fd3.
- `python-dotenv` — a single `load_dotenv` in `config.py:12`; `README` already tells users to export the keys. Optional.
- Mock chains/stories generator branches in `pipeline/scripts/make_mock_data.py` (782 lines) once real data is the default; or gate `make mock` behind an env flag so it can never overwrite `data/out`.

## Do not change

- Campaign totals come from the FEC candidate summary (unitemized included) while contributors/flows are itemized — that is why ledger totals match fec.gov to the cent (C-12 is a *labelling* problem, not a math one).
- Chain dollars conserve at every expanded node (verified over all 68 chains: 0 non-conserving nodes; shares sum to 1). `amount_in` = itemized receipts, not `webk24` totals — intentional (D-32).
- Sched A rows typed `PAC/COM/CCM/PTY` are dropped from the chain graph — they duplicate the transfers table (D-32).
- Super PAC → candidate/party edges are never traversed and are flagged `one_way_valve_violation` (4 entities). Correct.
- `22Z` refunds dropped; memo rows excluded at ingest; `15E` attributed to `OTHER_ID` with conduit kept as `CONDUIT_ID`; conduits' own Sched A omitted. All correct and tested.
- `SpendersTable` and `AdGallery` are the only client components — they sort/filter; leave them client.
- `validate.ts`/`validate.py` print `SKIP` for unknown JSON instead of failing — intentional; `contracts/jsonschema/*` is in sync with Zod (regenerated: no diff).
- `KEYSTONE RENEWAL PAC` chain `single_transfer_funded` absent while `WINSENATE` has it at 100% from SMP — correct per data.
- `DataStatusBanner` returns null for `"real"` — races.json PA is genuinely real now.

## `child/chains` (PR #6, merged into main as c28633e) — reviewed above

Conservation: holds (Do-not-change). Traceability definition: C-06 (depth_cap ⇒ disclosed; unchained ⇒ dark) and C-01 (ORG ⇒ dark)
make the 64.2% both over- and under-stated in ways that don't cancel. Flag logic: C-03, C-04, C-09, C-17. Story ranking: C-28;
stories are unrendered and `verified:false` — keep them out of the demo.

## Review 2

Reviewed at b66aa5d (`main`) after PR #11 and #12. Checks run clean: `contracts` typecheck+validate, `pipeline` lint/test/validate,
`web` lint/typecheck/build (2,147 static pages, 621 MB `.next`), dev server sweep over `/`, `/methodology`, ledger, `/stories`, `/ads`,
entity, chain, candidate and donor routes (all 200 except the two 404s below). All `data/out` files are `data_status: "real"` (2,141 files).
`FEC_API_KEY` was **not** present in this session's environment, so OpenFEC cross-checks ran on `DEMO_KEY` and hit rate limits; C-29's
dollar figures are computed from the repo's own `independent_expenditures.parquet`, which is sufficient to prove the double count.

**Verdict: demo it, but pull the two P0 claims off screen first.** The money model itself is sound — memo rows excluded, `15E`
attributed to individuals with conduits as pipes, refunds dropped, conservation holds at every expanded node (re-verified: 0
mismatches over 86 chains), and no super PAC → candidate money edge exists anywhere (4 `one_way_valve_violation` flags, none
traversed). PR #11 delivers what it claims: chain HTML is down to 567 KB, `unwalked` is a real fourth bucket ($1,855,716, excluded
from the score), evidence URLs are pair-filtered, own-JFC mismatches are exempt. PR #12's donor view is the most careful thing in the
repo: targeting edges are a separate `kind`, dashed, chipped "targeting edge — no money to the candidate", and never summed into
`total_given` — a targeting edge is **never** drawn as money. The biggest risk is unchanged from round 1 and now measurable: the
name-only organization classifier calls **$13.1M of registered-committee money "dark"** (C-30), and Schedule E still double-counts
**$2.28M across 42 re-reported transactions** (C-29, a C-02 regression). Both are single-number claims a judge can check on fec.gov in
one minute, and both sit in the headline: `$63.87M dark`, `0.7211 traceability`, `$235.67M outside`.

### Round-1 "fixed" re-verification (C-01..C-13)

| ID | Verdict | Evidence |
| --- | --- | --- |
| C-01 | **partially fixed → P0 (C-30, C-31)** | `unknown`→dark and `organization_class` shipped, but `_NONPROFIT` matches `PAC`/`COMMITTEE`/`AMERICAN`, so registered PACs (RESTORATION PAC, MOVEMENT VOTER PAC) are dark |
| C-02 | **not fixed → P0 (C-29)** | `is_notice=false&most_recent=true` does not dedupe rows re-reported in a later filing; 42 pairs sharing `tran_id`+payee+amount+dissemination date across two filings, $2,275,688 |
| C-03 | fixed | `POPUP_AFTER = 2024-10-17`, 6 popups, no negative-day text |
| C-04 | fixed (residual P2) | 0 shell flags on `P`/`A`/`J` committees; 107 remain, all `U`/`D`/`B`/leadership — the *name* `shell_cluster` is still overclaiming |
| C-05 | fixed | `?cycle=2024&election_full=false` on candidate URLs |
| C-06 | fixed (see C-37) | `unwalked_share`, `traceability.unwalked`, 4-segment bars; score excludes it |
| C-07 | fixed | `spenderVisibility()` gone; spenders table uses chain shares |
| C-08 | fixed | `contributor_name=<committee id>` pair filters on inflow/outflow URLs |
| C-09 | fixed | `is_own_jfc_pair` (designation+cand id+connected org+surname); Casey/McCormick committees carry no `transfer_mismatch` |
| C-10 | fixed | wire-format `view.ts` + client `visibleGraph`; largest chain page 567 KB (was ~3 MB) |
| C-11 | **not fixed → P1 (C-34)** | 3 ads link to `/entities/C30003529`, which does not exist |
| C-12 | fixed | "Total receipts (FEC summary)" vs "itemized" labels on entity/candidate panels |
| C-13 | fixed | `top_contributors`, `currency`, `issue_ids`, `paid_for_by` gone; JSON Schema mirror regenerates with no diff |

### New findings

| ID | Severity | Area | File:line | Finding | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| C-29 | **P0 blocker** | Money model | `pipeline/gotham/fec_ie.py:45-87`, `data/fec/pa-sen-2024/independent_expenditures.parquet` | `most_recent=true` filters *notices*, not rows re-reported in a later periodic filing: 42 pairs (84 rows) share committee, candidate, support/oppose, FEC `tran_id`, payee, amount **and** dissemination date across two `file_num`s, and both copies are summed. They are not byte-identical — 38 pairs also carry a revised `expenditure_date` and 34 a revised `purpose`, i.e. the same FEC-identified transaction re-reported in a later filing — **$2,275,688** double-counted (~1.0% of `outside_total`). Worst: AFP Action `SE24.31605` support McCormick and `SE24.31673` oppose Casey, $1,000,000 each, `file_num` 1841778 vs 1858497. Also inflates donor-view IE amounts. | Dedupe on `(committee_id, candidate_id, support_oppose, tran_id, payee_name, expenditure_amount, dissemination_date)`, keep the highest `file_num`. Do **not** dedupe on `tran_id` alone — 24 further groups share a `tran_id` across genuinely different payees/amounts, and collapsing those would wrongly drop ~$4.5M. |
| C-30 | **P0 blocker** | Provenance | `pipeline/gotham/orgs.py:34-39`, `web/src/components/chain/terminus.ts:4,15` | Rule 5 violation: 5 chain termini classified `dark` are FEC-registered committees present in the loaded committee table — RESTORATION PAC **$9.0M** (C00571588, super PAC), STRATEGIC VICTORY FUND IE PAC $2.46M, PEOPLE POWER PENNSYLVANIA $0.80M, MOVEMENT VOTER PAC $0.66M, MONTANA DEMOCRATIC PARTY $0.20M ≈ **$13.1M**. UI prints "Advocacy nonprofit — funders not on file" under a legend reading "dark wall (no disclosure)" over money whose donors *are* published (browser-verified on `/chains/C00530766`, where a **green disclosed RESTORATION PAC committee node coexists with the red dark RESTORATION PAC org node in the same graph**). | Before classifying an ORG name, exact/normalized-match it against `committees.parquet`; if it hits, emit a committee node (or `unwalked`), never `dark`. |
| C-31 | P1 should-fix | Data quality | `pipeline/gotham/orgs.py:37-38` | `_NONPROFIT` matches on any one of `AMERICANS?\|AMERICA`, `COMMITTEE`, `PAC`, `CHAMBER`, `ACTION`, `FUND`, `VICTORY`, …, and it is tested before `_LLC`/`_BUSINESS`, so `REPUBLICAN STATE LEADERSHIP COMMITTEE` (a 527 filing IRS 8872), `STAND TOGETHER CHAMBER OF COMMERCE` and `RESTORATION PAC` all return `nonprofit`→dark (verified by calling `classify_organization`). A single generic token decides the disclosure claim shown to the user. | Require a nonprofit *suffix/marker* (`501(C)`, `ACTION FUND`, `FOUNDATION`) and run `_LLC`/`_BUSINESS` before the generic-token pass. |
| C-32 | P1 should-fix | Provenance | `pipeline/gotham/donors.py:126,273`, `web/src/app/races/[raceId]/donors/[donorId]/page.tsx` | `allocation_note` is emitted only when `via_intermediary`. For a donor that gave **directly** to the spender there is no note, yet the page — headed "Where {donor}'s money went" — puts the spender's entire IE total under it: KOCH INDUSTRIES INC. gave $27,000,000 and the tree shows "supported with $13,610,480 in IEs"; same for STAND TOGETHER CHAMBER OF COMMERCE. The Method footer does say "once pooled, a donor's money is fungible, so no allocation is made past the first hop" — but the amber `allocation_note` callout is absent exactly where the tree is most allocation-like (browser-verified). | Emit `ALLOCATION_NOTE` whenever any depth ≥ 2 node or any targeting edge is rendered, not just for intermediaries. |
| C-33 | P1 should-fix | Provenance | `pipeline/gotham/data/ad_verifications.json`, `web/src/components/chain/seen-ads-strip.tsx:24`, `web/src/components/ads/ad-card.tsx` | Copy claims a disclaimer that does not exist in the data: "Paid for by this committee; the link was checked by a person" and "Verified paid-for-by → chain", while `ads.json.notes` states Google publishes **no US declared paid-for-by** and `paid_for_by` was deleted (D-44). The 5 verifications match advertiser *legal name* → FEC committee, which is weaker than a disclaimer. | Reword to "Advertiser name matched to this committee by hand" and cite the matched FEC record only. |
| C-34 | P1 should-fix | Web | `web/src/components/ads/ad-card.tsx:56-63`, `data/out/pa-sen-2024/ads.json` | The Sponsor link renders whenever `matched_entity_id` is set; 3 ads point at `C30003529`, which has no entity file — `/races/pa-sen-2024/entities/C30003529` returns **404** in dev and is absent from the build manifest. C-11's fix only gated the *chain* link. | Gate both links on membership in `listEntityIds(raceId)`. |
| C-35 | P1 should-fix | Provenance | `web/src/components/entity/entity-header.tsx`, `pipeline/gotham/ledger.py` (`entity_totals`) | Entity "Independent expenditures" uses the FEC summary `IND_EXP` from `webk24` (all races in the 2024 cycle) while the table below it lists this race only: WINSENATE shows **$311.3M** above a $63.0M race table, with no `source_url` on the header figure. A judge reads it as PA spending. | Label "all races (FEC summary)" and link the committee's fec.gov Schedule E page. |
| C-36 | P1 should-fix | Provenance | `pipeline/gotham/ledger.py:_top_counterparties` | Aggregated flow rows show one date and one transaction type for many transactions: WINSENATE's inflow renders "$312,850,000 · 2024-11-07 · 18G" for 100+ transfers, and `source_url` resolves to a filtered list, not that row. Nothing says the row is an aggregate. | Add `count` + `first_dt` to the flow contract and render "n transfers, date range". |
| C-37 | P2 nice | Money model | `pipeline/gotham/chains_graph.py`, `web/src/components/chain/view.ts:12` | D-41 added the `unwalked` bucket for nodes but not for edges: 832 edges terminating at `depth_cap` nodes still carry `visibility: "disclosed"`, so the diagram draws a green ribbon into a grey "not walked" box. Only node/summary shares know about `unwalked`. | Add `unwalked` to the edge visibility enum (additive) or colour ribbons from the target node's bucket. |
| C-38 | P2 nice | Design (DESIGN.md) | `docs/DESIGN.md:312-366` | Plan predates what shipped: step 11 (chain top-N rendering) is PR #11's `visibleGraph`, §4's component inventory has no donor tree or stories card (PR #12), it proposes issue chips on ad cards after `issue_ids` was deleted (D-44), and §3.3 assigns one grey token to both `unwalked` and targeting edges — the two things most worth keeping distinct. Steps 13–14 (shadcn/Radix, dark mode) add dependencies for two client components. | Re-baseline against `main`; keep steps 1–5 (tokens, fonts, tabular numerals, chips, source links); drop 13–14. |
| C-39 | P2 nice | Design (DESIGN.md) | `docs/DESIGN.md:18,26` | "Every number has a link" and "mobile does not break" are stated as *current* properties; C-35/C-36 and the horizontally-scrolling flow tables contradict both. A design doc that mis-states the baseline will plan the wrong work. | Replace the "already correct" claims with the audit result. |
| C-40 | P2 nice | Contracts | `pipeline/gotham/ads_verify.py`, `contracts/src/schemas.ts` (`AdVerification`) | `note` is parsed from `ad_verifications.json` and never emitted or rendered, so the human caveat ("advertiser legal name matches committee name; Google shows no disclaimer") exists only in the repo. Also dead: `StorySchema.kind:"ad_to_chain"` is never generated and `Story.ad_ids` is `[]` in all 17 stories. | Emit `note` into `ads.json` and render it in the ad card; delete the unused kind/field. |
| C-41 | P2 nice | Architecture | `web/src/lib/format.ts:24`, `pipeline/gotham/donors.py` (`donor_key`) | The donor-key slug is implemented twice (TS regex mirroring a Python one, per the comment). A change on either side silently 404s the 50 donor pages — already visible in that `KOCH INDUSTRIES INC.` becomes `org-KOCH_INDUSTRIES_INC-`. | Emit `donor_key` on the chain node and have the web layer read it. |
| C-42 | P2 nice | Contracts | `contracts/src/schemas.ts` (`DonorNodeSchema.amount`) | One field carries two meanings by depth ("money received from the parent (depth 1-2); IE dollars aimed at the candidate (depth 3)"). The tree only stays honest because `DonorTree` branches on `via.kind`; any other consumer will sum them. | Add `ie_amount` and keep `amount` money-only. |
| C-43 | P2 nice | Demo data | `data/out/pa-sen-2024/donors/*` | Entity resolution splits one donor across pages: "BLOOMBERG, MICHAEL" ($4.5M) and "BLOOMBERG, MICHAEL R." ($13.0M) occupy two of the 50 top-donor slots (C-16 residual). Donor pages are also reachable only from chain node names — no index. | Normalise middle initials in `donor_key`; add a top-donors list to the ledger page. |
| C-44 | P2 nice | Docs drift | `docs/SATURDAY.md:38-40` | Ad counts disagree with the data they describe: SATURDAY says "1,292 PA-relevant … 26 video posters", `ads.json.notes` says 1,849 matched the rule and 29 posters. Stories row says "17 … all `verified: false`" while 5 ads (not stories) are now hand-verified. | Regenerate the table from `notes` fields at handoff time. |

### Delete list

- `AdVerification.note` **or** its silent drop (C-40) — pick one; a hand-written caveat that never renders is worse than none.
- `StorySchema.kind:"ad_to_chain"` and `Story.ad_ids` — never populated (C-40).
- `spenders-table.tsx:219` `unwalked: 1` sentinel — a share bar built from a literal; use the chain summary or omit the bar.
- `docs/DESIGN.md` steps 13–14 (shadcn/Radix, dark mode) — dependencies for two client components (C-38).
- Duplicate `donorKey` in `web/src/lib/format.ts` (C-41).
- Still open from round 1: mock-data generator branches, `python-dotenv`, `/entities/C00401224` (ActBlue) still 404s (C-27).

### Do not change

- Targeting edges in the donor view: dashed border, `⇢`, "opposed/supported with $X in IEs", explicit "no money to the candidate"
  chip, excluded from `total_given`. This is the correct rendering; C-32 is about the *missing note*, not about this.
- `total_in_chains` double-counts a donor appearing in several chains — documented, and it is not summed against `total_given`.
- Candidate nodes in the donor walk start at `amount = 0.0` and receive only IE dollars. Intentional (D-47).
- `unwalked` is excluded from the traceability numerator *and* does not lower it — correct; it is an unknown, not a dark dollar.
- `traceability.method` already discloses "classified by name; no IRS lookup". Keep that sentence when fixing C-30/C-31.
- Chain conservation, valve flags, memo/refund/`15E`/conduit handling, FEC-summary-vs-itemized labelling: all re-verified correct.
- `DataStatusBanner` returning null for `"real"`, and `validate.*` printing `SKIP`: intentional.
- fec.gov spot-checks that match: Casey receipts $58,147,345.34 (exact), McCormick $35,970,836.83 (exact), SLF oppose-Casey
  $52,791,239.86 vs $52,799,239.86 (−$8,000, amendment lag). Do not "fix" these.

## Round 3 — Block 2

Reviewed at 4a3e81e (`devin/1788637846-campaign-commons-rename`, top of the #4←#7←#6←#10←#9←#8 stack; the tree is the Block 2
integration plus the Campaign Commons rename). Checks run clean: `contracts` typecheck+validate; `pipeline` lint, 159 tests,
validate (2,455 `data/out` + 5 `data/hand` ok); `web` lint, `tsc`, build (2,459 pages, 1m13s). Production server sweep: ledger,
ads wall (dark-share sort, issue filter), entities `C00865444`/`C00571703` (both "Where the money went" and "Ads this committee
ran"), vendor `V-waterfront-strategies`, donor `ind-EYCHANER_FRED-60614` → its committees' ads, chain `C00865444` (vendor / ad /
candidate / donor node panels, hide/restore, fold), header search (⌘K, arrow keys, Enter). Reconciliation scripts: Σ vendors
$233,396,761.46 = Σ IE rows = `ledger.traceability.outside_total`; per-spender vendor rows = that spender's IE rows for all 98
entities with IEs; `out_total` = Σ root→vendor money edges = the root's IE total for all 86 chains; every candidate node's
`amount_in` = Σ targeting edges into it. 180 search hrefs (30 × 6 kinds) all resolve to built pages. IDs continue from round 2 (C-45…).

**Verdict: demo the chain, with the diagram's ad column explained out loud.** The money model holds on the spending side: no
placement or targeting edge is summed into `out_total`, ribbons are money-only (`layout.ts:137`), every non-money amount is
parenthesised and captioned "no dollars move on this edge", the candidate panel says "None of that money goes to the candidate",
and the donor page keeps "pooled total, not this donor's share" on every deep hop. Every derived relationship in the data carries a
`Basis`, and the chain panel, ads wall, entity ads section and ledger issue cards all render label + rule + sources. The single
biggest risk is a **surface that lies by omission**: the vendor page — the natural place a judge clicks from the chain's vendor node
— renders none of the 74 vendors' `ads[]`, and its method footer says vendor↔ad links "are empty until a human verifies one" while
the same vendor has 96 adjacent/inferred links drawn in the chain one click away (C-45). Second: the chain diagram sizes ad nodes on
the same dollar scale as Schedule E payments (C-46), which is the one place the "separate currency" rule is broken visually.

### Findings

| ID | Sev | Area | File:line | Finding | Suggested fix (≤2 lines) |
|---|---|---|---|---|---|
| C-45 | P1 | Evidence basis | `web/src/app/races/[raceId]/vendors/[vendorId]/page.tsx:128`; `pipeline/campaign_commons/vendors.py:27,385` | `Vendor.ads[]` (74 vendor files, e.g. Waterfront 74 rows, all with `basis`) is never rendered; the only reference is the `length === 0` fallback "No ad-library creatives have been linked to this vendor's buys yet." The page's method footer, generated by `vendors.py:385`, reads "so vendor ↔ ad links are empty until a human verifies one" — false since `ads_enrich` fills them (1,090 links). Chain → vendor node → vendor page therefore shows fewer receipts than the graph. | Add an "Ads in this vendor's windows" card reusing `ad-card.tsx` `VendorLines` (label · rule · sources); have `ads_enrich` rewrite `Vendor.method` (or drop the sentence from `vendors.py`). → fixed in c494679 (`VendorAds` card: thumbs, sponsor, basis label/meaning/rule, sources; `?vendor=` gallery filter; `vendors.py` method reworded) |
| C-46 | P1 | Money vs placement | `web/src/components/chain/layout.ts:84-99`; `pipeline/campaign_commons/chains_out.py:264,304` | One `scale` for every column: `heightOf(n) = n.amount_in * scale`, and the ad column's total is `Σ midpoint`. A $550k Google midpoint ad is drawn as tall as a $550k Schedule E payment, and `agg:ads@…` ("64 more ads", `amount_in` $2,835,000) is a summed midpoint drawn in dollar height. Copy says "two different measures … never added together" (`issues.py`, ledger card); the picture adds them. | Give `out`-side `ad`/`aggregate` nodes a fixed height (or scale by `impressions` midpoint) and drop `amount_in` from the ad-column scale; keep the `$` only in the panel text. → fixed in c494679 (out-side `ad`/`aggregate` nodes fixed-height in `layout.ts`; `$` only in panel text) |
| C-47 | P1 | Idempotence | `pipeline/campaign_commons/ads_enrich.py:304-309` | `ad.pop("issues", None)` then re-assign moves `issues` after `vendor_links` on the second run; run 1 ≠ run 2 (1,226-line reorder of `ads.json`, 0 semantic diffs), run 2 = run 3. The committed `ads.json` is a run-1 file, so `make ads-enrich` once dirties `git status`. | Build the enrichment block in a fixed key order (`shares`, `issues`, `vendor_links`) and assign without `pop`; or `write_json(..., sort_keys=True)` for this stage. → fixed in c494679 (keys rebuilt in fixed order; test compares `json.dumps` with key order) |
| C-48 | P2 | Idempotence | `pipeline/campaign_commons/issues.py:405`; `search.py:275`; `vendors.py:431,460,487` | `generated_at = now_iso()` on every run; `issues.json`, `search.json` and all 311 vendor files churn with no content change. `ads_enrich` already does this right (touches `generated_at` only when content changed). | Read the existing file, compare with `generated_at` masked, and keep the old stamp when equal (same pattern as `ads_enrich.py:6`). → fixed in c494679 (`util.keep_generated_at` used by `write_json` and search's compact writer; tests in `test_util.py`) |
| C-49 | P2 | Stage order | `pipeline/campaign_commons/vendors.py:490`; `pipeline/Makefile:47` | `vendors` writes `"ads": []` unconditionally, so `make vendors` after `make ads-enrich` wipes the 74 reverse links until `ads-enrich` re-runs. Two stages write `vendors/<id>.json`; D-65's single-writer rule was applied to `ads.json` only. | Have `vendors` preserve an existing file's `ads[]`, or move the reverse index into a file `ads_enrich` owns (`vendors/<id>.ads.json`). → fixed in c494679 (`vendors` preserves existing `ads[]`; `ads_enrich` also prunes stale rows — this PR) |
| C-50 | P2 | Money model / crash | `pipeline/campaign_commons/issues.py:261`; `chains_out.py:43-46`; `contracts/src/schemas.ts:563` | `float(spend["max"])` will `TypeError` on the schema-allowed `max: null` (Google's open top bucket; 4 `impressions_range.max` are already null). `chains_out.midpoint` treats null as `lo`, `issues.spend_midpoint` as `(min+max)/2` — two midpoint conventions for one currency. | One `midpoint(range)` in `util.py` with an explicit null rule; `issues.py` uses it and records `open_ended` count in `coverage`. → fixed in c494679 (`util.range_midpoint`, open top → floor; `issues` coverage `open_ended`) |
| C-51 | P2 | Evidence basis | `pipeline/campaign_commons/ads_enrich.py:196-204`; `web/src/components/ads/ad-card.tsx:79` | Adjacent links pair a Google creative with *any* medium: the NRA ad card lists "HBP MARKETING LLC · mail · adjacent", "I360 LLC · phones · adjacent", "NRA-ILA · other · adjacent". A mail or phone buy cannot have placed a Google ad; the rule text is honest but the card reads as a vendor list for the ad. | Restrict `adjacent` to `digital`/`production`/`other` media, or render non-digital adjacents collapsed under "N same-window buys in other media". → fixed in this PR (`ADJACENT_MEDIA = {digital, production, other}`; adjacent 975 → 497; verified/inferred never dropped) |
| C-52 | P2 | Vendor normalisation | `pipeline/campaign_commons/vendors.py:52-84` | No `field` medium: OTG STRATEGIES $8.6M ("CANVASSING" ×24), SECOND STREET ASSOCIATES, THE OUTREACH TEAM, 79% of CampaignHQ all land in `other` ("no match"); `other` is the 4th-largest medium in the race. | Add `("field", ("CANVASS", "DOOR", "FIELD", "GOTV"))` before `other`; extend the `Medium` enum + `MEDIUM_LABELS`. → fixed in c494679 (`field` medium: contract, classifier, labels; `other` $14.2M → $0.3M) |
| C-53 | P2 | UI correctness | `web/src/app/races/[raceId]/vendors/[vendorId]/page.tsx:84` | `<MediumMix mix={[m]} max={1} />` per row → every chip is "100%" ("TV 100%", "production 100%") under a bar that says 97/3. | Pass the full `v.media_mix` once, or show `pct(m.amount / v.total)` in the row. → fixed in c494679 (`pct(m.amount / v.total)`) |
| C-54 | P2 | Evidence basis (labels) | `web/src/components/ads/ad-card.tsx:33-38` vs `web/src/components/chain/basis.ts` | Two basis label tables: ads wall says "adjacent" / "verified ✓", chain says "adjacent (dates overlap)" / "verified by hand"; `issue-cards.tsx:152` and `focus-chip.tsx:23` print the raw enum. Same relationship, three spellings. | Export `BASIS_LABELS`/`BASIS_MEANING` from `contracts` (or `web/src/lib/basis.ts`) and delete the local table. → fixed in c494679 (`web/src/lib/evidence.ts`; chain `basis.ts` re-exports) |
| C-55 | P2 | Docs drift | `docs/LOG.md:369`; `docs/CONTRACTS.md:18`; `docs/LOG.md:345`; `README.md:35` | LOG says stage order "ingest ledger vendors chains …"; `Makefile:47` is now `chains vendors` (D-70 mentions it, LOG does not). CONTRACTS says "`campaign_commons.ads` fills `ads[]`" — it is `ads_enrich`. LOG:345 "140 placement edges (135 inferred, 5 verified)" vs current 435 (138 inferred, 2 verified, 295 adjacent) — superseded by LOG:384 without saying so. README's `make` example omits every Block 2 stage. | One-line corrections; mark LOG:345 numbers "(superseded, see 2026-09-05 integration entry)". → fixed in this PR (README `make all`, LOG stage order + superseded counts, CONTRACTS `ads_enrich`) |
| C-56 | P2 | Setup / rename | `pipeline/pyproject.toml` (no `[tool.setuptools] packages`) | `pip install -e .` fails with "Multiple top-level packages discovered in a flat-layout: ['gotham', 'campaign_commons']" whenever a pre-rename `pipeline/gotham/__pycache__` survives a branch switch (it did here; `.gitignore` hides it). `make setup` is broken for every existing checkout until they `rm -rf pipeline/gotham`. | `packages = ["campaign_commons"]` in `pyproject.toml`; add the `rm -rf pipeline/gotham` note to the D-70 LOG entry. → fixed in c494679 (`[tool.setuptools] packages`; LOG gotcha) |
| C-57 | P2 | Copy accuracy | `web/src/components/chain/seen-ads-strip.tsx:17`; `web/src/components/entity/ads-section.tsx:77` | "Google shows the advertiser, not the paid-for-by line" is false at the source URL: the Transparency Center renders "Paid for by WinSenate · Super PAC" inside the creative (checked `CR15747662947024896001`). The true statement is that the *bulk CSV* has no paid-for-by field outside CA/NZ (already said in `ads.json.notes`). | Reword: "Google's bulk data carries no paid-for-by field for US advertisers; the match is on advertiser name." → fixed in c494679 ("Google's bulk data carries no paid-for-by field for US ads; matched on advertiser name") |
| C-58 | P2 | Wire size | `web/src/components/ads/ad-gallery.tsx` (client, all 500 ads); `web/src/components/search/search-box.tsx:13` | Ads page HTML 4.1 MB (500 ads × up to 6 vendor links × ~300-char `basis.rule` strings serialised into the client component); chain page 708 KB (`C00865444`), largest chain JSON 659 KB (`C00620971.json`); `search.json` 527 KB fetched on first ⌘K. Build 1m13s. | Render cards on the server and pass only filter keys to the client; template the adjacent `rule` (`window`, `medium`, `amount`) instead of storing prose per link. → open (ads page 4.0 → 3.3 MB from C-51 alone; server-rendered cards still to do) |
| C-59 | P2 | Slop | `pipeline/campaign_commons/vendors.py:325` / `chains_out.py:49` (`_date_range` ×2); `chains_out.py:43` / `issues.py:85` (midpoint ×2); `chains_out.py:82,100` | Duplicated date-range and midpoint helpers; `out`-side vendor/ad/candidate nodes carry `visibility: "disclosed"` — an FEC-donor-disclosure term on a Google creative and on a candidate. `view.ts:366,381` keys fold colour on `visibility`, so a future fold of the ad column would paint ads "disclosed". | Move `_date_range`/`midpoint` to `util.py`; make `visibility` nullable for `side: "out"` in `ChainNodeSchema`. → partly fixed in c494679 (midpoint); `_date_range` ×2 and out-side `visibility` still open |

### Delete list

- `pipeline/campaign_commons/vendors.py:27` docstring sentence "`Vendor.ads` stays empty until a hand-verified link exists" and the
  matching clause in the `method` string at `:385` (C-45).
- `web/src/components/ads/ad-card.tsx:33-38` `BASIS_LABEL` (C-54) — use the chain table.
- `docs/LOG.md:345` counts "105 targeting and 140 placement edges … (135 inferred, 5 verified)" — stale, or mark superseded (C-55).
- `data/hand/pa-sen-2024/vendor_ad_links.json` is `[]` and every `Vendor.ads[]` row is adjacent/inferred: the "verified" filter
  option on the ads wall ("Only verified vendor links") always returns 0 — hide the option until a row exists. → done in
  c494679 (basis options with zero matching ads are not rendered).

### Do not change

- `out_total`, per-spender vendor totals, candidate `amount_in`: all reconcile to the cent (0 mismatches / 86 chains, 98 entities).
- Placement/targeting edges drawn as constant-width spines, never ribbons (`layout.ts:137,160`); `(…)`-parenthesised amounts in the
  edge table; "IE dollars aimed at the candidate; none reach them" — correct, keep verbatim.
- Legend ↔ drawn edge: `BASIS_DASH` (`7 4` inferred, `2 4` adjacent, solid filed/verified) matches the legend copy and the SVG.
- Ledger issue cards: "Two layers, never summed" note, "ads ≈ $2.0M" with the midpoint caveat, `by_spender_focus` copy "spenders who
  describe themselves as …" — exactly D-66/D-67.
- Donor page pooled caveat on every hop past the first ("pooled total, not this donor's share") — survives into "Ads run by
  committees in this walk". Correct.
- Hand tags: 10 `ad_issues.json` rows and 8 `issue_focus.json` rows checked against their URLs. All tags match the creative
  (e.g. `CR15747662947024896001` "made millions on Wall Street, and outsourced PA jobs" → `labor_trade`); focus descriptions quote the
  org's own page (American Crossroads quote verified verbatim). 8 focus URLs return 403 to `curl` (bot walls: blackpac, lcv, afscme,
  climatepower, unitehere, americancrossroads) but load in a browser — not dead.
- Vendor aliases: no false merge found. `GENRRIS RUMALDO` ↔ `RUMALDO, GENRIS` (inferred) is the same payee; `U.S. POSTMASTER` → USPS
  and `WRNB-FM IHEART RADIO` → iHeartMedia are hand-verified. `NEW MAINSTREAM PRESS, INC.` vs `NEW MAINSTREAM MEDIA` and the Unite
  Here locals are kept separate — correct, different registrants.
- Medium on the top 20 by dollars is consistent with the ordered table as published in the rule ("MEDIA BUY"/"MEDIA PLACEMENT" → tv,
  "MAILER PRODUCTION" → production because `production` wins first match). Disclosed, so not a finding; C-52 is about the gap, not
  a misclassification.
- `chains_out.strip_out_side` removes every `side: "out"` node, their edges, `out_total` and `max_out_depth` before rebuilding —
  re-verified; the stage is semantically idempotent.
- `Makefile:47` `chains` before `vendors` (vendors asserts against `ledger.traceability.outside_total`, which `chains` writes) is
  the right order; only the docs lag (C-55).
- Ads wall "Matched to FEC committee 500 / 0 unmatched" is true of the emitted 500 (matched-first cap), not of the 1,849 selected;
  the notes say so.
