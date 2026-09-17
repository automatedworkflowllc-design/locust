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
    // Cursor left this list on 2026-09-16: its launcher passes `--approve-mcps`, and
    // outside Auto each call is still refused with nobody to answer, which the note now says.
    for (const runtime of ['codex', 'opencode', 'copilot', 'antigravity']) {
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

describe('a route that is not where your connectors live', () => {
  /*
   * MEASURED 2026-09-11, and it cost Colin an evening. Robinhood is signed in
   * and `Connected` on his Claude Code; `cursor-agent mcp list` reports
   * `requires_authentication` for the SAME url, and its `mcp login` completes
   * in the browser and persists nothing. So a teammate on Cursor failed every
   * call, and -- with nothing on screen to go on -- explained it by inventing
   * reasons about desktop OAuth, which Colin then chased.
   *
   * The app knew. It reads connectors off Claude Code and builds allow rules
   * only for Claude Code runs. It just never said so anywhere.
   */
  it('says where they are signed in, once there are any', () => {
    const said = connectorsNote('cursor', 'auto', true)
    expect(said).toContain('Claude Code')
    expect(said).toContain('Cursor')
  })

  it('does not claim the other route has none, because that is not true', () => {
    // Cursor's own plugins were ready in the very session Robinhood failed
    // in. A different SET, signed in separately -- not an absence.
    const said = connectorsNote('cursor', 'auto', true) ?? ''
    for (const wrong of ['no connectors', 'cannot use', 'without connectors']) {
      expect(said.toLowerCase()).not.toContain(wrong)
    }
    expect(said).toContain('different set')
  })

  it('tells a Cursor route outside Auto that connector calls will be refused, and where they work', () => {
    // Colin's ledger, 2026-09-15/16: 17 rejected calls in one Accept-edits
    // run, 0 on Auto. The menu now says so before the run does.
    for (const mode of ['accept-edits', 'ask', 'plan'] as const) {
      const said = connectorsNote('cursor', mode, false) ?? ''
      expect(said).toContain('refused')
      expect(said).toContain('Use Auto')
    }
    expect(connectorsNote('cursor', 'auto', false)).toBeUndefined()
  })

  it('stays quiet when this machine has none, because then there is nothing to place', () => {
    expect(connectorsNote('cursor', 'auto', false)).toBeUndefined()
    expect(connectorsNote('codex', 'ask', false)).toBeUndefined()
  })

  it('leaves the Claude sentence exactly as it was', () => {
    // The mode sentence is measured and hard-won; this change must not touch
    // it. It also must not depend on the new flag.
    expect(connectorsNote('claude', 'auto', true)).toBe(connectorsNote('claude', 'auto', false))
    expect(connectorsNote('claude', 'auto', true)).toContain('work here')
  })
})
