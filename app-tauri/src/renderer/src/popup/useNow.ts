// 팝업의 상대 시각 표시("1h 32m 후 리셋", "n분 전 활동 기준" 등)를 위한 "현재 시각" 훅.
// Date.now()를 렌더 함수 본문/기본 인자에서 직접 호출하면 impure(react-hooks purity 규칙 위반)이므로,
// 최초 1회는 useState의 지연 초기화 함수 안에서, 이후는 타이머 콜백(렌더 바깥) 안에서만 호출한다.
import { useEffect, useState } from 'react'

const TICK_MS = 30_000 // 30초 간격 — 분 단위 카운트다운이 눈에 띄게 어긋나지 않을 정도로 충분히 촘촘하다

export function useNow(): number {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}
