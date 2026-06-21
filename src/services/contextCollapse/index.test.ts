import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'
import type { StagedSpan } from './store.js'

const recordContextCollapseCommitMock = mock(async () => {})
const recordContextCollapseSnapshotMock = mock(async () => {})
const tokenCountWithEstimationMock = mock((messages: readonly Message[]) =>
  messages.reduce(
    (total, message) =>
      total +
      (typeof message.tokenEstimate === 'number'
        ? (message.tokenEstimate as number)
        : 1),
    0,
  ),
)

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
  tokenCountWithEstimation: tokenCountWithEstimationMock,
}))

const contextCollapse = await import('./index.js')
const store = await import('./store.js')
const registry = await import('./registry.js')

function makeMessage(label: string, tokenEstimate?: number): Message {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-${label.padStart(12, '0')}` as UUID,
    message: {
      role: 'user',
      content: label,
    },
    timestamp: `2026-01-01T00:00:${label.padStart(2, '0')}.000Z`,
    ...(tokenEstimate === undefined ? {} : { tokenEstimate }),
  }
}

function commitEntry(
  collapseId: string,
  firstArchivedUuid: string,
  lastArchivedUuid: string,
): ContextCollapseCommitEntry {
  return {
    type: 'marble-origami-commit',
    sessionId: '00000000-0000-4000-8000-000000000001' as UUID,
    collapseId,
    summaryUuid: `00000000-0000-4000-8000-${collapseId.padStart(12, '0')}`,
    summaryContent: `<collapsed id="${collapseId}">summary</collapsed>`,
    summary: 'summary',
    firstArchivedUuid,
    lastArchivedUuid,
  }
}

function stagedSpan(startUuid: string, endUuid: string): StagedSpan {
  return {
    startUuid,
    endUuid,
    summary: 'summary',
    risk: 1,
    stagedAt: 123,
  }
}

beforeEach(() => {
  if (contextCollapse.isContextCollapseEnabled()) {
    contextCollapse.resetContextCollapse()
  }
  store.reset()
  registry.clearSummaryRegistry()
  recordContextCollapseCommitMock.mockClear()
  recordContextCollapseSnapshotMock.mockClear()
  tokenCountWithEstimationMock.mockClear()
})

describe('context collapse index API', () => {
  test('getStats reports committed, staged, archived, and health state from the store', () => {
    const messages = [
      makeMessage('1'),
      makeMessage('2'),
      makeMessage('3'),
      makeMessage('4'),
    ]
    const first = store.pushCommitted(
      commitEntry('0000000000000001', messages[0]!.uuid, messages[1]!.uuid),
    )
    first.archived.push(messages[0]!, messages[1]!)
    const second = store.pushCommitted(
      commitEntry('0000000000000002', messages[2]!.uuid, messages[2]!.uuid),
    )
    second.archived.push(messages[2]!)
    store.pushStaged(stagedSpan(messages[2]!.uuid, messages[3]!.uuid))
    store.recordSpawn()
    store.recordSpawn()
    store.recordEmptySpawn()
    store.recordError('overflow')
    store.markEmptySpawnWarningEmitted()

    expect(contextCollapse.getStats()).toEqual({
      totalMessages: 0,
      collapsedMessages: 3,
      emptySpawnWarningEmitted: true,
      health: {
        totalSpawns: 2,
        totalErrors: 1,
        lastError: 'overflow',
        emptySpawnWarningEmitted: true,
        totalEmptySpawns: 1,
      },
      collapsedSpans: 2,
      stagedSpans: 1,
    })
  })

  test('resetContextCollapse disables collapse and clears store plus summary registry', () => {
    const messages = [makeMessage('1'), makeMessage('2')]
    store.pushCommitted(
      commitEntry('0000000000000001', messages[0]!.uuid, messages[1]!.uuid),
    )
    store.pushStaged(stagedSpan(messages[0]!.uuid, messages[1]!.uuid))
    store.recordSpawn()
    registry.registerSummary('summary-uuid', '0000000000000042')
    contextCollapse.initContextCollapse()

    contextCollapse.resetContextCollapse()

    expect(contextCollapse.isContextCollapseEnabled()).toBe(false)
    expect(store.getCommittedLog()).toEqual([])
    expect(store.getStaged()).toEqual([])
    expect(store.getHealth()).toEqual({
      totalSpawns: 0,
      totalErrors: 0,
      emptySpawnWarningEmitted: false,
      totalEmptySpawns: 0,
    })
    expect(registry.getCollapseIdForSummary('summary-uuid')).toBeUndefined()
    expect(registry.peekCollapseIdCounter()).toBe(0)
  })

  test('applyCollapsesIfNeeded forwards to scheduler', async () => {
    const messages = [makeMessage('1', 160_000), makeMessage('2', 25_000)]

    const result = await contextCollapse.applyCollapsesIfNeeded(
      messages,
      {},
      'main',
    )

    expect(result.committed).toBe(true)
    expect(store.getCommittedLog()).toHaveLength(1)
  })

  test('isWithheldPromptTooLong forwards to scheduler', () => {
    expect(
      contextCollapse.isWithheldPromptTooLong(
        makeMessage('1'),
        () => true,
        'main',
      ),
    ).toBe(true)
  })

  test('recoverFromOverflow forwards to scheduler', () => {
    const messages = [
      makeMessage('1', 1_000),
      makeMessage('2', 1_000),
      makeMessage('3', 1_000),
    ]
    store.pushStaged(stagedSpan(messages[0]!.uuid, messages[1]!.uuid))

    const result = contextCollapse.recoverFromOverflow(messages, 'main')

    expect(result.committed).toBe(1)
    expect(result.messages).toHaveLength(2)
    expect(store.getStaged()).toEqual([])
  })
})
