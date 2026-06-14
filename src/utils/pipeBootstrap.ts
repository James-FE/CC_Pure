/**
 * Pipe IPC bootstrap.
 *
 * Starts process-wide pipe infrastructure before the REPL renders. The React
 * hook can then attach handlers and heartbeat behavior to the already-running
 * server without owning server lifetime.
 */
import { feature } from 'bun:bundle'
import { hostname } from 'os'
import { getSessionId } from 'src/bootstrap/state.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import type { LanBeacon } from 'src/utils/lanBeacon.js'
import type { PipeRegistryEntry } from 'src/utils/pipeRegistry.js'
import type { PipeServer } from 'src/utils/pipeTransport.js'

type PipeBootstrapDeps = {
  getSessionId: typeof getSessionId
  registerCleanup: typeof registerCleanup
  createPipeServer: typeof import('src/utils/pipeTransport.js').createPipeServer
  getLocalIp: typeof import('src/utils/pipeTransport.js').getLocalIp
  getMachineId: typeof import('src/utils/pipeRegistry.js').getMachineId
  getMacAddress: typeof import('src/utils/pipeRegistry.js').getMacAddress
  determineRole: typeof import('src/utils/pipeRegistry.js').determineRole
  registerAsMain: typeof import('src/utils/pipeRegistry.js').registerAsMain
  registerAsSub: typeof import('src/utils/pipeRegistry.js').registerAsSub
  unregister: typeof import('src/utils/pipeRegistry.js').unregister
  hostname: typeof hostname
  createLanBeacon: (
    announce: ConstructorParameters<
      typeof import('src/utils/lanBeacon.js').LanBeacon
    >[0],
  ) => LanBeacon
  setLanBeacon: typeof import('src/utils/lanBeacon.js').setLanBeacon
}

export type PipeIpcBootstrap = {
  pipeName: string
  machineId: string
  mac: string
  localIp: string
  hostname: string
  initialRole: 'main' | 'sub'
  subIndex: number | null
  displayRole: string
  entry: PipeRegistryEntry
  server: PipeServer
  beacon: LanBeacon | null
  handlersAttached: boolean
  cleanup: () => Promise<void>
}

let bootstrapPromise: Promise<PipeIpcBootstrap | null> | null = null
let featureOverrideForTests: ((name: string) => boolean) | null = null
let depsOverrideForTests: PipeBootstrapDeps | null = null

export function __setPipeBootstrapFeatureOverrideForTests(
  override: ((name: string) => boolean) | null,
): void {
  featureOverrideForTests = override
}

export function __setPipeBootstrapDepsOverrideForTests(
  override: PipeBootstrapDeps | null,
): void {
  depsOverrideForTests = override
}

export function ensurePipeIpc(): Promise<PipeIpcBootstrap | null> {
  if (!udsInboxEnabled()) {
    return Promise.resolve(null)
  }

  const sessionId = getPipeBootstrapSessionId()
  if (!sessionId) {
    return Promise.resolve(null)
  }

  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapPipeIpc(sessionId).catch(() => {
      bootstrapPromise = null
      return null
    })
  }

  return bootstrapPromise
}

async function bootstrapPipeIpc(
  sessionId: string,
): Promise<PipeIpcBootstrap | null> {
  const deps = await getPipeBootstrapDeps()
  const pipeName = `cli-${sessionId.slice(0, 8)}`
  let server: PipeServer | null = null
  let beacon: LanBeacon | null = null
  let registered = false

  try {
    // --- Phase 1: Role determination ---
    const machineId = await deps.getMachineId()
    const mac = deps.getMacAddress()
    const localIp = deps.getLocalIp()
    const host = deps.hostname()
    const roleResult = await deps.determineRole(machineId)

    let entry: PipeRegistryEntry = {
      id: pipeName,
      pid: process.pid,
      machineId,
      startedAt: Date.now(),
      ip: localIp,
      mac,
      hostname: host,
      pipeName,
    }

    let initialRole: 'main' | 'sub' = 'main'
    let subIndex: number | null = null
    let displayRole = 'main'

    if (roleResult.role === 'main' || roleResult.role === 'main-recover') {
      await deps.registerAsMain(entry)
    } else {
      subIndex = roleResult.subIndex
      await deps.registerAsSub(entry, subIndex)
      initialRole = 'sub'
      displayRole = `sub-${subIndex}`
    }
    registered = true

    // --- Phase 2: Server creation ---
    server = await deps.createPipeServer(
      pipeName,
      lanPipesEnabled() ? { enableTcp: true, tcpPort: 0 } : undefined,
    )

    // --- Phase 3: LAN beacon ---
    if (lanPipesEnabled()) {
      if (server.tcpAddress) {
        beacon = deps.createLanBeacon({
          pipeName,
          machineId,
          hostname: host,
          ip: localIp,
          tcpPort: server.tcpAddress.port,
          role: initialRole,
        })
        beacon.start()
        deps.setLanBeacon(beacon)

        entry = {
          ...entry,
          tcpPort: server.tcpAddress.port,
          lanVisible: true,
        }
        if (initialRole === 'main') {
          await deps.registerAsMain(entry)
        } else if (subIndex != null) {
          await deps.registerAsSub(entry, subIndex)
        }
      }
    }

    let unregisterCleanup: (() => void) | null = null
    let cleaned = false
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      try {
        if (beacon) {
          beacon.stop()
          beacon = null
        }
        deps.setLanBeacon(null)
        await deps.unregister(pipeName)
        if (server) {
          await server.close()
          server = null
        }
      } finally {
        bootstrapPromise = null
        unregisterCleanup?.()
      }
    }
    unregisterCleanup = deps.registerCleanup(cleanup)

    return {
      pipeName,
      machineId,
      mac,
      localIp,
      hostname: host,
      initialRole,
      subIndex,
      displayRole,
      entry,
      server,
      beacon,
      handlersAttached: false,
      cleanup,
    }
  } catch {
    if (beacon) {
      beacon.stop()
      deps.setLanBeacon(null)
    }
    if (server) {
      await server.close().catch(() => {})
    }
    if (registered) {
      await deps.unregister(pipeName).catch(() => {})
    }
    throw new Error('Pipe IPC bootstrap failed')
  }
}

function getPipeBootstrapSessionId(): ReturnType<typeof getSessionId> {
  return depsOverrideForTests?.getSessionId() ?? getSessionId()
}

async function getPipeBootstrapDeps(): Promise<PipeBootstrapDeps> {
  if (depsOverrideForTests) {
    return depsOverrideForTests
  }

  const [pt, pr, lb] = await Promise.all([
    import('src/utils/pipeTransport.js'),
    import('src/utils/pipeRegistry.js'),
    import('src/utils/lanBeacon.js'),
  ])

  return {
    getSessionId,
    registerCleanup,
    createPipeServer: pt.createPipeServer,
    getLocalIp: pt.getLocalIp,
    getMachineId: pr.getMachineId,
    getMacAddress: pr.getMacAddress,
    determineRole: pr.determineRole,
    registerAsMain: pr.registerAsMain,
    registerAsSub: pr.registerAsSub,
    unregister: pr.unregister,
    hostname,
    createLanBeacon: announce => new lb.LanBeacon(announce),
    setLanBeacon: lb.setLanBeacon,
  }
}

function udsInboxEnabled(): boolean {
  if (featureOverrideForTests) {
    return featureOverrideForTests('UDS_INBOX')
  }
  if (feature('UDS_INBOX')) {
    return true
  }
  return false
}

function lanPipesEnabled(): boolean {
  if (featureOverrideForTests) {
    return featureOverrideForTests('LAN_PIPES')
  }
  if (feature('LAN_PIPES')) {
    return true
  }
  return false
}
