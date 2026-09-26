import { describe, expect, it } from 'vitest'

import { TIDY_PROMPT } from '../../shared/memory-tidy.js'
import { turnPromptLine } from './missionView.js'
import { reviewBrief } from './reviewBrief.js'

/*
 * A TURN A BUTTON STARTED SAYS WHAT WAS ASKED (A1.2).
 *
 * "Tidy up" and "Ask Jimothy for a review" send a page of instructions the
 * host wrote; the bubble drew all of it as though the person had typed it
 * (the 0.317 tidy drive's screenshot). The runtime still gets every word.
 */
describe("the bubble of a turn a button started", () => {
  it('a tidy pass: what the person asked for, not the brief', () => {
    expect(turnPromptLine({ prompt: TIDY_PROMPT })).toBe("Tidy this folder's team memory.")
  })

  it('a tidy pass sent with the brief before 0.372, its example in a code fence: the same', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const before = [TIDY_PROMPT.split(String.fromCharCode(10))[0], 'Suggest at most 10 changes...', fence, '<locust-tidy>', '</locust-tidy>', fence].join(String.fromCharCode(10))
    expect(turnPromptLine({ prompt: before })).toBe("Tidy this folder's team memory.")
  })

  it('a review: whose work, not the review material', () => {
    const brief = reviewBrief({
      request: 'Make the path handler work on Windows.',
      said: 'I normalised the separators.',
      changed: ['src/paths.ts'],
      commands: [],
      ranOn: 'Windows',
      author: 'Jimothy'
    })
    expect(turnPromptLine({ prompt: brief })).toBe("Review Jimothy's work.")
  })

  it("a person's own words, even ones that begin the same way, are left as they are", () => {
    const own = 'Jimothy finished a piece of work and you are reviewing it -- tell me what you think.'
    expect(turnPromptLine({ prompt: own })).toBe(own)
  })
})
