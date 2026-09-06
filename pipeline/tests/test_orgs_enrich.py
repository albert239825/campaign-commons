from campaign_commons import orgs_enrich


def test_unknown_class_is_dropped() -> None:
    assert "unknown" not in orgs_enrich.ALLOWED_CLASSES


def test_valid_class_is_kept_without_fetch() -> None:
    model = {"org_class": "business", "source_url": "https://example.org/missing", "quote": "A model citation."}
    kept = model if model.get("org_class") in orgs_enrich.ALLOWED_CLASSES else None
    row = orgs_enrich.model_row({"name": "TRUIST", "amount": 123.456}, kept)
    assert row["source_url"] == "https://example.org/missing"
    assert row["quote"] == "A model citation."
    assert row["basis"] == "inferred"
    assert row["verified"] is False


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
