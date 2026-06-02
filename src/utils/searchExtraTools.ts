/**
 * Stub — searchExtraTools module.
 * CC_Pure defers tool search to the main tool registry.
 * This stub provides the minimum type surface for typecheck passage.
 */

/** Check if SearchExtraTools feature is enabled (optimistic). */
export function isSearchExtraToolsEnabledOptimistic(): boolean {
  return false
}

/** Check if SearchExtraTools tool is available in the given tool list. */
export function isSearchExtraToolsToolAvailable(_tools: unknown): boolean {
  return false
}

/** Extract discovered tool names from conversation messages. */
export function extractDiscoveredToolNames(
  _messages: unknown[],
): Set<string> {
  return new Set()
}

/** Search for deferred tools by query string. */
export async function searchExtraTools(
  _query: string,
): Promise<Array<{ name: string; description: string; schema: unknown }>> {
  return []
}

/** Load a specific deferred tool by name. */
export async function loadDeferredTool(
  _toolName: string,
): Promise<{ name: string; call: (...args: unknown[]) => Promise<unknown> } | null> {
  return null
}
