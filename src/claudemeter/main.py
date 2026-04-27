from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import customtkinter as ctk

from claudemeter import APP_NAME
from claudemeter import autostart, paths
from claudemeter.aggregator import (
    Period,
    aggregate,
    AggregateTree,
)
from claudemeter.block_calculator import BLOCK_LENGTH, current_block
from claudemeter.config import Config
from claudemeter.format import format_dollars
from claudemeter.parser import UsageEvent
from claudemeter.pricing import PriceTable
from claudemeter.ui.main_window import MainWindow
from claudemeter.ui.settings import SettingsDialog
from claudemeter.ui.tray import Tray
from claudemeter.ui.widget import Widget
from claudemeter.watcher import LogWatcher

logger = logging.getLogger(__name__)


class App:
    def __init__(self, start_minimized: bool) -> None:
        self.config = Config.load(paths.config_path())
        self.start_minimized = start_minimized or self.config.start_minimized

        self.price_table = self._load_pricing()
        self.events: List[UsageEvent] = []
        self._events_lock = threading.Lock()
        self.tree: Optional[AggregateTree] = None
        self.widget: Optional[Widget] = None

        self.window = MainWindow(
            on_settings=self._open_settings,
            on_close_to_tray=lambda: None,
            config=self.config,
        )

        self.tray = Tray(
            icon_path=self._icon_path(),
            on_open=self._show_main,
            on_toggle_widget=self._toggle_widget,
            on_refresh=self._tick,
            on_settings=self._open_settings,
            on_open_ccusage=self._open_ccusage,
            on_quit=self._quit,
            widget_visible=lambda: self.widget is not None,
        )

        self.watcher = LogWatcher(paths.claude_log_dir(), on_events=self._on_new_events)

    def _icon_path(self) -> Path:
        if getattr(sys, "frozen", False):
            base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
        else:
            base = Path(__file__).resolve().parent.parent.parent
        return base / "assets" / "icon.ico"

    def _load_pricing(self) -> PriceTable:
        import time as _time
        cache_path = paths.pricing_cache_path()
        cached = PriceTable.load_from_cache(cache_path)
        cache_age_hours = float("inf")
        if cache_path.exists():
            cache_age_hours = (_time.time() - cache_path.stat().st_mtime) / 3600
        if cached is not None and cache_age_hours < 24:
            return cached
        # Cache stale or missing — try refresh in background, but use what we have for now.
        threading.Thread(target=self._refresh_pricing_async, daemon=True).start()
        return cached or PriceTable.fallback()

    def _refresh_pricing_async(self) -> None:
        fetched = PriceTable.fetch_from_litellm()
        if fetched is not None:
            fetched.save_to_cache(paths.pricing_cache_path())
            self.price_table = fetched

    def run(self) -> None:
        self.tray.start()
        if self.start_minimized:
            self.window.withdraw()
        if self.config.show_widget_on_start:
            self._show_widget()

        initial = self.watcher.initial_scan()
        with self._events_lock:
            self.events.extend(initial)
        self._rebuild_tree()
        self.watcher.start()

        self.window.after(self.config.live_refresh_seconds * 1000, self._tick)
        self.window.after(24 * 3600 * 1000, self._daily_pricing_refresh)
        self.window.mainloop()

    def _on_new_events(self, events: List[UsageEvent]) -> None:
        with self._events_lock:
            self.events.extend(events)

    def _rebuild_tree(self) -> None:
        now = datetime.now(timezone.utc)
        with self._events_lock:
            snapshot = list(self.events)
        self.tree = aggregate(snapshot, price_table=self.price_table, now=now)
        block = current_block(snapshot, now=now)
        progress = self._compute_block_progress(block, now)
        self.window.update_tree(self.tree, progress=progress)
        if self.widget is not None:
            self.widget.update_tree(self.tree, progress=progress)
        self._update_tooltip(block=block, now=now)

    @staticmethod
    def _compute_block_progress(block, now: datetime):
        if block is None:
            return None
        elapsed_ratio = (now - block.start) / BLOCK_LENGTH
        elapsed_ratio = max(0.0, min(1.0, elapsed_ratio))
        remaining = block.end - now
        remaining_secs = max(0, int(remaining.total_seconds()))
        h = remaining_secs // 3600
        m = (remaining_secs % 3600) // 60
        return (elapsed_ratio, f"{h}h{m}m 남음")

    def _update_tooltip(self, *, block=None, now: Optional[datetime] = None) -> None:
        if self.tree is None:
            self.tray.update_tooltip("ClaudeMeter")
            return
        if now is None:
            now = datetime.now(timezone.utc)
        today = self.tree.periods.get(Period.TODAY)
        parts: List[str] = []
        if block is not None:
            elapsed_ratio = (now - block.start) / BLOCK_LENGTH
            elapsed_ratio = max(0.0, min(1.0, elapsed_ratio))
            pct = int(elapsed_ratio * 100)
            remaining = block.end - now
            remaining_secs = max(0, int(remaining.total_seconds()))
            h = remaining_secs // 3600
            m = (remaining_secs % 3600) // 60
            parts.append(f"블록 {pct}%")
            parts.append(f"리셋까지 {h}h{m}m")
        if today is not None:
            parts.append(f"오늘 {format_dollars(today.cost)} 상당")
        self.tray.update_tooltip(" · ".join(parts) if parts else "ClaudeMeter")

    def _tick(self) -> None:
        self._rebuild_tree()
        self.window.after(self.config.live_refresh_seconds * 1000, self._tick)

    def _daily_pricing_refresh(self) -> None:
        threading.Thread(target=self._refresh_pricing_async, daemon=True).start()
        self.window.after(24 * 3600 * 1000, self._daily_pricing_refresh)

    def _show_main(self) -> None:
        self.window.show()

    def _toggle_widget(self) -> None:
        if self.widget is None:
            self._show_widget()
        else:
            self.widget.destroy()
            self.widget = None

    def _show_widget(self) -> None:
        if self.widget is not None:
            return
        self.widget = Widget(
            self.window,
            config=self.config,
            on_close=self._on_widget_closed,
            on_open_main=self._show_main,
            on_open_settings=self._open_settings,
            on_open_ccusage=self._open_ccusage,
            on_quit=self._quit,
        )
        if self.tree is not None:
            self.widget.update_tree(self.tree)

    def _on_widget_closed(self) -> None:
        self.widget = None

    def _open_settings(self) -> None:
        SettingsDialog(self.window, config=self.config, on_save=self._apply_config)

    def _apply_config(self, config: Config) -> None:
        config.save(paths.config_path())
        if config.auto_start:
            if not getattr(sys, "frozen", False):
                logger.warning("Autostart is only supported in frozen .exe builds; skipping.")
            else:
                try:
                    autostart.enable(sys.executable)
                except Exception as e:
                    logger.error("Failed to enable autostart: %s", e)
        else:
            autostart.disable()
        if self.widget is not None:
            self.widget.attributes("-topmost", config.widget_always_on_top)
            self.widget.attributes("-alpha", config.widget_opacity)

    def _open_ccusage(self) -> None:
        subprocess.Popen(
            ["cmd.exe", "/k", "npx", "ccusage", "daily"],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )

    def _quit(self) -> None:
        try:
            self.config.save(paths.config_path())
        except Exception as e:
            logger.error("Failed to save config on quit: %s", e)
        try:
            self.watcher.stop()
        except Exception as e:
            logger.error("Failed to stop watcher: %s", e)
        try:
            self.tray.stop()
        except Exception as e:
            logger.error("Failed to stop tray: %s", e)
        try:
            self.window.quit()
            self.window.destroy()
        except Exception:
            pass
        os._exit(0)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog=APP_NAME)
    parser.add_argument("--start-minimized", action="store_true")
    return parser.parse_args(argv)


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = parse_args(sys.argv[1:])
    app = App(start_minimized=args.start_minimized)
    app.run()
