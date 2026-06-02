/**
 * Stub — searchExtraTools/toolIndex module.
 * CC_Pure defers tool indexing to the main tool registry.
 * This stub provides the minimum type surface.
 */

export interface SearchExtraToolsResult {
  tools: ToolIndexEntry[]
}

export interface ToolIndexEntry {
  name: string
  description: string
  schema: unknown
}

/** Get the current tool index. */
export function getToolIndex(): ToolIndexEntry[] {
  return []
}

/** Search tools in the index by query string. */
export function searchTools(_query: string): SearchExtraToolsResult {
  return { tools: [] }
}

/** Build a search index of all available deferred tools. */
export function buildToolIndex(): ToolIndexEntry[] {
  return []
}
