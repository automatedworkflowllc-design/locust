import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { HandoffDivider } from './components/HandoffDivider.js'
import { HANDOFF_INSTRUCTION_MARKER } from './missionView.js'
import { routineDraft } from './routines.js'

/**
 * A CONVERSATION SWITCHED TO ANOTHER RUNTIME PARTWAY THROUGH.
 *
 * drive-runtime-switch on packaged 0.309 (Codex, then a free OpenCode model):
 * the word said on Codex came across, but the thread showed no divider; opened
 * again, the first message was gone, Codex's reply sat under the later
 * question, and the divider read "Codex -> opencode".
 */
describe('the divider', () => {
  it('names every runtime by its name', () => {
    const html = renderToStaticMarkup(<HandoffDivider from="codex" to="opencode" at={undefined} unsettledCount={0} omittedBriefing={[]} />)
    expect(html).toContain('aria-label="Handed off from Codex to OpenCode"')
    expect(html).not.toContain('opencode')
    const cursor = renderToStaticMarkup(<HandoffDivider from="cursor" to="claude" at={undefined} unsettledCount={0} omittedBriefing={[]} />)
    expect(cursor).toContain('aria-label="Handed off from Cursor Agent to Claude Code"')
  })
})

describe('saving a switched conversation as a routine', () => {
  function turn(missionId: string, prompt: string, runtime: PublicRecoveredMission['runtime'], continuesFrom?: PublicRecoveredMission['continuesFrom']): PublicRecoveredMission {
    return {
      missionId,
      runId: `run_${missionId}`,
      workspaceId: 'ws_test',
      prompt,
      runtime,
      model: 'default',
      requestedRouteId: runtime,
      resolvedRouteId: `${runtime}:default`,
      cliVersion: null,
      createdAt: '2026-09-24T04:00:00.000Z',
      lastUpdatedAt: '2026-09-24T04:00:00.000Z',
      phase: 'completed',
      events: [],
      eventCount: 0,
      eventsTruncated: false,
      integrityIssueCount: 0,
      sandbox: 'read-only',
      checkpoints: [],
      peerMessages: [],
      ...(continuesFrom === undefined ? {} : { continuesFrom })
    } as PublicRecoveredMission
  }

  it('takes the words typed on each side of the switch, never the host’s briefing', () => {
    const first = turn('r1', 'Remember the word marigold.', 'codex')
    const second = turn(
      'r2',
      `You are continuing a conversation another agent (Codex) started.\n\nWhat was done: ...\n\n${HANDOFF_INSTRUCTION_MARKER}\n\nWhat was the word?`,
      'opencode',
      { missionId: 'r1', checkpointEpoch: 2, reason: 'route-switch' }
    )
    const byId = new Map([first, second].map((mission) => [mission.missionId, mission] as const))
    expect(routineDraft(second, byId)?.steps).toEqual(['Remember the word marigold.', 'What was the word?'])
  })
})
