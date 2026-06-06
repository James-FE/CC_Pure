import type { SkillGapRecord } from './skillGapStore.js'

export async function generateSkillDraft(
  _gap: SkillGapRecord,
): Promise<{ name: string; skillPath: string } | null> {
  return null
}

export async function writeLearnedSkill(_skillPath: string): Promise<void> {
  // stub
}
