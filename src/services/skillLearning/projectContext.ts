import { join } from 'node:path'

export function getProjectStorageDir(cwd: string): string {
  return join(cwd, '.claude')
}

export function resolveProjectContext(
  cwd: string,
): { projectId: string; projectName: string } | null {
  return {
    projectId: cwd.replace(/[^a-zA-Z0-9]/g, '_'),
    projectName: cwd.split('/').pop() ?? 'unknown',
  }
}
