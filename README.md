# UsageMeter

Claude Code / Codex 사용량과 한도(rate limit) 상태를 Windows 트레이에서 보여주는 상주형 앱.

- 트레이 팝업에서 프로바이더별 5시간 세션·주간 한도 게이지 확인
- 대시보드에서 일별·월별 비용, 폴더별·세션별 사용량, 한도 소진 추이 확인
- 사용 기록은 로컬 SQLite에 영구 보존 (외부로 전송하지 않음)

## 설치 (사용자)

1. [Releases](https://github.com/kimyori7/UsageMeter/releases/latest)에서
   `UsageMeter_<version>_x64-setup.exe`를 내려받는다.
2. 실행해 설치한다. 설치 후 트레이 아이콘이 생기고, 좌클릭하면 팝업이 열린다.

요구 사항: Windows 10/11 64비트. WebView2 런타임이 필요한데 Windows 11에는 기본 포함돼 있고,
없는 경우 설치 관리자가 설치 중에 내려받아 함께 설치한다(설치 시 인터넷 연결 필요).

한도·사용량을 읽으려면 Claude Code 또는 Codex CLI로 **이미 로그인돼 있어야 한다** — 이 앱은
각 CLI가 로컬에 저장해 둔 인증 정보를 읽어 해당 계정의 한도를 조회한다. 별도 로그인 절차는 없다.

## 개발 실행

사전 준비: [Node.js](https://nodejs.org/) 22 이상, [Rust 툴체인](https://rustup.rs/),
Visual Studio Build Tools(C++ 데스크톱 개발 워크로드).

    cd app-tauri
    npm install
    npx tauri dev

`npm install`이 먼저 끝나야 한다 — 빌드 스크립트(`src-tauri/build.rs`)가 npm 패키지에서
ccusage 사이드카 실행 파일을 `src-tauri/binaries/`로 복사하며, 없으면 빌드가 중단된다.

테스트:

    cd app-tauri
    npm test          # 프론트엔드 (vitest)
    cd src-tauri && cargo test

## 패키징 (Windows 설치 파일)

    cd app-tauri
    npx tauri build

결과물은 `app-tauri/src-tauri/target/release/bundle/nsis/UsageMeter_<version>_x64-setup.exe`
(NSIS 인스톨러, 사이드카 ccusage.exe 동봉).

## 데이터

사용 기록은 SQLite(`%APPDATA%/UsageMeter/usage.db`)에 영구 보존된다. 일별/세션별 사용량뿐 아니라
한도(rate limit) 스냅샷 이력도 같은 DB에 기록되어, 대시보드 개요 탭에서 시간에 따른 한도 소진
추이를 확인할 수 있다.

## 저장소 구조

v2.0.0부터 Tauri 앱이다 — 실제 소스는 [`app-tauri/`](app-tauri/)에 있다. 이전 세대인
Electron 버전(v1.x)은 [`app/`](app/), 최초의 Python 버전(v0.1)은 [`legacy/`](legacy/)에
보존만 되어 있고 더는 유지보수하지 않는다. v1과 데이터 디렉터리·스키마가 호환되므로 이관 작업
없이 그대로 이어서 쓴다.

## 라이선스

[MIT](LICENSE)
