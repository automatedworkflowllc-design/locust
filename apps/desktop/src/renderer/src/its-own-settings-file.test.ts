import { describe, expect, it } from 'vitest'

import { failureMessage } from './missionView.js'

/**
 * A runtime that could not write its own config says so in English.
 *
 * Colin, 2026-09-14, on 0.119.0, asking one Cursor teammate to ask another
 * -- "this def used to work". What he got was two absolute paths, a uuid and
 * a POSIX errno:
 *
 *   Error: EPERM: operation not permitted, rename
 *   'C:\Users\<home>\.cursor\cli-config.json.19620.f8d831f1-....tmp' ->
 *   'C:\Users\<home>\.cursor\cli-config.json'
 *
 * `cursor-agent` rewrites that file on startup -- temp beside it, rename
 * over the top -- and on Windows the rename fails with EPERM while another
 * process still holds the destination open. A peer message starts a second
 * `cursor-agent` while the first is live, so the room features provoke it
 * directly. Thirteen abandoned `.tmp` files sat beside that config going
 * back to 2026-09-02: intermittent and old, not a regression.
 *
 * The reading that hurts is the one a person actually makes: "operation not
 * permitted" sounds like Locust was denied something in THEIR project. It
 * was not. The file belongs to the runtime and lives in their home folder,
 * and saying which is the entire fix.
 *
 * What this must NOT do is reassure about the workspace. The run died
 * somewhere and nothing here knows where -- and a comforting second clause
 * that turns out to be false is worse than the bare sentence it replaced.
 * That rule was bought with Grok's finding on Ask-mode banners.
 */

const EPERM =
  "Error: EPERM: operation not permitted, rename 'C:\\Users\\<home>\\.cursor\\cli-config.json.19620.f8d831f1-c13a-42f0-9e58-e03665f51f78.tmp' -> 'C:\\Users\\<home>\\.cursor\\cli-config.json'"

const said = (stderr: string): string =>
  failureMessage({ message: 'Cursor Agent ended without a terminal result record.', process: { stderr } })

describe('when a runtime cannot save its own settings file', () => {
  it('says whose file it was, because that is the part that is misread', () => {
    const text = said(EPERM)
    expect(text).toContain('its own settings file')
    expect(text).toContain('your home folder')
  })

  it('says the workspace was not what it was denied', () => {
    expect(said(EPERM)).toContain('nothing in this workspace was denied to it')
  })

  it('claims nothing about what the run did before it died', () => {
    // The honest gap. Grok, 2026-09-14: a reassuring sentence that is wrong
    // is worse than the bare one it replaced.
    const text = said(EPERM)
    expect(text).not.toContain('Nothing in the workspace has changed')
    expect(text).not.toContain('nothing was lost')
  })

  it('names the way forward, because this one is transient', () => {
    expect(said(EPERM)).toContain('again')
  })

  it('does not put the raw errno and two absolute paths on the card', () => {
    const text = said(EPERM)
    expect(text).not.toContain('.tmp')
    expect(text).not.toContain('EPERM')
  })

  it('keeps the host sentence it is extending', () => {
    expect(said(EPERM).startsWith('Cursor Agent ended without a terminal result record.')).toBe(true)
  })

  it('leaves every other last word exactly as it was', () => {
    // A guard that swallows unrelated failures would be a worse defect than
    // the jargon it replaced, so the fall-through is asserted too.
    expect(said('Error: ENOENT: no such file or directory')).toContain("The runtime's own last word was:")
    expect(said('RetriableError: [resource_exhausted]')).toContain('out of capacity right now')
    // A rename of something that is NOT a runtime config is not this.
    expect(said("Error: EPERM: operation not permitted, rename 'a.txt' -> 'b.txt'")).toContain(
      "The runtime's own last word was:"
    )
    // And a permissions error that never mentions a rename is not this.
    expect(said('Error: EPERM: operation not permitted, open cli-config.json')).toContain(
      "The runtime's own last word was:"
    )
  })
})
