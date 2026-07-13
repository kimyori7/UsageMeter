// IPC 채널명 상수 — main(ipc.ts)과 preload(index.ts) 양쪽이 반드시 이 파일을 import해서 쓴다.
// 채널명을 문자열 리터럴로 중복 타이핑하면 한쪽 오타로 조용히 안 붙는 채널이 생길 수 있어
// (렌더러가 invoke해도 handler가 없어 pending, 혹은 반대) 상수 하나로 통일해 컴파일 타임에 묶는다.
export const CHANNELS = {
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
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
