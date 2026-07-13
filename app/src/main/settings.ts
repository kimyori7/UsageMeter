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

/**
 * typeof 내로잉 + 기본값 대체 + 최소치 clamp를 한 곳에서 수행한다. 로드(디스크의 손상 가능 JSON)와
 * 저장(렌더러발 IPC payload — 컴파일 타임 보장 없음, 런타임엔 사실상 unknown) 양쪽 경로가 반드시
 * 이 함수를 통과한다. 안 그러면 문자열 autoStart가 setLoginItemSettings에 그대로 새거나
 * Math.round('abc')=NaN이 JSON에서 null로 직렬화돼 다음 로드까지 오염이 이어진다.
 */
function normalize(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const autoStart = typeof raw.autoStart === 'boolean' ? raw.autoStart : DEFAULT_SETTINGS.autoStart
  const limitsIntervalSec =
    typeof raw.limitsIntervalSec === 'number' && Number.isFinite(raw.limitsIntervalSec)
      ? raw.limitsIntervalSec
      : DEFAULT_SETTINGS.limitsIntervalSec
  const usageIntervalMin =
    typeof raw.usageIntervalMin === 'number' && Number.isFinite(raw.usageIntervalMin)
      ? raw.usageIntervalMin
      : DEFAULT_SETTINGS.usageIntervalMin
  return {
    autoStart,
    limitsIntervalSec: Math.max(MIN_LIMITS_INTERVAL_SEC, Math.round(limitsIntervalSec)),
    usageIntervalMin: Math.max(MIN_USAGE_INTERVAL_MIN, Math.round(usageIntervalMin))
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    // JSON.parse 결과가 null/배열/문자열이어도 normalize의 프로퍼티 접근이 throw하면 catch로 폴백.
    return normalize(JSON.parse(readFileSync(settingsPath(), 'utf-8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  const normalized = normalize(s)
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(normalized, null, 2))
  app.setLoginItemSettings({ openAtLogin: normalized.autoStart, args: ['--start-minimized'] })
}
