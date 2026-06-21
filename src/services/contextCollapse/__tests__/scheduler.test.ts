import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'

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

const store = await import('../store.js')
const registry = await import('../registry.js')
const scheduler = await import('../scheduler.js')

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

function stagedSpan(startUuid: string, endUuid: string): store.StagedSpan {
  return {
    startUuid,
    endUuid,
    summary: 'summary',
    risk: 1,
    stagedAt: 123,
  }
}

function commitEntry(
  collapseId: string,
  firstArchivedUuid: string,
  lastArchivedUuid: string,
  depth = 0,
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
    depth,
    parentId: null,
  }
}

beforeEach(() => {
  store.reset()
  registry.clearSummaryRegistry()
  recordContextCollapseCommitMock.mockClear()
  recordContextCollapseSnapshotMock.mockClear()
  tokenCountWithEstimationMock.mockClear()
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

describe('persistSnapshot', () => {
  test('records staged spans, armed state, and last spawn tokens', () => {
    const messages = [makeMessage('1'), makeMessage('2')]
    const span = stagedSpan(messages[0]!.uuid, messages[1]!.uuid)
    store.pushStaged(span)
    store.setArmed(true)
    store.setLastSpawnTokens(123_456)

    scheduler.__testing.persistSnapshot()

    expect(recordContextCollapseSnapshotMock).toHaveBeenCalledTimes(1)
    expect(recordContextCollapseSnapshotMock).toHaveBeenCalledWith({
      staged: [span],
      armed: true,
      lastSpawnTokens: 123_456,
    })
  })
})

describe('detectNesting', () => {
  test('returns depth zero when there is no committed log', () => {
    const messages = ['1', '2', '3'].map(makeMessage)

    expect(scheduler.__testing.detectNesting(messages, 0, 2)).toEqual({
      depth: 0,
      parentId: null,
    })
  })

  test('returns one level deeper when the candidate is inside a committed span', () => {
    const messages = ['1', '2', '3', '4', '5'].map(makeMessage)
    store.pushCommitted(
      commitEntry('parent', messages[1]!.uuid, messages[4]!.uuid, 2),
    )

    expect(scheduler.__testing.detectNesting(messages, 2, 3)).toEqual({
      depth: 3,
      parentId: 'parent',
    })
  })

  test('returns depth zero when the candidate does not overlap a committed span', () => {
    const messages = ['1', '2', '3', '4', '5'].map(makeMessage)
    store.pushCommitted(
      commitEntry('parent', messages[0]!.uuid, messages[1]!.uuid),
    )

    expect(scheduler.__testing.detectNesting(messages, 3, 4)).toEqual({
      depth: 0,
      parentId: null,
    })
  })
})

describe('overlapsExistingStaged', () => {
  test('returns false when candidate UUIDs cannot be resolved', () => {
    const messages = ['1', '2', '3'].map(makeMessage)
    store.pushStaged(stagedSpan(messages[0]!.uuid, messages[1]!.uuid))

    expect(
      scheduler.__testing.overlapsExistingStaged(
        {
          startUuid: 'missing-start',
          endUuid: 'missing-end',
          summary: 'summary',
          risk: 1,
        },
        messages,
      ),
    ).toBe(false)
  })

  test('returns true when the candidate fully overlaps a staged span', () => {
    const messages = ['1', '2', '3', '4'].map(makeMessage)
    store.pushStaged(stagedSpan(messages[1]!.uuid, messages[2]!.uuid))

    expect(
      scheduler.__testing.overlapsExistingStaged(
        {
          startUuid: messages[1]!.uuid,
          endUuid: messages[2]!.uuid,
          summary: 'summary',
          risk: 1,
        },
        messages,
      ),
    ).toBe(true)
  })

  test('returns true when the candidate partially overlaps a staged span', () => {
    const messages = ['1', '2', '3', '4', '5'].map(makeMessage)
    store.pushStaged(stagedSpan(messages[1]!.uuid, messages[3]!.uuid))

    expect(
      scheduler.__testing.overlapsExistingStaged(
        {
          startUuid: messages[3]!.uuid,
          endUuid: messages[4]!.uuid,
          summary: 'summary',
          risk: 1,
        },
        messages,
      ),
    ).toBe(true)
  })

  test('returns false when the candidate does not overlap a staged span', () => {
    const messages = ['1', '2', '3', '4', '5'].map(makeMessage)
    store.pushStaged(stagedSpan(messages[0]!.uuid, messages[1]!.uuid))

    expect(
      scheduler.__testing.overlapsExistingStaged(
        {
          startUuid: messages[3]!.uuid,
          endUuid: messages[4]!.uuid,
          summary: 'summary',
          risk: 1,
        },
        messages,
      ),
    ).toBe(false)
  })
})

describe('selectStagingCandidate', () => {
  test('returns undefined for an empty view', () => {
    expect(scheduler.__testing.selectStagingCandidate([])).toBeUndefined()
  })

  test('returns undefined when every message is in the protected tail', () => {
    const messages = [
      makeMessage('1', 10_000),
      makeMessage('2', 10_000),
      makeMessage('3', 10_000),
    ]

    expect(scheduler.__testing.selectStagingCandidate(messages)).toBeUndefined()
  })

  test('returns a candidate before the protected tail with summary and risk', () => {
    const messages = [
      makeMessage('1', 1_500),
      makeMessage('2', 1_000),
      makeMessage('3', 20_000),
      makeMessage('4', 5_000),
    ]

    expect(scheduler.__testing.selectStagingCandidate(messages)).toEqual({
      startUuid: messages[0]!.uuid,
      endUuid: messages[1]!.uuid,
      summary: 'Collapsed 2 messages.',
      risk: 2_500,
    })
  })
})
