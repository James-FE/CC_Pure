import type { Message } from 'src/types/message.js'
import { closeToolPairs, type SnipExecuteArgs } from './snipExecute.js'

/**
 * Estimated characters per token (conservative for mixed code/text).
 */
const CHARS_PER_TOKEN = 4

/**
 * Minimum message count before nudging the model to consider snipping.
 */
const SNIP_NUDGE_THRESHOLD = 30

/**
 * Text shown to the model as a nudge when the conversation is long enough
 * to benefit from snipping.
 */
export const SNIP_NUDGE_TEXT: string =
  'The conversation history is getting long. Consider using the /force-snip command or the snip tool to compress older messages, freeing context window space for continued work.'

/**
 * Check whether a message is an internal snip marker (not user-facing).
 * Snip markers are system messages injected by the snip tool to track
 * which messages have been registered for future removal.
 */
export function isSnipMarkerMessage(message: Message): boolean {
  if (message.type !== 'system') return false
  return (message as Record<string, unknown>).subtype === 'snip_marker'
}

/**
 * Estimate the token count of a single message by serialising its content.
 * This is a rough heuristic (~4 chars per token) used to report
 * tokensFreed; it does not need to be exact.
 */
export function estimateMessageTokens(message: Message): number {
  const content = message.message?.content
  let chars = 0
  if (typeof content === 'string') {
    chars = content.length
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') {
        chars += (block as string).length
      } else if (block && typeof block === 'object') {
        const obj = block as unknown as Record<string, unknown>
        const text = obj.text ?? obj.content
        if (typeof text === 'string') {
          chars += text.length
        } else {
          chars += JSON.stringify(block).length
        }
      }
    }
  } else if (content !== null && content !== undefined) {
    chars = JSON.stringify(content).length
  }
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
}

export function findSnipBoundary(messages: Message[]):
  | {
      index: number
      removedUuids: string[]
      boundaryMessage: Message
    }
  | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (
      msg.type === 'system' &&
      (msg as Record<string, unknown>).subtype === 'snip_boundary'
    ) {
      const meta = (msg as { snipMetadata?: { removedUuids?: unknown } })
        .snipMetadata
      if (Array.isArray(meta?.removedUuids)) {
        return {
          index: i,
          removedUuids: meta.removedUuids,
          boundaryMessage: msg,
        }
      }
    }
  }
  return undefined
}

/**
 * Scan the message array for the last `snip_boundary` system message and,
 * if found, remove all messages whose UUIDs appear in its
 * `snipMetadata.removedUuids`.
 *
 * This is the core memory-saving function. When a snip boundary exists:
 * 1. All messages listed in `removedUuids` are filtered out.
 * 2. The boundary message itself is kept (it records what was removed).
 * 3. Messages not in `removedUuids` (including post-boundary messages)
 *    are preserved.
 *
 * Called from:
 * - `query.ts` — strips snipped messages from the model-facing array
 *   before sending to the API.
 * - `QueryEngine.ts` `snipReplay` — trims `mutableMessages` so the
 *   in-memory store does not grow without bound in long SDK sessions.
 *
 * @param messages  Full message array (may contain a snip_boundary).
 * @param options   `force` — if true, always execute when a boundary is
 *                  present. Without `force`, the function still executes
 *                  if a boundary is found (the "if needed" refers to
 *                  whether a boundary exists, not a token threshold).
 */
export function snipCompactIfNeeded(
  messages: Message[],
  _options?: { force?: boolean },
): {
  messages: Message[]
  executed: boolean
  tokensFreed: number
  boundaryMessage?: Message
} {
  const boundary = findSnipBoundary(messages)

  if (!boundary) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  const { boundaryMessage, index: boundaryIdx, removedUuids } = boundary

  // Empty removedUuids metadata — fallback: keep boundary + everything after
  if (removedUuids.length === 0) {
    const kept = messages.slice(boundaryIdx)
    return {
      messages: kept,
      executed: true,
      tokensFreed: 0,
      boundaryMessage,
    }
  }

  // Filter out messages whose UUIDs are listed in removedUuids, closing over
  // tool_use/tool_result pairs so the model-facing array cannot contain one
  // side without the other.
  const removedSet = new Set(removedUuids)
  const closedRemovedMessages = closeToolPairs(
    messages.filter(msg => removedSet.has(String(msg.uuid))),
    messages,
  )
  const closedRemovedSet = new Set(
    closedRemovedMessages.map(msg => String(msg.uuid)),
  )
  const kept: Message[] = []
  let tokensFreed = 0

  for (const msg of messages) {
    if (closedRemovedSet.has(String(msg.uuid))) {
      tokensFreed += estimateMessageTokens(msg)
      continue
    }
    kept.push(msg)
  }

  return {
    messages: kept,
    executed: true,
    tokensFreed,
    boundaryMessage,
  }
}

/**
 * Returns true when the snip runtime is active.
 * Because this module is only loaded when the HISTORY_SNIP feature flag
 * is enabled, this always returns true.
 */
export function isSnipRuntimeEnabled(): boolean {
  return true
}

/**
 * Determine whether the conversation is long enough to warrant a nudge
 * to the model to consider snipping. Uses a simple message-count
 * threshold rather than an expensive token count.
 */
export function shouldNudgeForSnips(messages: Message[]): boolean {
  return messages.length >= SNIP_NUDGE_THRESHOLD
}

/**
 * Maximum total character length of message content before proactive
 * truncation kicks in. ~150 MB of string data corresponds to roughly
 * 1.5x the default 200k-token context window at 4 chars/token — well
 * beyond what any model can actually use in a single request.
 */
const PROACTIVE_TRUNCATE_CHARS = 150_000_000

/**
 * Minimum number of messages to keep when falling back to tail-only
 * retention (i.e. when no compact_boundary exists in the array).
 */
const PROACTIVE_TRUNCATE_MIN_TAIL = 50

/**
 * Proactively truncate old messages when the in-memory store grows too
 * large. Unlike `snipCompactIfNeeded` (which waits for a snip_boundary
 * from the API), this runs client-side after every push — ensuring
 * unbounded growth cannot happen even when the API never returns a
 * compact_boundary (e.g. third-party compat layers).
 *
 * Strategy:
 * 1. If a `compact_boundary` exists, keep it and everything after it.
 * 2. Otherwise, keep only the last `PROACTIVE_TRUNCATE_MIN_TAIL` messages.
 *
 * Returns the same array reference when no truncation is needed.
 */
export function proactiveTruncate(messages: Message[]): Message[] {
  if (messages.length < PROACTIVE_TRUNCATE_MIN_TAIL) return messages

  let totalChars = 0
  for (const msg of messages) {
    const content = msg.message?.content
    if (typeof content === 'string') {
      totalChars += content.length
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') {
          totalChars += (block as string).length
        } else if (block && typeof block === 'object') {
          const obj = block as unknown as Record<string, unknown>
          const text = obj.text ?? obj.content
          if (typeof text === 'string') {
            totalChars += text.length
          }
        }
      }
    }
  }

  if (totalChars < PROACTIVE_TRUNCATE_CHARS) return messages

  // Find last compact_boundary — the standard anchor point
  let boundaryIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (
      msg.type === 'system' &&
      (msg as Record<string, unknown>).subtype === 'compact_boundary'
    ) {
      boundaryIdx = i
      break
    }
  }

  const keepFrom =
    boundaryIdx >= 0
      ? boundaryIdx
      : Math.max(0, messages.length - PROACTIVE_TRUNCATE_MIN_TAIL)
  if (keepFrom === 0) return messages

  return messages.slice(keepFrom)
}

export async function maybeExecuteSnipFromToolResult(
  toolResultMessage: Message,
  store: Message[],
  signal: AbortSignal,
  haikuOptions: SnipExecuteArgs['haikuOptions'],
): Promise<Message | undefined> {
  const content = toolResultMessage.message?.content
  if (!Array.isArray(content)) return undefined

  for (const block of content) {
    if (!isToolResultBlock(block)) continue

    const toolUse = store.find(message =>
      getContentBlocks(message).some(
        candidate =>
          isSnipToolUseBlock(candidate) && candidate.id === block.tool_use_id,
      ),
    )
    if (!toolUse) continue

    const toolUseBlock = getContentBlocks(toolUse).find(isSnipToolUseBlock)
    if (!toolUseBlock) continue

    const input = normalizeSnipInput(toolUseBlock.input)
    if (!input.messageIds.length) continue

    /* eslint-disable @typescript-eslint/no-require-imports */
    const { executeSnip } =
      require('./snipExecute.js') as typeof import('./snipExecute.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return executeSnip({
      messageIds: input.messageIds,
      reason: input.reason,
      store,
      signal,
      haikuOptions,
    })
  }
  return undefined
}

function getContentBlocks(message: Message): unknown[] {
  const content = message.message?.content
  return Array.isArray(content) ? content : []
}

function isToolResultBlock(
  block: unknown,
): block is { type: 'tool_result'; tool_use_id: string } {
  if (!block || typeof block !== 'object') return false
  const record = block as Record<string, unknown>
  return record.type === 'tool_result' && typeof record.tool_use_id === 'string'
}

function isSnipToolUseBlock(
  block: unknown,
): block is { type: 'tool_use'; id: string; name: string; input: unknown } {
  if (!block || typeof block !== 'object') return false
  const record = block as Record<string, unknown>
  return (
    record.type === 'tool_use' &&
    record.name === 'Snip' &&
    typeof record.id === 'string'
  )
}

function normalizeSnipInput(input: unknown): {
  messageIds: string[]
  reason?: string
} {
  if (!input || typeof input !== 'object') return { messageIds: [] }
  const record = input as Record<string, unknown>
  const messageIds = Array.isArray(record.message_ids)
    ? record.message_ids.filter(
        (messageId): messageId is string => typeof messageId === 'string',
      )
    : []
  const reason = typeof record.reason === 'string' ? record.reason : undefined
  return { messageIds, reason }
}
