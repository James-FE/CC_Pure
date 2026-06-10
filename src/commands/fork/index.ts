import type { BetaContentBlockParam as ContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js'
import { AGENT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/AgentTool/constants.js'
import type { Command } from '../../commands.js'
import {
  isForkSubagentEnabled,
  isInForkChild,
} from '../../../packages/builtin-tools/src/tools/AgentTool/forkSubagent.js'

type ForkPromptBlock = Extract<ContentBlockParam, { type: 'text' }>

function buildForkPrompt(directive: string): string {
  return `You are creating a fork sub-agent. Follow these rules EXACTLY:

1. FIRST, output a short confirmation: "Fork started: <brief description of the task>"

2. THEN, immediately use the Agent tool with these EXACT parameters:
   - description: "a 3-5 word summary of the task"
   - prompt: "${directive}"
   - fork: true
   - run_in_background: true

3. DO NOT include: subagent_type, model, isolation, or cwd

4. When you receive the tool result, do NOT expand on it. The fork runs independently
   and you will receive a task notification when it completes.

5. Turn ends after the Agent tool call — do not continue generating.

The directive is: ${directive}`
}

const forkCommand: Command = {
  type: 'prompt',
  name: 'fork',
  description: 'Start a forked worker',
  argumentHint: '<directive>',
  progressMessage: 'starting fork',
  contentLength: 0,
  allowedTools: [AGENT_TOOL_NAME],
  source: 'builtin',
  isEnabled: isForkSubagentEnabled,
  async getPromptForCommand(args, context) {
    const directive = args.trim()
    if (!directive) {
      throw new Error('Usage: /fork <directive>')
    }

    if (isInForkChild(context.messages)) {
      throw new Error('Fork is not available inside a forked worker')
    }

    const block = {
      type: 'text' as const,
      text: buildForkPrompt(directive),
    } satisfies ForkPromptBlock

    return [block]
  },
}

export default forkCommand
