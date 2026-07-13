// 설정 화면: 자동시작 토글 + 폴링 주기 입력. 저장은 main(settings.ts)이 clamp한 실제 반영값을 돌려받아
// 되반영한다(사용자가 0을 입력해도 화면엔 최소치가 표시됨). 주기 변경은 poller에 실시간 반영하지
// 않고(브리프 YAGNI) 재시작 시(main/index.ts 부팅) 적용되므로 안내 문구로 그 사실을 알린다.
// 레이아웃은 앱 공통 카드 언어(#1e1e2a 카드 + 섹션 그룹 "일반"/"폴링 주기")를 따른다 — 컨트롤러
// 디자인 리뷰 반영. 동작/IPC는 변경 없음(스타일 + 저장 피드백만).
import { useEffect, useRef, useState } from 'react'
import { getSettings, setSettings as persistSettings } from '../api'

type SettingsShape = Awaited<ReturnType<typeof getSettings>>

const MIN_LIMITS_SEC = 15
const MIN_USAGE_MIN = 1
const SAVED_FEEDBACK_MS = 2000

export default function SettingsPane(): React.JSX.Element {
  const [settings, setLocalSettings] = useState<SettingsShape | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    getSettings().then((s) => {
      if (!cancelled) setLocalSettings(s)
    })
    return () => {
      cancelled = true
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  if (!settings) {
    return <div className="settings-pane settings-loading">불러오는 중…</div>
  }

  function update(patch: Partial<SettingsShape>): void {
    setLocalSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    // 값을 고치기 시작하면 직전 "저장됨 ✓" 피드백은 즉시 걷어낸다(이미 낡은 확인이므로).
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setJustSaved(false)
  }

  async function handleSave(): Promise<void> {
    if (!settings) return
    const applied = await persistSettings(settings)
    setLocalSettings(applied)
    setJustSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_FEEDBACK_MS)
  }

  return (
    <div className="settings-pane">
      <div className="settings-card">
        <div className="settings-section">
          <div className="settings-section-title">일반</div>
          <label className="settings-toggle-row">
            <span>윈도우 시작 시 자동 실행</span>
            <input
              type="checkbox"
              className="settings-toggle"
              checked={settings.autoStart}
              onChange={(e) => update({ autoStart: e.target.checked })}
            />
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">폴링 주기</div>

          <div className="settings-field-row">
            <label htmlFor="settings-limits-interval">한도 폴링 주기</label>
            <span className="settings-input-wrap">
              <input
                id="settings-limits-interval"
                type="number"
                min={MIN_LIMITS_SEC}
                value={settings.limitsIntervalSec}
                onChange={(e) => update({ limitsIntervalSec: Number(e.target.value) })}
              />
              <span className="settings-unit">초</span>
            </span>
          </div>

          <div className="settings-field-row">
            <label htmlFor="settings-usage-interval">사용량 집계 주기</label>
            <span className="settings-input-wrap">
              <input
                id="settings-usage-interval"
                type="number"
                min={MIN_USAGE_MIN}
                value={settings.usageIntervalMin}
                onChange={(e) => update({ usageIntervalMin: Number(e.target.value) })}
              />
              <span className="settings-unit">분</span>
            </span>
          </div>

          <p className="settings-note">
            최소 {MIN_LIMITS_SEC}초 / {MIN_USAGE_MIN}분 · 주기 변경은 앱을 재시작해야 적용됩니다.
          </p>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className={`settings-save${justSaved ? ' settings-save--saved' : ''}`}
            onClick={() => void handleSave()}
          >
            {justSaved ? '저장됨 ✓' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
