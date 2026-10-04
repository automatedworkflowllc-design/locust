import { crc32, deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../shared/ipc.js'
import { seedAvatar } from '../shared/avatar.js'
import { TEAM_CARD_KEYWORD, freeName, readTeamCard, teamCardOf } from '../shared/team-card.js'
import { isPng, readTextChunk, withTextChunk } from './png-text.js'

/**
 * A TEAM TRAVELS AS A PICTURE OF ITSELF (0.398).
 *
 * The rooms-and-peers research, item 8: Buzz shares a team as `.team.png`.
 * A Locust team card is an image with the team written into it as data --
 * and only the part of the team that is safe and useful to hand to someone
 * else.
 */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}
/** A real 1x1 PNG, built by hand. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
  chunk('IDAT', deflateSync(Buffer.from([0, 200, 240, 74]))),
  chunk('IEND', Buffer.alloc(0))
])
/** Every chunk's CRC checks, and IEND is last: the image is still an image. */
function wellFormed(png: Buffer): boolean {
  let at = 8
  let last = ''
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const typeAndData = png.subarray(at + 4, at + 8 + length)
    if ((crc32(typeAndData) >>> 0) !== png.readUInt32BE(at + 8 + length)) return false
    last = png.subarray(at + 4, at + 8).toString('latin1')
    at += 12 + length
  }
  return at === png.length && last === 'IEND'
}

describe('a text chunk in a PNG', () => {
  it('goes in and comes back, names that are not Latin-1 included, and the image stays well formed', () => {
    const written = withTextChunk(PNG, TEAM_CARD_KEYWORD, '{"name":"Zoë 🦗"}')
    expect(isPng(written)).toBe(true)
    expect(wellFormed(written)).toBe(true)
    expect(readTextChunk(written, TEAM_CARD_KEYWORD)).toBe('{"name":"Zoë 🦗"}')
  })

  it('replaces the one already there rather than stacking a second', () => {
    const twice = withTextChunk(withTextChunk(PNG, TEAM_CARD_KEYWORD, 'first'), TEAM_CARD_KEYWORD, 'second')
    expect(readTextChunk(twice, TEAM_CARD_KEYWORD)).toBe('second')
    expect(twice.toString('latin1').split('tEXt').length - 1).toBe(1)
  })

  it('reads nothing from an image without one, or from something that is not a PNG', () => {
    expect(readTextChunk(PNG, TEAM_CARD_KEYWORD)).toBeUndefined()
    expect(readTextChunk(Buffer.from('not an image'), TEAM_CARD_KEYWORD)).toBeUndefined()
    expect(() => withTextChunk(Buffer.from('not an image'), TEAM_CARD_KEYWORD, 'x')).toThrow('That is not a PNG image.')
  })
})

const teammate = (overrides: Partial<PublicTeammate>): PublicTeammate => ({
  teammateId: 'tm_wren',
  name: 'Wren',
  role: 'Code & Migrations' as PublicTeammate['role'],
  hue: 'lime',
  avatar: seedAvatar('tm_wren'),
  createdAt: '2026-09-27T05:00:00.000Z',
  ...overrides
})

describe('the card', () => {
  it('carries name, role, look and model -- and no id, folder, limit or model of your own', () => {
    const card = teamCardOf([
      teammate({ route: { runtime: 'claude', model: 'opus', mode: 'accept-edits', effort: 'high' }, monthlyLimitUsd: 20, worktree: true } as Partial<PublicTeammate>),
      teammate({ teammateId: 'tm_juno', name: 'Juno', route: { runtime: 'opencode', model: 'own-1a2b3c4d/acme-70b', mode: 'ask' } })
    ])
    expect(card.schema).toBe(1)
    expect(card.teammates[0]).toEqual({ name: 'Wren', role: 'Code & Migrations', hue: 'lime', avatar: seedAvatar('tm_wren'), route: { runtime: 'claude', model: 'opus', mode: 'accept-edits', effort: 'high' } })
    expect(card.teammates[1]).not.toHaveProperty('route')
    expect(JSON.stringify(card)).not.toMatch(/tm_|monthlyLimitUsd|worktree|own-1a2b/)
  })

  it('never brings a teammate in on Auto: a picture from someone else does not widen what runs unasked', () => {
    const read = readTeamCard({ schema: 1, teammates: [{ name: 'Rook', role: 'Custom', hue: 'blue', route: { runtime: 'codex', model: 'gpt', mode: 'auto' } }] })
    expect((read?.[0]?.route as { mode?: string } | undefined)?.mode).toBe('accept-edits')
  })

  it('is refused when it is not a Locust team card', () => {
    expect(readTeamCard({ schema: 2, teammates: [] })).toBeUndefined()
    expect(readTeamCard({ teammates: [] })).toBeUndefined()
    expect(readTeamCard('hello')).toBeUndefined()
  })

  it('never takes more than twelve teammates from one card', () => {
    const many = { schema: 1, teammates: Array.from({ length: 40 }, (_, index) => ({ name: `T${String(index)}` })) }
    expect(readTeamCard(many)).toHaveLength(12)
  })

  it('gives a teammate whose name is taken the next free one', () => {
    expect(freeName('Wren', new Set(['wren', 'Wren 2']))).toBe('Wren 3')
    expect(freeName('Sable', new Set(['Wren']))).toBe('Sable')
  })
})
