import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer, connectorsNote } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import type { MissionMode } from '../../shared/ipc.js'

/**
 * A mode that has taken the person's connectors away has to say so.
 *
 * On 2026-09-09 Colin asked a teammate in Accept edits to check Robinhood,
 * twice, and got a correct and useless answer both times -- "I have no
 * connection to Robinhood or any brokerage account, no credentials, and no
 * tool here that can reach it" -- with nothing on screen to say the MODE was
 * the reason. His question afterwards: "is it just going to be impossible to
 * call robinhood out of the locust folder?" It is not. It is impossible
 * outside Auto, and that was a sentence the app owed him.
 *
 * The sentence is checked as a function AND on the rendered chip, because a
 * sentence that exists only in a menu nobody opened is the shape of defect
 * this repository keeps shipping: a passing test over a control the screen
 * never draws.
 */

const ROUTE = (runtime: string): ComposerProps['route'] =>
  ({ runtime, model: 'sonnet', routeId: `${runtime}:sonnet` }) as unknown as ComposerProps['route']

const RESTRICTED = ['ask', 'accept-edits', 'plan', 'approve-each'] as const

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

describe('a mode that has taken the connectors away', () => {
  it('says so, in every restricted mode', () => {
    for (const mode of RESTRICTED) {
      expect(connectorsNote('claude', mode), mode).toContain('Your connectors are off in this mode')
      expect(connectorsNote('claude', mode), mode).toContain('Only Auto')
    }
  })

  it('says they are live in Auto rather than saying nothing at all', () => {
    const note = connectorsNote('claude', 'auto')
    expect(note).toContain('Auto is the only mode that reads your own Claude Code settings')
    expect(note).not.toContain('are off')
  })

  it('says nothing on a runtime whose launcher never touches MCP', () => {
    // Claude Code is the only one whose command builder mentions `mcp__`, so
    // the same words elsewhere would be a claim nothing behind them makes.
    for (const runtime of ['codex', 'cursor', 'opencode', 'copilot', 'antigravity']) {
      expect(connectorsNote(runtime, 'accept-edits'), runtime).toBeUndefined()
    }
  })

  it('reaches the screen without opening the menu', () => {
    // The chip is always drawn; the menu is not. A person who never opens it
    // still hits the wall, so the warning has to be readable from the bar.
    for (const mode of RESTRICTED) {
      expect(chip(mode), mode).toContain('Your connectors are off in this mode')
    }
    expect(chip('auto')).toBe('Permission mode')
    expect(chip('accept-edits', 'codex')).toBe('Permission mode')
  })
})
