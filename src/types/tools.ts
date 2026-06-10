import type { Message } from './message.js'

/**
 * Progress data for AgentTool execution.
 * Emitted by agent sub-agent tool invocations.
 */
export type AgentToolProgress = {
  type: 'agent_progress'
  /** The agent message (assistant or user turn from sub-agent) */
  message: Message
  /** The prompt/description of the agent task */
  prompt?: string
  /** Agent task identifier */
  agentId?: string
}

/**
 * Progress data for Bash tool execution.
 * Emitted periodically while a bash command is running.
 * Also used as ShellProgress for bash-mode UI.
 */
export type BashProgress = {
  type: 'bash_progress'
  /** Full accumulated output so far */
  fullOutput?: string
  /** Latest incremental output chunk */
  output?: string
  /** Elapsed time in seconds since command started */
  elapsedTimeSeconds?: number
  /** Number of output lines produced so far */
  totalLines?: number
  /** Number of output bytes produced so far */
  totalBytes?: number
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Background task identifier when running as a LocalShellTask */
  taskId?: string
}

/** Progress data for bash-mode UI. Covers both Bash and PowerShell progress. */
export type ShellProgress = BashProgress | PowerShellProgress

/**
 * Progress data for PowerShell tool execution.
 * Same fields as BashProgress, with a `powershell_progress` discriminant.
 */
export type PowerShellProgress = {
  type: 'powershell_progress'
  fullOutput?: string
  output?: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
  taskId?: string
}

/**
 * Progress data for MCP tool execution.
 * Matches the MCP progress notification shape emitted in client.ts.
 */
export type MCPProgress = {
  type: 'mcp_progress'
  /** Progress status */
  status: 'started' | 'completed' | 'failed' | 'progress'
  /** MCP server name */
  serverName: string
  /** MCP tool name */
  toolName: string
  /** Elapsed time in milliseconds */
  elapsedTimeMs?: number
  /** Current progress value (e.g., bytes transferred) */
  progress?: number
  /** Total expected value */
  total?: number
  /** Human-readable progress description */
  progressMessage?: string
}

/**
 * Progress data for REPL tool execution.
 * Fires while code executes in a persistent REPL session.
 */
export type REPLToolProgress = {
  type: 'repl_progress'
  /** REPL session identifier */
  sessionId?: string
  /** Incremental output chunk */
  output?: {
    /** Output stream */
    stream: 'stdout' | 'stderr'
    /** Output data */
    data: string
    /** Monotonic sequence number for ordering */
    sequence: number
  }
  /** Current execution state */
  state: 'executing' | 'awaiting_input' | 'completed' | 'error'
  /** Elapsed time in milliseconds */
  elapsedMs?: number
  /** The code being executed (on first event) */
  code?: string
}

/**
 * Progress data for Skill tool execution.
 * Relays progress from skill sub-agent invocations.
 * Same shape as AgentToolProgress with a different type discriminant.
 */
export type SkillToolProgress = {
  type: 'skill_progress'
  /** The skill execution message */
  message: Message
  /** Skill content/prompt */
  prompt?: string
  /** Skill agent identifier */
  agentId?: string
}

/**
 * Progress data for TaskOutput tool.
 * Emitted while waiting for a task to complete.
 */
export type TaskOutputProgress = {
  type: 'waiting_for_task'
  /** Description of the task being waited on */
  taskDescription: string
  /** Type of the task */
  taskType: string
}

/**
 * Progress data for WebSearch tool.
 * Fires incrementally as the search pipeline progresses.
 */
export type WebSearchProgress = {
  type: 'web_search_progress'
  /** The search query */
  query?: string
  /** Current pipeline stage */
  stage: 'searching' | 'fetching' | 'parsing' | 'completed'
  /** Search provider (e.g., 'google', 'bing') */
  provider?: string
  /** Total results found so far */
  resultsFound?: number
  /** Incremental results as they arrive */
  partialResults?: Array<{
    title: string
    url: string
    snippet?: string
  }>
  /** Elapsed time in milliseconds */
  elapsedMs?: number
}

/**
 * SDK workflow progress item — emitted in task_progress events.
 * Shape depends on the workflow engine producing the progress.
 */
export type SdkWorkflowProgress = Record<string, unknown>

/**
 * Union of all tool progress types — the canonical Progress type used by Tool.ts.
 */
export type ToolProgressData =
  | AgentToolProgress
  | BashProgress
  | MCPProgress
  | PowerShellProgress
  | REPLToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
