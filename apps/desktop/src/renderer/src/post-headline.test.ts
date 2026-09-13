import { describe, expect, it } from 'vitest'

import { postHeadline } from './components/RoomScreen.js'

/**
 * One line that answers "is anything wrong" on arrival.
 *
 * From the design agent's reply on following eight, 2026-09-09. Their
 * argument starts from a sentence of mine and takes it further than I did:
 * nobody watches a room while it runs, so "is anything wrong" is asked ONCE,
 * on arrival — and a question asked once needs a sentence that is true when
 * you look, not a view somebody has to watch. Eight states fit in one line
 * at any width.
 *
 * The rule is the trace line's: **count the ordinary, name the exceptional.**
 * One or two in a state get named, because that is the fact you want. Three
 * or more goes back to a number, because four names is a list and a list is
 * not a glance.
 *
 * They also declined to build the thing I asked for. "Who is furthest along"
 * has no answer: one teammate writes 500 lines through nine tool calls,
 * another answers in a sentence, so "further along" has no denominator — and
 * inventing one is the mistake Astra's finding refuses twice over.
 */

const member = (name: string, state: 'answered' | 'replied' | 'running' | 'failed' | 'waiting') => ({
  name,
  state
})

describe('the line above a post', () => {
  it('says so when everyone answered', () => {
    const all = Array.from({ length: 8 }, (_unused, i) => member(`M${String(i)}`, 'answered'))
    expect(postHeadline(all)).toBe('8 asked · all answered')
  })

  it('names one or two, and counts more', () => {
    const some = [
      ...Array.from({ length: 6 }, (_unused, i) => member(`M${String(i)}`, 'answered')),
      member('Otto', 'running'),
      member('Sable', 'failed')
    ]
    expect(postHeadline(some)).toBe('8 asked · 6 answered · Otto running · Sable failed')

    const many = [
      ...Array.from({ length: 5 }, (_unused, i) => member(`M${String(i)}`, 'answered')),
      ...Array.from({ length: 3 }, (_unused, i) => member(`F${String(i)}`, 'failed'))
    ]
    // Four names is a list and a list is not a glance.
    expect(postHeadline(many)).toBe('8 asked · 5 answered · 3 failed')
  })

  it('counts a queue separately from what was asked', () => {
    // Waiting members were NOT asked yet, so they are not in the asked
    // count — the number has to mean what it says.
    const mixed = [
      ...Array.from({ length: 2 }, (_unused, i) => member(`A${String(i)}`, 'answered')),
      ...Array.from({ length: 4 }, (_unused, i) => member(`R${String(i)}`, 'running')),
      ...Array.from({ length: 2 }, (_unused, i) => member(`W${String(i)}`, 'waiting'))
    ]
    expect(postHeadline(mixed)).toBe('6 asked · 2 answered · 4 running · 2 waiting for a slot')
  })

  it('writes no zero', () => {
    // A zero segment is absent, not written as zero. "0 failed" is noise
    // that arrives on every healthy post.
    const clean = [member('A', 'answered'), member('B', 'running')]
    const said = postHeadline(clean)
    expect(said).not.toContain('0 ')
    expect(said).toBe('2 asked · 1 answered · B running')
  })

  it('says something even for a post nothing came back from', () => {
    const silent = [member('A', 'running'), member('B', 'running')]
    expect(postHeadline(silent)).toBe('2 asked · A and B running')
  })

  /*
   * Astra, 2026-09-13: two cards both saying running, headline saying
   * all answered. Having spoken is not having finished, and the whole
   * value of this line is knowing whether anything is left to wait for.
   */
  it('never says all answered while someone is still working', () => {
    const both = [member("A", "replied"), member("B", "replied")]
    expect(postHeadline(both)).toBe("2 asked · A and B replied, still working")
    expect(postHeadline(both)).not.toContain("all answered")
  })

  it("counts the repliers past two, like every other state", () => {
    const three = [member("A", "replied"), member("B", "replied"), member("C", "replied")]
    expect(postHeadline(three)).toBe("3 asked · 3 replied, still working")
  })

  it("keeps a finished one separate from one that only spoke", () => {
    const mixed = [member("A", "answered"), member("B", "replied")]
    expect(postHeadline(mixed)).toBe("2 asked · 1 answered · B replied, still working")
  })
})
