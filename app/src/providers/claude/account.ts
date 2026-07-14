// app/src/providers/claude/account.ts
// 현재 로그인된 클로드 계정 신원(스펙 F1). ~/.claude.json은 수 MB일 수 있으나 60초 주기 1회 읽기라 허용.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json')

export interface ClaudeAccountIdentity {
  id: string
  email: string
}

/** oauthAccount.accountUuid가 없으면(로그아웃 등) null. 파일 없음/파싱 실패도 null (throw 금지). */
export function readClaudeAccount(
  configPath = DEFAULT_CLAUDE_CONFIG_PATH
): ClaudeAccountIdentity | null {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      oauthAccount?: { accountUuid?: unknown; emailAddress?: unknown } | null
    }
    const acc = raw?.oauthAccount
    if (typeof acc?.accountUuid !== 'string' || acc.accountUuid.length === 0) return null
    return {
      id: acc.accountUuid,
      email: typeof acc.emailAddress === 'string' ? acc.emailAddress : ''
    }
  } catch {
    return null
  }
}
