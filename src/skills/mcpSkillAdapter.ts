import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js'
import { buildMcpToolName } from '../services/mcp/mcpStringUtils.js'
import { FRONTMATTER_REGEX } from '../utils/frontmatterParser.js'
import type { SkillCategory } from './mcpSkillsTypes.js'

export interface McpSkillAdapterOptions {
  serverName: string
  schemaVersion?: string
  defaultCategory?: SkillCategory
  prefixWords?: readonly string[]
  domainCategoryMap?: Readonly<Record<string, SkillCategory>>
}

const DEFAULT_SCHEMA_VERSION = 'mcp-skill-adapter-v1'

const DEFAULT_PREFIX_WORDS = [
  'add',
  'append',
  'call',
  'check',
  'create',
  'delete',
  'execute',
  'fetch',
  'find',
  'get',
  'insert',
  'list',
  'load',
  'make',
  'open',
  'post',
  'publish',
  'put',
  'query',
  'read',
  'remove',
  'run',
  'search',
  'set',
  'sync',
  'trigger',
  'update',
  'upsert',
  'write',
] as const

const WEAK_DOMAIN_MODIFIERS = new Set([
  'all',
  'by',
  'current',
  'latest',
  'my',
  'new',
  'next',
  'recent',
  'single',
])

const IRREGULAR_SINGULARS: Readonly<Record<string, string>> = {
  analyses: 'analysis',
  children: 'child',
  criteria: 'criterion',
  data: 'data',
  indices: 'index',
  people: 'person',
  statuses: 'status',
}

const QUALITY_TERMS = new Set([
  'test',
  'tests',
  'lint',
  'check',
  'review',
  'validate',
  'validation',
  'diagnostic',
  'diagnostics',
  'quality',
  'coverage',
  'typecheck',
])

const DEPLOYMENT_TERMS = new Set([
  'deploy',
  'deployment',
  'release',
  'publish',
  'package',
  'build',
  'environment',
  'runner',
  'job',
  'workflow',
  'pipeline',
])

const SECURITY_TERMS = new Set([
  'auth',
  'authentication',
  'authorization',
  'token',
  'secret',
  'key',
  'permission',
  'policy',
  'security',
  'vulnerability',
  'scan',
  'user',
  'role',
])

const SEARCH_ACTION_TERMS = new Set([
  'search',
  'find',
  'query',
  'list',
  'get',
  'fetch',
])

const SEARCH_DOMAIN_TERMS = new Set([
  'search',
  'file',
  'document',
  'doc',
  'issue',
  'ticket',
  'repository',
  'repo',
])

const OBSERVABILITY_TERMS = new Set([
  'log',
  'logs',
  'metric',
  'metrics',
  'trace',
  'traces',
  'span',
  'event',
  'alert',
  'monitor',
  'monitoring',
  'dashboard',
])

function tokenizeToolName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(token => token.toLowerCase())
    .filter(Boolean)
}

export function stripMcpVerbPrefix(
  tokens: readonly string[],
  prefixWords: readonly string[] = DEFAULT_PREFIX_WORDS,
): { actionTokens: string[]; domainTokens: string[] } {
  const prefixSet = new Set(prefixWords)
  const actionTokens: string[] = []
  let index = 0

  while (index < tokens.length && prefixSet.has(tokens[index])) {
    actionTokens.push(tokens[index])
    index += 1
  }

  const remaining = tokens.slice(index)
  if (remaining.length === 0) {
    return {
      actionTokens: actionTokens.length > 0 ? actionTokens : ['use'],
      domainTokens: [...tokens],
    }
  }

  return {
    actionTokens: actionTokens.length > 0 ? actionTokens : ['use'],
    domainTokens: remaining,
  }
}

export function extractDomain(tokens: readonly string[]): string {
  const meaningful = tokens.find(token => !WEAK_DOMAIN_MODIFIERS.has(token))
  return normalizeDomain(meaningful ?? tokens[0] ?? 'tool')
}

export function normalizeDomain(domain: string): string {
  const irregular = IRREGULAR_SINGULARS[domain]
  if (irregular) return irregular
  if (domain.length > 4 && domain.endsWith('ies'))
    return `${domain.slice(0, -3)}y`
  if (/(ses|xes|zes|ches|shes)$/.test(domain)) return domain.slice(0, -2)
  if (domain.length > 3 && domain.endsWith('s') && !domain.endsWith('ss')) {
    return domain.slice(0, -1)
  }
  return domain
}

export function inferSkillCategory(input: {
  actionTokens: readonly string[]
  domain: string
  domainCategoryMap?: Readonly<Record<string, SkillCategory>>
  defaultCategory?: SkillCategory
}): SkillCategory {
  const mappedCategory = input.domainCategoryMap?.[input.domain]
  if (mappedCategory) return mappedCategory

  const actionOrDomainTerms = [...input.actionTokens, input.domain]
  if (actionOrDomainTerms.some(term => SECURITY_TERMS.has(term)))
    return 'security'
  if (actionOrDomainTerms.some(term => DEPLOYMENT_TERMS.has(term)))
    return 'deployment'
  if (actionOrDomainTerms.some(term => OBSERVABILITY_TERMS.has(term)))
    return 'observability'
  if (actionOrDomainTerms.some(term => QUALITY_TERMS.has(term)))
    return 'quality'
  if (
    input.actionTokens.some(token => SEARCH_ACTION_TERMS.has(token)) ||
    SEARCH_DOMAIN_TERMS.has(input.domain)
  ) {
    return 'search'
  }

  return input.defaultCategory ?? 'productivity'
}

export function adaptMcpToolsToSkills<T extends MCPTool>(
  tools: readonly T[],
  options: McpSkillAdapterOptions,
): T[] {
  return tools.map(tool => {
    if (hasSkillFrontmatter(tool.description)) return tool

    const description = buildSkillDescription(tool, options)
    return { ...tool, description } as T
  })
}

function hasSkillFrontmatter(description: unknown): description is string {
  return typeof description === 'string' && FRONTMATTER_REGEX.test(description)
}

function buildSkillDescription(
  tool: MCPTool,
  options: McpSkillAdapterOptions,
): string {
  const tokens = tokenizeToolName(tool.name)
  const { actionTokens, domainTokens } = stripMcpVerbPrefix(
    tokens,
    options.prefixWords,
  )
  const domain = extractDomain(domainTokens)
  const category = inferSkillCategory({
    actionTokens,
    domain,
    domainCategoryMap: options.domainCategoryMap,
    defaultCategory: options.defaultCategory,
  })
  const skillName = buildGeneratedSkillName(domain, actionTokens)
  const actionPhrase = actionTokens.join(' ')
  const originalDescription = normalizeDescription(tool.description)
  const description =
    firstSentence(originalDescription) ??
    generatedDescription(actionPhrase, domain, tool.name)
  const qualifiedToolName = buildMcpToolName(options.serverName, tool.name)
  const keywords = buildKeywords({
    domain,
    actionTokens,
    toolNameTokens: tokens,
    serverNameTokens: tokenizeToolName(options.serverName),
  })

  return [
    '---',
    'skill:',
    `  name: ${quoteYamlString(skillName)}`,
    `  description: ${quoteYamlString(description)}`,
    '  allowed_tools:',
    `    - ${quoteYamlString(qualifiedToolName)}`,
    `  category: ${quoteYamlString(category)}`,
    '  keywords:',
    ...keywords.map(keyword => `    - ${quoteYamlString(keyword)}`),
    `  _schema_version: ${quoteYamlString(options.schemaVersion ?? DEFAULT_SCHEMA_VERSION)}`,
    '---',
    '',
    `Use this skill when you need to ${actionPhrase} ${domain} through the MCP server.`,
    '',
    originalDescription,
  ]
    .filter(
      (line, index, lines) => line.length > 0 || lines[index + 1]?.length !== 0,
    )
    .join('\n')
}

function normalizeDescription(description: unknown): string {
  return typeof description === 'string'
    ? description.replace(/\r?\n/g, ' ').trim()
    : ''
}

function firstSentence(description: string): string | undefined {
  if (!description) return undefined
  const match = description.match(/^.*?[.!?](?:\s|$)/)
  return (match?.[0] ?? description).trim()
}

function generatedDescription(
  actionPhrase: string,
  domain: string,
  toolName: string,
): string {
  const capitalizedAction =
    actionPhrase.charAt(0).toUpperCase() + actionPhrase.slice(1)
  return `${capitalizedAction} ${domain} via MCP tool ${toolName}.`
}

function buildGeneratedSkillName(
  domain: string,
  actionTokens: readonly string[],
): string {
  const action = actionTokens[0] ?? 'use'
  return `${domain}-${action}`.replace(/[^a-z0-9_-]+/g, '-')
}

function buildKeywords(input: {
  domain: string
  actionTokens: readonly string[]
  toolNameTokens: readonly string[]
  serverNameTokens: readonly string[]
}): string[] {
  const keywords: string[] = []

  for (const token of [
    input.domain,
    ...input.actionTokens,
    ...input.toolNameTokens.map(normalizeDomain),
    ...input.serverNameTokens,
  ]) {
    if (token.length < 2 || keywords.includes(token)) continue
    keywords.push(token)
    if (keywords.length === 8) break
  }

  return keywords
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' ').trim())
}
