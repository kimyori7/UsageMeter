import os
from pathlib import Path
from unittest.mock import patch

from claudemeter import paths


def test_claude_log_dir_is_under_user_home():
    result = paths.claude_log_dir()
    assert result.name == "projects"
    assert result.parent.name == ".claude"


def test_appdata_dir_is_under_appdata_when_set(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    result = paths.appdata_dir()
    assert result == tmp_path / "ClaudeMeter"


def test_appdata_dir_creates_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    target = paths.appdata_dir()
    assert target.exists()
    assert target.is_dir()


def test_config_path_is_inside_appdata(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert paths.config_path() == tmp_path / "ClaudeMeter" / "config.json"


def test_pricing_cache_path_is_inside_appdata(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert paths.pricing_cache_path() == tmp_path / "ClaudeMeter" / "pricing.json"
