"""Small injectable client for the xAI Responses API."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import requests

XAI_URL = "https://api.x.ai/v1/responses"
PRICES = {
    "grok-4.3": (1.25, 2.50),
    "grok-4.6": (2.00, 6.00),
}

Transport = Callable[[str, str, dict[str, str], dict[str, Any]], tuple[int, dict[str, Any]]]


class XaiClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.x.ai/v1",
        transport: Transport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.transport = transport

    def create_response(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        delays = (1, 2, 4, 8, 16)
        last_error: Exception | None = None
        for attempt, delay in enumerate(delays):
            try:
                if self.transport is not None:
                    status, body = self.transport("POST", f"{self.base_url}/responses", headers, payload)
                else:
                    response = requests.post(f"{self.base_url}/responses", headers=headers, json=payload, timeout=120)
                    status, body = response.status_code, response.json()
                if status == 429 or status >= 500:
                    raise _RetryableResponse(status, body)
                if status >= 400:
                    raise RuntimeError(f"xAI Responses API returned HTTP {status}: {body}")
                return body
            except _RetryableResponse as exc:
                last_error = exc
            except (requests.RequestException, ConnectionError, TimeoutError) as exc:
                last_error = exc
            if attempt < len(delays) - 1:
                time.sleep(delay)
        assert last_error is not None
        raise last_error


class _RetryableResponse(RuntimeError):
    def __init__(self, status: int, body: object) -> None:
        super().__init__(f"xAI Responses API returned retryable HTTP {status}: {body}")
        self.status = status
        self.body = body


def output_text(response: dict[str, Any]) -> str:
    pieces: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str):
                    pieces.append(text)
    return "".join(pieces)


def estimate_usd(model: str, usage: dict[str, Any] | None) -> float:
    input_price, output_price = PRICES.get(model, (0.0, 0.0))
    usage = usage or {}
    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    return (float(input_tokens) * input_price + float(output_tokens) * output_price) / 1_000_000


def response_cost_usd(model: str, response: dict[str, Any] | None) -> float:
    usage = response.get("usage", {}) if isinstance(response, dict) else {}
    if not isinstance(usage, dict):
        return 0.0
    ticks = usage.get("cost_in_usd_ticks")
    if ticks is not None:
        return float(ticks) / 10_000_000_000
    return estimate_usd(model, usage)
