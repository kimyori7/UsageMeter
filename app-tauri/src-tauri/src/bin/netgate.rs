// 기업 프록시 환경 게이트 — reqwest(native-tls=schannel)가 기업 프록시 SSL 개입을 통과하는지 1회 실조회.
// 보안: 토큰은 메모리에서만 사용. 출력은 HTTP 상태코드 + 최상위 JSON 키 이름만.
use std::fs;

fn main() {
    let home = std::env::var("USERPROFILE").expect("USERPROFILE 없음");
    let path = format!(r"{home}\.claude\.credentials.json");
    let raw = fs::read_to_string(&path).expect("credentials 읽기 실패");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("credentials 파싱 실패");
    let token = json["claudeAiOauth"]["accessToken"]
        .as_str()
        .expect("accessToken 없음")
        .to_string();

    let client = reqwest::blocking::Client::new();
    let res = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send();

    match res {
        Ok(r) => {
            println!("status {}", r.status().as_u16());
            if let Ok(body) = r.json::<serde_json::Value>() {
                if let Some(obj) = body.as_object() {
                    let mut keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
                    keys.sort();
                    println!("keys {}", keys.join(" "));
                }
            }
        }
        Err(e) => {
            // reqwest 에러 문자열에 토큰은 포함되지 않는다(헤더는 표시 안 됨).
            println!("transport-error {e}");
            std::process::exit(1);
        }
    }
}
