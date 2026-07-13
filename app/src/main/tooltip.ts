// 트레이 아이콘 호버 툴팁 한 줄 요약을 만드는 순수함수.
// 창(windows)이 있는 provider만 고정 순서(claude, codex)로 나열하고, 창이 없으면 그 provider는 생략한다.
// 표시되는 provider 중 마지막 하나만 '오늘 $합계'(두 provider 합산)를 보여주고, 그 앞의 provider들은
// 자신의 session_5h 창 리셋까지 남은 시간을 'HhMm'으로 보여준다. types.ts 계약상 windows 배열의
// 순서/구성을 가정하면 안 되므로 kind로 명시 선택하고, session_5h가 없으면 첫 창으로 폴백한다.
// error가 있어도 windows가 남아있으면(직전 성공값 유지, stale) 계속 표시한다 — 생략 여부는 error가 아니라
// windows 부재로만 판단한다(스펙 §7: 폴링 실패해도 마지막 성공값을 계속 표시).
import type { AppState } from './poller'
import type { ProviderId, RateStatus, RateWindow } from '../providers/types'

const PROVIDER_ORDER: readonly ProviderId[] = ['claude', 'codex']
const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

/** 표시용 대표 창: session_5h 우선, 없으면 첫 창 (windows 배열 순서 가정 금지 — types.ts 계약). */
function displayWindow(status: RateStatus): RateWindow {
  return status.windows.find((w) => w.kind === 'session_5h') ?? status.windows[0]
}

function formatDuration(resetsAtSec: number, nowMs: number): string {
  const remainingMin = Math.max(0, Math.round((resetsAtSec * 1000 - nowMs) / 60_000))
  const h = Math.floor(remainingMin / 60)
  const m = remainingMin % 60
  return `${h}h${m}m`
}

function formatMoney(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function formatTooltip(state: AppState, now: number = Date.now()): string {
  const present = PROVIDER_ORDER.filter((p) => (state.limits[p]?.windows.length ?? 0) > 0)
  const totalCostUsd = PROVIDER_ORDER.reduce((sum, p) => sum + state.today[p].costUsd, 0)

  const segments = present.map((provider, i) => {
    const label = PROVIDER_LABEL[provider]
    const win = displayWindow(state.limits[provider]!)
    const pct = Math.round(win.usedPercent)
    const isLast = i === present.length - 1
    const tail = isLast ? `오늘 ${formatMoney(totalCostUsd)}` : formatDuration(win.resetsAt, now)
    return `${label} ${pct}% · ${tail}`
  })

  return segments.length > 0 ? segments.join(' | ') : `오늘 ${formatMoney(totalCostUsd)}`
}
