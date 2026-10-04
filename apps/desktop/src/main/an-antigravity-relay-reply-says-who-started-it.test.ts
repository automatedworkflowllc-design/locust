import type { MissionLedger } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { AgentApi } from './antigravity-host.js'
import { transcriptPathFor } from './antigravity-host.js'
import { createAntigravityMissionService } from './antigravity-mission.js'

/*
 * Code review B4, own runs 3: the relay hands its origin to an Antigravity
 * start, and every other runtime's record writes it down as `startedBy:
 * relay`. Antigravity's dropped it, so after a restart a reply the HOST began
 * -- its prompt a briefing the host wrote -- read as a conversation the
 * person began, with the briefing shown as their words.
 */
describe('an Antigravity run the relay started', () => {
  const run = async (relay: { hop: number; lastMissionOf: Record<string, string> } | undefined): Promise<Record<string, unknown>> => {
    const created: Record<string, unknown>[] = []
    const ledger = {
      createMission: async (input: Record<string, unknown>) => {
        created.push(input)
      },
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      getMission: async () => undefined,
      appendPeerLinks: async () => undefined,
      appendEditCheck: async () => undefined, appendApproval: async () => undefined
    } as unknown as MissionLedger
    const conversation = '03a2fcb4-8fd9-468e-a683-6bf3a5acd077'
    let ids = 0
    const service = createAntigravityMissionService({
      workspacePath: 'C:\\work\\pebble',
      ledger,
      probe: async () => ({
        executablePath: 'C:\\lang\\language_server.exe',
        version: '2.11.0',
        address: 'localhost:49839',
        csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e',
        projects: new Map([['c:/work/pebble', 'daf0f8ec-bb8e-49e8-a445-954eb0a62d0f']])
      }),
      emitEvent: () => undefined,
      emitUpdate: () => undefined,
      agentApi: (): AgentApi => ({ newConversation: async () => conversation, sendMessage: async () => undefined }),
      readTranscript: async (path) => (path === transcriptPathFor('C:\\Users\\dev', conversation) ? '' : undefined),
      home: 'C:\\Users\\dev',
      createId: () => String(++ids),
      now: () => new Date('2026-09-26T10:00:00.000Z'),
      pollMs: 5,
      notify: () => undefined
    })
    await service.start('A briefing the host wrote.', undefined, relay === undefined ? {} : { relay })
    service.dispose?.()
    expect(created).toHaveLength(1)
    return created[0]!
  }

  it('records that the relay started it, at its hop', async () => {
    expect((await run({ hop: 2, lastMissionOf: {} })).startedBy).toEqual({ kind: 'relay', hop: 2 })
  }, 10_000)

  it('records no starter for a run the person started', async () => {
    expect((await run(undefined)).startedBy).toBeUndefined()
  }, 10_000)
})
