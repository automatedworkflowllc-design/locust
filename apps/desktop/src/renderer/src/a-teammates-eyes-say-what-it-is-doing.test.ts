import { describe, expect, it } from 'vitest'

import type { FaceActivity } from './faceState.js'
import { eyeGlyphsFor } from './components/TeammateBot.js'

/**
 * A TEAMMATE'S EYES SAY WHAT IT IS DOING (0.559).
 *
 * Colin, 2026-10-02: "I kind of like what the codex mascot does with the eyes
 * making them different coding lines. Should we implement that to all of our
 * teammates?" Every teammate, whatever its shape: the rig's eyes become code
 * glyphs for the states that mean work or an outcome, and stay its own where
 * moving eyes say more (talking, listening) or the amber ring already speaks
 * (waiting on you). Looked at, drawn, at 96 and 32: _tools/look-glyph-eyes.mjs.
 */
describe('the glyph each state wears', () => {
  it('is a prompt and a block cursor at work, round eyes in thought, carets when done, crosses when stuck', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    expect(Object.fromEntries(all.map((activity) => [activity, eyeGlyphsFor(activity)?.join('') ?? 'own']))).toEqual({
      thinking: '••',
      working: '>▮',
      delegating: '>▮',
      responding: 'own',
      waiting: 'own',
      receiving: 'own',
      blocked: 'xx',
      done: '^^',
      idle: 'own'
    })
  })

  it('is drawn on a screen only (0.562): a face with no screen keeps its own eyes', () => {
    // Colin: "should the computer eyes be exclusive to the terminal screen?" -- yes. Bot.tsx sets
    // the glyphs only when it wears a screen; see a-teammate-chooses-its-screen.test.tsx for the faces.
    expect(eyeGlyphsFor('working')).toEqual(['>', '▮'])
  })
})
