import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { BOT_SHAPES, SCREEN_SHAPES, cleanAvatar, isBotSpec, screenSuits } from '../../shared/avatar.js'
import type { AvatarSpec } from '../../shared/avatar.js'
import { setTerminalFaces } from './botLook.js'
import { Bot } from './components/Bot.js'
import { TeammateBot } from './components/TeammateBot.js'

/**
 * A TEAMMATE CHOOSES ITS SCREEN (0.562).
 *
 * Colin, 2026-10-03: "do you think design wise some of the teammates shouldnt
 * have the computer screen/terminal face? if so should we just remove it
 * alright or have it toggleable in the teammate editor" -- then "maybe also a
 * toggle for the computer eyes as well, or should the computer eyes be
 * exclusive to the terminal screen? im happy with any design choice you
 * decide". So: a teammate's face is Eyes, a Mouth or a Screen, chosen in its
 * look; until chosen, a screen goes on the shapes it suits; code eyes are a
 * screen's alone; Settings > Appearance > Terminal faces turns every screen
 * off but Prompt's, whose face it is.
 */

const face = (html: string): string | undefined => /data-face="([a-z]+)"/.exec(html)?.[1]
const avatar = (bot?: AvatarSpec['bot']): AvatarSpec => ({ headwear: 0, accessory: 0, mouth: 0, ...(bot === undefined ? {} : { bot }) })

afterEach(() => setTerminalFaces(true))

describe('which shapes a screen suits', () => {
  it('suits the made, boxy shapes and not the grown, bumpy ones', () => {
    for (const shape of ['droid', 'mech', 'prompt', 'critter', 'square', 'pill', 'hexagon', 'pebble', 'circle', 'ghost', 'cat']) expect(screenSuits(shape), shape).toBe(true)
    for (const shape of ['star', 'flower', 'clover', 'cloud', 'drop', 'blob', 'puddle', 'triangle', 'alien', 'hopper', 'swarm']) expect(screenSuits(shape), shape).toBe(false)
  })

  it('names only shapes that exist', () => {
    for (const shape of SCREEN_SHAPES) expect((BOT_SHAPES as readonly string[]).includes(shape), shape).toBe(true)
  })
})

describe('a look that says whether it wears a screen', () => {
  it('keeps the choice, and refuses anything but true or false', () => {
    expect(isBotSpec({ shape: 'star', face: 'eyes', screen: true })).toBe(true)
    expect(isBotSpec({ shape: 'star', face: 'eyes' })).toBe(true)
    expect(isBotSpec({ shape: 'star', face: 'eyes', screen: 'yes' })).toBe(false)
    expect(cleanAvatar(avatar({ shape: 'droid', face: 'eyes', screen: false })).bot).toEqual({ shape: 'droid', face: 'eyes', screen: false })
    expect(cleanAvatar(avatar({ shape: 'droid', face: 'eyes' })).bot).toEqual({ shape: 'droid', face: 'eyes' })
  })
})

describe('the face a bot wears', () => {
  it('is a screen where the shape suits one, and its own eyes where it does not, until chosen', () => {
    expect(face(renderToStaticMarkup(<Bot type="droid" size={40} />))).toBe('screen')
    expect(face(renderToStaticMarkup(<Bot type="star" size={40} />))).toBe('eyes')
  })

  it('follows the teammate\'s choice either way', () => {
    expect(face(renderToStaticMarkup(<Bot type="star" size={40} screen />))).toBe('screen')
    expect(face(renderToStaticMarkup(<Bot type="droid" size={40} screen={false} />))).toBe('eyes')
    expect(face(renderToStaticMarkup(<TeammateBot hue="blue" avatar={avatar({ shape: 'droid', face: 'eyes', screen: false })} size={40} />))).toBe('eyes')
    expect(face(renderToStaticMarkup(<TeammateBot hue="blue" avatar={avatar({ shape: 'flower', face: 'eyes', screen: true })} size={40} />))).toBe('screen')
  })

  it('is never a screen with Terminal faces off -- but Prompt\'s, whose face it is', () => {
    setTerminalFaces(false)
    expect(face(renderToStaticMarkup(<Bot type="droid" size={40} screen />))).toBe('eyes')
    expect(face(renderToStaticMarkup(<Bot type="prompt" size={40} screen={false} />))).toBe('screen')
  })
})
