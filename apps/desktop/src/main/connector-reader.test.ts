import { describe, expect, it } from 'vitest'

import { createConnectorReader } from './connector-reader.js'

/**
 * The connector list is read in the background and a run never waits for it.
 *
 * `claude mcp list` health-checks every server, which took seconds when it
 * was measured. A mission that stopped for that would be a worse defect than
 * the one this fixes.
 */

const OUTPUT = [
  'Checking MCP server health…',
  '',
  'claude.ai Robinhood: https://agent.robinhood.com/mcp/trading - ✔ Connected',
  'claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication'
].join('\n')

describe('the connectors this machine has', () => {
  it('are empty until the first reading, rather than blocking for one', () => {
    const reader = createConnectorReader({ read: async () => OUTPUT })
    // Read synchronously, before the promise has had a chance to settle.
    expect(reader.names()).toEqual([])
    expect(reader.current()).toEqual([])
  })

  it('are there once a reading lands', async () => {
    const reader = createConnectorReader({ read: async () => OUTPUT })
    await reader.refresh()
    expect(reader.names()).toEqual(['claude.ai Robinhood'])
    // Present in the full reading, absent from the rules: a server the person
    // has not finished signing into has no tools to allow.
    expect(reader.current().map((entry) => entry.status)).toEqual(['connected', 'needs-auth'])
  })

  it('are read once and held, not re-read on every start', async () => {
    let reads = 0
    let clock = 1_000
    const reader = createConnectorReader({
      read: async () => {
        reads += 1
        return OUTPUT
      },
      now: () => clock,
      ttlMs: 60_000
    })
    await reader.refresh()
    await reader.refresh()
    await reader.refresh()
    expect(reads).toBe(1)
    clock += 60_001
    await reader.refresh()
    expect(reads).toBe(2)
  })

  it('keep the last good reading when a read fails or cannot run', async () => {
    let answer: (() => Promise<string | undefined>) = async () => OUTPUT
    let clock = 1_000
    const reader = createConnectorReader({ read: () => answer(), now: () => clock, ttlMs: 10 })
    await reader.refresh()
    expect(reader.names()).toEqual(['claude.ai Robinhood'])

    // Claude Code busy, or gone for a moment. Emptying the list here would
    // take everyone's connectors away mid-session for no reason.
    clock += 1_000
    answer = async () => undefined
    await reader.refresh()
    expect(reader.names()).toEqual(['claude.ai Robinhood'])

    clock += 1_000
    answer = () => Promise.reject(new Error('spawn failed'))
    await reader.refresh()
    expect(reader.names()).toEqual(['claude.ai Robinhood'])
  })

  it('take one reading at a time, however many runs start at once', async () => {
    let reads = 0
    let release = (): void => undefined
    const reader = createConnectorReader({
      read: () => {
        reads += 1
        return new Promise<string>((resolve) => {
          release = () => resolve(OUTPUT)
        })
      }
    })
    const all = [reader.refresh(), reader.refresh(), reader.refresh()]
    release()
    await Promise.all(all)
    expect(reads).toBe(1)
  })
})
