import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeCwdResolver } from './cwd'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codex-cwd-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function writeSession(name: string, firstLine: string, rest = '{"other":"line"}\n'): string {
  const p = join(dir, name)
  writeFileSync(p, firstLine + '\n' + rest)
  return p
}

describe('makeCwdResolver', () => {
  it('session_meta payload.cwd를 첫 줄에서 읽는다', () => {
    const p = writeSession(
      'a.jsonl',
      '{"timestamp":"2026-07-13T00:00:00Z","type":"session_meta","payload":{"cwd":"D:\\\\Projects\\\\X"}}'
    )
    const resolve = makeCwdResolver()
    expect(resolve(p)).toBe('D:\\Projects\\X')
  })

  it('없는 파일은 null', () => {
    const resolve = makeCwdResolver()
    expect(resolve(join(dir, 'nope.jsonl'))).toBeNull()
  })

  it('첫 줄이 깨진 JSON이면 null', () => {
    const p = writeSession('corrupt.jsonl', '{not valid json')
    const resolve = makeCwdResolver()
    expect(resolve(p)).toBeNull()
  })

  it('첫 줄에 session_meta가 없거나 cwd가 없으면 null', () => {
    const p = writeSession('no-cwd.jsonl', '{"timestamp":"2026-07-13T00:00:00Z","type":"other"}')
    const resolve = makeCwdResolver()
    expect(resolve(p)).toBeNull()
  })

  it('두 번째 호출은 캐시 — 파일 삭제 후에도 동일 결과', () => {
    const p = writeSession(
      'b.jsonl',
      '{"timestamp":"2026-07-13T00:00:00Z","type":"session_meta","payload":{"cwd":"D:\\\\Projects\\\\Y"}}'
    )
    const resolve = makeCwdResolver()
    expect(resolve(p)).toBe('D:\\Projects\\Y')
    rmSync(p)
    expect(resolve(p)).toBe('D:\\Projects\\Y')
  })
})
