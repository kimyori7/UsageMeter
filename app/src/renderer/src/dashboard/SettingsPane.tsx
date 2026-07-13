// 설정 화면: 자동시작 토글 + 폴링 주기 입력. 저장은 main(settings.ts)이 clamp한 실제 반영값을 돌려받아
// 되반영한다(사용자가 0을 입력해도 화면엔 최소치가 표시됨). 주기 변경은 poller에 실시간 반영하지
// 않고(브리프 YAGNI) 재시작 시(main/index.ts 부팅) 적용되므로 안내 문구로 그 사실을 알린다.
import { useEffect, useState } from 'react'
import { getSettings, setSettings as persistSettings } from '../api'

type SettingsShape = Awaited<ReturnType<typeof getSettings>>

const MIN_LIMITS_SEC = 15
const MIN_USAGE_MIN = 1

export default function SettingsPane(): React.JSX.Element {
  const [settings, setLocalSettings] = useState<SettingsShape | null>(null)
  const [dirty, setDirty] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSettings().then((s) => {
      if (!cancelled) setLocalSettings(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!settings) {
    return <div className="settings-pane settings-loading">불러오는 중…</div>
  }

  function update(patch: Partial<SettingsShape>): void {
    setLocalSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
    setJustSaved(false)
  }

  async function handleSave(): Promise<void> {
    if (!settings) return
    const applied = await persistSettings(settings)
    setLocalSettings(applied)
    setDirty(false)
    setJustSaved(true)
  }

  return (
    <div className="settings-pane">
      <div className="settings-row">
        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={settings.autoStart}
            onChange={(e) => update({ autoStart: e.target.checked })}
          />
          윈도우 시작 시 자동 실행
        </label>
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="settings-limits-interval">
          한도 폴링 주기(초, 최소 {MIN_LIMITS_SEC})
        </label>
        <input
          id="settings-limits-interval"
          type="number"
          min={MIN_LIMITS_SEC}
          value={settings.limitsIntervalSec}
          onChange={(e) => update({ limitsIntervalSec: Number(e.target.value) })}
        />
      </div>

      <div className="settings-row">
        <label className="settings-label" htmlFor="settings-usage-interval">
          사용량 집계 주기(분, 최소 {MIN_USAGE_MIN})
        </label>
        <input
          id="settings-usage-interval"
          type="number"
          min={MIN_USAGE_MIN}
          value={settings.usageIntervalMin}
          onChange={(e) => update({ usageIntervalMin: Number(e.target.value) })}
        />
      </div>

      <p className="settings-note">주기 변경은 앱을 재시작해야 적용됩니다.</p>

      <div className="settings-row settings-actions">
        <button type="button" className="settings-save" onClick={() => void handleSave()}>
          저장
        </button>
        {!dirty && justSaved && <span className="settings-saved">저장됨</span>}
      </div>
    </div>
  )
}
