// 채널명 상수의 유일한 책임: main(ipc.ts)과 preload(index.ts)가 같은 문자열을 쓰게 만드는 것.
// 여기서는 그 계약이 깨지는 두 가지 실패 모드만 잠근다 — (1) 브리프가 명시한 채널명 목록과 값이
// 달라지는 것(오타로 렌더러↔메인이 조용히 안 붙는 상황), (2) 두 채널이 같은 문자열로 겹치는 것.
import { describe, expect, it } from 'vitest'
import { CHANNELS } from './channels'

describe('CHANNELS', () => {
  it('matches the channel-name contract from the task-9 brief', () => {
    expect(CHANNELS).toEqual({
      stateGet: 'state:get',
      statePush: 'state:push',
      actionRefresh: 'action:refresh',
      actionOpenDashboard: 'action:open-dashboard',
      queryDaily: 'query:daily',
      queryFolders: 'query:folders',
      queryFolderSessions: 'query:folder-sessions',
      queryMonthly: 'query:monthly',
      querySnapshots: 'query:snapshots',
      settingsGet: 'settings:get',
      settingsSet: 'settings:set'
    })
  })

  it('has no duplicate channel-name values', () => {
    const values = Object.values(CHANNELS)
    expect(new Set(values).size).toBe(values.length)
  })
})
