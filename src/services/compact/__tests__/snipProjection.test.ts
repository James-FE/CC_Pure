import { randomUUID } from 'crypto'
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { isSnipBoundaryMessage, projectSnippedView } from '../snipProjection.js'

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

function makeSnipBoundary(removedUuids: string[]): Message {
  return {
    type: 'system',
    uuid: randomUUID() as UUID,
    subtype: 'snip_boundary',
    snipMetadata: { removedUuids },
  }
}

describe('projectSnippedView', () => {
  test('returns original messages when there is no boundary', () => {
    const messages = [makeMessage('one')]

    expect(projectSnippedView(messages)).toBe(messages)
  })

  test('removes only messages listed by the snip boundary removedUuids', () => {
    const keepBefore = makeMessage('keep-before')
    const removeOne = makeMessage('remove-one')
    const keepMiddle = makeMessage('keep-middle')
    const removeTwo = makeMessage('remove-two')
    const keepAfter = makeMessage('keep-after')
    const boundary = makeSnipBoundary([removeOne.uuid, removeTwo.uuid])
    const messages = [
      keepBefore,
      removeOne,
      keepMiddle,
      removeTwo,
      boundary,
      keepAfter,
    ]

    expect(projectSnippedView(messages)).toEqual([
      keepBefore,
      keepMiddle,
      boundary,
      keepAfter,
    ])
  })

  test('retains messages before the boundary when not listed in removedUuids', () => {
    const keepBefore = makeMessage('keep-before')
    const removeBefore = makeMessage('remove-before')
    const boundary = makeSnipBoundary([removeBefore.uuid])
    const keepAfter = makeMessage('keep-after')
    const messages = [keepBefore, removeBefore, boundary, keepAfter]

    expect(projectSnippedView(messages)).toEqual([
      keepBefore,
      boundary,
      keepAfter,
    ])
  })

  test('detects system snip boundary messages with removedUuids metadata', () => {
    const boundary = makeSnipBoundary(['removed'])

    expect(isSnipBoundaryMessage(boundary)).toBe(true)
  })
})
