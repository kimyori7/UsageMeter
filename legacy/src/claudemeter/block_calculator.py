from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Sequence

from claudemeter.parser import UsageEvent

BLOCK_LENGTH = timedelta(hours=5)


@dataclass
class Block:
    start: datetime
    end: datetime
    events: List[UsageEvent] = field(default_factory=list)


def find_blocks(events: Sequence[UsageEvent]) -> List[Block]:
    if not events:
        return []
    sorted_events = sorted(events, key=lambda e: e.timestamp)
    blocks: List[Block] = []
    current: Optional[Block] = None
    for event in sorted_events:
        if current is None or event.timestamp >= current.end:
            current = Block(
                start=event.timestamp,
                end=event.timestamp + BLOCK_LENGTH,
                events=[event],
            )
            blocks.append(current)
        else:
            current.events.append(event)
    return blocks


def current_block(
    events: Sequence[UsageEvent], *, now: Optional[datetime] = None
) -> Optional[Block]:
    if now is None:
        now = datetime.now(timezone.utc)
    blocks = find_blocks(events)
    if not blocks:
        return None
    last = blocks[-1]
    if last.start <= now < last.end:
        return last
    return None
