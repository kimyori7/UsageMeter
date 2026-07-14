import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// 반환값(토큰)은 호출자(main 메모리)에서만 사용. 로그·IPC로 내보내지 말 것.

export const DEFAULT_CRED_PATH = join(homedir(), '.claude', '.credentials.json')

/** claudeAiOauth 구조체에서 뽑아낸 값들. expiresAt=null은 "필드 없음/판정 불가"를 뜻함(만료됨과 다름). */
export interface ClaudeOAuthSnapshot {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
}

export interface ClaudeCredentialsFile {
  raw: Record<string, unknown> // 원본 JSON 전체(구조 보존 쓰기용, 미지 필드 포함)
  oauth: ClaudeOAuthSnapshot
}

export function readAccessToken(credPath = DEFAULT_CRED_PATH): string | null {
  return readClaudeCredentials(credPath)?.oauth.accessToken ?? null
}

/** 파일을 매번 새로 읽어 구조체로 반환한다. 파일 없음/파싱 실패 → null (throw 금지). */
export function readClaudeCredentials(credPath = DEFAULT_CRED_PATH): ClaudeCredentialsFile | null {
  try {
    const raw = JSON.parse(readFileSync(credPath, 'utf-8')) as Record<string, unknown>
    const oauthRaw = (raw?.claudeAiOauth ?? {}) as Record<string, unknown>
    const accessToken =
      typeof oauthRaw.accessToken === 'string'
        ? oauthRaw.accessToken
        : typeof raw?.accessToken === 'string'
          ? (raw.accessToken as string)
          : null
    const refreshToken = typeof oauthRaw.refreshToken === 'string' ? oauthRaw.refreshToken : null
    const expiresAt = typeof oauthRaw.expiresAt === 'number' ? oauthRaw.expiresAt : null
    return { raw, oauth: { accessToken, refreshToken, expiresAt } }
  } catch {
    return null
  }
}

/**
 * claudeAiOauth.accessToken/refreshToken/expiresAt만 갱신하고 나머지 구조는 그대로 보존해
 * 원자적으로(temp 파일 + rename) 쓴다. refreshToken이 undefined면 기존 값 유지(비회전).
 */
export function writeClaudeOAuthUpdate(
  credPath: string,
  raw: Record<string, unknown>,
  updates: { accessToken: string; refreshToken?: string; expiresAt: number }
): void {
  const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  const oauth = { ...(clone.claudeAiOauth as Record<string, unknown> | undefined) }
  oauth.accessToken = updates.accessToken
  if (updates.refreshToken !== undefined) oauth.refreshToken = updates.refreshToken
  oauth.expiresAt = updates.expiresAt
  clone.claudeAiOauth = oauth

  const tmpPath = join(
    dirname(credPath),
    `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  )
  writeFileSync(tmpPath, JSON.stringify(clone), 'utf-8')
  renameSync(tmpPath, credPath)
}
