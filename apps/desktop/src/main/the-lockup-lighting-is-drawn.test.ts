import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The CSS half of `the-lockup-powers-on.test.tsx`: the lighting exists, it
 * never turns the lockup dark on a relight, and reduced motion stops it.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const block = (from: string): string => {
  const start = shell.indexOf(from)
  if (start < 0) return ''
  let depth = 0
  for (let at = shell.indexOf('{', start); at < shell.length; at += 1) {
    if (shell[at] === '{') depth += 1
    if (shell[at] === '}') {
      depth -= 1
      if (depth === 0) return shell.slice(start, at + 1)
    }
  }
  return ''
}

describe('the home screen cover', () => {
  it('is the cover drawn to scale: its 960x254 numbers times the measured k', () => {
    // A2 (0.295): the machine -- no plate, the lockup on the glass.
    expect(block('.lc-cover {')).toContain('height: calc(254px * var(--lc-cover-k))')
    expect(block('.lc-cover .lc-lockup__mark {')).toContain('width: calc(100px * var(--lc-cover-k))')
    expect(block('.lc-cover .lc-lockup__name {')).toContain('font-size: calc(48px * var(--lc-cover-k))')
    expect(shell).not.toContain('.lc-cover__plate {')
  })

  it('centres the claim under the lockup, in mono capitals, never under the 10.5px floor', () => {
    expect(block('.lc-cover__screen {')).toContain('align-items: center')
    const claim = block('.lc-cover__claim {')
    expect(claim).toContain('font-family: var(--lc-font-mono)')
    expect(claim).toContain('text-transform: uppercase')
    expect(claim).toContain('letter-spacing: 0.16em')
    expect(claim).toContain('font-size: max(10.5px,')
    // The trailing tracking is taken back, or the centre sits half a gap left.
    expect(claim).toContain('margin: 0 -0.16em 0 0')
  })
})

describe('the lockup lighting', () => {
  it('powers on from dark, lit lime, and ends in the app ink', () => {
    const power = block('@keyframes lcLockupPower')
    expect(power).toMatch(/0%\s*\{[^}]*opacity: 0/)
    expect(block('.lc-lockup__lit {')).toContain('color: var(--lc-lime)')
    expect(block('.lc-lockup {')).toContain('color: var(--lc-text-primary)')
    expect(block('@keyframes lcLockupGlow')).toMatch(/100%\s*\{[^}]*opacity: 0/)
    expect(power).toMatch(/100%\s*\{[^}]*opacity: 1/)
  })

  it('relights without ever going dark', () => {
    const relight = block('@keyframes lcLockupRelight')
    expect(relight.length).toBeGreaterThan(0)
    // Every opacity it passes through: a flicker, never a blackout.
    const opacities = [...relight.matchAll(/opacity: ([0-9.]+)/g)].map((match) => Number(match[1]))
    expect(opacities.length).toBeGreaterThan(0)
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.7)
  })

  it('lays the boot screen tube over it: its scanlines and its sweep', () => {
    expect(block('.lc-lockup__scan {')).toContain('var(--lc-boot-scan)')
    expect(block('.lc-lockup__sweep {')).toContain('var(--lc-boot-glow-soft)')
  })

  it('sets the name the way the cover does: Figtree 700 capitals at the title tracking', () => {
    const name = block('.lc-lockup__name {')
    expect(name).toContain('font-family: var(--lc-font-ui)')
    expect(name).toContain('font-weight: 700')
    expect(name).toContain('letter-spacing: var(--lc-title-tracking)')
    expect(name).toContain('text-transform: uppercase')
  })

  it('stops for reduced motion', () => {
    const reduced = shell.slice(shell.indexOf('.lc-lockup.is-powering,\n  .lc-lockup.is-relighting,'))
    expect(reduced.slice(0, 200)).toContain('animation: none')
    expect(shell).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-lockup\.is-powering,/)
  })
})
