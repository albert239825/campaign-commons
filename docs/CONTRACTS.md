# Data contracts

Source of truth: [`contracts/src/schemas.ts`](../contracts/src/schemas.ts). This page is the map, not the territory.

## Files the web app reads (`data/out/`)

| Path | Schema | Written by | Read by |
| --- | --- | --- | --- |
| `races.json` | `RacesIndex` | `campaign_commons.ledger` | `/` |
| `<race_id>/ledger.json` | `Ledger` | `campaign_commons.ledger`, then `campaign_commons.chains` fills `traceability` + spender `flags`/`traceability_score` | `/races/[raceId]` |
| `<race_id>/entities/<entity_id>.json` | `Entity` | `campaign_commons.ledger`, then `campaign_commons.chains` fills `flags` | `/races/[raceId]/entities/[entityId]` |
| `<race_id>/chains/<entity_id>.json` | `Chain` | `campaign_commons.chains` | `/races/[raceId]/chains/[entityId]` |
| `<race_id>/ads.json` | `AdGallery` | `campaign_commons.ads` | `/races/[raceId]/ads` |
| `<race_id>/dossiers/<candidate_id>.json` | `Dossier` | `campaign_commons.dossier` | `/races/[raceId]/candidates/[candidateId]` |
| `<race_id>/stories.json` | `Stories` | `campaign_commons.chains` | `/races/[raceId]/stories`, ledger strip |
| `<race_id>/donors/<donor_key>.json` | `DonorView` | `campaign_commons.donors` | `/races/[raceId]/donors/[key]` |
| `<race_id>/vendors.json` | `VendorIndex` | `campaign_commons.vendors` (Block 2) | entity page, vendor pages |
| `<race_id>/vendors/<vendor_id>.json` | `Vendor` | `campaign_commons.vendors`; `campaign_commons.ads` fills `ads[]` | `/races/[raceId]/vendors/[vendorId]` |
| `<race_id>/issues.json` | `IssueSpending` | `campaign_commons.issues` (Block 2) | ledger issue cards |
| `search.json` | `SearchIndex` | `campaign_commons.search` (Block 2) | header search box (client) |

Block 2 also *patches* existing files in place: `campaign_commons.vendors` adds `vendors[]` and per-IE `vendor_id`/`medium` to
`entities/*.json`; `campaign_commons.issues` adds `issue_focus` to entities and `issues` (`{issue_ids, basis}`) to ads and IE rows; `campaign_commons.ads` adds
`sponsor_visibility_shares` and `vendor_links[]` to ads. All additive optional fields — V0 files stay valid.

## Hand-maintained inputs (`data/hand/<race_id>/`)

| File | Schema | Edited by | Consumed by |
| --- | --- | --- | --- |
| `issue_focus.json` | `HandIssueFocusFile` | issue-focus child, teammates | `campaign_commons.issues` → `Entity.issue_focus`, `issues.json.by_spender_focus` |
| `ad_issues.json` | `HandAdIssuesFile` | media-wall child, teammates | `campaign_commons.issues` → `Ad.issues`, `issues.json.by_ad_issue` |
| `ie_issues.json` | `HandIeIssuesFile` | issue-focus child | `campaign_commons.issues` → IE `issues`, `issues.json.by_ad_issue.ie_*` |
| `vendor_aliases.json` | `HandVendorAliasesFile` | vendors child | `campaign_commons.vendors` (folds after automatic normalisation) |
| `vendor_ad_links.json` | `HandVendorAdLinksFile` | anyone with a source | `campaign_commons.ads` → `Ad.vendor_links[]` with `basis: verified` |

Every file is `{race_id, method, rows[]}`; every row carries `source_url(s)` and `tagged_by`/`verified_by`. Empty `rows: []`
is valid. Never hand-edit `data/out`. `vendor_aliases.json` rows may carry an optional `tagged_at` (ISO date); it becomes the
vendor's `normalization.checked_at`, which a `verified` Basis requires (D-60).

## Evidence basis (Block 2)

`Basis {basis, rule, source_urls, checked_by, checked_at}` sits on every relationship or number that is not read straight off
a filed record: vendor normalisation, vendor→ad links, issue tags, out-side chain nodes/edges. `filed` = on a government
record · `verified` = a human found a source naming both sides · `inferred` = an explicit rule (stated in `rule`) ·
`adjacent` = co-occurrence (date window) only. `verified` is a discriminated variant: it requires ≥1 `source_urls` and
non-null `checked_by`/`checked_at`, so an unsupported verification claim fails validation. Issue tags always travel as
`issues: {issue_ids, basis}`; a `placement` chain edge (vendor → ad) requires `basis`; every out-side chain node (`vendor` /
`ad` / `candidate`) requires `basis`; `vendors.json.medium_basis` states the one rule by which every `medium` (IE rows,
vendors, `by_medium`) was classified from `purpose`, so per-row mediums stay small and the UI renders that rule once per
section. Focus kinds split by whether they *are* an issue: `single_issue` / `multi_issue` rows must name ≥1 `issue_ids` and
their `by_spender_focus` buckets carry a non-null `issue_id`; `general_partisan` / `candidate_aligned` / `business_trade` /
`labor` may have none. The UI must render `rule` wherever the relationship appears; chain edges style by basis (solid /
solid+check / dashed / dotted).

Validate: `cd contracts && npm run validate` or `cd pipeline && make validate` — both check `data/out` then `data/hand` by
default. Pass a directory to check one root; add `--hand` to validate a directory that is not literally named `hand`
(fixtures, temp copies) with the hand-file schemas. Same schemas, via `contracts/jsonschema/`.

## IDs

- `race_id`: `<state>-<office>-<cycle>` lowercase, e.g. `pa-sen-2024`.
- `candidate_id`: FEC candidate ID (`S6PA00217`).
- `entity_id`: FEC committee ID (`C00571703`) for committees. Synthetic for everything else:
  `ind:<NAME>|<ZIP5>` individuals, `org:<NAME>` non-committee organizations, `agg:other@<committee_id>` pruned remainder.
- `issue_id`: one of the ten in [`contracts/src/issues.ts`](../contracts/src/issues.ts). Frozen.

## Semantics that matter

- **Money edge vs targeting edge.** `Transfer` moves dollars from → to. `IndependentExpenditure` targets a candidate; no
  dollars reach them. Chains contain only money edges.
- **Visibility** is a property of an edge or a node's own funding: `disclosed` (FEC-filed), `inferable` (reconstructable from
  990s, lagged), `dark` (no disclosure obligation). Colors in `contracts/src/display.ts`.
- **Chain direction.** `depth 0` is the spender (sink). Edges point toward the root. Backward walk; see DECISIONS D-05.
- **`data_status`** on every top-level file: `mock` | `partial` | `real`. UI shows a banner unless `real`.
- **Adjacency only.** Every free-text field (`position`, `narrative`, `detail`, `method`) must be descriptive. No causal verbs.
- **Every number has a `source_url`.** If you can't source it, don't emit it.

## Changing a contract

1. Edit `contracts/src/schemas.ts`.
2. `npm run jsonschema` (regenerates `contracts/jsonschema/*.schema.json` for the Python side).
3. Update `pipeline/scripts/make_mock_data.py` so mocks still validate; `make mock && make validate`.
4. One line in `docs/DECISIONS.md`.
Additive, optional fields are cheap. Renames are not — coordinate.
