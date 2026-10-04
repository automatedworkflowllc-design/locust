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
 * i think cause its not a massive ball we can get away with it"* — which went
 * on the wrong orb first. He named the SHAPE he could see; the register it
 * sits on is called something else, and the two vocabularies have not agreed
 * since the orbs became an allocation rather than a description. Pinned by
 * ORB NAME here, which is the only one of the three that is unambiguous.
 *
 * Pinned here because both are pure CSS and nothing else in the suite can
 * see them: a stylesheet edit that dropped either would ship silently.
 */

// The CSS checks live beside the other stylesheet tests, in `main/`: the
// renderer's tsconfig carries no node types, so a test that reads a file
// cannot compile there.
const css = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')

describe('the live word is visibly live', () => {
  it('sweeps with the library own shape: a solid word, a highlight over it', () => {
    const rule = css.slice(css.indexOf('.lc-sweep::before'))
    // Ported from `.t-shimmer` on libraries.dev rather than approximated.
    // The overlay is drawn from the element's own `data-text`.
    expect(rule.slice(0, 700)).toContain('content: attr(data-text)')
    expect(rule.slice(0, 700)).toContain('background-size: 400% 100%')
    expect(rule.slice(0, 700)).toContain('-webkit-text-fill-color: transparent')
  })

  it('leaves the word itself painted', () => {
    /*
     * The hazard their shape removes. Ours made the INK transparent over a
     * moving gradient, so anything that stopped the paint left a blank where
     * a word had been -- which is why reduced motion had to restore a colour.
     * Here the base is a normal painted word and only the overlay is clipped.
     */
    const base = css.slice(css.indexOf('.lc-sweep {'), css.indexOf('.lc-sweep::before'))
    expect(base).toContain('color: var(--lc-text-muted)')
    expect(base).not.toContain('color: transparent')
  })

  it('drops only the highlight when motion is off', () => {
    const reduced = css.slice(css.lastIndexOf('.lc-sweep::before'))
    expect(reduced.slice(0, 200)).toContain('display: none')
  })

  it('sets the live word as a label rather than a machine string', () => {
    // 10.5px mono beside a 26px orb read as a caption on a picture.
    const rule = css.slice(css.indexOf('.lc-livestep__register {'))
    expect(rule.slice(0, 800)).toContain('font-size: 14px')
    expect(rule.slice(0, 800)).toContain('font-family: var(--lc-font-ui)')
    // 500 because the library's page is INTER at 400 and Geist at 400 is a
    // lighter face -- matching the number does not match the picture.
    expect(rule.slice(0, 800)).toContain('font-weight: 500')
  })

  it('scales no orb at all', () => {
    expect(css).not.toContain('transform: scale(1.3)')
  })
})
