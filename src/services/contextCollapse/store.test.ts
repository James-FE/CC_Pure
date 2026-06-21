import { beforeEach, describe, expect, test } from 'bun:test'
import type { ContextCollapseCommitEntry } from 'src/types/logs.js'
import type { Message } from 'src/types/message.js'
import {
  drainStaged,
  getArmed,
  getCommittedLog,
  getHealth,
  getLastSpawnTokens,
  getStaged,
  markEmptySpawnWarningEmitted,
  pushCommitted,
  pushStaged,
  recordEmptySpawn,
  recordError,
  recordSpawn,
  reset,
  setArmed,
  setLastSpawnTokens,
  type StagedSpan,
} from './store.js'

function commitEntry(
  collapseId: string,
  summaryUuid: string,
): ContextCollapseCommitEntry {
  return {
    type: 'marble-origami-commit',
    sessionId: '00000000-0000-4000-8000-000000000001',
    collapseId,
    summaryUuid,
    summaryContent: `<collapsed id="${collapseId}">summary</collapsed>`,
    summary: `summary ${collapseId}`,
    firstArchivedUuid: `first-${collapseId}`,
    lastArchivedUuid: `last-${collapseId}`,
  }
}

function stagedSpan(startUuid: string, endUuid: string): StagedSpan {
  return {
    startUuid,
    endUuid,
    summary: `${startUuid} to ${endUuid}`,
    risk: 0.25,
    stagedAt: 1234567890,
  }
}

function message(uuid: string): Message {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-${uuid}`,
    message: {
      role: 'user',
      content: 'hello',
    },
  }
}

describe('context collapse store', () => {
  beforeEach(() => {
    reset()
  })

  test('pushCommitted creates a committed collapse with an empty archive', () => {
    const entry = commitEntry('0000000000000001', 'summary-uuid-1')

    const committed = pushCommitted(entry)

    expect(committed).toEqual({ entry, archived: [] })
    expect(getCommittedLog()).toEqual([committed])
  })

  test('pushCommitted appends commits in order', () => {
    const first = pushCommitted(
      commitEntry('0000000000000001', 'summary-uuid-1'),
    )
    const second = pushCommitted(
      commitEntry('0000000000000002', 'summary-uuid-2'),
    )

    expect(getCommittedLog()).toEqual([first, second])
  })

  test('pushStaged appends spans in order', () => {
    const first = stagedSpan('start-1', 'end-1')
    const second = stagedSpan('start-2', 'end-2')

    pushStaged(first)
    pushStaged(second)

    expect(getStaged()).toEqual([first, second])
  })

  test('drainStaged returns all staged spans and clears the queue', () => {
    const first = stagedSpan('start-1', 'end-1')
    const second = stagedSpan('start-2', 'end-2')
    pushStaged(first)
    pushStaged(second)

    expect(drainStaged()).toEqual([first, second])
    expect(getStaged()).toEqual([])
    expect(drainStaged()).toEqual([])
  })

  test('drainStaged returns an empty array when the queue is already empty', () => {
    expect(drainStaged()).toEqual([])
  })

  test('setArmed round-trips through getArmed', () => {
    setArmed(true)
    expect(getArmed()).toBe(true)

    setArmed(false)
    expect(getArmed()).toBe(false)
  })

  test('setLastSpawnTokens round-trips through getLastSpawnTokens', () => {
    setLastSpawnTokens(42)

    expect(getLastSpawnTokens()).toBe(42)
  })

  test('recordSpawn increments total spawns in health', () => {
    recordSpawn()
    recordSpawn()

    expect(getHealth().totalSpawns).toBe(2)
  })

  test('recordEmptySpawn increments total empty spawns in health', () => {
    recordEmptySpawn()
    recordEmptySpawn()

    expect(getHealth().totalEmptySpawns).toBe(2)
  })

  test('recordError sets lastError and increments total errors in health', () => {
    recordError('first error')
    recordError('second error')

    expect(getHealth().lastError).toBe('second error')
    expect(getHealth().totalErrors).toBe(2)
  })

  test('markEmptySpawnWarningEmitted sets the health warning flag', () => {
    markEmptySpawnWarningEmitted()

    expect(getHealth().emptySpawnWarningEmitted).toBe(true)
  })

  test('reset wipes committed log, staged queue, trigger state, and health', () => {
    const committed = pushCommitted(
      commitEntry('0000000000000001', 'summary-uuid-1'),
    )
    committed.archived.push(message('000000000001'))
    pushStaged(stagedSpan('start-1', 'end-1'))
    setArmed(true)
    setLastSpawnTokens(42)
    recordSpawn()
    recordEmptySpawn()
    recordError('boom')
    markEmptySpawnWarningEmitted()

    reset()

    expect(getCommittedLog()).toEqual([])
    expect(getStaged()).toEqual([])
    expect(getArmed()).toBe(false)
    expect(getLastSpawnTokens()).toBe(0)
    expect(getHealth()).toEqual({
      totalSpawns: 0,
      totalErrors: 0,
      emptySpawnWarningEmitted: false,
      totalEmptySpawns: 0,
    })
  })
})
