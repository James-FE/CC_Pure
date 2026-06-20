import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from 'src/types/logs.js'
import type { CollapseEntry } from '../operations.js'
import {
  getRestoredCommits,
  getRestoredSnapshot,
  isValidEntry,
  restoreFromEntries,
} from '../persist.js'

function makeEntry(id: string, createdAt: string): CollapseEntry {
  return {
    id,
    span: {
      startIdx: 0,
      endIdx: 0,
      messageIds: [],
    },
    replacement: {
      text: id,
      tokens: 1,
    },
    createdAt,
    depth: 0,
    parentId: null,
    meta: {
      messageCount: 1,
      tokensIn: 10,
      tokensOut: 1,
      strategy: 'truncate',
    },
  }
}

function makeCommit(collapseId: string): ContextCollapseCommitEntry {
  return {
    type: 'marble-origami-commit',
    sessionId: 'session-id' as UUID,
    collapseId,
    summaryUuid: `summary-${collapseId}`,
    summaryContent: `<collapsed id="${collapseId}">summary ${collapseId}</collapsed>`,
    summary: `summary ${collapseId}`,
    firstArchivedUuid: `first-${collapseId}`,
    lastArchivedUuid: `last-${collapseId}`,
  }
}

function makeSnapshot(): ContextCollapseSnapshotEntry {
  return {
    type: 'marble-origami-snapshot',
    sessionId: 'session-id' as UUID,
    staged: [
      {
        startUuid: 'start',
        endUuid: 'end',
        summary: 'staged summary',
        risk: 0.2,
        stagedAt: 1,
      },
    ],
    armed: true,
    lastSpawnTokens: 123,
  }
}

describe('restoreFromEntries', () => {
  test('filters invalid index-based entries and dedupes by id', () => {
    const first = makeEntry('same', '2026-01-02T00:00:00.000Z')
    const duplicate = makeEntry('same', '2026-01-01T00:00:00.000Z')
    const oldest = makeEntry('oldest', '2026-01-01T00:00:00.000Z')
    const newest = makeEntry('newest', '2026-01-03T00:00:00.000Z')

    const restored = restoreFromEntries(
      [first, { id: '' }, null, newest, oldest, duplicate],
      null,
    )
    const restoredCollapseEntries = restored.filter(
      (entry): entry is CollapseEntry => 'id' in entry,
    )

    expect(restoredCollapseEntries.map(entry => entry.id)).toEqual([
      'same',
      'newest',
      'oldest',
    ])
    expect(restoredCollapseEntries.find(entry => entry.id === 'same')).toBe(
      first,
    )
  })

  test('restores persisted commit entries into the in-memory store and dedupes by collapseId', () => {
    const first = makeCommit('0000000000000001')
    const duplicate = {
      ...makeCommit('0000000000000001'),
      summary: 'duplicate should not win',
    }
    const second = makeCommit('0000000000000002')

    const restored = restoreFromEntries([first, duplicate, second], null)

    expect(restored).toEqual([first, second])
    expect(getRestoredCommits()).toEqual([first, second])
  })

  test('stores snapshot separately instead of treating it as a commit entry', () => {
    const commit = makeCommit('0000000000000001')
    const snapshot = makeSnapshot()

    const restored = restoreFromEntries([commit], snapshot)

    expect(restored).toEqual([commit])
    expect(getRestoredCommits()).toEqual([commit])
    expect(getRestoredSnapshot()).toEqual(snapshot)
  })

  test('clears restored store when all persisted commits are invalid', () => {
    restoreFromEntries([makeCommit('0000000000000001')], makeSnapshot())

    const restored = restoreFromEntries(
      [
        {
          ...makeCommit('0000000000000002'),
          firstArchivedUuid: undefined,
        },
      ],
      null,
    )

    expect(restored).toEqual([])
    expect(getRestoredCommits()).toEqual([])
    expect(getRestoredSnapshot()).toBeUndefined()
  })
})

describe('isValidEntry', () => {
  test('rejects entries missing required structural fields', () => {
    const valid = makeEntry('valid', '2026-01-01T00:00:00.000Z')

    expect(isValidEntry(valid)).toBe(true)
    expect(isValidEntry({ ...valid, span: undefined })).toBe(false)
    expect(isValidEntry({ ...valid, span: { endIdx: 1 } })).toBe(false)
    expect(isValidEntry({ ...valid, span: { startIdx: 0 } })).toBe(false)
    expect(isValidEntry({ ...valid, replacement: undefined })).toBe(false)
    expect(isValidEntry({ ...valid, replacement: { text: 'summary' } })).toBe(
      false,
    )
    expect(isValidEntry({ ...valid, replacement: { tokens: 1 } })).toBe(false)
    expect(isValidEntry({ ...valid, createdAt: '' })).toBe(false)
    expect(isValidEntry({ ...valid, meta: undefined })).toBe(false)
  })

  test('restoreFromEntries filters malformed entries that have an id', () => {
    const valid = makeEntry('valid', '2026-01-01T00:00:00.000Z')

    const restored = restoreFromEntries(
      [
        { id: 'missing-span', createdAt: valid.createdAt },
        { ...valid, id: 'missing-replacement', replacement: undefined },
        valid,
      ],
      null,
    )

    expect(restored).toEqual([valid])
  })
})
