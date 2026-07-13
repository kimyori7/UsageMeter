// ccusage는 CLI 전용 패키지(라이브러리 export 없음)라 자식 프로세스로 실행한다.
// v20부터 ccusage의 실제 구현은 플랫폼별 네이티브 바이너리(@ccusage/ccusage-<platform>-<arch>)이고,
// node_modules/ccusage/src/cli.js는 그 바이너리를 찾아 재실행하는 JS 디스패처일 뿐이다. 그 디스패처는
// require.resolve()로 얻은 asar 가상경로를 그대로 child_process.spawn()에 넘기는데, spawn은 OS 레벨
// 프로세스 생성이라 asar 내부 경로를 이해하지 못한다(app.asar는 OS 입장에선 폴더가 아니라 파일 하나) —
// 디스패처 내부 코드라 여기서 고칠 수 없다. 대신 우리 쪽에서 네이티브 바이너리 경로를 직접 해석해
// 곧바로 실행한다(디스패처/ELECTRON_RUN_AS_NODE 우회) — 실측(dev, packaged 모두)으로 cli.js를 거친
// 출력과 바이트 단위로 동일함을 확인함 (Task 12).
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { sep } from 'node:path'

const require_ = createRequire(import.meta.url)

function nativePackageName(): string | undefined {
  const { platform, arch } = process
  if (
    (platform === 'win32' || platform === 'darwin' || platform === 'linux') &&
    (arch === 'x64' || arch === 'arm64')
  ) {
    return `@ccusage/ccusage-${platform}-${arch}`
  }
  return undefined
}

function ccusageBinPath(): string {
  const pkgName = nativePackageName()
  if (!pkgName) {
    throw new Error(
      `ccusage native binary is not available for ${process.platform}-${process.arch}`
    )
  }
  const exeName = process.platform === 'win32' ? 'ccusage.exe' : 'ccusage'
  const binPath = require_.resolve(`${pkgName}/bin/${exeName}`)
  // 패키징 시 asar 가상경로는 실행 불가 — asarUnpack 대상 실경로로 치환 (Task 12)
  return binPath.replace('app.asar' + sep, 'app.asar.unpacked' + sep)
}

export async function runCcusage(args: string[]): Promise<unknown> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      ccusageBinPath(),
      args,
      {
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
