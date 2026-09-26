import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Three placements, from the design ruling of 2026-09-14.
 *
 * The pattern the ruling named is worth keeping in front of us: *the audit
 * finds a true statement, the fix states it truly, and the cost is that some
 * surface now says one thing too many.* That is a placement failure, not a
 * judgement failure. All three below came from correct fixes.
 *
 * 1. **The mission strip.** It grew to seven facts and truncated on Colin's
 *    screen as `… 208 out · co…`. Two registers: two scopes (six mission
 *    facts and one conversation fact joined by the same separator) and two
 *    tenses (`completed` is live; the id and the costs are the record). It
 *    had been growing because it is the most VISIBLE surface, not the right
 *    one. Off it came the noun, the permission prose -- which the composer's
 *    mode chip already states where it is actionable -- and the conversation
 *    total.
 *
 * 2. **The cold-start note.** A marker describing the boundary BETWEEN turns
 *    is centred and full-width; a note describing the turn you are ABOUT TO
 *    READ is left-aligned in the standing register. Cold start is the
 *    second, and was wearing the first's clothes.
 *
 * 3. **What a teammate sent.** The two directions are not symmetric. The
 *    reverse sentence exists because nothing arrived and an absence cannot
 *    explain itself; here something did arrive, and presence needs
 *    attributing rather than explaining. One word, and one link.
 */

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const read = (path: string): string => readFileSync(SRC + path, 'utf8')

describe('1 · the mission strip carries one scope and one tense', () => {
  const app = read('App.tsx')
  const strip = app.slice(app.indexOf('FOUR FACTS, ONE SCOPE'), app.indexOf('The context ring is NOT here'))

  it('dropped the noun that labelled the line once and cost eight characters forever', () => {
    expect(strip).not.toContain('`Mission · ${')
  })

  it('dropped the permission prose, which the composer already states where it can be changed', () => {
    // "A permission is a thing you can change, and stating it where it
    // cannot be changed is the app talking to itself."
    expect(strip).not.toContain('sandboxPhrase')
  })

  it('names the model always, and the phase only when it is news', () => {
    // The first-impressions pass (after 0.349; Colin, 2026-09-26: Claude's UI
    // "and beyond" is the standard) took the ruling one step further. The
    // eight-hex id went to Details -- it is a string to copy, not a fact to
    // read on every screen -- and a conversation that finished normally no
    // longer says "restored from the local ledger" or "completed". Running,
    // failed, cancelled and interrupted still say so; the model always does.
    expect(strip).toContain('modelDisplayName')
    expect(strip).not.toContain('shortMissionId')
    expect(strip).not.toContain('restored from the local ledger')
    expect(strip).toContain("liveRun.phase === 'completed'")
  })
})

describe('2 · a note is not a marker', () => {
  const css = read('shell.css')

  it('gives the note its own register: left-ruled, not centred', () => {
    const note = css.slice(css.indexOf('.lc-thread__note {'), css.indexOf('.lc-thread__marker {'))
    expect(note).toContain('border-left')
    expect(note).not.toContain('text-align: center')
    expect(note).not.toContain('text-transform: uppercase')
  })

  it('leaves the boundary marker centred, because it IS a boundary', () => {
    const marker = css.slice(css.indexOf('.lc-thread__marker {'))
    expect(marker.slice(0, 220)).toContain('text-align: center')
  })
})

describe('3 · what arrived is attributed, not explained', () => {
  const peer = read('components/PeerThread.tsx')

  it('says the teammate SENT it, rather than naming them and stopping', () => {
    expect(peer).toContain('{message.from.name} sent')
  })

  it('offers the sender’s own conversation, once, in the header', () => {
    expect(peer).toContain('lc-peer__origin')
    // Once per card. A link under every message is what Colin called
    // "clunky and isn't really needed" on 2026-09-06, and that stands.
    expect(peer.split('lc-peer__origin').length - 1).toBeLessThanOrEqual(2)
  })

  it('never claims there is more, which is the comparison it cannot make', () => {
    for (const claim of ['full reply', 'said more', 'longer than', 'only part']) {
      expect(peer).not.toContain(claim)
    }
  })

  it('reaches the sender by their own mission, which the store always had', () => {
    expect(peer).toContain('from.missionId')
  })
})
