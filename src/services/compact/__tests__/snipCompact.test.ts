import { randomUUID } from 'crypto'
import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { estimateMessageTokens, findSnipBoundary } from '../snipCompact.js'

function makeMessage(content: string, type: Message['type'] = 'user'): Message {
  return {
    type,
    uuid: randomUUID() as UUID,
    message: { content },
  }
}

function makeBoundary(removedUuids: string[]): Message {
  return {
    type: 'system',
    uuid: randomUUID() as UUID,
    subtype: 'snip_boundary',
    snipMetadata: { removedUuids },
  }
}

describe('findSnipBoundary', () => {
  test('returns the last set-based snip boundary', () => {
    const first = makeBoundary(['first'])
    const second = makeBoundary(['second'])
    const messages = [
      makeMessage('before'),
      first,
      makeMessage('middle'),
      second,
    ]

    expect(findSnipBoundary(messages)).toEqual({
      index: 3,
      removedUuids: ['second'],
      boundaryMessage: second,
    })
  })

  test('ignores snip boundaries without removedUuids metadata', () => {
    const malformedBoundary: Message = {
      type: 'system',
      uuid: randomUUID() as UUID,
      subtype: 'snip_boundary',
    }

    expect(findSnipBoundary([makeMessage('before'), malformedBoundary])).toBe(
      undefined,
    )
  })
})

describe('estimateMessageTokens', () => {
  test('estimates a minimum of one token for short messages', () => {
    expect(estimateMessageTokens(makeMessage('x'))).toBe(1)
  })

  test('estimates string content by four characters per token', () => {
    expect(estimateMessageTokens(makeMessage('12345'))).toBe(2)
  })
})
