// 팝업 루트 요소의 실제 높이를 메인 프로세스에 보고해 창을 content-fit시키는 훅.
// ResizeObserver는 실제 크기 변화에만 발화하지만, 마운트 직후 1회 보고 + StrictMode의 이펙트
// 재실행이 있으므로 마지막 전송값과 같으면 보내지 않는다(no-op resize 스킵). 클램프(min/max)와
// sender 검증은 메인(windows.resizePopup) 책임 — 렌더러는 측정·보고만 한다.
import { useEffect, useRef } from 'react'
import { resizePopup } from '../api'

export function usePopupHeight<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const lastSent = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const report = (): void => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      if (height > 0 && height !== lastSent.current) {
        lastSent.current = height
        resizePopup(height)
      }
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}
