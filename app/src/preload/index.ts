// contextBridge로 렌더러에 노출하는 유일한 창구. ipcRenderer 자체나 @electron-toolkit/preload의
// electronAPI(raw ipcRenderer 포함)는 절대 노출하지 않는다 — 렌더러는 타입 붙은 usagemeter API로만
// 메인과 통신한다(보안: contextIsolation 유지, 토큰류 데이터는 어떤 채널 payload에도 실리지 않음).
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/channels'
import type { AppState } from '../main/poller'
import type {
  dailyTotals,
  folderRollup,
  monthlyRollup,
  sessionsInFolder,
  snapshotSeries
} from '../store/queries'

type DailyOpts = Parameters<typeof dailyTotals>[1]
type DailyRow = ReturnType<typeof dailyTotals>[number]
type FolderOpts = Parameters<typeof folderRollup>[1]
type FolderRollupRow = ReturnType<typeof folderRollup>[number]
type FolderSessionsOpts = Parameters<typeof sessionsInFolder>[2]
type SessionRow = ReturnType<typeof sessionsInFolder>[number]
type MonthlyRow = ReturnType<typeof monthlyRollup>[number]
type SnapshotOpts = Parameters<typeof snapshotSeries>[1]
type SnapshotPoint = ReturnType<typeof snapshotSeries>[number]

const usagemeter = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(CHANNELS.stateGet),
  /** 구독 등록, 해제 함수를 반환한다 — 렌더러 쪽 useEffect 클린업에서 호출. */
  onState: (cb: (state: AppState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => cb(state)
    ipcRenderer.on(CHANNELS.statePush, listener)
    return () => ipcRenderer.removeListener(CHANNELS.statePush, listener)
  },
  refresh: (): Promise<void> => ipcRenderer.invoke(CHANNELS.actionRefresh),
  openDashboard: (): Promise<void> => ipcRenderer.invoke(CHANNELS.actionOpenDashboard),
  /** 팝업 콘텐츠 높이 보고(fire-and-forget) — 메인이 sender 검증·클램프 후 팝업 창만 리사이즈한다. */
  resizePopup: (height: number): void => {
    ipcRenderer.send(CHANNELS.popupResize, height)
  },
  queryDaily: (opts?: DailyOpts): Promise<DailyRow[]> =>
    ipcRenderer.invoke(CHANNELS.queryDaily, opts),
  queryFolders: (opts?: FolderOpts): Promise<FolderRollupRow[]> =>
    ipcRenderer.invoke(CHANNELS.queryFolders, opts),
  queryFolderSessions: (folder: string, opts?: FolderSessionsOpts): Promise<SessionRow[]> =>
    ipcRenderer.invoke(CHANNELS.queryFolderSessions, folder, opts),
  queryMonthly: (): Promise<MonthlyRow[]> => ipcRenderer.invoke(CHANNELS.queryMonthly),
  querySnapshots: (opts: SnapshotOpts): Promise<SnapshotPoint[]> =>
    ipcRenderer.invoke(CHANNELS.querySnapshots, opts)
}

export type UsagemeterApi = typeof usagemeter

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('usagemeter', usagemeter)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation은 항상 켜져 있어야 하는 보안 요구사항이지만, 꺼진 채 실행되는 사고를 대비해
  // 전역에라도 최소 동작하도록 방어적으로 유지한다.
  // @ts-ignore (define in dts)
  window.usagemeter = usagemeter
}
