// format.ts의 순수 포맷터 3종에 대한 RED 테스트 — resetsAt/now는 항상 epoch 초(RateWindow.resetsAt과
// 동일 단위)로 다룬다. fmtReset은 now를 명시 인자로 받으므로 fake timer 없이 로컬 Date 생성자로
// 결정적 시각을 만든다 — 이 머신(Asia/Seoul)뿐 아니라 어떤 타임존에서 실행해도 구현과 테스트가
// 동일한 로컬 해석을 쓰므로 안전하다.
import { describe, expect, it } from 'vitest'
import { fmtMoney, fmtReset, fmtTokens } from './format'

function localSec(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  return Math.floor(new Date(y, m - 1, d, h, mi, s).getTime() / 1000)
}

describe('fmtReset', () => {
  it('리셋 임박 — 시/분 형식, 목업 값(1h 32m)과 일치', () => {
    const now = localSec(2026, 7, 13, 10, 0, 0)
    const resetsAt = localSec(2026, 7, 13, 11, 32, 0)
    expect(fmtReset(resetsAt, now)).toBe('1h 32m 후 리셋')
  })

  it('분이 한 자리면 0 패딩 — 목업 값(3h 05m)과 일치', () => {
    const now = localSec(2026, 7, 13, 10, 0, 0)
    const resetsAt = localSec(2026, 7, 13, 13, 5, 0)
    expect(fmtReset(resetsAt, now)).toBe('3h 05m 후 리셋')
  })

  it('자정을 건너가도 24시간 미만이면 시/분 형식을 유지한다 (자정 경계)', () => {
    const now = localSec(2026, 7, 13, 23, 0, 0)
    const resetsAt = localSec(2026, 7, 14, 1, 0, 0)
    expect(fmtReset(resetsAt, now)).toBe('2h 00m 후 리셋')
  })

  it('23시간 59분은 아직 날짜 형식으로 넘어가지 않는다 (경계 직전)', () => {
    const now = localSec(2026, 7, 13, 10, 0, 0)
    const resetsAt = localSec(2026, 7, 14, 9, 59, 0)
    expect(fmtReset(resetsAt, now)).toBe('23h 59m 후 리셋')
  })

  it('정확히 24시간이면 M/D(요일) 형식으로 전환한다 (경계)', () => {
    const now = localSec(2026, 7, 13, 10, 0, 0)
    const resetsAt = localSec(2026, 7, 14, 10, 0, 0)
    expect(fmtReset(resetsAt, now)).toBe('7/14(화) 리셋')
  })

  it('며칠 뒤 리셋은 M/D(요일) 형식 — 목업 값(7/17(금))과 일치', () => {
    const now = localSec(2026, 7, 13, 10, 0, 0)
    const resetsAt = localSec(2026, 7, 17, 15, 0, 0)
    expect(fmtReset(resetsAt, now)).toBe('7/17(금) 리셋')
  })

  it('리셋 시각이 이미 지났으면 0으로 클램프한다', () => {
    const now = localSec(2026, 7, 13, 10, 1, 0)
    const resetsAt = localSec(2026, 7, 13, 10, 0, 0)
    expect(fmtReset(resetsAt, now)).toBe('0h 00m 후 리셋')
  })
})

describe('fmtMoney', () => {
  it('1000 미만은 소수 2자리 — 목업 값과 일치', () => {
    expect(fmtMoney(9.8)).toBe('$9.80')
    expect(fmtMoney(12.4)).toBe('$12.40')
  })

  it('1000 이상은 정수 + 천단위 구분, 소수 없음', () => {
    expect(fmtMoney(1234)).toBe('$1,234')
  })

  it('정확히 1000이면 이상(≥1000) 규칙을 적용한다', () => {
    expect(fmtMoney(1000)).toBe('$1,000')
  })
})

describe('fmtTokens', () => {
  it('1000 미만은 그대로 tok 단위만 붙인다', () => {
    expect(fmtTokens(500)).toBe('500 tok')
  })

  it('K 단위로 축약한다', () => {
    expect(fmtTokens(8400)).toBe('8.4K tok')
  })

  it('M 단위로 축약한다 — 목업 값(31.2M/10.9M)과 일치', () => {
    expect(fmtTokens(31_200_000)).toBe('31.2M tok')
    expect(fmtTokens(10_900_000)).toBe('10.9M tok')
  })

  it('B 단위로 축약한다', () => {
    expect(fmtTokens(1_500_000_000)).toBe('1.5B tok')
  })
})
