# src/claudemeter/ui/settings.py
from __future__ import annotations

from typing import Callable

import customtkinter as ctk

from claudemeter.config import Config


class SettingsDialog(ctk.CTkToplevel):
    def __init__(self, master, config: Config, on_save: Callable[[Config], None]) -> None:
        super().__init__(master)
        self.title("ClaudeMeter 설정")
        self.geometry("520x540")
        self.config_ref = config
        self.on_save = on_save

        self.var_auto_start = ctk.BooleanVar(value=config.auto_start)
        self.var_show_widget = ctk.BooleanVar(value=config.show_widget_on_start)
        self.var_start_min = ctk.BooleanVar(value=config.start_minimized)
        self.var_live_secs = ctk.IntVar(value=config.live_refresh_seconds)
        self.var_other_secs = ctk.IntVar(value=config.other_refresh_seconds)
        self.var_opacity = ctk.DoubleVar(value=config.widget_opacity)
        self.var_topmost = ctk.BooleanVar(value=config.widget_always_on_top)
        self.var_token_auto = ctk.BooleanVar(value=config.token_format_auto)

        self._build()

    def _build(self) -> None:
        pad = {"padx": 12, "pady": 4}

        ctk.CTkLabel(self, text="시작 옵션", font=("Segoe UI", 12, "bold")).pack(anchor="w", **pad)
        ctk.CTkCheckBox(self, text="Windows 시작 시 자동 실행", variable=self.var_auto_start).pack(anchor="w", **pad)
        ctk.CTkCheckBox(self, text="시작 시 위젯도 함께 표시", variable=self.var_show_widget).pack(anchor="w", **pad)
        ctk.CTkCheckBox(self, text="시작 시 메인 창 숨김 (트레이만)", variable=self.var_start_min).pack(anchor="w", **pad)

        ctk.CTkLabel(self, text="갱신 주기 (초)", font=("Segoe UI", 12, "bold")).pack(anchor="w", **pad)
        row1 = ctk.CTkFrame(self, fg_color="transparent")
        row1.pack(fill="x", **pad)
        ctk.CTkLabel(row1, text="Live:").pack(side="left")
        ctk.CTkOptionMenu(row1, values=["5", "10", "30", "60"],
                          command=lambda v: self.var_live_secs.set(int(v))).pack(side="left", padx=8)
        row2 = ctk.CTkFrame(self, fg_color="transparent")
        row2.pack(fill="x", **pad)
        ctk.CTkLabel(row2, text="그 외:").pack(side="left")
        ctk.CTkOptionMenu(row2, values=["30", "60", "300"],
                          command=lambda v: self.var_other_secs.set(int(v))).pack(side="left", padx=8)

        ctk.CTkLabel(self, text="위젯 모양", font=("Segoe UI", 12, "bold")).pack(anchor="w", **pad)
        op_row = ctk.CTkFrame(self, fg_color="transparent")
        op_row.pack(fill="x", **pad)
        ctk.CTkLabel(op_row, text="투명도:").pack(side="left")
        ctk.CTkSlider(op_row, from_=0.3, to=1.0, variable=self.var_opacity).pack(side="left", padx=8, fill="x", expand=True)
        ctk.CTkCheckBox(self, text="항상 다른 창 위에", variable=self.var_topmost).pack(anchor="w", **pad)

        ctk.CTkLabel(self, text="표시 단위", font=("Segoe UI", 12, "bold")).pack(anchor="w", **pad)
        ctk.CTkCheckBox(self, text="토큰 자동 표기 (K/M/B)", variable=self.var_token_auto).pack(anchor="w", **pad)

        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(fill="x", side="bottom", **pad)
        ctk.CTkButton(btn_row, text="저장", command=self._save).pack(side="right", padx=4)
        ctk.CTkButton(btn_row, text="취소", command=self.destroy).pack(side="right", padx=4)

    def _save(self) -> None:
        self.config_ref.auto_start = self.var_auto_start.get()
        self.config_ref.show_widget_on_start = self.var_show_widget.get()
        self.config_ref.start_minimized = self.var_start_min.get()
        self.config_ref.live_refresh_seconds = self.var_live_secs.get()
        self.config_ref.other_refresh_seconds = self.var_other_secs.get()
        self.config_ref.widget_opacity = self.var_opacity.get()
        self.config_ref.widget_always_on_top = self.var_topmost.get()
        self.config_ref.token_format_auto = self.var_token_auto.get()
        self.on_save(self.config_ref)
        self.destroy()
