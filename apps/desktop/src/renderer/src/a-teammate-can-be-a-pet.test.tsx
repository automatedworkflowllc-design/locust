import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { AvatarSpec, PetRef } from '../../shared/avatar.js'
import { setTerminalFaces } from './botLook.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { TeammateBot } from './components/TeammateBot.js'
import { setPetLook } from './pets.js'

/**
 * A TEAMMATE CAN BE A PET (0.563).
 *
 * Colin, 2026-10-03: "theyre just going to be added to the list of potential
 * choices for teammates" -- "just clarity these should be the exact same as
 * teammates" -- and "the new eyes will have to be isolated to our current
 * sprites". So a pet is drawn in a bot's place with a bot's marks (the
 * waiting ring, the presence dot), never with a screen or code eyes, and a
 * pet that cannot be drawn shows the bot instead of an empty box.
 */

const CAT: PetRef = { source: 'bundled', id: 'hoodie-cat' }
const wearing = (pet: PetRef, bot: AvatarSpec['bot'] = { shape: 'droid', face: 'eyes' }): AvatarSpec => ({ ...seedAvatar('tm_pet'), bot, pet })
const facesOf = (html: string): string[] => [...html.matchAll(/data-face="([a-z]+)"/g)].map((found) => found[1]!)

afterEach(() => {
  setPetLook(CAT, undefined)
  setTerminalFaces(true)
})

describe('a teammate wearing a pet', () => {
  it('draws the pet where the bot was, saying what it is doing', () => {
    const html = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(CAT)} size={34} activity="working" teammateId="tm_pet" name="Mochi" />)
    expect(facesOf(html)).toEqual(['pet'])
    expect(html).toContain('data-pet="hoodie-cat"')
    expect(html).toContain('data-pet-state="running"')
    // Still a teammate's face: the same hooks every surface reads.
    expect(html).toContain('data-teammate="tm_pet"')
    expect(html).toContain('aria-label="Mochi"')
  })

  it('keeps a bot’s marks: the waiting ring and the presence dot', () => {
    const html = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(CAT)} size={34} activity="waiting" presence="working" />)
    expect(html).toContain('lc-bot__ring')
    expect(html).toContain('lc-presence')
    expect(html).toContain('data-pet-state="waiting"')
  })

  it('never wears a screen or code eyes, even on a shape that suits one with Terminal faces on', () => {
    setTerminalFaces(true)
    const html = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(CAT, { shape: 'droid', face: 'eyes', screen: true })} size={44} activity="thinking" />)
    expect(facesOf(html)).toEqual(['pet'])
    expect(html).not.toContain('is-bouncing')
  })

  it('shows its bot when the pet cannot be drawn, never an empty box', () => {
    setPetLook(CAT, { status: 'missing', reason: 'That pet is not on this computer.' })
    const html = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(CAT)} size={34} activity="idle" />)
    expect(facesOf(html)).toEqual(['screen'])
    expect(html).not.toContain('data-pet=')
  })
})

describe('the look picker', () => {
  const open = (avatar?: AvatarSpec): string =>
    renderToStaticMarkup(
      <NewTeammateDialog
        onCancel={() => undefined}
        onCreate={() => undefined}
        error={undefined}
        mode="accept-edits"
        {...(avatar === undefined
          ? {}
          : {
              initial: {
                teammateId: 'tm_pet',
                name: 'Mochi',
                hue: 'lime',
                role: 'Docs & QA',
                avatar,
                createdAt: '2026-10-03T00:00:00.000Z'
              }
            })}
      />
    )

  it('lists pets under the bots, with the gallery a click away', () => {
    const html = open()
    expect(html).toContain('aria-label="Pets"')
    expect(html).toContain('Browse the gallery')
    // Nothing is browsed, let alone downloaded, until it is opened.
    expect(html).not.toContain('Pet gallery')
  })

  it('under a pet, steps the face choice aside and shows plain colours', () => {
    const html = open(wearing(CAT))
    expect(html).not.toContain('aria-label="Face"')
    expect(html).toContain('lc-hue__chip')
    // No bot tile is the chosen one while a pet is worn.
    expect(html).not.toMatch(/data-shape="[a-z]+" class="lc-look is-selected"/)
  })

  it('keeps the face choice for a bot', () => {
    const html = open({ ...seedAvatar('tm_bot'), bot: { shape: 'droid', face: 'eyes' } })
    expect(html).toContain('aria-label="Face"')
    expect(html).not.toContain('lc-hue__chip')
  })
})
