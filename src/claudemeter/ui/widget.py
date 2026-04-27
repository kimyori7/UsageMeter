# src/claudemeter/ui/widget.py
from __future__ import annotations

from typing import Callable, Optional, Set

import customtkinter as ctk

from claudemeter.aggregator import AggregateTree
from claudemeter.config import Config
from claudemeter.ui.tree_view import TreeView


class Widget(ctk.CTkToplevel):
    def __init__(self, master, config: Config, on_close: Callable[[], None]) -> None:
        super().__init__(master)
        self.title("ClaudeMeter Widget")
        self.geometry("320x540")
        self.attributes("-topmost", config.widget_always_on_top)
        self.attributes("-alpha", config.widget_opacity)
        self.overrideredirect(True)  # frameless
        self.config_ref = config
        self.on_close = on_close
        self._tree: Optional[AggregateTree] = None

        if config.widget_position:
            x, y = config.widget_position
            self.geometry(f"+{int(x)}+{int(y)}")

        self._expanded: Set[str] = set()
        self._build()
        self._enable_drag()

    def _build(self) -> None:
        header = ctk.CTkFrame(self, height=24, fg_color=("gray80", "gray20"))
        header.pack(fill="x")
        ctk.CTkLabel(header, text="🤖 ClaudeMeter", anchor="w").pack(side="left", padx=8)
        ctk.CTkButton(header, text="×", width=24, command=self._handle_close).pack(side="right", padx=2)

        self.tree_view = TreeView(
            self,
            on_toggle=self._toggle_row,
            token_auto=self.config_ref.token_format_auto,
            compact=True,
        )
        self.tree_view.pack(fill="both", expand=True, padx=2, pady=2)

    def _toggle_row(self, key: str) -> None:
        if key in self._expanded:
            self._expanded.discard(key)
        else:
            self._expanded.add(key)
        if self._tree is not None:
            self.tree_view.update_tree(self._tree, self._expanded)

    def update_tree(self, tree: AggregateTree) -> None:
        self._tree = tree
        self.tree_view.update_tree(tree, self._expanded)

    def _enable_drag(self) -> None:
        self._drag_origin = (0, 0)
        for widget in self.winfo_children():
            widget.bind("<ButtonPress-1>", self._start_drag, add="+")
            widget.bind("<B1-Motion>", self._do_drag, add="+")

    def _start_drag(self, event):
        self._drag_origin = (event.x_root - self.winfo_x(), event.y_root - self.winfo_y())

    def _do_drag(self, event):
        x = event.x_root - self._drag_origin[0]
        y = event.y_root - self._drag_origin[1]
        self.geometry(f"+{x}+{y}")
        self.config_ref.widget_position = [x, y]

    def _handle_close(self) -> None:
        self.destroy()
        self.on_close()
