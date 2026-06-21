import { randomUUID, type UUID } from 'crypto'
import type { CollapseStrategy } from 'src/types/logs.js'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'
import { getRestoredCommits } from './persist.js'

export type { CollapseStrategy }

/**
 * Records a single context collapse operation — a span of messages
 * compressed into a summary to fit within context limits.
 */
export type CollapseEntry = {
  /** Unique identifier for this collapse */
  id: string
  /**
   * UUID of the summary placeholder message. Optional — explicit CollapseEntry[]
   * callers don't provide it; createSummaryMessage falls back to randomUUID().
   */
  summaryUuid?: string
  /**
   * Verbatim placeholder body: <collapsed id="...">text</collapsed>.
   * Optional — explicit callers don't provide it; falls back to stub template.
   */
  summaryContent?: string
  /** Which messages were collapsed */
  span: {
    /** First message index in the original sequence (inclusive) */
    startIdx: number
    /** Last message index in the original sequence (inclusive) */
    endIdx: number
    /** Message IDs for tracking across reshuffles */
    messageIds: string[]
  }
  /** The summary that replaces the collapsed span */
  replacement: {
    /** Summary content */
    text: string
    /** Token count of the summary */
    tokens: number
  }
  /** When this collapse was performed (ISO-8601) */
  createdAt: string
  /** Nesting depth — 0 for top-level, 1+ for recursive collapses */
  depth: number
  /** Parent collapse ID if this is nested within another collapse */
  parentId: string | null
  /** Debug and analysis metadata */
  meta: {
    /** Original message count in the span */
    messageCount: number
    /** Estimated token count before collapse */
    tokensIn: number
    /** Estimated token count after collapse */
    tokensOut: number
    /** Collapse strategy used */
    strategy: CollapseStrategy
  }
}

/**
 * Creates a summary message that represents a collapsed span.
 * Uses a factory pattern with sensible defaults for synthetic messages
 * so callers don't need `as unknown as Message` type bypasses.
 */
export function createSummaryMessage(entry: CollapseEntry): Message {
  return {
    type: 'user',
    uuid: (entry.summaryUuid ?? randomUUID()) as UUID,
    message: {
      role: 'user',
      content:
        entry.summaryContent ??
        `[Collapsed ${entry.meta.messageCount} messages]\n\n${entry.replacement.text}`,
    },
    timestamp: entry.createdAt,
    isSidechain: true,
    isEphemeral: true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProjectableEntry(
  entry: unknown,
  messageCount: number,
): entry is CollapseEntry {
  if (!isRecord(entry)) return false

  const span = entry.span
  const replacement = entry.replacement

  if (!isRecord(span) || !isRecord(replacement) || !isRecord(entry.meta)) {
    return false
  }

  return (
    typeof span.startIdx === 'number' &&
    typeof span.endIdx === 'number' &&
    span.startIdx >= 0 &&
    span.endIdx < messageCount &&
    span.startIdx <= span.endIdx &&
    typeof replacement.text === 'string' &&
    typeof replacement.tokens === 'number' &&
    typeof entry.createdAt === 'string' &&
    entry.createdAt.trim() !== ''
  )
}

function commitToSpan(
  messages: Message[],
  commit: ContextCollapseCommitEntry,
): CollapseEntry | undefined {
  const startIdx = messages.findIndex(
    message => message.uuid === commit.firstArchivedUuid,
  )
  const endIdx = messages.findIndex(
    message => message.uuid === commit.lastArchivedUuid,
  )

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return undefined
  }

  const endTimestamp = messages[endIdx]?.timestamp
  const startTimestamp = messages[startIdx]?.timestamp

  return {
    id: commit.collapseId,
    summaryUuid: commit.summaryUuid,
    summaryContent: commit.summaryContent,
    span: {
      startIdx,
      endIdx,
      messageIds: messages
        .slice(startIdx, endIdx + 1)
        .map(message => message.uuid),
    },
    replacement: {
      text: commit.summary,
      tokens: commit.tokensOut ?? 0,
    },
    createdAt:
      typeof endTimestamp === 'string'
        ? endTimestamp
        : typeof startTimestamp === 'string'
          ? startTimestamp
          : new Date(0).toISOString(),
    depth: commit.depth ?? 0,
    parentId: commit.parentId ?? null,
    meta: {
      messageCount: endIdx - startIdx + 1,
      tokensIn: commit.tokensIn ?? 0,
      tokensOut: commit.tokensOut ?? 0,
      strategy: commit.strategy ?? 'llm-summary',
    },
  }
}

/**
 * Projects messages through a collapse commit log, returning a filtered
 * view where collapsed spans are replaced by summary messages.
 *
 * The collapse log is replayed on every entry so collapses persist across
 * turns — the full history lives in the REPL array, but the projected view
 * is what gets sent to the model.
 *
 * Invalid or out-of-range entries are ignored so corrupted persisted data
 * cannot throw while rebuilding the view. Overlapping valid spans are allowed;
 * duplicate skipped indices are naturally deduped by the skip set.
 *
 * @param messages  Full message history
 * @param collapseLog  Chronological list of collapse entries (optional — reads
 *   from the internal collapse store when omitted)
 * @returns  Projected view with collapsed spans replaced by summaries
 */
export function projectView(
  messages: Message[],
  collapseLog?: CollapseEntry[],
): Message[] {
  const effectiveCollapseLog =
    collapseLog ??
    getRestoredCommits()
      .map(commit => commitToSpan(messages, commit))
      .filter(entry => entry !== undefined)

  if (effectiveCollapseLog.length === 0) return messages

  // Sort by startIdx ascending so later collapses don't break earlier indices
  const sorted = effectiveCollapseLog
    .filter(entry => isProjectableEntry(entry, messages.length))
    .sort((a, b) => a.span.startIdx - b.span.startIdx)

  // Build a set of indices to skip
  const skipIndices = new Set<number>()
  for (const entry of sorted) {
    for (let i = entry.span.startIdx; i <= entry.span.endIdx; i++) {
      skipIndices.add(i)
    }
  }

  // Build projected view: keep non-collapsed messages, insert summary at collapse point
  const result: Message[] = []
  const insertions = new Map<number, Message>() // idx → summary message

  for (const entry of sorted) {
    insertions.set(entry.span.startIdx, createSummaryMessage(entry))
  }

  for (let i = 0; i < messages.length; i++) {
    if (skipIndices.has(i)) {
      // Insert summary on first skip of each span
      if (insertions.has(i)) {
        result.push(insertions.get(i)!)
      }
      continue
    }
    result.push(messages[i]!)
  }

  return result
}
