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

describe('the lockup lighting', () => {
  it('powers on from dark, lit lime, and ends in the app ink', () => {
    const power = block('@keyframes lcLockupPower')
    expect(power).toMatch(/0%\s*\{[^}]*opacity: 0/)
    expect(power).toContain('color: var(--lc-lime)')
    expect(power).toMatch(/100%\s*\{[^}]*color: var\(--lc-text-primary\)/)
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

  it('stops for reduced motion', () => {
    const reduced = shell.slice(shell.indexOf('.lc-lockup.is-powering,\n  .lc-lockup.is-relighting,'))
    expect(reduced.slice(0, 200)).toContain('animation: none')
    expect(shell).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-lockup\.is-powering,/)
  })
})
