# Campaign Commons

Political money & policy provenance engine. DNHacks 2026 (Sept 5–6), Station DC. Team: Eric, Albert, Patrick.

> We don't tell you who to vote for. We show you the receipts.

Public records — FEC filings, congressional votes, ad libraries — fused into one navigable system. Every number links to
its government record. Adjacency, never causation.

## Layout

```
contracts/   Zod schemas + TS types for every JSON file the app reads. THE interface between pipeline and web.
pipeline/    Python: FEC bulk → DuckDB → filtered Parquet → static JSON. Offline only.
data/fec/    Filtered FEC Parquet per race (committed, small).
data/out/    JSON the web app reads (committed). races.json + <race_id>/{ledger,ads,stories}.json + entities/ chains/ dossiers/
web/         Next.js 15 app. Reads data/out at build time. No backend, no runtime fetches.
docs/        README.md (index) · FAQ.md · LOG.md · ONTOLOGY.md · QUESTIONS.md (open) · DECISIONS.md (log) · PLAN.md · CONTRACTS.md · SATURDAY.md
```

## Run it

```bash
# web (works immediately against data/out)
cd web && npm install && npm run dev            # http://localhost:3000

# Money Trails graph mode (optional; D-82) — the ask box answers route-only without it
docker run -d --name cc-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/<password> neo4j:5
cd web && node --env-file=.env.local --import tsx scripts/load-graph.ts pa-sen-2024 --reset   # NEO4J_URI/USER/PASSWORD + XAI_API_KEY in web/.env.local

# contracts
cd contracts && npm install && npm run validate # validates data/out against schemas
npm run jsonschema                              # regenerate contracts/jsonschema/ after schema edits

# pipeline
cp .env.example .env                            # add FEC_API_KEY, CONGRESS_GOV_API_KEY
cd pipeline && make setup && . .venv/bin/activate
make mock                                       # regenerate mock fixtures
make all                                        # ingest ledger chains vendors ads ads-enrich issues dossier chains-out search validate (RACE=pa-sen-2024)
```

## Rules of the road

- Every visible number has a `source_url`. No exceptions.
- Money edges (contributions, transfers) and targeting edges (independent expenditures) are different things. Never draw
  super PAC → candidate as money.
- "Disclosed" ≠ "traceable". Super PACs disclose; dark = the hidden-donor layer (c4s, LLCs).
- No causal language anywhere in copy. "Adjacent to", "alongside", never "bought", "influenced".
- No LLM calls write the record layer. In the pipeline, LLM-derived data lives only in the labelled machine layer (D-82).
  At runtime a model may pick a route from the closed set (D-75) or narrate facts the server already fetched and sourced
  (D-83); it never authors a number or a page.
- `data_status: "mock"` files are placeholders; the pipeline overwrites them in place.
- Don't rewrite git history.
