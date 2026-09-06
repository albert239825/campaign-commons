# FAQ and glossary

Questions people actually asked, with the answer we give. Numbers are PA Senate 2024, `main` as of 2026-09-05; the live
values are in `data/out/`. Decision IDs refer to [DECISIONS.md](DECISIONS.md).

## Glossary

| Term | Meaning here |
| --- | --- |
| **Campaign money** | Money reported by a candidate's own committee (Casey for PA, McCormick's). We show cycle-2024 receipts (Schedule A) and totals; not vendor-level spending. |
| **Outside money** | Independent expenditures (Schedule E) by committees other than the campaign — super PACs, party committees, nonprofits — for or against a candidate. $233.4M in this race. |
| **Schedule A / B / E** | FEC form schedules: A = money received, B = money spent, E = independent expenditures. |
| **Independent expenditure (IE)** | Spending on communications that support or oppose a candidate, without coordinating with or giving money to that candidate. The "outside money" in the ledger is entirely Schedule E. |
| **Money edge** | A contribution or committee-to-committee transfer. Dollars move along it. |
| **Targeting edge** | A spender → candidate relationship via IEs. No dollars move to the candidate. Never drawn as money. |
| **Race neighborhood** | The subset of FEC data we keep: the two campaign committees, the 98 committees with IEs about either candidate, everything reachable backward from them over transfers, and those committees' donors. ~2,000 entities, ~50MB Parquet, committed. |
| **Conduit** | ActBlue / WinRed: platforms that pass earmarked donations through. Treated as pipes, not sources (D-07). |
| **Chain** | A spender's receipts walked backward over transfers until every branch terminates (D-05). |
| **Terminus** | Where a chain branch stops: a named individual, a business/union treasury, a dark wall, a cycle, or `unwalked`. |
| **Visibility** | Per node/edge: `disclosed` (named source on file), `inferable` (reconstructable), `dark` (no donor-disclosure obligation: c4, LLC, trust), `unwalked` (a registered committee whose receipts we didn't traverse — outside the neighborhood or past the hop cap). |
| **Dark** | Not "unknown to us" — a layer whose donors the law doesn't require to be disclosed. `unwalked` is our limit; `dark` is the system's. |
| **Traceability** | Share of a spender's (or race's) outside dollars that resolve to a `disclosed` terminus. Preliminary (D-06). Race 0.73, Casey 0.76, McCormick 0.69. |
| **Structural flag** | A pattern in the filings worth a look: `popup` (committee formed for this race), `single_transfer_funded`, `dead_end_dark`, `one_way_valve`, `shell_cluster` (shared address + treasurer), `transfer_mismatch`. Flags describe structure, never intent. |
| **Story** | A computed ranking (top by amount, by dark share, popups) that a human picks from. `verified: false` until a person checks it (D-12). |
| **Dossier** | A candidate's policy record on the frozen 10-issue taxonomy: roll calls, sponsored bills, stated positions. Hand-written, every line linked, `needs_review` (D-09). |
| **Pooled totals** | On a donor's forward view, amounts past the donor's own gift are committee-to-committee totals, not that donor's share. Once pooled, money is fungible (D-50). |

## Data and scope

**Does "the race" include both the campaigns and the super PACs?** Yes. Campaign committees are in with their full
Schedule A receipts and totals; every outside spender is in with its Schedule E plus its own receipts walked backward.
Not in: what the campaigns spent on (vendor-level Schedule B), and committees unrelated to the race.

**Why filter to a neighborhood instead of loading all of FEC?** The 2024 bulk files are several GB and cover every federal
race. The neighborhood is ~50MB, reproducible with `make ingest`, and committed so nobody re-downloads bulk (D-08).
The cost: a committee two transfers upstream that isn't in the neighborhood shows as `unwalked`, not `dark`.

**Why do the same ad dollars appear several times in FEC data?** A single IE can be filed as a 24/48-hour notice, again on
the quarterly report, and again on an amendment. We collapse to one row per FEC-identified transaction and keep the copy
from the highest `file_num` (D-48). Naive summing was 10–20% high on some spenders.

**What's the ActBlue / WinRed problem?** Jane gives Casey $50 through ActBlue. FEC data can show that $50 three times: as
Jane's earmarked receipt on Casey's report, as an ActBlue memo line on Casey's report, and in ActBlue's own filings. We
credit Jane, drop the memo copies, exclude the conduit from the transfer graph, and expose `via_conduit_total` (D-07).

**Why do our race-wide outside totals differ slightly from fec.gov's?** Per-spender totals match OpenFEC's
`schedule_e/by_candidate`. Race-wide we show $233.4M over 98 committees vs FEC's $231.96M over 94: the gap is Form 5
filers and committees the by-candidate endpoint omits, not double counting.

**Is the ledger's "from individuals" the same as the entity page's?** No. The ledger uses the FEC summary (includes
unitemized small gifts); entity pages sum itemized Schedule A rows. Both are labelled (C-12).

**What does "sponsor verified by hand" on an ad mean?** A person matched the advertiser's legal name on Google Ads
Transparency to the FEC committee record. Google shows the advertiser, not the ad's literal "Paid for by" line, so we
don't claim to have verified that (D-46, D-52). Five ads are verified.

**Why are compact figures rounded ($233M, $20M)?** Display formatting; the exact value is in the JSON and on hover/detail.
Precision rule is an open question (Q-03).

## Architecture

**Why static JSON and not a database / API?** Runtime is lookups and rendering. Static means zero ops, an offline-safe
demo, and Vercel-native deploys; contract violations fail the build, not the stage (D-02, D-13).

**Should chains use a graph database?** Not yet. The walk is a graph traversal, but it runs in pandas over ~200K edges and
finishes all 86 chains in seconds, precomputed. A graph DB earns its keep for ad hoc runtime traversal, a graph too big
for memory, or multi-race entity resolution — none hold for one race. Edges are already typed (money vs targeting) with
visibility, so DuckDB → Kùzu/Neo4j later is a schema copy, not a rewrite. See Q-01.

**Why no LLM?** Cost, and verifiability on stage: every sentence in a dossier is hand-written from a linked record (D-09).

**Why contracts in TypeScript and JSON Schema both?** Web reads the Zod types; Python validates output against the
generated JSON Schema. One definition, two consumers, drift caught by `make validate` (D-03).

**Who owns what?** Pipeline writes `data/out/`, web reads it, `contracts/` is the boundary. See [CONTRACTS.md](CONTRACTS.md).

## Product

**Are you saying donors bought votes?** No, and the copy never will. Money and policy are shown side by side because a
citizen can't currently see both; the reader draws conclusions. Words like "bought", "influenced", "in exchange" are
banned from copy (repo README).

**Why is the challenger's dossier thinner?** McCormick has no voting record; his page uses stated positions from the
archived campaign site. The asymmetry is stated on the page rather than hidden.

**Where is the ads page?** `/races/<race_id>/ads`, in the race section nav (Ledger · Ads · Stories · dossiers) at the top
of every race page.
