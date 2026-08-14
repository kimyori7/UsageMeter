import { describe, expect, it } from 'vitest'
import { modelBadges, shortModelName } from './modelLabel'

describe('shortModelName', () => {
  it('Claude 모델명은 계열 + 점 버전으로 줄인다', () => {
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(shortModelName('claude-fable-5')).toBe('Fable 5')
    expect(shortModelName('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  })

  it('규칙에 안 맞는 이름은 그대로 둔다', () => {
    expect(shortModelName('gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(shortModelName('gpt-5-mini')).toBe('gpt-5-mini')
    expect(shortModelName('<synthetic>')).toBe('<synthetic>')
  })
})

describe('modelBadges', () => {
  it('저장 문자열을 쉼표로 나누고 축약한다', () => {
    expect(modelBadges('claude-fable-5, claude-haiku-4-5-20251001')).toEqual(['Fable 5', 'Haiku 4.5'])
  })

  it('빈 문자열·공백만이면 빈 배열', () => {
    expect(modelBadges('')).toEqual([])
    expect(modelBadges('  ,  ')).toEqual([])
  })
})
