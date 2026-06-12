import { getSessionBlackboard } from './BlackboardSession.js'
import { set } from './BlackboardStore.js'

const LIFECYCLE_WRITER = 'blackboard-lifecycle'

function writeWorkerKey(
  workerId: string,
  field: string,
  value: string,
  writer: string = LIFECYCLE_WRITER,
): void {
  try {
    set(getSessionBlackboard(), `worker:${workerId}:${field}`, value, writer)
  } catch {
    // Blackboard writes must not break agent lifecycle transitions.
  }
}

export function writeWorkerStatus(workerId: string, status: string): void {
  writeWorkerKey(workerId, 'status', status)
  writeWorkerKey(workerId, 'updated_at', new Date().toISOString())
}

export function writeWorkerTask(workerId: string, task: string): void {
  writeWorkerKey(workerId, 'task', task)
}

export function writeWorkerResult(workerId: string, result: string): void {
  writeWorkerKey(workerId, 'result', result)
}
