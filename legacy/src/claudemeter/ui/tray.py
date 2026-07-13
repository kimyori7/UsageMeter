# src/claudemeter/ui/tray.py
from __future__ import annotations

from pathlib import Path
from typing import Callable

import pystray
from PIL import Image


class Tray:
    def __init__(
        self,
        icon_path: Path,
        on_open: Callable[[], None],
        on_toggle_widget: Callable[[], None],
        on_refresh: Callable[[], None],
        on_settings: Callable[[], None],
        on_open_ccusage: Callable[[], None],
        on_quit: Callable[[], None],
        widget_visible: Callable[[], bool] = lambda: False,
    ) -> None:
        self._icon_path = icon_path
        self._on_open = on_open
        self._on_toggle_widget = on_toggle_widget
        self._on_refresh = on_refresh
        self._on_settings = on_settings
        self._on_open_ccusage = on_open_ccusage
        self._on_quit = on_quit
        self._widget_visible_fn = widget_visible
        self._tooltip = "ClaudeMeter"
        self._icon: pystray.Icon | None = None

    def _build_menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem("📊 ClaudeMeter 열기", lambda *_: self._on_open(), default=True),
            pystray.MenuItem(
                "📌 위젯 보기",
                lambda *_: self._on_toggle_widget(),
                checked=lambda _i: self._widget_visible_fn(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("⚡ 새로고침", lambda *_: self._on_refresh()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("⚙ 설정...", lambda *_: self._on_settings()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("❓ ccusage 원본 표 열기", lambda *_: self._on_open_ccusage()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("❌ 종료", lambda *_: self._on_quit()),
        )

    def start(self) -> None:
        image = Image.open(self._icon_path)
        self._icon = pystray.Icon(
            "claudemeter",
            image,
            self._tooltip,
            menu=self._build_menu(),
        )
        self._icon.run_detached()

    def update_tooltip(self, text: str) -> None:
        self._tooltip = text
        if self._icon is not None:
            self._icon.title = text

    def stop(self) -> None:
        if self._icon is not None:
            self._icon.stop()
