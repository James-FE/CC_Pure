import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

describe('launchRepl', () => {
  test('does not bootstrap pipe IPC during REPL launch', () => {
    const source = readFileSync(
      new URL('../replLauncher.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('ensurePipeIpc')
    expect(source).not.toContain("import('./utils/pipeBootstrap.js')")
  })

  test('does not mount the pipe subsystem for UDS_INBOX alone', () => {
    const source = readFileSync(
      new URL('../screens/REPL.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain("if (!feature('UDS_INBOX')) return;")
    expect(source).toContain("feature('LAN_PIPES')")
    expect(source).toContain('enablePipeSubsystem = false')
    expect(source).toContain('if (!enablePipeSubsystem) return;')
  })
})
