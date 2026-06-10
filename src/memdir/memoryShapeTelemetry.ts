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
 *   in the callers. Instead of sending telemetry to Anthropic, we log
 *   memory shape data locally to ~/.claude/memory-stats.jsonl so the user
 *   can inspect recall precision, pool size distribution, and per-tool
 *   write patterns without any external analytics dependency.
 *
 * Restoration notes:
 *   The data is rich (recall pool size, selection set, per-tool write stats,
 *   scope distribution). If we ever want to build our own memory analytics,
 *   replace the no-ops with structured logging to ~/.claude/memory-stats.jsonl.
 *   The MemoryHeader and MemoryScope types are real and available at the
 *   call sites — no additional data plumbing needed.
 *
 *   To inspect: `cat ~/.claude/memory-stats.jsonl | jq .` or
 *   `tail -f ~/.claude/memory-stats.jsonl` during a session.
 */

import fs from 'node:fs'
import os from 'node:os'
import type { MemoryHeader } from './memoryScan.js'
import type { MemoryScope } from '../utils/memoryFileDetection.js'

const LOG_PATH = `${os.homedir()}/.claude/memory-stats.jsonl`

function typeCounts(memories: MemoryHeader[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of memories) {
    const type = m.type ?? 'undefined'
    counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

export const logMemoryRecallShape: (
  memories: MemoryHeader[],
  selected: MemoryHeader[],
) => void = (memories, selected) => {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: 'memory_recall_shape',
      poolSize: memories.length,
      selectedCount: selected.length,
      poolTypeCounts: typeCounts(memories),
      selectedTypeCounts: typeCounts(selected),
    })
    fs.appendFileSync(LOG_PATH, line + '\n')
  } catch {
    // Silently ignore — logging must never throw
  }
}

export const logMemoryWriteShape: (
  toolName: string,
  toolInput: Record<string, unknown>,
  filePath: string,
  scope: MemoryScope,
) => void = (toolName, _toolInput, filePath, scope) => {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: 'memory_write_shape',
      toolName,
      scope,
      filePath,
    })
    fs.appendFileSync(LOG_PATH, line + '\n')
  } catch {
    // Silently ignore — logging must never throw
  }
}
