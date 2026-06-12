import { describe, expect, test } from 'bun:test'
import {
  close,
  deleteByPrefix,
  deleteKey,
  get,
  getByPrefix,
  open,
  set,
} from '../BlackboardStore.js'

describe('BlackboardStore', () => {
  test('open creates the blackboard schema and set inserts versioned entries', () => {
    const db = open(':memory:')

    try {
      set(db, 'worker:alpha:status', 'running', 'worker:alpha')

      const entry = get(db, 'worker:alpha:status')
      expect(entry).not.toBeNull()
      expect(entry).toMatchObject({
        key: 'worker:alpha:status',
        value: 'running',
        version: 1,
        updatedBy: 'worker:alpha',
      })
      expect(entry?.updatedAt).toBeString()
    } finally {
      close(db)
    }
  })

  test('set updates existing entries and increments the version', () => {
    const db = open(':memory:')

    try {
      set(db, 'worker:alpha:status', 'running', 'worker:alpha')
      set(db, 'worker:alpha:status', 'done', 'worker:alpha')

      expect(get(db, 'worker:alpha:status')).toMatchObject({
        key: 'worker:alpha:status',
        value: 'done',
        version: 2,
        updatedBy: 'worker:alpha',
      })
    } finally {
      close(db)
    }
  })

  test('get returns null for missing keys', () => {
    const db = open(':memory:')

    try {
      expect(get(db, 'worker:missing:status')).toBeNull()
    } finally {
      close(db)
    }
  })

  test('getByPrefix returns matching entries ordered by key', () => {
    const db = open(':memory:')

    try {
      set(db, 'worker:beta:status', 'running', 'worker:beta')
      set(db, 'team:plan', 'ship it', 'coordinator')
      set(db, 'worker:alpha:status', 'done', 'worker:alpha')

      expect(getByPrefix(db, 'worker:').map(entry => entry.key)).toEqual([
        'worker:alpha:status',
        'worker:beta:status',
      ])
    } finally {
      close(db)
    }
  })

  test('deleteKey removes one entry', () => {
    const db = open(':memory:')

    try {
      set(db, 'worker:alpha:status', 'running', 'worker:alpha')
      set(db, 'worker:alpha:result', 'ok', 'worker:alpha')

      deleteKey(db, 'worker:alpha:status')

      expect(get(db, 'worker:alpha:status')).toBeNull()
      expect(get(db, 'worker:alpha:result')).not.toBeNull()
    } finally {
      close(db)
    }
  })

  test('deleteByPrefix removes all entries under a prefix', () => {
    const db = open(':memory:')

    try {
      set(db, 'worker:alpha:status', 'running', 'worker:alpha')
      set(db, 'worker:alpha:result', 'ok', 'worker:alpha')
      set(db, 'team:plan', 'ship it', 'coordinator')

      deleteByPrefix(db, 'worker:alpha:')

      expect(getByPrefix(db, 'worker:alpha:')).toEqual([])
      expect(get(db, 'team:plan')).not.toBeNull()
    } finally {
      close(db)
    }
  })
})
