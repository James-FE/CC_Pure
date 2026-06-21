import type { Message } from 'src/types/message.js'

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
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getCommittedLog, getHealth, getStaged } =
    require('./store.js') as typeof import('./store.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const committed = getCommittedLog()
  const health = getHealth()
  const collapsedMessages = committed.reduce((n, c) => n + c.archived.length, 0)
  return {
    totalMessages: 0,
    collapsedMessages,
    emptySpawnWarningEmitted: health.emptySpawnWarningEmitted,
    health: {
      totalSpawns: health.totalSpawns,
      totalErrors: health.totalErrors,
      lastError: health.lastError,
      emptySpawnWarningEmitted: health.emptySpawnWarningEmitted,
      totalEmptySpawns: health.totalEmptySpawns,
    },
    collapsedSpans: committed.length,
    stagedSpans: getStaged().length,
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
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { reset: resetStore } =
    require('./store.js') as typeof import('./store.js')
  const { clearSummaryRegistry } =
    require('./registry.js') as typeof import('./registry.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  resetStore()
  clearSummaryRegistry()
  notifySubscribers()
}

/** @stub → scheduler.ts */
export async function applyCollapsesIfNeeded(
  messages: Message[],
  ctx: unknown,
  querySource?: string,
): Promise<{ messages: Message[]; committed: boolean }> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const s = require('./scheduler.js') as typeof import('./scheduler.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return s.applyCollapsesIfNeeded(messages, ctx, querySource)
}

/** @stub → scheduler.ts */
export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLong: (msg: Message) => boolean,
  querySource?: string,
): boolean {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const s = require('./scheduler.js') as typeof import('./scheduler.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return s.isWithheldPromptTooLong(message, isPromptTooLong, querySource)
}

/** @stub → scheduler.ts */
export function recoverFromOverflow(
  messages: Message[],
  querySource?: string,
): {
  messages: Message[]
  committed: number
} {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const s = require('./scheduler.js') as typeof import('./scheduler.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return s.recoverFromOverflow(messages, querySource)
}
