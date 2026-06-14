import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

describe('print no-split bundle safety', () => {
  test('does not synchronously require UDS messaging before starting stdin producer', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'print.ts'), 'utf8')

    expect(source).not.toContain("require('../utils/udsMessaging.js')")
  })
})
