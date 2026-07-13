# src/claudemeter/watcher.py
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable, Dict, List

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from claudemeter.log_scanner import scan_file_from_offset
from claudemeter.parser import UsageEvent

logger = logging.getLogger(__name__)

OnEvents = Callable[[List[UsageEvent]], None]


class LogWatcher(FileSystemEventHandler):
    def __init__(self, log_dir: Path, on_events: OnEvents) -> None:
        self.log_dir = log_dir
        self.on_events = on_events
        self.offsets: Dict[Path, int] = {}
        self._observer: Observer | None = None
        self._lock = threading.Lock()

    def initial_scan(self) -> List[UsageEvent]:
        events: List[UsageEvent] = []
        if not self.log_dir.exists():
            return events
        for path in self.log_dir.rglob("*.jsonl"):
            file_events, offset = scan_file_from_offset(path, 0)
            events.extend(file_events)
            self.offsets[path] = offset
        return events

    def start(self) -> None:
        if not self.log_dir.exists():
            logger.warning("Log dir %s does not exist; watcher idle.", self.log_dir)
            return
        self._observer = Observer()
        self._observer.schedule(self, str(self.log_dir), recursive=True)
        self._observer.start()

    def stop(self) -> None:
        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=2.0)
            self._observer = None

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix != ".jsonl":
            return
        self._process(path)

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix != ".jsonl":
            return
        self._process(path)

    def _process(self, path: Path) -> None:
        with self._lock:
            offset = self.offsets.get(path, 0)
            try:
                events, new_offset = scan_file_from_offset(path, offset)
            except FileNotFoundError:
                return
            self.offsets[path] = new_offset
        if events:
            self.on_events(events)
