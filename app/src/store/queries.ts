// 대시보드 전용 읽기 쿼리. SQL 문자열 + 파라미터 바인딩(better-sqlite3 named/positional 파라미터)만
// 사용하고, 집계는 SQLite에 맡긴다(GROUP BY/SUM). folderRollup만 provider별 행을 폴더 단위로
// JS에서 병합한다(providers: ProviderId[] 배열을 만들어야 해서 SQL 한 줄로는 불가능).
import type Database from 'better-sqlite3'
import type { ProviderId, SessionRow, WindowKind } from '../providers/types'

function providerFilter(providers?: ProviderId[]): { clause: string; params: ProviderId[] } {
  if (!providers || providers.length === 0) return { clause: '', params: [] }
  return { clause: `provider IN (${providers.map(() => '?').join(',')})`, params: providers }
}

export function dailyTotals(
  db: Database.Database,
  opts: { from?: string; to?: string; providers?: ProviderId[] } = {}
): Array<{ date: string; provider: ProviderId; costUsd: number; totalTokens: number }> {
  const conditions: string[] = []
  const params: (string | ProviderId)[] = []
  if (opts.from) {
    conditions.push('date >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    conditions.push('date <= ?')
    params.push(opts.to)
  }
  const providers = providerFilter(opts.providers)
  if (providers.clause) {
    conditions.push(providers.clause)
    params.push(...providers.params)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .prepare(
      `SELECT date, provider, SUM(cost_usd) AS costUsd,
              SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
       FROM daily_usage
       ${where}
       GROUP BY date, provider
       ORDER BY date, provider`
    )
    .all(...params) as Array<{
    date: string
    provider: ProviderId
    costUsd: number
    totalTokens: number
  }>
}

export function todayByProvider(
  db: Database.Database,
  today: string
): Record<ProviderId, { costUsd: number; totalTokens: number }> {
  const rows = db
    .prepare(
      `SELECT provider, SUM(cost_usd) AS costUsd,
              SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
       FROM daily_usage WHERE date = ? GROUP BY provider`
    )
    .all(today) as Array<{ provider: ProviderId; costUsd: number; totalTokens: number }>

  const result: Record<ProviderId, { costUsd: number; totalTokens: number }> = {
    claude: { costUsd: 0, totalTokens: 0 },
    codex: { costUsd: 0, totalTokens: 0 }
  }
  for (const row of rows)
    result[row.provider] = { costUsd: row.costUsd, totalTokens: row.totalTokens }
  return result
}

// 대시보드(Task 11)에서 추가한 opts — 원래 queries.ts(Task 6/9)엔 providers만 있었다. 폴더·세션 탭의
// 기간 칩(목업 "이번 주/30일/전체")이 folderRollup/sessionsInFolder에도 적용되려면 날짜 필터가 필요해
// dailyTotals와 동일한 from/to 패턴으로 확장했다(기존 호출부는 opts 생략 시 동작 그대로).
// 주의: 세션 하나의 비용 전체를 "종료일(ended_at)"에 귀속시킨다 — dailyTotals/daily_usage.date(실제
// 사용이 발생한 날짜별로 분산 기록)와는 귀속 기준이 달라, 같은 기간을 선택해도 두 탭의 합계가
// 1원 단위로 정확히 일치하지는 않는다(폴더·세션 탭은 세션 단위 특성상 의도된 차이).
interface FolderQueryOpts {
  providers?: ProviderId[]
  from?: string // YYYY-MM-DD(로컬 일), date(ended_at,'localtime') >= from (포함)
  to?: string // YYYY-MM-DD(로컬 일), date(ended_at,'localtime') <= to (포함)
}

// 'localtime' 변환이 필수인 이유: ended_at은 Z 접미사 UTC 타임스탬프인데, from/to는 렌더러
// (dashboard/period.ts)가 로컬 Date 게터로 만든 로컬 캘린더 일이다. 앱의 나머지 일 단위 데이터도
// 전부 로컬 기준(ccusage daily 버킷, poller의 todayDateString) — 변환 없이 date()로 UTC 일을
// 추출하면 KST(UTC+9) 같은 양수 오프셋에서 자정~09시 종료 세션이 폴더 탭에서만 전날로 밀린다.
function dateRangeFilter(opts: Pick<FolderQueryOpts, 'from' | 'to'>): {
  clauses: string[]
  params: string[]
} {
  const clauses: string[] = []
  const params: string[] = []
  if (opts.from) {
    clauses.push("date(ended_at, 'localtime') >= ?")
    params.push(opts.from)
  }
  if (opts.to) {
    clauses.push("date(ended_at, 'localtime') <= ?")
    params.push(opts.to)
  }
  return { clauses, params }
}

export function folderRollup(
  db: Database.Database,
  opts: FolderQueryOpts = {}
): Array<{ folder: string; providers: ProviderId[]; costUsd: number; totalTokens: number }> {
  const providers = providerFilter(opts.providers)
  const dateRange = dateRangeFilter(opts)
  const conditions = [...(providers.clause ? [providers.clause] : []), ...dateRange.clauses]
  const params = [...providers.params, ...dateRange.params]
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `SELECT folder, provider, SUM(cost_usd) AS costUsd, SUM(total_tokens) AS totalTokens
       FROM session_usage
       ${where}
       GROUP BY folder, provider
       ORDER BY folder`
    )
    .all(...params) as Array<{
    folder: string
    provider: ProviderId
    costUsd: number
    totalTokens: number
  }>

  const byFolder = new Map<
    string,
    { folder: string; providers: ProviderId[]; costUsd: number; totalTokens: number }
  >()
  for (const row of rows) {
    const existing = byFolder.get(row.folder)
    if (existing) {
      existing.providers.push(row.provider)
      existing.costUsd += row.costUsd
      existing.totalTokens += row.totalTokens
    } else {
      byFolder.set(row.folder, {
        folder: row.folder,
        providers: [row.provider],
        costUsd: row.costUsd,
        totalTokens: row.totalTokens
      })
    }
  }
  return [...byFolder.values()]
}

export function sessionsInFolder(
  db: Database.Database,
  folder: string,
  opts: FolderQueryOpts = {}
): SessionRow[] {
  const conditions = ['folder = ?']
  const params: (string | ProviderId)[] = [folder]
  const providers = providerFilter(opts.providers)
  if (providers.clause) {
    conditions.push(providers.clause)
    params.push(...providers.params)
  }
  const dateRange = dateRangeFilter(opts)
  conditions.push(...dateRange.clauses)
  params.push(...dateRange.params)

  return db
    .prepare(
      `SELECT session_id AS sessionId, provider, folder, started_at AS startedAt, ended_at AS endedAt,
              total_tokens AS totalTokens, cost_usd AS costUsd
       FROM session_usage WHERE ${conditions.join(' AND ')}`
    )
    .all(...params) as SessionRow[]
}

export function monthlyRollup(db: Database.Database): Array<{
  month: string
  provider: ProviderId
  model: string
  costUsd: number
  totalTokens: number
}> {
  return db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, provider, model,
              SUM(cost_usd) AS costUsd, SUM(input_tokens + output_tokens + cache_tokens) AS totalTokens
       FROM daily_usage
       GROUP BY month, provider, model
       ORDER BY month, provider, model`
    )
    .all() as Array<{
    month: string
    provider: ProviderId
    model: string
    costUsd: number
    totalTokens: number
  }>
}

export function snapshotSeries(
  db: Database.Database,
  opts: { provider: ProviderId; window: WindowKind; from: number }
): Array<{ ts: number; usedPercent: number }> {
  return db
    .prepare(
      `SELECT ts, used_percent AS usedPercent FROM rate_snapshots
       WHERE provider = ? AND window = ? AND ts >= ?
       ORDER BY ts ASC`
    )
    .all(opts.provider, opts.window, opts.from) as Array<{ ts: number; usedPercent: number }>
}
