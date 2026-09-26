import { describe, expect, it } from 'vitest'

import { mentionAt, mentionChoices, mentionCompleted, namesSaid, withoutMention } from './roomMentions.js'

/**
 * ASK ONE TEAMMATE IN A ROOM (0.371): an @ in the room's box opens its
 * members; the one picked becomes a tile, and the @ leaves the text.
 */
const WREN = { teammateId: 'tm_wren', name: 'Wren' }
const PIP = { teammateId: 'tm_pip', name: 'Pip' }
const PIPPA = { teammateId: 'tm_pippa', name: 'Pippa' }
const members = [WREN, PIP, PIPPA]

describe('the @ being typed', () => {
  it('is found at the caret, at the start or after a space', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('@Wr', 3)).toEqual({ start: 0, query: 'Wr' })
    expect(mentionAt('hi @P', 5)).toEqual({ start: 3, query: 'P' })
  })

  it('is not an address, a finished word, or a word the caret is not in', () => {
    expect(mentionAt('mail pip@example.com', 20)).toBeUndefined()
    expect(mentionAt('@Wren ', 6)).toBeUndefined()
    expect(mentionAt('@Wren and more', 14)).toBeUndefined()
    expect(mentionAt('plain text', 10)).toBeUndefined()
  })
})

describe('who an @ offers', () => {
  it('is every member not already asked whose name starts with what was typed, in the room’s order', () => {
    expect(mentionChoices(members, [], '').map((member) => member.name)).toEqual(['Wren', 'Pip', 'Pippa'])
    expect(mentionChoices(members, [], 'pi').map((member) => member.name)).toEqual(['Pip', 'Pippa'])
    expect(mentionChoices(members, ['tm_pip'], 'pi').map((member) => member.name)).toEqual(['Pippa'])
    expect(mentionChoices(members, [], 'x')).toEqual([])
  })
})

describe('picking one', () => {
  it('takes the @-word out, leaving one space and none at the start', () => {
    expect(withoutMention('@Wr', { start: 0, query: 'Wr' })).toEqual({ text: '', caret: 0 })
    expect(withoutMention('@Wren tell me', { start: 0, query: 'Wren' })).toEqual({ text: 'tell me', caret: 0 })
    expect(withoutMention('so @Pi what now', { start: 3, query: 'Pi' })).toEqual({ text: 'so what now', caret: 3 })
    expect(withoutMention('ask @Pip', { start: 4, query: 'Pip' })).toEqual({ text: 'ask ', caret: 4 })
  })

  it('happens by itself when a whole name is typed and then a space', () => {
    const done = mentionCompleted(members, [], '@pip ', 5)
    expect(done?.member).toBe(PIP)
    expect(done?.mention).toEqual({ start: 0, query: 'pip' })
    // Only a whole name, only once, and only on the space.
    expect(mentionCompleted(members, [], '@Pi ', 4)).toBeUndefined()
    expect(mentionCompleted(members, ['tm_pip'], '@Pip ', 5)).toBeUndefined()
    expect(mentionCompleted(members, [], '@Pip', 4)).toBeUndefined()
    expect(mentionCompleted(members, [], '@Pipx', 5)).toBeUndefined()
  })
})

describe('the names, as a sentence says them', () => {
  it('reads as a person would write it', () => {
    expect(namesSaid(['Wren'])).toBe('Wren')
    expect(namesSaid(['Wren', 'Pip'])).toBe('Wren and Pip')
    expect(namesSaid(['Wren', 'Pip', 'Pippa'])).toBe('Wren, Pip and Pippa')
    expect(namesSaid([])).toBe('')
  })
})
