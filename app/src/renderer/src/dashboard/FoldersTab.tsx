// 폴더·세션 탭 — 목업(dashboard.html) 재현: cwd 단위 롤업 행(비중 막대, provider 색 분할) → 클릭 시
// 세션 목록으로 펼침. folderRollup(providers 필터만 지원)만으로는 폴더별 provider 비용 분할을 알 수
// 없어(합산 후 providers 목록만 남음) claude/codex 각각 단일 provider로 두 번 조회해 클라이언트에서
// 다시 합친다(folderSplit.ts, queries.ts는 건드리지 않음). period는 Task11에서 folderRollup/
// sessionsInFolder에 새로 추가한 from/to로 적용한다(store/queries.ts 변경 — 스코프 노트: 대시보드 셸의
// 기간 칩이 폴더 탭에도 실제로 적용되게 하려면 필요했다. queries.test.ts에 기존 케이스를 건드리지 않고
// 케이스만 추가했다).
import { useEffect, useState } from 'react'
import { queryFolders, queryFolderSessions } from '../api'
import { mergeFolderSplits, type FolderSplitRow } from './folderSplit'
import { sessionLabel } from './sessionLabel'
import { periodRange, type Period } from './period'
import { fmtMoney, fmtTokens } from '../popup/format'
import type { ProviderId, SessionRow } from '../../../providers/types'

interface FoldersTabProps {
  period: Period
  providers: ProviderId[]
}

function dotVariant(rowProviders: ProviderId[]): string {
  if (rowProviders.includes('claude') && rowProviders.includes('codex')) return 'both'
  return rowProviders.includes('claude') ? 'claude' : 'codex'
}

/** 비중 막대의 배경 — 두 provider가 섞인 폴더는 claudeCost 비율 지점에서 색을 나눈 그라디언트. */
function barBackground(row: FolderSplitRow): string {
  if (row.providers.length < 2) return row.providers.includes('claude') ? '#d97757' : '#19c37d'
  const claudeShare = row.totalCost > 0 ? (row.claudeCost / row.totalCost) * 100 : 50
  return `linear-gradient(90deg, #d97757 ${claudeShare}%, #19c37d ${claudeShare}%)`
}

export default function FoldersTab({ period, providers }: FoldersTabProps): React.JSX.Element {
  const [rows, setRows] = useState<FolderSplitRow[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [sessionsByFolder, setSessionsByFolder] = useState<Record<string, SessionRow[]>>({})

  useEffect(() => {
    let cancelled = false
    const range = periodRange(period)
    const claudeSelected = providers.includes('claude')
    const codexSelected = providers.includes('codex')

    Promise.all([
      claudeSelected ? queryFolders({ ...range, providers: ['claude'] }) : Promise.resolve([]),
      codexSelected ? queryFolders({ ...range, providers: ['codex'] }) : Promise.resolve([])
    ]).then(([claudeRows, codexRows]) => {
      if (cancelled) return
      setRows(mergeFolderSplits(claudeRows, codexRows))
      setExpanded(new Set())
      setSessionsByFolder({})
    })

    return () => {
      cancelled = true
    }
  }, [period, providers])

  function toggleFolder(folder: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) {
        next.delete(folder)
        return next
      }
      next.add(folder)
      if (!sessionsByFolder[folder]) {
        const range = periodRange(period)
        queryFolderSessions(folder, { ...range, providers }).then((sessions) => {
          setSessionsByFolder((prevSessions) => ({ ...prevSessions, [folder]: sessions }))
        })
      }
      return next
    })
  }

  if (rows.length === 0) {
    return <div className="folders-empty">표시할 폴더가 없습니다.</div>
  }

  return (
    <div className="folders-tab">
      {rows.map((row) => {
        const isOpen = expanded.has(row.folder)
        const sessions = sessionsByFolder[row.folder]

        return (
          <div key={row.folder}>
            <div className="frow" onClick={() => toggleFolder(row.folder)}>
              <span className="caret">{isOpen ? '▼' : '▶'}</span>
              <span className={`dot dot--${dotVariant(row.providers)}`} />
              <span className="fname">{row.folder}</span>
              <span className="fbar">
                <i style={{ width: `${row.sharePercent}%`, background: barBackground(row) }} />
              </span>
              <span className="ftok">{fmtTokens(row.totalTokens)}</span>
              <span className="fcost">{fmtMoney(row.totalCost)}</span>
            </div>

            {isOpen && (
              <>
                {sessions === undefined && (
                  <div className="frow child">
                    <span className="caret" />
                    <span className="fname folders-loading">불러오는 중…</span>
                  </div>
                )}
                {sessions?.length === 0 && (
                  <div className="frow child">
                    <span className="caret" />
                    <span className="fname folders-loading">세션 없음</span>
                  </div>
                )}
                {sessions?.map((session) => (
                  <div key={session.sessionId} className="frow child">
                    <span className="caret" />
                    <span className={`dot dot--${session.provider}`} />
                    <span className="fname">{sessionLabel(session)}</span>
                    <span className="ftok">{fmtTokens(session.totalTokens)}</span>
                    <span className="fcost">{fmtMoney(session.costUsd)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
