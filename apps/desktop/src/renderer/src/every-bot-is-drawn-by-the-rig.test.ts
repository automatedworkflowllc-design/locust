import { describe, expect, it } from 'vitest'
import { botAvatarPalette, botAvatarPresets, botAvatarShapes, botAvatarTypes, shade } from 'bot-avatars'

import { bodyColorOf, outlineOf, pointerPull } from './components/Bot.js'
import { LOCUST_BOTS } from './locustBots.js'

/**
 * EVERY BOT IS DRAWN BY THE RIG (0.300).
 *
 * The library's eighteen used to be its own BotAvatar, which keeps its rig to
 * itself -- so a teammate that finished could not hop and two could not look
 * at each other (Colin's "have fun" list: "you can run all those"). They are
 * drawn now the way Locust's own two always were, from the library's
 * exported pieces. That each draws exactly as BotAvatar drew it was checked
 * pixel for pixel on a page, all eighteen at three sizes, three colours and
 * both faces -- 324 of 324 identical, where a colour, a face or a shape apart
 * differs by hundreds to thousands of pixels (probe-bots-drawn-alike). These
 * hold the three things that check depended on.
 */

describe('the outline', () => {
  it("is the library's own for its eighteen: its path, its face and where it sits", () => {
    for (const type of botAvatarTypes) {
      const outline = outlineOf(type)
      const preset = botAvatarPresets[type]
      expect(outline.key).toBe(type)
      expect(outline.body).toBe(botAvatarShapes[type])
      expect([outline.face, outline.faceX, outline.faceY, outline.faceScale]).toEqual([preset.face, preset.faceX, preset.faceY, preset.faceScale])
      expect(outline.turn).toBe(1)
    }
  })

  it("is Locust's own for its two, as it always was", () => {
    const hopper = outlineOf('hopper')
    expect(hopper.key).toBe('locust-hopper')
    expect(hopper.body).toBe(LOCUST_BOTS.hopper.body)
    expect(hopper.partsDepth).toBe(LOCUST_BOTS.hopper.partsDepth)
    expect(outlineOf('swarm').turn).toBe(LOCUST_BOTS.swarm.turn)
  })
})

describe('the colour', () => {
  it("is BotAvatar's treatment for a library shape: a hue a touch more vivid, the palette more so", () => {
    expect(bodyColorOf('droid', '#5b8def')).toBe(shade('#5b8def', 0, 0.075))
    expect(bodyColorOf('ghost', undefined)).toBe(shade(botAvatarPresets.ghost.color, 0, 0.25))
  })

  it("is flat for Locust's own, which never took the treatment", () => {
    expect(bodyColorOf('hopper', '#c7d45a')).toBe('#c7d45a')
    expect(bodyColorOf('swarm', undefined)).toBe(botAvatarPalette.alien)
  })
})

describe('following a pointer, as BotAvatar did', () => {
  // A 96px bot's canvas is 144px square; its head sits 9.6px below the middle.
  const box = { left: 0, top: 0, width: 144, height: 144 }
  const head = { x: 72, y: 72 + 9.6 }

  it('looks straight at a pointer within a head width', () => {
    const pull = pointerPull(box, head.x + 48, head.y)
    expect(pull.strength).toBe(1)
    expect(pull.x).toBeCloseTo(0.5)
    expect(pull.y).toBeCloseTo(0)
  })

  it('lets go by three head widths, and never looks further than one head across', () => {
    const halfway = pointerPull(box, head.x + 192, head.y)
    expect(halfway.strength).toBeCloseTo(0.5)
    expect(halfway.x).toBeCloseTo(1)
    expect(pointerPull(box, head.x + 400, head.y).strength).toBe(0)
  })
})
