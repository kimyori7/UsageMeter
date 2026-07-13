from __future__ import annotations

from pathlib import Path
from typing import Iterable, List, Tuple

from claudemeter.parser import UsageEvent, parse_line


def scan_directory(directory: Path) -> Iterable[UsageEvent]:
    if not directory.exists():
        return
    for path in directory.rglob("*.jsonl"):
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                event = parse_line(line)
                if event is not None:
                    yield event


def scan_file_from_offset(path: Path, offset: int) -> Tuple[List[UsageEvent], int]:
    events: List[UsageEvent] = []
    with path.open("rb") as fh:
        fh.seek(offset)
        data = fh.read()
        new_offset = offset + len(data)
    text = data.decode("utf-8", errors="replace")
    for line in text.splitlines():
        event = parse_line(line)
        if event is not None:
            events.append(event)
    return events, new_offset
