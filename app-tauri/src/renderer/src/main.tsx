import './theme.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Popup from './popup/Popup'
import Dashboard from './dashboard/Dashboard'

/** main/windows.ts가 각 창을 `?mode=popup|dashboard` 쿼리로 로드한다 — 기본값은 popup. */
function currentMode(): 'popup' | 'dashboard' {
  return new URLSearchParams(window.location.search).get('mode') === 'dashboard'
    ? 'dashboard'
    : 'popup'
}

const view = currentMode() === 'dashboard' ? <Dashboard /> : <Popup />

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
