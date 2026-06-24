import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug'
import { logMock } from '../../../../tests/mocks/log'
import type { TeammateIdentity } from '../../../tasks/InProcessTeammateTask/types'
import { TEAM_LEAD_NAME } from '../constants'
import { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from '../teammatePromptAddendum'

mock.module('bun:bundle', () => ({
  feature: () => false,
}))
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

function makeIdentity(agentName: string): TeammateIdentity {
  return {
    agentId: `${agentName}@alpha`,
    agentName,
    teamName: 'alpha',
    color: 'cyan',
    planModeRequired: false,
    parentSessionId: 'parent-session',
  }
}

describe('inProcessRunner team lead context', () => {
  test('marks team-lead as the in-process team lead', async () => {
    const { createInProcessAgentContext } = await import('../inProcessRunner')

    const context = createInProcessAgentContext(makeIdentity(TEAM_LEAD_NAME))

    expect(context.agentType).toBe('teammate')
    if (context.agentType === 'teammate') {
      expect(context.isTeamLead).toBe(true)
    }
  })

  test('does not mark regular teammates as team lead', async () => {
    const { createInProcessAgentContext } = await import('../inProcessRunner')

    const context = createInProcessAgentContext(makeIdentity('researcher'))

    expect(context.agentType).toBe('teammate')
    if (context.agentType === 'teammate') {
      expect(context.isTeamLead).toBe(false)
    }
  })
})

describe('inProcessRunner teammate system prompt', () => {
  test('omits teammate addendum for the team lead', async () => {
    const { buildInProcessTeammateSystemPromptParts } = await import(
      '../inProcessRunner'
    )

    const parts = buildInProcessTeammateSystemPromptParts(['base prompt'], true)

    expect(parts.join('\n')).not.toContain(
      'The user interacts primarily with the team lead',
    )
  })

  test('includes teammate addendum for regular teammates', async () => {
    const { buildInProcessTeammateSystemPromptParts } = await import(
      '../inProcessRunner'
    )

    const parts = buildInProcessTeammateSystemPromptParts(
      ['base prompt'],
      false,
    )

    expect(parts).toContain(TEAMMATE_SYSTEM_PROMPT_ADDENDUM)
    expect(parts.join('\n')).toContain(
      'The user interacts primarily with the team lead',
    )
  })
})
