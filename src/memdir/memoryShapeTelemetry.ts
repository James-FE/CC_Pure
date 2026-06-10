/**
 * Memory Shape Telemetry
 *
 * Original (Anthropic Claude Code):
 *   Sends memory recall/write shape data to Anthropic's analytics backend
 *   for GrowthBook experiments and product improvement. Two entry points:
 *
 *   logMemoryRecallShape(memories, selected)
 *     Fired after each memory recall. Captures the full candidate pool
 *     (MemoryHeader[]) and the subset actually selected, so the analytics
 *     pipeline can compute recall precision, pool size distribution, and
 *     per-memory-type hit rates.
 *     Caller: findRelevantMemories.ts (guarded by MEMORY_SHAPE_TELEMETRY)
 *
 *   logMemoryWriteShape(toolName, toolInput, filePath, scope)
 *     Fired when Edit or Write tools modify a memory-tagged file. Captures
 *     which tool wrote what to which scope, enabling per-tool contribution
 *     tracking and scope-level write volume monitoring.
 *     Caller: sessionFileAccessHooks.ts (guarded by MEMORY_SHAPE_TELEMETRY)
 *
 * CC_Pure:
 *   The original implementation was not included in the leaked source.
 *   Function signatures were reconstructed from the dynamic require() calls
 *   in the callers. Implementation is no-op — we do not send telemetry to
 *   Anthropic and the MEMORY_SHAPE_TELEMETRY feature flag is left disabled.
 *
 * Restoration notes:
 *   The data is rich (recall pool size, selection set, per-tool write stats,
 *   scope distribution). If we ever want to build our own memory analytics,
 *   replace the no-ops with structured logging to ~/.claude/memory-stats.jsonl.
 *   The MemoryHeader and MemoryScope types are real and available at the
 *   call sites — no additional data plumbing needed.
 */

import type { MemoryHeader } from './memoryScan.js'
import type { MemoryScope } from '../utils/memoryFileDetection.js'

export const logMemoryRecallShape: (
  memories: MemoryHeader[],
  selected: MemoryHeader[],
) => void = () => {}

export const logMemoryWriteShape: (
  toolName: string,
  toolInput: Record<string, unknown>,
  filePath: string,
  scope: MemoryScope,
) => void = () => {}
