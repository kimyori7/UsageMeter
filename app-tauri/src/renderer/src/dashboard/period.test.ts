import { describe, it, expect } from 'vitest'
import { currentMonthPrefix, lastNDaysRange, periodFromMs, periodRange } from './period'

describe('lastNDaysRange', () => {
  it('n일(오늘 포함) 범위를 YYYY-MM-DD 문자열로 반환', () => {
    expect(lastNDaysRange(7, new Date(2026, 6, 13))).toEqual({
      from: '2026-07-07',
      to: '2026-07-13'
    })
  })

  it('n=1이면 from과 to가 오늘로 동일', () => {
    expect(lastNDaysRange(1, new Date(2026, 6, 13))).toEqual({
      from: '2026-07-13',
      to: '2026-07-13'
    })
  })

  it('월 경계를 넘어가도 정확히 계산', () => {
    expect(lastNDaysRange(5, new Date(2026, 6, 2))).toEqual({
      from: '2026-06-28',
      to: '2026-07-02'
    })
  })

  it('한 자리 월/일도 두 자리로 패딩', () => {
    expect(lastNDaysRange(3, new Date(2026, 0, 2))).toEqual({
      from: '2025-12-31',
      to: '2026-01-02'
    })
  })
})

describe('periodRange', () => {
  const today = new Date(2026, 6, 13)

  it("'7d'/'30d'/'90d'는 lastNDaysRange(n)과 동일", () => {
    expect(periodRange('7d', today)).toEqual(lastNDaysRange(7, today))
    expect(periodRange('30d', today)).toEqual(lastNDaysRange(30, today))
    expect(periodRange('90d', today)).toEqual(lastNDaysRange(90, today))
  })

  it("'1d'/'3d'는 lastNDaysRange(n)과 동일 — '1d'는 오늘 하루", () => {
    expect(periodRange('1d', today)).toEqual(lastNDaysRange(1, today))
    expect(periodRange('1d', today)).toEqual({ from: '2026-07-13', to: '2026-07-13' })
    expect(periodRange('3d', today)).toEqual(lastNDaysRange(3, today))
  })

  it("'all'은 경계 없음(빈 객체)", () => {
    expect(periodRange('all', today)).toEqual({})
  })
})

describe('periodFromMs', () => {
  const today = new Date(2026, 6, 13)

  it("'7d'는 lastNDaysRange(7).from 자정(로컬)의 epoch ms", () => {
    expect(periodFromMs('7d', today)).toBe(new Date(2026, 6, 7).getTime())
  })

  it("'all'은 0(경계 없음)", () => {
    expect(periodFromMs('all', today)).toBe(0)
  })

  it("'30d'/'90d'도 lastNDaysRange(n).from 자정의 epoch ms", () => {
    expect(periodFromMs('30d', today)).toBe(new Date(2026, 5, 14).getTime())
    expect(periodFromMs('90d', today)).toBe(new Date(2026, 3, 15).getTime())
  })

  it("'1d'/'3d'도 lastNDaysRange(n).from 자정의 epoch ms", () => {
    expect(periodFromMs('1d', today)).toBe(new Date(2026, 6, 13).getTime())
    expect(periodFromMs('3d', today)).toBe(new Date(2026, 6, 11).getTime())
  })
})

describe('currentMonthPrefix', () => {
  it("'YYYY-MM' 형태, 한 자리 월도 두 자리 패딩", () => {
    expect(currentMonthPrefix(new Date(2026, 6, 13))).toBe('2026-07')
    expect(currentMonthPrefix(new Date(2026, 0, 5))).toBe('2026-01')
  })
})
