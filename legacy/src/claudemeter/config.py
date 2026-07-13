from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_CONFIG: Dict[str, Any] = {
    "auto_start": False,
    "show_widget_on_start": False,
    "start_minimized": True,
    "live_refresh_seconds": 5,
    "other_refresh_seconds": 30,
    "widget_opacity": 0.8,
    "widget_always_on_top": True,
    "token_format_auto": True,
    "expanded_periods": ["current_block"],
    "expanded_sessions": [],
    "widget_position": None,
}


@dataclass
class Config:
    auto_start: bool = False
    show_widget_on_start: bool = False
    start_minimized: bool = True
    live_refresh_seconds: int = 5
    other_refresh_seconds: int = 30
    widget_opacity: float = 0.8
    widget_always_on_top: bool = True
    token_format_auto: bool = True
    expanded_periods: List[str] = field(default_factory=lambda: ["current_block"])
    expanded_sessions: List[str] = field(default_factory=list)
    widget_position: Any = None

    @classmethod
    def load(cls, path: Path) -> "Config":
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        merged = {**DEFAULT_CONFIG, **data}
        valid_keys = {f.name for f in fields(cls)}
        kwargs = {k: v for k, v in merged.items() if k in valid_keys}
        return cls(**kwargs)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
