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
  createSummaryMessage,
  type CollapseEntry,
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
const CTX_AGENT_MESSAGE_CHAR_LIMIT = 500

type ApplyResult = { messages: Message[]; committed: boolean }
type RecoverResult = { messages: Message[]; committed: number }
type Candidate = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
}
type CtxAgentVerdict = {
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
  ctx: CollapseContext,
  querySource?: string,
): Promise<ApplyResult> {
  if (querySource === MARBLE_QUERY_SOURCE) {
    return { messages, committed: false }
  }

  let view = projectCommittedView(messages)
  const model = ctx.options?.mainLoopModel ?? ''
  const windowSize = getEffectiveContextWindowSize(model)
  const tokens = tokenCountWithEstimation(view)

  if (tokens < windowSize * COMMIT_START_FRAC) {
    if (getArmed()) {
      setArmed(false)
      persistSnapshot()
    }
    return { messages: view, committed: false }
  }

  const shouldSpawn =
    !getArmed() ||
    tokens >= windowSize * BLOCKING_FRAC ||
    tokens - getLastSpawnTokens() >= SPAWN_INTERVAL_TOKENS

  if (shouldSpawn) {
    try {
      await spawnCtxAgent(view, ctx)
    } catch (error) {
      recordError(error instanceof Error ? error.message : String(error))
    }
    setArmed(true)
    setLastSpawnTokens(tokens)
    maybeWarnEmptySpawn()
    persistSnapshot()
  }

  const committed = commitSpans(messages, drainStaged(), 'llm-summary')
  if (committed > 0) {
    view = projectCommittedView(messages)
    persistSnapshot()
  }

  return { messages: view, committed: committed > 0 }
}

export function recoverFromOverflow(
  messages: Message[],
  querySource?: string,
): RecoverResult {
  if (querySource === MARBLE_QUERY_SOURCE) return { messages, committed: 0 }

  let committed = commitSpans(messages, drainStaged(), 'llm-summary')
  if (committed === 0) {
    const candidate = selectStagingCandidate(projectCommittedView(messages))
    if (candidate) {
      committed = commitSpans(
        messages,
        [{ ...candidate, stagedAt: Date.now() }],
        'truncate',
      )
    }
  }

  if (committed === 0) return { messages, committed: 0 }

  persistSnapshot()
  return { messages: projectCommittedView(messages), committed }
}

export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLong: (msg: Message) => boolean,
  querySource?: string,
): boolean {
  if (querySource === MARBLE_QUERY_SOURCE) return false
  if (!isPromptTooLong(message)) return false
  return true
}

function commitSpans(
  messages: Message[],
  spans: StagedSpan[],
  strategy: CollapseStrategy,
): number {
  recordSpawn()
  let committed = 0

  for (const span of spans) {
    const startIdx = messages.findIndex(
      message => message.uuid === span.startUuid,
    )
    const endIdx = messages.findIndex(message => message.uuid === span.endUuid)
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) continue

    const archived = messages.slice(startIdx, endIdx + 1)
    const collapseId = nextCollapseId()
    const summaryUuid = randomUUID()
    const summaryContent = `<collapsed id="${collapseId}">${span.summary}</collapsed>`
    const { depth, parentId } = detectNesting(messages, startIdx, endIdx)
    const tokensIn = tokenCountWithEstimation(archived)

    const entry: ContextCollapseCommitEntry = {
      type: 'marble-origami-commit',
      sessionId: getSessionId() as ContextCollapseCommitEntry['sessionId'],
      collapseId,
      summaryUuid,
      summaryContent,
      summary: span.summary,
      firstArchivedUuid: span.startUuid,
      lastArchivedUuid: span.endUuid,
      depth,
      parentId,
      tokensIn,
      tokensOut: 0,
      strategy,
    }

    const projected = collapseEntryFromCommit(messages, entry, startIdx, endIdx)
    entry.tokensOut = tokenCountWithEstimation([
      createSummaryMessage(projected),
    ])

    registerSummary(summaryUuid, collapseId)
    pushCommitted(entry)
    void recordContextCollapseCommit(entry)
    committed += 1
  }

  return committed
}

function collapseEntryFromCommit(
  messages: Message[],
  entry: ContextCollapseCommitEntry,
  startIdx: number,
  endIdx: number,
): CollapseEntry {
  const endTimestamp = messages[endIdx]?.timestamp
  const startTimestamp = messages[startIdx]?.timestamp

  return {
    id: entry.collapseId,
    summaryUuid: entry.summaryUuid,
    summaryContent: entry.summaryContent,
    span: {
      startIdx,
      endIdx,
      messageIds: messages
        .slice(startIdx, endIdx + 1)
        .map(message => message.uuid),
    },
    replacement: {
      text: entry.summary,
      tokens: entry.tokensOut ?? 0,
    },
    createdAt:
      typeof endTimestamp === 'string'
        ? endTimestamp
        : typeof startTimestamp === 'string'
          ? startTimestamp
          : new Date(0).toISOString(),
    depth: entry.depth ?? 0,
    parentId: entry.parentId ?? null,
    meta: {
      messageCount: endIdx - startIdx + 1,
      tokensIn: entry.tokensIn ?? 0,
      tokensOut: entry.tokensOut ?? 0,
      strategy: entry.strategy ?? 'llm-summary',
    },
  }
}

function projectCommittedView(messages: Message[]): Message[] {
  const collapseLog = getCommittedLog()
    .map(committed => {
      const startIdx = messages.findIndex(
        message => message.uuid === committed.entry.firstArchivedUuid,
      )
      const endIdx = messages.findIndex(
        message => message.uuid === committed.entry.lastArchivedUuid,
      )
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
        return undefined
      }
      return collapseEntryFromCommit(
        messages,
        committed.entry,
        startIdx,
        endIdx,
      )
    })
    .filter(entry => entry !== undefined)

  return projectView(messages, collapseLog)
}

function selectStagingCandidate(view: Message[]): Candidate | undefined {
  if (view.length === 0) return undefined

  let protectedTokens = 0
  let protectedStartIdx = view.length
  for (let i = view.length - 1; i >= 0; i--) {
    protectedTokens += tokenCountWithEstimation([view[i]!])
    protectedStartIdx = i
    if (protectedTokens >= PROTECTED_TAIL_TOKENS) break
  }

  const candidateMessages = view.slice(0, protectedStartIdx)
  if (candidateMessages.length === 0) return undefined

  const tokens = tokenCountWithEstimation(candidateMessages)
  if (tokens < MIN_SPAN_TOKENS) return undefined

  return {
    startUuid: candidateMessages[0]!.uuid,
    endUuid: candidateMessages[candidateMessages.length - 1]!.uuid,
    summary: `Collapsed ${candidateMessages.length} messages.`,
    risk: tokens,
  }
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
  candidate: Candidate,
  messages: Message[],
): boolean {
  const candidateStartIdx = messages.findIndex(
    message => message.uuid === candidate.startUuid,
  )
  const candidateEndIdx = messages.findIndex(
    message => message.uuid === candidate.endUuid,
  )
  if (candidateStartIdx === -1 || candidateEndIdx === -1) return false
  if (candidateStartIdx > candidateEndIdx) return false

  for (const span of getStaged()) {
    const stagedStartIdx = messages.findIndex(
      message => message.uuid === span.startUuid,
    )
    const stagedEndIdx = messages.findIndex(
      message => message.uuid === span.endUuid,
    )
    if (stagedStartIdx === -1 || stagedEndIdx === -1) continue
    if (stagedStartIdx > stagedEndIdx) continue
    if (
      candidateStartIdx <= stagedEndIdx &&
      stagedStartIdx <= candidateEndIdx
    ) {
      return true
    }
  }

  return false
}

function extractAssistantText(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (content === undefined) return ''
  return JSON.stringify(content)
}

function renderSpanForSummary(span: Message[]): string {
  return span
    .map(message => {
      const role = message.message?.role ?? message.type
      const content = extractAssistantText(message).slice(
        0,
        CTX_AGENT_MESSAGE_CHAR_LIMIT,
      )
      return `[${role}] ${content}`
    })
    .join('\n')
}

function parseVerdict(raw: string): CtxAgentVerdict | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined
  const verdict = parsed as Record<string, unknown>
  if (typeof verdict.summary !== 'string') return undefined
  if (typeof verdict.risk !== 'number' || !Number.isFinite(verdict.risk)) {
    return undefined
  }

  return {
    summary: verdict.summary,
    risk: Math.min(1, Math.max(0, verdict.risk)),
  }
}

async function spawnCtxAgent(
  view: Message[],
  _ctx: CollapseContext,
): Promise<void> {
  const candidate = selectStagingCandidate(view)
  if (candidate && !overlapsExistingStaged(candidate, view)) {
    pushStaged({
      ...candidate,
      stagedAt: Date.now(),
    })
    return
  }

  recordEmptySpawn()
}

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
  renderSpanForSummary,
  extractAssistantText,
  parseVerdict,
  selectStagingCandidate,
  spawnCtxAgent,
}
