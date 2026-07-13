import { describe, it, expect, vi } from 'vitest'
import { runCcusage } from './ccusage-runner'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
import { execFile } from 'node:child_process'

function mockExec(stdout: string, code = 0) {
  ;(execFile as any).mockImplementation((_f: any, _a: any, _o: any, cb: any) =>
    cb(code === 0 ? null : Object.assign(new Error('exit'), { code }), stdout, '')
  )
}

describe('runCcusage', () => {
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
})
