import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { getEffectiveContextWindowSize } from 'src/services/compact/autoCompact.js'
import type {
  CollapseStrategy,
  ContextCollapseCommitEntry,
} from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'
import {
  recordContextCollapseCommit,
  recordContextCollapseSnapshot,
} from 'src/utils/sessionStorage.js'
import { tokenCountWithEstimation } from 'src/utils/tokens.js'
import {
  commitToSpan,
  createSummaryMessage,
  projectView,
} from './operations.js'
import {
  getCollapseIdForSummary,
  nextCollapseId,
  registerSummary,
} from './registry.js'
import {
  drainStaged,
  getArmed,
  getCommittedLog,
  getHealth,
  getLastSpawnTokens,
  getStaged,
  markEmptySpawnWarningEmitted,
  pushCommitted,
  pushStaged,
  recordEmptySpawn,
  recordError,
  recordSpawn,
  setArmed,
  setLastSpawnTokens,
  type StagedSpan,
} from './store.js'

const COMMIT_START_FRAC = 0.9
const BLOCKING_FRAC = 0.95
const SPAWN_INTERVAL_TOKENS = 12_000
const PROTECTED_TAIL_TOKENS = 25_000
const MIN_SPAN_TOKENS = 2_000
const EMPTY_SPAWN_WARN_AT = 3
const MARBLE_QUERY_SOURCE = 'marble_origami'

type ApplyResult = { messages: Message[]; committed: boolean }
type RecoverResult = { messages: Message[]; committed: number }
type Candidate = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
}

type CollapseContext = {
  options?: {
    mainLoopModel?: string
  }
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _ctx: CollapseContext,
  _querySource?: string,
): Promise<ApplyResult> {
  return { messages, committed: false }
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource?: string,
): RecoverResult {
  return { messages, committed: 0 }
}

export function isWithheldPromptTooLong(
  _message: Message,
  _isPromptTooLong: (msg: Message) => boolean,
  _querySource?: string,
): boolean {
  return false
}

function commitSpans(
  _messages: Message[],
  _spans: StagedSpan[],
  _strategy: CollapseStrategy,
): number {
  return 0
}

function selectStagingCandidate(_view: Message[]): Candidate | undefined {
  return undefined
}

function detectNesting(
  messages: Message[],
  startIdx: number,
  endIdx: number,
): { depth: number; parentId: string | null } {
  for (const committed of getCommittedLog()) {
    const committedStartIdx = messages.findIndex(
      message => message.uuid === committed.entry.firstArchivedUuid,
    )
    const committedEndIdx = messages.findIndex(
      message => message.uuid === committed.entry.lastArchivedUuid,
    )
    if (
      committedStartIdx !== -1 &&
      committedEndIdx !== -1 &&
      committedStartIdx <= startIdx &&
      endIdx <= committedEndIdx
    ) {
      return {
        depth: (committed.entry.depth ?? 0) + 1,
        parentId: committed.entry.collapseId,
      }
    }
  }

  for (const message of messages.slice(startIdx, endIdx + 1)) {
    const parentId = getCollapseIdForSummary(message.uuid)
    if (parentId === undefined) continue

    const parent = getCommittedLog().find(
      committed => committed.entry.collapseId === parentId,
    )
    return {
      depth: ((parent?.entry.depth ?? 0) as number) + 1,
      parentId,
    }
  }

  return { depth: 0, parentId: null }
}

function overlapsExistingStaged(
  _candidate: Candidate,
  _messages: Message[],
): boolean {
  return false
}

async function spawnCtxAgent(
  _view: Message[],
  _ctx: CollapseContext,
): Promise<void> {}

function maybeWarnEmptySpawn(): void {
  const health = getHealth()
  if (
    health.totalEmptySpawns >= EMPTY_SPAWN_WARN_AT &&
    !health.emptySpawnWarningEmitted &&
    getStaged().length === 0
  ) {
    markEmptySpawnWarningEmitted()
    console.warn('Context collapse spawned empty summaries repeatedly.')
  }
}

function persistSnapshot(): void {
  void recordContextCollapseSnapshot({
    staged: getStaged().map(span => ({ ...span })),
    armed: getArmed(),
    lastSpawnTokens: getLastSpawnTokens(),
  })
}

export const __testing = {
  commitSpans,
  detectNesting,
  maybeWarnEmptySpawn,
  overlapsExistingStaged,
  persistSnapshot,
  selectStagingCandidate,
  spawnCtxAgent,
}
