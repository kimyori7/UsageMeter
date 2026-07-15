// 스냅샷 카드의 리셋 판정(스펙 §UI): 마지막 관측 이후 리셋 시각이 지났으면 과거 %는 무의미 —
// "리셋됨 · 여유 있음"으로 확정 표시한다. live 카드는 서버 수치가 진실이므로 판정하지 않는다.
import type { RateWindow } from '../../../providers/types'

export interface DisplayWindow {
  window: RateWindow | null
  resetPassed: boolean
}

export function displayWindow(w: RateWindow | null, nowSec: number, live: boolean): DisplayWindow {
  if (!live && w && w.resetsAt > 0 && w.resetsAt <= nowSec) return { window: w, resetPassed: true }
  return { window: w, resetPassed: false }
}

/** 스냅샷/스테일 카드 흐림 유예: 마지막 성공 후 GRACE_MS 안에는 흐리지 않는다. */
export const SNAPSHOT_GRACE_MS = 10 * 60_000

export function isDimmed(live: boolean, lastSeenAt: number, nowMs: number): boolean {
  return !live && nowMs - lastSeenAt >= SNAPSHOT_GRACE_MS
}
