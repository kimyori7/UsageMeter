from __future__ import annotations

import argparse
import logging
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
from claudemeter.block_calculator import BLOCK_LENGTH
from claudemeter.config import Config
from claudemeter.format import format_dollars, format_tokens
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
        self.events.extend(initial)
        self._rebuild_tree()
        self.watcher.start()

        self.window.after(self.config.live_refresh_seconds * 1000, self._tick)
        self.window.mainloop()

    def _on_new_events(self, events: List[UsageEvent]) -> None:
        self.events.extend(events)

    def _rebuild_tree(self) -> None:
        self.tree = aggregate(self.events, price_table=self.price_table, now=datetime.now(timezone.utc))
        self.window.update_tree(self.tree)
        if self.widget is not None:
            self.widget.update_tree(self.tree)
        self._update_tooltip()

    def _update_tooltip(self) -> None:
        if self.tree is None:
            self.tray.update_tooltip("ClaudeMeter")
            return
        block = self.tree.periods.get(Period.CURRENT_BLOCK)
        today = self.tree.periods.get(Period.TODAY)
        parts = []
        if block is not None and block.last_activity is not None:
            elapsed = datetime.now(timezone.utc) - (block.last_activity - BLOCK_LENGTH)
            parts.append(f"블록 {format_tokens(block.total_tokens, auto=True)}")
        if today is not None:
            parts.append(f"오늘 {format_dollars(today.cost)} 상당")
        self.tray.update_tooltip(" · ".join(parts) if parts else "ClaudeMeter")

    def _tick(self) -> None:
        self._rebuild_tree()
        self.window.after(self.config.live_refresh_seconds * 1000, self._tick)

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
        self.widget = Widget(self.window, config=self.config, on_close=self._on_widget_closed)
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
        self.config.save(paths.config_path())
        self.watcher.stop()
        self.tray.stop()
        self.window.destroy()


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog=APP_NAME)
    parser.add_argument("--start-minimized", action="store_true")
    return parser.parse_args(argv)


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = parse_args(sys.argv[1:])
    app = App(start_minimized=args.start_minimized)
    app.run()
