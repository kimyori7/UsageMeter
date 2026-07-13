// codex ccusage 세션 행의 directory는 날짜 폴더(예: 2026/07/13)일 뿐 실제 cwd가 아니다.
// 진짜 cwd는 sessionFile 첫 줄 JSON(session_meta 이벤트) payload.cwd에 있다.
import { readFileSync } from 'node:fs'

interface SessionMetaLine {
  payload?: { cwd?: unknown } | null
  cwd?: unknown
}

function firstLineOf(text: string): string {
  const idx = text.indexOf('\n')
  return idx === -1 ? text : text.slice(0, idx)
}

function readCwd(sessionFile: string): string | null {
  let text: string
  try {
    text = readFileSync(sessionFile, 'utf-8')
  } catch {
    return null // 파일 없음/읽기 실패
  }
  try {
    const line: SessionMetaLine = JSON.parse(firstLineOf(text))
    const cwd = line.payload?.cwd ?? line.cwd
    return typeof cwd === 'string' ? cwd : null
  } catch {
    return null // 첫 줄이 JSON이 아니거나 손상됨
  }
}

/** sessionFile 경로별 cwd를 동기 읽기하고 Map에 캐시하는 리졸버를 만든다. */
export function makeCwdResolver(): (sessionFile: string) => string | null {
  const cache = new Map<string, string | null>()
  return (sessionFile: string): string | null => {
    if (cache.has(sessionFile)) return cache.get(sessionFile) ?? null
    const cwd = readCwd(sessionFile)
    cache.set(sessionFile, cwd)
    return cwd
  }
}
