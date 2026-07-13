// ccusage는 CLI 전용 패키지(라이브러리 export 없음)라 자식 프로세스로 실행한다.
// 패키징된 앱에는 node.exe가 없으므로 Electron 바이너리를 ELECTRON_RUN_AS_NODE로 재사용.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)

function ccusageBinPath(): string {
  // ccusage/package.json의 bin 엔트리 절대경로 해석 (asarUnpack 대상 — Task 12)
  const pkgPath = require_.resolve('ccusage/package.json')
  const pkg = require_('ccusage/package.json')
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.ccusage
  return pkgPath.replace(/package\.json$/, rel.replace(/^\.\//, ''))
}

export async function runCcusage(args: string[]): Promise<unknown> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [ccusageBinPath(), ...args],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 64 * 1024 * 1024, // 세션 765개 JSON이 수 MB — 넉넉히
        windowsHide: true,
        timeout: 120_000
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`ccusage returned non-JSON output: ${stdout.slice(0, 200)}`)
  }
}
