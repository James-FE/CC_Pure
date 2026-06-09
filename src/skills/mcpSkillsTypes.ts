export interface MCPSkillMetadata {
  name: string
  description: string
  allowed_tools: string[]
  category?: SkillCategory
  keywords?: string[]
  triggers?: SkillTrigger[]
  model?: ModelRequirement
  isolation?: 'worktree' | 'sandbox' | null
  cost_tier?: 'low' | 'medium' | 'high' | 'ultra'
  context_requirements?: ContextRequirement[]
  _source_server?: string
  _schema_version?: string
}

export type SkillCategory =
  | 'quality'
  | 'deployment'
  | 'security'
  | 'search'
  | 'productivity'
  | 'observability'

export interface SkillTrigger {
  type: 'branch-with-changes' | 'file-pattern' | 'git-conflict' | 'keyword'
  value?: string
}

export type ModelRequirement = 'opus' | 'sonnet' | 'haiku'

export interface ContextRequirement {
  type: 'git-repo' | 'uncommitted-changes' | 'remote-branch' | 'environment-var'
  value?: string
  description?: string
}

export interface MCPSkill extends MCPSkillMetadata {
  qualified_name: string
  resolved_tools: string[]
  validation: {
    is_valid: boolean
    errors: string[]
    warnings: string[]
  }
}
