import { describe, expect, it } from 'vitest'

import { deferredOthersSentence } from './status.js'

/**
 * The same sentence has now been wrong about the rows behind it twice, and
 * both times for the same reason: it was fixed text about a varying list.
 *
 * - Fable, 0.198.0 — four CLIs installed and hung, collapsed behind *"5
 *   others Locust can drive — they each need their own account."* They needed
 *   no account and were already on the machine.
 * - Sol, 2026-09-21, finding 7 — expanded it and counted. Codex, Claude and
 *   Copilot install from here and then want an account; Cursor Agent and
 *   Antigravity are a **Get it** link to somebody else's installer.
 *
 * So the account claim only survives where it is true of every row, and the
 * mixed case — which is the real one on a bare machine — claims neither.
 */
const fromHere = { installsFromHere: true }
const fromVendor = { installsFromHere: false }

describe('the others line describes the others', () => {
  it('keeps the account claim only when it holds for every row', () => {
    expect(deferredOthersSentence([fromHere, fromHere, fromHere])).toBe(
      '3 others Locust can drive — each installs from here, then signs in.'
    )
  })

  it('says vendor when none of them install from here', () => {
    expect(deferredOthersSentence([fromVendor, fromVendor])).toBe(
      '2 others Locust can drive — each installs from its own vendor.'
    )
  })

  it('claims neither when the list is mixed', () => {
    // Sol's actual screen: Codex, Claude, Copilot from here; Cursor Agent and
    // Antigravity from their vendors.
    const sentence = deferredOthersSentence([fromHere, fromHere, fromHere, fromVendor, fromVendor])
    expect(sentence).toBe('5 others Locust can drive — some install from here, some from their own vendor.')
    expect(sentence).not.toContain('account')
  })

  it('counts one as one', () => {
    expect(deferredOthersSentence([fromVendor])).toContain('1 other Locust')
    expect(deferredOthersSentence([fromVendor])).not.toContain('1 others')
  })
})
