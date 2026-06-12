import type { Database } from 'bun:sqlite'
import { join } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import { getParentSessionId } from 'src/utils/teammate.js'
import { close, open } from './BlackboardStore.js'

let sessionDb: Database | null = null
let sessionDbPath: string | null = null

export function getBlackboardPath(
  sessionId: string = getParentSessionId() ?? getSessionId(),
): string {
  return join(getClaudeConfigHomeDir(), 'sessions', sessionId, 'blackboard.db')
}

export function openSessionBlackboard(
  sessionId: string = getParentSessionId() ?? getSessionId(),
): Database {
  return open(getBlackboardPath(sessionId))
}

export function initializeSessionBlackboard(
  sessionId: string = getParentSessionId() ?? getSessionId(),
): Database {
  const path = getBlackboardPath(sessionId)
  if (sessionDb && sessionDbPath === path) return sessionDb

  if (sessionDb) {
    close(sessionDb)
  }

  sessionDb = open(path)
  sessionDbPath = path
  return sessionDb
}

export function getSessionBlackboard(): Database {
  return initializeSessionBlackboard()
}

export function closeSessionBlackboard(): void {
  if (!sessionDb) return

  close(sessionDb)
  sessionDb = null
  sessionDbPath = null
}
