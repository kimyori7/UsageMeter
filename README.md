# UsageMeter

Claude Code/Codex 사용량과 한도(rate limit) 상태를 트레이에서 보여주는 상주형 Windows 앱.

v2부터 Electron 앱으로 재작성됐다 — 실제 소스는 [`app/`](app/)에 있다. v1(Python + customtkinter +
pystray)은 [`legacy/`](legacy/)에 보존만 되어 있고 더는 유지보수하지 않는다.

## 개발 실행

    cd app
    npm install
    npm run dev

## 패키징 (Windows 설치 파일)

    cd app
    npm run build:win

결과물은 `app/dist/UsageMeter-Setup-<version>.exe` (NSIS 인스톨러).

## 데이터

사용 기록은 SQLite(`%APPDATA%/UsageMeter/usage.db`)에 영구 보존된다. 일별/세션별 사용량뿐 아니라
한도(rate limit) 스냅샷 이력도 같은 DB에 기록되어, 대시보드 개요 탭에서 시간에 따른 한도 소진
추이를 확인할 수 있다.
