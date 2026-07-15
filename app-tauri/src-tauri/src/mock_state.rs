// 1단계 전용 목 상태 — 검증 하네스 shim.js의 MULTI fixture와 같은 시나리오를 재현한다.
// (3분 전 실패=밝음+기준 스탬프 / 26시간 전=흐림 / 9분 전=유예 경계 직전 밝음)
// 토큰류 데이터는 형태상 존재하지 않는다. 4단계에서 실제 poller 상태로 교체된다.
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn fixture() -> Value {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    let now_sec = now_ms / 1000;

    let claude_live = json!({
        "provider": "claude",
        "windows": [
            { "kind": "session_5h", "usedPercent": 62, "resetsAt": now_sec + 7200 },
            { "kind": "weekly", "usedPercent": 34, "resetsAt": now_sec + 3 * 86400 }
        ],
        "fetchedAt": now_ms,
        "plan": "max"
    });
    let codex_live = json!({
        "provider": "codex",
        "windows": [
            { "kind": "session_5h", "usedPercent": 45, "resetsAt": now_sec + 5400 },
            { "kind": "weekly", "usedPercent": 12, "resetsAt": now_sec + 5 * 86400 }
        ],
        "fetchedAt": now_ms,
        "plan": "plus"
    });

    json!({
        "limits": { "claude": claude_live, "codex": codex_live },
        "today": {
            "claude": { "costUsd": 8.42, "totalTokens": 1523000 },
            "codex": { "costUsd": 2.17, "totalTokens": 348000 }
        },
        "lastUsageSyncAt": now_ms,
        "accounts": [
            {
                "account": { "provider": "claude", "id": "uuid-a", "email": "fixture-a@example.com", "plan": "max" },
                "status": {
                    "provider": "claude",
                    "windows": [
                        { "kind": "session_5h", "usedPercent": 62, "resetsAt": now_sec + 7200 },
                        { "kind": "weekly", "usedPercent": 34, "resetsAt": now_sec + 3 * 86400 }
                    ],
                    "fetchedAt": now_ms - 3 * 60 * 1000,
                    "plan": "max",
                    "error": "network"
                },
                "live": false,
                "lastSeenAt": now_ms - 3 * 60 * 1000
            },
            {
                "account": { "provider": "claude", "id": "uuid-b", "email": "old-snapshot@example.com", "plan": "pro" },
                "status": {
                    "provider": "claude",
                    "windows": [
                        { "kind": "session_5h", "usedPercent": 88, "resetsAt": now_sec - 3600 },
                        { "kind": "weekly", "usedPercent": 71, "resetsAt": now_sec + 2 * 86400 }
                    ],
                    "fetchedAt": now_ms - 26 * 3600 * 1000,
                    "plan": "pro"
                },
                "live": false,
                "lastSeenAt": now_ms - 26 * 3600 * 1000
            },
            {
                "account": { "provider": "codex", "id": "acc-1", "email": "fixture-c@example.com", "plan": "plus" },
                "status": codex_live,
                "live": true,
                "lastSeenAt": now_ms
            },
            {
                "account": { "provider": "codex", "id": "acc-2", "email": "second@example.com" },
                "status": {
                    "provider": "codex",
                    "windows": [
                        { "kind": "session_5h", "usedPercent": 97, "resetsAt": now_sec - 120 },
                        { "kind": "weekly", "usedPercent": 45, "resetsAt": now_sec + 5 * 86400 }
                    ],
                    "fetchedAt": now_ms - 9 * 60 * 1000
                },
                "live": false,
                "lastSeenAt": now_ms - 9 * 60 * 1000
            }
        ]
    })
}
