RACE ?= pa-sen-2024
PY ?= python3

.PHONY: setup mock ingest ledger chains vendors ads issues search dossier validate all lint test

setup:            ## install pipeline deps (creates .venv)
	$(PY) -m venv .venv && . .venv/bin/activate && pip install -q -e ".[dev]"

mock:             ## regenerate MOCK data/out (frontend fixtures) — CLOBBERS real artifacts; use MOCK_OUT=dir to redirect
	$(PY) scripts/make_mock_data.py $(if $(MOCK_OUT),--out $(MOCK_OUT),)

ingest:           ## FEC bulk -> DuckDB -> data/fec/$(RACE)/*.parquet
	$(PY) -m gotham.ingest $(RACE)

ledger:           ## parquet -> races.json, ledger.json, entities/*.json
	$(PY) -m gotham.ledger $(RACE)

chains:           ## parquet -> chains/*.json, traceability, flags, stories.json
	$(PY) -m gotham.chains $(RACE)

vendors:          ## Block 2: Schedule E payees -> vendors.json, vendors/*.json; patches entities/*.json (vendors, IE vendor_id/medium)
	$(PY) -m gotham.vendors $(RACE)

ads:              ## Google political ads -> ads.json + cached creatives (Block 2: + sponsor shares, issue tags, vendor links)
	$(PY) -m gotham.ads $(RACE)

issues:           ## Block 2: data/hand/$(RACE)/{issue_focus,ad_issues,ie_issues}.json -> issues.json; patches entities + ads
	$(PY) -m gotham.issues $(RACE)

search:           ## Block 2: every page -> data/out/search.json (client-side index)
	$(PY) -m gotham.search

dossier:          ## congress.gov -> dossiers/*.json
	$(PY) -m gotham.dossier $(RACE)

validate:         ## validate data/out and data/hand against contracts/jsonschema
	$(PY) -m gotham.validate

# Block 2 children add their stage (vendors, issues, search) here when the module lands
all: ingest ledger chains ads dossier validate

lint:
	ruff check . && ruff format --check .

test:
	pytest -q
