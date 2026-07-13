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

export function folderRollup(
  db: Database.Database,
  opts: { providers?: ProviderId[] } = {}
): Array<{ folder: string; providers: ProviderId[]; costUsd: number; totalTokens: number }> {
  const providers = providerFilter(opts.providers)
  const where = providers.clause ? `WHERE ${providers.clause}` : ''

  const rows = db
    .prepare(
      `SELECT folder, provider, SUM(cost_usd) AS costUsd, SUM(total_tokens) AS totalTokens
       FROM session_usage
       ${where}
       GROUP BY folder, provider
       ORDER BY folder`
    )
    .all(...providers.params) as Array<{
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
  opts: { providers?: ProviderId[] } = {}
): SessionRow[] {
  const conditions = ['folder = ?']
  const params: (string | ProviderId)[] = [folder]
  const providers = providerFilter(opts.providers)
  if (providers.clause) {
    conditions.push(providers.clause)
    params.push(...providers.params)
  }

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
