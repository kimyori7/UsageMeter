import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateStatus } from '../providers/types'
import { applyMultiAccountSchema, openDb } from '../store/db'
import { upsertAccount } from '../store/accounts'
import { recordSnapshots } from '../store/snapshots'
import { createVault, type AccountVault } from './account-vault'
import { runAccountsCycle, type AccountsCycleDeps, type ActiveResults } from './accounts-cycle'

let db: Database.Database
let root: string
let vault: AccountVault
let srcDir: string

beforeEach(() => {
  db = openDb(':memory:')
  expect(applyMultiAccountSchema(db)).toBe(true)
  root = mkdtempSync(join(tmpdir(), 'cycle-'))
  vault = createVault(join(root, 'accounts'))
  srcDir = mkdtempSync(join(tmpdir(), 'cycle-src-'))
  writeFileSync(join(srcDir, 'cred.json'), '{"claudeAiOauth":{"accessToken":"FAKE"}}', 'utf-8')
  writeFileSync(
    join(srcDir, 'auth.json'),
    '{"tokens":{"access_token":"FAKE","account_id":"cx-active"}}',
    'utf-8'
  )
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

const okStatus = (provider: 'claude' | 'codex', used = 10): RateStatus => ({
  provider,
  windows: [{ kind: 'session_5h', usedPercent: used, resetsAt: 9999 }],
  fetchedAt: 5000
})

function makeDeps(
  overrides: Partial<AccountsCycleDeps['claude']> = {},
  codexOverrides: Partial<AccountsCycleDeps['codex']> = {}
): AccountsCycleDeps {
  return {
    db,
    vault,
    now: () => 5000,
    claude: {
      credPath: join(srcDir, 'cred.json'),
      readAccount: () => ({ id: 'cl-active', email: 'active@a.com' }),
      ensureToken: vi.fn(async () => 'FAKE-TOKEN'),
      fetchLimits: vi.fn(async () => okStatus('claude', 33)),
      ...overrides
    },
    codex: {
      authPath: join(srcDir, 'auth.json'),
      readVaultAuth: () => ({ accessToken: 'FAKE', accountId: 'cx-old' }),
      fetchUsage: vi.fn(async () => ({
        account: { id: 'cx-old', email: 'old@c.com' },
        status: okStatus('codex', 44)
      })),
      ...codexOverrides
    }
  }
}

const activeBoth: ActiveResults = {
  claude: okStatus('claude'),
  codex: {
    status: okStatus('codex'),
    account: { id: 'cx-active', email: 'cx@c.com', plan: 'plus' }
  }
}

describe('runAccountsCycle — 활성 계정', () => {
  it('레지스트리 upsert + 타임라인 + vault 사본 + 태그 스냅샷 + live 상태', async () => {
    const states = await runAccountsCycle(makeDeps(), activeBoth)
    const claude = states.find((s) => s.account.id === 'cl-active')
    expect(claude?.live).toBe(true)
    expect(claude?.account.email).toBe('active@a.com')
    expect(vault.hasCopy('claude', 'cl-active')).toBe(true)
    expect(vault.hasCopy('codex', 'cx-active')).toBe(true)
    const snap = db
      .prepare(`SELECT account_id FROM rate_snapshots WHERE provider='claude'`)
      .all() as { account_id: string }[]
    expect(snap.map((r) => r.account_id)).toContain('cl-active')
    const period = db
      .prepare(`SELECT account_id FROM login_periods WHERE provider='codex'`)
      .get() as {
      account_id: string
    }
    expect(period.account_id).toBe('cx-active')
  })

  it('활성 계정 에러 상태 → live=false, lastSeenAt은 nowMs가 아니라 status.fetchedAt(직전 성공 시각)', async () => {
    const errorStatus: RateStatus = {
      provider: 'claude',
      windows: [],
      fetchedAt: 4242, // poller.staleFallback이 직전 성공 status를 그대로 넘기므로 nowMs(5000)과 달라야 의미가 있다
      error: 'network'
    }
    const states = await runAccountsCycle(makeDeps(), { ...activeBoth, claude: errorStatus })
    const claude = states.find((s) => s.account.id === 'cl-active')
    expect(claude?.live).toBe(false)
    expect(claude?.lastSeenAt).toBe(4242)
  })

  it('활성 신원 미상이어도 상태가 성공이면 "" 태그로 스냅샷을 남긴다(이력 연속성)', async () => {
    const states = await runAccountsCycle(makeDeps({ readAccount: () => null }), {
      ...activeBoth,
      codex: { status: null, account: null }
    })
    const legacy = db
      .prepare(`SELECT account_id FROM rate_snapshots WHERE provider='claude'`)
      .get() as { account_id: string }
    expect(legacy.account_id).toBe('')
    expect(states.filter((s) => s.account.provider === 'claude')).toHaveLength(0)
  })
})

describe('runAccountsCycle — 비활성 계정', () => {
  it('vault 라이브 성공 → live=true + 태그 스냅샷', async () => {
    upsertAccount(db, { provider: 'claude', id: 'cl-old', email: 'old@a.com' }, 1000)
    vault.copyIfChanged('claude', 'cl-old', join(srcDir, 'cred.json'))
    const deps = makeDeps()
    const states = await runAccountsCycle(deps, activeBoth)
    const old = states.find((s) => s.account.id === 'cl-old')
    expect(old?.live).toBe(true)
    expect(deps.claude.ensureToken).toHaveBeenCalledWith(vault.credPath('claude', 'cl-old'))
    const tagged = db
      .prepare(`SELECT COUNT(*) AS n FROM rate_snapshots WHERE account_id='cl-old'`)
      .get() as { n: number }
    expect(tagged.n).toBeGreaterThan(0)
  })

  it('unauthorized → markRevoked + 스냅샷 폴백, 이후 사이클은 fetch 자체를 건너뛴다', async () => {
    upsertAccount(db, { provider: 'claude', id: 'cl-old', email: 'old@a.com' }, 1000)
    vault.copyIfChanged('claude', 'cl-old', join(srcDir, 'cred.json'))
    recordSnapshots(db, okStatus('claude', 70), 'cl-old') // 폴백에 쓰일 과거 스냅샷
    const fetchLimits = vi.fn(async () => ({
      ...okStatus('claude'),
      windows: [],
      error: 'unauthorized' as const
    }))
    const deps = makeDeps({ fetchLimits })
    const first = await runAccountsCycle(deps, activeBoth)
    const old1 = first.find((s) => s.account.id === 'cl-old')
    expect(old1?.live).toBe(false)
    expect(old1?.status.windows[0]?.usedPercent).toBe(70) // 스냅샷 폴백
    expect(vault.isRevoked('claude', 'cl-old')).toBe(true)
    fetchLimits.mockClear()
    await runAccountsCycle(deps, activeBoth)
    expect(fetchLimits).not.toHaveBeenCalled() // revoked 스킵 — cycle은 비활성 fetch 자체를 안 한다
  })

  it('network 오류 → revoked 마킹 없이 폴백 / 스냅샷도 없으면 no-data 상태', async () => {
    upsertAccount(db, { provider: 'codex', id: 'cx-old', email: 'old@c.com' }, 1000)
    vault.copyIfChanged('codex', 'cx-old', join(srcDir, 'auth.json'))
    const deps = makeDeps(
      {},
      {
        fetchUsage: vi.fn(async () => ({
          account: null,
          status: { ...okStatus('codex'), windows: [], error: 'network' as const }
        }))
      }
    )
    const states = await runAccountsCycle(deps, activeBoth)
    const old = states.find((s) => s.account.id === 'cx-old')
    expect(old?.live).toBe(false)
    expect(old?.status.error).toBe('no-data')
    expect(vault.isRevoked('codex', 'cx-old')).toBe(false)
  })

  it('사본 없음 → fetch 시도 없이 스냅샷 폴백', async () => {
    upsertAccount(db, { provider: 'codex', id: 'cx-novault', email: 'nv@c.com' }, 1000)
    const fetchUsage = vi.fn()
    const states = await runAccountsCycle(makeDeps({}, { fetchUsage }), activeBoth)
    expect(states.find((s) => s.account.id === 'cx-novault')?.live).toBe(false)
    expect(fetchUsage).not.toHaveBeenCalled()
  })
})

describe('runAccountsCycle — 프로바이더별 예외 격리', () => {
  it('Claude 블록에서 동기 예외가 나도 사이클은 reject하지 않고 Codex는 계속 처리된다', async () => {
    upsertAccount(db, { provider: 'codex', id: 'cx-old', email: 'old@c.com' }, 1000)
    vault.copyIfChanged('codex', 'cx-old', join(srcDir, 'auth.json'))
    const deps = makeDeps({
      readAccount: () => {
        throw new Error('DB failure')
      }
    })
    const states = await runAccountsCycle(deps, activeBoth)
    // Claude 블록은 통째로 실패했으므로 claude 상태는 하나도 없어야 한다.
    expect(states.filter((s) => s.account.provider === 'claude')).toHaveLength(0)
    // Codex 블록은 Claude 실패와 무관하게 활성/비활성 계정 모두 정상 처리되어야 한다.
    expect(states.some((s) => s.account.provider === 'codex' && s.account.id === 'cx-active')).toBe(
      true
    )
    expect(states.some((s) => s.account.provider === 'codex' && s.account.id === 'cx-old')).toBe(
      true
    )
  })
})
