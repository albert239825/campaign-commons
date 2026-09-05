RACE ?= pa-sen-2024
PY ?= python3

.PHONY: setup mock ingest ledger chains ads dossier trails validate all lint test

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

ads:              ## Google political ads -> ads.json + cached creatives
	$(PY) -m gotham.ads $(RACE)

dossier:          ## congress.gov -> dossiers/*.json
	$(PY) -m gotham.dossier $(RACE)

trails:           ## ledger + ads + chains + entities -> trails.json (Money Trails answers; no new downloads)
	$(PY) -m gotham.trails $(RACE)

validate:         ## validate data/out against contracts/jsonschema
	$(PY) -m gotham.validate

all: ingest ledger chains ads dossier trails validate

lint:
	ruff check . && ruff format --check .

test:
	pytest -q
