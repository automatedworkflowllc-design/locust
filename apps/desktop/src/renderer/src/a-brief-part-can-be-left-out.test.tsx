import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HandoffDivider } from './components/HandoffDivider.js'
import COMPOSER from './components/Composer.tsx?raw'
import { handoffPreviewLine, handoffPreviewParts, joinerBefore } from './handoffPreview.js'

/**
 * A BRIEF PART CAN BE LEFT OUT (0.527, product ideas round four: "with a way
 * to drop a section"). Under the box, the parts of a reply on another runtime
 * that may go each carry a control; what the person left out is said, with a
 * way to put it back, and the divider says it after the switch.
 */
const switched = (extra: Partial<{ kept: string[]; omitted: string[]; unsettledCount: number; leftOutByYou: string[] }> = {}) =>
  ({ kind: 'switch', fromRuntime: 'Codex CLI', kept: ['task', 'earlier', 'unsettled', 'settled', 'summary'], omitted: [], unsettledCount: 1, taskByFile: false, taskClipped: false, ...extra }) as const

describe('the parts of a brief', () => {
  it('marks the earlier messages, the finished steps and the last reply as droppable, and nothing else', () => {
    const parts = handoffPreviewParts(switched())
    expect(parts?.kind).toBe('parts')
    if (parts?.kind !== 'parts') return
    expect(parts.carried.map((entry) => [entry.name, entry.droppable])).toEqual([
      ['task', false],
      ['earlier', true],
      ['unsettled', false],
      ['settled', true],
      ['summary', true]
    ])
  })

  it('says what the person left out, in their words', () => {
    expect(handoffPreviewLine(switched({ kept: ['task', 'earlier'], unsettledCount: 0, leftOutByYou: ['summary'] }))).toBe(
      'It carries the task and the earlier messages. You left out its last reply.'
    )
  })

  it('reads the same from an older host that sends no choice', () => {
    expect(handoffPreviewLine(switched({ kept: ['task'], unsettledCount: 0 }))).toBe('It carries the task.')
  })

  it('joins the parts as a sentence does', () => {
    expect([0, 1, 2].map((index) => joinerBefore(index, 3))).toEqual(['', ', ', ' and '])
    expect(joinerBefore(1, 2)).toBe(' and ')
  })
})

describe('the composer', () => {
  const source = COMPOSER

  it('puts a control on each part that may go, and a way to put them back', () => {
    expect(source).toContain('aria-label={`Leave out ${entry.words}`}')
    expect(source).toContain('Put back')
  })

  it('sends the choice with the message only when it crosses runtimes', () => {
    expect(source).toContain('continuation === undefined || leaveOut.length === 0 ? undefined : { leaveOut }')
  })
})

describe('the divider after the switch', () => {
  it('says what the person left out, plainly, beside what did not fit', () => {
    const html = renderToStaticMarkup(
      <HandoffDivider from="codex" to="claude" at={undefined} unsettledCount={0} omittedBriefing={['earlier']} leftOutByYou={['summary', 'settled']} />
    )
    expect(html).toContain('Left out of the summary to fit: the earlier messages.')
    expect(html).toContain('You left out its last reply and the steps it finished.')
  })

  it('says nothing more when nothing was left out', () => {
    const html = renderToStaticMarkup(<HandoffDivider from="codex" to="claude" at={undefined} unsettledCount={0} omittedBriefing={[]} />)
    expect(html).not.toContain('You left out')
  })
})
