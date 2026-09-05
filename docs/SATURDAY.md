# Saturday handoff — what exists, what's real, what to check

_Written by the overnight master session (https://app.devin.ai/sessions/2196d5252a1a4a97ae23bf2b4e57a99b). Log at the bottom._

## TL;DR

V0 (money-depth) is on `main` and browser-tested: race table → PA 2024 ledger → 2,000 entity pages → funding chains to
termination for 86/98 outside spenders → preliminary traceability → structural flags → Google ad gallery → two hand-written,
fully-linked dossiers. Everything is precomputed JSON under `data/out/` validated against `contracts/`; the web app is
lookups + rendering (2,096 static pages). TX 2026 is a stub row. No LLM was used anywhere.

Headline numbers (PA Senate 2024, all from FEC, cycle 2023–24):

| | Casey | McCormick | Race |
| --- | --- | --- | --- |
| Campaign receipts | $58.1M | $36.0M | $94.1M |
| Outside spending about the candidate (support + oppose) | $127.2M | $108.5M | $235.7M (98 spenders) |
| Traceability (preliminary) | 0.749 | 0.689 | 0.721 |

Top outside spenders: WINSENATE $63.0M (traceability 0.64, 2.6% not walked; 100% funded by SMP; `dead_end_dark`), Senate Leadership Fund
$52.8M (0.79), Keystone Renewal PAC $48.2M (0.85), Americans for Prosperity Action $21.7M (0.65, `dead_end_dark`), DSCC $10.5M
(0.99). Campaign totals and the SLF / WINSENATE IE totals match fec.gov to the cent / within amendments.

## How to run

See `README.md`. Fastest path to the demo: `cd web && npm install && npm run dev`. Full regeneration:
`cd pipeline && make setup ingest ledger chains ads dossier validate` (needs `FEC_API_KEY`, `CONGRESS_GOV_API_KEY`; ingest
downloads ~3GB of FEC bulk once and caches it, then re-pulls Schedule E from the OpenFEC API).

## What is real vs. stub

| Surface | File(s) | Status | Notes |
| --- | --- | --- | --- |
| Race table | `data/out/races.json` | **real** (PA) / stub (TX 2026) | Totals from FEC candidate summaries (`weball24`) + Schedule E about Casey/McCormick |
| Race ledger | `pa-sen-2024/ledger.json` | **real** | Casey $58.1M / McCormick $36.0M receipts; $235.7M outside, 98 spenders (OpenFEC `schedule_e`, periodic + `most_recent`, D-36). `via_conduit_total` = 15E earmarks. Per-candidate + per-spender traceability, flags |
| Entity pages | `pa-sen-2024/entities/*.json` | **real** | 2,000 committees: 98 spenders + 2 campaigns as seeds, then transfer neighborhood (D-29). Totals split individuals / committees / business-union treasuries / orgs with funding not on file (D-38). Form 5 filers fall back to itemized receipts |
| Chains | `pa-sen-2024/chains/*.json` | **real** | 86/98 spenders (12 are Form 5 / type-I filers with no receipts to walk). Backward over money edges only, to termination (individual, business/union, dark org, conduit, cycle, 8-hop cap), 1% pruning into `agg:other`, dollars conserve per node (D-32..D-35) |
| Stories | `pa-sen-2024/stories.json` | **real** | 17 ranked by amount / dark share / flags; all `verified: false`. Rendered as the ledger "Start here" strip + `/stories` (V1 below) |
| Ad gallery | `pa-sen-2024/ads.json` | **real** | Google political-ads bundle; 1,292 PA-relevant, 500 emitted (cap), all matched `auto`; `paid_for_by` null (Google has no US declared-name field); 26 video posters cached |
| Dossiers | `pa-sen-2024/dossiers/*.json` | **real** | Casey: 33 roll calls + 26 bills across 10/10 issues (senate.gov XML, congress.gov). McCormick: 10 stated positions from 2024-11-01 Wayback of davemccormickpa.com/issues. Every stance `needs_review: true`; asymmetry note rendered |
| Methodology page | `web/src/app/methodology` | **real** | States the traceability definition, name-only org classifier, no IRS lookup, adjacency-not-causation |

## Methodology caveats a judge could poke at

- **Visibility of organizations is a name heuristic** (`pipeline/gotham/orgs.py`, D-38): `union` and `business` are disclosed
  termini; `llc`, `nonprofit`, `unknown` are dark. `LEAGUE OF CONSERVATION VOTERS, INC.` → nonprofit (advocacy vocabulary beats
  corporate suffix); bare `COINBASE` → unknown → dark. No IRS/990 lookup yet, so `inferable` is never emitted (D-34).
- **`depth_cap` termini are a fourth "not walked" bucket** (C-06 fixed): committees outside the loaded neighborhood or past the
  hop/node cap are neither disclosed nor dark (`unwalked_share`, `traceability.unwalked`). Race-wide it is $1.86M (0.8%); the
  score dropped 0.729 → 0.721 accordingly. A dark layer behind an unwalked committee still would not show.
- Traceability is `preliminary: true` everywhere in data and copy.
- No time ordering in the graph: a December 2024 receipt counts toward the visibility mix of October spending (C-15).
- Chain pages ship the full SVG server-side: WINSENATE / CFFE PAC pages are 5–6MB HTML (C-10). Fine on localhost; prune
  client-side before Vercel.

## Needs human review in the morning

- [ ] All dossier stances (`needs_review: true`) — read each `position` against its linked evidence.
- [ ] Pick the demo story from `stories.json` (`verified: false` until a human checks the chain on fec.gov). Suggested:
      WINSENATE ← SMP (100% single-source, SMP itself 34% dark) or AFP Action (dead-ends at Americans for Prosperity c4).
- [ ] Ad → committee matches marked `auto` — promote to `verified` after eyeballing.
- [ ] `docs/CRITIQUE.md` (branch `critic/review-1`): P0s C-01..C-05 are fixed in PR #8; P1s below are open.

## Critic findings — status

Adversarial review of `main@c28633e` by a read-only child session: 28 findings, `docs/CRITIQUE.md`.

Fixed (PR #8): C-01 ORG⇒dark (org classifier), C-02 IE dedupe (OpenFEC API source), C-03 popup negative days,
C-04 shell_cluster on connected-org families, C-05 fec.gov links now `election_full=false`, C-14 this doc.

Fixed on `fix/critic-p1` (one commit each): C-10 chain page size (b051031), C-06 depth_cap ⇒ own `unwalked` bucket (ae2fd84),
C-12 "from individuals" labels (67ddc6c), C-07 spender row share bar (08e4fd3), C-09 `transfer_mismatch` on a campaign's
own JFC (78069cf), C-08 pair-filtered evidence URLs (f37d85f), C-13 dead contract fields (36ded3b).
Still open: C-11 ad chain-link gating, C-13's `Story*`/`stories.json` part, C-15..C-28 (P2).

## Validation (final, `e117b6f`)

`contracts` typecheck / jsonschema / validate → 2,092 ok, 0 failed · `pipeline` ruff clean, 43 tests, validate 2,092 ok ·
`web` lint / typecheck / build → 2,096 static pages. Browser run (testing agent, real data): 14 routes 200, no console
errors, no `NaN`/`undefined`/negative-day/causal-phrase matches; evidence on PR #8.

## Decisions

`docs/DECISIONS.md` (append-only, D-01..D-38 with reasoning). The ones that shape the numbers: D-29 neighborhood cap,
D-32 chain walk semantics, D-34 no `inferable` yet, D-36 Schedule E from API, D-38 org classifier.

## Cut lines (pre-agreed)

- Chains don't render → ledger + entities + traceability numbers only.
- Ad matching flaky → gallery stays unlinked.
- Personalization slips → demo complete artifacts, narrate the lens.

## V1 (branch `v1/ads-and-stories`) — what a human verified vs. what the pipeline generated

| Surface | Human-verified | Pipeline-generated |
| --- | --- | --- |
| Stories ("Start here" strip, `/stories`) | nothing yet — every card carries "Unverified — pipeline-generated"; set `verified: true` + `verified_by_url` in `stories.json` after checking a story against fec.gov to flip it to "Checked against fec.gov" | ranking, titles, narratives, headline numbers (templated from chain data, D-45) |
| Ad → chain links | 5 ads in `pipeline/gotham/data/ad_verifications.json` (WINSENATE, SLF, AFP Action, Keystone Renewal, DSCC): advertiser identity read on adstransparency.google.com, committee ID + PA-Sen Schedule E confirmed on fec.gov. Only these show "Verified paid-for-by → chain" and the "You may have seen this ad" strip on the chain page (D-46). Caveat: Google's ad page shows the advertiser's legal name / FEC ID, not a literal "Paid for by" line; AFP Action showed an EIN and was matched by name | the other 495 `matched_entity_id`s (name match, `match_confidence`), impressions/spend ranges, cached posters |
| Donor forward views (`donors/*.json`, `/donors/[key]`) | nothing — the walk is mechanical | donor ranking, forward tree, `allocation_note` (D-47). Money edges and IE targeting edges are separate; no money edge ever ends at a candidate |

Every number on these surfaces still links to an fec.gov or Google record; the verification adds a human reading on top, it does not replace the link.

## Next (V1/V2, on branches)

3–5 hand-verified ad→chain links; render stories; fusion links stance ↔ issue-adjacent money (needs donor industry codes);
issue picker; TX 2026 field; `inferable` via 990s; the open critic P1s.

## Log

- 07:1x UTC — Stage 0 (scaffold, contracts, mocks, stubs, docs) pushed to `main`. Five Stage 1 sessions started.
- 07:35 — Frontend A merged (PR #1): race table, ledger, entity page.
- 07:40 — Ads pipeline merged (PR #2). Fixed a footgun: `make test` used to regenerate mock data over real artifacts.
- 07:45 — Dossier pipeline merged (PR #4).
- 08:30 — Frontend B merged (PR #3): chain SVG flow, ad gallery, dossier page. FEC ingest still running.
- 08:55 — FEC ingest + ledger merged (PR #5). Fixed `top_contributors` showing committee IDs (pandas `iterrows` `.name` is the index, not the column). Stage 2 (chains) session started; critic session started in parallel.
- 09:30 — Stage 2 merged (PR #6, c28633e): real chains, traceability 0.642, flags, stories. Critic delivered `docs/CRITIQUE.md` (PR #7).
- 09:45–12:35 — PR #8: Schedule E → OpenFEC API (98 spenders, $235.7M), org classifier, popup/shell fixes, entity totals split, Form 5 fallback, copy. Traceability 0.729. Browser-tested; artifacts regenerated.
