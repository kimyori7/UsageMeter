// 모델 스코프 주간 한도 창(weekly_fable 등) 선별 + 게이지 라벨 도출.
// kind 규약은 백엔드(providers/claude/limits.rs scoped_kind)와 쌍: "weekly_" + 모델명 슬러그(소문자).
// 고정 두 창(session_5h/weekly)과 달리 스코프 창은 데이터에 있을 때만 렌더한다(자리 표시 줄 없음).
import type { RateWindow } from '../../../providers/types'

const PREFIX = 'weekly_'

/** windows에서 모델 스코프 주간 창만 골라낸다. 'weekly'(전체 주간)는 접두사가 달라 걸리지 않는다. */
export function scopedWeeklyWindows(windows: RateWindow[]): RateWindow[] {
  return windows.filter((w) => w.kind.startsWith(PREFIX))
}

/** "weekly_fable" → "Fable" — 슬러그의 각 단어 첫 글자만 대문자로 되살린다. */
export function scopedModelName(kind: string): string {
  return kind
    .slice(PREFIX.length)
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

/** "weekly_fable" → "주간 한도 (Fable)" — 팝업 게이지 줄 라벨. */
export function scopedWindowLabel(kind: string): string {
  return `주간 한도 (${scopedModelName(kind)})`
}
