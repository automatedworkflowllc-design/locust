import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { botAvatarTypes } from 'bot-avatars'

import {
  ACCESSORY_COUNT,
  BOT_SHAPES,
  HEADWEAR_COUNT,
  MOUTH_COUNT,
  botFor,
  cleanAvatar,
  isAvatarSpec,
  seedAvatar,
  shuffledAvatar
} from '../../shared/avatar.js'
import type { AvatarSpec } from '../../shared/avatar.js'
import type { FaceActivity } from './faceState.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { TeammateBot, botMotion } from './components/TeammateBot.js'

/**
 * EVERY TEAMMATE IS A BOT.
 *
 * Colin, 2026-09-22: "we're going to have to make miniature versions of the
 * little bots for our sidebar as well and chat as well and teammate picker
 * panel". His picks: idle keeps still ("ill run with your suggestion"),
 * Locust's own two join the shapes ("why not both? its our branding"), more
 * colours ("add as much as youd like"), and randomize AND choose ("we could
 * just have a choose your avatar option or both").
 */

describe('the shapes', () => {
  it("are the library's eighteen, then Locust's own two", () => {
    expect(BOT_SHAPES.slice(0, 18)).toEqual(botAvatarTypes)
    expect(BOT_SHAPES.slice(18)).toEqual(['hopper', 'swarm'])
  })
})

describe("a teammate's bot", () => {
  it('is derived from the seeded look, so every teammate made before bots has one that never changes', () => {
    const look = seedAvatar('tm_wren')
    expect(botFor(look)).toEqual(botFor(seedAvatar('tm_wren')))
  })

  it('can be any of the twenty, from the looks the seed can make', () => {
    const reached = new Set<string>()
    for (let headwear = 0; headwear < HEADWEAR_COUNT; headwear += 1)
      for (let accessory = 0; accessory < ACCESSORY_COUNT; accessory += 1)
        for (let mouth = 0; mouth < MOUTH_COUNT; mouth += 1)
          reached.add(botFor({ headwear, accessory, mouth } as AvatarSpec).shape)
    expect([...reached].sort()).toEqual([...BOT_SHAPES].sort())
  })

  it('is the one the person picked, when they picked one', () => {
    const picked: AvatarSpec = { ...seedAvatar('tm_wren'), bot: { shape: 'hopper', face: 'mouth' } }
    expect(botFor(picked)).toEqual({ shape: 'hopper', face: 'mouth' })
  })

  it('gives way to the derived one on a shuffle, so shuffling moves through the bots', () => {
    const picked: AvatarSpec = { ...seedAvatar('tm_wren'), bot: { shape: 'hopper', face: 'mouth' } }
    const next = shuffledAvatar(picked)
    expect(next.bot).toBeUndefined()
    expect(botFor(next).shape).not.toBe(botFor(shuffledAvatar(next)).shape)
  })

  it('is validated, and nothing but the known fields reaches disk', () => {
    expect(isAvatarSpec({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'ghost', face: 'eyes' } })).toBe(true)
    expect(isAvatarSpec({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'robot', face: 'eyes' } })).toBe(false)
    expect(isAvatarSpec({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'ghost', face: 'nose' } })).toBe(false)
    const extra = { headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'ghost', face: 'eyes', size: 900 }, script: 'x' } as unknown as AvatarSpec
    expect(cleanAvatar(extra)).toEqual({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'ghost', face: 'eyes' } })
  })
})

describe('how a bot moves', () => {
  it('only work moves: idle, blocked and done keep still; at full motion working hops, the rest look around', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    const summary = Object.fromEntries(all.map((activity) => {
      const motion = botMotion(activity, 'full')
      return [activity, motion.paused ? 'still' : motion.state]
    }))
    expect(summary).toEqual({
      thinking: 'default',
      working: 'working',
      delegating: 'working',
      responding: 'default',
      waiting: 'default',
      receiving: 'default',
      blocked: 'still',
      done: 'still',
      idle: 'still'
    })
  })
})

describe('what a teammate bot draws', () => {
  const look: AvatarSpec = { ...seedAvatar('tm_atlas'), bot: { shape: 'droid', face: 'eyes' } }

  it('keeps the hooks the face had: the activity, the teammate, and its own shape', () => {
    const html = renderToStaticMarkup(<TeammateBot hue="teal" avatar={look} size={26} activity="working" teammateId="tm_atlas" />)
    expect(html).toMatch(/class="lc-face lc-bot[^"]*"/)
    expect(html).toContain('data-activity="working"')
    expect(html).toContain('data-bot="droid"')
    expect(html).toContain('data-teammate="tm_atlas"')
    expect(html).toContain('aria-hidden="true"')
  })

  it("wears Locust's marks: the amber ring and dot of a teammate waiting on you", () => {
    const html = renderToStaticMarkup(<TeammateBot hue="blue" avatar={look} activity="waiting" presence="approval" />)
    expect(html).toContain('lc-bot__ring')
    expect(html).toContain('lc-presence--amber')
    expect(renderToStaticMarkup(<TeammateBot hue="blue" avatar={look} />)).not.toContain('lc-bot__ring')
  })

  it('answers to the name where it stands in for one', () => {
    const html = renderToStaticMarkup(<TeammateBot hue="rose" avatar={look} name="Atlas" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Atlas"')
  })
})

describe('the new teammate dialog', () => {
  const html = renderToStaticMarkup(
    <NewTeammateDialog error={undefined} mode="auto" onCancel={() => undefined} onCreate={() => undefined} />
  )

  it('offers every shape to choose from, and the face', () => {
    const look = html.slice(html.indexOf('aria-label="Look"'))
    expect((look.match(/class="lc-look( is-selected)?"/g) ?? []).length).toBe(20)
    expect(html).toContain('aria-label="Hopper, a Locust"')
    expect(html).toContain('aria-label="Swarm, a Locust"')
    expect(html).toContain('aria-label="Face"')
  })

  it('keeps Shuffle, once, with the look it shuffles', () => {
    expect((html.match(/Shuffle look/g) ?? []).length).toBe(1)
    expect(html.indexOf('Shuffle look')).toBeGreaterThan(html.indexOf('class="lc-lookhead"'))
  })

  it('has nine colours', () => {
    const colours = html.slice(html.indexOf('aria-label="Avatar colour"'), html.indexOf('class="lc-lookhead"'))
    expect((colours.match(/role="radio"/g) ?? []).length).toBe(9)
  })
})
