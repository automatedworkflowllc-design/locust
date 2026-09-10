import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer, connectorsNote } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import type { MissionMode } from '../../shared/ipc.js'

/**
 * The mode governs this machine. A connector is not on this machine.
 *
 * Three wrong sentences shipped before this one, and each is worth keeping as
 * a thing this control now forbids by name:
 *
 *  1. "Only Auto can reach an MCP server" -- blamed `--restricted`, which
 *     never blocked MCP; `--strict-mcp-config` is the flag that would.
 *  2. "Your connectors are available in every mode" -- they were offered, and
 *     every call was then denied for want of anyone to approve it.
 *  3. "A connector call will be refused in this mode" -- true until Locust
 *     began passing a named allow rule per connector.
 *
 * Colin, 2026-09-10: "honestly just let them have access to the mcp tools if
 * the client have access to it -- it only makes sense and is way less muddy."
 * So they all work, and the line says the thing a person cannot infer from
 * the mode's own words: "every write is refused" is a promise about DISK, and
 * a connector reaches past this machine.
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
  it('says they work, in every mode', () => {
    for (const mode of EVERY_MODE) {
      expect(connectorsNote('claude', mode), mode).toContain('Your connectors work')
    }
  })

  it('says the one thing the mode cannot tell you: a connector is not this machine', () => {
    for (const mode of RESTRICTED) {
      expect(connectorsNote('claude', mode), mode).toContain('limits is this machine')
      expect(connectorsNote('claude', mode), mode).toContain('outside the sandbox')
    }
    // Auto has nothing to distinguish -- it covers the machine as well.
    expect(connectorsNote('claude', 'auto')).toContain('everything else on this machine')
  })

  it('never repeats any of the three sentences that turned out to be wrong', () => {
    for (const mode of EVERY_MODE) {
      const note = connectorsNote('claude', mode) ?? ''
      expect(note, mode).not.toContain('own Claude Code settings')
      expect(note, mode).not.toContain('available in every mode')
      expect(note, mode).not.toContain('will be refused')
      expect(note, mode).not.toContain('Only Auto')
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
    for (const mode of EVERY_MODE) {
      expect(chip(mode), mode).toContain('Your connectors work')
    }
  })
})
