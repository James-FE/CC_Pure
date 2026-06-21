import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'
import type { StagedSpan } from '../store.js'

const recordContextCollapseCommitMock = mock(async () => {})
const recordContextCollapseSnapshotMock = mock(async () => {})
const queryHaikuMock = mock(async () =>
  makeAssistantMessage([
    { type: 'text', text: '{"summary":"model","risk":0.2}' },
  ]),
)
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

mock.module('src/services/api/claude.js', () => ({
  queryHaiku: queryHaikuMock,
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

function makeAssistantMessage(content: unknown): Message {
  return {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-000000000999' as UUID,
    message: {
      id: 'msg_000000000999',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku',
      content: content as never,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    timestamp: '2026-01-01T00:00:59.000Z',
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
  queryHaikuMock.mockReset()
  queryHaikuMock.mockImplementation(async () =>
    makeAssistantMessage([
      { type: 'text', text: '{"summary":"model","risk":0.2}' },
    ]),
  )
  tokenCountWithEstimationMock.mockClear()
})

describe('renderSpanForSummary', () => {
  test('formats a normal message as role-prefixed text', () => {
    expect(
      scheduler.__testing.renderSpanForSummary([makeMessage('hello')]),
    ).toBe('[user] hello')
  })

  test('returns an empty string for an empty span', () => {
    expect(scheduler.__testing.renderSpanForSummary([])).toBe('')
  })

  test('serializes assistant tool_use blocks as JSON text', () => {
    const message = makeAssistantMessage([
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: 'src/index.ts' },
      },
    ])

    expect(scheduler.__testing.extractAssistantText(message)).toBe(
      JSON.stringify(message.message.content),
    )
  })

  test('truncates each rendered message to 500 characters', () => {
    const long = 'x'.repeat(501)

    expect(scheduler.__testing.renderSpanForSummary([makeMessage(long)])).toBe(
      `[user] ${'x'.repeat(500)}`,
    )
  })
})

describe('parseVerdict', () => {
  test('parses a valid summary and risk JSON object', () => {
    expect(
      scheduler.__testing.parseVerdict('{"summary":"x","risk":0.3}'),
    ).toEqual({
      summary: 'x',
      risk: 0.3,
    })
  })

  test('returns undefined for invalid JSON', () => {
    expect(scheduler.__testing.parseVerdict('{bad json')).toBeUndefined()
  })

  test('returns undefined when required fields are missing', () => {
    expect(scheduler.__testing.parseVerdict('{"summary":"x"}')).toBeUndefined()
    expect(scheduler.__testing.parseVerdict('{"risk":0.3}')).toBeUndefined()
  })

  test('clamps risk into the supported range', () => {
    expect(
      scheduler.__testing.parseVerdict('{"summary":"x","risk":1.3}'),
    ).toEqual({
      summary: 'x',
      risk: 1,
    })
    expect(
      scheduler.__testing.parseVerdict('{"summary":"x","risk":-0.2}'),
    ).toEqual({
      summary: 'x',
      risk: 0,
    })
  })
})

describe('summarizeCandidate', () => {
  test('returns the parsed verdict from queryHaiku', async () => {
    const messages = [
      makeMessage('1', 1_500),
      makeMessage('2', 1_000),
      makeMessage('3', 20_000),
      makeMessage('4', 5_000),
    ]
    const signal = new AbortController().signal

    await expect(
      scheduler.__testing.summarizeCandidate(
        messages,
        {
          startUuid: messages[0]!.uuid,
          endUuid: messages[1]!.uuid,
          summary: 'Collapsed 2 messages.',
          risk: 2_500,
        },
        signal,
      ),
    ).resolves.toEqual({ summary: 'model', risk: 0.2 })
    expect(queryHaikuMock).toHaveBeenCalledTimes(1)
  })

  test('falls back to the candidate summary when queryHaiku throws', async () => {
    queryHaikuMock.mockImplementation(async () => {
      throw new Error('network down')
    })
    const messages = [makeMessage('1', 1_500), makeMessage('2', 25_000)]
    const candidate = {
      startUuid: messages[0]!.uuid,
      endUuid: messages[0]!.uuid,
      summary: 'Collapsed 1 messages.',
      risk: 1_500,
    }

    await expect(
      scheduler.__testing.summarizeCandidate(
        messages,
        candidate,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ summary: candidate.summary, risk: 0.5 })
  })

  test('falls back to the candidate summary when the verdict is invalid', async () => {
    queryHaikuMock.mockImplementation(async () =>
      makeAssistantMessage([{ type: 'text', text: 'not json' }]),
    )
    const messages = [makeMessage('1', 1_500), makeMessage('2', 25_000)]
    const candidate = {
      startUuid: messages[0]!.uuid,
      endUuid: messages[0]!.uuid,
      summary: 'Collapsed 1 messages.',
      risk: 1_500,
    }

    await expect(
      scheduler.__testing.summarizeCandidate(
        messages,
        candidate,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ summary: candidate.summary, risk: 0.5 })
  })
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

describe('commitSpans', () => {
  test('returns zero for an empty span list', () => {
    const messages = [makeMessage('1')]

    expect(scheduler.__testing.commitSpans(messages, [], 'llm-summary')).toBe(0)
    expect(store.getCommittedLog()).toEqual([])
  })

  test('commits a valid span and registers the summary', () => {
    const messages = [makeMessage('1', 1_000), makeMessage('2', 1_200)]
    const span = stagedSpan(messages[0]!.uuid, messages[1]!.uuid)

    expect(
      scheduler.__testing.commitSpans(messages, [span], 'llm-summary'),
    ).toBe(1)

    const entry = store.getCommittedLog()[0]!.entry
    expect(entry).toMatchObject({
      type: 'marble-origami-commit',
      sessionId: '00000000-0000-4000-8000-000000000001',
      collapseId: '0000000000000001',
      summaryContent: '<collapsed id="0000000000000001">summary</collapsed>',
      summary: 'summary',
      firstArchivedUuid: messages[0]!.uuid,
      lastArchivedUuid: messages[1]!.uuid,
      depth: 0,
      parentId: null,
      tokensIn: 2_200,
      tokensOut: 1,
      strategy: 'llm-summary',
    })
    expect(registry.getCollapseIdForSummary(entry.summaryUuid)).toBe(
      entry.collapseId,
    )
    expect(recordContextCollapseCommitMock).toHaveBeenCalledWith(entry)
  })

  test('skips spans whose boundaries cannot be resolved', () => {
    const messages = [makeMessage('1'), makeMessage('2')]

    expect(
      scheduler.__testing.commitSpans(
        messages,
        [stagedSpan('missing', messages[1]!.uuid)],
        'llm-summary',
      ),
    ).toBe(0)

    expect(store.getCommittedLog()).toEqual([])
    expect(recordContextCollapseCommitMock).not.toHaveBeenCalled()
  })

  test('records one spawn outside the span loop', () => {
    const messages = [
      makeMessage('1', 1_000),
      makeMessage('2', 1_000),
      makeMessage('3', 1_000),
      makeMessage('4', 1_000),
    ]

    expect(
      scheduler.__testing.commitSpans(
        messages,
        [
          stagedSpan(messages[0]!.uuid, messages[1]!.uuid),
          stagedSpan(messages[2]!.uuid, messages[3]!.uuid),
        ],
        'truncate',
      ),
    ).toBe(2)

    expect(store.getHealth().totalSpawns).toBe(1)
    expect(store.getCommittedLog()).toHaveLength(2)
  })

  test('writes estimated output tokens and the supplied strategy', () => {
    const messages = [makeMessage('1', 2_000), makeMessage('2', 500)]
    const span = stagedSpan(messages[0]!.uuid, messages[1]!.uuid)

    scheduler.__testing.commitSpans(messages, [span], 'truncate')

    expect(store.getCommittedLog()[0]!.entry.tokensOut).toBe(1)
    expect(store.getCommittedLog()[0]!.entry.strategy).toBe('truncate')
  })
})

describe('spawnCtxAgent', () => {
  function makeSpawnMessages(): Message[] {
    return [
      makeMessage('1', 1_500),
      makeMessage('2', 1_000),
      makeMessage('3', 20_000),
      makeMessage('4', 5_000),
    ]
  }

  test('uses the deterministic fallback without a signal and does not call queryHaiku', async () => {
    const messages = makeSpawnMessages()

    await scheduler.__testing.spawnCtxAgent(messages, {})

    expect(queryHaikuMock).not.toHaveBeenCalled()
    expect(store.getStaged()).toHaveLength(1)
    expect(store.getStaged()[0]).toMatchObject({
      startUuid: messages[0]!.uuid,
      endUuid: messages[1]!.uuid,
      summary: 'Collapsed 2 messages.',
      risk: 2_500,
    })
    expect(typeof store.getStaged()[0]!.stagedAt).toBe('number')
  })

  test('stages the model summary when queryHaiku returns a valid verdict', async () => {
    const messages = makeSpawnMessages()

    await scheduler.__testing.spawnCtxAgent(messages, {
      abortController: new AbortController(),
    })

    expect(queryHaikuMock).toHaveBeenCalledTimes(1)
    expect(store.getStaged()).toHaveLength(1)
    expect(store.getStaged()[0]).toMatchObject({
      startUuid: messages[0]!.uuid,
      endUuid: messages[1]!.uuid,
      summary: 'model',
      risk: 0.2,
    })
  })

  test('falls back to the placeholder summary when queryHaiku throws', async () => {
    queryHaikuMock.mockImplementation(async () => {
      throw new Error('network down')
    })
    const messages = makeSpawnMessages()

    await scheduler.__testing.spawnCtxAgent(messages, {
      abortController: new AbortController(),
    })

    expect(queryHaikuMock).toHaveBeenCalledTimes(1)
    expect(store.getStaged()).toHaveLength(1)
    expect(store.getStaged()[0]).toMatchObject({
      startUuid: messages[0]!.uuid,
      endUuid: messages[1]!.uuid,
      summary: 'Collapsed 2 messages.',
      risk: 0.5,
    })
  })

  test('records an empty spawn and stages nothing when the verdict risk is too high', async () => {
    queryHaikuMock.mockImplementation(async () =>
      makeAssistantMessage([
        { type: 'text', text: '{"summary":"too risky","risk":0.8}' },
      ]),
    )
    const messages = makeSpawnMessages()

    await scheduler.__testing.spawnCtxAgent(messages, {
      abortController: new AbortController(),
    })

    expect(store.getHealth().totalEmptySpawns).toBe(1)
    expect(store.getStaged()).toEqual([])
  })

  test('records an empty spawn when no candidate exists', async () => {
    await scheduler.__testing.spawnCtxAgent([], {})

    expect(store.getHealth().totalEmptySpawns).toBe(1)
    expect(store.getStaged()).toEqual([])
  })
})

describe('isWithheldPromptTooLong', () => {
  test('returns false for marble_origami queries', () => {
    expect(
      scheduler.isWithheldPromptTooLong(
        makeMessage('1'),
        () => true,
        'marble_origami',
      ),
    ).toBe(false)
  })

  test('returns false when the message is not prompt-too-long', () => {
    expect(
      scheduler.isWithheldPromptTooLong(makeMessage('1'), () => false, 'main'),
    ).toBe(false)
  })

  test('returns true when a non-marble message is prompt-too-long', () => {
    expect(
      scheduler.isWithheldPromptTooLong(makeMessage('1'), () => true, 'main'),
    ).toBe(true)
  })
})

describe('recoverFromOverflow', () => {
  test('short-circuits marble_origami queries', () => {
    const messages = [makeMessage('1')]

    expect(scheduler.recoverFromOverflow(messages, 'marble_origami')).toEqual({
      messages,
      committed: 0,
    })
  })

  test('returns zero when there are no staged spans and no candidate', () => {
    const messages: Message[] = []

    expect(scheduler.recoverFromOverflow(messages, 'main')).toEqual({
      messages,
      committed: 0,
    })
  })

  test('commits staged spans and returns a projected view', () => {
    const messages = [
      makeMessage('1', 1_000),
      makeMessage('2', 1_000),
      makeMessage('3', 1_000),
    ]
    store.pushStaged(stagedSpan(messages[0]!.uuid, messages[1]!.uuid))

    const result = scheduler.recoverFromOverflow(messages, 'main')

    expect(result.committed).toBe(1)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]!.message?.content).toBe(
      '<collapsed id="0000000000000001">summary</collapsed>',
    )
    expect(result.messages[1]).toBe(messages[2])
    expect(store.getStaged()).toEqual([])
  })

  test('commits a truncate candidate when staged spans are empty', () => {
    const messages = [
      makeMessage('1', 1_500),
      makeMessage('2', 1_000),
      makeMessage('3', 20_000),
      makeMessage('4', 5_000),
    ]

    const result = scheduler.recoverFromOverflow(messages, 'main')

    expect(result.committed).toBe(1)
    expect(store.getCommittedLog()[0]!.entry.strategy).toBe('truncate')
    expect(result.messages).toHaveLength(3)
  })

  test('returns synchronously without a Promise', () => {
    const result = scheduler.recoverFromOverflow([], 'main')

    expect(result).not.toBeInstanceOf(Promise)
    expect(result).toEqual({ messages: [], committed: 0 })
  })
})

describe('applyCollapsesIfNeeded', () => {
  test('short-circuits marble_origami queries', async () => {
    const messages = [makeMessage('1', 200_000)]

    await expect(
      scheduler.applyCollapsesIfNeeded(messages, {}, 'marble_origami'),
    ).resolves.toEqual({
      messages,
      committed: false,
    })
    expect(store.getCommittedLog()).toEqual([])
  })

  test('does not spawn below ninety percent and disarms the scheduler', async () => {
    const messages = [makeMessage('1', 1_000)]
    store.setArmed(true)

    const result = await scheduler.applyCollapsesIfNeeded(messages, {}, 'main')

    expect(result).toEqual({ messages, committed: false })
    expect(store.getArmed()).toBe(false)
    expect(store.getHealth().totalSpawns).toBe(0)
  })

  test('spawns and commits when tokens cross ninety percent while unarmed', async () => {
    const messages = [makeMessage('1', 160_000), makeMessage('2', 25_000)]

    const result = await scheduler.applyCollapsesIfNeeded(messages, {}, 'main')

    expect(result.committed).toBe(true)
    expect(store.getCommittedLog()).toHaveLength(1)
    expect(store.getArmed()).toBe(true)
    expect(store.getLastSpawnTokens()).toBe(185_000)
  })

  test('force spawns at ninety-five percent even when already armed', async () => {
    const messages = [makeMessage('1', 165_000), makeMessage('2', 25_000)]
    store.setArmed(true)
    store.setLastSpawnTokens(190_000)

    const result = await scheduler.applyCollapsesIfNeeded(messages, {}, 'main')

    expect(result.committed).toBe(true)
    expect(store.getCommittedLog()).toHaveLength(1)
  })

  test('spawns when the token interval advances by at least twelve thousand', async () => {
    const messages = [makeMessage('1', 158_000), makeMessage('2', 25_000)]
    store.setArmed(true)
    store.setLastSpawnTokens(170_000)

    const result = await scheduler.applyCollapsesIfNeeded(messages, {}, 'main')

    expect(result.committed).toBe(true)
    expect(store.getCommittedLog()).toHaveLength(1)
  })
})
