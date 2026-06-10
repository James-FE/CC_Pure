import { describe, expect, test } from 'bun:test'
import type { CollapseEntry } from '../operations.js'
import { isValidEntry, restoreFromEntries } from '../persist.js'

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

describe('restoreFromEntries', () => {
  test('merges raw entries and array snapshots, filters invalid entries, dedupes, and sorts oldest first', () => {
    const first = makeEntry('same', '2026-01-02T00:00:00.000Z')
    const duplicate = makeEntry('same', '2026-01-01T00:00:00.000Z')
    const oldest = makeEntry('oldest', '2026-01-01T00:00:00.000Z')
    const newest = makeEntry('newest', '2026-01-03T00:00:00.000Z')

    const restored = restoreFromEntries(
      [first, { id: '' }, null, newest],
      [oldest, duplicate],
    )

    expect(restored.map(entry => entry.id)).toEqual([
      'oldest',
      'same',
      'newest',
    ])
    expect(restored.find(entry => entry.id === 'same')).toBe(first)
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
