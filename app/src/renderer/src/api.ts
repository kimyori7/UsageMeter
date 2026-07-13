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

/**
 * 구독 + 초기 getState()를 하나로 묶은 훅 — 언마운트 시 자동 구독 해제.
 * push-wins: onState 구독을 초기 getState() 호출보다 먼저 걸어 두므로, 초기 조회가 늦게 끝나는 동안
 * 이미 push가 한 번 와 있었다면(pushed=true) 그 뒤늦은 초기값으로 덮어쓰지 않는다(최신 값 유지).
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
        // 초기 조회 실패 — push가 오면 정상 복구되므로 여기서는 unhandled rejection만 막는다.
      })
    return unsubscribe
  }, [])

  return state
}
