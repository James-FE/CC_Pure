const uuidToId = new Map<string, string>()
const idToUuid = new Map<string, string>()
let collapseIdCounter = 0

export function nextCollapseId(): string {
  collapseIdCounter += 1
  return String(collapseIdCounter).padStart(16, '0')
}

export function registerSummary(summaryUuid: string, collapseId: string): void {
  if (
    uuidToId.get(summaryUuid) === collapseId &&
    idToUuid.get(collapseId) === summaryUuid
  ) {
    return
  }

  const previousCollapseId = uuidToId.get(summaryUuid)
  if (previousCollapseId !== undefined) {
    idToUuid.delete(previousCollapseId)
  }

  const previousSummaryUuid = idToUuid.get(collapseId)
  if (previousSummaryUuid !== undefined) {
    uuidToId.delete(previousSummaryUuid)
  }

  uuidToId.set(summaryUuid, collapseId)
  idToUuid.set(collapseId, summaryUuid)
}

export function getCollapseIdForSummary(
  summaryUuid: string,
): string | undefined {
  return uuidToId.get(summaryUuid)
}

export function getSummaryUuidForCollapse(
  collapseId: string,
): string | undefined {
  return idToUuid.get(collapseId)
}

export function reseedCollapseIdCounter(maxRestoredId: number): void {
  if (Number.isFinite(maxRestoredId) && maxRestoredId > collapseIdCounter) {
    collapseIdCounter = maxRestoredId
  }
}

export function peekCollapseIdCounter(): number {
  return collapseIdCounter
}

export function clearSummaryRegistry(): void {
  uuidToId.clear()
  idToUuid.clear()
  collapseIdCounter = 0
}
