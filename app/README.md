# UsageMeter

Claude Code / Codex CLI 사용량을 트레이에서 보여주는 상주형 Electron 앱 (Windows 11 전용).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

## Test

```bash
npm test
```

better-sqlite3 ABI 주의사항은 아래 참조 — `npm test` 실패 시 가장 먼저 `npm rebuild better-sqlite3`.

## Build (Windows NSIS 설치본)

```bash
npm run build:win
```

`app/dist/UsageMeter-Setup-<version>.exe` (설치본) + `app/dist/win-unpacked/UsageMeter.exe` (압축 해제 실행본, 설치 없이 바로 실행 가능)가 생성된다. 

## Native module note (better-sqlite3)

`better-sqlite3`는 특정 ABI(Node/Electron 런타임별로 다름)로 컴파일된 네이티브 모듈이다. `vitest`는 **시스템 Node** ABI로 돌고, `npm run dev`/패키징은 **Electron** ABI가 필요해 두 상태가 충돌한다.

- 테스트 전: `npm rebuild better-sqlite3` (시스템 Node ABI로 재빌드)
- 앱 실행/패키징 전: `npx electron-rebuild -f -m . -w better-sqlite3` (Electron ABI로 강제 재빌드 — `electron-builder install-app-deps`가 조용히 no-op할 때가 있어 이쪽이 더 안정적)

`npm install` 직후 `npm test`가 better-sqlite3를 못 읽으면 `npm rebuild better-sqlite3` 후 재시도.

## Packaging notes (Task 12)

- `ccusage`는 CLI 전용 패키지이며 v20부터 실제 구현이 플랫폼별 네이티브 바이너리(`@ccusage/ccusage-win32-x64` 등)다. `electron-builder.yml`의 `asarUnpack`에 `node_modules/@ccusage/**`가 반드시 포함되어야 하며, `ccusage-runner.ts`가 그 바이너리의 asar 가상경로를 `app.asar.unpacked`로 치환해 직접 실행한다.
- 트레이 아이콘은 패키지 상태에서 `process.resourcesPath/icon.ico`를 읽는다 — `electron-builder.yml`의 `extraResources`가 `resources/icon.ico`를 리소스 루트로 복사한다.
- 자동시작은 `app.setLoginItemSettings`(설정 화면에서 토글) — 별도 태스크 스케줄러/레지스트리 직접 조작 없음.
