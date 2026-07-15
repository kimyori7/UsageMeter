use std::path::Path;

// ccusage 사이드카: npm 패키지(@ccusage/ccusage-win32-x64)의 네이티브 exe를 tauri externalBin
// 위치(binaries/ccusage-<target-triple>.exe)로 복사한다. tauri CLI가 dev에선 target/<profile>/,
// 번들에선 앱 exe 옆에 이 파일을 ccusage.exe로 배치한다. 바이너리는 커밋하지 않으므로(3.4MB)
// cargo build/test 전에 여기서 존재를 보장한다.
const NPM_SOURCE: &str = "../node_modules/@ccusage/ccusage-win32-x64/bin/ccusage.exe";

fn main() {
    let target = std::env::var("TARGET").expect("cargo가 TARGET을 제공한다");
    let dest_path = format!("binaries/ccusage-{target}.exe");
    let dest = Path::new(&dest_path);
    let src = Path::new(NPM_SOURCE);
    if src.exists() {
        std::fs::create_dir_all("binaries").expect("binaries/ 생성 실패");
        // 매번 덮어써서 npm update 시 새 바이너리가 자동 반영되게 한다(3.4MB 복사 — 무시 가능).
        std::fs::copy(src, dest).expect("ccusage.exe 복사 실패");
    } else if !dest.exists() {
        panic!("ccusage 사이드카 없음 — app-tauri에서 npm install을 먼저 실행하세요 ({NPM_SOURCE})");
    }
    println!("cargo:rerun-if-changed={NPM_SOURCE}");
    tauri_build::build()
}
