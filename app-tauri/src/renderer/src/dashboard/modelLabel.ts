// 저장된 모델명 문자열(', '로 이어진 원본)을 화면 뱃지용 짧은 이름으로 바꾼다.
// Claude 모델명만 규칙이 확실해(claude-<계열>-<버전>-<날짜>) 축약하고, 그 외 이름은 손대지 않는다 —
// 모르는 이름을 임의로 자르면 gpt-5.6-sol 같은 이름이 훼손된다.
// 날짜 접미사를 버전 정규식 안에서 선택적으로 처리하면 버전 그룹이 날짜까지 삼킨다
// (4-5-20251001 전체가 버전으로 매치됨) — 먼저 떼어낸 뒤 버전만 매치한다.
const DATE_SUFFIX = /-\d{8}$/
const CLAUDE_NAME = /^claude-([a-z]+)-((?:\d+-)*\d+)$/

/** 'claude-haiku-4-5-20251001' → 'Haiku 4.5'. 규칙에 안 맞으면 원본 그대로. */
export function shortModelName(raw: string): string {
  const m = CLAUDE_NAME.exec(raw.replace(DATE_SUFFIX, ''))
  if (!m) return raw
  const family = m[1][0].toUpperCase() + m[1].slice(1)
  return `${family} ${m[2].replaceAll('-', '.')}`
}

/** 저장 문자열 → 뱃지 목록. 빈 문자열이면 빈 배열(호출부가 표시 여부를 정한다). */
export function modelBadges(models: string): string[] {
  return models
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(shortModelName)
}
