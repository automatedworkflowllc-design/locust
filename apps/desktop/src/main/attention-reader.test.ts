import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../shared/ipc.js'
import { createAttentionReader } from './attention-reader.js'

const reply = (text: string) => ({ type: 'message.delta', sourceAdapter: 'claude', payload: { itemId: 'm1', operation: 'append', text, final: true } })
const limit = (message: string) => ({ type: 'route.limit_detected', sourceAdapter: 'claude', payload: { kind: 'quota-exhausted', message } })
const completed = { type: 'run.completed', sourceAdapter: 'claude', payload: {} }

function harness(input: { readonly phase: string; readonly events: readonly unknown[]; readonly owner?: string }) {
  const said: string[] = []
  const reader = createAttentionReader({
    ledger: { getMission: async () => ({ phase: input.phase, events: input.events }) as never },
    teammates: {
      list: async () => [{ teammateId: 'tm_wren', name: 'Wren' } as PublicTeammate],
      missionOwners: async (): Promise<Readonly<Record<string, string>>> => (input.owner === undefined ? {} : { mission_1: input.owner })
    },
    attention: {
      decisionAsked: (name, question) => {
        said.push(`decision:${name ?? '-'}:${question}`)
        return true
      },
      limitHit: (name, runtime, message) => {
        said.push(`limit:${name ?? '-'}:${runtime}:${message ?? '-'}`)
        return true
      }
    }
  })
  return { said, reader }
}

const ASK = 'I can do this two ways.\n<locust-ask>\nWhich database?\n- Postgres :: what we run today\n- SQLite :: no server\n</locust-ask>'

describe('what a run ending says to a person who stepped away', () => {
  it('a decision card in a completed reply is a question from the teammate', async () => {
    const h = harness({ phase: 'completed', events: [reply(ASK), completed], owner: 'tm_wren' })
    await h.reader.onRunEnded({ missionId: 'mission_1' })
    expect(h.said).toEqual(['decision:Wren:Which database?'])
  })

  it('a run stopped at its account limit says so, with the runtime and its own words', async () => {
    const h = harness({ phase: 'interrupted', events: [limit('You have hit your weekly limit.')], owner: 'tm_wren' })
    await h.reader.onRunEnded({ missionId: 'mission_1' })
    expect(h.said).toEqual(['limit:Wren:claude:You have hit your weekly limit.'])
  })

  it('a limit the run went on to complete past is not a limit; a plain completion says nothing', async () => {
    const past = harness({ phase: 'completed', events: [limit('rate'), completed, reply('Done.')], owner: 'tm_wren' })
    await past.reader.onRunEnded({ missionId: 'mission_1' })
    expect(past.said).toEqual([])
    const plain = harness({ phase: 'completed', events: [reply('All done, nothing to ask.'), completed], owner: 'tm_wren' })
    await plain.reader.onRunEnded({ missionId: 'mission_1' })
    expect(plain.said).toEqual([])
  })

  it('a decision in a run that did not complete is not asked; nobody\'s conversation is unnamed', async () => {
    const failed = harness({ phase: 'failed', events: [reply(ASK)], owner: 'tm_wren' })
    await failed.reader.onRunEnded({ missionId: 'mission_1' })
    expect(failed.said).toEqual([])
    const nobody = harness({ phase: 'completed', events: [reply(ASK), completed] })
    await nobody.reader.onRunEnded({ missionId: 'mission_1' })
    expect(nobody.said).toEqual(['decision:-:Which database?'])
  })
})
