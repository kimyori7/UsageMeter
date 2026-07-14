// 픽스처는 전부 FAKE 토큰 — 실계정 파일 접근 금지.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVault } from './account-vault'

let root: string
let srcDir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-'))
  srcDir = mkdtempSync(join(tmpdir(), 'vault-src-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})
function writeSource(content: string): string {
  const p = join(srcDir, 'auth.json')
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('createVault', () => {
  it('사본 생성·내용 동일 시 스킵·변경 시 갱신, temp 잔여물 없음', () => {
    const vault = createVault(join(root, 'accounts'))
    const src = writeSource('{"t":"FAKE-1"}')
    vault.copyIfChanged('codex', 'acc-1', src)
    expect(vault.hasCopy('codex', 'acc-1')).toBe(true)
    expect(readFileSync(vault.credPath('codex', 'acc-1'), 'utf-8')).toBe('{"t":"FAKE-1"}')
    vault.copyIfChanged('codex', 'acc-1', src) // 동일 — 스킵(에러 없이)
    writeFileSync(src, '{"t":"FAKE-2"}', 'utf-8')
    vault.copyIfChanged('codex', 'acc-1', src)
    expect(readFileSync(vault.credPath('codex', 'acc-1'), 'utf-8')).toBe('{"t":"FAKE-2"}')
    expect(readdirSync(join(root, 'accounts')).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('revoked 마킹은 재생성 후에도 유지되고, 내용 변경 사본이 오면 해제된다', () => {
    const vault = createVault(join(root, 'accounts'))
    const src = writeSource('{"t":"FAKE-1"}')
    vault.copyIfChanged('claude', 'acc-1', src)
    vault.markRevoked('claude', 'acc-1')
    expect(createVault(join(root, 'accounts')).isRevoked('claude', 'acc-1')).toBe(true) // 영속
    writeFileSync(src, '{"t":"FAKE-3"}', 'utf-8')
    vault.copyIfChanged('claude', 'acc-1', src) // 새 토큰 → 해제
    expect(vault.isRevoked('claude', 'acc-1')).toBe(false)
  })

  it('원본 없음 → 조용히 무시(기존 사본 유지)', () => {
    const vault = createVault(join(root, 'accounts'))
    const src = writeSource('{"t":"FAKE-1"}')
    vault.copyIfChanged('codex', 'acc-1', src)
    vault.copyIfChanged('codex', 'acc-1', join(srcDir, 'no-such.json'))
    expect(readFileSync(vault.credPath('codex', 'acc-1'), 'utf-8')).toBe('{"t":"FAKE-1"}')
  })

  it('accountId의 경로 위험 문자를 파일명에서 무해화한다', () => {
    const vault = createVault(join(root, 'accounts'))
    const p = vault.credPath('claude', 'a/b\\c:d')
    expect(p.startsWith(join(root, 'accounts'))).toBe(true)
    // 전체 경로가 아닌 파일명(basename)만 검사 — Windows에서는 join()의 '\' 구분자가
    // 'claude' 앞에 항상 붙어 전체 경로 문자열 검사가 오탐(false positive)을 낸다.
    const name = basename(p)
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
  })
})
