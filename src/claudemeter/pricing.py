from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

from claudemeter.parser import UsageEvent

logger = logging.getLogger(__name__)

LITELLM_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)

# Hard-coded fallback for offline first-run. Values mirror Claude's published pricing.
FALLBACK_PRICES: Dict[str, Dict[str, float]] = {
    "claude-opus-4-7": {
        "input_cost_per_token": 0.000015,
        "output_cost_per_token": 0.000075,
        "cache_creation_input_token_cost": 0.00001875,
        "cache_read_input_token_cost": 0.0000015,
    },
    "claude-sonnet-4-6": {
        "input_cost_per_token": 0.000003,
        "output_cost_per_token": 0.000015,
        "cache_creation_input_token_cost": 0.00000375,
        "cache_read_input_token_cost": 0.0000003,
    },
    "claude-haiku-4-5": {
        "input_cost_per_token": 0.0000008,
        "output_cost_per_token": 0.000004,
        "cache_creation_input_token_cost": 0.000001,
        "cache_read_input_token_cost": 0.00000008,
    },
}


@dataclass
class PriceTable:
    entries: Dict[str, Dict[str, float]]

    @classmethod
    def fallback(cls) -> "PriceTable":
        return cls(dict(FALLBACK_PRICES))

    @classmethod
    def load_from_cache(cls, path: Path) -> Optional["PriceTable"]:
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        if not isinstance(data, dict):
            return None
        return cls({k: v for k, v in data.items() if isinstance(v, dict)})

    def save_to_cache(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.entries), encoding="utf-8")

    @classmethod
    def fetch_from_litellm(cls, timeout: float = 10.0) -> Optional["PriceTable"]:
        import requests

        try:
            resp = requests.get(LITELLM_URL, timeout=timeout)
            resp.raise_for_status()
            full = resp.json()
        except (requests.RequestException, ValueError):
            logger.warning("Failed to fetch LiteLLM pricing; using fallback/cache.")
            return None
        claude_entries = {
            name: spec
            for name, spec in full.items()
            if isinstance(spec, dict) and name.startswith("claude-")
        }
        return cls(claude_entries)


def compute_cost(event: UsageEvent, table: PriceTable) -> float:
    spec = table.entries.get(event.model)
    if spec is None:
        return 0.0
    return (
        event.input_tokens * spec.get("input_cost_per_token", 0.0)
        + event.output_tokens * spec.get("output_cost_per_token", 0.0)
        + event.cache_creation_tokens
        * spec.get("cache_creation_input_token_cost", 0.0)
        + event.cache_read_tokens * spec.get("cache_read_input_token_cost", 0.0)
    )
