import { randomUUID } from 'crypto'
import { describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import {
  estimateMessageTokens,
  findSnipBoundary,
  resolveSnipMarkersIfNeeded,
  snipCompactIfNeeded,
} from '../snipCompact.js'

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

function makeMarker(markedUuids: string[], estimatedTokens: number): Message {
  return {
    type: 'system',
    uuid: randomUUID() as UUID,
    subtype: 'snip_marker',
    markedUuids,
    estimatedTokens,
    timestamp: '2026-06-20T00:00:00.000Z',
  }
}

function makeToolUseMessage(toolUseId: string): Message {
  return {
    type: 'assistant',
    uuid: randomUUID() as UUID,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Read',
          input: {},
        },
      ],
    },
  }
}

function makeToolResultMessage(toolUseId: string): Message {
  return {
    type: 'user',
    uuid: randomUUID() as UUID,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'result',
        },
      ],
    },
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

describe('snipCompactIfNeeded', () => {
  test('rescans filtered messages so kept output does not contain orphan tool_results', () => {
    const user = makeMessage('start')
    const toolUse = makeToolUseMessage('toolu_read')
    const toolResult = makeToolResultMessage('toolu_read')
    const boundary = makeBoundary([toolUse.uuid])
    const nextUser = makeMessage('next')

    const compacted = snipCompactIfNeeded([
      user,
      toolUse,
      toolResult,
      boundary,
      nextUser,
    ])

    expect(compacted.executed).toBe(true)
    expect(compacted.messages).toEqual([user, boundary, nextUser])
  })
})

describe('resolveSnipMarkersIfNeeded', () => {
  test('turns pending snip markers into boundaries and removes marked messages', async () => {
    const remove = makeMessage('old context '.repeat(100), 'user')
    const keep = makeMessage('keep me', 'user')
    const marker = makeMarker([remove.uuid], 300)
    const queryHaiku = mock(async () => ({
      message: {
        content: [{ type: 'text', text: 'Resolved marker summary' }],
      },
    }))
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const compacted = await resolveSnipMarkersIfNeeded(
      [remove, marker, keep],
      new AbortController().signal,
      { systemPrompt: [], maxTokens: 512 },
    )

    expect(compacted.executed).toBe(true)
    expect(compacted.messages.map(message => message.uuid)).toEqual([
      keep.uuid,
      compacted.boundaryMessages[0]?.uuid,
    ])
    expect(compacted.boundaryMessages[0]).toMatchObject({
      type: 'system',
      subtype: 'snip_boundary',
      summary: 'Resolved marker summary',
      snipMetadata: { removedUuids: [remove.uuid] },
    })
    expect(queryHaiku).toHaveBeenCalledTimes(1)
  })
})
