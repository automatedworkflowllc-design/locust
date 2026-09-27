import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OpenInTerminalButton, terminalOffer } from './components/OpenInTerminal.js'
import APP from './App.tsx?raw'

/**
 * A CONVERSATION OFFERS ITS OWN TERMINAL (0.387).
 *
 * Colin, 2026-09-26: "we can either ship it in the three dot dropdown or have
 * it more visible, or do like a coding terminal button" -- with a small `</>`
 * square. Both, and the button says what opening it means.
 */
const base = { runtime: 'claude', model: 'opus', missionId: 'm1', running: false, teammateName: 'Wren' } as const

describe('the terminal offer', () => {
  it('names the runtime whose interface opens, and says Locust will not see it and its permissions are not this mode', () => {
    const offer = terminalOffer(base)
    expect(offer?.label).toBe('Open in Claude Code, in a terminal')
    expect(offer?.title).toContain("The same session, in Wren's folder.")
    expect(offer?.title).toContain("Locust won't see what you do there")
    expect(offer?.title).toContain("Claude Code's own permissions, not this conversation's mode")
    expect(offer?.disabled).toBeUndefined()
  })

  it('is held while the run is going, saying until when and why', () => {
    expect(terminalOffer({ ...base, running: true })?.disabled).toBe("Available when Wren finishes: Locust's run and a terminal can't share one session at once.")
  })

  it('is not made where there is no terminal to open', () => {
    expect(terminalOffer({ ...base, runtime: 'antigravity' })).toBeUndefined()
    expect(terminalOffer({ ...base, runtime: 'gemini' })).toBeUndefined()
    expect(terminalOffer({ ...base, runtime: 'opencode', model: 'own-1a2b3c4d/acme-70b' })).toBeUndefined()
    expect(terminalOffer({ ...base, missionId: undefined })).toBeUndefined()
    for (const runtime of ['codex', 'copilot', 'cursor', 'opencode', 'muse']) expect(terminalOffer({ ...base, runtime }), runtime).toBeDefined()
  })
})

describe('the </> button', () => {
  it('is the code glyph, named and titled, and disabled with the reason as its title', () => {
    const offer = terminalOffer(base)!
    const html = renderToStaticMarkup(<OpenInTerminalButton offer={offer} onOpen={() => undefined} />)
    expect(html).toContain('aria-label="Open in Claude Code, in a terminal"')
    expect(html).toContain('<path d="m14 5-4 14"></path>')
    expect(html).not.toContain('disabled')
    const held = renderToStaticMarkup(<OpenInTerminalButton offer={terminalOffer({ ...base, running: true })!} onOpen={() => undefined} />)
    expect(held).toContain('disabled=""')
    expect(held).toContain('title="Available when Wren finishes')
  })

  it('sits in the conversation header before the ... menu, and the same action heads that menu', () => {
    const button = APP.indexOf('<OpenInTerminalButton offer={shownTerminal}')
    const more = APP.indexOf('aria-label="More actions"')
    expect(button).toBeGreaterThan(-1)
    expect(button).toBeLessThan(more)
    const menu = APP.indexOf('headerActions.push({ label: `Open in terminal (${shownTerminal.runtimeName})`')
    const reviews = APP.indexOf('label: `Ask ${reviewer.name} for a review`')
    expect(menu).toBeGreaterThan(-1)
    expect(menu).toBeLessThan(reviews)
  })
})
