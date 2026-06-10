import type { CollapseEntry } from './operations.js'

/**
 * Restores collapse entries and snapshot from persisted session data.
 * Called by ResumeConversation.tsx and sessionRestore.ts when
 * resuming a session that had active context collapses.
 *
 * @param rawEntries  Collapse commit entries from session transcript
 * @param snapshot  Collapse snapshot (serialized state at save time)
 */
export function restoreFromEntries(
  rawEntries: unknown[],
  snapshot: unknown,
): void {
  // When CONTEXT_COLLAPSE is disabled (stub), this is a no-op.
  // When enabled, this would:
  // 1. Validate and type rawEntries as CollapseEntry[]
  // 2. Replay entries into the in-memory collapse store
  // 3. Restore snapshot state so collapse tracking resumes correctly
  void rawEntries
  void snapshot
}
