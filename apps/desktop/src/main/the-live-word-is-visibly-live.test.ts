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

  it('scales no orb at all', () => {
    /*
     * A DECISION, not an omission. Colin asked for one a size up, looked at
     * the result and stopped the idea: "with how bad the other one looks
     * enlarged id be wary to even touch the other one, just revert to
     * previous size for now".
     *
     * These are canvas drawings authored for their size. The library takes 64
     * or 20 and throws on anything else, so a bigger orb can only be a
     * transform of a 20px raster -- every stroke 30% softer with it, and on a
     * mark this small that reads as broken rather than as big.
     */
    expect(css).not.toContain(".lc-livestep__orb[data-orb='")
    const box = css.slice(css.indexOf('.lc-livestep__orb {'))
    expect(box.slice(0, 160)).toContain('width: 20px')
  })
})
