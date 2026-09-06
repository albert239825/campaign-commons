from campaign_commons import orgs_enrich


def test_guard_drops_quote_not_on_fetched_page() -> None:
    pages = [orgs_enrich.Page("https://example.org", "TRUIST is a bank.", "now")]
    assert (
        orgs_enrich.guard_classification(
            {"org_class": "business", "source_url": "https://example.org", "quote": "Truist is a trust"},
            pages,
        )
        is None
    )


def test_guard_drops_unknown_class() -> None:
    pages = [orgs_enrich.Page("https://example.org", "TRUIST is a bank.", "now")]
    assert (
        orgs_enrich.guard_classification(
            {"org_class": "unknown", "source_url": "https://example.org", "quote": "TRUIST is a bank."},
            pages,
        )
        is None
    )


def test_guard_keeps_verifiable_inferred_row() -> None:
    pages = [orgs_enrich.Page("https://example.org", "TRUIST is a bank.", "now")]
    kept = orgs_enrich.guard_classification(
        {"org_class": "business", "source_url": "https://example.org", "quote": "TRUIST is a bank."},
        pages,
    )
    assert kept == {
        "org_class": "business",
        "source_url": "https://example.org",
        "quote": "TRUIST is a bank.",
    }


def test_model_response_parser_reads_responses_api_message() -> None:
    payload = {
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": '{"org_class":"business","source_url":"https://example.org","quote":"TRUIST is a bank."}',
                    }
                ],
            }
        ]
    }
    assert orgs_enrich._parse_classification(payload)["org_class"] == "business"


def test_model_response_is_cached_without_a_second_http_call(tmp_path, monkeypatch) -> None:
    payload = {
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": '{"org_class":"business","source_url":"https://example.org","quote":"TRUIST is a bank."}',
                    }
                ],
            }
        ]
    }

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    calls = []
    monkeypatch.setattr(orgs_enrich, "RAW", tmp_path)
    monkeypatch.setattr(orgs_enrich, "XAI_API_KEY", "test")
    monkeypatch.setattr(orgs_enrich.requests, "post", lambda *args, **kwargs: calls.append(args) or Response())
    first = orgs_enrich.model_classification("race", "TRUIST", 100.0, "PAC", "C1", 2024)
    second = orgs_enrich.model_classification("race", "TRUIST", 100.0, "PAC", "C1", 2024)
    assert first == second
    assert len(calls) == 1
