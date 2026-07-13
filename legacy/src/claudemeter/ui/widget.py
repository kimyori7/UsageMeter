# src/claudemeter/ui/widget.py
from __future__ import annotations

import tkinter as tk
from typing import Callable, Optional, Set, Tuple

import customtkinter as ctk

from claudemeter.aggregator import AggregateTree
from claudemeter.config import Config
from claudemeter.ui.tree_view import TreeView


class Widget(ctk.CTkToplevel):
    def __init__(
        self,
        master,
        config: Config,
        on_close: Callable[[], None],
        on_open_main: Optional[Callable[[], None]] = None,
        on_open_settings: Optional[Callable[[], None]] = None,
        on_open_ccusage: Optional[Callable[[], None]] = None,
        on_quit: Optional[Callable[[], None]] = None,
    ) -> None:
        super().__init__(master)
        self.title("ClaudeMeter Widget")
        self.geometry("320x540")
        self.overrideredirect(True)
        self.attributes("-topmost", config.widget_always_on_top)
        self.config_ref = config
        self.on_close = on_close
        self.on_open_main = on_open_main
        self.on_open_settings = on_open_settings
        self.on_open_ccusage = on_open_ccusage
        self.on_quit = on_quit
        self._tree: Optional[AggregateTree] = None
        self._block_progress: Optional[Tuple[float, str]] = None

        if config.widget_position:
            x, y = config.widget_position
            self.geometry(f"+{int(x)}+{int(y)}")

        self._expanded: Set[str] = set()
        self._build()
        self._build_context_menu()
        self._enable_drag()
        self._bind_context_menu()

        self.update_idletasks()
        self.after(10, lambda: self.attributes("-alpha", config.widget_opacity))

    def _build(self) -> None:
        header = ctk.CTkFrame(self, height=28, fg_color=("gray80", "gray20"))
        header.pack(fill="x")
        self._header = header
        ctk.CTkLabel(header, text="🤖", anchor="w").pack(side="left", padx=(8, 4))
        ctk.CTkButton(header, text="×", width=24, command=self._handle_close).pack(side="right", padx=2)
        self._opacity_slider = ctk.CTkSlider(
            header,
            from_=0.3,
            to=1.0,
            width=90,
            number_of_steps=14,
            command=self._on_opacity_change,
        )
        self._opacity_slider.set(self.config_ref.widget_opacity)
        self._opacity_slider.pack(side="right", padx=(4, 6))
        self._opacity_label = ctk.CTkLabel(
            header, text=f"{int(self.config_ref.widget_opacity * 100)}%", width=36
        )
        self._opacity_label.pack(side="right", padx=(0, 2))

        self.tree_view = TreeView(
            self,
            on_toggle=self._toggle_row,
            token_auto=self.config_ref.token_format_auto,
            compact=True,
        )
        self.tree_view.pack(fill="both", expand=True, padx=2, pady=2)

    def _build_context_menu(self) -> None:
        self._context_menu = tk.Menu(self, tearoff=0)
        if self.on_open_main is not None:
            self._context_menu.add_command(label="메인 창 열기", command=self.on_open_main)
        if self.on_open_settings is not None:
            self._context_menu.add_command(label="설정...", command=self.on_open_settings)
        if self.on_open_ccusage is not None:
            self._context_menu.add_command(label="ccusage 원본 표 열기", command=self.on_open_ccusage)
        if self.on_quit is not None:
            self._context_menu.add_separator()
            self._context_menu.add_command(label="종료", command=self.on_quit)

    def _bind_context_menu(self) -> None:
        def popup(event):
            try:
                self._context_menu.tk_popup(event.x_root, event.y_root)
            finally:
                self._context_menu.grab_release()

        self.bind("<Button-3>", popup)
        self._header.bind("<Button-3>", popup)
        for child in self._header.winfo_children():
            try:
                child.bind("<Button-3>", popup, add="+")
            except tk.TclError:
                pass

    def _toggle_row(self, key: str) -> None:
        if key in self._expanded:
            self._expanded.discard(key)
        else:
            self._expanded.add(key)
        if self._tree is not None:
            self.tree_view.update_tree(
                self._tree,
                self._expanded,
                current_block_progress=self._block_progress,
            )

    def update_tree(
        self,
        tree: AggregateTree,
        *,
        progress: Optional[Tuple[float, str]] = None,
    ) -> None:
        self._tree = tree
        self._block_progress = progress
        self.tree_view.update_tree(tree, self._expanded, current_block_progress=progress)

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

    def _on_opacity_change(self, value: float) -> None:
        value = max(0.3, min(1.0, float(value)))
        self.attributes("-alpha", value)
        self.config_ref.widget_opacity = value
        self._opacity_label.configure(text=f"{int(value * 100)}%")

    def _handle_close(self) -> None:
        self.destroy()
        self.on_close()
