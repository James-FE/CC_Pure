import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'

export type CommittedCollapse = {
  /** The persisted commit, verbatim. Source of truth for boundaries + summary. */
  entry: ContextCollapseCommitEntry
  /** Resolved archived span. Empty until projectView first locates the span. */
  archived: Message[]
}

export type StagedSpan = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

export type CollapseHealth = {
  totalSpawns: number
  totalErrors: number
  lastError?: string
  emptySpawnWarningEmitted: boolean
  totalEmptySpawns: number
}

let committedLog: CommittedCollapse[] = []
let staged: StagedSpan[] = []
let armed = false
let lastSpawnTokens = 0
let health = freshHealth()

function freshHealth(): CollapseHealth {
  return {
    totalSpawns: 0,
    totalErrors: 0,
    emptySpawnWarningEmitted: false,
    totalEmptySpawns: 0,
  }
}

export function getCommittedLog(): CommittedCollapse[] {
  return committedLog
}

export function pushCommitted(
  entry: ContextCollapseCommitEntry,
): CommittedCollapse {
  const committed = { entry, archived: [] }
  committedLog.push(committed)
  return committed
}

export function getStaged(): StagedSpan[] {
  return staged
}

export function pushStaged(span: StagedSpan): void {
  staged.push(span)
}

export function drainStaged(): StagedSpan[] {
  return staged.splice(0)
}

export function getArmed(): boolean {
  return armed
}

export function setArmed(nextArmed: boolean): void {
  armed = nextArmed
}

export function getLastSpawnTokens(): number {
  return lastSpawnTokens
}

export function setLastSpawnTokens(tokens: number): void {
  lastSpawnTokens = tokens
}

export function getHealth(): CollapseHealth {
  return health
}

export function recordSpawn(): void {
  health.totalSpawns += 1
}

export function recordEmptySpawn(): void {
  health.totalEmptySpawns += 1
}

export function recordError(message: string): void {
  health.lastError = message
  health.totalErrors += 1
}

export function markEmptySpawnWarningEmitted(): void {
  health.emptySpawnWarningEmitted = true
}

export function reset(): void {
  committedLog = []
  staged = []
  armed = false
  lastSpawnTokens = 0
  health = freshHealth()
}
