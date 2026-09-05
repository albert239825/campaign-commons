# Data contracts

Source of truth: [`contracts/src/schemas.ts`](../contracts/src/schemas.ts). This page is the map, not the territory.

## Files the web app reads (`data/out/`)

| Path | Schema | Written by | Read by |
| --- | --- | --- | --- |
| `races.json` | `RacesIndex` | `gotham.ledger` | `/` |
| `<race_id>/ledger.json` | `Ledger` | `gotham.ledger`, then `gotham.chains` fills `traceability` + spender `flags`/`traceability_score` | `/races/[raceId]` |
| `<race_id>/entities/<entity_id>.json` | `Entity` | `gotham.ledger`, then `gotham.chains` fills `flags` | `/races/[raceId]/entities/[entityId]` |
| `<race_id>/chains/<entity_id>.json` | `Chain` | `gotham.chains` | `/races/[raceId]/chains/[entityId]` |
| `<race_id>/ads.json` | `AdGallery` | `gotham.ads` | `/races/[raceId]/ads` |
| `<race_id>/dossiers/<candidate_id>.json` | `Dossier` | `gotham.dossier` | `/races/[raceId]/candidates/[candidateId]` |
| `<race_id>/stories.json` | `Stories` | `gotham.chains` | (demo prep; not rendered in V0) |

Validate: `cd contracts && npm run validate` or `cd pipeline && make validate` (same schemas, via `contracts/jsonschema/`).

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
