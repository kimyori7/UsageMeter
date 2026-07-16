# UsageMeter

Claude Code/Codex 사용량과 한도(rate limit) 상태를 트레이에서 보여주는 상주형 Windows 앱.

v2.0.0부터 Tauri 앱이다 — 실제 소스는 [`app-tauri/`](app-tauri/)에 있다. 이전 세대인
Electron 버전(v1.x)은 [`app/`](app/), 최초의 Python 버전(v0.1)은 [`legacy/`](legacy/)에
보존만 되어 있고 더는 유지보수하지 않는다.

## 개발 실행

    cd app-tauri
    npm install
    npx tauri dev

## 패키징 (Windows 설치 파일)

    cd app-tauri
    npx tauri build

결과물은 `app-tauri/src-tauri/target/release/bundle/nsis/UsageMeter_<version>_x64-setup.exe`
(NSIS 인스톨러, 사이드카 ccusage.exe 동봉).

## 데이터

사용 기록은 SQLite(`%APPDATA%/UsageMeter/usage.db`)에 영구 보존된다. 일별/세션별 사용량뿐 아니라
한도(rate limit) 스냅샷 이력도 같은 DB에 기록되어, 대시보드 개요 탭에서 시간에 따른 한도 소진
추이를 확인할 수 있다. v1(Electron)과 데이터 디렉터리·스키마가 호환되므로 이관 작업 없이
그대로 이어서 쓴다.
