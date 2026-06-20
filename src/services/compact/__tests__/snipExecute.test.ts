import { randomUUID } from 'crypto'
import { describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'
import { SnipTool } from '@claude-code-best/builtin-tools/tools/SnipTool/SnipTool.js'
import type { Message } from 'src/types/message.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import {
  closeToolPairs,
  executeSnip,
  groupExchanges,
  isToolResultCarrier,
} from '../snipExecute.js'
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

  test('creates a fallback boundary for snips below the removed token threshold', async () => {
    const message = makeMessage('too small')
    const queryHaiku = mock(async () => ({
      type: 'assistant',
      uuid: randomUUID() as UUID,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Should not be called' }],
      },
    }))
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const boundary = await executeSnip({
      messageIds: [message.uuid],
      store: [message],
      signal: new AbortController().signal,
      haikuOptions: { systemPrompt: asSystemPrompt([]), maxTokens: 512 },
    })

    expect(boundary).toMatchObject({
      type: 'system',
      subtype: 'snip_boundary',
      messageCount: 1,
      tokenCount: 3,
    })
    expect(boundary?.summary).toContain('Snipped 1 messages')
    expect(boundary?.snipMetadata).toEqual({ removedUuids: [message.uuid] })
    expect(queryHaiku).toHaveBeenCalledTimes(0)
  })

  test('returns a snip_failed notice when no message IDs match', async () => {
    const missingIds = ['missing-a', 'missing-b']
    const queryHaiku = mock(async () => ({
      type: 'assistant',
      uuid: randomUUID() as UUID,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Should not be called' }],
      },
    }))
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const notice = await executeSnip({
      messageIds: missingIds,
      store: [makeMessage('keep me')],
      signal: new AbortController().signal,
      haikuOptions: { systemPrompt: asSystemPrompt([]), maxTokens: 512 },
    })

    expect(notice).toMatchObject({
      type: 'system',
      subtype: 'snip_failed',
      missingMessageIds: missingIds,
      message: {
        role: 'system',
        content:
          'Snip failed: no requested message IDs were found: missing-a, missing-b',
      },
    })
    expect(queryHaiku).toHaveBeenCalledTimes(0)
  })

  test('removes matching tool_result carrier when snipping an exchange with tool_use', async () => {
    const firstUser = makeMessage(longText, 'user', '2026-06-20T00:00:00.000Z')
    const toolUse = makeToolUseMessage('toolu_read', { file_path: 'a.ts' })
    const toolResult = makeToolResultMessage('toolu_read')
    const assistant = makeMessage(
      'assistant final '.repeat(60),
      'assistant',
      '2026-06-20T00:00:03.000Z',
    )
    const nextUser = makeMessage('keep me', 'user', '2026-06-20T00:00:04.000Z')
    const queryHaiku = mock(async () => ({
      type: 'assistant',
      uuid: randomUUID() as UUID,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Tool exchange summary' }],
      },
    }))
    mock.module('src/services/api/claude.js', () => ({ queryHaiku }))

    const boundary = await executeSnip({
      messageIds: [firstUser.uuid],
      store: [firstUser, toolUse, toolResult, assistant, nextUser],
      signal: new AbortController().signal,
      haikuOptions: { systemPrompt: asSystemPrompt([]), maxTokens: 512 },
    })

    expect(boundary?.snipMetadata).toEqual({
      removedUuids: [
        firstUser.uuid,
        toolUse.uuid,
        toolResult.uuid,
        assistant.uuid,
      ],
    })
  })
})

describe('exchange grouping helpers', () => {
  test('treats tool_result user messages as part of the active exchange', () => {
    const firstUser = makeMessage('start')
    const toolUse = makeToolUseMessage('toolu_read', {})
    const toolResult = makeToolResultMessage('toolu_read')
    const nextUser = makeMessage('next')

    expect(isToolResultCarrier(toolResult)).toBe(true)
    expect(groupExchanges([firstUser, toolUse, toolResult, nextUser])).toEqual([
      [firstUser, toolUse, toolResult],
      [nextUser],
    ])
  })

  test('removes orphan tool pair candidates from the deletion set', () => {
    const user = makeMessage(longText)
    const orphanToolUse = makeToolUseMessage('toolu_missing_result', {})
    const nextUser = makeMessage('next')

    const closed = closeToolPairs(
      [user, orphanToolUse],
      [user, orphanToolUse, nextUser],
    )

    expect(closed).toEqual([user])
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

describe('SnipTool', () => {
  test('reports registration instead of completed deletion', () => {
    const result = SnipTool.mapToolResultToToolResultBlockParam(
      { snipped_count: 2, summary: 'trim old context' },
      'toolu_snip',
    )

    expect(result.content).toBe(
      'Registered 2 messages for snipping; they will be collapsed into a summary shortly.',
    )
    expect(String(result.content)).not.toContain('Snipped')
  })
})
