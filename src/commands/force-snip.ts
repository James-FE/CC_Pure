import { randomUUID } from 'crypto'
import { estimateMessageTokens } from '../services/compact/snipCompact.js'
import {
  closeToolPairs,
  groupExchanges,
} from '../services/compact/snipExecute.js'
import type { Command, LocalCommandCall } from '../types/command.js'
import type { Message } from '../types/message.js'

type ForceSnipStats = {
  budget: number
  totalRemovableTokens: number
  remainingRemovableTokens: number
  removedMessages: number
  freedTokens: number
  beforeMessages: number
  afterMessages: number
}

const call: LocalCommandCall = async (args, context) => {
  const parsedBudget = parseBudget(args)
  if (parsedBudget.type === 'invalid') {
    return {
      type: 'text',
      value:
        'Invalid /force-snip budget. Use a non-negative token count, e.g. /force-snip 12000.',
    }
  }

  let stats: ForceSnipStats | undefined

  context.setMessages(prev => {
    const result = forceSnipMessages(prev, parsedBudget.value)
    stats = result.stats
    return result.messages
  })

  if (!stats || stats.removedMessages === 0) {
    return {
      type: 'text',
      value:
        'Force-snip found nothing to remove. Need at least two user turns with removable history before the latest user turn.',
    }
  }

  return {
    type: 'text',
    value:
      `Force-snipped ${stats.removedMessages} messages, freeing ~${stats.freedTokens} tokens. ` +
      `Removable history went from ~${stats.totalRemovableTokens} to ~${stats.remainingRemovableTokens} tokens ` +
      `(budget ~${stats.budget}). Latest user turn was preserved. ` +
      `Messages: ${stats.beforeMessages} -> ${stats.afterMessages}.`,
  }
}

function parseBudget(args: string):
  | {
      type: 'default'
      value: undefined
    }
  | {
      type: 'valid'
      value: number
    }
  | {
      type: 'invalid'
    } {
  const trimmed = args.trim()
  if (!trimmed) return { type: 'default', value: undefined }

  const [rawBudget] = trimmed.split(/\s+/)
  const value = Number(rawBudget)
  if (!Number.isInteger(value) || value < 0) return { type: 'invalid' }
  return { type: 'valid', value }
}

function forceSnipMessages(
  prev: Message[],
  requestedBudget: number | undefined,
): { messages: Message[]; stats: ForceSnipStats } {
  const exchanges = groupExchanges(prev)
  const removableExchanges = exchanges.slice(0, -1)
  const protectedExchange = exchanges.at(-1) ?? []
  const totalRemovableTokens = sumExchangeTokens(removableExchanges)
  const budget =
    requestedBudget ?? Math.max(0, Math.ceil(totalRemovableTokens * 0.5))

  if (removableExchanges.length === 0 || totalRemovableTokens <= budget) {
    return {
      messages: prev,
      stats: {
        budget,
        totalRemovableTokens,
        remainingRemovableTokens: totalRemovableTokens,
        removedMessages: 0,
        freedTokens: 0,
        beforeMessages: prev.length,
        afterMessages: prev.length,
      },
    }
  }

  const candidates: Message[] = []
  let remainingRemovableTokens = totalRemovableTokens

  for (const exchange of removableExchanges) {
    if (remainingRemovableTokens <= budget) break
    candidates.push(...exchange)
    remainingRemovableTokens -= sumMessageTokens(exchange)
  }

  const protectedUuids = new Set(
    protectedExchange.map(message => String(message.uuid)),
  )
  const closedRemovedMessages = closeToolPairs(candidates, prev).filter(
    message => !protectedUuids.has(String(message.uuid)),
  )
  const removedSet = new Set(
    closedRemovedMessages.map(message => String(message.uuid)),
  )

  if (removedSet.size === 0) {
    return {
      messages: prev,
      stats: {
        budget,
        totalRemovableTokens,
        remainingRemovableTokens: totalRemovableTokens,
        removedMessages: 0,
        freedTokens: 0,
        beforeMessages: prev.length,
        afterMessages: prev.length,
      },
    }
  }

  const freedTokens = sumMessageTokens(closedRemovedMessages)
  const nextMessages = [
    ...prev.filter(message => !removedSet.has(String(message.uuid))),
    makeBoundary(closedRemovedMessages, freedTokens),
  ]

  return {
    messages: nextMessages,
    stats: {
      budget,
      totalRemovableTokens,
      remainingRemovableTokens: Math.max(0, totalRemovableTokens - freedTokens),
      removedMessages: closedRemovedMessages.length,
      freedTokens,
      beforeMessages: prev.length,
      afterMessages: nextMessages.length,
    },
  }
}

function sumExchangeTokens(exchanges: Message[][]): number {
  let total = 0
  for (const exchange of exchanges) {
    total += sumMessageTokens(exchange)
  }
  return total
}

function sumMessageTokens(messages: Message[]): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message)
  }
  return total
}

function makeBoundary(
  removedMessages: Message[],
  removedTokens: number,
): Message {
  const removedUuids = removedMessages.map(message => String(message.uuid))
  const from = String(removedMessages[0]?.timestamp ?? '?')
  const to = String(removedMessages.at(-1)?.timestamp ?? '?')
  const summary = `Force-snipped ${removedUuids.length} messages (~${removedTokens} tokens) from ${from} to ${to}.`

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
    message: {
      role: 'system',
      content: summary,
    },
  } as Message
}

const forceSnip = {
  type: 'local',
  name: 'force-snip',
  description:
    'Deterministically snip older conversation history to free context space',
  argumentHint: '[remaining-token-budget]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  isHidden: false,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default forceSnip
