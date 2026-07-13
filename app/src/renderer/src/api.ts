// 렌더러가 메인과 통신하는 유일한 진입점 — 컴포넌트는 window.usagemeter를 직접 만지지 말고
// 이 파일의 named export만 쓴다. 타입은 preload가 노출한 UsagemeterApi 전역 선언(index.d.ts)을
// 그대로 물려받는다 — 여기서 다시 정의하지 않는다(DRY, 드리프트 방지).
import { useEffect, useState } from 'react'
import type { AppState } from '../../main/poller'

export const {
  getState,
  onState,
  refresh,
  openDashboard,
  queryDaily,
  queryFolders,
  queryFolderSessions,
  queryMonthly,
  querySnapshots
} = window.usagemeter

/** 구독 + 초기 getState()를 하나로 묶은 훅 — 언마운트 시 자동 구독 해제. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    let cancelled = false
    void getState().then((initial) => {
      if (!cancelled) setState(initial)
    })
    const unsubscribe = onState((next) => setState(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
