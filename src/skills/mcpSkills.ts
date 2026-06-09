// MCP skills — fetches skills/commands exposed via MCP servers.
// Dynamically require'd by services/mcp/client.ts and useManageMCPConnections.ts
// when MCP_SKILLS feature is enabled.

import {
  type ListToolsResult,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { buildMcpToolName } from '../services/mcp/mcpStringUtils.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Command } from '../types/command.js'
import { errorMessage } from '../utils/errors.js'
import {
  FRONTMATTER_REGEX,
  parseFrontmatter,
} from '../utils/frontmatterParser.js'
import { logMCPError } from '../utils/log.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { recursivelySanitizeUnicode } from '../utils/sanitization.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'
import { adaptMcpToolsToSkills } from './mcpSkillAdapter.js'
import type {
  ContextRequirement,
  MCPSkill,
  MCPSkillMetadata,
  ModelRequirement,
  SkillCategory,
  SkillTrigger,
} from './mcpSkillsTypes.js'

const MCP_FETCH_CACHE_SIZE = 20

function hasSkillFrontmatter(description: unknown): description is string {
  return typeof description === 'string' && FRONTMATTER_REGEX.test(description)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0)
  }
  return []
}

function parseSkillCategory(value: unknown): SkillCategory | undefined {
  return value === 'quality' ||
    value === 'deployment' ||
    value === 'security' ||
    value === 'search' ||
    value === 'productivity' ||
    value === 'observability'
    ? value
    : undefined
}

function parseModelRequirement(value: unknown): ModelRequirement | undefined {
  return value === 'opus' || value === 'sonnet' || value === 'haiku'
    ? value
    : undefined
}

function parseIsolation(
  value: unknown,
): 'worktree' | 'sandbox' | null | undefined {
  if (value === null) return null
  return value === 'worktree' || value === 'sandbox' ? value : undefined
}

function parseCostTier(
  value: unknown,
): 'low' | 'medium' | 'high' | 'ultra' | undefined {
  return value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'ultra'
    ? value
    : undefined
}

function parseSkillTriggers(value: unknown): SkillTrigger[] | undefined {
  if (!Array.isArray(value)) return undefined

  const triggers = value.flatMap((item): SkillTrigger[] => {
    if (!isRecord(item)) return []

    const type = item.type
    if (
      type !== 'branch-with-changes' &&
      type !== 'file-pattern' &&
      type !== 'git-conflict' &&
      type !== 'keyword'
    ) {
      return []
    }

    return [
      {
        type,
        value: typeof item.value === 'string' ? item.value : undefined,
      },
    ]
  })

  return triggers.length > 0 ? triggers : undefined
}

function parseContextRequirements(
  value: unknown,
): ContextRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined

  const requirements = value.flatMap((item): ContextRequirement[] => {
    if (!isRecord(item)) return []

    const type = item.type
    if (
      type !== 'git-repo' &&
      type !== 'uncommitted-changes' &&
      type !== 'remote-branch' &&
      type !== 'environment-var'
    ) {
      return []
    }

    return [
      {
        type,
        value: typeof item.value === 'string' ? item.value : undefined,
        description:
          typeof item.description === 'string' ? item.description : undefined,
      },
    ]
  })

  return requirements.length > 0 ? requirements : undefined
}

function parseMcpSkillMetadata(
  frontmatter: Record<string, unknown>,
  serverName: string,
): { metadata: MCPSkillMetadata | null; errors: string[] } {
  const skill = frontmatter.skill
  if (!isRecord(skill)) {
    return {
      metadata: null,
      errors: ['Missing nested skill frontmatter object'],
    }
  }

  const errors: string[] = []
  const name = typeof skill.name === 'string' ? skill.name.trim() : ''
  const description =
    typeof skill.description === 'string' ? skill.description.trim() : ''
  const allowedTools = parseStringArray(skill.allowed_tools)

  if (!name) errors.push('skill.name must be a non-empty string')
  if (!description) errors.push('skill.description must be a non-empty string')
  if (allowedTools.length === 0) {
    errors.push('skill.allowed_tools must contain at least one tool')
  }

  if (errors.length > 0) {
    return { metadata: null, errors }
  }

  return {
    metadata: {
      name,
      description,
      allowed_tools: allowedTools,
      category: parseSkillCategory(skill.category),
      keywords: parseStringArray(skill.keywords),
      triggers: parseSkillTriggers(skill.triggers),
      model: parseModelRequirement(skill.model),
      isolation: parseIsolation(skill.isolation),
      cost_tier: parseCostTier(skill.cost_tier),
      context_requirements: parseContextRequirements(
        skill.context_requirements,
      ),
      _source_server: serverName,
      _schema_version:
        typeof skill._schema_version === 'string'
          ? skill._schema_version
          : undefined,
    },
    errors: [],
  }
}

function validateAllowedTools(
  metadata: MCPSkillMetadata,
  client: MCPServerConnection,
  availableToolNames: Set<string>,
  availableQualifiedToolNames: Set<string>,
): Pick<MCPSkill, 'resolved_tools' | 'validation'> {
  const warnings: string[] = []
  const resolvedTools: string[] = []

  for (const toolName of metadata.allowed_tools) {
    if (availableQualifiedToolNames.has(toolName)) {
      resolvedTools.push(toolName)
      continue
    }

    if (availableToolNames.has(toolName)) {
      resolvedTools.push(buildMcpToolName(client.name, toolName))
      continue
    }

    warnings.push(
      `Allowed tool '${toolName}' was not found on MCP server '${client.name}'`,
    )
  }

  return {
    resolved_tools: resolvedTools,
    validation: {
      is_valid: true,
      errors: [],
      warnings,
    },
  }
}

function buildWhenToUse(metadata: MCPSkillMetadata): string | undefined {
  const parts: string[] = []

  if (metadata.category) parts.push(`Category: ${metadata.category}`)
  if (metadata.keywords && metadata.keywords.length > 0) {
    parts.push(`Keywords: ${metadata.keywords.join(', ')}`)
  }
  if (metadata.triggers && metadata.triggers.length > 0) {
    parts.push(
      `Triggers: ${metadata.triggers
        .map(trigger =>
          trigger.value ? `${trigger.type}:${trigger.value}` : trigger.type,
        )
        .join(', ')}`,
    )
  }
  if (
    metadata.context_requirements &&
    metadata.context_requirements.length > 0
  ) {
    parts.push(
      `Context requirements: ${metadata.context_requirements
        .map(requirement =>
          requirement.value
            ? `${requirement.type}:${requirement.value}`
            : requirement.type,
        )
        .join(', ')}`,
    )
  }

  return parts.length > 0 ? parts.join('\n') : undefined
}

function metadataToCommandFrontmatter(
  metadata: MCPSkillMetadata,
  resolvedTools: string[],
): Record<string, unknown> {
  return {
    name: metadata.name,
    description: metadata.description,
    'allowed-tools': resolvedTools,
    model: metadata.model,
    when_to_use: buildWhenToUse(metadata),
    version: metadata._schema_version,
    'user-invocable': 'true',
  }
}

function getMcpSkillsCacheKey(client: MCPServerConnection): string {
  if (client.type !== 'connected') return client.name

  const serverName = client.serverInfo?.name ?? client.name
  const serverVersion = client.serverInfo?.version ?? 'unknown'
  const toolCapability = client.capabilities?.tools ? 'tools' : 'no-tools'

  return `${client.name}:${serverName}:${serverVersion}:${toolCapability}`
}

export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []
    if (!client.capabilities?.tools) return []

    try {
      const result = (await client.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema,
      )) as ListToolsResult

      const toolsToProcess = adaptMcpToolsToSkills(
        recursivelySanitizeUnicode(result.tools),
        { serverName: client.name },
      )
      const availableToolNames = new Set(toolsToProcess.map(tool => tool.name))
      const availableQualifiedToolNames = new Set(
        toolsToProcess.map(tool => buildMcpToolName(client.name, tool.name)),
      )
      const { createSkillCommand, parseSkillFrontmatterFields } =
        getMCPSkillBuilders()
      const commands: Command[] = []

      for (const tool of toolsToProcess) {
        if (!hasSkillFrontmatter(tool.description)) continue

        try {
          const { frontmatter, content: markdownContent } = parseFrontmatter(
            tool.description,
            `mcp:${client.name}:${tool.name}`,
          )

          const { metadata, errors } = parseMcpSkillMetadata(
            frontmatter,
            client.name,
          )
          if (!metadata) {
            throw new Error(errors.join('; '))
          }

          const qualifiedName = `${client.name}:${metadata.name}`
          const validation = validateAllowedTools(
            metadata,
            client,
            availableToolNames,
            availableQualifiedToolNames,
          )
          const mcpSkill: MCPSkill = {
            ...metadata,
            qualified_name: qualifiedName,
            ...validation,
          }

          for (const warning of mcpSkill.validation.warnings) {
            logMCPError(client.name, `MCP skill '${qualifiedName}': ${warning}`)
          }

          const skillName = buildMcpToolName(client.name, metadata.name)
          const parsed = parseSkillFrontmatterFields(
            metadataToCommandFrontmatter(metadata, mcpSkill.resolved_tools),
            markdownContent,
            skillName,
          )

          commands.push(
            createSkillCommand({
              ...parsed,
              displayName: `${qualifiedName} (MCP)`,
              skillName,
              markdownContent,
              source: 'mcp',
              baseDir: undefined,
              loadedFrom: 'mcp',
              paths: undefined,
            }),
          )
        } catch (error) {
          logMCPError(
            client.name,
            `Failed to parse MCP skill '${tool.name}': ${errorMessage(error)}`,
          )
        }
      }

      return commands
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch MCP skills: ${errorMessage(error)}`,
      )
      return []
    }
  },
  getMcpSkillsCacheKey,
  MCP_FETCH_CACHE_SIZE,
)
