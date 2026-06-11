import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { buildPostCompactMessages } from '../../src/services/compact/compact.js'
import {
  createSystemMessage,
  createUserMessage,
} from '../../src/utils/messages.js'
import { setEventStore } from '../../src/coordinator/eventStoreInstance.js'
import {
  projectTeamState,
  renderTeamContext,
} from '../../src/coordinator/teamProjection.js'
import type { CompactionResult } from '../../src/services/compact/compact.js'
import type {
  EventStore,
  TeamEvent,
} from '../../src/coordinator/teamEventStore.js'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'COORDINATOR_MODE',
}))

class MockEventStore implements EventStore {
  events: TeamEvent[] = []

  async append(event: TeamEvent): Promise<void> {
    this.events.push(event)
  }

  async read(since?: number): Promise<TeamEvent[]> {
    return this.events.filter(
      event => since === undefined || event.timestamp > since,
    )
  }

  async clear(before?: number): Promise<void> {
    if (before === undefined) {
      this.events = []
      return
    }

    this.events = this.events.filter(event => event.timestamp >= before)
  }
}

let clearEventsBeforeCheckpoint: (
  teamContext: string | undefined,
) => Promise<void>

beforeAll(async () => {
  const queryModule = await import('../../src/query.js')
  clearEventsBeforeCheckpoint = queryModule.clearEventsBeforeCheckpoint
})

describe('coordinator event log integration', () => {
  test('recovers team state from events after compaction', async () => {
    const store = new MockEventStore()
    setEventStore(store)

    await store.append({
      version: 1,
      timestamp: 100,
      coordinatorId: 'coordinator-a',
      sessionId: 'session-a',
      type: 'coordinator.worker_spawned',
      workerId: 'worker-1',
      directive: 'Investigate tests',
      agentType: 'worker',
    })
    await store.append({
      version: 1,
      timestamp: 110,
      coordinatorId: 'coordinator-a',
      sessionId: 'session-a',
      type: 'coordinator.worker_spawned',
      workerId: 'worker-2',
      directive: 'Inspect implementation',
      agentType: 'worker',
    })
    await store.append({
      version: 1,
      timestamp: 150,
      coordinatorId: 'coordinator-a',
      sessionId: 'session-a',
      type: 'coordinator.worker_result',
      workerId: 'worker-1',
      status: 'completed',
      summary: 'Tests are green',
    })

    const recovered = projectTeamState(await store.read())
    const teamContext = renderTeamContext(recovered)
    const compacted = buildPostCompactMessages(
      makeCompactionResult(),
      teamContext,
    )

    expect(recovered.workers['worker-1']?.status).toBe('completed')
    expect(recovered.workers['worker-2']?.status).toBe('running')
    expect(compacted.at(-1)?.type).toBe('system')
    expect(compacted.at(-1)?.content).toContain('worker-1')
    expect(compacted.at(-1)?.content).toContain('worker-2')
  })

  test('writes checkpoint and clears events before it after compaction', async () => {
    const store = new MockEventStore()
    setEventStore(store)
    process.env.COORDINATOR_ID = 'coordinator-test'

    const originalDateNow = Date.now
    Date.now = () => 200

    try {
      await store.append({
        version: 1,
        timestamp: 100,
        coordinatorId: 'coordinator-test',
        sessionId: 'session-a',
        type: 'coordinator.worker_spawned',
        workerId: 'worker-1',
        directive: 'Investigate checkpoint cleanup',
        agentType: 'worker',
      })
      await store.append({
        version: 1,
        timestamp: 150,
        coordinatorId: 'coordinator-test',
        sessionId: 'session-a',
        type: 'coordinator.worker_result',
        workerId: 'worker-1',
        status: 'completed',
        summary: 'Checkpoint cleanup is ready',
      })

      await clearEventsBeforeCheckpoint('<coordinator-team-state />')

      expect(store.events).toHaveLength(1)
      const checkpoint = store.events[0]
      expect(checkpoint?.type).toBe('coordinator.checkpoint')
      expect(checkpoint?.timestamp).toBe(200)
      expect(checkpoint?.coordinatorId).toBe('coordinator-test')
      expect(
        checkpoint?.type === 'coordinator.checkpoint'
          ? checkpoint.projectedState.workers['worker-1']?.status
          : undefined,
      ).toBe('completed')
    } finally {
      Date.now = originalDateNow
      delete process.env.COORDINATOR_ID
    }
  })
})

function makeCompactionResult(): CompactionResult {
  return {
    boundaryMarker: createSystemMessage('compact boundary', 'info'),
    summaryMessages: [createUserMessage({ content: 'summary', isMeta: true })],
    attachments: [],
    hookResults: [],
    messagesToKeep: [],
  }
}
