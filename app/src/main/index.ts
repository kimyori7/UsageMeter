// 부팅 배선: 단일 인스턴스 락 → DB/폴러 구성 → 트레이 생성. 부팅 시 창은 열지 않는다(트레이 상주) —
// 창은 트레이 좌클릭(팝업 토글)/메뉴(열기·대시보드)/second-instance(팝업 표시 보장)로만 연다.
// v1과 달리 단일 프로세스 이벤트 루프라 스레드 데드락 걱정이 없다 — 종료는 tray.destroy() → app.quit()로 충분.
import { app, net } from 'electron'
import type { Tray } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createTray } from './tray'
import { Windows } from './windows'
import { formatTooltip } from './tooltip'
import { registerIpc } from './ipc'
import { Poller, type AppState } from './poller'
import { loadSettings } from './settings'
import { runCcusage } from './ccusage-runner'
import { openDb, applyMultiAccountSchema } from '../store/db'
import { upsertDaily } from '../store/daily'
import { upsertSessions } from '../store/sessions'
import { recordSnapshots } from '../store/snapshots'
import { todayByProvider } from '../store/queries'
import { fetchClaudeLimits } from '../providers/claude/limits'
import { readCodexLimits } from '../providers/codex/limits'
import { normalizeDaily, normalizeSessions } from '../providers/usage-normalizer'
import { makeCwdResolver } from '../providers/codex/cwd'
import { createVault } from './account-vault'
import { runAccountsCycle } from './accounts-cycle'
import { fetchCodexUsage } from '../providers/codex/usage-api'
import { readCodexAuth, DEFAULT_CODEX_AUTH_PATH } from '../providers/codex/auth'
import { readClaudeAccount } from '../providers/claude/account'
import { ensureFreshToken } from '../providers/claude/refresh'
import { DEFAULT_CRED_PATH } from '../providers/claude/credentials'

const startMinimized = process.argv.includes('--start-minimized')

let tray: Tray | null = null
const windows = new Windows(() => {
  if (!tray) throw new Error('tray not initialized')
  return tray.getBounds()
})
let poller: Poller | null = null

function quit(): void {
  poller?.stop()
  windows.destroyAll()
  tray?.destroy()
  app.quit()
}

function boot(): void {
  // 기본 부팅도 트레이만 띄우고 창은 자동으로 열지 않는다(Step4 수동검증 흐름과 일치) — 따라서
  // --start-minimized는 현재 동작상 no-op이지만, 자동시작(Task 11) 설정과의 인자 계약은 유지해 둔다.
  if (startMinimized) {
    console.log('[UsageMeter] started with --start-minimized (tray-only boot, same as default)')
  }
  // DB 경로: 스펙/브리프에 파일명이 명시돼 있지 않아 usage.db로 정함 (task-8-report.md에 플래그).
  const db = openDb(join(app.getPath('userData'), 'usage.db'))
  const codexCwdOf = makeCwdResolver()

  // 기업 프록시 MITM 인증서(스펙 F7) 때문에 실호출은 OS 인증서 저장소를 쓰는 크로미움 스택(net.fetch)으로.
  const netFetch = ((input: string | URL | Request, init?: RequestInit) =>
    net.fetch(input as string, init)) as typeof fetch
  const multiAccount = applyMultiAccountSchema(db)
  if (!multiAccount)
    console.error('[UsageMeter] multi-account schema migration failed — feature disabled')
  const vault = createVault(join(app.getPath('userData'), 'accounts'))
  const cycleDeps = {
    db,
    vault,
    claude: {
      credPath: DEFAULT_CRED_PATH,
      readAccount: readClaudeAccount,
      ensureToken: (credPath: string) => ensureFreshToken({ credPath, fetchFn: netFetch }),
      fetchLimits: (token: string | null) => fetchClaudeLimits({ token, fetchFn: netFetch })
    },
    codex: {
      authPath: DEFAULT_CODEX_AUTH_PATH,
      readVaultAuth: (vaultPath: string) => readCodexAuth(vaultPath),
      fetchUsage: (auth: import('../providers/codex/auth').CodexAuth) =>
        fetchCodexUsage({ auth, fetchFn: netFetch })
    }
  }

  // 설정 화면(Task 11)의 폴링 주기는 실행 중 실시간 반영하지 않고(YAGNI), 부팅 시 여기서 1회 읽어
  // Poller 생성 인자로 넘긴다 — SettingsPane의 "재시작 후 적용" 안내 문구가 실제로 참이 되도록.
  const settings = loadSettings()
  poller = new Poller(
    {
      db,
      fetchClaudeLimits: () => fetchClaudeLimits({ fetchFn: netFetch }),
      readCodexLimits,
      fetchCodexUsage: () => fetchCodexUsage({ fetchFn: netFetch }),
      accountsCycle: multiAccount ? (active) => runAccountsCycle(cycleDeps, active) : undefined,
      runCcusage,
      normalizeDaily,
      normalizeSessions,
      codexCwdOf,
      upsertDaily,
      upsertSessions,
      recordSnapshots,
      todayByProvider
    },
    { limitsMs: settings.limitsIntervalSec * 1000, usageMs: settings.usageIntervalMin * 60_000 }
  )
  poller.on('state', (state: AppState) => {
    tray?.setToolTip(formatTooltip(state))
  })
  registerIpc({ db, poller, windows })

  tray = createTray({
    onTogglePopup: () => windows.showPopup(),
    onOpenPopup: () => windows.ensurePopupShown(),
    onOpenDashboard: () => windows.showDashboard(),
    onRefresh: () => void poller?.refreshNow(),
    onQuit: () => quit()
  })

  poller.start()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 계약은 "팝업 표시"(보장)지 토글이 아니다 — 이미 떠 있으면 숨기지 말고 앞으로 가져온다.
    // 부팅(트레이 생성) 전에 이벤트가 오면 getTrayBounds()가 throw하므로 무시한다(uncaught 방지).
    if (tray) windows.ensurePopupShown()
  })

  // 트레이 상주 앱: 모든 창이 닫혀도(대시보드 닫기 등) 앱은 종료하지 않는다 — 종료는 트레이 메뉴로만.
  app.on('window-all-closed', () => {})

  app
    .whenReady()
    .then(() => {
      electronApp.setAppUserModelId('cc.kimyori.usagemeter')
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })
      boot()
    })
    .catch((err: unknown) => {
      // boot() 실패(DB 오픈 등)를 삼키지 않는다 — 안 그러면 트레이도 창도 없는 유령 프로세스로 남는다.
      console.error('[UsageMeter] boot failed:', err)
      app.quit()
    })
}
