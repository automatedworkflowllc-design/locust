import { describe, expect, it } from 'vitest'

import { nestedUnder } from '../shared/nested-conversations.js'

/**
 * A CONVERSATION A TEAMMATE STARTED FOR ANOTHER SITS UNDER THE ONE IT CAME
 * FROM (0.463), one level deep, and never hidden by a loop.
 */
const row = (missionId: string, memberIds?: readonly string[]) => ({ missionId, ...(memberIds === undefined ? {} : { memberIds }) })

describe('a relayed conversation', () => {
  it('sits under the conversation any turn of which sent it', () => {
    const rows = [row('m_ask', ['m_ask', 'm_ask2']), row('m_reply')]
    const from: Record<string, string> = { m_reply: 'm_ask2' }
    expect([...nestedUnder(rows, (r) => from[r.missionId])]).toEqual([['m_reply', 'm_ask']])
  })

  it('stays where it was when the conversation it came from is not listed', () => {
    expect([...nestedUnder([row('m_reply')], () => 'm_gone')]).toEqual([])
  })

  it('nests one level only: a reply to a reply sits at the top', () => {
    const rows = [row('m_person'), row('m_juno'), row('m_wren')]
    const from: Record<string, string> = { m_juno: 'm_person', m_wren: 'm_juno' }
    expect([...nestedUnder(rows, (r) => from[r.missionId])]).toEqual([['m_juno', 'm_person']])
  })

  it('hides nothing when two conversations name each other', () => {
    const rows = [row('m_a'), row('m_b')]
    const from: Record<string, string> = { m_a: 'm_b', m_b: 'm_a' }
    expect([...nestedUnder(rows, (r) => from[r.missionId])]).toEqual([])
  })

  it('never nests a conversation under itself', () => {
    expect([...nestedUnder([row('m_a', ['m_a', 'm_a2'])], () => 'm_a2')]).toEqual([])
  })
})
