import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { SessionId } from '../../types/ids.js'
import type { LanBeacon } from '../lanBeacon.js'
import type { DetermineRoleResult, PipeRegistryEntry } from '../pipeRegistry.js'
import type { PipeServer, PipeServerOptions } from '../pipeTransport.js'

const enabledFeatures = new Set<string>()
const cleanupFns: Array<() => Promise<void>> = []
const serverInstances: Array<{
  close: ReturnType<typeof mock>
  onMessage: ReturnType<typeof mock>
  tcpAddress: { host: string; port: number } | null
}> = []
const beaconInstances: Array<{
  announce: ConstructorParameters<typeof LanBeacon>[0]
  start: ReturnType<typeof mock>
  stop: ReturnType<typeof mock>
}> = []

let roleResult: DetermineRoleResult = { role: 'main' }

const createPipeServerMock = mock(
  async (_name: string, options?: PipeServerOptions) => {
    const server = {
      close: mock(async () => {}),
      onMessage: mock(() => {}),
      tcpAddress: options?.enableTcp ? { host: '0.0.0.0', port: 4567 } : null,
    }
    serverInstances.push(server)
    return server as unknown as PipeServer
  },
)
const registerAsMainMock = mock(async (_entry: PipeRegistryEntry) => {})
const registerAsSubMock = mock(
  async (_entry: PipeRegistryEntry, _subIndex: number) => {},
)
const unregisterMock = mock(async (_pipeName: string) => {})
const setLanBeaconMock = mock((_beacon: LanBeacon | null) => {})
const registerCleanupMock = mock((cleanup: () => Promise<void>) => {
  cleanupFns.push(cleanup)
  return () => {
    const index = cleanupFns.indexOf(cleanup)
    if (index >= 0) cleanupFns.splice(index, 1)
  }
})

async function cleanupBootstrap(): Promise<void> {
  const cleanup = cleanupFns.shift()
  if (cleanup) {
    await cleanup()
  }
}

async function loadPipeBootstrap(): Promise<
  typeof import('../pipeBootstrap.js')
> {
  const mod = await import('../pipeBootstrap.js')
  mod.__setPipeBootstrapFeatureOverrideForTests((name: string) =>
    enabledFeatures.has(name),
  )
  mod.__setPipeBootstrapDepsOverrideForTests({
    getSessionId: () => 'abcdef1234567890' as SessionId,
    registerCleanup: registerCleanupMock,
    createPipeServer: createPipeServerMock,
    getLocalIp: () => '192.168.1.50',
    getMachineId: async () => 'machine-123',
    getMacAddress: () => 'aa:bb:cc:dd:ee:ff',
    determineRole: async () => roleResult,
    registerAsMain: registerAsMainMock,
    registerAsSub: registerAsSubMock,
    unregister: unregisterMock,
    hostname: () => 'test-host',
    createLanBeacon: announce => {
      const beacon = {
        announce,
        start: mock(() => {}),
        stop: mock(() => {}),
      }
      beaconInstances.push(beacon)
      return beacon as unknown as LanBeacon
    },
    setLanBeacon: setLanBeaconMock,
  })
  return mod
}

beforeEach(() => {
  enabledFeatures.clear()
  enabledFeatures.add('UDS_INBOX')
  cleanupFns.length = 0
  serverInstances.length = 0
  beaconInstances.length = 0
  roleResult = { role: 'main' }
  createPipeServerMock.mockClear()
  registerAsMainMock.mockClear()
  registerAsSubMock.mockClear()
  unregisterMock.mockClear()
  setLanBeaconMock.mockClear()
  registerCleanupMock.mockClear()
})

afterEach(async () => {
  await cleanupBootstrap()
  const mod = await import('../pipeBootstrap.js')
  mod.__setPipeBootstrapFeatureOverrideForTests(null)
  mod.__setPipeBootstrapDepsOverrideForTests(null)
})

describe('ensurePipeIpc', () => {
  test('coalesces concurrent calls into one pipe server and preserves LAN tcp entry', async () => {
    enabledFeatures.add('LAN_PIPES')
    const { ensurePipeIpc } = await loadPipeBootstrap()

    const [first, second] = await Promise.all([
      ensurePipeIpc(),
      ensurePipeIpc(),
    ])

    expect(first).toBe(second)
    expect(first?.pipeName).toBe('cli-abcdef12')
    expect(first?.initialRole).toBe('main')
    expect(first?.entry.tcpPort).toBe(4567)
    expect(first?.entry.lanVisible).toBe(true)
    expect(createPipeServerMock).toHaveBeenCalledTimes(1)
    expect(createPipeServerMock.mock.calls[0]?.[1]).toEqual({
      enableTcp: true,
      tcpPort: 0,
    })
    expect(registerAsMainMock).toHaveBeenCalledTimes(2)
    expect(beaconInstances).toHaveLength(1)
    expect(beaconInstances[0]?.start).toHaveBeenCalledTimes(1)
    expect(setLanBeaconMock).toHaveBeenCalledWith(beaconInstances[0])
  })

  test('cleanup resets the memoized bootstrap for the next caller', async () => {
    const { ensurePipeIpc } = await loadPipeBootstrap()

    const first = await ensurePipeIpc()
    await cleanupBootstrap()
    const second = await ensurePipeIpc()

    expect(second).not.toBe(first)
    expect(createPipeServerMock).toHaveBeenCalledTimes(2)
    expect(unregisterMock).toHaveBeenCalledWith('cli-abcdef12')
    expect(serverInstances[0]?.close).toHaveBeenCalledTimes(1)
  })

  test('returns null without creating a server when UDS_INBOX is disabled', async () => {
    enabledFeatures.delete('UDS_INBOX')
    const { ensurePipeIpc } = await loadPipeBootstrap()

    await expect(ensurePipeIpc()).resolves.toBeNull()

    expect(createPipeServerMock).not.toHaveBeenCalled()
    expect(registerCleanupMock).not.toHaveBeenCalled()
  })
})
