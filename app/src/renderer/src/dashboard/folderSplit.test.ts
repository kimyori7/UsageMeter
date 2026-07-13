import { describe, it, expect } from 'vitest'
import { mergeFolderSplits } from './folderSplit'
import type { ProviderId } from '../../../providers/types'

interface FolderRollupRow {
  folder: string
  providers: ProviderId[]
  costUsd: number
  totalTokens: number
}

describe('mergeFolderSplits', () => {
  it('claude/codex 단일 프로바이더 롤업 두 배열을 폴더별로 병합하고 비중(%)을 계산', () => {
    const claudeRows: FolderRollupRow[] = [
      { folder: 'proj', providers: ['claude'], costUsd: 10, totalTokens: 100 }
    ]
    const codexRows: FolderRollupRow[] = [
      { folder: 'proj', providers: ['codex'], costUsd: 5, totalTokens: 50 },
      { folder: 'other', providers: ['codex'], costUsd: 5, totalTokens: 50 }
    ]
    const result = mergeFolderSplits(claudeRows, codexRows)
    expect(result).toEqual([
      {
        folder: 'proj',
        claudeCost: 10,
        codexCost: 5,
        totalCost: 15,
        totalTokens: 150,
        providers: ['claude', 'codex'],
        sharePercent: 75
      },
      {
        folder: 'other',
        claudeCost: 0,
        codexCost: 5,
        totalCost: 5,
        totalTokens: 50,
        providers: ['codex'],
        sharePercent: 25
      }
    ])
  })

  it('totalCost 내림차순 정렬', () => {
    const claudeRows: FolderRollupRow[] = [
      { folder: 'small', providers: ['claude'], costUsd: 1, totalTokens: 1 },
      { folder: 'big', providers: ['claude'], costUsd: 100, totalTokens: 1 }
    ]
    expect(mergeFolderSplits(claudeRows, []).map((r) => r.folder)).toEqual(['big', 'small'])
  })

  it('한쪽 배열이 비어 있으면(프로바이더 토글 꺼짐) 그쪽 비용은 전부 0', () => {
    const claudeRows: FolderRollupRow[] = [
      { folder: 'proj', providers: ['claude'], costUsd: 10, totalTokens: 100 }
    ]
    const result = mergeFolderSplits(claudeRows, [])
    expect(result).toEqual([
      {
        folder: 'proj',
        claudeCost: 10,
        codexCost: 0,
        totalCost: 10,
        totalTokens: 100,
        providers: ['claude'],
        sharePercent: 100
      }
    ])
  })

  it('둘 다 비어 있으면 빈 배열(0으로 나누기 없이)', () => {
    expect(mergeFolderSplits([], [])).toEqual([])
  })
})
