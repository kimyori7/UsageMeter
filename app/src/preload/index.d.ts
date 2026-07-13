import type { UsagemeterApi } from './index'

declare global {
  interface Window {
    usagemeter: UsagemeterApi
  }
}
