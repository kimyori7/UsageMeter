// snapshotSeries(query:snapshots) 원시 행(provider×window 각각 별도 배열)을 "한도 소진 추이" 차트가
// 바로 쓸 수 있는 "ts 하나당 한 행" 형태로 병합한다. pivotDaily(reshape.ts)와 같은 패턴이지만 축이
// provider×window 4계열(claude/codex × session/weekly)이라 date가 아니라 ts(epoch ms) 기준으로 병합.
// 값이 없는 계열은 0이 아니라 null — 0은 "실제로 0% 사용"과 구분이 안 돼 차트가 거짓 baseline을 그리게
// 된다(pivotDaily는 날짜별 스택 합산이라 0이 안전하지만, 여긴 시계열 line이라 null로 구멍을 낸다).
import type { ProviderId, WindowKind } from '../../../providers/types'

export interface SnapshotSeriesInput {
  provider: ProviderId
  window: WindowKind
  rows: Array<{ ts: number; usedPercent: number }>
}

export interface SnapshotChartPoint {
  ts: number
  claudeSession: number | null
  claudeWeekly: number | null
  codexSession: number | null
  codexWeekly: number | null
}

type SeriesKey = Exclude<keyof SnapshotChartPoint, 'ts'>

function seriesKey(provider: ProviderId, window: WindowKind): SeriesKey {
  if (provider === 'claude') return window === 'session_5h' ? 'claudeSession' : 'claudeWeekly'
  return window === 'session_5h' ? 'codexSession' : 'codexWeekly'
}

export function mergeSnapshotSeries(inputs: SnapshotSeriesInput[]): SnapshotChartPoint[] {
  const byTs = new Map<number, SnapshotChartPoint>()
  for (const input of inputs) {
    const key = seriesKey(input.provider, input.window)
    for (const row of input.rows) {
      const point = byTs.get(row.ts) ?? {
        ts: row.ts,
        claudeSession: null,
        claudeWeekly: null,
        codexSession: null,
        codexWeekly: null
      }
      point[key] = row.usedPercent
      byTs.set(row.ts, point)
    }
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}
