// 개요 탭의 요약 카드 3개(이번 주 비용 / 주간 한도 % / 이번 달 누적)가 공유하는 얇은 컨테이너.
// 값 표시 방식이 카드마다 다르므로(단일 금액 vs 프로바이더별 두 줄) 내용은 children으로 위임한다.
interface StatCardProps {
  label: string
  children: React.ReactNode
}

export default function StatCard({ label, children }: StatCardProps): React.JSX.Element {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-body">{children}</div>
    </div>
  )
}
