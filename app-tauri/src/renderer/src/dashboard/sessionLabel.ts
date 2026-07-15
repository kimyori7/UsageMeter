// 폴더·세션 탭이 펼친 세션 행에 쓰는 표시 라벨. SessionRow(providers/types.ts)에는 제목(title) 필드가
// 없다 — ccusage session JSON에도 없어 애초에 정규화 파이프라인(usage-normalizer.ts)이 만들지 못한다.
// 목업(dashboard.html)의 codex 행도 실제 제목이 아니라 잘린 rollout 파일명("rollout-…f5")을 쓰고
// 있어, 이 자리표시 방식(시각 + sessionId 앞 8자)이 목업과 어긋나지 않는 정직한 대체다.
function fmtSessionTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '(시각 미상)'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

export function sessionLabel(session: {
  startedAt: string | null
  endedAt: string | null
  sessionId: string
}): string {
  const iso = session.startedAt ?? session.endedAt
  const time = iso ? fmtSessionTime(iso) : '(시각 미상)'
  return `${time} · ${session.sessionId.slice(0, 8)}`
}
