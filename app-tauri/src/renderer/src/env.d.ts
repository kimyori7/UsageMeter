/// <reference types="vite/client" />
import type { UsagemeterApi } from './api'

declare global {
  interface Window {
    // 하네스(shim.js) 모드에서만 존재 — 실전 빌드에서는 undefined.
    usagemeter?: UsagemeterApi
  }
}

export {}
