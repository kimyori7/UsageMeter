// 트레이 아이콘 생성 + 우클릭 메뉴(열기/대시보드/새로고침/종료). 좌클릭은 팝업 토글.
// 아이콘 경로: dev는 프로젝트 소스 트리의 resources/icon.ico, 패키지는 process.resourcesPath
// (electron-builder가 resources/icon.ico를 리소스 루트에 배치하도록 Task 12에서 보장해야 한다).
import { Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export interface TrayCallbacks {
  /** 좌클릭 — 팝업 토글(보이면 숨김). */
  onTogglePopup: () => void
  /** 메뉴 '열기' — 팝업 표시 보장(절대 숨기지 않음). 명시적 '열기'가 닫기로 동작하면 안 된다. */
  onOpenPopup: () => void
  onOpenDashboard: () => void
  onRefresh: () => void
  onQuit: () => void
}

function iconPath(): string {
  return is.dev
    ? join(__dirname, '../../resources/icon.ico')
    : join(process.resourcesPath, 'icon.ico')
}

export function createTray(opts: TrayCallbacks): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath()))
  tray.setToolTip('UsageMeter')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: () => opts.onOpenPopup() },
      { label: '대시보드', click: () => opts.onOpenDashboard() },
      { label: '새로고침', click: () => opts.onRefresh() },
      { type: 'separator' },
      { label: '종료', click: () => opts.onQuit() }
    ])
  )
  tray.on('click', () => opts.onTogglePopup())
  return tray
}
