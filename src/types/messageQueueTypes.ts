/**
 * Message queue type definitions for session event queueing.
 *
 * Every queue mutation (enqueue/dequeue/remove/popAll) is logged as a
 * QueueOperationMessage in the session transcript. This lets post-hoc
 * analysis reconstruct queue state at any point — critical for debugging
 * priority inversion, starvation, and between-turn drain behavior.
 */

/**
 * Type of queue operation performed.
 */
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll'

/**
 * Message representing an operation in the session event queue.
 * Persisted to the session transcript via recordQueueOperation().
 */
export type QueueOperationMessage = {
  type: 'queue-operation'
  /** The operation performed on the queue */
  operation: QueueOperation
  /** ISO-8601 timestamp of the operation */
  timestamp: string
  /** Session identifier for scoping */
  sessionId: string
  /** Optional command content for enqueue/popAll operations */
  content?: string
}
