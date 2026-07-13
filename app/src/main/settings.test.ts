import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// electron 모듈만 목(mock) — 파일 IO는 실제 임시 디렉터리에서 수행한다(절대 %APPDATA% 건드리지 않음).
// getPath는 beforeEach에서 mockReturnValue로 매 테스트 새 임시 디렉터리를 가리키게 한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 mock 변수도 vi.hoisted로 함께 끌어올린다.
const { getPath, setLoginItemSettings } = vi.hoisted(() => ({
  getPath: vi.fn(),
  setLoginItemSettings: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath, setLoginItemSettings } }))

import { loadSettings, saveSettings } from './settings'

describe('settings', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'usagemeter-settings-'))
    getPath.mockReturnValue(dir)
    setLoginItemSettings.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('파일이 없으면 기본값을 반환', () => {
    expect(loadSettings()).toEqual({ autoStart: false, limitsIntervalSec: 60, usageIntervalMin: 5 })
  })

  it('저장 후 로드하면 저장한 값 그대로(라운드트립)', () => {
    saveSettings({ autoStart: true, limitsIntervalSec: 30, usageIntervalMin: 10 })
    expect(loadSettings()).toEqual({ autoStart: true, limitsIntervalSec: 30, usageIntervalMin: 10 })
  })

  it('저장 시 app.setLoginItemSettings를 openAtLogin + args로 호출', () => {
    saveSettings({ autoStart: true, limitsIntervalSec: 60, usageIntervalMin: 5 })
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ['--start-minimized']
    })

    saveSettings({ autoStart: false, limitsIntervalSec: 60, usageIntervalMin: 5 })
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      args: ['--start-minimized']
    })
  })

  it('손상된 JSON 파일이면 기본값으로 폴백', () => {
    writeFileSync(join(dir, 'settings.json'), '{not json')
    expect(loadSettings()).toEqual({ autoStart: false, limitsIntervalSec: 60, usageIntervalMin: 5 })
  })

  it('필드 타입이 어긋난 값은 기본값으로 대체(부분 손상 방어)', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ autoStart: 'yes', usageIntervalMin: 7 })
    )
    expect(loadSettings()).toEqual({ autoStart: false, limitsIntervalSec: 60, usageIntervalMin: 7 })
  })

  it('너무 작은 간격 값은 최소치로 clamp되어 저장/로드됨 (폴러 폭주 방지)', () => {
    saveSettings({ autoStart: false, limitsIntervalSec: 0, usageIntervalMin: 0 })
    expect(loadSettings()).toEqual({ autoStart: false, limitsIntervalSec: 15, usageIntervalMin: 1 })
  })
})
