import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const INDEX = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
const READER = readFileSync(fileURLToPath(new URL('./connector-reader.ts', import.meta.url)), 'utf8')

/**
 * Leads from the code review, settled (B4).
 */
describe('the connector list', () => {
  /*
   * connector-reader asks for 20 s; the shared probe runner capped every
   * probe at 10 s. MEASURED 2026-09-24 on Colin's machine: `claude mcp list`
   * takes 15-17 s -- through the old runner it timed out with no connectors
   * read, so no connector allow rule was ever made.
   */
  it('is read through a runner whose ceiling is above what it asks for', () => {
    const asked = Number(/const TIMEOUT_MS = ([\d_]+)/.exec(READER)?.[1]?.replace(/_/g, ''))
    const ceiling = Number(/createNodeProbeRunner\(\{ maximumTimeoutMs: ([\d_]+) \}\)/.exec(INDEX)?.[1]?.replace(/_/g, ''))
    expect(asked).toBeGreaterThan(10_000)
    expect(ceiling).toBeGreaterThan(asked)
    expect(INDEX).toContain('await connectorProbeRunner.run({')
  })
})

describe('runtime discovery', () => {
  it('checks who is asking before it drops any cached answer', () => {
    const start = INDEX.indexOf('ipcMain.handle(RUNTIME_DISCOVERY_CHANNEL')
    const body = INDEX.slice(start, start + 4000)
    expect(body.indexOf('event.senderFrame.parent !== null')).toBeGreaterThan(0)
    expect(body.indexOf('event.senderFrame.parent !== null')).toBeLessThan(body.indexOf('discoveryCache = undefined'))
  })
})
