// 실사용 usage.db 복사본에 대한 마이그레이션 점검 도구(개발 전용).
// 단위 테스트는 항상 새 임시 DB를 만들기 때문에 "기존 DB에 컬럼이 실제로 추가되는가"를 검증하지 못한다.
// 사용: cargo run --example dbmigrate_check -- <usage.db 복사본 경로>
// (examples/에 두는 이유: src/bin/*.rs는 NSIS 인스톨러에 자동 동봉된다.)
use usagemeter_lib::store::db::{apply_session_models_schema, open_db};
use usagemeter_lib::store::queries::{sessions_in_folder, RangeOpts};

fn main() {
    let path = std::env::args().nth(1).expect("usage.db 경로 인자 필요");
    let conn = open_db(std::path::Path::new(&path)).expect("DB 열기 실패");

    let before = column_names(&conn);
    println!("models 컬럼(마이그레이션 전): {}", before.iter().any(|c| c == "models"));

    assert!(apply_session_models_schema(&conn), "마이그레이션 실패");
    let after = column_names(&conn);
    println!("models 컬럼(마이그레이션 후): {}", after.iter().any(|c| c == "models"));
    println!("session_usage 컬럼: {}", after.join(", "));

    let total: i64 =
        conn.query_row("SELECT COUNT(*) FROM session_usage", [], |r| r.get(0)).unwrap();
    println!("세션 행 수(보존 확인): {total}");

    // 실제 조회 경로가 새 컬럼과 함께 동작하는지 — 가장 세션이 많은 폴더로 한 번 질의한다.
    let folder: String = conn
        .query_row(
            "SELECT folder FROM session_usage GROUP BY folder ORDER BY COUNT(*) DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let rows = sessions_in_folder(&conn, &folder, &RangeOpts::default()).expect("조회 실패");
    println!("조회 폴더: {folder} — 세션 {}건", rows.len());
    for row in rows.iter().take(3) {
        println!("  {} models={:?}", row["sessionId"], row["models"]);
    }

    assert!(apply_session_models_schema(&conn), "재실행(멱등) 실패");
    println!("멱등 재실행 OK");
}

fn column_names(conn: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = conn.prepare("PRAGMA table_info(session_usage)").unwrap();
    let names = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
    names.filter_map(Result::ok).collect()
}
