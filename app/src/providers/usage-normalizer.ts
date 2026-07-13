// ccusage CLI 원시 JSON → provider-agnostic DailyRow/SessionRow 변환.
// 필드명은 Task 2 픽스처로 확정된 실제 ccusage 출력 기준 (claude=totalCost/modelBreakdowns 배열,
// codex=costUSD/models 객체). 픽스처가 소스 오브 트루스 — 계약 문서와 다르면 픽스처를 따른다.
import type { DailyRow, ProviderId, SessionRow } from './types'

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

interface RawModelBreakdown {
  modelName?: unknown
  cost?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  cacheCreationTokens?: unknown
  cacheReadTokens?: unknown
}

interface RawDailyEntry {
  date?: unknown
  totalCost?: unknown // claude
  costUSD?: unknown // codex
  inputTokens?: unknown
  outputTokens?: unknown
  cacheCreationTokens?: unknown
  cacheReadTokens?: unknown
  modelBreakdowns?: RawModelBreakdown[] // claude: 모델별 cost 포함 — 모델별 행으로 전개
  models?: Record<string, unknown> // codex: 모델별 cost 없음 — 전개하지 않음
}

function claudeDailyRows(day: RawDailyEntry): DailyRow[] {
  const breakdowns = Array.isArray(day.modelBreakdowns) ? day.modelBreakdowns : []
  return breakdowns.map((mb) => ({
    date: str(day.date),
    provider: 'claude',
    model: str(mb.modelName),
    inputTokens: num(mb.inputTokens),
    outputTokens: num(mb.outputTokens),
    cacheTokens: num(mb.cacheCreationTokens) + num(mb.cacheReadTokens),
    costUsd: num(mb.cost)
  }))
}

function codexDailyRow(day: RawDailyEntry): DailyRow {
  // codex의 models 엔트리에는 모델별 cost가 없어(day.costUSD만 존재) 모델 전개를 하지 않고
  // 하루치 합계를 한 행으로 기록한다. model 필드는 등장한 모델명을 합쳐 표시.
  const modelNames = day.models && typeof day.models === 'object' ? Object.keys(day.models) : []
  return {
    date: str(day.date),
    provider: 'codex',
    model: modelNames.join(', '),
    inputTokens: num(day.inputTokens),
    outputTokens: num(day.outputTokens),
    cacheTokens: num(day.cacheCreationTokens) + num(day.cacheReadTokens),
    costUsd: num(day.costUSD)
  }
}

export function normalizeDaily(provider: ProviderId, cliJson: unknown): DailyRow[] {
  const daily = (cliJson as { daily?: RawDailyEntry[] } | null)?.daily
  const days = Array.isArray(daily) ? daily : []
  return provider === 'claude' ? days.flatMap(claudeDailyRows) : days.map(codexDailyRow)
}

interface RawSession {
  sessionId?: unknown
  projectPath?: unknown // claude
  sessionFile?: unknown // codex
  totalCost?: unknown // claude
  costUSD?: unknown // codex
  totalTokens?: unknown
  firstActivity?: unknown // claude
  lastActivity?: unknown // claude + codex
}

function claudeSessionRow(s: RawSession): SessionRow {
  return {
    sessionId: str(s.sessionId),
    provider: 'claude',
    folder: str(s.projectPath),
    startedAt: strOrNull(s.firstActivity),
    endedAt: strOrNull(s.lastActivity),
    totalTokens: num(s.totalTokens),
    costUsd: num(s.totalCost)
  }
}

function codexSessionRow(
  s: RawSession,
  cwdOf?: (sessionFile: string) => string | null
): SessionRow {
  const folder = (cwdOf ? cwdOf(str(s.sessionFile)) : null) ?? '(폴더 미지정)'
  return {
    sessionId: str(s.sessionId),
    provider: 'codex',
    folder,
    startedAt: null, // codex 로그에는 세션 시작 시각이 없음(lastActivity만 존재)
    endedAt: strOrNull(s.lastActivity),
    totalTokens: num(s.totalTokens),
    costUsd: num(s.costUSD)
  }
}

export function normalizeSessions(
  provider: ProviderId,
  cliJson: unknown,
  codexCwdOf?: (sessionFile: string) => string | null
): SessionRow[] {
  const sessions = (cliJson as { sessions?: RawSession[] } | null)?.sessions
  const rows = Array.isArray(sessions) ? sessions : []
  return provider === 'claude'
    ? rows.map(claudeSessionRow)
    : rows.map((s) => codexSessionRow(s, codexCwdOf))
}
