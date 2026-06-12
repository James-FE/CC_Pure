import { z } from 'zod/v4'
import {
  getSessionBlackboard,
} from 'src/blackboard/BlackboardSession.js'
import type { BlackboardEntry } from 'src/blackboard/BlackboardTypes.js'
import { get, getByPrefix, set } from 'src/blackboard/BlackboardStore.js'
import { buildTool, type ToolResultBlockParam } from 'src/Tool.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getAgentId } from 'src/utils/teammate.js'
import { BLACKBOARD_WORKER_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['read', 'write', 'heartbeat'])
      .describe('Blackboard operation to perform.'),
    key: z
      .string()
      .optional()
      .describe('Exact blackboard key for read/write operations.'),
    prefix: z
      .string()
      .optional()
      .describe('Prefix to scan when action is read and key is omitted.'),
    value: z
      .string()
      .optional()
      .describe('String value to write when action is write.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const entrySchema = z.strictObject({
  key: z.string(),
  value: z.string(),
  version: z.number(),
  updatedAt: z.string(),
  updatedBy: z.string(),
})

const outputSchema = lazySchema(() =>
  z.strictObject({
    success: z.boolean(),
    action: z.enum(['read', 'write', 'heartbeat']),
    entry: entrySchema.nullable().optional(),
    entries: z.array(entrySchema).optional(),
    key: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function resolveWorkerId(contextAgentId?: string): string | null {
  const asyncContext = getAgentContext()
  return contextAgentId ?? asyncContext?.agentId ?? getAgentId() ?? null
}

function getWorkerPrefix(workerId: string): string {
  return `worker:${workerId}:`
}

function assertCanWriteWorkerKey(key: string, workerId: string): void {
  const prefix = getWorkerPrefix(workerId)
  if (key.startsWith(prefix)) return

  throw new Error(`Workers can only write keys under ${prefix}`)
}

export const BlackboardTool = buildTool({
  name: BLACKBOARD_WORKER_TOOL_NAME,
  searchHint: 'read write shared blackboard worker state heartbeat',
  maxResultSizeChars: 100_000,
  strict: true,
  shouldDefer: true,

  async description() {
    return 'Read or write shared agent blackboard state'
  },

  async prompt() {
    return `Use the blackboard to share structured worker and team state with other agents.

Actions:
- read: provide key for one entry, or prefix for a scan
- write: provide key and value; workers may only write worker:{id}:* keys for their own id
- heartbeat: updates worker:{id}:heartbeat for the current worker`
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly(input) {
    return input.action === 'read'
  },

  async validateInput(input) {
    if (input.action === 'read' && !input.key && !input.prefix) {
      return {
        result: false,
        message: 'Blackboard read requires key or prefix',
        errorCode: 9,
      }
    }
    if (input.action === 'write' && (!input.key || input.value === undefined)) {
      return {
        result: false,
        message: 'Blackboard write requires key and value',
        errorCode: 9,
      }
    }
    return { result: true }
  },

  renderToolUseMessage(input: Partial<Input>) {
    if (input.action === 'read') {
      return `Blackboard read ${input.key ?? input.prefix ?? ''}`.trim()
    }
    if (input.action === 'heartbeat') return 'Blackboard heartbeat'
    return `Blackboard write ${input.key ?? ''}`.trim()
  },

  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },

  async call(input, context) {
    const db = getSessionBlackboard()

    if (input.action === 'read') {
      if (input.key) {
        return {
          data: {
            success: true,
            action: input.action,
            entry: get(db, input.key),
          },
        }
      }

      return {
        data: {
          success: true,
          action: input.action,
          entries: getByPrefix(db, input.prefix ?? ''),
        },
      }
    }

    const workerId = resolveWorkerId(
      context.agentId ? String(context.agentId) : undefined,
    )
    if (!workerId) {
      throw new Error('Blackboard writes require a worker agent id')
    }

    const key =
      input.action === 'heartbeat'
        ? `${getWorkerPrefix(workerId)}heartbeat`
        : input.key
    if (!key) {
      throw new Error('Blackboard write requires key')
    }
    assertCanWriteWorkerKey(key, workerId)

    const value =
      input.action === 'heartbeat' ? new Date().toISOString() : input.value
    if (value === undefined) {
      throw new Error('Blackboard write requires value')
    }

    set(db, key, value, workerId)
    const entry: BlackboardEntry | null = get(db, key)

    return {
      data: {
        success: true,
        action: input.action,
        key,
        entry,
      },
    }
  },
})
