/**
 * UDS client — peer discovery and messaging over Unix Domain Sockets.
 *
 * Scans the temp directory for Claude Code messaging sockets and provides
 * functions to list live peers and send messages to them.
 */
import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createConnection } from 'node:net'

export interface PeerInfo {
  peerId: string
  socketPath: string
  messagingSocketPath?: string
  name?: string
  kind?: string
  cwd?: string
  pid?: number
  sessionId?: string
}

export interface LiveSession {
  kind: string
  sessionId: string
}

const SOCKET_PREFIX = 'claude-messaging-'
const SOCKET_SUFFIX = '.sock'

function extractPid(socketPath: string): number | null {
  const name = basename(socketPath)
  if (!name.startsWith(SOCKET_PREFIX) || !name.endsWith(SOCKET_SUFFIX))
    return null
  const pidStr = name.slice(SOCKET_PREFIX.length, -SOCKET_SUFFIX.length)
  const pid = parseInt(pidStr, 10)
  return isNaN(pid) ? null : pid
}

/** List connected peers by scanning for UDS sockets in tmpdir. */
export async function listPeers(): Promise<PeerInfo[]> {
  const peers: PeerInfo[] = []
  const ownPid = process.pid

  let entries: string[]
  try {
    entries = readdirSync(tmpdir())
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.startsWith(SOCKET_PREFIX) || !entry.endsWith(SOCKET_SUFFIX))
      continue
    const socketPath = join(tmpdir(), entry)
    const pid = extractPid(socketPath)
    if (pid === null || pid === ownPid) continue

    // Verify socket is live (file exists and is a socket)
    try {
      const stat = statSync(socketPath)
      if (!stat.isSocket()) continue
    } catch {
      continue
    }

    peers.push({
      peerId: `pid:${pid}`,
      socketPath,
      messagingSocketPath: socketPath,
      pid,
    })
  }

  return peers
}

/** Send a message to a UDS socket. */
export async function sendToUdsSocket(
  socketPath: string,
  message: unknown,
): Promise<void> {
  const payload =
    typeof message === 'string' ? message : JSON.stringify(message)

  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath)
    socket.on('connect', () => {
      socket.end(payload + '\n', () => resolve())
    })
    socket.on('error', reject)
    // Timeout after 5 seconds to avoid hanging on stale sockets
    socket.setTimeout(5000, () => {
      socket.destroy()
      reject(new Error(`sendToUdsSocket timeout: ${socketPath}`))
    })
  })
}

/** List all live sessions via UDS. */
export async function listAllLiveSessions(): Promise<LiveSession[]> {
  const peers = await listPeers()
  return peers.map(p => ({
    kind: 'uds',
    sessionId: p.peerId,
  }))
}
