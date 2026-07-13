// 프로바이더 토글 칩("● Claude"/"● Codex") — 목업(dashboard.html) filters row 우측과 동일한 형태.
// selected가 비면(둘 다 꺼짐) 대시보드 셸이 쿼리를 보내지 않고 안내 문구를 보여준다(빈 배열=all이
// 아니라 "표시할 게 없음"으로 다루기 위해 — queries.ts의 providers 필터는 빈 배열을 "필터 없음"으로
// 해석하므로, 그 의미 차이를 여기서 만들지 않고 호출부(Dashboard.tsx)에서 조기 처리한다).
import type { ProviderId } from '../../../providers/types'

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }
const ALL_PROVIDERS: ProviderId[] = ['claude', 'codex']

interface ProviderToggleProps {
  selected: ProviderId[]
  onChange: (next: ProviderId[]) => void
}

export default function ProviderToggle({
  selected,
  onChange
}: ProviderToggleProps): React.JSX.Element {
  function toggle(p: ProviderId): void {
    onChange(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p])
  }

  return (
    <div className="chips provider-toggle">
      {ALL_PROVIDERS.map((p) => (
        <button
          key={p}
          type="button"
          className={`chip${selected.includes(p) ? ' chip--on' : ''}`}
          onClick={() => toggle(p)}
        >
          <span className={`provider-dot provider-dot--${p}`} /> {PROVIDER_LABEL[p]}
        </button>
      ))}
    </div>
  )
}
