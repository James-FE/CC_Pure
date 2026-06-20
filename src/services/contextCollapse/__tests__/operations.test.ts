import { randomUUID } from 'crypto'
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import {
  createSummaryMessage,
  type CollapseEntry,
  projectView,
} from '../operations.js'
import { restoreFromEntries } from '../persist.js'

function makeMessage(label: string): Message {
  return {
    type: 'user',
    uuid: randomUUID() as UUID,
    message: {
      role: 'user',
      content: label,
    },
  }
}

function makeEntry(
  id: string,
  startIdx: number,
  endIdx: number,
  summary: string,
): CollapseEntry {
  return {
    id,
    span: {
      startIdx,
      endIdx,
      messageIds: [],
    },
    replacement: {
      text: summary,
      tokens: 8,
    },
    createdAt: `2026-01-01T00:00:0${startIdx}.000Z`,
    depth: 0,
    parentId: null,
    meta: {
      messageCount: endIdx - startIdx + 1,
      tokensIn: 100,
      tokensOut: 8,
      strategy: 'llm-summary',
    },
  }
}

function makeCommit(
  firstArchivedUuid: string,
  lastArchivedUuid: string,
  summary: string,
): ContextCollapseCommitEntry {
  return {
    type: 'marble-origami-commit',
    sessionId: 'session-id' as UUID,
    collapseId: randomUUID(),
    summaryUuid: randomUUID(),
    summaryContent: `<collapsed id="collapse">${summary}</collapsed>`,
    summary,
    firstArchivedUuid,
    lastArchivedUuid,
  }
}

describe('projectView', () => {
  test('returns the original messages when there is no collapse log', () => {
    const messages = [makeMessage('one')]

    expect(projectView(messages)).toBe(messages)
    expect(projectView(messages, [])).toBe(messages)
  })

  test('replaces collapsed spans with summaries sorted by start index', () => {
    const messages = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map(makeMessage)
    const projected = projectView(messages, [
      makeEntry('later', 4, 5, 'later summary'),
      makeEntry('earlier', 1, 2, 'earlier summary'),
    ])

    expect(projected).toHaveLength(4)
    expect(projected[0]).toBe(messages[0])
    expect(projected[1]?.message?.content).toBe(
      '[Collapsed 2 messages]\n\nearlier summary',
    )
    expect(projected[2]).toBe(messages[3])
    expect(projected[3]?.message?.content).toBe(
      '[Collapsed 2 messages]\n\nlater summary',
    )
  })

  test('skips collapse entries with spans outside the message range', () => {
    const messages = ['m0', 'm1', 'm2'].map(makeMessage)

    const projected = projectView(messages, [
      makeEntry('negative-start', -1, 1, 'negative summary'),
      makeEntry('past-end', 2, 3, 'past end summary'),
      makeEntry('valid', 1, 1, 'valid summary'),
    ])

    expect(projected).toHaveLength(3)
    expect(projected[0]).toBe(messages[0])
    expect(projected[1]?.message?.content).toBe(
      '[Collapsed 1 messages]\n\nvalid summary',
    )
    expect(projected[2]).toBe(messages[2])
  })

  test('uses restored UUID-based commits when no collapse log is provided', () => {
    const messages = ['m0', 'm1', 'm2', 'm3'].map(makeMessage)
    restoreFromEntries(
      [
        makeCommit(messages[1]!.uuid, messages[2]!.uuid, 'restored summary'),
        makeCommit('missing-start', messages[3]!.uuid, 'missing summary'),
      ],
      null,
    )

    const projected = projectView(messages)

    expect(projected).toHaveLength(3)
    expect(projected[0]).toBe(messages[0])
    expect(projected[1]?.message?.content).toBe(
      '[Collapsed 2 messages]\n\nrestored summary',
    )
    expect(projected[2]).toBe(messages[3])
  })
})

describe('createSummaryMessage', () => {
  test('creates a synthetic user summary message with a fresh uuid', () => {
    const message = createSummaryMessage(makeEntry('entry', 0, 2, 'summary'))

    expect(message.type).toBe('user')
    expect(typeof message.uuid).toBe('string')
    expect(message.message?.role).toBe('user')
    expect(message.message?.content).toBe('[Collapsed 3 messages]\n\nsummary')
    expect(message.isSidechain).toBe(true)
    expect(message.isEphemeral).toBe(true)
  })
})
