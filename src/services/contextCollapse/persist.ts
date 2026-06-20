import type { CollapseEntry } from './operations.js'
import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from 'src/types/logs.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

let restoredCommits: ContextCollapseCommitEntry[] = []
let restoredSnapshot: ContextCollapseSnapshotEntry | undefined

export function getRestoredCommits(): ContextCollapseCommitEntry[] {
  return restoredCommits
}

export function getRestoredSnapshot():
  | ContextCollapseSnapshotEntry
  | undefined {
  return restoredSnapshot
}

/**
 * Validates that an object has the required UUID-based commit shape written
 * by the transcript layer.
 */
function isValidCommitEntry(
  entry: unknown,
): entry is ContextCollapseCommitEntry {
  if (!isRecord(entry)) return false

  return (
    entry.type === 'marble-origami-commit' &&
    typeof entry.collapseId === 'string' &&
    typeof entry.summaryUuid === 'string' &&
    typeof entry.summaryContent === 'string' &&
    typeof entry.summary === 'string' &&
    typeof entry.firstArchivedUuid === 'string' &&
    typeof entry.lastArchivedUuid === 'string'
  )
}

function isValidSnapshotEntry(
  entry: unknown,
): entry is ContextCollapseSnapshotEntry {
  return isRecord(entry) && entry.type === 'marble-origami-snapshot'
}

/**
 * Validates the legacy index-based CollapseEntry shape. Kept as a fallback so
 * older in-memory callers/tests are not rejected while the persisted transcript
 * format uses ContextCollapseCommitEntry.
 */
function isValidCollapseEntry(entry: unknown): entry is CollapseEntry {
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
 * Validates that an object has a supported persisted collapse entry shape.
 */
export function isValidEntry(
  entry: unknown,
): entry is ContextCollapseCommitEntry | CollapseEntry {
  return isValidCommitEntry(entry) || isValidCollapseEntry(entry)
}

/**
 * Restores collapse entries and snapshot from persisted session data.
 * Called by ResumeConversation.tsx and sessionRestore.ts when
 * resuming a session that had active context collapses.
 *
 * Validates and deduplicates entries, then replays UUID-based commits into
 * the in-memory collapse store so projectView() can reconstruct the collapsed
 * view on the next turn.
 *
 * @param rawEntries  Collapse commit entries from session transcript
 * @param snapshot  Collapse snapshot (serialized state at save time)
 * @returns  Validated, deduplicated entries
 */
export function restoreFromEntries(
  rawEntries: unknown[],
  snapshot: unknown,
): Array<ContextCollapseCommitEntry | CollapseEntry> {
  restoredCommits = []
  restoredSnapshot = isValidSnapshotEntry(snapshot) ? snapshot : undefined

  const seenIds = new Set<string>()
  const seenCollapseIds = new Set<string>()
  const entries: Array<ContextCollapseCommitEntry | CollapseEntry> = []

  for (const item of rawEntries) {
    if (!isValidEntry(item)) continue

    if (isValidCommitEntry(item)) {
      // Deduplicate by collapseId — keep first occurrence
      if (seenCollapseIds.has(item.collapseId)) continue
      seenCollapseIds.add(item.collapseId)
      entries.push(item)
      restoredCommits.push(item)
      continue
    }

    // Legacy index-based fallback: deduplicate by id — keep first occurrence
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)
    entries.push(item)
  }

  return entries
}
