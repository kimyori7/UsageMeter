from datetime import datetime, timezone
from claudemeter.parser import UsageEvent, parse_line


def test_parse_assistant_line_with_usage():
    line = (
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":10,"cache_creation_input_tokens":1000,'
        '"cache_read_input_tokens":500,"output_tokens":200}},'
        '"sessionId":"sess-A","timestamp":"2026-04-27T12:00:01.000Z",'
        '"cwd":"C:\\\\Users\\\\me\\\\Documents\\\\UsageMeter"}'
    )
    event = parse_line(line)
    assert isinstance(event, UsageEvent)
    assert event.session_id == "sess-A"
    assert event.project_path == "C:\\Users\\me\\Documents\\UsageMeter"
    assert event.model == "claude-opus-4-7"
    assert event.input_tokens == 10
    assert event.cache_creation_tokens == 1000
    assert event.cache_read_tokens == 500
    assert event.output_tokens == 200
    assert event.timestamp == datetime(2026, 4, 27, 12, 0, 1, tzinfo=timezone.utc)


def test_parse_user_line_returns_none():
    line = '{"type":"user","message":{"role":"user","content":"hi"},"sessionId":"X"}'
    assert parse_line(line) is None


def test_parse_permission_mode_line_returns_none():
    line = '{"type":"permission-mode","permissionMode":"default","sessionId":"X"}'
    assert parse_line(line) is None


def test_parse_assistant_line_without_usage_returns_none():
    line = '{"type":"assistant","message":{"model":"claude-opus-4-7","content":[]},"sessionId":"X","timestamp":"2026-04-27T12:00:01Z"}'
    assert parse_line(line) is None


def test_parse_invalid_json_returns_none():
    assert parse_line("not json") is None
    assert parse_line("") is None


def test_parse_line_missing_cwd_uses_unknown():
    line = (
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":1,"cache_creation_input_tokens":0,'
        '"cache_read_input_tokens":0,"output_tokens":1}},'
        '"sessionId":"sess-A","timestamp":"2026-04-27T12:00:01.000Z"}'
    )
    event = parse_line(line)
    assert event is not None
    assert event.project_path == "Unknown Project"
