// 팝업(트레이 근처, frameless, blur 시 자동 숨김)과 대시보드(일반 창, 이미 있으면 focus) 관리.
// 렌더러는 아직 Task 9/10에서 IPC·?mode= 분기가 붙기 전까지는 템플릿 데모 화면 그대로 뜬다.
import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

const POPUP_WIDTH = 356
const POPUP_HEIGHT = 480 // 임시값 — Task 10에서 실콘텐츠 높이로 조정
const DASHBOARD_WIDTH = 960
const DASHBOARD_HEIGHT = 680

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function loadRenderer(win: BrowserWindow, mode: 'popup' | 'dashboard'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    win.loadURL(`${devUrl}?mode=${mode}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode } })
  }
}

/** 팝업/대시보드 BrowserWindow 생성·재사용·배치를 담당한다. */
export class Windows {
  private popupWin: BrowserWindow | null = null
  private dashboardWin: BrowserWindow | null = null

  /** 팝업 위치 계산에 트레이 아이콘의 현재 화면 좌표가 필요해 지연 조회 함수로 주입받는다. */
  constructor(private readonly getTrayBounds: () => Rectangle) {}

  private popupPosition(trayBounds: Rectangle): { x: number; y: number } {
    const trayCenter = {
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2
    }
    const { workArea } = screen.getDisplayNearestPoint(trayCenter)
    const rawX = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2)
    const rawY = Math.round(trayBounds.y - POPUP_HEIGHT) // Windows 작업표시줄은 보통 하단 — 트레이 위로 띄운다
    const x = Math.min(Math.max(rawX, workArea.x), workArea.x + workArea.width - POPUP_WIDTH)
    const y = Math.min(Math.max(rawY, workArea.y), workArea.y + workArea.height - POPUP_HEIGHT)
    return { x, y }
  }

  /** 팝업이 보이면 숨기고, 숨겨져 있거나 없으면 트레이 근처에 띄운다(좌클릭 토글). */
  showPopup(): void {
    if (this.popupWin && !this.popupWin.isDestroyed()) {
      if (this.popupWin.isVisible()) {
        this.popupWin.hide()
        return
      }
      const { x, y } = this.popupPosition(this.getTrayBounds())
      this.popupWin.setPosition(x, y)
      this.popupWin.show()
      this.popupWin.focus()
      return
    }
    const { x, y } = this.popupPosition(this.getTrayBounds())
    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x,
      y,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: { preload: preloadPath(), sandbox: false }
    })
    loadRenderer(win, 'popup')
    win.on('ready-to-show', () => win.show())
    win.on('blur', () => win.hide())
    win.on('closed', () => {
      this.popupWin = null
    })
    this.popupWin = win
  }

  /** 대시보드가 이미 떠 있으면 focus만, 없으면 새로 만든다. */
  showDashboard(): void {
    if (this.dashboardWin && !this.dashboardWin.isDestroyed()) {
      this.dashboardWin.show()
      this.dashboardWin.focus()
      return
    }
    const win = new BrowserWindow({
      width: DASHBOARD_WIDTH,
      height: DASHBOARD_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      webPreferences: { preload: preloadPath(), sandbox: false }
    })
    loadRenderer(win, 'dashboard')
    win.on('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.dashboardWin = null
    })
    this.dashboardWin = win
  }

  /** 종료 경로에서 호출 — 열린 창을 정리한다 (v1 데드락 없음, 단순 destroy로 충분). */
  destroyAll(): void {
    this.popupWin?.destroy()
    this.dashboardWin?.destroy()
  }
}
