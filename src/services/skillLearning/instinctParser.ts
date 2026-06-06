export interface StoredInstinct {
  key: string
  prompt: string
  count: number
}

export function createInstinct(
  prompt: string,
  _options?: { sessionId?: string; projectId?: string },
): StoredInstinct {
  return {
    key: `instinct-${Buffer.from(prompt).toString('base64').slice(0, 32)}`,
    prompt,
    count: 0,
  }
}
