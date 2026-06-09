import { describe, expect, test } from 'bun:test'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import {
  adaptMcpToolsToSkills,
  extractDomain,
  inferSkillCategory,
  normalizeDomain,
  stripMcpVerbPrefix,
} from '../mcpSkillAdapter.js'

function tool(name: string, description?: string) {
  return {
    name,
    description,
    inputSchema: { type: 'object' as const },
  }
}

describe('mcpSkillAdapter', () => {
  test('strips common MCP verb prefixes without stripping all tokens', () => {
    expect(stripMcpVerbPrefix(['search', 'issues'])).toEqual({
      actionTokens: ['search'],
      domainTokens: ['issues'],
    })
    expect(stripMcpVerbPrefix(['get'])).toEqual({
      actionTokens: ['get'],
      domainTokens: ['get'],
    })
  })

  test('normalizes plural domains to singular nouns', () => {
    expect(normalizeDomain('repositories')).toBe('repository')
    expect(normalizeDomain('branches')).toBe('branch')
    expect(normalizeDomain('issues')).toBe('issue')
    expect(normalizeDomain('statuses')).toBe('status')
    expect(normalizeDomain('class')).toBe('class')
    expect(normalizeDomain('css')).toBe('css')
    expect(normalizeDomain('data')).toBe('data')
  })

  test('extracts first meaningful domain token', () => {
    expect(extractDomain(['current', 'users'])).toBe('user')
    expect(extractDomain(['latest', 'repositories'])).toBe('repository')
    expect(extractDomain(['issues', 'comments'])).toBe('issue')
  })

  test('infers categories with security before generic search actions', () => {
    expect(
      inferSkillCategory({ actionTokens: ['list'], domain: 'secret' }),
    ).toBe('security')
    expect(
      inferSkillCategory({ actionTokens: ['search'], domain: 'issue' }),
    ).toBe('search')
    expect(inferSkillCategory({ actionTokens: ['run'], domain: 'test' })).toBe(
      'quality',
    )
  })

  test('generates skill frontmatter for ordinary MCP tools', () => {
    const [adapted] = adaptMcpToolsToSkills(
      [tool('search_issues', 'Search issues in a tracker.')],
      { serverName: 'github' },
    )

    const { frontmatter, content } = parseFrontmatter(adapted.description)
    expect(frontmatter).toEqual({
      skill: {
        name: 'issue-search',
        description: 'Search issues in a tracker.',
        allowed_tools: ['mcp__github__search_issues'],
        category: 'search',
        keywords: expect.arrayContaining(['issue', 'search', 'github']),
        _schema_version: 'mcp-skill-adapter-v1',
      },
    })
    expect(content).toContain('Use this skill when you need to search issue')
    expect(content).toContain('Search issues in a tracker.')
  })

  test('generates use action for names without a verb prefix', () => {
    const [adapted] = adaptMcpToolsToSkills([tool('issue_comment')], {
      serverName: 'github',
    })

    const { frontmatter } = parseFrontmatter(adapted.description)
    expect(frontmatter).toMatchObject({
      skill: {
        name: 'issue-use',
        allowed_tools: ['mcp__github__issue_comment'],
      },
    })
  })

  test('generates use action for domain-only tool names', () => {
    const [adapted] = adaptMcpToolsToSkills([tool('issues')], {
      serverName: 'github',
    })

    const { frontmatter } = parseFrontmatter(adapted.description)
    expect(frontmatter).toMatchObject({
      skill: {
        name: 'issue-use',
        allowed_tools: ['mcp__github__issues'],
      },
    })
  })

  test('preserves tools that already have frontmatter', () => {
    const existingDescription = [
      '---',
      'skill:',
      '  name: "custom"',
      '  description: "Custom skill."',
      '  allowed_tools:',
      '    - "custom_tool"',
      '---',
      'Body',
    ].join('\n')
    const original = tool('custom_tool', existingDescription)

    const [adapted] = adaptMcpToolsToSkills([original], {
      serverName: 'custom',
    })

    expect(adapted).toBe(original)
    expect(adapted.description).toBe(existingDescription)
  })

  test('is idempotent for generated descriptions', () => {
    const once = adaptMcpToolsToSkills([tool('issues')], {
      serverName: 'github',
    })
    const twice = adaptMcpToolsToSkills(once, { serverName: 'github' })

    expect(twice[0].description).toBe(once[0].description)
  })
})
