# src/claudemeter/ui/tree_view.py
from __future__ import annotations

from typing import Callable, Optional, Set

import customtkinter as ctk

from claudemeter.aggregator import AggregateTree, Period, PeriodNode, SessionNode, ModelNode
from claudemeter.format import format_tokens, format_dollars

PERIOD_LABELS = {
    Period.CURRENT_BLOCK: "🕐 현재 블록 (Live)",
    Period.TODAY: "📅 오늘",
    Period.THIS_WEEK: "📅 이번 주",
    Period.THIS_MONTH: "📅 이번 달",
    Period.ALL_TIME: "📅 전체 (누적)",
}

PERIOD_ORDER = [
    Period.CURRENT_BLOCK,
    Period.TODAY,
    Period.THIS_WEEK,
    Period.THIS_MONTH,
    Period.ALL_TIME,
]


class TreeView(ctk.CTkScrollableFrame):
    def __init__(
        self,
        master,
        on_toggle: Callable[[str], None],
        token_auto: bool = True,
        compact: bool = False,
        **kwargs,
    ):
        super().__init__(master, **kwargs)
        self.on_toggle = on_toggle
        self.token_auto = token_auto
        self.compact = compact
        self._tree: Optional[AggregateTree] = None
        self._expanded: Set[str] = set()

    def update_tree(self, tree: AggregateTree, expanded: Set[str]) -> None:
        self._tree = tree
        self._expanded = expanded
        self._redraw()

    def _redraw(self) -> None:
        for child in self.winfo_children():
            child.destroy()
        if self._tree is None:
            return
        for period in PERIOD_ORDER:
            node = self._tree.periods.get(period)
            if node is None:
                continue
            self._draw_period(period, node)

    def _draw_period(self, period: Period, node: PeriodNode) -> None:
        key = f"period:{period.value}"
        expanded = key in self._expanded
        chevron = "▼" if expanded else "▶"
        label = PERIOD_LABELS[period]
        summary = f"{format_tokens(node.total_tokens, auto=self.token_auto)} · {format_dollars(node.cost)}"

        row = self._make_row(0, chevron, label, summary, key)
        row.pack(fill="x", padx=2, pady=1)

        if not expanded:
            return
        sorted_sessions = sorted(
            node.sessions.values(), key=lambda s: s.total_tokens, reverse=True
        )
        for session in sorted_sessions:
            self._draw_session(period, session)

    def _draw_session(self, period: Period, node: SessionNode) -> None:
        key = f"session:{period.value}:{node.project_path}"
        expanded = key in self._expanded
        chevron = "▼" if expanded else "▶"
        label = f"📁 {self._short_path(node.project_path)}"
        summary = f"{format_tokens(node.total_tokens, auto=self.token_auto)} · {format_dollars(node.cost)}"
        row = self._make_row(20, chevron, label, summary, key)
        row.pack(fill="x", padx=2, pady=1)

        if not expanded:
            return
        sorted_models = sorted(node.models.values(), key=lambda m: m.total_tokens, reverse=True)
        for model in sorted_models:
            self._draw_model(model)

    def _draw_model(self, node: ModelNode) -> None:
        label = f"🤖 {node.model}"
        summary = f"{format_tokens(node.total_tokens, auto=self.token_auto)} · {format_dollars(node.cost)}"
        row = self._make_row(40, " ", label, summary, key=None)
        row.pack(fill="x", padx=2, pady=1)

    def _make_row(self, indent: int, chevron: str, label: str, summary: str, key: Optional[str]):
        row = ctk.CTkFrame(self, fg_color="transparent")
        ctk.CTkLabel(row, text="", width=indent).pack(side="left")
        chev = ctk.CTkLabel(row, text=chevron, width=20)
        chev.pack(side="left")
        lbl = ctk.CTkLabel(row, text=label, anchor="w")
        lbl.pack(side="left", padx=(4, 0))
        ctk.CTkLabel(row, text=summary, anchor="e").pack(side="right", padx=(0, 6))
        if key is not None:
            for w in (row, chev, lbl):
                w.bind("<Button-1>", lambda _e, k=key: self.on_toggle(k))
                w.configure(cursor="hand2")
        return row

    @staticmethod
    def _short_path(path: str) -> str:
        normalized = path.replace("\\", "/")
        parts = [p for p in normalized.split("/") if p]
        return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else path)
