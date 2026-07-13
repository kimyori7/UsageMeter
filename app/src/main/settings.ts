// 설정 JSON 로드/저장 (%APPDATA%/UsageMeter/settings.json = app.getPath('userData') + settings.json)
// + 자동시작(app.setLoginItemSettings) 반영. 폴링 주기(limitsIntervalSec/usageIntervalMin)는 SettingsPane에서
// 저장 즉시 poller에 실시간 반영하지 않는다(YAGNI) — 대신 부팅 시(main/index.ts) loadSettings()를 읽어
// Poller 생성 인자로 넘긴다("재시작 후 적용" 문구가 실제로 참이 되도록).
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Settings {
  autoStart: boolean
  limitsIntervalSec: number
  usageIntervalMin: number
}

const DEFAULT_SETTINGS: Settings = { autoStart: false, limitsIntervalSec: 60, usageIntervalMin: 5 }

// 값이 너무 작으면(0 등) poller의 자기재예약 타이머가 간격 없이 돌며 OAuth API/ccusage를 폭주시킨다 —
// 손으로 수정한 JSON이나 UI 입력 실수로부터 항상 방어한다(로드·저장 양쪽에서 clamp).
const MIN_LIMITS_INTERVAL_SEC = 15
const MIN_USAGE_INTERVAL_MIN = 1

function clamp(s: Settings): Settings {
  return {
    autoStart: s.autoStart,
    limitsIntervalSec: Math.max(MIN_LIMITS_INTERVAL_SEC, Math.round(s.limitsIntervalSec)),
    usageIntervalMin: Math.max(MIN_USAGE_INTERVAL_MIN, Math.round(s.usageIntervalMin))
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return clamp({
      autoStart:
        typeof parsed.autoStart === 'boolean' ? parsed.autoStart : DEFAULT_SETTINGS.autoStart,
      limitsIntervalSec:
        typeof parsed.limitsIntervalSec === 'number'
          ? parsed.limitsIntervalSec
          : DEFAULT_SETTINGS.limitsIntervalSec,
      usageIntervalMin:
        typeof parsed.usageIntervalMin === 'number'
          ? parsed.usageIntervalMin
          : DEFAULT_SETTINGS.usageIntervalMin
    })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  const clamped = clamp(s)
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(clamped, null, 2))
  app.setLoginItemSettings({ openAtLogin: clamped.autoStart, args: ['--start-minimized'] })
}
