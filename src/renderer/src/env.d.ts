/// <reference types="vite/client" />

import type { DraftDockApi } from '../../shared/types'

declare global {
  interface Window { draftdock: DraftDockApi }
}

export {}
