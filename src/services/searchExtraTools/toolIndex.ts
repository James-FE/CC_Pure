/**
 * Stub — searchExtraTools/toolIndex module.
 * CC_Pure defers tool indexing to the main tool registry.
 * This stub provides the minimum type surface for typecheck passage.
 */

export interface SearchExtraToolResult {
  name: string
  description: string
  score: number
  inputSchema?: unknown
}

// Legacy alias for compatibility
export type SearchExtraToolsResult = SearchExtraToolResult

export interface ToolIndexEntry {
  name: string
  description: string
  schema: unknown
}

/** Get the current tool index. */
export function getToolIndex(_deferredTools?: unknown[]): SearchExtraToolResult[] {
  return []
}

/** Search tools in the index by query string. */
export function searchTools(
  _query: string,
  _index: SearchExtraToolResult[],
  _maxResults?: number,
): SearchExtraToolResult[] {
  return []
}

/** Build a search index of all available deferred tools. */
export function buildToolIndex(): ToolIndexEntry[] {
  return []
}
