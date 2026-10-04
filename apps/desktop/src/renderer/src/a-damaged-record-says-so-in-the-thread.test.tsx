import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { Thread } from './components/Thread.js'

/**
 * A DAMAGED RECORD SAYS SO IN THE THREAD (QA-2026-09-29 round 2, N7).
 * A bad line mid-file cut the rest of the turn, and the reply above ended
 * mid-sentence with nothing on the thread to say why.
 */
const recorded = (integrityIssueCount: number): PublicRecoveredMission => ({
  missionId: 'mission_1',
  runId: 'run_1',
  workspaceId: 'ws_test',
  prompt: 'Summarize the turns',
  runtime: 'claude',
  model: 'opus',
  requestedRouteId: 'claude:opus',
  resolvedRouteId: 'claude:opus',
  cliVersion: null,
  createdAt: '2026-09-29T09:58:00.000Z',
  lastUpdatedAt: '2026-09-29T10:00:00.000Z',
  phase: 'completed',
  events: [],
  eventCount: 0,
  eventsTruncated: false,
  integrityIssueCount,
  sandbox: 'workspace-write',
  checkpoints: [],
  peerMessages: []
})

const thread = (restored: PublicRecoveredMission): string =>
  renderToStaticMarkup(
    <Thread
      prompt="Summarize the turns"
      onOpenPeerRun={() => undefined}
      earlierTurns={[]}
      events={[]}
      running={false}
      restoredMission={restored}
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

describe('a turn whose record was damaged', () => {
  it('says what is missing and that the file is kept', () => {
    expect(thread(recorded(1))).toContain('could not be read, so what came after it is missing here. The file is kept as it is.')
  })

  it('says nothing of the kind when the record read whole', () => {
    expect(thread(recorded(0))).not.toContain('could not be read')
  })
})
