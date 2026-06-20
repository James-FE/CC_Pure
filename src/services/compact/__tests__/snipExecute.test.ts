import { randomUUID } from 'crypto'
import { describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { executeSnip } from '../snipExecute.js'
import { maybeExecuteSnipFromToolResult } from '../snipCompact.js'

function makeMessage(
  content: string,
  type: Message['type'] = 'user',
  timestamp = '2026-06-20T00:00:00.000Z',
): Message {
  return {
    type,
    uuid: randomUUID() as UUID,
    timestamp,
    message: {
      role: type === 'assistant' ? 'assistant' : 'user',
      content,
    },
  }
}

function makeToolUseMessage(toolUseId: string, input: unknown): Message {
  return {
    type: 'assistant',
    uuid: randomUUID() as UUID,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Snip',
          input,
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
          content: 'Snipped 1 messages.',
        },
      ],
    },
  }
}

const longText = 'x'.repeat(900)

describe('executeSnip', () => {
  test('expands selected messages to assistant exchange block and summarizes with Haiku', async () => {
    const firstUser = makeMessage(longText, 'user', '2026-06-20T00:00:00.000Z')
    const assistant = makeMessage(
      'assistant details '.repeat(60),
      'assistant',
      '2026-06-20T00:00:01.000Z',
    )
    const nextUser = makeMessage('keep me', 'user', '2026-06-20T00:00:02.000Z')
    const queryHaiku = mock(
      async (_params: { options: { maxOutputTokensOverride?: number } }) => ({
        type: 'assistant',
        uuid: randomUUID() as UUID,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Haiku summary' }],
        },
      }),
    )
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const boundary = await executeSnip({
      messageIds: [firstUser.uuid],
      reason: 'old exploration',
      store: [firstUser, assistant, nextUser],
      signal: new AbortController().signal,
      haikuOptions: {
        systemPrompt: asSystemPrompt(['Summarize snipped history.']),
        maxTokens: 512,
      },
    })

    expect(boundary).toMatchObject({
      type: 'system',
      subtype: 'snip_boundary',
      summary: 'Haiku summary',
      messageCount: 2,
    })
    expect(boundary?.snipMetadata).toEqual({
      removedUuids: [firstUser.uuid, assistant.uuid],
    })
    expect(queryHaiku).toHaveBeenCalledTimes(1)
    expect(queryHaiku.mock.calls[0]?.[0].options.maxOutputTokensOverride).toBe(
      247,
    )
  })

  test('skips snips below the removed token threshold', async () => {
    const message = makeMessage('too small')

    const boundary = await executeSnip({
      messageIds: [message.uuid],
      store: [message],
      signal: new AbortController().signal,
      haikuOptions: { systemPrompt: asSystemPrompt([]), maxTokens: 512 },
    })

    expect(boundary).toBeUndefined()
  })
})

describe('maybeExecuteSnipFromToolResult', () => {
  test('bridges a Snip tool result to a snip boundary message', async () => {
    const target = makeMessage(longText)
    const nextUser = makeMessage('next user message')
    const toolUseId = 'toolu_snip'
    const toolUse = makeToolUseMessage(toolUseId, {
      message_ids: [target.uuid],
      reason: 'trim old context',
    })
    const toolResult = makeToolResultMessage(toolUseId)
    const queryHaiku = mock(async () => ({
      type: 'assistant',
      uuid: randomUUID() as UUID,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Bridge summary' }],
      },
    }))
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const boundary = await maybeExecuteSnipFromToolResult(
      toolResult,
      [target, nextUser, toolUse, toolResult],
      new AbortController().signal,
      { systemPrompt: asSystemPrompt([]), maxTokens: 512 },
    )

    expect(boundary).toMatchObject({
      type: 'system',
      subtype: 'snip_boundary',
      summary: 'Bridge summary',
      messageCount: 1,
    })
    expect(boundary?.snipMetadata).toEqual({ removedUuids: [target.uuid] })
  })
})
