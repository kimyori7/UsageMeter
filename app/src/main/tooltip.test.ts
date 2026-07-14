// formatTooltip: 트레이 아이콘 호버 툴팁 한 줄 요약을 만드는 순수함수.
// 표시 규칙(브리프 예시 'Claude 68% · 1h32m | Codex 32% · 오늘 $12.40'에서 역산):
// - 창(windows.length>0)이 있는 provider만 순서(claude, codex)대로 표시, 없으면 생략.
// - 표시되는 provider 중 마지막 하나만 '오늘 $합계'를 보여주고, 그 앞의 provider들은
//   자신의 session_5h 창(없으면 첫 창) 리셋까지 남은 시간을 'HhMm'으로 보여준다.
//   types.ts 계약상 windows 배열의 순서/구성을 가정하면 안 되므로 kind로 명시 선택한다.
// - error가 있어도 windows가 남아있으면(직전 성공값 유지, stale) 계속 표시한다 — 생략은 error가 아니라
//   windows 부재로만 판단.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { formatTooltip } from './tooltip'
import type { AppState } from './poller'
import type { RateStatus } from '../providers/types'

const NOW = Date.parse('2026-01-01T00:00:00Z')

function rateStatus(overrides: Partial<RateStatus> & { usedPercent?: number } = {}): RateStatus {
  const { usedPercent, ...rest } = overrides
  return {
    provider: 'claude',
    windows:
      usedPercent === undefined
        ? []
        : [{ kind: 'session_5h', usedPercent, resetsAt: Math.floor(NOW / 1000) + 92 * 60 }],
    fetchedAt: NOW,
    ...rest
  }
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    limits: { claude: null, codex: null },
    today: { claude: { costUsd: 0, totalTokens: 0 }, codex: { costUsd: 0, totalTokens: 0 } },
    lastUsageSyncAt: NOW,
    accounts: [],
    ...overrides
  }
}

beforeEach(() => vi.useFakeTimers().setSystemTime(NOW))
afterEach(() => vi.useRealTimers())

describe('formatTooltip', () => {
  it('창이 둘 다 있으면 앞 provider는 리셋까지 남은시간, 마지막 provider는 오늘 합계를 보여준다', () => {
    const state = baseState({
      limits: {
        claude: rateStatus({ provider: 'claude', usedPercent: 68 }),
        codex: rateStatus({ provider: 'codex', usedPercent: 32 })
      },
      today: { claude: { costUsd: 5, totalTokens: 100 }, codex: { costUsd: 7.4, totalTokens: 200 } }
    })
    expect(formatTooltip(state)).toBe('Claude 68% · 1h32m | Codex 32% · 오늘 $12.40')
  })

  it('창이 없는 provider는 생략되고, 남은 하나가 마지막이 되어 오늘 합계를 보여준다', () => {
    const state = baseState({
      limits: { claude: null, codex: rateStatus({ provider: 'codex', usedPercent: 32 }) },
      today: { claude: { costUsd: 0, totalTokens: 0 }, codex: { costUsd: 7.4, totalTokens: 200 } }
    })
    expect(formatTooltip(state)).toBe('Codex 32% · 오늘 $7.40')
  })

  it('error가 있어도 직전 성공값(windows)이 남아있으면 표시한다', () => {
    const state = baseState({
      limits: {
        claude: rateStatus({ provider: 'claude', usedPercent: 68, stale: true, error: 'network' }),
        codex: rateStatus({ provider: 'codex', usedPercent: 32 })
      },
      today: { claude: { costUsd: 5, totalTokens: 100 }, codex: { costUsd: 7.4, totalTokens: 200 } }
    })
    expect(formatTooltip(state)).toBe('Claude 68% · 1h32m | Codex 32% · 오늘 $12.40')
  })

  it('windows 배열에서 weekly가 앞에 와도 session_5h 창을 골라 보여준다 (배열 순서 가정 금지)', () => {
    // types.ts 계약: windows는 "존재하는 창만" — 특정 순서/구성을 가정하면 안 된다.
    const claude: RateStatus = {
      provider: 'claude',
      windows: [
        { kind: 'weekly', usedPercent: 41, resetsAt: Math.floor(NOW / 1000) + 4 * 24 * 3600 },
        { kind: 'session_5h', usedPercent: 68, resetsAt: Math.floor(NOW / 1000) + 92 * 60 }
      ],
      fetchedAt: NOW
    }
    const state = baseState({
      limits: { claude, codex: rateStatus({ provider: 'codex', usedPercent: 32 }) },
      today: { claude: { costUsd: 5, totalTokens: 100 }, codex: { costUsd: 7.4, totalTokens: 200 } }
    })
    expect(formatTooltip(state)).toBe('Claude 68% · 1h32m | Codex 32% · 오늘 $12.40')
  })

  it('오늘 합계가 0이어도 생략하지 않고 $0.00으로 보여준다', () => {
    const state = baseState({
      limits: {
        claude: rateStatus({ provider: 'claude', usedPercent: 68 }),
        codex: rateStatus({ provider: 'codex', usedPercent: 32 })
      },
      today: { claude: { costUsd: 0, totalTokens: 0 }, codex: { costUsd: 0, totalTokens: 0 } }
    })
    expect(formatTooltip(state)).toBe('Claude 68% · 1h32m | Codex 32% · 오늘 $0.00')
  })
})
