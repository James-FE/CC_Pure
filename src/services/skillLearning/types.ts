export type InstinctDomain = string
export type SkillGapStatus = 'pending' | 'draft' | 'active' | 'closed'
export interface SkillLearningProjectContext {
  cwd: string
  projectId: string
  projectName: string
}
