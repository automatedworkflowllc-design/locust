import { describe, expect, it } from 'vitest'

import { handoffPreviewLine } from './handoffPreview.js'

/**
 * A REPLY ON ANOTHER RUNTIME SAYS WHAT IT CARRIES, before it is sent (0.517).
 * The host composes the brief as the send would (HANDOFF_PREVIEW_CHANNEL);
 * this is how that reads under the box.
 */
const switched = (extra: Partial<{ kept: string[]; omitted: string[]; unsettledCount: number; taskByFile: boolean; taskClipped: boolean }> = {}) =>
  ({ kind: 'switch', fromRuntime: 'OpenCode', kept: ['task', 'earlier', 'settled', 'summary'], omitted: [], unsettledCount: 0, taskByFile: false, taskClipped: false, ...extra }) as const

describe('what a handoff carries, in words', () => {
  it('names each part carried, in the order it is read', () => {
    expect(handoffPreviewLine(switched())).toBe('It carries the task, the earlier messages, the steps it finished and its last reply.')
  })

  it('says what was left out to fit', () => {
    expect(handoffPreviewLine(switched({ kept: ['task', 'settled'], omitted: ['summary', 'earlier'] }))).toBe(
      'It carries the task and the steps it finished. Left out to fit: its last reply and the earlier messages.'
    )
  })

  it('counts the steps that never reported back, and leaves them out of the words when there are none', () => {
    expect(handoffPreviewLine(switched({ kept: ['task', 'unsettled'], unsettledCount: 2 }))).toBe('It carries the task and 2 steps that never reported back.')
    expect(handoffPreviewLine(switched({ kept: ['task', 'unsettled'], unsettledCount: 0 }))).toBe('It carries the task.')
  })

  it('says when the task goes as a file, or only its start fits', () => {
    expect(handoffPreviewLine(switched({ kept: ['task'], taskByFile: true }))).toBe('It carries the task, as a file.')
    expect(handoffPreviewLine(switched({ kept: ['task'], taskClipped: true }))).toBe('It carries the start of the task.')
  })

  it('says a refusal before the send, and nothing for a reply on the same runtime', () => {
    expect(handoffPreviewLine({ kind: 'refused', message: 'That conversation is too long to carry to another runtime with this reply.' })).toBe(
      'Not sent as it is: That conversation is too long to carry to another runtime with this reply.'
    )
    expect(handoffPreviewLine({ kind: 'same' })).toBeUndefined()
    expect(handoffPreviewLine(undefined)).toBeUndefined()
  })
})
