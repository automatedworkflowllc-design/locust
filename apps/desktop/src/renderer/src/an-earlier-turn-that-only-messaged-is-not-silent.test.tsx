import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicPeerMessage } from '../../shared/ipc.js'
import { Thread } from './components/Thread.js'

/**
 * A TURN THAT ONLY MESSAGED A TEAMMATE DID NOT END WITHOUT A REPLY.
 *
 * Seen on drive-brief-once (2026-09-24, and the same on the 0.320 control):
 * Wren was asked to send Booty one message and say nothing else, and did.
 * While that was the latest turn the thread was right; once a third turn
 * followed, the earlier one read "This turn ended without a reply: the
 * runtime finished and wrote nothing back ... Sending it again usually works"
 * -- above "1 message to Booty", inviting the person to send it twice.
 */
let sequence = 0
const event = (type: string, payload: unknown): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `run:${String(sequence)}`,
    runId: 'run',
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 24, 16, sequence)).toISOString(),
    sourceAdapter: 'claude',
    type,
    payload
  } as unknown as NormalizedRuntimeEvent
}
// The reply was the block alone, which the thread draws as the message card.
const onlyABlock = [
  event('run.started', { runtimeThreadId: 's1' }),
  event('message.delta', { itemId: 'm1', operation: 'replace', text: '<locust-share to="Booty">The build is green.</locust-share>', final: true }),
  event('run.completed', {})
]
const answered = [
  event('run.started', { runtimeThreadId: 's1' }),
  event('message.delta', { itemId: 'm2', operation: 'replace', text: 'My teammate is Booty.', final: true }),
  event('run.completed', {})
]
const toBooty: PublicPeerMessage = {
  messageId: 'wm_1',
  direction: 'posted',
  from: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_2' },
  to: { teammateId: 'tm_booty', name: 'Booty' },
  text: 'The build is green.',
  at: '2026-09-24T16:02:00.000Z'
}

const thread = (earlierPeers: readonly PublicPeerMessage[]): string =>
  renderToStaticMarkup(
    <Thread
      prompt="What is your teammate called?"
      onOpenPeerRun={() => undefined}
      earlierTurns={[{ missionId: 'mission_2', prompt: 'Send Booty one message.', events: onlyABlock, peerMessages: earlierPeers }]}
      events={answered}
      running={false}
      restoredMission={undefined}
      error={undefined}
      errorIsPersistence={false}
      startedAt={undefined}
      approvals={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      decidingIds={[]}
      cancelled={false}
      handoff={undefined}
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
    />
  )

describe('an earlier turn that only messaged a teammate', () => {
  it('is not said to have ended without a reply', () => {
    expect(thread([toBooty])).not.toContain('ended without a reply')
  })

  it('still is, when it really wrote nothing and messaged nobody', () => {
    // The control: the notice is not simply gone from earlier turns.
    expect(thread([])).toContain('ended without a reply')
  })
})
