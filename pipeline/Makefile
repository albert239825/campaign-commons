RACE ?= pa-sen-2024
PY ?= python3

.PHONY: setup mock ingest ledger chains vendors ads ads-enrich enrich-transcripts enrich-ads enrich-review enrich-spenders issues search dossier validate all lint test

setup:            ## install pipeline deps (creates .venv)
	$(PY) -m venv .venv && . .venv/bin/activate && pip install -q -e ".[dev]"

mock:             ## regenerate MOCK data/out (frontend fixtures) — CLOBBERS real artifacts; use MOCK_OUT=dir to redirect
	$(PY) scripts/make_mock_data.py $(if $(MOCK_OUT),--out $(MOCK_OUT),)

ingest:           ## FEC bulk -> DuckDB -> data/fec/$(RACE)/*.parquet
	$(PY) -m campaign_commons.ingest $(RACE)

ledger:           ## parquet -> races.json, ledger.json, entities/*.json
	$(PY) -m campaign_commons.ledger $(RACE)

chains:           ## parquet -> chains/*.json, traceability, flags, stories.json
	$(PY) -m campaign_commons.chains $(RACE)

vendors:          ## Block 2: Schedule E payees -> vendors.json, vendors/*.json; patches entities/*.json (vendors, IE vendor_id/medium)
	$(PY) -m campaign_commons.vendors $(RACE)

ads:              ## Google political ads -> ads.json + cached creatives (downloads the bundle)
	$(PY) -m campaign_commons.ads $(RACE)

ads-enrich:       ## Block 2: patch ads.json in place with sponsor shares, hand issue tags, vendor links (+ vendors/*.json ads[]); no download
	$(PY) -m campaign_commons.ads_enrich $(RACE)

enrich-transcripts: ## Fetch YouTube captions locally; run from a residential IP because YouTube blocks cloud IPs
	$(PY) -m campaign_commons.enrich_transcripts $(RACE)

enrich-ads:       ## Classify cached ad transcripts with xAI (requires XAI_API_KEY)
	$(PY) -m campaign_commons.enrich_ads $(RACE)

enrich-review:    ## Print pending machine ad classifications for human review
	$(PY) -m campaign_commons.enrich_review $(RACE)

enrich-spenders:  ## Classify spender self-descriptions (requires XAI_API_KEY and FEC_API_KEY; get a free key at api.open.fec.gov/developers)
	$(PY) -m campaign_commons.enrich_spenders $(RACE)

issues:           ## Block 2: data/hand/$(RACE)/{issue_focus,ad_issues,ie_issues}.json -> issues.json; patches entities + ads
	$(PY) -m campaign_commons.issues $(RACE)

search:           ## Block 2: every page -> data/out/search.json (client-side index)
	$(PY) -m campaign_commons.search

dossier:          ## congress.gov -> dossiers/*.json
	$(PY) -m campaign_commons.dossier $(RACE)

chains-out:       ## Block 2: spending side of chains/*.json (root -> vendor -> ad -> candidate); runs after vendors/ads/dossier
	$(PY) -m campaign_commons.chains_out $(RACE)

validate:         ## validate data/out and data/hand against contracts/jsonschema
	$(PY) -m campaign_commons.validate

# Stage order: chains before vendors (vendors reconciles against ledger.traceability, which chains writes);
# ads-enrich and issues read vendors/ads; chains-out reads all of them; search last
all: ingest ledger chains vendors ads ads-enrich issues dossier chains-out search validate

lint:
	ruff check . && ruff format --check .

test:
	pytest -q
