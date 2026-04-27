from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


@dataclass(frozen=True)
class UsageEvent:
    timestamp: datetime
    session_id: str
    project_path: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
        )


def _parse_timestamp(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_line(line: str) -> Optional[UsageEvent]:
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if obj.get("type") != "assistant":
        return None
    message = obj.get("message") or {}
    usage = message.get("usage")
    if not usage:
        return None
    timestamp_raw = obj.get("timestamp")
    if not timestamp_raw:
        return None
    try:
        timestamp = _parse_timestamp(timestamp_raw)
    except ValueError:
        return None
    return UsageEvent(
        timestamp=timestamp,
        session_id=obj.get("sessionId") or "unknown",
        project_path=obj.get("cwd") or "Unknown Project",
        model=message.get("model") or "unknown",
        input_tokens=int(usage.get("input_tokens", 0)),
        output_tokens=int(usage.get("output_tokens", 0)),
        cache_creation_tokens=int(usage.get("cache_creation_input_tokens", 0)),
        cache_read_tokens=int(usage.get("cache_read_input_tokens", 0)),
    )
