import os
from pathlib import Path


def claude_log_dir() -> Path:
    return Path.home() / ".claude" / "projects"


def appdata_dir() -> Path:
    base = os.environ.get("APPDATA")
    target = Path(base) / "ClaudeMeter" if base else Path.home() / ".claudemeter"
    target.mkdir(parents=True, exist_ok=True)
    return target


def config_path() -> Path:
    return appdata_dir() / "config.json"


def pricing_cache_path() -> Path:
    return appdata_dir() / "pricing.json"
