# src/claudemeter/ui/tree_view.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

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


@dataclass
class RowHandle:
    """Holds widgets for a single rendered row so we can update text in place."""

    kind: str  # "data" or "progress"
    frame: ctk.CTkFrame
    # Data row widgets (None for progress rows)
    chev_label: Optional[ctk.CTkLabel] = None
    text_label: Optional[ctk.CTkLabel] = None
    summary_label: Optional[ctk.CTkLabel] = None
    indent: Optional[int] = None
    # Progress row widgets (None for data rows)
    bar: Optional[ctk.CTkProgressBar] = None
    remaining_label: Optional[ctk.CTkLabel] = None


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
        self._block_progress: Optional[Tuple[float, str]] = None
        # Stable map: key -> RowHandle. Insertion order tracks current visual order.
        self._rows: Dict[str, RowHandle] = {}

    def update_tree(
        self,
        tree: AggregateTree,
        expanded: Set[str],
        *,
        current_block_progress: Optional[Tuple[float, str]] = None,
    ) -> None:
        self._tree = tree
        self._expanded = expanded
        self._block_progress = current_block_progress
        self._redraw()

    # ------------------------------------------------------------------
    # Diff-based redraw
    # ------------------------------------------------------------------
    def _redraw(self) -> None:
        if self._tree is None:
            # Clear everything.
            for handle in self._rows.values():
                handle.frame.destroy()
            self._rows.clear()
            return

        desired: List[Tuple[str, Dict[str, Any]]] = self._compute_desired_rows()
        desired_keys = [k for k, _ in desired]
        desired_key_set = set(desired_keys)

        # Pass 1: create or update rows in desired order.
        for key, data in desired:
            handle = self._rows.get(key)
            if handle is None:
                handle = self._create_row(key, data)
                self._rows[key] = handle
            else:
                self._update_row(handle, data)

        # Pass 2: remove rows no longer wanted.
        stale = [k for k in self._rows.keys() if k not in desired_key_set]
        for k in stale:
            self._rows[k].frame.destroy()
            del self._rows[k]

        # Pass 3: ensure visual order matches desired order.
        self._reorder_if_needed(desired_keys)

    def _compute_desired_rows(self) -> List[Tuple[str, Dict[str, Any]]]:
        """Return ordered list of (key, row_data dict) tuples that should be visible."""
        out: List[Tuple[str, Dict[str, Any]]] = []
        if self._tree is None:
            return out
        for period in PERIOD_ORDER:
            node = self._tree.periods.get(period)
            if node is None:
                continue
            period_key = f"period:{period.value}"
            expanded = period_key in self._expanded
            out.append(
                (
                    period_key,
                    {
                        "kind": "data",
                        "indent": 0,
                        "chevron": "▼" if expanded else "▶",
                        "label": PERIOD_LABELS[period],
                        "summary": (
                            f"{format_tokens(node.total_tokens, auto=self.token_auto)} · "
                            f"{format_dollars(node.cost)}"
                        ),
                        "clickable_key": period_key,
                    },
                )
            )

            # Progress bar appears under CURRENT_BLOCK row when provided.
            if period == Period.CURRENT_BLOCK and self._block_progress is not None:
                ratio, remaining_str = self._block_progress
                out.append(
                    (
                        "progress:current_block",
                        {
                            "kind": "progress",
                            "ratio": ratio,
                            "remaining": remaining_str,
                        },
                    )
                )

            if not expanded:
                continue
            sorted_sessions = sorted(
                node.sessions.values(), key=lambda s: s.total_tokens, reverse=True
            )
            for session in sorted_sessions:
                session_key = f"session:{period.value}:{session.project_path}"
                session_expanded = session_key in self._expanded
                out.append(
                    (
                        session_key,
                        {
                            "kind": "data",
                            "indent": 20,
                            "chevron": "▼" if session_expanded else "▶",
                            "label": f"📁 {self._short_path(session.project_path)}",
                            "summary": (
                                f"{format_tokens(session.total_tokens, auto=self.token_auto)} · "
                                f"{format_dollars(session.cost)}"
                            ),
                            "clickable_key": session_key,
                        },
                    )
                )
                if not session_expanded:
                    continue
                sorted_models = sorted(
                    session.models.values(), key=lambda m: m.total_tokens, reverse=True
                )
                for model in sorted_models:
                    model_key = f"model:{period.value}:{session.project_path}:{model.model}"
                    out.append(
                        (
                            model_key,
                            {
                                "kind": "data",
                                "indent": 40,
                                "chevron": " ",
                                "label": f"🤖 {model.model}",
                                "summary": (
                                    f"{format_tokens(model.total_tokens, auto=self.token_auto)} · "
                                    f"{format_dollars(model.cost)}"
                                ),
                                "clickable_key": None,
                            },
                        )
                    )
        return out

    # ------------------------------------------------------------------
    # Row creation / update
    # ------------------------------------------------------------------
    def _create_row(self, key: str, data: Dict[str, Any]) -> RowHandle:
        if data["kind"] == "progress":
            return self._create_progress_row(data)
        return self._create_data_row(key, data)

    def _create_data_row(self, key: str, data: Dict[str, Any]) -> RowHandle:
        indent = data["indent"]
        frame = ctk.CTkFrame(self, fg_color="transparent")
        ctk.CTkLabel(frame, text="", width=indent).pack(side="left")
        chev = ctk.CTkLabel(frame, text=data["chevron"], width=20)
        chev.pack(side="left")
        lbl = ctk.CTkLabel(frame, text=data["label"], anchor="w")
        lbl.pack(side="left", padx=(4, 0))
        summary = ctk.CTkLabel(frame, text=data["summary"], anchor="e")
        summary.pack(side="right", padx=(0, 6))

        clickable = data.get("clickable_key")
        if clickable is not None:
            for w in (frame, chev, lbl):
                w.bind("<Button-1>", lambda _e, k=clickable: self.on_toggle(k))
                w.configure(cursor="hand2")

        frame.pack(fill="x", padx=2, pady=1)
        return RowHandle(
            kind="data",
            frame=frame,
            chev_label=chev,
            text_label=lbl,
            summary_label=summary,
            indent=indent,
        )

    def _create_progress_row(self, data: Dict[str, Any]) -> RowHandle:
        frame = ctk.CTkFrame(self, fg_color="transparent")
        ctk.CTkLabel(frame, text="", width=20).pack(side="left")
        bar = ctk.CTkProgressBar(frame)
        bar.set(data["ratio"])
        bar.pack(side="left", padx=(4, 8), fill="x", expand=True)
        remaining = ctk.CTkLabel(frame, text=data["remaining"], anchor="e")
        remaining.pack(side="right", padx=(0, 6))
        frame.pack(fill="x", padx=2, pady=(0, 2))
        return RowHandle(
            kind="progress",
            frame=frame,
            bar=bar,
            remaining_label=remaining,
        )

    def _update_row(self, handle: RowHandle, data: Dict[str, Any]) -> None:
        # If a row's "kind" changed (data <-> progress) under the same key,
        # rebuild it. Shouldn't happen given our key scheme, but be safe.
        if handle.kind != data["kind"]:
            handle.frame.destroy()
            # Caller will replace it; signal by destroying and not updating.
            # We mutate handle in-place by rebuilding through caller flow.
            # Simpler: just destroy and create fresh by raising... actually we
            # cannot easily swap here. Do it inline:
            return self._replace_handle_inplace(handle, data)

        if handle.kind == "data":
            assert handle.chev_label is not None
            assert handle.text_label is not None
            assert handle.summary_label is not None
            if handle.chev_label.cget("text") != data["chevron"]:
                handle.chev_label.configure(text=data["chevron"])
            if handle.text_label.cget("text") != data["label"]:
                handle.text_label.configure(text=data["label"])
            if handle.summary_label.cget("text") != data["summary"]:
                handle.summary_label.configure(text=data["summary"])
        else:  # progress
            assert handle.bar is not None
            assert handle.remaining_label is not None
            handle.bar.set(data["ratio"])
            if handle.remaining_label.cget("text") != data["remaining"]:
                handle.remaining_label.configure(text=data["remaining"])

    def _replace_handle_inplace(self, handle: RowHandle, data: Dict[str, Any]) -> None:
        # Defensive path: kind changed for the same key. Unused under current
        # key scheme, but keeps state consistent if it ever happens.
        # Find the key for this handle so we can swap it in self._rows.
        key_for_handle: Optional[str] = None
        for k, h in self._rows.items():
            if h is handle:
                key_for_handle = k
                break
        if key_for_handle is None:
            return
        new_handle = self._create_row(key_for_handle, data)
        self._rows[key_for_handle] = new_handle

    # ------------------------------------------------------------------
    # Reorder logic — only repack rows whose position actually changed.
    # ------------------------------------------------------------------
    def _reorder_if_needed(self, desired_keys: List[str]) -> None:
        """Ensure rows are packed in `desired_keys` order with minimal repacking."""
        # Current order = pack_slaves() order on self.
        # CTkScrollableFrame packs into an internal frame; use the frame's master
        # of any tracked row to query siblings, but simpler is to compare against
        # our own insertion order and force a repack pass only when mismatched.
        current_keys = self._current_visual_order(desired_keys)
        if current_keys == desired_keys:
            return

        # Find first index where order diverges. Repack from there onward.
        first_mismatch = 0
        for i, (cur, des) in enumerate(zip(current_keys, desired_keys)):
            if cur != des:
                first_mismatch = i
                break
        else:
            first_mismatch = min(len(current_keys), len(desired_keys))

        # Repack the tail in correct order. Each row uses pack with no `before`/
        # `after` — since we pack_forget then pack in sequence, they append to
        # the end of currently-packed siblings, which is exactly what we want
        # because we're processing them top-down and earlier rows (unchanged)
        # are still packed.
        for key in desired_keys[first_mismatch:]:
            handle = self._rows.get(key)
            if handle is None:
                continue
            handle.frame.pack_forget()
            if handle.kind == "data":
                handle.frame.pack(fill="x", padx=2, pady=1)
            else:
                handle.frame.pack(fill="x", padx=2, pady=(0, 2))

    def _current_visual_order(self, desired_keys: List[str]) -> List[str]:
        """Return current visual order of tracked rows, restricted to keys we own."""
        # CTk packs into an internal `parent_frame`. Use the frame of any tracked
        # row to find siblings in pack order.
        parent = None
        for handle in self._rows.values():
            parent = handle.frame.master
            break
        if parent is None:
            return []

        # pack_slaves returns widgets in pack order.
        try:
            slaves = parent.pack_slaves()
        except Exception:
            return list(self._rows.keys())

        # Build reverse map: frame -> key
        frame_to_key = {h.frame: k for k, h in self._rows.items()}
        return [frame_to_key[s] for s in slaves if s in frame_to_key]

    @staticmethod
    def _short_path(path: str) -> str:
        normalized = path.replace("\\", "/")
        parts = [p for p in normalized.split("/") if p]
        return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else path)
