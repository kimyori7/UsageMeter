// 팝업(트레이 근처, frameless, blur 시 자동 숨김)과 대시보드(일반 창, 이미 있으면 focus) 관리.
// 렌더러는 ?mode=popup|dashboard로 분기해 실제 화면을 그린다(Task 10) — 대시보드는 아직 placeholder(Task 11).
import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

const POPUP_WIDTH = 356
// 초기 높이일 뿐 — 로드 직후 렌더러가 콘텐츠 높이를 보고하면(popup:resize) content-fit으로 조정된다.
const POPUP_HEIGHT = 400
// 렌더러 보고값 클램프 범위 — 비정상 값(0·거대값)이 와도 창이 사라지거나 화면을 덮지 않게 방어한다.
const POPUP_MIN_HEIGHT = 180
const POPUP_MAX_HEIGHT = 560
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

  private popupPosition(trayBounds: Rectangle, height: number): { x: number; y: number } {
    const trayCenter = {
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2
    }
    const { workArea } = screen.getDisplayNearestPoint(trayCenter)
    const rawX = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2)
    const rawY = Math.round(trayBounds.y - height) // Windows 작업표시줄은 보통 하단 — 트레이 위로 띄운다
    const x = Math.min(Math.max(rawX, workArea.x), workArea.x + workArea.width - POPUP_WIDTH)
    const y = Math.min(Math.max(rawY, workArea.y), workArea.y + workArea.height - height)
    return { x, y }
  }

  /** 팝업이 보이면 숨기고, 숨겨져 있거나 없으면 띄운다 — 트레이 좌클릭 전용 토글. */
  showPopup(): void {
    if (this.popupWin && !this.popupWin.isDestroyed() && this.popupWin.isVisible()) {
      this.popupWin.hide()
      return
    }
    this.ensurePopupShown()
  }

  /** 팝업을 반드시 표시·포커스한다 — 절대 숨기지 않는다 (second-instance, 트레이 메뉴 '열기'). */
  ensurePopupShown(): void {
    if (this.popupWin && !this.popupWin.isDestroyed()) {
      // content-fit으로 조정된 현재 높이를 기준으로 재배치한다 — 초기 상수로 되돌리면 위치가 어긋난다.
      const { x, y } = this.popupPosition(this.getTrayBounds(), this.popupWin.getBounds().height)
      this.popupWin.setPosition(x, y)
      this.popupWin.show()
      this.popupWin.focus()
      return
    }
    const { x, y } = this.popupPosition(this.getTrayBounds(), POPUP_HEIGHT)
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

  /**
   * 렌더러가 보고한 콘텐츠 높이(popup:resize)로 팝업 창을 content-fit한다.
   * sender가 팝업 창의 webContents일 때만 동작 — 대시보드(또는 다른 어떤 창)가 이 채널로
   * 팝업을 리사이즈하는 것을 막는다. 높이는 MIN/MAX로 클램프하고, 변화가 없으면 no-op,
   * 변하면 트레이 기준 배치를 다시 계산해 작업영역 밖으로 밀리지 않게 재클램프한다.
   */
  resizePopup(sender: WebContents, contentHeight: number): void {
    const win = this.popupWin
    if (!win || win.isDestroyed() || win.webContents !== sender) return
    const height = Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, Math.ceil(contentHeight)))
    if (win.getBounds().height === height) return
    const { x, y } = this.popupPosition(this.getTrayBounds(), height)
    win.setBounds({ x, y, width: POPUP_WIDTH, height })
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
