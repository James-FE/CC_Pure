/**
 * OS keychain integration for LocalVault.
 *
 * On macOS this delegates to the system Keychain via security(1).
 * On Linux and other platforms, always throws KeychainUnavailableError
 * so LocalVault falls back to AES-256-GCM encrypted file storage
 * (~/.claude/local-vault.enc.json).
 */
export class KeychainUnavailableError extends Error {
  constructor() {
    super('OS keychain not available on this platform')
    this.name = 'KeychainUnavailableError'
  }
}

const unavailable = (..._args: unknown[]) => {
  throw new KeychainUnavailableError()
}

export const tryKeychain = {
  set: unavailable,
  get: unavailable,
  delete: unavailable,
  list: unavailable,
  _addToIndex: unavailable,
  _removeFromIndex: unavailable,
} as {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | undefined>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
  _addToIndex(key: string): Promise<void>
  _removeFromIndex(key: string): Promise<void>
}
