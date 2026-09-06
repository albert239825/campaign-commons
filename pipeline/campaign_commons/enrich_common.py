"""Shared helpers for machine enrichment stages."""

from __future__ import annotations

import string


def _normalize(text: str) -> str:
    table = str.maketrans({char: " " for char in string.punctuation})
    return " ".join(text.lower().translate(table).split())


def is_normalized_substring(quote: str, text: str) -> bool:
    return bool(_normalize(quote)) and _normalize(quote) in _normalize(text)
