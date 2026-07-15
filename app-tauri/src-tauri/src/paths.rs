// 데이터 디렉터리 해석. v1(Electron productName "UsageMeter")과 같은 %APPDATA%\UsageMeter 를 쓴다 —
// 무이관 호환의 뿌리. Tauri 기본 app_data_dir(identifier 기반)를 쓰면 다른 폴더가 되므로 금지.
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").expect("APPDATA 없음");
    PathBuf::from(appdata).join("UsageMeter")
}
