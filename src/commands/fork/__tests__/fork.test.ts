import { describe, expect, mock, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/AgentTool/constants.js'
import { FORK_BOILERPLATE_TAG } from '../../../constants/xml.js'
import type { Command } from '../../../commands.js'
import type { ToolUseContext } from '../../../Tool.js'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'FORK_SUBAGENT',
}))

mock.module('src/bootstrap/state.js', () => ({
  getIsNonInteractiveSession: () => false,
}))

mock.module('src/coordinator/coordinatorMode.js', () => ({
  isCoordinatorMode: () => false,
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => undefined,
}))

mock.module('src/utils/messages.js', () => ({
  createUserMessage: ({ content }: { content: unknown }) => ({
    type: 'user',
    message: { role: 'user', content },
  }),
}))

type PromptCommand = Extract<Command, { type: 'prompt' }>

const forkCommand = (await import('../index.js')).default as PromptCommand

function makeContext(
  messages: ToolUseContext['messages'] = [],
): ToolUseContext {
  return {
    messages,
  } as unknown as ToolUseContext
}

describe('/fork command', () => {
  test('rejects an empty directive with usage text', async () => {
    await expect(
      forkCommand.getPromptForCommand('   ', makeContext()),
    ).rejects.toThrow('Usage: /fork <directive>')
  })

  test('rejects use from inside a fork child', async () => {
    await expect(
      forkCommand.getPromptForCommand(
        'review auth',
        makeContext([
          {
            type: 'user',
            message: {
              content: [
                {
                  type: 'text',
                  text: `<${FORK_BOILERPLATE_TAG}>child</${FORK_BOILERPLATE_TAG}>`,
                },
              ],
            },
          },
        ] as ToolUseContext['messages']),
      ),
    ).rejects.toThrow('Fork is not available inside a forked worker')
  })

  test('returns a strict Agent tool fork prompt for the directive', async () => {
    const blocks = await forkCommand.getPromptForCommand(
      '  review authentication flow  ',
      makeContext(),
    )

    expect(forkCommand.name).toBe('fork')
    expect(forkCommand.type).toBe('prompt')
    expect(forkCommand.allowedTools).toEqual([AGENT_TOOL_NAME])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')

    const text = blocks[0]?.type === 'text' ? blocks[0].text : ''
    expect(text).toContain('You are creating a fork sub-agent.')
    expect(text).toContain(
      'FIRST, output a short confirmation: "Fork started: <brief description of the task>"',
    )
    expect(text).toContain('immediately use the Agent tool')
    expect(text).toContain('- description: "a 3-5 word summary of the task"')
    expect(text).toContain('- prompt: "review authentication flow"')
    expect(text).toContain('- fork: true')
    expect(text).toContain('- run_in_background: true')
    expect(text).toContain(
      'DO NOT include: subagent_type, model, isolation, or cwd',
    )
    expect(text).toContain('The directive is: review authentication flow')
  })
})
