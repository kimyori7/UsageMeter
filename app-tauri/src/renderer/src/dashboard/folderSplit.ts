// 폴더·세션 탭의 비중 막대 계산. queries.ts의 folderRollup은 provider별 합계를 병합해 반환하므로
// (providers: ProviderId[] 목록만 남고 provider별 금액은 소실) 막대의 Claude/Codex 색 분할 비율을
// 재구성하려면 provider 하나씩 필터링한 두 번의 folderRollup 호출 결과를 여기서 다시 합친다.
// (queries.ts는 이미 테스트된 순수 쿼리 모듈이라 반환 형태를 바꾸지 않고 렌더러 쪽에서 조합한다.)
import type { ProviderId } from '../../../providers/types'

interface FolderRollupRow {
  folder: string
  providers: ProviderId[]
  costUsd: number
  totalTokens: number
}

export interface FolderSplitRow {
  folder: string
  claudeCost: number
  codexCost: number
  totalCost: number
  totalTokens: number
  providers: ProviderId[] // 이 폴더에 실제 비용>0로 기여한 provider만 (요청 시 토글 꺼진 provider는 제외됨)
  sharePercent: number // totalCost / (표시되는 폴더 전체 합) * 100 — "기간 내 비중" 막대 폭
}

/** claude 전용/codex 전용 folderRollup 결과를 폴더별로 병합하고 비중(%)을 계산해 내림차순 정렬한다. */
export function mergeFolderSplits(
  claudeRows: FolderRollupRow[],
  codexRows: FolderRollupRow[]
): FolderSplitRow[] {
  const byFolder = new Map<string, { claudeCost: number; codexCost: number; totalTokens: number }>()
  for (const row of claudeRows) {
    const existing = byFolder.get(row.folder) ?? { claudeCost: 0, codexCost: 0, totalTokens: 0 }
    existing.claudeCost += row.costUsd
    existing.totalTokens += row.totalTokens
    byFolder.set(row.folder, existing)
  }
  for (const row of codexRows) {
    const existing = byFolder.get(row.folder) ?? { claudeCost: 0, codexCost: 0, totalTokens: 0 }
    existing.codexCost += row.costUsd
    existing.totalTokens += row.totalTokens
    byFolder.set(row.folder, existing)
  }

  const merged = [...byFolder.entries()]
    .map(([folder, v]) => {
      const totalCost = v.claudeCost + v.codexCost
      const providers: ProviderId[] = []
      if (v.claudeCost > 0) providers.push('claude')
      if (v.codexCost > 0) providers.push('codex')
      return { folder, ...v, totalCost, providers }
    })
    // 방어적 필터 — 이론상 두 provider 모두 비용 0(토큰만 존재)인 행은 막대가 의미 없어 제외한다.
    .filter((r) => r.totalCost > 0 || r.totalTokens > 0)

  const grandTotal = merged.reduce((sum, r) => sum + r.totalCost, 0)

  return merged
    .map((r) => ({ ...r, sharePercent: grandTotal > 0 ? (r.totalCost / grandTotal) * 100 : 0 }))
    .sort((a, b) => b.totalCost - a.totalCost)
}
