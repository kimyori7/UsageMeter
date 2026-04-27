from datetime import datetime, timezone, timedelta

from claudemeter.aggregator import (
    Period,
    AggregateMetrics,
    aggregate,
    period_for,
)
from claudemeter.parser import UsageEvent
from claudemeter.pricing import PriceTable

PRICE_TABLE = PriceTable(
    {
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
)


def make_event(ts, session="S", model="claude-opus-4-7", inp=10, out=20, cc=0, cr=0, project="P"):
    return UsageEvent(
        timestamp=ts,
        session_id=session,
        project_path=project,
        model=model,
        input_tokens=inp,
        output_tokens=out,
        cache_creation_tokens=cc,
        cache_read_tokens=cr,
    )


def test_empty_events_produces_empty_tree():
    tree = aggregate([], price_table=PRICE_TABLE, now=datetime(2026, 4, 27, tzinfo=timezone.utc))
    assert tree.periods == {}


def test_single_event_appears_under_today_thisweek_thismonth_alltime_block():
    now = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)
    e = make_event(now, project="P1")
    tree = aggregate([e], price_table=PRICE_TABLE, now=now)
    expected_periods = {Period.CURRENT_BLOCK, Period.TODAY, Period.THIS_WEEK, Period.THIS_MONTH, Period.ALL_TIME}
    assert set(tree.periods.keys()) == expected_periods
    today = tree.periods[Period.TODAY]
    assert today.total_tokens == 30
    assert "P1" in today.sessions
    session = today.sessions["P1"]
    assert "claude-opus-4-7" in session.models


def test_yesterday_event_excluded_from_today_but_in_alltime():
    now = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)
    yesterday = now - timedelta(days=1)
    tree = aggregate([make_event(yesterday)], price_table=PRICE_TABLE, now=now)
    assert Period.TODAY not in tree.periods
    assert Period.ALL_TIME in tree.periods


def test_session_model_token_aggregation():
    now = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)
    events = [
        make_event(now, session="S1", model="claude-opus-4-7", inp=10, out=20),
        make_event(now, session="S1", model="claude-opus-4-7", inp=5, out=15),
        make_event(now, session="S1", model="claude-sonnet-4-6", inp=2, out=4),
        make_event(now, session="S2", model="claude-opus-4-7", inp=1, out=1),
    ]
    tree = aggregate(events, price_table=PRICE_TABLE, now=now)
    today = tree.periods[Period.TODAY]
    s1 = today.sessions["P"]  # all default project="P"
    # Wait — all four events share session S1/S2 but project_path "P". Let me re-examine.
    assert s1.total_tokens == 10 + 20 + 5 + 15 + 2 + 4 + 1 + 1


def test_period_for_today_boundary():
    from claudemeter.aggregator import _local_midnight
    now = datetime(2026, 4, 27, 12, 0, tzinfo=timezone.utc)
    local_midnight = _local_midnight(now)
    one_minute_before = local_midnight - timedelta(minutes=1)
    assert Period.TODAY in period_for(local_midnight, now=now)
    assert Period.TODAY not in period_for(one_minute_before, now=now)
