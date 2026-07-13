// codex ccusage 세션 행의 directory는 ~/.codex/sessions 밑 날짜 폴더(예: 2026/07/13)일 뿐
// 실제 cwd가 아니다. 진짜 cwd는 해당 rollout 파일 첫 줄 JSON(session_meta 이벤트) payload.cwd에 있다.
// ccusage가 주는 sessionFile은 확장자 없는 베이스네임이라 .jsonl 재시도가 필요하다.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface SessionMetaLine {
  payload?: { cwd?: unknown } | null
  cwd?: unknown
}

function firstLineOf(text: string): string {
  const idx = text.indexOf('\n')
  return idx === -1 ? text : text.slice(0, idx)
}

function readFirstLine(path: string): string | null {
  try {
    return firstLineOf(readFileSync(path, 'utf-8'))
  } catch {
    return null // 파일 없음/읽기 실패
  }
}

function readCwd(sessionsRoot: string, directory: string, sessionFile: string): string | null {
  const base = join(sessionsRoot, directory, sessionFile)
  // ccusage의 sessionFile은 확장자가 빠져 있음 — 정확한 경로 실패 시 .jsonl 재시도
  const line = readFirstLine(base) ?? readFirstLine(base + '.jsonl')
  if (line === null) return null
  try {
    const meta: SessionMetaLine = JSON.parse(line)
    const cwd = meta.payload?.cwd ?? meta.cwd
    return typeof cwd === 'string' ? cwd : null
  } catch {
    return null // 첫 줄이 JSON이 아니거나 손상됨
  }
}

/** directory+sessionFile별 cwd를 동기 읽기하고 Map에 캐시하는 리졸버를 만든다. */
export function makeCwdResolver(
  sessionsRoot: string = join(homedir(), '.codex', 'sessions')
): (directory: string, sessionFile: string) => string | null {
  const cache = new Map<string, string | null>()
  return (directory: string, sessionFile: string): string | null => {
    const key = directory + '/' + sessionFile
    if (cache.has(key)) return cache.get(key) ?? null
    const cwd = readCwd(sessionsRoot, directory, sessionFile)
    cache.set(key, cwd)
    return cwd
  }
}
