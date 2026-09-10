import { describe, expect, it } from 'vitest'

import {
  askConsequence,
  askHeadline,
  askLede,
  askPlaceholder,
  askRefusal,
  askSendLabel,
  namesInWords,
  UNTITLED_ROOM
} from './askWho.js'
import { MAX_ROOM_TEAMMATES } from '../../shared/live-missions.js'

/**
 * Asking more than one teammate at once.
 *
 * Colin, 2026-09-09: "how does one create a room for teammates, i cant figure
 * it out lol." The design agent's answer, 2026-09-10: a room is the
 * consequence of the ask, not its prerequisite -- so the composer's contract
 * gains a word and the Rooms screen stops having to be a factory.
 *
 * Every string here is a sentence a person reads, so they are checked as
 * sentences rather than as templates.
 */

describe('who the home composer is asking', () => {
  it('says their names the way a person would', () => {
    expect(namesInWords(['Wren'])).toBe('Wren')
    expect(namesInWords(['Wren', 'Atlas'])).toBe('Wren and Atlas')
    expect(namesInWords(['Wren', 'Atlas', 'Juno'])).toBe('Wren, Atlas and Juno')
    // Never an empty sentence fragment.
    expect(namesInWords([])).toBe('nobody')
  })

  it('heads the screen with them', () => {
    expect(askHeadline(['Wren'])).toBe('Ask Wren')
    expect(askHeadline(['Wren', 'Atlas'])).toBe('Ask Wren and Atlas')
    expect(askHeadline([])).toBe('Ask a teammate')
  })

  it('changes the box and the button only when the set really has more than one', () => {
    expect(askPlaceholder(['Wren'])).toBe('Message Wren…')
    expect(askPlaceholder(['Wren', 'Atlas'])).toBe('Ask 2 teammates…')
    expect(askSendLabel(1)).toBe('Send')
    expect(askSendLabel(2)).toBe('Ask all')
    // One teammate is the app exactly as it was.
    expect(askLede(1)).toContain('own runtime and model')
    expect(askLede(2)).toContain('land together in a room')
  })

  it('says what sending will do, before it is pressed', () => {
    const said = askConsequence(['Wren', 'Atlas'])
    expect(said).toContain('Start 2 conversations')
    expect(said).toContain(UNTITLED_ROOM)
    expect(said).toContain('Wren and Atlas')
    // The two things a person would otherwise have to discover: that the room
    // can be renamed, and that it can be posted to again without re-picking.
    expect(said).toContain('rename it there')
    expect(said).toContain('without picking anyone')
  })

  it('says nothing at all for one teammate, because nothing new happens', () => {
    // Narrating "send one message to one teammate" would be noise on the one
    // path that has always worked this way.
    expect(askConsequence(['Wren'])).toBeUndefined()
    expect(askConsequence([])).toBeUndefined()
  })

  it('uses the room’s real name once it has one', () => {
    expect(askConsequence(['Wren', 'Atlas'], 'Release crew')).toContain('“Release crew”')
    expect(askConsequence(['Wren', 'Atlas'], 'Release crew')).not.toContain(UNTITLED_ROOM)
  })

  it('refuses a set too big to be a room, before the press rather than after', () => {
    // `createRoom` would fail with "A room needs between 1 and 8 teammates",
    // which is a sentence about a thing the person never asked to make.
    expect(askRefusal(MAX_ROOM_TEAMMATES)).toBeUndefined()
    expect(askRefusal(1)).toBeUndefined()
    const refused = askRefusal(MAX_ROOM_TEAMMATES + 2)
    expect(refused).toContain(String(MAX_ROOM_TEAMMATES))
    expect(refused).toContain('Untick 2')
  })

  it('agrees with the cap it is quoting', () => {
    // The number in the sentence is the constant, not a copy of it.
    expect(askRefusal(MAX_ROOM_TEAMMATES + 1)).toContain(`up to ${String(MAX_ROOM_TEAMMATES)} teammates`)
  })
})
