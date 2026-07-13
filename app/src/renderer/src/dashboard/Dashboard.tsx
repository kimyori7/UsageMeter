// 대시보드 셸: 탭바(개요/일별 기록/폴더·세션/월 리포트/⚙) + 기간·프로바이더 필터 상태.
// 필터는 셸이 소유하고 각 탭에 props로 내려준다(브리프 Step1) — 탭 전환 시 비활성 탭은 언마운트한다
// (조건부 렌더링, display:none 아님): 재마운트가 곧 재조회이므로 필터를 바꾸지 않고 탭만 오가도
// 최신 데이터를 다시 받는다는 장점이 있다(포커스 복귀 시 새로고침 효과).
import { useState } from 'react'
import PeriodChips from '../components/PeriodChips'
import ProviderToggle from '../components/ProviderToggle'
import OverviewTab from './OverviewTab'
import DailyTab from './DailyTab'
import FoldersTab from './FoldersTab'
import type { Period } from './period'
import type { ProviderId } from '../../../providers/types'

type TabId = 'overview' | 'daily' | 'folders' | 'monthly' | 'settings'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: '개요' },
  { id: 'daily', label: '일별 기록' },
  { id: 'folders', label: '폴더·세션' },
  { id: 'monthly', label: '월 리포트' },
  { id: 'settings', label: '⚙' }
]

// 필터(기간·프로바이더)를 실제로 쓰는 탭만 필터 바를 보여준다 — 월 리포트/설정은 해당 없음
// (monthlyRollup은 opts가 없고, 설정 화면은 데이터 조회 자체가 없다).
const TABS_WITH_FILTERS: ReadonlySet<TabId> = new Set(['overview', 'daily', 'folders'])

export default function Dashboard(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [period, setPeriod] = useState<Period>('30d')
  const [providers, setProviders] = useState<ProviderId[]>(['claude', 'codex'])

  const showFilters = TABS_WITH_FILTERS.has(activeTab)
  const noProvidersSelected = showFilters && providers.length === 0

  return (
    <div className="dashboard">
      <div className="dashboard-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`dashboard-tab${tab.id === activeTab ? ' dashboard-tab--on' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dashboard-body">
        {showFilters && (
          <div className="dashboard-filters">
            <PeriodChips value={period} onChange={setPeriod} />
            <span className="dashboard-filters-spacer" />
            <ProviderToggle selected={providers} onChange={setProviders} />
          </div>
        )}

        {noProvidersSelected ? (
          <div className="dashboard-empty">
            선택된 프로바이더가 없습니다 — 위에서 하나 이상 켜세요.
          </div>
        ) : (
          <>
            {activeTab === 'overview' && <OverviewTab period={period} providers={providers} />}
            {activeTab === 'daily' && <DailyTab period={period} providers={providers} />}
            {activeTab === 'folders' && <FoldersTab period={period} providers={providers} />}
            {/* 월 리포트/설정은 후속 커밋에서 채운다(다음 2개 커밋 참고). */}
            {(activeTab === 'monthly' || activeTab === 'settings') && (
              <div className="dashboard-empty">이 탭은 다음 커밋에서 구현됩니다.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
