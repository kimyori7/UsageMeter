// 타입 전용 스텁 — v1 main/settings.ts의 Settings 계약만 보존 (런타임은 Rust settings.rs, 2단계).
export interface Settings {
  autoStart: boolean
  limitsIntervalSec: number
  usageIntervalMin: number
}
