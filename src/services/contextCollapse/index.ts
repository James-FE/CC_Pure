interface CollapseStats {
  totalMessages: number
  collapsedMessages: number
  emptySpawnWarningEmitted: boolean
}

export function getStats(): CollapseStats {
  return {
    totalMessages: 0,
    collapsedMessages: 0,
    emptySpawnWarningEmitted: false,
  }
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export function subscribe(callback: () => void): () => void {
  return () => {}
}
