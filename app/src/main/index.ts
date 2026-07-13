// 부팅 배선: 단일 인스턴스 락 → DB/폴러 구성 → 트레이 생성 → (기본) 대시보드 표시.
// --start-minimized(자동시작 인자, settings.ts에서 로그인 시 전달)면 창 없이 트레이만 띄운다.
// v1과 달리 단일 프로세스 이벤트 루프라 스레드 데드락 걱정이 없다 — 종료는 tray.destroy() → app.quit()로 충분.
import { app } from 'electron'
import type { Tray } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createTray } from './tray'
import { Windows } from './windows'
import { formatTooltip } from './tooltip'
import { Poller, type AppState } from './poller'
import { runCcusage } from './ccusage-runner'
import { openDb } from '../store/db'
import { upsertDaily } from '../store/daily'
import { upsertSessions } from '../store/sessions'
import { recordSnapshots } from '../store/snapshots'
import { todayByProvider } from '../store/queries'
import { fetchClaudeLimits } from '../providers/claude/limits'
import { readCodexLimits } from '../providers/codex/limits'
import { normalizeDaily, normalizeSessions } from '../providers/usage-normalizer'
import { makeCwdResolver } from '../providers/codex/cwd'

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
  // DB 경로: 스펙/브리프에 파일명이 명시돼 있지 않아 usage.db로 정함 (task-8-report.md에 플래그).
  const db = openDb(join(app.getPath('userData'), 'usage.db'))
  const codexCwdOf = makeCwdResolver()

  poller = new Poller({
    db,
    fetchClaudeLimits,
    readCodexLimits,
    runCcusage,
    normalizeDaily,
    normalizeSessions,
    codexCwdOf,
    upsertDaily,
    upsertSessions,
    recordSnapshots,
    todayByProvider
  })
  poller.on('state', (state: AppState) => {
    tray?.setToolTip(formatTooltip(state))
  })

  tray = createTray({
    onOpenPopup: () => windows.showPopup(),
    onOpenDashboard: () => windows.showDashboard(),
    onRefresh: () => void poller?.refreshNow(),
    onQuit: () => quit()
  })

  poller.start()

  if (!startMinimized) {
    windows.showDashboard()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windows.showPopup()
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
