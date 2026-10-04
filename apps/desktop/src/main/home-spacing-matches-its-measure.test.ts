import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * HOME'S SPACING MATCHES ITS MEASURE (0.583).
 *
 * HomeCover's `homeIsShort` decides whether Home tightens from constants --
 * the bots' reach above the cover, the normal padding and gap -- rather than
 * from the live styles, so tightening cannot argue itself back off. That only
 * holds while the stylesheet says the same numbers, so this reads both.
 * (renderer/src/home-fits-two-rows-of-teammates.test.ts tests the decision.)
 */

const renderer = join(__dirname, '..', 'renderer', 'src')
const css = readFileSync(join(renderer, 'shell.css'), 'utf8')
const tokens = readFileSync(join(renderer, 'tokens.css'), 'utf8')
const cover = readFileSync(join(renderer, 'components', 'HomeCover.tsx'), 'utf8')

const constant = (name: string): number => Number(new RegExp(`export const ${name} = (\\d+)`).exec(cover)?.[1])
const token = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1])
/** The rule whose selector starts its own line, exactly as written. */
const rule = (selector: string): string => {
  const match = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')} \\{([^}]*)\\}`, 'm').exec(css)
  return match?.[1] ?? ''
}

describe("Home's stylesheet and the numbers its measure assumes", () => {
  it("the bots' reach is the machine's own top margin", () => {
    expect(constant('COVER_REACH')).toBe(48)
    expect(rule('.lc-cover--machine')).toContain(`margin-top: calc(${String(constant('COVER_REACH'))}px * var(--lc-cover-k))`)
  })

  it('the normal padding and gap are the constants', () => {
    expect(rule('.lc-empty')).toContain('padding: var(--lc-space-8) var(--lc-space-6)')
    expect(token('lc-space-8')).toBe(constant('HOME_PAD'))
    expect(rule('.lc-empty__inner')).toContain('gap: var(--lc-space-5)')
    expect(token('lc-space-5')).toBe(constant('HOME_GAP'))
  })

  it('tight is smaller on both, so a short page gains room', () => {
    expect(rule('.lc-empty.is-tight')).toContain('padding-top: var(--lc-space-5)')
    expect(rule('.lc-empty.is-tight')).toContain('padding-bottom: var(--lc-space-5)')
    expect(rule('.lc-empty.is-tight > .lc-empty__inner')).toContain('gap: var(--lc-space-4)')
    expect(token('lc-space-5')).toBeLessThan(token('lc-space-8'))
    expect(token('lc-space-4')).toBeLessThan(token('lc-space-5'))
  })

  it('the column is centred, not anchored to the bottom', () => {
    const inner = rule('.lc-empty__inner')
    expect(inner).toContain('margin-top: auto')
    expect(inner).toContain('margin-bottom: auto')
  })

  it('Home opens at its top, not scrolled to the end', () => {
    const home = readFileSync(join(renderer, 'components', 'FirstLaunch.tsx'), 'utf8')
    expect(home).toContain('let atEnd = false')
    expect(home).not.toContain('let atEnd = true')
  })
})
