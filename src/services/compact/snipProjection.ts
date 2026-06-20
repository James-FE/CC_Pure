import type { Message } from 'src/types/message.js'
import { snipCompactIfNeeded } from './snipCompact.js'

/**
 * Returns true if the given message is a snip boundary marker.
 */
export function isSnipBoundaryMessage(message: Message): boolean {
  if (message.type !== 'system') return false
  const meta = (message as Record<string, unknown>).snipMetadata
  return (
    meta !== null &&
    meta !== undefined &&
    Array.isArray((meta as { removedUuids?: unknown }).removedUuids)
  )
}

/**
 * Projects messages through the snip view by removing messages listed in
 * the most recent set-based snip boundary.
 *
 * REPL keeps snipped messages for UI scrollback; this projection ensures
 * the model does not receive content explicitly removed by the snip set.
 *
 * @param messages  Full message history (including snipped prefix)
 * @returns  Messages with removedUuids filtered out, or the original array
 */
export function projectSnippedView(messages: Message[]): Message[] {
  const { messages: kept, executed } = snipCompactIfNeeded(messages)
  return executed ? kept : messages
}
