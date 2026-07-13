# src/claudemeter/ui/main_window.py
from __future__ import annotations

import subprocess
from typing import Callable, Optional, Set, Tuple

import customtkinter as ctk

from claudemeter.aggregator import AggregateTree
from claudemeter.config import Config
from claudemeter.ui.tree_view import TreeView


class MainWindow(ctk.CTk):
    def __init__(
        self,
        on_settings: Callable[[], None],
        on_close_to_tray: Callable[[], None],
        config: Config,
    ) -> None:
        super().__init__()
        self.title("ClaudeMeter")
        self.geometry("720x720")
        self.overrideredirect(True)
        self.on_settings = on_settings
        self.on_close_to_tray = on_close_to_tray
        self.config_ref = config
        self._tree: Optional[AggregateTree] = None
        self._expanded: Set[str] = set(self._compose_expanded_keys(config))
        self._block_progress: Optional[Tuple[float, str]] = None
        self._drag_origin = (0, 0)

        self.protocol("WM_DELETE_WINDOW", self._handle_close)
        self._build()
        self._enable_header_drag()

    @staticmethod
    def _compose_expanded_keys(config: Config) -> Set[str]:
        keys = {f"period:{p}" for p in config.expanded_periods}
        keys.update(f"session:{s}" for s in config.expanded_sessions)
        return keys

    def _build(self) -> None:
        header = ctk.CTkFrame(self, height=40)
        header.pack(fill="x", padx=4, pady=4)
        self._header = header
        self._header_label = ctk.CTkLabel(header, text="🤖 ClaudeMeter", font=("Segoe UI", 14, "bold"))
        self._header_label.pack(side="left", padx=8)
        ctk.CTkButton(header, text="✕", width=32, command=self._handle_close).pack(side="right", padx=2)
        ctk.CTkButton(header, text="⚙", width=32, command=self.on_settings).pack(side="right", padx=2)

        self.tree_view = TreeView(
            self,
            on_toggle=self._toggle_row,
            token_auto=self.config_ref.token_format_auto,
        )
        self.tree_view.pack(fill="both", expand=True, padx=4, pady=4)

        footer = ctk.CTkFrame(self, height=32)
        footer.pack(fill="x", padx=4, pady=4)
        ctk.CTkButton(footer, text="자세히 보기 (ccusage 원본)", command=self._open_ccusage).pack(side="right", padx=4)

    def _toggle_row(self, key: str) -> None:
        if key in self._expanded:
            self._expanded.discard(key)
        else:
            self._expanded.add(key)
        self._persist_expanded()
        if self._tree is not None:
            self.tree_view.update_tree(
                self._tree,
                self._expanded,
                current_block_progress=self._block_progress,
            )

    def _persist_expanded(self) -> None:
        self.config_ref.expanded_periods = [
            k.split(":", 1)[1] for k in self._expanded if k.startswith("period:")
        ]
        self.config_ref.expanded_sessions = [
            k.split(":", 1)[1] for k in self._expanded if k.startswith("session:")
        ]

    def update_tree(
        self,
        tree: AggregateTree,
        *,
        progress: Optional[Tuple[float, str]] = None,
    ) -> None:
        self._tree = tree
        self._block_progress = progress
        self.tree_view.update_tree(tree, self._expanded, current_block_progress=progress)

    def _handle_close(self) -> None:
        self.withdraw()
        self.on_close_to_tray()

    def _enable_header_drag(self) -> None:
        for w in (self._header, self._header_label):
            w.bind("<ButtonPress-1>", self._start_drag, add="+")
            w.bind("<B1-Motion>", self._do_drag, add="+")

    def _start_drag(self, event):
        self._drag_origin = (event.x_root - self.winfo_x(), event.y_root - self.winfo_y())

    def _do_drag(self, event):
        x = event.x_root - self._drag_origin[0]
        y = event.y_root - self._drag_origin[1]
        self.geometry(f"+{x}+{y}")

    def _open_ccusage(self) -> None:
        subprocess.Popen(
            ["cmd.exe", "/k", "npx", "ccusage", "daily"],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )

    def show(self) -> None:
        self.deiconify()
        self.lift()
        self.focus_force()
