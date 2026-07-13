import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 반환값은 호출자(main 메모리)에서만 사용. 로그·IPC로 내보내지 말 것.
export function readAccessToken(
  credPath = join(homedir(), '.claude', '.credentials.json')
): string | null {
  try {
    const j = JSON.parse(readFileSync(credPath, 'utf-8'))
    return j?.claudeAiOauth?.accessToken ?? j?.accessToken ?? null
  } catch {
    return null
  }
}
