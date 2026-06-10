/**
 * UDS messaging utilities — Unix Domain Socket path management and server lifecycle.
 *
 * Each Claude Code instance creates a UDS socket for cross-session peer messaging.
 * Other instances discover peers by scanning for these sockets in a shared directory.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'

let activeSocketPath: string | null = null

/** Default UDS socket path for this process. */
export function getDefaultUdsSocketPath(): string {
  return join(tmpdir(), `claude-messaging-${process.pid}.sock`)
}

/** Get the currently active UDS messaging socket path, if any. */
export function getUdsMessagingSocketPath(): string | null {
  return activeSocketPath
}

/** Format a UDS path as a display address. */
export function formatUdsAddress(socketPath: string): string {
  return `uds:${socketPath}`
}

/**
 * Start the UDS messaging server on the given socket path.
 * Listens for incoming peer messages and logs them.
 */
export async function startUdsMessaging(
  socketPath: string,
  _options: { isExplicit: boolean },
): Promise<void> {
  // Clean up stale socket if present
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {
      // Ignore — socket may be in use by another process
    }
  }

  return new Promise<void>((resolve, reject) => {
    const server = createServer(socket => {
      socket.on('data', () => {
        // Incoming peer message — handled by the inbox poller
        // Raw data is consumed by useInboxPoller.ts which polls
        // the socket independently via its own file-descriptor watch.
      })
      socket.on('error', () => {
        // Peer disconnect — silently ignore
      })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      // Socket in use by another instance — that's fine, they're our peer
      if (err.code === 'EADDRINUSE') {
        activeSocketPath = socketPath
        resolve()
        return
      }
      reject(err)
    })

    server.listen(socketPath, () => {
      activeSocketPath = socketPath
      resolve()
    })
  })
}
