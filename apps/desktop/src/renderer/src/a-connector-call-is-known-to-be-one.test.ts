import { describe, expect, it } from 'vitest'

import { buildThread, isBareConnectorTool, orbStateFor } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A call that leaves the machine has to be KNOWN to have left it.
 *
 * Colin, 2026-09-20, with two screenshots — one of an Antigravity turn whose
 * fold read `3 tool calls — mcp, mcp, mcp done`, and one of the `solving`
 * orb: *"working is showing the same animation as grabbing an mcp tool call,
 * i dont think we have mcp properly setup to its own unique animation, i
 * could be wrong. this should be the one used for mcp or connectors"*.
 *
 * He was right on both halves, and they are separate defects:
 *
 * 1. **The call was not recognised.** Every connector name Locust had been
 *    shown carried its server in the name — `mcp__Robinhood__get_watchlists`,
 *    `Google_Drive__create_file`, Codex's `mcp.server.tool` — so the split
 *    WAS the detection. Antigravity names the tool flatly `mcp` and puts the
 *    server somewhere the event does not carry, so the split returned nothing
 *    and the call was filed as an ordinary local tool. No connector register,
 *    no connector orb, and nothing saying the work had left the machine.
 * 2. **The shape was wrong.** `solving` was on every open tool, so it is his
 *    now for connectors, and `connecting` takes the ordinary tool row.
 *
 * The server stays unknown when the name does not carry it. "Using a
 * connector" with no name is true; inventing one would not be.
 */

const at = '2026-09-20T10:00:00.000Z'

const started = (itemId: string, name: string): NormalizedRuntimeEvent =>
  ({
    id: `s-${itemId}`,
    runId: 'r',
    missionId: 'm',
    sequence: 1,
    occurredAt: at,
    sourceAdapter: 'antigravity',
    type: 'tool.started',
    payload: { itemId, name }
  }) as unknown as NormalizedRuntimeEvent

const liveStep = (events: readonly NormalizedRuntimeEvent[]) => {
  const item = buildThread(events, { running: true, mayEdit: true, startedAt: at }).find(
    (entry) => entry.type === 'live-step'
  )
  return item?.type === 'live-step' ? item : undefined
}

describe('a connector call is known to be one', () => {
  it('reads a bare mcp tool name as a connector call', () => {
    expect(isBareConnectorTool('mcp')).toBe(true)
    expect(isBareConnectorTool('MCP')).toBe(true)
    expect(isBareConnectorTool('use_mcp_tool')).toBe(true)
  })

  it('does not turn a file or an ordinary tool into one', () => {
    // The whole risk of a name-shaped rule. `mcp_server_config.json` is a
    // file a person reads, and reading it does not leave the machine.
    expect(isBareConnectorTool('mcp_server_config.json')).toBe(false)
    expect(isBareConnectorTool('Read')).toBe(false)
    expect(isBareConnectorTool('grep_search')).toBe(false)
    expect(isBareConnectorTool('')).toBe(false)
  })

  it('puts the live line on the connector register', () => {
    const step = liveStep([started('t1', 'mcp')])
    expect(step?.register).toBe('connector')
    expect(step?.orb).toBe('solving')
  })

  it('names no server it was not told', () => {
    const step = liveStep([started('t1', 'mcp')])
    expect(step?.detail).toBeUndefined()
  })

  it('still names the server when the name carries one', () => {
    const step = liveStep([started('t1', 'mcp__claude_ai_Robinhood__get_watchlists')])
    expect(step?.register).toBe('connector')
    expect(step?.detail).toBe('Robinhood')
    expect(step?.label).toBe('get_watchlists')
  })

  it('leaves an ordinary tool alone', () => {
    const step = liveStep([started('t1', 'grep_search')])
    expect(step?.register).toBe('tool')
    expect(step?.orb).toBe('searching')
  })

  it('never shows the same orb twice across the busiest transition', () => {
    // Colin's rule, 2026-09-20: "we shouldnt have the same orb playing right
    // after one another ever". These are the four registers a run walks
    // between with a tool in the middle.
    const walked = ['working', 'tool', 'connector', 'thinking'] as const
    const orbs = walked.map((register) => orbStateFor(undefined, false, register))
    expect(new Set(orbs).size).toBe(walked.length)
  })
})
