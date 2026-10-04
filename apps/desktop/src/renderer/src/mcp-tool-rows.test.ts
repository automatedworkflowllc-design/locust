import { describe, expect, it } from 'vitest'

import { mcpToolParts } from './missionView.js'

/**
 * A connector call reads as a connector call.
 *
 * The first MCP tool a Locust teammate ever reached showed up on screen as
 * `mcp__claude_ai_Robinhood__get_watchlists` — one machine name, drawn
 * whole. Colin, 2026-09-09: "the mcp tool calls came out a little messy,
 * might need to make that part of the ui, should be easy for you since you
 * can see how its done in claude."
 *
 * It is. The shape is `mcp__<server>__<tool>`, and the row already has two
 * slots that mean exactly those things: what was acted on, and what acted.
 * So an MCP call stops being a special case.
 */

describe('an MCP tool name', () => {
  it('splits into the server and the tool', () => {
    expect(mcpToolParts('mcp__claude_ai_Robinhood__get_watchlists')).toEqual({
      server: 'Robinhood',
      tool: 'get_watchlists'
    })
  })

  it('drops the transport, keeps the product', () => {
    /*
     * `claude_ai_` says how the connector is carried, not what it is. An
     * account connector and a local server for the same product are the same
     * product to whoever connected it.
     */
    expect(mcpToolParts('mcp__claude_ai_Gmail__send_message')?.server).toBe('Gmail')
    expect(mcpToolParts('mcp__robinhood-trading__get_portfolio')?.server).toBe('robinhood trading')
  })

  it('keeps a tool name that has underscores of its own', () => {
    // The split is on the FIRST double underscore only: everything after it
    // is the tool, and tool names are full of single underscores.
    expect(mcpToolParts('mcp__Figma__get_design_context')).toEqual({
      server: 'Figma',
      tool: 'get_design_context'
    })
  })

  it('reads Codex’s own join too', () => {
    // Codex sends `server.tool` rather than the doubled underscores, so
    // without this it would be the one runtime the fix did not help.
    expect(mcpToolParts('mcp_tool.robinhood.get_portfolio')?.server).toBe('robinhood')
  })

  it('leaves every ordinary tool alone', () => {
    // THE way to over-fix this: a file path has dots in it, and Read is not
    // a connector.
    expect(mcpToolParts('Read')).toBeUndefined()
    expect(mcpToolParts('Bash')).toBeUndefined()
    expect(mcpToolParts('src/billing/adapter.ts')).toBeUndefined()
    expect(mcpToolParts('mcp_tool')).toBeUndefined()
  })
})
