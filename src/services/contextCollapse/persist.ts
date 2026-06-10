import type { CollapseEntry } from './operations.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validates that an object has the required persisted CollapseEntry shape.
 */
export function isValidEntry(entry: unknown): entry is CollapseEntry {
  if (!isRecord(entry)) return false

  const span = entry.span
  const replacement = entry.replacement

  return (
    typeof entry.id === 'string' &&
    entry.id.trim() !== '' &&
    isRecord(span) &&
    typeof span.startIdx === 'number' &&
    typeof span.endIdx === 'number' &&
    isRecord(replacement) &&
    typeof replacement.text === 'string' &&
    typeof replacement.tokens === 'number' &&
    typeof entry.createdAt === 'string' &&
    entry.createdAt.trim() !== '' &&
    isRecord(entry.meta)
  )
}

/**
 * Restores collapse entries and snapshot from persisted session data.
 * Called by ResumeConversation.tsx and sessionRestore.ts when
 * resuming a session that had active context collapses.
 *
 * Validates, deduplicates by id, sorts by createdAt, and replays
 * entries into the in-memory collapse store so projectView() can
 * reconstruct the collapsed view on the next turn.
 *
 * @param rawEntries  Collapse commit entries from session transcript
 * @param snapshot  Collapse snapshot (serialized state at save time)
 * @returns  Validated, deduplicated, sorted CollapseEntry array
 */
export function restoreFromEntries(
  rawEntries: unknown[],
  snapshot: unknown,
): CollapseEntry[] {
  const seenIds = new Set<string>()
  const entries: CollapseEntry[] = []

  // Combine raw entries and snapshot entries (if snapshot is an array)
  const allRaw = [...rawEntries]
  if (Array.isArray(snapshot)) {
    allRaw.push(...(snapshot as unknown[]))
  }

  for (const item of allRaw) {
    if (!isValidEntry(item)) continue
    // Deduplicate by id — keep first occurrence
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)
    entries.push(item)
  }

  // Sort by createdAt ascending (oldest collapse first)
  entries.sort((a, b) => {
    const aTime =
      typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0
    const bTime =
      typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0
    return aTime - bTime
  })

  return entries
}
