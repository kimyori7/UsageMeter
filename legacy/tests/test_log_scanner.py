from pathlib import Path

from claudemeter.log_scanner import scan_directory, scan_file_from_offset


def test_scan_directory_yields_usage_events_only(tmp_path):
    log = tmp_path / "session-A.jsonl"
    log.write_text(
        '{"type":"permission-mode"}\n'
        '{"type":"user","message":{}}\n'
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":1,"cache_creation_input_tokens":0,'
        '"cache_read_input_tokens":0,"output_tokens":1}},'
        '"sessionId":"S","timestamp":"2026-04-27T12:00:01Z","cwd":"C:\\\\X"}\n',
        encoding="utf-8",
    )
    events = list(scan_directory(tmp_path))
    assert len(events) == 1
    assert events[0].session_id == "S"


def test_scan_directory_handles_subdirectories(tmp_path):
    sub = tmp_path / "project-A"
    sub.mkdir()
    log = sub / "session.jsonl"
    log.write_text(
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":1,"cache_creation_input_tokens":0,'
        '"cache_read_input_tokens":0,"output_tokens":1}},'
        '"sessionId":"S","timestamp":"2026-04-27T12:00:01Z","cwd":"C:\\\\X"}\n',
        encoding="utf-8",
    )
    assert len(list(scan_directory(tmp_path))) == 1


def test_scan_directory_missing_dir_returns_empty(tmp_path):
    missing = tmp_path / "does-not-exist"
    assert list(scan_directory(missing)) == []


def test_scan_file_from_offset_reads_only_new_bytes(tmp_path):
    log = tmp_path / "log.jsonl"
    line1 = (
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":1,"cache_creation_input_tokens":0,'
        '"cache_read_input_tokens":0,"output_tokens":1}},'
        '"sessionId":"S1","timestamp":"2026-04-27T12:00:01Z","cwd":"C:\\\\X"}\n'
    )
    line2 = (
        '{"type":"assistant","message":{"model":"claude-opus-4-7",'
        '"usage":{"input_tokens":2,"cache_creation_input_tokens":0,'
        '"cache_read_input_tokens":0,"output_tokens":2}},'
        '"sessionId":"S2","timestamp":"2026-04-27T12:00:02Z","cwd":"C:\\\\X"}\n'
    )
    log.write_bytes(line1.encode("utf-8"))
    events1, offset = scan_file_from_offset(log, 0)
    assert [e.session_id for e in events1] == ["S1"]
    assert offset == len(line1.encode("utf-8"))

    log.open("ab").write(line2.encode("utf-8"))
    events2, offset2 = scan_file_from_offset(log, offset)
    assert [e.session_id for e in events2] == ["S2"]
    assert offset2 == len(line1.encode("utf-8")) + len(line2.encode("utf-8"))
