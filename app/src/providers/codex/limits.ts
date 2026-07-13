import { promises as fs, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RateStatus, RateWindow } from '../types'

const TAIL_BYTES = 512 * 1024 // 42MB짜리 rollout도 끝부분만 읽는다
const STALE_MS = 30 * 60_000

interface RawWindow {
  used_percent?: unknown
  window_minutes?: unknown
  resets_at?: unknown
}

interface RawRateLimits {
  primary?: RawWindow | null
  secondary?: RawWindow | null
  plan_type?: unknown
}

interface RawLine {
  payload?: { rate_limits?: RawRateLimits | null } | null
  rate_limits?: RawRateLimits | null
}

async function newestRollout(root: string): Promise<{ path: string; mtimeMs: number } | null> {
  let best: { path: string; mtimeMs: number } | null = null
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(p)
      } else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        const { mtimeMs } = await fs.stat(p)
        if (!best || mtimeMs > best.mtimeMs) best = { path: p, mtimeMs }
      }
    }
  }
  await walk(root)
  return best
}

function windowKind(windowMinutes: unknown): RateWindow['kind'] | null {
  if (windowMinutes === 300) return 'session_5h'
  if (windowMinutes === 10080) return 'weekly'
  return null
}

function windowsFrom(rl: RawRateLimits): RateWindow[] {
  const out: RateWindow[] = []
  for (const raw of [rl.primary, rl.secondary]) {
    if (!raw || typeof raw.used_percent !== 'number') continue
    const kind = windowKind(raw.window_minutes)
    if (!kind) continue
    const resetsAt = typeof raw.resets_at === 'number' ? raw.resets_at : 0
    out.push({ kind, usedPercent: raw.used_percent, resetsAt })
  }
  // 표시 순서 고정: 세션 → 주간 (primary/secondary 배치와 무관하게)
  return out.sort((a, b) => (a.kind === 'session_5h' ? -1 : 1) - (b.kind === 'session_5h' ? -1 : 1))
}

/**
 * sessionsDir 기본 ~/.codex/sessions. 최신 mtime rollout-*.jsonl의 마지막 rate_limits 이벤트를 읽는다.
 * stale = 파일 mtime이 30분 이상 과거. fetchedAt = 파일 mtime(epoch ms).
 */
export async function readCodexLimits(
  sessionsDir: string = join(homedir(), '.codex', 'sessions')
): Promise<RateStatus> {
  const base: RateStatus = { provider: 'codex', windows: [], fetchedAt: Date.now() }
  const file = await newestRollout(sessionsDir)
  if (!file) return { ...base, error: 'no-credentials' }

  const { size } = await fs.stat(file.path)
  const fh = await fs.open(file.path, 'r')
  let text: string
  try {
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    text = buf.toString('utf-8')
  } finally {
    await fh.close()
  }

  let lastRateLimits: RawRateLimits | null = null
  for (const line of text.split('\n')) {
    if (line.indexOf('"rate_limits"') === -1) continue
    const braceIdx = line.indexOf('{')
    if (braceIdx === -1) continue
    try {
      const obj: RawLine = JSON.parse(line.slice(braceIdx))
      const rl = obj?.payload?.rate_limits ?? obj?.rate_limits
      if (rl) lastRateLimits = rl
    } catch {
      // tail 경계에서 잘린 첫 줄 등 — 무시
    }
  }
  if (!lastRateLimits) return { ...base, fetchedAt: file.mtimeMs, error: 'no-data' }

  const plan = typeof lastRateLimits.plan_type === 'string' ? lastRateLimits.plan_type : undefined
  return {
    ...base,
    windows: windowsFrom(lastRateLimits),
    plan,
    fetchedAt: file.mtimeMs,
    stale: Date.now() - file.mtimeMs > STALE_MS
  }
}
