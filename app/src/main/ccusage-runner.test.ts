import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sep } from 'node:path'
import { runCcusage } from './ccusage-runner'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
// ccusage-runner는 모듈 로드 시 createRequire()로 require_를 만들고 require_.resolve()로
// 네이티브 바이너리 경로를 얻는다 — 경로 치환 분기를 테스트하려고 node:module을 목으로 대체.
const resolveMock = vi.hoisted(() => vi.fn())
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: resolveMock }) }))
import { execFile } from 'node:child_process'

const DEV_BIN_PATH = ['D:', 'dev', 'node_modules', '@ccusage', 'x', 'bin', 'ccusage.exe'].join(sep)

function mockExec(stdout: string, code = 0) {
  ;(execFile as any).mockImplementation((_f: any, _a: any, _o: any, cb: any) =>
    cb(code === 0 ? null : Object.assign(new Error('exit'), { code }), stdout, '')
  )
}

function stubProcess(prop: 'platform' | 'arch', value: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, prop)!
  Object.defineProperty(process, prop, { value })
  return () => Object.defineProperty(process, prop, original)
}

describe('runCcusage', () => {
  let restores: Array<() => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
    resolveMock.mockReturnValue(DEV_BIN_PATH)
  })
  afterEach(() => {
    restores.forEach((r) => r())
    restores = []
  })

  it('parses JSON stdout', async () => {
    mockExec('{"daily":[],"totals":{}}')
    await expect(runCcusage(['daily', '--json'])).resolves.toEqual({ daily: [], totals: {} })
  })
  it('rejects on non-JSON output', async () => {
    mockExec('boom')
    await expect(runCcusage(['daily', '--json'])).rejects.toThrow(/JSON/)
  })
  it('rejects on process failure', async () => {
    mockExec('', 1)
    await expect(runCcusage(['daily', '--json'])).rejects.toThrow()
  })

  it('지원하지 않는 platform이면 설명적 에러로 reject하고 execFile을 호출하지 않는다', async () => {
    restores.push(stubProcess('platform', 'freebsd'), stubProcess('arch', 'x64'))
    await expect(runCcusage(['daily', '--json'])).rejects.toThrow(/not available for freebsd-x64/)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('지원하지 않는 arch면 설명적 에러로 reject하고 execFile을 호출하지 않는다', async () => {
    restores.push(stubProcess('platform', 'win32'), stubProcess('arch', 'ia32'))
    await expect(runCcusage(['daily', '--json'])).rejects.toThrow(/not available for win32-ia32/)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('resolve된 경로의 app.asar 세그먼트를 app.asar.unpacked로 치환해 실행한다', async () => {
    const asarSegments = ['D:', 'app', 'resources', 'app.asar', 'node_modules', '@ccusage']
    const asarPath = [...asarSegments, 'x', 'bin', 'ccusage.exe'].join(sep)
    resolveMock.mockReturnValue(asarPath)
    mockExec('{"ok":true}')
    await runCcusage(['daily', '--json'])
    const calledPath = (execFile as any).mock.calls[0][0]
    expect(calledPath).toBe(asarPath.replace('app.asar' + sep, 'app.asar.unpacked' + sep))
    expect(calledPath).toContain('app.asar.unpacked' + sep + 'node_modules')
  })

  it('asar 밖 경로(dev)는 치환 없이 그대로 실행한다', async () => {
    mockExec('{"ok":true}')
    await runCcusage(['daily', '--json'])
    expect((execFile as any).mock.calls[0][0]).toBe(DEV_BIN_PATH)
  })
})
