import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer, connectorsNote } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import type { MissionMode } from '../../shared/ipc.js'

/**
 * What a mode does to a connector, said in the words that survived measuring.
 *
 * Two wrong sentences shipped before this one, both wrong about the reason:
 *
 *  1. "Only Auto can reach an MCP server." `--restricted` never blocked them;
 *     `--strict-mcp-config` is the flag that would, and running the argv by
 *     hand listed every connector on the account.
 *  2. "Your connectors are available in every mode." Removing our own
 *     `--disallowedTools mcp__*` made them OFFERED, and driving the built app
 *     in Ask showed the rest: Claude Code asks before using one, a printed
 *     run has nowhere to ask, and the call is denied. The activity row read
 *     `get_watchlists / Robinhood / failed`.
 *
 * Colin's question was "do you think thats acceptable for the user to only
 * have access for mcp tools under auto or is that standard?" It is not
 * standard, and the real answer is per-connector permission rather than a
 * mode: an allow rule must name its server (`mcp__claude_ai_Robinhood__*` is
 * accepted, `mcp__*` is refused). Until that exists, the app says which mode
 * can and which cannot, rather than letting the model improvise a reason.
 */

const ROUTE = (runtime: string): ComposerProps['route'] =>
  ({ runtime, model: 'sonnet', routeId: `${runtime}:sonnet` }) as unknown as ComposerProps['route']

const RESTRICTED = ['ask', 'accept-edits', 'plan', 'approve-each'] as const
const EVERY_MODE = [...RESTRICTED, 'auto'] as const

function chip(mode: MissionMode, runtime = 'claude'): string {
  const props = {
    runtimes: [],
    limitedRuntimes: new Map(),
    discoveryPhase: 'ready',
    models: [],
    route: ROUTE(runtime),
    mode,
    onModeChange: () => undefined,
    onRouteChange: () => undefined,
    onSend: () => undefined,
    running: false,
    platform: 'win32'
  } as unknown as ComposerProps
  const html = renderToStaticMarkup(<Composer {...props} />)
  return /aria-label="Permission mode" title="([^"]*)"/.exec(html)?.[1] ?? 'NO CHIP'
}

describe('what a mode does to a connector', () => {
  it('says a call will be refused, in every mode that cannot ask', () => {
    for (const mode of RESTRICTED) {
      expect(connectorsNote('claude', mode), mode).toContain('will be refused in this mode')
      expect(connectorsNote('claude', mode), mode).toContain('no way to put that question to you')
    }
  })

  it('says they work in Auto, and why that is not free', () => {
    const note = connectorsNote('claude', 'auto')
    expect(note).toContain('Your connectors work here')
    // Never sold as a pure win: the same flag that stops it asking is the one
    // that lets it change anything on this machine.
    expect(note).toContain('change anything on this machine')
    expect(note).not.toContain('refused')
  })

  it('never repeats either sentence that turned out to be wrong', () => {
    for (const mode of EVERY_MODE) {
      const note = connectorsNote('claude', mode) ?? ''
      // v1: the reason given was `--restricted`, which never blocked MCP.
      expect(note, mode).not.toContain('own Claude Code settings')
      // v2: "available in every mode", which the Ask drive disproved.
      expect(note, mode).not.toContain('available in every mode')
    }
  })

  it('says nothing on a runtime whose launcher never touches MCP', () => {
    for (const runtime of ['codex', 'cursor', 'opencode', 'copilot', 'antigravity']) {
      expect(connectorsNote(runtime, 'accept-edits'), runtime).toBeUndefined()
      expect(chip('accept-edits', runtime), runtime).toBe('Permission mode')
    }
  })

  it('reaches the screen without opening the menu', () => {
    // The chip is always drawn; the menu is not. A person who never opens it
    // still has to be able to read this.
    for (const mode of RESTRICTED) {
      expect(chip(mode), mode).toContain('will be refused in this mode')
    }
    expect(chip('auto')).toContain('Your connectors work here')
  })
})
