from datetime import datetime, timedelta, timezone

from claudemeter.block_calculator import find_blocks, current_block, BLOCK_LENGTH
from claudemeter.parser import UsageEvent


def make_event(ts):
    return UsageEvent(
        timestamp=ts,
        session_id="S",
        project_path="P",
        model="claude-opus-4-7",
        input_tokens=1,
        output_tokens=1,
        cache_creation_tokens=0,
        cache_read_tokens=0,
    )


def test_no_events_no_blocks():
    assert find_blocks([]) == []


def test_single_event_creates_one_block():
    ts = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    blocks = find_blocks([make_event(ts)])
    assert len(blocks) == 1
    assert blocks[0].start == ts
    assert blocks[0].end == ts + BLOCK_LENGTH
    assert len(blocks[0].events) == 1


def test_events_within_5h_grouped_into_one_block():
    base = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    events = [
        make_event(base),
        make_event(base + timedelta(hours=2)),
        make_event(base + timedelta(hours=4, minutes=59)),
    ]
    blocks = find_blocks(events)
    assert len(blocks) == 1
    assert len(blocks[0].events) == 3


def test_events_across_5h_gap_create_two_blocks():
    base = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    events = [
        make_event(base),
        make_event(base + timedelta(hours=6)),
    ]
    blocks = find_blocks(events)
    assert len(blocks) == 2


def test_current_block_returns_latest_active():
    base = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    now = base + timedelta(hours=2)
    events = [make_event(base)]
    block = current_block(events, now=now)
    assert block is not None
    assert block.start == base


def test_current_block_returns_none_when_no_active_block():
    base = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    now = base + timedelta(hours=10)
    events = [make_event(base)]
    assert current_block(events, now=now) is None


def test_find_blocks_handles_unsorted_input():
    base = datetime(2026, 4, 27, 10, 0, tzinfo=timezone.utc)
    events = [
        make_event(base + timedelta(hours=2)),
        make_event(base),
        make_event(base + timedelta(hours=6)),
    ]
    blocks = find_blocks(events)
    assert len(blocks) == 2
    assert blocks[0].start == base
