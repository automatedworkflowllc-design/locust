import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The live line must LOOK live, and the thinking orb must be visible at the
 * size it ships.
 *
 * Colin, 2026-09-20, on 0.217 — which already had the sweep: *"the slight
 * subtle text glow moving gradient i mentioned that claude code does we
 * should add that to the text next to the orb just to reiterate to the user
 * it isnt stale text"*. Asking for a feature that is already shipped is the
 * clearest report there is that it reads as absent, so the band was widened
 * rather than argued about.
 *
 * And: *"can you make just the thinking animation in locust slightly larger?
 * i think cause its not a massive ball we can get away with it"*. `listening`
 * is a wave through latitude rings, so it uses less of its box than the dense
 * shapes beside it and reads a size down at the same size.
 *
 * Pinned here because both are pure CSS and nothing else in the suite can
 * see them: a stylesheet edit that dropped either would ship silently.
 */

// The CSS checks live beside the other stylesheet tests, in `main/`: the
// renderer's tsconfig carries no node types, so a test that reads a file
// cannot compile there.
const css = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')

describe('the live word is visibly live', () => {
  it('sweeps a band wide enough to notice', () => {
    const rule = css.slice(css.indexOf('.lc-sweep {'))
    // 30→70 rather than 40→60: a fifth of the travel was a couple of
    // characters on a seven-letter word.
    expect(rule).toContain('var(--lc-text-muted) 30%')
    expect(rule).toContain('var(--lc-text-name) 50%')
    expect(rule).toContain('var(--lc-text-muted) 70%')
  })

  it('puts the colour back when motion is off', () => {
    // `background-clip: text` means the ink is TRANSPARENT. Stopping the
    // paint without restoring a colour leaves a blank where a word was.
    // The LAST `.lc-sweep {` in the file is the reduced-motion override; the
    // stylesheet has many reduced-motion blocks, so anchoring on the first
    // one found a different rule entirely.
    const sweep = css.slice(css.lastIndexOf('.lc-sweep {'))
    expect(sweep.slice(0, 220)).toContain('color: var(--lc-text-muted)')
    expect(sweep.slice(0, 220)).toContain('animation: none')
  })

  it('draws the thinking orb a size up without moving the line', () => {
    const rule = css.slice(css.indexOf(".lc-livestep__orb[data-orb='listening']"))
    expect(rule.slice(0, 160)).toContain('transform: scale(1.3)')
    // The BOX stays 20px: the library takes 64 or 20 and throws on anything
    // else, so this is a scale, and the layout must not depend on it.
    const box = css.slice(css.indexOf('.lc-livestep__orb {'))
    expect(box.slice(0, 160)).toContain('width: 20px')
  })
})
