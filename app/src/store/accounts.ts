// 계정 레지스트리(accounts)와 로그인 타임라인(login_periods). login_periods는 이번 릴리스에서
// 읽지 않는다 — 2차(계정별 사용량 귀속)용 데이터 축적만 한다(스펙 §저장 구조).
import type Database from 'better-sqlite3'
import type { ProviderId } from '../providers/types'

export interface AccountRecord {
  provider: ProviderId
  id: string
  email: string
  plan?: string
  firstSeenAt: number
  lastSeenAt: number
}

export function upsertAccount(
  db: Database.Database,
  acc: { provider: ProviderId; id: string; email: string; plan?: string },
  nowMs: number
): void {
  db.prepare(
    `INSERT INTO accounts(provider, id, email, plan, first_seen_at, last_seen_at)
     VALUES (@provider, @id, @email, @plan, @now, @now)
     ON CONFLICT(provider, id) DO UPDATE SET
       email = CASE WHEN excluded.email = '' THEN accounts.email ELSE excluded.email END,
       plan = COALESCE(excluded.plan, accounts.plan),
       last_seen_at = excluded.last_seen_at`
  ).run({
    provider: acc.provider,
    id: acc.id,
    email: acc.email,
    plan: acc.plan ?? null,
    now: nowMs
  })
}

export function listAccounts(db: Database.Database, provider: ProviderId): AccountRecord[] {
  const rows = db
    .prepare(
      `SELECT provider, id, email, plan, first_seen_at, last_seen_at
       FROM accounts WHERE provider = ? ORDER BY last_seen_at DESC`
    )
    .all(provider) as {
    provider: ProviderId
    id: string
    email: string
    plan: string | null
    first_seen_at: number
    last_seen_at: number
  }[]
  return rows.map((r) => ({
    provider: r.provider,
    id: r.id,
    email: r.email,
    plan: r.plan ?? undefined,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at
  }))
}

export function touchLoginPeriod(
  db: Database.Database,
  provider: ProviderId,
  accountId: string,
  nowMs: number
): void {
  const latest = db
    .prepare(
      `SELECT id, account_id FROM login_periods WHERE provider = ? ORDER BY ended_at DESC, id DESC LIMIT 1`
    )
    .get(provider) as { id: number; account_id: string } | undefined
  if (latest && latest.account_id === accountId) {
    db.prepare(`UPDATE login_periods SET ended_at = ? WHERE id = ?`).run(nowMs, latest.id)
  } else {
    db.prepare(
      `INSERT INTO login_periods(provider, account_id, started_at, ended_at) VALUES (?, ?, ?, ?)`
    ).run(provider, accountId, nowMs, nowMs)
  }
}
