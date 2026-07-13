// 팝업 표시용 순수 포맷터 — 컴포넌트는 문자열을 직접 조립하지 않고 이 3개 함수만 통해 만든다.
// resetsAt/now는 항상 epoch 초(RateWindow.resetsAt과 동일 단위) — ms와 섞어 쓰지 않는다.
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const
const DAY_SEC = 24 * 60 * 60

/**
 * '1h 32m 후 리셋' (24시간 미만, 분은 항상 2자리 패딩) | '7/17(금) 리셋' (24시간 이상, 로컬 캘린더 기준).
 * 임계값은 순수하게 경과 시간(24시간)이지 자정 통과 여부가 아니다 — 자정을 넘겨도 24시간 미만이면
 * 여전히 시/분 형식을 유지한다.
 */
export function fmtReset(resetsAt: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diffSec = Math.max(0, resetsAt - now)
  if (diffSec >= DAY_SEC) {
    const d = new Date(resetsAt * 1000)
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KO[d.getDay()]}) 리셋`
  }
  const totalMin = Math.floor(diffSec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${String(m).padStart(2, '0')}m 후 리셋`
}

/** '$12.40' (1000 미만, 소수 2자리) | '$1,234' (1000 이상, 정수 반올림 + 천단위 구분). */
export function fmtMoney(usd: number): string {
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString('en-US')}`
  return `$${usd.toFixed(2)}`
}

/**
 * '42.1M tok' 형태 — B/M/K 단위로 자동 축약(소수 1자리), 1000 미만은 그대로 tok만 붙인다.
 * 단위 전환 경계는 1e6/1e9가 아니라 999,950/999,950,000 — toFixed(1) 반올림으로 하위 단위 가수가
 * "1000.0"으로 읽히는 값(예: 999,950 → "1000.0K")은 상위 단위("1.0M")로 미리 넘긴다.
 */
export function fmtTokens(n: number): string {
  if (n >= 999_950_000) return `${(n / 1_000_000_000).toFixed(1)}B tok`
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M tok`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tok`
  return `${n} tok`
}

const WARN_PERCENT = 90

/** 게이지 라벨에 표시하는 정수 % — 표시와 경고 판정이 반드시 같은 반올림 값을 쓰도록 하는 단일 진입점. */
export function displayPercent(usedPercent: number): number {
  return Math.round(usedPercent)
}

/**
 * 경고색(≥90%) 판정 — 원본 값이 아니라 displayPercent(반올림된 표시값) 기준.
 * 89.6처럼 라벨에 "90%"로 보이는 값이 경고색 없이 그려지는 표시-색 모순을 막는다.
 */
export function isWarnPercent(usedPercent: number): boolean {
  return displayPercent(usedPercent) >= WARN_PERCENT
}
