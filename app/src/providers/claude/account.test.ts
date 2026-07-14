// app/src/providers/claude/account.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readClaudeAccount } from './account'

let dir: string
function writeConfig(content: string): string {
  dir = mkdtempSync(join(tmpdir(), 'claude-acc-'))
  const p = join(dir, '.claude.json')
  writeFileSync(p, content, 'utf-8')
  return p
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('readClaudeAccount', () => {
  it('oauthAccount에서 uuid·email을 읽는다 (다른 필드 무시)', () => {
    const p = writeConfig(
      JSON.stringify({
        numStartups: 5,
        oauthAccount: { accountUuid: 'uuid-1', emailAddress: 'a@b.com', organizationUuid: 'org-1' },
        projects: {}
      })
    )
    expect(readClaudeAccount(p)).toEqual({ id: 'uuid-1', email: 'a@b.com' })
  })

  it('emailAddress 결측 → email은 빈 문자열', () => {
    const p = writeConfig(JSON.stringify({ oauthAccount: { accountUuid: 'uuid-1' } }))
    expect(readClaudeAccount(p)).toEqual({ id: 'uuid-1', email: '' })
  })

  it('oauthAccount 없음(로그아웃 상태) → null', () => {
    expect(readClaudeAccount(writeConfig(JSON.stringify({ numStartups: 5 })))).toBeNull()
  })

  it('파일 없음 → null / 파싱 실패 → null', () => {
    expect(readClaudeAccount(join(tmpdir(), 'no-such', '.claude.json'))).toBeNull()
    expect(readClaudeAccount(writeConfig('{{{'))).toBeNull()
  })
})
