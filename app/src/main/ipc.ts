// 렌더러 ↔ 메인 IPC 배선의 유일한 등록 지점. 여기서 만드는 각 핸들러는 poller/queries/windows의
// 얇은 위임일 뿐 — 비즈니스 로직은 없다(순수 배선). 채널명은 shared/channels.ts의 상수만 쓴다
// (preload/index.ts와 여기서 동일한 상수를 import — 문자열 중복 타이핑 금지).
import { BrowserWindow, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { CHANNELS } from '../shared/channels'
import type { AppState, Poller } from './poller'
import type { Windows } from './windows'
import {
  dailyTotals,
  folderRollup,
  monthlyRollup,
  sessionsInFolder,
  snapshotSeries
} from '../store/queries'

export interface IpcDeps {
  db: Database.Database
  poller: Poller
  windows: Pick<Windows, 'showDashboard' | 'resizePopup'>
}

/**
 * main↔renderer IPC 핸들러를 등록한다. 부팅 시 1회만 호출된다(index.ts) — poller/tray 리스너와
 * 마찬가지로 앱 생명주기 동안 해제하지 않는다(quit()에서 프로세스가 통째로 종료되므로 불필요).
 */
export function registerIpc(deps: IpcDeps): void {
  const { db, poller, windows } = deps

  ipcMain.handle(CHANNELS.stateGet, () => poller.getState())
  ipcMain.handle(CHANNELS.actionRefresh, () => poller.refreshNow())
  ipcMain.handle(CHANNELS.actionOpenDashboard, () => windows.showDashboard())

  // 팝업 content-fit 높이 보고(fire-and-forget send). 값 검증은 여기서 최소(유한 숫자만),
  // sender가 팝업 창인지의 권한 검증과 클램프·no-op 스킵은 windows.resizePopup 책임.
  ipcMain.on(CHANNELS.popupResize, (event, height: unknown) => {
    if (typeof height === 'number' && Number.isFinite(height)) {
      windows.resizePopup(event.sender, height)
    }
  })

  ipcMain.handle(CHANNELS.queryDaily, (_event, opts?: Parameters<typeof dailyTotals>[1]) =>
    dailyTotals(db, opts)
  )
  ipcMain.handle(CHANNELS.queryFolders, (_event, opts?: Parameters<typeof folderRollup>[1]) =>
    folderRollup(db, opts)
  )
  ipcMain.handle(
    CHANNELS.queryFolderSessions,
    (_event, folder: string, opts?: Parameters<typeof sessionsInFolder>[2]) =>
      sessionsInFolder(db, folder, opts)
  )
  ipcMain.handle(CHANNELS.queryMonthly, () => monthlyRollup(db))
  ipcMain.handle(CHANNELS.querySnapshots, (_event, opts: Parameters<typeof snapshotSeries>[1]) =>
    snapshotSeries(db, opts)
  )

  // 폴러는 매 틱(limits 60s / usage 5min)마다 'state' 이벤트를 낸다 — 변경 감지 없이 매번 push한다.
  // (렌더러 재렌더 비용은 낮고, dedup은 이번 태스크 범위 밖 — 필요해지면 이전 상태와 얕은 비교 추가.)
  poller.on('state', (state: AppState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.statePush, state)
    }
  })
}
