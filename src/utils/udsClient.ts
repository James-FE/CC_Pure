/**
 * UDS client — peer discovery and messaging over Unix Domain Sockets.
 *
 * Scans the temp directory for Claude Code messaging sockets and provides
 * functions to list live peers and send messages to them.
 *
 * Socket naming: claude-messaging-{hostname}-{pid}.sock
 */
import { readdirSync, statSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
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

/**
 * Extract PID from a socket filename.
 * Format: claude-messaging-{hostname}-{pid}.sock
 * The hostname segment can contain hyphens, so we take the last
 * dash-separated token before the .sock suffix as the PID.
 */
function extractPid(socketPath: string): number | null {
  const name = basename(socketPath)
  if (!name.startsWith(SOCKET_PREFIX) || !name.endsWith(SOCKET_SUFFIX)) {
    return null
  }
  const inner = name.slice(SOCKET_PREFIX.length, -SOCKET_SUFFIX.length)
  // PID is the last dash-separated segment (hostname may contain dashes)
  const lastDash = inner.lastIndexOf('-')
  if (lastDash === -1) return null
  const pidStr = inner.slice(lastDash + 1)
  const pid = parseInt(pidStr, 10)
  return isNaN(pid) ? null : pid
}

/** List connected peers by scanning for UDS sockets in tmpdir. */
export async function listPeers(): Promise<PeerInfo[]> {
  const peers: PeerInfo[] = []
  const ownPid = process.pid
  const ownHostname = hostname()
  const ownUid = process.getuid?.() ?? -1

  let entries: string[]
  try {
    entries = readdirSync(tmpdir())
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.startsWith(SOCKET_PREFIX) || !entry.endsWith(SOCKET_SUFFIX)) {
      continue
    }
    const socketPath = join(tmpdir(), entry)
    const pid = extractPid(socketPath)
    if (pid === null) continue

    // Skip self: same hostname AND same pid
    if (
      pid === ownPid &&
      entry.startsWith(`claude-messaging-${ownHostname}-`)
    ) {
      continue
    }

    // Verify socket is live and owned by the same user
    try {
      const stat = statSync(socketPath)
      if (!stat.isSocket()) continue
      // Ownership check: only trust sockets owned by the same uid
      if (ownUid !== -1 && stat.uid !== ownUid) continue
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
