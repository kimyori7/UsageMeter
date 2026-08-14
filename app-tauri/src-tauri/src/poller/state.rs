// 폴러가 렌더러에 push하는 앱 상태 — v1 poller.ts AppState 계약.
// camelCase 직렬화, limits의 None과 lastUsageSyncAt의 None은 null 유지(v1 초기 상태가 null) —
// RateStatus 내부 옵션(plan/stale/error)의 키 생략과 다른 규칙이라 skip_serializing_if를 쓰지 않는다.
use crate::accounts_cycle::AccountRateState;
use crate::providers::types::RateStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayEntry {
    pub cost_usd: f64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Today {
    pub claude: TodayEntry,
    pub codex: TodayEntry,
}

#[derive(Debug, Clone, Serialize)]
pub struct Limits {
    pub claude: Option<RateStatus>,
    pub codex: Option<RateStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub limits: Limits,
    pub today: Today,
    pub last_usage_sync_at: Option<f64>,
    pub accounts: Vec<AccountRateState>,
}

impl AppState {
    /// v1 Poller 생성자의 초기 상태와 동일 — 첫 틱 전 get_state가 이 값을 돌려준다.
    pub fn initial() -> Self {
        Self {
            limits: Limits { claude: None, codex: None },
            today: Today::default(),
            last_usage_sync_at: None,
            accounts: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn initial_state_serializes_v1_contract() {
        let v = serde_json::to_value(AppState::initial()).unwrap();
        // v1 초기 상태: null은 키 생략이 아니라 null 그대로 (렌더러가 limits.claude === null 분기)
        assert_eq!(
            v,
            json!({
                "limits": { "claude": null, "codex": null },
                "today": {
                    "claude": { "costUsd": 0.0, "totalTokens": 0 },
                    "codex": { "costUsd": 0.0, "totalTokens": 0 }
                },
                "lastUsageSyncAt": null,
                "accounts": []
            })
        );
    }

    #[test]
    fn populated_state_uses_camel_case_everywhere() {
        // P2 이월(DTO 계약 잠금): 렌더러가 실제로 읽는 키가 전부 camelCase인지 전체 트리로 확인
        use crate::providers::types::{RateStatus, RateWindow};
        let mut st = AppState::initial();
        st.limits.claude = Some(RateStatus {
            windows: vec![RateWindow { kind: "session_5h".into(), used_percent: 62.0, resets_at: 100.0 }],
            ..RateStatus::base("claude", 5000.0)
        });
        st.today.claude = TodayEntry { cost_usd: 8.42, total_tokens: 1523 };
        st.last_usage_sync_at = Some(6000.0);
        // 렌더러 accountView가 accounts[].lastSeenAt/live를 읽는다(유예 판정) — 키 이름 핀.
        st.accounts.push(crate::accounts_cycle::AccountRateState {
            account: crate::accounts_cycle::AccountInfo {
                provider: "claude".into(),
                id: "acc-1".into(),
                email: "fake@example.com".into(),
                plan: None,
            },
            status: RateStatus::base("claude", 4000.0),
            active: false,
            live: false,
            last_seen_at: 4000.0,
        });
        let v = serde_json::to_value(&st).unwrap();
        assert_eq!(v["limits"]["claude"]["windows"][0]["usedPercent"], 62.0);
        assert_eq!(v["limits"]["claude"]["windows"][0]["resetsAt"], 100.0);
        assert_eq!(v["limits"]["claude"]["fetchedAt"], 5000.0);
        assert_eq!(v["today"]["claude"]["costUsd"], 8.42);
        assert_eq!(v["today"]["claude"]["totalTokens"], 1523);
        assert_eq!(v["lastUsageSyncAt"], 6000.0);
        assert_eq!(v["accounts"][0]["lastSeenAt"], 4000.0);
        assert_eq!(v["accounts"][0]["live"], false);
        assert_eq!(v["accounts"][0]["active"], false); // 팝업 1계정 선별이 읽는 키

        assert_eq!(v["accounts"][0]["account"]["email"], "fake@example.com");
        assert!(v["accounts"][0]["account"].get("plan").is_none()); // v1 undefined → 키 생략
    }

    #[test]
    fn today_deserializes_from_real_today_by_provider_output() {
        // P2 이월(camelCase 역직렬화 실테스트): 실 쿼리 출력 → Today 강타입 왕복
        let dir = tempfile::tempdir().unwrap();
        let mut conn = crate::store::db::open_db(&dir.path().join("u.db")).unwrap();
        crate::store::daily::upsert_daily(
            &mut conn,
            &[crate::store::daily::DailyRow {
                date: "2026-07-15".into(),
                provider: "claude".into(),
                model: "opus".into(),
                input_tokens: 100,
                output_tokens: 200,
                cache_tokens: 300,
                cost_usd: 1.25,
            }],
        )
        .unwrap();
        let v = crate::store::queries::today_by_provider(&conn, "2026-07-15").unwrap();
        let today: Today = serde_json::from_value(v).unwrap();
        assert_eq!(today.claude, TodayEntry { cost_usd: 1.25, total_tokens: 600 });
        assert_eq!(today.codex, TodayEntry::default());
    }
}
