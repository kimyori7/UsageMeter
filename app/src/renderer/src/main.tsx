import './theme.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Popup from './popup/Popup'

/** main/windows.ts가 각 창을 `?mode=popup|dashboard` 쿼리로 로드한다 — 기본값은 popup. */
function currentMode(): 'popup' | 'dashboard' {
  return new URLSearchParams(window.location.search).get('mode') === 'dashboard'
    ? 'dashboard'
    : 'popup'
}

// 대시보드 화면은 Task 11 구현 — 지금은 자리만 표시하는 최소 placeholder.
const view =
  currentMode() === 'dashboard' ? (
    <div className="dashboard-placeholder">대시보드 (Task 11에서 구현)</div>
  ) : (
    <Popup />
  )

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
