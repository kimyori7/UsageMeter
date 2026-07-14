// app/src/providers/codex/auth.ts
// ~/.codex/auth.json 리더. 반환 토큰은 main 메모리에서만 사용 — 로그·IPC로 내보내지 말 것.
// 의도적으로 refresh_token은 읽지 않는다(스펙 F3: 1회용 회전식이라 외부 앱이 쓰면 CLI 로그인 파손).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')

export interface CodexAuth {
  accessToken: string
  accountId: string
}

/** 파일 없음/파싱 실패/필드 결측 → null (throw 금지). */
export function readCodexAuth(authPath = DEFAULT_CODEX_AUTH_PATH): CodexAuth | null {
  try {
    const raw = JSON.parse(readFileSync(authPath, 'utf-8')) as {
      tokens?: { access_token?: unknown; account_id?: unknown } | null
    }
    const t = raw?.tokens
    if (typeof t?.access_token !== 'string' || typeof t?.account_id !== 'string') return null
    return { accessToken: t.access_token, accountId: t.account_id }
  } catch {
    return null
  }
}
