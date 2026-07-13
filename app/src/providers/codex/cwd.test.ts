import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeCwdResolver } from './cwd'

const META = (cwd: string): string =>
  JSON.stringify({ timestamp: '2026-07-13T00:00:00Z', type: 'session_meta', payload: { cwd } })

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-cwd-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function writeRollout(directory: string, name: string, firstLine: string): string {
  const dir = join(root, directory)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, firstLine + '\n{"other":"line"}\n')
  return p
}

describe('makeCwdResolver', () => {
  it('실제 레이아웃 e2e: 확장자 없는 sessionFile도 .jsonl 재시도로 cwd를 찾는다', () => {
    writeRollout('2026/07/13', 'rollout-abc.jsonl', META('D:\\Projects\\X'))
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/13', 'rollout-abc')).toBe('D:\\Projects\\X')
  })

  it('확장자가 이미 붙은 sessionFile은 그대로 찾는다', () => {
    writeRollout('2026/07/12', 'rollout-def.jsonl', META('D:\\Projects\\Y'))
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/12', 'rollout-def.jsonl')).toBe('D:\\Projects\\Y')
  })

  it('없는 파일은 null', () => {
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/13', 'rollout-nope')).toBeNull()
  })

  it('첫 줄이 깨진 JSON이면 null', () => {
    writeRollout('2026/07/13', 'rollout-corrupt.jsonl', '{not valid json')
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/13', 'rollout-corrupt')).toBeNull()
  })

  it('첫 줄에 session_meta cwd가 없으면 null', () => {
    writeRollout(
      '2026/07/13',
      'rollout-nocwd.jsonl',
      '{"timestamp":"2026-07-13T00:00:00Z","type":"other"}'
    )
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/13', 'rollout-nocwd')).toBeNull()
  })

  it('두 번째 호출은 캐시 — 파일 삭제 후에도 동일 결과', () => {
    const p = writeRollout('2026/07/13', 'rollout-cache.jsonl', META('D:\\Projects\\Z'))
    const resolve = makeCwdResolver(root)
    expect(resolve('2026/07/13', 'rollout-cache')).toBe('D:\\Projects\\Z')
    rmSync(p)
    expect(resolve('2026/07/13', 'rollout-cache')).toBe('D:\\Projects\\Z')
  })
})
