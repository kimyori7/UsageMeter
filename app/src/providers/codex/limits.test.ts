import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCodexLimits } from './limits'

const RL = (primary: object, secondary: object | null) =>
  JSON.stringify({
    timestamp: '2026-07-13T05:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: { limit_id: 'codex', primary, secondary, plan_type: 'plus' }
    }
  })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-'))
  mkdirSync(join(dir, '2026/07/13'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function writeRollout(name: string, lines: string[], mtime = new Date()): string {
  const p = join(dir, '2026/07/13', name)
  writeFileSync(p, lines.join('\n') + '\n')
  utimesSync(p, mtime, mtime)
  return p
}

describe('readCodexLimits', () => {
  it('마지막 rate_limits에서 5h+주간 창 매핑', async () => {
    writeRollout('rollout-a.jsonl', [
      '{"other":"line"}',
      RL(
        { used_percent: 10, window_minutes: 300, resets_at: 1783090774 },
        { used_percent: 17, window_minutes: 10080, resets_at: 1784508174 }
      ),
      RL(
        { used_percent: 32, window_minutes: 300, resets_at: 1783090999 },
        { used_percent: 18, window_minutes: 10080, resets_at: 1784508174 }
      )
    ])
    const s = await readCodexLimits(dir)
    expect(s.windows).toEqual([
      { kind: 'session_5h', usedPercent: 32, resetsAt: 1783090999 },
      { kind: 'weekly', usedPercent: 18, resetsAt: 1784508174 }
    ])
    expect(s.plan).toBe('plus')
  })

  it('primary가 주간(10080)+secondary null이어도 동작', async () => {
    writeRollout('rollout-b.jsonl', [
      RL({ used_percent: 17, window_minutes: 10080, resets_at: 1784508175 }, null)
    ])
    const s = await readCodexLimits(dir)
    expect(s.windows).toEqual([{ kind: 'weekly', usedPercent: 17, resetsAt: 1784508175 }])
  })

  it('primary가 주간, secondary가 세션이어도 표시 순서는 세션→주간으로 고정', async () => {
    writeRollout('rollout-swap.jsonl', [
      RL(
        { used_percent: 44, window_minutes: 10080, resets_at: 1784508200 },
        { used_percent: 21, window_minutes: 300, resets_at: 1783091000 }
      )
    ])
    const s = await readCodexLimits(dir)
    expect(s.windows).toEqual([
      { kind: 'session_5h', usedPercent: 21, resetsAt: 1783091000 },
      { kind: 'weekly', usedPercent: 44, resetsAt: 1784508200 }
    ])
  })

  it('가장 최신 mtime 파일을 선택', async () => {
    writeRollout(
      'rollout-old.jsonl',
      [RL({ used_percent: 99, window_minutes: 300, resets_at: 1 }, null)],
      new Date(Date.now() - 86400_000)
    )
    writeRollout('rollout-new.jsonl', [
      RL({ used_percent: 5, window_minutes: 300, resets_at: 2 }, null)
    ])
    const s = await readCodexLimits(dir)
    expect(s.windows[0].usedPercent).toBe(5)
  })

  it('30분 넘은 파일은 stale', async () => {
    writeRollout(
      'rollout-c.jsonl',
      [RL({ used_percent: 1, window_minutes: 300, resets_at: 3 }, null)],
      new Date(Date.now() - 31 * 60_000)
    )
    expect((await readCodexLimits(dir)).stale).toBe(true)
  })

  it('rate_limits 없으면 no-data, 디렉터리 없으면 no-credentials', async () => {
    writeRollout('rollout-d.jsonl', ['{"a":1}'])
    expect((await readCodexLimits(dir)).error).toBe('no-data')
    expect((await readCodexLimits(join(dir, 'nope'))).error).toBe('no-credentials')
  })

  it('512KiB 초과 파일: tail 경계가 한글 패딩 문자 중간에 걸려도 창을 찾는다', async () => {
    const TAIL = 512 * 1024 // limits.ts의 TAIL_BYTES와 동일해야 함
    // 창 밖(파일 앞부분)의 미끼 rate_limits — 결과에 나오면 tail 컷이 안 된 것
    const decoy = RL({ used_percent: 99, window_minutes: 300, resets_at: 1 }, null)
    const rl = RL(
      { used_percent: 7, window_minutes: 300, resets_at: 111 },
      { used_percent: 9, window_minutes: 10080, resets_at: 222 }
    )
    // 한글 패딩 뒤에 오는 바이트 수를 3의 배수로 맞춰, 컷 지점이 3바이트 문자의
    // 2번째 바이트(문자 중간)에 정확히 떨어지게 한다. (TAIL % 3 === 2 이용)
    let tailJunk = '{"z":1}'
    const restBytes = (): number => Buffer.byteLength('"}\n' + rl + '\n' + tailJunk + '\n')
    while (restBytes() % 3 !== 0) tailJunk += ' '
    const korean = '한'.repeat(Math.ceil(TAIL / 3) + 100) // '한' = UTF-8 3바이트
    const padLine = '{"pad":"' + korean + '"}'
    const p = writeRollout('rollout-big.jsonl', [decoy, padLine, rl, tailJunk])

    // 시나리오 전제 검증: 파일이 창보다 크고, 컷이 한글 런 안의 문자 중간에 위치
    const size = statSync(p).size
    expect(size).toBeGreaterThan(TAIL)
    const cut = size - TAIL
    const koreanStart = Buffer.byteLength(decoy + '\n{"pad":"')
    expect(cut).toBeGreaterThan(koreanStart)
    expect(cut).toBeLessThan(koreanStart + Buffer.byteLength(korean))
    expect((cut - koreanStart) % 3).toBe(1) // 문자 경계가 아닌 중간 바이트

    const s = await readCodexLimits(dir)
    expect(s.error).toBeUndefined()
    expect(s.windows).toEqual([
      { kind: 'session_5h', usedPercent: 7, resetsAt: 111 },
      { kind: 'weekly', usedPercent: 9, resetsAt: 222 }
    ])
    expect(s.plan).toBe('plus')
  })
})
