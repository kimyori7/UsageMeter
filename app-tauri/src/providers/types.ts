// Shared provider types consumed by later tasks (limits providers, normalizer, poller).
// Do not change names/signatures here without updating every consumer.

/** Which usage provider a piece of data came from. */
export type ProviderId = 'claude' | 'codex'

/** Which rate-limit window a RateWindow entry represents. */
export type WindowKind = 'session_5h' | 'weekly'

export interface RateWindow {
  kind: WindowKind // which window this entry describes
  usedPercent: number // 0-100, percent of the window's quota consumed
  resetsAt: number // epoch sec, when this window resets
}

export interface RateStatus {
  provider: ProviderId // which provider this status belongs to
  windows: RateWindow[] // only the windows that exist for this provider — do not assume a fixed set
  plan?: string // display label, e.g. 'Max 20x' | 'plus'
  fetchedAt: number // epoch ms, when this status was fetched
  stale?: boolean // codex: log data is old / claude: showing cached value after a failed poll
  error?: 'no-credentials' | 'unauthorized' | 'network' | 'no-data' // set when fetch failed
}

export interface DailyRow {
  date: string // YYYY-MM-DD
  provider: ProviderId // which provider this row belongs to
  model: string // model name used
  inputTokens: number // input token count
  outputTokens: number // output token count
  cacheTokens: number // cache read/write token count
  costUsd: number // cost in USD
}

export interface SessionRow {
  sessionId: string // unique session identifier
  provider: ProviderId // which provider this row belongs to
  folder: string // project/working folder associated with the session
  startedAt: string | null // ISO timestamp, session start (null if unknown)
  endedAt: string | null // ISO timestamp, session end (null if unknown)
  totalTokens: number // total tokens used in the session
  costUsd: number // cost in USD
}
