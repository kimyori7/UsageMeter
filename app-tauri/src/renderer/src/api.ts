// 렌더러가 뒷단과 통신하는 유일한 진입점 — named export 표면은 v1과 동일하게 유지한다.
// 실전: Tauri invoke/listen. 하네스(VITE_HARNESS=1): v1과 동일하게 window.usagemeter 전역을
// 사용해 기존 shim.js 스크린샷 하네스를 그대로 재사용한다.
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppState } from '../../main/poller'
import type { Settings } from '../../main/settings'
import type { ProviderId, SessionRow, WindowKind } from '../../providers/types'

export interface DailyTotalRow {
  date: string
  provider: ProviderId
  costUsd: number
  totalTokens: number
}
export interface FolderRollupRow {
  folder: string
  providers: ProviderId[]
  costUsd: number
  totalTokens: number
}
export interface MonthlyRow {
  month: string
  provider: ProviderId
  model: string
  costUsd: number
  totalTokens: number
}
export interface SnapshotPoint {
  ts: number
  usedPercent: number
}
export interface RangeOpts {
  from?: string
  to?: string
  providers?: ProviderId[]
}

export interface UsagemeterApi {
  getState: () => Promise<AppState>
  onState: (cb: (state: AppState) => void) => () => void
  refresh: () => Promise<void>
  openDashboard: () => Promise<void>
  resizePopup: (height: number) => void
  queryDaily: (opts?: RangeOpts) => Promise<DailyTotalRow[]>
  queryFolders: (opts?: RangeOpts) => Promise<FolderRollupRow[]>
  queryFolderSessions: (folder: string, opts?: RangeOpts) => Promise<SessionRow[]>
  queryMonthly: () => Promise<MonthlyRow[]>
  querySnapshots: (opts: {
    provider: ProviderId
    window: WindowKind
    from: number
  }) => Promise<SnapshotPoint[]>
  getSettings: () => Promise<Settings>
  setSettings: (settings: Settings) => Promise<Settings>
}

const tauriApi: UsagemeterApi = {
  getState: () => invoke<AppState>('get_state'),
  onState: (cb) => {
    // listen은 비동기로 등록된다 — 등록 완료 전에 해제가 불리면 등록 즉시 풀도록 방어한다.
    let unlisten: (() => void) | null = null
    let cancelled = false
    listen<AppState>('state', (event) => cb(event.payload)).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  },
  refresh: () => invoke('refresh'),
  openDashboard: () => invoke('open_dashboard'),
  resizePopup: (height) => {
    void invoke('resize_popup', { height })
  },
  queryDaily: (opts) => invoke('query_daily', { opts: opts ?? {} }),
  queryFolders: (opts) => invoke('query_folders', { opts: opts ?? {} }),
  queryFolderSessions: (folder, opts) =>
    invoke('query_folder_sessions', { folder, opts: opts ?? {} }),
  queryMonthly: () => invoke('query_monthly'),
  querySnapshots: (opts) => invoke('query_snapshots', { opts }),
  getSettings: () => invoke<Settings>('get_settings'),
  setSettings: (settings) => invoke<Settings>('set_settings', { settings })
}

// 하네스 모드: 빌드 타임 상수라 실전 번들에서는 이 분기가 제거된다(tree-shaking).
const api: UsagemeterApi =
  import.meta.env.VITE_HARNESS === '1' && window.usagemeter ? window.usagemeter : tauriApi

export const {
  getState,
  onState,
  refresh,
  openDashboard,
  resizePopup,
  queryDaily,
  queryFolders,
  queryFolderSessions,
  queryMonthly,
  querySnapshots,
  getSettings,
  setSettings
} = api

/**
 * 구독 + 초기 getState()를 하나로 묶은 훅 — v1과 동일한 push-wins 의미론.
 * onState 구독을 초기 getState()보다 먼저 걸어, 초기 조회가 늦는 동안 push가 먼저 왔다면
 * 뒤늦은 초기값으로 덮어쓰지 않는다.
 */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    let pushed = false
    const unsubscribe = onState((next) => {
      pushed = true
      setState(next)
    })
    getState()
      .then((initial) => {
        if (!pushed) setState(initial)
      })
      .catch(() => {
        // 초기 조회 실패 — push가 오면 정상 복구되므로 unhandled rejection만 막는다.
      })
    return unsubscribe
  }, [])

  return state
}
