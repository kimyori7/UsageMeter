// 렌더러가 메인과 통신하는 유일한 진입점 — 컴포넌트는 window.usagemeter를 직접 만지지 말고
// 이 파일의 named export만 쓴다. 타입은 preload가 노출한 UsagemeterApi 전역 선언(index.d.ts)을
// 그대로 물려받는다 — 여기서 다시 정의하지 않는다(DRY, 드리프트 방지).
import { useEffect, useState } from 'react'
import type { AppState } from '../../main/poller'

// preload가 실패했거나(contextBridge.exposeInMainWorld throw) contextIsolation이 꺼진 채 로드된 경우
// window.usagemeter가 없다 — 아래 구조 분해가 그냥 실행되면 "Cannot destructure property 'getState' of
// undefined"처럼 원인을 알 수 없는 TypeError로 백색 화면만 남는다. 여기서 먼저 걸러 원인이 드러나는
// 에러로 바꾼다(복구 로직은 없음 — preload 배선 자체가 깨진 상황이라 렌더러가 스스로 고칠 수 없다).
if (!window.usagemeter) {
  throw new Error(
    'window.usagemeter가 없습니다 — preload 스크립트 로드 또는 contextBridge 노출에 실패했습니다.'
  )
}

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
