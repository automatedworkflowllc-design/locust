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
  /*
   * A SCREEN SPEAKS ASCII (2026-10-05). Colin: "i was referring to the
   * terminal eye text themselves being/involving ascii". Waiting on you and a
   * message just in now wear `o o`, eyes on you (the amber ring alone spoke
   * for waiting before); stuck is `> <`, the face of trying -- crosses read as
   * dead more than stuck.
   *
   * AND `o o` AS IT TALKS TO YOU (2026-10-05). Colin: "we dont want them locked
   * behind tool calls the user may never use". Answering, it wore the resting
   * bars; now its eyes are on you while its reply comes in.
   */
  it('is a prompt and a block cursor at work, round eyes in thought, carets when done, `> <` when stuck, `o o` on you', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    expect(Object.fromEntries(all.map((activity) => [activity, eyeGlyphsFor(activity)?.join('') ?? 'own']))).toEqual({
      thinking: '••',
      working: '>▮',
      delegating: '>▮',
      responding: 'oo',
      waiting: 'oo',
      receiving: 'oo',
      blocked: '><',
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
