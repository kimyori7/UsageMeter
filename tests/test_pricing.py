import json
from pathlib import Path
from unittest.mock import patch

from claudemeter.pricing import PriceTable, compute_cost
from claudemeter.parser import UsageEvent
from datetime import datetime, timezone


PRICE_FIXTURE = {
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
}


def make_event(model="claude-opus-4-7", **kwargs):
    defaults = dict(
        timestamp=datetime(2026, 4, 27, tzinfo=timezone.utc),
        session_id="S",
        project_path="P",
        model=model,
        input_tokens=0,
        output_tokens=0,
        cache_creation_tokens=0,
        cache_read_tokens=0,
    )
    defaults.update(kwargs)
    return UsageEvent(**defaults)


def test_compute_cost_simple_input_output():
    table = PriceTable(PRICE_FIXTURE)
    event = make_event(input_tokens=1000, output_tokens=500)
    expected = 1000 * 0.000015 + 500 * 0.000075
    assert compute_cost(event, table) == expected


def test_compute_cost_with_cache():
    table = PriceTable(PRICE_FIXTURE)
    event = make_event(
        input_tokens=10,
        output_tokens=20,
        cache_creation_tokens=1000,
        cache_read_tokens=2000,
    )
    expected = (
        10 * 0.000015
        + 20 * 0.000075
        + 1000 * 0.00001875
        + 2000 * 0.0000015
    )
    assert compute_cost(event, table) == expected


def test_compute_cost_unknown_model_returns_zero():
    table = PriceTable(PRICE_FIXTURE)
    event = make_event(model="claude-foo-99", input_tokens=1000)
    assert compute_cost(event, table) == 0.0


def test_price_table_load_from_cache(tmp_path):
    cache = tmp_path / "pricing.json"
    cache.write_text(json.dumps(PRICE_FIXTURE), encoding="utf-8")
    table = PriceTable.load_from_cache(cache)
    assert table is not None
    assert "claude-opus-4-7" in table.entries


def test_price_table_load_missing_returns_none(tmp_path):
    assert PriceTable.load_from_cache(tmp_path / "missing.json") is None


def test_price_table_load_corrupt_returns_none(tmp_path):
    cache = tmp_path / "pricing.json"
    cache.write_text("not json", encoding="utf-8")
    assert PriceTable.load_from_cache(cache) is None


def test_price_table_save(tmp_path):
    cache = tmp_path / "pricing.json"
    table = PriceTable(PRICE_FIXTURE)
    table.save_to_cache(cache)
    assert cache.exists()
    loaded = PriceTable.load_from_cache(cache)
    assert loaded.entries == PRICE_FIXTURE
