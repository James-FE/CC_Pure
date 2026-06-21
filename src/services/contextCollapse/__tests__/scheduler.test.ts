import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'

const recordContextCollapseCommitMock = mock(async () => {})
const recordContextCollapseSnapshotMock = mock(async () => {})

mock.module('bun:bundle', () => ({
  feature: () => true,
}))

mock.module('src/bootstrap/state.js', () => ({
  getSessionId: () => '00000000-0000-4000-8000-000000000001',
}))

mock.module('src/services/compact/autoCompact.js', () => ({
  getEffectiveContextWindowSize: () => 200_000,
}))

mock.module('src/utils/sessionStorage.js', () => ({
  recordContextCollapseCommit: recordContextCollapseCommitMock,
  recordContextCollapseSnapshot: recordContextCollapseSnapshotMock,
}))

mock.module('src/utils/tokens.js', () => ({
  tokenCountWithEstimation: (messages: readonly Message[]) => messages.length,
}))

const store = await import('../store.js')
const registry = await import('../registry.js')
const scheduler = await import('../scheduler.js')

function makeMessage(label: string): Message {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-${label.padStart(12, '0')}` as UUID,
    message: {
      role: 'user',
      content: label,
    },
    timestamp: `2026-01-01T00:00:${label.padStart(2, '0')}.000Z`,
  }
}

function stagedSpan(startUuid: string, endUuid: string): store.StagedSpan {
  return {
    startUuid,
    endUuid,
    summary: 'summary',
    risk: 1,
    stagedAt: 123,
  }
}

beforeEach(() => {
  store.reset()
  registry.clearSummaryRegistry()
  recordContextCollapseCommitMock.mockClear()
  recordContextCollapseSnapshotMock.mockClear()
})

describe('maybeWarnEmptySpawn', () => {
  test('does not warn before the empty spawn threshold', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    store.recordEmptySpawn()
    store.recordEmptySpawn()

    scheduler.__testing.maybeWarnEmptySpawn()

    expect(warn).not.toHaveBeenCalled()
    expect(store.getHealth().emptySpawnWarningEmitted).toBe(false)
    warn.mockRestore()
  })

  test('warns once when empty spawns reach the threshold with no staged spans', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    store.recordEmptySpawn()
    store.recordEmptySpawn()
    store.recordEmptySpawn()

    scheduler.__testing.maybeWarnEmptySpawn()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(store.getHealth().emptySpawnWarningEmitted).toBe(true)
    warn.mockRestore()
  })

  test('does not warn again after the empty spawn warning was emitted', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    store.recordEmptySpawn()
    store.recordEmptySpawn()
    store.recordEmptySpawn()
    store.markEmptySpawnWarningEmitted()

    scheduler.__testing.maybeWarnEmptySpawn()

    expect(warn).not.toHaveBeenCalled()
    expect(store.getHealth().emptySpawnWarningEmitted).toBe(true)
    warn.mockRestore()
  })
})
