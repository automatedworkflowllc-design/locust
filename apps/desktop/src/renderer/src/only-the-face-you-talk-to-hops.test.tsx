import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { AvatarSpec } from '../../shared/avatar.js'
import type { FaceActivity } from './faceState.js'
import { TeammateBot, botMotion } from './components/TeammateBot.js'

/**
 * ONLY THE FACE YOU ARE TALKING TO HOPS.
 *
 * Colin, 2026-09-23, with a frame of the sidebar and the workroom header both
 * hopping the same working teammate: "these two bot versions have the same
 * amount of movement as the one in the chat and its a bit distracting ...
 * besides the one in the chat just give them a slight bounce or look around,
 * the one in the chat can remain as is". And then: "the one in the chat where
 * you're speaking to, all that movement is fine and great ... but its mirrored
 * in the sidebar and the top, lets tame those two down a bit".
 *
 * Which sites ask for the whole performance is held in main/ (it reads the
 * source); this holds what each level does.
 */

const ALL: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']

describe('a subtle bot, everywhere but the conversation', () => {
  it('looks around at work instead of hopping, and bounces a little', () => {
    for (const activity of ['working', 'delegating'] as const) {
      expect(botMotion(activity)).toEqual({ state: 'default', paused: false, jumpEvery: 0, bounces: true })
    }
  })

  it('never flips, whatever it is doing', () => {
    for (const activity of ALL) expect(botMotion(activity).jumpEvery).toBe(0)
  })

  it('bounces only at work: thinking and answering look around, still keeps still', () => {
    const summary = Object.fromEntries(ALL.map((activity) => {
      const motion = botMotion(activity)
      return [activity, motion.paused ? 'still' : motion.bounces ? 'bounce' : 'look']
    }))
    expect(summary).toEqual({
      thinking: 'look',
      working: 'bounce',
      delegating: 'bounce',
      responding: 'look',
      waiting: 'look',
      receiving: 'look',
      blocked: 'still',
      done: 'still',
      idle: 'still'
    })
  })

  it('is what a teammate bot is unless it is told otherwise', () => {
    const look: AvatarSpec = { ...seedAvatar('tm_yurt'), bot: { shape: 'ghost', face: 'eyes' } }
    const html = renderToStaticMarkup(<TeammateBot hue="pearl" avatar={look} size={26} activity="working" teammateId="tm_yurt" />)
    expect(html).toContain('data-motion="subtle"')
    expect(html).toMatch(/class="lc-face lc-bot is-bouncing"/)
    const thinking = renderToStaticMarkup(<TeammateBot hue="pearl" avatar={look} size={26} activity="thinking" />)
    expect(thinking).not.toContain('is-bouncing')
  })
})

describe('the face you are talking to', () => {
  it('keeps the whole performance: it hops at work, and flips on its own schedule', () => {
    expect(botMotion('working', 'full')).toEqual({ state: 'working', paused: false, bounces: false })
    expect(botMotion('thinking', 'full')).toEqual({ state: 'default', paused: false, bounces: false })
    expect(botMotion('thinking', 'full')).not.toHaveProperty('jumpEvery')
  })

  it('does not bounce as well -- it hops', () => {
    const look: AvatarSpec = { ...seedAvatar('tm_yurt'), bot: { shape: 'ghost', face: 'eyes' } }
    const html = renderToStaticMarkup(<TeammateBot hue="pearl" avatar={look} size={26} activity="working" motion="full" />)
    expect(html).toContain('data-motion="full"')
    expect(html).not.toContain('is-bouncing')
  })
})
