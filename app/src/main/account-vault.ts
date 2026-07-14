// 토큰 사본 보관소(스펙 §컴포넌트). 사본은 원본 자격증명 파일의 통째 복사 — 내용을 파싱·로깅하지 않는다.
// 코덱스 사본의 refresh_token은 어떤 코드도 읽지 않는다(스펙 F3). 모든 메서드는 throw하지 않는다.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProviderId } from '../providers/types'

export interface AccountVault {
  credPath(provider: ProviderId, accountId: string): string
  hasCopy(provider: ProviderId, accountId: string): boolean
  copyIfChanged(provider: ProviderId, accountId: string, sourcePath: string): void
  isRevoked(provider: ProviderId, accountId: string): boolean
  markRevoked(provider: ProviderId, accountId: string): void
}

function fileKey(provider: ProviderId, accountId: string): string {
  return `${provider}-${accountId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export function createVault(rootDir: string): AccountVault {
  try {
    mkdirSync(rootDir, { recursive: true })
  } catch {
    // 생성 실패 시 이후 호출들이 개별적으로 조용히 실패한다 — 앱 부팅을 막지 않는다.
  }
  const credPath = (p: ProviderId, id: string): string => join(rootDir, `${fileKey(p, id)}.json`)
  const revokedPath = (p: ProviderId, id: string): string =>
    join(rootDir, `${fileKey(p, id)}.revoked`)

  return {
    credPath,
    hasCopy: (p, id) => existsSync(credPath(p, id)),
    copyIfChanged(p, id, sourcePath) {
      try {
        const source = readFileSync(sourcePath, 'utf-8')
        const dest = credPath(p, id)
        if (existsSync(dest) && readFileSync(dest, 'utf-8') === source) return
        const tmp = join(rootDir, `.${fileKey(p, id)}.${process.pid}.tmp`)
        writeFileSync(tmp, source, 'utf-8')
        renameSync(tmp, dest)
        try {
          unlinkSync(revokedPath(p, id)) // 새 토큰 사본 = revoked 상태 해제
        } catch {
          // 마커가 없던 경우 — 정상
        }
      } catch {
        // 원본 없음/쓰기 실패 — 기존 사본 유지, 다음 틱에 재시도된다.
      }
    },
    isRevoked: (p, id) => existsSync(revokedPath(p, id)),
    markRevoked(p, id) {
      try {
        writeFileSync(revokedPath(p, id), String(Date.now()), 'utf-8')
      } catch {
        // 마킹 실패 — 다음 틱에 401을 다시 만나면 재시도.
      }
    }
  }
}
