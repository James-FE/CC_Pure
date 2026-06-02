// Stub — UDS client for peer discovery. CC_Pure keeps core remote-control.
// Full UDS mesh is disabled; these stubs satisfy the typechecker.

export interface PeerInfo {
  peerId: string
  socketPath: string
}

/** List connected peers on the UDS mesh. */
export async function listPeers(): Promise<PeerInfo[]> {
  return []
}
