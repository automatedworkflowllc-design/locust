import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { OUTBOUND_LINKS, isOutboundLink } from '../shared/outbound-links.js'

/**
 * No link in this app can be dead.
 *
 * The host denies `window.open` and cancels navigation away from its own
 * URL, on purpose: `shell.openExternal` hands a URL to the operating system
 * where none of the packaged build's egress rules apply. The note beside
 * that policy said "Nothing in this shell links out, so nothing is opened",
 * and asked that a feature needing a link name the exact URL in the host.
 *
 * Then the first-run panel grew three `<a target="_blank">` links -- one per
 * runtime that is not an npm package, and one for Node.js -- and nobody
 * named anything. All three were dead in every build that shipped them. A
 * dead link is invisible to every test we had: it renders, it has a cursor,
 * the markup is correct, and nothing happens. It took an outside tester on
 * 0.55.0 to find it, and it was the ONLY way out offered to someone with no
 * Node.js on their machine.
 *
 * So this is the control, in two halves. An anchor that navigates cannot
 * exist in the renderer at all, and every address the renderer does ask for
 * must be one the host will actually open.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

function sources(directory: string): readonly string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.')) found.push(path)
  }
  return found
}

/** Source with comments removed: prose about links is not a link. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ')
}

const files = sources(RENDERER)

describe('links out of the app', () => {
  it('has renderer sources to look at, and a list to check against', () => {
    // The control. A walk that finds nothing would report every file clean.
    expect(files.length).toBeGreaterThan(20)
    expect(OUTBOUND_LINKS.length).toBeGreaterThanOrEqual(3)
    // Read from the runtime facts rather than copied, so a vendor URL that
    // moves cannot leave a dead link behind.
    expect(OUTBOUND_LINKS).toContain('https://cursor.com/cli')
    expect(OUTBOUND_LINKS).toContain('https://antigravity.google')
    expect(OUTBOUND_LINKS).toContain('https://nodejs.org')
  })

  it('opens only what the host allows', () => {
    for (const url of OUTBOUND_LINKS) expect(isOutboundLink(url)).toBe(true)
    // The whole point of the list: anything else is refused rather than
    // handed to the operating system.
    expect(isOutboundLink('https://example.com')).toBe(false)
    expect(isOutboundLink('https://nodejs.org.evil.test')).toBe(false)
    expect(isOutboundLink('file:///C:/Windows')).toBe(false)
    expect(isOutboundLink(undefined)).toBe(false)
  })

  it('draws no anchor that tries to navigate', () => {
    /*
     * THE regression, stated as the shape rather than the symptom. An
     * `href` to anywhere but the app itself does nothing here, whether or
     * not it carries target="_blank" -- and it does nothing SILENTLY, which
     * is why it survived so long.
     */
    for (const path of files) {
      const code = codeOnly(readFileSync(path, 'utf8'))
      const anchors = [...code.matchAll(/<a\s[^>]*href=/g)]
      expect(anchors, `${path.slice(RENDERER.length)} draws an <a href>, which cannot open in this app`).toEqual([])
    }
  })

  it('asks the host for every address it names', () => {
    // Any http(s) address written in the renderer has to be one the host
    // will open, or pressing the thing that shows it does nothing again.
    for (const path of files) {
      const code = codeOnly(readFileSync(path, 'utf8'))
      for (const match of code.matchAll(/'(https?:\/\/[^']+)'/g)) {
        const url = match[1] ?? ''
        expect(isOutboundLink(url), `${path.slice(RENDERER.length)} names ${url}, which the host will not open`).toBe(true)
      }
    }
  })
})
