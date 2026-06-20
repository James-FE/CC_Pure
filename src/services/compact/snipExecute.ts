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
  const removedMessages: Message[] = []
  const exchanges = groupExchanges(args.store)

  for (const messageId of args.messageIds) {
    const exchange = exchanges.find(candidate =>
      candidate.some(message => message.uuid === messageId),
    )
    if (exchange) {
      removedMessages.push(...exchange)
      continue
    }

    const msg = args.store.find(m => m.uuid === messageId)
    if (msg) removedMessages.push(msg)
  }

  const closedRemovedMessages = closeToolPairs(removedMessages, args.store)
  const removedUuids = closedRemovedMessages.map(message =>
    String(message.uuid),
  )

  if (removedUuids.length === 0) {
    const missingMessageIds = args.messageIds
    return {
      type: 'system',
      uuid: randomUUID(),
      subtype: 'snip_failed',
      missingMessageIds,
      message: {
        role: 'system',
        content: `Snip failed: no requested message IDs were found: ${missingMessageIds.join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    } as Message
  }

  let removedTokens = 0
  for (const message of closedRemovedMessages) {
    removedTokens += estimateMessageTokens(message)
  }

  const deterministicFallback = () => {
    const count = removedUuids.length
    const from = String(closedRemovedMessages[0]?.timestamp ?? '?')
    const to = String(closedRemovedMessages.at(-1)?.timestamp ?? '?')
    return (
      args.reason ??
      `Snipped ${count} messages (${removedTokens} tokens) from ${from} to ${to}`
    )
  }

  let summary: string
  if (removedTokens < MIN_REMOVED_TOKENS) {
    summary = deterministicFallback()
  } else {
    const summaryMaxTokens = Math.min(
      MAX_SUMMARY_TOKENS,
      Math.floor(removedTokens * 0.5),
      args.haikuOptions.maxTokens,
    )

    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { queryHaiku } =
        require('src/services/api/claude.js') as typeof import('src/services/api/claude.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const response = await queryHaiku({
        systemPrompt: asSystemPrompt(args.haikuOptions.systemPrompt),
        userPrompt: renderExchangesForSummary(closedRemovedMessages),
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

export function isToolResultCarrier(message: Message): boolean {
  if (message.type !== 'user') return false
  return getToolResultIds(message).length > 0
}

function isRealUserTurn(message: Message): boolean {
  return (
    message.type === 'user' && !message.isMeta && !isToolResultCarrier(message)
  )
}

export function groupExchanges(store: Message[]): Message[][] {
  const exchanges: Message[][] = []
  let current: Message[] | undefined

  for (const message of store) {
    if (isRealUserTurn(message)) {
      if (current && current.length > 0) exchanges.push(current)
      current = [message]
      continue
    }

    if (current) current.push(message)
  }

  if (current && current.length > 0) exchanges.push(current)
  return exchanges
}

export function closeToolPairs(
  removed: Message[],
  store: Message[],
): Message[] {
  const selected = new Set(removed.map(message => String(message.uuid)))
  if (selected.size === 0) return []

  const storeByUuid = new Map(
    store.map(message => [String(message.uuid), message] as const),
  )
  const { adjacency, orphanMessageUuids } = buildToolPairGraph(store)

  for (const uuid of Array.from(selected)) {
    if (!storeByUuid.has(uuid)) selected.delete(uuid)
  }

  for (const uuid of Array.from(selected)) {
    for (const connectedUuid of collectConnectedUuids(uuid, adjacency)) {
      selected.add(connectedUuid)
    }
  }

  for (const uuid of Array.from(selected)) {
    if (!orphanMessageUuids.has(uuid)) continue
    for (const connectedUuid of collectConnectedUuids(uuid, adjacency)) {
      selected.delete(connectedUuid)
    }
  }

  return store.filter(message => selected.has(String(message.uuid)))
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

function getContentBlocks(message: Message): unknown[] {
  const content = message.message?.content
  return Array.isArray(content) ? content : []
}

function getToolUseIds(message: Message): string[] {
  const ids: string[] = []
  for (const block of getContentBlocks(message)) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'tool_use' && typeof record.id === 'string') {
      ids.push(record.id)
    }
  }
  return ids
}

function getToolResultIds(message: Message): string[] {
  const ids: string[] = []
  for (const block of getContentBlocks(message)) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (
      record.type === 'tool_result' &&
      typeof record.tool_use_id === 'string'
    ) {
      ids.push(record.tool_use_id)
    }
  }
  return ids
}

function buildToolPairGraph(store: Message[]): {
  adjacency: Map<string, Set<string>>
  orphanMessageUuids: Set<string>
} {
  const adjacency = new Map<string, Set<string>>()
  const orphanMessageUuids = new Set<string>()
  const toolUseMessages = new Map<string, Message[]>()
  const toolResultMessages = new Map<string, Message[]>()

  for (const message of store) {
    for (const id of getToolUseIds(message)) {
      const messages = toolUseMessages.get(id) ?? []
      messages.push(message)
      toolUseMessages.set(id, messages)
    }
    for (const id of getToolResultIds(message)) {
      const messages = toolResultMessages.get(id) ?? []
      messages.push(message)
      toolResultMessages.set(id, messages)
    }
  }

  const allToolIds = new Set([
    ...toolUseMessages.keys(),
    ...toolResultMessages.keys(),
  ])

  for (const id of allToolIds) {
    const useMessages = toolUseMessages.get(id) ?? []
    const resultMessages = toolResultMessages.get(id) ?? []

    if (useMessages.length === 0 || resultMessages.length === 0) {
      for (const message of [...useMessages, ...resultMessages]) {
        orphanMessageUuids.add(String(message.uuid))
      }
      continue
    }

    for (const useMessage of useMessages) {
      for (const resultMessage of resultMessages) {
        connectMessages(adjacency, useMessage, resultMessage)
      }
    }
  }

  return { adjacency, orphanMessageUuids }
}

function connectMessages(
  adjacency: Map<string, Set<string>>,
  left: Message,
  right: Message,
) {
  const leftUuid = String(left.uuid)
  const rightUuid = String(right.uuid)
  const leftEdges = adjacency.get(leftUuid) ?? new Set<string>()
  const rightEdges = adjacency.get(rightUuid) ?? new Set<string>()

  leftEdges.add(rightUuid)
  rightEdges.add(leftUuid)
  adjacency.set(leftUuid, leftEdges)
  adjacency.set(rightUuid, rightEdges)
}

function collectConnectedUuids(
  startUuid: string,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>()
  const stack = [startUuid]

  while (stack.length > 0) {
    const uuid = stack.pop()!
    if (visited.has(uuid)) continue
    visited.add(uuid)

    for (const nextUuid of adjacency.get(uuid) ?? []) {
      if (!visited.has(nextUuid)) stack.push(nextUuid)
    }
  }

  return visited
}
