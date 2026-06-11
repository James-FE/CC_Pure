interface CollapseStats {
  totalMessages: number
  collapsedMessages: number
  emptySpawnWarningEmitted: boolean
  health: {
    totalSpawns: number
    totalErrors: number
    lastError?: string
    emptySpawnWarningEmitted: boolean
    totalEmptySpawns: number
  }
  collapsedSpans: number
  stagedSpans: number
}

let contextCollapseEnabled = false
const subscribers = new Set<() => void>()

function notifySubscribers(): void {
  for (const callback of subscribers) {
    callback()
  }
}

export function getStats(): CollapseStats {
  return {
    totalMessages: 0,
    collapsedMessages: 0,
    emptySpawnWarningEmitted: false,
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      emptySpawnWarningEmitted: false,
      totalEmptySpawns: 0,
    },
    collapsedSpans: 0,
    stagedSpans: 0,
  }
}

export function isContextCollapseEnabled(): boolean {
  return contextCollapseEnabled
}

export function subscribe(callback: () => void): () => void {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

export function initContextCollapse(): void {
  if (contextCollapseEnabled) return
  contextCollapseEnabled = true
  notifySubscribers()
}

export function resetContextCollapse(): void {
  if (!contextCollapseEnabled) return
  contextCollapseEnabled = false
  notifySubscribers()
}

/** @stub */
export function applyCollapsesIfNeeded(..._args: unknown[]): {
  messages: unknown[]
  committed: boolean
} {
  return { messages: (_args[0] as unknown[]) || [], committed: false }
}

/** @stub */
export function isWithheldPromptTooLong(..._args: unknown[]): boolean {
  return false
}

/** @stub */
export function recoverFromOverflow(..._args: unknown[]): {
  messages: unknown[]
  committed: boolean
} {
  return { messages: (_args[0] as unknown[]) || [], committed: false }
}
