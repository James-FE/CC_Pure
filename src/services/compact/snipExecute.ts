import { randomUUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { estimateMessageTokens } from './snipCompact.js'

const MIN_REMOVED_TOKENS = 200
const MAX_SUMMARY_TOKENS = 512

export interface SnipExecuteArgs {
  messageIds: string[]
  reason?: string
  store: Message[]
  signal: AbortSignal
  haikuOptions: {
    systemPrompt: readonly string[]
    maxTokens: number
  }
}

type QueryHaikuResponse = {
  content?: unknown
  message?: {
    content?: unknown
  }
}

type TextBlock = {
  type?: unknown
  text?: unknown
}

export async function executeSnip(
  args: SnipExecuteArgs,
): Promise<Message | undefined> {
  const removedUuids: string[] = []
  const removedMessages: Message[] = []
  const seenUuids = new Set<string>()

  for (const messageId of args.messageIds) {
    const msg = args.store.find(m => m.uuid === messageId)
    if (!msg) continue
    const idx = args.store.indexOf(msg)
    addRemovedMessage(msg, removedMessages, removedUuids, seenUuids)

    for (let j = idx + 1; j < args.store.length; j++) {
      const next = args.store[j]!
      if (next.type === 'user') break
      addRemovedMessage(next, removedMessages, removedUuids, seenUuids)
    }
  }

  if (removedUuids.length === 0) return undefined

  let removedTokens = 0
  for (const message of removedMessages) {
    removedTokens += estimateMessageTokens(message)
  }
  if (removedTokens < MIN_REMOVED_TOKENS) return undefined

  const summaryMaxTokens = Math.min(
    MAX_SUMMARY_TOKENS,
    Math.floor(removedTokens * 0.5),
    args.haikuOptions.maxTokens,
  )

  const deterministicFallback = () => {
    const count = removedUuids.length
    const from = String(removedMessages[0]?.timestamp ?? '?')
    const to = String(removedMessages.at(-1)?.timestamp ?? '?')
    return (
      args.reason ??
      `Snipped ${count} messages (${removedTokens} tokens) from ${from} to ${to}`
    )
  }

  let summary: string
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { queryHaiku } =
      require('src/services/api/claude.js') as typeof import('src/services/api/claude.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt(args.haikuOptions.systemPrompt),
      userPrompt: renderExchangesForSummary(removedMessages),
      signal: args.signal,
      options: {
        querySource: 'snip_summary_generation',
        enablePromptCaching: false,
        agents: [],
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: summaryMaxTokens,
      },
    })
    summary = extractTextContent(response) || deterministicFallback()
  } catch {
    summary = deterministicFallback()
  }

  return {
    type: 'system',
    uuid: randomUUID(),
    subtype: 'snip_boundary',
    snipMetadata: {
      removedUuids,
    },
    summary,
    messageCount: removedUuids.length,
    tokenCount: removedTokens,
    timestamp: new Date().toISOString(),
  } as Message
}

function addRemovedMessage(
  message: Message,
  removedMessages: Message[],
  removedUuids: string[],
  seenUuids: Set<string>,
) {
  if (seenUuids.has(message.uuid)) return
  seenUuids.add(message.uuid)
  removedMessages.push(message)
  removedUuids.push(message.uuid)
}

export function extractTextContent(res: QueryHaikuResponse): string | null {
  const content = res.content ?? res.message?.content
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null

  const text = content
    .filter((block): block is TextBlock => isTextBlock(block))
    .map(block => String(block.text))
    .join('\n')
    .trim()
  return text || null
}

function isTextBlock(block: unknown): block is TextBlock {
  if (!block || typeof block !== 'object') return false
  const record = block as Record<string, unknown>
  return record.type === 'text' && typeof record.text === 'string'
}

function renderExchangesForSummary(messages: Message[]): string {
  return messages
    .map(message => {
      const role = message.type || String(message.message?.role ?? 'unknown')
      const content = message.message?.content
      return `[${role}] ${renderContent(content).slice(0, 500)}`
    })
    .join('\n\n')
}

function renderContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(renderContentBlock).join(' ')
  }
  if (content === null || content === undefined) return ''
  return JSON.stringify(content)
}

function renderContentBlock(block: unknown): string {
  if (typeof block === 'string') return block
  if (!block || typeof block !== 'object') return JSON.stringify(block)

  const record = block as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  return JSON.stringify(record)
}
