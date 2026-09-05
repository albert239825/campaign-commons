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
