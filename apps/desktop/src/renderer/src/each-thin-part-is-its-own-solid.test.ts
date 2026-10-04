import { botAvatarParts } from 'bot-avatars'
import { describe, expect, it } from 'vitest'

import { partPieces } from './components/Bot.js'
import { LOCUST_BOTS } from './locustBots.js'

/**
 * EACH THIN PART ITS OWN SOLID (0.577, bot-avatars 0.2). 0.2 extrudes one
 * path as one solid: the mech's two antennae, kept in one path, drew as a
 * black scribble between them. Handed a list, it draws each piece alone.
 */
describe('a shape\'s thin parts', () => {
  it('are split into one piece per antenna, leg or wing', () => {
    // The library's own: each antenna a stalk and a ball.
    expect(partPieces(botAvatarParts.mech ?? '').length).toBeGreaterThan(1)
    expect(partPieces(LOCUST_BOTS.swarm.parts)).toHaveLength(6)
    expect(partPieces(LOCUST_BOTS.hopper.parts)).toHaveLength(6)
    expect(partPieces(LOCUST_BOTS.critter.parts)).toHaveLength(4)
    expect(partPieces(LOCUST_BOTS.prompt.parts)).toHaveLength(3)
  })

  it('lose nothing in the split: the pieces put back together are the path', () => {
    for (const parts of [botAvatarParts.mech ?? '', LOCUST_BOTS.swarm.parts, LOCUST_BOTS.hopper.parts]) {
      expect(partPieces(parts).join('').replace(/\s+/g, '')).toBe(parts.replace(/\s+/g, ''))
    }
  })

  it('every piece starts with a move, so each is a path of its own', () => {
    for (const shape of Object.values(LOCUST_BOTS)) {
      for (const piece of partPieces(shape.parts)) expect(piece.startsWith('M'), piece.slice(0, 20)).toBe(true)
    }
  })
})
