import json
from claudemeter.config import Config, DEFAULT_CONFIG


def test_default_config_has_expected_keys():
    cfg = Config()
    assert cfg.auto_start is False
    assert cfg.show_widget_on_start is False
    assert cfg.start_minimized is True
    assert cfg.live_refresh_seconds == 5
    assert cfg.other_refresh_seconds == 30
    assert cfg.widget_opacity == 0.8
    assert cfg.widget_always_on_top is True
    assert cfg.token_format_auto is True


def test_load_missing_returns_defaults(tmp_path):
    cfg = Config.load(tmp_path / "missing.json")
    assert cfg.auto_start is False


def test_save_then_load_round_trip(tmp_path):
    path = tmp_path / "config.json"
    cfg = Config(auto_start=True, widget_opacity=0.5, live_refresh_seconds=10)
    cfg.save(path)

    loaded = Config.load(path)
    assert loaded.auto_start is True
    assert loaded.widget_opacity == 0.5
    assert loaded.live_refresh_seconds == 10


def test_load_corrupt_returns_defaults(tmp_path):
    path = tmp_path / "config.json"
    path.write_text("not json", encoding="utf-8")
    cfg = Config.load(path)
    assert cfg.auto_start is False


def test_load_partial_merges_with_defaults(tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"auto_start": True}), encoding="utf-8")
    cfg = Config.load(path)
    assert cfg.auto_start is True
    assert cfg.widget_opacity == DEFAULT_CONFIG["widget_opacity"]
